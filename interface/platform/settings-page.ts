/**
 * The Settings page (/settings, also reached as /app/settings).
 *
 * One page for every platform: the browser on a desktop, the Chrome extension's
 * "Open settings", the phone apps' web view. It replaces the old React Settings
 * route, which could not be rebuilt (its toolchain is no longer in the repo) and
 * which lost its layout under about 420px.
 *
 * Wears the house look (AGENTS.md, VISUAL STYLE): the server adds the ring and
 * background, this page only uses the shared tokens and shapes. All text goes in
 * with textContent, never innerHTML, so nothing a server returns can run as
 * markup. Every control either changes something real and says whether it
 * saved, or says why it cannot. Nothing is fetched from anywhere but this
 * server (the update check is made by the server, not by this page).
 */
export const SETTINGS_PAGE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings</title>
<style>
  :root { color-scheme: dark; --ok:#8fe3a8; --err:#ff9aa8; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { min-height: 100vh; background: #110c0e; color: #f8ede9; overflow-x: hidden; }
  main { position: relative; z-index: 1; width: 100%; max-width: 760px; margin: 0 auto; padding: 20px 16px 96px; display: grid; gap: 16px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 24px; margin: 0; }
  h2 { font-size: 18px; margin: 0 0 4px; }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  p { margin: 6px 0 12px; font-size: 14px; line-height: 1.5; }
  a { color: #ffc4b4; }
  .back { text-decoration: none; display: inline-flex; align-items: center; }
  nav[role=tablist] { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 8px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  nav[role=tablist]::-webkit-scrollbar { display: none; }
  nav[role=tablist] .nc-btn { flex: 0 0 auto; white-space: nowrap; min-height: 44px; }
  nav[role=tablist] .nc-btn[aria-selected=true] { color: #ffc4b4; background: rgba(255,154,132,.16); border-color: rgba(255,154,132,.5); }
  section.nc-glass { padding: 22px; min-width: 0; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid rgba(255,228,218,.12); flex-wrap: wrap; }
  .row:first-of-type { border-top: 0; }
  .row > .txt { flex: 1 1 220px; min-width: 0; }
  .row .label { font-weight: 700; font-size: 15px; }
  .row .help { font-size: 13px; margin: 2px 0 0; color: rgba(248,237,233,.62); overflow-wrap: anywhere; }
  .stack { display: grid; gap: 10px; max-width: 420px; }
  .stack label { font-size: 13px; color: rgba(248,237,233,.62); display: grid; gap: 6px; }
  .nc-input { width: 100%; min-width: 0; }
  select.nc-input { appearance: none; padding-right: 36px; background-image: linear-gradient(45deg, transparent 50%, #ffc4b4 50%), linear-gradient(135deg, #ffc4b4 50%, transparent 50%); background-position: calc(100% - 20px) 50%, calc(100% - 15px) 50%; background-size: 5px 5px; background-repeat: no-repeat; background-color: rgba(20,12,14,.4); }
  select.nc-input option { background: #1b1216; color: #f8ede9; }
  input[type=checkbox][role=switch] { appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 52px; height: 32px; border-radius: 999px; background: rgba(255,238,230,.1); border: 1px solid rgba(255,228,218,.28); position: relative; cursor: pointer; transition: background .25s, border-color .25s; margin: 0; }
  input[type=checkbox][role=switch]::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #f8ede9; transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
  input[type=checkbox][role=switch]:checked { background: rgba(255,154,132,.3); border-color: rgba(255,154,132,.7); }
  input[type=checkbox][role=switch]:checked::after { transform: translateX(20px); background: #ffc4b4; }
  input[type=checkbox][role=switch]:disabled { opacity: .5; cursor: default; }
  :focus-visible { outline: 2px solid #ff9a84; outline-offset: 2px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(255,228,218,.2); background: rgba(255,238,230,.07); color: rgba(248,237,233,.62); }
  .badge.ok { color: var(--ok); border-color: rgba(143,227,168,.45); }
  .badge.warn { color: #ffc4b4; border-color: rgba(255,154,132,.5); }
  .badge.bad { color: var(--err); border-color: rgba(255,154,168,.5); }
  .banner { padding: 12px 16px; border-radius: 24px; font-size: 14px; border: 1px solid rgba(255,154,168,.5); background: rgba(255,154,168,.1); color: var(--err); overflow-wrap: anywhere; }
  .banner.ok { border-color: rgba(143,227,168,.45); background: rgba(143,227,168,.08); color: var(--ok); }
  #status { min-height: 22px; font-size: 14px; padding: 0 8px; }
  #status.err { color: var(--err); } #status.ok { color: var(--ok); }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .grid a { display: block; padding: 14px 18px; border-radius: 24px; background: rgba(255,240,232,.06); border: 1px solid rgba(255,228,218,.14); text-decoration: none; color: inherit; min-height: 44px; }
  .grid a b { display: block; color: #ffc4b4; }
  .grid a span { font-size: 13px; color: rgba(248,237,233,.62); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .cap { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; padding: 12px 0; border-top: 1px solid rgba(255,228,218,.12); align-items: center; }
  .cap .help { grid-column: 1 / -1; }
  @media (max-width: 480px) { section.nc-glass { padding: 18px 16px; border-radius: 28px; } .cap { grid-template-columns: 1fr; } .cap select { width: 100%; } h1 { font-size: 22px; } }
  [hidden] { display: none !important; }
</style>
</head>
<body class="nc-soft">
<main>
  <header>
    <h1>Settings</h1>
    <a class="nc-btn back" href="/">Back to chat</a>
  </header>
  <div id="status" role="status" aria-live="polite"></div>
  <div id="persist" class="banner" hidden role="alert"></div>
  <nav role="tablist" aria-label="Settings sections" id="tabs"></nav>
  <section class="nc-glass" id="panel" role="tabpanel" tabindex="-1" aria-live="polite"></section>
</main>
<script>
(function () {
  'use strict';
  var LEVELS = ['observe', 'interact', 'modify', 'execute', 'system', 'privileged'];
  var SECTIONS = [
    ['general', 'General'], ['updates', 'Updates'], ['remote', 'Remote access'], ['access', 'Computer access'], ['aios', 'AI OS'],
    ['safety', 'Safety'], ['data', 'Data'], ['modules', 'More'], ['about', 'About']
  ];
  var tabs = document.getElementById('tabs'), panel = document.getElementById('panel');
  var statusEl = document.getElementById('status'), persistEl = document.getElementById('persist');
  var current = null, statusTimer = null;

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    })(Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function say(msg, kind) {
    statusEl.textContent = msg; statusEl.className = kind || '';
    clearTimeout(statusTimer);
    if (kind === 'ok') statusTimer = setTimeout(function () { statusEl.textContent = ''; statusEl.className = ''; }, 3500);
  }
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    var r;
    try { r = await fetch(path, init); }
    catch (e) { throw new Error('Could not reach the NeuroClaw server. Check that it is running and that this device can reach it.'); }
    var body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    if (r.status === 401) throw new Error('You are not logged in. Open Accounts to log in, then come back.');
    if (r.status === 403) throw new Error((body && body.error) || 'Only the admin can do that.');
    if (!r.ok) throw new Error((body && body.error) || ('The server answered ' + r.status + '.'));
    return body;
  }
  function loading(text) { panel.replaceChildren(h('p', { class: 'nc-dim', text: text || 'Loading...' })); }
  function failed(err, retry) {
    panel.replaceChildren(h('div', { class: 'banner', role: 'alert', text: err.message || String(err) }), h('div', { class: 'actions' }, h('button', { class: 'nc-btn primary', type: 'button', text: 'Try again', onclick: retry })));
  }
  function showPersistence(p) {
    if (p && p.ok === false) { persistEl.textContent = p.error || 'The last change could not be saved.'; persistEl.hidden = false; }
    else persistEl.hidden = true;
  }
  function toggle(id, checked, onchange, label) {
    var input = h('input', { type: 'checkbox', role: 'switch', id: id, 'aria-label': label });
    input.checked = !!checked;
    input.addEventListener('change', async function () {
      var want = input.checked; input.disabled = true;
      try { await onchange(want); }
      catch (e) { input.checked = !want; say(e.message, 'err'); }
      finally { input.disabled = false; }
    });
    return input;
  }
  function setting(label, help, control, forId) {
    return h('div', { class: 'row' }, h('div', { class: 'txt' }, h('label', { class: 'label', for: forId, text: label }), h('p', { class: 'help', text: help })), control);
  }

  /* ---------- General ---------- */
  async function general() {
    var s = await api('/api/app-settings');
    var st = s.settings;
    showPersistence(s.persistence);
    async function save(patch, okMsg) {
      var r = await api('/api/app-settings', { method: 'POST', body: patch });
      st = r.settings; showPersistence(r.persistence); say(okMsg || 'Saved.', 'ok');
      try { localStorage.setItem('nc_appearance', JSON.stringify(st.appearance)); } catch (e) { /* storage blocked */ }
      if (window.ncApplyAppearance) window.ncApplyAppearance(st.appearance);
      return r;
    }
    var rm = h('select', { class: 'nc-input', id: 'reduceMotion', 'aria-label': 'Reduce motion' },
      h('option', { value: 'system', text: 'Follow my device' }), h('option', { value: 'on', text: 'Reduce motion' }), h('option', { value: 'off', text: 'Full motion' }));
    rm.value = st.appearance.reduceMotion;
    rm.addEventListener('change', async function () { var prev = st.appearance.reduceMotion; try { await save({ appearance: { reduceMotion: rm.value } }); } catch (e) { rm.value = prev; say(e.message, 'err'); } });
    panel.replaceChildren(
      h('h2', { text: 'General' }),
      h('p', { class: 'nc-dim', text: 'These apply to every device that uses this server.' }),
      h('h3', { text: 'Appearance' }),
      setting('Ring and glow background', 'Turn off for a plain dark background. Saves battery on phones.', toggle('ambient', st.appearance.ambient, function (v) { return save({ appearance: { ambient: v } }); }, 'Ring and glow background'), 'ambient'),
      setting('Reduce motion', 'Follow my device uses your system setting. Reduce motion keeps the ring nearly still.', rm, 'reduceMotion'),
      h('h3', { text: 'Chat' }),
      setting('Remember the chat on this device', 'Keeps the conversation on the home page in this browser. Off clears it when the page reloads.', toggle('keepLocalHistory', st.chat.keepLocalHistory, function (v) {
        return save({ chat: { keepLocalHistory: v } }).then(function () { try { localStorage.setItem('nc_keep_hist', v ? '1' : '0'); if (!v) localStorage.removeItem('nc_hist'); } catch (e) { /* storage blocked */ } });
      }, 'Remember the chat on this device'), 'keepLocalHistory')
    );
  }

  /* ---------- Updates ---------- */
  async function updates() {
    var s = await api('/api/app-settings'), info = await api('/api/app-info');
    var st = s.settings;
    var result = h('div', { id: 'update-result', 'aria-live': 'polite' });
    var checkBtn = h('button', { class: 'nc-btn primary', type: 'button', id: 'check-update', text: 'Check for updates' });
    async function save(patch) { var r = await api('/api/app-settings', { method: 'POST', body: patch }); st = r.settings; showPersistence(r.persistence); say('Saved.', 'ok'); }
    function render(u) {
      var kids = [];
      var cls = u.state === 'current' ? 'ok' : u.state === 'available' ? 'warn' : u.state === 'failed' ? 'bad' : '';
      var word = { current: 'Up to date', available: 'Update available', failed: 'Check failed', unconfigured: 'Not checked' }[u.state] || u.state;
      kids.push(h('p', null, h('span', { class: 'badge ' + cls, text: word }), ' ', u.message));
      if (u.artifact) {
        kids.push(h('div', { class: 'row' }, h('div', { class: 'txt' },
          h('div', { class: 'label', text: u.artifact.name }),
          h('p', { class: 'help', text: Math.round(u.artifact.size / 1024 / 1024 * 10) / 10 + ' MB, ' + (u.artifact.signing === 'signed' ? 'code-signed' : 'not code-signed') }),
          h('p', { class: 'help mono', text: 'SHA-256 ' + u.artifact.sha256 }),
          h('p', { class: 'help', text: 'Download it from the releases page, compare the SHA-256 with the line above, then open it. NeuroClaw never installs an update by itself.' })
        ), h('a', { class: 'nc-btn primary', href: 'https://github.com/zach909/.my-ai/releases', target: '_blank', rel: 'noopener', text: 'Open releases' })));
      }
      if (u.checkedAt) kids.push(h('p', { class: 'help nc-dim', text: 'Checked ' + new Date(u.checkedAt).toLocaleString() }));
      result.replaceChildren.apply(result, kids);
    }
    async function check() {
      checkBtn.disabled = true; result.replaceChildren(h('p', { class: 'nc-dim', text: 'Checking...' }));
      try { render(await api('/api/app-update')); }
      catch (e) { render({ state: 'failed', message: e.message }); }
      finally { checkBtn.disabled = false; }
    }
    checkBtn.addEventListener('click', check);
    var channel = h('select', { class: 'nc-input', id: 'channel', 'aria-label': 'Update channel' }, h('option', { value: 'stable', text: 'Stable' }), h('option', { value: 'beta', text: 'Beta' }));
    channel.value = st.updates.channel;
    channel.addEventListener('change', async function () { var prev = st.updates.channel; try { await save({ updates: { channel: channel.value } }); } catch (e) { channel.value = prev; say(e.message, 'err'); } });
    var addr = h('input', { class: 'nc-input', id: 'manifestUrl', type: 'url', inputmode: 'url', 'aria-label': 'Update address', placeholder: 'https://...' });
    addr.value = st.updates.manifestUrl;
    var saveAddr = h('button', { class: 'nc-btn', type: 'button', id: 'save-address', text: 'Save address', onclick: async function () { try { await save({ updates: { manifestUrl: addr.value } }); addr.value = st.updates.manifestUrl; } catch (e) { say(e.message, 'err'); } } });
    panel.replaceChildren(
      h('h2', { text: 'Updates' }),
      h('p', null, 'This is version ', h('b', { text: info.version }), info.build.packaged ? ' (' + info.build.channel + ' build, commit ' + String(info.build.commit).slice(0, 8) + ').' : ' from source' + (info.build.commit ? ', commit ' + info.build.commit.slice(0, 8) : '') + '.'),
      h('p', { class: 'nc-dim', text: 'How updates reach you on ' + info.server.label + ': ' + ({ 'manual-download': 'you download and run the new installer yourself', 'chrome-web-store': 'Chrome updates the extension for you', 'play-store': 'through Google Play', 'app-store': 'through the App Store', 'package-manager': 'through your package manager' }[info.server.updateMechanism]) + '.' }),
      h('div', { class: 'actions' }, checkBtn), result,
      h('h3', { text: 'Options' }),
      setting('Update channel', 'Stable only offers finished releases.', channel, 'channel'),
      setting('Check when Settings opens', 'Contacts the update address below. Off by default.', toggle('checkAutomatically', st.updates.checkAutomatically, function (v) { return save({ updates: { checkAutomatically: v } }); }, 'Check when Settings opens'), 'checkAutomatically'),
      h('div', { class: 'row' }, h('div', { class: 'txt' }, h('label', { class: 'label', for: 'manifestUrl', text: 'Update address' }), h('p', { class: 'help', text: 'Where the release manifest is published. https only (or a local address). Empty turns checks off.' }), addr), saveAddr)
    );
    render({ state: 'unconfigured', message: 'Press "Check for updates" to look for a newer version.' });
    if (st.updates.checkAutomatically) check();
  }

  /* ---------- Remote access ---------- */
  async function remote() {
    var st = await api('/api/auth/status');
    var min = st.minPasswordLength || 8;
    var cur = h('input', { class: 'nc-input', id: 'cur', type: 'password', autocomplete: 'current-password' });
    var nw = h('input', { class: 'nc-input', id: 'new', type: 'password', autocomplete: 'new-password' });
    var cf = h('input', { class: 'nc-input', id: 'confirm', type: 'password', autocomplete: 'new-password' });
    var go = h('button', { class: 'nc-btn primary', type: 'button', text: st.passwordSet ? 'Change password' : 'Set password' });
    go.addEventListener('click', async function () {
      if (nw.value.length < min) return say('The password must be at least ' + min + ' characters.', 'err');
      if (nw.value !== cf.value) return say('The two passwords do not match.', 'err');
      go.disabled = true;
      try { await api('/api/auth/password', { method: 'POST', body: { password: nw.value, current: cur.value || undefined } }); say(st.passwordSet ? 'Password changed.' : 'Password set. Remote access is now protected.', 'ok'); remote().catch(function (e) { failed(e, remote); }); }
      catch (e) { say(e.message, 'err'); go.disabled = false; }
    });
    var out = st.loggedIn ? h('button', { class: 'nc-btn', type: 'button', text: 'Log out on this device', onclick: async function () { try { await api('/api/auth/logout', { method: 'POST', body: {} }); say('Logged out on this device.', 'ok'); remote().catch(function (e) { failed(e, remote); }); } catch (e) { say(e.message, 'err'); } } }) : null;
    panel.replaceChildren(
      h('h2', { text: 'Remote access' }),
      h('p', { class: 'nc-dim', text: 'The password that guards this server from every device except the computer it runs on. Your phone and Chromebook sign in with it.' }),
      h('div', { class: 'banner' + (st.passwordSet ? ' ok' : ''), text: st.passwordSet ? 'A password is set.' + (st.loggedIn ? ' You are signed in on this device.' : '') : 'No password is set. Anyone who can reach this server over the network can use it.' }),
      h('div', { class: 'stack', style: 'margin-top:14px' },
        st.passwordSet ? h('label', null, 'Current password (not needed on the computer that runs the server)', cur) : null,
        h('label', null, st.passwordSet ? 'New password' : 'Set a password', nw),
        h('label', null, 'Confirm', cf),
        h('div', { class: 'actions' }, go, out))
    );
  }

  /* ---------- Computer access ---------- */
  async function access() {
    var d = await api('/api/access');
    showPersistence(d.persistence);
    var kids = [h('h2', { text: 'Computer access' }), h('p', { class: 'nc-dim', text: 'What the agent may do on the computer that runs the server. Everything is off until granted.' }), h('h3', { text: 'Master switches' })];
    async function refresh() { access().catch(function (e) { failed(e, access); }); }
    d.switches.forEach(function (sw) {
      kids.push(setting(sw.label, sw.description + (sw.on && !sw.effective ? ' (overridden by the master switch)' : ''), toggle('sw-' + sw.name, sw.on, async function (v) { var r = await api('/api/access/switch', { method: 'POST', body: { name: sw.name, on: v } }); showPersistence(r.persistence); say(r.persistence && r.persistence.ok === false ? 'Changed for now, but not saved.' : 'Saved.', r.persistence && r.persistence.ok === false ? 'err' : 'ok'); refresh(); }, sw.label), 'sw-' + sw.name));
    });
    kids.push(h('h3', { text: 'What each capability may do' }));
    d.capabilities.forEach(function (c) {
      var sel = h('select', { class: 'nc-input', id: 'cap-' + c.capability, 'aria-label': c.capability + ' level' }, h('option', { value: '', text: 'Off' }));
      LEVELS.slice(LEVELS.indexOf(c.minimum)).forEach(function (l) { sel.appendChild(h('option', { value: l, text: l })); });
      sel.value = c.level || '';
      sel.addEventListener('change', async function () {
        var prev = c.level || '';
        try { var r = await api('/api/access/capability', { method: 'POST', body: { capability: c.capability, level: sel.value || null } }); showPersistence(r.persistence); say('Saved.', 'ok'); refresh(); }
        catch (e) { sel.value = prev; say(e.message, 'err'); }
      });
      kids.push(h('div', { class: 'cap' }, h('div', null, h('span', { class: 'label', text: c.capability }), ' ', h('span', { class: 'badge ' + (c.effective ? 'ok' : ''), text: c.effective ? 'allowed' : c.blockedBySwitch ? 'blocked by ' + c.blockedBySwitch + ' switch' : 'off' })), sel, h('p', { class: 'help', text: 'Lowest level you can grant: ' + c.minimum + '.' })));
    });
    panel.replaceChildren.apply(panel, kids);
  }

  /* ---------- Safety ---------- */
  async function safety() {
    var s = await api('/api/safety');
    var kids = [h('h2', { text: 'Safety' }), h('p', { class: 'nc-dim', text: 'Tools that can change your computer ask before they run. Turn a question off only for a tool you trust.' })];
    kids.push(h('h3', { text: 'Ask before using' }));
    s.tools.forEach(function (t) {
      kids.push(setting(t.label, t.why, toggle('ask-' + t.id, t.ask, async function (v) { await api('/api/safety/tools', { method: 'POST', body: { id: t.id, ask: v } }); say('Saved.', 'ok'); }, 'Ask before using ' + t.label), 'ask-' + t.id));
    });
    var steps = h('input', { class: 'nc-input', id: 'maxSteps', type: 'number', min: '1', max: String(s.autoContinue.max), value: String(s.autoContinue.maxSteps), 'aria-label': 'Most steps in a row' });
    steps.addEventListener('change', async function () { try { await api('/api/safety/auto-continue', { method: 'POST', body: { maxSteps: Number(steps.value) } }); say('Saved.', 'ok'); } catch (e) { say(e.message, 'err'); safety().catch(function (er) { failed(er, safety); }); } });
    kids.push(h('h3', { text: 'Keep going on its own' }));
    kids.push(setting('Continue after a step', 'Let the agent chain steps without asking after each.', toggle('autoContinue', s.autoContinue.enabled, async function (v) { await api('/api/safety/auto-continue', { method: 'POST', body: { enabled: v } }); say('Saved.', 'ok'); }, 'Continue after a step'), 'autoContinue'));
    kids.push(setting('Most steps in a row', 'Between 1 and ' + s.autoContinue.max + '.', steps, 'maxSteps'));
    var phrase = h('input', { class: 'nc-input', id: 'phrase', type: 'text', autocomplete: 'off', placeholder: s.completeAccessPhrase, 'aria-label': 'Type the phrase to give complete access' });
    var ca = h('button', { class: s.fullAccess ? 'nc-btn' : 'nc-btn primary', type: 'button', text: s.fullAccess ? 'Turn complete access off' : 'Give complete access' });
    ca.addEventListener('click', async function () {
      try { await api('/api/safety/complete-access', { method: 'POST', body: s.fullAccess ? { on: false } : { on: true, phrase: phrase.value } }); say(s.fullAccess ? 'Complete access is off.' : 'Complete access is on.', 'ok'); safety().catch(function (e) { failed(e, safety); }); }
      catch (e) { say(e.message, 'err'); }
    });
    kids.push(h('h3', { text: 'Complete access' }));
    kids.push(h('div', { class: 'banner' + (s.fullAccess ? '' : ' ok'), text: s.fullAccess ? 'Complete access is ON: every capability is granted and nothing asks first.' : 'Complete access is off.' }));
    kids.push(h('div', { class: 'stack', style: 'margin-top:12px' }, s.fullAccess ? null : h('label', null, 'To turn it on, type: ' + s.completeAccessPhrase, phrase), h('div', { class: 'actions' }, ca)));
    panel.replaceChildren.apply(panel, kids);
  }

  /* ---------- Data ---------- */
  async function data() {
    var file = h('input', { type: 'file', id: 'import-file', accept: '.zip,application/zip', class: 'nc-input', 'aria-label': 'Chat export to import' });
    var imp = h('button', { class: 'nc-btn', type: 'button', text: 'Import chats' });
    imp.addEventListener('click', async function () {
      var f = file.files && file.files[0];
      if (!f) return say('Choose a chat export (.zip) first.', 'err');
      imp.disabled = true;
      try {
        var buf = new Uint8Array(await f.arrayBuffer()), bin = '';
        for (var i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        var r = await api('/api/chat-history/import', { method: 'POST', body: { zip: btoa(bin) } });
        say('Imported. ' + (r.imported != null ? r.imported + ' chats added.' : 'Done.'), 'ok');
      } catch (e) { say(e.message, 'err'); } finally { imp.disabled = false; }
    });
    var confirmBox = h('input', { class: 'nc-input', id: 'confirm-delete', type: 'text', autocomplete: 'off', placeholder: 'delete everything', 'aria-label': 'Type delete everything to confirm' });
    var del = h('button', { class: 'nc-btn', type: 'button', text: 'Forget everything' });
    del.addEventListener('click', async function () {
      if (confirmBox.value !== 'delete everything') return say('Type "delete everything" exactly to confirm.', 'err');
      del.disabled = true;
      try { var r = await api('/api/memory/all', { method: 'DELETE', body: { confirm: 'delete everything' } }); try { localStorage.removeItem('nc_hist'); } catch (e) { /* storage blocked */ } confirmBox.value = ''; say('Forgot ' + r.memories + ' memories, ' + r.threads + ' chats and ' + r.rooms + ' rooms.', 'ok'); }
      catch (e) { say(e.message, 'err'); } finally { del.disabled = false; }
    });
    panel.replaceChildren(
      h('h2', { text: 'Data' }),
      h('h3', { text: 'Back up your chats' }),
      h('p', { class: 'nc-dim', text: 'Download every chat as one file to keep before resetting a computer. Importing never overwrites a chat that is already here.' }),
      h('div', { class: 'actions' }, h('a', { class: 'nc-btn primary', href: '/api/chat-history/export', download: '', text: 'Download chats' })),
      h('div', { class: 'stack', style: 'margin-top:12px' }, h('label', null, 'Import a chat export', file), h('div', { class: 'actions' }, imp)),
      h('h3', { text: 'Forget everything' }),
      h('p', { class: 'nc-dim', text: 'Deletes every remembered item, every chat and every shared chat room on this server. This cannot be undone.' }),
      h('div', { class: 'stack' }, h('label', null, 'Type delete everything to confirm', confirmBox), h('div', { class: 'actions' }, del))
    );
  }

  /* ---------- More ---------- */
  function modules() {
    var links = [
      ['/accounts', 'Accounts', 'Admin and user accounts; each person keeps their own data.'],
      ['/commons', 'Commons', 'Points, leaderboard, projects and the hive.'],
      ['/sharing', 'Sharing', 'Data donation, lending compute, apps.'],
      ['/app/store', 'Store', 'Browse and publish skills, plugins and files.'],
      ['/builder', 'Extension Builder', 'Build, train and deploy extensions.'],
      ['/app/self-improvement', 'Self-improvement', 'What the background agents have learned.'],
      ['/app', 'Full dashboard', 'The older dashboard. Needs a device with WebGL for its animation.']
    ];
    panel.replaceChildren(h('h2', { text: 'More' }), h('p', { class: 'nc-dim', text: 'Other pages of the app.' }),
      h('div', { class: 'grid' }, links.map(function (l) { return h('a', { href: l[0] }, h('b', { text: l[1] }), h('span', { text: l[2] })); })));
  }

  /* ---------- AI OS mode ---------- */
  async function aios() {
    var s = await api('/api/ai-os');
    var badge = h('span', { class: 'badge', id: 'aios-state' });
    var outcome = h('p', { class: 'help', id: 'aios-outcome', role: 'status' });
    function paint(x) { s = x; badge.className = 'badge' + (x.enabled ? ' ok' : ''); badge.textContent = x.enabled ? 'On' : 'Off'; }
    paint(s);
    var sw = toggle('aios', s.enabled, async function (v) {
      outcome.textContent = '';
      var r = await api('/api/ai-os', { method: 'POST', body: { enabled: v } });
      paint(r.status); outcome.textContent = r.result.message; say(v ? 'AI OS mode is on.' : 'AI OS mode is off.', 'ok');
    }, 'Start NeuroClaw when I sign in');
    sw.disabled = !s.supported || !s.canChange;
    var bullets = [
      'Runs the engine in the background from sign-in, with no window open, so the AI is ready the moment you open a window, a browser tab or the Chrome extension on this computer. It listens on this computer only, unless you have set the server up for other devices (which needs a password).',
      'Gives the agent no extra access. Computer access, tool safety and approvals work exactly as before.',
      'Does not start a second copy right now. The engine you are using keeps running, and the computer starts it from your next sign-in.',
      'Changes only your own account, with no administrator rights. Turn the switch off, or run "node scripts/ai-os.mjs disable", to undo it completely.'
    ];
    panel.replaceChildren(
      h('h2', { text: 'AI OS mode' }),
      h('p', { class: 'nc-dim', text: 'Make this computer one where the AI is always there, instead of an app you have to open.' }),
      s.supported ? setting('Start NeuroClaw when I sign in', s.summary, h('span', null, badge, ' ', sw), 'aios') : h('p', { class: 'help', id: 'aios-reason', text: s.reason }),
      s.supported && !s.canChange ? h('p', { class: 'help', id: 'aios-locked', text: 'Only the admin, sitting at this computer, can change this. From a terminal on it: node scripts/ai-os.mjs enable' }) : null,
      outcome,
      h('h3', { text: 'What it does, and what it does not' }),
      h('ul', { style: 'margin:6px 0 0;padding-left:20px;display:grid;gap:8px;font-size:14px;line-height:1.5' }, bullets.map(function (b) { return h('li', { text: b }); }))
    );
  }

  /* ---------- About ---------- */
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });
  async function about() {
    var info = await api('/api/app-info');
    var rows = info.client.capabilities.map(function (c) {
      return h('div', { class: 'row' }, h('div', { class: 'txt' }, h('div', { class: 'label', text: c.id }), c.note ? h('p', { class: 'help', text: c.note }) : null), h('span', { class: 'badge ' + (c.status === 'supported' ? 'ok' : c.status === 'limited' ? 'warn' : 'bad'), text: c.status }));
    });
    var inst = h('button', { class: 'nc-btn primary', type: 'button', text: 'Install this app', onclick: async function () { if (!installPrompt) return say('Use your browser menu: "Install app" or "Add to Home screen".', 'ok'); installPrompt.prompt(); installPrompt = null; } });
    var b = info.build;
    panel.replaceChildren(
      h('h2', { text: 'About' }),
      h('div', { class: 'row' }, h('div', { class: 'txt' }, h('div', { class: 'label', text: 'NeuroClaw ' + info.version }), h('p', { class: 'help mono', text: (b.packaged ? b.channel + ' build' : 'built from source') + (b.commit ? ', commit ' + b.commit : '') + (b.platform ? ', ' + b.platform + '/' + b.arch : '') + (b.builtAt ? ', ' + b.builtAt : '') }))),
      h('div', { class: 'row' }, h('div', { class: 'txt' }, h('div', { class: 'label', text: 'Engine runs on' }), h('p', { class: 'help', text: info.server.label + ': ' + info.server.engineHost })), null),
      h('div', { class: 'row' }, h('div', { class: 'txt' }, h('div', { class: 'label', text: 'This device' }), h('p', { class: 'help', text: info.client.label + ': ' + info.client.uiHost })), inst),
      h('h3', { text: 'What works on ' + info.client.label }),
      h('p', { class: 'nc-dim', text: 'Honest list. "limited" and "unavailable" say why in plain words.' }),
      h('div', null, rows),
      h('h3', { text: 'Features here' }),
      h('div', null, info.features.map(function (f) { return h('div', { class: 'row' }, h('div', { class: 'txt' }, h('div', { class: 'label', text: f.title }), f.support.reason ? h('p', { class: 'help', text: f.support.reason }) : null, f.needsNetwork ? h('p', { class: 'help', text: 'Needs a network connection.' }) : null), h('span', { class: 'badge ' + (f.support.status === 'supported' ? 'ok' : f.support.status === 'limited' ? 'warn' : 'bad'), text: f.support.status })); }))
    );
  }

  var RENDER = { general: general, updates: updates, remote: remote, access: access, aios: aios, safety: safety, data: data, modules: modules, about: about };

  function select(id, focus) {
    if (!RENDER[id]) id = 'general';
    current = id;
    Array.prototype.forEach.call(tabs.children, function (b) { var on = b.dataset.id === id; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', 'tab-' + id);
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* embedded view */ }
    statusEl.textContent = ''; statusEl.className = ''; persistEl.hidden = true;
    loading();
    Promise.resolve().then(RENDER[id]).catch(function (e) { failed(e, function () { select(id); }); });
    if (focus) panel.focus({ preventScroll: true });
  }
  SECTIONS.forEach(function (s, i) {
    var b = h('button', { class: 'nc-btn', type: 'button', role: 'tab', id: 'tab-' + s[0], text: s[1] });
    b.dataset.id = s[0];
    b.addEventListener('click', function () { select(s[0]); });
    b.addEventListener('keydown', function (e) {
      var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? SECTIONS.length - 1 : -1;
      if (n < 0) return;
      e.preventDefault(); n = (n + SECTIONS.length) % SECTIONS.length;
      tabs.children[n].focus(); select(SECTIONS[n][0]);
    });
    tabs.appendChild(b);
  });
  window.addEventListener('hashchange', function () { var id = location.hash.slice(1); if (id !== current) select(id); });
  select(location.hash.slice(1) || 'general');
})();
</script>
</body>
</html>`;
