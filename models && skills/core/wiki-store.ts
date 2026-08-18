/**
 * Wiki Store — reads and writes the real wiki/*.md pages that both
 * interface/web-server.ts's GET/POST /api/wiki routes and plugins/wiki.ts's
 * WikiPlugin use, so there is exactly one place that knows the page format,
 * the safe-name rule, and the title/description extraction convention
 * instead of that logic drifting between an HTTP handler and a plugin (the
 * same class of bug fixed repeatedly elsewhere in this repo when two
 * implementations of the same thing existed side by side -- see
 * wiki/Bots.md).
 *
 * This is the concrete implementation of docs/SKILL_ACQUISITION_LOOP.md's
 * "push the wiki page" step: publishWikiPage() is what lets the AI itself
 * -- not just a human through the browser -- write a new wiki/*.md page as
 * part of its own skill-acquisition loop, via plugins/wiki.ts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Matches the same rule interface/web-server.ts's GET /api/wiki/:name
// already enforced: a bare filename stem, no '.' or '/' at all, so this can
// never escape the wiki/ directory (rules out both '..' traversal and an
// absolute-path override).
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export interface WikiPageSummary {
  name: string;
  title: string;
  description: string;
}

export interface WikiPage extends WikiPageSummary {
  content: string;
}

export class WikiNameError extends Error {}

function wikiDir(): string {
  return path.resolve(process.cwd(), "wiki");
}

/** Pull a title and one-line description out of a page's raw markdown -- see extractWikiSummary's original in interface/web-server.ts for the shape every wiki/*.md page follows. */
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

export function listWikiPages(): WikiPageSummary[] {
  const dir = wikiDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const name = f.slice(0, -3);
      const raw = readFileSync(path.join(dir, f), "utf8");
      return { name, ...extractWikiSummary(raw) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function readWikiPage(name: string): WikiPage | null {
  assertSafeName(name);
  const file = path.join(wikiDir(), `${name}.md`);
  if (!existsSync(file)) return null;
  const content = readFileSync(file, "utf8");
  return { name, content, ...extractWikiSummary(content) };
}

/**
 * Create or overwrite a wiki page with real markdown content. Used by both
 * POST /api/wiki (a human, via the /app/wiki "New Page" form) and
 * WikiPlugin.publish() (the AI itself, as a plugin action) -- one code path,
 * so a page published either way behaves identically and shows up
 * immediately in GET /api/wiki since nothing is cached.
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
  const dir = wikiDir();
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
  return { name, title: extractedTitle || title.trim(), description, content: body };
}
