/**
 * What the user has told the agent about themselves, and the goals they have
 * set for it -- the two lists on the Memory tab's "About you" and "Goals"
 * sections.
 *
 * Long-term memory lives only in RAM, so anything typed there directly would
 * be gone on the next restart. This keeps the user's own entries in a small
 * JSON file (~/.neuroclaw/profile.json) and mirrors each one into long-term
 * memory as a pinned item (tag "about-you" or "goal", id "profile-<id>"), so
 * the agent recalls them when answering and capacity eviction never drops them.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LongTermMemory } from "./long-term-memory.js";

export type ProfileList = "about" | "goals";

export interface ProfileEntry {
  id: string;
  text: string;
  createdAt: number;
  /** Goals only: the user marked it achieved. */
  done?: boolean;
}

export interface UserProfile {
  about: ProfileEntry[];
  goals: ProfileEntry[];
}

const MAX_TEXT = 1000;

export class UserProfileStore {
  private profile: UserProfile;

  constructor(private readonly file: string = join(homedir(), ".neuroclaw", "profile.json")) {
    this.profile = this.read();
  }

  get(): UserProfile {
    return { about: this.profile.about.map(e => ({ ...e })), goals: this.profile.goals.map(e => ({ ...e })) };
  }

  add(list: ProfileList, text: string, memory?: LongTermMemory): ProfileEntry {
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) throw new Error("Text is empty.");
    const entry: ProfileEntry = { id: randomUUID().slice(0, 8), text: clean, createdAt: Date.now() };
    if (list === "goals") entry.done = false;
    this.profile[list].push(entry);
    this.write();
    if (memory) this.mirror(memory, list, entry);
    return { ...entry };
  }

  update(list: ProfileList, id: string, patch: { text?: string; done?: boolean }, memory?: LongTermMemory): ProfileEntry | null {
    const entry = this.profile[list].find(e => e.id === id);
    if (!entry) return null;
    if (typeof patch.text === "string" && patch.text.trim()) entry.text = patch.text.trim().slice(0, MAX_TEXT);
    if (list === "goals" && typeof patch.done === "boolean") entry.done = patch.done;
    this.write();
    if (memory) this.mirror(memory, list, entry);
    return { ...entry };
  }

  remove(list: ProfileList, id: string, memory?: LongTermMemory): boolean {
    const before = this.profile[list].length;
    this.profile[list] = this.profile[list].filter(e => e.id !== id);
    if (this.profile[list].length === before) return false;
    this.write();
    memory?.forget(memoryId(id));
    return true;
  }

  /** Put every entry into long-term memory (again). Idempotent: same ids replace. */
  syncTo(memory: LongTermMemory): void {
    for (const e of this.profile.about) this.mirror(memory, "about", e);
    for (const e of this.profile.goals) this.mirror(memory, "goals", e);
  }

  private mirror(memory: LongTermMemory, list: ProfileList, entry: ProfileEntry): void {
    // An achieved goal is no longer something to work toward; keep it out of recall.
    if (list === "goals" && entry.done) {
      memory.forget(memoryId(entry.id));
      return;
    }
    const content = list === "about"
      ? `About the user: ${entry.text}`
      : `The user's goal for me: ${entry.text}`;
    memory.remember(content, {
      id: memoryId(entry.id),
      tags: [list === "about" ? "about-you" : "goal", "user-profile"],
      importance: 0.95,
      pinned: true,
    });
  }

  private read(): UserProfile {
    try {
      if (!existsSync(this.file)) return { about: [], goals: [] };
      const parsed = JSON.parse(readFileSync(this.file, "utf-8")) as Partial<UserProfile>;
      const clean = (list: unknown): ProfileEntry[] => Array.isArray(list)
        ? list.filter((e): e is ProfileEntry => !!e && typeof e.id === "string" && typeof e.text === "string")
        : [];
      return { about: clean(parsed.about), goals: clean(parsed.goals) };
    } catch {
      return { about: [], goals: [] };
    }
  }

  // Atomic: a crash mid-write must not lose everything the user typed.
  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.profile, null, 2), "utf-8");
    renameSync(tmp, this.file);
  }
}

function memoryId(id: string): string {
  return `profile-${id}`;
}
