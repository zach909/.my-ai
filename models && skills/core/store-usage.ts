/**
 * When each store item was last needed on THIS device.
 *
 * Auto-offload (store-offload.ts) can only drop what has gone unused, and
 * nothing recorded use: an install had an `installedAt`, a cached payload had
 * a file mtime, and neither says whether the item was touched since. This is
 * that record, kept device-local beside the installed items and never
 * committed -- what one machine uses says nothing about another's.
 *
 * Best-effort by design. Writing a timestamp must never be the reason an
 * install, an activation or a mod apply fails, so every failure is swallowed
 * and the item simply looks a little older than it is.
 *
 * Deliberately imports nothing from store-install or store-fetch: those call
 * markUsed(), and importing back would make a cycle.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";

export interface UsageEntry {
  lastUsedAt: number;
  uses: number;
}

export type UsageMap = Record<string, UsageEntry>;

function usageFile(): string {
  const root = process.env.CORONA_INSTALLED_DIR
    ? path.resolve(process.env.CORONA_INSTALLED_DIR)
    : path.resolve(process.cwd(), "extension-builder", "installed");
  return path.join(root, ".usage.json");
}

const keyOf = (kind: string, name: string): string => `${kind}/${name}`;

export function readUsage(): UsageMap {
  try {
    const parsed = JSON.parse(readFileSync(usageFile(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as UsageMap) : {};
  } catch {
    return {};
  }
}

/** Record that an item was needed just now. */
export function markUsed(kind: string, name: string, at: number = Date.now()): void {
  try {
    const usage = readUsage();
    const key = keyOf(kind, name);
    const prior = usage[key];
    usage[key] = { lastUsedAt: Math.max(at, prior?.lastUsedAt ?? 0), uses: (prior?.uses ?? 0) + 1 };
    const file = usageFile();
    if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, usage);
  } catch {
    // See the header: bookkeeping never gets to break the thing it records.
  }
}

/** When the item was last needed, or null when nothing has ever recorded it. */
export function lastUsedAt(kind: string, name: string): number | null {
  return readUsage()[keyOf(kind, name)]?.lastUsedAt ?? null;
}

/** Drop an item's record, for when the item itself is gone. */
export function forgetUsage(kind: string, name: string): void {
  try {
    const usage = readUsage();
    if (!(keyOf(kind, name) in usage)) return;
    delete usage[keyOf(kind, name)];
    writeJsonAtomic(usageFile(), usage);
  } catch {
    // Same reasoning as markUsed.
  }
}
