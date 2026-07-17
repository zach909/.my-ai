# Platform Support

The AI runs locally on macOS, Windows, and Linux — the design notes' "Runs on Your Machine."

## Overview

**Purpose**: Cross-platform local operation with no external APIs, and honest degradation where a platform-specific capability (like GNOME's virtual desktops — see [[System-Access]]) isn't available.

## How platform detection actually works

`interface/system-access.ts`'s `SystemAccess.getOSType()` and `isLinuxGNOME()` are the real entry points — capabilities that depend on the host platform are probed at runtime, not assumed:

- **Multi-desktop / virtual input** ([[System-Access]], [[Multi-Input]]): GNOME-specific (`gsettings`, `xinput`), so `hasMultiDesktopSupport()` / `hasVirtualInputSupport()` honestly report unavailable on Windows, macOS, or a non-GNOME Linux desktop, rather than silently no-op'ing.
- **Plugins** ([[Plugins]]): each local-service plugin's `available()` probe is platform-aware where it needs to be (e.g. a hardware/OS service that simply doesn't exist on the current host reports unavailable, cleanly).
- **The Python core** (`model && skills manager/`): pure Python + PyTorch, portable across all three platforms as-is; `tinygpt/utils.py`'s `resolve_device()` picks `cuda`/`mps`/`cpu` based on what's actually present, so the same training/inference code runs on an Nvidia GPU (Linux/Windows), Apple Silicon (macOS, via `mps`), or CPU-only, honoring the request but falling back gracefully.

## What's genuinely platform-independent

Everything that doesn't touch OS-specific desktop/input APIs — the mesh itself ([[Neuron-Mesh]]), [[NeuroLang]], the [[Builder]], [[Empathy-Engine]], [[RLM]], [[Privacy]]'s encryption, and the browser backend (`interface/server.py`) — runs identically on all three platforms, since none of it depends on anything beyond the Python/Node standard toolchains.

## See Also

- [[Home]] - Main wiki page
- [[System-Access]] - The platform-specific capabilities (GNOME multi-desktop) and their honest-unavailable fallback
- [[Privacy]] - Why nothing here needs a platform-specific external service to work

---

*Cross-platform by not depending on platform-specific behaviour anywhere it doesn't have to — and by admitting honestly where it does.*
