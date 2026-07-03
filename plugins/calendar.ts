import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  location?: string;
  category?: string;
}

const STORAGE_DIR = join(homedir(), ".neuroclaw", "calendar");
const STORAGE_FILE = join(STORAGE_DIR, "events.json");

export class CalendarPlugin extends BasePlugin {
  private events: CalendarEvent[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  async onActivate(context: any): Promise<void> { await super.onActivate(context); this.load(); }

  async list(from?: number, to?: number): Promise<CalendarEvent[]> {
    let result = [...this.events];
    if (from) result = result.filter(e => e.startTime >= from);
    if (to) result = result.filter(e => e.endTime <= to);
    return result.sort((a, b) => a.startTime - b.startTime);
  }

  async add(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
    const ev: CalendarEvent = { ...event, id: `cal-${Date.now()}-${Math.random().toString(36).slice(2,9)}` };
    this.events.push(ev); this.save(); return ev;
  }

  async update(id: string, updates: Partial<CalendarEvent>): Promise<boolean> {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.events[idx] = { ...this.events[idx], ...updates }; this.save(); return true;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.events.splice(idx, 1); this.save(); return true;
  }

  async getUpcoming(count: number = 5): Promise<CalendarEvent[]> {
    const now = Date.now();
    return this.events.filter(e => e.startTime >= now).sort((a, b) => a.startTime - b.startTime).slice(0, count);
  }

  private load(): void { try { if (existsSync(STORAGE_FILE)) this.events = JSON.parse(readFileSync(STORAGE_FILE, "utf-8")); } catch { this.events = []; } }
  private save(): void { try { if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true }); writeFileSync(STORAGE_FILE, JSON.stringify(this.events, null, 2), "utf-8"); } catch { } }
}
