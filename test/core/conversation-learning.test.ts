/**
 * Tests for the local-only conversation-learning pipeline:
 * src/lib/conversation-log.ts (the real append/read of local turns) and
 * scripts/conversation-learning-agent.mjs's pure sample-building logic.
 * The real end-to-end training (real pytorch_trainer.py, real
 * convergence) was verified manually via `node
 * scripts/conversation-learning-agent.mjs --once` against a real local
 * log before shipping -- 5/5 samples genuinely converged -- same
 * precedent as this session's other autonomous-agent scripts.
 */

import { mkdtempSync, rmSync, appendFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendConversationTurn, readRecentConversationTurns } from '../../src/lib/conversation-log';
import { buildSamples, readRecentTurns, acquireLock, releaseLock } from '../../scripts/conversation-learning-agent.mjs';

describe('conversation-log: appendConversationTurn() / readRecentConversationTurns()', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a real turn to disk and back', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    appendConversationTurn('hello', 'hi there', logPath);
    const turns = readRecentConversationTurns(10, logPath);
    expect(turns.length).toBe(1);
    expect(turns[0].userMessage).toBe('hello');
    expect(turns[0].response).toBe('hi there');
  });

  it('preserves order across multiple appends -- oldest first', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    appendConversationTurn('first', 'r1', logPath);
    appendConversationTurn('second', 'r2', logPath);
    appendConversationTurn('third', 'r3', logPath);
    const turns = readRecentConversationTurns(10, logPath);
    expect(turns.map((t) => t.userMessage)).toEqual(['first', 'second', 'third']);
  });

  it('returns an empty array for a log that does not exist yet, never throws', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    expect(readRecentConversationTurns(10, path.join(dir, 'nope.jsonl'))).toEqual([]);
  });

  it('respects the limit, keeping the most recent entries', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    for (let i = 0; i < 5; i++) appendConversationTurn(`msg${i}`, `resp${i}`, logPath);
    const turns = readRecentConversationTurns(2, logPath);
    expect(turns.map((t) => t.userMessage)).toEqual(['msg3', 'msg4']);
  });

  it('skips a malformed line instead of throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    appendConversationTurn('real turn', 'real response', logPath);
    appendFileSync(logPath, 'not valid json {{{\n');
    const turns = readRecentConversationTurns(10, logPath);
    expect(turns.length).toBe(1);
    expect(turns[0].userMessage).toBe('real turn');
  });
});

describe('conversation-learning-agent: readRecentTurns() -- the plain-JS mirror', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads real turns written by appendConversationTurn() -- same file format, both sides agree', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-log-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    appendConversationTurn('hi', 'hello back', logPath);
    const turns = readRecentTurns(logPath, 10);
    expect(turns.length).toBe(1);
    expect(turns[0].userMessage).toBe('hi');
  });
});

describe('conversation-learning-agent: buildSamples() -- both real prediction directions', () => {
  it('builds a "respond" sample (predict the response from the input) for every turn', () => {
    const turns = [{ at: 1, userMessage: 'a', response: 'A' }];
    const samples = buildSamples(turns);
    const respond = samples.find((s: any) => s.kind === 'respond');
    expect(respond).toBeTruthy();
    expect(respond.inputText).toBe('a');
    expect(respond.targetText).toBe('A');
  });

  it('builds an "anticipate" sample (predict the next user message from the prior response) only when a prior turn exists', () => {
    const turns = [
      { at: 1, userMessage: 'first message', response: 'first response' },
      { at: 2, userMessage: 'second message', response: 'second response' },
    ];
    const samples = buildSamples(turns);
    const anticipate = samples.filter((s: any) => s.kind === 'anticipate');
    expect(anticipate.length).toBe(1); // only the second turn has a prior turn
    expect(anticipate[0].inputText).toBe('first response');
    expect(anticipate[0].targetText).toBe('second message');
  });

  it('produces no anticipate sample for a single, first-ever turn', () => {
    const turns = [{ at: 1, userMessage: 'only message', response: 'only response' }];
    const samples = buildSamples(turns);
    expect(samples.every((s: any) => s.kind !== 'anticipate')).toBe(true);
  });

  it('gives every sample a stable, unique key', () => {
    const turns = [
      { at: 1, userMessage: 'a', response: 'A' },
      { at: 2, userMessage: 'b', response: 'B' },
    ];
    const samples = buildSamples(turns);
    const keys = samples.map((s: any) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces exactly 2N-1 samples for N turns (N respond + N-1 anticipate)', () => {
    const turns = Array.from({ length: 5 }, (_, i) => ({ at: i, userMessage: `m${i}`, response: `r${i}` }));
    const samples = buildSamples(turns);
    expect(samples.length).toBe(2 * 5 - 1);
  });
});

describe('conversation-learning-agent: acquireLock() / releaseLock() -- the cross-process guard', () => {
  // This is the real thing that keeps the immediate in-process trigger
  // (src/lib/conversation-learning-trigger.ts, fired from bot-service.ts
  // on every turn) from training at the same moment as the separate
  // background scripts/conversation-learning-agent.mjs process -- two
  // different OS processes, so a same-process boolean can't see each
  // other. Exercised against a real throwaway file, not mocked.
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the first caller acquires it, and it leaves a real lock file behind', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'sub', 'conversation-learning.lock');
    expect(acquireLock(lockPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
  });

  it('a second caller is refused while the lock is held', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'conversation-learning.lock');
    expect(acquireLock(lockPath)).toBe(true);
    expect(acquireLock(lockPath)).toBe(false); // still held -- real EEXIST path
  });

  it('releaseLock() frees it for the next caller', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'conversation-learning.lock');
    expect(acquireLock(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
    expect(acquireLock(lockPath)).toBe(true); // free again
  });

  it('releaseLock() on a lock that was never acquired is a harmless no-op', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'never-created.lock');
    expect(() => releaseLock(lockPath)).not.toThrow();
  });

  it('a stale lock (older than the staleness window) is reclaimed instead of blocking forever', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'conversation-learning.lock');
    expect(acquireLock(lockPath)).toBe(true);
    // Simulate an abandoned lock from a process that died without cleaning
    // up: backdate its mtime past LOCK_STALE_MS (10 minutes).
    const staleTime = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath, staleTime, staleTime);
    expect(acquireLock(lockPath)).toBe(true); // reclaimed, not refused
  });

  it('a fresh lock (within the staleness window) is not reclaimed', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conv-lock-test-'));
    const lockPath = path.join(dir, 'conversation-learning.lock');
    expect(acquireLock(lockPath)).toBe(true);
    expect(acquireLock(lockPath)).toBe(false); // just created -- nowhere near stale
  });
});

describe('who said what', () => {
  it('carries the speaker on both sides of every sample', () => {
    // A transcript that does not say who spoke is a transcript of nobody: the
    // network sees the words of a question and the words of an answer with
    // nothing marking those as different kinds of thing.
    const turns = [
      { at: 1, userMessage: 'what is this', response: 'a neural mesh' },
      { at: 2, userMessage: 'and this', response: 'the same mesh' },
    ];
    const samples = buildSamples(turns);
    const respond = samples.find(s => s.kind === 'respond')!;
    expect(respond.inputSpeaker).toBe('user');
    expect(respond.targetSpeaker).toBe('ai');

    const anticipate = samples.find(s => s.kind === 'anticipate')!;
    expect(anticipate.inputSpeaker).toBe('ai');
    expect(anticipate.targetSpeaker).toBe('user');
  });

  it('writes a turn the way a conversation reads', async () => {
    const { formatTurn } = await import('../../models && skills/core/neuro-lang.js');
    expect(formatTurn('ai', 'hello')).toBe('AI: hello');
    expect(formatTurn('user', 'hello')).toBe('User: hello');
  });

  it('puts the same words from different speakers in genuinely different places', async () => {
    // The point of the reserved dimension. A label alone leaves the two at
    // cosine 0.96 for a long message -- a difference the network cannot learn
    // from, which would make labelling decoration.
    const { embedTurn, embedText } = await import('../../models && skills/core/neuro-lang.js');
    const cos = (a: number[], b: number[]) => {
      let d = 0, x = 0, y = 0;
      for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
      return d / (Math.sqrt(x) * Math.sqrt(y));
    };
    const long = 'the quick brown fox jumps over the lazy dog and keeps running across the field for a while';

    expect(cos(embedText(`AI: ${long}`, 16), embedText(`User: ${long}`, 16))).toBeGreaterThan(0.9);
    expect(Math.abs(cos(embedTurn('ai', long, 16), embedTurn('user', long, 16)))).toBeLessThan(0.2);
  });

  it('does not let a long message drown the speaker out', async () => {
    // The failure a weaker marker had: it worked on short text and stopped
    // working exactly when a conversation got interesting.
    const { embedTurn } = await import('../../models && skills/core/neuro-lang.js');
    const cos = (a: number[], b: number[]) => {
      let d = 0, x = 0, y = 0;
      for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
      return d / (Math.sqrt(x) * Math.sqrt(y));
    };
    const huge = 'a fairly long sentence that goes on and on '.repeat(30);
    expect(Math.abs(cos(embedTurn('ai', huge, 16), embedTurn('user', huge, 16)))).toBeLessThan(0.2);
  });

  it('still separates different things said by the same speaker', async () => {
    // The speaker must not swamp the content either -- the network has to
    // learn what was actually said, not only who was talking.
    const { embedTurn } = await import('../../models && skills/core/neuro-lang.js');
    const cos = (a: number[], b: number[]) => {
      let d = 0, x = 0, y = 0;
      for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
      return d / (Math.sqrt(x) * Math.sqrt(y));
    };
    const same = cos(embedTurn('ai', 'the weather is cold today', 16), embedTurn('ai', 'the weather is cold today', 16));
    const different = cos(embedTurn('ai', 'the weather is cold today', 16), embedTurn('ai', 'compile the extension builder', 16));
    expect(same).toBeCloseTo(1, 6);
    expect(different).toBeLessThan(0.9);
  });

  it('keeps every component inside what a tanh readout can reach', async () => {
    const { embedTurn } = await import('../../models && skills/core/neuro-lang.js');
    for (const text of ['hi', 'a much longer message '.repeat(20)]) {
      for (const speaker of ['ai', 'user'] as const) {
        for (const v of embedTurn(speaker, text, 16)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the continuous mind sees a conversation, not a run-on sentence', () => {
  const cos = (a: number[], b: number[]) => {
    let d = 0, x = 0, y = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
    return d / (Math.sqrt(x) * Math.sqrt(y));
  };

  it('tells a monologue from a back-and-forth', async () => {
    const { embedTranscript } = await import('../../models && skills/core/neuro-lang.js');
    const both = embedTranscript([
      { speaker: 'user', text: 'what is the mesh' },
      { speaker: 'ai', text: 'every neuron wired to every other' },
    ], 16);
    const onlyAi = embedTranscript([
      { speaker: 'ai', text: 'what is the mesh' },
      { speaker: 'ai', text: 'every neuron wired to every other' },
    ], 16);

    // Same words, different conversation. Dimension 0 is who was talking:
    // balanced in an exchange, saturated in a monologue.
    expect(Math.abs(both[0])).toBeLessThan(0.2);
    expect(Math.abs(onlyAi[0])).toBeGreaterThan(0.4);
    expect(cos(both, onlyAi)).toBeLessThan(0.95);
  });

  it('keeps the turn boundary rather than running the words together', async () => {
    const { embedTranscript, embedTurn } = await import('../../models && skills/core/neuro-lang.js');
    const asTwo = embedTranscript([
      { speaker: 'user', text: 'stop' },
      { speaker: 'user', text: 'now' },
    ], 16);
    const asOne = embedTurn('user', 'stop now', 16);
    expect(cos(asTwo, asOne)).toBeLessThan(0.99);
  });

  it('a single queued turn is exactly one turn', async () => {
    const { embedTranscript, embedTurn } = await import('../../models && skills/core/neuro-lang.js');
    expect(embedTranscript([{ speaker: 'ai', text: 'hello' }], 16)).toEqual(embedTurn('ai', 'hello', 16));
  });

  it('stays inside what a tanh readout can reach', async () => {
    const { embedTranscript } = await import('../../models && skills/core/neuro-lang.js');
    const many = Array.from({ length: 20 }, (_, i) => ({
      speaker: (i % 2 === 0 ? 'user' : 'ai') as 'user' | 'ai',
      text: `turn number ${i} with a reasonable amount of text in it`,
    }));
    for (const v of embedTranscript(many, 16)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});
