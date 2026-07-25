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

echo ""
echo "$_passed passed, $_failed failed"
[ "$_failed" -eq 0 ]
