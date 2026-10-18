/**
 * The agent files things into folders. No keyword rules, no fixed categories.
 *
 * Chats, wiki pages and projects are shown to the agent one at a time, along
 * with the folders that already exist and the last few things it filed, and it
 * says where the thing belongs and how much of it belongs there:
 *
 *     Science/Physics: 70
 *     Notes: 30
 *
 * That is the half zone (folder-tree.ts): an item can be mostly in one place
 * and partly in another, or fully in both. A path with slashes makes folders
 * inside folders.
 *
 * ── How it learns from this ────────────────────────────────────────────
 *
 * Two ways, both honest about what they are:
 *   - In the moment: each prompt carries the folders so far and the agent's own
 *     recent filings, so it stays consistent with what it already decided.
 *   - In the network: every filing is passed to `learn`, which in the live
 *     system is the mesh's one door for learning (NeuroclawSystem.learnFrom),
 *     so the decision also goes through the Zip Loop like anything else the
 *     mesh learns from.
 *
 * ── When the agent says nothing useful ─────────────────────────────────
 *
 * The reply is read strictly. If it cannot be read as places, the item stays
 * unsorted (not guessed at) and is not asked about again until `minGapMs` has
 * passed. A slow or muddled agent leaves things unsorted; it never loses them.
 */

import type { ChatHistoryStore } from "./chat-history-store.js";
import { listWikiPages } from "./wiki-store.js";
import { loadProjects, type Think } from "./projects.js";
import {
  MAX_PLACEMENTS,
  MIN_WEIGHT,
  folderPaths,
  itemId,
  listNodes,
  markAsked,
  parsePath,
  placeItem,
  pruneMissing,
  recentFilings,
  type ItemRef,
  type PlaceSpec,
  type TreeCtx,
} from "./folder-tree.js";

export const DEFAULT_ASK_GAP_MS = 30 * 60 * 1000;
const EXCERPT = 400;

export interface OrganizeItem extends ItemRef {
  /** What the agent reads to decide. */
  excerpt: string;
}

/** Everything there currently is to organise. */
export function gatherItems(sources: { chats?: ChatHistoryStore | null; wiki?: boolean; projects?: boolean } = {}): OrganizeItem[] {
  const items: OrganizeItem[] = [];
  if (sources.chats) {
    for (const t of sources.chats.listThreads()) {
      const user = t.messages.filter(m => m.role === "user").slice(-2).map(m => m.content).join(" / ");
      items.push({ kind: "chat", ref: t.id, title: t.title || "(untitled)", excerpt: user.slice(0, EXCERPT) });
    }
  }
  if (sources.wiki !== false) {
    for (const p of listWikiPages()) {
      // A project's page is the project itself, which is organised as a project.
      if (p.name.startsWith("projects/")) continue;
      items.push({ kind: "wiki", ref: p.name, title: p.title || p.name, excerpt: (p.description || "").slice(0, EXCERPT) });
    }
  }
  if (sources.projects !== false) {
    for (const p of loadProjects()) items.push({ kind: "project", ref: p.id, title: p.title, excerpt: p.goal.slice(0, EXCERPT) });
  }
  return items;
}

/**
 * Reads the agent's reply as places. One per line, "Path: how much" where how
 * much is 0 to 100 (a trailing % is fine). A line with only a path means all of
 * it. Anything that is not a clean place is ignored, so chatter around the
 * answer does no harm; a place thinner than MIN_WEIGHT is not worth recording.
 */
export function parsePlaces(reply: string): PlaceSpec[] {
  const specs: PlaceSpec[] = [];
  for (const raw of String(reply ?? "").split(/\r?\n/).slice(0, 12)) {
    if (specs.length >= MAX_PLACEMENTS) break;
    const line = raw.replace(/^[\s>*•-]+/, "").replace(/\*\*|__|`/g, "").trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?::|\||–|—|-)\s*(\d{1,3})(?:\.\d+)?\s*%?\s*$/.exec(line);
    const target = m ? parsePath(m[1].replace(/^["'“”]+|["'“”]+$/g, "")) : parsePath(line.replace(/^["'“”]+|["'“”.]+$/g, ""));
    if (!target) continue;
    const weight = m ? Math.min(100, Number(m[2])) / 100 : 1;
    if (weight < MIN_WEIGHT) continue;
    if (/^(unsorted|none|nothing|n\/a)$/i.test(target.join("/"))) continue;
    if (!specs.some(s => s.path.join("/").toLowerCase() === target.join("/").toLowerCase())) specs.push({ path: target, weight });
  }
  return specs;
}

export function placementPrompt(item: OrganizeItem, ctx: TreeCtx): string {
  const folders = folderPaths(ctx);
  const recent = recentFilings(ctx);
  return (
    "You organise a library of chats, wiki pages and projects into folders. Folders can sit inside folders: write a path like Science/Physics.\n" +
    "Something can belong in more than one place. Say how much of it belongs in each, from 0 to 100. The numbers do not have to add up to 100.\n" +
    `Existing folders:\n${folders.length ? folders.map(f => `- ${f}`).join("\n") : "- (none yet)"}\n` +
    (recent.length ? `What you filed recently:\n${recent.map(r => `- ${r}`).join("\n")}\n` : "") +
    `\nItem (${item.kind}): ${item.title}\n${item.excerpt ? `${item.excerpt}\n` : ""}\n` +
    "Reply with one line for each place, like:\nScience/Physics: 70\nNotes: 30\n" +
    "Use an existing folder when one fits. Make a short new one when none does."
  );
}

export interface OrganizeOptions extends TreeCtx {
  /** Most items to ask about in one pass. Each is a trip through the same mesh chat uses. */
  limit?: number;
  /** Least time before an item the agent could not place is asked about again. */
  minGapMs?: number;
  /** Where each decision is passed on to be learned from. */
  learn?: (text: string) => void;
}

export interface OrganizeReport {
  asked: number;
  placed: number;
  split: number;
  left: number;
}

/** The lesson the mesh is given for one filing. Short, because every byte of it goes through the Zip Loop. */
export function lessonFor(item: OrganizeItem, specs: PlaceSpec[]): string {
  const where = specs.map(s => `${s.path.join("/")} ${Math.round(s.weight * 100)}%`).join(" and ");
  return `"${item.title.slice(0, 80)}" (${item.kind}) belongs in ${where}.`;
}

/** File what has not been filed yet. Never throws on the agent's behalf. */
export async function organizeItems(items: OrganizeItem[], think: Think, opts: OrganizeOptions = {}): Promise<OrganizeReport> {
  const now = opts.now ?? Date.now;
  const gap = opts.minGapMs ?? DEFAULT_ASK_GAP_MS;
  const known = new Map(listNodes(opts).map(n => [n.id, n]));
  const due = items
    .filter(i => {
      const n = known.get(itemId(i.kind, i.ref));
      return !n || (n.placements.length === 0 && now() - n.askedAt >= gap);
    })
    .slice(0, opts.limit ?? 3);

  const report: OrganizeReport = { asked: 0, placed: 0, split: 0, left: 0 };
  for (const item of due) {
    report.asked++;
    let reply = "";
    try {
      reply = await think(placementPrompt(item, opts));
    } catch {
      reply = "";
    }
    const specs = parsePlaces(reply);
    if (specs.length === 0) {
      markAsked(item, opts);
      report.left++;
      continue;
    }
    placeItem(item, specs, opts);
    report.placed++;
    if (specs.length > 1) report.split++;
    try {
      opts.learn?.(lessonFor(item, specs));
    } catch {
      // Learning is a bonus; it must never undo a filing.
    }
  }
  return report;
}

/** Drop folder entries for chats, pages and projects that no longer exist. */
export function pruneGone(items: OrganizeItem[], gathered: { chats: boolean; wiki: boolean; projects: boolean }, ctx: TreeCtx = {}): number {
  const live: Array<{ kind: ItemRef["kind"]; refs: string[] }> = [];
  if (gathered.chats) live.push({ kind: "chat", refs: items.filter(i => i.kind === "chat").map(i => i.ref) });
  if (gathered.wiki) live.push({ kind: "wiki", refs: items.filter(i => i.kind === "wiki").map(i => i.ref) });
  if (gathered.projects) live.push({ kind: "project", refs: items.filter(i => i.kind === "project").map(i => i.ref) });
  return pruneMissing(live, ctx);
}
