#!/usr/bin/env node
/**
 * shared-mesh-base.mjs — writes extension-builder/shared-mesh/base.json, the
 * one canonical starting network every install loads before adding its own
 * learning (see models && skills/core/shared-mesh.ts for why one is needed).
 *
 * Run it only to START OVER: a new base has a new baseId, and every delta
 * computed against the old one is then ignored by every install. Needs a
 * built backend (node scripts/build-backend.mjs).
 *
 * Usage: node scripts/shared-mesh-base.mjs [--force]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './git-worktree-utils.mjs'

const OUT = path.join(ROOT, 'extension-builder', 'shared-mesh', 'base.json')

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error(`${path.relative(ROOT, OUT)} already exists -- pass --force to replace it (this invalidates every published delta).`)
  process.exit(1)
}

const dist = (rel) => pathToFileURL(path.join(ROOT, 'dist', rel)).href
const { NeuroPipeline } = await import(dist('models && skills/core/pipeline.js'))
const { makeBaseFile } = await import(dist('models && skills/core/shared-mesh.js'))

const engine = new NeuroPipeline().ensureBrain()
const base = makeBaseFile(engine.captureNetworkState())
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(base) + '\n', 'utf8')
console.log(`wrote ${path.relative(ROOT, OUT)} (baseId ${base.baseId}, ${base.shape.neurons}x${base.shape.dimensions})`)
