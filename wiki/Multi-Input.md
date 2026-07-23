# Multi-Input Support

The system supports multiple desktops, multiple keyboards, and multiple mice specifically to prevent conflicts with the user's own desktop session — the design notes' requirement under [[System-Access]], covered here in more depth because "don't interfere with the user's input" is a binding problem, not just a device-creation one.

## Overview

**Purpose**: Give the AI's virtual input devices their own identity and desktop binding, so an action it takes never lands on the user's screen or steals their cursor.

**File**: `interface/multi-desktop.ts` (`MultiDesktopManager`) — same module as [[System-Access]], this page covers `VirtualDevice` and `DeviceBinding` specifically.

## Virtual devices

```typescript
interface VirtualDevice {
  id: string;
  type: 'keyboard' | 'mouse';
  name: string;
  created: number;
  masterId?: number;   // xinput master device id, only when backed by a real xinput device
}
```

`createAiVirtualPointer()` and `createAiVirtualKeyboard()` (see [[System-Access]]) each produce one of these. `masterId` is only populated when `xinput create-master` actually succeeded on the host — if `xinput` isn't available, the device object still exists (so calling code doesn't have to special-case it) but honestly carries no backing hardware id, matching the project-wide pattern of failing clean rather than pretending.

## Device bindings

```typescript
interface DeviceBinding {
  deviceId: string;
  desktopId: string;
  mode: 'exclusive' | 'shared';
}

mdm.getVirtualDevices();  // every device the AI has created
mdm.getAllBindings();     // which desktop each one is bound to, and how
```

A binding is what actually prevents interference: a device bound `'exclusive'` to the AI's own desktop (`getAiWorkspace()`) never delivers or receives events on the user's desktop, while `'shared'` mode is available for cases where the AI is deliberately acting on the user's visible session (with the alignment veto's user-approval gate — see [[Privacy]] — in front of anything that visible).

## Why exclusivity matters here specifically

Creating a second virtual mouse and keyboard solves half the problem; without desktop-level exclusivity, both real and virtual devices would still generate events into the same GNOME session, and a fast AI-driven sequence of clicks/keystrokes could easily interleave with whatever the user is doing at that exact moment. Binding the AI's devices to their own workspace (`focusAiDesktop()`) closes that race entirely — the two input streams are physically separated at the desktop level, not just logically distinguished by device id.

## Verifying it

`npm test` (`test/smoke.mjs`)'s `App bootstrap` suite exercises `SystemAccess`/`MultiDesktopManager` only indirectly today, through `getMultiDesktop()` and the CLI's `printStatus()` command. `MultiDesktopManager` itself — `VirtualDevice`/`DeviceBinding` creation, `getVirtualDevices()`/`getAllBindings()`, desktop exclusivity — does not yet have direct unit coverage in `test/smoke.mjs`.

## See Also

- [[Home]] - Main wiki page
- [[System-Access]] - The broader terminal/file-system/desktop access this device binding supports
- [[Privacy]] - Why a shared-mode action still needs explicit approval

---

*Two independent input streams, exclusively bound to two independent desktops — the mechanism, not just the devices, that keeps the AI from fighting the user for the mouse.*
