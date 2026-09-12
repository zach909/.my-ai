#!/bin/sh
# Runs under `startx` (see .bash_profile). openbox-session itself sources
# ~/.config/openbox/autostart -- that file, not this one, is where the
# actual kiosk browser gets launched.
exec openbox-session
