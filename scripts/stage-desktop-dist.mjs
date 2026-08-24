#!/usr/bin/env node
/**
 * Builds the web app for packaging into the desktop app, and proves the
 * result is what the desktop app should ship.
 *
 * The web build carries the Blink visual-editor runtime: a ~38KB inline
 * script in every page that stamps `data-blnk-id` onto a couple of hundred
 * elements before React hydrates, which makes React report a hydration
 * mismatch on every page. In the web project that is the editor and it stays.
 * The desktop app has no editor to talk to, so it builds with
 * VITE_BLINK_EDITOR=off and the script is simply never emitted.
 *
 * Building with the flag is the whole fix. Stripping the script out of the
 * finished HTML is NOT equivalent and was tried first: the client bundle
 * still renders it, so the two sides disagree and React reports error #418
 * instead of the original warning. Both sides have to agree, which means the
 * decision has to be made at build time.
 *
 * The verification at the end is not ceremony -- a silently-ignored env var
 * would put the editor runtime straight back into the shipped app, and the
 * only way to know is to look at the output.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(repoRoot, 'dist')
const staged = path.join(repoRoot, 'desktop-app', '.staged-dist')

/** The marker the editor runtime always carries, in HTML and in the bundle. */
const MARKER = 'BLINK_PICKER_RUNTIME_V2'

function filesIn(dir, exts) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...filesIn(full, exts))
    else if (exts.some(e => entry.endsWith(e))) found.push(full)
  }
  return found
}

console.log('[stage-desktop] building the web app with the editor runtime off…')
execFileSync('npm', ['run', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_BLINK_EDITOR: 'off' },
})

if (!existsSync(source)) {
  console.error('[stage-desktop] the build produced no dist/.')
  process.exit(1)
}

rmSync(staged, { recursive: true, force: true })
cpSync(source, staged, { recursive: true })

// Check the HTML *and* the JS bundles: the runtime lives in both when it is
// enabled, and a page is only genuinely clean when neither carries it.
const carriers = filesIn(staged, ['.html', '.js']).filter(f => readFileSync(f, 'utf8').includes(MARKER))
if (carriers.length > 0) {
  console.error(`[stage-desktop] VITE_BLINK_EDITOR=off did not take effect -- ${carriers.length} file(s) still carry the editor runtime:`)
  for (const f of carriers.slice(0, 10)) console.error(`  ${path.relative(staged, f)}`)
  process.exit(1)
}

const pages = filesIn(staged, ['.html']).length
console.log(`[stage-desktop] staged dist/ -> desktop-app/.staged-dist`)
console.log(`[stage-desktop] verified: 0 of ${pages} pages carry the editor runtime, and no JS bundle does either`)
