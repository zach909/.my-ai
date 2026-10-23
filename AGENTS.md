# NO THIRD-PARTY CODE (standing rule from the owner; read this first)

The owner has said this many times and it must never need saying again.

- **Never add third-party code of any kind.** No npm, pip or cargo packages; no vendored or cloned source; no SDKs, CLIs, apps or models; no `npm install <pkg>` or `pip install` to make something work, not even "just to test". Write it with Node built-ins, the Python standard library, and this project's own modules.
- **If a task seems to need third-party code, stop and ask.** Do not pick a library and add it. Do not add a dependency to get past a failing step.
- **The only exceptions are ones the owner named:** web search through an open-source SearXNG instance, and an Ollama model reached over HTTP. Both are services the owner runs; nothing from them is vendored or imported. Everything else needs a fresh yes.
- **No tokenizer.** Text, audio, and images all enter the mesh as the raw bits they are through the Zip Loop. Do not add word or subword tokenizers, outside embeddings, or speech-to-text (no Whisper, Vosk, Wispr Flow or similar).
- **Check before claiming.** Before saying something is or is not third-party, or is or is not in the repo, look at the files. Do not describe code from memory.
- **This rule is enforced, not just written down.** `node scripts/check-no-third-party.mjs` (also `npm run check:third-party`) fails on any package outside `.third-party-allowlist.json`, any lockfile or manifest for another package manager, vendored folders, jars and archives, imports of anything that is not a Node/Python/platform built-in, bundled or minified code, other people's licence or copyright banners, `uses:` actions outside the allow-list, and `npm install <pkg>` / `pip install` / `npx <pkg>` / `git clone` / `git submodule` / `curl | sh` commands. It runs in the git pre-commit and pre-push hooks (`.githooks/`, set up by `npm install`), in CI (`.github/workflows/no-third-party.yml`), in the test suite (`test/core/no-third-party.test.ts`), and as Claude Code hooks (`.claude/settings.json`, `.claude/hooks/block-third-party.mjs`) that stop the assistant before it installs or pastes anything and before it finishes with third-party code left in the repo. Only the owner may edit the guard files or the allow-list (`CODEOWNERS`, and the hook refuses edits to them). If the check fails, remove the third-party code; do not widen the allow-list, add an exemption, or use `--no-verify`. The check cannot see a plain function pasted from a website with no banner, so that part stays on whoever writes the code.
- Already present and not to be added to: `typescript`, `@types/node` and `vitest` as build and test tools. Known leftovers still to be removed: `torch` imports in `model && skills manager/neurolang.py` and the `torch`, `numpy`, `sentencepiece` lines in that folder's `requirements.txt`.

# VISUAL STYLE (standing rule from the owner: this is the look for everything)

The owner chose the look of the terminal page at `/` (`HTML_TEMPLATE` in `interface/web-server.ts`) plus the ring behind it, and wants it on every page and every new page. The code is the source of truth; this is what it currently is. Do not drift from it, and do not restyle a page in another look.

- **Where it lives.** `interface/ambient.ts` holds the shared CSS and the ring drawing. The server adds it to every HTML response (`injectAmbient()`, `/ambient.css`, `/ambient.js`), so a new page gets the ring and background without asking. Pages only need to use the same tokens and shapes below.
- **Palette: soft coral on warm dark, no blue anywhere.** Ground `#110c0e` fading to `#1b1216`. Text `#f8ede9`, dimmed `rgba(248,237,233,.62)`. Accent coral `#ff9a84`, soft `#ffc4b4`, deep `#e8705a`. Lines `rgba(255,228,218,.2)`. Glass fill `rgba(255,240,232,.07-.08)`. Online green `#8fe3a8`, error pink `#ff9aa8`. Never `#4a7dff`, indigo, cyan or any other blue.
- **Everything round and soft.** Panels 32-36px radius, chat bubbles 24px, inputs and buttons fully pill-shaped (999px). No sharp corners, soft deep shadows with a faint coral glow.
- **Surfaces are glass.** Translucent fill, `backdrop-filter: blur(26px) saturate(1.5)`, a 1px line border, a 1px light inner top edge.
- **Buttons are clear glass.** Neutral: `rgba(255,238,230,.07)` with the line border. Primary: coral glass, fill `rgba(255,154,132,.16)`, border `rgba(255,154,132,.5)`, text `#ffc4b4`. Hover: fill `.28`, lift 2px and scale 1.03. Press: scale .95. Spring easing `cubic-bezier(.34,1.56,.64,1)`.
- **Type.** System rounded stack: `ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif`. No web fonts, nothing fetched.
- **The ring.** One continuous coral cord, never separate links, blocks or pins. It is one smooth wave with no corners: six rises and six dips like the crown ring in the owner's model (the clay-render video), never plates or blocks. It is a barrel, not lopsided: top and bottom tips tucked in 10%, the middle eased out 4%. It flips end over end around a glowing sphere in the centre (it does not spin flat about its own axis) with a slow wobble. The centre is a sphere with the agent inside it: a small shoggoth (a many-eyed green mass of tentacles with holes in it, wearing a little yellow smiley face; the owner drew it and asked for it on 2026-10-18; it replaces the earlier plain sphere) drawn with Canvas paths. It is the one thing on the page that is not coral. It is not an image file or an icon. When the alignment protocol removes the agent it crawls out past the ring, the ring breaks into beads and falls, and it vanishes, leaving a hollow sphere and a one-line note. No icon or picture is used as the page icon (the owner tried one and did not like it). One colour. It speeds up while someone types or sends, and leans a little toward the pointer. Drawn with the browser's own Canvas 2D, no 3D library.
- **Motion is smooth.** Ease everything (exponential smoothing, no snapping), springy entrances, drifting coral glow behind. Respect `prefers-reduced-motion`.
- **Stand-alone pages** (the desktop app's `loading.html` and `index.html`, the extension popup, the launcher pages in `scripts/launcher.mjs`, the older pages in `interface/`) cannot be served by the backend, so each loads its own generated copy of the look. After changing `interface/ambient.ts`, run `npx tsc -p tsconfig.backend.json && node scripts/sync-ambient.mjs`; `test/core/ambient-copies.test.ts` fails if a copy has drifted. A page opts in with `<body class="nc-soft">` and can use `nc-glass`, `nc-btn` (`primary`), `nc-input` and `nc-dim` from the same stylesheet. The native phone screens have no colours of their own; the phone shows `/app` in a web view, which already has the look.
- **The built dashboard** (`dist/app`, React tokens) is remapped to the same palette, rounder and see-through, from the same stylesheet.
- **Not allowed:** blue, chunky or blocky links, hard corners, a second ring or competing background on a page, any third-party library or font for the look (see the first section).

# Docker Dev Environment

## What this is
NeuroClaw — a local-first AI agent. The backend is a Node/TypeScript HTTP server (port 7861). The React/Vite frontend's npm packages have been removed from `package.json`, so the dashboard no longer builds or runs; its source under `src/` (routes, components, features) is still in the repo but unused.

## Running it
```
docker compose -f docker-compose.dev.yml up -d
```
- Single `web` service on `node:22-slim`, repo bind-mounted at `/app`.
- `npm run dev` (scripts/dev.mjs) does: tsc backend build → starts the backend and stays up until it exits. It no longer starts Vite. Port and bind address come from `NEUROCLAW_WEB_PORT` (default 7861) and `NEUROCLAW_WEB_HOST` (default 127.0.0.1).
- The only npm packages left are the build and test tools: `typescript`, `@types/node`, `vitest`.
- `NEUROCLAW_AUTO_UPDATE=0` disables the startup git fetch/pull so it never touches the working tree.
- The compose file runs the backend itself on its one port, 7861 (`NEUROCLAW_WEB_HOST=0.0.0.0`), and publishes that same process on the host as both `127.0.0.1:7861` and `127.0.0.1:3000`, so http://localhost:3000 and http://localhost:7861 are the same real backend: `/` terminal page, `/app` dashboard, `/api/*`. No proxy sits in front, because a proxy would make remote clients look like loopback and bypass the backend's password gate. Because the bind is non-loopback, the backend wants a password: set `NEUROCLAW_WEB_PASSWORD`, or open `/login` and enter the setup code printed in `docker compose -f docker-compose.dev.yml logs web`.

## Verifying it works
- With a password set, `GET http://localhost:3000/` (or `:7861`) and `/api/status` (Basic auth) return 200 through compose; `/login` answers without one.
- `npm run lint:types` typechecks the backend; `npx vitest run` runs the tests.

## Secrets
None required. The app is local-first. No external API keys needed to boot.

## Notes / gotchas
- Backend build uses the repo's `.bin/tsc` symlink → needs `node_modules` installed first (the dev script handles this).
- Python `asi_core/` is standalone (stdlib only, empty requirements.txt) and is NOT part of the web runtime.
- Web search needs a SearXNG instance: `NEUROCLAW_SEARXNG_URL`, default `http://127.0.0.1:8080` (see plugins/searxng.ts).

## Hard rule: no third-party models or code for anything the network itself should do
The user has said this many times, explicitly: do not bring in a third-party model,
library, or service to do work that belongs to NeuroClaw's own neural mesh or Zip
Loop. No Whisper, no cloud STT/TTS APIs, no third-party ML packages, nothing
downloaded or `npm install`ed to replace or sit in front of the network's own
reasoning. This is a standing rule, not a one-time answer to one request.
- Voice-to-text buttons use only the OS's own first-party API (Android
  `SpeechRecognizer`, iOS `SFSpeechRecognizer`/`AVAudioEngine` via `Speech`/
  `AVFoundation`) purely to turn speech into a text string in the input box.
  That string then goes through `brain.send(text)` exactly like typed text —
  through the real bit-level Zip Loop, no tokenizer, nothing short-circuited.
- Before adding any new dependency (npm, pip, Gradle, CocoaPods/SPM) ask
  whether it does cognition/understanding work the mesh should be doing
  instead. If so, don't add it — extend the mesh/Zip Loop/skills instead,
  even if that's slower or more work.
- There is no tokenizer anywhere in this repo (`tokenizer.js` was deleted,
  not disabled) and it must stay that way: text is raw bits through
  the Zip Loop everywhere, always.

# PLATFORMS AND RELEASES (one app, many builds; map in `docs/PLATFORMS.md`)

- **One shared UI.** The home chat (`HTML_TEMPLATE` in `interface/web-server.ts`) and Settings (`interface/platform/settings-page.ts`) are served by the engine and shown by every platform (desktop app window, Chrome extension, phone web views). Change them once. Never add a per-platform copy of a page or a feature.
- **Platform differences live in one table:** `interface/platform/adapters.ts` (what each OS can really do, with reasons) and `interface/platform/feature-contract.ts` (every feature, its files, routes and tests; support per platform is derived). A new feature gets an entry; `node --test "test/platform/*.test.mjs"` fails if the entry points at something that is not there. The parity matrix in `docs/PLATFORMS.md` is generated: `node scripts/build-backend.mjs && node scripts/release/parity-matrix.mjs --write`.
- **Settings and config never use `process.cwd()`.** Use `interface/platform/app-paths.ts` (`configFile`, `dataRoot`): a desktop entry, an installed app and a service all start somewhere unwritable. Saves must report failure, never throw into a request and never claim success.
- **One version:** `package.json`. After changing it run `node scripts/release/version.mjs sync` (or `set 1.2.3`); a test fails on drift. Every artifact name, `build-info.json` and the release manifest carry that version and the source commit.
- **Tests:** `node --test "test/platform/*.test.mjs"` (Node's built-in runner; needs `node scripts/build-backend.mjs` first, and a Chrome/Chromium for the browser tests). The older vitest suite needs `vitest` installed and is not run by CI when it is missing; say so rather than counting it.
- **CI** (`.github/workflows/ci.yml`) rebuilds only what a change affects (`scripts/release/changed-targets.mjs`) and its summary reports real job results. Do not make a skipped or failed build look like a pass. Only `actions/checkout` and `actions/upload-artifact` may be used.
- **Signing credentials are never in the repo.** macOS signing and notarisation, Windows signing, Play and App Store publishing run only when the owner configures repository secrets; without them the artifacts are labelled unsigned.
- **Pre-existing violations this work did not fix** (the owner decides): `package.json` and `package-lock.json` still list the React/Vite/three stack; `src/`, `dist/app`, `dist/assets` and a tracked `node_modules/` contain third-party code; `desktop-app/` is an Electron project (the packaged desktop path no longer uses it); `mobile/android/gradle/wrapper` holds a Gradle wrapper jar; the iOS CI job installs `xcodegen` with Homebrew.
