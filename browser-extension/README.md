# NeuroClaw for Chrome and Chromebook

One click on the toolbar icon opens your NeuroClaw. The extension finds your NeuroClaw server, says plainly what it
found, and opens the interface (the home chat and Settings) in a tab.

**What this is not:** the NeuroClaw engine does not run inside a Chrome extension. A browser extension cannot start a
program, run Node.js, or read arbitrary files, and this one does not pretend to. It connects to a NeuroClaw server
that is running somewhere you control:

| Where the server runs | Address to use | Notes |
| --- | --- | --- |
| This computer (Windows, macOS, Linux) with the NeuroClaw desktop app open | `http://localhost:7861` (the default) | Nothing to set up. |
| A Chromebook's own Linux container | `http://localhost:7861` | Chrome reaches the container as localhost. Turn on Linux in Settings > Developers, then open the NeuroClaw `.deb` from the Files app and choose Install (no terminal). Open *NeuroClaw* from the Linux apps in the launcher; it starts the engine and opens the page in Chrome. Use the `arm64` package on ARM Chromebooks, `x64` on Intel/AMD. Not tested on a real Chromebook yet. |
| Another computer on your network | `http://192.168.1.20:7861` (its address) | Set a Remote Access password on that server first (Settings > Remote access). Chrome asks permission to talk to that one address, once. |

A server on another computer is reached over plain `http://` unless you put it behind HTTPS yourself; on a home network that is
usual, but the Remote Access password is then sent unencrypted on that network, so use an `https://` address for anything
beyond your own home.

## Install

**From the Chrome Web Store** (once it is published, which needs the maintainer's Chrome developer account and the
one-time registration fee; the repository cannot do that for you): open the listing, press *Add to Chrome*. Chrome
then keeps the extension up to date by itself, on Chromebooks too.

**Without the store (developer mode)**, which works today:

1. Get `neuroclaw-chrome-extension-<version>.zip` from the release page, or build it: `node scripts/release/build-extension.mjs`.
2. Unzip it.
3. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, choose the unzipped folder.
4. Pin the NeuroClaw icon. Click it.

Developer-mode extensions do not update themselves; install the next release the same way. Chrome may show a
"disable developer mode extensions" notice on start-up; that is Chrome's, and goes away once the store version is used.
(Some managed Chromebooks, for example school devices, block both routes; that is the administrator's setting.)

## What it asks for, and why

| Permission | Why |
| --- | --- |
| `storage` | Remember the server address. |
| `clipboardWrite` | The *Random idea* page copies an idea before opening the chat. |
| Access to `localhost` and `127.0.0.1` | To check that your local server is running. |
| Optional access to one other address | Only if you type a server on another computer, and only after Chrome asks you. |

It has no content scripts: it never reads or changes the pages you browse. It loads no code from the internet.
Nothing is sent anywhere except to the server address you chose.

## Pages

- `app.html`: the launcher. Connects, then opens your server. `app.html?stay=1` keeps this page open to show the status.
- `options.html`: the server address (also reachable from the launcher and from *Extension options*).
- `popup.html`: *Random idea*, the older "Chance" feature (built-in ideas are in `ideas.json`, kept in sync with
  `src/lib/chance-ideas.json`). Reached from the launcher; it opens your server's chat with the idea copied.

## Build and test

```
node scripts/build-backend.mjs                     # once, so icons can be checked
node scripts/release/make-icons.mjs                # regenerate icons/ (the cord around the sphere, drawn in code)
node scripts/release/build-extension.mjs           # release-artifacts/neuroclaw-chrome-extension-<version>.zip
node --test test/platform/extension.test.mjs       # includes loading it in a real Chromium
```

`ambient.css` / `ambient.js` are generated copies of the shared look (`node scripts/sync-ambient.mjs`); a test fails
if they drift. The version comes from `package.json` (`node scripts/release/version.mjs sync`).
