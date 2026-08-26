/**
 * Writing code, running it, and fixing it when it fails.
 *
 * The agent could already analyse code and execute a snippet in an isolated
 * vm. What it could not do is the thing that actually makes coding work:
 * notice its own output was wrong and revise it against the real error.
 * Generating a better first attempt is not the mechanism -- checking is.
 *
 * So this is a verify-and-revise loop over the existing sandbox. It runs a
 * candidate against real assertions, and when one fails it hands the ACTUAL
 * failure text back to whatever is proposing revisions, rather than a generic
 * "that didn't work". An agent told only that it failed can do no better than
 * guess again; an agent told `expected 6, got 5` can fix the off-by-one.
 *
 * What this module honestly is: the loop and the checking. The intelligence
 * that proposes a revision is supplied by the caller -- the mesh, a prompting
 * skill, or a human. Pretending otherwise would be the whole problem with
 * claiming an agent "writes code".
 *
 * Everything runs in `createContext({})`: no require, no process, no
 * filesystem, no network, and a hard timeout. Consistent with this project's
 * no-external-APIs rule, a candidate cannot reach out even if it tries.
 */

import { createContext, Script } from "node:vm";

/** How long any single candidate may run before it is killed. */
export const CANDIDATE_TIMEOUT_MS = 2000;

/** One thing the code must do. `expression` is evaluated after the code runs. */
export interface CodeCheck {
  /** What this is testing, in words, so a failure report reads like a reason. */
  name: string;
  /** A JS expression evaluated in the same sandbox after the candidate. */
  expression: string;
  /** Deep-compared against the expression's value. */
  expected: unknown;
}

export interface CheckOutcome {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  /** Present when the check could not be evaluated at all. */
  error?: string;
}

export interface VerifyResult {
  passed: boolean;
  outcomes: CheckOutcome[];
  /** Set when the candidate itself threw or would not parse. */
  crashed?: string;
  ms: number;
  /**
   * The failure, phrased for whoever has to fix it. Empty when everything
   * passed. This is the part that makes revision possible rather than
   * guesswork.
   */
  report: string;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // Structural comparison, so a check expecting [1,2,3] is not defeated by
  // the array being a different object with the same contents.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Run a candidate against its checks. Never throws -- a crash is a result. */
export function verifyCode(code: string, checks: CodeCheck[]): VerifyResult {
  const started = Date.now();
  const outcomes: CheckOutcome[] = [];

  let sandbox: object;
  try {
    sandbox = createContext({});
    new Script(code, { filename: "candidate.js" }).runInContext(sandbox, { timeout: CANDIDATE_TIMEOUT_MS });
  } catch (err) {
    const crashed = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      outcomes: [],
      crashed,
      ms: Date.now() - started,
      // Named as its own kind of failure: "it does not run" and "it runs and
      // is wrong" call for completely different fixes.
      report: `The code did not run: ${crashed}`,
    };
  }

  for (const check of checks) {
    try {
      const actual = new Script(check.expression, { filename: "check.js" }).runInContext(sandbox, {
        timeout: CANDIDATE_TIMEOUT_MS,
      });
      outcomes.push({ name: check.name, passed: sameValue(actual, check.expected), expected: check.expected, actual });
    } catch (err) {
      outcomes.push({
        name: check.name,
        passed: false,
        expected: check.expected,
        actual: undefined,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failed = outcomes.filter(o => !o.passed);
  return {
    passed: failed.length === 0 && checks.length > 0,
    outcomes,
    ms: Date.now() - started,
    report: failed
      .map(o =>
        o.error
          ? `${o.name}: could not be checked — ${o.error}`
          : `${o.name}: expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`,
      )
      .join("\n"),
  };
}

export interface IterationAttempt {
  attempt: number;
  code: string;
  result: VerifyResult;
}

export interface IterationResult {
  /** The code that passed, or null when none did. */
  code: string | null;
  passed: boolean;
  attempts: IterationAttempt[];
  /**
   * Why it stopped: solved, out of attempts, or the reviser gave up or
   * repeated itself. Distinguishing these matters -- "no more ideas" and "ran
   * out of budget" are different situations for whoever reads this.
   */
  stopped: "solved" | "out-of-attempts" | "no-revision" | "repeating";
}

/**
 * Try, check, revise, repeat.
 *
 * `revise` receives the failing code and the real failure text and returns a
 * new candidate, or null when it has nothing better. Stopping when a reviser
 * returns the same code twice is deliberate: a loop that keeps re-running an
 * identical failing candidate is not iterating, it is spinning, and it will
 * burn the whole budget doing it.
 */
export async function iterateOnCode(input: {
  initial: string;
  checks: CodeCheck[];
  revise: (code: string, failure: string, attempt: number) => string | null | Promise<string | null>;
  maxAttempts?: number;
}): Promise<IterationResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 5);
  const attempts: IterationAttempt[] = [];
  const seen = new Set<string>();
  let code = input.initial;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = verifyCode(code, input.checks);
    attempts.push({ attempt, code, result });
    if (result.passed) return { code, passed: true, attempts, stopped: "solved" };

    seen.add(code);
    const next = await input.revise(code, result.report, attempt);
    if (next === null || next === undefined) {
      return { code: null, passed: false, attempts, stopped: "no-revision" };
    }
    if (seen.has(next)) {
      return { code: null, passed: false, attempts, stopped: "repeating" };
    }
    code = next;
  }

  return { code: null, passed: false, attempts, stopped: "out-of-attempts" };
}
