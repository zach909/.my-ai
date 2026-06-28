#!/bin/bash
# install-extension.sh — Install the GNOME Multi-Input extension
set -euo pipefail

EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/multi-input@neuroclaw.local"

echo "Installing GNOME Multi-Input extension to ${EXT_DIR}"

mkdir -p "${EXT_DIR}"

cp extension.js metadata.json "${EXT_DIR}/"

echo "Extension installed. Restart GNOME Shell (Alt+F2, 'r', Enter)"
echo "or log out and back in. Then enable with:"
echo "  gnome-extensions enable multi-input@neuroclaw.local"
