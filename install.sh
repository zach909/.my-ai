#!/bin/bash
# Neuroclaw — Prometheus Elastic Core Installer
# Easy one-click installer that sets up the app and creates desktop shortcuts

set -e

echo "🧠 Neuroclaw — Prometheus Elastic Core Installer"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    echo ""
    echo -e "${YELLOW}Step 1: Installing dependencies...${NC}"
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js is not installed. Please install Node.js 18+ first.${NC}"
        echo "Visit: https://nodejs.org/"
        exit 1
    fi
    
    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}Python 3 is not installed. Please install Python 3.11+ first.${NC}"
        exit 1
    fi
    
    # Install Node.js dependencies
    echo "Installing Node.js dependencies..."
    if command -v pnpm &> /dev/null; then
        pnpm install
    elif command -v npm &> /dev/null; then
        npm install
    else
        echo -e "${RED}Neither pnpm nor npm found. Please install a package manager.${NC}"
        exit 1
    fi
    
    # Install Python dependencies
    echo "Installing Python dependencies..."
    cd "model && skills manager"
    if [ -f "requirements.txt" ]; then
        pip3 install -r requirements.txt --quiet
    fi
    cd ..
    
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Function to build the application
build_app() {
    echo ""
    echo -e "${YELLOW}Step 2: Building the application...${NC}"
    npm run build
    echo -e "${GREEN}✓ Application built${NC}"
}

# Function to create desktop shortcut (Linux)
create_linux_shortcut() {
    echo ""
    echo -e "${YELLOW}Step 3: Creating desktop shortcut...${NC}"
    
    INSTALL_DIR="$(pwd)"
    APP_NAME="Neuroclaw"
    DESKTOP_FILE="$HOME/.local/share/applications/neuroclaw.desktop"
    ICON_FILE="$INSTALL_DIR/public/icon.png"
    
    # Create applications directory if it doesn't exist
    mkdir -p "$HOME/.local/share/applications"
    mkdir -p "$HOME/.local/share/icons"
    
    # Copy icon if it exists, otherwise create a simple one
    if [ -f "$ICON_FILE" ]; then
        cp "$ICON_FILE" "$HOME/.local/share/icons/neuroclaw.png"
    else
        # Create a simple placeholder icon (blue brain emoji as PNG)
        echo -e "${YELLOW}Creating placeholder icon...${NC}"
        # We'll use a simple SVG icon instead
        cat > "$HOME/.local/share/icons/neuroclaw.svg" << 'SVG_ICON'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="45" fill="#3B82F6"/>
  <text x="50" y="65" font-size="50" text-anchor="middle" fill="white">🧠</text>
</svg>
SVG_ICON
    fi
    
    # Create desktop entry
    cat > "$DESKTOP_FILE" << DESKTOP_ENTRY
[Desktop Entry]
Version=1.0
Type=Application
Name=Neuroclaw
Comment=Prometheus Elastic Core - Local AI Mesh
Exec=bash -c "cd $INSTALL_DIR && ./start.sh"
Icon=$HOME/.local/share/icons/neuroclaw.svg
Terminal=false
Categories=Utility;ArtificialIntelligence;
Keywords=AI;neural;mesh;local;
DESKTOP_ENTRY

    chmod +x "$DESKTOP_FILE"
    
    # Also create a desktop icon on the actual desktop if it exists
    if [ -d "$HOME/Desktop" ]; then
        cat > "$HOME/Desktop/neuroclaw.desktop" << DESKTOP_LINK
[Desktop Entry]
Version=1.0
Type=Link
Name=Neuroclaw
URL=$DESKTOP_FILE
Icon=$HOME/.local/share/icons/neuroclaw.svg
DESKTOP_LINK
        chmod +x "$HOME/Desktop/neuroclaw.desktop"
    fi
    
    echo -e "${GREEN}✓ Desktop shortcut created${NC}"
    echo "  You can now find Neuroclaw in your applications menu!"
}

# Function to create macOS app bundle
create_macos_app() {
    echo ""
    echo -e "${YELLOW}Step 3: Creating macOS application...${NC}"
    
    INSTALL_DIR="$(pwd)"
    APP_NAME="Neuroclaw.app"
    APP_DIR="/Applications/$APP_NAME"
    
    # Create app bundle structure
    mkdir -p "$APP_DIR/Contents/MacOS"
    mkdir -p "$APP_DIR/Contents/Resources"
    
    # Create Info.plist
    cat > "$APP_DIR/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>neuroclaw</string>
    <key>CFBundleIdentifier</key>
    <string>com.neuroclaw.app</string>
    <key>CFBundleName</key>
    <string>Neuroclaw</string>
    <key>CFBundleDisplayName</key>
    <string>Neuroclaw</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
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
    
    # Copy icon
    if [ -f "$INSTALL_DIR/public/icon.png" ]; then
        cp "$INSTALL_DIR/public/icon.png" "$APP_DIR/Contents/Resources/icon.icns"
    fi
    
    echo -e "${GREEN}✓ Application installed to /Applications${NC}"
    echo "  You can now launch Neuroclaw from Launchpad or Spotlight!"
}

# Function to create start script
create_start_script() {
    echo ""
    echo -e "${YELLOW}Step 4: Creating start script...${NC}"
    
    cat > start.sh << 'START_SCRIPT'
#!/bin/bash
# Neuroclaw — Prometheus Elastic Core Launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧠 Starting Neuroclaw..."
echo ""

# Start the web UI in the background
echo "Starting web interface..."
npm run dev &
WEB_PID=$!

# Wait a moment for the server to start
sleep 3

# Try to open in browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
    open http://localhost:3000
else
    echo "Open your browser to: http://localhost:3000"
fi

echo ""
echo "Press Ctrl+C to stop all services"
wait $WEB_PID
START_SCRIPT

    chmod +x start.sh
    echo -e "${GREEN}✓ Start script created${NC}"
}

# Function to show completion message
show_completion() {
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}   Installation Complete! 🎉${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo "You can now start Neuroclaw in several ways:"
    echo ""
    echo "  1. ${BLUE}Double-click${NC} the Neuroclaw icon in your applications"
    echo "  2. Run ${BLUE}./start.sh${NC} from the terminal"
    echo "  3. Use ${BLUE}npm run dev${NC} for development mode"
    echo ""
    echo "The app will open at: ${BLUE}http://localhost:3000${NC}"
    echo ""
    echo -e "${YELLOW}Note:${NC} First startup may take a moment while components initialize."
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
            echo -e "${YELLOW}Note: Automatic desktop integration not available for $OS${NC}"
            echo "Use ./start.sh to launch the application"
            ;;
    esac
    
    show_completion
}

# Run installer
main
