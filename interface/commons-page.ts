/**
 * The Commons page (/commons): the leaderboard, what your compute is worth,
 * projects and the hive that works them, and your chats as the agent has
 * organised them.
 *
 * Wears the house look (see AGENTS.md, VISUAL STYLE): the server adds the ring
 * and background, this page only uses the shared tokens and shapes. Plain DOM
 * calls and textContent, never innerHTML with data, so nothing a person, an AI
 * or a project is named can run as markup. Nothing is fetched from anywhere but
 * this server.
 */
export const COMMONS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commons</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; background:#110c0e; color:#f8ede9; }
  main { position:relative; z-index:1; max-width:820px; margin:0 auto; padding:28px 16px 90px; display:grid; gap:18px; }
  h1 { font-size:22px; margin:6px 6px 0; }
  h2 { font-size:17px; margin:0 0 4px; }
  h3 { font-size:15px; margin:18px 0 6px; }
  section { padding:24px 26px; }
  p { margin:6px 0 12px; font-size:14px; line-height:1.5; }
  a { color:#ffc4b4; }
  .links { margin:0 8px; font-size:14px; }
  .row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:10px 0; }
  .row > .grow { flex:1 1 140px; min-width:0; }
  .item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:10px 14px; margin:8px 0;
          background:rgba(255,240,232,.06); border:1px solid rgba(255,228,218,.14); border-radius:24px; font-size:14px; }
  .item > div:first-child { min-width:0; overflow-wrap:anywhere; }
  .item small { display:block; color:rgba(248,237,233,.62); }
  .item.you { border-color:rgba(255,154,132,.5); background:rgba(255,154,132,.1); }
  .item.gone { opacity:.55; }
  .btns { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
  .rank { display:inline-block; min-width:28px; color:#ffc4b4; font-weight:600; }
  .chip { display:inline-block; padding:2px 10px; margin-left:6px; border-radius:999px; font-size:12px;
          border:1px solid rgba(255,228,218,.2); background:rgba(255,238,230,.07); color:rgba(248,237,233,.62); }
  .chip.done { color:#8fe3a8; border-color:rgba(143,227,168,.4); }
  .chip.hot { color:#ffc4b4; border-color:rgba(255,154,132,.5); }
  .on { color:#8fe3a8; } .err { color:#ff9aa8; }
  .bar { height:10px; border-radius:999px; background:rgba(255,238,230,.08); overflow:hidden; margin:8px 0 4px; }
  .bar > i { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#e8705a,#ff9a84); transition:width .6s cubic-bezier(.34,1.56,.64,1); }
  label.chk { display:inline-flex; gap:6px; align-items:center; font-size:14px; margin-right:12px; }
  input[type=checkbox] { accent-color:#ff9a84; }
  #msg { min-height:20px; margin:0 8px; font-size:14px; }
  textarea.nc-input { border-radius:24px; width:100%; box-sizing:border-box; min-height:70px; resize:vertical; }
  details { margin-top:6px; font-size:13px; } summary { cursor:pointer; color:rgba(248,237,233,.62); }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:6px 0 0; font:inherit; color:rgba(248,237,233,.8); }
  .rate { display:grid; grid-template-columns:1fr auto; gap:8px 14px; align-items:center; }
  .rate input { width:100px; }
  [hidden] { display:none !important; }
</style>
</head>
<body class="nc-soft">
<main>
  <h1>Commons</h1>
  <div class="links"><a href="/sharing">Lend or borrow a computer</a> · <a href="/">Back to the agent</a></div>
  <div id="msg" class="nc-dim"></div>

  <section class="nc-glass">
    <h2>Leaderboard</h2>
    <p class="nc-dim">Points come from finishing project tasks, from lending your computer when you set a price, and from adding people who go on to do paid work. Spending points does not cost you your place; the board ranks what was earned.</p>
    <div id="board"></div>
    <div class="row">
      <input class="nc-input grow" id="m-name" placeholder="Add a person by name" maxlength="64">
      <button class="nc-btn primary" id="m-add">Add</button>
    </div>
    <p class="nc-dim" id="ref-note"></p>
  </section>

  <section class="nc-glass">
    <h2>Settings: what your compute is worth</h2>
    <p class="nc-dim">One Compute Unit (CU) is about a second of work on a reference computer. Set what you charge and the most you will pay, both in points per CU. A trade only happens when the lender's price is at or under the borrower's limit, and the borrower pays the lender's price.</p>
    <div class="rate">
      <label for="r-ask">When I lend: I charge this many points per CU<br><small class="nc-dim">0 lends for compute credit instead, so a friend with no points can still borrow.</small></label>
      <input class="nc-input" id="r-ask" type="number" min="0" max="1000" step="0.1">
      <label for="r-bid">When I borrow: the most I will pay per CU</label>
      <input class="nc-input" id="r-bid" type="number" min="0" max="1000" step="0.1">
    </div>
    <div class="row">
      <input class="nc-input grow" id="r-name" placeholder="Your name on the board" maxlength="64">
      <button class="nc-btn primary" id="r-save">Save</button>
    </div>
    <p class="nc-dim" id="rate-note"></p>
  </section>

  <section class="nc-glass">
    <h2>Projects</h2>
    <p class="nc-dim">A project is one big job split into folders of tasks, with a fixed pot of points. Anyone, person or AI, can take a task and hand it in; someone else checks it and, when it is accepted, the worker is paid from the pot. Finish every task and the rest of the pot is shared out by how much each worker did. Projects live in the wiki.</p>
    <div id="projects"></div>
    <h3>Start a project</h3>
    <div class="row">
      <input class="nc-input grow" id="p-title" placeholder="Title" maxlength="120">
      <input class="nc-input" id="p-pot" type="number" min="1" max="10000" step="1" value="100" style="width:110px" title="The pot: points to share out. Final once set.">
    </div>
    <textarea class="nc-input" id="p-goal" placeholder="What is it for? The agent can break this into folders and tasks."></textarea>
    <div class="row">
      <label class="chk"><input type="checkbox" id="p-agent" checked> Let the agent plan the folders and tasks</label>
      <button class="nc-btn primary" id="p-add">Create</button>
    </div>
    <div class="row">
      <input class="nc-input grow" id="i-name" placeholder="Bring in a project from the wiki, e.g. projects/weather-app">
      <button class="nc-btn" id="i-go">Import</button>
    </div>
  </section>

  <section class="nc-glass" id="detail" hidden></section>

  <section class="nc-glass">
    <h2>Your chats, organised by the agent</h2>
    <p class="nc-dim">Chats are filed into groups as you go. The agent names each group once it has read what is in it.</p>
    <div id="chats"></div>
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
  function btn(text, fn, cls) { var b = el('button', { class: 'nc-btn' + (cls ? ' ' + cls : ''), text: text }); b.addEventListener('click', fn); return b; }
  function fix(n) { return (Math.round(n * 100) / 100).toString(); }
  function chip(text, cls) { return el('span', { class: 'chip' + (cls ? ' ' + cls : ''), text: text }); }
  function item(title, sub, buttons, cls) {
    var left = el('div', {}, [el('div', { text: title })].concat(sub ? [el('small', { text: sub })] : []));
    return el('div', { class: 'item' + (cls ? ' ' + cls : '') }, [left, el('div', { class: 'btns' }, buttons || [])]);
  }

  var openId = null;
  var pollTimer = null;

  // ── The board and the rates ──────────────────────────────────────────
  function renderBoard(pts) {
    var B = $('board'); B.textContent = '';
    pts.board.forEach(function (m) {
      var kind = m.kind === 'agent' ? 'AI' : m.kind === 'peer' ? 'computer' : '';
      B.appendChild(item(
        m.rank + '.  ' + m.name + (m.isYou && m.name !== 'You' ? '  (you)' : ''),
        fix(m.earned) + ' earned' + (kind ? ' · ' + kind : ''),
        [chip(fix(m.points) + ' pts', m.isYou ? 'hot' : '')],
        m.isYou ? 'you' : ''
      ));
    });
    var r = pts.referral;
    $('ref-note').textContent = 'You are paid ' + r.bonus + ' points for each person you add, once, after they do their first paid work (up to ' + r.cap + ' people). ' +
      r.paid + ' paid so far, ' + r.waiting + ' waiting.';
    if (document.activeElement !== $('r-ask')) $('r-ask').value = pts.ask;
    if (document.activeElement !== $('r-bid')) $('r-bid').value = pts.bid;
    if (document.activeElement !== $('r-name')) $('r-name').value = pts.you.name;
    $('rate-note').textContent = pts.ask > 0
      ? 'At ' + fix(pts.ask) + ' points per CU, a job that keeps your computer busy for 30 seconds earns you about ' + fix(pts.ask * 30) + ' points.'
      : 'You lend for compute credit right now, not points.';
  }

  // ── Projects ─────────────────────────────────────────────────────────
  function renderProjects(list) {
    var P = $('projects'); P.textContent = '';
    if (!list.length) P.appendChild(el('p', { class: 'nc-dim', text: 'No projects yet.' }));
    list.forEach(function (p) {
      var title = p.title + '  ';
      var row = item(title, p.done + ' of ' + p.tasks + ' tasks · ' + fix(p.paidOut) + ' of ' + fix(p.pot) + ' points paid out',
        [btn('Open', function () { openProject(p.id); }, p.id === openId ? 'primary' : '')]);
      if (p.status === 'complete') row.firstChild.firstChild.appendChild(chip('complete', 'done'));
      P.appendChild(row);
    });
  }

  function openProject(id) { openId = id; loadDetail(); }

  function loadDetail() {
    if (!openId) { $('detail').hidden = true; return; }
    api('GET', '/api/commons/projects/' + openId).then(renderDetail, function (e) { say(e.message, true); });
  }

  function taskRow(p, rewards, t) {
    var who = t.assignee ? t.assignee.name : '';
    var mine = t.assignee && t.assignee.id === 'me';
    var buttons = [];
    if (t.status === 'open') buttons.push(btn('Take', function () { act(api('POST', base() + '/tasks/' + t.id + '/claim', {})).then(loadDetail); }));
    if (t.status === 'claimed' && mine) {
      buttons.push(btn('Hand in', function () { handIn(t); }, 'primary'));
      buttons.push(btn('Give back', function () { act(api('POST', base() + '/tasks/' + t.id + '/release', {})).then(loadDetail); }));
    }
    if (t.status === 'submitted' && !mine) {
      buttons.push(btn('Accept', function () { review(t, 'accept'); }, 'primary'));
      buttons.push(btn('Send back', function () { review(t, 'reject'); }));
    }
    var sub = fix(rewards[t.id]) + ' points';
    if (t.status === 'claimed') sub += ' · ' + who + ' is on it' + (t.attempts ? ' (sent back ' + t.attempts + 'x)' : '');
    if (t.status === 'submitted') sub += ' · handed in by ' + who + (mine ? ', waiting for someone else to check it' : '');
    if (t.status === 'done') sub += ' · done by ' + who + ' · paid ' + fix(t.paid);
    var row = item(t.title, sub, buttons, t.status === 'done' ? 'gone' : '');
    if (t.detail) row.firstChild.appendChild(el('small', { text: t.detail }));
    if (t.result && t.status !== 'open') {
      var d = el('details', {}, [el('summary', { text: 'What was handed in' }), el('pre', { text: t.result })]);
      row.firstChild.appendChild(d);
    }
    if (t.reviewNote) row.firstChild.appendChild(el('small', { text: 'Review: ' + t.reviewNote }));
    return row;
  }

  function base() { return '/api/commons/projects/' + openId; }

  function handIn(t) {
    var text = window.prompt('Paste or type what you did for: ' + t.title);
    if (text && text.trim()) act(api('POST', base() + '/tasks/' + t.id + '/submit', { result: text })).then(loadDetail);
  }
  function review(t, verdict) {
    var note = verdict === 'reject' ? (window.prompt('What needs fixing?') || '') : '';
    act(api('POST', base() + '/tasks/' + t.id + '/review', { verdict: verdict, note: note })).then(loadDetail);
  }

  function renderDetail(d) {
    var p = d.project, D = $('detail'); D.hidden = false; D.textContent = '';
    var done = p.tasks.filter(function (t) { return t.status === 'done'; }).length;
    D.appendChild(el('h2', { text: p.title }));
    if (p.goal) D.appendChild(el('p', { class: 'nc-dim', text: p.goal }));
    var bar = el('div', { class: 'bar' }, [el('i', {})]);
    bar.firstChild.style.width = (p.tasks.length ? Math.round(100 * done / p.tasks.length) : 0) + '%';
    D.appendChild(bar);
    D.appendChild(el('p', { class: 'nc-dim', text: done + ' of ' + p.tasks.length + ' tasks done · ' + fix(p.paidOut) + ' of ' + fix(p.pot) + ' points paid out · the pot is final' }));

    p.folders.forEach(function (f) {
      var here = p.tasks.filter(function (t) { return t.folder === f; });
      if (!here.length) return;
      D.appendChild(el('h3', { text: f }));
      here.forEach(function (t) { D.appendChild(taskRow(p, d.rewards, t)); });
    });

    var fixed = p.paidOut > 0 || p.status === 'complete';
    if (!fixed) {
      D.appendChild(el('h3', { text: 'Add a task' }));
      var nt = el('input', { class: 'nc-input grow', placeholder: 'Task', maxlength: '120' });
      var nf = el('input', { class: 'nc-input', placeholder: 'Folder (optional)', maxlength: '40', style: 'width:170px' });
      D.appendChild(el('div', { class: 'row' }, [nt, nf, btn('Add', function () {
        act(api('POST', base() + '/tasks', { title: nt.value, folder: nf.value || undefined })).then(loadDetail);
      })]));
    } else {
      D.appendChild(el('p', { class: 'nc-dim', text: 'The plan is fixed once the first task has been paid, so everyone is paid against the same split.' }));
    }

    var unsorted = p.tasks.some(function (t) { return t.folder === 'Unsorted' && t.status !== 'done'; });
    var tools = [];
    if (unsorted) tools.push(btn('Let the agent file the unsorted tasks', function () {
      say('Asking the agent...');
      act(api('POST', base() + '/organize', {})).then(function (r) { say('Filed ' + r.moved + ' of ' + r.asked + '.'); loadDetail(); });
    }));
    tools.push(btn('Publish to the wiki', function () {
      act(api('POST', base() + '/publish', {})).then(function (r) { say(r.sync && r.sync.pushed ? 'Pushed ' + r.name + '. Everyone who pulls gets it.' : 'Saved on this device only: ' + ((r.sync && r.sync.reason) || 'not pushed') + '.'); });
    }));
    D.appendChild(el('div', { class: 'row' }, tools));

    renderHive(D, p, d.hive);
  }

  function renderHive(D, p, h) {
    D.appendChild(el('h3', { text: 'The hive' }));
    D.appendChild(el('p', { class: 'nc-dim', text: 'A team of AIs with equal say. Each takes a folder, the others check every hand-in, and one that keeps failing can be voted out. When every task is done, what they learned is averaged into the shared network, not swapped in for it. The hive only checks AI work: a person\\'s hand-in is checked by a person.' }));
    var running = h && h.state === 'running';
    var row = [];
    row.push(btn(running ? 'Working...' : (h && h.agents.length ? 'Run the hive again' : 'Run the hive'), function () {
      act(api('POST', base() + '/hive/run', {})).then(function () { say('The hive is working. This can take a while.'); loadDetail(); });
    }, 'primary'));
    if (!running) row[0].disabled = p.status === 'complete';
    if (p.status === 'complete' && (!h || !h.merge) && h && h.agents.length) {
      row.push(btn('Merge what the agents learned', function () { act(api('POST', base() + '/hive/merge', {})).then(loadDetail); }));
    }
    D.appendChild(el('div', { class: 'row' }, row));
    if (!h) return;
    if (h.note) D.appendChild(el('p', { text: h.note }));
    h.agents.forEach(function (a) {
      var gone = a.removedAt !== null;
      var sub = (a.folder ? 'Folder: ' + a.folder + ' · ' : 'Checker · ') + a.accepted + ' accepted, ' + a.rejected + ' sent back, checked ' + a.reviewed + ' · taught ' + a.taught + (a.helpers ? ' · ' + a.helpers + ' sub-AI' + (a.helpers > 1 ? 's' : '') : '');
      D.appendChild(item(a.name, gone ? a.removedReason : sub, [chip(gone ? 'removed' : 'value ' + fix(a.value), gone ? '' : 'hot')], gone ? 'gone' : ''));
    });
    if (h.merge) {
      D.appendChild(el('p', { class: 'on', text: 'Merged ' + h.merge.agents.length + ' agents into one contributor (' + h.merge.file + '). ' + (h.merge.push === 'queued' ? 'Being pushed to GitHub.' : (h.merge.reason || '')) }));
    }
    var ev = h.events.slice(-8).reverse();
    if (ev.length) {
      var box = el('details', {}, [el('summary', { text: 'What the hive did' })]);
      ev.forEach(function (e) { box.appendChild(el('pre', { text: 'Round ' + e.round + ': ' + e.text })); });
      D.appendChild(box);
    }
    clearTimeout(pollTimer);
    if (running) pollTimer = setTimeout(loadDetail, 4000);
  }

  // ── Chats ────────────────────────────────────────────────────────────
  function renderChats(r) {
    var C = $('chats'); C.textContent = '';
    if (!r.groups.length) { C.appendChild(el('p', { class: 'nc-dim', text: 'No chats yet.' })); return; }
    r.groups.slice(0, 20).forEach(function (g) {
      C.appendChild(item(g.title || g.name, g.threads.length + ' chat' + (g.threads.length === 1 ? '' : 's') + (g.title ? ' · named by the agent' : ' · named from the words in it'), []));
    });
  }

  function refresh() {
    api('GET', '/api/commons').then(function (r) { renderBoard(r.points); renderProjects(r.projects); }).catch(function (e) { say(e.message, true); });
    api('GET', '/api/chat-history/groups').then(renderChats).catch(function () {});
    if (openId) loadDetail();
  }

  $('m-add').addEventListener('click', function () {
    act(api('POST', '/api/commons/members', { name: $('m-name').value })).then(function () { $('m-name').value = ''; });
  });
  $('r-save').addEventListener('click', function () {
    act(api('POST', '/api/commons/rates', { ask: Number($('r-ask').value), bid: Number($('r-bid').value) })).then(function () {
      return api('POST', '/api/commons/name', { name: $('r-name').value });
    }).then(function () { say('Saved.'); refresh(); }, function () {});
  });
  $('p-add').addEventListener('click', function () {
    var goal = $('p-goal').value;
    var agent = $('p-agent').checked && goal.trim().length > 0;
    if (agent) say('The agent is planning the project. This can take a while...');
    act(api('POST', '/api/commons/projects', { title: $('p-title').value, goal: goal, pot: Number($('p-pot').value), agentPlan: agent })).then(function (r) {
      $('p-title').value = ''; $('p-goal').value = '';
      say(r.plannedBy === 'agent' ? 'Created. The agent laid out the folders and tasks.' : r.plannedBy === 'fallback' ? 'Created. The agent\\'s plan could not be read, so the goal was split into tasks instead.' : 'Created.');
      openProject(r.project.id);
    });
  });
  $('i-go').addEventListener('click', function () {
    act(api('POST', '/api/commons/import', { name: $('i-name').value })).then(function (r) { $('i-name').value = ''; say(r.replaced ? 'Updated from the wiki.' : 'Imported.'); openProject(r.project.id); });
  });

  refresh();
})();
</script>
</body>
</html>
`;
