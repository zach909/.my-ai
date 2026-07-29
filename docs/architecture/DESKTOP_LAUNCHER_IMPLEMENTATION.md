# Desktop App Launcher Implementation

## Overview
This implementation adds a desktop-like interface with clickable app icons that launch applications, similar to traditional desktop environments (like GNOME, KDE, Windows, macOS).

## Components Created

### 1. Frontend: `/workspace/src/components/Desktop.tsx`
A complete React desktop component with:
- **AppItem Interface**: Defines launchable applications with command, args, icon, category, and workspace
- **DEFAULT_APPS Registry**: Pre-configured apps including:
  - System apps (File Manager, Terminal, Settings)
  - Productivity (Browser, Email, Calendar)
  - Communication (Phone)
  - Multimedia (Camera, Radio)
  - Development (Docs, Neuroclaw Core, Extension Builder)
- **useAppLauncher Hook**: Handles IPC communication with backend
  - `launchApp()`: Launch apps from the registry
  - `launchCustom()`: Launch custom commands
  - `launchPackage()`: Launch .deb/.exe/.apk packages
- **DesktopIcon Component**: Individual app icon with visual feedback
- **Desktop Component**: Main desktop view with animated background and app grid

### 2. Backend API: `/workspace/interface/web-server.ts`
Added four new API endpoints:

#### POST `/api/apps/launch`
Launch an application via AppLauncher
```json
{
  "command": "gnome-terminal",
  "args": [],
  "name": "Terminal",
  "workspace": 0
}
```

#### GET `/api/apps/list`
List all launched applications with their status

#### POST `/api/apps/close`
Close a running application by appId

#### POST `/api/apps/launch-package`
Launch package files (.deb, .exe, .apk)
```json
{
  "path": "/path/to/package.deb",
  "type": "deb"  // optional, auto-detected from extension
}
```

### 3. Route: `/workspace/src/routes/desktop.tsx`
New route at `/desktop` that renders the Desktop component

## How It Works

### Click Flow:
1. User clicks app icon on desktop
2. `DesktopIcon.onClick` calls `handleAppClick(app)`
3. `useAppLauncher.launchApp()` sends POST request to `/api/apps/launch`
4. WebServer receives request and calls `AppLauncher.launch()`
5. AppLauncher spawns the process using Node.js `child_process.spawn()`
6. Window management via `wmctrl` moves app to specified workspace
7. Response sent back to frontend with appId, pid, etc.
8. UI shows launching animation until app starts

### Package Support:
- **.deb** (Debian/Ubuntu): Installs via `sudo apt install`
- **.exe** (Windows): Runs via Wine emulator
- **.apk** (Android): Installs via ADB

## Usage

### Access the Desktop:
Navigate to `/desktop` in your browser

### Launch Apps:
Click any icon on the desktop to launch the corresponding application

### Programmatic Usage:
```typescript
// In your React component
import { useAppLauncher } from '@/components/Desktop'

function MyComponent() {
  const { launchApp, launchCustom, launchPackage } = useAppLauncher()
  
  // Launch from registry
  await launchApp({ id: 'terminal', name: 'Terminal', command: 'gnome-terminal', ... })
  
  // Launch custom command
  await launchCustom('firefox', ['https://example.com'], 'Firefox')
  
  // Launch package file
  await launchPackage('/path/to/app.deb', 'deb')
}
```

## Dependencies
- Backend: Uses existing `AppLauncher` class (`/workspace/interface/app-launcher.js`)
- Frontend: React, lucide-react icons, Tailwind CSS
- System: Requires `wmctrl` for window management on Linux

## Features
- ✅ Visual feedback during app launch (pulsing animation)
- ✅ Error handling with toast notifications
- ✅ Workspace management (apps open on specified virtual desktops)
- ✅ Category organization
- ✅ Status bar showing active launches
- ✅ Beautiful gradient background with mesh pattern
- ✅ Responsive design
- ✅ Support for multiple package formats (.deb, .exe, .apk)

## Testing

**Note:** the frontend (`src/`, this Vite/React app) and the backend
(`interface/web-server.ts`, plain Node/TS) are two separate processes on two
separate ports -- there is no single "the web server" that serves both. Build
and start the backend first:
```bash
node scripts/build-backend.mjs
node dist/interface/main.js web 7861
```
(7861 is `interface/main.ts`'s default port when none is given; adjust the
`curl` calls below if you pick another one.)

The API endpoints are then available directly on that port. Test with curl:
```bash
# Launch terminal
curl -X POST http://localhost:7861/api/apps/launch \
  -H "Content-Type: application/json" \
  -d '{"command":"gnome-terminal","name":"Terminal"}'

# List running apps
curl http://localhost:7861/api/apps/list
```

To exercise the actual `/desktop` UI (not just the API directly), also run
`vite`'s dev server (`npm run dev` / `bun run dev`, port 3000) with the
backend above already running -- `vite.config.ts`'s dev-server proxy forwards
`/api/*` requests to `http://127.0.0.1:7861`. This proxy only applies to the
dev server: a production `vite build` produces a purely static site (see
`scripts/finalize-static-build.mjs`) with no route to the backend at all
unless the hosting layer provides its own reverse proxy for `/api/*` -- not
yet solved here (a real, disclosed gap, not something this doc should imply
already works).
