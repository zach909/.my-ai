# NeuroClaw — Deployment Guide

How to run NeuroClaw, the local-first agent built on the OneBrain neural mesh engine (`models && skills/core/onebrain.ts`). There is no model checkpoint to train or load: the network is the mesh itself, and it is built, grown, and saved by the app and the Extension Builder.

> **History:** an earlier version of this guide covered the TinyGPT transformer track (`train_at_scale.py`, `chat.py`, `core.py`, GPU training, a `tinygpt/` package). That track was removed. Its instructions no longer work, so they were dropped here rather than kept as a trap.

## Requirements

- **Node.js** 22 or newer (the dev container uses `node:22-slim`).
- **Disk**: the first `npm install` pulls a large dependency tree (including three.js). Later runs reuse `node_modules`.
- **No GPU, no API keys, no secrets.** The app is local-first and boots without any external service.
- Python is optional. `asi_core/` (stdlib only) is a standalone reference implementation and is not part of the web runtime. `model && skills manager/` holds the NeuroLang DSL/runtime and some legacy files (see the root README).

## Development

```bash
npm install
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) compiles the backend with `tsc`, starts it on `127.0.0.1:7861`, then starts Vite on `0.0.0.0:3000`. Vite proxies `/api/*` to the backend, so the browser talks to a single origin. Open http://localhost:3000, which redirects `/` to `/app`.

### Docker

```bash
docker compose -f docker-compose.dev.yml up -d
```

A single `web` service on `node:22-slim` with the repo bind-mounted at `/app`. First boot runs `npm install`.

- `NEUROCLAW_AUTO_UPDATE=0` disables the startup git fetch/pull so the working tree is never touched.
- `CHOKIDAR_USEPOLLING=true` enables hot reload under a bind mount.

## Production server

```bash
npm run server
```

`scripts/server.mjs` builds and starts the production backend, prints a read-only startup resource diagnostic and an update check, and launches the autonomous background agents alongside it (self-improvement loop, skill-creation agent, skill-drill agent, conversation-learning agent, peer-sync listener). All of them are torn down together when the server exits.

### Start on demand

```bash
npm run launch
```

`scripts/launcher.mjs` is a tiny process meant to be left running (for example, started at login) on the backend's port. It does nothing until the first request, then answers with a "Starting…" page, frees the port, and spawns `scripts/server.mjs` detached.

### Always-on with systemd

```ini
[Unit]
Description=NeuroClaw
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/repo
ExecStart=/usr/bin/npm run server
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Adjust `User`, `WorkingDirectory`, and the `npm` path for your machine, then `systemctl daemon-reload && systemctl enable --now <unit>`. Logs: `journalctl -u <unit> -f`.

## Static build

```bash
npm run build
```

Runs `vite build` then `scripts/finalize-static-build.mjs`. `npm run build:phone-brain` builds the phone-sized brain from `mobile/brain/`.

## Desktop app and live USB

- `desktop-app/` — Electron wrapper for macOS, Windows, and Debian. See its README.
- `live-usb/` — Debian live-build configuration for a bootable NeuroClaw image.

## Verifying

```bash
npm test                 # smoke + vitest integration + install-script test
npm run lint             # types, eslint, stylelint
npm run bench            # OneBrain hyperdimensional and mesh benchmarks (needs bun)
```

Health check for a running dev server (it must follow redirects):

```bash
curl -sL http://localhost:3000/ -o /dev/null -w '%{http_code}\n'   # expect 200
```

## Troubleshooting

- **`tsc` not found on first run**: the backend build uses the repo's `.bin/tsc` symlink, which needs `node_modules` installed first. `npm run dev` handles this; if you compiled by hand, run `npm install` first.
- **Hot reload not firing in Docker**: set `CHOKIDAR_USEPOLLING=true`.
- **Working tree changed unexpectedly at startup**: the startup update check can pull. Set `NEUROCLAW_AUTO_UPDATE=0`.
- **Health check returns 307**: `/` redirects to `/app`. Follow redirects (`curl -L`).

## References

- [Root README](../README.md) — overview and repository layout
- [Neural mesh design](NEURAL_MESH_DESIGN.md) — the all-to-all mesh spec
- [Extension Builder spec](EXTENSION_BUILDER_SPEC.md) — teaching the mesh new skills
- [Architecture](ARCHITECTURE.md) — subsystem reference and change log
