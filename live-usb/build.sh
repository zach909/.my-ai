#!/bin/bash
# live-usb/build.sh -- builds the bootable, installable NeuroClaw live USB
# image. Run this ON THE MACHINE THAT WILL ACTUALLY BUILD THE ISO (a real
# Debian/Ubuntu box or VM with root -- see README.md's prerequisites), NOT
# inside whatever sandbox generated these config files: that environment
# has no live-build/debootstrap/xorriso installed, no loop-device access,
# and no way to boot-test the result on real hardware regardless.
#
# What this does, in order:
#   1. Stages a pruned copy of the repo into config/includes.chroot/opt/
#      neuroclaw/ -- excludes .git, node_modules, dist, build artifacts,
#      and extension-builder's own vendored reference trees (PyTorch/,
#      Moby/, CMUDict/, DebianInstaller/ -- hundreds of MB of unrelated
#      third-party source this app's runtime never touches). None of that
#      exclusion is guesswork: it's the same live vite.config.ts already
#      excludes from its own dev-server file watcher for the same reason
#      (see that file's own `ignored` list).
#   2. `lb config` -- configures a Debian live-build tree for a hybrid
#      (BIOS + UEFI) bootable ISO.
#   3. `lb build` -- actually builds it. This downloads a base Debian
#      system, installs live-usb/config/package-lists/neuroclaw.list.chroot's
#      packages into it, runs config/hooks/live/0100-neuroclaw-setup.hook.chroot
#      (npm ci + a first build) inside that chroot, then assembles the
#      squashfs + ISO. Expect this to take a while (a real network fetch of
#      a base system plus `npm ci` and a `tsc` build) and a genuinely large
#      amount of free disk (see README.md).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
STAGE_DIR="$HERE/config/includes.chroot/opt/neuroclaw"

if [ "$EUID" -ne 0 ]; then
  echo "This must run as root (live-build itself requires it for the chroot/mount work lb build does)." >&2
  echo "Try: sudo $0" >&2
  exit 1
fi

if ! command -v lb >/dev/null 2>&1; then
  echo "live-build (the 'lb' command) is not installed." >&2
  echo "On Debian/Ubuntu: sudo apt-get install live-build" >&2
  exit 1
fi

echo "[build.sh] staging a pruned copy of the repo into $STAGE_DIR ..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.vite-out/' \
  --exclude '.claude/' \
  --exclude 'live-usb/' \
  --exclude 'desktop-app/node_modules/' \
  --exclude 'desktop-app/dist/' \
  --exclude 'extension-builder/PyTorch/' \
  --exclude 'extension-builder/Moby/' \
  --exclude 'extension-builder/CMUDict/' \
  --exclude 'extension-builder/DebianInstaller/' \
  --exclude 'test/' \
  --exclude 'tests/' \
  --exclude '__pycache__/' \
  --exclude '.pytest_cache/' \
  --exclude '.mypy_cache/' \
  "$REPO_ROOT/" "$STAGE_DIR/"
echo "[build.sh] staged $(du -sh "$STAGE_DIR" | cut -f1)."

cd "$HERE"

echo "[build.sh] lb config..."
lb config \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --debian-installer live \
  --archive-areas "main contrib non-free non-free-firmware"

echo "[build.sh] lb build (this takes a while)..."
lb build

echo
echo "[build.sh] done. Look for a live-image-amd64.hybrid.iso in $HERE."
echo "Write it to a USB drive with, e.g.:"
echo "  sudo dd if=live-image-amd64.hybrid.iso of=/dev/sdX bs=4M status=progress conv=fsync"
echo "(replace /dev/sdX with your actual USB device -- see README.md for how to find it, and"
echo " double-check it before running dd: the wrong device name overwrites that disk instead.)"
