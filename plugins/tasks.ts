import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

const STORAGE_DIR = join(homedir(), ".neuroclaw");
const STORAGE_FILE = join(STORAGE_DIR, "tasks.json");

export class TasksPlugin extends BasePlugin {
  private tasks: Task[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  async onActivate(context: any): Promise<void> {
    await super.onActivate(context);
    try {
      if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(STORAGE_DIR, 0o700);
        if (existsSync(STORAGE_FILE)) {
          chmodSync(STORAGE_FILE, 0o600);
        }
      }
    } catch { }
    this.load();
  }

  async create(title: string, opts?: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      title, completed: false, priority: "medium", createdAt: Date.now(),
      tags: [], ...opts,
    };
    this.tasks.push(task); this.save(); return task;
  }

  async list(filter?: { completed?: boolean; priority?: string; tag?: string }): Promise<Task[]> {
    let result = [...this.tasks];
    if (filter?.completed !== undefined) result = result.filter(t => t.completed === filter.completed);
    if (filter?.priority) result = result.filter(t => t.priority === filter.priority);
    if (filter?.tag) result = result.filter(t => t.tags.includes(filter.tag!));
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async complete(id: string): Promise<boolean> {
    const t = this.tasks.find(task => task.id === id);
    if (!t) return false;
    t.completed = true; this.save(); return true;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1); this.save(); return true;
  }

  private load(): void { try { if (existsSync(STORAGE_FILE)) this.tasks = JSON.parse(readFileSync(STORAGE_FILE, "utf-8")); } catch { this.tasks = []; } }
  private save(): void {
    try {
      if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(STORAGE_DIR, 0o700);
      }
      writeFileSync(STORAGE_FILE, JSON.stringify(this.tasks, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(STORAGE_FILE, 0o600);
      }
    } catch { }
  }
}
