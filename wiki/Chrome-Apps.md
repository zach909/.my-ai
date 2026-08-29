# Chrome Apps

The system uses Chrome applications to connect with supported local services — the design notes' "Background — Chrome Applications": additional local data sources and system capabilities, registered the same way any other plugin is.

## Overview

**Purpose**: Treat a locally-installed Chrome app as a supplementary local data source/service, without ever making an external network call to do it.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `plugins/browser.ts` — `BrowserPlugin` | Registers, connects, and reads data from local Chrome apps as `ChromeAppConfig` entries |

## `BrowserPlugin`'s Chrome app registry (TypeScript)

```typescript
plugin.registerChromeApp(config);          // register (install) a Chrome app as a local service
await plugin.connectChromeApp(id);         // connect so its local data becomes available
plugin.isChromeAppConnected(id);
plugin.listChromeApps();
```

A handful of commonly-available local Chrome apps are seeded by default (`registerDefaultChromeApps()`), and any configured with `autoConnect: true` connect automatically at construction — matching "provides additional data sources and system capabilities" without requiring the user to manually wire each one up.

## `ChromeAppsPlugin` (Python)

This connector detects a locally-installed Chrome/Chromium binary and reports the command needed to launch a local app — it does **not** open a network connection itself; launching is left to the gated action layer (see [[Privacy]]), consistent with the project-wide plugin pattern (see [[Plugins]]): a real local capability where one exists, an honest "not available on this host" where it doesn't.

## Verifying it

`npm test` (`test/smoke.mjs`)'s "Chrome Apps" section covers the default-seeded catalog, `autoConnect` firing on registration, connect-on-demand, reading local data/permissions from a connected app, and disconnecting — plus confirming the browser plugin declines plain conversation so it doesn't hijack ordinary chat into a web search (a real fixed bug from this project's history). `python test_core.py`'s `test_local_plugins` covers the Python connector probing locally without opening any connection.

## See Also

- [[Home]] - Main wiki page
- [[Plugins]] - The local-service-or-honest-failure pattern this follows
- [[Privacy]] - Why launching an app still routes through the gated action layer

---

*A Chrome app becomes another local data source the same way any plugin does — registered, probed honestly, never phoning out on its own.*
