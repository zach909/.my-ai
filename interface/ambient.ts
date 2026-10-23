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
  window.ncAmbient = { excite: excite, tips: function () { return tips; }, stats: function () { return { stride: STRIDE, beads: M, dpr: DPR, frames: frames, avgDrawMs: frames ? drawMs / frames : 0, paused: hidden || reduce }; } };
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


  /* ---- The hive: a green shoggoth lives in the sphere; its tentacles are the net skills, held in by the crown;
          every hive agent gets a small sphere and shoggoth of its own ---- */
  var skills = [], agents = [], tips = [], sceneT = 0, clock = 0, tentSegs = 20;
  function hashOf(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
  function loadScene() {
    if (!/^https?:$/.test(location.protocol) || !window.fetch) return;
    var json = function (r) { return r.ok ? r.json() : null; };
    fetch('/api/net-skills', { headers: { accept: 'application/json' } }).then(json).then(function (d) {
      if (!d) return;
      var list = [], most = 1, seen = {};
      (d.skills || []).forEach(function (s) {
        var n = Array.isArray(s.neurons) ? s.neurons.length : Object.keys(s.ids || {}).length;
        most = Math.max(most, n); seen[s.skill] = 1; list.push({ name: String(s.skill), neurons: n });
      });
      /* Skill regions the network already has show up in its affinity pairs even before anything is grafted. */
      (d.affinity || []).forEach(function (p) {
        [p.a, p.b].forEach(function (name) { if (name && !seen[name]) { seen[name] = 1; list.push({ name: String(name), neurons: 1 }); } });
      });
      list.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      skills = list.map(function (s) {
        return { name: s.name, neurons: s.neurons, size: Math.sqrt(s.neurons / most), phase: hashOf(s.name) * 6.283, jit: hashOf(s.name + '#'), born: clock };
      });
      if (reduce && !hidden) draw(performance.now());
    }).catch(function () { /* not logged in, or no backend here: the sphere and its shoggoth are still drawn */ });
    fetch('/api/hive-agents', { headers: { accept: 'application/json' } }).then(json).then(function (d) {
      if (!d) return;
      agents = (d.agents || []).map(function (a) {
        return { id: String(a.id), name: String(a.name || a.id), working: !!a.working, phase: hashOf(String(a.id)) * 6.283, orbit: hashOf(String(a.id) + 'o') };
      });
      if (reduce && !hidden) draw(performance.now());
    }).catch(function () { /* same */ });
  }
  loadScene();
  setInterval(function () { if (!hidden && !document.hidden) loadScene(); }, 20000);

  /* The blob's outline: a loop that breathes and throws out slow pseudopods. */
  function blobOutline(x, y, r, t, seed) {
    var N = 64, i, a, rr;
    ctx.beginPath();
    for (i = 0; i <= N; i++) {
      a = (i / N) * 6.2832;
      rr = r * (1 + 0.12 * Math.sin(3 * a + t * 1.3 + seed) + 0.09 * Math.sin(5 * a - t * 1.7 + 1.1 + seed) + 0.05 * Math.sin(9 * a + t * 2.3)
        + 0.22 * Math.max(0, Math.sin(2 * a - t * 0.8 + seed)) * Math.max(0, Math.sin(a + t * 0.35 + 0.5 + seed)));
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  var EYES = [[-0.35, -0.2, 1], [0.1, -0.38, 0.8], [0.38, -0.05, 1.1], [-0.12, 0.12, 0.9], [0.2, 0.34, 0.7], [-0.4, 0.28, 0.6]];
  /* A shoggoth, clipped to its sphere: green body, many eyes that follow the pointer and blink out of step. */
  function drawShoggoth(cx, cy, sr, bx, by, r0, t, seed, eyeCount, glow) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, sr * 0.985, 0, 6.2832); ctx.clip();
    var halo = ctx.createRadialGradient(bx, by, r0 * 0.3, bx, by, sr);
    halo.addColorStop(0, 'rgba(143,227,168,' + (0.22 + glow * 0.2).toFixed(2) + ')'); halo.addColorStop(1, 'rgba(143,227,168,0)');
    ctx.fillStyle = halo; ctx.fillRect(cx - sr, cy - sr, sr * 2, sr * 2);
    blobOutline(bx, by, r0, t, seed);
    var fill = ctx.createRadialGradient(bx - r0 * 0.25, by - r0 * 0.3, r0 * 0.1, bx, by, r0 * 1.3);
    fill.addColorStop(0, 'rgba(176,240,196,.95)'); fill.addColorStop(0.55, 'rgba(110,200,140,.92)'); fill.addColorStop(1, 'rgba(38,104,66,.9)');
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = 'rgba(143,227,168,.55)'; ctx.lineWidth = Math.max(1, sr * 0.012); ctx.stroke();
    var dir = Math.atan2(ptr.sy, ptr.sx), mag = Math.min(1, Math.hypot(ptr.sx, ptr.sy));
    for (var k = 0; k < eyeCount; k++) {
      var e = EYES[k], ex = bx + e[0] * r0 * 1.05, ey = by + e[1] * r0 * 1.05, er = r0 * 0.13 * e[2];
      var blink = reduce ? 1 : (Math.sin(t * 0.7 + k * 2.3 + seed) > 0.97 ? 0.1 : 1);
      ctx.fillStyle = '#f8ede9'; ctx.beginPath(); ctx.ellipse(ex, ey, er, er * blink, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#110c0e'; ctx.beginPath();
      ctx.ellipse(ex + Math.cos(dir) * er * 0.4 * mag, ey + Math.sin(dir) * er * 0.4 * mag * blink, er * 0.45, er * 0.45 * blink, 0, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }
  function blobAt(cx, cy, sr, t) {
    return { x: cx + Math.sin(t * 0.5) * sr * 0.06 + ptr.sx * sr * 0.06, y: cy + Math.cos(t * 0.43) * sr * 0.06 + ptr.sy * sr * 0.06, r: sr * 0.52 };
  }
  /* One tentacle per net skill, rooted in the blob and held in by the crown: past the ring it slides along the inside. */
  function drawTentacles(cx, cy, sr, bl, t) {
    var n = skills.length, hold = sr * 1.38, segs = tentSegs, spinA = reduce ? 0 : t * 0.1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var k = 0; k < n; k++) {
      var s = skills[k];
      var grow = reduce ? 1 : Math.min(1, Math.max(0, (clock - s.born) / 1.6));
      s.reach = 1 - (1 - grow) * (1 - grow);
      var ang = spinA + (k / n) * 6.2832, len = sr * (0.75 + 0.75 * s.size) * (0.8 + 0.4 * s.jit) * s.reach;
      var x = bl.x + Math.cos(ang) * bl.r * 0.7, y = bl.y + Math.sin(ang) * bl.r * 0.7, heading = ang;
      var thick = Math.min(sr * (0.2 + 0.1 * s.size), (6.2832 * bl.r * 0.7 / Math.max(n, 1)) * 0.8);
      var dir = Math.atan2(ptr.sy, ptr.sx), lean = Math.min(1, Math.hypot(ptr.sx, ptr.sy)) * 0.35;
      var pts = [x, y], i;
      for (i = 1; i <= segs; i++) {
        var u = i / segs;
        var sway = Math.sin(t * 1.1 + s.phase + u * 7.5) * 0.55 * u + Math.sin(t * 0.6 + s.phase * 2 + u * 3.1) * 0.3 * u;
        heading += sway * (13 / segs) + Math.sin(dir - heading) * lean * u * 0.4;
        x += Math.cos(heading) * len / segs; y += Math.sin(heading) * len / segs;
        var rx = x - cx, ry = y - cy, rd = Math.hypot(rx, ry);
        if (rd > hold) {
          var side = Math.cos(heading) * ry - Math.sin(heading) * rx > 0 ? 1 : -1;
          x = cx + rx / rd * hold; y = cy + ry / rd * hold; heading = Math.atan2(ry, rx) + side * Math.PI / 2;
        }
        pts.push(x, y);
      }
      for (i = segs; i > 0; i--) {
        var f = i / segs;
        ctx.strokeStyle = 'rgba(' + Math.round(38 + 138 * (1 - f)) + ',' + Math.round(104 + 136 * (1 - f)) + ',' + Math.round(66 + 130 * (1 - f)) + ',' + (0.93 - f * 0.3).toFixed(2) + ')';
        ctx.lineWidth = Math.max(1.2, thick * (1 - f * 0.88));
        ctx.beginPath(); ctx.moveTo(pts[(i - 1) * 2], pts[(i - 1) * 2 + 1]); ctx.lineTo(pts[i * 2], pts[i * 2 + 1]); ctx.stroke();
      }
      var tx = pts[segs * 2], ty = pts[segs * 2 + 1], br = thick * 0.9;
      var bead = ctx.createRadialGradient(tx, ty, 0, tx, ty, br);
      bead.addColorStop(0, 'rgba(226,255,236,.95)'); bead.addColorStop(1, 'rgba(143,227,168,0)');
      ctx.fillStyle = bead; ctx.beginPath(); ctx.arc(tx, ty, br, 0, 6.2832); ctx.fill();
      tips.push({ x: tx, y: ty, label: s.name + ' · ' + s.neurons + ' neuron' + (s.neurons === 1 ? '' : 's'), kind: 'skill' });
    }
  }
  /* One small sphere and shoggoth per hive agent, drifting round the big one. A working hive's agents glow. */
  function drawAgents(cx, cy, sr, t) {
    var m = agents.length, ar = sr * 0.3;
    for (var k = 0; k < m; k++) {
      var a = agents[k], th = (k / m) * 6.2832 + (reduce ? 0 : t * 0.04) + a.orbit * 0.6;
      var rho = sr * (2.1 + (k % 3) * 0.5);
      var x = Math.min(W - ar * 1.4, Math.max(ar * 1.4, cx + Math.cos(th) * rho * (W > H ? 1.35 : 0.8)));
      var y = Math.min(H - ar * 1.4, Math.max(ar * 1.4, cy + Math.sin(th) * rho * (W > H ? 0.8 : 1.3)));
      var r = ar * (1 + (reduce ? 0 : Math.sin(t * 1.4 + a.phase) * 0.03));
      var glow = a.working ? 0.5 + (reduce ? 0 : Math.sin(t * 3 + a.phase) * 0.5) : 0;
      var halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.6);
      halo.addColorStop(0, 'rgba(255,138,112,' + (0.16 + glow * 0.16).toFixed(3) + ')'); halo.addColorStop(1, 'rgba(255,138,112,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 6.2832); ctx.fill();
      var core = ctx.createRadialGradient(x - r * 0.28, y - r * 0.32, r * 0.1, x, y, r);
      core.addColorStop(0, 'rgb(96,50,52)'); core.addColorStop(0.6, 'rgb(44,22,26)'); core.addColorStop(1, 'rgb(26,13,16)');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      var bl = { x: x + Math.sin(t * 0.6 + a.phase) * r * 0.08, y: y + Math.cos(t * 0.5 + a.phase) * r * 0.08, r: r * 0.5 };
      drawShoggoth(x, y, r, bl.x, bl.y, bl.r, t, a.phase, 3, glow);
      ctx.strokeStyle = 'rgba(255,196,180,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
      tips.push({ x: x, y: y - r, label: 'Hive agent · ' + a.name + (a.working ? ' (working)' : ''), kind: 'agent' });
    }
  }

  var angle = 0.6, last = performance.now(), visible = true;
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; last = performance.now(); });

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
    clock = tt;
    if (!reduce) { angle += dt * (0.8 + energy * 3.2); sceneT += dt * (1 + energy * 2.5); }
    tips.length = 0;

    var a = angle, b = reduce ? 0.2 : Math.sin(tt * 0.3) * 0.55 + ptr.sx * 0.35, c = reduce ? 0.1 : Math.sin(tt * 0.21) * 0.4 + ptr.sy * 0.25;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    /* rotation = Rx(a) * Ry(b) * Rz(c) */
    var m00 = cb * cc, m01 = -cb * sc, m02 = sb;
    var m10 = ca * sc - sa * (-sb * cc), m11 = ca * cc - sa * (sb * sc), m12 = -sa * cb;
    var m20 = sa * sc + ca * (-sb * cc), m21 = sa * cc + ca * (sb * sc), m22 = ca * cb;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;

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

    /* Glow behind the sphere */
    var sr = SPHERE * (FOCAL / DIST) * (1 + (reduce ? 0 : Math.sin(tt * 1.4) * 0.018 + energy * 0.05));
    var halo = ctx.createRadialGradient(cx, cy, sr * 0.8, cx, cy, sr * 1.5);
    halo.addColorStop(0, 'rgba(255,138,112,' + (0.2 + energy * 0.12).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(255,138,112,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, sr * 1.5, 0, Math.PI * 2); ctx.fill();
    drawAgents(cx, cy, sr, sceneT);

    var idx = 0;
    var drawBead = function (n) {
      var t = (sz[n] + 1.6) / 3.2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var pr = BEAD * sd[n];
      ctx.drawImage(sprites[Math.round(t * (SHADES - 1))], sx[n] - pr, sy[n] - pr, pr * 2, pr * 2);
    };
    for (; idx < M && sz[order[idx]] <= 0; idx++) drawBead(order[idx]);

    var core = ctx.createRadialGradient(cx - sr * 0.28, cy - sr * 0.32, sr * 0.1, cx, cy, sr);
    core.addColorStop(0, 'rgb(96,50,52)');
    core.addColorStop(0.6, 'rgb(44,22,26)');
    core.addColorStop(1, 'rgb(26,13,16)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
    var bl = blobAt(cx, cy, sr, sceneT);
    drawTentacles(cx, cy, sr, bl, sceneT);
    drawShoggoth(cx, cy, sr, bl.x, bl.y, bl.r, sceneT, 0, 6, energy);

    for (; idx < M; idx++) drawBead(order[idx]);
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
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${script}</body>`) : out + script;
}
