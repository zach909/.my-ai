#!/usr/bin/env node
/**
 * Print, or write into docs/PLATFORMS.md, the feature-parity matrix generated from the feature contract
 * (interface/platform/feature-contract.ts) and the adapter table. The document is never edited by hand
 * in that region; test/platform/adapters.test.mjs fails when it is stale.
 *
 *   node scripts/release/parity-matrix.mjs            print
 *   node scripts/release/parity-matrix.mjs --write    replace the region between the markers in docs/PLATFORMS.md
 * Needs `node scripts/build-backend.mjs` first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (f) => import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', f)).href);
const A = await load('adapters.js');
const C = await load('feature-contract.js');
const mark = (s) => ({ supported: 'yes', limited: 'partly', unavailable: 'no' }[s]);

export function renderMatrix() {
  const lines = [`| Feature | ${A.PLATFORM_IDS.map((p) => A.adapterFor(p).label).join(' | ')} |`, `| --- | ${A.PLATFORM_IDS.map(() => '---').join(' | ')} |`];
  for (const { feature, support } of C.parityMatrix()) lines.push(`| ${feature.title} | ${A.PLATFORM_IDS.map((p) => mark(support[p].status)).join(' | ')} |`);
  return lines.join('\n');
}

export function renderCapabilities() {
  const lines = [`| Capability | ${A.PLATFORM_IDS.map((p) => A.adapterFor(p).label).join(' | ')} |`, `| --- | ${A.PLATFORM_IDS.map(() => '---').join(' | ')} |`];
  for (const c of A.CAPABILITY_IDS) lines.push(`| ${c} | ${A.PLATFORM_IDS.map((p) => mark(A.adapterFor(p).capabilities[c].status)).join(' | ')} |`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = `${renderMatrix()}`;
  if (!process.argv.includes('--write')) { console.log(out); console.log(); console.log(renderCapabilities()); }
  else {
    const file = path.join(ROOT, 'docs', 'PLATFORMS.md');
    let doc = readFileSync(file, 'utf8');
    const swap = (name, body) => {
      const re = new RegExp(`(<!-- ${name}:begin -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
      if (!re.test(doc)) throw new Error(`docs/PLATFORMS.md has no ${name} markers`);
      doc = doc.replace(re, `$1\n${body}\n$2`);
    };
    swap('parity-matrix', renderMatrix());
    swap('capability-matrix', renderCapabilities());
    writeFileSync(file, doc);
    console.log('docs/PLATFORMS.md updated');
  }
}
