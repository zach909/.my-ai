/**
 * The Hive page (/hive): a legend for the background scene, with names on hover.
 *
 * The scene itself is the page background everywhere (interface/ambient.ts): a green shoggoth lives in the
 * big sphere, its tentacles are the net skills, held in by the crown, and every hive agent has a small
 * sphere and shoggoth of its own. This page only reads the tip positions the background publishes and
 * shows the name under the pointer, as text, never as markup. Nothing is fetched from anywhere.
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
  main { position:relative; z-index:2; max-width:1100px; margin:0 auto; padding:28px 16px 60px; display:grid; grid-template-columns:minmax(0,1fr); gap:10px; pointer-events:none; }
  h1 { font-size:22px; margin:6px 6px 0; }
  .bar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; margin:0 8px; font-size:14px; }
  #tip { position:fixed; z-index:3; pointer-events:none; opacity:0; transform:translate(-50%,-130%); padding:8px 14px; border-radius:999px; font-size:13px;
         background:rgba(20,12,14,.72); border:1px solid rgba(255,154,132,.5); color:#ffc4b4; white-space:nowrap; transition:opacity .2s ease; }
</style>
</head>
<body class="nc-soft">
<main>
  <h1>Hive</h1>
  <div class="bar">
    <span class="nc-dim">The shoggoth lives in the big sphere and its tentacles are the net skills, one each, held in by the crown. Every hive agent has a small sphere and shoggoth of its own.</span>
    <span id="note" class="nc-dim"></span>
  </div>
</main>
<div id="tip"></div>
<script>
(function () {
  var tip = document.getElementById('tip');
  var note = document.getElementById('note');
  setTimeout(function () { if (!window.ncAmbient) note.textContent = 'The background is turned off in Settings > Appearance.'; }, 1500);
  document.addEventListener('pointermove', function (e) {
    var tips = window.ncAmbient && window.ncAmbient.tips ? window.ncAmbient.tips() : [];
    var best = null, bd = 26 * 26;
    tips.forEach(function (t) { var d = (t.x - e.clientX) * (t.x - e.clientX) + (t.y - e.clientY) * (t.y - e.clientY); if (d < bd) { bd = d; best = t; } });
    if (best) { tip.textContent = best.label; tip.style.left = best.x + 'px'; tip.style.top = best.y + 'px'; tip.style.opacity = '1'; }
    else tip.style.opacity = '0';
  });
})();
</script>
</body>
</html>
`;
