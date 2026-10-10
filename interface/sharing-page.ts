/**
 * The Sharing page (/sharing): data donor, lending and borrowing compute, and
 * the apps allowed to call Corona.
 *
 * Wears the house look (see AGENTS.md, VISUAL STYLE): the server adds the ring
 * and background, this page only uses the shared tokens and shapes. Plain DOM
 * calls and textContent, never innerHTML with data, so nothing a peer or an app
 * is named can run as markup. Nothing is fetched from anywhere but this server.
 */
export const SHARING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sharing</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; background:#110c0e; color:#f8ede9; }
  main { position:relative; z-index:1; max-width:760px; margin:0 auto; padding:28px 16px 80px; display:grid; gap:18px; }
  h1 { font-size:22px; margin:6px 6px 0; }
  h2 { font-size:17px; margin:0 0 4px; }
  section { padding:24px 26px; }
  p { margin:6px 0 12px; font-size:14px; line-height:1.5; }
  .row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:10px 0; }
  .row > .grow { flex:1 1 140px; min-width:0; }
  .item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:10px 14px; margin:8px 0;
          background:rgba(255,240,232,.06); border:1px solid rgba(255,228,218,.14); border-radius:24px; font-size:14px; }
  .item small { display:block; color:rgba(248,237,233,.62); }
  .on { color:#8fe3a8; } .err { color:#ff9aa8; }
  .tok { word-break:break-all; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; padding:12px 16px;
         background:rgba(20,12,14,.5); border:1px solid rgba(255,154,132,.5); border-radius:24px; margin:10px 0; }
  label.chk { display:inline-flex; gap:6px; align-items:center; font-size:14px; margin-right:12px; }
  input[type=checkbox] { accent-color:#ff9a84; }
  #msg { min-height:20px; margin:0 8px; font-size:14px; }
  textarea.nc-input { border-radius:24px; width:100%; box-sizing:border-box; min-height:70px; resize:vertical; }
</style>
</head>
<body class="nc-soft">
<main>
  <h1>Sharing</h1>
  <div id="msg" class="nc-dim"></div>

  <section class="nc-glass">
    <h2>Data donor</h2>
    <p class="nc-dim">Lets this computer's screen and microphone become training data for this computer's own network. It stays on this device: there is no upload. Off until you turn it on, and you can pause, stop or erase at any time.</p>
    <div id="donor-state"></div>
    <div class="row" id="donor-sources"></div>
    <div class="row">
      <button class="nc-btn" data-pause="30">Pause 30 min</button>
      <button class="nc-btn" data-pause="480">Pause 8 h</button>
      <button class="nc-btn" data-pause="0">Resume</button>
      <button class="nc-btn" id="donor-erase">Erase what was captured</button>
    </div>
  </section>

  <section class="nc-glass">
    <h2>Lend this computer</h2>
    <p class="nc-dim">Time other people use your computer earns credit. Guests can only ask it to think (chat); they get no files, no shell and no screen. Each lease has an hour limit and a compute cap, and you can end it whenever you like. What a guest asks is visible to this computer.</p>
    <div class="row">
      <label class="chk"><input type="checkbox" id="lend-on"> Lending is on</label>
      <span id="balance" class="nc-dim"></span>
    </div>
    <div class="row">
      <input class="nc-input grow" id="l-label" placeholder="Who is it for?" maxlength="64">
      <input class="nc-input" id="l-hours" type="number" min="0.25" max="24" step="0.25" value="1" style="width:90px" title="Hours">
      <input class="nc-input" id="l-cap" type="number" min="1" step="1" value="600" style="width:100px" title="Compute cap (CU)">
      <button class="nc-btn primary" id="l-grant">Grant lease</button>
    </div>
    <div id="l-token"></div>
    <div id="leases"></div>
  </section>

  <section class="nc-glass">
    <h2>Use someone else's computer</h2>
    <p class="nc-dim">Spend the credit you earned. Add a computer with the address and the lease token its owner gave you.</p>
    <div class="row">
      <input class="nc-input grow" id="p-name" placeholder="Name" maxlength="64">
      <input class="nc-input grow" id="p-url" placeholder="http://192.168.1.20:7861">
      <input class="nc-input grow" id="p-token" placeholder="Lease token (cl_...)" type="password" autocomplete="off">
      <button class="nc-btn" id="p-add">Add</button>
    </div>
    <div id="peers"></div>
    <textarea class="nc-input" id="b-prompt" placeholder="Ask it something"></textarea>
    <div class="row"><select class="nc-input" id="b-peer"></select><button class="nc-btn primary" id="b-go">Ask</button></div>
    <div id="b-out" class="nc-dim"></div>
    <div id="ledger"></div>
  </section>

  <section class="nc-glass">
    <h2>Apps</h2>
    <p class="nc-dim">Programs and store apps that may call Corona's API. Nothing is allowed unless you tick it. A token is shown once.</p>
    <div class="row">
      <input class="nc-input grow" id="a-name" placeholder="App name" maxlength="64">
      <button class="nc-btn primary" id="a-add">Register</button>
    </div>
    <div class="row" id="a-scopes"></div>
    <div id="a-token"></div>
    <div id="apps"></div>
  </section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function say(t, bad) { var m = $('msg'); m.textContent = t || ''; m.className = bad ? 'err' : 'nc-dim'; }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Failed (' + r.status + ')')); return j; }); });
  }
  function act(p) { return p.then(function (r) { say(''); refresh(); return r; }, function (e) { say(e.message, true); throw e; }); }
  function item(title, sub, buttons) {
    var left = el('div', {}, [el('div', { text: title })].concat(sub ? [el('small', { text: sub })] : []));
    return el('div', { class: 'item' }, [left, el('div', {}, buttons || [])]);
  }
  function btn(text, fn) { var b = el('button', { class: 'nc-btn', text: text }); b.addEventListener('click', fn); return b; }
  function fix(n) { return (Math.round(n * 100) / 100).toString(); }

  var DISCLOSE = {};
  var SCOPES = [];

  function renderDonor(d) {
    DISCLOSE = d.disclosure;
    var s = $('donor-state'); s.textContent = '';
    s.appendChild(el('div', { class: d.anyRecording ? 'on' : 'nc-dim', text: d.anyRecording ? 'Recording now' : 'Not recording' }));
    s.appendChild(el('div', { class: 'nc-dim', text: d.spool.chunks + ' chunks waiting for training (' + fix(d.spool.bytes / 1048576) + ' MB)' + (d.settings.pausedUntil && d.settings.pausedUntil > Date.now() ? ' - paused' : '') }));
    var box = $('donor-sources'); box.textContent = '';
    var master = el('input', { type: 'checkbox' }); master.checked = d.settings.enabled;
    master.addEventListener('change', function () { act(api('POST', '/api/donor', { enabled: master.checked })); });
    box.appendChild(el('label', { class: 'chk' }, [master, el('span', { text: 'Donor on' })]));
    ['screen', 'audio'].forEach(function (src) {
      var c = el('input', { type: 'checkbox' }); c.checked = d.settings.sources[src];
      c.addEventListener('change', function () {
        var want = c.checked;
        if (want && !confirm('This will capture:\\n\\n' + DISCLOSE[src] + '\\n\\nTurn it on?')) { c.checked = false; return; }
        act(api('POST', '/api/donor', { sources: (function () { var o = {}; o[src] = want; return o; })(), acknowledge: true })).catch(function () { c.checked = !want; });
      });
      box.appendChild(el('label', { class: 'chk' }, [c, el('span', { text: src === 'screen' ? 'Screen' : 'Microphone' })]));
    });
  }

  function renderCompute(c) {
    $('lend-on').checked = c.lending;
    $('balance').textContent = 'Credit: ' + fix(c.balance) + ' CU (can go down to -' + fix(c.creditLimit) + ')' + (c.mops ? ' - this computer: ' + fix(c.mops) + ' Mops' : '');
    var L = $('leases'); L.textContent = '';
    c.leases.slice().reverse().forEach(function (l) {
      var state = l.problem ? l.problem : 'Active until ' + new Date(l.expiresAt).toLocaleString();
      var b = l.problem ? [] : [btn('End', function () { act(api('POST', '/api/compute/leases/' + l.id + '/revoke', {})); })];
      L.appendChild(item(l.label, state + ' - used ' + fix(l.usedCu) + ' of ' + fix(l.capCu) + ' CU', b));
    });
    var P = $('peers'); P.textContent = '';
    var sel = $('b-peer'); sel.textContent = '';
    c.peers.forEach(function (p) {
      P.appendChild(item(p.name, p.baseUrl, [btn('Remove', function () { act(api('DELETE', '/api/compute/peers/' + p.id)); })]));
      sel.appendChild(el('option', { value: p.id, text: p.name }));
    });
    var G = $('ledger'); G.textContent = '';
    c.entries.slice(0, 10).forEach(function (e) {
      G.appendChild(item((e.kind === 'earned' ? '+' : '-') + fix(e.cu) + ' CU - ' + e.who, new Date(e.at).toLocaleString() + ' - ' + e.note));
    });
  }

  function renderApps(a) {
    SCOPES = a.scopes;
    var sc = $('a-scopes');
    if (!sc.childNodes.length) {
      a.scopes.forEach(function (s) { sc.appendChild(el('label', { class: 'chk' }, [el('input', { type: 'checkbox', 'data-scope': s }), el('span', { text: s })])); });
    }
    var A = $('apps'); A.textContent = '';
    a.apps.filter(function (x) { return !x.revokedAt; }).forEach(function (x) {
      A.appendChild(item(x.name, (x.scopes.length ? x.scopes.join(', ') : 'no permissions') + (x.lastUsedAt ? ' - last used ' + new Date(x.lastUsedAt).toLocaleString() : ' - never used'),
        [btn('Revoke', function () { if (confirm('Revoke ' + x.name + '? Its token stops working immediately.')) act(api('POST', '/api/corona-apps/' + x.id + '/revoke', {})); })]));
    });
  }

  function showToken(into, label, token) {
    into.textContent = '';
    into.appendChild(el('div', { class: 'nc-dim', text: label }));
    into.appendChild(el('div', { class: 'tok', text: token }));
  }

  function refresh() {
    api('GET', '/api/donor').then(renderDonor).catch(function (e) { say(e.message, true); });
    api('GET', '/api/compute').then(renderCompute).catch(function () {});
    api('GET', '/api/corona-apps').then(renderApps).catch(function () {});
  }

  document.querySelectorAll('[data-pause]').forEach(function (b) {
    b.addEventListener('click', function () { act(api('POST', '/api/donor/pause', { minutes: Number(b.getAttribute('data-pause')) })); });
  });
  $('donor-erase').addEventListener('click', function () {
    if (confirm('Delete everything the donor has captured and not yet trained on?')) act(api('DELETE', '/api/donor/data')).then(function (r) { say('Erased ' + r.erased + ' chunks.'); });
  });
  $('lend-on').addEventListener('change', function () { act(api('POST', '/api/compute/lending', { enabled: $('lend-on').checked })); });
  $('l-grant').addEventListener('click', function () {
    act(api('POST', '/api/compute/leases', { label: $('l-label').value, hours: Number($('l-hours').value), capCu: Number($('l-cap').value) }))
      .then(function (r) { showToken($('l-token'), 'Give this token and your address to ' + r.lease.label + '. It is shown once.', r.token); });
  });
  $('p-add').addEventListener('click', function () {
    act(api('POST', '/api/compute/peers', { name: $('p-name').value, baseUrl: $('p-url').value, leaseToken: $('p-token').value })).then(function () { $('p-token').value = ''; });
  });
  $('b-go').addEventListener('click', function () {
    $('b-out').textContent = 'Thinking...';
    act(api('POST', '/api/compute/borrow', { peerId: $('b-peer').value, prompt: $('b-prompt').value }))
      .then(function (r) { $('b-out').textContent = r.result + '  (' + fix(r.cu) + ' CU)'; }, function () { $('b-out').textContent = ''; });
  });
  $('a-add').addEventListener('click', function () {
    var scopes = Array.prototype.map.call(document.querySelectorAll('[data-scope]:checked'), function (c) { return c.getAttribute('data-scope'); });
    act(api('POST', '/api/corona-apps', { name: $('a-name').value, source: 'program', scopes: scopes }))
      .then(function (r) { showToken($('a-token'), 'Token for ' + r.app.name + ' (shown once):', r.token); });
  });

  refresh();
  setInterval(refresh, 15000);
})();
</script>
</body>
</html>`;
