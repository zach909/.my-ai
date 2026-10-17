/**
 * Platform adapters report accurate capabilities, and the feature contract matches the tree.
 * The claims that can be checked against the repository are checked against it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dist, ensureBuilt } from './helpers.mjs';

ensureBuilt();
const A = await import(dist('interface/platform/adapters.js'));
const C = await import(dist('interface/platform/feature-contract.js'));
const text = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = (rel, ext) => walk(path.join(ROOT, rel)).filter((f) => f.endsWith(ext)).map((f) => readFileSync(f, 'utf8')).join('\n');

test('all six platforms exist and every one answers every capability with a status and, when not fully supported, a reason', () => {
  assert.deepEqual([...A.PLATFORM_IDS].sort(), ['android', 'chromeos', 'ios', 'linux', 'macos', 'windows']);
  for (const id of A.PLATFORM_IDS) {
    const a = A.adapterFor(id);
    assert.equal(a.id, id);
    for (const c of A.CAPABILITY_IDS) {
      const r = a.capabilities[c];
      assert.ok(r, `${id}.${c} missing`);
      assert.ok(['supported', 'limited', 'unavailable'].includes(r.status), `${id}.${c}`);
      if (r.status !== 'supported') assert.ok(r.note.length > 15, `${id}.${c} is ${r.status} but gives no reason`);
    }
    assert.ok(a.artifacts.length > 0 && a.uiHost && a.engineHost, id);
  }
});

test('platform detection from the OS and from user agents', () => {
  assert.equal(A.detectPlatform({ nodePlatform: 'win32' }), 'windows');
  assert.equal(A.detectPlatform({ nodePlatform: 'darwin' }), 'macos');
  assert.equal(A.detectPlatform({ nodePlatform: 'linux' }), 'linux');
  const ua = {
    chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  };
  for (const [want, agent] of Object.entries(ua)) assert.equal(A.detectPlatform({ userAgent: agent }), want, want);
  assert.equal(A.detectPlatform({ userAgent: ua.android, nodePlatform: 'linux' }), 'android', 'Android is not mistaken for Linux');
  assert.equal(A.detectPlatform({ userAgent: ua.chromeos }), 'chromeos', 'ChromeOS is not mistaken for Linux');
});

test('a Chrome extension is not claimed to contain an engine, and the extension really cannot start one', () => {
  const chromeos = A.adapterFor('chromeos');
  assert.equal(chromeos.capabilities.localEngine.status, 'unavailable');
  assert.equal(chromeos.capabilities.backgroundService.status, 'unavailable');
  assert.equal(chromeos.capabilities.remoteEngine.status, 'supported');
  const m = JSON.parse(text('browser-extension/manifest.json'));
  assert.ok(!(m.permissions ?? []).includes('nativeMessaging'), 'no native messaging: nothing outside the browser can be started');
  assert.ok(!(m.permissions ?? []).includes('debugger'));
});

test('iOS claims match what iOS allows and what the app contains', () => {
  const ios = A.adapterFor('ios');
  for (const c of ['backgroundService', 'desktopControl', 'systemTray']) assert.equal(ios.capabilities[c].status, 'unavailable', c);
  assert.ok(existsSync(path.join(ROOT, 'mobile/ios/project.yml')));
  const swift = sources('mobile/ios/NeuroClaw', '.swift');
  assert.match(swift, /SFSpeechRecognizer/, 'iOS voiceInput is supported only because the app really uses SFSpeechRecognizer');
  assert.match(text('mobile/ios/project.yml'), /NSCameraUsageDescription/);
});

test('Android claims match the app: voice, overlay, accessibility bridge, camera, and its own brain', () => {
  const android = A.adapterFor('android');
  assert.equal(android.capabilities.voiceInput.status, 'supported');
  const kt = sources('mobile/android/app/src/main', '.kt');
  assert.match(kt, /SpeechRecognizer/);
  assert.ok(existsSync(path.join(ROOT, 'mobile/android/app/src/main/java/ai/neuroclaw/app/OverlayService.kt')));
  assert.ok(existsSync(path.join(ROOT, 'mobile/android/app/src/main/java/ai/neuroclaw/app/AgentBridgeService.kt')));
  assert.ok(existsSync(path.join(ROOT, 'mobile/brain/bundle/neuroclaw-brain.js')), 'the on-phone brain it claims');
  assert.match(text('mobile/android/app/src/main/AndroidManifest.xml'), /android\.permission\.CAMERA/);
});

test('desktop platforms: no tray and no macOS desktop control are claimed, because the packaged apps contain neither', () => {
  for (const id of ['windows', 'linux', 'macos']) assert.equal(A.adapterFor(id).capabilities.systemTray.status, 'unavailable', id);
  assert.equal(A.adapterFor('macos').capabilities.desktopControl.status, 'unavailable');
  const keys = [...text('scripts/release/macos/entitlements.plist').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'], 'only what the Node runtime needs; no camera, microphone, automation or accessibility entitlement');
});

test('every artifact kind an adapter promises is produced by a script or workflow job in this repository', () => {
  const where = {
    'linux-deb': 'scripts/release/package-linux.mjs', 'linux-tarball': 'scripts/release/package-linux.mjs',
    'windows-installer-exe': 'scripts/release/package-windows.mjs', 'windows-zip': 'scripts/release/package-windows.mjs',
    'macos-app-zip': 'scripts/release/package-macos.mjs', 'macos-dmg': 'scripts/release/package-macos.mjs',
    'chrome-extension-zip': 'scripts/release/build-extension.mjs',
    'android-apk': '.github/workflows/ci.yml', 'ios-simulator-app': '.github/workflows/ci.yml',
  };
  for (const id of A.PLATFORM_IDS) for (const kind of A.adapterFor(id).artifacts) {
    assert.ok(where[kind], `unknown artifact kind ${kind}`);
    const body = text(where[kind]);
    const needle = kind === 'android-apk' ? 'assembleDebug' : kind === 'ios-simulator-app' ? 'iphonesimulator' : kind === 'chrome-extension-zip' ? 'neuroclaw-chrome-extension-' : kind;
    assert.ok(body.includes(needle), `${where[kind]} does not mention ${needle}`);
  }
});

test('update mechanisms match the platform: store updates only where a store exists, manual download elsewhere', () => {
  assert.equal(A.adapterFor('chromeos').updateMechanism, 'chrome-web-store');
  assert.equal(A.adapterFor('ios').updateMechanism, 'app-store');
  assert.equal(A.adapterFor('android').updateMechanism, 'play-store');
  for (const id of ['windows', 'linux', 'macos']) assert.equal(A.adapterFor(id).updateMechanism, 'manual-download', `${id} never claims to update itself`);
  for (const id of ['windows', 'linux', 'macos']) assert.notEqual(A.adapterFor(id).capabilities.selfUpdate.status, 'supported', `${id} does not replace itself silently`);
});

test('the feature contract matches the tree: files, routes and tests all exist', () => {
  assert.deepEqual(C.verifyContract(ROOT), []);
});

test('support is derived from capabilities, so the parity matrix cannot overclaim', () => {
  const by = (id) => C.FEATURES.find((f) => f.id === id);
  const s = (id, p) => C.featureSupport(by(id), p);
  // Chat needs an engine somewhere: local on desktops, a server for the browser and phones.
  assert.deepEqual(s('chat', 'windows').via, ['localEngine']);
  assert.equal(s('chat', 'chromeos').status, 'supported');
  assert.deepEqual(s('chat', 'chromeos').via, ['remoteEngine']);
  // Things that need the engine on this device are unavailable in a browser and on iOS.
  assert.equal(s('computer-access', 'chromeos').status, 'unavailable');
  assert.equal(s('self-improvement', 'ios').status, 'unavailable');
  assert.equal(s('desktop-control', 'macos').status, 'unavailable');
  assert.equal(s('desktop-control', 'linux').status, 'limited');
  // Features that belong to one kind of platform are "not applicable" elsewhere, never quietly "supported".
  assert.equal(s('desktop-app', 'android').status, 'unavailable');
  assert.match(s('desktop-app', 'android').reason, /Not applicable/);
  assert.equal(s('chrome-extension', 'windows').status, 'unavailable');
  assert.equal(s('phone-sync', 'linux').status, 'unavailable');
  assert.equal(s('phone-sync', 'ios').status, 'supported');
  // Every feature is covered by at least one test and implemented by at least one file.
  for (const f of C.FEATURES) { assert.ok(f.tests.length > 0, f.id); assert.ok(f.implementation.length > 0, f.id); }
  const m = C.parityMatrix();
  assert.equal(m.length, C.FEATURES.length);
  for (const row of m) assert.deepEqual(Object.keys(row.support).sort(), [...A.PLATFORM_IDS].sort());
});

test('docs/PLATFORMS.md carries the generated parity matrix, current', () => {
  const doc = text('docs/PLATFORMS.md');
  const mark = (s) => ({ supported: 'yes', limited: 'partly', unavailable: 'no' }[s]);
  const header = `| Feature | ${A.PLATFORM_IDS.map((p) => A.adapterFor(p).label).join(' | ')} |`;
  assert.ok(doc.includes(header), 'matrix header is present');
  for (const { feature, support } of C.parityMatrix()) {
    const row = `| ${feature.title} | ${A.PLATFORM_IDS.map((p) => mark(support[p].status)).join(' | ')} |`;
    assert.ok(doc.includes(row), `PLATFORMS.md is out of date for "${feature.title}" (run: node scripts/release/parity-matrix.mjs --write)`);
  }
});
