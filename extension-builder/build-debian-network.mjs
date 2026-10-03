#!/usr/bin/env node
/**
 * build-debian-network.mjs — one-time build driver for the Config Files
 * Code-to-Net network, forward AND reverse.
 *
 * Like build-main-network.mjs's project-source import, a representative
 * sample of THIS repository's own files is run through
 * ExtensionBuilder.importCodeToNet() -- the engine's real
 * bytecode->neuron-topology converter (CodeToNet.importCode() in
 * models && skills/core/thorns.js). (This script used to import a sample
 * of a vendored debian-installer source tree; that vendored copy has been
 * removed, so this now points at our own files instead -- the
 * forward/reverse proof below never depended on Debian specifically, only
 * on having some real bytes to round-trip.)
 *
 * What matters here is the reverse direction: ExtensionBuilder.exportCodeNet()
 * walks each neuron's own stored network topology (its byte-chain of
 * code_neuron_N nodes, connected inputLayer -> ... -> outputLayer) back
 * into the exact original bytes. This is a genuine graph traversal over
 * the network's own edges, not a shortcut -- see CodeToNet.exportCode()'s
 * doc comment in thorns.js -- and it's lossless: importCode() keeps every
 * source segment verbatim on its neuron rather than a lossy encoding, so
 * walking the chain back reproduces the input byte-for-byte. Every file
 * imported below is immediately reversed and checked against the exact
 * bytes that went in.
 *
 * Usage: node extension-builder/build-debian-network.mjs
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));

function log(...args) {
  console.log('[build-debian-network]', ...args);
}

// A different slice of this repository's own files than
// build-main-network.mjs uses, so the two Code-to-Net demos exercise
// different bytes: config/build files rather than source/prose.
const PROJECT_FILES = [
  'STRUCTURE.md',
  'PRIVACY.md',
  'TERMS.md',
  'vite.config.ts',
  'tsconfig.json',
  'eslint.config.js',
  '.stylelintrc.json',
  'components.json',
  'scripts/install.sh',
  '.gitignore',
];
// Same reasoning as build-main-network.mjs's cap: CodeToNet.importCode()
// makes one internal neuron per 8 bytes, so this bounds how big each
// file's byte-chain topology gets -- cheap Map entries either way, but
// capping keeps the whole run fast; the point (forward + reverse works)
// doesn't need the entire file to prove it.
const BYTES_PER_FILE = 4096;

async function main() {
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Config Files Network',
    "this project's own config/build files via real Code-to-Net, forward and reverse",
  );

  let imported = 0;
  let reversedOk = 0;
  const results = [];

  for (const rel of PROJECT_FILES) {
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) {
      log(`skip (not found): ${rel}`);
      continue;
    }
    const original = readFileSync(full).subarray(0, BYTES_PER_FILE);

    // Forward: code -> network.
    const neuron = builder.importCodeToNet(project.id, `cfg_${rel.replace(/[\\/ &]/g, '_')}`, original);
    if (!neuron) continue;
    imported++;

    // Reverse: network -> code. This is the actual point of this script --
    // proving the network can be walked back to what went in, not just
    // built forward.
    const reconstructed = Buffer.from(builder.exportCodeNet(project.id, neuron.id));
    const matches = Buffer.compare(reconstructed, Buffer.from(original)) === 0;
    if (matches) reversedOk++;

    log(`${matches ? 'OK  ' : 'FAIL'} ${rel} -> ${neuron.name} (${neuron.definition}) -- reversed ${reconstructed.length}/${original.length} bytes, exact match: ${matches}`);
    results.push({ file: rel, neuron: neuron.name, bytes: original.length, reversedExactMatch: matches });
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const json = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `debian_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, json, 'utf8');

  log(`Saved: ${path.relative(ROOT, outPath)}`);
  log(`${imported} file(s) imported, ${reversedOk}/${imported} reversed to a byte-exact match`);
  return { outPath, imported, reversedOk, results };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
  if (summary.reversedOk !== summary.imported) {
    console.error('[build-debian-network] not every file reversed exactly -- see FAIL lines above');
    process.exit(1);
  }
}).catch((err) => {
  console.error('[build-debian-network] FAILED:', err);
  process.exit(1);
});
