# AI OS mode

Turn the computer you already have into one where the AI is always there. It is not a new operating system and it replaces nothing: the computer is told to start NeuroClaw's engine every time you sign in, so the AI is already running before you open a window, a browser tab or the Chrome extension.

Without it, NeuroClaw runs only while its window is open. With it, the window is just a view onto an engine that is already up.

## Turn it on

- **Settings > AI OS**, the switch "Start NeuroClaw when I sign in". Only the admin, sitting at the computer itself, can change it (it adds a login item to the computer, so it cannot be done over the network).
- **Or in a terminal on the computer:**

      node scripts/ai-os.mjs status
      node scripts/ai-os.mjs enable
      node scripts/ai-os.mjs disable

  `enable` also starts the engine right away if none is running. Add `--json` for machine-readable output.

Turning it on from Settings does **not** start a second copy: the engine you are using keeps running, and the computer starts it from your next sign-in.

## What each system does

| System | How the engine is started at sign-in | If it stops |
|---|---|---|
| Linux with systemd | a user service, `~/.config/systemd/user/neuroclaw.service` | restarted after a failure, gives up after 5 crashes in 5 minutes |
| Linux without a user manager (containers, WSL) | an autostart entry, `~/.config/autostart/neuroclaw-ai-os.desktop` | not restarted |
| macOS | a LaunchAgent, `~/Library/LaunchAgents/ai.neuroclaw.os.plist` | restarted after a failure |
| Windows | a hidden script, started by a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, so no console window flashes at sign-in | not restarted |

Everything is per-user. No administrator rights, no system-wide service, nothing outside your own account. Output goes to `~/.neuroclaw/logs/ai-os.log`.

An installed build starts through its packaged launcher with no window. A source checkout starts `dist/interface/main.js web 7861` directly, with the startup `git pull` switched off, because a background service must never rewrite the folder it runs from.

## The assistant on each system

Turning AI OS mode on also gives you the nearest thing each system allows to "the AI is the assistant". Be clear about the limits: **two of these systems do not let any other app replace their built-in assistant.**

| System | What you get | What you do not get |
|---|---|---|
| **Android** | NeuroClaw can be your **default digital assistant**, the role Gemini holds. Tap "Make NeuroClaw my assistant" on the main screen, then pick it under Digital assistant app. After that the power-button long press and the home gesture open a NeuroClaw chat sheet. | A "Hey ..." wake word (Android reserves hotword detection for the phone's maker). Only you can choose the assistant; the app cannot take the role itself. |
| **Windows** | A "NeuroClaw Assistant" Start menu entry with the hotkey **Ctrl+Alt+N**. | Replacing Copilot. As far as I know Windows lets the Copilot key launch only a packaged Store app, and NeuroClaw is not one; I did not verify that and did not try to work around it, because the only way is a keyboard hook, which is a keylogging primitive this project refuses to build. |
| **macOS** | Nothing new. | Replacing Siri. Apple provides no way for any app to do that. Open NeuroClaw from the Dock or Spotlight, or give the app a shortcut under System Settings > Keyboard > Keyboard Shortcuts > App Shortcuts. |
| **Debian and other Linux** | A "NeuroClaw Assistant" entry in the application menu and search. On **GNOME** (Debian's default desktop) also the shortcut **Ctrl+Alt+N**, added to your custom shortcuts without touching the ones you have. | A shortcut on KDE, XFCE and the rest: set one yourself to the entry's command. |
| **ChromeOS** | Alt+Shift+Y in Chrome opens NeuroClaw through the extension (rebind at `chrome://extensions/shortcuts`; Chrome ignores a combination another app owns). | Replacing Google Assistant. The engine cannot run on ChromeOS itself; run it in the Chromebook's Linux container, which is Debian, and turn AI OS mode on **inside** it. |

If the GNOME shortcut list ever comes back in a format this does not expect, it is left completely alone and the step says so.

## What it does not do

- **It gives the agent no extra access.** Computer access, tool safety and approvals behave exactly as before. This only decides *when the engine starts*.
- **It does not open the engine to the network.** The engine still listens on this computer only. Your phone can reach it only if you have set the server up to listen on the network, which needs a password. Verified by connecting to the machine's external address: refused.
- **It does not add a tray icon, a global hotkey or a shell replacement.** Those need platform-specific permissions the app does not ask for (see `docs/PLATFORMS.md`); they are not part of this.
- **It does not restart the engine after you update the app.** Restart the service (`systemctl --user restart neuroclaw`, or sign out and in) to pick up the new version.

## Undo

Turn the switch off, or run `node scripts/ai-os.mjs disable`. It removes everything it wrote, in both of the Linux ways, so nothing is left behind and the engine is never started twice. A copy that is already running keeps running until it is closed.

If a step cannot be undone (a file you cannot delete), it says which one and does not claim to be off.

## If you develop NeuroClaw from a checkout

While it is on, the service holds port 7861, so `npm run dev` will fail with "address in use". Run `node scripts/ai-os.mjs disable` first.

## What has and has not been verified

| | Verified here | Not verified here |
|---|---|---|
| Linux | the GNOME shortcut logic runs only against a fake `gsettings` (the schema is not installed here), including preserving existing shortcuts and refusing unexpected output; the systemd unit passes `systemd-analyze verify` (with an install path containing spaces, `%`, backticks, `&` and `;`); the autostart `Exec` line round-trips through the Desktop Entry rules; enable and disable run end to end against a throwaway home; the command it starts serves requests and refuses external connections | a real graphical login session; a live `systemctl --user` |
| macOS | the plist is well-formed XML (`xmllint`) with its paths escaped | loading it with `launchctl` on a Mac |
| Android | the manifest, service metadata and sheet are checked as source; **nothing was compiled** (no Android SDK here), the CI Android job is the first compile | running it on a phone; whether a given phone maker's build accepts the assistant launch |
| ChromeOS | the extension loads in Chromium with the new manifest | a Chromebook |
| Windows | the scripts (startup, opener, Start menu shortcut with hotkey) and the `reg` commands are generated with Windows paths and checked as text | running them on a Windows PC |

The capability list in Settings > About therefore calls background service **limited**, not supported, on all three, with this reason.

Tests: `node --test test/platform/ai-os.test.mjs`. Code: `interface/platform/ai-os.ts`, `scripts/ai-os.mjs`.
