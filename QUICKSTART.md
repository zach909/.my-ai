# 🧠 Neuroclaw — 1-Minute Quick Start

## Install & Run

### Option 1: One-Click Installer (Recommended)

```bash
./install.sh
```

That's it! The installer will:
1. Install all dependencies
2. Build the app
3. Create a desktop icon
4. Launch the application

### Option 2: Manual Setup

```bash
# Install dependencies
npm install

# Build and run
npm run start
```

## Launch Methods

After installation, you can start Neuroclaw in **3 ways**:

| Method | Command | Description |
|--------|---------|-------------|
| **Desktop App** | Click the icon | Double-click from applications menu |
| **Terminal** | `./start.sh` | Simple launcher script |
| **npm** | `npm run dev` | Development mode with hot reload |

## What to Expect

1. **First Launch** (~10-30 seconds)
   - Dependencies install
   - Application builds
   - Desktop shortcut created

2. **App Opens**
   - Browser opens to `http://localhost:3000`
   - Neural mesh initializes
   - You're ready to chat!

3. **Using the App**
   - Chat with your local AI
   - Visualize the neural mesh in 3D
   - Install plugins and skills
   - Train custom models

## Troubleshooting

**Port 3000 already in use?**
```bash
lsof -ti:3000 | xargs kill -9
```

**Need to reinstall?**
```bash
rm -rf node_modules
npm install
```

**Want to uninstall desktop shortcut?**
```bash
# Linux
rm ~/.local/share/applications/neuroclaw.desktop

# macOS  
rm -rf /Applications/Neuroclaw.app
```

---

**📖 Full documentation:** See [INSTALL.md](INSTALL.md) and [README.md](README.md)
