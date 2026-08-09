#!/usr/bin/env node
/**
 * build-debian-network.mjs — one-time build driver for the Debian
 * Installer Code-to-Net network, forward AND reverse.
 *
 * Like build-main-network.mjs's moby import, a representative sample of
 * debian-installer source (vendored under extension-builder/DebianInstaller/,
 * github mirror of salsa.debian.org/installer-team/debian-installer) is
 * run through ExtensionBuilder.importCodeToNet() -- the engine's real
 * bytecode->neuron-topology converter (CodeToNet.importCode() in
 * models && skills/core/thorns.js).
 *
 * What's new here is the reverse direction: ExtensionBuilder.exportCodeNet()
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

const DI_DIR = path.join(ROOT, 'extension-builder', 'DebianInstaller');
const DI_FILES = [
  'build/Makefile',
  'build/README',
  'build/daily-build',
  'build/d-i-unpack-helper',
  'build/util/tftpboot.sh',
  'build/TODO',
  'build/translation-status',
  'debian/control',
  'debian/rules',
  'debian/changelog',
];
// Same reasoning as build-main-network.mjs's moby cap: CodeToNet.importCode()
// makes one internal neuron per 8 bytes, so this bounds how big each
// file's byte-chain topology gets (debian/changelog alone is 243KB
// uncapped -- ~30,000 internal neurons -- still cheap Map entries, but
// capping keeps the whole run fast and the point (forward + reverse
// works) doesn't need the entire file to prove it).
const BYTES_PER_FILE = 4096;

async function main() {
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Debian Installer Network',
    'debian-installer source via real Code-to-Net, forward and reverse',
  );

  let imported = 0;
  let reversedOk = 0;
  const results = [];

  for (const rel of DI_FILES) {
    const full = path.join(DI_DIR, rel);
    if (!existsSync(full)) {
      log(`skip (not found): ${rel}`);
      continue;
    }
    const original = readFileSync(full).subarray(0, BYTES_PER_FILE);

    // Forward: code -> network.
    const neuron = builder.importCodeToNet(project.id, `di_${rel.replace(/[\\/]/g, '_')}`, original);
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
