#!/usr/bin/env node
/**
 * Find code that exists but nothing can reach.
 *
 * This repository's most common defect, by a wide margin, is not a bug in
 * logic -- it is real, working, tested code with no call path. A store that
 * could not be reached from chat. A research plugin with searchWeb() and no
 * onMessage. A memory API with no page. Prompting skills that ran in the loop
 * with no UI. Twenty-six plugins absent from the routing table. A
 * loadRoutingMemory() nothing called, written the same hour as the comment
 * warning about this exact pattern.
 *
 * Each was found by hand, days or weeks after being written, and each looked
 * finished from the inside: it compiled, it had tests, the tests passed. The
 * tests passed because they called the code directly, which is precisely the
 * one caller that proves nothing about reachability.
 *
 * So this checks the property those tests cannot: for every exported symbol,
 * does anything outside its own file and its own tests actually use it.
 *
 * Deliberately a report, not a failure. Plenty of exports are legitimately
 * unused right now -- a public API surface, something a future caller will
 * want, a symbol exported only for tests. The point is to make the list
 * visible and small enough to read, so a new entry stands out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SEARCH_DIRS = ['models && skills', 'plugins', 'plugin_manager', 'interface', 'src']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite-out', 'generated', 'clones'])

/** Exports a symbol name is allowed to be unused under, with the reason. */
const EXPECTED_UNUSED = [
  [/^(default)$/, 'default export'],
  [/Props$|Options$|Config$|Result$|Event$|Item$|Info$|Summary$|View$|Record$/, 'a type others may implement against'],
]

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Exported symbol names in a file. Regex, not a parser -- good enough to spot the pattern. */
function exportsOf(source) {
  const names = new Set()
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) names.add(m[1])
  }
  return names
}

const files = SEARCH_DIRS.flatMap(d => walk(path.join(ROOT, d)))
const sources = new Map(files.map(f => [f, readFileSync(f, 'utf8')]))
// Tests count as callers for "is this used at all", but NOT for reachability:
// a test calling a function directly is exactly the caller that proves nothing.
const testFiles = [...walk(path.join(ROOT, 'test')), ...walk(path.join(ROOT, 'tests'))]
const testSource = testFiles.map(f => { try { return readFileSync(f, 'utf8') } catch { return '' } }).join('\n')

const findings = []
for (const [file, source] of sources) {
  const rel = path.relative(ROOT, file)
  for (const name of exportsOf(source)) {
    if (EXPECTED_UNUSED.some(([re]) => re.test(name))) continue

    let usedElsewhere = false
    for (const [otherFile, otherSource] of sources) {
      if (otherFile === file) continue
      // Word-boundary match: `foo` must not be satisfied by `fooBar`.
      if (new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(otherSource)) { usedElsewhere = true; break }
    }
    if (usedElsewhere) continue

    const usedInTests = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(testSource)
    findings.push({ file: rel, name, usedInTests })
  }
}

// Tested-but-unreachable first: those are the dangerous ones. Something with
// tests and no production caller looks finished and is not, which is the exact
// shape every defect listed at the top of this file had.
findings.sort((a, b) => Number(b.usedInTests) - Number(a.usedInTests) || a.file.localeCompare(b.file))

const tested = findings.filter(f => f.usedInTests)
const untouched = findings.filter(f => !f.usedInTests)

console.log(`Scanned ${sources.size} files in ${SEARCH_DIRS.join(', ')}\n`)
console.log(`TESTED BUT NOT USED IN PRODUCTION CODE (${tested.length})`)
console.log('  These have tests, so they look finished. Nothing outside their own')
console.log('  file and their tests calls them.\n')
for (const f of tested) console.log(`  ${f.file}  ->  ${f.name}`)
console.log(`\nEXPORTED AND UNUSED ANYWHERE (${untouched.length})\n`)
for (const f of untouched) console.log(`  ${f.file}  ->  ${f.name}`)
console.log(`\n${findings.length} total.`)

// Never fails the build: many of these are legitimate. It reports.
process.exit(0)
