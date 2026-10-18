#!/usr/bin/env node
/**
 * macOS packages from a staged payload (scripts/release/stage-app.mjs):
 *
 *   neuroclaw-<version>-macos-<arch>.zip   NeuroClaw.app, zipped
 *   neuroclaw-<version>-macos-<arch>.dmg   disk image with NeuroClaw.app and an Applications shortcut
 *
 *   node scripts/release/package-macos.mjs <stageDir> <outDir> [--stage-only]
 *
 * NeuroClaw.app is a standard bundle: Contents/Info.plist, Contents/MacOS/NeuroClaw (a small native
 * window host in Swift, using only SwiftUI and WebKit), Contents/Resources/{AppIcon.icns, app/, runtime/}.
 * Double-click it in Finder or keep it in the Dock. It needs no privileges, installs no service, and
 * asks for no permissions (see scripts/release/macos/entitlements.plist).
 *
 * Building needs macOS (swiftc, hdiutil, codesign). On other systems --stage-only lays out the bundle
 * without the executable, which is what the tests check. Signing: with no credentials the app is
 * ad-hoc signed (it runs; Gatekeeper asks you to confirm "open anyway" the first time). A Developer ID
 * signature and notarisation need the maintainer's Apple credentials and are done by the release
 * workflow only when those secrets exist; this script never contains or reads them.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_NAME, artifactName, copyTree, normalizeModes, writeFile } from './packaging.mjs';
import { makeIcns } from './icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLE_ID = 'ai.neuroclaw.desktop';

export function infoPlist({ version, build }) {
  const kv = (k, v) => `  <key>${k}</key>\n  ${v}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${[
    kv('CFBundleName', `<string>${APP_NAME}</string>`),
    kv('CFBundleDisplayName', `<string>${APP_NAME}</string>`),
    kv('CFBundleIdentifier', `<string>${BUNDLE_ID}</string>`),
    kv('CFBundleExecutable', `<string>${APP_NAME}</string>`),
    kv('CFBundleIconFile', '<string>AppIcon</string>'),
    kv('CFBundlePackageType', '<string>APPL</string>'),
    kv('CFBundleShortVersionString', `<string>${version}</string>`),
    kv('CFBundleVersion', `<string>${build}</string>`),
    kv('LSMinimumSystemVersion', '<string>12.0</string>'),
    kv('LSApplicationCategoryType', '<string>public.app-category.productivity</string>'),
    kv('NSHighResolutionCapable', '<true/>'),
    kv('NSSupportsAutomaticGraphicsSwitching', '<true/>'),
    // The engine and the window talk over this computer's loopback address only.
    kv('NSAppTransportSecurity', '<dict><key>NSAllowsLocalNetworking</key><true/></dict>'),
  ].join('\n')}
</dict>
</plist>
`;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || r.error?.message || '').slice(-500)}`);
  return r;
}

export async function packageMacos({ stageDir, outDir, stageOnly = false }) {
  const info = JSON.parse(readFileSync(path.join(stageDir, 'app', 'build-info.json'), 'utf8'));
  const { renderIconPng } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'icon.js')).href);
  const { versionCode } = await import(pathToFileURL(path.join(HERE, 'version.mjs')).href);
  mkdirSync(outDir, { recursive: true });
  const work = path.join(outDir, '.work-macos');
  rmSync(work, { recursive: true, force: true });
  const bundle = path.join(work, `${APP_NAME}.app`);
  const res = path.join(bundle, 'Contents', 'Resources');
  mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  copyTree(path.join(stageDir, 'app'), path.join(res, 'app'));
  copyTree(path.join(stageDir, 'runtime'), path.join(res, 'runtime'));
  normalizeModes(res);
  chmodSync(path.join(res, 'runtime', 'node'), 0o755);
  writeFile(path.join(bundle, 'Contents', 'Info.plist'), infoPlist({ version: info.version.replace(/-.*/, ''), build: String(versionCode(info.version)) }));
  writeFileSync(path.join(res, 'AppIcon.icns'), makeIcns([16, 32, 64, 128, 256, 512].map((size) => ({ size, png: renderIconPng(size) }))));
  writeFile(path.join(bundle, 'Contents', 'PkgInfo'), 'APPL????');

  if (stageOnly) return { artifacts: [], skipped: [{ kind: 'macos-app', reason: '--stage-only' }], bundle };
  if (process.platform !== 'darwin') {
    rmSync(work, { recursive: true, force: true });
    return { artifacts: [], skipped: [{ kind: 'macos-app-zip', reason: 'needs macOS (swiftc, codesign)' }, { kind: 'macos-dmg', reason: 'needs macOS (hdiutil)' }], bundle: null };
  }

  // The window host: Swift, Cocoa and WebKit only.
  const exe = path.join(bundle, 'Contents', 'MacOS', APP_NAME);
  run('swiftc', ['-O', '-parse-as-library', '-o', exe, path.join(HERE, 'macos', 'NeuroClawHost.swift'), '-framework', 'SwiftUI', '-framework', 'WebKit']);
  chmodSync(exe, 0o755);

  // Signing. A real identity comes from the environment (set by the workflow from repository secrets); otherwise ad hoc.
  const identity = process.env.MACOS_SIGN_IDENTITY || '-';
  const entitlements = path.join(HERE, 'macos', 'entitlements.plist');
  const sign = ['--force', '--options', 'runtime', '--entitlements', entitlements, '--sign', identity];
  if (identity !== '-') sign.push('--timestamp');
  run('codesign', [...sign, path.join(res, 'runtime', 'node')]);
  run('codesign', [...sign, bundle]);
  run('codesign', ['--verify', '--deep', '--strict', bundle]);
  const signing = identity === '-' ? 'ad-hoc' : 'developer-id';

  const artifacts = [];
  const zip = path.join(outDir, artifactName({ version: info.version, platform: 'macos', arch: info.arch, ext: 'zip' }));
  rmSync(zip, { force: true });
  run('ditto', ['-c', '-k', '--keepParent', bundle, zip]);
  artifacts.push({ file: zip, kind: 'macos-app-zip', platform: 'macos', arch: info.arch, signing });

  const dmgRoot = path.join(work, 'dmg');
  mkdirSync(dmgRoot, { recursive: true });
  run('ditto', [bundle, path.join(dmgRoot, `${APP_NAME}.app`)]);
  symlinkSync('/Applications', path.join(dmgRoot, 'Applications'));
  const dmg = path.join(outDir, artifactName({ version: info.version, platform: 'macos', arch: info.arch, ext: 'dmg' }));
  rmSync(dmg, { force: true });
  run('hdiutil', ['create', '-volname', APP_NAME, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmg]);
  artifacts.push({ file: dmg, kind: 'macos-dmg', platform: 'macos', arch: info.arch, signing });
  rmSync(work, { recursive: true, force: true });
  return { artifacts, skipped: [], bundle };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const [stage, out] = a;
  if (!stage || !out) { console.error('usage: package-macos.mjs <stageDir> <outDir> [--stage-only]'); process.exit(2); }
  packageMacos({ stageDir: path.resolve(stage), outDir: path.resolve(out), stageOnly: process.argv.includes('--stage-only') })
    .then((r) => { r.artifacts.forEach((x) => console.log(`${x.file}\t${x.signing}`)); r.skipped.forEach((s) => console.log(`SKIPPED ${s.kind}: ${s.reason}`)); })
    .catch((e) => { console.error(`macos packaging failed: ${e.message}`); process.exit(1); });
}
