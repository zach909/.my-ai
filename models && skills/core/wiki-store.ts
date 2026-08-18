/**
 * Wiki Store — reads and writes wiki pages for both interface/web-server.ts's
 * GET/POST /api/wiki routes and plugins/wiki.ts's WikiPlugin, so there is
 * exactly one place that knows the page format, the safe-name rule, and the
 * title/description extraction convention instead of that logic drifting
 * between an HTTP handler and a plugin (the same class of bug fixed
 * repeatedly elsewhere in this repo when two implementations of the same
 * thing existed side by side -- see wiki/Bots.md).
 *
 * Two separate collections, deliberately not one flat directory:
 *
 *   wiki/          the curated, hand-written wiki shipped with the repo
 *                   (Home, Builder, Bots, ...) -- source: "human". Read-only
 *                   from this module; nothing here ever writes into wiki/
 *                   directly, so an AI-published page can never silently
 *                   overwrite or sit indistinguishable from a carefully
 *                   reviewed spec.
 *   wiki/bot/       pages published through publishWikiPage() -- source:
 *                   "bot". This is the concrete implementation of
 *                   docs/SKILL_ACQUISITION_LOOP.md's "push the wiki page"
 *                   step: the AI (via plugins/wiki.ts's WikiPlugin) and a
 *                   human using the /app/wiki "New Page" form both publish
 *                   here, through the same function -- neither one can
 *                   write into the curated collection.
 *
 * listWikiPages()/readWikiPage() merge both collections and tag every page
 * with which one it came from, so callers (the /app/wiki UI) can render
 * them as two visibly distinct sections instead of one undifferentiated
 * list.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Matches the same rule interface/web-server.ts's GET /api/wiki/:name
// already enforced: a bare filename stem, no '.' or '/' at all, so this can
// never escape either directory (rules out both '..' traversal and an
// absolute-path override).
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export type WikiSource = "human" | "bot";

export interface WikiPageSummary {
  name: string;
  title: string;
  description: string;
  source: WikiSource;
}

export interface WikiPage extends WikiPageSummary {
  content: string;
}

export class WikiNameError extends Error {}

function wikiDir(): string {
  return path.resolve(process.cwd(), "wiki");
}

function botWikiDir(): string {
  return path.join(wikiDir(), "bot");
}

/** Pull a title and one-line description out of a page's raw markdown -- every page in wiki/*.md and wiki/bot/*.md follows the `# Title` + paragraph shape this extracts. */
export function extractWikiSummary(raw: string): { title: string; description: string } {
  const lines = raw.split("\n");
  let title = "";
  let description = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!title) {
      const h1 = trimmed.match(/^#\s+(.+)$/);
      if (h1) title = h1[1].trim();
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.startsWith("```")) continue;
    description = trimmed;
    break;
  }
  return { title, description };
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new WikiNameError(
      `"${name}" is not a valid wiki page name -- letters, digits, '-', and '_' only (no '.' or '/').`
    );
  }
}

function listDir(dir: string, source: WikiSource): WikiPageSummary[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const name = f.slice(0, -3);
      const raw = readFileSync(path.join(dir, f), "utf8");
      return { name, source, ...extractWikiSummary(raw) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The curated collection followed by the bot-published one -- two groups, not interleaved, so a caller that doesn't re-group by `source` still shows curated pages first. */
export function listWikiPages(): WikiPageSummary[] {
  return [...listDir(wikiDir(), "human"), ...listDir(botWikiDir(), "bot")];
}

/** Checks the curated collection first, then the bot-published one -- a curated page's name always wins if the two ever collide. */
export function readWikiPage(name: string): WikiPage | null {
  assertSafeName(name);
  const humanFile = path.join(wikiDir(), `${name}.md`);
  if (existsSync(humanFile)) {
    const content = readFileSync(humanFile, "utf8");
    return { name, source: "human", content, ...extractWikiSummary(content) };
  }
  const botFile = path.join(botWikiDir(), `${name}.md`);
  if (existsSync(botFile)) {
    const content = readFileSync(botFile, "utf8");
    return { name, source: "bot", content, ...extractWikiSummary(content) };
  }
  return null;
}

/**
 * Create or overwrite a page in the bot-published collection (wiki/bot/) --
 * used by both POST /api/wiki (a human, via the /app/wiki "New Page" form)
 * and WikiPlugin.publish() (the AI itself, as a plugin action). Neither
 * caller can reach the curated wiki/ directory through this function; that
 * collection only changes through a real commit to the repo.
 *
 * `content` is written as-is if it already starts with a `# Title` heading;
 * otherwise one is prepended from `title` so every published page still
 * matches the `# Title` convention listWikiPages()/extractWikiSummary()
 * depend on.
 */
export function publishWikiPage(name: string, title: string, content: string): WikiPage {
  assertSafeName(name);
  if (!title.trim()) throw new WikiNameError("A wiki page needs a non-empty title.");
  if (!content.trim()) throw new WikiNameError("A wiki page needs non-empty content.");
  // Without this check, publishing under a name that collides with a
  // curated page would still succeed -- it just writes an unreachable file
  // into wiki/bot/, since readWikiPage() always resolves that name to the
  // curated page first (see its own doc comment). That's a silent no-op
  // from the caller's point of view: a "publish"/"edit" that reports
  // success but is never actually visible anywhere. Fail loudly instead.
  if (existsSync(path.join(wikiDir(), `${name}.md`))) {
    throw new WikiNameError(
      `"${name}" is already a curated wiki page and can't be overwritten here -- pick a different name.`
    );
  }
  const dir = botWikiDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const hasHeading = /^\s*#\s+.+/.test(content);
  const draft = hasHeading ? content : `# ${title.trim()}\n\n${content}`;
  // Write and return the exact same string -- previously this wrote
  // draft+'\n' to disk but returned `draft` (without it) as `content`, so a
  // publish response's content didn't byte-for-byte match what a follow-up
  // GET /api/wiki/:name would return for the same page.
  const body = draft.endsWith("\n") ? draft : `${draft}\n`;
  const file = path.join(dir, `${name}.md`);
  writeFileSync(file, body, "utf8");
  const { title: extractedTitle, description } = extractWikiSummary(body);
  return { name, source: "bot", title: extractedTitle || title.trim(), description, content: body };
}
