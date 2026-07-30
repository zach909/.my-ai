/**
 * Tests for Working Memory (Spec Section 3): task-scoped scratch state that
 * delegates goal/constraints/plan to PlanTracker (Section 24) instead of
 * duplicating them, and hands off to LongTermMemory (Section 7) on commit.
 */

import { PlanTracker } from '../../models && skills/core/plan-tracker.js';
import { LongTermMemory } from '../../models && skills/core/long-term-memory.js';
import { WorkingMemory } from '../../models && skills/core/working-memory.js';

describe('WorkingMemory (Section 3)', () => {
  let plan: PlanTracker;
  let wm: WorkingMemory;

  beforeEach(() => {
    plan = new PlanTracker();
    wm = new WorkingMemory(plan);
  });

  test('goal/constraints/plan always read through to the shared PlanTracker', () => {
    plan.setObjective('Ship the release');
    plan.addConstraint('no downtime');
    expect(wm.getGoal()).toBe('Ship the release');
    expect(wm.getConstraints()).toContain('no downtime');
    expect(wm.getCurrentPlan().objective).toBe('Ship the release');
  });

  test('a later change to the plan is immediately visible through working memory (no stale copy)', () => {
    plan.setObjective('first goal');
    expect(wm.getGoal()).toBe('first goal');
    plan.setObjective('second goal');
    expect(wm.getGoal()).toBe('second goal');
  });

  test('accumulates inputs, reasoning steps, calculations, and intermediate results', () => {
    wm.addInput('user asked for X');
    wm.addReasoningStep('considered approach A');
    wm.setCalculation('estimatedCost', 42);
    wm.addIntermediateResult('draft v1 produced');

    expect(wm.getInputs()).toEqual(['user asked for X']);
    expect(wm.getReasoning()).toEqual(['considered approach A']);
    expect(wm.getCalculation('estimatedCost')).toBe(42);
    expect(wm.getIntermediateResults()).toEqual(['draft v1 produced']);
  });

  test('snapshot reflects both delegated goal state and own scratch state', () => {
    plan.setObjective('the goal');
    wm.addInput('an input');
    const snap = wm.snapshot();
    expect(snap.goal).toBe('the goal');
    expect(snap.inputs).toEqual(['an input']);
  });

  test('commitToLongTerm transfers goal + intermediate results, then clears scratch state', () => {
    plan.setObjective('Write the report');
    wm.addIntermediateResult('collected the data');
    wm.addIntermediateResult('drafted the summary');
    wm.addInput('raw input that should NOT itself be committed');

    const memory = new LongTermMemory();
    const items = wm.commitToLongTerm(memory);

    expect(items.length).toBe(3);
    expect(memory.size()).toBe(3);
    expect(items.some(i => i.content.includes('Write the report'))).toBe(true);
    expect(items.some(i => i.content.includes('drafted the summary'))).toBe(true);

    // Scratch state is cleared after commit...
    expect(wm.getIntermediateResults()).toEqual([]);
    expect(wm.getInputs()).toEqual([]);
    // ...but the goal itself is untouched -- that's PlanTracker.reset()'s job.
    expect(wm.getGoal()).toBe('Write the report');
  });

  test('committing with nothing to say does not touch long-term memory', () => {
    const memory = new LongTermMemory();
    const items = wm.commitToLongTerm(memory);
    expect(items).toEqual([]);
    expect(memory.size()).toBe(0);
  });

  test('clearTaskState clears scratch state without touching the plan', () => {
    plan.setObjective('goal');
    wm.addInput('x');
    wm.addReasoningStep('y');
    wm.setCalculation('z', 1);
    wm.addIntermediateResult('w');

    wm.clearTaskState();

    expect(wm.getInputs()).toEqual([]);
    expect(wm.getReasoning()).toEqual([]);
    expect(wm.getCalculations()).toEqual({});
    expect(wm.getIntermediateResults()).toEqual([]);
    expect(wm.getGoal()).toBe('goal');
  });
});
