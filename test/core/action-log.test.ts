/**
 * Tests for ActionLog (models && skills/core/action-log.ts), the
 * TypeScript port of asi_core.action_log.ActionLog -- see that file's
 * test_action_log.py for the Python coverage this mirrors.
 */
import { describe, it, expect } from 'vitest';
import { ActionLog, ApprovalStatus } from '../../models && skills/core/action-log';
import { NeuronMesh } from '../../models && skills/core/onebrain';

describe('ActionLog request/approval rules', () => {
  it('an action with no approval rules is not required', () => {
    const log = new ActionLog();
    const record = log.request('organize_notes', 'tidy up', 'memory');
    expect(record.approval).toBe(ApprovalStatus.NOT_REQUIRED);
  });

  it('an action matching an approval rule is pending', () => {
    const log = new ActionLog();
    log.requireApprovalFor((action) => action === 'delete_file');
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    expect(record.approval).toBe(ApprovalStatus.PENDING);
  });

  it('multiple rules are ORed together', () => {
    const log = new ActionLog();
    log.requireApprovalFor((a) => a.startsWith('delete_'));
    log.requireApprovalFor((a) => a === 'install_extension');
    expect(log.needsApproval('delete_file')).toBe(true);
    expect(log.needsApproval('install_extension')).toBe(true);
    expect(log.needsApproval('read_file')).toBe(false);
  });

  it('requests accumulate in order', () => {
    const log = new ActionLog();
    log.request('a', 'x', 's');
    log.request('b', 'y', 's');
    expect(log.history().map((r) => r.action)).toEqual(['a', 'b']);
  });
});

describe('ActionLog approve/deny flow', () => {
  it('approves a pending action', () => {
    const log = new ActionLog();
    log.requireApprovalFor(() => true);
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    log.approve(record);
    expect(record.approval).toBe(ApprovalStatus.APPROVED);
  });

  it('denies a pending action', () => {
    const log = new ActionLog();
    log.requireApprovalFor(() => true);
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    log.deny(record);
    expect(record.approval).toBe(ApprovalStatus.DENIED);
  });

  it('approving a non-pending action throws', () => {
    const log = new ActionLog();
    const record = log.request('read_file', 'inspect', 'filesystem'); // NOT_REQUIRED
    expect(() => log.approve(record)).toThrow();
  });

  it('denying a non-pending action throws', () => {
    const log = new ActionLog();
    const record = log.request('read_file', 'inspect', 'filesystem');
    expect(() => log.deny(record)).toThrow();
  });
});

describe('ActionLog.perform', () => {
  it('runs the action immediately when approval is not required', () => {
    const log = new ActionLog();
    const record = log.request('compute', 'test', 'math');
    const result = log.perform(record, () => 1 + 1);
    expect(result).toBe(2);
    expect(record.result).toBe('success');
  });

  it('throws and refuses to run a still-pending action', () => {
    const log = new ActionLog();
    log.requireApprovalFor(() => true);
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    let ran = false;
    expect(() => log.perform(record, () => { ran = true; })).toThrow(/awaiting approval/);
    expect(ran).toBe(false);
  });

  it('throws and refuses to run a denied action', () => {
    const log = new ActionLog();
    log.requireApprovalFor(() => true);
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    log.deny(record);
    let ran = false;
    expect(() => log.perform(record, () => { ran = true; })).toThrow(/was denied/);
    expect(ran).toBe(false);
  });

  it('runs an approved action', () => {
    const log = new ActionLog();
    log.requireApprovalFor(() => true);
    const record = log.request('delete_file', 'cleanup', 'filesystem');
    log.approve(record);
    let ran = false;
    log.perform(record, () => { ran = true; });
    expect(ran).toBe(true);
    expect(record.result).toBe('success');
  });

  it('records a failed action\'s error instead of leaving result blank', () => {
    const log = new ActionLog();
    const record = log.request('risky', 'test', 'sys');
    expect(() => log.perform(record, () => { throw new Error('boom'); })).toThrow('boom');
    expect(record.result).toBe('error: boom');
  });
});

describe('ActionLog.history', () => {
  it('filters by system when given', () => {
    const log = new ActionLog();
    log.request('a', 'x', 'mesh');
    log.request('b', 'y', 'extensions');
    log.request('c', 'z', 'mesh');
    expect(log.history('mesh').map((r) => r.action)).toEqual(['a', 'c']);
  });

  it('returns everything when system is omitted', () => {
    const log = new ActionLog();
    log.request('a', 'x', 'mesh');
    log.request('b', 'y', 'extensions');
    expect(log.history()).toHaveLength(2);
  });
});

describe('ActionLog gating a real structural action (mergeFrom)', () => {
  it('gates NeuronMesh.mergeFrom exactly like asi_core.UnifiedBrain gates create_expert/create_extension', () => {
    const log = new ActionLog();
    log.requireApprovalFor((action) => action.startsWith('merge:'));

    const a = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });
    const b = new NeuronMesh({ nodeCount: 2, connectionDensity: 1.0 });

    const record = log.request('merge:brain-b', 'combine two brains into one', 'mesh');
    expect(record.approval).toBe(ApprovalStatus.PENDING);

    // The mesh operation itself has no idea an ActionLog exists -- the
    // gate is purely in the caller, matching add_expert_group/
    // create_extension's own separation in asi_core/unified_brain.py.
    expect(() => log.perform(record, () => a.mergeFrom(b))).toThrow(/awaiting approval/);
    expect(a.getTopology().nodeCount).toBe(3); // unchanged: merge never ran

    log.approve(record);
    const idMap = log.perform(record, () => a.mergeFrom(b));
    expect(idMap.size).toBe(2);
    expect(a.getTopology().nodeCount).toBe(5);
  });
});
