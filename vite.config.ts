import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'node:fs';
// Blink Visual Editor: stamps data-blnk-id on JSX + injects iframe-side picker
// runtime. Self-contained (no external deps) so this template stays portable.
import { blinkTaggerPlugin } from './plugins/blink-tagger.plugin.mjs';

// Blink: guarantee global CSS survives agent rewrites of src/routes/__root.tsx.
// TanStack Start only emits a stylesheet for CSS imported by a ROUTE module, and
// the agent frequently regenerates __root.tsx from scratch and drops the
// `import '../index.css'` — orphaning Tailwind so the app renders unstyled. This
// runs in-sandbox on EVERY compile (dev HMR + prerender build), so the import is
// always present in the route module Start collects — no backend/timing
// dependency, styled on the first render. Idempotent (skips if already imported).
function blinkEnsureRootCss() {
  return {
    name: 'blink-ensure-root-css',
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

// Blink: make a FAILED route-tree generation visible instead of silent.
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
// dev overlay, which is both what the user sees and what Blink's preview-error
// channel forwards to the agent's next turn.
//
// Report-only and fail-open: it never edits files, never blocks the server, and any
// error inside the check is swallowed. Debounced + re-checked so an in-flight
// regeneration is never reported as a failure.
function blinkRouteTreeHealth() {
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
    name: 'blink-route-tree-health',
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
            err: { message, stack: '', plugin: 'blink-route-tree-health', id: GEN_FILE },
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
              server.config.logger.error(`[blink] ${message}`);
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

export default defineConfig({
  plugins: [
    blinkEnsureRootCss(),
    blinkRouteTreeHealth(),
    // Tailwind v4 via the official Vite plugin. Handles `@import "tailwindcss"`
    // itself (must NOT be a PostCSS plugin here — TanStack Start's prerender build
    // runs postcss-import first and can't resolve the v4 bare import → build fails).
    tailwindcss(),
    // Build-time tagger OFF by default — its transform can stamp data-blnk-id into
    // HTML inside string literals. Enable with BLINK_BUILD_TIME_TAGGER=on.
    ...(process.env.BLINK_BUILD_TIME_TAGGER === 'on' ? [blinkTaggerPlugin()] : []),
    // TanStack Start — SSR + static prerendering so search engines AND AI crawlers
    // (GPTBot/ClaudeBot/PerplexityBot, which do NOT execute JS) get fully-rendered
    // HTML on the first request. `prerender` emits crawlable static HTML at build time.
    // NOTE: the Start plugin MUST come before the React plugin.
    tanstackStart({
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
    // @blinkdotnew/ui + framer-motion + R3F peers must share one React instance or hooks
    // crash inside motion with: Cannot read properties of null (reading 'useRef')
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'framer-motion'],
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
        '**/extension-builder/Moby/**',
        '**/extension-builder/CMUDict/**',
        '**/extension-builder/debian-installer/**',
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
    // .vite-out/client/* -> dist/ so Blink hosting serves dist/index.html
    // (BUILD_PATHS['vite-react'] = 'dist'). Building here instead of dist/ dodges the
    // EACCES from Start's client build emptying the platform-prepared dist/, which
    // pre-injects a read-only _redirects the sandbox user can't unlink.
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
