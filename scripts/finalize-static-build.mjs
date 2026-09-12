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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
// Stale route HTML from earlier builds is the same problem as stale assets,
// but it cannot be fixed by clearing dist/ wholesale: dist/ also holds the
// BACKEND build output (interface/, plugins/, models && skills/, src/, ...),
// which this script never produced and must never delete.
//
// So record exactly which top-level entries the frontend build emitted, and on
// the next run delete only the ones that are no longer emitted. A route that
// was deleted from src/routes stops being generated and is then removed here,
// instead of being served forever -- which is how a deleted preview route was
// still shipping, still referencing a script that had been taken out of the
// app.
const MANIFEST_FILE = join(DEST, '.frontend-build-manifest.json')
const currentEntries = readdirSync(SRC)
let previousEntries = []
try {
  if (existsSync(MANIFEST_FILE)) {
    const parsed = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
    if (Array.isArray(parsed?.entries)) previousEntries = parsed.entries.filter(e => typeof e === 'string')
  }
} catch (e) {
  // A corrupt manifest must not fail the build; the worst case is that one
  // generation of stale files survives until the next successful write.
  console.warn(`[finalize] could not read the previous build manifest: ${e.code || e.message}`)
}

// The manifest only knows what it has recorded, so entries left behind BEFORE
// it existed would survive forever. Seed it by detecting them: a prerendered
// route is a directory containing index.html, and no backend output directory
// in dist/ (interface/, plugins/, src/, models && skills/, plugin_manager/,
// extension-builder/, extension_system/) has one -- verified against the real
// build output before relying on it.
if (previousEntries.length === 0) {
  for (const entry of readdirSync(DEST)) {
    if (entry === 'assets' || entry === '_redirects') continue
    try {
      if (existsSync(join(DEST, entry, 'index.html'))) previousEntries.push(entry)
    } catch { /* unreadable entry -- leave it alone */ }
  }
  if (previousEntries.length > 0) {
    console.log(`[finalize] first run: adopted ${previousEntries.length} existing route entr(ies) for tracking`)
  }
}

const nowEmitted = new Set(currentEntries)
let staleRoutes = 0
for (const previous of previousEntries) {
  if (nowEmitted.has(previous)) continue
  // Never touch the platform's pre-injected redirect, and never walk outside
  // dist/ via a manifest entry that somehow contains a path separator.
  if (previous === '_redirects' || previous.includes('/') || previous.includes('\\') || previous.includes('..')) continue
  try {
    rmSync(join(DEST, previous), { recursive: true, force: true })
    staleRoutes++
  } catch (e) {
    console.warn(`[finalize] could not remove stale entry ${previous}: ${e.code || e.message}`)
  }
}
if (staleRoutes > 0) console.log(`[finalize] removed ${staleRoutes} stale route entr(ies) no longer produced by the build`)

// cpSync MERGES into an existing directory, so a nested route that is no
// longer prerendered survives inside a parent that still is -- app/ is still
// emitted, so app/shared-chat/ from an older build stayed and kept serving
// stale HTML. Route directories are entirely build output, so replace each one
// wholesale rather than copying over the top of it.
for (const entry of currentEntries) {
  if (entry === 'assets' || entry === '_redirects') continue
  const target = join(DEST, entry)
  if (!existsSync(target)) continue
  // Only directories this build is about to re-emit, never backend output.
  try {
    if (existsSync(join(SRC, entry)) && statSync(join(SRC, entry)).isDirectory()) {
      rmSync(target, { recursive: true, force: true })
    }
  } catch (e) {
    console.warn(`[finalize] could not replace ${entry}: ${e.code || e.message}`)
  }
}

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

// Written only after every entry copied successfully, so a failed build never
// leaves a manifest claiming files that are not actually there.
writeFileSync(MANIFEST_FILE, JSON.stringify({ entries: currentEntries }, null, 2) + '\n')

rmSync('.vite-out', { recursive: true, force: true })

if (!existsSync(join(DEST, 'index.html'))) {
  console.error('[finalize] dist/index.html missing after flatten — build is not publishable')
  process.exit(1)
}

console.log('[finalize] ✓ static build flattened to dist/ (dist/index.html ready)')
