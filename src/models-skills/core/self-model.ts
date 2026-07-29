/**
 * Self-Model (ASI §9).
 *
 * A model of the system's own capabilities and limitations: per-domain
 * competence updated from actual performance, so the system knows what it does
 * well, where it fails, and how confident a conclusion in a given domain
 * deserves to be. It is used to *calibrate* confidence — the system should not
 * claim certainty its track record does not support — and to surface capability
 * gaps that self-improvement (§5) should target.
 */

export interface DomainStat {
  domain: string;
  attempts: number;
  successes: number;
  /** EMA of success (0..1) — the live competence estimate. */
  competence: number;
}

export class SelfModel {
  private domains = new Map<string, DomainStat>();
  private readonly alpha: number;
  private readonly minAttempts: number;

  constructor(cfg: { alpha?: number; minAttempts?: number } = {}) {
    this.alpha = cfg.alpha ?? 0.3;
    this.minAttempts = cfg.minAttempts ?? 3;
  }

  /** Record the outcome of an attempt in a domain. */
  record(domain: string, success: boolean): DomainStat {
    const key = normalize(domain);
    const stat = this.domains.get(key) ?? { domain: key, attempts: 0, successes: 0, competence: 0.5 };
    stat.attempts++;
    if (success) stat.successes++;
    stat.competence = stat.competence + this.alpha * ((success ? 1 : 0) - stat.competence);
    this.domains.set(key, stat);
    return stat;
  }

  /** Current competence estimate in a domain (0.5 prior when unknown). */
  competence(domain: string): number {
    return this.domains.get(normalize(domain))?.competence ?? 0.5;
  }

  /** Whether the system has demonstrated competence in a domain. */
  knows(domain: string, threshold = 0.65): boolean {
    const s = this.domains.get(normalize(domain));
    return !!s && s.attempts >= this.minAttempts && s.competence >= threshold;
  }

  /** Domains with enough evidence but low competence — where improvement is needed. */
  gaps(threshold = 0.5): string[] {
    return Array.from(this.domains.values())
      .filter(s => s.attempts >= this.minAttempts && s.competence < threshold)
      .sort((a, b) => a.competence - b.competence)
      .map(s => s.domain);
  }

  /**
   * Calibrate a stated confidence by track record: with little evidence pull
   * toward the prior; with a poor record, damp it. Never returns more certainty
   * than the domain competence supports.
   */
  calibrate(statedConfidence: number, domain: string): number {
    const s = this.domains.get(normalize(domain));
    const c = clamp01(statedConfidence);
    if (!s || s.attempts < this.minAttempts) return clamp01(0.5 + (c - 0.5) * 0.5); // low evidence → shrink toward prior
    return clamp01(Math.min(c, 0.5 + (s.competence - 0.5) * 1.0 + (c - 0.5) * 0.5));
  }

  summary(): DomainStat[] {
    return Array.from(this.domains.values()).map(s => ({ ...s }));
  }
}

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
