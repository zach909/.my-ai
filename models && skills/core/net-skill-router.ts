/**
 * Net-skill routing: which skill regions of the ONE mesh are asked this tick.
 *
 * This replaces the Mixture-of-Experts router (MoERouter). That router was a
 * separate learned gate in front of the mesh: a randomly initialised
 * inputDim x numExperts matrix whose top-k scores picked "experts", each of
 * which also carried its own (lazily allocated) weight matrix. It was a second
 * network deciding for the first one, and the experts it picked were named
 * after skills without being scored by anything the skills actually meant.
 *
 * A net skill is a REGION of the mesh -- a named neuron group grafted in by
 * net-skill-graft.ts and tuned to what the skill means (embedText of its
 * definition). So routing is just asking which regions this input is about:
 * each region's meaning is embedded the same way the graft tuned its neurons,
 * scored by cosine against the input, and the best `topK` become the tick's
 * `activeGroups`. No second network, no random weights, and a region is
 * chosen for exactly the reason it exists.
 */
import { embedText } from "./neuro-lang.js";
import { SkillAccuracyLedger, type SkillStatus } from "./net-skill-accuracy.js";

export interface NetSkillRegion {
  id: string;
  name: string;
  /** What the region is FOR, in words: what its input is compared against. */
  meaning: string;
}

export interface NetSkillSelection {
  /** Chosen region ids, best first. */
  ids: string[];
  /** Score of every chosen region (cosine similarity, -1..1). */
  scores: Map<string, number>;
}

export interface NetSkillUsage {
  id: string;
  name: string;
  /** Ticks this region was selected on. */
  selected: number;
  /** Fraction of all selections that went to this region. */
  share: number;
}

/** Below this similarity a region is not about the input at all and is never selected. */
const MIN_SCORE = 0.05;

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export class NetSkillRouter {
  private readonly regions = new Map<string, NetSkillRegion>();
  /** Embedded meanings, per dimension count (inputs arrive at more than one size). */
  private readonly meaningVectors = new Map<number, Map<string, number[]>>();
  private readonly usage = new Map<string, number>();
  private totalSelections = 0;

  /**
   * How well each region has predicted before, and which are switched off for
   * it. Private to this router unless the owner hands in a shared one, which
   * is how every router in a running system comes to agree on the same
   * on/off state.
   */
  private ledger: SkillAccuracyLedger;

  constructor(
    private readonly topK: number = 2,
    private readonly dims: number = 64,
    ledger: SkillAccuracyLedger = new SkillAccuracyLedger(),
  ) {
    this.ledger = ledger;
  }

  getLedger(): SkillAccuracyLedger { return this.ledger; }
  setLedger(ledger: SkillAccuracyLedger): void { this.ledger = ledger; }

  /** Add (or redescribe) a region. Returns how many regions there are. */
  register(region: NetSkillRegion): number {
    this.regions.set(region.id, region);
    for (const byId of this.meaningVectors.values()) byId.delete(region.id);
    if (!this.usage.has(region.id)) this.usage.set(region.id, 0);
    return this.regions.size;
  }

  unregister(id: string): boolean {
    for (const byId of this.meaningVectors.values()) byId.delete(id);
    this.usage.delete(id);
    return this.regions.delete(id);
  }

  has(id: string): boolean { return this.regions.has(id); }
  getRegion(id: string): NetSkillRegion | undefined { return this.regions.get(id); }
  listRegions(): NetSkillRegion[] { return Array.from(this.regions.values()); }
  getRegionCount(): number { return this.regions.size; }

  private meaningVector(id: string, dims: number): number[] {
    let byId = this.meaningVectors.get(dims);
    if (!byId) { byId = new Map(); this.meaningVectors.set(dims, byId); }
    let vec = byId.get(id);
    if (!vec) {
      const r = this.regions.get(id)!;
      vec = embedText(`${r.name} ${r.meaning}`, dims);
      byId.set(id, vec);
    }
    return vec;
  }

  /** Every region's similarity to `input`, best first. Does not count as a selection. */
  score(input: string | ArrayLike<number>): Array<{ id: string; score: number }> {
    const vec = typeof input === "string" ? embedText(input, this.dims) : input;
    const dims = vec.length;
    return Array.from(this.regions.keys())
      .map((id) => ({ id, score: cosine(vec, this.meaningVector(id, dims)) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  /**
   * The regions to ask this tick: the `k` whose meaning is closest to the
   * input, excluding any that are not related to it at all. Empty when
   * nothing is -- the caller then runs the mesh ungated.
   */
  select(input: string | ArrayLike<number>, k: number = this.topK): NetSkillSelection {
    // Switched-off regions are skipped before the cut to k, so the next-best
    // region takes the place instead of the tick running one short.
    const chosen = this.score(input)
      .filter((s) => s.score >= MIN_SCORE && this.ledger.isEnabled(s.id))
      .slice(0, Math.max(0, k));
    const scores = new Map(chosen.map((s) => [s.id, s.score]));
    for (const { id } of chosen) this.usage.set(id, (this.usage.get(id) ?? 0) + 1);
    this.totalSelections += chosen.length;
    return { ids: chosen.map((s) => s.id), scores };
  }

  /**
   * Score this router's prediction for `input` against what turned out to be
   * the right regions, and let the result feed the on/off decision.
   *
   * `actual` is ground truth from outside the router: the regions the input
   * really ended up needing (the plugins whose tools ran and succeeded, say).
   * With nothing known there is nothing to judge, and nothing is recorded: a
   * turn with no outcome is not a miss.
   *
   * It re-runs the prediction itself, over EVERY region including switched-off
   * ones. A region that is off is not run, but it can still be asked "would you
   * have been picked, and were you right?", which is how it earns its way back.
   *
   * `inScope` limits which regions are judged. A region that can never show up
   * in `actual` (because no signal for it exists yet) must not be recorded as
   * wrong every time it is predicted.
   */
  judge(
    input: string | ArrayLike<number>,
    actual: Iterable<string>,
    inScope?: (id: string) => boolean,
  ): Array<{ id: string; hit: boolean; flipped: "on" | "off" | null }> {
    const truth = new Set(actual);
    if (truth.size === 0) return [];
    // If none of the named outcomes is a region this router has, the outcome is
    // in a different vocabulary and says nothing about this router's
    // predictions. Scoring them all as misses would switch off good regions.
    if (!Array.from(truth).some((id) => this.regions.has(id))) return [];
    const out: Array<{ id: string; hit: boolean; flipped: "on" | "off" | null }> = [];
    for (const { id } of this.score(input).filter((s) => s.score >= MIN_SCORE).slice(0, this.topK)) {
      if (inScope && !inScope(id)) continue;
      const hit = truth.has(id);
      out.push({ id, hit, flipped: this.ledger.record(id, hit) });
    }
    return out;
  }

  /** Every registered region with its track record and whether it is running. */
  getAccuracy(): Array<SkillStatus & { name: string }> {
    return Array.from(this.regions.values(), (r) => ({ ...this.ledger.status(r.id), name: r.name }));
  }

  /** How often each region has been selected: the load-balance view the MoE used to report. */
  getUsage(): NetSkillUsage[] {
    return Array.from(this.regions.values()).map((r) => {
      const selected = this.usage.get(r.id) ?? 0;
      return { id: r.id, name: r.name, selected, share: this.totalSelections ? selected / this.totalSelections : 0 };
    });
  }
}
