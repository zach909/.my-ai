#!/usr/bin/env node
/**
 * Regression test for scripts/doctor.mjs's Debian-version check.
 *
 * "make the system requirements for Debian newer versions" -- this app is
 * built and tested against Debian 12 (bookworm) or newer (see the README's
 * System Requirements and doctor.mjs's own doc comment for why: Electron
 * needs a glibc/libgtk-3/libnss3 newer than Debian 10/11 reliably ship).
 * doctor.mjs reads DOCTOR_DEBIAN_VERSION_FILE instead of the real
 * /etc/debian_version when set, exactly so this can be exercised against
 * a real, spawned run of the actual script -- not a reimplementation of
 * its parsing logic -- without touching the real system file.
 *
 * Run with: node test/doctor.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(HERE, '..', 'scripts', 'doctor.mjs');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'doctor-test-'));

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; console.log(`  FAIL ${msg}`); }
}

function runWithDebianVersion(content) {
  const file = path.join(tmpDir, 'debian_version');
  writeFileSync(file, content);
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...process.env, DOCTOR_DEBIAN_VERSION_FILE: file },
  });
}

try {
  const old10 = runWithDebianVersion('10.13\n');
  check(old10.stdout.includes('Debian 10.13 detected'),
    'Debian 10 is reported by name, not silently accepted');
  check(old10.stdout.includes('Debian 12 (bookworm) or newer'),
    'the warning names the actual supported baseline');
  check(old10.status === 0,
    'an old Debian version is a warning, not a launch-blocking failure -- doctor.mjs never claims certainty it does not have');

  const old11 = runWithDebianVersion('11.9\n');
  check(old11.stdout.includes('Debian 11.9 detected'), 'Debian 11 is also flagged (the supported baseline is 12, not 11)');

  const current12 = runWithDebianVersion('12.8\n');
  check(current12.stdout.includes('Debian version is 12.8') && !current12.stdout.includes('12.8 detected'),
    'Debian 12 (the actual supported baseline) reports as fine, not a warning');

  const newer13 = runWithDebianVersion('13.0\n');
  check(newer13.stdout.includes('Debian version is 13.0'), 'Debian 13 (newer than the baseline) reports as fine');

  // testing/unstable reads like "bookworm/sid" or "trixie/sid" -- not a
  // parseable leading number, and always newer than any numbered stable
  // release by definition, so this must never be misread as an old version.
  const testing = runWithDebianVersion('trixie/sid\n');
  check(testing.stdout.includes('Debian version is trixie/sid') && !testing.stdout.includes('detected --'),
    'testing/unstable ("trixie/sid") is treated as fine, not misparsed as an old numbered release');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
