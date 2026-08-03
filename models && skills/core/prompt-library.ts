/**
 * Prompt Library -- saved, reusable prompt templates.
 *
 * Deliberately distinct from both "Skill" (plugin_manager's registered MoE
 * expert, Section 26) and PromptingSkill (prompt-understanding/goal
 * decomposition, prompting-skill.ts): a saved prompt is just a named piece
 * of text a user wants to invoke again and again without retyping it --
 * "a different way of importing a set prompt you want to do repeatedly",
 * not an expert and not an orchestration engine. How these get *used* is a
 * training-time concern (which prompts get reinforced, suggested, etc.),
 * not something hardcoded in here -- this is just the storage + templating.
 */

export interface SavedPrompt {
  name: string;
  template: string;
  createdAt: number;
  updatedAt: number;
  useCount: number;
}

export class PromptLibrary {
  private prompts = new Map<string, SavedPrompt>();

  /** Save (or overwrite) a named prompt template. */
  save(name: string, template: string): SavedPrompt {
    const key = PromptLibrary.normalize(name);
    const now = Date.now();
    const existing = this.prompts.get(key);
    const entry: SavedPrompt = {
      name: key,
      template,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      useCount: existing?.useCount ?? 0,
    };
    this.prompts.set(key, entry);
    return entry;
  }

  get(name: string): SavedPrompt | undefined {
    return this.prompts.get(PromptLibrary.normalize(name));
  }

  list(): SavedPrompt[] {
    return Array.from(this.prompts.values());
  }

  remove(name: string): boolean {
    return this.prompts.delete(PromptLibrary.normalize(name));
  }

  /**
   * The actual "do this prompt again" action: substitutes {{var}}
   * placeholders with the given values and bumps the saved prompt's use
   * count, so it's real usage data (not hardcoded) -- something training
   * could later reinforce which saved prompts matter most.
   */
  apply(name: string, vars: Record<string, string> = {}): string | null {
    const entry = this.prompts.get(PromptLibrary.normalize(name));
    if (!entry) return null;
    entry.useCount++;
    return entry.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
  }

  private static normalize(name: string): string {
    return name.trim().toLowerCase();
  }
}
