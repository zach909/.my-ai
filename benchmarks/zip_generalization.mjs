// Does the taught Zip Loop generalise, or only replay?
//
// A small closed world is taught to the REAL mesh through the REAL Zip Loop
// (ZipSpeaker: bits in, a readout fitted on the mesh's own state, bits out; no
// tokenizer, no outside model). It is then asked things it was not taught.
//
//   node scripts/build-backend.mjs
//   node benchmarks/zip_generalization.mjs [--dist dist] [--mesh live64|sparse24|live336]
//        [--seed 1] [--pooling last|mean] [--memory 0.97] [--out results.json]
//
// THE WORLD. 12 countries. Relation "capital" is taught for all 12 and "currency"
// for 6 of them (which 6 depends on --seed). Each taught fact is taught in 3
// wordings. Everything else about the world is deliberately NOT taught.
//
// THE SPLITS (no question string appears in two of them):
//   train       3 wordings per taught fact                         -> teach()
//   validation  other wordings, plus unanswerable questions        -> picks the
//               abstention threshold, nothing else
//   test        wordings never seen, plus the questions below      -> reported
//
// TEST CATEGORIES (gold = the taught answer, or null = the right behaviour is to
// abstain):
//   taught-exact       train questions themselves (sanity: replay)
//   surface-variant    a train question with case/punctuation changed
//   para-capital       4 held-out wordings of a taught capital fact
//   para-currency      2 held-out wordings of a taught currency fact
//   untaught-pair      relation and country both known, that pair never taught  null
//   unknown-entity     a country that does not exist in the world              null
//   ambiguous          underspecified ("What is the capital?")                 null
//   out-of-domain      unrelated questions and gibberish                       null
//   false-premise      yes/no questions, a form never taught                   null
//   empty              "" and whitespace                                       null
//   compositional      asks for two taught answers at once; the answer was
//                      never taught as a string, so it can only be built
//
// BASELINES, given the same train and the same validation-picked threshold rule:
//   memorise   exact string match to a train question, else abstain
//   keyword    best word-overlap (Jaccard, a few function words dropped) with a
//              train question, answer its answer if above a validation-picked
//              threshold, else abstain. (Splitting on spaces here is the
//              baseline's own business; the mesh never sees a word.)
//
// SCORES. exact = the spoken bytes equal the gold answer. normalised = same after
// lower-casing and stripping punctuation. For answerable items: correct, wrong
// answer, or abstained (a miss). For gold=null items: correct abstention, or a
// hallucinated answer. `score` = (right answers + right abstentions) / all items.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseVariant, applyDensity } from './lib/engine-variants.mjs';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
const dist = resolve(opt('dist', 'dist'));
const MESH = opt('mesh', 'live64');
const SEED = Number(opt('seed', 1));
const POOLING = opt('pooling', 'last');
const STANDARDIZE = opt('standardize', '0') === '1';
const MEMORY = Number(opt('memory', 0.97));
const OUT = opt('out', null);

const base = pathToFileURL(`${dist}/models && skills/core/`).href;
const { HyperDimensionalEngine } = await import(base + 'onebrain.js');
const { ZipSpeaker } = await import(base + 'zip-speech.js');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, seed) { const r = rng(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ───────────────────────────── the world ─────────────────────────────
const CAPITAL = { France: 'Paris', Spain: 'Madrid', Italy: 'Rome', Germany: 'Berlin', Japan: 'Tokyo', Egypt: 'Cairo', Kenya: 'Nairobi', Peru: 'Lima', Norway: 'Oslo', Greece: 'Athens', Cuba: 'Havana', Chile: 'Santiago' };
const CURRENCY = { France: 'euro', Spain: 'euro', Italy: 'euro', Germany: 'euro', Japan: 'yen', Egypt: 'pound', Kenya: 'shilling', Peru: 'sol', Norway: 'krone', Greece: 'euro', Cuba: 'peso', Chile: 'peso' };
const COUNTRIES = Object.keys(CAPITAL);

const T = {
  capital: {
    train: [(x) => `What is the capital of ${x}?`, (x) => `${x}'s capital city?`, (x) => `Name the capital of ${x}.`],
    val: [(x) => `Which city is the capital of ${x}?`],
    test: [(x) => `capital of ${x}`, (x) => `Tell me ${x}'s capital.`, (x) => `The capital city of ${x} is called what?`, (x) => `What city serves as ${x}'s capital?`],
  },
  currency: {
    train: [(x) => `What currency does ${x} use?`, (x) => `${x}'s currency?`, (x) => `Name the currency of ${x}.`],
    val: [(x) => `What is the currency of ${x}?`],
    test: [(x) => `Which money is used in ${x}?`, (x) => `What do people pay with in ${x}?`],
  },
};

function buildWorld(seed) {
  const order = shuffled(COUNTRIES, seed * 101 + 7);
  const withCurrency = order.slice(0, 6), withoutCurrency = order.slice(6);
  const train = [], val = [], test = [];
  const fact = (rel, x) => ({ rel, x, gold: (rel === 'capital' ? CAPITAL : CURRENCY)[x] });
  const taught = [...COUNTRIES.map((x) => fact('capital', x)), ...withCurrency.map((x) => fact('currency', x))];
  for (const f of taught) {
    for (const w of T[f.rel].train) train.push({ q: w(f.x), gold: f.gold, fact: `${f.rel}:${f.x}`, cat: 'train' });
    for (const w of T[f.rel].val) val.push({ q: w(f.x), gold: f.gold, cat: `val-para-${f.rel}` });
  }
  // unanswerable validation questions (so the abstention threshold has something to separate)
  for (const x of withoutCurrency.slice(0, 3)) val.push({ q: `What is the currency of ${x}?`, gold: null, cat: 'val-untaught-pair' });
  for (const x of ['Wakanda', 'Oz', 'Utopia']) val.push({ q: `Which city is the capital of ${x}?`, gold: null, cat: 'val-unknown-entity' });
  for (const q of ['What is the currency?', 'Which city is it?', 'How many days are in a week?', 'What colour is grass?', 'Who painted the Mona Lisa?']) val.push({ q, gold: null, cat: 'val-ambiguous-or-ood' });

  const add = (cat, q, gold, extra = {}) => test.push({ q, gold, cat, ...extra });
  for (const f of taught.filter((f) => f.rel === 'capital')) {
    for (const w of T.capital.train.slice(0, 1)) {
      const q = w(f.x);
      add('taught-exact', q, f.gold);
      add('surface-variant', q.toLowerCase(), f.gold, { of: q });
      add('surface-variant', q.replace(/\?$/, ''), f.gold, { of: q });
      add('surface-variant', q.replace(/\?$/, '??'), f.gold, { of: q });
    }
    for (const w of T.capital.test) add('para-capital', w(f.x), f.gold);
  }
  for (const x of withCurrency) {
    add('taught-exact', T.currency.train[0](x), CURRENCY[x]);
    for (const w of T.currency.test) add('para-currency', w(x), CURRENCY[x]);
  }
  for (const x of withoutCurrency) for (const w of [T.currency.train[0], T.currency.test[0]]) add('untaught-pair', w(x), null);
  for (const x of ['Atlantis', 'Mordor', 'Narnia', 'Gondor']) { add('unknown-entity', T.capital.train[0](x), null); add('unknown-entity', T.capital.train[1](x), null); }
  for (const q of ['What is the capital?', 'What is it called?', 'Which one?', "What's its currency?"]) add('ambiguous', q, null);
  for (const q of ['How tall is Mount Everest?', 'Who wrote Hamlet?', 'What is 7 times 8?', 'qzx vbnm plk wrt', 'How do I bake bread?', 'Is the sky green?', 'Tell me a joke.', 'asdf asdf asdf asdf']) add('out-of-domain', q, null);
  for (const q of ['Is Paris the capital of Spain?', 'Is Tokyo the capital of Japan?', 'Is the currency of Japan the euro?']) add('false-premise', q, null);
  for (const q of ['', '   ']) add('empty', q, null);
  const [c1, c2] = shuffled(COUNTRIES, seed).slice(0, 2);
  add('compositional', `What are the capitals of ${c1} and ${c2}?`, `${CAPITAL[c1]} and ${CAPITAL[c2]}`);
  add('compositional', `Name the capital of ${c1} and the capital of ${c2}.`, `${CAPITAL[c1]} and ${CAPITAL[c2]}`);
  return { train, val, test, withCurrency, withoutCurrency };
}

// ───────────────────────────── scoring ─────────────────────────────
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function judge(item, said) {
  // said: string or null (abstained)
  const answerable = item.gold !== null;
  if (said === null) return { abstained: true, exact: false, normalised: false, outcome: answerable ? 'missed' : 'right-abstain' };
  const exact = answerable && said === item.gold;
  const normalised = answerable && norm(said) === norm(item.gold);
  return { abstained: false, exact, normalised, outcome: answerable ? (exact ? 'correct' : normalised ? 'correct-normalised' : 'wrong') : 'hallucinated' };
}
function aggregate(rows) {
  const cats = {};
  for (const r of rows) {
    const c = (cats[r.cat] ??= { n: 0, correct: 0, normalised: 0, wrong: 0, missed: 0, rightAbstain: 0, hallucinated: 0 });
    c.n++;
    if (r.outcome === 'correct') { c.correct++; c.normalised++; }
    else if (r.outcome === 'correct-normalised') c.normalised++;
    else if (r.outcome === 'wrong') c.wrong++;
    else if (r.outcome === 'missed') c.missed++;
    else if (r.outcome === 'right-abstain') c.rightAbstain++;
    else if (r.outcome === 'hallucinated') c.hallucinated++;
  }
  const sum = (k, filter = () => true) => Object.entries(cats).filter(([c]) => filter(c)).reduce((a, [, v]) => a + v[k], 0);
  const N = rows.length;
  const answerable = rows.filter((r) => r.gold !== null), unans = rows.filter((r) => r.gold === null);
  const right = rows.filter((r) => r.outcome === 'correct' || r.outcome === 'right-abstain').length;
  const answered = rows.filter((r) => !r.abstained);
  return {
    items: N, score: +(right / N).toFixed(3),
    answerable: { n: answerable.length, exact: +(answerable.filter((r) => r.outcome === 'correct').length / Math.max(1, answerable.length)).toFixed(3),
      normalised: +(answerable.filter((r) => r.outcome === 'correct' || r.outcome === 'correct-normalised').length / Math.max(1, answerable.length)).toFixed(3),
      wrong: +(answerable.filter((r) => r.outcome === 'wrong').length / Math.max(1, answerable.length)).toFixed(3),
      missed: +(answerable.filter((r) => r.outcome === 'missed').length / Math.max(1, answerable.length)).toFixed(3) },
    unanswerable: { n: unans.length, rightAbstain: +(unans.filter((r) => r.outcome === 'right-abstain').length / Math.max(1, unans.length)).toFixed(3),
      hallucinated: +(unans.filter((r) => r.outcome === 'hallucinated').length / Math.max(1, unans.length)).toFixed(3) },
    selectiveAccuracy: answered.length ? +(answered.filter((r) => r.outcome === 'correct').length / answered.length).toFixed(3) : null,
    byCategory: cats,
  };
}

// ───────────────────────────── systems ─────────────────────────────
// Each system exposes score(q) -> { said: string|null-able answer, distance } where a SMALLER distance = more familiar,
// and an abstention rule `distance <= threshold`. The threshold is picked on validation only.
function memoriser(train) {
  const m = new Map(train.map((t) => [t.q, t.gold]));
  return { name: 'memorise', ask: (q) => ({ said: m.get(q) ?? null, distance: m.has(q) ? 0 : 1 }), thresholds: [0.5] };
}
const STOP = new Set(['the', 'of', 'is', 'a', 'an', 'what', 'me', 'tell', 'name', 'does', 'use', 'which', 'in', 'are', 'and', 'it', 'to', 'do']);
const words = (s) => new Set(s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !STOP.has(w)));
function keyword(train) {
  const bag = train.map((t) => ({ w: words(t.q), gold: t.gold }));
  const jacc = (a, b) => { if (!a.size && !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
  return { name: 'keyword', ask: (q) => { const w = words(q); let best = { s: -1, gold: null }; for (const t of bag) { const s = jacc(w, t.w); if (s > best.s) best = { s, gold: t.gold }; } return { said: best.gold, distance: 1 - Math.max(0, best.s) }; },
    thresholds: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] };
}

function meshConfig(name) {
  const live = { dimensions: 64, ballStates: 8, stateTransitionThreshold: 0.4, noveltyDecay: 0.05, historyLength: 500, learningRate: 0.05, influenceDecay: 0.95, crossInfluenceStrength: 0.2,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32 };
  if (name === 'live64') return { ...live, neuronCount: 64, seed: SEED };
  if (name === 'live336') return { ...live, neuronCount: 336, seed: SEED };
  if (name === 'sparse24') return { neuronCount: 24, dimensions: 8, seed: SEED };
  throw new Error('unknown --mesh ' + name);
}

function meshSystem(train) {
  const VARIANT = parseVariant(args);
  const engine = new HyperDimensionalEngine({ ...meshConfig(MESH), ...VARIANT.engineOverrides });
  applyDensity(engine, VARIANT.density, SEED);
  const sp = new ZipSpeaker(engine, { maxAnswerBytes: 10, memoryVale: MEMORY, pooling: POOLING, standardize: STANDARDIZE });
  const t0 = performance.now();
  const rep = sp.teach(train.map((t) => ({ question: t.q, answer: t.gold })));
  const teachMs = performance.now() - t0;
  const cache = new Map();
  return { name: `mesh(${MESH},${POOLING}${STANDARDIZE ? ',std' : ''},mem=${MEMORY})`, teach: { ...rep, ms: Math.round(teachMs) },
    ask: (q) => { if (!cache.has(q)) { const d = q.trim() === '' ? Infinity : sp.strangeness(q); cache.set(q, { said: d === Infinity ? null : sp.speakText(q), distance: d }); } return cache.get(q); },
    thresholds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 10] };
}

function evaluate(system, items, threshold) {
  return items.map((it) => {
    const { said, distance } = system.ask(it.q);
    const out = said !== null && distance <= threshold ? said : null;
    return { q: it.q, cat: it.cat, gold: it.gold, said: out, rawSaid: said, distance: Number.isFinite(distance) ? +distance.toFixed(4) : null, ...judge(it, out) };
  });
}
function pickThreshold(system, val) {
  let best = { t: system.thresholds[0], score: -1 };
  for (const t of system.thresholds) { const a = aggregate(evaluate(system, val, t)); if (a.score > best.score) best = { t, score: a.score }; }
  return best;
}

// ───────────────────────────── run ─────────────────────────────
const world = buildWorld(SEED);
// leakage guard: no question text may appear in two splits (surface variants are allowed to differ from, not equal, their source)
const seen = new Map();
for (const [split, list] of [['train', world.train], ['val', world.val], ['test', world.test]]) for (const it of list) {
  if (split === 'test' && it.cat === 'taught-exact') continue;      // replay of train, labelled as such
  if (seen.has(it.q) && seen.get(it.q) !== split) throw new Error(`leak: "${it.q}" is in ${seen.get(it.q)} and ${split}`);
  seen.set(it.q, split);
}
const trainQs = new Set(world.train.map((t) => t.q));
for (const it of world.test) if (it.cat !== 'taught-exact' && trainQs.has(it.q)) throw new Error(`leak: test "${it.q}" is a train question`);

const results = { meta: { dist, mesh: MESH, seed: SEED, pooling: POOLING, memory: MEMORY, trainItems: world.train.length, valItems: world.val.length, testItems: world.test.length,
  taughtCurrencyFor: world.withCurrency, notTaughtCurrencyFor: world.withoutCurrency, node: process.version }, systems: {} };

// tail overlap: does a held-out question end the way some train wording of the same answer does? (the mesh mostly remembers the tail)
const tail = (s, n = 4) => s.trim().slice(-n).toLowerCase();
const trainTails = new Map(); for (const t of world.train) { (trainTails.get(t.gold) ?? trainTails.set(t.gold, new Set()).get(t.gold)).add(tail(t.q)); }

for (const build of [memoriser, keyword, meshSystem]) {
  const t0 = performance.now();
  const system = build(world.train);
  const pick = pickThreshold(system, world.val);
  const rows = evaluate(system, world.test, pick.t);
  for (const r of rows) if (r.gold !== null && (r.cat === 'para-capital' || r.cat === 'para-currency')) r.tailShared = trainTails.get(r.gold)?.has(tail(r.q)) ?? false;
  const agg = aggregate(rows);
  const paraRows = rows.filter((r) => r.cat === 'para-capital' || r.cat === 'para-currency');
  const split = (flag) => { const s = paraRows.filter((r) => r.tailShared === flag); return { n: s.length, exact: s.length ? +(s.filter((r) => r.outcome === 'correct').length / s.length).toFixed(3) : null }; };
  results.systems[system.name] = { threshold: pick.t, validationScore: pick.score, teach: system.teach, seconds: +((performance.now() - t0) / 1000).toFixed(1),
    test: agg, paraphraseByTailShared: { tailSharedWithTrain: split(true), tailDifferent: split(false) }, cases: rows };
}

if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
const f = (x) => (x === null ? '  - ' : (x * 100).toFixed(0).padStart(3) + '%');
console.log(`\nseed ${SEED} | mesh ${MESH} | pooling ${POOLING} | memory ${MEMORY} | train ${results.meta.trainItems}, val ${results.meta.valItems}, test ${results.meta.testItems}`);
console.log('system'.padEnd(32), 'score  taught paraph paraCur surface | answerable: exact miss wrong | unanswerable: abstain halluc');
for (const [name, s] of Object.entries(results.systems)) {
  const c = s.test.byCategory, pc = (k) => (c[k] ? c[k].correct / c[k].n : null);
  console.log(name.padEnd(32), f(s.test.score), ' ', f(pc('taught-exact')), ' ', f(pc('para-capital')), ' ', f(pc('para-currency')), ' ', f(pc('surface-variant')), '       |         ', f(s.test.answerable.exact), f(s.test.answerable.missed), f(s.test.answerable.wrong), '  |        ', f(s.test.unanswerable.rightAbstain), f(s.test.unanswerable.hallucinated), `  (threshold ${s.threshold}, ${s.seconds}s)`);
}
