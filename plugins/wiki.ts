import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { listWikiPages, readWikiPage, publishWikiPage, deleteWikiPage, WikiNameError, type WikiPageSummary, type WikiPage } from "../models && skills/core/wiki-store.js";

/**
 * WikiPlugin — the AI's own hands for docs/SKILL_ACQUISITION_LOOP.md's
 * "push the wiki page" step: list()/read() let it check what's already
 * documented before researching further (the loop's step 1, covering both
 * the curated wiki/ and its own past wiki/bot/ pages), and publish() lets
 * it write a new page itself once something is learned/verified, exactly
 * like a human would through the /app/wiki "New Page" form -- both paths
 * go through the same models && skills/core/wiki-store.ts and always land
 * in wiki/bot/, tagged source: "bot", never the curated wiki/ collection.
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
  async publish(name: string, title: string, content: string): Promise<WikiPage> {
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

    return publishWikiPage(name, title, content);
  }

  /**
   * Same underlying call as publish() -- publishWikiPage() already
   * overwrites a same-named wiki/bot/*.md file unconditionally -- but
   * requires the page to already exist first, so an "edit" can't silently
   * turn into creating a brand-new page from a typo'd name, and can't
   * touch a curated wiki/ page (publishWikiPage() already refuses that on
   * its own, but the error there is generic; this one names the actual
   * mistake).
   */
  async edit(name: string, title: string, content: string): Promise<WikiPage> {
    const existing = await this.read(name);
    if (!existing) {
      throw new WikiNameError(`No existing page named "${name}" to edit -- use publish() to create a new one.`);
    }
    if (existing.source !== "bot") {
      throw new WikiNameError(`"${name}" is a curated wiki page and can't be edited here.`);
    }
    return publishWikiPage(name, title, content);
  }

  /** deleteWikiPage() already refuses a curated wiki/ name; this just forwards. */
  async remove(name: string): Promise<void> {
    return deleteWikiPage(name);
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = String(message).trim();

    // wiki list
    if (/^wiki\s+list\b/i.test(input)) {
      const pages = await this.list();
      if (pages.length === 0) return `[Wiki] No pages yet.`;
      return `[Wiki] ${pages.length} page(s): ${pages.map(p => p.title || p.name).join(", ")}`;
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
        const page = await this.publish(name, title, content);
        return `[Wiki] Published "${page.title}" to wiki/bot/${page.name}.md.`;
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
        const page = await this.edit(name, title, content);
        return `[Wiki] Saved changes to "${page.title}" (wiki/bot/${page.name}.md).`;
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
        await this.remove(name);
        return `[Wiki] Deleted wiki/bot/${name}.md.`;
      } catch (err) {
        const detail = err instanceof WikiNameError ? err.message : "Failed to delete.";
        return `[Wiki] ${detail}`;
      }
    }

    return null;
  }
}
