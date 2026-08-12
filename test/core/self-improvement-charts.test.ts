import { buildScoreSeries, buildPassRateSeries } from '../../src/lib/self-improvement-charts';

describe('buildScoreSeries()', () => {
  it('emits one row per scored attempt, with only that attempt\'s own target populated', () => {
    const rows = buildScoreSeries({
      'a.mjs': { history: [{ at: '2026-01-01T00:00:00Z', score: 0.5 }] },
      'b.mjs': { history: [{ at: '2026-01-02T00:00:00Z', score: 0.7 }] },
    });
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ at: '2026-01-01T00:00:00Z', 'a.mjs': 0.5, 'b.mjs': null });
    expect(rows[1]).toEqual({ at: '2026-01-02T00:00:00Z', 'a.mjs': null, 'b.mjs': 0.7 });
  });

  it('sorts by real timestamp regardless of input order', () => {
    const rows = buildScoreSeries({
      'a.mjs': {
        history: [
          { at: '2026-01-03T00:00:00Z', score: 0.9 },
          { at: '2026-01-01T00:00:00Z', score: 0.1 },
        ],
      },
    });
    expect(rows.map((r) => r.at)).toEqual(['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']);
  });

  it('skips attempts with no real score (a punished/failed sandbox run)', () => {
    const rows = buildScoreSeries({ 'a.mjs': { history: [{ at: '2026-01-01T00:00:00Z', ok: false }] } });
    expect(rows).toEqual([]);
  });

  it('handles no targets at all -- a fresh install', () => {
    expect(buildScoreSeries({})).toEqual([]);
  });
});

describe('buildPassRateSeries()', () => {
  it('computes a real cumulative pass rate across every drilled skill, sorted by time', () => {
    const rows = buildPassRateSeries({
      'skill-a': { history: [{ at: '2026-01-01T00:00:00Z', ok: true, improved: true }] },
      'skill-b': {
        history: [
          { at: '2026-01-02T00:00:00Z', ok: true, improved: false },
          { at: '2026-01-03T00:00:00Z', ok: true, improved: true },
        ],
      },
    });
    expect(rows.map((r) => r.passRate)).toEqual([1, 0.5, 2 / 3]);
    expect(rows.map((r) => r.attempts)).toEqual([1, 2, 3]);
  });

  it('excludes attempts that failed outright (ok: false) -- those never reached the judge', () => {
    const rows = buildPassRateSeries({
      'skill-a': {
        history: [
          { at: '2026-01-01T00:00:00Z', ok: false },
          { at: '2026-01-02T00:00:00Z', ok: true, improved: true },
        ],
      },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].passRate).toBe(1);
  });

  it('handles no drilled skills at all -- a fresh install', () => {
    expect(buildPassRateSeries({})).toEqual([]);
  });
});
