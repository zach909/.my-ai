/**
 * The star's own breathing rate, pinned.
 *
 * AgentPulse's self-driven "no activity supplied" mode breathes at a fixed
 * frequency (Math.sin(t * RATE)) -- there is no prop for it, so the only way
 * to regress the speed is to edit the constant by hand, and the only way to
 * catch that is to check the constant itself. Read as source text rather
 * than imported and run, the same convention test/core/evaluation-ux.test.ts
 * and wiki-ux.test.ts already use for a React component with no headless
 * DOM in this suite (see vitest.config.ts: environment 'node', no @/ alias).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AgentPulse breathes at ten times its original rate', () => {
  const filePath = path.resolve(process.cwd(), 'src/components/agent-pulse.tsx');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  it('drives the self-timed breathing sine at 9, not the original 0.9', () => {
    expect(fileContent).toContain('Math.sin(t * 9)');
    // The old rate must not still be there under a different guise -- this
    // would also catch a mistaken "0.9" left in a comment being read as
    // proof the change happened when the code itself did not change.
    expect(fileContent).not.toMatch(/Math\.sin\(t \* 0\.9\)/);
  });

  it('still only stretches the points -- no rotation added along with the speed', () => {
    // The ring's whole identity (see the file's own doc comment) is that it
    // breathes rather than spins: only `amplitude`/`sharpness` come from the
    // drive value, and `phase` stays the literal 0 passed to ringPath(). A
    // speed change is not the place a rotation should quietly sneak in.
    expect(fileContent).toContain('ringPath(amplitude, sharpness, 0)');
  });
});
