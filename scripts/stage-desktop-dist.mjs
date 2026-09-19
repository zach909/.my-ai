#!/usr/bin/env node
/**
 * Builds the web app and stages the result for packaging into the desktop
 * app (desktop-app/.staged-dist, which electron-builder's `extraResources`
 * picks up — see desktop-app/package.json).
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(repoRoot, 'dist')
const staged = path.join(repoRoot, 'desktop-app', '.staged-dist')

console.log('[stage-desktop] building the web app…')
execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })

if (!existsSync(source)) {
  console.error('[stage-desktop] the build produced no dist/.')
  process.exit(1)
}

rmSync(staged, { recursive: true, force: true })
cpSync(source, staged, { recursive: true })

console.log('[stage-desktop] staged dist/ -> desktop-app/.staged-dist')
