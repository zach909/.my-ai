/**
 * Editing a prompting skill, and seeing the prompt actually inside one.
 *
 * The backend has always overwritten a prompting skill by name (see
 * test/core/prompting-skills.test.ts's "replaces by name, which is what
 * makes an edit take effect") and always sent the full skill document,
 * including `query` (perception) and `input`/`expect` (action) -- the
 * actual prompt text a skill runs. Nothing in the UI showed those fields,
 * and there was no way to open an existing skill for editing at all, only
 * to write a new one from a blank form.
 *
 * Read as source text rather than imported and rendered, the same
 * convention test/core/evaluation-ux.test.ts and wiki-ux.test.ts already
 * use for a React component with no headless DOM in this suite (see
 * vitest.config.ts: environment 'node', no @/ alias).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('the prompting skills panel shows and edits the prompt inside a skill', () => {
  const filePath = path.resolve(process.cwd(), 'src/routes/app/store.tsx');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  it('declares query/input/expect on the view type, so the already-sent data can reach the UI at all', () => {
    const viewType = fileContent.slice(
      fileContent.indexOf('interface PromptingSkillView'),
      fileContent.indexOf('interface PromptingSkillView') + 800,
    );
    expect(viewType).toContain('query?: string');
    expect(viewType).toContain('input?: string');
    expect(viewType).toContain('expect?: string');
  });

  it('renders the query/input/expect text on a skill\'s card, not just its name and description', () => {
    expect(fileContent).toContain('skill.query &&');
    expect(fileContent).toContain('skill.input &&');
    expect(fileContent).toContain('skill.expect &&');
  });

  it('has an Edit button on every active skill card', () => {
    const cardSection = fileContent.slice(
      fileContent.indexOf('runs on every message'),
      fileContent.indexOf('runs on every message') + 3000,
    );
    expect(cardSection).toContain('setEditing(skill)');
    expect(cardSection).toContain('Edit');
  });

  it('the form accepts an `initial` skill to edit and an onCancel, not just a blank-form onPublished', () => {
    const formSignature = fileContent.slice(
      fileContent.indexOf('function PublishPromptingSkill'),
      fileContent.indexOf('function PublishPromptingSkill') + 500,
    );
    expect(formSignature).toContain('initial?: PromptingSkillView | null');
    expect(formSignature).toContain('onCancel?: () => void');
  });

  it('pre-fills every field from the skill being edited, including query/input/expect', () => {
    const formBody = fileContent.slice(
      fileContent.indexOf('function PublishPromptingSkill'),
      fileContent.indexOf('function PublishPromptingSkill') + 3500,
    );
    expect(formBody).toContain("useState(initial?.name ?? '')");
    expect(formBody).toContain("useState<'perception' | 'cognitive' | 'action'>(initial?.category ?? 'perception')");
    expect(formBody).toContain("useState(initial?.query ?? '')");
    expect(formBody).toContain("useState(initial?.input ?? '')");
    expect(formBody).toContain("useState(initial?.expect ?? '')");
  });

  it('locks the name and category while editing, so a save cannot silently fork a new skill', () => {
    // Renaming or recategorising through republish-by-name would create a
    // SECOND skill next to the one being edited rather than changing it --
    // both fields disable on `editing`, the same flag the rest of the form
    // uses to distinguish "write new" from "edit existing".
    const nameField = fileContent.slice(fileContent.indexOf('<Label className="text-xs">Name</Label>'), fileContent.indexOf('<Label className="text-xs">Name</Label>') + 550);
    expect(nameField).toContain('disabled={editing}');

    const categoryButtons = fileContent.slice(
      fileContent.indexOf("(['perception', 'cognitive', 'action'] as const).map"),
      fileContent.indexOf("(['perception', 'cognitive', 'action'] as const).map") + 500,
    );
    expect(categoryButtons).toContain('disabled={editing}');
  });

  it('sends query on publish for a perception skill, and input/expect for an action skill', () => {
    const publishFn = fileContent.slice(
      fileContent.indexOf('const publish = async (alsoInstall: boolean)'),
      fileContent.indexOf('const publish = async (alsoInstall: boolean)') + 1200,
    );
    expect(publishFn).toMatch(/if \(query\.trim\(\)\) skill\.query = query\.trim\(\)/);
    expect(publishFn).toMatch(/if \(input\.trim\(\)\) skill\.input = input\.trim\(\)/);
    expect(publishFn).toMatch(/if \(expectField\.trim\(\)\) skill\.expect = expectField\.trim\(\)/);
  });
});
