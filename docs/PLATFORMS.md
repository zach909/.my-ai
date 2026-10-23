# NeuroClaw on every platform

One application, one source tree. This document is the map: what is shared, what is platform-specific,
what each platform can really do, how each one is installed and updated, how a change reaches every build,
and what is still unfinished. The two matrices below are generated from `interface/platform/adapters.ts` and
`interface/platform/feature-contract.ts` by `node scripts/release/parity-matrix.mjs --write`, and
`test/platform/adapters.test.mjs` fails when they go stale.

> **House rule that shaped every decision here:** no third-party code (`AGENTS.md`). So there is no Electron,
> Capacitor, React Native or Flutter in the new path. The desktop apps use the engine's own Node runtime plus the
> operating system's own browser engine (Edge/Chrome/Chromium app window, or WebKit on macOS); the phones use
> their own system web views; installers are built with tools each OS ships (`dpkg-deb`, IExpress, `hdiutil`).

## The layers

```
 Shared AI core          models && skills/  plugins/  plugin_manager/  extension_system/  extension-builder/
   (unchanged)           the OneBrain mesh, Zip Loop, memory, skills, plugins -- served by interface/web-server.ts

 Shared application      interface/web-server.ts  HTML_TEMPLATE (home chat)      interface/ambient.ts (the one look)
   layer                 interface/platform/settings-page.ts (/settings)         interface/platform/routes.ts (/api/app-*)
                         interface/platform/settings-store.ts (shared settings)   interface/platform/feature-contract.ts

 Platform adapter        interface/platform/adapters.ts   what each OS can really do, in one table, tested against the tree
   layer                 interface/platform/app-paths.ts  where settings live (never the working directory)

 Platform packaging      browser-extension/            Chrome / ChromeOS            scripts/release/package-linux.mjs   .deb .tar.gz
   layer                 scripts/desktop-launcher.mjs  the double-click launcher    scripts/release/package-windows.mjs .exe .zip
                         mobile/android, mobile/ios    native phone apps            scripts/release/package-macos.mjs   .app .dmg

 Automated delivery      .github/workflows/ci.yml      plan -> verify -> build per platform -> summary -> draft release
   layer                 scripts/release/              version, manifest, changed-targets, summary, smoke-package
```

Everything a person sees is the **same two web pages**, served by the engine: the home chat (`/`) and Settings
(`/settings`). The desktop app shows them in an app window, the Chrome extension opens them, and the phone apps show
them in a web view. Change a page once and every platform shows it the next time it connects; no per-platform copy
exists to edit. Platform code is only the part that has to differ: starting the engine, the window, installation,
and the permissions each OS prompts for.

<!-- parity-matrix:begin -->
| Feature | Windows | Linux | macOS | ChromeOS / Chromebook | Android | iOS |
| --- | --- | --- | --- | --- | --- | --- |
| Chat | yes | yes | yes | yes | yes | yes |
| Chat history | yes | yes | yes | yes | yes | yes |
| Memory | yes | yes | yes | yes | yes | yes |
| Reasoning engine | yes | yes | yes | yes | yes | yes |
| Skills | yes | yes | yes | yes | yes | yes |
| Plugins | yes | yes | yes | yes | yes | yes |
| Extensions | yes | yes | yes | yes | yes | yes |
| Store | yes | yes | yes | yes | yes | yes |
| Wiki | yes | yes | yes | yes | yes | yes |
| Web search | yes | yes | yes | yes | yes | yes |
| Settings | yes | yes | yes | yes | yes | yes |
| Computer access | yes | yes | yes | no | partly | partly |
| Tool safety and approvals | yes | yes | yes | no | partly | partly |
| Remote access password | yes | yes | yes | partly | partly | partly |
| Accounts | yes | yes | yes | partly | partly | partly |
| Commons | yes | yes | yes | partly | partly | partly |
| Self-improvement | yes | yes | yes | no | partly | no |
| Desktop control | partly | partly | no | no | partly | no |
| Phone sync | no | no | no | no | yes | yes |
| Phone apps | no | no | no | no | yes | yes |
| Desktop app (launcher and installers) | yes | yes | yes | no | no | no |
| Source updates | yes | yes | yes | partly | partly | partly |
| App update status | yes | yes | yes | yes | yes | yes |
| Installable web app | yes | yes | yes | yes | yes | yes |
| Chrome extension launcher | no | no | no | yes | no | no |
| Versioning, release manifest, change-driven builds | yes | yes | yes | yes | yes | yes |
<!-- parity-matrix:end -->

<!-- capability-matrix:begin -->
| Capability | Windows | Linux | macOS | ChromeOS / Chromebook | Android | iOS |
| --- | --- | --- | --- | --- | --- | --- |
| localEngine | yes | yes | yes | no | partly | partly |
| remoteEngine | yes | yes | yes | yes | yes | yes |
| offlineChat | yes | yes | yes | no | yes | yes |
| backgroundService | partly | partly | partly | no | partly | no |
| fileAccess | yes | yes | yes | no | partly | partly |
| desktopControl | partly | partly | no | no | partly | no |
| systemTray | no | no | no | no | partly | no |
| notifications | yes | yes | yes | partly | yes | yes |
| voiceInput | partly | partly | partly | partly | yes | yes |
| cameraCapture | partly | partly | partly | partly | yes | yes |
| installWithoutTerminal | yes | yes | yes | yes | partly | no |
| selfUpdate | partly | partly | partly | yes | partly | yes |
<!-- capability-matrix:end -->

`yes` means this repository's code delivers it on that platform today. `partly` and `no` come with the reason in
`interface/platform/adapters.ts` (also shown on the About tab of Settings, per device). A feature that belongs to one kind
of platform (the desktop launcher, the extension, phone sync) is `no` elsewhere because it does not apply there.

## What was wrong (found by running it, not by reading)

| Problem | Root cause | Fix |
| --- | --- | --- |
| **Settings crashed or did not save on Linux** (and any installed or desktop-entry launch) | Computer-access switches, tool-safety and network state were saved to `process.cwd()/config/...`. A desktop entry starts in `$HOME`, an install lives somewhere read-only, a service starts in `/`: `mkdir config` threw `EEXIST`/`EACCES` inside the switch handler and nothing persisted. | Settings now live in the user's data folder (`~/.neuroclaw/config`, `interface/platform/app-paths.ts`); the older checkout copy is still read once so nobody loses their switches. A failed save is reported in plain words and never thrown into the request or shown as saved. Covered by `test/platform/settings.test.mjs` (a working directory the app cannot write, then a restart). |
| **The installed app could not run from a read-only place** | Wiki, store, extension-builder and generated content are also resolved against the working directory. | The launcher runs a per-user, writable copy of the app (`scripts/release/app-home.mjs`): code is replaced on update, your own pages and files are never touched. |
| **Phone and narrow-window layouts overflowed** | The home page's input row had no `min-width: 0` so Send ran off a 360px screen; the page used `100vh` (taller than a phone's visible area); the React Settings page lost its layout under about 420px; Commons, Accounts and the login form were wider than the screen because of grid `min-content`. | Fixed in the page CSS; every page is checked at 360, 390, 768 and 1280px for sideways scroll, tap-target size and console errors (`test/platform/mobile-ui.test.mjs`). |
| **Android controls looked dead** | The address hint said port 3000 (the old dev server; NeuroClaw is on 7861); an address typed without `http://` made every page fail silently; "Open web app" closed its own screen with no message when no address was set; a server that could not be reached showed a blank page; three buttons per row ran off the edge; the chat panel had weight 1 inside a scroll view, so it had **no height**; the web view granted camera and microphone to any origin. | `MainActivity.kt`, `WebActivity.kt`, `Settings.kt` fixed (address normalised, toast and an "unreachable" page with Try again, equal-width rows, a real chat height, permissions only for the chosen server). Opens the shared interface and Settings instead of the legacy dashboard. **These Kotlin edits were not compiled here (no Android SDK); the CI Android job compiles them.** |
| **iOS had the same address and blank-page faults** | `WebAppView` built `base + "/app"` from the raw text. | Address normalised, failures shown, the shared interface and Settings are reachable from a menu. Not compiled here (no Xcode); the CI iOS job compiles it. |
| **The installable web app never installed** | `public/manifest.webmanifest` and `public/sw.js` were never copied into `dist/`, which is all the backend serves, so both answered 404; the manifest also used the old blue. | The backend generates the manifest, icons and an offline shell itself, in the house colours, served without a login (`interface/platform/pwa.ts`). |
| **Slow rendering of the ring on weak devices** | 2304 beads were sorted and drawn every frame at up to 2x pixel density on every device. | The ring now measures its own frame time and draws a quarter as many beads (still one continuous cord) on devices that cannot keep up, starts reduced on touch and low-core devices, and respects the new Reduce motion setting. |
| **`/app` (the old React dashboard) throws when WebGL is missing** | `three`/`react-three-fiber` create a WebGL context with no fallback; Chromebooks, VMs and some phones have none. The page survives behind an error boundary but logs errors, and it draws a second, competing background (the house style forbids that). | **Not fixed**: that bundle cannot be rebuilt (its toolchain is no longer in the repo). Settings, the home chat, Accounts, Commons and Sharing, which are the pages that matter on a phone, no longer depend on it. See "Unfinished". |
| **One version nowhere** | `package.json` said 0.0.0, the home page said 0.1.0, the extension 1.0.0, the desktop project 1.0.0, Android 0.1.0. | `package.json` is the one version; `scripts/release/version.mjs` writes it to the extension, desktop project, Android and iOS projects and a test fails on drift. |
| **Settings did not expose what the app supports** | The old Settings page had Remote Access, a static Brain note, Computer Access and links. | The new page adds appearance, chat, updates (with status), tool safety and approvals, data (export, import, forget everything), accounts and module links, and an honest per-device capability list. |

## Install and update, per platform

| Platform | Artifact | Installs how | Updates how |
| --- | --- | --- | --- |
| Windows | `neuroclaw-<v>-windows-x64.exe` (IExpress), `.zip` | Per-user, no administrator rights; Start menu entry, optional desktop shortcut, listed in Installed apps with an uninstaller | The app (Settings > Updates) tells you when a newer release exists and shows the file and its SHA-256. You run the new installer. It never replaces itself. |
| Linux | `neuroclaw-<v>-linux-x64.deb`, `.tar.gz` | `dpkg -i` or your software centre; menu entry opens it | Same: you install the newer `.deb`. |
| macOS | `NeuroClaw.app` in `neuroclaw-<v>-macos-arm64.dmg` and `.zip` | Drag to Applications; opens from Finder or the Dock | Same: a newer `.dmg`. A signed, notarised release needs Apple credentials (below). |
| ChromeOS / Chrome | `neuroclaw-chrome-extension-<v>.zip` | Chrome Web Store (when published) or Load unpacked | Chrome updates a published extension itself. A developer-mode install does not update. |
| Android | `neuroclaw-<v>-android-any.apk` (debug-signed) | Sideload | Through the store you install from once it is on Google Play. A sideloaded debug APK does not update itself. |
| iOS | simulator build only (CI) | not installable on a device yet | App Store / TestFlight once there is a signed build. |

An installer or `.dmg` never changes itself when the source changes. A new version exists only when the pipeline builds
and publishes it, and each artifact carries its application version, source commit, platform, architecture and channel
(`build-info.json` inside, `release-manifest.json` beside).

## How one source change reaches the builds

```
 push / PR / tag
      |
   plan ----- scripts/release/changed-targets.mjs: which of extension, linux, windows, macos, android, ios does it affect?
      |         shared engine or interface -> desktop packages;  browser-extension/ -> extension;  mobile/android -> android;
      |         mobile/ios -> ios;  package.json, workflows, release scripts -> everything;  docs or tests alone -> nothing
   verify --- version drift, type check, backend build, look and icons in step, node --test "test/platform/*.test.mjs", engine smoke test,
      |         the older vitest suite if vitest is installed (otherwise reported as NOT RUN, never as passed)
      |
   linux | windows | macos | extension | android | ios      (only the affected ones; each starts the packaged app and checks it,
      |                                                      Windows even installs and uninstalls it)
   summary -- one table of what really happened: Built / FAILED / Not rebuilt (unaffected) / Skipped; exit 1 if anything failed
      |
   release -- tags `v<version>` (must equal package.json) or a manual run with "publish": builds EVERYTHING, writes
              release-manifest.json (name, platform, arch, kind, SHA-256, size, signed or unsigned, commit) and SHA256SUMS,
              and creates a **draft** GitHub release. You publish the draft.
```

Releasing: bump the version (`node scripts/release/version.mjs set 0.2.0`), commit, tag `v0.2.0`, push the tag. Nothing is
merged or published without you.

## Secrets and signing you must provide (none are in the repository)

| For | Repository secrets | Without them |
| --- | --- | --- |
| macOS Developer ID signing | `MACOS_CERTIFICATE_P12` (base64), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGN_IDENTITY_NAME` | The app is ad-hoc signed; macOS asks you to confirm opening it. The summary says so. |
| macOS notarisation | `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | Not notarised. |
| Windows code signing | not wired yet (needs a certificate and `signtool`) | Unsigned; SmartScreen warns on first run. The manifest marks it `unsigned`. |
| Chrome Web Store | a Chrome developer account (one-time fee); upload the extension zip | Developer-mode install only. |
| Google Play | a Play account and an upload key (not wired yet) | Debug-signed APK to sideload. |
| App Store / TestFlight | an Apple developer team, certificates and provisioning (not wired yet) | Simulator build only. |

## Limits worth knowing

- A Chrome extension cannot contain or start the engine. On a Chromebook the engine runs in the Linux container (one-time
  terminal step) or on another computer; there is no way around that on ChromeOS.
- The desktop apps run the engine in the OS's own browser engine window: Edge on Windows (preinstalled), Chrome, Chromium,
  Edge or Brave on Linux, WebKit in `NeuroClaw.app` on macOS. If no Chromium-based browser is found on Windows or Linux the
  default browser is used and the engine keeps running until you stop it. The packaged apps have no tray icon, no
  Accessibility or screen-capture permission on macOS, and no Windows UI-automation tools (those exist only in the
  unmaintained Electron project).
- Closing the app window stops the engine the app started (so nothing lingers). If you want your phone to sync with your PC,
  keep the app open.
- iOS cannot run a background server, drive other apps or draw over them; Android only with permissions you grant by hand.
- Speech-to-text is the operating system's, on phones only; nothing is bundled.

## Tests: what ran, what did not

Run them: `npm run test:platform` (builds the backend, then `node --test "test/platform/*.test.mjs"`). Node's built-in runner, no
packages. The browser tests drive a real Chromium over the DevTools protocol (`test/platform/browser.mjs`, about 150 lines);
without Chrome or Chromium they are reported as skipped with the reason, and CI sets `NEUROCLAW_REQUIRE_BROWSER=1` so a
missing browser fails there instead.

| File | What it proves (real behaviour, not file existence) |
| --- | --- |
| `engine.test.mjs` | the real backend starts; chat goes through the engine and returns a reply; plugins, memory, skills, history, store answer |
| `settings.test.mjs` | validation; atomic saves; persistence across a server restart; a failed save is reported and not shown as saved; **the Linux regression** (unwritable working directory); safety settings persist; the page serves at both URLs |
| `mobile-ui.test.mjs` | 11 pages at 360, 390, 768 and 1280px: no sideways scroll, no console errors, tap targets at least 44px on phones; send a chat message and get the engine's reply; navigation by real clicks; tabs by tap and keyboard; a toggle saves, applies and survives reload; a failed save is shown and the switch reverts; update status shows available, current and failed; the manifest, PNG icons and service worker are real |
| `extension.test.mjs` | manifest permissions are the minimum; icons are real PNGs equal to the renderer's output; address handling; the zip is exact and reproducible; **loaded in Chromium**: the service worker runs, the action opens one launcher tab (a second click returns to it), the launcher connects to a live server and opens the real interface, explains an unreachable one, validates a bad address, saves a good one |
| `packaging.test.mjs` | the payload needs no packages; the per-user app copy installs, updates and never touches your files; the packaged engine starts from `/` like a desktop entry, saves, restarts and stops; the launcher reuses a running server, avoids a port held by another program and reports a broken install; **a real `.deb`** (metadata, permissions, no setuid, no service, install script, extracted layout started for real) and `.tar.gz`; the Windows zip and installer scripts (per-user, no elevation, reversible); the macOS bundle and its minimal-privilege host |
| `adapters.test.mjs` | capability claims are checked against the tree (Android voice, overlay and bridge exist; iOS cannot background; the extension has no native messaging); every promised artifact kind has a producer; the feature contract matches files, routes and tests; this document's matrices are current |
| `update.test.mjs`, `release-manifest.test.mjs`, `version.test.mjs` | available, current, ahead, beta not offered to stable, no build for this machine, and nine failure modes; strict manifest schema and real checksums; one version everywhere and drift is named and repaired |
| `ci.test.mjs` | a change triggers exactly the builds it affects; the summary never reports a failed or skipped build as built; the workflow is wired so a failed build cannot be released, only first-party actions are used, secrets are never echoed, and no credential is committed |
| `mobile-native.test.mjs` | the Android and iOS source faults listed above stay fixed (checked as source: no SDK here) |

**Executed in this session (Linux, Node 22, Chromium 141):** all 107 platform tests passed, 0 skipped, in about 130 seconds.
The repository's older engine smoke test (`node test/smoke.mjs`) gives **872 passed, 6 failed**, and the identical 6 fail on
unmodified `main` (a boot-loaded extension recall check, an `[Waiting fo...` JSON parse in two learning checks, and three
self-authored-skill checks), so this work adds no regression there.

**Not executed, and why:**

- The older vitest suite (`test/core/*.test.ts`, about 180 files): `node_modules/vitest/dist` is missing from the repository's
  tracked `node_modules`, and installing it is a package install that the project rules (and this session's permissions) forbid.
  CI runs it when vitest is present and otherwise reports "NOT RUN" in the summary.
- Windows: IExpress installer, Start menu entry, install and uninstall (needs a Windows runner; the CI job does it).
- macOS: `swiftc`, `codesign`, `hdiutil`, the `.app` really opening (needs a Mac; the CI job compiles, signs ad hoc, verifies and starts the packaged engine).
- Android: Gradle build of the edited Kotlin. iOS: `xcodegen` and `xcodebuild` of the edited Swift. (Android SDK and Xcode are not available here.)
- A real Chromebook, a real phone, and the Chrome Web Store flow.
- The GitHub Actions workflow itself has never run: it was linted as YAML and its structure is tested, but the first real run
  may need small fixes (runner images and tool paths are the usual suspects).

## Unfinished, and decisions that are yours

1. **Third-party code that was already in the repo** (AGENTS.md rule), left as found: `package.json` still lists the React,
   Vite and three stack; `src/`, `dist/app`, `dist/assets` and a tracked `node_modules/` hold third-party code;
   `desktop-app/` is an Electron project (no longer used for installers); the Android Gradle wrapper jar; the iOS CI job uses
   Homebrew `xcodegen`. `node scripts/check-no-third-party.mjs` reports tens of thousands of problems because of these, none of
   them added here; every file this work added passes it.
2. **Bundling the Node runtime** into the desktop packages is the one new thing a package carries that is not this repo's code.
   It is the `node` binary of the CI runner for that platform, copied at build time, never committed or downloaded, and it is what
   lets the app start without Node installed. If you would rather require Node, say so and the packagers drop it.
3. **The old React dashboard** (`/app/*`: Store, Extension Builder, Self-improvement UIs) is still the only interface for those
   three features, ships inside the desktop packages, and needs WebGL for its animation. Rebuilding those screens as plain pages
   in the house style is the way to retire it; it was too large to do safely here.
4. **The phone apps' on-phone brain** (`mobile/brain/bundle/neuroclaw-brain.js`) is a committed bundle that cannot be regenerated
   (its build tool is gone), so engine changes reach phones through the server's pages but not through that bundle.
5. **Signing and publishing**: Windows code signing, Google Play, the App Store and TestFlight are not wired (they need your
   certificates and accounts); macOS signing and notarisation are wired but wait for the secrets above.
6. **Intel macOS** is not built (add a `macos-15-intel` job when you want it); **Linux arm64** (ARM Chromebooks) builds only from
   a manual run with "linux_arm64" ticked, because it needs a GitHub-hosted ARM runner.
7. No tray icon, no macOS Accessibility or screen capture, and no Windows UI automation in the packaged desktop apps (see Limits).
8. Settings of the older kind that still live on the legacy dashboard are linked from Settings > More rather than rebuilt.
9. The ring icon and the extension's icon are the cord around the sphere, drawn in code, because the owner's rule is that no
   picture or logo is used. If you want a different mark for the stores, replace `interface/platform/icon.ts`.
