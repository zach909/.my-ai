import { describe, it, expect } from 'vitest';
import { planRequirements } from '../../models && skills/core/requirement-planner.js';
import {
  freezeMainModel,
  assertMainModelUnchanged,
  planAgainstFrozenModel,
  MainModelChanged,
} from '../../models && skills/core/skill-freeze.js';

describe('requirement planner', () => {
  it('defaults to a net skill, never silently to a training run', () => {
    // "learn" is a capability word. The old planner turned the WHOLE plan into
    // a training run because of one word like this, which is exactly what
    // building a net skill by default is supposed to prevent.
    const plan = planRequirements(['learn which files I edit most', 'keep a list of my projects']);
    expect(plan.recommended).toBe('net-skill');
    expect(plan.requirements.every(r => r.route === 'net-skill')).toBe(true);
  });

  it('still says which requirements would be sharper trained', () => {
    const plan = planRequirements(['learn which files I edit most', 'keep a list of my projects']);
    expect(plan.alternative.route).toBe('train');
    expect(plan.alternative.requirements).toEqual(['learn which files I edit most']);
    expect(plan.requirements[1].betterWithTraining).toBe(false);
  });

  it('builds nothing for a requirement something already satisfies', () => {
    const plan = planRequirements(['search the web'], {
      findExisting: () => [{ id: 'web-search', score: 90, reason: 'declares the verb "search"' }],
    });
    expect(plan.requirements[0].route).toBe('already-satisfied');
    expect(plan.requirements[0].satisfiedBy).toBe('web-search');
    expect(plan.neurons).toHaveLength(0);
  });

  it('ignores a weak match rather than claiming a requirement is done', () => {
    const plan = planRequirements(['search the web'], {
      findExisting: () => [{ id: 'calendar', score: 4, reason: 'shares one word' }],
    });
    expect(plan.requirements[0].route).toBe('net-skill');
  });

  it('connects the neurons it plans, because a pile of neurons is not a network', () => {
    const plan = planRequirements(['keep a list of my projects', 'note when a build fails']);
    const [first, second] = plan.neurons;
    expect(plan.neuroLang).toContain(`"${first.name}"@connections=".${second.name}"`);
  });

  it('names a neuron even for a requirement made entirely of noise words', () => {
    const plan = planRequirements(['the and for']);
    expect(plan.neurons[0].name).toMatch(/^requirement-\d+$/);
  });
});

describe('freezing the main model', () => {
  const viewOf = (names: string[]) => ({ neuronNames: () => names.slice() });

  it('notices a neuron being added to the main model', () => {
    const names = ['file reader', 'calendar'];
    const view = { neuronNames: () => names.slice() };
    const frozen = freezeMainModel(view);
    names.push('something new');
    expect(() => assertMainModelUnchanged(frozen, view)).toThrow(MainModelChanged);
  });

  it('notices the same neuron being added twice, not just a rename', () => {
    // A digest over a Set would call this unchanged, and "the mesh quietly
    // grew" is the failure that actually matters here.
    const names = ['file reader'];
    const view = { neuronNames: () => names.slice() };
    const frozen = freezeMainModel(view);
    names.push('file reader');
    expect(() => assertMainModelUnchanged(frozen, view)).toThrow(MainModelChanged);
  });

  it('does not care what order the neurons come back in', () => {
    const frozen = freezeMainModel(viewOf(['a neuron', 'b neuron']));
    expect(() => assertMainModelUnchanged(frozen, viewOf(['b neuron', 'a neuron']))).not.toThrow();
  });

  it('plans against the frozen model and reports it unchanged', () => {
    const result = planAgainstFrozenModel(['keep a list of my projects'], viewOf(['calendar']));
    expect(result.verified).toBe(true);
    expect(result.frozen.neuronCount).toBe(1);
    expect(result.plan.recommended).toBe('net-skill');
  });

  it('uses the main model to notice a requirement it already covers', () => {
    const result = planAgainstFrozenModel(
      ['read files'],
      viewOf(['read files from disk']),
    );
    expect(result.plan.requirements[0].route).toBe('already-satisfied');
    expect(result.plan.requirements[0].satisfiedBy).toBe('read files from disk');
  });

  it('does not claim a requirement is covered on one shared word', () => {
    const result = planAgainstFrozenModel(
      ['read my email and summarise every thread'],
      viewOf(['read files from disk']),
    );
    expect(result.plan.requirements[0].route).toBe('net-skill');
  });

  it('refuses to call a plan frozen if the model moved underneath it', () => {
    let calls = 0;
    const view = {
      neuronNames: () => {
        calls++;
        return calls === 1 ? ['calendar'] : ['calendar', 'sneaked in'];
      },
    };
    expect(() => planAgainstFrozenModel(['keep a list of my projects'], view)).toThrow(MainModelChanged);
  });
});

describe('routing scores as confidence', () => {
  it('reports how much of the request a plugin declares, not just a rank', async () => {
    // The score is a rank -- "8" means two matching terms and nothing in
    // general. Feeding it straight into the planner's threshold meant no
    // plugin ever counted as covering a requirement, so the plan proposed
    // rebuilding capabilities the machine plainly had. The fraction is what
    // crosses that boundary, so the router has to report it.
    const { CapabilityRouter } = await import('../../plugin_manager/capability-router.js');
    const router = new CapabilityRouter();
    const plugins = new Map<string, never>([
      ['email', { onMessage: async () => null, describeCapabilities: () => ({ nouns: ['email', 'inbox'], verbs: ['send'] }) } as never],
    ]);
    router.reindex(plugins as never, {});
    const [top] = router.rank('send an email');
    expect(top.id).toBe('email');
    expect(top.inputTerms).toBeGreaterThan(0);
    expect(top.matched / top.inputTerms).toBeGreaterThanOrEqual(0.5);
  });
});
