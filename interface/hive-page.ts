/**
 * The Hive page (/hive): the network drawn as one sphere with a tentacle for
 * every net skill that is grafted into it.
 *
 * Wears the house look (see AGENTS.md, VISUAL STYLE): the server adds the ring
 * and background, this page only uses the shared tokens and shapes. The
 * tentacles are drawn with the browser's own Canvas 2D, no library. Skill names
 * are drawn as text, never as markup. Nothing is fetched except this server's
 * own /api/net-skills.
 */
export const HIVE_PAGE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hive</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; background:#110c0e; color:#f8ede9; }
  main { position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:28px 16px 60px; display:grid; grid-template-columns:minmax(0,1fr); gap:14px; }
  h1 { font-size:22px; margin:6px 6px 0; }
  .bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; margin:0 8px; font-size:14px; }
  section { padding:10px; }
  #stage { position:relative; width:100%; height:68vh; min-height:380px; border-radius:26px; overflow:hidden; }
  #hive { display:block; width:100%; height:100%; }
  #tip { position:absolute; pointer-events:none; opacity:0; transform:translate(-50%,-130%); padding:8px 14px; border-radius:999px; font-size:13px;
         background:rgba(20,12,14,.72); border:1px solid rgba(255,154,132,.5); color:#ffc4b4; white-space:nowrap; transition:opacity .2s ease; }
  #note { min-height:20px; margin:0 8px; font-size:14px; }
</style>
</head>
<body class="nc-soft">
<main>
  <h1>Hive</h1>
  <div class="bar">
    <span class="nc-dim">One tentacle for every net skill in the network. Longer means more neurons.</span>
    <span id="count" class="nc-dim"></span>
  </div>
  <div id="note" class="nc-dim"></div>
  <section class="nc-glass">
    <div id="stage"><canvas id="hive"></canvas><div id="tip"></div></div>
  </section>
</main>
<script>
(function () {
  var canvas = document.getElementById('hive');
  var stage = document.getElementById('stage');
  var tip = document.getElementById('tip');
  var note = document.getElementById('note');
  var count = document.getElementById('count');
  var ctx = canvas.getContext('2d');
  if (!ctx) { note.textContent = 'This browser cannot draw the hive.'; return; }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var skills = [];      // { name, neurons, phase, reach, tipX, tipY, len }
  var W = 0, H = 0, dpr = 1;
  var look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 };
  var hover = -1, spin = 0, t0 = performance.now();

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth; H = stage.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function load() {
    fetch('/api/net-skills', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.error) { note.textContent = 'The network said: ' + d.error; return; }
      var list = (d && d.skills) || [];
      var most = 1, seen = {}, next = [];
      list.forEach(function (s) {
        var n = Array.isArray(s.neurons) ? s.neurons.length : Object.keys(s.ids || {}).length;
        most = Math.max(most, n); seen[s.skill] = 1;
        next.push({ name: String(s.skill), neurons: n });
      });
      // Skill regions the network already has show up in its affinity pairs even when nothing has been grafted yet.
      ((d && d.affinity) || []).forEach(function (p) {
        [p.a, p.b].forEach(function (name) { if (name && !seen[name]) { seen[name] = 1; next.push({ name: String(name), neurons: 1 }); } });
      });
      skills = next.map(function (s) {
        var old = skills.filter(function (o) { return o.name === s.name; })[0];
        return { name: s.name, neurons: s.neurons, size: Math.sqrt(s.neurons / most),
                 phase: old ? old.phase : hash(s.name) * 6.283, jit: hash(s.name + '#'), reach: old ? old.reach : 0, tipX: 0, tipY: 0 };
      });
      skills.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      count.textContent = skills.length + ' net skill' + (skills.length === 1 ? '' : 's') + ' · ' + (d.neuronCount || 0) + ' neurons';
      note.textContent = skills.length ? '' : (d.note || 'The network has no skills yet.');
    }).catch(function () { note.textContent = 'Could not reach the network.'; });
  }

  function tentacle(cx, cy, R, ang, s, time) {
    var len = R * (1.5 + 1.9 * s.size) * (0.8 + 0.4 * s.jit) * s.reach;
    var segs = 30, x = cx + Math.cos(ang) * R * 0.92, y = cy + Math.sin(ang) * R * 0.92;
    var heading = ang, pts = [[x, y]];
    var dir = Math.atan2(look.y, look.x), lean = Math.min(1, Math.hypot(look.x, look.y)) * 0.35;
    for (var i = 1; i <= segs; i++) {
      var u = i / segs;
      var sway = Math.sin(time * 1.1 + s.phase + u * 5.2) * 0.34 * u + Math.sin(time * 0.6 + s.phase * 2 + u * 2.1) * 0.18 * u;
      var pull = Math.sin(dir - heading) * lean * u * 0.4;
      heading += (sway * 0.22 + pull) ;
      x += Math.cos(heading) * len / segs; y += Math.sin(heading) * len / segs;
      pts.push([x, y]);
    }
    return pts;
  }

  function frame(now) {
    var time = (now - t0) / 1000;
    look.x += (lookTo.x - look.x) * 0.06; look.y += (lookTo.y - look.y) * 0.06;
    if (!reduce) spin += 0.0016;
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.165 * (1 + Math.sin(time * 1.4) * 0.015);

    var glow = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 3.4);
    glow.addColorStop(0, 'rgba(255,154,132,.22)'); glow.addColorStop(1, 'rgba(255,154,132,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 3.4, 0, 6.2832); ctx.fill();

    var n = skills.length;
    for (var k = 0; k < n; k++) {
      var s = skills[k];
      s.reach += (1 - s.reach) * 0.04;
      var ang = spin + (k / n) * 6.2832;
      var pts = tentacle(cx, cy, R, ang, s, time);
      var thick = Math.min(R * (0.2 + 0.1 * s.size), (6.2832 * R / Math.max(n, 1)) * 0.55);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (var i = pts.length - 1; i > 0; i--) {
        var u = i / (pts.length - 1);
        ctx.strokeStyle = k === hover ? 'rgba(255,196,180,' + (0.95 - u * 0.25) + ')' : 'rgba(' + Math.round(232 + 23 * (1 - u)) + ',' + Math.round(112 + 42 * (1 - u)) + ',' + Math.round(90 + 42 * (1 - u)) + ',' + (0.9 - u * 0.35) + ')';
        ctx.lineWidth = Math.max(1.5, thick * (1 - u * 0.88));
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
      var tp = pts[pts.length - 1]; s.tipX = tp[0]; s.tipY = tp[1];
      var bead = ctx.createRadialGradient(tp[0], tp[1], 0, tp[0], tp[1], thick * 0.9);
      bead.addColorStop(0, 'rgba(255,230,220,.95)'); bead.addColorStop(1, 'rgba(255,154,132,0)');
      ctx.fillStyle = bead; ctx.beginPath(); ctx.arc(tp[0], tp[1], thick * 0.9, 0, 6.2832); ctx.fill();
    }

    var body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#6b3a3e'); body.addColorStop(0.6, '#3a1d22'); body.addColorStop(1, '#1d0f13');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,180,.35)'; ctx.lineWidth = 1.2; ctx.stroke();

    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointermove', function (e) {
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    lookTo.x = (x - W / 2) / (W / 2); lookTo.y = (y - H / 2) / (H / 2);
    var best = -1, bd = 26 * 26;
    skills.forEach(function (s, i) { var d = (s.tipX - x) * (s.tipX - x) + (s.tipY - y) * (s.tipY - y); if (d < bd) { bd = d; best = i; } });
    hover = best;
    if (best >= 0) {
      tip.textContent = skills[best].name + ' · ' + skills[best].neurons + ' neuron' + (skills[best].neurons === 1 ? '' : 's');
      tip.style.left = skills[best].tipX + 'px'; tip.style.top = skills[best].tipY + 'px'; tip.style.opacity = '1';
    } else tip.style.opacity = '0';
  });
  canvas.addEventListener('pointerleave', function () { lookTo.x = 0; lookTo.y = 0; hover = -1; tip.style.opacity = '0'; });
  window.addEventListener('resize', resize);

  resize(); load(); setInterval(load, 15000);
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`;
