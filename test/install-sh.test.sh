#!/bin/bash
# Regression test for install.sh.
#
# install.sh has real side effects when run for real (npm/pnpm install, pip
# install into a venv, building the app, writing desktop shortcuts into
# $HOME or /Applications) -- not safe to run end-to-end as an automated
# test. Instead this sources the script (which skips its own `main` call
# when sourced rather than executed, see the BASH_SOURCE guard at the
# bottom of install.sh) and exercises just the side-effect-free pieces:
# the color-variable definitions and check_prerequisites()'s Node version
# logic.
#
# Run with: bash test/install-sh.test.sh

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

_passed=0
_failed=0

check() {
    if [ "$1" = "0" ]; then
        _passed=$((_passed + 1))
        echo "  ok   $2"
    else
        _failed=$((_failed + 1))
        echo "  FAIL $2"
    fi
}

# --- color variables must be real ANSI escapes, not literal hex strings ---
source install.sh > /dev/null

for name in BLUE PURPLE CYAN GREEN YELLOW RED GRAY; do
    # The variables are single-quoted ('\033[...m'), so their raw value is
    # the literal 4 characters \, 0, 3, 3 -- that's correct and normal;
    # `echo -e` is what turns \033 into a real ESC byte at render time
    # (the same deferred-interpretation idiom the rest of the script
    # already relies on for NC='\033[0m'). What must be checked is the
    # *rendered* output, matching how every real call site actually uses
    # these variables.
    rendered="$(echo -e "${!name}x")"
    case "$rendered" in
        $'\033'\[*m*)
            check 0 "$name renders as a real ANSI escape sequence, not a literal hex string"
            ;;
        *)
            check 1 "$name renders as a real ANSI escape sequence, not a literal hex string (got: $(echo -e "${!name}" | cat -A))"
            ;;
    esac
done

rendered="$(echo -e "${BLUE}x${NC}")"
case "$rendered" in
    "#"*)
        check 1 "colored output does not start with a literal '#' hex-color prefix"
        ;;
    *)
        check 0 "colored output does not start with a literal '#' hex-color prefix"
        ;;
esac

# --- check_prerequisites()'s Node version gate ---
# Exercise the exact version-comparison logic check_prerequisites() runs,
# without actually calling it (it calls `exit 1` on failure, which would
# kill this test process too -- the real function is verified indirectly
# here, by re-deriving its NODE_MAJOR line and reusing its exact condition).
version_check_would_fail() {
    local fake_version="$1"
    local major
    major="$(echo "$fake_version" | sed 's/^v//' | cut -d. -f1)"
    [ "$major" -lt 18 ]
}

if version_check_would_fail "v16.20.0"; then
    check 0 "Node 16 is correctly identified as too old (< 18)"
else
    check 1 "Node 16 is correctly identified as too old (< 18)"
fi

if version_check_would_fail "v18.0.0"; then
    check 1 "Node 18.0.0 is correctly identified as new enough"
else
    check 0 "Node 18.0.0 is correctly identified as new enough"
fi

if version_check_would_fail "v22.22.2"; then
    check 1 "Node 22 is correctly identified as new enough"
else
    check 0 "Node 22 is correctly identified as new enough"
fi

# --- the actual real Node on this machine must pass check_prerequisites()
#     without exiting (confirms the function itself, not just the
#     reimplemented logic above, on whatever Node this environment has) ---
if command -v node &> /dev/null; then
    (check_prerequisites) > /dev/null 2>&1
    check $? "check_prerequisites() passes for real against this machine's actual Node/Python"
fi

# --- run_step() must surface a failing command's error instead of letting
#     `set -e` kill the script with zero explanation (the actual bug: a
#     silently-failed `npm install --silent` used to look identical to a
#     successful one, and every later step -- desktop shortcut, `npm run
#     lint` -- would then fail for reasons that looked unrelated) ---
# NOTE: this test script has `install.sh` sourced into it above, which means
# its `set -e` is now live in *this* shell too. A bare `out="$(cmd)"` where
# cmd's exit status is non-zero is a simple command failing under `set -e`,
# so it would kill this whole test script right here rather than just the
# command substitution's subshell -- every assertion below that expects a
# non-zero exit status uses `|| rc=$?` (an OR-list is exempt from `set -e`)
# to capture it safely instead.
rc=0
out="$( (run_step "fake install failed" false) 2>&1 )" || rc=$?
case "$out" in
    *"fake install failed"*)
        check 0 "run_step() prints the failure message when the wrapped command fails"
        ;;
    *)
        check 1 "run_step() prints the failure message when the wrapped command fails (got: $out)"
        ;;
esac
check $([ "$rc" -ne 0 ] && echo 0 || echo 1) "run_step() exits non-zero when the wrapped command fails"

rc=0
out="$( (run_step "should not print" true) 2>&1 )" || rc=$?
check $([ "$rc" -eq 0 ] && echo 0 || echo 1) "run_step() exits zero when the wrapped command succeeds"
case "$out" in
    *"should not print"*)
        check 1 "run_step() prints nothing extra when the wrapped command succeeds"
        ;;
    *)
        check 0 "run_step() prints nothing extra when the wrapped command succeeds"
        ;;
esac

# --- is_wsl() ---
(
    unset WSL_DISTRO_NAME WSL_INTEROP
    if is_wsl; then
        # Only true if this actual machine's kernel really reports it
        if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
            check 0 "is_wsl() with no WSL markers only returns true on a real WSL kernel"
        else
            check 1 "is_wsl() with no WSL markers only returns true on a real WSL kernel"
        fi
    else
        check 0 "is_wsl() with no WSL markers only returns true on a real WSL kernel"
    fi
)

(
    export WSL_DISTRO_NAME="Ubuntu"
    if is_wsl; then
        check 0 "is_wsl() returns true when WSL_DISTRO_NAME is set"
    else
        check 1 "is_wsl() returns true when WSL_DISTRO_NAME is set"
    fi
)

# --- create_linux_shortcut()'s $HOME/Desktop handling: every branch must
#     print something explaining what happened, instead of the old
#     behavior of silently doing nothing when ~/Desktop doesn't exist
#     (indistinguishable from a broken install) ---
_shortcut_tmp="$(mktemp -d)"
trap '[ -n "${_shortcut_tmp:-}" ] && rm -rf "$_shortcut_tmp"' EXIT

# Case 1: a real ~/Desktop folder exists -- the shortcut must be created
# there and marked trusted (via `gio`, stubbed here so the test doesn't
# depend on a real GNOME session being available).
_fake_home="$_shortcut_tmp/home_with_desktop"
mkdir -p "$_fake_home/Desktop"
_fake_bin="$_shortcut_tmp/bin"
mkdir -p "$_fake_bin"
_gio_log="$_shortcut_tmp/gio.log"
cat > "$_fake_bin/gio" << 'FAKE_GIO'
#!/bin/bash
echo "$@" >> "$GIO_LOG"
FAKE_GIO
chmod +x "$_fake_bin/gio"

out="$(HOME="$_fake_home" GIO_LOG="$_gio_log" PATH="$_fake_bin:$PATH" bash -c 'source install.sh > /dev/null; create_linux_shortcut' 2>&1)"
if [ -f "$_fake_home/Desktop/neuroclaw.desktop" ]; then
    check 0 "create_linux_shortcut() creates a Desktop shortcut when ~/Desktop exists"
else
    check 1 "create_linux_shortcut() creates a Desktop shortcut when ~/Desktop exists"
fi
if [ -f "$_gio_log" ] && grep -q "metadata::trusted true" "$_gio_log"; then
    check 0 "create_linux_shortcut() marks the Desktop shortcut trusted via gio"
else
    check 1 "create_linux_shortcut() marks the Desktop shortcut trusted via gio (log: $(cat "$_gio_log" 2>/dev/null))"
fi
case "$out" in
    *"Icon added to your Desktop"*)
        check 0 "create_linux_shortcut() reports the Desktop icon was added"
        ;;
    *)
        check 1 "create_linux_shortcut() reports the Desktop icon was added (got: $out)"
        ;;
esac

# Case 2: no ~/Desktop and not WSL -- must explain why, not stay silent.
_fake_home2="$_shortcut_tmp/home_no_desktop"
mkdir -p "$_fake_home2"
out="$(HOME="$_fake_home2" WSL_DISTRO_NAME= WSL_INTEROP= bash -c 'unset WSL_DISTRO_NAME WSL_INTEROP; source install.sh > /dev/null; create_linux_shortcut' 2>&1)"
case "$out" in
    *"no ~/Desktop folder found"*)
        check 0 "create_linux_shortcut() explains when no ~/Desktop folder exists (non-WSL)"
        ;;
    *)
        check 1 "create_linux_shortcut() explains when no ~/Desktop folder exists (non-WSL) (got: $out)"
        ;;
esac

# Case 3: no ~/Desktop and WSL -- must give the WSL-specific explanation.
out="$(HOME="$_fake_home2" WSL_DISTRO_NAME="Ubuntu" bash -c 'source install.sh > /dev/null; create_linux_shortcut' 2>&1)"
case "$out" in
    *"running under WSL"*)
        check 0 "create_linux_shortcut() gives WSL-specific guidance when no ~/Desktop folder exists"
        ;;
    *)
        check 1 "create_linux_shortcut() gives WSL-specific guidance when no ~/Desktop folder exists (got: $out)"
        ;;
esac

rm -rf "$_shortcut_tmp"
trap - EXIT

echo ""
echo "$_passed passed, $_failed failed"
[ "$_failed" -eq 0 ]
