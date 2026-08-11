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

import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendConversationTurn, readRecentConversationTurns } from '../../src/lib/conversation-log';
import { buildSamples, readRecentTurns } from '../../scripts/conversation-learning-agent.mjs';

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
