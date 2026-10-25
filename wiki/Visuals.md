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
