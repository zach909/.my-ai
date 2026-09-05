#!/usr/bin/env node
/**
 * Preflight check for `npm start` (dev-mode Electron launch).
 *
 * "desktop app does not open" / "npm start prints nothing at all, not even
 * an error" -- the single hardest class of bug to fix over chat, because
 * there is nothing to read. `electron .` on Linux can fail completely
 * silently in a few well-known ways (no display server reachable, a missing
 * shared library the dynamic linker refuses before Electron's own code ever
 * runs, the sandbox setuid helper being unusable) depending on the
 * distro/session, and none of them are this app's own code -- they need to
 * be checked and reported BEFORE Electron gets a chance to fail quietly.
 *
 * Never blocks a launch on its own suspicion -- prints what it found and
 * exits 0 unless the electron binary is outright missing (in which case
 * there is nothing `electron .` could possibly do anyway, so failing fast
 * with a clear reason beats a guaranteed, silent crash).
 */
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let warnings = 0;
function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m!\x1b[0m ${msg}`); warnings++; }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }

console.log('[desktop-app] checking the environment before launching Electron...');

// 1. The electron binary itself -- present, and actually a file (not a
// broken symlink left over from a half-finished `npm install`).
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
let electronBinOk = false;
try {
  const stat = statSync(electronBin);
  electronBinOk = stat.isFile() && stat.size > 0;
} catch { /* does not exist */ }
if (!electronBinOk) {
  fail(`Electron binary not found at ${electronBin}.`);
  console.log('');
  console.log('  This means `npm install` never finished downloading it (electron\'s');
  console.log('  postinstall script fetches a separate ~100MB binary after the package');
  console.log('  itself installs -- a network hiccup partway through leaves the package');
  console.log('  present but this file missing, and neither npm nor `electron .` says so).');
  console.log('');
  console.log('  Fix: re-run the download explicitly and watch it complete --');
  console.log('    cd desktop-app && node node_modules/electron/install.js');
  console.log('  then try `npm start` again.');
  process.exitCode = 1;
  process.exit(1);
}
ok(`Electron binary present (${electronBin})`);

// 2. A display server to actually put a window on. On Linux this is the
// single most common reason a GUI app produces zero output and zero
// window: Electron/Chromium's own crash path for "no display" varies by
// version and is not guaranteed to print anything a user would notice
// before the process exits.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  warn('Neither $DISPLAY nor $WAYLAND_DISPLAY is set -- there is no X11 or Wayland session for a window to appear on.');
  console.log('    If this is a plain SSH session, either add -X (X11 forwarding) when connecting,');
  console.log('    or run this from the machine\'s own desktop session, not a remote shell.');
} else if (process.platform === 'linux') {
  ok(`Display available (${process.env.WAYLAND_DISPLAY ? `WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY}` : `DISPLAY=${process.env.DISPLAY}`})`);
}

// 3. Running as root. Electron's sandbox setuid helper refuses to run as
// root by design (a real, correct security behavior, not a bug) and
// Chromium's own message for it is a single FATAL log line that is easy to
// miss if a terminal was closed immediately after, or scroll past if
// something else was printed after it.
if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  warn('Running as root. Electron refuses to run its sandbox this way and will exit immediately with:');
  console.log('    "Running as root without --no-sandbox is not supported"');
  console.log('    Run as an ordinary user instead, or (only if you understand the tradeoff)');
  console.log('    launch with: electron . --no-sandbox');
}

// 4. Missing shared libraries. A distro missing one of Chromium's runtime
// dependencies (common on minimal/server installs, or right after an
// interrupted apt upgrade) makes the dynamic linker kill the process
// before any of Electron's own code -- including its own error
// reporting -- ever runs. `ldd` on the binary itself surfaces exactly
// which one, which `electron .`'s own silence never would.
if (process.platform === 'linux') {
  try {
    const lddOut = execFileSync('ldd', [electronBin], { encoding: 'utf8', timeout: 5000 });
    const missing = lddOut.split('\n').filter(l => l.includes('not found'));
    if (missing.length > 0) {
      fail('Missing shared libraries Electron needs to even start:');
      for (const line of missing) console.log(`    ${line.trim()}`);
      console.log('    Install them with your distro\'s package manager (the library name before');
      console.log('    ".so" usually maps to a package, e.g. libnss3.so -> libnss3 on Debian/Ubuntu).');
    } else {
      ok('All shared libraries Electron links against are present (ldd reports none missing)');
    }
  } catch (err) {
    // `ldd` itself missing, or the call failed for some other reason -- not
    // fatal to report, just cannot confirm this one either way.
    warn(`Could not run ldd to check for missing shared libraries (${err.message.split('\n')[0]})`);
  }
}

console.log('');
if (warnings > 0) {
  console.log(`[desktop-app] ${warnings} thing(s) above may be why nothing appears -- launching Electron anyway.`);
} else {
  console.log('[desktop-app] environment looks fine -- launching Electron.');
}
console.log('');
