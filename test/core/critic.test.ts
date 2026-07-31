/**
 * Tests for the Critic (Spec Section 23): a genuinely separate verification
 * system that reviews a claim rather than trusting the process that produced
 * it to judge itself.
 */

import { KnowledgeGraph } from '../../models && skills/core/knowledge-graph.js';
import { MathEngine } from '../../models && skills/core/math-engine.js';
import { MistakeTracker } from '../../models && skills/core/mistake-tracker.js';
import { Critic } from '../../models && skills/core/critic.js';
import type { ReasoningResult } from '../../models && skills/core/reasoning-engine.js';

describe('Critic (Section 23)', () => {
  test('passes a claim with no calculations, assumptions, or contradictions', async () => {
    const critic = new Critic();
    const report = await critic.review({ claim: 'The sky is blue.' });
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.confidence).toBeGreaterThan(0.5);
  });

  test('independently recomputes a claimed calculation and catches a wrong one', async () => {
    const critic = new Critic({ math: new MathEngine() });
    const good = await critic.review({ claim: 'x', calculations: [{ expression: '2 * (3 + 4)', claimed: 14 }] });
    expect(good.passed).toBe(true);
    expect(good.calculationChecks[0].verified).toBe(true);

    const bad = await critic.review({ claim: 'x', calculations: [{ expression: '2 * (3 + 4)', claimed: 99 }] });
    expect(bad.passed).toBe(false);
    expect(bad.calculationChecks[0].verified).toBe(false);
    expect(bad.calculationChecks[0].actual).toBe(14);
    expect(bad.issues.some(i => i.includes('calculation failed'))).toBe(true);
  });

  test('challenges an assumption that has no supporting fact behind it', async () => {
    const critic = new Critic();
    const report = await critic.review({
      claim: 'The bridge will hold the load.',
      supportingFacts: ['The bridge is rated for 10 tons.'],
      assumptions: ['the load is under 10 tons', 'the bridge was inspected last week'],
    });
    const rated = report.assumptionChallenges.find(a => a.assumption.includes('under 10 tons'));
    const inspected = report.assumptionChallenges.find(a => a.assumption.includes('inspected'));
    expect(rated?.supported).toBe(true);
    expect(inspected?.supported).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.issues.some(i => i.includes('unchallenged assumption'))).toBe(true);
  });

  test('searches the knowledge graph for contradictions scoped to the claim entities', async () => {
    const graph = new KnowledgeGraph();
    graph.relate('the engine', 'is', 'reliable');
    graph.relate('the engine', 'is-not', 'reliable');
    graph.relate('unrelated-thing', 'is', 'fine');
    graph.relate('unrelated-thing', 'is-not', 'fine');

    const critic = new Critic({ knowledge: graph });
    const scoped = await critic.review({ claim: 'the engine is reliable', entities: ['the engine'] });
    expect(scoped.contradictions).toHaveLength(1);
    expect(scoped.passed).toBe(false);

    const unscopedElsewhere = await critic.review({ claim: 'x', entities: ['something else entirely'] });
    expect(unscopedElsewhere.contradictions).toHaveLength(0);
  });

  test('surfaces known failure patterns for the task from the mistake tracker', async () => {
    const mistakes = new MistakeTracker();
    mistakes.record({
      task: 'divide by the user count',
      description: 'divided by zero when user count was empty',
      cause: 'reasoning',
      prevention: 'guard against a zero user count before dividing',
    });
    const critic = new Critic({ mistakes });
    const report = await critic.review({ claim: 'result', task: 'divide by the user count' });
    expect(report.knownErrorPatterns).toContain('guard against a zero user count before dividing');
  });

  test('runs an injected code test hook and reflects a failure in the report', async () => {
    const critic = new Critic({
      testCode: (code) => ({ passed: !code.includes('BROKEN'), detail: code.includes('BROKEN') ? 'assertion failed' : 'ok' }),
    });
    const passing = await critic.review({ claim: 'x', code: ['return 1 + 1;'] });
    expect(passing.codeTests[0].passed).toBe(true);
    expect(passing.passed).toBe(true);

    const failing = await critic.review({ claim: 'x', code: ['return BROKEN;'] });
    expect(failing.codeTests[0].passed).toBe(false);
    expect(failing.passed).toBe(false);
  });

  test('never executes code itself when no test hook is supplied', async () => {
    const critic = new Critic();
    const report = await critic.review({ claim: 'x', code: ['process.exit(1)'] });
    expect(report.codeTests).toHaveLength(0);
    expect(report.passed).toBe(true);
  });

  test('compareAnswers independently reviews multiple candidates and picks the one that survives scrutiny', async () => {
    const math = new MathEngine();
    const critic = new Critic({ math });
    const { bestId, reports } = await critic.compareAnswers([
      { id: 'candidate-a', claim: 'a', calculations: [{ expression: '5 * 5', claimed: 25 }] },
      { id: 'candidate-b', claim: 'b', calculations: [{ expression: '5 * 5', claimed: 30 }] },
    ]);
    expect(bestId).toBe('candidate-a');
    expect(reports.get('candidate-a')?.passed).toBe(true);
    expect(reports.get('candidate-b')?.passed).toBe(false);
  });

  test('fromReasoningResult builds review input directly from a ReasoningEngine result', async () => {
    const result: ReasoningResult = {
      problem: 'how do we ship the feature safely',
      objective: 'ship the feature safely',
      available: ['the feature has a rollback plan'],
      missing: [],
      soughtAndResolved: [],
      revised: [],
      approaches: [],
      chosen: 'decompose',
      subproblems: [],
      subresults: [],
      result: 'ship behind a feature flag with a rollback plan',
      verified: true,
      confidence: 0.8,
      lessons: [],
      assumptions: ['the deployment happens during off-peak traffic hours'],
      trace: [],
    };
    const input = Critic.fromReasoningResult(result);
    expect(input.claim).toBe(result.result);
    expect(input.supportingFacts).toEqual(result.available);
    expect(input.assumptions).toEqual(result.assumptions);
    expect(input.entities).toEqual([result.objective]);

    const critic = new Critic();
    const report = await critic.review(input);
    // Nothing in the single grounding fact (a rollback plan existing) says
    // anything about *when* the deployment happens -- exactly the kind of
    // unearned assumption Section 23 asks a separate system to challenge
    // rather than accept just because the reasoner believed it.
    expect(report.assumptionChallenges[0].supported).toBe(false);
  });
});
