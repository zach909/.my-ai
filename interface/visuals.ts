/**
 * Visuals: the AI is the back end, the visual in its reply is the front end.
 *
 * A reply (or a message you type yourself) can carry a fenced block:
 *
 *     ```visual
 *     <button id="go">Roll</button>
 *     <script>go.onclick = () => ai.send('roll', { sides: 6 });</script>
 *     ```
 *
 * The chat page draws the block as a live panel. Whatever the panel does, it
 * does by calling `ai.send(name, data)`: that becomes the next turn, a
 * `[visual event] name {json}` message the AI answers like any other, and the
 * answer can carry the next visual. The AI never touches the screen directly
 * and the screen never decides anything: the screen shows, the AI answers.
 * That is the whole contract.
 *
 * Safety, since the panel runs code that someone (you, or the AI) wrote:
 *  - It is an iframe with `sandbox="allow-scripts"` and nothing else: no
 *    same-origin access (so no cookies, no storage, no reaching the page or
 *    this server), no forms, no popups, no top navigation.
 *  - A CSP in the panel's own document blocks every network request, and only
 *    data: and blob: images, media and fonts load. Nothing is fetched.
 *  - The only way out is postMessage, and the page accepts it only from that
 *    exact frame, with a validated event name and at most VISUAL_EVENT_DATA_MAX
 *    characters of JSON.
 *
 * Everything the panel can use is written here; nothing is loaded from outside.
 *
 * What reaches the mesh is small on purpose: the doorway keeps 200 characters
 * of a prompt and 160 of each prompting skill (models && skills/llm.js), so
 * the framing below is one short sentence and an event is name plus a little
 * data, never the panel's code.
 */

/** The fence label that marks a visual. */
export const VISUAL_FENCE = 'visual';
/** A block bigger than this stays plain text (it is not drawn). */
export const VISUAL_MAX_BYTES = 64 * 1024;
/** Blocks past this many in one message stay plain text. */
export const VISUAL_MAX_PER_MESSAGE = 3;
/** What an event name may look like. */
export const VISUAL_EVENT_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The most JSON, in characters, one event may carry. */
export const VISUAL_EVENT_DATA_MAX = 1000;

export interface ReplyPart {
  kind: 'text' | 'visual';
  text: string;
}

/**
 * Cut a message into its prose and its visual blocks, in order.
 *
 * Written once and shared: the chat page runs this exact function (its source
 * is serialised into VISUAL_CLIENT_JS), so the server and the page can never
 * disagree about what counts as a visual. For that reason it must stay
 * self-contained: no outside names, literals only.
 */
export function splitVisuals(text: string): ReplyPart[] {
  const s = String(text == null ? '' : text);
  const parts: ReplyPart[] = [];
  const re = /```visual[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
  let last = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => { if (t.trim()) parts.push({ kind: 'text', text: t.trim() }); };
  while ((m = re.exec(s)) !== null) {
    const code = m[1];
    // Too many, too big or empty: leave the fence where it is, as text.
    if (count >= 3 || code.length > 65536 || !code.trim()) continue;
    pushText(s.slice(last, m.index));
    parts.push({ kind: 'visual', text: code });
    last = m.index + m[0].length;
    count++;
  }
  pushText(s.slice(last));
  return parts;
}

/** The message with each visual replaced by `[visual]`: what the mesh and the history see instead of the code. */
export function plainText(text: string): string {
  const parts = splitVisuals(text);
  // No visual in it: hand it back untouched, whitespace and all.
  if (!parts.some((p) => p.kind === 'visual')) return String(text == null ? '' : text);
  return parts.map((p) => (p.kind === 'visual' ? '[visual]' : p.text)).join('\n').trim();
}

export interface VisualEvent {
  name: string;
  data: unknown;
}

/** A visual event from the request body, or null when it is not a well-formed one. */
export function parseVisualEvent(raw: unknown): VisualEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, data } = raw as { name?: unknown; data?: unknown };
  if (typeof name !== 'string' || !VISUAL_EVENT_NAME.test(name)) return null;
  let json: string | undefined;
  try { json = JSON.stringify(data === undefined ? null : data); } catch { return null; }
  if (typeof json !== 'string' || json.length > VISUAL_EVENT_DATA_MAX) return null;
  return { name, data: JSON.parse(json) };
}

/** The turn the AI is handed when a visual reports something. */
export function visualEventMessage(event: VisualEvent): string {
  return `[visual event] ${event.name} ${JSON.stringify(event.data)}`;
}

/**
 * The framing handed to generation as a prompting skill, so it travels beside
 * the prompt through the Zip Loop instead of being pasted into it. One short
 * sentence: the doorway keeps 160 characters of title plus description.
 */
export const VISUAL_BACKEND_SKILL = {
  name: 'visual-backend',
  title: 'Be the back end',
  description: 'Act as the code behind the screen. Answer with a visual block as the front end; on a [visual event], answer with the updated visual.',
};

/** The skills to hand `generate()` for a chat request: the framing when the page asked for visuals, none otherwise. */
export function visualSkillsFor(body: { visuals?: unknown } | null | undefined): Array<{ name: string; title: string; description: string }> {
  return body && body.visuals === true ? [VISUAL_BACKEND_SKILL] : [];
}

/** Things a visual may open with, so there is something to edit on a blank page. Plain HTML, CSS and JS. */
export const VISUAL_STARTERS: Record<string, string> = {
  Counter: [
    '<div style="display:flex;gap:14px;align-items:center">',
    '  <button id="less">-</button>',
    '  <strong id="n" style="font-size:30px;min-width:2ch;text-align:center">0</strong>',
    '  <button id="more" class="primary">+</button>',
    '</div>',
    '<script>',
    'var n = 0, out = document.getElementById("n");',
    'function set(v) { n = v; out.textContent = n; ai.send("count", { n: n }); }',
    'document.getElementById("less").onclick = function () { set(n - 1); };',
    'document.getElementById("more").onclick = function () { set(n + 1); };',
    '</script>',
  ].join('\n'),
  Choices: [
    '<p style="margin:0 0 10px">Pick one</p>',
    '<div id="row" style="display:flex;gap:10px;flex-wrap:wrap"></div>',
    '<script>',
    '["Tell me more", "Show an example", "Start over"].forEach(function (label) {',
    '  var b = document.createElement("button");',
    '  b.textContent = label;',
    '  b.onclick = function () { ai.send("pick", { choice: label }); };',
    '  document.getElementById("row").appendChild(b);',
    '});',
    '</script>',
  ].join('\n'),
  Canvas: [
    '<canvas id="c" width="320" height="160" style="width:100%;border-radius:24px;background:rgba(255,240,232,.05)"></canvas>',
    '<script>',
    'var c = document.getElementById("c"), g = c.getContext("2d"), t = 0;',
    'function frame() {',
    '  t += 0.03; g.clearRect(0, 0, 320, 160);',
    '  g.strokeStyle = "#ff9a84"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath();',
    '  for (var x = 0; x <= 320; x += 4) { var y = 80 + Math.sin(x / 28 + t) * 34; if (x) g.lineTo(x, y); else g.moveTo(x, y); }',
    '  g.stroke(); requestAnimationFrame(frame);',
    '}',
    'frame();',
    'c.onclick = function (e) {',
    '  var r = c.getBoundingClientRect();',
    '  ai.send("tap", { x: Math.round((e.clientX - r.left) / r.width * 320), y: Math.round((e.clientY - r.top) / r.height * 160) });',
    '};',
    '</script>',
  ].join('\n'),
};

/** Inside every panel, so plain HTML already looks like the rest of the page. Coral on warm dark, round, no blue. */
const PANEL_CSS = [
  ":root{color-scheme:dark;--coral:#ff9a84;--soft:#ffc4b4;--deep:#e8705a;--text:#f8ede9;--dim:rgba(248,237,233,.62);--line:rgba(255,228,218,.2);--glass:rgba(255,240,232,.08)}",
  '*{box-sizing:border-box}',
  "html,body{margin:0;background:transparent;color:var(--text);font:14px/1.5 ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',sans-serif}",
  'body{padding:14px 16px}',
  'button{font:inherit;color:var(--text);background:rgba(255,238,230,.07);border:1px solid var(--line);border-radius:999px;padding:8px 16px;cursor:pointer;transition:transform .2s cubic-bezier(.34,1.56,.64,1),background .2s}',
  'button:hover{background:rgba(255,154,132,.28);transform:translateY(-2px) scale(1.03)}',
  'button:active{transform:scale(.95)}',
  'button.primary{background:rgba(255,154,132,.16);border-color:rgba(255,154,132,.5);color:var(--soft)}',
  'input,select,textarea{font:inherit;color:var(--text);background:var(--glass);border:1px solid var(--line);border-radius:999px;padding:8px 14px;outline:none}',
  'textarea{border-radius:18px}',
  'input:focus,select:focus,textarea:focus{border-color:rgba(255,154,132,.6)}',
  'a{color:var(--soft)}',
  'canvas,img,svg{max-width:100%}',
  '[data-busy] button{opacity:.55;pointer-events:none}',
  '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}',
].join('');

/** The panel's own document may run its inline script and nothing else; no request of any kind leaves it. */
const PANEL_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";
const PANEL_META = `<meta http-equiv="Content-Security-Policy" content="${PANEL_CSP.replace(/'/g, '&#39;')}">`;

/** JSON that is safe to sit inside a <script> element: no `<` for `</script>` or `<!--` to hide in. */
const embed = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

/** Styles for the panels and the workbench. Same tokens as the rest of the page (see AGENTS.md, VISUAL STYLE). */
export const VISUAL_CSS = `
  .nc-visual { margin-top: 10px; width: min(560px, 78vw); max-width: 100%; border: 1px solid var(--border); border-radius: 24px;
    background: rgba(255, 240, 232, 0.07); backdrop-filter: blur(26px) saturate(1.5); overflow: hidden;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 12px 28px rgba(0, 0, 0, 0.28), 0 0 24px rgba(255, 154, 132, 0.06);
    animation: morphicExpand 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .nc-visual-bar { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px 0 16px; font-size: 11px; opacity: 0.62; }
  .nc-visual-bar button, #nc-bench button, #nc-visual-btn { font: inherit; color: var(--text); background: rgba(255, 238, 230, 0.07);
    border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s; }
  .nc-visual-bar button:hover, #nc-bench button:hover, #nc-visual-btn:hover { background: rgba(255, 154, 132, 0.28); transform: translateY(-2px) scale(1.03); }
  .nc-visual-bar button:active, #nc-bench button:active, #nc-visual-btn:active { transform: scale(0.95); }
  .nc-visual iframe { display: block; width: 100%; height: 120px; border: 0; background: transparent; transition: height 0.25s ease; }
  .nc-visual pre { margin: 0; padding: 10px 16px; max-height: 260px; overflow: auto; white-space: pre-wrap; border-top: 1px solid var(--border);
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  #nc-visual-btn { padding: 12px 20px; min-height: 44px; }
  #nc-bench { margin: 0 24px 8px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 32px; max-height: 70vh; overflow: auto;
    background: rgba(255, 240, 232, 0.08); backdrop-filter: blur(26px) saturate(1.5);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 16px 36px rgba(0, 0, 0, 0.35), 0 0 28px rgba(255, 154, 132, 0.08); }
  #nc-bench[hidden] { display: none; }
  #nc-bench { position: relative; z-index: 1; }
  #nc-bench .nc-bench-head, #nc-bench .nc-bench-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #nc-bench .nc-bench-head { justify-content: space-between; margin-bottom: 10px; }
  #nc-bench select { font: inherit; color: var(--text); background: rgba(255, 240, 232, 0.07); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; }
  #nc-bench label { font-size: 12px; opacity: 0.8; display: flex; gap: 6px; align-items: center; }
  #nc-bench textarea { width: 100%; min-height: 8em; resize: vertical; color: var(--text); background: rgba(14, 10, 12, 0.55); border: 1px solid var(--border);
    border-radius: 18px; padding: 10px 14px; outline: none; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  #nc-bench textarea:focus { border-color: rgba(255, 154, 132, 0.6); }
  #nc-bench .nc-visual { margin: 10px 0; width: 100%; }
  #nc-bench .nc-bench-actions { justify-content: space-between; }
  #nc-bench-log { font-size: 12px; opacity: 0.7; min-height: 1.4em; overflow-wrap: anywhere; }
  #nc-bench .primary { background: rgba(255, 154, 132, 0.16); border-color: rgba(255, 154, 132, 0.5); color: var(--primary-light); }
  @media (max-width: 520px) { #nc-bench { margin: 0 16px 8px; } #nc-visual-btn { padding: 12px 14px; } }
  @media (prefers-reduced-motion: reduce) { .nc-visual, .nc-visual iframe, .nc-visual-bar button, #nc-bench button { animation: none; transition: none; } }
`;

/**
 * The page side: draws panels, relays their events, and builds the workbench.
 * One global, `ncVisuals`. Plain browser JavaScript, no outside code. It holds
 * no backticks and no backslashes because it is spliced into the chat page's
 * own template.
 */
export const VISUAL_CLIENT_JS = `
var ncVisuals = (function () {
  var split = (${splitVisuals.toString()});
  var META = ${embed(PANEL_META)};
  var BASE = ${embed(PANEL_CSS)};
  var STARTERS = ${embed(VISUAL_STARTERS)};
  var NAME = ${VISUAL_EVENT_NAME.toString()};
  var DATA_MAX = ${VISUAL_EVENT_DATA_MAX};
  var HEIGHT_MIN = 60, HEIGHT_MAX = 640;
  var NL = String.fromCharCode(10), FENCE = String.fromCharCode(96, 96, 96);
  var frames = {}, seq = 0, busy = false, handler = null;

  function plain(text) {
    var parts = split(text);
    if (!parts.some(function (p) { return p.kind === 'visual'; })) return String(text == null ? '' : text);
    return parts.map(function (p) { return p.kind === 'visual' ? '[visual]' : p.text; }).join(NL).trim();
  }

  function bridge(id) {
    return '(function(){var id=' + JSON.stringify(id) + ';'
      + 'function post(m){m.nc="visual";m.id=id;parent.postMessage(m,"*")}'
      + 'var sent=0;window.ai={busy:false,send:function(n,d){sent++;post({type:"event",name:String(n),data:d===undefined?null:d})}};'
      // Doing anything to a panel prompts the AI, with no code from whoever wrote it: a click on a control or a
      // changed field is reported unless the panel's own handler already called ai.send for it. data-ai="..."
      // on an element is a built-in prompt, sent along as "ask".
      + 'function auto(name,e){var t=e.target&&e.target.closest?e.target.closest("button,a,input,select,textarea,summary,[data-ai],[role=button]"):null;'
      + 'if(!t||t.disabled)return;'
      // Typing into a field is not a click on a control; fields report through "change" instead.
      + 'if(name==="click"&&/^(input|textarea|select)$/i.test(t.tagName)&&!/^(button|submit)$/.test(t.type))return;'
      + 'var before=sent;setTimeout(function(){if(sent!==before)return;'
      + 'var d={tag:t.tagName.toLowerCase()};if(t.id)d.id=t.id.slice(0,40);'
      + 'var x=(t.getAttribute("aria-label")||t.textContent||"").trim().slice(0,60);if(x)d.text=x;'
      + 'if(name==="change"){d.value=t.type==="checkbox"||t.type==="radio"?!!t.checked:String(t.value).slice(0,100)}'
      + 'var a=t.getAttribute("data-ai");if(a)d.ask=a.slice(0,120);window.ai.send(name,d)},0)}'
      + 'addEventListener("click",function(e){auto("click",e)},true);'
      + 'addEventListener("change",function(e){auto("change",e)},true);'
      + 'addEventListener("message",function(e){var m=e.data;if(!m||m.nc!=="visual-host"||m.type!=="busy")return;'
      + 'window.ai.busy=!!m.value;document.documentElement.toggleAttribute("data-busy",!!m.value);'
      + 'dispatchEvent(new CustomEvent("ai:busy",{detail:!!m.value}))});'
      + 'var last=0;function fit(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);'
      + 'if(Math.abs(h-last)>1){last=h;post({type:"size",h:h})}}'
      + 'addEventListener("load",fit);if(window.ResizeObserver)new ResizeObserver(fit).observe(document.documentElement);'
      + '})();';
  }

  function srcdoc(id, code) {
    return '<!doctype html><html><head><meta charset="utf-8">' + META + '<style>' + BASE + '</style><script>'
      + bridge(id) + '</' + 'script></head><body>' + code + '</body></html>';
  }

  function tell(entry, value) {
    try { entry.el.contentWindow.postMessage({ nc: 'visual-host', type: 'busy', value: value }, '*'); } catch (e) { /* frame is gone */ }
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.nc !== 'visual' || typeof m.id !== 'string') return;
    var entry = frames[m.id];
    if (!entry || !entry.el.isConnected || e.source !== entry.el.contentWindow) return;
    if (m.type === 'size') {
      var h = Math.round(Number(m.h));
      if (h > 0) entry.el.style.height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, h)) + 'px';
      return;
    }
    if (m.type !== 'event' || typeof m.name !== 'string' || !NAME.test(m.name)) return;
    var json;
    try { json = JSON.stringify(m.data === undefined ? null : m.data); } catch (x) { return; }
    if (typeof json !== 'string' || json.length > DATA_MAX) return;
    var data = JSON.parse(json);
    if (entry.onEvent) { entry.onEvent(m.name, data); return; }
    if (busy || !handler) { tell(entry, true); return; }
    handler(m.name, data);
  });

  /** One panel: a glass frame, a "code" switch that shows the source, and the sandboxed iframe. */
  function mount(code, onEvent) {
    Object.keys(frames).forEach(function (k) { if (!frames[k].el.isConnected) delete frames[k]; });
    var id = 'v' + (++seq);
    var wrap = document.createElement('div');
    wrap.className = 'nc-visual';
    var bar = document.createElement('div');
    bar.className = 'nc-visual-bar';
    var label = document.createElement('span');
    label.textContent = 'visual';
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'code';
    toggle.setAttribute('aria-expanded', 'false');
    bar.appendChild(label);
    bar.appendChild(toggle);
    var el = document.createElement('iframe');
    el.setAttribute('sandbox', 'allow-scripts');
    el.setAttribute('referrerpolicy', 'no-referrer');
    el.setAttribute('title', 'Visual from the chat');
    el.srcdoc = srcdoc(id, code);
    wrap.appendChild(bar);
    wrap.appendChild(el);
    var pre = null;
    toggle.onclick = function () {
      if (pre) { pre.remove(); pre = null; toggle.setAttribute('aria-expanded', 'false'); return; }
      pre = document.createElement('pre');
      pre.textContent = code;
      wrap.appendChild(pre);
      toggle.setAttribute('aria-expanded', 'true');
    };
    frames[id] = { el: el, onEvent: onEvent || null };
    // Read busy when the frame has loaded, not now: a panel drawn mid-turn may finish loading after the turn ends.
    if (!onEvent) el.addEventListener('load', function () { if (busy) tell(frames[id], true); });
    return wrap;
  }

  /** Put the visuals of a message into its bubble, ahead of the timestamp row. Returns how many were drawn. */
  function attach(bubble, text, before) {
    var n = 0;
    split(text).forEach(function (p) {
      if (p.kind !== 'visual') return;
      bubble.insertBefore(mount(p.text), before || null);
      n++;
    });
    return n;
  }

  function setBusy(value) {
    busy = !!value;
    Object.keys(frames).forEach(function (k) { if (!frames[k].onEvent) tell(frames[k], busy); });
  }

  function enabled() {
    try { return localStorage.getItem('nc_visuals') !== '0'; } catch (e) { return true; }
  }

  /** The workbench: write a visual, watch it run, send it to the chat. */
  function install(o) {
    handler = o.onEvent;
    var area = o.input.parentNode;
    var open = document.createElement('button');
    open.type = 'button';
    open.id = 'nc-visual-btn';
    open.textContent = 'Visual';
    open.setAttribute('aria-label', 'Open the visual workbench');
    open.setAttribute('aria-expanded', 'false');
    area.insertBefore(open, o.sendBtn);
    var bench = document.createElement('div');
    bench.id = 'nc-bench';
    bench.hidden = true;
    bench.setAttribute('role', 'group');
    bench.setAttribute('aria-label', 'Visual workbench');
    var opts = Object.keys(STARTERS).map(function (k) { return '<option>' + k + '</option>'; }).join('');
    bench.innerHTML = '<div class="nc-bench-head"><strong>Visual</strong>'
      + '<select id="nc-bench-starter" aria-label="Start from"><option value="">Start from...</option>' + opts + '</select>'
      + '<label><input type="checkbox" id="nc-bench-on"> Ask the AI to answer with visuals</label>'
      + '<button type="button" id="nc-bench-close">Close</button></div>'
      + '<textarea id="nc-bench-code" spellcheck="false" aria-label="Visual code: HTML, CSS and JavaScript" placeholder="HTML, CSS and JavaScript. Call ai.send(name, data) to tell the AI something."></textarea>'
      + '<div id="nc-bench-preview"></div>'
      + '<div class="nc-bench-actions"><span id="nc-bench-log" role="status" aria-live="polite"></span>'
      + '<button type="button" id="nc-bench-send" class="primary">Send to chat</button></div>';
    area.parentNode.insertBefore(bench, area);
    var code = bench.querySelector('#nc-bench-code');
    var preview = bench.querySelector('#nc-bench-preview');
    var log = bench.querySelector('#nc-bench-log');
    var on = bench.querySelector('#nc-bench-on');
    on.checked = enabled();
    on.onchange = function () { try { localStorage.setItem('nc_visuals', on.checked ? '1' : '0'); } catch (e) { /* storage blocked */ } };
    var timer = 0;
    function draw() {
      preview.textContent = '';
      if (!code.value.trim()) return;
      preview.appendChild(mount(code.value, function (name, data) { log.textContent = 'event ' + name + ' ' + JSON.stringify(data); }));
    }
    code.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(draw, 350); });
    bench.querySelector('#nc-bench-starter').onchange = function (e) {
      if (!STARTERS[e.target.value]) return;
      code.value = STARTERS[e.target.value];
      log.textContent = '';
      draw();
    };
    function show(v) {
      bench.hidden = !v;
      open.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) code.focus(); else { preview.textContent = ''; o.input.focus(); }
    }
    open.onclick = function () { show(bench.hidden); };
    bench.querySelector('#nc-bench-close').onclick = function () { show(false); };
    bench.addEventListener('keydown', function (e) { if (e.key === 'Escape') show(false); });
    bench.querySelector('#nc-bench-send').onclick = function () {
      var text = code.value.trim();
      if (!text) { log.textContent = 'Write something first.'; return; }
      if (text.length > ${VISUAL_MAX_BYTES}) { log.textContent = 'Too big to draw (limit ${VISUAL_MAX_BYTES / 1024} KB).'; return; }
      o.send(FENCE + 'visual' + NL + text + NL + FENCE);
      show(false);
    };
  }

  return { split: split, plain: plain, attach: attach, setBusy: setBusy, enabled: enabled, install: install, srcdoc: srcdoc };
})();
`;
