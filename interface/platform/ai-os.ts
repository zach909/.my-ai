/**
 * AI OS mode: turn an ordinary computer into one where the AI is always there.
 *
 * Today NeuroClaw runs only while its window is open (see scripts/desktop-launcher.mjs: closing the
 * window stops the engine). In AI OS mode the engine is part of the user's login session instead: the
 * operating system starts it when the person signs in, restarts it if it dies (where the OS can), and it
 * keeps running with no window open, so the AI is ready the moment a window, a browser tab or the Chrome
 * extension on this computer asks for it. (Other devices, such as the phone app, can only reach it if the
 * owner has set the server up to listen on the network, which needs a password; this mode does not change that.)
 *
 * It is a conversion of the machine you already have, not a new operating system, and it is undone with
 * one command. It uses each OS's own per-user mechanism, so it needs no administrator rights and no
 * helper program:
 *
 *   Linux    a systemd user service; where there is no user manager (a container, WSL without systemd)
 *            an XDG autostart entry in ~/.config/autostart instead
 *   macOS    a LaunchAgent in ~/Library/LaunchAgents
 *   Windows  a value under HKCU\...\Run that starts a hidden script (no console window at sign-in)
 *
 * What it does NOT do, on purpose: it grants the agent nothing. Computer Access switches, tool safety
 * and approvals work exactly as before; this only decides when the engine starts. The engine still binds
 * to this computer's loopback address unless the owner has set a password and another address.
 *
 * `planAiOs` is a pure function (an environment in, files and commands out) so every platform's output is
 * tested on any machine. `enableAiOs` / `disableAiOs` / `aiOsStatus` run a plan through an injectable
 * `AiOsIo`, so tests use a fake instead of touching the real operating system. Windows and macOS output is
 * generated and checked here but has not been run on those systems from this repository's Linux sandbox.
 *
 * Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { codeRoot, dataRoot } from './app-paths.js';

export type AiOsMechanism = 'systemd-user' | 'xdg-autostart' | 'launch-agent' | 'run-key';

/** What the operating system should start, and how. */
export interface EngineCommand {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** 'launcher' = the packaged app's launcher (installed builds); 'direct' = dist/interface/main.js (a source checkout). */
  kind: 'launcher' | 'direct';
}

export interface AiOsEnv {
  platform: NodeJS.Platform;
  home: string;
  /** The per-user data folder (logs and the hidden launcher script live here). */
  dataDir: string;
  /** The folder that holds package.json, dist/ and scripts/. */
  root: string;
  /** The Node runtime to start the engine with. */
  node: string;
  uid: number | null;
  /** Whether `systemctl --user` can reach a user manager right now (Linux only). */
  systemdUser: boolean;
  env: NodeJS.ProcessEnv;
}

export interface Command {
  file: string;
  args: string[];
  label: string;
  /** A failure is not an error (for example "stop" when nothing is running). */
  optional?: boolean;
}

export interface FileWrite { path: string; content: string; mode?: number }

export interface AiOsUnsupported { supported: false; reason: string }
export type AiOsPlan =
  | AiOsUnsupported
  | {
      supported: true;
      mechanism: AiOsMechanism;
      /** One line for the person: what turning this on will do. */
      summary: string;
      engine: EngineCommand;
      files: FileWrite[];
      /** Run after the files are written: registers it for the next sign-in. Never starts a second engine. */
      enable: Command[];
      /** Only when nothing is running yet: start it now instead of waiting for the next sign-in. */
      startNow: Command[];
      /** Run before the files are removed. */
      disable: Command[];
      /** Every file this mode can leave behind on this platform, in either of its mechanisms. */
      remove: string[];
      /** Files from the other mechanism, removed on enable so the engine is never started twice. */
      removeOnEnable: string[];
      /** Alternatives: the mode is installed when every path of ANY one set exists (and `registry`, if set, holds). */
      installed: string[][];
      /** Windows: the registry value that must also exist. */
      registry?: { key: string; value: string };
      /** Linux/GNOME: a keyboard shortcut that opens the assistant, set through the desktop's own settings tool. */
      shortcut?: { command: string; binding: string; gnome: boolean };
    };

/** A type guard: with the repo's non-strict tsconfig a boolean discriminant does not narrow on its own. */
export const isUnsupported = (plan: AiOsPlan): plan is AiOsUnsupported => plan.supported === false;

export const DEFAULT_PORT = 7861;
const NAME = 'neuroclaw';
const LABEL = 'ai.neuroclaw.os';
const RUN_VALUE = 'NeuroClawAiOs';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
/** The key combination Windows attaches to the Start menu shortcut. Ctrl+Alt+letter is the form a shortcut's Hotkey accepts. */
export const SUMMON_HOTKEY = 'CTRL+ALT+N';
/** The same combination in GNOME's notation. */
export const GNOME_BINDING = '<Primary><Alt>n';
const GNOME_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const GNOME_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/neuroclaw/';

/** Path rules of the platform being planned for, not of the machine doing the planning. */
const pathFor = (platform: NodeJS.Platform): typeof path.posix => (platform === 'win32' ? path.win32 : path.posix);

/** Where the engine runs from: the packaged launcher when this is an installed build, else the built backend. */
export function engineCommand(platform: NodeJS.Platform, root: string, node: string, dataDir: string, exists: (p: string) => boolean = existsSync): EngineCommand | null {
  const P = pathFor(platform);
  const launcher = P.join(root, 'scripts', 'desktop-launcher.mjs');
  if (exists(P.join(root, 'build-info.json')) && exists(launcher)) {
    return { kind: 'launcher', file: node, args: [launcher, '--no-window'], cwd: dataDir, env: {} };
  }
  const main = P.join(root, 'dist', 'interface', 'main.js');
  if (exists(main)) {
    // A background service must never rewrite the checkout it runs from, so the startup git pull is off.
    return { kind: 'direct', file: node, args: [main, 'web', String(DEFAULT_PORT)], cwd: root, env: { NEUROCLAW_AUTO_UPDATE: '0' } };
  }
  return null;
}

/* ---------- quoting for each target format ---------- */

/** systemd: one quoted word of ExecStart. Backslash and quote are escaped; % would start a specifier. */
const sd = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
/**
 * Desktop Entry `Exec`: a quoted argument escapes " ` $ and \ with a backslash, % is doubled, and then the
 * file's own string escaping doubles every backslash again (Desktop Entry spec, "The Exec key").
 */
const desktopWord = (s: string): string => `"${s.replace(/%/g, '%%').replace(/(["`$\\])/g, '\\$1')}"`.replace(/\\/g, '\\\\');
const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A VBScript string literal. */
const vbs = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/* ---------- the plan ---------- */

export function planAiOs(e: AiOsEnv, exists: (p: string) => boolean = existsSync): AiOsPlan {
  const platform = e.platform;
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
    return { supported: false, reason: `AI OS mode needs a desktop computer (Windows, macOS or Linux). This is ${platform}; on a phone or Chromebook, point the app at a computer that has it turned on.` };
  }
  const P = pathFor(platform);
  const engine = engineCommand(platform, e.root, e.node, e.dataDir, exists);
  if (!engine) {
    return { supported: false, reason: 'This copy of NeuroClaw has not been built yet (dist/interface/main.js is missing), so there is nothing for the computer to start. Run "node scripts/build-backend.mjs" first.' };
  }
  const log = P.join(e.dataDir, 'logs', 'ai-os.log');
  const argv = [engine.file, ...engine.args];

  if (platform === 'linux') {
    const configHome = e.env.XDG_CONFIG_HOME && P.isAbsolute(e.env.XDG_CONFIG_HOME) ? e.env.XDG_CONFIG_HOME : P.join(e.home, '.config');
    const unit = P.join(configHome, 'systemd', 'user', `${NAME}.service`);
    const wants = P.join(configHome, 'systemd', 'user', 'default.target.wants', `${NAME}.service`);
    const autostart = P.join(configHome, 'autostart', `${NAME}-ai-os.desktop`);
    const dataHome = e.env.XDG_DATA_HOME && P.isAbsolute(e.env.XDG_DATA_HOME) ? e.env.XDG_DATA_HOME : P.join(e.home, '.local', 'share');
    const menu = P.join(dataHome, 'applications', `${NAME}-assistant.desktop`);
    // What the menu entry and the shortcut run: an installed build's launcher (which attaches to the running engine and
    // shows its own window), else the engine's page in the default browser.
    const open = engine.kind === 'launcher'
      ? [engine.file, P.join(e.root, 'scripts', 'desktop-launcher.mjs')]
      : ['xdg-open', `http://127.0.0.1:${DEFAULT_PORT}/`];
    const menuText = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=NeuroClaw Assistant',
      'Comment=Open the NeuroClaw assistant',
      `Exec=${open.map(desktopWord).join(' ')}`,
      'Terminal=false',
      'Categories=Utility;',
      'Keywords=ai;assistant;neuroclaw;',
      '',
    ].join('\n');
    const gnome = /(^|:)GNOME(:|$)/i.test(String(e.env.XDG_CURRENT_DESKTOP ?? ''));
    const shortcut = { gnome, binding: GNOME_BINDING, command: open.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ') };
    const unitText = [
      '[Unit]',
      'Description=NeuroClaw (AI OS mode: the AI engine for this account)',
      'StartLimitIntervalSec=300',
      'StartLimitBurst=5',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${engine.cwd.replace(/%/g, '%%')}`,
      `ExecStart=${argv.map(sd).join(' ')}`,
      ...Object.entries(engine.env).map(([k, v]) => `Environment=${sd(`${k}=${v}`)}`),
      `StandardOutput=append:${log.replace(/%/g, '%%')}`,
      `StandardError=append:${log.replace(/%/g, '%%')}`,
      'Restart=on-failure',
      'RestartSec=5',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n');
    const desktopText = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=NeuroClaw (AI OS mode)',
      'Comment=Starts the NeuroClaw engine when you sign in',
      `Exec=${(Object.keys(engine.env).length ? ['env', ...Object.entries(engine.env).map(([k, v]) => `${k}=${v}`), ...argv] : argv).map(desktopWord).join(' ')}`,
      `Path=${engine.cwd}`,
      'Terminal=false',
      'NoDisplay=true',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
    const installed = [[unit, wants], [autostart]];
    // systemd refuses ' " \ and tab in a program path, and expands $VAR in arguments; rather than guess how it
    // would read such a path, use the autostart entry (whose quoting is defined by the Desktop Entry spec).
    const systemdCanTakeThesePaths = argv.every((a) => !/[$'"\\\t\r\n]/.test(a)) && !/[\r\n]/.test(engine.cwd + log);
    if (e.systemdUser && systemdCanTakeThesePaths) {
      return {
        supported: true, mechanism: 'systemd-user', engine, installed,
        summary: `Starts the engine when you sign in, through a systemd user service, and restarts it if it stops. Adds a "NeuroClaw Assistant" entry to the application menu${gnome ? ' and the keyboard shortcut Ctrl+Alt+N' : ''}.`,
        files: [{ path: unit, content: unitText, mode: 0o644 }, { path: menu, content: menuText, mode: 0o644 }],
        shortcut,
        enable: [
          { file: 'systemctl', args: ['--user', 'daemon-reload'], label: 'Reload systemd' },
          { file: 'systemctl', args: ['--user', 'enable', `${NAME}.service`], label: 'Enable the service for your next sign-in' },
        ],
        startNow: [{ file: 'systemctl', args: ['--user', 'start', `${NAME}.service`], label: 'Start the service now' }],
        disable: [{ file: 'systemctl', args: ['--user', 'disable', '--now', `${NAME}.service`], label: 'Stop and disable the service', optional: true }],
        remove: [unit, wants, autostart, menu],
        removeOnEnable: [autostart],
      };
    }
    return {
      supported: true, mechanism: 'xdg-autostart', engine, installed,
      summary: `Starts the engine when you sign in, through an autostart entry${gnome ? ', adds an application-menu entry and the keyboard shortcut Ctrl+Alt+N' : ' and adds an application-menu entry'}. ${e.systemdUser ? 'A path here has a character systemd cannot take' : 'This session has no systemd user manager'}, so it is not restarted if it stops.`,
      files: [{ path: autostart, content: desktopText, mode: 0o644 }, { path: menu, content: menuText, mode: 0o644 }],
      shortcut,
      enable: [],
      startNow: [],
      disable: [],
      remove: [autostart, unit, wants, menu],
      removeOnEnable: [unit, wants],
    };
  }

  if (platform === 'darwin') {
    const plist = P.join(e.home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const uid = e.uid ?? 0;
    const envEntries = Object.entries(engine.env);
    const text = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${LABEL}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      ...argv.map((a) => `    <string>${xml(a)}</string>`),
      '  </array>',
      '  <key>WorkingDirectory</key>',
      `  <string>${xml(engine.cwd)}</string>`,
      ...(envEntries.length
        ? ['  <key>EnvironmentVariables</key>', '  <dict>', ...envEntries.flatMap(([k, v]) => [`    <key>${xml(k)}</key>`, `    <string>${xml(v)}</string>`]), '  </dict>']
        : []),
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <dict>',
      '    <key>SuccessfulExit</key>',
      '    <false/>',
      '  </dict>',
      '  <key>ThrottleInterval</key>',
      '  <integer>10</integer>',
      '  <key>StandardOutPath</key>',
      `  <string>${xml(log)}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${xml(log)}</string>`,
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
    return {
      supported: true, mechanism: 'launch-agent', engine, installed: [[plist]],
      summary: 'Starts the engine when you sign in, through a LaunchAgent, and restarts it if it stops.',
      files: [{ path: plist, content: text, mode: 0o644 }],
      // launchd loads everything in ~/Library/LaunchAgents at sign-in, so writing the file is the whole of "enable".
      enable: [],
      startNow: [
        { file: 'launchctl', args: ['bootout', `gui/${uid}/${LABEL}`], label: 'Replace any older copy', optional: true },
        { file: 'launchctl', args: ['bootstrap', `gui/${uid}`, plist], label: 'Load the LaunchAgent now' },
      ],
      disable: [{ file: 'launchctl', args: ['bootout', `gui/${uid}/${LABEL}`], label: 'Unload the LaunchAgent', optional: true }],
      remove: [plist],
      removeOnEnable: [],
    };
  }

  // Windows: a registry Run value starts wscript.exe, which runs a hidden command. node.exe on its own would flash a console window.
  const script = P.join(e.dataDir, 'ai-os.vbs');
  const openScript = P.join(e.dataDir, 'ai-os-open.vbs');
  const makerScript = P.join(e.dataDir, 'ai-os-shortcut.vbs');
  const shortcut = P.join(e.env.APPDATA || P.join(e.home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'NeuroClaw Assistant.lnk');
  const lines = [
    '\' NeuroClaw AI OS mode: starts the engine at sign-in with no console window. Written by NeuroClaw; remove it with "node scripts/ai-os.mjs disable".',
    'Set sh = CreateObject("WScript.Shell")',
    ...Object.entries(engine.env).map(([k, v]) => `sh.Environment("PROCESS")(${vbs(k)}) = ${vbs(v)}`),
    `sh.CurrentDirectory = ${vbs(engine.cwd)}`,
    `sh.Run ${vbs(argv.map((a) => `"${a}"`).join(' '))}, 0, False`,
    '',
  ];
  // Opens the assistant window. An installed build's launcher attaches to the running engine and shows its own window;
  // a source checkout has no window launcher, so the engine's page opens in the default browser.
  const openLines = [
    '\' NeuroClaw assistant: opens the window onto the engine that AI OS mode keeps running.',
    'Set sh = CreateObject("WScript.Shell")',
    engine.kind === 'launcher'
      ? `sh.Run ${vbs(`"${engine.file}" "${P.join(e.root, 'scripts', 'desktop-launcher.mjs')}"`)}, 0, False`
      : `sh.Run ${vbs(`http://127.0.0.1:${DEFAULT_PORT}/`)}`,
    '',
  ];
  // One-off: creates the Start menu shortcut that carries the hotkey. Windows only honours a shortcut's Hotkey from the Start menu or desktop.
  const makerLines = [
    '\' NeuroClaw AI OS mode: creates the "NeuroClaw Assistant" Start menu shortcut and its hotkey.',
    'Set sh = CreateObject("WScript.Shell")',
    `Set lnk = sh.CreateShortcut(${vbs(shortcut)})`,
    'lnk.TargetPath = "wscript.exe"',
    `lnk.Arguments = ${vbs(`//B //Nologo "${openScript}"`)}`,
    `lnk.Hotkey = ${vbs(SUMMON_HOTKEY)}`,
    'lnk.WindowStyle = 7',
    'lnk.Description = "Open the NeuroClaw assistant"',
    'lnk.Save',
    '',
  ];
  return {
    supported: true, mechanism: 'run-key', engine, installed: [[script]], registry: { key: RUN_KEY, value: RUN_VALUE },
    summary: `Starts the engine when you sign in (a hidden script listed under your account's startup programs; it is not restarted if it stops) and adds a "NeuroClaw Assistant" Start menu shortcut you can open with ${SUMMON_HOTKEY}.`,
    files: [
      { path: script, content: lines.join('\r\n') },
      { path: openScript, content: openLines.join('\r\n') },
      { path: makerScript, content: makerLines.join('\r\n') },
    ],
    enable: [
      { file: 'reg', args: ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `wscript.exe //B //Nologo "${script}"`, '/f'], label: 'Add the startup entry' },
      { file: 'wscript.exe', args: ['//B', '//Nologo', makerScript], label: 'Create the Start menu shortcut and its hotkey' },
    ],
    startNow: [],
    disable: [{ file: 'reg', args: ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], label: 'Remove the startup entry', optional: true }],
    remove: [script, openScript, makerScript, shortcut],
    removeOnEnable: [],
  };
}

/* ---------- running a plan ---------- */

export interface RunResult { status: number | null; stdout: string; stderr: string }

export interface AiOsIo {
  writeFile(file: string, content: string, mode?: number): void;
  /** Removes the file or link if it is there (a dangling link too); not an error when it is not. */
  removeFile(file: string): void;
  exists(file: string): boolean;
  run(file: string, args: string[]): RunResult;
}

export const realIo: AiOsIo = {
  writeFile(file, content, mode) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, file);
  },
  removeFile(file) { rmSync(file, { force: true }); },
  exists: (file) => existsSync(file),
  run(file, args) {
    const r = spawnSync(file, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : r.stderr ?? '' };
  },
};

export interface StepResult { step: string; ok: boolean; detail?: string }
export interface AiOsResult {
  ok: boolean;
  enabled: boolean;
  mechanism: AiOsMechanism | null;
  steps: StepResult[];
  /** Plain words for the person. */
  message: string;
}

export function currentEnv(io: AiOsIo = realIo): AiOsEnv {
  const platform = process.platform;
  let systemdUser = false;
  if (platform === 'linux') { try { systemdUser = io.run('systemctl', ['--user', 'show-environment']).status === 0; } catch { /* no systemctl */ } }
  return {
    platform, home: homedir(), dataDir: dataRoot(), root: codeRoot(), node: process.execPath,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    systemdUser, env: process.env,
  };
}

const detailOf = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300);

/* ---------- the GNOME keyboard shortcut (Debian's default desktop) ---------- */

/** A GVariant string literal, as `gsettings set` reads it. */
const gv = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Reads `gsettings get ... custom-keybindings` output. Returns null for anything that is not exactly an array of
 * plain strings, so an unexpected format means the person's existing shortcuts are left completely alone.
 */
export function parseGsettingsList(out: string): string[] | null {
  const t = out.trim();
  if (t === '@as []' || t === '[]') return [];
  const m = /^\[((?:'[^'\\]*')(?:,\s*'[^'\\]*')*)\]$/.exec(t);
  return m ? [...m[1].matchAll(/'([^'\\]*)'/g)].map((x) => x[1]) : null;
}

/** Add (on) or remove (off) NeuroClaw's own entry in GNOME's custom shortcuts, touching nothing else. Never throws; failures are steps. */
export function applyGnomeShortcut(sc: { command: string; binding: string }, io: AiOsIo, on: boolean): StepResult[] {
  const label = on ? 'Add the keyboard shortcut' : 'Remove the keyboard shortcut';
  const run = (args: string[]): RunResult => { try { return io.run('gsettings', args); } catch (err) { return { status: null, stdout: '', stderr: (err as Error).message }; } };
  const got = run(['get', GNOME_KEYS, 'custom-keybindings']);
  if (got.status !== 0) return on ? [{ step: label, ok: true, detail: 'skipped: this session has no usable GNOME settings' }] : [];
  const list = parseGsettingsList(got.stdout);
  if (list === null) return [{ step: label, ok: true, detail: 'skipped: your shortcut list is in a format this did not expect, so it was left alone' }];
  const has = list.includes(GNOME_PATH);
  if (!on && !has) return [];
  const schema = `${GNOME_KEYS}.custom-keybinding:${GNOME_PATH}`;
  const steps: StepResult[] = [];
  const attempt = (what: string, args: string[]): boolean => {
    const r = run(args);
    const ok = r.status === 0;
    steps.push({ step: what, ok, detail: ok ? undefined : detailOf(r) || `exit ${r.status}` });
    return ok;
  };
  if (on) {
    const wrote = attempt(`${label}: name`, ['set', schema, 'name', gv('NeuroClaw Assistant')])
      && attempt(`${label}: command`, ['set', schema, 'command', gv(sc.command)])
      && attempt(`${label}: key`, ['set', schema, 'binding', gv(sc.binding)]);
    if (wrote && !has) attempt(`${label}: list`, ['set', GNOME_KEYS, 'custom-keybindings', `[${[...list, GNOME_PATH].map(gv).join(', ')}]`]);
  } else {
    const rest = list.filter((x) => x !== GNOME_PATH);
    attempt(label, ['set', GNOME_KEYS, 'custom-keybindings', rest.length ? `[${rest.map(gv).join(', ')}]` : '@as []']);
    for (const k of ['name', 'command', 'binding']) run(['reset', schema, k]);
  }
  return steps;
}

function runCommand(io: AiOsIo, c: Command): { ok: boolean; step: StepResult } {
  let r: RunResult;
  try { r = io.run(c.file, c.args); } catch (err) { r = { status: null, stdout: '', stderr: (err as Error).message }; }
  const ok = r.status === 0;
  return { ok, step: { step: c.label, ok: ok || !!c.optional, detail: ok ? undefined : detailOf(r) || `exit ${r.status}` } };
}

export interface EnableOptions {
  /**
   * Also start the engine now. Only pass true when no engine is running: a second one on the same port
   * would fail and be restarted in a loop. The default registers it for the next sign-in only.
   */
  startNow?: boolean;
}

/** Make the engine start at sign-in. Idempotent: running it again rewrites the same files. */
export function enableAiOs(e: AiOsEnv = currentEnv(), io: AiOsIo = realIo, opts: EnableOptions = {}): AiOsResult {
  const plan = planAiOs(e, io.exists);
  if (isUnsupported(plan)) return { ok: false, enabled: false, mechanism: null, steps: [], message: plan.reason };
  const steps: StepResult[] = [];
  const written: string[] = [];
  const fail = (message: string): AiOsResult => ({ ok: false, enabled: false, mechanism: plan.mechanism, steps, message });
  const rollback = () => { for (const f of written) { try { io.removeFile(f); } catch { /* best effort */ } } };

  for (const f of plan.removeOnEnable) {
    try {
      const had = io.exists(f);
      io.removeFile(f);
      if (had) steps.push({ step: `Remove ${f} (the other way of starting it)`, ok: true });
    } catch (err) { steps.push({ step: `Remove ${f}`, ok: false, detail: (err as Error).message }); }
  }
  try { mkdirSync(path.join(e.dataDir, 'logs'), { recursive: true }); } catch { /* the service reports it if it matters */ }
  for (const f of plan.files) {
    try {
      io.writeFile(f.path, f.content, f.mode);
      written.push(f.path);
      steps.push({ step: `Write ${f.path}`, ok: true });
    } catch (err) {
      steps.push({ step: `Write ${f.path}`, ok: false, detail: (err as Error).message });
      rollback();
      return fail(`Could not write ${f.path}: ${(err as Error).message}. Nothing was turned on.`);
    }
  }
  for (const c of [...plan.enable, ...(opts.startNow ? plan.startNow : [])]) {
    const { ok, step } = runCommand(io, c);
    steps.push(step);
    if (!ok && !c.optional) {
      rollback();
      for (const d of plan.disable) runCommand(io, d);
      return fail(`"${c.label}" failed (${step.detail}). Nothing was left turned on.`);
    }
  }
  if (plan.shortcut?.gnome) steps.push(...applyGnomeShortcut(plan.shortcut, io, true));
  const when = opts.startNow && plan.startNow.length ? 'It is running now and will start at every sign-in.' : 'The engine you have open now keeps running; the computer starts it from your next sign-in.';
  const shortcutFailed = steps.some((x) => !x.ok);
  return { ok: true, enabled: true, mechanism: plan.mechanism, steps, message: `AI OS mode is on. ${plan.summary} ${when}${shortcutFailed ? ' The keyboard shortcut could not be set; see the steps.' : ''}` };
}

/** Stop starting the engine at sign-in and remove everything enableAiOs wrote. A server that is already running keeps running until it is closed. */
export function disableAiOs(e: AiOsEnv = currentEnv(), io: AiOsIo = realIo): AiOsResult {
  const plan = planAiOs(e, io.exists);
  if (isUnsupported(plan)) return { ok: false, enabled: false, mechanism: null, steps: [], message: plan.reason };
  const steps: StepResult[] = [];
  let ok = true;
  for (const c of plan.disable) {
    const r = runCommand(io, c);
    steps.push(r.step);
    if (!r.ok && !c.optional) ok = false;
  }
  for (const f of plan.remove) {
    try {
      const had = io.exists(f);
      io.removeFile(f);
      if (had) steps.push({ step: `Remove ${f}`, ok: true });
    } catch (err) {
      ok = false;
      steps.push({ step: `Remove ${f}`, ok: false, detail: (err as Error).message });
    }
  }
  if (plan.shortcut) {
    const st = applyGnomeShortcut(plan.shortcut, io, false);
    steps.push(...st);
    if (st.some((x) => !x.ok)) ok = false;
  }
  if (plan.mechanism === 'systemd-user') runCommand(io, { file: 'systemctl', args: ['--user', 'daemon-reload'], label: 'Reload systemd', optional: true });
  if (ok) return { ok: true, enabled: false, mechanism: plan.mechanism, steps, message: 'AI OS mode is off. NeuroClaw will no longer start when you sign in.' };
  // Do not claim it is off when a step failed: look at what is actually still there.
  return { ok: false, enabled: aiOsStatus(e, io).enabled, mechanism: plan.mechanism, steps, message: 'Some parts could not be removed; see the steps.' };
}

export interface AiOsStatus {
  supported: boolean;
  platform: NodeJS.Platform;
  mechanism: AiOsMechanism | null;
  enabled: boolean;
  /** Why it is unavailable. Empty when supported. */
  reason: string;
  /** What turning it on does on this machine. */
  summary: string;
  files: string[];
}

export function aiOsStatus(e: AiOsEnv = currentEnv(), io: AiOsIo = realIo): AiOsStatus {
  const plan = planAiOs(e, io.exists);
  if (isUnsupported(plan)) return { supported: false, platform: e.platform, mechanism: null, enabled: false, reason: plan.reason, summary: '', files: [] };
  // "On" means the thing the operating system reads is there, in either mechanism, not just one of our files.
  let enabled = plan.installed.some((set) => set.every((p) => io.exists(p)));
  if (enabled && plan.registry) {
    try { enabled = io.run('reg', ['query', plan.registry.key, '/v', plan.registry.value]).status === 0; } catch { enabled = false; }
  }
  return { supported: true, platform: e.platform, mechanism: plan.mechanism, enabled, reason: '', summary: plan.summary, files: plan.files.map((f) => f.path) };
}
