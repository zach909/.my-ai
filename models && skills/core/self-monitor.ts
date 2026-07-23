/**
 * Self-Modeling & Self-Correction (Spec Section 11).
 *
 * Section 11 asks the system to monitor its own internal state, compare
 * *expected* behavior with *actual* behavior, and treat a large divergence as a
 * signal that something unexpected happened — while distinguishing a normal
 * prediction error from a serious system failure, and never treating this as
 * evidence of consciousness.
 *
 * The hyperdimensional engine already does this at the *neuron* level (its
 * self-model surprise). This is the *system* level: a lightweight monitor that
 * tracks high-level signals (alignment score, memory growth, health, plan
 * progress …), maintains an adaptive baseline for each, and classifies each new
 * observation as normal / warning / failure by how far it deviates from what
 * was expected. A failure-level anomaly is the signal that self-healing (§24)
 * or a re-route should run.
 *
 * Deterministic and local; no claim of subjective experience.
 */

export type Severity = "normal" | "warning" | "failure";

export interface Observation {
  name: string;
  expected: number;
  actual: number;
  /** Deviation normalized by the signal's scale (0 = on expectation). */
  deviation: number;
  severity: Severity;
  anomaly: boolean;
  timestamp: number;
}

export interface SelfMonitorConfig {
  /** Normalized deviation above which an observation is a warning (default 2). */
  warnThreshold?: number;
  /** Normalized deviation above which it is a failure (default 4). */
  failThreshold?: number;
  /** EMA smoothing for the adaptive baseline (default 0.2). */
  alpha?: number;
}

interface Baseline {
  mean: number;
  /** Running mean absolute deviation — the expected fluctuation scale. */
  scale: number;
  count: number;
}

export class SelfMonitor {
  private baselines = new Map<string, Baseline>();
  private log: Observation[] = [];
  private readonly logCapacity = 5000;
  private readonly warn: number;
  private readonly fail: number;
  private readonly alpha: number;

  constructor(cfg: SelfMonitorConfig = {}) {
    this.warn = cfg.warnThreshold ?? 2;
    this.fail = cfg.failThreshold ?? 4;
    this.alpha = cfg.alpha ?? 0.2;
  }

  /**
   * Record an observation of a signal. With an explicit `expected`, deviation
   * is measured against it; otherwise against the signal's adaptive baseline.
   * Returns the classified observation. The baseline is only nudged by
   * non-failure observations, so a genuine failure does not silently normalize
   * itself into the expected range.
   */
  observe(name: string, actual: number, expected?: number): Observation {
    const now = Date.now();
    const base = this.baselines.get(name);

    // First sighting (with no explicit expectation): establish the baseline.
    if (base === undefined && expected === undefined) {
      this.baselines.set(name, { mean: actual, scale: Math.max(1e-9, Math.abs(actual) * 0.1), count: 1 });
      const obs: Observation = { name, expected: actual, actual, deviation: 0, severity: "normal", anomaly: false, timestamp: now };
      this.log.push(obs);
      if (this.log.length > this.logCapacity) this.log.splice(0, this.log.length - this.logCapacity);
      return obs;
    }

    const exp = expected ?? base!.mean;
    const scale = expected !== undefined ? Math.max(1e-9, Math.abs(expected) * 0.1 || 1e-9) : Math.max(1e-9, base!.scale);
    const rawDev = Math.abs(actual - exp);
    const deviation = rawDev / scale;
    const severity: Severity = deviation >= this.fail ? "failure" : deviation >= this.warn ? "warning" : "normal";

    // Adapt the baseline toward the observation (skip on failure so an outlier
    // does not become the new "expected").
    if (base) {
      if (severity !== "failure") {
        base.mean = base.mean + this.alpha * (actual - base.mean);
        base.scale = Math.max(1e-9, base.scale + this.alpha * (rawDev - base.scale));
        base.count++;
      }
    } else if (expected !== undefined) {
      // Seed a baseline from the first explicitly-expected observation.
      this.baselines.set(name, { mean: actual, scale, count: 1 });
    }

    const obs: Observation = { name, expected: exp, actual, deviation, severity, anomaly: severity !== "normal", timestamp: now };
    this.log.push(obs);
    if (this.log.length > this.logCapacity) this.log.splice(0, this.log.length - this.logCapacity);
    return obs;
  }

  /** The most recent observation per signal that is currently anomalous. */
  anomalies(): Observation[] {
    const latest = new Map<string, Observation>();
    for (const o of this.log) latest.set(o.name, o);
    return Array.from(latest.values()).filter(o => o.anomaly);
  }

  /** True when any signal is at failure severity — the "serious failure" flag. */
  hasFailure(): boolean {
    return this.anomalies().some(o => o.severity === "failure");
  }

  baselineOf(name: string): number | undefined {
    return this.baselines.get(name)?.mean;
  }

  history(name?: string): Observation[] {
    return name ? this.log.filter(o => o.name === name) : [...this.log];
  }

  reset(): void {
    this.baselines.clear();
    this.log = [];
  }
}
