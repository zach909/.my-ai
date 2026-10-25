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
| Linux | the systemd unit passes `systemd-analyze verify` (with an install path containing spaces, `%`, backticks, `&` and `;`); the autostart `Exec` line round-trips through the Desktop Entry rules; enable and disable run end to end against a throwaway home; the command it starts serves requests and refuses external connections | a real graphical login session; a live `systemctl --user` |
| macOS | the plist is well-formed XML (`xmllint`) with its paths escaped | loading it with `launchctl` on a Mac |
| Windows | the script and the `reg` commands are generated with Windows paths and checked as text | running them on a Windows PC |

The capability list in Settings > About therefore calls background service **limited**, not supported, on all three, with this reason.

Tests: `node --test test/platform/ai-os.test.mjs`. Code: `interface/platform/ai-os.ts`, `scripts/ai-os.mjs`.
