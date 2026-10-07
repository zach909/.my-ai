# NO THIRD-PARTY CODE (standing rule from the owner; read this first)

The owner has said this many times and it must never need saying again.

- **Never add third-party code of any kind.** No npm, pip or cargo packages; no vendored or cloned source; no SDKs, CLIs, apps or models; no `npm install <pkg>` or `pip install` to make something work, not even "just to test". Write it with Node built-ins, the Python standard library, and this project's own modules.
- **If a task seems to need third-party code, stop and ask.** Do not pick a library and add it. Do not add a dependency to get past a failing step.
- **The only exceptions are ones the owner named:** web search through an open-source SearXNG instance, and an Ollama model reached over HTTP. Both are services the owner runs; nothing from them is vendored or imported. Everything else needs a fresh yes.
- **No tokenizer.** Text, audio, and images all enter the mesh as the raw bits they are through the Zip Loop. Do not add word or subword tokenizers, outside embeddings, or speech-to-text (no Whisper, Vosk, Wispr Flow or similar).
- **Check before claiming.** Before saying something is or is not third-party, or is or is not in the repo, look at the files. Do not describe code from memory.
- Already present and not to be added to: `typescript`, `@types/node` and `vitest` as build and test tools. Known leftovers still to be removed: `torch` imports in `model && skills manager/neurolang.py` and the `torch`, `numpy`, `sentencepiece` lines in that folder's `requirements.txt`.

# VISUAL STYLE (standing rule from the owner: this is the look for everything)

The owner chose the look of the terminal page at `/` (`HTML_TEMPLATE` in `interface/web-server.ts`) plus the ring behind it, and wants it on every page and every new page. The code is the source of truth; this is what it currently is. Do not drift from it, and do not restyle a page in another look.

- **Where it lives.** `interface/ambient.ts` holds the shared CSS and the ring drawing. The server adds it to every HTML response (`injectAmbient()`, `/ambient.css`, `/ambient.js`), so a new page gets the ring and background without asking. Pages only need to use the same tokens and shapes below.
- **Palette: soft coral on warm dark, no blue anywhere.** Ground `#110c0e` fading to `#1b1216`. Text `#f8ede9`, dimmed `rgba(248,237,233,.62)`. Accent coral `#ff9a84`, soft `#ffc4b4`, deep `#e8705a`. Lines `rgba(255,228,218,.2)`. Glass fill `rgba(255,240,232,.07-.08)`. Online green `#8fe3a8`, error pink `#ff9aa8`. Never `#4a7dff`, indigo, cyan or any other blue.
- **Everything round and soft.** Panels 32-36px radius, chat bubbles 24px, inputs and buttons fully pill-shaped (999px). No sharp corners, soft deep shadows with a faint coral glow.
- **Surfaces are glass.** Translucent fill, `backdrop-filter: blur(26px) saturate(1.5)`, a 1px line border, a 1px light inner top edge.
- **Buttons are clear glass.** Neutral: `rgba(255,238,230,.07)` with the line border. Primary: coral glass, fill `rgba(255,154,132,.16)`, border `rgba(255,154,132,.5)`, text `#ffc4b4`. Hover: fill `.28`, lift 2px and scale 1.03. Press: scale .95. Spring easing `cubic-bezier(.34,1.56,.64,1)`.
- **Type.** System rounded stack: `ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif`. No web fonts, nothing fetched.
- **The ring.** One continuous coral cord, never separate links, blocks or pins. It is one smooth wave with no corners: six rises and six dips like the crown ring in the owner's model (the clay-render video), never plates or blocks. It is a barrel, not lopsided: top and bottom tips tucked in 10%, the middle eased out 4%. It flips end over end through a glowing sphere in the centre (it does not spin flat about its own axis) with a slow wobble. One colour. It speeds up while someone types or sends, and leans a little toward the pointer. Drawn with the browser's own Canvas 2D, no 3D library.
- **Motion is smooth.** Ease everything (exponential smoothing, no snapping), springy entrances, drifting coral glow behind. Respect `prefers-reduced-motion`.
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
- `npm run dev` (scripts/dev.mjs) does: tsc backend build → starts backend on 127.0.0.1:7861 and stays up until it exits. It no longer starts Vite.
- The only npm packages left are the build and test tools: `typescript`, `@types/node`, `vitest`.
- `NEUROCLAW_AUTO_UPDATE=0` disables the startup git fetch/pull so it never touches the working tree.
- The compose file still publishes port 3000 for the old frontend (nothing listens there now) and does not publish 7861. The backend binds 127.0.0.1 inside the container, so reach it from inside, e.g. `docker compose -f docker-compose.dev.yml exec web curl -s http://127.0.0.1:7861/api/status`. `CHOKIDAR_USEPOLLING` is also unused now.

## Verifying it works
- Inside the container, `GET http://127.0.0.1:7861/` and `/api/status` return 200 (checked with `npm run dev`).
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
