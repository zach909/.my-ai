import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE_DIR = join(homedir(), ".neuroclaw", "calendar");
const STORAGE_FILE = join(STORAGE_DIR, "events.json");
export class CalendarPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.events = [];
    }
    async onActivate(context) { await super.onActivate(context); this.load(); }
    async list(from, to) {
        let result = [...this.events];
        if (from)
            result = result.filter(e => e.startTime >= from);
        if (to)
            result = result.filter(e => e.endTime <= to);
        return result.sort((a, b) => a.startTime - b.startTime);
    }
    async add(event) {
        const ev = { ...event, id: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` };
        this.events.push(ev);
        this.save();
        return ev;
    }
    async update(id, updates) {
        const idx = this.events.findIndex(e => e.id === id);
        if (idx === -1)
            return false;
        this.events[idx] = { ...this.events[idx], ...updates };
        this.save();
        return true;
    }
    async remove(id) {
        const idx = this.events.findIndex(e => e.id === id);
        if (idx === -1)
            return false;
        this.events.splice(idx, 1);
        this.save();
        return true;
    }
    async getUpcoming(count = 5) {
        const now = Date.now();
        return this.events.filter(e => e.startTime >= now).sort((a, b) => a.startTime - b.startTime).slice(0, count);
    }
    load() { try {
        if (existsSync(STORAGE_FILE))
            this.events = JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
    }
    catch {
        this.events = [];
    } }
    save() { try {
        if (!existsSync(STORAGE_DIR))
            mkdirSync(STORAGE_DIR, { recursive: true });
        writeFileSync(STORAGE_FILE, JSON.stringify(this.events, null, 2), "utf-8");
    }
    catch { } }
}
