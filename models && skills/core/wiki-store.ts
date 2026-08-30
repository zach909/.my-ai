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
 *                   human using the /app/store "New Page" form both publish
 *                   here, through the same function -- neither one can
 *                   write into the curated collection.
 *
 * listWikiPages()/readWikiPage() merge both collections and tag every page
 * with which one it came from, so callers (the /app/store UI) can render
 * them as two visibly distinct sections instead of one undifferentiated
 * list.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syncStorePaths, type StoreSyncResult } from "./store-sync.js";

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

function backupsDir(name: string): string {
  return path.join(botWikiDir(), ".backups", name);
}

/**
 * Snapshot a bot-published page's current on-disk content before it's about
 * to be overwritten or deleted. wiki/bot/ had no backup/versioning at all --
 * publishWikiPage()'s overwrite and deleteWikiPage()'s unlink were both
 * unconditional, permanent, and unrecoverable. Now that wiki reads are
 * exempt from the server's remote-access password (interface/web-server.ts,
 * "Public Shared AI Knowledge Database" -- bot-published content is meant
 * to be openly readable), losing it to an accidental overwrite/delete is a
 * real, higher-stakes risk than when it was loopback-only. No-op if the
 * page doesn't exist yet -- nothing to back up for a brand-new page.
 */
function backupBeforeChange(name: string): void {
  const file = path.join(botWikiDir(), `${name}.md`);
  if (!existsSync(file)) return;
  const dir = backupsDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = readFileSync(file, "utf8");
  // Colon-free so the stamp is a valid filename stem on every OS (Windows
  // rejects ':' in filenames); still lexicographically sortable, which is
  // all listWikiBackups() below needs to return oldest-first. Millisecond
  // resolution alone isn't enough -- two edits landing in the same
  // millisecond (a realistic case: a scripted restore immediately
  // followed by another write) would collide on the same filename and
  // silently overwrite one backup with the other. A numeric suffix,
  // incremented until the name is free, guarantees every real backup gets
  // its own file regardless of timing.
  const base = new Date().toISOString().replace(/[:.]/g, "-");
  let stamp = base;
  let suffix = 1;
  while (existsSync(path.join(dir, `${stamp}.md`))) {
    stamp = `${base}-${suffix++}`;
  }
  writeFileSync(path.join(dir, `${stamp}.md`), content, "utf8");
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
 * used by both POST /api/wiki (a human, via the /app/store "New Page" form)
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
  backupBeforeChange(name);
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

/**
 * Remove a bot-published page -- the cleanup half of publish()/edit(),
 * needed the moment a page gets created under the wrong name (an "edit"
 * that couldn't reach the original because the name didn't match exactly,
 * back before this app locked the name field during edit) and needs
 * deleting rather than leaving an orphaned duplicate with no way to remove
 * it. Only ever touches wiki/bot/ -- deleting a curated page is refused
 * with the same message publishing/editing one is, since this function
 * can't distinguish "doesn't exist" from "exists but is curated" without
 * checking, and the curated collection should never be touched by this
 * module regardless of which error message is technically more precise.
 */
export function deleteWikiPage(name: string): void {
  assertSafeName(name);
  if (existsSync(path.join(wikiDir(), `${name}.md`))) {
    throw new WikiNameError(`"${name}" is a curated wiki page and can't be deleted here.`);
  }
  const file = path.join(botWikiDir(), `${name}.md`);
  if (!existsSync(file)) {
    throw new WikiNameError(`No bot-published page named "${name}" to delete.`);
  }
  backupBeforeChange(name);
  unlinkSync(file);
}

export interface WikiBackupSummary {
  name: string;
  /** The ISO-ish stamp used as the backup's filename stem -- pass back into readWikiBackup()/restoreWikiBackup(). */
  timestamp: string;
}

const SAFE_TIMESTAMP = /^[0-9A-Za-z-]+$/;

/** Every backed-up snapshot of a bot-published page, oldest first. Empty for a page with no backups (never edited/deleted, or never existed). */
export function listWikiBackups(name: string): WikiBackupSummary[] {
  assertSafeName(name);
  const dir = backupsDir(name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name, timestamp: f.slice(0, -3) }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Raw markdown of one backed-up snapshot, or null if that page/timestamp has no backup. */
export function readWikiBackup(name: string, timestamp: string): string | null {
  assertSafeName(name);
  if (!SAFE_TIMESTAMP.test(timestamp)) {
    throw new WikiNameError(`"${timestamp}" is not a valid backup timestamp.`);
  }
  const file = path.join(backupsDir(name), `${timestamp}.md`);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

/**
 * Restore a bot-published page from one of its own backups. Goes back
 * through publishWikiPage(), which itself calls backupBeforeChange() first
 * -- so restoring is never itself an unrecoverable action: the content
 * being replaced by the restore gets its own new backup snapshot too.
 */
export function restoreWikiBackup(name: string, timestamp: string): WikiPage {
  const raw = readWikiBackup(name, timestamp);
  if (raw === null) {
    throw new WikiNameError(`No backup of "${name}" at "${timestamp}".`);
  }
  const { title } = extractWikiSummary(raw);
  return publishWikiPage(name, title || name, raw);
}


/**
 * Publish a wiki page and actually share it.
 *
 * publishWikiPage() writes into `wiki/bot/` and stops, which leaves the page
 * exactly as device-local as not publishing it -- it dies with the machine
 * and no other clone ever sees it. This commits and pushes the page so a
 * `git pull` anywhere else picks it up, and reports honestly when it could
 * not (see store-sync.ts).
 */
export async function publishWikiPageAndSync(
  name: string,
  title: string,
  content: string,
): Promise<{ page: WikiPage; sync: StoreSyncResult }> {
  const page = publishWikiPage(name, title, content);
  const sync = await syncStorePaths(
    [path.join(botWikiDir(), `${name}.md`)],
    `wiki: publish ${name}`,
    { storeDir: wikiDir() },
  );
  return { page, sync };
}

/** Delete a bot-published page and propagate the removal, so a pull cannot resurrect it. */
export async function deleteWikiPageAndSync(name: string): Promise<StoreSyncResult> {
  const file = path.join(botWikiDir(), `${name}.md`);
  deleteWikiPage(name);
  return syncStorePaths([file], `wiki: remove ${name}`, { storeDir: wikiDir() });
}
