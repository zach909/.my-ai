/**
 * Virtual workspaces: named groups of chat threads inside the shared
 * interface, so a person juggling several conversations at once can switch
 * between named contexts without separate browser windows or monitors.
 *
 * This is a within-app grouping only. It does not touch the operating
 * system's own virtual desktops: there is no cross-platform API this
 * project could drive honestly to switch an OS workspace, so it does not
 * claim to (see docs/PLATFORMS.md, "Unfinished"). What it does is real: a
 * named workspace, its member thread ids, and which one is "active",
 * persisted the same way models && skills/core/chat-history-store.ts
 * persists threads (one JSON file per record).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface Workspace {
  id: string;
  name: string;
  threadIds: string[];
  createdAt: number;
  updatedAt: number;
}

const NAME_MAX = 80;

export class WorkspaceStore {
  private readonly rootDir: string;
  private readonly activeFile: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? join(homedir(), ".neuroclaw", "workspaces");
    this.activeFile = join(this.rootDir, ".active");
  }

  private assertSafeId(id: string): void {
    if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
      throw new Error(`Invalid workspace id "${id}": must not contain path separators or be "." / ".."`);
    }
  }

  private path(id: string): string {
    this.assertSafeId(id);
    return join(this.rootDir, `${id}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true });
  }

  list(): Workspace[] {
    if (!existsSync(this.rootDir)) return [];
    const out: Workspace[] = [];
    for (const entry of readdirSync(this.rootDir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(readFileSync(join(this.rootDir, entry), "utf8")) as Workspace);
      } catch {
        // Skip a corrupted/partial file rather than failing the whole listing.
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Workspace | null {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Workspace;
    } catch {
      return null;
    }
  }

  create(name: string): Workspace {
    this.ensureDir();
    const now = Date.now();
    const workspace: Workspace = {
      id: randomUUID(),
      name: (name || "Untitled workspace").slice(0, NAME_MAX),
      threadIds: [],
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(this.path(workspace.id), JSON.stringify(workspace), "utf8");
    return workspace;
  }

  rename(id: string, name: string): Workspace | null {
    const workspace = this.get(id);
    if (!workspace) return null;
    workspace.name = (name || workspace.name).slice(0, NAME_MAX);
    workspace.updatedAt = Date.now();
    writeFileSync(this.path(id), JSON.stringify(workspace), "utf8");
    return workspace;
  }

  /** Deletes the workspace. Clears it as active if it was. Returns false if it did not exist. */
  delete(id: string): boolean {
    const p = this.path(id);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    if (this.getActiveId() === id) this.setActive(null);
    return true;
  }

  /** Adds or removes one thread from a workspace. A thread may belong to more than one workspace. */
  setThreadMembership(id: string, threadId: string, member: boolean): Workspace | null {
    const workspace = this.get(id);
    if (!workspace) return null;
    const has = workspace.threadIds.includes(threadId);
    if (member && !has) workspace.threadIds.push(threadId);
    if (!member && has) workspace.threadIds = workspace.threadIds.filter((t) => t !== threadId);
    workspace.updatedAt = Date.now();
    writeFileSync(this.path(id), JSON.stringify(workspace), "utf8");
    return workspace;
  }

  getActiveId(): string | null {
    if (!existsSync(this.activeFile)) return null;
    try {
      const id = readFileSync(this.activeFile, "utf8").trim();
      return id || null;
    } catch {
      return null;
    }
  }

  /** Switches which workspace is "current". `null` clears it, back to the default unsorted view. Throws on an unknown id so a UI bug cannot silently point at nothing. */
  setActive(id: string | null): void {
    this.ensureDir();
    if (id === null) {
      writeFileSync(this.activeFile, "", "utf8");
      return;
    }
    if (!this.get(id)) throw new Error(`No workspace "${id}"`);
    writeFileSync(this.activeFile, id, "utf8");
  }
}
