# System Access

The AI has controlled access to the terminal and file system, and runs its own virtual desktop, keyboard, and mouse so it doesn't fight the user for control of the real ones — the design notes' "Full System Access."

## Overview

**Purpose**: Let the AI actually act on the local machine (run commands, use the file system, control a UI) without a human having to relay every action manually, while never colliding with what the user is doing on their own desktop.

**File**: `interface/system-access.js` (JS-only module; no `.ts` source has ever existed here) — `SystemAccess`

```typescript
const access = new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
access.executeCommand('ls -la', { timeout: 5000, cwd: '/some/path' });
access.hasMultiDesktopSupport();   // is a second workspace actually available on this host?
access.hasVirtualInputSupport();   // can it create its own pointer/keyboard?
access.isLinuxGNOME();             // multi-desktop is GNOME-specific today
access.getMultiDesktop();          // -> MultiDesktopManager, see below
```

`interface/main.ts`'s composition root does construct one `SystemAccess` and thread it through both the CLI and the web backend's `NeuroclawRunner` — but `executeCommand()` itself is not gated by the alignment veto at all: it's a bare `execSync()` call with no `AlignmentVeto` reference anywhere in the file. It also has no live caller today beyond its own `validateCapabilities()` self-check (`this.executeCommand('echo test')`); neither the CLI nor `NeuroclawRunner` calls it for a real user- or model-issued command — `interface/cli.ts`'s own comment on this notes that only `getMultiDesktop()` is actually exercised on the live path. If real shell-command execution is wired up in the future, it does not currently route through the alignment veto (see [[Privacy]]) — that gate would need to be added at the call site, the same way `AlignmentVeto.evaluate()` is already used elsewhere (e.g. `pipeline.ts`).

## Multiple desktops, keyboards, and mice

**File**: `interface/multi-desktop.ts` — `MultiDesktopManager`

```typescript
const mdm = access.getMultiDesktop();
mdm.isGnomeAvailable();          // gsettings probe, real local command, no external call
mdm.hasXinput();  mdm.hasUinput();
mdm.createAiVirtualPointer();    // xinput create-master — the AI's own mouse
mdm.createAiVirtualKeyboard();   // the AI's own keyboard
mdm.getAiWorkspace();  mdm.focusAiDesktop();
mdm.listDesktops();  mdm.getDesktopCount();
```

Virtual desktop management is genuinely powered by GNOME's own tooling — `gsettings` for workspace count, `xinput create-master` for a second, independent pointer/keyboard pair. This is a real local-command implementation, not a simulation: `isExtensionAvailable()` / `isGnomeAvailable()` / `hasXinput()` / `hasUinput()` probe the actual host before anything claims multi-desktop or virtual-input support is present, so the system degrades honestly (reports unavailable) on a host without GNOME or `xinput`/`uinput`, exactly like the plugin-availability pattern elsewhere in the project (see [[Plugins]]).

## Why this matters

Without a second virtual pointer/keyboard and workspace, an AI acting on "the" desktop would compete with the user's own mouse and keyboard input — every AI-driven click or keystroke would land wherever the user's cursor happened to be. `createAiVirtualPointer()` / `createAiVirtualKeyboard()` give the AI its own independent input devices, and `getAiWorkspace()` / `focusAiDesktop()` give it its own workspace to act in, so the two never interfere.

## Verifying it

`npm test` (`test/smoke.mjs`)'s `App bootstrap` suite exercises `SystemAccess` through the real `bootstrap()` composition root: confirms the CLI actually carries a live `SystemAccess` instance (not `undefined`), and that `getSystemInfo()`/`validateCapabilities()` are genuinely reachable and surfaced through the CLI's `status` command — not just constructed and left unused. `MultiDesktopManager` itself does not yet have direct unit coverage in `test/smoke.mjs`; its own honest-degrade probes (`isGnomeAvailable()`/`hasXinput()`/`hasUinput()`) are currently only exercised indirectly, through the CLI's `status`/`desktop` commands during manual use.

## See Also

- [[Home]] - Main wiki page
- [[Privacy]] - `executeCommand()`'s shell access has no live caller yet and is not currently gated by the alignment veto
- [[Plugins]] - The same honest-unavailable-on-this-host pattern used throughout

---

*Full system access, with the AI given its own desktop instead of borrowing the user's.*
