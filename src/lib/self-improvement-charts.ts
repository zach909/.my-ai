/**
 * self-improvement-charts.ts — pure data transforms behind the
 * Self-Improvement dashboard (src/routes/app/self-improvement.tsx):
 * "I want a graph about how the agent itself is doing on these tasks,
 * and... how good it is at passing the improvement test."
 *
 * Kept separate from the route component (which only calls these and
 * renders) so the actual shaping logic is directly unit-testable without
 * mounting React or recharts.
 */

export interface ScoreboardEntry {
  history?: Array<{ at: string; score?: number; ok?: boolean; runnerOk?: boolean }>;
}

export interface DrillEntry {
  history?: Array<{ at: string; ok?: boolean; improved?: boolean; accuracyAfter?: number }>;
}

export interface ScorePoint {
  at: string;
  [targetKey: string]: string | number | null;
}

/**
 * "How the agent itself is doing on these tasks" — one point per
 * self-improve.mjs attempt, one series per target script, so a viewer
 * can see each skill's real trained score climb (or not) over time.
 * Points from different targets don't share an x-axis position unless
 * their timestamps happen to coincide -- recharts fills the gap with
 * `null` (no line segment drawn) rather than a misleading interpolation.
 */
export function buildScoreSeries(selfImprovement: Record<string, ScoreboardEntry>): ScorePoint[] {
  const targetKeys = Object.keys(selfImprovement);
  const rows: ScorePoint[] = [];
  for (const key of targetKeys) {
    const history = selfImprovement[key]?.history ?? [];
    for (const attempt of history) {
      if (typeof attempt.score !== 'number') continue;
      const row: ScorePoint = { at: attempt.at };
      for (const k of targetKeys) row[k] = k === key ? attempt.score : null;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

export interface PassRatePoint {
  at: string;
  passRate: number;
  attempts: number;
}

/**
 * "How good it is at passing the improvement test" — a cumulative,
 * running pass rate across every drill attempt from every skill
 * (skill-drill-agent.mjs), sorted by real timestamp. `improved: true`
 * is the judge's real verdict (a strict, held-out accuracy gain -- see
 * that script's own doc comment), not a self-report.
 */
export function buildPassRateSeries(skillDrills: Record<string, DrillEntry>): PassRatePoint[] {
  const attempts = Object.values(skillDrills)
    .flatMap((entry) => entry.history ?? [])
    .filter((a) => a.ok === true)
    .sort((a, b) => a.at.localeCompare(b.at));

  let improvedCount = 0;
  return attempts.map((attempt, i) => {
    if (attempt.improved) improvedCount++;
    return { at: attempt.at, passRate: improvedCount / (i + 1), attempts: i + 1 };
  });
}
