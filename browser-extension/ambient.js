(function () {
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
  window.ncAmbient = { excite: excite };
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
