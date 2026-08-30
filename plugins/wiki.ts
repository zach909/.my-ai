import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import {
  listWikiPages,
  readWikiPage,
  publishWikiPageAndSync,
  deleteWikiPageAndSync,
  WikiNameError,
  type WikiPageSummary,
  type WikiPage,
} from "../models && skills/core/wiki-store.js";
import type { StoreSyncResult } from "../models && skills/core/store-sync.js";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Says plainly whether a sync actually left the device. The same distinction
 * StorePlugin's own chat replies make -- "pushed" and "saved locally" are
 * different outcomes, and the whole point of surfacing sync here is that a
 * bot-published page saying "Published" with nothing after it used to mean
 * nothing about whether anyone else would ever see it.
 */
function describeSync(sync: StoreSyncResult): string {
  return sync.pushed
    ? `Pushed${sync.branch ? ` to ${sync.branch}` : ""} — everyone who pulls now gets it.`
    : `Saved on this device only — ${sync.reason ?? "it has not reached anyone else yet"}.`;
}

/**
 * WikiPlugin — the AI's own hands for docs/SKILL_ACQUISITION_LOOP.md's
 * "push the wiki page" step: list()/read() let it check what's already
 * documented before researching further (the loop's step 1, covering both
 * the curated wiki/ and its own past wiki/bot/ pages), and publish() lets
 * it write a new page itself once something is learned/verified.
 *
 * publish()/edit()/remove() call the *AndSync form of every wiki-store
 * function, the same one POST /api/wiki (the human /app/wiki form) calls --
 * not the plain form, which only writes the file locally. They did not
 * always: the first version called publishWikiPage()/deleteWikiPage()
 * directly, so a page the bot published landed on disk correctly and was
 * NEVER committed or pushed. Nothing failed and nothing reported an error --
 * there was no reason to report, because sync was never attempted. A bot
 * page and a human page went through completely different code paths while
 * this doc comment claimed they were "exactly" the same one.
 */
export class WikiPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  async list(): Promise<WikiPageSummary[]> {
    return listWikiPages();
  }

  async read(name: string): Promise<WikiPage | null> {
    if (typeof name !== "string") {
      throw new Error("Security Error: Page name must be a string.");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("Security Error: Page name cannot be empty.");
    }
    if (name.length > 100) {
      throw new Error("Security Error: Page name exceeds maximum length limit of 100 characters.");
    }

    return readWikiPage(name);
  }

  /** The AI publishing a page "with itself" -- no human in the loop required. */
  async publish(name: string, title: string, content: string): Promise<{ page: WikiPage; sync: StoreSyncResult }> {
    if (typeof name !== "string") {
      throw new Error("Security Error: Page name must be a string.");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("Security Error: Page name cannot be empty.");
    }
    if (name.length > 100) {
      throw new Error("Security Error: Page name exceeds maximum length limit of 100 characters.");
    }

    if (typeof title !== "string") {
      throw new Error("Security Error: Page title must be a string.");
    }
    if (!title || title.trim().length === 0) {
      throw new Error("Security Error: Page title cannot be empty.");
    }
    if (title.length > 200) {
      throw new Error("Security Error: Page title exceeds maximum length limit of 200 characters.");
    }

    if (typeof content !== "string") {
      throw new Error("Security Error: Page content must be a string.");
    }
    if (!content || content.trim().length === 0) {
      throw new Error("Security Error: Page content cannot be empty.");
    }
    if (content.length > 100000) {
      throw new Error("Security Error: Page content exceeds maximum length limit of 100,000 characters.");
    }

    return publishWikiPageAndSync(name, title, content);
  }

  /**
   * Same underlying call as publish() -- publishWikiPageAndSync() already
   * overwrites a same-named wiki/bot/*.md file unconditionally -- but
   * requires the page to already exist first, so an "edit" can't silently
   * turn into creating a brand-new page from a typo'd name, and can't
   * touch a curated wiki/ page (publishWikiPageAndSync() already refuses
   * that on its own, but the error there is generic; this one names the
   * actual mistake).
   */
  async edit(name: string, title: string, content: string): Promise<{ page: WikiPage; sync: StoreSyncResult }> {
    const existing = await this.read(name);
    if (!existing) {
      throw new WikiNameError(`No existing page named "${name}" to edit -- use publish() to create a new one.`);
    }
    if (existing.source !== "bot") {
      throw new WikiNameError(`"${name}" is a curated wiki page and can't be edited here.`);
    }
    return publishWikiPageAndSync(name, title, content);
  }

  /** deleteWikiPage() already refuses a curated wiki/ name; deleteWikiPageAndSync() forwards to it and then propagates the removal, so a later `git pull` cannot resurrect a page this just deleted. */
  async remove(name: string): Promise<StoreSyncResult> {
    return deleteWikiPageAndSync(name);
  }

  /**
   * Deterministic, local keyword-overlap search over every page's title +
   * description (both curated wiki/ and self-authored wiki/bot/) -- no
   * embeddings service, the same overlapScore() pattern SkillLibrary.
   * search() (models && skills/core/skill-library.ts) already uses for
   * skills. "wiki search" had no implementation at all before this --
   * list()/read() let a caller browse by exact name, but there was no way
   * to actually find a relevant page by topic.
   */
  async search(query: string, topK = 5): Promise<Array<{ page: WikiPageSummary; score: number }>> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const pages = await this.list();
    const hits: Array<{ page: WikiPageSummary; score: number }> = [];
    for (const page of pages) {
      const docTokens = tokenize(`${page.title} ${page.description}`);
      const docSet = new Set(docTokens);
      const matches = queryTokens.filter(t => docSet.has(t)).length;
      const score = matches / queryTokens.length;
      if (score > 0) hits.push({ page, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = String(message).trim();

    // wiki list
    if (/^wiki\s+list\b/i.test(input)) {
      const pages = await this.list();
      if (pages.length === 0) return `[Wiki] No pages yet.`;
      return `[Wiki] ${pages.length} page(s): ${pages.map(p => p.title || p.name).join(", ")}`;
    }

    // wiki search <query>
    const searchMatch = input.match(/^wiki\s+search\s+(.+)$/i);
    if (searchMatch?.[1]) {
      const hits = await this.search(searchMatch[1]);
      if (hits.length === 0) return `[Wiki] No pages matching "${searchMatch[1]}".`;
      return `[Wiki] ${hits.length} match(es): ${hits.map(h => `${h.page.title || h.page.name} (${Math.round(h.score * 100)}%)`).join(", ")}`;
    }

    // wiki read <name>
    const readMatch = input.match(/^wiki\s+read\s+(\S+)/i);
    if (readMatch?.[1]) {
      const page = await this.read(readMatch[1]);
      if (!page) return `[Wiki] No page named "${readMatch[1]}".`;
      return `[Wiki] ${page.title}: ${page.description || page.content.slice(0, 200)}`;
    }

    // wiki publish "<name>" "<title>": <content...>
    const publishMatch = input.match(/^wiki\s+publish\s+"([^"]+)"\s+"([^"]+)"\s*:\s*([\s\S]+)$/i);
    if (publishMatch) {
      const [, name, title, content] = publishMatch;
      try {
        const { page, sync } = await this.publish(name, title, content);
        return `[Wiki] Published "${page.title}" to wiki/bot/${page.name}.md. ${describeSync(sync)}`;
      } catch (err) {
        const detail = err instanceof WikiNameError ? err.message : "Failed to publish.";
        return `[Wiki] ${detail}`;
      }
    }

    // wiki edit "<name>" "<title>": <content...>
    const editMatch = input.match(/^wiki\s+edit\s+"([^"]+)"\s+"([^"]+)"\s*:\s*([\s\S]+)$/i);
    if (editMatch) {
      const [, name, title, content] = editMatch;
      try {
        const { page, sync } = await this.edit(name, title, content);
        return `[Wiki] Saved changes to "${page.title}" (wiki/bot/${page.name}.md). ${describeSync(sync)}`;
      } catch (err) {
        const detail = err instanceof WikiNameError ? err.message : "Failed to save changes.";
        return `[Wiki] ${detail}`;
      }
    }

    // wiki delete <name>
    const deleteMatch = input.match(/^wiki\s+delete\s+(\S+)/i);
    if (deleteMatch?.[1]) {
      const name = deleteMatch[1];
      try {
        const sync = await this.remove(name);
        return `[Wiki] Deleted wiki/bot/${name}.md. ${describeSync(sync)}`;
      } catch (err) {
        const detail = err instanceof WikiNameError ? err.message : "Failed to delete.";
        return `[Wiki] ${detail}`;
      }
    }

    return null;
  }
}
