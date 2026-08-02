/**
 * Tests for the Goal and Constraint System (Spec Section 24), implemented as
 * an extension of PlanTracker rather than a separate parallel system, plus
 * PromptingSkill (Section 10), which understands prompts and records the
 * resulting goal onto that same PlanTracker.
 */

import { PlanTracker } from '../../models && skills/core/plan-tracker.js';
import { IntentRouter } from '../../models && skills/core/intent-router.js';
import { EmpathyEngine } from '../../models && skills/core/empathy.js';
import { PromptingSkill } from '../../models && skills/core/prompting-skill.js';

describe('PlanTracker goal structure (Section 24)', () => {
  let plan: PlanTracker;

  beforeEach(() => {
    plan = new PlanTracker();
  });

  test('records objective and reason', () => {
    plan.setObjective('Ship the release');
    plan.setReason('The deadline is Friday');
    const snap = plan.snapshot();
    expect(snap.objective).toBe('Ship the release');
    expect(snap.reason).toBe('The deadline is Friday');
  });

  test('forbidden actions always win over allowed actions', () => {
    plan.allowAction('read_file');
    plan.forbidAction('read_file');
    expect(plan.isActionPermitted('read_file')).toBe(false);
  });

  test('an explicit allow-list is a whitelist -- anything else is denied', () => {
    plan.allowAction('read_file');
    expect(plan.isActionPermitted('read_file')).toBe(true);
    expect(plan.isActionPermitted('delete_file')).toBe(false);
  });

  test('with no allow-list declared, only explicitly forbidden actions are denied', () => {
    plan.forbidAction('delete_file');
    expect(plan.isActionPermitted('read_file')).toBe(true);
    expect(plan.isActionPermitted('delete_file')).toBe(false);
  });

  test('evaluates success conditions against real state', () => {
    plan.addSuccessCondition('all tests pass', (s) => s.testsPassing === true);
    plan.addFailureCondition('build broke', (s) => s.buildOk === false);

    const passing = plan.evaluateConditions({ testsPassing: true, buildOk: true });
    expect(passing.succeeded).toBe(true);
    expect(passing.failed).toBe(false);

    const broken = plan.evaluateConditions({ testsPassing: false, buildOk: false });
    expect(broken.succeeded).toBe(false);
    expect(broken.failed).toBe(true);
    expect(broken.matchedFailure).toContain('build broke');
  });

  test('descriptive-only conditions (no predicate) never auto-match', () => {
    plan.addSuccessCondition('user is happy with the result');
    const result = plan.evaluateConditions({});
    expect(result.succeeded).toBe(false);
    expect(plan.getSuccessConditions()).toContain('user is happy with the result');
  });

  test('reset clears the goal structure fields too', () => {
    plan.setReason('why');
    plan.allowAction('a');
    plan.forbidAction('b');
    plan.addSuccessCondition('c');
    plan.reset();
    const snap = plan.snapshot();
    expect(snap.reason).toBe('');
    expect(snap.allowedActions).toEqual([]);
    expect(snap.forbiddenActions).toEqual([]);
    expect(snap.successConditions).toEqual([]);
  });
});

describe('PromptingSkill (Section 10)', () => {
  let plan: PlanTracker;
  let router: IntentRouter;
  let empathy: EmpathyEngine;
  let prompting: PromptingSkill;

  beforeEach(() => {
    plan = new PlanTracker();
    router = new IntentRouter();
    empathy = new EmpathyEngine();
    prompting = new PromptingSkill(router, plan, empathy);
  });

  test('records the objective onto the shared PlanTracker, not a private copy', () => {
    prompting.understand('Please fix the login bug', 'user reported it blocks sign-in');
    expect(plan.getObjective()).toBe('Please fix the login bug');
    expect(plan.getReason()).toBe('user reported it blocks sign-in');
  });

  test('breaks a compound request into ordered subtasks on the plan', () => {
    const analysis = prompting.understand('Read the file, and then summarize it, and then email it to me');
    expect(analysis.subtasks.length).toBe(3);
    expect(plan.getSteps().length).toBe(3);
  });

  test('flags an empty or too-short request as missing information', () => {
    const empty = prompting.understand('');
    expect(empty.missingInfo.length).toBeGreaterThan(0);

    const short = prompting.understand('do it');
    expect(short.missingInfo.length).toBeGreaterThan(0);
  });

  test('a clear, concrete request has no missing-info gaps', () => {
    const analysis = prompting.understand('Summarize the quarterly sales report for the board meeting');
    expect(analysis.missingInfo).toEqual([]);
  });

  test('selects the capability the request actually routes to', () => {
    const analysis = prompting.understand('Can you run a health check on yourself?');
    expect(analysis.selectedCapability).toBe('heal');
  });

  test('never proceeds autonomously when information is missing, regardless of empathy alignment', () => {
    const analysis = prompting.understand('do it');
    expect(prompting.shouldProceedAutonomously(analysis)).toBe(false);
  });

  test('defers to the empathy-derived alignment gate once the request is clear', () => {
    const analysis = prompting.understand('Summarize the quarterly sales report for the board meeting');
    // Fresh EmpathyEngine starts fully aligned (alignmentScore: 1.0), so it
    // should permit autonomous action once there is no missing information.
    expect(prompting.shouldProceedAutonomously(analysis)).toBe(true);
  });

  test('checkResult reads through to the same PlanTracker conditions', () => {
    prompting.understand('Ship the release');
    plan.addSuccessCondition('deployed', (s) => s.deployed === true);
    const result = prompting.checkResult({ deployed: true });
    expect(result.succeeded).toBe(true);
  });
});
