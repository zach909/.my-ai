/**
 * The Accounts page (/accounts, and /login once there is an admin): set up the
 * server, log in or sign up, and for the admin, manage everyone else.
 *
 * Wears the house look (see AGENTS.md, VISUAL STYLE): the server adds the ring
 * and background, this page only uses the shared tokens and shapes. Plain DOM
 * calls and textContent, never innerHTML with data, so nothing a person is named
 * can run as markup. Nothing is fetched from anywhere but this server.
 */
export const ACCOUNTS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accounts</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; background:#110c0e; color:#f8ede9; }
  main { position:relative; z-index:1; max-width:560px; margin:0 auto; padding:40px 16px 80px; display:grid; grid-template-columns:minmax(0,1fr); gap:18px; }
  h1 { font-size:22px; margin:6px 6px 0; }
  h2 { font-size:17px; margin:0 0 4px; }
  section { padding:24px 26px; }
  p { margin:6px 0 12px; font-size:14px; line-height:1.5; }
  a { color:#ffc4b4; }
  .row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:10px 0; }
  .row > .grow { flex:1 1 160px; min-width:0; }
  .item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:10px 14px; margin:8px 0;
          background:rgba(255,240,232,.06); border:1px solid rgba(255,228,218,.14); border-radius:24px; font-size:14px; }
  .item > div:first-child { min-width:0; overflow-wrap:anywhere; }
  .item small { display:block; color:rgba(248,237,233,.62); }
  .item.gone { opacity:.55; }
  .btns { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
  .chip { display:inline-block; padding:2px 10px; margin-left:6px; border-radius:999px; font-size:12px; border:1px solid rgba(255,228,218,.2); background:rgba(255,238,230,.07); color:rgba(248,237,233,.62); }
  .chip.hot { color:#ffc4b4; border-color:rgba(255,154,132,.5); }
  .err { color:#ff9aa8; } .on { color:#8fe3a8; }
  #msg { min-height:20px; margin:0 8px; font-size:14px; }
  label.chk { display:inline-flex; gap:6px; align-items:center; font-size:14px; }
  input[type=checkbox] { accent-color:#ff9a84; }
  [hidden] { display:none !important; }
</style>
</head>
<body class="nc-soft">
<main>
  <h1>Accounts</h1>
  <div id="msg" class="nc-dim"></div>

  <section class="nc-glass" id="setup" hidden>
    <h2>Set up this server</h2>
    <p class="nc-dim">The computer's administrator sets this up, once. The account made here is the admin: it runs the computer, the tools and the agent. After that everyone gets access: anyone can make their own account from any device, and nobody can see anyone else's chats, folders, projects or points.</p>
    <div class="row"><input class="nc-input grow" id="su-name" placeholder="Admin name" maxlength="32" autocomplete="username"></div>
    <div class="row"><input class="nc-input grow" id="su-pass" type="password" placeholder="Password (8 or more characters)" autocomplete="new-password"></div>
    <div class="row" id="su-code-row"><input class="nc-input grow" id="su-code" placeholder="Setup code from the server's console" autocomplete="off" spellcheck="false"></div>
    <p class="nc-dim" id="su-note"></p>
    <div class="row"><button class="nc-btn primary" id="su-go">Create the admin account</button></div>
  </section>

  <section class="nc-glass" id="login" hidden>
    <h2>Log in</h2>
    <div class="row"><input class="nc-input grow" id="li-name" placeholder="Name" maxlength="32" autocomplete="username"></div>
    <div class="row"><input class="nc-input grow" id="li-pass" type="password" placeholder="Password" autocomplete="current-password"></div>
    <div class="row"><button class="nc-btn primary" id="li-go">Log in</button></div>
  </section>

  <section class="nc-glass" id="signup" hidden>
    <h2>Make an account</h2>
    <p class="nc-dim">Your chats, folders, projects and points are yours alone. The admin can turn your account off but cannot read your password.</p>
    <div class="row"><input class="nc-input grow" id="rg-name" placeholder="Choose a name" maxlength="32" autocomplete="username"></div>
    <div class="row"><input class="nc-input grow" id="rg-pass" type="password" placeholder="Choose a password (8 or more characters)" autocomplete="new-password"></div>
    <div class="row"><button class="nc-btn primary" id="rg-go">Sign up</button></div>
  </section>

  <section class="nc-glass" id="me" hidden>
    <h2 id="me-title"></h2>
    <div class="row">
      <a class="nc-btn primary" href="/commons" style="text-decoration:none">Open Commons</a>
      <a class="nc-btn" href="/" style="text-decoration:none">Chat with the agent</a>
      <button class="nc-btn" id="lo-go">Log out</button>
    </div>
    <div id="pw-box">
      <p class="nc-dim">Change your password (this logs you out everywhere).</p>
      <div class="row">
        <input class="nc-input grow" id="pw-old" type="password" placeholder="Current password" autocomplete="current-password">
        <input class="nc-input grow" id="pw-new" type="password" placeholder="New password" autocomplete="new-password">
        <button class="nc-btn" id="pw-go">Change</button>
      </div>
    </div>
  </section>

  <section class="nc-glass" id="admin" hidden>
    <h2>Everyone</h2>
    <div id="users"></div>
    <h2 style="margin-top:18px">Make an account</h2>
    <div class="row">
      <input class="nc-input grow" id="au-name" placeholder="Name" maxlength="32">
      <input class="nc-input grow" id="au-pass" type="password" placeholder="Password" autocomplete="new-password">
      <button class="nc-btn primary" id="au-go">Add</button>
    </div>
    <h2 style="margin-top:18px">Settings</h2>
    <div class="row">
      <label class="chk"><input type="checkbox" id="st-open"> Anyone can sign up</label>
    </div>
    <p class="nc-dim">Off means only you can make accounts.</p>
    <div class="row">
      <label class="chk"><input type="checkbox" id="st-learn"> Let the shared brain learn from and remember other people</label>
    </div>
    <p class="nc-dim">Off (the default) means what other people say never enters the brain, so it cannot come back out in someone else's answers. On means everyone shares what it learns. What the brain has already learned stays shared either way.</p>
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
  function btn(text, fn) { var b = el('button', { class: 'nc-btn', text: text }); b.addEventListener('click', fn); return b; }
  function next() {
    var n = new URLSearchParams(location.search).get('next');
    return n && n.charAt(0) === '/' && n.charAt(1) !== '/' ? n : '/commons';
  }
  function go(p) { return p.then(function () { location.href = next(); }, function (e) { say(e.message, true); }); }

  function show(id, on) { $(id).hidden = !on; }

  function renderUsers(r) {
    var U = $('users'); U.textContent = '';
    r.users.forEach(function (u) {
      var off = u.disabledAt !== null;
      var buttons = [];
      if (u.role !== 'admin') {
        buttons.push(btn(off ? 'Turn on' : 'Turn off', function () { api('POST', '/api/accounts/users/' + u.id + '/' + (off ? 'enable' : 'disable'), {}).then(load, function (e) { say(e.message, true); }); }));
        buttons.push(btn('New password', function () {
          var pw = window.prompt('New password for ' + u.name + ' (8 or more characters):');
          if (pw) api('POST', '/api/accounts/users/' + u.id + '/password', { password: pw }).then(function () { say('Password changed. They are logged out everywhere.'); }, function (e) { say(e.message, true); });
        }));
        buttons.push(btn('Delete', function () {
          if (!confirm('Delete ' + u.name + '?')) return;
          var purge = confirm('Also erase all of ' + u.name + "'s chats, folders, projects and points? This cannot be undone. OK erases them; Cancel keeps their data on disk.");
          api('POST', '/api/accounts/users/' + u.id + '/delete', { purge: purge }).then(load, function (e) { say(e.message, true); });
        }));
      }
      var row = el('div', { class: 'item' + (off ? ' gone' : '') }, [
        el('div', {}, [el('div', { text: u.name }), el('small', { text: (u.role === 'admin' ? 'Admin' : off ? 'Turned off' : 'User') + ' · joined ' + new Date(u.createdAt).toLocaleDateString() })]),
        el('div', { class: 'btns' }, buttons)
      ]);
      U.appendChild(row);
    });
    $('st-open').checked = r.signup === 'open';
    $('st-learn').checked = r.learnFromUsers === true;
  }

  function load() {
    api('GET', '/api/accounts/status').then(function (s) {
      var signedIn = s.me.kind !== 'anonymous';
      show('setup', !s.hasAdmin);
      show('login', s.hasAdmin && !signedIn);
      show('signup', s.hasAdmin && !signedIn && s.signup === 'open');
      show('me', signedIn);
      show('admin', signedIn && s.me.role === 'admin');
      var atMachine = s.onThisMachine && s.computerAdmin;
      $('su-code-row').hidden = atMachine;
      $('su-note').textContent = atMachine
        ? 'You are at the computer and it is running as an administrator, so no code is needed.'
        : s.onThisMachine
          ? 'This computer is not running as an administrator. Run the server as the computer\\'s administrator, or use the setup code printed on its console.'
          : 'Only the computer\\'s administrator can set this up. The setup code is printed on the server\\'s console when it starts.';
      if (signedIn) {
        $('me-title').textContent = s.me.kind === 'owner' ? 'You are the owner of this server' : 'Signed in as ' + s.me.name + (s.me.role === 'admin' ? ' (admin)' : '');
        $('pw-box').hidden = s.me.kind !== 'user';
        if (s.me.role === 'admin') api('GET', '/api/accounts/users').then(renderUsers, function (e) { say(e.message, true); });
      }
    }, function (e) { say(e.message, true); });
  }

  $('su-go').addEventListener('click', function () { go(api('POST', '/api/accounts/setup', { name: $('su-name').value, password: $('su-pass').value, setupCode: $('su-code').value })); });
  $('li-go').addEventListener('click', function () { go(api('POST', '/api/accounts/login', { name: $('li-name').value, password: $('li-pass').value })); });
  $('li-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('li-go').click(); });
  $('rg-go').addEventListener('click', function () { go(api('POST', '/api/accounts/register', { name: $('rg-name').value, password: $('rg-pass').value })); });
  $('lo-go').addEventListener('click', function () { api('POST', '/api/accounts/logout', {}).then(function () { location.href = '/accounts'; }); });
  $('pw-go').addEventListener('click', function () {
    api('POST', '/api/accounts/password', { oldPassword: $('pw-old').value, newPassword: $('pw-new').value }).then(function () { location.href = '/accounts'; }, function (e) { say(e.message, true); });
  });
  $('au-go').addEventListener('click', function () {
    api('POST', '/api/accounts/users', { name: $('au-name').value, password: $('au-pass').value }).then(function () { $('au-name').value = ''; $('au-pass').value = ''; say('Account made.'); load(); }, function (e) { say(e.message, true); });
  });
  $('st-open').addEventListener('change', function () { api('POST', '/api/accounts/settings', { signup: $('st-open').checked ? 'open' : 'invite' }).then(function () { say('Saved.'); }, function (e) { say(e.message, true); }); });
  $('st-learn').addEventListener('change', function () {
    var on = $('st-learn').checked;
    if (on && !confirm('Everyone will share what the brain learns, and what one person says could come back in another person\\'s answers. Turn it on?')) { $('st-learn').checked = false; return; }
    api('POST', '/api/accounts/settings', { learnFromUsers: on }).then(function () { say('Saved.'); }, function (e) { say(e.message, true); });
  });
  load();
})();
</script>
</body>
</html>
`;
