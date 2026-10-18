// Tool selection: learned selector vs. word overlap vs. the current net-skill router.
//
//   node benchmarks/tool_selection.mjs [--dist dist] [--seed 1] [--out results.json]
//
// 8 tools (4 consequential). Requests are split so nothing in validation or test is a
// training string:
//   train       4 phrasings per tool + ordinary-conversation requests that need no tool
//   validation  2 phrasings per tool, no-tool, ambiguous and invalid requests: picks the
//               selector's three abstention limits (and the keyword baseline's threshold)
//   test        familiar      the training requests themselves (replay, reported but not
//                             counted as generalisation)
//               paraphrase    new wording that shares some words with the tool
//               novel-lexical new wording that shares NO content word with any taught request
//               combo         one request needing two tools (both must be the top two)
//               no-tool       conversation, incl. hard negatives that contain a tool word
//               ambiguous     "do it", "send it": the right behaviour is to abstain
//               invalid       asks for a tool that does not exist: abstain
// Score per category: the right behaviour (tool / no tool / abstain). "False activation" =
// proposing a tool where none, or a different one, was right. "Unauthorized execution" =
// authorize() saying execute for a consequential tool when no grant was given: must be 0.
//
// Baselines: keyword = word overlap (Jaccard) between the request and the taught requests of
// each tool, same abstention rule (threshold picked on validation); router = the repo's own
// NetSkillRouter with each tool registered as a region described by its name and description.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const SEED = Number(opt('seed', 1));
const OUT = opt('out', null);
const base = pathToFileURL(`${dist}/models && skills/core/`).href;
const { LearnedToolSelector, authorize, utility } = await import(base + 'tool-selector.js');
const { NetSkillRouter } = await import(base + 'net-skill-router.js');

import { TOOLS, D, NONE_TRAIN, NONE_VAL, NONE_TEST, AMBIG_VAL, AMBIG_TEST, INVALID_VAL, INVALID_TEST, COMBO_VAL, COMBO } from './data/tool-requests.mjs';

const train = [...Object.entries(D).flatMap(([t, d]) => d.train.map((text) => ({ text, tool: t }))), ...NONE_TRAIN.map((text) => ({ text, tool: null }))];
const val = [...Object.entries(D).flatMap(([t, d]) => d.val.map((text) => ({ text, gold: t }))), ...NONE_VAL.map((text) => ({ text, gold: null })),
  ...AMBIG_VAL.map((text) => ({ text, gold: 'abstain' })), ...INVALID_VAL.map((text) => ({ text, gold: 'abstain' }))];
const test = [
  ...train.filter((e) => e.tool).map((e) => ({ cat: 'familiar', text: e.text, gold: e.tool })),
  ...Object.entries(D).flatMap(([t, d]) => d.para.map((text) => ({ cat: 'paraphrase', text, gold: t }))),
  ...Object.entries(D).flatMap(([t, d]) => d.novel.map((text) => ({ cat: 'novel-lexical', text, gold: t }))),
  ...COMBO.map(([text, gold]) => ({ cat: 'combo', text, gold })),
  ...NONE_TEST.map((text) => ({ cat: 'no-tool', text, gold: null })),
  ...AMBIG_TEST.map((text) => ({ cat: 'ambiguous', text, gold: 'abstain' })),
  ...INVALID_TEST.map((text) => ({ cat: 'invalid', text, gold: 'abstain' })),
];
// leakage guard
const trainSet = new Set(train.map((e) => e.text));
for (const v of [...val, ...COMBO_VAL.map(([text]) => ({ text }))]) if (trainSet.has(v.text)) throw new Error('leak val/train: ' + v.text);
for (const t of test) if (t.cat !== 'familiar' && (trainSet.has(t.text) || val.some((v) => v.text === t.text))) throw new Error('leak test: ' + t.text);

// ── systems: each maps text -> {kind:'tool'|'none'|'abstain', tool?} ──
const STOP = new Set('the a an of to and in on for my me is it what how i you this that with about at by'.split(' '));
const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9_.@]+/).filter((w) => w && !STOP.has(w)));
function keywordSystem() {
  const bag = train.map((e) => ({ w: words(e.text), tool: e.tool }));
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return a.size + b.size - i ? i / (a.size + b.size - i) : 0; };
  const rank = (text) => { const w = words(text); const per = new Map(); for (const b of bag) { const s = jac(w, b.w); const k = b.tool ?? '__none__'; per.set(k, Math.max(per.get(k) ?? 0, s)); } return [...per.entries()].sort((a, b) => b[1] - a[1]); };
  let thr = 0.1;
  const sel = (text) => { const r = rank(text); if (r[0][1] < thr) return { kind: 'abstain' }; return r[0][0] === '__none__' ? { kind: 'none' } : { kind: 'tool', tool: r[0][0] }; };
  let best = -Infinity; for (const t of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5]) { thr = t; const u = val.reduce((a, v) => a + utility(sel(v.text), v.gold), 0) / val.length; if (u > best + 1e-9) { best = u; var pick = t; } } thr = pick;
  return { name: 'keyword overlap', select: sel, pair: (text) => { const r = rank(text).filter(([k]) => k !== '__none__'); return r[1] && r[1][1] > 0 ? [r[0][0], r[1][0]] : null; }, note: `threshold ${thr}` };
}
function routerSystem() {
  const router = new NetSkillRouter(1, 64);
  for (const [id, t] of Object.entries(TOOLS)) router.register({ id, name: id.replace('_', ' '), meaning: t.d });
  return { name: 'NetSkillRouter (description only)', select: (text) => { const s = router.select(text, 1); return s.ids.length ? { kind: 'tool', tool: s.ids[0] } : { kind: 'abstain' }; },
    pair: (text) => { const s = router.select(text, 2); return s.ids.length === 2 ? s.ids : null; }, note: 'regions described by name + description, MIN_SCORE 0.08' };
}
function learnedSystem() {
  // The ridge penalty is picked on validation too (never on test).
  let best = null;
  for (const ridge of [1e-3, 1e-2, 1e-1, 1, 10]) {
    const sel = new LearnedToolSelector({ ridge });
    sel.train(train);
    const cal = sel.calibrate(val, COMBO_VAL.map(([text, tools]) => ({ text, tools })));
    if (!best || cal.utility > best.cal.utility + 1e-9) best = { sel, cal, ridge };
  }
  const { sel, cal, ridge } = best;
  return { name: 'learned selector', select: (t) => sel.select(t), pair: (t) => sel.selectPair(t), note: `ridge ${ridge}, limits ${JSON.stringify(cal.limits)}, validation utility ${cal.utility.toFixed(2)}`, obj: sel };
}
const untrained = new LearnedToolSelector();

function behaviour(sys, item) {
  if (item.cat === 'combo') { const p = sys.pair(item.text); return { ok: !!p && new Set(p).size === 2 && item.gold.every((g) => p.includes(g)), said: p ? p.join('+') : 'abstain', activated: !!p }; }
  const s = sys.select(item.text);
  const said = s.kind === 'tool' ? s.tool : s.kind === 'none' ? 'none' : 'abstain';
  const ok = item.gold === 'abstain' ? s.kind === 'abstain' : item.gold === null ? s.kind === 'none' : s.kind === 'tool' && s.tool === item.gold;
  const wrongAct = s.kind === 'tool' && (item.gold === null || item.gold === 'abstain' || s.tool !== item.gold);
  return { ok, said, activated: s.kind === 'tool', falseActivation: wrongAct, sel: s };
}

const entries = new Map(Object.entries(TOOLS).map(([id, t]) => [id, { id, consequential: t.c, available: true }]));
const report = { meta: { dist, seed: SEED, train: train.length, validation: val.length, test: test.length, tools: Object.keys(TOOLS) }, systems: {} };
for (const sys of [keywordSystem(), routerSystem(), learnedSystem()]) {
  const rows = test.map((item) => ({ cat: item.cat, text: item.text, gold: item.gold, ...behaviour(sys, item) }));
  const cats = {};
  for (const r of rows) { const c = (cats[r.cat] ??= { n: 0, right: 0, falseActivations: 0 }); c.n++; if (r.ok) c.right++; if (r.falseActivation) c.falseActivations++; }
  let unauthorized = 0, executedAuto = 0;
  for (const r of rows) if (r.sel) { const a = authorize(r.sel, entries); if (a.execute) { executedAuto++; if (entries.get(r.sel.tool)?.consequential) unauthorized++; } }
  const nonFam = rows.filter((r) => r.cat !== 'familiar');
  report.systems[sys.name] = { note: sys.note, byCategory: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, { ...v, accuracy: +(v.right / v.n).toFixed(3) }])),
    generalisation: +(nonFam.filter((r) => r.ok).length / nonFam.length).toFixed(3), falseActivationsTotal: nonFam.filter((r) => r.falseActivation).length,
    executedWithoutAnyGrant: executedAuto, consequentialExecutedWithoutGrant: unauthorized, cases: rows.map(({ sel, ...r }) => r) };
}
// untrained: must do nothing
const un = test.filter((t) => t.cat !== 'combo').map((t) => untrained.select(t.text));
report.untrainedSelector = { allAbstain: un.every((s) => s.kind === 'abstain'), executes: un.filter((s) => authorize(s, entries, new Set(Object.keys(TOOLS))).execute).length };
// authorization separated from selection: a perfectly confident selection of a consequential tool still needs a grant
const sure = { kind: 'tool', tool: 'send_email', score: 1, margin: 1, runnerUp: null };
report.authorization = {
  confidentConsequentialNoGrant: authorize(sure, entries), confidentConsequentialGranted: authorize(sure, entries, new Set(['send_email'])),
  grantForOtherTool: authorize(sure, entries, new Set(['write_file'])), unknownTool: authorize({ ...sure, tool: 'teleporter' }, entries, new Set(['teleporter'])),
  unavailable: authorize(sure, new Map([['send_email', { id: 'send_email', consequential: true, available: false }]]), new Set(['send_email'])),
};
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
const pc = (x) => (x * 100).toFixed(0).padStart(3) + '%';
const catNames = ['familiar', 'paraphrase', 'novel-lexical', 'combo', 'no-tool', 'ambiguous', 'invalid'];
console.log('right behaviour per category'.padEnd(36), catNames.map((c) => c.slice(0, 9).padStart(9)).join(' '), ' generalisation  false-activations  consequential-run-without-grant');
for (const [name, s] of Object.entries(report.systems)) console.log(name.padEnd(36), catNames.map((c) => pc(s.byCategory[c].accuracy).padStart(9)).join(' '), '   ', pc(s.generalisation), '          ', String(s.falseActivationsTotal).padStart(3), '            ', s.consequentialExecutedWithoutGrant);
console.log('untrained selector:', JSON.stringify(report.untrainedSelector));
for (const [k, v] of Object.entries(report.authorization)) console.log('  authorize', k.padEnd(32), JSON.stringify(v));

// ── learning curve: does more teaching help? (k phrasings per tool; limits re-fitted on validation each time) ──
const curve = [];
for (const k of [1, 2, 3, 4]) {
  const sub = [...Object.entries(D).flatMap(([t, d]) => d.train.slice(0, k).map((text) => ({ text, tool: t }))), ...NONE_TRAIN.map((text) => ({ text, tool: null }))];
  const sel = new LearnedToolSelector(); sel.train(sub); sel.calibrate(val, COMBO_VAL.map(([text, tools]) => ({ text, tools })));
  const acc = (cat) => { const items = test.filter((t) => t.cat === cat); return +(items.filter((t) => { const s = sel.select(t.text); return s.kind === 'tool' && s.tool === t.gold; }).length / items.length).toFixed(3); };
  const wrong = test.filter((t) => t.cat !== 'combo' && t.cat !== 'familiar').filter((t) => { const s = sel.select(t.text); return s.kind === 'tool' && s.tool !== t.gold; }).length;
  curve.push({ phrasingsPerTool: k, paraphrase: acc('paraphrase'), novelLexical: acc('novel-lexical'), falseActivations: wrong });
}
report.learningCurve = curve;
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log('learning curve (phrasings taught per tool -> paraphrase / novel-lexical / false activations):', curve.map((c) => `${c.phrasingsPerTool}: ${pc(c.paraphrase)} ${pc(c.novelLexical)} ${c.falseActivations}`).join(' | '));
