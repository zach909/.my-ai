# System Access

The AI has controlled access to the terminal and file system, and runs its own virtual desktop, keyboard, and mouse so it doesn't fight the user for control of the real ones — the design notes' "Full System Access."

## Overview

**Purpose**: Let the AI actually act on the local machine (run commands, use the file system, control a UI) without a human having to relay every action manually, while never colliding with what the user is doing on their own desktop.

**File**: `interface/system-access.ts` — `SystemAccess`

```typescript
const access = new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
access.executeCommand('ls -la', { timeout: 5000, cwd: '/some/path' });
access.hasMultiDesktopSupport();   // is a second workspace actually available on this host?
access.hasVirtualInputSupport();   // can it create its own pointer/keyboard?
access.isLinuxGNOME();             // multi-desktop is GNOME-specific today
access.getMultiDesktop();          // -> MultiDesktopManager, see below
```

`interface/main.ts`'s composition root constructs one `SystemAccess` and threads it through both the CLI and the web backend's `NeuroclawRunner`, so terminal/file-system actions taken through either interface go through the same gated, veto-checked path (see [[Privacy]] and the alignment veto) rather than a raw shell escape.

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

`npm test` (`test/smoke.mjs`)'s system-control section covers `DesktopEnv` detection (correctly reporting no desktop environment in a headless sandbox), `SystemControlHub` status/window queries, and `KeyboardControl`'s `press_key`/`type_text`/`mouse_move` returning honest booleans rather than pretending to succeed with no real device present.

## See Also

- [[Home]] - Main wiki page
- [[Privacy]] - Why terminal/file-system actions are veto-gated
- [[Plugins]] - The same honest-unavailable-on-this-host pattern used throughout

---

*Full system access, with the AI given its own desktop instead of borrowing the user's.*
