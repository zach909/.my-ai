/**
 * Yes/no questions with a probability: a whole email and "is this spam?",
 * answered by a region of the one mesh.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain';
import { YesNoDoorway } from '../../models && skills/core/yes-no';

const engine = () => new HyperDimensionalEngine({
  neuronCount: 32, dimensions: 64, propagationSteps: 8,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true,
});

const SPAM = [
  'WIN a FREE iPhone now click here',
  'Congratulations you won the lottery, claim your prize',
  'cheap pills discount buy now limited offer',
  'You have been selected for a cash reward, click the link',
  'Earn money fast from home, guaranteed',
  'URGENT your account will be suspended, verify now',
];
const HAM = [
  'Hi, are we still meeting for lunch tomorrow?',
  "Here are the notes from today's team meeting",
  'Can you review my pull request when you get a chance',
  'Mom says dinner is at six on Sunday',
  'The quarterly report is attached for your review',
  'Thanks for the help with the project yesterday',
];

function taught() {
  const doorway = new YesNoDoorway(engine());
  for (const t of SPAM) doorway.teach('Is this spam?', t, true);
  for (const t of HAM) doorway.teach('Is this spam?', t, false);
  return doorway;
}

describe('yes/no questions answered by the mesh', () => {
  it('answers a whole email with yes/no and a probability', () => {
    const doorway = taught();
    const spam = doorway.ask('Is this spam?', 'Claim your FREE prize now, click here to win a cash reward');
    expect(spam.trained).toBe(true);
    expect(spam.answer).toBe('yes');
    expect(spam.probabilityYes).toBeGreaterThan(0.5);
    expect(spam.confidence).toBeGreaterThan(0.5);
    const ham = doorway.ask('Is this spam?', 'Attached is the report from the team meeting');
    expect(ham.answer).toBe('no');
    expect(ham.probabilityYes).toBeLessThan(0.5);
  });

  it('gets most of a held-out set right', () => {
    const doorway = taught();
    const cases: Array<[string, 'yes' | 'no']> = [
      ['Claim your FREE prize now, click here to win', 'yes'],
      ['Limited offer: buy cheap watches now', 'yes'],
      ['You won a cash reward, verify your account', 'yes'],
      ['Are you free for a call tomorrow afternoon?', 'no'],
      ['Attached is the report from the meeting', 'no'],
      ['Could you review the notes before Sunday?', 'no'],
    ];
    const right = cases.filter(([text, want]) => doorway.ask('is this spam', text).answer === want).length;
    expect(right).toBeGreaterThanOrEqual(5);
  });

  it('a question with no examples of both answers says it is untrained, at 0.5', () => {
    const doorway = new YesNoDoorway(engine());
    const r = doorway.ask('Is this urgent?', 'The server is down right now');
    expect(r.trained).toBe(false);
    expect(r.probabilityYes).toBe(0.5);
    doorway.teach('Is this urgent?', 'The server is down', true);
    expect(doorway.ask('Is this urgent?', 'anything').trained).toBe(false);
  });

  it('different questions do not interfere, and asking does not change what was taught', () => {
    const doorway = taught();
    doorway.teach('Is this about food?', 'dinner is at six', true);
    doorway.teach('Is this about food?', 'the report is attached', false);
    const first = doorway.ask('Is this spam?', 'Claim your FREE prize now');
    for (let i = 0; i < 5; i++) doorway.ask('Is this spam?', 'Claim your FREE prize now');
    const again = doorway.ask('Is this spam?', 'Claim your FREE prize now');
    expect(again.answer).toBe(first.answer);
    expect(doorway.questions().map((q) => q.question).sort()).toEqual(['is this about food', 'is this spam']);
  });

  it('what was taught survives a save and a load into a fresh mesh', () => {
    const saved = taught().toJSON();
    const restored = new YesNoDoorway(engine());
    restored.load(saved);
    const r = restored.ask('Is this spam?', 'Claim your FREE prize now, click here to win');
    expect(r.trained).toBe(true);
    expect(r.answer).toBe('yes');
  });

  it('probabilities are calibrated to the taught examples, not pinned at 0 or 1', () => {
    const doorway = taught();
    const r = doorway.ask('Is this spam?', 'Claim your FREE prize now, click here to win');
    // Confident about a clear case, but not certain.
    expect(r.probabilityYes).toBeGreaterThan(0.6);
    expect(r.probabilityYes).toBeLessThan(0.999);
    // A text sharing nothing with either side sits near the middle.
    const unclear = doorway.ask('Is this spam?', 'zzzz qqqq');
    expect(Math.abs(unclear.probabilityYes - 0.5)).toBeLessThan(Math.abs(r.probabilityYes - 0.5));
    // And it says how well it fits what it was taught.
    expect(r.fitAccuracy).toBeGreaterThanOrEqual(0.9);
  });
});
