import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE = join(homedir(), ".neuroclaw", "tasks.json");
export class TasksPlugin extends BasePlugin {
    tasks = [];
    constructor(definition) { super(definition); }
    async onActivate(context) { await super.onActivate(context); this.load(); }
    async create(title, opts) {
        const task = {
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            title, completed: false, priority: "medium", createdAt: Date.now(),
            tags: [], ...opts,
        };
        this.tasks.push(task);
        this.save();
        return task;
    }
    async list(filter) {
        let result = [...this.tasks];
        if (filter?.completed !== undefined)
            result = result.filter(t => t.completed === filter.completed);
        if (filter?.priority)
            result = result.filter(t => t.priority === filter.priority);
        if (filter?.tag)
            result = result.filter(t => t.tags.includes(filter.tag));
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    async complete(id) {
        const t = this.tasks.find(task => task.id === id);
        if (!t)
            return false;
        t.completed = true;
        this.save();
        return true;
    }
    async remove(id) {
        const idx = this.tasks.findIndex(t => t.id === id);
        if (idx === -1)
            return false;
        this.tasks.splice(idx, 1);
        this.save();
        return true;
    }
    load() { try {
        if (existsSync(STORAGE))
            this.tasks = JSON.parse(readFileSync(STORAGE, "utf-8"));
    }
    catch {
        this.tasks = [];
    } }
    save() { try {
        writeFileSync(STORAGE, JSON.stringify(this.tasks, null, 2), "utf-8");
    }
    catch { } }
}
