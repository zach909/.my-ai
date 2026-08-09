#!/usr/bin/env node
/**
 * system-diagnostics.mjs — read-only startup diagnostic printed when
 * `npm run server` runs: memory pressure and the processes actually
 * consuming it, "so they know if their computer is taking up a lot of
 * memory... to speed up their AI processing."
 *
 * Deliberately NOT a virus scanner, and deliberately NOT invasive: this
 * never kills, deprioritizes, or modifies anything on the machine it
 * runs on -- per this session's own scoping decision, an app that
 * silently changes system state for anyone who clones the repo and runs
 * `npm run server` is not something to build. This only reads memory
 * stats and process listings and prints a report; a process using an
 * unusual amount of memory is flagged as "worth checking," never
 * diagnosed as malware -- actual malware detection needs a real
 * antivirus engine with signature/heuristic databases this script does
 * not have, and claiming otherwise would be dishonest. The report says
 * so explicitly.
 */

import { spawnSync } from 'node:child_process'
import os from 'node:os'

function log(...args) {
  console.log('[system-diagnostics]', ...args)
}

export function getMemoryReport() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  return { totalBytes: total, freeBytes: free, usedBytes: used, usedFraction: used / total }
}

/** Top processes by memory share, read-only, best-effort. POSIX only
 *  (`ps`) -- degrades to an empty list rather than guessing on platforms
 *  without it (e.g. Windows, where `tasklist`'s output shape isn't worth
 *  parsing unreliably for a report this cosmetic). */
export function getTopProcessesByMemory(limit = 8) {
  if (process.platform === 'win32') return []
  const res = spawnSync('ps', ['-eo', 'pid,comm,%mem,%cpu', '--sort=-%mem'], { encoding: 'utf8', timeout: 5000 })
  if (res.status !== 0 || !res.stdout) return []
  const lines = res.stdout.trim().split('\n').slice(1, limit + 1) // skip the header row
  return lines
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)$/)
      if (!match) return null
      const [, pid, command, memPercent, cpuPercent] = match
      return { pid: Number(pid), command, memPercent: Number(memPercent), cpuPercent: Number(cpuPercent) }
    })
    .filter(Boolean)
}

/** A process using more than this share of total memory gets flagged in
 *  the report as worth a look -- not accused of anything, just surfaced. */
const FLAG_MEM_PERCENT_THRESHOLD = 15

export function buildDiagnosticsReport() {
  const memory = getMemoryReport()
  const processes = getTopProcessesByMemory()
  const flagged = processes.filter((p) => p.memPercent >= FLAG_MEM_PERCENT_THRESHOLD)
  return { memory, processes, flagged }
}

export function formatReport(report) {
  const lines = []
  lines.push(`System memory: ${(report.memory.usedFraction * 100).toFixed(1)}% used (${formatBytes(report.memory.usedBytes)} / ${formatBytes(report.memory.totalBytes)})`)
  if (report.memory.usedFraction > 0.85) {
    lines.push('  -> Memory is under real pressure -- closing unused apps/tabs before running heavy training cycles will help.')
  }
  if (report.processes.length > 0) {
    lines.push('Top memory consumers:')
    for (const p of report.processes) {
      lines.push(`  ${p.memPercent.toFixed(1)}% mem, ${p.cpuPercent.toFixed(1)}% cpu -- ${p.command} (pid ${p.pid})`)
    }
  }
  if (report.flagged.length > 0) {
    lines.push(`Worth a look: ${report.flagged.map((p) => p.command).join(', ')} ${report.flagged.length === 1 ? 'is' : 'are'} using an unusually large share of memory.`)
  }
  lines.push('Note: this is a resource-usage report, not a virus scanner -- it cannot detect malware. If something above looks wrong, run a real antivirus/anti-malware tool to check.')
  return lines.join('\n')
}

function formatBytes(bytes) {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

export function printDiagnostics() {
  const report = buildDiagnosticsReport()
  log('startup diagnostics:\n' + formatReport(report))
  return report
}

function isEntryPoint() {
  return process.argv[1] && process.argv[1].endsWith('system-diagnostics.mjs')
}

if (isEntryPoint()) {
  printDiagnostics()
}
