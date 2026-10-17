/**
 * Folders inside folders, with items that can sit in two places at once.
 *
 * Everything that gets organised -- chats, wiki pages, projects, and the
 * folders themselves -- is a node in one shared tree. A folder can hold any of
 * them, folders included, so folders nest as deep as MAX_DEPTH.
 *
 * ── The half zone ─────────────────────────────────────────────────────
 *
 * A node does not sit in ONE folder. It has up to MAX_PLACEMENTS placements,
 * each a folder and a weight from just above 0 to 1: how much of it belongs
 * there. The weights are independent, so they do not have to add up to 1:
 *
 *     a chat about wiring a sensor:   Electronics 0.7,  Code 0.4
 *     a page that is fully both:       Physics 1,        Chemistry 1
 *
 * "Mostly here, a bit there" and "completely in both" are both just weights.
 * An item with no placement is not lost: it is unsorted, and shows up there.
 *
 * Because a folder is a node too, a folder can sit half in two parents, so this
 * is a graph rather than a plain tree. Placing a folder inside itself, or
 * anywhere beneath itself, is refused: that would make a loop with no top.
 *
 * Who decides where things go is not this file's business. It stores and
 * validates; folder-organizer.ts asks the agent.
 *
 * State is per-device: ~/.neuroclaw/folders.json (override CORONA_FOLDERS_FILE).
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { dataFile } from "./user-context.js";


export const ROOT = "root";
export const MAX_PLACEMENTS = 3;
export const MAX_DEPTH = 5;
export const MAX_NODES = 5000;
/** Below this an item is not really "in" a folder at all. */
export const MIN_WEIGHT = 0.1;
const MAX_VIEW_DEPTH = 6;

export type NodeKind = "folder" | "chat" | "wiki" | "project";

export interface Placement {
  /** A folder's id, or ROOT. */
  parent: string;
  /** How much of the node belongs here: above 0, at most 1. Weights are independent of each other. */
  weight: number;
}

export interface TreeNode {
  id: string;
  kind: NodeKind;
  title: string;
  /** What this stands for: a chat's id, a wiki page's name, a project's id. A folder's is its own id. */
  ref: string;
  placements: Placement[];
  /** When it was last put somewhere, or null if it never has been. */
  placedAt: number | null;
  /** When the agent was last asked about it, so a muddled reply is not retried in a loop. */
  askedAt: number;
  createdAt: number;
}

export interface TreeCtx {
  file?: string;
  now?: () => number;
}

export function foldersFile(): string {
  return process.env.CORONA_FOLDERS_FILE
    ? path.resolve(process.env.CORONA_FOLDERS_FILE)
    : dataFile("folders.json");
}

const fileOf = (c: TreeCtx): string => c.file ?? foldersFile();
const nowOf = (c: TreeCtx): number => (c.now ?? Date.now)();
const round = (n: number): number => Math.round(n * 1000) / 1000;

export class TreeError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

// ── Names ──────────────────────────────────────────────────────────────

/** One folder name, made safe to show and store. Null if it cannot be one. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length > 40 || !/^[A-Za-z0-9][A-Za-z0-9 &_().,'-]*$/.test(n)) return null;
  return n;
}

/** A path such as "Science/Physics", as its folder names. Null if any part is unusable or it is too deep. */
export function parsePath(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(/\s*(?:\/|>)\s*/).filter(p => p.length > 0);
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null;
  const names = parts.map(cleanName);
  return names.every((n): n is string => n !== null) ? names : null;
}

// ── Reading and writing ────────────────────────────────────────────────

function cleanNode(raw: unknown): TreeNode | null {
  const n = raw as Partial<TreeNode> | null;
  if (!n || typeof n !== "object" || typeof n.id !== "string" || n.id.length > 160) return null;
  const kind: NodeKind | null = n.kind === "folder" || n.kind === "chat" || n.kind === "wiki" || n.kind === "project" ? n.kind : null;
  if (!kind || typeof n.title !== "string" || typeof n.ref !== "string") return null;
  const placements: Placement[] = [];
  for (const p of Array.isArray(n.placements) ? n.placements : []) {
    if (p && typeof p.parent === "string" && typeof p.weight === "number" && Number.isFinite(p.weight) && p.weight > 0 && p.weight <= 1 && placements.length < MAX_PLACEMENTS) {
      if (!placements.some(x => x.parent === p.parent)) placements.push({ parent: p.parent, weight: round(p.weight) });
    }
  }
  return {
    id: n.id, kind, title: n.title.slice(0, 200), ref: n.ref.slice(0, 160), placements,
    placedAt: typeof n.placedAt === "number" ? n.placedAt : null,
    askedAt: typeof n.askedAt === "number" ? n.askedAt : 0,
    createdAt: typeof n.createdAt === "number" ? n.createdAt : 0,
  };
}

export function loadTree(file = foldersFile()): TreeNode[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { nodes?: unknown };
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(cleanNode).filter((n): n is TreeNode => n !== null).slice(0, MAX_NODES);
    // A placement that points at a folder that is gone puts the node back in the unsorted pile.
    const ids = new Set(nodes.map(n => n.id));
    for (const n of nodes) n.placements = n.placements.filter(p => p.parent === ROOT || (ids.has(p.parent) && p.parent !== n.id));
    return nodes;
  } catch {
    return [];
  }
}

function saveTree(nodes: TreeNode[], file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { nodes });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Not every filesystem has modes.
  }
}

const byId = (nodes: TreeNode[], id: string): TreeNode | undefined => nodes.find(n => n.id === id);

/** Whether `ancestor` is somewhere above `node`, by any route. */
function isAbove(nodes: TreeNode[], ancestor: string, node: string, seen = new Set<string>()): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  const n = byId(nodes, node);
  if (!n) return false;
  return n.placements.some(p => p.parent === ancestor || (p.parent !== ROOT && isAbove(nodes, ancestor, p.parent, seen)));
}

// ── Making folders ─────────────────────────────────────────────────────

function folderUnder(nodes: TreeNode[], parent: string, name: string): TreeNode | undefined {
  return nodes.find(n => n.kind === "folder" && n.title.toLowerCase() === name.toLowerCase() && n.placements.some(p => p.parent === parent));
}

/** The folder at this path, making any that are missing. Each new folder starts fully inside the one above it. */
function ensurePath(nodes: TreeNode[], names: string[], now: number): TreeNode {
  let parent = ROOT;
  let node: TreeNode | undefined;
  for (const name of names) {
    node = folderUnder(nodes, parent, name);
    if (!node) {
      if (nodes.length >= MAX_NODES) throw new TreeError(`At most ${MAX_NODES} things can be organised.`);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "folder";
      node = { id: `folder:${slug}-${randomBytes(3).toString("hex")}`, kind: "folder", title: name, ref: "", placements: [{ parent, weight: 1 }], placedAt: now, askedAt: 0, createdAt: now };
      node.ref = node.id;
      nodes.push(node);
    }
    parent = node.id;
  }
  return node!;
}

// ── Placing things ─────────────────────────────────────────────────────

export interface ItemRef {
  kind: Exclude<NodeKind, "folder">;
  ref: string;
  title: string;
}

export interface PlaceSpec {
  path: string[];
  weight: number;
}

export const itemId = (kind: NodeKind, ref: string): string => `${kind}:${ref}`;

function checkSpecs(specs: PlaceSpec[]): PlaceSpec[] {
  if (!Array.isArray(specs) || specs.length > MAX_PLACEMENTS) throw new TreeError(`Something can be in at most ${MAX_PLACEMENTS} places at once.`);
  const out: PlaceSpec[] = [];
  for (const s of specs) {
    if (!s || !Array.isArray(s.path) || s.path.length === 0 || s.path.length > MAX_DEPTH || !s.path.every(p => cleanName(p) !== null)) throw new TreeError("A place is a path of folder names.");
    if (typeof s.weight !== "number" || !Number.isFinite(s.weight) || s.weight <= 0 || s.weight > 1) throw new TreeError("How much belongs in a place is above 0 and at most 1.");
    if (s.weight >= MIN_WEIGHT) out.push({ path: s.path.map(p => cleanName(p)!), weight: round(s.weight) });
  }
  return out;
}

/**
 * Put an item in up to MAX_PLACEMENTS places, replacing wherever it was. Folders
 * on the paths are made if they do not exist. Two specs that land in the same
 * folder keep the larger weight. An empty list is allowed and means unsorted.
 */
export function placeItem(item: ItemRef, specs: PlaceSpec[], ctx: TreeCtx = {}): TreeNode {
  const file = fileOf(ctx);
  const now = nowOf(ctx);
  const clean = checkSpecs(specs);
  const nodes = loadTree(file);
  let node = byId(nodes, itemId(item.kind, item.ref));
  if (!node) {
    if (nodes.length >= MAX_NODES) throw new TreeError(`At most ${MAX_NODES} things can be organised.`);
    node = { id: itemId(item.kind, item.ref), kind: item.kind, title: item.title.slice(0, 200), ref: item.ref.slice(0, 160), placements: [], placedAt: null, askedAt: 0, createdAt: now };
    nodes.push(node);
  }
  node.title = item.title.slice(0, 200);
  const placements: Placement[] = [];
  for (const spec of clean) {
    const folder = ensurePath(nodes, spec.path, now);
    const have = placements.find(p => p.parent === folder.id);
    if (have) have.weight = Math.max(have.weight, spec.weight);
    else placements.push({ parent: folder.id, weight: spec.weight });
  }
  node.placements = placements;
  node.placedAt = now;
  node.askedAt = now;
  saveTree(nodes, file);
  return node;
}

/** Put a folder inside other folders (half in each if you like), refusing anything that would loop. */
export function placeFolder(folderId: string, parents: Array<{ parent: string; weight: number }>, ctx: TreeCtx = {}): TreeNode {
  const file = fileOf(ctx);
  const nodes = loadTree(file);
  const folder = byId(nodes, folderId);
  if (!folder || folder.kind !== "folder") throw new TreeError("No such folder.", 404);
  if (parents.length > MAX_PLACEMENTS) throw new TreeError(`Something can be in at most ${MAX_PLACEMENTS} places at once.`);
  const placements: Placement[] = [];
  for (const p of parents) {
    if (typeof p.weight !== "number" || !Number.isFinite(p.weight) || p.weight <= 0 || p.weight > 1) throw new TreeError("How much belongs in a place is above 0 and at most 1.");
    if (p.parent !== ROOT) {
      const target = byId(nodes, p.parent);
      if (!target || target.kind !== "folder") throw new TreeError("No such folder to put it in.", 404);
      if (p.parent === folderId || isAbove(nodes, folderId, p.parent)) throw new TreeError("A folder cannot go inside itself or anything inside it.");
    }
    if (!placements.some(x => x.parent === p.parent)) placements.push({ parent: p.parent, weight: round(p.weight) });
  }
  folder.placements = placements;
  folder.placedAt = nowOf(ctx);
  saveTree(nodes, file);
  return folder;
}

/** Note that the agent was asked and gave nothing usable, so it is not asked again straight away. */
export function markAsked(item: ItemRef, ctx: TreeCtx = {}): void {
  const file = fileOf(ctx);
  const nodes = loadTree(file);
  const id = itemId(item.kind, item.ref);
  let node = byId(nodes, id);
  if (!node) {
    node = { id, kind: item.kind, title: item.title.slice(0, 200), ref: item.ref.slice(0, 160), placements: [], placedAt: null, askedAt: 0, createdAt: nowOf(ctx) };
    nodes.push(node);
  }
  node.askedAt = nowOf(ctx);
  saveTree(nodes, file);
}

/** Forget items of these kinds whose originals no longer exist, so a deleted chat does not leave a ghost. */
export function pruneMissing(live: Array<{ kind: ItemRef["kind"]; refs: string[] }>, ctx: TreeCtx = {}): number {
  const file = fileOf(ctx);
  const nodes = loadTree(file);
  const kept = nodes.filter(n => {
    const group = live.find(g => g.kind === n.kind);
    return !group || group.refs.includes(n.ref);
  });
  const removed = nodes.length - kept.length;
  if (removed > 0) saveTree(kept, file);
  return removed;
}

// ── Looking ────────────────────────────────────────────────────────────

/** Every route from the top down to this node, each with how much of it lies along that route (the weights multiply). */
export function pathsOf(nodes: TreeNode[], id: string, depth = 0): Array<{ path: string[]; weight: number }> {
  const n = byId(nodes, id);
  if (!n || depth > MAX_VIEW_DEPTH) return [];
  const out: Array<{ path: string[]; weight: number }> = [];
  for (const p of n.placements) {
    if (p.parent === ROOT) {
      out.push({ path: n.kind === "folder" ? [n.title] : [], weight: p.weight });
      continue;
    }
    for (const above of pathsOf(nodes, p.parent, depth + 1)) {
      out.push({ path: n.kind === "folder" ? [...above.path, n.title] : above.path, weight: round(above.weight * p.weight) });
    }
  }
  return out;
}

export interface ViewNode {
  id: string;
  kind: NodeKind;
  title: string;
  /** How much of this node belongs here, in this spot. */
  weight: number;
  children: ViewNode[];
}

export interface TreeView {
  /** What is at the top level, with everything beneath it. A half-placed item appears under each of its folders. */
  top: ViewNode[];
  /** Things the agent has not placed. */
  unsorted: Array<{ id: string; kind: NodeKind; title: string }>;
  counts: { folders: number; items: number; split: number };
}

/** The whole thing as a nested view for the page. */
export function viewTree(ctx: TreeCtx = {}): TreeView {
  const nodes = loadTree(fileOf(ctx));
  const children = new Map<string, Array<{ node: TreeNode; weight: number }>>();
  for (const n of nodes) for (const p of n.placements) {
    const list = children.get(p.parent) ?? [];
    list.push({ node: n, weight: p.weight });
    children.set(p.parent, list);
  }
  const build = (parent: string, depth: number, trail: string[]): ViewNode[] =>
    (children.get(parent) ?? [])
      .filter(c => !trail.includes(c.node.id))
      .sort((a, b) => (a.node.kind === "folder" ? 0 : 1) - (b.node.kind === "folder" ? 0 : 1) || b.weight - a.weight || a.node.title.localeCompare(b.node.title))
      .map(c => ({
        id: c.node.id, kind: c.node.kind, title: c.node.title, weight: c.weight,
        children: depth >= MAX_VIEW_DEPTH ? [] : build(c.node.id, depth + 1, [...trail, c.node.id]),
      }));
  const items = nodes.filter(n => n.kind !== "folder");
  return {
    top: build(ROOT, 0, []),
    unsorted: items.filter(n => n.placements.length === 0).map(n => ({ id: n.id, kind: n.kind, title: n.title })),
    counts: { folders: nodes.length - items.length, items: items.length, split: items.filter(n => n.placements.length > 1).length },
  };
}

/** Every folder as a full path, for showing the agent what already exists. */
export function folderPaths(ctx: TreeCtx = {}, limit = 60): string[] {
  const nodes = loadTree(fileOf(ctx));
  const paths = new Set<string>();
  for (const f of nodes.filter(n => n.kind === "folder")) for (const p of pathsOf(nodes, f.id)) paths.add(p.path.join("/"));
  return [...paths].filter(Boolean).sort().slice(0, limit);
}

/** The most recent things that were filed, as "title -> Path 70, Other 30", so the agent can stay consistent with itself. */
export function recentFilings(ctx: TreeCtx = {}, n = 5): string[] {
  const nodes = loadTree(fileOf(ctx));
  return nodes
    .filter(x => x.kind !== "folder" && x.placements.length > 0 && x.placedAt !== null)
    .sort((a, b) => (b.placedAt ?? 0) - (a.placedAt ?? 0))
    .slice(0, n)
    .map(x => `"${x.title.slice(0, 60)}" -> ${pathsOf(nodes, x.id).map(p => `${p.path.join("/")} ${Math.round(p.weight * 100)}`).join(", ")}`);
}

export function getNode(id: string, ctx: TreeCtx = {}): TreeNode | null {
  return byId(loadTree(fileOf(ctx)), id) ?? null;
}

export function listNodes(ctx: TreeCtx = {}): TreeNode[] {
  return loadTree(fileOf(ctx));
}
