import { defineConfig } from 'vite';
import path from 'path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// ESM/CJS interop safety: if a package ever resolves through an interop layer
// that double-wraps its default export, `namespace.default.default` is the real
// function. Pick the deepest callable so the config works regardless of how the
// bundler externalised the module.
function pickCallable(ns: Record<string, unknown>, dflt: unknown): any {
  let fn: any = typeof dflt === 'function' ? dflt : (ns as any).default;
  if (typeof fn === 'function' && typeof fn.default === 'function') fn = fn.default;
  return fn;
}

// Torn-install fallback (see the long comment above CONFIG_BARE_DEPS): when one
// of the plugin packages below is corrupt, Vite's rolldown config-bundler dies
// with "Failed to resolve entry" — but only for *static* bare imports. These
// are dynamic `await import()` calls: externalize-deps resolves them lazily via
// plain Node at run time, which is the one resolution path both reported
// failures proved works. When every dep is intact these lines are equivalent
// in effect to the static imports they replace.
const modStart = await import(/* @vite-ignore */ '@tanstack/react-start/plugin/vite');
const modReact = await import(/* @vite-ignore */ '@vitejs/plugin-react');
const modTw = await import(/* @vite-ignore */ '@tailwindcss/vite');
const tanstackStart = pickCallable(modStart, undefined) ?? (modStart as any).tanstackStart;
const viteReact = pickCallable(modReact, modReact.default);
const tailwindcss = pickCallable(modTw, modTw.default);

// Guarantee global CSS survives an AI coding agent's rewrite of
// src/routes/__root.tsx. TanStack Start only emits a stylesheet for CSS
// imported by a ROUTE module, and an agent regenerating __root.tsx from
// scratch will often drop the `import '../index.css'` — orphaning Tailwind
// so the app renders unstyled. This runs on EVERY compile (dev HMR +
// prerender build), so the import is always present in the route module
// Start collects — no backend/timing dependency, styled on the first
// render. Idempotent (skips if already imported).
function ensureRootCss() {
  return {
    name: 'ensure-root-css',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?')[0];
      if (!file.endsWith('/src/routes/__root.tsx')) return null;
      // Already imports the global stylesheet (bare side-effect import)? Leave it.
      if (/import\s+['"][^'"]*index\.css['"]/.test(code)) return null;
      // Only inject if src/index.css actually exists — never force-import a file the
      // user deleted (CSS-modules / styled-components / a different entry), which would
      // turn an unstyled page into a hard "module not found" build error.
      const cssPath = path.resolve(path.dirname(file), '../index.css');
      if (!fs.existsSync(cssPath)) return null;
      // Append (ES imports hoist) so existing line numbers — and therefore stack
      // traces / dev-overlay positions in the user's __root.tsx — are unchanged.
      return { code: `${code}\nimport '../index.css';\n`, map: null };
    },
  };
}

// Make a FAILED route-tree generation visible instead of silent.
//
// When TanStack's generator throws (two files claiming the same path, a route file
// with no `Route` export, a syntax error in a route), it fails inside the plugin:
// nothing is printed where the agent or the user can see it, `routeTree.gen.ts` is
// left STALE, and the dev server happily keeps serving the last good tree. So the
// preview looks healthy while every deploy build dies — the app is "done" and broken
// at the same time. Agents then read the stale gen file, conclude the watcher is
// wedged, and debug the wrong problem (or hand-write the gen file).
//
// This detects the condition generically — WITHOUT reimplementing TanStack's path
// resolution: if a route file exists on disk but no import for it appears in the
// generated tree, generation is failing. Vite's own ErrorPayload then puts it on the
// dev overlay, which is what the user (or an AI coding agent working in this repo)
// sees on their next turn.
//
// Report-only and fail-open: it never edits files, never blocks the server, and any
// error inside the check is swallowed. Debounced + re-checked so an in-flight
// regeneration is never reported as a failure.
function routeTreeHealth() {
  const ROUTES_DIR = path.resolve(import.meta.dirname, './src/routes');
  const GEN_FILE = path.resolve(import.meta.dirname, './src/routeTree.gen.ts');
  const SETTLE_MS = 1200;
  // Boot needs more slack than an edit: the first generation, dep optimisation and
  // the initial compile all land after the server starts.
  const STARTUP_SETTLE_MS = 4000;

  /**
   * Route files whose module path should appear in the generated tree. Only files
   * that actually call `createFileRoute` count — agents legitimately keep helper
   * components (e.g. an auth-gate) next to routes, and those never appear in the
   * tree; treating them as missing would raise a false alarm, which is exactly the
   * kind of misleading signal this plugin exists to remove.
   */
  function routeFiles(dir: string, base = ''): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // TanStack's `routeFileIgnorePrefix` (default `-`): `-`-prefixed files and
      // directories are intentionally excluded from the generated tree, so they
      // must never be counted as missing.
      if (entry.name.startsWith('-')) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out.push(...routeFiles(path.join(dir, entry.name), rel));
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.startsWith('__root.')) {
        if (!/createFileRoute\s*\(/.test(fs.readFileSync(path.join(dir, entry.name), 'utf-8'))) continue;
        // `.lazy` files are code-split halves of a route registered under its
        // non-lazy id — normalise so they are never reported as missing.
        out.push(rel.replace(/\.lazy\.tsx?$/, '').replace(/\.tsx?$/, ''));
      }
    }
    return out;
  }

  function missingFromTree(): string[] {
    if (!fs.existsSync(GEN_FILE) || !fs.existsSync(ROUTES_DIR)) return [];
    const gen = fs.readFileSync(GEN_FILE, 'utf-8');
    return [...new Set(routeFiles(ROUTES_DIR))].filter(id => {
      // Anchor on the closing quote (optionally an extension) so a parent id like
      // `app` isn't considered present just because `./routes/app/index` is.
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`\\./routes/${escaped}(\\.tsx?)?['"\`]`).test(gen);
    });
  }

  return {
    name: 'route-tree-health',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      let timer: NodeJS.Timeout | undefined;
      // Last reported failure, kept so it can be re-sent to clients that connect
      // AFTER it was detected — a startup-time failure is found within seconds of
      // boot, long before anyone opens the preview, and ws.send with no client
      // attached reaches nobody.
      let pending: string | null = null;

      const report = (message: string) => {
        pending = message;
        try {
          server.ws.send({
            type: 'error',
            err: { message, stack: '', plugin: 'route-tree-health', id: GEN_FILE },
          });
        } catch {
          /* fail open */
        }
      };

      const check = () => {
        try {
          // Two passes: the first can race an in-flight write of routeTree.gen.ts.
          const missing = missingFromTree();
          if (missing.length === 0) {
            pending = null;
            return;
          }
          setTimeout(() => {
            try {
              const stillMissing = missingFromTree();
              if (stillMissing.length === 0) {
                pending = null;
                return;
              }
              const files = stillMissing.map(id => `  src/routes/${id}.tsx`).join('\n');
              const message =
                'Route generation FAILED — src/routeTree.gen.ts is stale, so these route ' +
                'files are NOT registered and the production build will fail:\n' +
                `${files}\n\n` +
                'The dev preview is still serving the last good route tree, so it looks fine — ' +
                'it is not. Run `bun run build` to see the generator error verbatim.\n\n' +
                'Most common cause: two files resolving to the SAME path. A `_`-prefixed ' +
                'layout is PATHLESS (no URL segment), so `src/routes/_x/index.tsx` — and a ' +
                'childless `src/routes/_x.tsx` — both resolve to "/" and collide with ' +
                'src/routes/index.tsx. Put dashboard pages under the real `/app` segment ' +
                '(src/routes/app/) instead. Also check every route file exports ' +
                '`const Route = createFileRoute(...)` — never `export default`.';
              report(message);
              server.config.logger.error(`[route-tree-health] ${message}`);
            } catch {
              /* fail open */
            }
          }, SETTLE_MS);
        } catch {
          /* fail open */
        }
      };

      server.watcher.on('all', (_event: string, file: string) => {
        if (!file.startsWith(ROUTES_DIR)) return;
        clearTimeout(timer);
        timer = setTimeout(check, SETTLE_MS);
      });

      // Check once at boot too. A tree that is ALREADY broken when the server starts
      // never triggers the watcher — nothing under src/routes changes — so without
      // this the plugin would miss the single most common real-world arrival of the
      // failure: a turn that died mid-restructure, a restored sandbox, or a
      // dependency-triggered dev-server restart. Longer settle than the watcher path
      // because the first generation only runs once the server is up.
      const startupTimer = setTimeout(check, STARTUP_SETTLE_MS);

      // Re-send to clients that attach after the fact (the boot-time failure is
      // detected before any browser is connected). Guarded: if this Vite version
      // doesn't emit 'connection', nothing happens and the plugin still works.
      try {
        server.ws.on('connection', () => {
          if (pending) report(pending);
        });
      } catch {
        /* fail open */
      }

      server.httpServer?.once('close', () => {
        clearTimeout(startupTimer);
        clearTimeout(timer);
      });
    },
  };
}

// Resilient loading of vite.config.ts itself (reported crashes: `npm run dev`
// booted the backend, then died with "failed to load config from
// vite.config.ts" + 'Failed to resolve entry for package
// "@vitejs/plugin-react"' coming from Vite's internal [plugin
// externalize-deps], and later "Cannot find module
// '@tanstack/react-start/plugin/vite'" from the module-runner path).
//
// Background: by default Vite loads this file by re-bundling it with rolldown,
// whose `externalize-deps` plugin runs Vite's OWN package resolver on every
// bare import. If an installed package's files don't match its package.json
// exports map — a torn npm install, e.g. after an install crashed mid-way with
// the arborist "edgesOut" bug seen in this repo — that resolver hard-fails and
// the dev server never starts, even though plain Node resolves the package
// fine. Verified experimentally here: deleting
// node_modules/@vitejs/plugin-react/dist/index.js reproduces the exact
// reported error under the bundler path, while plain Node still resolved it.
//
// The FIRST fix here switched to Vite's module runner (`--config-loader=runner`)
// to sidestep rolldown's resolver — but that introduced a worse failure mode on
// real user machines: the runner imports bare deps through Vite's own module
// pipeline with its own resolution/caching semantics, so it can die with
// ERR_MODULE_NOT_FOUND for packages plain Node resolves perfectly (e.g. stale
// runner caches or strict conditional-export handling around
// '@tanstack/react-start/plugin/vite'). That is exactly the second crash above.
//
// Final approach — eliminate the fragile dependency instead of juggling loaders:
// this file no longer *statically* imports any plugin package. The three Vite
// plugins are loaded with plain-Node dynamic `await import()` (top of file),
// which rolldown's externalize-deps pass never touches — it only resolves
// static bare imports. So even on a torn install ("Failed to resolve entry for
// package @vitejs/plugin-react"), the config bundles cleanly and the plugins
// load through Node's own resolver, the one path both reported failures proved
// works. No forced --config-loader flag anywhere (the runner variant caused the
// second crash: ERR_MODULE_NOT_FOUND for packages plain Node resolves fine).
//
// Belt-and-braces last resort: the self-check below (`configDepIsIntact`)
// verifies every bare specifier this config needs actually resolves AND that
// all files listed in each package's package.json "exports"/"main" exist on
// disk. If an install is so broken that something else still trips the bundler,
// we re-exec the SAME command once with `--configLoader native` (Vite loads
// this file through Node itself — no rolldown, no runner), guarded by an env
// var against loops. On a healthy install none of this runs and behaviour is
// identical to stock Vite. scripts/dev.mjs likewise does not force a loader.
const CONFIG_BARE_DEPS = [
  'vite',
  '@tanstack/react-start',
  // Subpath exactly as imported by this config, so the check verifies the
  // real specifier (plain Node resolves '<pkg>/package.json' even when the
  // package's "exports" map omits it — which is what rolldown's stricter
  // externalize-deps pass then dies on at bundle time).
  '@tanstack/react-start/plugin/vite',
  '@vitejs/plugin-react',
  '@tailwindcss/vite',
];

/**
 * True only when `specifier` resolves through Node's own ESM resolver AND
 * every concrete file target listed in the owning package's package.json
 * "exports"/"main" exists on disk. Additionally, if the package's "exports"
 * map has no entry covering `specifier` at all (bare or subpath), the
 * specifier is treated as broken — that mismatch is precisely what Vite's
 * rolldown `externalize-deps` pass chokes on after a torn install, while
 * legacy CJS require() would happily succeed.
 */
function configDepIsIntact(specifier: string): boolean {
  try {
    const require_ = createRequire(import.meta.url);
    // 1) The exact specifier must resolve via Node's modern resolver (honours
    //    the "exports" map). Throws for missing packages/files and for
    //    subpaths excluded by exports.
    const resolved = require_.resolve(specifier);
    // 2) Walk up from the resolved file to the owning package root.
    let pkgDir = path.dirname(resolved);
    for (;;) {
      if (path.basename(pkgDir) === 'node_modules') return false;
      if (fs.existsSync(path.join(pkgDir, 'package.json'))) break;
      const parent = path.dirname(pkgDir);
      if (parent === pkgDir) return false;
      pkgDir = parent;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
    const pkgName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    // Belt-and-braces: confirm this really is the package we asked for.
    if (pkg.name !== pkgName) return false;
    const targets: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') targets.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    if (pkg.exports) walk(pkg.exports);
    if (typeof pkg.main === 'string') targets.push(pkg.main);
    for (const t of targets) {
      // Skip wildcard export patterns like './dist/client/*' — they are
      // mapping rules, not concrete files, and don't exist on disk as-is.
      if (t.startsWith('.') && !t.includes('*') && !fs.existsSync(path.join(pkgDir, t))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const BROKEN_CONFIG_DEPS = CONFIG_BARE_DEPS.filter((d) => !configDepIsIntact(d));

// The three plugin specifiers loaded via dynamic `await import()` at the top of
// this file. When any of them is torn, Vite's default `bundle` config-loader
// (rolldown + externalize-deps) dies with the opaque "Failed to resolve entry"
// error — but note it only ever *externalises* those imports now; nothing in
// this file statically imports a plugin package anymore, so even a torn install
// bundles cleanly here and the plain-Node dynamic resolution above succeeds.
// The detection below exists as a belt-and-braces last resort for environments
// where something else about the torn install still trips the bundler: we then
// re-exec the SAME command once with `--configLoader native`, which loads this
// exact file through Node itself (no rolldown, no runner pipeline), guarded by
// an env var against loops. On a healthy install none of this runs.
const SHIMMED_SPECS = [
  '@tanstack/react-start/plugin/vite',
  '@vitejs/plugin-react',
  '@tailwindcss/vite',
];
const NEEDS_NATIVE_LOADER = BROKEN_CONFIG_DEPS.some((d) => SHIMMED_SPECS.includes(d));

if (
  NEEDS_NATIVE_LOADER &&
  !process.env.NEUROCLAW_CONFIG_LOADER_GUARD &&
  process.argv.every(
    (a) => a !== '--configLoader' && !a.startsWith('--configLoader='),
  ) &&
  process.env.VITEST === undefined // vitest loads configs programmatically
) {
  console.error(
    '[vite.config] Incomplete install detected for: ' +
      BROKEN_CONFIG_DEPS.join(', ') +
      '. Retrying config load with --configLoader native (plain Node). If this ' +
      'still fails, repair the install: `rm -rf node_modules package-lock.json && npm install --legacy-peer-deps`.',
  );
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(
      process.execPath,
      [...process.execArgv, ...process.argv.slice(1), '--configLoader', 'native'],
      {
        stdio: 'inherit',
        env: { ...process.env, NEUROCLAW_CONFIG_LOADER_GUARD: '1' },
      },
    );
    if (!r.error) process.exit(r.status ?? 0);
    // Could not re-exec meaningfully — fall through and load normally.
  } catch {
    /* fail open: original startup behaviour */
  }
}

export default defineConfig({
  plugins: [
    ensureRootCss(),
    routeTreeHealth(),
    // Tailwind v4 via the official Vite plugin. Handles `@import "tailwindcss"`
    // itself (must NOT be a PostCSS plugin here — TanStack Start's prerender build
    // runs postcss-import first and can't resolve the v4 bare import → build fails).
    tailwindcss(),
    // TanStack Start — SSR + static prerendering so search engines AND AI crawlers
    // (GPTBot/ClaudeBot/PerplexityBot, which do NOT execute JS) get fully-rendered
    // HTML on the first request. `prerender` emits crawlable static HTML at build time.
    // NOTE: the Start plugin MUST come before the React plugin.
    tanstackStart({
      // We register viteReact() explicitly below; without this flag Start
      // silently injects its own copy of the React plugin (duplicate) and
      // prints a deprecation warning.
      customViteReactPlugin: true,
      prerender: {
        enabled: true,
        // Follow in-app links from the prerendered entry to statically render
        // every reachable route.
        crawlLinks: true,
        // CRITICAL: do NOT fail the build when a crawled link 404s. Broken /
        // example / dynamic / auth-gated links are common, and `crawlLinks`
        // follows ALL of them — without this, ONE dead link aborts the whole
        // build → no dist/ → "404 NoSuchKey index.html" white screen. Skip + warn.
        failOnError: false,
      },
    }),
    viteReact(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    // R3F (@react-three/fiber, @react-three/drei) peers must share one React
    // instance or hooks crash with: Cannot read properties of null (reading 'useRef')
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
    watch: {
      // Real crash reported running `npm run dev`: "ENOSPC: System limit
      // for number of file watchers reached" from a file under
      // `model && skills manager/venv/.../torch/...` -- a Python venv's
      // site-packages easily contains tens of thousands of files, and
      // .gitignore (venv/, node_modules/, dist/, ...) has zero effect on
      // chokidar/native fs.watch, which watches the real filesystem
      // regardless of git's ignore rules. None of these directories
      // contain source Vite needs HMR for, so excluding them here is a
      // straightforward, low-risk fix (fewer watched files is strictly
      // safer, never a source of missed-reload bugs since nothing under
      // them is ever imported into the frontend bundle).
      ignored: [
        '**/venv/**',
        '**/.venv/**',
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/clones/**',
        // extension-builder/ used to also vendor PyTorch, Moby, CMUDict, and
        // DebianInstaller source trees (hundreds of MB combined) -- the
        // actual crash this list existed to prevent, reported running on a
        // phone (limited inotify headroom). Those vendored trees have been
        // removed (build-main-network.mjs / build-debian-network.mjs now
        // import this project's own source instead), so only the generated
        // extensions/ output needs excluding here.
        '**/extension-builder/extensions/**',
        '**/__pycache__/**',
        '**/.mypy_cache/**',
        '**/.pytest_cache/**',
        '**/coverage/**',
        '**/htmlcov/**',
      ],
    },
    // src/components/Desktop.tsx (the only fetch('/api/...') caller anywhere
    // in src/, confirmed by grep) calls the Node backend (interface/web-server.ts,
    // default port 7861 per interface/main.ts) assuming same-origin -- with no
    // proxy, that request 404s against this dev server, which has no /api routes
    // of its own. This only bridges `vite`/`vite dev`; the static `vite build`
    // output still has no route to the backend unless a hosting-layer reverse
    // proxy provides one (see DESKTOP_LAUNCHER_IMPLEMENTATION.md and
    // ARCHITECTURE.md for the disclosed production-deployment gap).
    proxy: {
      '/api': { target: 'http://127.0.0.1:7861', changeOrigin: true },
    },
  },
  build: {
    // Build into a clean temp dir; scripts/finalize-static-build.mjs then flattens
    // .vite-out/client/* -> dist/ so any static host can serve dist/index.html.
    // Building here instead of dist/ dodges the EACCES from Start's client build
    // emptying a platform-prepared dist/ that pre-injects a read-only
    // _redirects the sandbox user can't unlink.
    outDir: '.vite-out',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // three.js and react-three-fiber were being emitted into fifteen
        // separate route chunks -- 15 MB, half the built site, and all of it
        // the same library. The prerender pass builds a per-route entry, and
        // without an explicit shared chunk each one inlines its own copy.
        // Naming them here forces a single shared chunk that every route
        // references instead.
        manualChunks(id) {
          if (/node_modules\/(three|@react-three)\//.test(id)) return 'three';
        },
      },
    },
  },
});
