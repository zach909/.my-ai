/**
 * Self-Healing (Spec Section 24).
 *
 * The `SelfHealExtension` plugin does process-level hygiene (GC, heap checks).
 * Section 24 asks for more: detect failed components, revert to a known-good
 * state, rebuild generated structures, reinitialize a failed process, replace
 * invalid connections, and report unrecoverable failures — and crucially, "all
 * automatic repair mechanisms should be testable" and must "not silently modify
 * important data without maintaining a recovery mechanism".
 *
 * SelfHealer is a small, testable component registry that enforces exactly
 * that contract: every heal step is logged (never silent), repairs are bounded
 * and re-verified, a known-good snapshot can be restored when a repair can't
 * fix a component, and anything still broken is reported as unrecoverable
 * rather than hidden.
 */

export interface HealableComponent {
  name: string;
  /** Returns true when the component is healthy. */
  check: () => boolean | Promise<boolean>;
  /** Attempt an in-place repair (e.g. reinitialize, replace invalid connections). */
  repair?: () => void | Promise<void>;
  /** Capture a known-good state for later restore. */
  snapshot?: () => unknown;
  /** Revert to a previously captured known-good state. */
  restore?: (snap: unknown) => void | Promise<void>;
  /** Max repair attempts before falling back to restore/unrecoverable (default 1). */
  maxAttempts?: number;
}

export interface HealResult {
  component: string;
  wasHealthy: boolean;
  actions: string[];
  recovered: boolean;
  unrecoverable: boolean;
}

export interface HealReport {
  checked: number;
  healthy: number;
  repaired: number;
  restored: number;
  unrecoverable: string[];
  results: HealResult[];
  log: string[];
}

export class SelfHealer {
  private components = new Map<string, HealableComponent>();
  private snapshots = new Map<string, unknown>();
  private log: string[] = [];
  private readonly logCapacity = 5000;

  register(component: HealableComponent): void {
    this.components.set(component.name, component);
  }
  unregister(name: string): boolean {
    this.snapshots.delete(name);
    return this.components.delete(name);
  }
  list(): string[] {
    return Array.from(this.components.keys());
  }

  /** Capture a known-good snapshot for every component that supports it. */
  snapshotAll(): void {
    for (const c of this.components.values()) {
      if (c.snapshot) {
        this.snapshots.set(c.name, c.snapshot());
        this.record(`snapshot captured for "${c.name}"`);
      }
    }
  }

  /** Current health of every component without attempting repairs. */
  async healthReport(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const c of this.components.values()) out[c.name] = await c.check();
    return out;
  }

  /**
   * Detect and repair. For each unhealthy component: try `repair` up to
   * maxAttempts and re-verify; if still broken, restore the known-good snapshot
   * and re-verify; if still broken, report it as unrecoverable. Every step is
   * logged.
   */
  async heal(): Promise<HealReport> {
    const results: HealResult[] = [];
    const unrecoverable: string[] = [];
    let healthy = 0;
    let repaired = 0;
    let restored = 0;

    for (const c of this.components.values()) {
      const actions: string[] = [];
      const wasHealthy = await c.check();
      if (wasHealthy) {
        healthy++;
        results.push({ component: c.name, wasHealthy: true, actions, recovered: true, unrecoverable: false });
        continue;
      }
      this.record(`"${c.name}" unhealthy — attempting recovery`);

      let ok = false;
      const attempts = Math.max(1, c.maxAttempts ?? 1);
      if (c.repair) {
        for (let i = 0; i < attempts && !ok; i++) {
          try {
            await c.repair();
            actions.push("repaired");
            this.record(`"${c.name}" repair attempt ${i + 1}`);
          } catch (e) {
            this.record(`"${c.name}" repair threw: ${errMsg(e)}`);
          }
          ok = await c.check();
        }
        if (ok) repaired++;
      }

      // Fall back to a known-good snapshot.
      if (!ok && c.restore && this.snapshots.has(c.name)) {
        try {
          await c.restore(this.snapshots.get(c.name));
          actions.push("restored-known-good");
          this.record(`"${c.name}" reverted to known-good snapshot`);
        } catch (e) {
          this.record(`"${c.name}" restore threw: ${errMsg(e)}`);
        }
        ok = await c.check();
        if (ok) restored++;
      }

      if (!ok) {
        actions.push("unrecoverable");
        unrecoverable.push(c.name);
        this.record(`"${c.name}" could not be recovered — reported`);
      }
      results.push({ component: c.name, wasHealthy: false, actions, recovered: ok, unrecoverable: !ok });
    }

    return {
      checked: this.components.size,
      healthy,
      repaired,
      restored,
      unrecoverable,
      results,
      log: [...this.log],
    };
  }

  getLog(): string[] {
    return [...this.log];
  }
  clearLog(): void {
    this.log = [];
  }

  private record(msg: string): void {
    this.log.push(`[${new Date().toISOString()}] ${msg}`);
    if (this.log.length > this.logCapacity) this.log.splice(0, this.log.length - this.logCapacity);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
