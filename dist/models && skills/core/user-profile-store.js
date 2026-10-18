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
const MAX_TEXT = 1000;
export class UserProfileStore {
    constructor(file = join(homedir(), ".neuroclaw", "profile.json")) {
        this.file = file;
        this.profile = this.read();
    }
    get() {
        return { about: this.profile.about.map(e => ({ ...e })), goals: this.profile.goals.map(e => ({ ...e })) };
    }
    add(list, text, memory) {
        const clean = text.trim().slice(0, MAX_TEXT);
        if (!clean)
            throw new Error("Text is empty.");
        const entry = { id: randomUUID().slice(0, 8), text: clean, createdAt: Date.now() };
        if (list === "goals")
            entry.done = false;
        this.profile[list].push(entry);
        this.write();
        if (memory)
            this.mirror(memory, list, entry);
        return { ...entry };
    }
    update(list, id, patch, memory) {
        const entry = this.profile[list].find(e => e.id === id);
        if (!entry)
            return null;
        if (typeof patch.text === "string" && patch.text.trim())
            entry.text = patch.text.trim().slice(0, MAX_TEXT);
        if (list === "goals" && typeof patch.done === "boolean")
            entry.done = patch.done;
        this.write();
        if (memory)
            this.mirror(memory, list, entry);
        return { ...entry };
    }
    remove(list, id, memory) {
        const before = this.profile[list].length;
        this.profile[list] = this.profile[list].filter(e => e.id !== id);
        if (this.profile[list].length === before)
            return false;
        this.write();
        memory?.forget(memoryId(id));
        return true;
    }
    /** Put every entry into long-term memory (again). Idempotent: same ids replace. */
    syncTo(memory) {
        for (const e of this.profile.about)
            this.mirror(memory, "about", e);
        for (const e of this.profile.goals)
            this.mirror(memory, "goals", e);
    }
    mirror(memory, list, entry) {
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
    read() {
        try {
            if (!existsSync(this.file))
                return { about: [], goals: [] };
            const parsed = JSON.parse(readFileSync(this.file, "utf-8"));
            const clean = (list) => Array.isArray(list)
                ? list.filter((e) => !!e && typeof e.id === "string" && typeof e.text === "string")
                : [];
            return { about: clean(parsed.about), goals: clean(parsed.goals) };
        }
        catch {
            return { about: [], goals: [] };
        }
    }
    // Atomic: a crash mid-write must not lose everything the user typed.
    write() {
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.profile, null, 2), "utf-8");
        renameSync(tmp, this.file);
    }
}
function memoryId(id) {
    return `profile-${id}`;
}
