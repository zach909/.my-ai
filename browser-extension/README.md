# NeuroClaw Chance — browser extension

Toolbar popup: click **Surprise me** for a random idea, **Try it in chat** copies it and opens your local NeuroClaw (`http://localhost:3000/app/chat`), and you can add your own ideas.

## Install (Chrome / Edge / Brave)
1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `browser-extension/` folder.

## Install (Firefox)
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** → pick `manifest.json`.

Built-in ideas are in `ideas.json` (keep in sync with `src/lib/chance-ideas.json`).
