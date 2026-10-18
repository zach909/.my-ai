/**
 * Shared helpers for the platform packagers (Linux, Windows, macOS):
 * artifact names, permission normalisation, and the one desktop entry text.
 * Node built-ins only.
 */
import { chmodSync, cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const APP_NAME = 'NeuroClaw';
export const APP_ID = 'neuroclaw';
export const APP_SUMMARY = 'Local-first AI agent: one engine on this computer, no account and no cloud required.';

/** Chrome/Debian use different architecture names; artifacts and the manifest use x64 and arm64. */
export const DEB_ARCH = { x64: 'amd64', arm64: 'arm64' };

export function artifactName({ version, platform, arch, ext }) {
  return `neuroclaw-${version}-${platform}-${arch}.${ext}`;
}

/** Directories 755, files 644, so a package never carries the build machine's umask. Executables are set afterwards. */
export function normalizeModes(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { chmodSync(p, 0o755); normalizeModes(p); }
    else chmodSync(p, 0o644);
  }
  chmodSync(dir, 0o755);
}

export function desktopEntry({ exec }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    `Comment=${APP_SUMMARY}`,
    `Exec=${exec}`,
    `Icon=${APP_ID}`,
    'Terminal=false',
    'Categories=Utility;Science;',
    'Keywords=AI;agent;chat;assistant;',
    'StartupNotification=false',
    '',
  ].join('\n');
}

export function writeFile(file, text, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
}

export function copyTree(from, to) {
  cpSync(from, to, { recursive: true });
}
