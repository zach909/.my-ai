#!/usr/bin/env node
/**
 * Linux packages from a staged payload (scripts/release/stage-app.mjs):
 *
 *   neuroclaw-<version>-linux-<arch>.deb       installs to /opt/neuroclaw, adds /usr/bin/neuroclaw,
 *                                               an application-menu entry and icons. Needs dpkg-deb
 *                                               (present on Debian, Ubuntu and the GitHub runners).
 *   neuroclaw-<version>-linux-<arch>.tar.gz     the same files, unpack anywhere; no root needed.
 *
 *   node scripts/release/package-linux.mjs <stageDir> <outDir>
 *
 * Nothing runs as root after install: no service, no daemon, no changes outside the
 * package's own files (the postinst only refreshes the menu and icon caches, if the
 * tools exist). The app starts from the menu entry with no terminal.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_ID, APP_NAME, APP_SUMMARY, DEB_ARCH, artifactName, copyTree, desktopEntry, normalizeModes, writeFile } from './packaging.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICON_SIZES = [48, 128, 256, 512];

function dirSizeKb(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) { const p = path.join(dir, name); n += statSync(p).isDirectory() ? dirSizeKb(p) : Math.ceil(statSync(p).size / 1024); }
  return n;
}

async function icons() {
  const { renderIconPng } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'icon.js')).href);
  return ICON_SIZES.map((s) => ({ size: s, png: renderIconPng(s) }));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || r.error?.message || '').slice(-400)}`);
  return r;
}

export async function packageLinux({ stageDir, outDir }) {
  const info = JSON.parse(readFileSync(path.join(stageDir, 'app', 'build-info.json'), 'utf8'));
  const arch = info.arch;
  if (!DEB_ARCH[arch]) throw new Error(`unsupported architecture ${arch}`);
  mkdirSync(outDir, { recursive: true });
  const work = path.join(outDir, '.work-linux');
  rmSync(work, { recursive: true, force: true });
  const pngs = await icons();
  const artifacts = [];

  // ---- .deb ----
  {
    const root = path.join(work, 'deb');
    const opt = path.join(root, 'opt', APP_ID);
    copyTree(path.join(stageDir, 'app'), path.join(opt, 'app'));
    copyTree(path.join(stageDir, 'runtime'), path.join(opt, 'runtime'));
    normalizeModes(opt);
    chmodSync(path.join(opt, 'runtime', 'node'), 0o755);
    writeFile(path.join(root, 'usr', 'bin', APP_ID), `#!/bin/sh\nexec /opt/${APP_ID}/runtime/node /opt/${APP_ID}/app/scripts/desktop-launcher.mjs "$@"\n`, 0o755);
    writeFile(path.join(root, 'usr', 'share', 'applications', `${APP_ID}.desktop`), desktopEntry({ exec: APP_ID }));
    for (const { size, png } of pngs) {
      const f = path.join(root, 'usr', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps', `${APP_ID}.png`);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFile(f, png);
    }
    writeFile(path.join(root, 'usr', 'share', 'doc', APP_ID, 'copyright'), `${APP_NAME}: source and licence at https://github.com/zach909/.my-ai\n`);
    const control = [
      `Package: ${APP_ID}`,
      `Version: ${info.version}`,
      'Section: utils',
      'Priority: optional',
      `Architecture: ${DEB_ARCH[arch]}`,
      `Installed-Size: ${dirSizeKb(root)}`,
      'Maintainer: zach909 <zach909@users.noreply.github.com>',
      'Recommends: chromium | chromium-browser | google-chrome-stable | microsoft-edge-stable',
      'Homepage: https://github.com/zach909/.my-ai',
      `Description: ${APP_SUMMARY}`,
      ` Runs the NeuroClaw engine on this computer and opens it in its own window.`,
      ` Bundles its own Node runtime; nothing else needs to be installed. Open it from`,
      ` the application menu. Source commit ${info.commit}.`,
      '',
    ].join('\n');
    writeFile(path.join(root, 'DEBIAN', 'control'), control);
    const post = '#!/bin/sh\nset -e\ncommand -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true\ncommand -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true\nexit 0\n';
    writeFile(path.join(root, 'DEBIAN', 'postinst'), post, 0o755);
    writeFile(path.join(root, 'DEBIAN', 'postrm'), post, 0o755);
    for (const d of ['DEBIAN', 'usr', 'usr/bin', 'usr/share', 'opt']) chmodSync(path.join(root, d), 0o755);
    const out = path.join(outDir, artifactName({ version: info.version, platform: 'linux', arch, ext: 'deb' }));
    run('dpkg-deb', ['--root-owner-group', `-Z${process.env.NEUROCLAW_DEB_COMPRESSION || 'xz'}`, '--build', root, out]);
    artifacts.push({ file: out, kind: 'linux-deb', platform: 'linux', arch });
  }

  // ---- tarball ----
  {
    const top = `neuroclaw-${info.version}-linux-${arch}`;
    const root = path.join(work, 'tar', top);
    copyTree(path.join(stageDir, 'app'), path.join(root, 'app'));
    copyTree(path.join(stageDir, 'runtime'), path.join(root, 'runtime'));
    normalizeModes(root);
    chmodSync(path.join(root, 'runtime', 'node'), 0o755);
    writeFile(path.join(root, APP_ID), '#!/bin/sh\nhere=$(dirname "$(readlink -f "$0")")\nexec "$here/runtime/node" "$here/app/scripts/desktop-launcher.mjs" "$@"\n', 0o755);
    writeFile(path.join(root, `${APP_ID}.desktop`), desktopEntry({ exec: '/path/to/neuroclaw' }));
    writeFile(path.join(root, 'README.txt'), `${APP_NAME} ${info.version}\n\nRun ./neuroclaw (double-click it in your file manager). To add it to your application menu, copy\nneuroclaw.desktop to ~/.local/share/applications/, then change the Exec= line to the full path of ./neuroclaw.\nIt installs nothing and needs no root. Remove it by deleting this folder (your data stays in ~/.neuroclaw).\n`);
    for (const { size, png } of pngs.filter((p) => p.size === 256)) writeFile(path.join(root, `${APP_ID}.png`), png);
    const out = path.join(outDir, artifactName({ version: info.version, platform: 'linux', arch, ext: 'tar.gz' }));
    const epoch = process.env.SOURCE_DATE_EPOCH ? `@${process.env.SOURCE_DATE_EPOCH}` : '1980-01-01';
    run('tar', ['--sort=name', `--mtime=${epoch}`, '--owner=0', '--group=0', '--numeric-owner', '-C', path.join(work, 'tar'), '-czf', out, top]);
    artifacts.push({ file: out, kind: 'linux-tarball', platform: 'linux', arch });
  }

  rmSync(work, { recursive: true, force: true });
  return artifacts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, out] = process.argv.slice(2);
  if (!stage || !out) { console.error('usage: package-linux.mjs <stageDir> <outDir>'); process.exit(2); }
  packageLinux({ stageDir: path.resolve(stage), outDir: path.resolve(out) })
    .then((a) => a.forEach((x) => console.log(x.file)))
    .catch((e) => { console.error(`linux packaging failed: ${e.message}`); process.exit(1); });
}
