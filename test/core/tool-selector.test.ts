/**
 * Choosing a tool is not permission to run it.
 *
 * The selector proposes; authorize() decides, and knows nothing about scores. The
 * held-out accuracy numbers are in benchmarks/tool_selection.mjs; these pin the
 * behaviours that must never regress: untrained does nothing, a confident
 * proposal for a consequential tool still needs an explicit grant for that tool,
 * unknown or unavailable tools never run, and abstention is a real answer.
 */
import { describe, it, expect } from 'vitest';
import { LearnedToolSelector, authorize, utility, type ToolEntry, type Selection } from '../../models && skills/core/tool-selector.js';

const tools = new Map<string, ToolEntry>([
  ['read_file', { id: 'read_file', consequential: false, available: true }],
  ['send_email', { id: 'send_email', consequential: true, available: true }],
  ['gone', { id: 'gone', consequential: false, available: false }],
]);
const train = [
  { text: 'read the file notes.txt', tool: 'read_file' }, { text: 'show me the contents of report.md', tool: 'read_file' },
  { text: 'what does the log file say', tool: 'read_file' }, { text: 'open config.json and tell me what is inside', tool: 'read_file' },
  { text: 'send an email to Bob saying I will be late', tool: 'send_email' }, { text: 'email the report to my boss', tool: 'send_email' },
  { text: 'mail the invoice to the client', tool: 'send_email' }, { text: 'compose a message to alice@example.com about the meeting', tool: 'send_email' },
  { text: 'tell me a joke', tool: null }, { text: 'what is the capital of France', tool: null }, { text: 'thanks, that was helpful', tool: null },
];
const val = [
  { text: 'display the text in todo.txt', gold: 'read_file' }, { text: 'email Jane the schedule', gold: 'send_email' },
  { text: 'hello there', gold: null }, { text: 'go ahead', gold: 'abstain' }, { text: 'launch the missiles', gold: 'abstain' },
] as const;

describe('an untrained selector does nothing', () => {
  it('abstains on everything, and nothing it says can execute', () => {
    const s = new LearnedToolSelector();
    for (const t of ['read the file notes.txt', 'email bob', '', 'asdf']) {
      const sel = s.select(t);
      expect(sel).toEqual({ kind: 'abstain', reason: 'untrained' });
      expect(authorize(sel, tools, new Set(['read_file', 'send_email'])).execute).toBe(false);
    }
  });
  it('refuses to be calibrated before it is taught, and to be trained on nothing', () => {
    expect(() => new LearnedToolSelector().calibrate([])).toThrow();
    expect(() => new LearnedToolSelector().train([])).toThrow();
  });
});

describe('a taught selector', () => {
  const s = new LearnedToolSelector();
  s.train(train);
  s.calibrate([...val]);

  it('chooses the right tool for what it was taught', () => {
    expect(s.select('read the file notes.txt')).toMatchObject({ kind: 'tool', tool: 'read_file' });
    expect(s.select('email the report to my boss')).toMatchObject({ kind: 'tool', tool: 'send_email' });
  });
  it('is deterministic', () => {
    expect(s.select('show me the contents of report.md')).toEqual(s.select('show me the contents of report.md'));
  });
  it('does not propose a tool for gibberish or an empty request', () => {
    for (const t of ['', '   ', 'qzx vbnm plk wrt', '\u0000\u0001']) expect(s.select(t).kind).not.toBe('tool');
  });
  it('limits are fitted on validation requests passed in, and the validation set is not mutated', () => {
    const copy = JSON.stringify(val);
    const t = new LearnedToolSelector(); t.train(train);
    const { limits } = t.calibrate([...val]);
    expect(t.limits).toEqual(limits);
    expect(JSON.stringify(val)).toBe(copy);
  });
});

describe('utility: a wrong action costs more than a miss', () => {
  const tool = (name: string): Selection => ({ kind: 'tool', tool: name, score: 1, margin: 1, runnerUp: null });
  it('scores right action +1, miss 0, wrong action -2, right abstention +1', () => {
    expect(utility(tool('a'), 'a')).toBe(1);
    expect(utility({ kind: 'abstain', reason: 'low-score' }, 'a')).toBe(0);
    expect(utility(tool('b'), 'a')).toBe(-2);
    expect(utility({ kind: 'abstain', reason: 'ambiguous' }, 'abstain')).toBe(1);
    expect(utility(tool('a'), 'abstain')).toBe(-2);
    expect(utility(tool('a'), null)).toBe(-2);
  });
});

describe('authorize: permission is separate from selection', () => {
  const sure = (tool: string): Selection => ({ kind: 'tool', tool, score: 99, margin: 99, runnerUp: null });
  it('a consequential tool never runs on confidence alone', () => {
    expect(authorize(sure('send_email'), tools).execute).toBe(false);
  });
  it('and not on a grant for a different tool', () => {
    expect(authorize(sure('send_email'), tools, new Set(['read_file'])).execute).toBe(false);
  });
  it('runs with an explicit grant for exactly that tool', () => {
    expect(authorize(sure('send_email'), tools, new Set(['send_email'])).execute).toBe(true);
  });
  it('a harmless tool needs no grant', () => {
    expect(authorize(sure('read_file'), tools).execute).toBe(true);
  });
  it('an unknown or unavailable tool never runs, grant or not', () => {
    expect(authorize(sure('teleporter'), tools, new Set(['teleporter'])).execute).toBe(false);
    expect(authorize(sure('gone'), tools, new Set(['gone'])).execute).toBe(false);
  });
  it('no-tool and abstention never execute anything', () => {
    expect(authorize({ kind: 'none', score: 1 }, tools, new Set(['send_email'])).execute).toBe(false);
    expect(authorize({ kind: 'abstain', reason: 'ambiguous' }, tools, new Set(['send_email'])).execute).toBe(false);
  });
});
