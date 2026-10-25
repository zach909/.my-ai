/**
 * Curiosity: an intrinsic drive to find out what it does not know.
 *
 * Everything else in this repo learns when it is handed something -- a chat,
 * a document, a taught example. Nothing made the system go and look. This is
 * the missing half: a standing drive that keeps a list of things it wonders
 * about, picks the one most worth chasing, goes and finds out, checks whether
 * it actually came back knowing more, and lets what it found raise the next
 * question.
 *
 * What it rewards, and why it is not "chase whatever is new"
 * ---------------------------------------------------------
 * A drive that rewards novelty or surprise gets stuck on noise: a source that
 * is random forever stays surprising forever (the "noisy TV" trap), so the
 * agent stares at it and learns nothing. So the reward here is LEARNING
 * PROGRESS: how much coverage of the topic went up after exploring it, read
 * off the knowledge graph before and after. A topic that stays surprising but
 * never gets understood earns zero progress, its interest decays, and the
 * drive moves on (and comes back to it much later, once). Interest in a topic
 * is part how much is unknown (the gap), part how much exploring it has paid
 * off lately, and a little for never having looked. Boredom halves it per
 * fruitless visit.
 *
 * Where questions come from (all of them inherent, none scheduled by a person)
 *   - a question it was asked and could not answer ("what is X"),
 *   - words in what it is told that the graph barely knows,
 *   - contradictions it is holding (two claims it cannot both believe),
 *   - concepts that exist but connect to nothing (it has a word and no idea),
 *   - the edge of what it just learned: the object of a new fact it has no
 *     picture of yet. Learning one thing raises the next question.
 *
 * What it will not do
 *   - It never trains the mesh. It decides WHAT to learn and routes it through
 *     the same AutonomousLearner every other fact goes through, so reliability
 *     checks and conflict preservation still apply (conflicts are kept, not
 *     overwritten, and become a new question).
 *   - It never reaches for anything that looks like a secret, a path, a URL or
 *     an address (`isSafeTopic`): honest curiosity is about ideas, and the
 *     honeypot in agent-profile.ts exists precisely to catch the other kind.
 *   - It does not decide where answers come from. The caller supplies the
 *     `explore` function (the system gives it memory and, only if the owner
 *     turned it on, the owner's own SearXNG) and an `allow` gate (the system
 *     gives it the AlignmentVeto). Every exploration is bounded: a cap per
 *     hour, a cap on facts per topic, and a pause switch.
 *
 * Deterministic and local, like its neighbours: time is injectable, nothing is
 * random, so it can be tested without a network or a clock.
 */

import type { KnowledgeGraph } from "./knowledge-graph.js";
import type { AutonomousLearner, LearnResult } from "./autonomous-learner.js";

export type GapSource = "asked" | "contradiction" | "surprise" | "unknown" | "dangling" | "frontier";

export interface Interest {
  topic: string;
  source: GapSource;
  /** 0..1: how much of this is still unknown. Only exploring that actually teaches something lowers it. */
  gap: number;
  /** 0..1: running average of recent learning progress. Starts optimistic (0.5): an unexplored gap might be tractable. */
  progress: number;
  visits: number;
  /** Consecutive explorations that taught nothing. Each one halves the interest. */
  stale: number;
  /** How many questions removed from something a person asked. Caps runaway chains. */
  depth: number;
  addedAt: number;
  lastVisit: number;
  /** Not chased again until this time (bored, withheld, or the source was unreachable). */
  retiredUntil: number;
}

export interface Exploration {
  topic: string;
  source: GapSource;
  at: number;
  facts: number;
  /** Facts the learner took in (stored, updated, or recommended as a skill/extension). */
  gained: number;
  /** Facts that disagreed with something already believed: kept alongside it, and now a question of their own. */
  conflicts: number;
  /** Facts the learner refused (too unreliable). */
  ignored: number;
  coverageBefore: number;
  coverageAfter: number;
  /** 0..1: the intrinsic reward. */
  progress: number;
  /** New questions this exploration raised. */
  spawned: string[];
  /** Why nothing was explored (withheld by the gate, or the source failed). */
  skipped?: string;
}

export type Explorer = (topic: string) => Promise<string[]>;

export interface CuriosityDeps {
  /** Goes and finds out. Returns plain statements about the topic. Failures are caught here, never thrown into the caller. */
  explore: Explorer;
  /** Last word before a topic is explored (the system wires the AlignmentVeto in). Default: allow. */
  allow?: (topic: string, source: GapSource) => boolean;
  now?: () => number;
}

export interface CuriosityOptions {
  /** Explorations started per rolling hour (default 12). The brake on a drive that never gets tired. */
  maxPerHour?: number;
  /** Facts taken from one exploration (default 8). */
  factsPerTopic?: number;
  /** Fruitless visits in a row before a topic is put down (default 3). */
  patience?: number;
  /** How long a put-down topic is left alone (default 6 hours). */
  cooldownMs?: number;
  /** Most interests held at once; the least interesting is dropped (default 200). */
  capacity?: number;
  /** Frontier questions stop this many steps from a person's question (default 3). */
  maxDepth?: number;
  /** Below this the drive is quiet and surveys its own knowledge for gaps instead (default 0.08). */
  minDrive?: number;
  /** Coverage at or above this counts as known: no question is raised, and an open one is closed (default 0.7). */
  knownAt?: number;
}

export type Mood = "resting" | "restless" | "curious" | "absorbed";

export interface CuriosityStatus {
  mood: Mood;
  /** Strength of the strongest pull right now, 0..1. */
  drive: number;
  paused: boolean;
  wondering: Array<{ topic: string; source: GapSource; interest: number; gap: number; visits: number }>;
  /** Put down for now: asked about, learned nothing, will be revisited after the cooldown. */
  setAside: string[];
  explored: number;
  /** Topics that ended up known because of exploring them. */
  resolved: number;
  /** Explorations still allowed this hour. */
  budgetLeft: number;
  recent: Exploration[];
}

export interface CuriosityState {
  version: 1;
  interests: Interest[];
  explored: number;
  resolved: number;
  recent: Exploration[];
  started: number[];
  /** A pause is the owner's decision; it has to outlive a restart. */
  paused?: boolean;
}

const HOUR = 3_600_000;
const SOURCES: readonly GapSource[] = ["asked", "contradiction", "surprise", "unknown", "dangling", "frontier"];

/** Common words that are never worth wondering about. */
const STOP = new Set((
  "about above after again against almost always another around because before being between " +
  "could doing during either enough every first having himself herself should something sometimes " +
  "still their there these thing things think those through today under until using where whether " +
  "which while would please really maybe tell show give make want need know like just"
).split(" "));

/** Anything that smells like a secret, a file path, a link or an address is not a topic. */
const SECRET_WORDS = /password|passwd|passphrase|secret|credential|api[ _-]?key|access[ _-]?token|private[ _-]?key|ssh|\.env|seed phrase|social security|credit card|bank account/i;

/** Curiosity is about ideas. It refuses to chase anything that reads like a secret, a path, a link or a person's address. */
export function isSafeTopic(topic: string): boolean {
  const t = (topic ?? "").trim();
  if (t.length < 3 || t.length > 120) return false;
  if (/[\u0000-\u001f]/.test(t)) return false;
  if (/[\\/@]|https?:|www\./i.test(t)) return false;
  if (/\d{6,}/.test(t)) return false;
  return !SECRET_WORDS.test(t);
}

/**
 * Pull statements about `topic` out of free text (a memory entry, a search
 * snippet): whole sentences that mention it, long enough to say something and
 * short enough to be one claim. What the learner makes of them is its call.
 */
export function factsAbout(topic: string, text: string, max = 4): string[] {
  const words = topic.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (words.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 20 || s.length > 300) continue;
    const lower = s.toLowerCase();
    if (!words.some(w => lower.includes(w))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const normalize = (s: string): string => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const GAINED = new Set<LearnResult["decision"]>(["stored", "updated-existing", "recommend-skill", "recommend-extension"]);

export class CuriosityDrive {
  private interests = new Map<string, Interest>();
  private recent: Exploration[] = [];
  private started: number[] = [];
  private explored = 0;
  private resolved = 0;
  private paused = false;
  private readonly o: Required<CuriosityOptions>;

  constructor(
    private readonly knowledge: KnowledgeGraph,
    private readonly learner: AutonomousLearner,
    private readonly deps: CuriosityDeps,
    opts: CuriosityOptions = {},
  ) {
    this.o = {
      maxPerHour: opts.maxPerHour ?? 12,
      factsPerTopic: opts.factsPerTopic ?? 8,
      patience: opts.patience ?? 3,
      cooldownMs: opts.cooldownMs ?? 6 * HOUR,
      capacity: opts.capacity ?? 200,
      maxDepth: opts.maxDepth ?? 3,
      minDrive: opts.minDrive ?? 0.08,
      knownAt: opts.knownAt ?? 0.7,
    };
  }

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  setPaused(paused: boolean): void { this.paused = paused; }
  isPaused(): boolean { return this.paused; }

  /**
   * How much the graph knows about a topic, 0..1. A concept with a definition
   * and a few connections is well known; a topic with no concept of its own is
   * only as known as its nearest neighbour, and never past halfway.
   */
  coverage(topic: string): number {
    const concept = this.knowledge.getConcept(topic);
    const own = concept ? (concept.definition ? 0.4 : 0.1) + 0.6 * Math.min(1, this.knowledge.degree(topic) / 4) : 0;
    const hit = this.knowledge.search(topic, 1)[0];
    const near = hit && hit.concept.id !== concept?.id ? 0.5 * hit.score : 0;
    return clamp01(Math.max(own, near));
  }

  // ---- where questions come from -------------------------------------------------------

  /**
   * Start wondering about something, or wonder harder if already doing so.
   * Returns the interest, or null if it is not a safe topic, is already known,
   * or the chain of questions has run too deep.
   */
  wonder(topic: string, source: GapSource, strength = 0.5, depth = 0): Interest | null {
    const label = topic.trim().replace(/\s+/g, " ");
    if (!isSafeTopic(label)) return null;
    const key = normalize(label);
    const now = this.now();
    const existing = this.interests.get(key);
    if (existing) {
      existing.gap = clamp01(existing.gap + strength * 0.5);
      // A person asking, or a fresh contradiction, is new evidence: worth another try even if it was put down.
      if (source === "asked" || source === "contradiction") {
        existing.retiredUntil = 0;
        existing.source = source;
      }
      return existing;
    }
    if (source === "frontier" && depth > this.o.maxDepth) return null;
    if (this.coverage(label) >= this.o.knownAt) return null;
    const interest: Interest = {
      topic: label, source, gap: clamp01(strength), progress: 0.5, visits: 0, stale: 0,
      depth, addedAt: now, lastVisit: 0, retiredUntil: 0,
    };
    this.interests.set(key, interest);
    this.trim();
    return this.interests.has(key) ? interest : null;
  }

  /**
   * Listen to something said to the system. A direct question it cannot
   * answer is the strongest pull there is; otherwise, long words the graph has
   * never heard of are worth a look (at most two per message, so one long
   * paragraph cannot flood the list).
   */
  noticeText(text: string): Interest[] {
    const raised = new Map<string, Interest>();
    const t = (text ?? "").trim();
    if (!t) return [];
    const q = /\b(?:what|who)\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?([a-z][a-z\- ]{2,50}?)\s*[?.!]*$/i.exec(t)
      ?? /\bhow\s+(?:does|do|did)\s+(?:a\s+|an\s+|the\s+)?([a-z][a-z\- ]{2,50}?)\s+work\s*[?.!]*$/i.exec(t);
    if (q) {
      const i = this.wonder(q[1], "asked", 0.9);
      if (i) raised.set(normalize(i.topic), i);
    }
    // Picking words out of free text is only safe when the text is not about something private: a
    // fragment of a password, a path or an address would otherwise become a search. Such a message
    // is not mined for words at all, and path/link/address-shaped tokens never are.
    if (SECRET_WORDS.test(t)) return [...raised.values()];
    const plain = t.replace(/\S*[\\/@]\S*|https?:\S*|www\.\S*/gi, " ");
    let n = 0;
    for (const w of new Set(plain.toLowerCase().split(/[^a-z]+/))) {
      if (n >= 2) break;
      if (w.length < 6 || STOP.has(w) || this.knowledge.getConcept(w) || this.interests.has(w)) continue;
      if (this.coverage(w) > 0.3) continue;
      const i = this.wonder(w, "unknown", 0.55);
      if (i) { raised.set(normalize(i.topic), i); n++; }
    }
    return [...raised.values()];
  }

  /** Hear what the learner decided about a fact: a disagreement or an unfamiliar object becomes a question. */
  noticeLearned(result: LearnResult, depth = 0): void {
    if (result.decision === "conflict-preserved" && result.subject) this.wonder(result.subject, "contradiction", 0.8, depth);
    if ((result.decision === "stored" || result.decision === "updated-existing") && result.object && depth < this.o.maxDepth) {
      this.wonder(result.object.replace(/^(?:a|an|the)\s+/i, ""), "frontier", 0.4, depth + 1);
    }
  }

  /**
   * Look over its own knowledge for loose ends: contradictions it is holding
   * and concepts that connect to nothing. This is what a mind with nothing
   * pressing does, and it is why the drive never simply goes idle.
   */
  scanKnowledge(): number {
    let raised = 0;
    for (const c of this.knowledge.findContradictions().slice(0, 3)) {
      if (this.wonder(c.a.from, "contradiction", 0.8)) raised++;
    }
    for (const c of this.knowledge.allConcepts()) {
      if (raised >= 6) break;
      if (c.name.split(/\s+/).length > 4 || this.knowledge.degree(c.name) > 0) continue;
      if (this.wonder(c.name, "dangling", c.definition ? 0.35 : 0.5)) raised++;
    }
    return raised;
  }

  // ---- choosing and exploring ----------------------------------------------------------

  /** How much a topic pulls right now: the gap, plus how well exploring it has paid off, plus a little for never having looked, all halved per fruitless visit. */
  interest(i: Interest): number {
    const novelty = 1 / Math.sqrt(1 + i.visits);
    return Math.pow(0.5, i.stale) * (0.5 * i.gap + 0.35 * i.progress + 0.15 * novelty);
  }

  private pick(now: number): Interest | null {
    let best: Interest | null = null;
    let bestScore = this.o.minDrive;
    for (const i of this.interests.values()) {
      if (i.retiredUntil > now) continue;
      const s = this.interest(i);
      if (s > bestScore) { best = i; bestScore = s; }
    }
    return best;
  }

  private trim(): void {
    while (this.interests.size > this.o.capacity) {
      let worst: string | null = null;
      let worstScore = Infinity;
      for (const [k, i] of this.interests) {
        const s = this.interest(i);
        if (s < worstScore) { worst = k; worstScore = s; }
      }
      if (worst === null) break;
      this.interests.delete(worst);
    }
  }

  /**
   * One step of wanting to know: pick the most interesting open question,
   * explore it, measure what it taught, and let that raise the next question.
   * Returns null when it is resting, out of budget, or has nothing to wonder
   * about; the system calls this on a slow timer when it is otherwise idle.
   */
  async step(): Promise<Exploration | null> {
    if (this.paused) return null;
    const now = this.now();
    this.started = this.started.filter(t => now - t < HOUR);
    if (this.started.length >= this.o.maxPerHour) return null;

    let interest = this.pick(now);
    if (!interest && this.scanKnowledge() > 0) interest = this.pick(now);
    if (!interest) return null;

    const base = { topic: interest.topic, source: interest.source, at: now };
    const blank = { facts: 0, gained: 0, conflicts: 0, ignored: 0, progress: 0, spawned: [] as string[] };

    if (this.deps.allow && !this.deps.allow(interest.topic, interest.source)) {
      interest.retiredUntil = now + this.o.cooldownMs;
      return this.record({ ...base, ...blank, coverageBefore: 0, coverageAfter: 0, skipped: "withheld by the alignment gate" });
    }

    this.started.push(now);
    this.explored++;
    interest.visits++;
    interest.lastVisit = now;
    const before = this.coverage(interest.topic);

    let facts: string[];
    try {
      facts = (await this.deps.explore(interest.topic))
        .filter((f): f is string => typeof f === "string")
        .map(f => f.trim().slice(0, 400))
        .filter(f => f.length > 0)
        .slice(0, this.o.factsPerTopic);
    } catch (err) {
      // An unreachable source says nothing about the topic: back off briefly, do not count it as boring.
      interest.retiredUntil = now + 10 * 60_000;
      return this.record({ ...base, ...blank, coverageBefore: before, coverageAfter: before, skipped: `could not explore: ${err instanceof Error ? err.message : String(err)}` });
    }

    let gained = 0, conflicts = 0, ignored = 0;
    let firstGained: string | undefined;
    const spawned: string[] = [];
    for (const fact of facts) {
      const result = this.learner.learn(fact);
      if (GAINED.has(result.decision)) { gained++; firstGained ??= fact; }
      else if (result.decision === "conflict-preserved") conflicts++;
      else if (result.decision === "ignored-unreliable") ignored++;
      const sizeBefore = this.interests.size;
      this.noticeLearned(result, interest.depth);
      if (this.interests.size > sizeBefore && result.object) spawned.push(result.object);
    }
    // Having found something out, the topic itself becomes a thing it knows.
    const own = this.knowledge.getConcept(interest.topic);
    if (firstGained && !(own && own.definition)) this.knowledge.addConcept(interest.topic, firstGained);

    const after = this.coverage(interest.topic);
    const progress = gained === 0 ? 0 : clamp01(2 * (after - before));

    interest.progress = 0.5 * interest.progress + 0.5 * progress;
    interest.stale = progress < 0.05 ? interest.stale + 1 : 0;
    interest.gap = clamp01(interest.gap * (1 - progress));

    if (after >= this.o.knownAt) {
      this.interests.delete(normalize(interest.topic));
      this.resolved++;
    } else if (interest.stale >= this.o.patience) {
      // Put down, not forgotten: one more fruitless try after the cooldown and it is put down again.
      interest.retiredUntil = now + this.o.cooldownMs;
      interest.stale = this.o.patience - 1;
    }

    return this.record({ ...base, facts: facts.length, gained, conflicts, ignored, coverageBefore: before, coverageAfter: after, progress, spawned });
  }

  private record(e: Exploration): Exploration {
    this.recent.push(e);
    if (this.recent.length > 50) this.recent.splice(0, this.recent.length - 50);
    return e;
  }

  // ---- how it feels from the outside ---------------------------------------------------

  status(): CuriosityStatus {
    const now = this.now();
    const open = [...this.interests.values()].filter(i => i.retiredUntil <= now);
    const ranked = open.map(i => ({ i, s: this.interest(i) })).sort((a, b) => b.s - a.s);
    const drive = ranked[0]?.s ?? 0;
    const last = [...this.recent].reverse().find(e => !e.skipped);
    let mood: Mood;
    if (this.paused) mood = "resting";
    else if (drive < this.o.minDrive) mood = "restless";
    else if (last && last.progress >= 0.3 && now - last.at < HOUR) mood = "absorbed";
    else mood = "curious";
    return {
      mood,
      drive: clamp01(drive),
      paused: this.paused,
      wondering: ranked.slice(0, 5).map(({ i, s }) => ({ topic: i.topic, source: i.source, interest: Number(s.toFixed(3)), gap: Number(i.gap.toFixed(3)), visits: i.visits })),
      setAside: [...this.interests.values()].filter(i => i.retiredUntil > now).map(i => i.topic).slice(0, 10),
      explored: this.explored,
      resolved: this.resolved,
      budgetLeft: Math.max(0, this.o.maxPerHour - this.started.filter(t => now - t < HOUR).length),
      recent: this.recent.slice(-10),
    };
  }

  // ---- keeping it across restarts ------------------------------------------------------

  toJSON(): CuriosityState {
    return {
      version: 1,
      interests: [...this.interests.values()],
      explored: this.explored,
      resolved: this.resolved,
      recent: this.recent,
      started: this.started,
      paused: this.paused,
    };
  }

  /** Restore saved state. Anything malformed is dropped rather than trusted. */
  restore(raw: unknown): void {
    const s = raw as Partial<CuriosityState> | null;
    if (!s || s.version !== 1 || !Array.isArray(s.interests)) return;
    this.interests.clear();
    for (const r of s.interests) {
      if (!r || typeof r.topic !== "string" || !isSafeTopic(r.topic) || !SOURCES.includes(r.source)) continue;
      const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
      this.interests.set(normalize(r.topic), {
        topic: r.topic, source: r.source,
        gap: clamp01(num(r.gap, 0.5)), progress: clamp01(num(r.progress, 0.5)),
        visits: Math.max(0, Math.floor(num(r.visits, 0))), stale: Math.max(0, Math.floor(num(r.stale, 0))),
        depth: Math.max(0, Math.floor(num(r.depth, 0))),
        addedAt: num(r.addedAt, 0), lastVisit: num(r.lastVisit, 0), retiredUntil: num(r.retiredUntil, 0),
      });
    }
    this.trim();
    this.explored = Math.max(0, Math.floor(Number(s.explored) || 0));
    this.resolved = Math.max(0, Math.floor(Number(s.resolved) || 0));
    this.recent = Array.isArray(s.recent) ? s.recent.slice(-50) : [];
    this.started = Array.isArray(s.started) ? s.started.filter(t => typeof t === "number" && Number.isFinite(t)) : [];
    this.paused = s.paused === true;
  }
}
