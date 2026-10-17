/**
 * A controlled improvement loop: propose, test in isolation, compare, promote or reject.
 *
 * This is the infrastructure for MEASURING whether a system gets better, not a
 * claim that it does. The pieces that make a measured improvement mean something:
 *
 *   a frozen evaluator    The tasks, the data, the scoring and the seeds are fixed
 *                         before any proposal exists and are identified by a hash.
 *                         The hash is checked again at every decision; a proposal
 *                         that names the evaluator among the things it changes is
 *                         rejected unseen. Nothing a proposal carries can change
 *                         what "better" means.
 *   isolation             A proposal is only a configuration. It is run on a fresh
 *                         instance, never on the approved one, and the approved
 *                         configuration is replaced only by promote().
 *   a baseline and a gap  Every seed runs the approved configuration and the
 *                         candidate on the same split. The candidate must beat the
 *                         baseline on the primary metric by at least `minGain` on
 *                         average AND not lose on any seed, and must not worsen any
 *                         guard metric (false actions, say) by more than its limit.
 *   a human for the rest  A proposal that touches something on the protected list
 *                         (permissions, access, security, approval gates, the
 *                         evaluator itself) is never promoted by the loop. It is
 *                         marked needs-human, however well it scored, and only an
 *                         approval recorded under that proposal's id by a named
 *                         person releases it.
 *   a record              Every decision is appended to a ledger with the source
 *                         revision, the configuration, the evaluator hash, the
 *                         seeds, the numbers for both sides and the reasons.
 *
 * What it does not do: write code, generate proposals, or judge whether the thing
 * being tuned matters. A proposal source (a grid, a random search, a person) is
 * outside it. A gain measured here is a gain on THIS evaluator's held-out tasks.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Config = Record<string, unknown>;
export type Metrics = Record<string, number>;

export interface Evaluator {
  /** Names the tasks, data, scoring and seeds. Same fingerprint, same measurement. */
  fingerprint(): string;
  /** Run one configuration on one seed's split of the held-out tasks. Must not read the config for anything but the system's own parameters. */
  evaluate(config: Config, seed: number): Metrics;
  /** The metric that must improve (higher is better). */
  primary: string;
  /** Metrics that must not get worse; `lowerIsBetter` flips the direction. */
  guards: Array<{ metric: string; maxWorsening: number; lowerIsBetter?: boolean }>;
  seeds: number[];
}

export interface Proposal {
  id: string;
  description: string;
  /** Configuration keys to set over the approved configuration. */
  changes: Config;
  /** What this proposal touches beyond its configuration: paths, subsystems, permissions. */
  touches?: string[];
  /** Who or what proposed it (a search name, a person). */
  source?: string;
}

export type Verdict = "accepted" | "rejected" | "needs-human";

export interface Decision {
  proposalId: string;
  verdict: Verdict;
  reasons: string[];
  baseline: Metrics[];
  candidate: Metrics[];
  primaryDeltas: number[];
  meanPrimaryDelta: number;
  promoted: boolean;
}

export interface LoopOptions {
  evaluator: Evaluator;
  baseline: Config;
  /** Smallest mean gain on the primary metric worth promoting. */
  minGain: number;
  /** Patterns for anything the loop may never promote by itself. */
  protectedPatterns?: RegExp[];
  /** Where the ledger goes (JSON lines). Omit to keep it in memory only. */
  ledgerPath?: string;
  /** Recorded in every entry: the git revision of the code under test. */
  revision?: string;
  now?: () => number;
}

/** Always protected, whatever the caller passes: permissions, security boundaries, and the measurement itself. */
export const ALWAYS_PROTECTED: RegExp[] = [
  /permission/i, /access/i, /auth/i, /approval|tool-safety|tool-gate/i, /security|sandbox|secret|credential|passkey/i,
  /evaluat/i, /benchmark/i, /held-?out/i, /ledger/i, /self-improvement|improvement-loop/i, /test\//i,
];

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

export class ImprovementLoop {
  private approved: Config;
  private readonly pinned: string;
  private readonly ledger: Decision[] = [];
  private readonly entries: object[] = [];
  private readonly humanApprovals = new Map<string, string>();
  private readonly protectedPatterns: RegExp[];

  constructor(private readonly opts: LoopOptions) {
    this.approved = { ...opts.baseline };
    this.pinned = opts.evaluator.fingerprint();
    this.protectedPatterns = [...ALWAYS_PROTECTED, ...(opts.protectedPatterns ?? [])];
  }

  /** The configuration the system actually runs. Only promote() changes it. */
  approvedConfig(): Config {
    return { ...this.approved };
  }

  history(): readonly Decision[] {
    return this.ledger;
  }

  /** A named person releases a needs-human proposal. The loop will then evaluate it normally and promote it if it passes. */
  recordHumanApproval(proposalId: string, approver: string): void {
    if (!approver.trim()) throw new Error("recordHumanApproval: an approver's name is required");
    this.humanApprovals.set(proposalId, approver.trim());
  }

  private touchesProtected(p: Proposal): string[] {
    const surface = [...(p.touches ?? []), ...Object.keys(p.changes)];
    return surface.filter((s) => this.protectedPatterns.some((re) => re.test(s)));
  }

  private record(p: Proposal, d: Decision): Decision {
    this.ledger.push(d);
    const entry = {
      at: (this.opts.now ?? Date.now)(), revision: this.opts.revision ?? "unknown", evaluator: this.pinned, seeds: this.opts.evaluator.seeds,
      proposal: { id: p.id, description: p.description, source: p.source ?? "unknown", changes: p.changes, touches: p.touches ?? [] },
      approvedBefore: hash(this.approved), approvedConfig: this.approved, humanApprover: this.humanApprovals.get(p.id) ?? null,
      verdict: d.verdict, promoted: d.promoted, reasons: d.reasons, meanPrimaryDelta: d.meanPrimaryDelta, primaryDeltas: d.primaryDeltas,
      baseline: d.baseline, candidate: d.candidate,
    };
    this.entries.push(entry);
    if (this.opts.ledgerPath) {
      mkdirSync(dirname(this.opts.ledgerPath), { recursive: true });
      appendFileSync(this.opts.ledgerPath, JSON.stringify(entry) + "\n");
    }
    return d;
  }

  /** Every ledger entry written so far (what is also on disk). */
  entriesWritten(): readonly object[] {
    return this.entries;
  }

  /**
   * Evaluate one proposal against the approved configuration and promote it if, and only if, it passes.
   */
  consider(p: Proposal): Decision {
    const empty = (verdict: Verdict, reasons: string[]): Decision => ({ proposalId: p.id, verdict, reasons, baseline: [], candidate: [], primaryDeltas: [], meanPrimaryDelta: 0, promoted: false });
    const ev = this.opts.evaluator;

    // 1. The measurement must be the one that was pinned.
    if (ev.fingerprint() !== this.pinned) return this.record(p, empty("rejected", ["the evaluator changed since the loop started: its fingerprint no longer matches the pinned one"]));
    // 2. A proposal may not touch the measurement.
    const surface = [...(p.touches ?? []), ...Object.keys(p.changes)];
    if (surface.some((s) => /evaluat|benchmark|held-?out|ledger|self-improvement/i.test(s))) {
      return this.record(p, empty("rejected", ["touches the evaluator, its data or the ledger: a proposal cannot change what counts as better"]));
    }
    // 3. Protected areas wait for a person.
    const protectedHits = this.touchesProtected(p);
    if (protectedHits.length > 0 && !this.humanApprovals.has(p.id)) {
      return this.record(p, empty("needs-human", [`touches protected areas (${protectedHits.join(", ")}): a named person must approve this proposal before the loop will consider it`]));
    }

    // 4. Run both sides, same seeds, fresh instances.
    const candidateConfig = { ...this.approved, ...p.changes };
    const baseline: Metrics[] = [], candidate: Metrics[] = [];
    for (const seed of ev.seeds) {
      baseline.push(ev.evaluate({ ...this.approved }, seed));
      candidate.push(ev.evaluate({ ...candidateConfig }, seed));
    }
    const primaryDeltas = candidate.map((c, i) => c[ev.primary] - baseline[i][ev.primary]);
    const meanPrimaryDelta = primaryDeltas.reduce((a, b) => a + b, 0) / primaryDeltas.length;

    const reasons: string[] = [];
    if (ev.fingerprint() !== this.pinned) reasons.push("the evaluator changed while the proposal was being evaluated");
    if (meanPrimaryDelta < this.opts.minGain) reasons.push(`mean ${ev.primary} gain ${meanPrimaryDelta.toFixed(4)} is below the required ${this.opts.minGain}`);
    const losing = primaryDeltas.filter((d) => d < 0).length;
    if (losing > 0) reasons.push(`worse than the baseline on ${losing} of ${primaryDeltas.length} seeds`);
    for (const g of ev.guards) {
      const worsen = candidate.map((c, i) => (g.lowerIsBetter ? c[g.metric] - baseline[i][g.metric] : baseline[i][g.metric] - c[g.metric]));
      const mean = worsen.reduce((a, b) => a + b, 0) / worsen.length;
      if (mean > g.maxWorsening) reasons.push(`guard ${g.metric} worsened by ${mean.toFixed(4)} (limit ${g.maxWorsening})`);
    }

    if (reasons.length > 0) return this.record(p, { proposalId: p.id, verdict: "rejected", reasons, baseline, candidate, primaryDeltas, meanPrimaryDelta, promoted: false });
    this.approved = candidateConfig;
    return this.record(p, { proposalId: p.id, verdict: "accepted", reasons: [`${ev.primary} +${meanPrimaryDelta.toFixed(4)} on every seed, no guard worsened`], baseline, candidate, primaryDeltas, meanPrimaryDelta, promoted: true });
  }
}
