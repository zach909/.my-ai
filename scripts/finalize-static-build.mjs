/**
 * Flatten the TanStack Start build into a static `dist/` that Blink hosting serves.
 *
 * TanStack Start's `vite build` (configured with `build.outDir: '.vite-out'`)
 * emits:
 *   .vite-out/client/   ← prerendered HTML + assets (what we want, STATIC)
 *   .vite-out/server/   ← SSR Nitro server (NOT used by Blink's static S3 hosting)
 *
 * Blink uploads `dist/` and serves `dist/index.html` (see src/constants/publish.ts
 * BUILD_PATHS['vite-react'] = 'dist'). So we copy `.vite-out/client/*` up into a
 * flat `dist/` and drop the server.
 *
 * Why build into `.vite-out` instead of `dist/` directly: the platform pre-injects
 * `dist/.../​_redirects` (the SPA fallback) owned by another user, and Start's client
 * build tries to EMPTY its out dir first → `EACCES: unlink _redirects`. Building into
 * a clean temp dir avoids that entirely; here we only COPY into `dist/` (never delete),
 * so a pre-existing read-only `_redirects` is tolerated.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SRC = '.vite-out/client'
const DEST = 'dist'

if (!existsSync(SRC)) {
  console.error(`[finalize] build output missing: ${SRC} — did "vite build" run?`)
  process.exit(1)
}

mkdirSync(DEST, { recursive: true })

// Clear dist/assets before copying. Asset filenames are content-hashed, so a
// rebuild writes NEW names and leaves the previous ones behind forever --
// dist/assets had grown to 33 MB across 308 files, of which a clean build
// produces 2.4 MB across 58. The rest was dead chunks from earlier builds,
// including fifteen separate 900 KB copies of three.js, and the desktop app
// packages all of dist/, so every one of them shipped to users.
//
// Only assets/ is cleared, not dist/ as a whole: the never-delete rule exists
// for the platform's pre-injected read-only _redirects at the top level, and
// nothing but build output ever lands in assets/. A file that cannot be
// removed is warned about rather than fatal, since a leftover is wasteful but
// harmless, whereas failing the build here would not be.
const ASSETS = join(DEST, 'assets')
if (existsSync(ASSETS)) {
  let cleared = 0
  for (const stale of readdirSync(ASSETS)) {
    try {
      rmSync(join(ASSETS, stale), { recursive: true, force: true })
      cleared++
    } catch (e) {
      console.warn(`[finalize] could not remove stale asset ${stale}: ${e.code || e.message}`)
    }
  }
  if (cleared > 0) console.log(`[finalize] cleared ${cleared} stale asset(s) from dist/assets`)
}

for (const entry of readdirSync(SRC)) {
  try {
    cpSync(join(SRC, entry), join(DEST, entry), { recursive: true, force: true })
  } catch (e) {
    // ONLY the platform-pre-injected `_redirects` may be skipped: it's read-only,
    // already in dist/, and byte-identical to ours. ANY other failed entry (assets/,
    // index.html, route html) would leave dist/index.html pointing at missing or
    // stale hashed assets — a silently broken deployment. Fail the build instead.
    if (entry === '_redirects') {
      console.warn(`[finalize] skip ${entry}: ${e.code || e.message} (pre-injected, identical content)`)
    } else {
      console.error(`[finalize] FAILED copying ${entry} into dist/: ${e.code || e.message} — aborting (a partial dist/ deploys broken)`)
      process.exit(1)
    }
  }
}

rmSync('.vite-out', { recursive: true, force: true })

if (!existsSync(join(DEST, 'index.html'))) {
  console.error('[finalize] dist/index.html missing after flatten — build is not publishable')
  process.exit(1)
}

console.log('[finalize] ✓ static build flattened to dist/ (dist/index.html ready)')
