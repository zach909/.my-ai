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
 * In the centre sits a glowing sphere. The AI's icon (interface/ai-icon.ts) is
 * only the page icon in the browser tab, served at /ai-icon.jpg.
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

  /* ---- The cord: one smooth closed wave, six rises and six dips, tips tucked in and the middle eased out ---- */
  var SCALE = 0.023, PITCH = 22, STEP = (2 * Math.PI) / 24;
  var R = PITCH / (Math.SQRT2 * Math.sin(STEP));
  var RISE = R * Math.sqrt(2 * Math.cos(STEP) * (1 - Math.cos(STEP)));
  var TIP_IN = 0.1, MID_OUT = 0.04, FIT = 0.88;
  var BEAD = 3.3 * SCALE * FIT, SPHERE = 0.92;

  var N = 2304;
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
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    var tanHalf = Math.tan((40 * Math.PI) / 360), need = 1.75;
    DIST = Math.max(need / tanHalf, need / (tanHalf * (W / H)));
    FOCAL = (H / 2) / tanHalf;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---- Motion: the ring flips end over end through the sphere, with a slow wobble ---- */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', function (e) { ptr.x = (e.clientX / W) * 2 - 1; ptr.y = (e.clientY / H) * 2 - 1; });
  var energy = 0, energyTarget = 0;
  function excite(a) { energyTarget = Math.min(1, energyTarget + a); }
  document.addEventListener('input', function () { excite(0.12); }, true);
  document.addEventListener('submit', function () { excite(1); }, true);
  document.addEventListener('click', function () { excite(0.25); }, true);

  var sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), sd = new Float32Array(N);
  var order = new Uint16Array(N);
  for (var o = 0; o < N; o++) order[o] = o;

  var angle = 0.6, last = performance.now(), visible = true;
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; last = performance.now(); });

  function draw(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
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

    for (var i = 0; i < N; i++) {
      var x = px[i], y = py[i], z = pz[i];
      var X = m00 * x + m01 * y + m02 * z, Y = m10 * x + m11 * y + m12 * z, Z = m20 * x + m21 * y + m22 * z;
      var d = DIST - Z, k = FOCAL / d;
      sx[i] = cx + X * k; sy[i] = cy - Y * k; sz[i] = Z; sd[i] = k;
    }
    /* Insertion sort, far to near: the order barely changes between frames, so this is close to linear. */
    for (var u = 1; u < N; u++) {
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

    var idx = 0;
    var drawBead = function (n) {
      var t = (sz[n] + 1.6) / 3.2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var pr = BEAD * sd[n];
      ctx.drawImage(sprites[Math.round(t * (SHADES - 1))], sx[n] - pr, sy[n] - pr, pr * 2, pr * 2);
    };
    for (; idx < N && sz[order[idx]] <= 0; idx++) drawBead(order[idx]);

    var core = ctx.createRadialGradient(cx - sr * 0.28, cy - sr * 0.32, sr * 0.1, cx, cy, sr);
    core.addColorStop(0, 'rgb(96,50,52)');
    core.addColorStop(0.6, 'rgb(44,22,26)');
    core.addColorStop(1, 'rgb(26,13,16)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();

    for (; idx < N; idx++) drawBead(order[idx]);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (visible) draw(now);
  }
  if (reduce) { draw(performance.now()); window.addEventListener('resize', function () { draw(performance.now()); }); }
  else requestAnimationFrame(frame);
})();
`;

/** The two asset paths, served without a login: they are only the look of the page, and the login page needs them. */
export function isAmbientRoute(pathname: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") && (pathname === "/ambient.css" || pathname === "/ambient.js" || pathname === "/ai-icon.jpg");
}

const MARK = 'data-nc-ambient="1"';

/**
 * Add the ambient layer to an HTML document. Safe to call twice, and a
 * no-op on anything that is not a page (no <html> or <body> to hook onto).
 */
export function injectAmbient(html: string): string {
  if (html.includes(MARK)) return html;
  // The AI's icon is every page's icon, replacing whatever icon the page named.
  const link = `<link rel="icon" type="image/jpeg" href="/ai-icon.jpg" ${MARK}><link rel="stylesheet" href="/ambient.css" ${MARK}>`;
  const script = `<script src="/ambient.js" defer ${MARK}></script>`;
  let out = html.replace(/<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi, "");
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${link}</head>`);
  else if (/<body[\s>]/i.test(out)) out = out.replace(/<body/i, `${link}<body`);
  else return html;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${script}</body>`) : out + script;
}
