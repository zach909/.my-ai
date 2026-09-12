# Auto-starts the graphical kiosk session the moment the live user's shell
# logs in on the console -- no display manager installed (one more thing to
# configure/theme for a single-purpose appliance with exactly one graphical
# thing to ever show), so this is what stands in for one. Only fires on the
# first virtual console (tty1) and only when nothing has already started an
# X server -- switching to another VT and logging in again (or `su`-ing in)
# must not spawn a second, conflicting X server.
if [ -z "${DISPLAY}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -nocursor
fi
