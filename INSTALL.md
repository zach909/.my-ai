# 🧠 Neuroclaw — Easy Installation Guide

## Quick Start (Recommended)

### One-Click Install

Run the installer script to set up everything automatically:

```bash
./install.sh
```

This will:
1. ✅ Install all dependencies (Node.js + Python)
2. ✅ Build the application
3. ✅ Create a desktop shortcut (Linux/macOS)
4. ✅ Set up a simple start script

### After Installation

**Launch the app in any of these ways:**

1. **Desktop Icon** — Click the Neuroclaw icon in your applications menu
2. **Terminal** — Run `./start.sh` from the Neuroclaw directory
3. **npm** — Run `npm run start` or `npm run dev`

The app will open automatically at: **http://localhost:3000**

---

## Manual Installation

If you prefer to install manually:

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Python 3.11+** — [Download](https://python.org/)
- **Git** — For cloning the repository

### Step 1: Install Dependencies

```bash
# Install Node.js packages
npm install

# Install Python packages
cd "model && skills manager"
pip install -r requirements.txt
cd ..
```

### Step 2: Build the App

```bash
npm run build
```

### Step 3: Run the App

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run start
```

---

## What Gets Installed?

| Component | Description |
|-----------|-------------|
| **Web UI** | React-based dashboard with 3D neural mesh visualization |
| **Backend** | TypeScript/Node.js runtime for plugins and extensions |
| **AI Core** | Python-based neural mesh engine (all-to-all neuron network) |
| **Desktop Shortcut** | Easy launch from your applications menu |

---

## First Launch

When you first start Neuroclaw:

1. The web interface opens in your browser
2. The neural mesh initializes (may take a few seconds)
3. You can start chatting, training, or exploring plugins

### Default Ports

- **Web Interface**: http://localhost:3000
- **Backend API**: http://localhost:8000 (if running)

---

## Troubleshooting

### Port Already in Use

If port 3000 is busy, the app will show an error. Try:

```bash
# Kill processes on port 3000
lsof -ti:3000 | xargs kill -9  # macOS/Linux
```

### Missing Dependencies

```bash
# Reinstall everything
rm -rf node_modules
npm install
```

### Python Issues

```bash
# Create a fresh virtual environment
cd "model && skills manager"
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
```

### Native Desktop App (optional)

`model && skills manager/desktop_app.py` is a native chat window (Tkinter —
no browser, no Electron) for the Python AI core; see that folder's
`README.md` for usage. Tkinter ships by default on the python.org Windows/
macOS installers. On Debian/Ubuntu it's a separate OS package matched to
your Python's minor version:

```bash
python3 --version                 # e.g. Python 3.11.x
sudo apt install python3.11-tk    # match the version above
```

---

## Uninstall

To remove the desktop shortcut:

```bash
# Linux
rm ~/.local/share/applications/neuroclaw.desktop
rm -rf ~/.local/share/icons/neuroclaw.*

# macOS
rm -rf /Applications/Neuroclaw.app
```

Then delete the Neuroclaw folder.

---

## Need Help?

- Check the [README.md](README.md) for detailed documentation
- See [DEPLOYMENT.md](DEPLOYMENT.md) for advanced setup
- Review [ARCHITECTURE.md](ARCHITECTURE.md) to understand the system

**Enjoy your local AI! 🎉**
