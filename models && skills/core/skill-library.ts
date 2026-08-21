/**
 * Skill Library (supports Section 10/26: reuse a skill instead of
 * recreating it).
 *
 * SkillMakerExtension (plugins/extensions/index.ts) writes each
 * self-authored skill to disk as a pair: a `.neuri` source under
 * generated/skills/ and a companion wiki report under
 * generated/skills-wiki/ recording its description and the sources/info
 * that went into it -- repo-relative, not homedir-relative, so a
 * self-authored skill is genuinely public (committed/pushed like any other
 * repo change) rather than living only in an ephemeral local sandbox. That
 * directory pair is already a shared local library: every NeuroclawSystem
 * instance running on the same machine -- including separate hive-mind
 * agents (Section 8) -- reads and writes the same paths.
 *
 * SkillLibrary is the search/read side of that library: find a
 * previously-built skill by keyword against its wiki report, then load its
 * `.neuri` source or actually install it through a NeuroLangInterpreter.
 * "Download" here means a local filesystem read, never a network fetch --
 * consistent with Section 17's "no external APIs for the core system".
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NeuroLangInterpreter, NeuriNeuron } from "./neuro-lang.js";

export interface SkillIOLayers {
  inputs: NeuriNeuron[];
  outputs: NeuriNeuron[];
}

export interface SkillWikiEntry {
  name: string;
  description: string;
  sources: string[];
  neuronNames: string[];
  generatedAt: string | null;
  wikiPath: string;
  neuriPath: string;
}

export interface SkillSearchHit {
  entry: SkillWikiEntry;
  score: number;
}

const NO_SOURCES_MARKER = "generated directly from the description above";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Fraction of query tokens present in the document -- deterministic, local, no embeddings service. */
function overlapScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const docSet = new Set(docTokens);
  const matches = queryTokens.filter(t => docSet.has(t)).length;
  return matches / queryTokens.length;
}

export class SkillLibrary {
  private readonly skillsDir: string;
  private readonly wikiDir: string;

  constructor(skillsDir?: string, wikiDir?: string) {
    const base = process.env.NEUROCLAW_GENERATED_DIR || join(process.cwd(), "generated");
    this.skillsDir = skillsDir ?? join(base, "skills");
    this.wikiDir = wikiDir ?? join(base, "skills-wiki");
  }

  /** Every skill with a wiki report, parsed back into structured form. */
  list(): SkillWikiEntry[] {
    if (!existsSync(this.wikiDir)) return [];
    const files = readdirSync(this.wikiDir).filter(f => f.endsWith(".md"));
    const entries: SkillWikiEntry[] = [];
    for (const f of files) {
      const entry = this.parseWikiFile(join(this.wikiDir, f));
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * Search skills by keyword overlap against name + description + sources.
   * Deterministic and local -- no embeddings service, no network call.
   */
  search(query: string, topK = 5): SkillSearchHit[] {
    const queryTokens = tokenize(query);
    const hits: SkillSearchHit[] = [];
    for (const entry of this.list()) {
      const docTokens = tokenize(`${entry.name} ${entry.description} ${entry.sources.join(" ")}`);
      const score = overlapScore(queryTokens, docTokens);
      if (score > 0) hits.push({ entry, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** A single entry by exact skill name, if it exists. */
  get(name: string): SkillWikiEntry | undefined {
    return this.list().find(e => e.name === name);
  }

  /** The raw .neuri source for a skill, if it exists on disk. */
  loadSource(name: string): string | null {
    const p = join(this.skillsDir, `${name}.neuri`);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }

  /**
   * "Download" a skill: parse and evaluate its .neuri source through a
   * NeuroLangInterpreter, actually instantiating its neurons rather than
   * just handing back text. Returns null if the skill has no source on
   * disk; throws if the source fails to parse (surfacing a broken skill
   * loudly rather than silently installing nothing).
   */
  async install(name: string, interpreter: NeuroLangInterpreter): Promise<Map<string, NeuriNeuron> | null> {
    const source = this.loadSource(name);
    if (!source) return null;
    const parsed = await interpreter.parse(source);
    if (parsed.errors.length > 0) {
      throw new Error(`Skill "${name}" failed to parse: ${parsed.errors.join("; ")}`);
    }
    return interpreter.evaluate(parsed);
  }

  /**
   * Install a skill and split its neurons into dedicated input/output
   * layers (any neuron the skill's own `.neuri` source tagged
   * `@role="input"`/`"output"`), the same way MoE experts are a labeled
   * subset of one shared mesh rather than a separate network -- a caller
   * that just wants "feed this skill X, read back Y" doesn't need to know
   * the skill's internal neuron names. Neurons with no `@role` tag are
   * still installed and still connected; they're just interior, not I/O.
   * Returns null if the skill has no source on disk (same as install()).
   */
  async installWithIOLayers(
    name: string,
    interpreter: NeuroLangInterpreter
  ): Promise<{ neurons: Map<string, NeuriNeuron>; io: SkillIOLayers } | null> {
    const neurons = await this.install(name, interpreter);
    if (!neurons) return null;
    return { neurons, io: interpreter.getIOLayers(neurons) };
  }

  /** Parse a wiki report back into structured form. Matches the exact
   * format SkillMakerExtension.generateWikiDoc() writes; returns null for
   * anything that doesn't look like one of its reports rather than
   * guessing at a malformed/foreign file. */
  private parseWikiFile(path: string): SkillWikiEntry | null {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
    if (!titleMatch) return null;
    const name = titleMatch[1].trim();

    const descriptionLine = lines.find(l => l.startsWith("**Description:**"));
    const description = descriptionLine ? descriptionLine.replace("**Description:**", "").trim() : "";

    const generatedLine = lines.find(l => l.startsWith("**Generated:**"));
    const generatedAt = generatedLine ? generatedLine.replace("**Generated:**", "").trim() : null;

    const neuronNames = lines
      .filter(l => /^-\s+`[^`]+`$/.test(l.trim()))
      .map(l => l.trim().match(/^-\s+`([^`]+)`$/)?.[1])
      .filter((n): n is string => !!n);

    const sourcesHeaderIdx = lines.findIndex(l => l.trim() === "## Sources and info used");
    const sources: string[] = [];
    if (sourcesHeaderIdx !== -1) {
      for (let i = sourcesHeaderIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("## ")) break;
        if (line.startsWith("- ")) {
          const item = line.slice(2).trim();
          if (!item.toLowerCase().includes(NO_SOURCES_MARKER)) sources.push(item);
        }
      }
    }

    return {
      name,
      description,
      sources,
      neuronNames,
      generatedAt,
      wikiPath: path,
      neuriPath: join(this.skillsDir, `${name}.neuri`),
    };
  }
}
