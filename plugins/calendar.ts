import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
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

  private validateId(id: string): void {
    if (typeof id !== "string") throw new Error("Security Error: Event ID must be a string.");
    if (!id.trim()) throw new Error("Security Error: Event ID cannot be empty.");
    if (id.length > 100) throw new Error("Security Error: Event ID exceeds maximum length limit of 100 characters.");
  }

  private validateEventData(event: Partial<CalendarEvent>, isUpdate = false): void {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("Security Error: Event data must be an object.");
    }
    if (!isUpdate || event.title !== undefined) {
      if (typeof event.title !== "string") throw new Error("Security Error: Event title must be a string.");
      if (!event.title.trim()) throw new Error("Security Error: Event title cannot be empty.");
      if (event.title.length > 200) throw new Error("Security Error: Event title exceeds maximum length limit of 200 characters.");
    }
    if (event.description !== undefined) {
      if (typeof event.description !== "string") throw new Error("Security Error: Event description must be a string.");
      if (event.description.length > 2000) throw new Error("Security Error: Event description exceeds maximum length limit of 2000 characters.");
    }
    if (event.location !== undefined) {
      if (typeof event.location !== "string") throw new Error("Security Error: Event location must be a string.");
      if (event.location.length > 500) throw new Error("Security Error: Event location exceeds maximum length limit of 500 characters.");
    }
    if (event.category !== undefined) {
      if (typeof event.category !== "string") throw new Error("Security Error: Event category must be a string.");
      if (event.category.length > 100) throw new Error("Security Error: Event category exceeds maximum length limit of 100 characters.");
    }
    const checkTime = (val: any, name: string, required: boolean) => {
      if (required || val !== undefined) {
        if (typeof val !== "number" || isNaN(val) || !isFinite(val) || val < 0) {
          throw new Error(`Security Error: '${name}' must be a non-negative finite number.`);
        }
      }
    };
    checkTime(event.startTime, "startTime", !isUpdate);
    checkTime(event.endTime, "endTime", !isUpdate);
    if (event.startTime !== undefined && event.endTime !== undefined && event.startTime > event.endTime) {
      throw new Error("Security Error: 'startTime' cannot be greater than 'endTime'.");
    }
  }

  async list(from?: number, to?: number): Promise<CalendarEvent[]> {
    if (from !== undefined && (typeof from !== "number" || isNaN(from) || !isFinite(from) || from < 0)) {
      throw new Error("Security Error: 'from' timestamp must be a non-negative finite number.");
    }
    if (to !== undefined && (typeof to !== "number" || isNaN(to) || !isFinite(to) || to < 0)) {
      throw new Error("Security Error: 'to' timestamp must be a non-negative finite number.");
    }
    if (from !== undefined && to !== undefined && from > to) {
      throw new Error("Security Error: 'from' timestamp cannot be greater than 'to' timestamp.");
    }

    let result = [...this.events];
    if (from !== undefined) result = result.filter(e => e.startTime >= from);
    if (to !== undefined) result = result.filter(e => e.endTime <= to);
    return result.sort((a, b) => a.startTime - b.startTime);
  }

  async add(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
    this.validateEventData(event, false);
    const ev: CalendarEvent = { ...event, id: `cal-${Date.now()}-${Math.random().toString(36).slice(2,9)}` };
    this.events.push(ev); this.save(); return ev;
  }

  async update(id: string, updates: Partial<CalendarEvent>): Promise<boolean> {
    this.validateId(id);
    this.validateEventData(updates, true);
    const idx = this.events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const merged = { ...this.events[idx], ...updates };
    if (merged.startTime > merged.endTime) {
      throw new Error("Security Error: 'startTime' cannot be greater than 'endTime'.");
    }
    this.events[idx] = merged; this.save(); return true;
  }

  async remove(id: string): Promise<boolean> {
    this.validateId(id);
    const idx = this.events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.events.splice(idx, 1); this.save(); return true;
  }

  async getUpcoming(count: number = 5): Promise<CalendarEvent[]> {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error("Security Error: 'count' must be an integer between 1 and 1000.");
    }
    const now = Date.now();
    return this.events.filter(e => e.startTime >= now).sort((a, b) => a.startTime - b.startTime).slice(0, count);
  }

  private load(): void {
    try {
      if (!existsSync(STORAGE_FILE)) return;
      const raw: unknown[] = JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
      // Both this plugin and plugin_calendar.py (the Python sibling) persist
      // to the exact same STORAGE_FILE path, sharing the same "cal-*" id
      // format -- but plugin_calendar.py's events use "start"/"end" seconds
      // fields, not this class's "startTime"/"endTime" milliseconds fields.
      // Without this normalization, list()/getUpcoming() filter and sort on
      // `e.startTime`/`e.endTime`, which are `undefined` on every
      // Python-written record: getUpcoming() silently drops genuinely
      // upcoming events (undefined >= now is always false), and list()'s
      // from/to filtering and sort order break the same way.
      this.events = raw.map((e: any) => ({
        ...e,
        startTime: e.startTime ?? (typeof e.start === "number" ? e.start * 1000 : e.startTime),
        endTime: e.endTime ?? (typeof e.end === "number" ? e.end * 1000 : e.endTime),
      }));
    } catch { this.events = []; }
  }
  private save(): void {
    try {
      if (!existsSync(STORAGE_DIR)) {
        mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(STORAGE_DIR, 0o700);
      }
      writeFileSync(STORAGE_FILE, JSON.stringify(this.events, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(STORAGE_FILE, 0o600);
      }
    } catch { }
  }
}
