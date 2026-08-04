/**
 * Plugin Library -- the plugin equivalent of SkillLibrary (skill-library.ts),
 * same shared-wiki-document pattern:
 *
 * PluginMakerExtension (plugins/extensions/index.ts) writes each
 * self-authored plugin to disk as a pair: a `.ts` source under
 * ~/.neuroclaw/plugins/ and a companion wiki report under
 * ~/.neuroclaw/plugins-wiki/ recording its description and capabilities.
 * That directory pair is a shared local library: every NeuroclawSystem
 * instance on the same machine -- including separate hive-mind agents --
 * reads and writes the same paths, so a plugin one instance builds is
 * discoverable and reusable by another instead of being recreated from
 * scratch.
 *
 * PluginLibrary is the search/read side: find a previously-built plugin by
 * keyword against its wiki report, then load its `.ts` source. "Download"
 * here is always a local filesystem read, never a network fetch (Section
 * 17: no external APIs for the core system).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PluginWikiEntry {
  name: string;
  description: string;
  capabilities: string[];
  generatedAt: string | null;
  wikiPath: string;
  sourcePath: string;
}

export interface PluginSearchHit {
  entry: PluginWikiEntry;
  score: number;
}

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

export class PluginLibrary {
  private readonly pluginsDir: string;
  private readonly wikiDir: string;

  constructor(pluginsDir?: string, wikiDir?: string) {
    this.pluginsDir = pluginsDir ?? join(homedir(), ".neuroclaw", "plugins");
    this.wikiDir = wikiDir ?? join(homedir(), ".neuroclaw", "plugins-wiki");
  }

  /** Every self-authored plugin with a wiki report, parsed back into structured form. */
  list(): PluginWikiEntry[] {
    if (!existsSync(this.wikiDir)) return [];
    const files = readdirSync(this.wikiDir).filter(f => f.endsWith(".md"));
    const entries: PluginWikiEntry[] = [];
    for (const f of files) {
      const entry = this.parseWikiFile(join(this.wikiDir, f));
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /** Search plugins by keyword overlap against name + description + capabilities. */
  search(query: string, topK = 5): PluginSearchHit[] {
    const queryTokens = tokenize(query);
    const hits: PluginSearchHit[] = [];
    for (const entry of this.list()) {
      const docTokens = tokenize(`${entry.name} ${entry.description} ${entry.capabilities.join(" ")}`);
      const score = overlapScore(queryTokens, docTokens);
      if (score > 0) hits.push({ entry, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** A single entry by exact plugin name, if it exists. */
  get(name: string): PluginWikiEntry | undefined {
    return this.list().find(e => e.name === name);
  }

  /** The raw .ts source for a plugin, if it exists on disk. */
  loadSource(name: string): string | null {
    const p = join(this.pluginsDir, `${name}.ts`);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }

  /** Parse a wiki report back into structured form. Matches the exact
   * format PluginMakerExtension.generateWikiDoc() writes; returns null for
   * anything that doesn't look like one of its reports. */
  private parseWikiFile(path: string): PluginWikiEntry | null {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
    if (!titleMatch) return null;
    const name = titleMatch[1].trim();

    const descriptionLine = lines.find(l => l.startsWith("**Description:**"));
    const description = descriptionLine ? descriptionLine.replace("**Description:**", "").trim() : "";

    const generatedLine = lines.find(l => l.startsWith("**Generated:**"));
    const generatedAt = generatedLine ? generatedLine.replace("**Generated:**", "").trim() : null;

    const capsHeaderIdx = lines.findIndex(l => l.trim() === "## Capabilities");
    const capabilities: string[] = [];
    if (capsHeaderIdx !== -1) {
      for (let i = capsHeaderIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("## ")) break;
        if (line.startsWith("- ")) capabilities.push(line.slice(2).trim());
      }
    }

    return {
      name,
      description,
      capabilities,
      generatedAt,
      wikiPath: path,
      sourcePath: join(this.pluginsDir, `${name}.ts`),
    };
  }
}
