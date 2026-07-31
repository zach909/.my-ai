/**
 * Tests for the World Model (Spec Section 4): a spec-aligned entity/causal/
 * temporal vocabulary layered over KnowledgeGraph, not a duplicate graph.
 */

import { KnowledgeGraph } from '../../models && skills/core/knowledge-graph.js';
import { WorldModel } from '../../models && skills/core/world-model.js';

describe('WorldModel (Section 4)', () => {
  let graph: KnowledgeGraph;
  let world: WorldModel;

  beforeEach(() => {
    graph = new KnowledgeGraph();
    world = new WorldModel(graph);
  });

  test('registers entities under Section 4 categories and retrieves them by category', () => {
    world.registerEntity('Ada Lovelace', 'person', 'an early computer programmer');
    world.registerEntity('London', 'place');
    world.registerEntity('the analytical engine', 'physical-system');

    const people = world.getEntitiesByCategory('person');
    expect(people.map(p => p.name)).toContain('Ada Lovelace');

    const places = world.getEntitiesByCategory('place');
    expect(places.map(p => p.name)).toContain('London');
  });

  test('getCategory reports the currently-believed category for a registered entity', () => {
    world.registerEntity('the office', 'place');
    expect(world.getCategory('the office')).toBe('place');
    expect(world.getCategory('something never registered')).toBeUndefined();
  });

  test('this is really the same KnowledgeGraph, not a parallel one', () => {
    world.registerEntity('Paris', 'place');
    expect(graph.getConcept('Paris')).toBeDefined();
  });

  test('records and queries causal relationships in both directions', () => {
    world.recordCause('rain', 'wet streets', 0.95);
    world.recordCause('rain', 'traffic delays', 0.6);

    const effects = world.getEffectsOf('rain');
    expect(effects.map(e => e.name)).toEqual(expect.arrayContaining(['wet streets', 'traffic delays']));

    const causes = world.getCausesOf('wet streets');
    expect(causes.map(c => c.name)).toContain('rain');
  });

  test('tracks the confidence (uncertainty) of a specific causal claim', () => {
    world.recordCause('smoking', 'lung disease', 0.9);
    expect(world.getConfidence('smoking', 'causes', 'lung disease')).toBe(0.9);
    expect(world.getConfidence('smoking', 'causes', 'something unrelated')).toBeUndefined();
  });

  test('records and retrieves when an event occurred', () => {
    const t = Date.UTC(2026, 0, 1);
    world.recordEventTime('the launch', t);
    expect(world.getEventTime('the launch')).toBe(t);
    expect(world.getCategory('the launch')).toBe('event');
  });

  test('getEventTime is undefined for an event with no recorded time', () => {
    world.registerEntity('an unscheduled event', 'event');
    expect(world.getEventTime('an unscheduled event')).toBeUndefined();
  });

  test('updating a causal claim (Section 4: continuously updated) is reflected in confidence', () => {
    world.recordCause('the bug', 'the outage', 0.5);
    expect(world.getConfidence('the bug', 'causes', 'the outage')).toBe(0.5);

    // A later, more confident assertion of the SAME fact is simply added --
    // current() (which getConfidence reads through) surfaces the most
    // recently pushed non-superseded relation for a given (from,type) pair
    // first, matching KnowledgeGraph's own "most recent wins" reading.
    world.recordCause('the bug', 'the outage', 0.95);
    expect(world.getConfidence('the bug', 'causes', 'the outage')).toBe(0.95);
  });
});
