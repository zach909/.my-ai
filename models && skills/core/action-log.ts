/**
 * Action Log / Human Approval System.
 *
 * The one piece of asi_core.UnifiedBrain (the Python reference brain --
 * see asi_core/action_log.py) that had no TypeScript counterpart anywhere
 * in the live app: spec Part 9 sections 161-163 and Part 10 section 191
 * ("The AI should explain: what it did, why it did it, what changed").
 * Every structural action is logged with what happened, why, and which
 * system performed it, and a caller-registered rule can mark certain
 * actions as requiring explicit human approval before they execute.
 *
 * Deliberately generic and standalone, matching the Python version: this
 * module has no dependency on NeuronMesh/UnifiedBrain/etc. A caller gates
 * a structural action (growing a mesh via mergeFrom()/addNode(),
 * installing an extension, ...) by wrapping it:
 *
 *   const log = new ActionLog();
 *   log.requireApprovalFor((action) => action.startsWith('merge:'));
 *   const record = log.request(`merge:${otherId}`, 'combine two brains', 'mesh');
 *   const idMap = log.perform(record, () => mesh.mergeFrom(other)); // throws until approved
 *   // ... elsewhere, once a human has reviewed it: log.approve(record);
 *
 * The action's own implementation (mergeFrom, extension install, ...)
 * never needs to know an ActionLog exists -- the gate lives entirely in
 * the caller, exactly like asi_core.UnifiedBrain.create_expert/
 * create_extension wrap NeuralMesh.add_expert_group/ExtensionSystem.create
 * without either of those methods importing action_log.py.
 */

export enum ApprovalStatus {
  NOT_REQUIRED = 'not_required',
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
}

/** Spec Part 9 section 162 (Action History). */
export interface ActionRecord {
  action: string;
  why: string;
  system: string;
  result?: string;
  approval: ApprovalStatus;
}

export type ApprovalPredicate = (action: string) => boolean;

/**
 * Records every action and gates actions matching a caller-registered
 * "requires approval" rule behind explicit approve()/deny() before
 * perform() will run them (spec section 163: "Certain actions require
 * approval").
 */
export class ActionLog {
  private records: ActionRecord[] = [];
  private approvalRules: ApprovalPredicate[] = [];

  /** Register a rule: any action for which predicate(action) is true
   *  requires approval before perform() will run it. */
  requireApprovalFor(predicate: ApprovalPredicate): void {
    this.approvalRules.push(predicate);
  }

  needsApproval(action: string): boolean {
    return this.approvalRules.some((rule) => rule(action));
  }

  /**
   * Log an action as requested. If it needs approval (per the registered
   * rules), it's recorded PENDING and perform() will refuse to run it
   * until approve()/deny() resolves it.
   */
  request(action: string, why: string, system: string): ActionRecord {
    const approval = this.needsApproval(action) ? ApprovalStatus.PENDING : ApprovalStatus.NOT_REQUIRED;
    const record: ActionRecord = { action, why, system, approval };
    this.records.push(record);
    return record;
  }

  approve(record: ActionRecord): void {
    if (record.approval !== ApprovalStatus.PENDING) {
      throw new Error(`action is not pending approval: ${record.approval}`);
    }
    record.approval = ApprovalStatus.APPROVED;
  }

  deny(record: ActionRecord): void {
    if (record.approval !== ApprovalStatus.PENDING) {
      throw new Error(`action is not pending approval: ${record.approval}`);
    }
    record.approval = ApprovalStatus.DENIED;
  }

  /**
   * Run fn() and log its result -- but only if the action doesn't
   * require approval, or has already been approved. Throws if the
   * action is still pending or was denied, and records a failed
   * action's error instead of leaving `result` blank.
   */
  perform<T>(record: ActionRecord, fn: () => T): T {
    if (record.approval === ApprovalStatus.PENDING) {
      throw new Error(`action '${record.action}' is awaiting approval`);
    }
    if (record.approval === ApprovalStatus.DENIED) {
      throw new Error(`action '${record.action}' was denied`);
    }
    try {
      const result = fn();
      record.result = 'success';
      return result;
    } catch (err) {
      record.result = `error: ${err instanceof Error ? err.message : String(err)}`;
      throw err;
    }
  }

  history(system?: string): ActionRecord[] {
    if (system === undefined) return [...this.records];
    return this.records.filter((r) => r.system === system);
  }
}
