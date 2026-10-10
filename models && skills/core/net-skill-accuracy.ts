/**
 * How well each net skill has predicted what an input is about, and the
 * on/off decision that follows from it.
 *
 * The router (net-skill-router.ts) predicts, for every input, which skill
 * regions the input is about. It used to do that forever with no memory of
 * whether it had been right, so a region whose meaning matched many inputs on
 * paper and almost none in practice kept being asked every time. This keeps
 * the score and acts on it.
 *
 * The rule, in plain terms:
 *   - Each time a region is predicted for an input whose real outcome is known,
 *     it either was part of that outcome (a hit) or was not (a miss).
 *   - Accuracy is a moving average over those, starting at a neutral 0.5 so a
 *     couple of early results cannot decide anything.
 *   - After `minTrials` results, a region whose accuracy falls below `offBelow`
 *     is switched off; once off, it is switched back on when its accuracy
 *     reaches `onAbove`. The two thresholds differ on purpose: a single cutoff
 *     would flip a region on and off around it.
 *   - A switched-off region is still judged -- the router predicts for it
 *     without running it -- which is how it can earn its way back. Without
 *     that, off would be forever.
 *   - The owner can override per region: "on" and "off" ignore the score,
 *     "auto" follows it.
 *
 * One ledger is shared by every router in the process, so a decision made from
 * one place holds everywhere, and it persists so the learning survives a
 * restart.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";

export type SkillSwitch = "auto" | "on" | "off";

export interface GateConfig {
  /** Results needed before the score is allowed to switch a region. */
  minTrials: number;
  /** Accuracy below which a region is switched off. */
  offBelow: number;
  /** Accuracy at or above which a switched-off region comes back. */
  onAbove: number;
  /** Weight of the newest result in the moving average. */
  alpha: number;
}

/**
 * Calibrated for a router that predicts two regions per input while usually
 * one is right: even a good region is right well under half the time it is
 * named, so "off" means rarely right, not "less than half".
 */
export const DEFAULT_GATE: GateConfig = { minTrials: 20, offBelow: 0.15, onAbove: 0.3, alpha: 0.1 };

export interface SkillRecord {
  trials: number;
  hits: number;
  /** Moving average of hit (1) / miss (0), 0..1. */
  accuracy: number;
  /** The score has switched this region off. Only matters in "auto". */
  autoOff: boolean;
  mode: SkillSwitch;
  updatedAt: number;
}

export interface SkillStatus extends SkillRecord {
  id: string;
  /** Whether the router will run this region right now. */
  enabled: boolean;
  /** Why, in a sentence. */
  reason: string;
}

const NEUTRAL = 0.5;

function fresh(): SkillRecord {
  return { trials: 0, hits: 0, accuracy: NEUTRAL, autoOff: false, mode: "auto", updatedAt: 0 };
}

export class SkillAccuracyLedger {
  private readonly records = new Map<string, SkillRecord>();
  private file: string | null = null;
  readonly gate: GateConfig;

  constructor(gate: Partial<GateConfig> = {}) {
    this.gate = { ...DEFAULT_GATE, ...gate };
  }

  /** Should the router run this region? Unknown regions run: no record means no complaint. */
  isEnabled(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec || rec.mode === "on") return true;
    if (rec.mode === "off") return false;
    return !rec.autoOff;
  }

  /**
   * Record one result. Returns "off" or "on" when this result is what flipped
   * the automatic decision, so the caller can say so.
   */
  record(id: string, hit: boolean, now: number = Date.now()): "off" | "on" | null {
    const rec = this.records.get(id) ?? fresh();
    rec.trials++;
    if (hit) rec.hits++;
    rec.accuracy += this.gate.alpha * ((hit ? 1 : 0) - rec.accuracy);
    rec.updatedAt = now;

    let flipped: "off" | "on" | null = null;
    if (rec.trials >= this.gate.minTrials) {
      if (!rec.autoOff && rec.accuracy < this.gate.offBelow) {
        rec.autoOff = true;
        flipped = "off";
      } else if (rec.autoOff && rec.accuracy >= this.gate.onAbove) {
        rec.autoOff = false;
        flipped = "on";
      }
    }
    this.records.set(id, rec);
    this.save();
    return flipped;
  }

  setSwitch(id: string, mode: SkillSwitch): void {
    const rec = this.records.get(id) ?? fresh();
    rec.mode = mode;
    rec.updatedAt = Date.now();
    this.records.set(id, rec);
    this.save();
  }

  /** Forget what has been learned about a region (for one that has changed). Keeps the owner's switch. */
  reset(id: string): void {
    const rec = this.records.get(id);
    if (!rec) return;
    this.records.set(id, { ...fresh(), mode: rec.mode, updatedAt: Date.now() });
    this.save();
  }

  get(id: string): SkillRecord | undefined {
    const rec = this.records.get(id);
    return rec ? { ...rec } : undefined;
  }

  status(id: string): SkillStatus {
    const rec = this.records.get(id) ?? fresh();
    return { ...rec, id, enabled: this.isEnabled(id), reason: this.reason(rec) };
  }

  /** Every region the ledger has heard of. */
  all(): SkillStatus[] {
    return Array.from(this.records.keys(), id => this.status(id));
  }

  private reason(rec: SkillRecord): string {
    const pct = `${Math.round(rec.accuracy * 100)}%`;
    if (rec.mode === "on") return "Kept on by you, whatever its score.";
    if (rec.mode === "off") return "Kept off by you.";
    if (rec.trials < this.gate.minTrials) {
      return `Still learning: ${rec.trials} of ${this.gate.minTrials} results needed before its score can switch it.`;
    }
    return rec.autoOff
      ? `Switched off: right about ${pct} of the time. Comes back at ${Math.round(this.gate.onAbove * 100)}%.`
      : `On: right about ${pct} of the time. Switches off below ${Math.round(this.gate.offBelow * 100)}%.`;
  }

  /** Load the saved ledger from `file`, and write back to it whenever it changes. */
  persistTo(file: string): void {
    this.file = file;
    if (!existsSync(file)) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { skills?: Record<string, Partial<SkillRecord>> };
      for (const [id, raw] of Object.entries(parsed.skills ?? {})) {
        if (!raw || typeof raw !== "object") continue;
        const rec = fresh();
        if (Number.isFinite(raw.trials)) rec.trials = Math.max(0, Math.floor(raw.trials!));
        if (Number.isFinite(raw.hits)) rec.hits = Math.max(0, Math.floor(raw.hits!));
        if (Number.isFinite(raw.accuracy)) rec.accuracy = Math.min(1, Math.max(0, raw.accuracy!));
        if (typeof raw.autoOff === "boolean") rec.autoOff = raw.autoOff;
        if (raw.mode === "on" || raw.mode === "off" || raw.mode === "auto") rec.mode = raw.mode;
        if (Number.isFinite(raw.updatedAt)) rec.updatedAt = raw.updatedAt!;
        this.records.set(id, rec);
      }
    } catch {
      // An unreadable ledger starts over rather than blocking boot. Worst case
      // is that regions are neutral again, which is where they began.
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, { version: 1, skills: Object.fromEntries(this.records) });
    } catch {
      // Bookkeeping must not break routing; the next change tries again.
    }
  }
}
