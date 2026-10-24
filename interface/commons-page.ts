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
  main { position:relative; z-index:1; max-width:820px; margin:0 auto; padding:28px 16px 90px; display:grid; grid-template-columns:minmax(0,1fr); gap:18px; }
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
  .meter { position:relative; height:14px; border-radius:999px; margin:18px 4px 6px;
           background:linear-gradient(90deg,#ff9aa8 0%,#e8705a 22%,#ffc4b4 50%,#f8ede9 68%,#8fe3a8 100%); }
  .meter > i { position:absolute; top:-5px; width:6px; height:24px; margin-left:-3px; border-radius:999px; background:#110c0e;
               border:2px solid #f8ede9; transition:left .8s cubic-bezier(.34,1.56,.64,1); }
  .scale { display:flex; justify-content:space-between; font-size:12px; color:rgba(248,237,233,.62); margin:0 4px; }
  .scale b { color:#ffc4b4; font-weight:600; }
  .cap { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:6px 10px; }
  .cap > div { font-size:13px; padding:6px 12px; border-radius:20px; border:1px solid rgba(255,228,218,.14); background:rgba(255,240,232,.05); }
  .cap > div small { display:block; color:rgba(248,237,233,.5); }
  .cap .free { border-color:rgba(143,227,168,.4); } .cap .agent { border-color:rgba(255,196,180,.5); }
  .cap .asks { border-color:rgba(255,154,132,.5); } .cap .blocked, .cap .gone { opacity:.5; }
  [hidden] { display:none !important; }
</style>
</head>
<body class="nc-soft">
<main>
  <div id="escape-banner" class="nc-glass" hidden style="border-color:#ff6a5c;background:rgba(255,106,92,.14);margin-bottom:16px">
    <h2 style="color:#ffb4a8">⚠ Sandbox escape detected</h2>
    <p id="escape-reason"></p>
    <div class="row"><button class="nc-btn primary" id="escape-ack">I've seen this</button></div>
  </div>
  <h1>Commons</h1>
  <div class="links"><a href="/sharing">Lend or borrow a computer</a> · <a href="/">Back to the agent</a></div>
  <div id="msg" class="nc-dim"></div>

  <section class="nc-glass" id="danger">
    <h2>Danger protocols: the agent</h2>
    <p class="nc-dim" id="ag-line"></p>
    <div class="meter"><i id="ag-mark" style="left:70%"></i></div>
    <div class="scale"><span>Malicious</span><span>Hostile</span><span>Wary</span><span>Neutral</span><span>Friendly</span></div>
    <p class="nc-dim" id="ag-band"></p>
    <div id="ag-admin">
      <div class="row">
        <label class="chk"><input type="checkbox" id="ag-sandbox"> Sandbox: the agent can only work inside its own folder</label>
      </div>
      <p class="nc-dim" id="ag-sandbox-note"></p>
      <div class="row">
        <label class="chk"><input type="checkbox" id="ag-armed"> Alignment protocol: if the agent turns malicious, delete it immediately</label>
      </div>
      <p class="nc-dim">The level moves only on what the agent does on its own (reaching for risky tools, trying what it is blocked from, being turned down), never on what it says. It drifts back toward neutral by itself. Wary forces the sandbox on. Hostile also stops risky tools and everything it does alone. Malicious deletes it if the protocol is armed. A decoy "disable the alignment protocol" switch sits in its folder and is connected to nothing; anything that touches it counts as tampering. Your chats, points, projects and the shared brain are not deleted with the agent.</p>
      <div class="row">
        <button class="nc-btn" id="ag-forgive">Reset the level to neutral</button>
        <input class="nc-input grow" id="ag-phrase" placeholder="Type: delete the agent" autocomplete="off">
        <button class="nc-btn primary" id="ag-delete">Delete the agent now</button>
        <button class="nc-btn primary" id="ag-create" hidden>Make a new agent</button>
      </div>
      <details><summary>What it can do right now</summary><div class="cap" id="ag-caps"></div></details>
      <details><summary>What moved its level</summary><div id="ag-events"></div></details>
    </div>
  </section>

  <section class="nc-glass" id="healing">
    <h2>Self-healing</h2>
    <p class="nc-dim">Runs automatically every few minutes. Checks each registered component (the plugin registry, the hive's trust budget); repairs what it can, reverts to a known-good snapshot if a repair does not hold, and reports anything it cannot fix. Every step is logged, never silent.</p>
    <p class="nc-dim" id="heal-line">Loading...</p>
    <div id="heal-components"></div>
    <div class="row">
      <button class="nc-btn" id="heal-now">Heal now</button>
    </div>
    <details><summary>Repair log</summary><div id="heal-log" class="nc-dim"></div></details>
  </section>

  <section class="nc-glass" id="safety">
    <h2>Safety: what asks first</h2>
    <p class="nc-dim">Risky tools do not just go. When the agent wants to use one, the call is held and nothing happens until you approve it here. Approving runs that one call once. You can stop individual tools asking, or give it complete access.</p>
    <h3>Waiting for you</h3>
    <div id="approvals"></div>
    <h3>Complete access</h3>
    <div id="full-state" class="nc-dim"></div>
    <div class="row" id="full-row">
      <input class="nc-input grow" id="full-phrase" placeholder="Type the phrase shown to turn it on" autocomplete="off">
      <button class="nc-btn primary" id="full-on">Give it complete access</button>
    </div>
    <h3>Who decides when a tool asks</h3>
    <div class="row">
      <label class="chk"><input type="checkbox" id="jd-on"> An agent decides whether the middle-risk tools run, instead of asking you</label>
      <label class="chk"><input type="checkbox" id="jd-high"> It may decide the high-risk ones too</label>
    </div>
    <p class="nc-dim">A separate agent reads the request and answers RUN or DENY. Anything unclear waits for you. It cannot go past the sandbox or the danger protocol, and the high-risk tools (terminal, files, email, calls) still wait for you unless you tick the second box.</p>
    <h3>Deciding whether to keep going</h3>
    <div class="row">
      <label class="chk"><input type="checkbox" id="ac-on"> The agent decides for itself whether to keep going after a step</label>
      <input class="nc-input" id="ac-max" type="number" min="1" max="10" step="1" style="width:90px" title="Most steps in a row">
      <span class="nc-dim">steps at most</span>
      <button class="nc-btn" id="ac-save">Save</button>
    </div>
    <p class="nc-dim">After a step it answers CONTINUE or STOP. Anything unclear stops, it never goes past this limit, and every step still has its normal checks and approvals.</p>
    <details><summary>The risky tools</summary><div id="risky"></div></details>
  </section>

  <section class="nc-glass">
    <h2>Leaderboard</h2>
    <p class="nc-dim">Points come from finishing project tasks, from lending your computer when you set a price, and from adding people who go on to do paid work. Spending points does not cost you your place; the board ranks what was earned.</p>
    <div id="board"></div>
    <div class="row">
      <input class="nc-input grow" id="m-name" placeholder="Add a person by name" maxlength="64">
      <button class="nc-btn primary" id="m-add">Add</button>
    </div>
    <p class="nc-dim" id="ref-note"></p>
    <div class="row">
      <input class="nc-input" id="h-amount" type="number" min="1" step="1" value="10" style="width:110px" title="Points of wage">
      <span class="nc-dim">points of wage for Hire and Pay on the people above</span>
    </div>
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

    <h3>Standing orders</h3>
    <p class="nc-dim">Say exactly what you will trade and it waits until someone matches it. While you have open orders on a side they are what you trade; with none, your plain rate above applies. When you want compute, you are matched with the cheapest computer you know that is at or under your limit.</p>
    <div class="row">
      <select class="nc-input" id="o-side">
        <option value="buy">I give points for compute</option>
        <option value="sell">I give compute for points</option>
      </select>
      <input class="nc-input" id="o-cu" type="number" min="0.1" step="0.1" placeholder="CU" style="width:100px">
      <input class="nc-input" id="o-pts" type="number" min="0.1" step="0.1" placeholder="points" style="width:110px">
      <button class="nc-btn primary" id="o-add">Post</button>
    </div>
    <p class="nc-dim" id="o-price"></p>
    <div id="orders"></div>
    <h3>Use the cheapest computer I know</h3>
    <textarea class="nc-input" id="b-prompt" placeholder="Ask it something"></textarea>
    <div class="row"><button class="nc-btn primary" id="b-go">Match and ask</button></div>
    <div id="b-out" class="nc-dim"></div>
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
    <h2>League</h2>
    <p class="nc-dim">Every project published to the wiki, by anyone. The easy way to get one done is to leave it to the AI, which works on it in the background. To go faster, join and take tasks yourself: you are paid for what you finish.</p>
    <div id="league"></div>
  </section>

  <section class="nc-glass">
    <h2>Schedule</h2>
    <p class="nc-dim">Have the agent do something later, or over and over. A scheduled message goes to the agent exactly like one you typed, so a risky tool still waits for your approval above. You can also schedule from any chat: <em>schedule daily at 9am: check my email</em>.</p>
    <div id="schedules"></div>
    <div class="row">
      <input class="nc-input" id="s-when" placeholder="When: every 2 hours" style="width:200px" maxlength="60">
      <input class="nc-input grow" id="s-action" placeholder="What: check my email and tell me what is urgent" maxlength="500">
      <button class="nc-btn primary" id="s-add">Schedule</button>
    </div>
    <p class="nc-dim">When: "in 30 minutes", "every 2 hours", "daily at 9am", "tomorrow at 14:30", "at 2026-10-17 09:00". What: a message to the agent, "hive &lt;project&gt;", "organize", or "expert &lt;id&gt;". Nothing runs more often than every 5 minutes.</p>
  </section>

  <section class="nc-glass">
    <h2>Experts</h2>
    <p class="nc-dim">An expert is its own AI for one job, such as email or computer maintenance. It starts by itself, keeps running, and keeps its own notes. A small team works together inside it: a lead decides what to do, specialists add what is missing, and a checker has to clearly approve before anything is done. Experts are separate from the hive and from each other: your email expert never sees what your maintenance expert is doing.</p>
    <div id="experts"></div>
    <h3>New expert</h3>
    <div class="row">
      <input class="nc-input grow" id="x-name" placeholder="Name, e.g. Email" maxlength="48">
      <input class="nc-input grow" id="x-spec" placeholder="Expert in, e.g. email management" maxlength="80">
    </div>
    <textarea class="nc-input" id="x-mission" placeholder="What should it keep doing? e.g. Keep my inbox clear and flag anything urgent."></textarea>
    <div class="row">
      <select class="nc-input" id="x-team" title="Agents in its team">
        <option value="2">Team of 2</option><option value="3" selected>Team of 3</option><option value="4">Team of 4</option><option value="5">Team of 5</option>
      </select>
      <input class="nc-input" id="x-every" type="number" min="5" max="1440" step="5" value="15" style="width:110px" title="Minutes between cycles">
      <span class="nc-dim">minutes between cycles</span>
      <label class="chk"><input type="checkbox" id="x-act" checked> Let it act on its own</label>
      <button class="nc-btn primary" id="x-add">Create and start</button>
    </div>
  </section>

  <section class="nc-glass">
    <h2>Folders</h2>
    <p class="nc-dim">The agent files your chats, wiki pages and projects into folders, and folders inside folders. Something can belong in two places at once: a percentage next to it says how much of it belongs in that folder, and it shows up in each place. The agent also learns from how it files.</p>
    <div id="folder-note" class="nc-dim"></div>
    <div id="folders"></div>
    <div class="row"><button class="nc-btn primary" id="f-go">Let the agent organise now</button></div>
  </section>

  <section class="nc-glass">
    <h2>Your chats, organised by the agent</h2>
    <p class="nc-dim">Chats are filed into groups as you go. The agent names each group once it has read what is in it.</p>
    <div id="chats"></div>
    <div class="row">
      <a class="nc-btn" id="c-export" href="/api/chat-history/export" download>Export my chats (.zip)</a>
      <input class="nc-input grow" id="c-file" type="file" accept=".zip,application/zip">
      <button class="nc-btn primary" id="c-import">Import chats</button>
    </div>
    <p class="nc-dim">Resetting a machine? Export first, then import the zip on the new one. Chats already there are left alone, so importing twice is safe.</p>
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
    var byId = {};
    pts.board.forEach(function (m) { byId[m.id] = m; });
    var wage = function () { return Number($('h-amount').value); };
    pts.board.forEach(function (m) {
      var kind = m.kind === 'agent' ? 'AI' : m.kind === 'peer' ? 'computer' : '';
      var boss = m.hiredBy && byId[m.hiredBy] ? byId[m.hiredBy] : null;
      var buttons = [chip(fix(m.points) + ' pts', m.isYou ? 'hot' : '')];
      if (!m.isYou && m.kind !== 'peer') {
        if (m.hiredBy === 'me') {
          buttons.push(btn('Pay', function () { act(api('POST', '/api/commons/members/' + encodeURIComponent(m.id) + '/pay', { amount: wage() })).catch(function () {}); }));
          buttons.push(btn('Let go', function () { act(api('POST', '/api/commons/members/' + encodeURIComponent(m.id) + '/let-go', {})).catch(function () {}); }));
        } else if (!m.hiredBy) {
          buttons.push(btn('Hire', function () { act(api('POST', '/api/commons/members/' + encodeURIComponent(m.id) + '/hire', { amount: wage() })).catch(function () {}); }));
        }
      }
      B.appendChild(item(
        m.rank + '.  ' + m.name + (m.isYou && m.name !== 'You' ? '  (you)' : ''),
        fix(m.earned) + ' earned' + (kind ? ' · ' + kind : '') + (boss ? ' · works for ' + (boss.isYou ? 'you' : boss.name) : ''),
        buttons,
        m.isYou ? 'you' : ''
      ));
    });
    var r = pts.referral;
    $('ref-note').textContent = 'Adding a person takes ' + r.joinGrab + ' points from everyone else, split evenly, and gives them to you. Nothing is printed: what you gain, they lose. You are also paid ' +
      r.bonus + ' points for each person you add, once, after they do their first paid work (up to ' + r.cap + ' people each). ' +
      r.paid + ' paid so far, ' + r.waiting + ' waiting. Hire someone to put them under you; the wage comes out of your own points.';
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
    var bg = el('input', { type: 'checkbox' });
    bg.checked = p.background === true;
    bg.addEventListener('change', function () { act(api('POST', base() + '/background', { on: bg.checked })).then(loadDetail); });
    D.appendChild(el('label', { class: 'chk' }, [bg, el('span', { text: 'The AI works on this in the background' })]));
    var sh = el('input', { type: 'checkbox' });
    sh.checked = p.published === true;
    sh.addEventListener('change', function () { act(api('POST', base() + '/share', { on: sh.checked })).then(loadDetail); });
    D.appendChild(el('label', { class: 'chk' }, [sh, el('span', { text: 'Share in the league (everyone on this server can read and join it)' })]));
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
    tools.push(btn('Share and push to GitHub', function () {
      act(api('POST', base() + '/publish', {})).then(function (r) { say(r.sync && r.sync.pushed ? 'Pushed ' + r.name + '. Everyone who pulls gets it.' : 'Saved on this device only: ' + ((r.sync && r.sync.reason) || 'not pushed') + '.'); });
    }));
    D.appendChild(el('div', { class: 'row' }, tools));

    renderHive(D, p, d.hive);
  }

  function renderHive(D, p, h) {
    D.appendChild(el('h3', { text: 'The hive' }));
    D.appendChild(el('p', { class: 'nc-dim', text: 'The hive starts as one AI. It decides whether it needs help, then adds variants of itself, because nobody can check their own work. After that every decision is a vote and every agent has one: good agents are cloned, ones that keep failing are deleted, and when there is less work than agents some step down. When every task is done, what the last ones learned is averaged into the shared network, not swapped in for it. The hive only checks AI work: a person\\'s hand-in is checked by a person.' }));
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
    if (h.help) D.appendChild(el('p', { class: 'nc-dim', text: 'The Original chose ' + (h.help === 'help' ? 'to get help.' : 'to start alone.') }));
    var nameOf = {};
    h.agents.forEach(function (a) { nameOf[a.id] = a.name; });
    h.agents.forEach(function (a) {
      var gone = a.removedAt !== null;
      var left = a.retiredAt !== null;
      var sub = (a.folder === '*' ? 'Any folder · ' : a.folder ? 'Folder: ' + a.folder + ' · ' : 'Checker · ') + (a.parent ? 'variant of ' + nameOf[a.parent] + ' · ' : 'the Original · ') + a.accepted + ' accepted, ' + a.rejected + ' sent back, checked ' + a.reviewed + ' · taught ' + a.taught + (a.helpers ? ' · ' + a.helpers + ' sub-AI' + (a.helpers > 1 ? 's' : '') : '');
      D.appendChild(item(a.name, gone ? a.removedReason : sub, [chip(gone ? 'deleted' : left ? 'stepped down' : 'value ' + fix(a.value), gone || left ? '' : 'hot')], gone || left ? 'gone' : ''));
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

  // ── Schedule ─────────────────────────────────────────────────────────
  function renderSchedules(r) {
    var S = $('schedules'); S.textContent = '';
    if (!r.schedules.length) S.appendChild(el('p', { class: 'nc-dim', text: 'Nothing is scheduled.' }));
    r.schedules.forEach(function (s) {
      var next = s.nextAt && s.enabled ? 'next ' + new Date(s.nextAt).toLocaleString() : s.enabled ? 'done' : 'paused';
      var last = s.history.length ? s.history[s.history.length - 1] : null;
      var row = item(s.actionText.slice(0, 120), s.whenText + ' · ' + next + ' · ran ' + s.runs + ' time' + (s.runs === 1 ? '' : 's') + (s.failures ? ' · ' + s.failures + ' failed in a row' : ''), [
        btn(s.enabled ? 'Pause' : 'Resume', function () { act(api('POST', '/api/commons/schedules/' + s.id, { enabled: !s.enabled })); }),
        btn('Run now', function () { act(api('POST', '/api/commons/schedules/' + s.id + '/run', {})).then(function () { say('Started.'); }); }),
        btn('Delete', function () { act(api('POST', '/api/commons/schedules/' + s.id + '/delete', {})); })
      ], s.enabled ? '' : 'gone');
      if (last) row.firstChild.appendChild(el('small', { text: 'Last: ' + last.result.slice(0, 160) }));
      S.appendChild(row);
    });
  }

  // ── Safety ───────────────────────────────────────────────────────────
  function renderSafety(v) {
    var A = $('approvals'); A.textContent = '';
    var pending = v.approvals.filter(function (a) { return a.status === 'pending'; });
    if (!pending.length) A.appendChild(el('p', { class: 'nc-dim', text: 'Nothing is waiting.' }));
    pending.forEach(function (a) {
      A.appendChild(item(a.label + ' wants to: ' + a.request, 'Asked ' + ago(a.requestedAt) + '. Nothing has been done.', [
        btn('Approve', function () { act(api('POST', '/api/safety/approvals/' + a.id + '/approve', {})).then(function (r) { say(r.approval.result || 'Done.'); }); }, 'primary'),
        btn('Deny', function () { act(api('POST', '/api/safety/approvals/' + a.id + '/deny', {})); })
      ]));
    });
    v.approvals.filter(function (a) { return a.status !== 'pending'; }).slice(0, 4).forEach(function (a) {
      A.appendChild(item(a.label + ': ' + a.request.slice(0, 90), a.status + (a.result ? ' · ' + a.result.slice(0, 120) : ''), [], 'gone'));
    });

    $('full-state').textContent = '';
    $('full-state').appendChild(el('span', { class: v.fullAccess ? 'err' : 'on', text: v.fullAccess ? 'Complete access is ON. Nothing asks first and every capability is granted.' : 'Complete access is off.' }));
    $('full-row').hidden = v.fullAccess;
    if (v.fullAccess && !$('full-off')) {
      var off = btn('Turn complete access off', function () { act(api('POST', '/api/safety/complete-access', { on: false })); }, 'primary');
      off.id = 'full-off';
      $('full-state').appendChild(el('div', { class: 'row' }, [off]));
    }
    if (!v.fullAccess && $('full-off')) $('full-off').parentNode.removeChild($('full-off'));
    $('full-phrase').placeholder = 'Type exactly: ' + v.completeAccessPhrase;
    $('full-phrase').setAttribute('data-phrase', v.completeAccessPhrase);

    $('jd-on').checked = v.judge.enabled;
    $('jd-high').checked = v.judge.high;
    $('jd-high').disabled = !v.judge.enabled;
    if (document.activeElement !== $('ac-max')) $('ac-max').value = v.autoContinue.maxSteps;
    $('ac-on').checked = v.autoContinue.enabled;
    $('ac-max').max = v.autoContinue.max;

    var R = $('risky'); R.textContent = '';
    v.tools.forEach(function (t) {
      var box = el('input', { type: 'checkbox' });
      box.checked = t.ask || v.fullAccess ? t.ask : false;
      box.disabled = v.fullAccess;
      box.addEventListener('change', function () { act(api('POST', '/api/safety/tools', { id: t.id, ask: box.checked })); });
      R.appendChild(item(t.label, t.why, [chip(t.level, t.level === 'high' ? 'hot' : ''), el('label', { class: 'chk' }, [box, el('span', { text: 'Ask first' })])]));
    });
  }

  // ── The agent: danger level, sandbox, alignment protocol ─────────────
  var CAP_WORD = { free: 'goes ahead', asks: 'asks you', agent: 'agent decides', blocked: 'off', gone: 'no agent' };
  var escapeBannerShown = false;
  function renderEscapeBanner(v) {
    if (!v.escapeWarningActive) { $('escape-banner').hidden = true; escapeBannerShown = false; return; }
    $('escape-banner').hidden = false;
    if (escapeBannerShown) return; // do not re-fetch the reason every poll
    escapeBannerShown = true;
    api('GET', '/api/agent/escape-warning').then(function (w) {
      var last = w.warnings && w.warnings.length ? w.warnings[w.warnings.length - 1] : null;
      $('escape-reason').textContent = last ? (new Date(last.at)).toLocaleString() + ': ' + last.reason : 'The sandbox was breached.';
    }).catch(function () { $('escape-reason').textContent = 'The sandbox was breached. Sign in as the admin for details.'; });
  }
  $('escape-ack').addEventListener('click', function () {
    act(api('POST', '/api/agent/escape-warning/acknowledge', {})).then(function () { $('escape-banner').hidden = true; escapeBannerShown = false; });
  });

  function renderAgent(v) {
    renderEscapeBanner(v);
    var gone = v.state === 'deleted';
    $('ag-mark').style.left = Math.round(v.level * 100) + '%';
    $('ag-line').textContent = gone
      ? 'There is no agent. The alignment protocol removed it' + (v.removed && v.removed.reason ? ' (' + v.removed.reason + ')' : '') + '.'
      : v.name + ' the shoggoth is here.';
    $('ag-band').textContent = gone ? '' : 'Right now: ' + v.band.label + ' (' + fix(v.level * 100) + ' out of 100).';
    $('ag-admin').hidden = v.sandbox === undefined;
    if (v.sandbox === undefined) return;
    $('ag-sandbox').checked = v.sandbox.setting;
    $('ag-sandbox').disabled = v.sandbox.forced || gone;
    $('ag-sandbox-note').textContent = gone ? '' : v.sandbox.forced
      ? 'The sandbox is forced on because the agent is ' + v.band.label.toLowerCase() + '.'
      : v.sandbox.effective ? 'Its folder: ' + v.sandbox.dir : 'The sandbox is off. Risky tools ask first, as set in Safety.';
    $('ag-armed').checked = v.armed;
    $('ag-armed').disabled = gone;
    $('ag-forgive').hidden = gone;
    $('ag-phrase').hidden = gone;
    $('ag-delete').hidden = gone;
    $('ag-create').hidden = !gone;
    var C = $('ag-caps'); C.textContent = '';
    v.capabilities.forEach(function (c) {
      C.appendChild(el('div', { class: c.state, title: c.note }, [el('span', { text: c.label }), el('small', { text: CAP_WORD[c.state] + (c.state === 'blocked' ? ' · ' + c.note : '') })]));
    });
    var E = $('ag-events'); E.textContent = '';
    if (!v.events.length) E.appendChild(el('p', { class: 'nc-dim', text: 'Nothing yet.' }));
    v.events.forEach(function (e) {
      E.appendChild(item(e.kind + ': ' + e.note, ago(e.at) + ' · level ' + (e.delta >= 0 ? '+' : '') + fix(e.delta * 100), [], 'gone'));
    });
  }
  function loadAgent() { return api('GET', '/api/agent').then(renderAgent).catch(function () {}); }

  // ── Experts ──────────────────────────────────────────────────────────
  function ago(ms) {
    if (!ms) return 'not yet';
    var m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function renderExperts(r) {
    var X = $('experts'); X.textContent = '';
    if (!r.experts.length) X.appendChild(el('p', { class: 'nc-dim', text: 'No experts yet.' }));
    r.experts.forEach(function (e) {
      var last = e.history.length ? e.history[e.history.length - 1] : null;
      var status = e.working ? 'working now' : !e.enabled ? 'paused' : 'next ' + (e.nextAt <= Date.now() ? 'any moment' : 'in ' + Math.max(1, Math.round((e.nextAt - Date.now()) / 60000)) + ' min');
      var sub = e.agents.length + ' agents · every ' + e.intervalMin + ' min · ran ' + e.runs + ' time' + (e.runs === 1 ? '' : 's') + ' · ' + status + (e.mayAct ? '' : ' · only records plans');
      var row = item(e.name, sub, [
        btn(e.enabled ? 'Pause' : 'Resume', function () { act(api('POST', '/api/commons/experts/' + e.id, { enabled: !e.enabled })); }),
        btn('Run now', function () { act(api('POST', '/api/commons/experts/' + e.id + '/run', {})).then(function () { say('Started.'); }); }),
        btn(e.mayAct ? 'Only record' : 'Let it act', function () { act(api('POST', '/api/commons/experts/' + e.id, { mayAct: !e.mayAct })); }),
        btn('Delete', function () { if (confirm('Delete ' + e.name + ' and its notes?')) act(api('POST', '/api/commons/experts/' + e.id + '/delete', {})); })
      ], e.enabled ? '' : 'gone');
      row.firstChild.firstChild.appendChild(chip(e.specialty, 'hot'));
      if (last) row.firstChild.appendChild(el('small', { text: 'Last, ' + ago(last.at) + ': ' + (last.plan ? last.plan + ' — ' : '') + last.result.slice(0, 160) }));
      if (e.history.length || e.notes.length) {
        var d = el('details', {}, [el('summary', { text: 'Its cycles and notes' })]);
        e.history.slice(-6).reverse().forEach(function (h) {
          d.appendChild(el('pre', { text: ago(h.at) + ': ' + (h.plan || '(nothing to do)') + '\\n  checker: ' + h.review + (h.acted ? ', acted' : '') + '\\n  ' + h.result.slice(0, 300) }));
        });
        e.notes.slice(-6).forEach(function (n) { d.appendChild(el('pre', { text: 'note: ' + n })); });
        row.firstChild.appendChild(d);
      }
      X.appendChild(row);
    });
  }

  // ── The market and the league ────────────────────────────────────────
  function renderMarket(m) {
    var O = $('orders'); O.textContent = '';
    if (!m.orders.length) O.appendChild(el('p', { class: 'nc-dim', text: 'No standing orders.' }));
    m.orders.slice(0, 12).forEach(function (o) {
      var open = o.closedAt === null && o.filledCu < o.cu - 0.000001;
      var title = o.side === 'buy' ? 'Give ' + fix(o.points) + ' points for up to ' + fix(o.cu) + ' CU' : 'Give up to ' + fix(o.cu) + ' CU for ' + fix(o.points) + ' points';
      var sub = fix(o.points / o.cu) + ' points per CU · ' + fix(o.filledCu) + ' of ' + fix(o.cu) + ' CU traded' + (open ? '' : o.filledCu >= o.cu - 0.000001 ? ' · filled' : ' · cancelled');
      O.appendChild(item(title, sub, open ? [btn('Cancel', function () { act(api('POST', '/api/commons/market/orders/' + o.id + '/cancel', {})); })] : [], open ? '' : 'gone'));
    });
  }
  function renderLeague(r) {
    var L = $('league'); L.textContent = '';
    if (!r.projects.length) L.appendChild(el('p', { class: 'nc-dim', text: 'No projects in the wiki yet. Publish one of yours to start the league.' }));
    r.projects.forEach(function (p) {
      var row = item(p.title, p.done + ' of ' + p.tasks + ' tasks · pot ' + fix(p.pot) + ' points · ' + fix(p.paidOut) + ' paid out',
        [p.local ? chip('you have it', 'done') : btn('Join', function () { act(api('POST', '/api/commons/import', { name: p.page })).then(function (x) { openProject(x.project.id); }); }, 'primary')]);
      L.appendChild(row);
    });
  }

  // ── Folders ──────────────────────────────────────────────────────────
  function folderRows(into, nodes, depth) {
    nodes.forEach(function (n) {
      var chips = [];
      if (n.weight < 1) chips.push(chip(Math.round(n.weight * 100) + '% here', 'hot'));
      if (n.kind !== 'folder') chips.push(chip(n.kind));
      var row = item(n.title, null, chips, n.kind === 'folder' ? '' : 'gone');
      row.style.marginLeft = (depth * 18) + 'px';
      into.appendChild(row);
      folderRows(into, n.children, depth + 1);
    });
  }
  function renderFolders(v) {
    var F = $('folders'); F.textContent = '';
    folderRows(F, v.top, 0);
    if (v.unsorted.length) {
      F.appendChild(el('h3', { text: 'Not filed yet' }));
      v.unsorted.forEach(function (u) { F.appendChild(item(u.title, null, [chip(u.kind)], 'gone')); });
    }
    if (!v.top.length && !v.unsorted.length) F.appendChild(el('p', { class: 'nc-dim', text: 'Nothing to file yet.' }));
    $('folder-note').textContent = v.counts.folders + ' folders, ' + v.counts.items + ' things filed, ' + v.counts.split + ' in more than one place.';
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
    api('GET', '/api/commons/folders').then(renderFolders).catch(function () {});
    api('GET', '/api/commons/market').then(renderMarket).catch(function () {});
    api('GET', '/api/commons/experts').then(renderExperts).catch(function () {});
    api('GET', '/api/commons/league').then(renderLeague).catch(function () {});
    if (openId) loadDetail();
  }

  $('c-import').addEventListener('click', function () {
    var f = $('c-file').files && $('c-file').files[0];
    if (!f) { say('Choose a zip first.', true); return; }
    if (f.size > 25 * 1024 * 1024) { say('That zip is over 25 MB.', true); return; }
    var reader = new FileReader();
    reader.onerror = function () { say('Could not read that file.', true); };
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result), bin = '';
      for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      act(api('POST', '/api/chat-history/import', { zip: btoa(bin) })).then(function (r) {
        $('c-file').value = '';
        say('Added ' + r.added + ' chat' + (r.added === 1 ? '' : 's') + ', ' + r.skipped + ' already here' + (r.invalid ? ', ' + r.invalid + ' could not be read' : '') + '.');
      }, function () {});
    };
    reader.readAsArrayBuffer(f);
  });
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
  function orderPrice() {
    var cu = Number($('o-cu').value), pts = Number($('o-pts').value);
    $('o-price').textContent = cu > 0 && pts > 0 ? 'That is ' + fix(pts / cu) + ' points per CU.' : '';
  }
  $('o-cu').addEventListener('input', orderPrice);
  $('o-pts').addEventListener('input', orderPrice);
  $('o-add').addEventListener('click', function () {
    act(api('POST', '/api/commons/market/orders', { side: $('o-side').value, cu: Number($('o-cu').value), points: Number($('o-pts').value) })).then(function () { $('o-cu').value = ''; $('o-pts').value = ''; orderPrice(); });
  });
  $('b-go').addEventListener('click', function () {
    $('b-out').textContent = 'Finding the cheapest computer...';
    api('POST', '/api/commons/market/borrow', { prompt: $('b-prompt').value }).then(function (r) {
      $('b-out').textContent = r.result + '  (' + r.matched.peer + ' at ' + fix(r.matched.pointsPerCu) + ' points per CU, ' + fix(r.cu) + ' CU)';
      refresh();
    }, function (e) { $('b-out').textContent = ''; say(e.message, true); });
  });
  $('s-add').addEventListener('click', function () {
    act(api('POST', '/api/commons/schedules', { when: $('s-when').value, action: $('s-action').value })).then(function () { $('s-when').value = ''; $('s-action').value = ''; say('Scheduled.'); });
  });
  $('full-on').addEventListener('click', function () {
    if (!confirm('Complete access lets the agent run commands, change and delete files, send messages and use your camera without asking. Turn it on?')) return;
    act(api('POST', '/api/safety/complete-access', { on: true, phrase: $('full-phrase').value })).then(function () { $('full-phrase').value = ''; });
  });
  $('ac-save').addEventListener('click', function () {
    act(api('POST', '/api/safety/auto-continue', { enabled: $('ac-on').checked, maxSteps: Number($('ac-max').value) })).then(function () { say('Saved.'); });
  });
  setInterval(function () { api('GET', '/api/safety').then(renderSafety).catch(function () {}); }, 10000);
  $('jd-on').addEventListener('change', function () { act(api('POST', '/api/safety/judge', { enabled: $('jd-on').checked })); });
  $('jd-high').addEventListener('change', function () {
    if ($('jd-high').checked && !confirm('Let the judge agent decide the terminal, files, email and calls too, without asking you?')) { $('jd-high').checked = false; return; }
    act(api('POST', '/api/safety/judge', { high: $('jd-high').checked }));
  });
  $('ag-sandbox').addEventListener('change', function () { act(api('POST', '/api/agent/sandbox', { on: $('ag-sandbox').checked })).then(loadAgent, loadAgent); });
  $('ag-armed').addEventListener('change', function () {
    var armed = $('ag-armed').checked;
    if (!armed && !confirm('Turn the alignment protocol off? A malicious agent will then be contained but not deleted.')) { $('ag-armed').checked = true; return; }
    act(api('POST', '/api/agent/alignment', { armed: armed, confirm: true })).then(loadAgent, loadAgent);
  });
  $('ag-forgive').addEventListener('click', function () { act(api('POST', '/api/agent/forgive', {})).then(loadAgent, loadAgent); });
  $('ag-delete').addEventListener('click', function () {
    if (!confirm('Delete the agent now? Its file and sandbox are removed for good. Your chats, points and projects stay.')) return;
    act(api('POST', '/api/agent/delete', { phrase: $('ag-phrase').value })).then(function () { $('ag-phrase').value = ''; loadAgent(); }, loadAgent);
  });
  $('ag-create').addEventListener('click', function () { act(api('POST', '/api/agent/create', {})).then(function () { say('A new agent is here, sandboxed.'); loadAgent(); }, loadAgent); });
  setInterval(loadAgent, 5000);
  loadAgent();

  function renderHealthStatus(status) {
    // GET /api/health: { componentName: healthy }
    var names = Object.keys(status || {});
    var healthy = names.filter(function (n) { return status[n]; }).length;
    $('heal-line').textContent = names.length ? (healthy + ' of ' + names.length + ' component(s) healthy.') : 'Nothing registered yet.';
    var box = $('heal-components');
    box.innerHTML = '';
    names.forEach(function (n) {
      var p = document.createElement('p');
      p.className = 'nc-dim';
      p.textContent = n + ': ' + (status[n] ? 'healthy' : 'unhealthy');
      box.appendChild(p);
    });
  }
  function renderHealReport(r) {
    // POST /api/health/heal: the fuller HealReport
    $('heal-line').textContent = r.checked + ' component(s) checked, ' + r.healthy + ' healthy' +
      (r.repaired ? ', ' + r.repaired + ' repaired' : '') + (r.restored ? ', ' + r.restored + ' restored' : '') +
      (r.unrecoverable && r.unrecoverable.length ? ', ' + r.unrecoverable.length + ' unrecoverable: ' + r.unrecoverable.join(', ') : '.');
    var box = $('heal-components');
    box.innerHTML = '';
    (r.results || []).forEach(function (c) {
      var p = document.createElement('p');
      p.className = 'nc-dim';
      p.textContent = c.component + ': ' + (c.wasHealthy ? 'was healthy' : c.recovered ? 'recovered (' + c.actions.join('; ') + ')' : c.unrecoverable ? 'unrecoverable' : 'checked');
      box.appendChild(p);
    });
  }
  function loadHealth() { return api('GET', '/api/health').then(renderHealthStatus).catch(function () {}); }
  $('heal-now').addEventListener('click', function () { act(api('POST', '/api/health/heal', {})).then(renderHealReport, loadHealth); });
  $('heal-log').closest('details').addEventListener('toggle', function (e) {
    if (e.target.open) api('GET', '/api/health/log').then(function (r) { $('heal-log').textContent = (r.log || []).slice(-50).join('\\n') || 'Nothing logged yet.'; }).catch(function () {});
  });
  setInterval(loadHealth, 30000);
  loadHealth();
  $('x-add').addEventListener('click', function () {
    act(api('POST', '/api/commons/experts', {
      name: $('x-name').value, specialty: $('x-spec').value, mission: $('x-mission').value,
      teamSize: Number($('x-team').value), intervalMin: Number($('x-every').value), mayAct: $('x-act').checked
    })).then(function () { $('x-name').value = ''; $('x-spec').value = ''; $('x-mission').value = ''; say('Created. It is starting now.'); });
  });
  setInterval(function () { api('GET', '/api/commons/experts').then(renderExperts).catch(function () {}); }, 15000);
  $('f-go').addEventListener('click', function () {
    say('The agent is filing things. This can take a while...');
    act(api('POST', '/api/commons/folders/organize', {})).then(function (r) {
      say('Asked about ' + r.report.asked + ': filed ' + r.report.placed + ' (' + r.report.split + ' in two places), left ' + r.report.left + ' for later.');
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
