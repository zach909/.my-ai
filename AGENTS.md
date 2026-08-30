# Base44 Dev Environment

## What this is
NeuroClaw — a local-first AI agent. Frontend is TanStack Start (React) + Vite (port 3000); backend is a Node/TypeScript HTTP server (port 7861). Both are started by a single command.

## Running it
```
docker compose -f docker-compose.base44.yml up -d
```
- Single `web` service on `node:22-slim`, repo bind-mounted at `/app`.
- `npm run dev` (scripts/dev.mjs) does: tsc backend build → starts backend on 127.0.0.1:7861 → starts Vite on 0.0.0.0:3000.
- Vite proxies `/api/*` to the backend (single-origin; no CORS/cookie config needed).
- First boot runs `npm install` (large dep tree incl. three.js); subsequent restarts reuse `node_modules` in the bind mount.
- `NEUROCLAW_AUTO_UPDATE=0` disables the startup git fetch/pull so it never touches the working tree.
- `CHOKIDAR_USEPOLLING=true` enables HMR under the bind mount.

## Verifying it works
- `curl -sL -H "Host: external-preview.example.com" http://localhost:3000/` → 200, redirects `/` → `/app` (Dashboard).
- Served frontend is live source (unhashed `/src/index.css`), not a prebuilt bundle.
- Vite config already sets `server.host: true` + `allowedHosts: true`, so the preview's external hostname is accepted.

## Secrets
None required. The app is local-first; the Blink SDK (`@blinkdotnew/sdk`) ships hardcoded defaults. No external API keys needed to boot.

## Notes / gotchas
- Backend build uses the repo's `.bin/tsc` symlink → needs `node_modules` installed first (the dev script handles this).
- `/` is a 307 redirect to `/app`; health check must follow redirects.
- Python `asi_core/` is standalone (stdlib only, empty requirements.txt) and is NOT part of the web runtime.
