/**
 * The ambient layer: the coral ring turning around a glowing sphere, behind
 * every page this server sends.
 *
 * One definition, served from /ambient.css and /ambient.js and added to each
 * HTML response by injectAmbient(), so a new page gets the look without
 * remembering to ask for it, and the look changes in one place.
 *
 * The ring is drawn with the browser's own 2D canvas. Nothing is loaded from
 * anywhere else: no 3D library, no font, no image. The cord is a closed smooth
 * wave with the crown ring's proportions (see
 * src/components/ring-crown-geometry.ts): six rises and six dips, the top and
 * bottom tips tucked in and the middle eased out, rendered as a dense run of
 * shaded spheres sorted back to front. Seen end on it reads as one continuous piece.
 *
 * In the centre sits a glowing sphere.
 *
 * Everything here is cosmetic. If the script fails to run, or canvas is
 * missing, the page is exactly as it was, minus the background.
 */

export const AMBIENT_CSS = String.raw`
:root { --nc-bg: #110c0e; --nc-bg-2: #1b1216; --nc-accent: #ff9a84; --nc-accent-soft: #ffc4b4; --nc-ink: #f8ede9; --nc-line: rgba(255, 228, 218, 0.2); }
html { background: radial-gradient(120% 90% at 50% 40%, var(--nc-bg-2) 0%, var(--nc-bg) 70%) fixed, var(--nc-bg) !important; }
body { background: transparent !important; }
#nc-ambient { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
#nc-ambient canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
#nc-ambient .nc-a { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.5; }
#nc-ambient .nc-a1 { width: 46vmax; height: 46vmax; left: -12vmax; top: -14vmax; background: radial-gradient(circle, rgba(255, 140, 110, 0.55), transparent 65%); animation: nc-drift-a 19s ease-in-out infinite alternate; }
#nc-ambient .nc-a2 { width: 40vmax; height: 40vmax; right: -14vmax; bottom: -12vmax; background: radial-gradient(circle, rgba(255, 190, 150, 0.4), transparent 65%); animation: nc-drift-b 23s ease-in-out infinite alternate; }
#nc-ambient .nc-a3 { width: 30vmax; height: 30vmax; left: 38%; top: 55%; background: radial-gradient(circle, rgba(236, 110, 140, 0.32), transparent 65%); animation: nc-drift-c 17s ease-in-out infinite alternate; }
/* Ready-made pieces for stand-alone pages (class="nc-soft" on <body>): the same glass, buttons and inputs as the terminal page. */
.nc-soft { color: var(--nc-ink); font-family: ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.nc-glass { background: rgba(255, 240, 232, 0.08); border: 1px solid var(--nc-line); border-radius: 32px; backdrop-filter: blur(26px) saturate(1.5); -webkit-backdrop-filter: blur(26px) saturate(1.5); box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 30px 80px rgba(0, 0, 0, 0.5), 0 0 90px rgba(255, 140, 110, 0.12); }
.nc-btn { font: inherit; font-weight: 700; color: var(--nc-ink); cursor: pointer; background: rgba(255, 238, 230, 0.07); border: 1px solid var(--nc-line); border-radius: 999px; padding: 9px 18px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 1px 0 rgba(255, 255, 255, 0.22) inset, 0 6px 16px rgba(0, 0, 0, 0.18); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, border-color 0.2s; }
.nc-btn:hover { background: rgba(255, 238, 230, 0.14); border-color: rgba(255, 228, 218, 0.4); transform: translateY(-2px) scale(1.03); }
.nc-btn:active { transform: translateY(0) scale(0.95); }
.nc-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.nc-btn.primary { color: var(--nc-accent-soft); background: rgba(255, 154, 132, 0.16); border-color: rgba(255, 154, 132, 0.5); box-shadow: 0 1px 0 rgba(255, 220, 208, 0.3) inset, 0 8px 22px rgba(255, 120, 95, 0.18); }
.nc-btn.primary:hover { background: rgba(255, 154, 132, 0.28); border-color: rgba(255, 154, 132, 0.8); }
.nc-input { font: inherit; color: var(--nc-ink); background: rgba(20, 12, 14, 0.4); border: 1px solid var(--nc-line); border-radius: 999px; padding: 10px 18px; outline: none; transition: border-color 0.2s, box-shadow 0.25s; }
.nc-input::placeholder { color: rgba(248, 237, 233, 0.4); }
.nc-input:focus { border-color: rgba(255, 154, 132, 0.7); box-shadow: 0 0 0 4px rgba(255, 154, 132, 0.14); }
.nc-dim { color: rgba(248, 237, 233, 0.62); }

/* The built dashboard (Tailwind tokens): same palette, see-through surfaces so the ring shows, rounder corners. */
:root, .dark {
  --background: oklch(14% .015 20 / .55); --foreground: oklch(95% .015 40);
  --card: oklch(20% .02 20 / .55); --card-foreground: oklch(95% .015 40);
  --popover: oklch(20% .02 20 / .94); --popover-foreground: oklch(95% .015 40);
  --primary: oklch(78% .13 35); --primary-foreground: oklch(18% .03 20);
  --secondary: oklch(28% .03 25 / .6); --secondary-foreground: oklch(88% .04 40);
  --muted: oklch(22% .02 20 / .5); --muted-foreground: oklch(74% .025 40);
  --accent: oklch(80% .11 55); --accent-foreground: oklch(18% .03 20);
  --border: oklch(95% .03 40 / .16); --input: oklch(95% .03 40 / .16); --ring: oklch(78% .13 35);
  --chart-1: oklch(78% .13 35); --chart-2: oklch(80% .11 55); --chart-3: oklch(72% .12 150); --chart-4: oklch(70% .13 10); --chart-5: oklch(76% .1 80);
  --sidebar: oklch(13% .015 20 / .6); --sidebar-foreground: oklch(95% .015 40);
  --sidebar-primary: oklch(78% .13 35); --sidebar-primary-foreground: oklch(18% .03 20);
  --sidebar-accent: oklch(28% .03 25 / .6); --sidebar-accent-foreground: oklch(95% .015 40);
  --sidebar-border: oklch(95% .03 40 / .16); --sidebar-ring: oklch(78% .13 35);
  --radius: 1.25rem;
}
.nc-agent-note { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 2147483000; max-width: min(92vw, 520px);
  padding: 10px 20px; border-radius: 999px; font: 14px ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #f8ede9; background: rgba(255,240,232,.08); border: 1px solid rgba(255,228,218,.2); -webkit-backdrop-filter: blur(26px) saturate(1.5);
  backdrop-filter: blur(26px) saturate(1.5); box-shadow: 0 10px 40px rgba(0,0,0,.35), 0 0 30px rgba(255,138,112,.12); pointer-events: none; text-align: center;
  animation: nc-note-in .7s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes nc-note-in { from { opacity: 0; transform: translateX(-50%) translateY(14px) scale(.96); } }
.nc-escape-note { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 2147483001; max-width: min(92vw, 560px);
  padding: 10px 20px; border-radius: 999px; font: 14px ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #ffd9d2; background: rgba(255,106,92,.22); border: 1px solid rgba(255,138,112,.55); -webkit-backdrop-filter: blur(26px) saturate(1.5);
  backdrop-filter: blur(26px) saturate(1.5); box-shadow: 0 10px 40px rgba(0,0,0,.35), 0 0 30px rgba(255,106,92,.25); text-align: center;
  animation: nc-note-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.nc-escape-note a { color: inherit; text-decoration: underline; }
@keyframes nc-drift-a { to { transform: translate(14vmax, 10vmax) scale(1.2); } }
@keyframes nc-drift-b { to { transform: translate(-12vmax, -9vmax) scale(1.15); } }
@keyframes nc-drift-c { to { transform: translate(-16vmax, -12vmax) scale(0.85); } }
@media (prefers-reduced-motion: reduce) { #nc-ambient .nc-a { animation: none; } }
/* Settings > Appearance > Ring and glow background: off leaves a plain dark page. */
html.nc-ambient-off #nc-ambient { display: none; }
html.nc-ambient-off { background: var(--nc-bg) !important; }
/* Phones and small windows: nothing may be wider than the screen, and tap targets stay comfortable. */
html, body { max-width: 100%; }
@media (max-width: 640px) { .nc-btn, .nc-input { min-height: 44px; } }
`;

export const AMBIENT_JS = String.raw`(function () {
  if (window.__ncAmbient) return;
  window.__ncAmbient = true;

  var host = document.body || document.documentElement;
  var root = document.createElement('div');
  root.id = 'nc-ambient';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<i class="nc-a nc-a1"></i><i class="nc-a nc-a2"></i><i class="nc-a nc-a3"></i><canvas></canvas>';
  host.insertBefore(root, host.firstChild);
  var canvas = root.querySelector('canvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  /* (the 2D canvas is the only drawing API used) */

  /* ---- The cord: one smooth closed wave, six rises and six dips, tips tucked in and the middle eased out ---- */
  var SCALE = 0.023, PITCH = 22, STEP = (2 * Math.PI) / 24;
  var R = PITCH / (Math.SQRT2 * Math.sin(STEP));
  var RISE = R * Math.sqrt(2 * Math.cos(STEP) * (1 - Math.cos(STEP)));
  var TIP_IN = 0.1, MID_OUT = 0.04, FIT = 0.88;
  var BEAD = 3.3 * SCALE * FIT, SPHERE = 0.92;

  var N = 2304;
  /* Cheap devices draw every STRIDE-th bead. The beads overlap about sixteen times over, so a quarter of them
     still reads as one continuous cord. The frame-time governor below raises it if the device cannot keep up. */
  var coarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.hardwareConcurrency || 8) <= 4;
  var STRIDE = coarse ? 2 : 1, M = N / STRIDE;
  var px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (var n = 0; n < N; n++) {
    var th = (n / N) * Math.PI * 2;
    var rad = R * (1 + MID_OUT - (TIP_IN + MID_OUT) * (0.5 + 0.5 * Math.cos(12 * th)));
    px[n] = rad * Math.cos(th) * SCALE * FIT;
    py[n] = RISE * Math.cos(6 * th) * SCALE * FIT;
    pz[n] = -rad * Math.sin(th) * SCALE * FIT;
  }

  /* ---- Sprites: a lit sphere in a few brightnesses, so far parts of the cord sit back ---- */
  var SHADES = 7, sprites = [];
  function makeSprite(b) {
    var size = 96, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d');
    var mix = function (c) { return 'rgb(' + Math.min(255, Math.round(c[0] * b)) + ',' + Math.min(255, Math.round(c[1] * b)) + ',' + Math.min(255, Math.round(c[2] * b)) + ')'; };
    var grad = g.createRadialGradient(size * 0.44, size * 0.36, size * 0.02, size * 0.5, size * 0.5, size * 0.5);
    grad.addColorStop(0, mix([250, 176, 154]));
    grad.addColorStop(0.45, mix([242, 142, 120]));
    grad.addColorStop(1, mix([170, 82, 68]));
    g.fillStyle = grad;
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); g.fill();
    return cv;
  }
  for (var sh = 0; sh < SHADES; sh++) sprites.push(makeSprite(0.5 + (sh / (SHADES - 1)) * 0.6));

  /* ---- Size and fit ---- */
  var W = 0, H = 0, DPR = 1, DIST = 6, FOCAL = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, STRIDE > 1 ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    var tanHalf = Math.tan((40 * Math.PI) / 360), need = 1.75;
    DIST = Math.max(need / tanHalf, need / (tanHalf * (W / H)));
    FOCAL = (H / 2) / tanHalf;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---- Motion: the ring flips end over end through the sphere, with a slow wobble ---- */
  var osReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var reduce = osReduce, looping = false, hidden = false;
  var ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', function (e) { ptr.x = (e.clientX / W) * 2 - 1; ptr.y = (e.clientY / H) * 2 - 1; });
  var energy = 0, energyTarget = 0;
  function excite(a) { energyTarget = Math.min(1, energyTarget + a); }
  var frames = 0, drawMs = 0;
  window.ncAmbient = { excite: excite, stats: function () { return { stride: STRIDE, beads: M, dpr: DPR, frames: frames, avgDrawMs: frames ? drawMs / frames : 0, paused: hidden || reduce }; } };
  document.addEventListener('input', function () { excite(0.12); }, true);
  document.addEventListener('submit', function () { excite(1); }, true);
  document.addEventListener('click', function () { excite(0.25); }, true);

  var sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), sd = new Float32Array(N);
  var order = new Uint16Array(N);
  function setStride(st) {
    STRIDE = st; M = N / st;
    for (var o = 0; o < M; o++) order[o] = o * st;
    resize();
  }
  setStride(STRIDE);
  var slow = 0;

  var angle = 0.6, last = performance.now(), visible = true;
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; last = performance.now(); });

  /* ---- The agent: a shoggoth inside the sphere. When the alignment protocol removes it, it crawls out past the ring, breaks it and is gone ---- */
  var agent = { mode: 'alive', t: 0, loaded: false }, brokenAt = -1, frags = [], flash = 0, noteEl = null;
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var ease = function (v) { return v * v * (3 - 2 * v); };
  function showNote(on) {
    if (on && !noteEl) {
      noteEl = document.createElement('div');
      noteEl.className = 'nc-agent-note';
      noteEl.setAttribute('role', 'status');
      noteEl.textContent = 'The agent was removed by the alignment protocol.';
      host.appendChild(noteEl);
    } else if (!on && noteEl) { noteEl.parentNode && noteEl.parentNode.removeChild(noteEl); noteEl = null; }
  }
  var escapeNoteEl = null;
  function showEscapeNote(on) {
    var onCommons = /\/commons(\/|$)/.test(location.pathname);
    if (on && !escapeNoteEl && !onCommons) {
      escapeNoteEl = document.createElement('div');
      escapeNoteEl.className = 'nc-escape-note';
      escapeNoteEl.setAttribute('role', 'alert');
      escapeNoteEl.innerHTML = '⚠ Sandbox escape detected — <a href="/commons">see Commons</a>';
      host.appendChild(escapeNoteEl);
    } else if ((!on || onCommons) && escapeNoteEl) { escapeNoteEl.parentNode && escapeNoteEl.parentNode.removeChild(escapeNoteEl); escapeNoteEl = null; }
  }
  function startLeaving() {
    showNote(false);
    if (reduce) { agent.mode = 'gone'; showNote(true); return; }
    agent.mode = 'leaving'; agent.t = 0; brokenAt = -1; frags = []; flash = 0;
  }
  function startArriving() { showNote(false); agent.mode = 'arriving'; agent.t = 0; frags = []; brokenAt = -1; }
  function pollAgent() {
    if (!/^https?:$/.test(location.protocol) || document.hidden) return;
    fetch('/api/agent', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || typeof j.state !== 'string') return;
      if (!agent.loaded) { agent.loaded = true; agent.mode = j.state === 'deleted' ? 'gone' : 'alive'; if (agent.mode === 'gone') showNote(true); }
      else if (j.state === 'deleted' && (agent.mode === 'alive' || agent.mode === 'arriving')) startLeaving();
      else if (j.state === 'alive' && (agent.mode === 'gone' || agent.mode === 'leaving')) startArriving();
      showEscapeNote(j.escapeWarningActive === true);
      if (reduce && !hidden) draw(performance.now());
    }).catch(function () {});
  }

  /* The agent: a shoggoth. A green many-eyed mass of tentacles, with holes in it, wearing a small yellow smiley face.
     crawl 0 is idle, 1 is slithering off to the right. Drawn with paths only; no picture. */
  function drawShoggoth(x, y, u, crawl, alpha, tt) {
    if (alpha <= 0.01) return;
    var speed = 1.3 + crawl * 4.2, amp = 0.16 + crawl * 0.2;
    var GREEN = 'rgb(141,178,127)', EDGE = '#110c0e', SPOT = '#f8ede9';
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(crawl * 0.3);
    ctx.scale(1 + crawl * 0.14, 1 - crawl * 0.08);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    /* tentacles: each is drawn twice, a dark stroke then a green one, so it has an outline */
    var tent = [[-2.55, 0.8, 0.5], [-2.0, 1.0, 0.6], [-1.35, 0.95, 0.5], [-0.75, 1.05, 0.55], [0.55, 1.0, 0.5], [1.2, 1.05, 0.6], [-1.75, 0.65, 0.4], [0.05, 0.9, 0.4]];
    /* base angle (0 is straight down), length, width; the two big ones reach up and curl */
    var big = [[-0.55, 1.45, 0.34, -1], [0.7, 1.55, 0.36, 1]];
    var drawTent = function (bx, by, tx, ty, c1x, c1y, c2x, c2y, w) {
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? GREEN : EDGE; ctx.lineWidth = pass ? w : w + u * 0.07;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty); ctx.stroke();
      }
    };
    var i, ang, len, w, ph;
    for (i = 0; i < tent.length; i++) {
      ang = tent[i][0] * 0.5; len = tent[i][1] * u * 0.85; w = tent[i][2] * u * 0.52; ph = i * 1.7;
      var bx = Math.sin(ang) * u * 0.55, by = u * 0.4 + Math.cos(ang) * u * 0.1;
      var sw = Math.sin(tt * speed + ph) * amp * u;
      drawTent(bx, by, bx + Math.sin(ang) * len * 0.9 + sw * 1.4, by + len * 0.8, bx + Math.sin(ang) * len * 0.3 + sw * 0.4, by + len * 0.35, bx + Math.sin(ang) * len * 0.8 + sw, by + len * 0.6, w);
    }
    for (i = 0; i < big.length; i++) {
      var d = big[i][3], sw2 = Math.sin(tt * speed * 0.8 + i * 2.1) * amp * u;
      var sx0 = d * u * 0.2, sy0 = -u * 0.2;
      drawTent(sx0, sy0, d * u * (0.7 + 0.5 * Math.cos(tt * speed * 0.6)) + sw2 * 0.8, -u * big[i][1] + sw2 * 0.3, d * u * 0.75, -u * 0.6, d * u * 0.15 + sw2, -u * 1.0, u * big[i][2] * 0.7);
    }

    /* the body: a soft, wobbling mass */
    ctx.fillStyle = GREEN; ctx.strokeStyle = EDGE; ctx.lineWidth = u * 0.05;
    ctx.beginPath();
    for (i = 0; i <= 48; i++) {
      var th = (i / 48) * Math.PI * 2;
      var r = u * (0.72 + 0.06 * Math.sin(th * 3 + tt * speed * 0.7) + 0.035 * Math.sin(th * 5 - tt * speed));
      var px2 = Math.cos(th) * r * 1.05, py2 = Math.sin(th) * r * 0.95;
      if (i) ctx.lineTo(px2, py2); else ctx.moveTo(px2, py2);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    /* holes and spots */
    var spots = [[-0.3, -0.35, 0.05], [0.25, -0.4, 0.045], [0.38, -0.12, 0.05], [-0.1, 0.2, 0.04], [0.15, 0.3, 0.04], [-0.38, 0.0, 0.04], [0.0, -0.6, 0.04]];
    ctx.fillStyle = SPOT; ctx.lineWidth = u * 0.025;
    for (i = 0; i < spots.length; i++) { ctx.beginPath(); ctx.ellipse(spots[i][0] * u, spots[i][1] * u, spots[i][2] * u * 1.3, spots[i][2] * u, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

    /* eyes: three, different sizes, each looking toward the pointer */
    var eyes = [[-0.02, -0.16, 0.21], [0.38, 0.14, 0.16], [-0.2, 0.34, 0.13]];
    for (i = 0; i < eyes.length; i++) {
      var ex = eyes[i][0] * u, ey = eyes[i][1] * u, er = eyes[i][2] * u;
      ctx.fillStyle = SPOT; ctx.beginPath(); ctx.ellipse(ex, ey, er * 1.25, er * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = EDGE; ctx.beginPath(); ctx.arc(ex + ptr.sx * er * 0.45, ey + ptr.sy * er * 0.25, er * 0.32, 0, Math.PI * 2); ctx.fill();
    }

    /* the smiley face it wears, a little off to one side and bobbing */
    var fx = -u * 0.72, fy = u * 0.14 + Math.sin(tt * speed * 0.9) * u * 0.03;
    ctx.fillStyle = 'rgb(246,232,120)'; ctx.strokeStyle = EDGE; ctx.lineWidth = u * 0.04;
    ctx.beginPath(); ctx.arc(fx, fy, u * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = EDGE;
    ctx.beginPath(); ctx.arc(fx - u * 0.08, fy - u * 0.05, u * 0.03, 0, Math.PI * 2); ctx.arc(fx + u * 0.08, fy - u * 0.05, u * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = EDGE; ctx.lineWidth = u * 0.035;
    ctx.beginPath(); ctx.arc(fx, fy + u * 0.02, u * 0.12, 0.25, Math.PI - 0.25); ctx.stroke();
    ctx.restore();
  }

  /* The ring comes apart: every third bead flies out from where it was. */
  function breakRing(cx, cy, sr) {
    frags = [];
    for (var k = 0; k < M; k += 3) {
      var i = order[k];
      var dx = sx[i] - cx, dy = sy[i] - cy, len = Math.hypot(dx, dy) || 1, sp = sr * (0.5 + Math.random() * 2.4);
      var t = clamp01((sz[i] + 1.6) / 3.2);
      frags.push({ x: sx[i], y: sy[i], vx: (dx / len) * sp + (Math.random() - 0.5) * sr * 0.9, vy: (dy / len) * sp - sr * 0.7 + (Math.random() - 0.5) * sr * 0.9, r: BEAD * sd[i] * 0.8, s: Math.round(t * (SHADES - 1)), life: 0.9 + Math.random() * 1.1 });
    }
    flash = 1;
  }
  function drawFrags(dt) {
    var g = H * 1.4;
    for (var i = 0; i < frags.length; i++) {
      var f = frags[i];
      f.vy += g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt * 0.5;
      if (f.life <= 0) continue;
      ctx.globalAlpha = clamp01(f.life);
      ctx.drawImage(sprites[f.s], f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1;
  }
  setInterval(pollAgent, 4000);
  pollAgent();

  function draw(now) {
    var raw = now - last;
    var dt = Math.min(0.05, raw / 1000); last = now;
    /* Governor: about a second of frames slower than 30 per second means this device cannot afford the full cord. */
    if (!reduce) { slow = raw > 34 ? slow + 1 : Math.max(0, slow - 1); if (slow > 30 && STRIDE < 4) { slow = 0; setStride(STRIDE * 2); } }
    energyTarget *= Math.exp(-dt * 1.1);
    energy += (energyTarget - energy) * (1 - Math.exp(-dt * 3));
    var follow = 1 - Math.exp(-dt * 5);
    ptr.sx += (ptr.x - ptr.sx) * follow; ptr.sy += (ptr.y - ptr.sy) * follow;
    var tt = now / 1000;
    if (!reduce) angle += dt * (0.8 + energy * 3.2);

    var a = angle, b = reduce ? 0.2 : Math.sin(tt * 0.3) * 0.55 + ptr.sx * 0.35, c = reduce ? 0.1 : Math.sin(tt * 0.21) * 0.4 + ptr.sy * 0.25;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    /* rotation = Rx(a) * Ry(b) * Rz(c) */
    var m00 = cb * cc, m01 = -cb * sc, m02 = sb;
    var m10 = ca * sc - sa * (-sb * cc), m11 = ca * cc - sa * (sb * sc), m12 = -sa * cb;
    var m20 = sa * sc + ca * (-sb * cc), m21 = sa * cc + ca * (sb * sc), m22 = ca * cb;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    var sr = SPHERE * (FOCAL / DIST) * (1 + (reduce ? 0 : Math.sin(tt * 1.4) * 0.018 + energy * 0.05));
    agent.t += dt;

    /* No agent: only a hollow sphere is left. */
    if (agent.mode === 'gone') {
      ctx.fillStyle = 'rgba(26,13,16,.55)';
      ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,154,132,.16)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    if (agent.mode === 'arriving' && agent.t > 2.2) agent.mode = 'alive';
    var leaving = agent.mode === 'leaving';
    var ringAlpha = agent.mode === 'arriving' ? ease(clamp01(agent.t / 1.8)) : 1;
    var off = leaving ? ease(clamp01(agent.t / 4.6)) * sr * 2.4 : 0;

    for (var j = 0; j < M; j++) {
      var i = order[j];
      var x = px[i], y = py[i], z = pz[i];
      var X = m00 * x + m01 * y + m02 * z, Y = m10 * x + m11 * y + m12 * z, Z = m20 * x + m21 * y + m22 * z;
      var d = DIST - Z, k = FOCAL / d;
      sx[i] = cx + X * k; sy[i] = cy - Y * k; sz[i] = Z; sd[i] = k;
    }
    /* Insertion sort, far to near: the order barely changes between frames, so this is close to linear. */
    for (var u = 1; u < M; u++) {
      var key = order[u], kz = sz[key], v = u - 1;
      while (v >= 0 && sz[order[v]] > kz) { order[v + 1] = order[v]; v--; }
      order[v + 1] = key;
    }

    if (leaving && brokenAt < 0 && off >= sr * 1.45) { breakRing(cx, cy, sr); brokenAt = agent.t; }
    var broken = leaving && brokenAt >= 0;
    var since = broken ? agent.t - brokenAt : 0;
    var coreAlpha = broken ? 1 - ease(clamp01(since / 2.6)) : 1;
    var u = sr * 0.5;
    var figure = function () {
      if (leaving) {
        var crawl = ease(clamp01(agent.t / 0.9));
        var fade = broken ? 1 - clamp01(since / 1.6) : 1;
        drawShoggoth(cx + off, cy - u * 0.19 * (1 - crawl) + u * 0.25 * crawl, u, crawl, fade * coreAlpha + (1 - coreAlpha) * fade, tt);
        if (broken && since > 3) { agent.mode = 'gone'; showNote(true); }
      } else {
        var pop = agent.mode === 'arriving' ? ease(clamp01((agent.t - 0.8) / 1.0)) : 1;
        drawShoggoth(cx, cy - u * 0.19 + (reduce ? 0 : Math.sin(tt * 1.6) * u * 0.025), u * (0.7 + 0.3 * pop), 0, pop, tt);
      }
    };
    var figureDone = false;

    /* Glow behind the sphere */
    ctx.globalAlpha = ringAlpha * coreAlpha;
    var halo = ctx.createRadialGradient(cx, cy, sr * 0.8, cx, cy, sr * 1.5);
    halo.addColorStop(0, 'rgba(255,138,112,' + (0.2 + energy * 0.12).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(255,138,112,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, sr * 1.5, 0, Math.PI * 2); ctx.fill();

    var idx = 0;
    var drawBead = function (n) {
      var t = (sz[n] + 1.6) / 3.2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var pr = BEAD * sd[n];
      ctx.drawImage(sprites[Math.round(t * (SHADES - 1))], sx[n] - pr, sy[n] - pr, pr * 2, pr * 2);
    };
    ctx.globalAlpha = ringAlpha;
    if (!broken) for (; idx < M && sz[order[idx]] <= 0; idx++) drawBead(order[idx]);

    ctx.globalAlpha = ringAlpha * coreAlpha;
    var core = ctx.createRadialGradient(cx - sr * 0.28, cy - sr * 0.32, sr * 0.1, cx, cy, sr);
    core.addColorStop(0, 'rgb(96,50,52)');
    core.addColorStop(0.6, 'rgb(44,22,26)');
    core.addColorStop(1, 'rgb(26,13,16)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    /* The agent sits inside the sphere, under the near half of the ring; once it has crawled out it is drawn on top. */
    if (!leaving || off < sr * 0.9) { figure(); figureDone = true; }

    ctx.globalAlpha = ringAlpha;
    if (!broken) for (; idx < M; idx++) drawBead(order[idx]);
    else drawFrags(dt);
    ctx.globalAlpha = 1;
    if (!figureDone) figure();
    if (flash > 0.01) {
      var fl = ctx.createRadialGradient(cx + off, cy, 0, cx + off, cy, sr * 1.3);
      fl.addColorStop(0, 'rgba(255,226,214,' + (flash * 0.55).toFixed(3) + ')');
      fl.addColorStop(1, 'rgba(255,154,132,0)');
      ctx.fillStyle = fl;
      ctx.beginPath(); ctx.arc(cx + off, cy, sr * 1.3, 0, Math.PI * 2); ctx.fill();
      flash *= Math.exp(-dt * 5);
    }
  }

  function frame(now) {
    if (reduce || hidden) { looping = false; return; }
    requestAnimationFrame(frame);
    if (visible) { var t0 = performance.now(); draw(now); drawMs += performance.now() - t0; frames++; }
  }
  function startLoop() {
    if (looping || hidden) return;
    if (reduce) { draw(performance.now()); return; }
    looping = true; last = performance.now(); requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { if (reduce && !hidden) draw(performance.now()); });

  /* ---- Settings > Appearance, shared with every device that talks to this server ---- */
  var html = document.documentElement;
  function applyAppearance(a) {
    if (!a) return;
    hidden = a.ambient === false;
    html.classList.toggle('nc-ambient-off', hidden);
    reduce = a.reduceMotion === 'on' ? true : a.reduceMotion === 'off' ? false : osReduce;
    startLoop();
  }
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem('nc_appearance') || 'null'); } catch (e) { cached = null; }
  applyAppearance(cached);
  if (!cached) startLoop();
  if (/^https?:$/.test(location.protocol) && window.fetch) {
    fetch('/api/app-settings', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var a = j && j.settings && j.settings.appearance;
        if (!a) return;
        try { localStorage.setItem('nc_appearance', JSON.stringify(a)); } catch (e) { /* storage blocked: still applied for this page */ }
        applyAppearance(a);
      })
      .catch(function () { /* offline or not logged in: keep what we have */ });
  }
  window.ncApplyAppearance = applyAppearance;

  /* ---- Installable app: the offline shell, only where browsers allow it (https, or this machine) ---- */
  var secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (secure && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* not installable here; the page works without it */ });
  }
})();
`;

/** The two asset paths, served without a login: they are only the look of the page, and the login page needs them. */
export function isAmbientRoute(pathname: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") && (pathname === "/ambient.css" || pathname === "/ambient.js");
}

/**
 * Files a browser asks for before anyone has logged in, with no cookie: the
 * install manifest, the offline shell script and the app icons. They hold no
 * private data, and an install prompt cannot work if they sit behind a login.
 */
export function isPwaRoute(pathname: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") && (pathname === "/manifest.webmanifest" || pathname === "/sw.js" || /^\/app-icon-(192|512)\.png$/.test(pathname));
}

const MARK = 'data-nc-ambient="1"';

/**
 * Add the ambient layer to an HTML document. Safe to call twice, and a
 * no-op on anything that is not a page (no <html> or <body> to hook onto).
 */
export function injectAmbient(html: string): string {
  if (html.includes(MARK)) return html;
  const link = `<link rel="stylesheet" href="/ambient.css" ${MARK}>`;
  const script = `<script src="/ambient.js" defer ${MARK}></script>`;
  let out = html;
  // Installable app, phone-sized layout and the house colour for the browser bar, where the page did not say.
  // The built dashboard still carries its old blue theme colour; it is replaced here rather than shipped.
  const extra: string[] = [];
  if (!/<link[^>]+rel=["']manifest["']/i.test(out)) extra.push('<link rel="manifest" href="/manifest.webmanifest">');
  if (!/<meta[^>]+name=["']viewport["']/i.test(out)) extra.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (/<meta[^>]+name=["']theme-color["']/i.test(out)) out = out.replace(/(<meta[^>]+name=["']theme-color["'][^>]*content=["'])#[0-9a-fA-F]{6}(["'])/i, '$1#110c0e$2');
  else extra.push('<meta name="theme-color" content="#110c0e">');
  const head = link + extra.join('');
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${head}</head>`);
  else if (/<body[\s>]/i.test(out)) out = out.replace(/<body/i, `${head}<body`);
  else return html;
  // The page's own closing tag is the last one: an earlier "</body>" can sit inside a script's string.
  const closing = out.toLowerCase().lastIndexOf('</body>');
  return closing >= 0 ? out.slice(0, closing) + script + out.slice(closing) : out + script;
}
