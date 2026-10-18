#!/usr/bin/env node
/**
 * Windows packages from a staged payload (scripts/release/stage-app.mjs):
 *
 *   neuroclaw-<version>-windows-<arch>.zip   portable: unzip anywhere and double-click NeuroClaw.vbs
 *   neuroclaw-<version>-windows-<arch>.exe   installer, built with IExpress (a tool Windows itself ships).
 *                                             Installs for the current user only (no administrator rights),
 *                                             adds a Start menu entry, offers a desktop shortcut, and lists
 *                                             the app under "Installed apps" so it can be uninstalled.
 *
 *   node scripts/release/package-windows.mjs <stageDir> <outDir>
 *
 * The .exe can only be produced on Windows (iexpress.exe); elsewhere this builds the
 * zip and reports that the installer was skipped, rather than claiming it exists.
 * The installer file name deliberately avoids "setup", "install" and "update":
 * Windows' installer detection would otherwise ask for administrator elevation, and
 * an elevated run would install into the administrator's profile, not the user's.
 * The app is not code-signed here; Windows SmartScreen will say so on first run.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_ID, APP_NAME, APP_SUMMARY, artifactName, writeFile } from './packaging.mjs';
import { makeIco } from './icons.mjs';
import { createZip } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Hidden-window launcher: double-click, no console flash. */
export const LAUNCH_VBS = `' Starts NeuroClaw without a console window.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run """" & here & "\\runtime\\node.exe"" """ & here & "\\app\\scripts\\desktop-launcher.mjs""", 0, False
`;

export const INSTALL_PS1 = `# Per-user installer for ${APP_NAME}. Runs without administrator rights.
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\\${APP_NAME}'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ver = (Get-Content (Join-Path $here 'version.txt') -Raw).Trim()

# A running copy would hold its files open; stop it first.
$oldNode = Join-Path $dest 'runtime\\node.exe'
if (Test-Path $oldNode) {
  try { & $oldNode (Join-Path $dest 'app\\scripts\\desktop-launcher.mjs') --stop } catch { }
  Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $oldNode } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null
Expand-Archive -Path (Join-Path $here 'payload.zip') -DestinationPath $dest -Force

$shell = New-Object -ComObject WScript.Shell
function New-NeuroClawShortcut([string]$path) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'
  $s.Arguments = '"' + (Join-Path $dest '${APP_NAME}.vbs') + '"'
  $s.WorkingDirectory = $dest
  $s.IconLocation = Join-Path $dest '${APP_NAME}.ico'
  $s.Description = '${APP_SUMMARY}'
  $s.Save()
}
New-NeuroClawShortcut (Join-Path ([Environment]::GetFolderPath('Programs')) '${APP_NAME}.lnk')

# NEUROCLAW_INSTALL_SILENT=1 (used by the build's own install test) skips both dialogs and adds no desktop shortcut.
$silent = $env:NEUROCLAW_INSTALL_SILENT -eq '1'
Add-Type -AssemblyName PresentationFramework
$answer = 'No'
if (-not $silent) { $answer = [System.Windows.MessageBox]::Show('Add a ${APP_NAME} shortcut to your desktop?', '${APP_NAME}', 'YesNo', 'Question') }
if ($answer -eq 'Yes') { New-NeuroClawShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) '${APP_NAME}.lnk') }

$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}'
New-Item -Path $key -Force | Out-Null
Set-ItemProperty $key DisplayName '${APP_NAME}'
Set-ItemProperty $key DisplayVersion $ver
Set-ItemProperty $key Publisher 'zach909'
Set-ItemProperty $key InstallLocation $dest
Set-ItemProperty $key DisplayIcon (Join-Path $dest '${APP_NAME}.ico')
Set-ItemProperty $key UninstallString ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dest 'uninstall.ps1') + '"')
Set-ItemProperty $key NoModify 1 -Type DWord
Set-ItemProperty $key NoRepair 1 -Type DWord

if (-not $silent) { [System.Windows.MessageBox]::Show('${APP_NAME} ' + $ver + ' is installed. Find it in the Start menu.', '${APP_NAME}', 'OK', 'Information') | Out-Null }
`;

export const UNINSTALL_PS1 = `# Removes ${APP_NAME} for the current user. Your data in %USERPROFILE%\\.neuroclaw is kept.
$ErrorActionPreference = 'SilentlyContinue'
$dest = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $dest 'runtime\\node.exe'
if (Test-Path $node) { & $node (Join-Path $dest 'app\\scripts\\desktop-launcher.mjs') --stop }
Get-Process -Name node | Where-Object { $_.Path -eq $node } | Stop-Process -Force
Start-Sleep -Seconds 1
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) '${APP_NAME}.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) '${APP_NAME}.lnk') -Force
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}' -Recurse -Force
# This script lives inside the folder it deletes, so hand the last step to a process that outlives it.
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList ('/c ping -n 3 127.0.0.1 >nul & rmdir /s /q "' + $dest + '"')
`;

export const INSTALL_CMD = '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"\r\n';

export function iexpressSed({ workDir, target }) {
  const files = ['payload.zip', 'install.ps1', 'install.cmd', 'version.txt'];
  const w = workDir.endsWith('\\') ? workDir : `${workDir}\\`;
  return [
    '[Version]', 'Class=IEXPRESS', 'SEDVersion=3',
    '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=0', 'HideExtractAnimation=1', 'UseLongFileName=1',
    'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N', 'InstallPrompt=', 'DisplayLicense=',
    `FinishMessage=`, `TargetName=${target}`, `FriendlyName=${APP_NAME}`, 'AppLaunched=cmd /c install.cmd', 'PostInstallCmd=<None>',
    'AdminQuietInstCmd=', 'UserQuietInstCmd=', 'SourceFiles=SourceFiles',
    '[SourceFiles]', `SourceFiles0=${w}`,
    '[SourceFiles0]', ...files.map((f) => `%FILE_${f.replace(/\W/g, '_')}%=`),
    '[Strings]', ...files.map((f) => `FILE_${f.replace(/\W/g, '_')}="${f}"`),
    '',
  ].join('\r\n');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push({ name: path.relative(base, p).split(path.sep).join('/'), file: p });
  }
  return out;
}

export async function packageWindows({ stageDir, outDir }) {
  const info = JSON.parse(readFileSync(path.join(stageDir, 'app', 'build-info.json'), 'utf8'));
  const { renderIconPng } = await import(pathToFileURL(path.join(ROOT, 'dist', 'interface', 'platform', 'icon.js')).href);
  mkdirSync(outDir, { recursive: true });
  const ico = makeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: renderIconPng(size) })));

  const entries = [];
  for (const { name, file } of listFiles(path.join(stageDir, 'app'))) entries.push({ name: `${APP_NAME}/app/${name}`, data: readFileSync(file) });
  entries.push({ name: `${APP_NAME}/runtime/node.exe`, data: readFileSync(path.join(stageDir, 'runtime', 'node.exe')) });
  entries.push({ name: `${APP_NAME}/${APP_NAME}.vbs`, data: Buffer.from(LAUNCH_VBS.replace(/\n/g, '\r\n')) });
  entries.push({ name: `${APP_NAME}/${APP_NAME}.ico`, data: ico });
  entries.push({ name: `${APP_NAME}/uninstall.ps1`, data: Buffer.from(UNINSTALL_PS1) });

  const artifacts = [];
  const zip = path.join(outDir, artifactName({ version: info.version, platform: 'windows', arch: info.arch, ext: 'zip' }));
  writeFileSync(zip, createZip(entries));
  artifacts.push({ file: zip, kind: 'windows-zip', platform: 'windows', arch: info.arch });

  if (process.platform !== 'win32') {
    console.warn('windows installer skipped: iexpress.exe exists only on Windows');
    return { artifacts, skipped: [{ kind: 'windows-installer-exe', reason: 'iexpress.exe is only available on Windows runners' }] };
  }
  // Installer: the same tree, zipped without the top folder, plus the scripts IExpress runs.
  const work = path.join(outDir, '.work-windows');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'payload.zip'), createZip(entries.map((e) => ({ ...e, name: e.name.slice(APP_NAME.length + 1) }))));
  writeFile(path.join(work, 'install.ps1'), INSTALL_PS1);
  writeFile(path.join(work, 'install.cmd'), INSTALL_CMD);
  writeFile(path.join(work, 'version.txt'), `${info.version}\n`);
  const target = path.resolve(outDir, artifactName({ version: info.version, platform: 'windows', arch: info.arch, ext: 'exe' }));
  writeFileSync(path.join(work, 'neuroclaw.sed'), iexpressSed({ workDir: work, target }));
  const r = spawnSync('iexpress.exe', ['/N', '/Q', path.join(work, 'neuroclaw.sed')], { encoding: 'utf8' });
  rmSync(work, { recursive: true, force: true });
  let ok = false;
  try { ok = statSync(target).size > 1024 * 1024; } catch { ok = false; }
  if (r.status !== 0 || !ok) throw new Error(`iexpress did not produce the installer (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(-300)}`);
  artifacts.push({ file: target, kind: 'windows-installer-exe', platform: 'windows', arch: info.arch });
  return { artifacts, skipped: [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, out] = process.argv.slice(2);
  if (!stage || !out) { console.error('usage: package-windows.mjs <stageDir> <outDir>'); process.exit(2); }
  packageWindows({ stageDir: path.resolve(stage), outDir: path.resolve(out) })
    .then((r) => { r.artifacts.forEach((x) => console.log(x.file)); r.skipped.forEach((s) => console.log(`SKIPPED ${s.kind}: ${s.reason}`)); })
    .catch((e) => { console.error(`windows packaging failed: ${e.message}`); process.exit(1); });
}
