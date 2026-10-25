/**
 * Curiosity (models && skills/core/curiosity.ts): a drive to find out what the
 * system does not know. The things worth pinning are the ones that make it
 * curious rather than merely busy:
 *
 *  - it wonders about what it cannot answer, and exploring teaches it
 *    something it can measure (coverage goes up),
 *  - what it learns raises the next question,
 *  - it is rewarded for LEARNING, not for surprise: a source that stays
 *    mysterious but teaches nothing is put down (the "noisy TV" trap),
 *  - it is bounded and gated, and refuses anything that looks like a secret.
 */
import { describe, it, expect } from 'vitest';
import { CuriosityDrive, isSafeTopic, factsAbout, type Explorer } from '../../models && skills/core/curiosity';
import { KnowledgeGraph } from '../../models && skills/core/knowledge-graph';
import { AutonomousLearner } from '../../models && skills/core/autonomous-learner';

function build(explore: Explorer, extra: { allow?: (t: string) => boolean; opts?: ConstructorParameters<typeof CuriosityDrive>[3] } = {}) {
  const clock = { t: 1_000_000 };
  const kg = new KnowledgeGraph();
  const learner = new AutonomousLearner(kg);
  const drive = new CuriosityDrive(kg, learner, { explore, allow: extra.allow, now: () => clock.t }, extra.opts);
  return { kg, learner, drive, clock };
}

describe('isSafeTopic', () => {
  it('accepts ideas and refuses secrets, paths, links and addresses', () => {
    expect(isSafeTopic('photosynthesis')).toBe(true);
    expect(isSafeTopic('black hole thermodynamics')).toBe(true);
    for (const bad of ['my password', 'api key for the bank', '/etc/passwd', 'C:\\Users\\me', 'https://example.com', 'me@example.com', '~/.ssh/id_rsa', 'ab', 'x'.repeat(121), '1234567890']) {
      expect(isSafeTopic(bad), bad).toBe(false);
    }
  });
});

describe('factsAbout', () => {
  it('keeps whole sentences that mention the topic', () => {
    const text = 'Photosynthesis is how plants make food from light. The weather was nice. Photosynthesis happens in the chloroplast of a cell.';
    expect(factsAbout('photosynthesis', text)).toEqual([
      'Photosynthesis is how plants make food from light.',
      'Photosynthesis happens in the chloroplast of a cell.',
    ]);
  });
});

describe('what it wonders about', () => {
  it('a question it cannot answer is a strong pull; a question it can answer is not', () => {
    const { kg, drive } = build(async () => []);
    const raised = drive.noticeText('What is photosynthesis?');
    expect(raised.map(i => i.topic)).toEqual(['photosynthesis']);
    expect(raised[0].source).toBe('asked');
    expect(raised[0].gap).toBeGreaterThanOrEqual(0.9);

    kg.addConcept('gravity', 'The force that pulls masses together');
    kg.relate('gravity', 'is', 'force');
    kg.relate('gravity', 'causes', 'orbits');
    kg.relate('gravity', 'requires', 'mass');
    kg.relate('gravity', 'is', 'attraction');
    expect(drive.noticeText('What is gravity?')).toEqual([]);
  });

  it('long words the graph has never heard are worth a look, at most two per message', () => {
    const { drive } = build(async () => []);
    const topics = drive.noticeText('Yesterday someone mentioned stromatolites, ribosomes, and plankton blooms').map(i => i.topic);
    expect(topics).toHaveLength(2);
    expect(topics.every(t => t.length >= 6)).toBe(true);
  });

  it('never wonders about a secret, or about fragments lifted out of one', () => {
    const { drive } = build(async () => []);
    expect(drive.wonder('the admin password', 'asked', 1)).toBeNull();
    expect(drive.noticeText('What is /etc/shadow?')).toEqual([]);
    expect(drive.noticeText('please read ~/documents/mortgage_statement and https://bank.example/accounts')).toEqual([]);
    expect(drive.noticeText('my password is hunter2secret, remember it')).toEqual([]);
    expect(drive.status().wondering).toEqual([]);
  });

  it('a held contradiction becomes a question when it surveys its own knowledge', () => {
    const { kg, drive } = build(async () => []);
    kg.relate('milk', 'is', 'healthy');
    kg.relate('milk', 'is-not', 'healthy');
    expect(drive.scanKnowledge()).toBeGreaterThan(0);
    expect(drive.status().wondering[0]).toMatchObject({ topic: 'milk', source: 'contradiction' });
  });

  it('a word it has but connects to nothing is a question', () => {
    const { kg, drive } = build(async () => []);
    kg.addConcept('serendipity');
    drive.scanKnowledge();
    expect(drive.status().wondering.map(w => w.topic)).toContain('serendipity');
  });
});

describe('exploring', () => {
  it('goes and finds out, and the graph measurably knows more afterwards', async () => {
    const asked: string[] = [];
    const { kg, drive } = build(async topic => {
      asked.push(topic);
      return [
        'Photosynthesis is chemistry',
        'Photosynthesis requires light',
        'Photosynthesis causes oxygen',
        'Photosynthesis is energy conversion',
      ];
    });
    drive.noticeText('What is photosynthesis?');
    const before = drive.coverage('photosynthesis');
    const e = await drive.step();

    expect(asked).toEqual(['photosynthesis']);
    expect(e).not.toBeNull();
    expect(e!.gained).toBe(4);
    expect(e!.coverageAfter).toBeGreaterThan(before);
    expect(e!.progress).toBeGreaterThan(0.5);
    expect(kg.getConcept('photosynthesis')!.definition).not.toBe('');
    expect(drive.status().resolved).toBe(1);
  });

  it('what it learns raises the next question', async () => {
    const { drive } = build(async topic => topic === 'photosynthesis' ? ['Photosynthesis requires chlorophyll'] : []);
    drive.wonder('photosynthesis', 'asked', 0.9);
    const e = await drive.step();
    expect(e!.spawned).toContain('chlorophyll');
    expect(drive.status().wondering.map(w => w.topic)).toContain('chlorophyll');
  });

  it('a chain of questions stops after maxDepth steps', async () => {
    let n = 0;
    const { drive } = build(async topic => [`${topic} requires thing${++n}`], { opts: { maxDepth: 2, minDrive: 0 } });
    drive.wonder('seedling', 'asked', 0.9);
    for (let i = 0; i < 12; i++) await drive.step();
    const deepest = drive.toJSON().interests.reduce((m, i) => Math.max(m, i.depth), 0);
    expect(deepest).toBeLessThanOrEqual(2);
  });

  it('keeps a disagreement beside the old belief and asks about it', async () => {
    const { kg, drive } = build(async () => ['The cache is not reliable']);
    kg.relate('the cache', 'is', 'reliable', { confidence: 0.6 });
    drive.wonder('the cache', 'asked', 0.9);
    const e = await drive.step();
    expect(e!.conflicts).toBe(1);
    expect(kg.findContradictions()).toHaveLength(1);
    expect(drive.status().wondering.map(w => w.topic)).toContain('the cache');
  });

  it('is rewarded for learning, not surprise: a mystery that teaches nothing is put down', async () => {
    // The noisy TV: always something to say, nothing the learner will take in.
    const noise: Explorer = async () => ['maybe it is something, i heard, not sure', 'perhaps unconfirmed, i think so'];
    const real: Explorer = async topic => topic === 'tides' ? ['Tides is gravity effect', 'Tides requires moon', 'Tides causes erosion'] : noise(topic);
    const { drive, clock } = build(real, { opts: { patience: 3 } });
    drive.wonder('static', 'surprise', 1);      // far more unknown than tides...
    drive.wonder('tides', 'asked', 0.5);

    const order: string[] = [];
    for (let i = 0; i < 14; i++) {
      const e = await drive.step();
      if (e) order.push(e.topic);
      clock.t += 1000;
    }
    // ...so it looks at static first, learns nothing, and is drawn to tides instead (which teaches it
    // three new things to wonder about, which it also chases). Static is visited at most `patience`
    // times and then put down, however surprising it stays.
    expect(order[0]).toBe('static');
    expect(order[1]).toBe('tides');
    expect(order.filter(t => t === 'static').length).toBeLessThanOrEqual(3);
    expect(drive.status().setAside).toContain('static');
    expect(drive.status().resolved).toBeGreaterThanOrEqual(1);
  });

  it('comes back to a put-down topic only after the cooldown', async () => {
    const { drive, clock } = build(async () => ['maybe, i heard, not sure'], { opts: { patience: 1, cooldownMs: 10_000 } });
    drive.wonder('mirage', 'asked', 1);
    await drive.step();
    expect(await drive.step()).toBeNull();
    clock.t += 10_001;
    expect((await drive.step())?.topic).toBe('mirage');
  });
});

describe('bounds', () => {
  it('stops at its hourly budget and gets it back an hour later', async () => {
    const { drive, clock } = build(async () => [], { opts: { maxPerHour: 2, minDrive: 0 } });
    for (const t of ['alpha topic', 'beta topic', 'gamma topic']) drive.wonder(t, 'asked', 1);
    expect(await drive.step()).not.toBeNull();
    expect(await drive.step()).not.toBeNull();
    expect(await drive.step()).toBeNull();
    expect(drive.status().budgetLeft).toBe(0);
    clock.t += 3_600_001;
    expect(await drive.step()).not.toBeNull();
  });

  it('a withheld topic is not explored and does not spend the budget', async () => {
    let explored = 0;
    const { drive } = build(async () => { explored++; return []; }, { allow: t => t !== 'forbidden knowledge' });
    drive.wonder('forbidden knowledge', 'asked', 1);
    const e = await drive.step();
    expect(e!.skipped).toMatch(/withheld/);
    expect(explored).toBe(0);
    expect(drive.status().budgetLeft).toBe(12);
  });

  it('an unreachable source backs off without calling the topic boring', async () => {
    const { drive, clock } = build(async () => { throw new Error('no route to host'); });
    drive.wonder('volcanoes', 'asked', 1);
    const e = await drive.step();
    expect(e!.skipped).toMatch(/no route to host/);
    expect(drive.toJSON().interests[0].stale).toBe(0);
    expect(await drive.step()).toBeNull();
    clock.t += 11 * 60_000;
    expect((await drive.step())?.topic).toBe('volcanoes');
  });

  it('pausing stops it entirely', async () => {
    const { drive } = build(async () => ['Volcanoes is geology']);
    drive.wonder('volcanoes', 'asked', 1);
    drive.setPaused(true);
    expect(await drive.step()).toBeNull();
    expect(drive.status().mood).toBe('resting');
  });

  it('never holds more than its capacity', () => {
    const { drive } = build(async () => [], { opts: { capacity: 5 } });
    for (let i = 0; i < 20; i++) drive.wonder(`question number ${i}`, 'unknown', 0.1 + i / 40);
    expect(drive.toJSON().interests.length).toBe(5);
  });
});

describe('mood and memory', () => {
  it('is restless with nothing to wonder about, curious with something, absorbed after a good find', async () => {
    const { drive } = build(async () => ['Volcanoes is geology', 'Volcanoes causes eruptions', 'Volcanoes requires magma']);
    expect(drive.status().mood).toBe('restless');
    drive.wonder('volcanoes', 'asked', 1);
    drive.wonder('glaciers', 'asked', 0.9);
    expect(drive.status().mood).toBe('curious');
    await drive.step();
    expect(drive.status().mood).toBe('absorbed');
  });

  it('survives a restart, and drops anything malformed or unsafe', () => {
    const a = build(async () => []);
    a.drive.wonder('volcanoes', 'asked', 1);
    const saved = JSON.parse(JSON.stringify(a.drive.toJSON()));
    saved.interests.push({ topic: 'the root password', source: 'asked' }, { topic: 'fine topic', source: 'nonsense' }, null);

    const b = build(async () => []);
    b.drive.restore(saved);
    expect(b.drive.status().wondering.map(w => w.topic)).toEqual(['volcanoes']);
    b.drive.restore({ version: 99 });
    b.drive.restore('garbage');
    expect(b.drive.status().wondering).toHaveLength(1);
  });

  it('a pause is the owner\'s decision and outlives a restart', async () => {
    const a = build(async () => []);
    a.drive.setPaused(true);
    const b = build(async () => []);
    b.drive.restore(JSON.parse(JSON.stringify(a.drive.toJSON())));
    expect(b.drive.isPaused()).toBe(true);
    b.drive.wonder('volcanoes', 'asked', 1);
    expect(await b.drive.step()).toBeNull();
  });
});
