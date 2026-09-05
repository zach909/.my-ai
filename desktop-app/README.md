# Cross-Platform Desktop Application

A native desktop application template built with Electron that runs seamlessly on macOS, Windows, and Debian Linux (Debian 12/bookworm or newer — see System Requirements below) without virtualization or subsystems.

## 📁 Project Structure

```
desktop-app/
├── src/
│   ├── main/
│   │   └── main.js          # Main process (Node.js backend)
│   ├── preload/
│   │   └── preload.js       # Preload script (secure bridge)
│   └── renderer/
│       └── index.html       # UI (HTML/CSS/JS frontend)
├── assets/                   # Application icons and resources
├── build/                    # Build configuration files
├── package.json             # Dependencies and build config
└── README.md                # This file
```

## 🖥️ System Requirements

- **Node.js**: v18 or higher — [Download](https://nodejs.org/)
- **Linux (Debian/Ubuntu-based)**: **Debian 12 (bookworm) or newer** is what this app is built and tested against. This isn't an arbitrary cutoff: Electron (currently v43) requires glibc ≥ 2.28 and a reasonably current libstdc++/libgtk-3/libnss3, which Debian 10 (buster) meets only marginally and Debian 9 (stretch) and older do not meet at all — expect the app to fail to launch, often silently, on anything older than Debian 11 (bullseye), and Debian 12 is the version this project actually verifies against. Ubuntu 22.04 LTS or newer (built on a comparable glibc) works the same way.
- **Windows**: Windows 10 or newer.
- **macOS**: a currently-supported macOS release (Electron's own minimum tracks Apple's).
- **Disk**: ~500MB free for `node_modules` (Electron's own bundled Chromium runtime is the bulk of it) plus space for this repo's built `dist/`.

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** or **pnpm** package manager

### Installation

```bash
cd desktop-app
npm install
```

### Development Mode

Run the application in development mode:

```bash
npm start
```

## 🏗️ Building for Production

### Build for Current Platform

```bash
npm run build
```

### Build for Specific Platforms

#### Windows (.exe installer)
```bash
npm run build:win
```
Output: `dist/DesktopApp Setup x.x.x.exe` (NSIS installer)

#### macOS (.app bundle + .dmg)
```bash
npm run build:mac
```
Output: 
- `dist/mac/DesktopApp.app` (Application bundle)
- `dist/DesktopApp-x.x.dmg` (Disk image installer)

Note: macOS builds require macOS with Xcode command line tools.

#### Linux (AppImage + .deb)
```bash
npm run build:linux
```
Output:
- `dist/DesktopApp-x.x.x.AppImage` (Portable executable)
- `dist/desktop-app_x.x.x_amd64.deb` (Debian package)

#### Build for All Platforms
```bash
npm run build:all
```

Note: Cross-compilation has limitations. For best results, build on each target platform.

## 🔧 Features

### Native OS Integration

- **File System Access**: Read/write files, select directories
- **Process Management**: Spawn and execute native commands
- **System Information**: Access platform-specific details
- **External Applications**: Open URLs in default browser, show files in folder

### Security

- Context Isolation enabled
- Node Integration disabled in renderer
- Secure IPC communication via preload script
- Content Security Policy enforced

## 📝 Architecture

### Main Process (`src/main/main.js`)
- Runs in Node.js environment
- Full access to OS APIs
- Manages application windows
- Handles IPC requests from renderer

### Preload Script (`src/preload/preload.js`)
- Bridges main and renderer processes
- Exposes safe APIs via `contextBridge`
- Maintains security boundaries

### Renderer Process (`src/renderer/index.html`)
- Web technologies (HTML/CSS/JavaScript)
- No direct Node.js access
- Communicates via IPC

## 🛠️ Customization

### Adding Icons

Replace the placeholder icons in `assets/`:
- `icon.ico` - Windows (256x256 recommended)
- `icon.icns` - macOS (use iconutil or online converters)
- `icon.png` - Linux (512x512 recommended)

### Modifying Build Configuration

Edit the `build` section in `package.json`:
- Change `appId` for your application
- Modify `productName` for display name
- Add/remove build targets
- Configure platform-specific options

### Adding Native Modules

For native Node.js modules:
```bash
npm install <module-name>
npm rebuild --runtime=electron --target=<electron-version>
```

## 📦 Distribution

### Windows
- Distribute the `.exe` installer
- Users run the installer for standard installation
- Supports silent installation with `/S` flag

### macOS
- Distribute the `.dmg` file
- Users drag the app to Applications folder
- Notarization required for distribution outside App Store

### Linux (Debian/Ubuntu)
```bash
# Install .deb package
sudo dpkg -i dist/desktop-app_x.x.x_amd64.deb
sudo apt-get install -f  # Fix dependencies if needed

# Or use AppImage (no installation required)
chmod +x dist/DesktopApp-x.x.x.AppImage
./dist/DesktopApp-x.x.x.AppImage
```

The `.deb` package includes:
- Desktop entry file (`/usr/share/applications/desktopapp.desktop`)
- Application icon
- Menu integration

## 🔐 Code Signing (Production)

### Windows
Requires code signing certificate:
```json
"win": {
  "certificateSubjectName": "Your Company Name",
  "signingHashAlgorithms": ["sha256"]
}
```

### macOS
Requires Apple Developer ID:
```json
"mac": {
  "identity": "Developer ID Application: Your Name"
}
```

### Linux
Generally not required, but AppImage can be signed optionally.

## 🐛 Troubleshooting

### `npm start` opens nothing, and prints nothing at all

`npm start` now runs `scripts/doctor.mjs` first, which checks for the most
common causes of this on Linux (electron's binary never finished
downloading, no display server reachable, running as root, a missing
shared library Chromium needs) and prints what it finds before Electron
even launches — so a launch that used to fail completely silently now
prints at least one diagnostic line. Read what it says; if it reports
everything is fine and the app still doesn't appear, the failure is
happening inside Electron itself after that point, and running
`node_modules/.bin/electron . --enable-logging` will surface Chromium's
own log output for whatever comes next.

### Build fails on Linux
Ensure you have required dependencies:
```bash
# Debian/Ubuntu
sudo apt-get install --no-install-recommends -y \
  icnsutils \
  graphicsmagick \
  xz-utils \
  libopenjp2-7 \
  libarchive-tools \
  flatpak \
  flatpak-builder
```

### macOS build issues
- Install Xcode Command Line Tools: `xcode-select --install`
- Ensure you're on a supported macOS version

### Windows build issues
- Ensure Visual Studio Build Tools are installed
- Run as Administrator if encountering permission errors

## 📚 Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Electron Builder](https://www.electron.build/)
- [IPC Communication](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)

## 📄 License

MIT License - feel free to use this template for your projects!
