# NeuroClaw Live USB

A bootable USB image: plug it into any PC, boot from it, and NeuroClaw
starts automatically in a fullscreen kiosk window -- no installation, no
setup. An "Install NeuroClaw" button inside the app itself (visible only
when running from this live image) launches a graphical installer to put
it permanently on the machine's own disk, with the option to fully encrypt
that install (LUKS -- the Linux equivalent of BitLocker).

This directory is a [Debian live-build](https://live-team.pages.debian.net/live-manual/)
configuration tree, not a pre-built image. Building the actual `.iso` has
to happen on a real Linux machine with root -- **it cannot be built or
boot-tested from the sandboxed session that generated these files**, which
has no `live-build`/`debootstrap`/loop-device access and no real hardware
to boot on. Everything below is written to be run by you.

## What you get

- **Boot it, and it just runs.** The live session auto-logs in, starts an
  X session running nothing but a single fullscreen Chromium window
  (`--kiosk`), pointed at the real NeuroClaw app. No desktop, no taskbar,
  no login prompt to get past.
- **"Install NeuroClaw" from inside the app.** A button appears in the
  sidebar (bottom, only when running from this live image) that launches
  [Calamares](https://calamares.io/), a graphical installer -- the same
  one Parrot OS itself ships (see `store/wiki/ParrotOSTools.md` in this
  repo). Its normal "erase disk and install" flow includes an **"Encrypt
  system"** checkbox (LUKS) once `cryptsetup` is present, which this image
  installs specifically so that checkbox is there.
- Nothing here modifies the machine you boot it on unless you explicitly
  click Install and complete Calamares' own confirmation steps -- a plain
  boot-and-try is exactly as non-destructive as booting any other live
  Linux USB.

## Prerequisites (on the machine that builds the ISO)

- A real Debian- or Ubuntu-based machine or VM, **with root** (`live-build`
  itself needs it for the chroot/mount work `lb build` does).
- `sudo apt-get install live-build rsync`
- **~20GB+ of free disk** during the build (a full Debian base system, this
  repo's complete `node_modules` including devDependencies -- see "Why
  devDependencies stay installed" below -- the assembled squashfs, and the
  final ISO all exist at once mid-build). The finished ISO itself will
  likely land somewhere in the 3-6GB range.
- A working internet connection (the build fetches a base Debian system
  and every package in `config/package-lists/neuroclaw.list.chroot` from a
  real Debian mirror).
- 20-60+ minutes, depending on your connection and disk speed. This is a
  real OS build, not a quick script.

## Building it

```sh
cd live-usb
sudo ./build.sh
```

This stages a pruned copy of the repo, runs `lb config`, then `lb build`.
When it finishes, look for `live-image-amd64.hybrid.iso` in this
directory.

## Writing it to a USB drive

**Find the right device first -- this step overwrites the ENTIRE drive you
point it at, with no per-partition prompt and no confirmation beyond what
you type yourself.**

```sh
lsblk                     # find your USB drive's device name, e.g. sdb -- NOT sdb1
sudo dd if=live-image-amd64.hybrid.iso of=/dev/sdX bs=4M status=progress conv=fsync
```

Replace `/dev/sdX` with your actual USB device (whole-disk, not a
partition -- `/dev/sdb`, not `/dev/sdb1`). Double- and triple-check this
against `lsblk`'s output before running it. `dd` does not ask "are you
sure" -- pointing it at the wrong device silently destroys whatever was on
it. On macOS, the device path looks like `/dev/rdiskN`; on Windows, use
[Rufus](https://rufus.ie/) or [balenaEtcher](https://www.balena.io/etcher/)
instead of `dd`.

## Boot-testing it

Boot the target machine from the USB (its BIOS/UEFI boot menu -- usually
F12, F10, Esc, or Del at power-on, varies by manufacturer) and confirm:

1. It reaches a fullscreen NeuroClaw window on its own, with no login
   prompt or desktop visible first.
2. The chat actually works (talking to it exercises the real backend, not
   just the frontend shell).
3. The "Install NeuroClaw" button appears in the sidebar and launches
   Calamares.
4. In Calamares' partition step, choosing "erase disk" shows an "Encrypt
   system" option -- **don't actually run a full install through to disk
   on a machine you care about unless you mean to.** Test the flow on a
   spare machine or a disposable VM.

None of this was boot-tested by the session that wrote these files -- it
could not be. Please report back (or just fix it directly) if something
here doesn't come up the way this document says it should; the most
likely failure points are noted below.

## Why :3000, not :7861 -- and why devDependencies stay installed

`interface/web-server.ts`'s own `GET /` serves a bare-bones fallback
terminal page, not the real app (Chats, Pinned Chats, Chat History,
Settings, Store, ...) -- that's served by Vite itself, on :3000, which is
also where `scripts/dev.mjs`'s own proxy config forwards `/api/*` requests
through to the real backend on :7861. `npm run dev` (which
`neuroclaw-dev.service` runs) is the single command that starts both,
together, in the right order -- the exact same thing this repo's own
developers run day to day, not something improvised for this image.

Because that's Vite's **dev** server, not a production static build,
`vite`, `@vitejs/plugin-react`, `tailwindcss`, and the rest of this
project's devDependencies have to stay installed and available in the live
image -- there is no "prune to production" step here the way a normal
deploy would have one. That's the main reason this image is larger than a
minimal live Linux distro.

## Known limits / things to check if something's off

- **Node.js version.** Debian stable's own `nodejs` package can lag behind
  what this project expects. If `config/hooks/live/
  0100-neuroclaw-setup.hook.chroot`'s `npm ci` fails during the build,
  check `node -v` inside the chroot and consider swapping the `nodejs`/
  `npm` entries in `config/package-lists/neuroclaw.list.chroot` for the
  [NodeSource](https://github.com/nodesource/distributions) repository
  instead, added as an extra `lb config` apt source.
- **First boot on very slow hardware.** `npm run dev` runs a `tsc` build
  and Vite's own dependency pre-bundle on every boot (nothing under
  `/opt/neuroclaw` persists between boots on a plain live session) --
  the openbox autostart script waits for `:3000` to actually answer
  before opening chromium, but a very slow machine could still mean a
  longer-than-expected wait before anything appears.
- **Persistence.** This is a plain (non-persistent) live image: chats,
  settings, and anything else written during a session are gone on
  reboot, same as any live Linux USB without a persistence partition set
  up. Adding one is a real, well-documented live-build feature
  (`--union` overlay + a `persistence.conf` on the USB's own free space)
  but is out of scope here -- ask if you want it added.
- **WiFi drivers.** `network-manager` is installed, but some WiFi chipsets
  need proprietary firmware packages (`firmware-iwlwifi`, etc., from
  `non-free-firmware`) that aren't listed here since the specific chipset
  varies by machine. `lb config`'s `--archive-areas` above already
  includes `non-free-firmware`, so add the specific firmware package your
  test hardware needs to `neuroclaw.list.chroot` if WiFi doesn't come up.
