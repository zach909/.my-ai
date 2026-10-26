/**
 * The feature contract: every shared feature, what implements it, what it needs
 * from the platform, where it works, and which tests cover it.
 *
 * Support per platform is DERIVED, not typed in. A feature lists the platform
 * capabilities it needs (`needs`: alternatives, each a set that must all hold)
 * and `featureSupport()` combines that with the adapter table in adapters.ts.
 * So a platform cannot be claimed to support chat without a way to reach an
 * engine, and the parity matrix in docs/PLATFORMS.md is generated from this
 * file (scripts/release/parity-matrix.mjs) and checked by a test.
 *
 * `verifyContract()` checks the parts that can be checked from the file system:
 * that implementation files exist, that each route is actually handled in the
 * server source, and that each named test file exists. A feature that points at
 * something that is not there fails the build.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ADAPTERS, PLATFORM_IDS, type CapabilityId, type PlatformId, type Support } from './adapters.js';

export interface FeatureTest {
  file: string;
  /** vitest: the repo's existing suite (needs its dev dependencies installed). node-test: runs with plain `node --test`. */
  runner: 'vitest' | 'node-test';
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  /** Files that implement it, relative to the repo root. */
  implementation: string[];
  /** HTTP routes it is reached through (METHOD path). Each must appear in the server source. */
  routes: string[];
  /** Alternatives. The feature works where ANY one set is fully available. */
  needs: CapabilityId[][];
  tests: FeatureTest[];
  /** True when the feature contacts the network to do its job. */
  needsNetwork?: boolean;
  /** When set, the feature only exists on these platforms (it is not "unsupported" elsewhere, it is not applicable). */
  onlyOn?: PlatformId[];
}

const v = (file: string): FeatureTest => ({ file, runner: 'vitest' });
const n = (file: string): FeatureTest => ({ file, runner: 'node-test' });

/** An engine is reachable either on the device or at a server. */
const ENGINE: CapabilityId[][] = [['localEngine'], ['remoteEngine']];

export const FEATURES: Feature[] = [
  {
    id: 'chat', title: 'Chat', description: 'Talk to the agent; replies come from the OneBrain mesh through the bit-level Zip Loop.',
    implementation: ['interface/web-server.ts', 'interface/runner.ts', 'interface/visuals.ts', 'models && skills/llm.js'],
    routes: ['POST /api/chat', 'POST /api/chat/messages', 'POST /api/chat/correct', 'GET /api/status'],
    needs: ENGINE, tests: [v('test/core/zip-loop-send.test.ts'), v('test/core/chat-send-gate.test.ts'), n('test/platform/engine.test.mjs'), n('test/platform/visuals.test.mjs')],
  },
  {
    id: 'chat-history', title: 'Chat history', description: 'Saved threads, search, pinning, export and import.',
    implementation: ['models && skills/core/chat-history-store.ts'],
    routes: ['GET /api/chat-history/threads', 'POST /api/chat-history/save', 'GET /api/chat-history/search', 'GET /api/chat-history/export', 'POST /api/chat-history/import'],
    needs: ENGINE, tests: [v('test/core/chat-history-pin.test.ts'), v('test/core/chat-archive.test.ts')],
  },
  {
    id: 'memory', title: 'Memory', description: 'What the agent remembers, listed, forgotten one item or all at once.',
    implementation: ['models && skills/onebrain-memory.js', 'models && skills/core/long-term-memory.ts'],
    routes: ['GET /api/memory', 'DELETE /api/memory/all'],
    needs: ENGINE, tests: [v('test/core/long-term-memory.test.ts'), v('test/core/delete-everything.test.ts')],
  },
  {
    id: 'reasoning', title: 'Reasoning engine', description: 'OneBrain neural mesh, hyperdimensional memory, experts and the Zip Loop.',
    implementation: ['models && skills/llm.js', 'models && skills/core/unified-brain.ts', 'models && skills/onebrain/model.json'],
    routes: ['GET /api/neurons', 'POST /api/zip-loop/run', 'POST /api/zip-loop/file'],
    needs: ENGINE, tests: [v('test/core/onebrain-front-door.test.ts'), v('test/core/zip-halt.test.ts'), n('test/platform/engine.test.mjs')],
  },
  {
    id: 'skills', title: 'Skills', description: 'Net-skills and prompting skills the mesh routes to; install, switch and publish.',
    implementation: ['models && skills/core/net-skill-mesh.ts', 'models && skills/core/prompting-skill-store.ts'],
    routes: ['GET /api/net-skills', 'POST /api/net-skills/switch', 'GET /api/prompting-skills', 'POST /api/prompting-skills/install'],
    needs: ENGINE, tests: [v('test/core/net-skill-store.test.ts'), v('test/core/prompting-skills.test.ts')],
  },
  {
    id: 'plugins', title: 'Plugins', description: 'Tool plugins the agent can call (research, calendar, files, tasks...).',
    implementation: ['plugins/index.ts', 'plugin_manager/registry.ts'],
    routes: ['GET /api/plugins'],
    needs: ENGINE, tests: [v('test/core/tool-neurons-chat.test.ts'), n('test/platform/engine.test.mjs')],
  },
  {
    id: 'extensions', title: 'Extensions', description: 'Extension Builder: build, train, register and publish extensions.',
    implementation: ['extension-builder', 'extension_system'],
    routes: ['GET /api/extension/list', 'POST /api/extension/build', 'POST /api/extension/register'],
    needs: ENGINE, tests: [v('test/core/extension-system.test.ts'), v('test/core/extensions-security.test.ts')],
  },
  {
    id: 'store', title: 'Store', description: 'Browse, install, update and publish skills, plugins and files.',
    implementation: ['models && skills/core/store.ts', 'models && skills/core/store-install.ts'],
    routes: ['GET /api/store', 'POST /api/store/install', 'POST /api/store/uninstall'],
    needs: ENGINE, tests: [v('test/core/store-install.test.ts')], needsNetwork: true,
  },
  {
    id: 'wiki', title: 'Wiki', description: 'Shared knowledge pages anyone can read and add to.',
    implementation: ['models && skills/core/wiki-store.ts', 'plugins/wiki.ts'],
    routes: ['GET /api/wiki', 'POST /api/wiki'],
    needs: ENGINE, tests: [v('test/core/wiki-ux.test.ts'), v('test/core/wiki-security.test.ts')],
  },
  {
    id: 'web-search', title: 'Web search', description: 'Search through an open-source SearXNG instance you run.',
    implementation: ['plugins/searxng.ts', 'plugins/research.ts'],
    routes: [],
    needs: [['localEngine'], ['remoteEngine']], tests: [v('test/core/searxng.test.ts')], needsNetwork: true,
  },
  {
    id: 'settings', title: 'Settings', description: 'Appearance, chat, updates, remote access password, computer access, safety, data and about, in one persistent page.',
    implementation: ['interface/platform/settings-store.ts', 'interface/platform/settings-page.ts', 'interface/platform/routes.ts'],
    routes: ['GET /api/app-settings', 'POST /api/app-settings', 'GET /settings'],
    needs: ENGINE, tests: [n('test/platform/settings.test.mjs'), n('test/platform/mobile-ui.test.mjs')],
  },
  {
    id: 'computer-access', title: 'Computer access', description: 'Per-capability grants and master switches for what the agent may do on a computer.',
    implementation: ['models && skills/core/access-settings.ts', 'models && skills/core/access-manager.ts'],
    routes: ['GET /api/access', 'POST /api/access/switch', 'POST /api/access/capability'],
    needs: [['localEngine']], tests: [v('test/core/access-switches.test.ts'), n('test/platform/settings.test.mjs')],
  },
  {
    id: 'safety', title: 'Tool safety and approvals', description: 'Ask-first tools, approvals, auto-continue limits.',
    implementation: ['models && skills/core/tool-safety.ts', 'interface/safety-routes.ts'],
    routes: ['GET /api/safety', 'POST /api/safety/tools'],
    needs: [['localEngine']], tests: [v('test/core/safety-routes.test.ts'), v('test/core/tool-safety.test.ts')],
  },
  {
    id: 'remote-access', title: 'Remote access password', description: 'Password that guards the server from other devices.',
    implementation: ['models && skills/core/remote-access.ts'],
    routes: ['GET /api/auth/status', 'POST /api/auth/password', 'POST /api/auth/login'],
    needs: [['localEngine']], tests: [v('test/core/remote-access.test.ts')],
  },
  {
    id: 'accounts', title: 'Accounts', description: 'Admin and user accounts with separate data.',
    implementation: ['models && skills/core/accounts.ts', 'interface/accounts-routes.ts', 'interface/accounts-page.ts'],
    routes: ['GET /accounts'],
    needs: [['localEngine']], tests: [v('test/core/accounts.test.ts'), v('test/core/accounts-routes.test.ts')],
  },
  {
    id: 'commons', title: 'Commons', description: 'Points, leaderboard, projects and the hive.',
    implementation: ['interface/commons-routes.ts', 'interface/commons-page.ts'],
    routes: ['GET /commons'],
    needs: [['localEngine']], tests: [v('test/core/commons-routes.test.ts')],
  },
  {
    id: 'self-improvement', title: 'Self-improvement', description: 'Background agents that tune and create skills on this computer.',
    implementation: ['scripts/self-improve.mjs', 'scripts/skill-agent.mjs'],
    routes: ['GET /api/self-improvement/server-status', 'POST /api/self-improvement/server/start', 'POST /api/self-improvement/server/stop'],
    needs: [['localEngine', 'backgroundService']], tests: [v('test/core/self-improvement-server.test.ts')],
  },
  {
    id: 'desktop-control', title: 'Desktop control', description: 'See and drive windows through the OS (X11, Windows automation).',
    implementation: ['models && skills/core/desktop-control.ts', 'plugins/desktop.ts'],
    routes: ['GET /api/apps/list'],
    needs: [['localEngine', 'desktopControl']], tests: [v('test/core/desktop-control.test.ts')],
  },
  {
    id: 'phone-sync', title: 'Phone sync', description: 'Phone apps sync conversations, photos and learned examples with the server.',
    implementation: ['mobile/brain/src/index.ts', 'interface/web-server.ts'],
    routes: ['POST /api/phone-sync'],
    needs: [['remoteEngine']], tests: [v('test/core/phone-brain.test.ts')], onlyOn: ['android', 'ios'],
  },
  {
    id: 'mobile-apps', title: 'Phone apps', description: 'Native Android and iOS apps: on-phone brain, setup screen, and the shared interface (home chat and Settings) in a web view.',
    implementation: ['mobile/android/app/src/main/java/ai/neuroclaw/app/WebActivity.kt', 'mobile/android/app/src/main/java/ai/neuroclaw/app/MainActivity.kt', 'mobile/ios/NeuroClaw/WebAppView.swift', 'mobile/ios/NeuroClaw/ContentView.swift'],
    routes: [],
    needs: [['localEngine'], ['remoteEngine']], tests: [n('test/platform/mobile-native.test.mjs'), n('test/platform/mobile-ui.test.mjs')], onlyOn: ['android', 'ios'],
  },
  {
    id: 'desktop-app', title: 'Desktop app (launcher and installers)', description: 'Open from the Start menu, application menu or Dock: starts the bundled engine and shows the interface in its own window.',
    implementation: ['scripts/desktop-launcher.mjs', 'scripts/release/stage-app.mjs', 'scripts/release/app-home.mjs', 'scripts/release/package-linux.mjs', 'scripts/release/package-windows.mjs', 'scripts/release/package-macos.mjs'],
    routes: [],
    needs: [['localEngine', 'installWithoutTerminal']], tests: [n('test/platform/packaging.test.mjs')], onlyOn: ['windows', 'linux', 'macos'],
  },
  {
    id: 'ai-os', title: 'AI OS mode (start with the computer)', description: 'Makes the engine part of the computer\'s sign-in, so the AI is running before any window is opened: a systemd user service or autostart entry on Linux, a LaunchAgent on macOS, a hidden per-user startup script on Windows. Per-user, undone with one switch, and it grants the agent no extra access. Also adds an assistant entry point where the OS has one to offer: a Start menu shortcut with a Ctrl+Alt+N hotkey on Windows, an application-menu entry and a GNOME Ctrl+Alt+N shortcut on Debian and other Linux. It cannot replace Copilot or Siri, which those systems do not allow.',
    implementation: ['interface/platform/ai-os.ts', 'interface/platform/routes.ts', 'interface/platform/settings-page.ts', 'scripts/ai-os.mjs'],
    routes: ['GET /api/ai-os', 'POST /api/ai-os'],
    needs: [['localEngine', 'backgroundService']], tests: [n('test/platform/ai-os.test.mjs')], onlyOn: ['windows', 'linux', 'macos'],
  },
  {
    id: 'system-assistant', title: 'Default digital assistant (Android)', description: 'NeuroClaw can be chosen under Settings > Default apps > Digital assistant app, the role Gemini holds, and then opens as a chat sheet from the power-button long press and the home gesture. Only the person can make the choice; there is no "Hey ..." wake word, which Android reserves for the phone\'s maker.',
    implementation: ['mobile/android/app/src/main/java/ai/neuroclaw/app/AssistantService.kt', 'mobile/android/app/src/main/java/ai/neuroclaw/app/AssistActivity.kt', 'mobile/android/app/src/main/res/xml/voice_interaction_service.xml', 'mobile/android/app/src/main/AndroidManifest.xml'],
    routes: [],
    needs: [['localEngine']], tests: [n('test/platform/mobile-native.test.mjs')], onlyOn: ['android'],
  },
  {
    id: 'source-updates', title: 'Source updates', description: 'For git checkouts: how far behind origin, and a safe fast-forward.',
    implementation: ['models && skills/core/auto-update.ts', 'scripts/update-check.mjs'],
    routes: ['GET /api/updates', 'POST /api/updates/apply'],
    needs: [['localEngine']], tests: [v('test/core/update-check.test.ts')], needsNetwork: true,
  },
  {
    id: 'app-updates', title: 'App update status', description: 'Whether this installed build is current, behind, or could not check, from the signed-off release manifest.',
    implementation: ['interface/platform/update.ts', 'interface/platform/release-manifest.ts', 'interface/platform/routes.ts'],
    routes: ['GET /api/app-update'],
    needs: ENGINE, tests: [n('test/platform/update.test.mjs'), n('test/platform/release-manifest.test.mjs')], needsNetwork: true,
  },
  {
    id: 'pwa', title: 'Installable web app', description: 'Manifest and offline shell so a browser can install the interface.',
    implementation: ['interface/platform/pwa.ts'],
    routes: ['GET /manifest.webmanifest', 'GET /sw.js'],
    needs: ENGINE, tests: [n('test/platform/mobile-ui.test.mjs')],
  },
  {
    id: 'chrome-extension', title: 'Chrome extension launcher', description: 'Toolbar icon (and the Alt+Shift+Y keyboard shortcut, rebindable at chrome://extensions/shortcuts) that checks the server and opens the interface; options page for the server address.',
    implementation: ['browser-extension/manifest.json', 'browser-extension/app.html', 'browser-extension/app.js'],
    routes: [],
    needs: [['remoteEngine']], tests: [n('test/platform/extension.test.mjs')], onlyOn: ['chromeos'],
  },
  {
    id: 'release-pipeline', title: 'Versioning, release manifest, change-driven builds', description: 'One version, one manifest of checksummed artifacts per release, and a build plan that rebuilds only what a change affects.',
    implementation: ['scripts/release/version.mjs', 'scripts/release/manifest.mjs', 'scripts/release/changed-targets.mjs', 'scripts/release/summary.mjs', '.github/workflows/ci.yml'],
    routes: [],
    needs: [['localEngine'], ['remoteEngine']], tests: [n('test/platform/version.test.mjs'), n('test/platform/ci.test.mjs'), n('test/platform/release-manifest.test.mjs')],
  },
  {
    id: 'root-access', title: 'Root / system access', description: 'Linux only, and only one thing: a systemd unit action (status/start/stop/restart/enable/disable) run through pkexec, whose OS authentication dialog is the approval, gated by a deny-by-default allowlist (Settings > Access). Not root shell access and not "complete" root access -- the tool enum\'s other 100+ operations (package install, firewall rules, local accounts, mounting, security policy) all fail closed as not implemented, and Windows and macOS have no privilege-broker adapter at all.',
    implementation: ['models && skills/core/linux-privilege-broker.ts', 'plugins/linux-permission-tools.ts', 'plugins/linux-permission-plugin.ts'],
    routes: ['GET /api/linux-privilege-broker', 'POST /api/linux-privilege-broker'],
    needs: [['localEngine']], tests: [v('test/core/linux-privilege-broker.test.ts')], onlyOn: ['linux'],
  },
  {
    id: 'all-permissions', title: 'All permissions', description: 'A typed confirmation phrase ("give it complete access") turns off every approval hold at once: no tool asks first until it is turned back off. Real and already wired (models && skills/core/tool-safety.ts’s fullAccess flag), shown in Commons > Safety. This is a software-level switch on the approval gate, not an OS permission grant — it does not reach further than the capabilities granted elsewhere (Computer access, Root access).',
    implementation: ['models && skills/core/tool-safety.ts', 'interface/safety-routes.ts', 'interface/commons-page.ts'],
    routes: ['GET /api/safety', 'POST /api/safety/complete-access'],
    needs: [['localEngine']], tests: [v('test/core/safety-routes.test.ts'), v('test/core/tool-safety.test.ts')],
  },
  {
    id: 'system-permissions', title: 'System permissions, multi-desktop, multi-mouse and multi-keyboard', description: 'Every OS-level permission this project has a name for, in one place: Computer access’s switches and per-capability grants (real, everywhere), Root access’s one pkexec-backed operation and 100+ still-unimplemented tool descriptors (Linux only), the agent sandbox’s confinement (real, everywhere), named in-app workspaces (real, everywhere -- see the "Virtual workspaces" row above, not OS-level desktop switching), and telling separate physical mice and keyboards apart by device enumeration only -- real on Linux, Windows and macOS (reading each OS\'s own device list; never the live input stream, which would be a keylogger), still not possible on ChromeOS, Android or iOS. Shown here as one bundle so the gap is visible in the same place as what is real, rather than only in prose; the capability matrix below has the same facts broken out per platform (systemPermissions, multiDesktop, multiMouse, multiKeyboard).',
    implementation: ['models && skills/core/access-manager.ts', 'models && skills/core/access-settings.ts', 'models && skills/core/linux-privilege-broker.ts', 'models && skills/core/danger-protocol.ts', 'interface/platform/adapters.ts'],
    routes: ['GET /api/access', 'GET /api/linux-privilege-broker', 'GET /api/agent'],
    needs: [['systemPermissions']], tests: [v('test/core/access-switches.test.ts'), v('test/core/linux-privilege-broker.test.ts'), v('test/core/agent-protocol.test.ts')],
  },
  {
    id: 'terminal', title: 'Terminal', description: 'A tool the agent can use to run shell commands on this device and read back their output, gated by the same ask-first/approval system as every other risky tool and with a best-effort guardrail against the most common catastrophic accidents (it is a sandboxed shell-command tool, not an open terminal emulator and not a path to extra privileges beyond the agent\'s own).',
    implementation: ['plugins/terminal.ts'],
    routes: [],
    needs: [['localEngine']], tests: [v('test/core/tool-neurons.test.ts'), v('test/core/risky-gate-regression.test.ts')],
  },
  {
    id: 'workspaces', title: 'Virtual workspaces', description: 'Named, in-app workspaces that group chat threads so a person running several conversations at once can switch between named contexts -- a software grouping inside the shared interface, not OS-level virtual desktop switching, which no platform exposes to this app.',
    implementation: ['models && skills/core/workspace-store.ts'],
    routes: ['GET /api/workspaces', 'POST /api/workspaces', 'POST /api/workspaces/:id/rename', 'POST /api/workspaces/:id/activate', 'POST /api/workspaces/:id/threads', 'DELETE /api/workspaces/:id'],
    needs: ENGINE, tests: [v('test/core/workspace-store.test.ts')],
  },
  {
    id: 'agent-sandbox', title: 'Agent sandbox, with a tamper trap', description: 'Confines the agent to its own folder; forced on automatically once its danger level reaches "wary", and switchable by hand at any time. A decoy "disable the alignment protocol" switch is planted in the agent’s folder and connected to nothing; touching it (by a tool, a script, or the agent’s own writes) counts as tampering and moves the danger level, checked before every tool call and on a timer.',
    implementation: ['models && skills/core/danger-protocol.ts', 'interface/agent-routes.ts', 'interface/commons-page.ts', 'interface/web-server.ts'],
    routes: ['GET /api/agent', 'POST /api/agent/sandbox'],
    needs: [['localEngine']], tests: [v('test/core/agent-protocol.test.ts'), v('test/core/agent-routes.test.ts')],
  },
  {
    id: 'escape-warning', title: 'Sandbox escape warning', description: 'A successful escape (the decoy trap tripping) used to only move a number in a file nobody was looking at. Now it logs a loud console banner, writes a record outside the agent’s own folder that survives the agent being deleted and is not cleared by forgive() or time passing, pushes a real OS notification where the notifications plugin is active, and shows an unmissable banner on every page (not just Commons) until a person acknowledges it.',
    implementation: ['models && skills/core/agent-profile.ts', 'models && skills/core/danger-protocol.ts', 'interface/web-server.ts', 'interface/agent-routes.ts', 'interface/ambient.ts', 'interface/commons-page.ts'],
    routes: ['GET /api/agent/escape-warning', 'POST /api/agent/escape-warning/acknowledge'],
    needs: [['localEngine']], tests: [v('test/core/agent-protocol.test.ts')],
  },
  {
    id: 'self-healing', title: 'Self-healing', description: 'Checks registered components (the plugin registry, the hive’s trust-budget invariant) on a timer; repairs in place, reverts to a known-good snapshot if a repair does not hold, and reports anything it cannot fix. Every step is logged and the log is readable later, not just at the moment of a heal.',
    implementation: ['models && skills/core/self-healer.ts', 'src/index.ts', 'interface/web-server.ts', 'interface/commons-page.ts'],
    routes: ['GET /api/health', 'POST /api/health/heal', 'GET /api/health/log'],
    needs: [['localEngine']], tests: [v('test/core/self-healer.test.ts')],
  },
  {
    id: 'hive-mind', title: 'Hive mind', description: 'A project’s own multi-agent team: starts as one AI, adds variants of itself when it decides it needs help, decides everything by vote, clones agents that do well and deletes ones that keep failing, and averages what the last ones learned into the shared network rather than swapping it in. Checks only AI work; a person’s hand-in is checked by a person. Its trust-budget invariant is one of self-healing’s two registered components.',
    implementation: ['models && skills/core/hive-mind.ts', 'models && skills/core/hive-learning.ts', 'models && skills/core/hive-background.ts', 'plugins/hive.ts', 'interface/commons-routes.ts', 'interface/commons-page.ts'],
    routes: ['GET /api/commons/projects/:id/hive', 'POST /api/commons/projects/:id/hive/run', 'POST /api/commons/projects/:id/hive/merge'],
    needs: [['localEngine']], tests: [v('test/core/project-hive.test.ts'), v('test/core/hive-learning.test.ts'), v('test/core/hive-background.test.ts'), v('test/core/hive-plugin.test.ts')],
  },
  {
    id: 'ai-monitor', title: 'AI monitor (judge agent)', description: 'A separate agent reads a held, middle-risk tool request and answers RUN or DENY; anything unclear, or a high-risk tool unless a second switch is on, still waits for you. Turning it off is manual mode: every held call waits for a person.',
    implementation: ['models && skills/core/tool-safety.ts', 'interface/commons-page.ts'],
    routes: ['POST /api/safety/judge'],
    needs: [['localEngine']], tests: [v('test/core/agent-judge.test.ts')],
  },
  {
    id: 'alignment-protocol', title: 'Alignment protocol (kill switch)', description: 'A danger level that moves only on what the agent does on its own; reaching "malicious" deletes the agent’s file and sandbox if the protocol is armed. A manual "delete the agent now" button fires it immediately, armed or not.',
    implementation: ['models && skills/core/danger-protocol.ts', 'models && skills/core/alignment-veto.ts', 'interface/agent-routes.ts', 'interface/commons-page.ts'],
    routes: ['GET /api/agent', 'POST /api/agent/alignment', 'POST /api/agent/delete', 'POST /api/agent/create'],
    needs: [['localEngine']], tests: [v('test/core/agent-protocol.test.ts'), v('test/core/agent-judge.test.ts')],
  },
];

export type SupportVia = { status: Support; via: CapabilityId[] | null; reason: string };

/** How well a platform supports a feature: the best of its alternatives, each limited by its weakest capability. */
export function featureSupport(feature: Feature, platform: PlatformId): SupportVia {
  if (feature.onlyOn && !feature.onlyOn.includes(platform)) {
    return { status: 'unavailable', via: null, reason: `Not applicable: this feature belongs to ${feature.onlyOn.join(', ')}.` };
  }
  const caps = ADAPTERS[platform].capabilities;
  const rank: Record<Support, number> = { unavailable: 0, limited: 1, supported: 2 };
  let best: SupportVia | null = null;
  for (const set of feature.needs) {
    let status: Support = 'supported';
    let reason = '';
    for (const c of set) {
      const r = caps[c];
      if (rank[r.status] < rank[status]) status = r.status;
      if (r.status !== 'supported' && !reason) reason = `${c}: ${r.note}`;
    }
    if (!best || rank[status] > rank[best.status]) best = { status, via: set, reason };
  }
  return best ?? { status: 'unavailable', via: null, reason: 'no requirements listed' };
}

export function parityMatrix(): Array<{ feature: Feature; support: Record<PlatformId, SupportVia> }> {
  return FEATURES.map((feature) => ({
    feature,
    support: Object.fromEntries(PLATFORM_IDS.map((p) => [p, featureSupport(feature, p)])) as Record<PlatformId, SupportVia>,
  }));
}

export interface ContractProblem { feature: string; problem: string }

/** Everything the file system can confirm. Empty list means the contract matches the tree. */
export function verifyContract(root: string, features: Feature[] = FEATURES): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const serverSources = ['interface/web-server.ts', 'interface/safety-routes.ts', 'interface/accounts-routes.ts', 'interface/commons-routes.ts', 'interface/agent-routes.ts', 'interface/platform/routes.ts', 'interface/platform/pwa.ts']
    .map((f) => path.join(root, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const ids = new Set<string>();
  for (const f of features) {
    if (ids.has(f.id)) problems.push({ feature: f.id, problem: 'duplicate feature id' });
    ids.add(f.id);
    if (f.tests.length === 0) problems.push({ feature: f.id, problem: 'no tests listed' });
    if (f.implementation.length === 0) problems.push({ feature: f.id, problem: 'no implementation listed' });
    for (const file of f.implementation) if (!existsSync(path.join(root, file))) problems.push({ feature: f.id, problem: `implementation file missing: ${file}` });
    for (const t of f.tests) if (!existsSync(path.join(root, t.file))) problems.push({ feature: f.id, problem: `test file missing: ${t.file}` });
    for (const r of f.routes) {
      const [method, route] = r.split(' ');
      // Page routes and exact API routes are written as `pathname === '/x'`; groups as startsWith or a regex.
      const exact = `'${route}'`;
      const exactDq = `"${route}"`;
      const prefixLiteral = route.replace(/\/[^/]*$/, '');
      const found = serverSources.includes(exact) || serverSources.includes(exactDq) || serverSources.includes('`' + route + '`') || (route.includes('/:') && serverSources.includes(prefixLiteral));
      if (!found) problems.push({ feature: f.id, problem: `route not found in server source: ${r}` });
      if (!['GET', 'POST', 'DELETE', 'PUT', 'PATCH'].includes(method)) problems.push({ feature: f.id, problem: `bad method in route: ${r}` });
    }
  }
  return problems;
}
