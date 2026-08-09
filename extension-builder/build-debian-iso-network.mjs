#!/usr/bin/env node
/**
 * build-debian-iso-network.mjs — Code-to-Net over the actual Debian
 * installer BINARY (the bootable .iso), not its source code -- the
 * follow-up to build-debian-network.mjs, which used debian-installer's
 * source tree. "I want you to use the binary version... make it run
 * from the dictionaries using the coding of the neural network" (Code-
 * to-Net, not "coaching"/scripting): a representative sample of the raw
 * ISO's bytes goes through the engine's real bytecode->neuron-topology
 * converter, then immediately back through the real reverse
 * (exportCodeNet()) with every sample checked byte-for-byte against the
 * original, same as every prior Code-to-Net import this session.
 *
 * Debian's own installer ISO images are DFSG-free, official, and freely
 * redistributable (unlike Windows/macOS/Android, which this session
 * already declined to touch) -- see the discussion earlier this
 * conversation about why proprietary OS installers were refused. This
 * script does NOT commit the ~755MB ISO itself into the repository
 * (a single opaque binary blob that size would bloat git history
 * forever, unlike the source trees already vendored under
 * extension-builder/) -- it downloads/reads the ISO from a local path,
 * samples it, and the resulting network (small, definition-carrying
 * neurons) is what actually gets committed. Anyone can reproduce the
 * exact same network from the exact same public URL and byte offsets
 * documented below.
 *
 * Source: https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.6.0-amd64-netinst.iso
 * Verified this run: 791674880 bytes, matches the server's
 * Content-Length exactly; `file` identifies it as a genuine bootable
 * ISO 9660 filesystem, "Debian 13.6.0 amd64".
 *
 * Usage: node extension-builder/build-debian-iso-network.mjs <path-to-iso>
 * (requires a fresh `node scripts/build-backend.mjs` first)
 */

import { statSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[build-debian-iso-network]', ...args); }

// Same reasoning as every prior Code-to-Net import this session:
// CodeToNet.importCode() makes one internal neuron per 8 bytes, so an
// uncapped 791MB file would produce ~99 million internal neurons --
// nowhere near tractable, and pointless besides: the point is proving
// the real Code-to-Net/exportCodeNet() round trip against genuine ISO
// bytes, not literally re-encoding the whole install image. Six fixed
// byte offsets spread across the image (not just the front) so the
// sample isn't only the boot sector -- some land in the bootloader
// region, some further into the filesystem/package-pool area.
const BYTES_PER_SAMPLE = 4096;
const SAMPLE_OFFSETS_FRACTION = [0, 0.05, 0.25, 0.5, 0.75, 0.95];

async function main() {
  const isoPath = process.argv[2];
  if (!isoPath) {
    console.error('Usage: node extension-builder/build-debian-iso-network.mjs <path-to-iso>');
    process.exit(1);
  }
  const stat = statSync(isoPath);
  log(`ISO: ${isoPath} (${stat.size.toLocaleString()} bytes)`);

  const { ExtensionBuilder } = await import(path.join(ROOT, 'dist', 'extension-builder', 'builder.js'));
  const builder = new ExtensionBuilder();
  const project = builder.createProject(
    'Debian ISO Binary Network',
    'Real Code-to-Net over the actual Debian installer binary (.iso), forward and reverse',
  );

  const fd = openSync(isoPath, 'r');
  let imported = 0;
  let reversedOk = 0;
  const results = [];
  try {
    for (const frac of SAMPLE_OFFSETS_FRACTION) {
      const offset = Math.min(stat.size - BYTES_PER_SAMPLE, Math.floor(stat.size * frac));
      const buf = Buffer.alloc(BYTES_PER_SAMPLE);
      const bytesRead = readSync(fd, buf, 0, BYTES_PER_SAMPLE, offset);
      const original = buf.subarray(0, bytesRead);

      const neuron = builder.importCodeToNet(project.id, `debian_iso_offset_${offset}`, original);
      if (!neuron) continue;
      imported++;

      const reconstructed = Buffer.from(builder.exportCodeNet(project.id, neuron.id));
      const matches = Buffer.compare(reconstructed, original) === 0;
      if (matches) reversedOk++;

      log(`${matches ? 'OK  ' : 'FAIL'} offset ${offset.toLocaleString()} (${(frac * 100).toFixed(0)}% through the image) -> ${neuron.name} (${neuron.definition}) -- reversed ${reconstructed.length}/${original.length} bytes, exact match: ${matches}`);
      results.push({ offset, fraction: frac, neuron: neuron.name, bytes: original.length, reversedExactMatch: matches });
    }
  } finally {
    closeSync(fd);
  }

  const outDir = path.join(ROOT, 'extension-builder', 'extensions');
  mkdirSync(outDir, { recursive: true });
  const json = builder.saveWithoutQuantization(project.id);
  const outPath = path.join(outDir, `debian_iso_network_${Date.now()}.ext.json`);
  writeFileSync(outPath, json, 'utf8');

  log(`Saved: ${path.relative(ROOT, outPath)}`);
  log(`${imported} sample(s) imported, ${reversedOk}/${imported} reversed to a byte-exact match`);
  return { outPath, isoSize: stat.size, imported, reversedOk, results };
}

main().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
  if (summary.reversedOk !== summary.imported) {
    console.error('[build-debian-iso-network] not every sample reversed exactly -- see FAIL lines above');
    process.exit(1);
  }
}).catch((err) => {
  console.error('[build-debian-iso-network] FAILED:', err);
  process.exit(1);
});
