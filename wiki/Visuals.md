# Visuals

The AI is the back end; the panel in a reply is the front end. The screen shows, the AI answers.

## Writing one

Put a fenced block labelled `visual` in a message (or press **Visual** next to Send for a workbench with starters and a live preview):

    ```visual
    <button data-ai="Roll a die and show it">Roll</button>
    ```

It is plain HTML, CSS and JavaScript. The page's look (coral on warm dark, round, no blue) is already applied inside the panel.

## Prompting the AI

Doing anything to a panel prompts the AI, and the panel does not need any code for it:

| You do | The AI gets |
|---|---|
| click a button, link or `data-ai` element | `[visual event] click {"tag":"button","id":"go","text":"Roll","ask":"..."}` |
| change a field, checkbox or select | `[visual event] change {"id":"c","value":true}` |
| the panel calls `ai.send("tap", {x: 3})` | `[visual event] tap {"x":3}` |

`data-ai="..."` on an element is a built-in prompt, sent as `ask`. A panel that calls `ai.send` itself is not reported twice for the same click. Events that arrive while the last answer is still coming are dropped and the panel is told (`ai.busy`, and an `ai:busy` event on `window`).

## Safety

The panel is an iframe with `sandbox="allow-scripts"` only: no page access, no cookies or storage, no forms, no popups. Its own CSP blocks every network request; only `data:` and `blob:` images, media and fonts load. The only way out is a message the page accepts from that exact frame, with a validated name (`A-Z a-z 0-9 _ . : -`, up to 64) and at most 1000 characters of JSON. The panel's code stays on the page: the server and the history get `[visual]` in its place. Limits: 64 KB a panel, 3 panels a message.

## Limits

The mesh keeps 200 characters of a prompt and 160 of each prompting skill, so an event is a name and a little data. The replies come from the mesh, which has not been taught to write panels yet; the framing skill (`visual-backend`) and the event loop are what is in place.

## Apps (with your permission)

Press **make app** on any panel, yours or one the AI wrote. It is two steps and both are yours:

1. **Name it and review.** The app is saved in NeuroClaw (`~/.neuroclaw/visual-apps/`) and the card shows the *exact path and the exact text* of the one file that would be written on this computer. Nothing is on your computer yet.
2. **Approve.** Only then is the file written: a `.desktop` entry in `~/.local/share/applications` (Linux), a `.webloc` in `~/Applications` (macOS), or a `.url` shortcut in the Start Menu's Programs folder (Windows). It opens `/visual-apps/<id>` on this NeuroClaw and does nothing else.

The AI can propose an app (it is a visual in a reply) but cannot install one: there is no chat or tool path to the install routes, they are for the owner or an admin, and an install needs the approval the preview returned (one use, expires in 5 minutes). Cancel deletes the saved draft. **Remove it** takes out the launcher this wrote and leaves a file someone replaced alone.

Installing has to be done from the computer NeuroClaw runs on, since the launcher is a file there. From a phone or another PC the app is still saved and opens at its page; on Android, iPhone and ChromeOS use "Add to home screen" / "Install app" on that page.

An installed app is the panel at full width. What it reports goes to the AI like any panel's events, and a panel in the answer replaces the one on screen.

## Letting an app change this computer

An installed app can ask this computer to do things (open or list files, run a command, press keys, turn a radio off, show a notification), and none of it is on by default. Each layer below is separate; all of them have to say yes.

1. **You let that app ask for that tool.** After installing, **Let it change this computer...** lists the tools an app can ever be given (Terminal, Files, Desktop, Mouse and keyboard, System permissions, Radios, Notifications). You pick, review, and approve, the same two steps as installing. An app is never offered anything that speaks or publishes for you (email, messages, calls, passkeys, GitHub), looks at you (camera, microphone, screen, location, contacts), or changes the agent itself (computer access, store, plugin and skill makers, self repair).
2. **The request goes through the AI's own tool gate.** The app calls `ai.os("terminal", "run ls")` and gets back `{status, text}`. The server runs it with `PluginRegistry.runTool()`, which uses the same gate as chat: the danger protocol, the owner-only rule and the approval queue. Risky tools (Terminal, Files, Desktop, ...) are **held**: nothing runs until you approve that one call in Settings, and the app is told `held`.
3. **The tool's own limits still apply.** The Files tool, for example, only reaches the folder NeuroClaw runs in, whatever the app and you agreed.

Only an installed app can do this. A panel in the chat has no handler, so `ai.os` rejects there; the AI's own panels cannot touch the computer. Requests come only from this computer, from the owner or an admin, one at a time, up to 600 characters. The app's page lists **every** request it made and what became of it (`ran`, `held`, `refused`), whatever the answer. You can take the permission back with `POST /api/visual-apps/<id>/os-revoke`, or remove the app.
