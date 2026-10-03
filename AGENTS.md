# NO THIRD-PARTY CODE (standing rule from the owner; read this first)

The owner has said this many times and it must never need saying again.

- **Never add third-party code of any kind.** No npm, pip or cargo packages; no vendored or cloned source; no SDKs, CLIs, apps or models; no `npm install <pkg>` or `pip install` to make something work, not even "just to test". Write it with Node built-ins, the Python standard library, and this project's own modules.
- **If a task seems to need third-party code, stop and ask.** Do not pick a library and add it. Do not add a dependency to get past a failing step.
- **The only exceptions are ones the owner named:** web search through an open-source SearXNG instance, and an Ollama model reached over HTTP. Both are services the owner runs; nothing from them is vendored or imported. Everything else needs a fresh yes.
- **No tokenizer.** Text enters the mesh as its UTF-8 bytes through the Zip Loop, and audio and images enter as the bits they already are. Do not add word or subword tokenizers, outside embeddings, or speech-to-text (no Whisper, Vosk, Wispr Flow or similar).
- **Check before claiming.** Before saying something is or is not third-party, or is or is not in the repo, look at the files. Do not describe code from memory.
- Already present and not to be added to: `typescript`, `@types/node` and `vitest` as build and test tools. Known leftovers still to be removed: `torch` imports in `model && skills manager/neurolang.py` and the `torch`, `numpy`, `sentencepiece` lines in that folder's `requirements.txt`.

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
  through the real byte-level Zip Loop, no tokenizer, nothing short-circuited.
- Before adding any new dependency (npm, pip, Gradle, CocoaPods/SPM) ask
  whether it does cognition/understanding work the mesh should be doing
  instead. If so, don't add it — extend the mesh/Zip Loop/skills instead,
  even if that's slower or more work.
- There is no tokenizer anywhere in this repo (`tokenizer.js` was deleted,
  not disabled) and it must stay that way: text is raw UTF-8 bytes through
  the Zip Loop everywhere, always.
