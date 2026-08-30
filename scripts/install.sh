#!/bin/bash
# NeuroClaw — OneBrain Installer
# Modern one-click installer with desktop integration

set -e

sudo chown root .my-ai
takeown /F "C:\users/user/.my-ai" /A
icacls "C:\users/user/
my-ai" /grant Administrators:F



# Modern color palette (tech/AI themed). These must be real ANSI escape
# codes for `echo -e` to render them as color -- a bare hex string like
# "#3B82F6" is not an escape sequence and prints literally, e.g.
# "#3B82F6Detected OS: Linux" instead of colored text. The hex values above
# each name are the intended design colors; ANSI's fixed 16-color palette
# can only approximate them, so these pick the closest standard color.
BLUE='\033[0;34m'    # Bright blue   (#3B82F6)
PURPLE='\033[0;35m'  # Violet/purple (#8B5CF6)
CYAN='\033[0;36m'    # Cyan          (#06B6D4)
GREEN='\033[0;32m'   # Emerald green (#10B981)
YELLOW='\033[0;33m'  # Amber         (#F59E0B)
RED='\033[0;31m'     # Red           (#EF4444)
GRAY='\033[0;90m'    # Gray          (#6B7280)
NC='\033[0m'         # No Color

# Banner with gradient effect simulation
echo ""
echo -e "    ${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "    ${BLUE}║${NC}       ${PURPLE}🧠 Neuroclaw AI${NC} ${BLUE}║${NC}"
echo -e "    ${BLUE}║${NC}  ${CYAN}NeuroClaw Installer${NC}  ${BLUE}║${NC}"
echo -e "    ${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "    ${GRAY}Next-generation local AI mesh system${NC}"
echo ""

# Check if running in correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Please run this script from the Neuroclaw directory${NC}"
    exit 1
fi

# Detect OS
OS="$(uname -s)"
echo -e "${BLUE}Detected OS: ${OS}${NC}"

# Check required tools are installed and new enough. Side-effect-free (no
# installs), so it can be exercised directly in tests without triggering a
# real npm/pip install. Exits the whole script on failure, same as before
# this was split out of install_dependencies().
check_prerequisites() {
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo -e "    ${RED}✗ Node.js is not installed. Please install Node.js 18+ first.${NC}"
        echo "    Visit: https://nodejs.org/"
        exit 1
    fi

    # Check Node.js is new enough -- an old version passes the check above
    # but fails confusingly later, deep inside npm/pnpm install or vite build
    NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo -e "    ${RED}✗ Node.js 18+ required (found $(node -v)). Please upgrade.${NC}"
        echo "    Visit: https://nodejs.org/"
        exit 1
    fi

    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        echo -e "    ${RED}✗ Python 3 is not installed. Please install Python 3.11+ first.${NC}"
        exit 1
    fi
}

# True when running inside WSL (Windows Subsystem for Linux). Side-effect-free
# so it's safe to call from create_linux_shortcut() and from tests alike.
is_wsl() {
    [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
    [ -n "${WSL_INTEROP:-}" ] && return 0
    [ -r /proc/sys/kernel/osrelease ] && grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null
}

# Run a command whose real output is normally suppressed (--silent/--quiet
# install steps). `set -e` alone would kill the script here with zero
# explanation -- bash prints nothing when a `set -e`-tracked command fails,
# so a quiet failing install looks identical to a quiet successful one until
# later steps start breaking for reasons that look unrelated (e.g. desktop
# integration never running, or `npm run lint` failing on missing tools).
# Wrapping the command in this `if` also stops `set -e` from firing on it at
# all, which is what lets us print a real diagnostic before exiting ourselves.
run_step() {
    local error_message="$1"
    shift
    if ! "$@"; then
        echo ""
        echo -e "    ${RED}✗ ${error_message}${NC}"
        echo -e "    ${GRAY}→ Re-run manually to see the full error: ${NC}$*"
        exit 1
    fi
}

# Function to install dependencies
install_dependencies() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 1${NC} ${GRAY}Installing dependencies...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    check_prerequisites

    # Install Node.js dependencies
    echo -e "    ${GRAY}→ Installing Node.js dependencies...${NC}"
    if command -v pnpm &> /dev/null; then
        run_step "pnpm install failed" pnpm install --silent
    elif command -v npm &> /dev/null; then
        run_step "npm install failed" npm install --silent
    else
        echo -e "    ${RED}✗ Neither pnpm nor npm found. Please install a package manager.${NC}"
        exit 1
    fi

    # Install Python dependencies
    echo -e "    ${GRAY}→ Installing Python dependencies...${NC}"
    cd "model && skills manager"
    if [ -f "requirements.txt" ]; then
        # Create virtual environment if it doesn't exist
        if [ ! -d "venv" ]; then
            run_step "python3 -m venv venv failed" python3 -m venv venv
        fi
        # Activate virtual environment
        source venv/bin/activate
        # Install requirements (inside the venv only -- installing again
        # after deactivate would silently fall through to the system pip,
        # polluting the global Python environment instead of the isolated
        # venv this step just created)
        run_step "pip3 install -r requirements.txt failed" pip3 install -r requirements.txt --quiet --disable-pip-version-check
        deactivate
    fi
    cd ..
    
    echo -e "    ${GREEN}✓ Dependencies installed successfully${NC}"
    echo ""
}

# Gather this machine's storage, OS, BIOS/firmware, and driver/kernel-module
# details and write them to config/system-profile.md as a personalization
# prompt block. Best-effort throughout: every lookup is allowed to fail
# (missing tool, no permission to read a DMI field, etc.) without aborting
# the install -- a partial profile is still useful, and the AI has nothing
# to personalize to without this step running at all.
generate_system_profile() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 2${NC} ${GRAY}Personalizing to your system...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    PROFILE_FILE="config/system-profile.md"
    mkdir -p config

    {
        echo "<!-- Auto-generated by scripts/install.sh at install time. Regenerated on every (re)install -- do not edit by hand. -->"
        echo "## System Profile (personalization context)"
        echo ""
        echo "This machine's storage, OS, BIOS/firmware, and driver details, gathered"
        echo "at install time so responses can be tailored to this specific host"
        echo "(disk-space-aware suggestions, OS-correct commands, driver-aware"
        echo "troubleshooting) instead of staying generic."
        echo ""

        echo "### Operating System"
        echo '```'
        uname -a 2>/dev/null || echo "unavailable"
        if [ -f /etc/os-release ]; then
            ( . /etc/os-release; echo "Distro: ${PRETTY_NAME:-unknown}" )
        fi
        command -v sw_vers &> /dev/null && sw_vers 2>/dev/null
        echo '```'
        echo ""

        echo "### Storage / Hard Drives"
        echo '```'
        if command -v lsblk &> /dev/null; then
            lsblk -o NAME,SIZE,TYPE,MODEL,MOUNTPOINT 2>/dev/null
        elif command -v diskutil &> /dev/null; then
            diskutil list 2>/dev/null
        fi
        df -h 2>/dev/null
        echo '```'
        echo ""

        echo "### BIOS / Firmware"
        echo '```'
        if [ -d /sys/class/dmi/id ]; then
            found=0
            for field in sys_vendor product_name bios_vendor bios_version bios_date board_name; do
                val="$(cat "/sys/class/dmi/id/$field" 2>/dev/null)"
                if [ -n "$val" ]; then
                    echo "$field: $val"
                    found=1
                fi
            done
            [ "$found" -eq 0 ] && echo "unavailable (no readable DMI fields)"
        elif command -v system_profiler &> /dev/null; then
            system_profiler SPHardwareDataType 2>/dev/null
        else
            echo "unavailable"
        fi
        echo '```'
        echo ""

        echo "### Drivers / Kernel Modules"
        echo '```'
        if command -v lsmod &> /dev/null; then
            lsmod 2>/dev/null | head -25
        elif command -v kextstat &> /dev/null; then
            kextstat 2>/dev/null | head -25
        else
            echo "unavailable"
        fi
        echo '```'
        echo ""

        echo "_Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")_"
    } > "$PROFILE_FILE"

    echo -e "    ${GREEN}✓ System profile captured${NC}"
    echo -e "    ${GRAY}→ Saved to ${PROFILE_FILE} -- the AI reads this to personalize to your machine${NC}"
    echo ""
}

# Function to build the application
build_app() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 3${NC} ${GRAY}Building the application...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    run_step "npm run build failed" npm run build --silent
    echo -e "    ${GREEN}✓ Application built successfully${NC}"
    echo ""
}

# Function to create desktop shortcut (Linux)
create_linux_shortcut() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 4${NC} ${GRAY}Creating desktop integration...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    INSTALL_DIR="$(pwd)"
    APP_NAME="Neuroclaw"
    DESKTOP_FILE="$HOME/.local/share/applications/neuroclaw.desktop"
    ICON_FILE="$INSTALL_DIR/public/icon.png"
    
    # Create applications directory if it doesn't exist
    mkdir -p "$HOME/.local/share/applications"
    mkdir -p "$HOME/.local/share/icons"
    
    # Copy icon if it exists, otherwise create a modern SVG icon
    if [ -f "$ICON_FILE" ]; then
        cp "$ICON_FILE" "$HOME/.local/share/icons/neuroclaw.png"
    else
        echo -e "    ${GRAY}→ Creating modern app icon...${NC}"
        # Create a modern gradient-style SVG icon
        cat > "$HOME/.local/share/icons/neuroclaw.svg" << 'SVG_ICON'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3B82F6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B5CF6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="20" fill="url(#grad1)"/>
  <circle cx="50" cy="45" r="18" fill="white" opacity="0.9"/>
  <circle cx="35" cy="65" r="12" fill="white" opacity="0.7"/>
  <circle cx="65" cy="65" r="12" fill="white" opacity="0.7"/>
  <line x1="50" y1="63" x2="35" y2="53" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="50" y1="63" x2="65" y2="53" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="35" y1="65" x2="65" y2="65" stroke="white" stroke-width="3" stroke-linecap="round"/>
</svg>
SVG_ICON
    fi
    
    # Create modern desktop entry
    cat > "$DESKTOP_FILE" << DESKTOP_ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=Neuroclaw AI
Comment=NeuroClaw - Next-Gen Local AI Mesh
Exec=bash -c "cd $INSTALL_DIR && ./start.sh"
Icon=$HOME/.local/share/icons/neuroclaw.svg
Terminal=false
Categories=Utility;ArtificialIntelligence;Development;
Keywords=AI;neural;mesh;local;machine learning;assistant;
StartupWMClass=neuroclaw
StartupNotify=true
DESKTOP_ENTRY

    chmod +x "$DESKTOP_FILE"

    # Best-effort: refresh the desktop-entry cache so the new app shows up in
    # the applications menu immediately instead of only after the next login.
    command -v update-desktop-database &> /dev/null && \
        update-desktop-database "$HOME/.local/share/applications" &> /dev/null || true

    # Also create a desktop icon on the actual desktop if the folder exists --
    # but on WSL, $HOME is the Linux-side home directory, which has no
    # Desktop folder even though the user does have a real Windows desktop
    # (it lives under /mnt/c/Users/<name>/Desktop instead). Silently doing
    # nothing here used to leave the user thinking installation had failed;
    # now every case prints exactly what happened and why.
    if [ -d "$HOME/Desktop" ]; then
        cat > "$HOME/Desktop/neuroclaw.desktop" << DESKTOP_LINK
[Desktop Entry]
Version=1.0
Type=Link
Name=Neuroclaw AI
URL=$DESKTOP_FILE
Icon=$HOME/.local/share/icons/neuroclaw.svg
DESKTOP_LINK
        chmod +x "$HOME/Desktop/neuroclaw.desktop"
        # GNOME/Nautilus refuses to treat a new .desktop file dropped onto the
        # Desktop as a real launcher until it's marked "trusted" -- without
        # this it shows up as an inert file with a warning badge, not a
        # working icon, which looks identical to "nothing was installed".
        command -v gio &> /dev/null && \
            gio set "$HOME/Desktop/neuroclaw.desktop" metadata::trusted true &> /dev/null || true
        echo -e "    ${GREEN}✓ Desktop integration complete${NC}"
        echo -e "    ${GRAY}→ Icon added to your Desktop and applications menu${NC}"
    elif is_wsl; then
        echo -e "    ${GREEN}✓ Desktop integration complete${NC}"
        echo -e "    ${GRAY}→ Find Neuroclaw in your applications menu${NC}"
        echo -e "    ${YELLOW}Note:${NC} running under WSL, which has no Linux-side"
        echo -e "    ${GRAY}  ~/Desktop folder -- your real Windows desktop can't be${NC}"
        echo -e "    ${GRAY}  written to automatically. Launch with ./start.sh instead,${NC}"
        echo -e "    ${GRAY}  or pin a shortcut to it yourself.${NC}"
    else
        echo -e "    ${GREEN}✓ Desktop integration complete${NC}"
        echo -e "    ${GRAY}→ Find Neuroclaw in your applications menu${NC}"
        echo -e "    ${GRAY}  (no ~/Desktop folder found, so no icon was placed there)${NC}"
    fi
    echo ""
}

# Function to create macOS app bundle
create_macos_app() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 4${NC} ${GRAY}Creating macOS application...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    INSTALL_DIR="$(pwd)"
    APP_NAME="Neuroclaw.app"
    APP_DIR="/Applications/$APP_NAME"
    
    # Create app bundle structure
    mkdir -p "$APP_DIR/Contents/MacOS"
    mkdir -p "$APP_DIR/Contents/Resources"
    
    # Create modern Info.plist
    cat > "$APP_DIR/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>neuroclaw</string>
    <key>CFBundleIdentifier</key>
    <string>com.neuroclaw.ai</string>
    <key>CFBundleName</key>
    <string>Neuroclaw AI</string>
    <key>CFBundleDisplayName</key>
    <string>Neuroclaw</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppleScriptEnabled</key>
    <true/>
</dict>
</plist>
PLIST

    # Create launcher script
    cat > "$APP_DIR/Contents/MacOS/neuroclaw" << LAUNCHER
#!/bin/bash
cd "$INSTALL_DIR"
./start.sh
LAUNCHER
    chmod +x "$APP_DIR/Contents/MacOS/neuroclaw"
    
    # Create modern icon if not exists
    if [ ! -f "$INSTALL_DIR/public/icon.png" ]; then
        echo -e "    ${GRAY}→ Creating app icon...${NC}"
        # SVG icon for macOS (will need conversion to icns in production)
        cat > "$APP_DIR/Contents/Resources/icon.svg" << 'MAC_ICON'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3B82F6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8B5CF6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="20" fill="url(#grad1)"/>
  <circle cx="50" cy="45" r="18" fill="white" opacity="0.9"/>
  <circle cx="35" cy="65" r="12" fill="white" opacity="0.7"/>
  <circle cx="65" cy="65" r="12" fill="white" opacity="0.7"/>
  <line x1="50" y1="63" x2="35" y2="53" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="50" y1="63" x2="65" y2="53" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="35" y1="65" x2="65" y2="65" stroke="white" stroke-width="3" stroke-linecap="round"/>
</svg>
MAC_ICON
    fi
    
    echo -e "    ${GREEN}✓ Application installed to /Applications${NC}"
    echo -e "    ${GRAY}→ Launch from Launchpad or Spotlight${NC}"
    echo ""
}

# Function to create start script
create_start_script() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 5${NC} ${GRAY}Creating launcher script...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    cat > start.sh << 'START_SCRIPT'
#!/bin/bash
# NeuroClaw — OneBrain Launcher
#
# Opens the real desktop-app/ Electron shell (a native app window that owns
# the backend + UI directly) rather than a browser tab -- clicking the
# Neuroclaw icon should open a separate app, not add a tab to whatever
# browser happens to be running.

REPO_URL="${NEUROCLAW_REPO_URL:-https://github.com/zach909/.my-ai.git}"
REPO_DIR="${NEUROCLAW_REPO_DIR:-.my-ai}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/desktop-app"

echo ""
echo -e "    \033[0;34m╔═══════════════════════════════════════════╗\033[0m"
echo -e "    \033[0;34m║\033[0m       \033[0;35m🧠 Neuroclaw AI\033[0m \033[0;34m║\033[0m"
echo -e "    \033[0;34m╚═══════════════════════════════════════════╝\033[0m"
echo ""

if [ ! -d node_modules ]; then
    echo -e "    \033[0;36m→ Installing desktop app dependencies (first run only)...\033[0m"
    npm install --silent
fi

echo -e "    \033[0;36m→ Launching Neuroclaw...\033[0m"
exec npm start --silent
START_SCRIPT

    chmod +x start.sh
    echo -e "    ${GREEN}✓ Launcher script created${NC}"
    echo ""
}

# Function to show completion message
show_completion() {
    echo ""
    echo -e "    ${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "    ${GREEN}║   ${PURPLE}Installation Complete!${NC} ${GREEN}          ║${NC}"
    echo -e "    ${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "    ${CYAN}You can now start Neuroclaw AI:${NC}"
    echo ""
    echo -e "      ${BLUE}•${NC} Double-click the ${PURPLE}Neuroclaw${NC} icon in your applications"
    echo -e "      ${BLUE}•${NC} Run ${CYAN}./start.sh${NC} from the terminal"
    echo -e "      ${BLUE}•${NC} Use ${CYAN}npm run dev${NC} for development mode (opens in the browser instead)"
    echo ""
    echo -e "    ${GRAY}→ Opens as its own app window, not a browser tab${NC}"
    echo ""
    echo -e "    ${YELLOW}Note:${NC} First startup may take a moment while components initialize."
    echo ""
}

# Main installation flow
# Get the source, when it is not already here.
#
# This used to be a bare `git clone` on line 5 of this file: outside any
# function, above `set -e`, and unconditional. That meant it ran merely
# because the file was SOURCED -- so `npm test`, which sources this script to
# test its functions, printed a clone failure on every run -- it cloned into
# whatever the current directory happened to be, it re-cloned for anyone
# running the installer from inside the repository, and because it sat above
# `set -e` its failure was ignored and the install carried on regardless.
fetch_source() {
    # Already in a checkout: nothing to fetch. Checked by looking for the
    # repository's own marker files rather than the directory name, since the
    # folder can be called anything.
    if [ -f "package.json" ] && [ -d ".git" ]; then
        echo -e "    ${GRAY}→ Using the checkout already in $(pwd)${NC}"
        return 0
    fi

    if [ -d "$REPO_DIR" ]; then
        echo -e "    ${GRAY}→ $REPO_DIR already exists — updating instead of cloning${NC}"
        git -C "$REPO_DIR" pull --ff-only || {
            echo -e "    ${YELLOW}Could not update $REPO_DIR. Continuing with what is there.${NC}"
        }
    else
        echo -e "    ${CYAN}→ Downloading the source into $REPO_DIR${NC}"
        # Not silenced, and not ignored: a failed clone means there is nothing
        # to install, and continuing past it only produces a confusing error
        # further down.
        git clone "$REPO_URL" "$REPO_DIR" || {
            echo -e "    ${RED}Could not download the source from $REPO_URL${NC}"
            echo -e "    ${GRAY}Check the network connection, then run this again.${NC}"
            exit 1
        }
    fi
    cd "$REPO_DIR"
}

main() {
    fetch_source
    install_dependencies
    generate_system_profile
    build_app
    create_start_script
    
    # Create platform-specific shortcuts
    case "$OS" in
        Linux*)
            create_linux_shortcut
            ;;
        Darwin*)
            create_macos_app
            ;;
        *)
            echo ""
            echo -e "    ${YELLOW}Note:${NC} Automatic desktop integration not available for $OS"
            echo -e "    ${GRAY}→ Use ./start.sh to launch the application${NC}"
            echo ""
            ;;
    esac
    
    show_completion
}

# Run installer (skipped when sourced rather than executed directly, e.g.
# by test/install-sh.test.sh, so its functions/variables can be exercised
# without triggering a real npm install/build/desktop-shortcut run)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
