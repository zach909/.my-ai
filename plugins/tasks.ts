import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../models && skills/core/user-context.js";

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: number;
  createdAt: number;
  tags: string[];
}

// Per person: the owner's tasks stay in ~/.neuroclaw/tasks.json, everyone else has their own.
const storageDir = (): string => dataDir();
const storagePath = (): string => join(dataDir(), "tasks.json");

export class TasksPlugin extends BasePlugin {
  private tasks: Task[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  async onActivate(context: any): Promise<void> {
    await super.onActivate(context);
    try {
      if (!existsSync(storageDir())) {
        mkdirSync(storageDir(), { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(storageDir(), 0o700);
        if (existsSync(storagePath())) {
          chmodSync(storagePath(), 0o600);
        }
      }
    } catch { }
    this.load();
  }

  async create(title: string, opts?: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task> {
    if (typeof title !== "string" || !title.trim() || title.length > 200) {
      throw new Error("Security Error: Invalid task title.");
    }
    if (opts && typeof opts === "object") {
      if (opts.description !== undefined && (typeof opts.description !== "string" || opts.description.length > 2000)) {
        throw new Error("Security Error: Invalid task description.");
      }
      if (opts.priority !== undefined && !["low", "medium", "high"].includes(opts.priority)) {
        throw new Error("Security Error: Invalid task priority.");
      }
      if (opts.tags !== undefined && (!Array.isArray(opts.tags) || opts.tags.some(t => typeof t !== "string" || t.length > 50))) {
        throw new Error("Security Error: Invalid task tags.");
      }
    }
    this.load(); // this person's tasks, not whoever used the plugin last
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      title, completed: false, priority: "medium", createdAt: Date.now(),
      tags: [], ...opts,
    };
    this.tasks.push(task); this.save(); return task;
  }

  async list(filter?: { completed?: boolean; priority?: string; tag?: string }): Promise<Task[]> {
    if (filter && typeof filter === "object") {
      if (filter.priority !== undefined && !["low", "medium", "high"].includes(filter.priority)) {
        throw new Error("Security Error: Invalid filter priority.");
      }
      if (filter.tag !== undefined && (typeof filter.tag !== "string" || filter.tag.length > 50)) {
        throw new Error("Security Error: Invalid filter tag.");
      }
    }
    this.load();
    let result = [...this.tasks];
    if (filter?.completed !== undefined) result = result.filter(t => t.completed === filter.completed);
    if (filter?.priority) result = result.filter(t => t.priority === filter.priority);
    if (filter?.tag) result = result.filter(t => t.tags.includes(filter.tag!));
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async complete(id: string): Promise<boolean> {
    this.validateId(id);
    this.load();
    const t = this.tasks.find(task => task.id === id);
    if (!t) return false;
    t.completed = true; this.save(); return true;
  }

  async remove(id: string): Promise<boolean> {
    this.validateId(id);
    this.load();
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1); this.save(); return true;
  }

  private validateId(id: string): void {
    if (typeof id !== "string" || !id.trim() || id.length > 100) {
      throw new Error("Security Error: Invalid task ID.");
    }
  }

  /**
   * This person's tasks. A person with no file yet has NO tasks: leaving the list
   * as it was would hand them whatever the last person using this one plugin
   * instance had in memory.
   */
  private load(): void {
    try {
      this.tasks = existsSync(storagePath()) ? JSON.parse(readFileSync(storagePath(), "utf-8")) : [];
    } catch {
      this.tasks = [];
    }
  }

  private save(): void {
    try {
      if (!existsSync(storageDir())) {
        mkdirSync(storageDir(), { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(storageDir(), 0o700);
      }
      writeFileSync(storagePath(), JSON.stringify(this.tasks, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(storagePath(), 0o600);
      }
    } catch { }
  }
}
