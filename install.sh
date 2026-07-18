#!/bin/bash
# Neuroclaw — Prometheus Elastic Core Installer
# Modern one-click installer with desktop integration

set -e

# Modern color palette (tech/AI themed)
BLUE='#3B82F6'      # Bright blue
PURPLE='#8B5CF6'    # Violet/purple
CYAN='#06B6D4'      # Cyan
GREEN='#10B981'     # Emerald green
YELLOW='#F59E0B'    # Amber
RED='#EF4444'       # Red
GRAY='#6B7280'      # Gray
NC='\033[0m'        # No Color

# Banner with gradient effect simulation
echo ""
echo -e "    ${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "    ${BLUE}║${NC}       ${PURPLE}🧠 Neuroclaw AI${NC} ${BLUE}║${NC}"
echo -e "    ${BLUE}║${NC}  ${CYAN}Prometheus Elastic Core Installer${NC}  ${BLUE}║${NC}"
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

# Function to install dependencies
install_dependencies() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 1${NC} ${GRAY}Installing dependencies...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo -e "    ${RED}✗ Node.js is not installed. Please install Node.js 18+ first.${NC}"
        echo "    Visit: https://nodejs.org/"
        exit 1
    fi
    
    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        echo -e "    ${RED}✗ Python 3 is not installed. Please install Python 3.11+ first.${NC}"
        exit 1
    fi
    
    # Install Node.js dependencies
    echo -e "    ${GRAY}→ Installing Node.js dependencies...${NC}"
    if command -v pnpm &> /dev/null; then
        pnpm install --silent
    elif command -v npm &> /dev/null; then
        npm install --silent
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
            python3 -m venv venv
        fi
        # Activate virtual environment
        source venv/bin/activate
        # Install requirements
        pip3 install -r requirements.txt --disable-pip-version-check
        deactivate
    fi
    cd ..
    
    echo -e "    ${GREEN}✓ Dependencies installed successfully${NC}"
    echo ""
}

# Function to build the application
build_app() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 2${NC} ${GRAY}Building the application...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    npm run build --silent
    echo -e "    ${GREEN}✓ Application built successfully${NC}"
    echo ""
}

# Function to create desktop shortcut (Linux)
create_linux_shortcut() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 3${NC} ${GRAY}Creating desktop integration...${NC}"
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
Comment=Prometheus Elastic Core - Next-Gen Local AI Mesh
Exec=bash -c "cd $INSTALL_DIR && ./start.sh"
Icon=$HOME/.local/share/icons/neuroclaw.svg
Terminal=false
Categories=Utility;ArtificialIntelligence;Development;
Keywords=AI;neural;mesh;local;machine learning;assistant;
StartupWMClass=neuroclaw
StartupNotify=true
DESKTOP_ENTRY

    chmod +x "$DESKTOP_FILE"
    
    # Also create a desktop icon on the actual desktop if it exists
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
    fi
    
    echo -e "    ${GREEN}✓ Desktop integration complete${NC}"
    echo -e "    ${GRAY}→ Find Neuroclaw in your applications menu${NC}"
    echo ""
}

# Function to create macOS app bundle
create_macos_app() {
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    ${PURPLE}Step 3${NC} ${GRAY}Creating macOS application...${NC}"
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
    echo -e "    ${PURPLE}Step 4${NC} ${GRAY}Creating launcher script...${NC}"
    echo -e "    ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    cat > start.sh << 'START_SCRIPT'
#!/bin/bash
# Neuroclaw — Prometheus Elastic Core Launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "    \033[0;34m╔═══════════════════════════════════════════╗\033[0m"
echo -e "    \033[0;34m║\033[0m       \033[0;35m🧠 Neuroclaw AI\033[0m \033[0;34m║\033[0m"
echo -e "    \033[0;34m╚═══════════════════════════════════════════╝\033[0m"
echo ""

# Start the web UI in the background
echo -e "    \033[0;36m→ Starting web interface...\033[0m"
npm run dev --silent &
WEB_PID=$!

# Wait a moment for the server to start
sleep 3

# Try to open in browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
    open http://localhost:3000
else
    echo -e "    \033[0;36m→ Open your browser to: \033[1;34mhttp://localhost:3000\033[0m"
fi

echo ""
echo -e "    \033[0;36m→ Press Ctrl+C to stop all services\033[0m"
wait $WEB_PID
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
    echo -e "      ${BLUE}•${NC} Use ${CYAN}npm run dev${NC} for development mode"
    echo ""
    echo -e "    ${GRAY}→ App will open at: ${BLUE}http://localhost:3000${NC}"
    echo ""
    echo -e "    ${YELLOW}Note:${NC} First startup may take a moment while components initialize."
    echo ""
}

# Main installation flow
main() {
    install_dependencies
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

# Run installer
main
