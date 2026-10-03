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
- Web search needs a SearXNG instance: `NEUROCLAW_SEARXNG_URL`, default `http://127.0.0.1:8080` (see docs/BACKROOM.md and plugins/searxng.ts).
