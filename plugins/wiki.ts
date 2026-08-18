import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { listWikiPages, readWikiPage, publishWikiPage, WikiNameError, type WikiPageSummary, type WikiPage } from "../models && skills/core/wiki-store.js";

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
    return readWikiPage(name);
  }

  /** The AI publishing a page "with itself" -- no human in the loop required. */
  async publish(name: string, title: string, content: string): Promise<WikiPage> {
    return publishWikiPage(name, title, content);
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
        return `[Wiki] Published "${page.title}" to wiki/${page.name}.md.`;
      } catch (err) {
        const detail = err instanceof WikiNameError ? err.message : "Failed to publish.";
        return `[Wiki] ${detail}`;
      }
    }

    return null;
  }
}
