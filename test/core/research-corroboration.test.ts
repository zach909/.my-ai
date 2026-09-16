/**
 * conductResearch()'s "never trust one source" corroboration -- the bug
 * that made scripts/skill-agent.mjs discard every single research cycle
 * for every topic in this project's history (`extension-builder/
 * skill-agent-registry.json`, every entry: "no corroborated findings for
 * this topic -- nothing to publish").
 *
 * The old code keyed "one vote per SOURCE per claim" on `hit.source`
 * (only ever "memory" | "drive" | "web"), so a claim could carry at most
 * one web vote no matter how many different web pages agreed -- and in
 * production memory starts empty and drive is this repo's own code, not
 * a knowledge base, so web is nearly the only real signal. `verified`
 * (2+ independent sources) could therefore never become true from real
 * research, for any topic, ever. Fixed by keying on `hit.location` (the
 * actual origin -- URL/file/memory id), so two distinct web pages
 * agreeing correctly counts as independent corroboration.
 */
import { describe, it, expect, vi } from 'vitest';
import { ResearchPlugin, type SearchResult } from '../../plugins/research';

function plugin() {
  return new ResearchPlugin({ id: 'research', name: 'Research', type: 'api-connection', capabilities: [] } as any);
}

describe('conductResearch() corroboration', () => {
  it('two DIFFERENT web pages describing the same fact corroborate each other (the real-world case)', async () => {
    const p = plugin();
    const shared = 'quantum error correction protects fragile qubit states from decoherence noise';
    vi.spyOn(p, 'searchMemory').mockResolvedValue([]);
    vi.spyOn(p, 'searchDrive').mockResolvedValue([]);
    vi.spyOn(p, 'searchWeb').mockResolvedValue([
      { source: 'web', title: 'Page A', snippet: shared, location: 'https://a.example/qec' },
      { source: 'web', title: 'Page B', snippet: shared, location: 'https://b.example/qec' },
    ] satisfies SearchResult[]);

    const report = await p.conductResearch('quantum error correction');
    expect(report.verifiedCount).toBe(1);
    expect(report.claims[0].verified).toBe(true);
    expect(report.claims[0].sources).toHaveLength(2);
  });

  it('the SAME url appearing twice does not count as two independent sources', async () => {
    const p = plugin();
    const shared = 'the same page indexed twice should not corroborate itself';
    vi.spyOn(p, 'searchMemory').mockResolvedValue([]);
    vi.spyOn(p, 'searchDrive').mockResolvedValue([]);
    vi.spyOn(p, 'searchWeb').mockResolvedValue([
      { source: 'web', title: 'Page A', snippet: shared, location: 'https://a.example/dup' },
      { source: 'web', title: 'Page A (again)', snippet: shared, location: 'https://a.example/dup' },
    ] satisfies SearchResult[]);

    const report = await p.conductResearch('duplicate url');
    expect(report.verifiedCount).toBe(0);
    expect(report.claims[0].sources).toHaveLength(1);
  });

  it('a genuinely single-sourced finding stays unverified, never silently upgraded', async () => {
    const p = plugin();
    vi.spyOn(p, 'searchMemory').mockResolvedValue([]);
    vi.spyOn(p, 'searchDrive').mockResolvedValue([]);
    vi.spyOn(p, 'searchWeb').mockResolvedValue([
      { source: 'web', title: 'Only Page', snippet: 'a claim nobody else confirms', location: 'https://only.example/x' },
    ] satisfies SearchResult[]);

    const report = await p.conductResearch('single source topic');
    expect(report.verifiedCount).toBe(0);
    expect(report.unverifiedCount).toBe(1);
    expect(report.claims[0].verified).toBe(false);
  });

  it('memory + web on the same fact still corroborates across source types, not just within one', async () => {
    const p = plugin();
    const shared = 'a fact this instance already remembered and also found on the web';
    vi.spyOn(p, 'searchMemory').mockResolvedValue([
      { source: 'memory', title: 'earlier note', snippet: shared, location: 'mem_1' },
    ]);
    vi.spyOn(p, 'searchDrive').mockResolvedValue([]);
    vi.spyOn(p, 'searchWeb').mockResolvedValue([
      { source: 'web', title: 'Confirming Page', snippet: shared, location: 'https://c.example/y' },
    ]);

    const report = await p.conductResearch('cross-type corroboration');
    expect(report.verifiedCount).toBe(1);
    expect(new Set(report.claims[0].sources.map((s) => s.source))).toEqual(new Set(['memory', 'web']));
  });
});
