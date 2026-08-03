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
 *
 * Shared the same way skills and plugins already are (SkillLibrary /
 * PluginLibrary): every saved prompt is written to disk as a human-readable
 * wiki document under ~/.neuroclaw/prompts-wiki/, so any NeuroclawSystem
 * instance on the same machine -- including separate hive-mind agents --
 * can see and reuse a prompt another instance saved, instead of each
 * instance only ever holding its own in-memory copy. "Shared" here is
 * always a local filesystem read/write, never a network call (Section 17).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SavedPrompt {
  name: string;
  template: string;
  createdAt: number;
  updatedAt: number;
  useCount: number;
}

export interface PromptSearchHit {
  entry: SavedPrompt;
  score: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function overlapScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const docSet = new Set(docTokens);
  const matches = queryTokens.filter(t => docSet.has(t)).length;
  return matches / queryTokens.length;
}

export class PromptLibrary {
  private prompts = new Map<string, SavedPrompt>();
  private readonly wikiDir: string;

  constructor(wikiDir?: string) {
    this.wikiDir = wikiDir ?? join(homedir(), ".neuroclaw", "prompts-wiki");
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.wikiDir)) return;
    for (const f of readdirSync(this.wikiDir).filter(f => f.endsWith(".md"))) {
      const entry = this.parseWikiFile(join(this.wikiDir, f));
      if (entry) this.prompts.set(entry.name, entry);
    }
  }

  /** Save (or overwrite) a named prompt template, persisted immediately as a shared wiki doc. */
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
    this.persist(entry);
    return entry;
  }

  get(name: string): SavedPrompt | undefined {
    return this.prompts.get(PromptLibrary.normalize(name));
  }

  list(): SavedPrompt[] {
    return Array.from(this.prompts.values());
  }

  /** Search saved prompts by keyword overlap against name + template text. */
  search(query: string, topK = 5): PromptSearchHit[] {
    const queryTokens = tokenize(query);
    const hits: PromptSearchHit[] = [];
    for (const entry of this.list()) {
      const docTokens = tokenize(`${entry.name} ${entry.template}`);
      const score = overlapScore(queryTokens, docTokens);
      if (score > 0) hits.push({ entry, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  remove(name: string): boolean {
    const key = PromptLibrary.normalize(name);
    const existed = this.prompts.delete(key);
    if (existed) {
      try { unlinkSync(this.wikiPath(key)); } catch { /* already gone */ }
    }
    return existed;
  }

  /**
   * The actual "do this prompt again" action: substitutes {{var}}
   * placeholders with the given values and bumps the saved prompt's use
   * count -- persisted immediately, so it's real, shared usage data (not
   * hardcoded) -- something training could later reinforce which saved
   * prompts matter most.
   */
  apply(name: string, vars: Record<string, string> = {}): string | null {
    const entry = this.prompts.get(PromptLibrary.normalize(name));
    if (!entry) return null;
    entry.useCount++;
    entry.updatedAt = Date.now();
    this.persist(entry);
    return entry.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
  }

  private wikiPath(name: string): string {
    return join(this.wikiDir, `${name}.md`);
  }

  private persist(entry: SavedPrompt): void {
    if (!existsSync(this.wikiDir)) mkdirSync(this.wikiDir, { recursive: true });
    writeFileSync(this.wikiPath(entry.name), this.generateWikiDoc(entry), "utf-8");
  }

  private generateWikiDoc(entry: SavedPrompt): string {
    const lines: string[] = [];
    lines.push(`# ${entry.name}`);
    lines.push('');
    lines.push(`**Created:** ${new Date(entry.createdAt).toISOString()}`);
    lines.push(`**Updated:** ${new Date(entry.updatedAt).toISOString()}`);
    lines.push(`**Use count:** ${entry.useCount}`);
    lines.push('');
    lines.push('## Template');
    lines.push('');
    lines.push('```');
    lines.push(entry.template);
    lines.push('```');
    lines.push('');
    return lines.join('\n');
  }

  /** Parse a wiki doc back into structured form. Returns null for anything that doesn't look like one of ours. */
  private parseWikiFile(path: string): SavedPrompt | null {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
    if (!titleMatch) return null;
    const name = titleMatch[1].trim();

    const createdLine = lines.find(l => l.startsWith("**Created:**"));
    const createdAt = createdLine ? Date.parse(createdLine.replace("**Created:**", "").trim()) : NaN;
    const updatedLine = lines.find(l => l.startsWith("**Updated:**"));
    const updatedAt = updatedLine ? Date.parse(updatedLine.replace("**Updated:**", "").trim()) : NaN;
    const useCountLine = lines.find(l => l.startsWith("**Use count:**"));
    const useCount = useCountLine ? parseInt(useCountLine.replace("**Use count:**", "").trim(), 10) : 0;

    const fenceStart = lines.findIndex(l => l.trim() === "```");
    const fenceEnd = lines.indexOf("```", fenceStart + 1);
    const template = fenceStart !== -1 && fenceEnd !== -1
      ? lines.slice(fenceStart + 1, fenceEnd).join("\n")
      : "";

    return {
      name,
      template,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      useCount: Number.isFinite(useCount) ? useCount : 0,
    };
  }

  private static normalize(name: string): string {
    return name.trim().toLowerCase();
  }
}
