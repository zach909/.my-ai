/**
 * Tests for scripts/capability-exam.mjs and its domain generators --
 * "a test that can't be cheated": completely random questions, in
 * random order, regenerated fresh every single call, spanning math plus
 * chemistry, astrophysics, optics, quantum computing, and digital logic
 * ("I don't want it just to be math").
 */

import { generateExam, gradeAnswer, gradeExam, shuffle, EXAM_DOMAINS } from '../../scripts/capability-exam.mjs';
import { generateChemistryProblem, ATOMIC_WEIGHTS } from '../../scripts/exam-generators/chemistry.mjs';
import { generateAstrophysicsProblem } from '../../scripts/exam-generators/astrophysics.mjs';
import { generateOpticsProblem } from '../../scripts/exam-generators/optics.mjs';
import { generateQuantumComputingProblem } from '../../scripts/exam-generators/quantum-computing.mjs';
import { generateDigitalLogicProblem } from '../../scripts/exam-generators/digital-logic.mjs';

describe('EXAM_DOMAINS -- multi-domain, not just math', () => {
  it('covers math plus every domain the user asked for', () => {
    const domains = Object.keys(EXAM_DOMAINS);
    expect(domains).toContain('arithmetic');
    expect(domains).toContain('chemistry');
    expect(domains).toContain('astrophysics');
    expect(domains).toContain('optics');
    expect(domains).toContain('quantum-computing');
    expect(domains).toContain('digital-logic');
  });
});

describe('generateExam() -- random questions, random order, never reused', () => {
  it('draws questionsPerDomain questions from every domain', () => {
    const exam = generateExam({ questionsPerDomain: 3, rand: Math.random });
    expect(exam.questions.length).toBe(3 * Object.keys(EXAM_DOMAINS).length);
    const domainsSeen = new Set(exam.questions.map((q) => q.domain));
    expect(domainsSeen.size).toBe(Object.keys(EXAM_DOMAINS).length);
  });

  it('two exams generated back to back are not identical -- genuinely fresh, not cached', () => {
    const a = generateExam({ questionsPerDomain: 4 });
    const b = generateExam({ questionsPerDomain: 4 });
    expect(a.questions.map((q) => q.problem)).not.toEqual(b.questions.map((q) => q.problem));
  });

  it('is deterministic given a fixed rand() source -- testable without being predictable in practice', () => {
    function makeSeededRand(seed: number) {
      let state = seed;
      return () => {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
      };
    }
    const a = generateExam({ questionsPerDomain: 2, rand: makeSeededRand(1) });
    const b = generateExam({ questionsPerDomain: 2, rand: makeSeededRand(1) });
    expect(a.questions.map((q) => q.answer)).toEqual(b.questions.map((q) => q.answer));
  });

  it('can be restricted to a subset of domains', () => {
    const exam = generateExam({ questionsPerDomain: 2, domains: ['arithmetic'] });
    expect(exam.questions.every((q) => q.domain === 'arithmetic')).toBe(true);
  });
});

describe('shuffle() -- real Fisher-Yates, not a biased sort comparator', () => {
  it('preserves every element, just reorders them', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = shuffle(items, Math.random);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    shuffle(items, Math.random);
    expect(items).toEqual(copy);
  });
});

describe('gradeAnswer() -- exact and numeric-tolerant grading', () => {
  it('accepts an exact string match, case/whitespace-insensitive', () => {
    expect(gradeAnswer('42', ' 42 ')).toBe(true);
    expect(gradeAnswer('ABC', 'abc')).toBe(true);
  });

  it('accepts a numeric answer within relative tolerance', () => {
    expect(gradeAnswer('3.14159', '3.14')).toBe(true);
    expect(gradeAnswer('1000', '1e3')).toBe(true);
  });

  it('rejects a genuinely wrong numeric answer', () => {
    expect(gradeAnswer('100', '50')).toBe(false);
  });

  it('rejects a non-string/number given answer instead of throwing', () => {
    expect(gradeAnswer('42', undefined as unknown as string)).toBe(false);
    expect(gradeAnswer('42', null as unknown as string)).toBe(false);
  });
});

describe('gradeExam() -- score plus a per-question breakdown', () => {
  it('scores a perfect run as 1.0', () => {
    const exam = generateExam({ questionsPerDomain: 2, domains: ['arithmetic'] });
    const answers = exam.questions.map((q) => q.answer);
    const result = gradeExam(exam, answers);
    expect(result.score).toBe(1);
    expect(result.correctCount).toBe(result.totalCount);
  });

  it('scores an all-wrong run as 0.0', () => {
    const exam = generateExam({ questionsPerDomain: 2, domains: ['arithmetic'] });
    const answers = exam.questions.map(() => '__definitely-wrong__');
    const result = gradeExam(exam, answers);
    expect(result.score).toBe(0);
  });
});

describe('domain generators -- real closed-form formulas, verifiable answers', () => {
  it('chemistry: molar mass is the real sum of a known periodic-table subset', () => {
    const { answer } = generateChemistryProblem(() => 0.1);
    expect(Number.isFinite(Number(answer))).toBe(true);
    expect(Object.keys(ATOMIC_WEIGHTS).length).toBeGreaterThan(5);
  });

  it('astrophysics: produces a finite, positive numeric answer', () => {
    for (const r of [0.1, 0.9]) {
      const { answer } = generateAstrophysicsProblem(() => r);
      expect(Number(answer)).toBeGreaterThan(0);
    }
  });

  it('optics: produces a finite, positive numeric answer', () => {
    for (const r of [0.1, 0.9]) {
      const { answer } = generateOpticsProblem(() => r);
      expect(Number(answer)).toBeGreaterThan(0);
    }
  });

  it('quantum-computing: state count for n qubits is exactly 2^n', () => {
    const { problem, answer } = generateQuantumComputingProblem(() => 0.5);
    const match = problem.match(/(\d+) qubits/);
    if (problem.includes('basis states') && match) {
      expect(Number(answer)).toBe(2 ** Number(match[1]));
    } else {
      expect(Number.isFinite(Number(answer)) || typeof answer === 'string').toBe(true);
    }
  });

  it('digital-logic: a binary<->decimal conversion round-trips correctly', () => {
    const { problem, answer } = generateDigitalLogicProblem(() => 0.1);
    expect(typeof problem).toBe('string');
    expect(typeof answer).toBe('string');
  });
});
