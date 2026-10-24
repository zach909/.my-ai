/**
 * Platform adapters.
 *
 * The shared application asks one question of the operating system: "what can
 * you actually do?". Each adapter answers it for one platform, honestly. Shared
 * code never branches on the OS name; it asks `adapter.capabilities` and shows
 * the reason when something is unavailable. That keeps the six builds one app:
 * everything that differs lives in this table, in the platform packaging, or in
 * the native code of the phone apps.
 *
 * "supported" means the capability is delivered by this repository's code on
 * that platform today. "limited" means partly (with the reason in `note`).
 * "unavailable" means the platform does not allow it (or this repo does not
 * implement it) and `note` says which, plus the alternative if there is one.
 *
 * Capability status is part of the contract tested in
 * test/platform/adapters.test.mjs: that file also checks the claims that can be
 * checked from here (for example that a platform claiming a native app has one
 * in the tree).
 */

export type PlatformId = 'windows' | 'linux' | 'macos' | 'chromeos' | 'android' | 'ios';
export type RuntimeKind = 'node' | 'browser' | 'native-app';
export type Support = 'supported' | 'limited' | 'unavailable';

export const PLATFORM_IDS: readonly PlatformId[] = ['windows', 'linux', 'macos', 'chromeos', 'android', 'ios'];

export const CAPABILITY_IDS = [
  'localEngine',        // the OneBrain engine runs on this device
  'remoteEngine',       // can use an engine running elsewhere
  'offlineChat',        // chat works with no network
  'backgroundService',  // the engine can keep running while the app is closed
  'fileAccess',         // agent can read/write files the user allows
  'desktopControl',     // agent can see and drive other apps' windows
  'systemTray',         // tray / menu-bar presence
  'notifications',      // OS notifications
  'voiceInput',         // OS speech-to-text into the input box
  'cameraCapture',      // photo capture to the engine
  'installWithoutTerminal', // a normal installer or store install exists
  'selfUpdate',         // how updates arrive (see UpdateMechanism)
  'multiSeatInput',      // telling separate physical mice/keyboards apart, or multiple independent virtual desktops
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilityReport { status: Support; note: string }

export type UpdateMechanism =
  | 'chrome-web-store'   // ChromeOS / Chrome: the browser updates the extension
  | 'play-store'
  | 'app-store'
  | 'manual-download'    // the app tells you a new version exists; you run the installer
  | 'package-manager';   // distro package

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  /** Where the shared UI runs on this platform. */
  uiHost: string;
  /** Where the engine runs. */
  engineHost: string;
  runtime: RuntimeKind;
  updateMechanism: UpdateMechanism;
  /** Artifact kinds the release pipeline produces for this platform. */
  artifacts: string[];
  capabilities: Record<CapabilityId, CapabilityReport>;
}

const ok = (note = ''): CapabilityReport => ({ status: 'supported', note });
const some = (note: string): CapabilityReport => ({ status: 'limited', note });
const no = (note: string): CapabilityReport => ({ status: 'unavailable', note });

const desktopCommon = {
  localEngine: ok('The engine runs on this computer inside the app\'s own Node runtime.'),
  remoteEngine: ok('Point the app at another NeuroClaw server in Settings > Connection.'),
  offlineChat: ok('OneBrain answers with no network. Web search and the store need one.'),
  backgroundService: some('Runs while the app window is closed only if the app is left running; there is no system service.'),
  fileAccess: ok('Through Computer Access: off until you grant a folder.'),
  notifications: ok(),
  voiceInput: some('No speech-to-text is bundled; type, or use the OS dictation shortcut.'),
  cameraCapture: some('Through the browser window\'s camera permission prompt.'),
  installWithoutTerminal: ok('Double-click installer or app bundle.'),
  multiSeatInput: no('Not built: the UI runs in one browser window, which the OS gives one merged mouse/keyboard input stream for, with no standard way to tell which physical device an event came from. Separate virtual desktops/workspaces inside the app are not built either.'),
} as const;

export const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  windows: {
    id: 'windows', label: 'Windows', uiHost: 'Edge app window (preinstalled WebView host)', engineHost: 'bundled Node runtime on this PC',
    runtime: 'node', updateMechanism: 'manual-download', artifacts: ['windows-installer-exe', 'windows-zip'],
    capabilities: {
      ...desktopCommon,
      desktopControl: no('No Windows UI Automation tools are wired into the packaged launcher.'),
      systemTray: no('The launcher opens a window; there is no tray icon.'),
      selfUpdate: some('The app reports a newer release and links to the installer. It never replaces itself silently.'),
    },
  },
  linux: {
    id: 'linux', label: 'Linux', uiHost: 'Chromium/Chrome app window, else the default browser', engineHost: 'bundled Node runtime on this computer',
    runtime: 'node', updateMechanism: 'manual-download', artifacts: ['linux-deb', 'linux-tarball'],
    capabilities: {
      ...desktopCommon,
      desktopControl: some('X11 tools and Linux permission tools exist; Wayland sessions restrict what any app may see or drive.'),
      systemTray: no('The launcher opens a window; there is no tray icon.'),
      selfUpdate: some('The app reports a newer release; install the new .deb or tarball yourself.'),
    },
  },
  macos: {
    id: 'macos', label: 'macOS', uiHost: 'WKWebView window in NeuroClaw.app', engineHost: 'bundled Node runtime inside NeuroClaw.app',
    runtime: 'node', updateMechanism: 'manual-download', artifacts: ['macos-app-zip', 'macos-dmg'],
    capabilities: {
      ...desktopCommon,
      desktopControl: no('The packaged app asks for no Accessibility or Screen Recording permission.'),
      systemTray: no('No menu-bar item; open the app from the Dock.'),
      selfUpdate: some('Reports a newer release and links to the .dmg. Signed, notarised updates need the maintainer\'s Apple credentials, which this repo does not hold.'),
    },
  },
  chromeos: {
    id: 'chromeos', label: 'ChromeOS / Chromebook', uiHost: 'Chrome (extension page and installed web app)', engineHost: 'a NeuroClaw server elsewhere: another computer, or the Linux container on the Chromebook',
    runtime: 'browser', updateMechanism: 'chrome-web-store', artifacts: ['chrome-extension-zip'],
    capabilities: {
      localEngine: no('A Chrome extension cannot run the Node engine or start a process. Run the server in the Chromebook\'s Linux container or on another computer.'),
      remoteEngine: ok('The extension connects to the server you name (default http://localhost:7861, which reaches the Linux container).'),
      offlineChat: no('Needs a reachable server. The interface itself opens offline from cache; chat does not.'),
      backgroundService: no('Extensions cannot host the engine.'),
      fileAccess: no('Chrome gives extensions no arbitrary file access.'),
      desktopControl: no('Not possible from a browser.'),
      systemTray: no('Only the toolbar icon.'),
      notifications: some('Browser notifications after you allow them.'),
      voiceInput: some('Chrome\'s own dictation; no speech-to-text is bundled.'),
      cameraCapture: some('Browser camera permission prompt.'),
      installWithoutTerminal: ok('Install the extension from the Chrome Web Store (once published) or load the zip in developer mode. Starting the server on the Chromebook needs the Linux container.'),
      selfUpdate: ok('Chrome updates published extensions itself.'),
      multiSeatInput: no('A browser extension has no access to raw input devices and no concept of a second virtual desktop.'),
    },
  },
  android: {
    id: 'android', label: 'Android', uiHost: 'Native app (Kotlin) with a WebView for the shared UI', engineHost: 'the app\'s own on-phone network (mobile/brain bundle)',
    runtime: 'native-app', updateMechanism: 'play-store', artifacts: ['android-apk'],
    capabilities: {
      localEngine: some('The phone runs the bundled brain (about 100 KB), not the full desktop engine.'),
      remoteEngine: ok('Sync with, and open the web app of, a NeuroClaw server on your network.'),
      offlineChat: ok('The on-phone network answers with no connection.'),
      backgroundService: some('Android limits background work. The overlay and bridge services run only while enabled by the user.'),
      fileAccess: some('Scoped storage and the permissions you grant.'),
      desktopControl: some('Accessibility-service bridge, off until enabled in Android settings; acts only in NeuroClaw\'s own windows.'),
      systemTray: some('Floating bubble needs the "display over other apps" permission.'),
      notifications: ok(),
      voiceInput: ok('Android SpeechRecognizer feeds text into the input box.'),
      cameraCapture: ok(),
      installWithoutTerminal: some('CI produces a debug APK; Play Store publishing needs the maintainer\'s signing key and Play account.'),
      selfUpdate: some('Through the store you installed from. A debug APK does not update itself.'),
      multiSeatInput: no('Not built. Some Android devices support a second connected display or a DeX-style desktop mode, but this app does nothing with it, and Android gives apps no way to distinguish two physical keyboards or mice either.'),
    },
  },
  ios: {
    id: 'ios', label: 'iOS', uiHost: 'Native app (SwiftUI) with WKWebView for the shared UI', engineHost: 'the app\'s own on-phone network (mobile/brain bundle)',
    runtime: 'native-app', updateMechanism: 'app-store', artifacts: ['ios-simulator-app'],
    capabilities: {
      localEngine: some('The phone runs the bundled brain, not the full desktop engine.'),
      remoteEngine: ok('Sync with, and open the web app of, a NeuroClaw server on your network.'),
      offlineChat: ok('The on-phone network answers with no connection.'),
      backgroundService: no('iOS does not allow an app to keep a server running in the background.'),
      fileAccess: some('Only what the file picker and photo picker hand the app.'),
      desktopControl: no('iOS gives apps no way to see or drive other apps.'),
      systemTray: no('No overlays on iOS.'),
      notifications: ok(),
      voiceInput: ok('SFSpeechRecognizer feeds text into the input box.'),
      cameraCapture: ok(),
      installWithoutTerminal: no('CI builds an unsigned simulator app only. A device build needs an Apple developer team, signing certificates and TestFlight/App Store.'),
      selfUpdate: ok('The App Store updates it, once published.'),
      multiSeatInput: no('Not built, and iOS gives an app no way to tell two Bluetooth keyboards or trackpads apart or to run a second independent desktop.'),
    },
  },
};

/**
 * Pick the platform from what the running environment says about itself.
 * Server side this is the Node process; client side the same function is given
 * a user-agent. Both feed the same table.
 */
export function detectPlatform(input: { nodePlatform?: string; userAgent?: string } = {}): PlatformId {
  const ua = input.userAgent ?? '';
  if (ua) {
    if (/\bCrOS\b/.test(ua)) return 'chromeos';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
    if (/Linux|X11/i.test(ua)) return 'linux';
  }
  switch (input.nodePlatform ?? process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    case 'android': return 'android';
    default: return 'linux';
  }
}

export function adapterFor(id: PlatformId): PlatformAdapter {
  return ADAPTERS[id];
}

/** What the shared UI needs to render a capability list for one platform. */
export function describeCapabilities(id: PlatformId): Array<{ id: CapabilityId; status: Support; note: string }> {
  return CAPABILITY_IDS.map((c) => ({ id: c, ...ADAPTERS[id].capabilities[c] }));
}
