import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE_DIR = join(homedir(), ".neuroclaw", "contacts");
const STORAGE_FILE = join(STORAGE_DIR, "contacts.json");
export class ContactsPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.contacts = [];
    }
    async onActivate(context) {
        await super.onActivate(context);
        this.load();
    }
    async list() {
        return [...this.contacts];
    }
    async get(id) {
        return this.contacts.find((c) => c.id === id);
    }
    async add(contact) {
        const newContact = { ...contact, id: this.generateId() };
        this.contacts.push(newContact);
        this.save();
        return newContact;
    }
    async update(id, updates) {
        const idx = this.contacts.findIndex((c) => c.id === id);
        if (idx === -1)
            return false;
        this.contacts[idx] = { ...this.contacts[idx], ...updates };
        this.save();
        return true;
    }
    async remove(id) {
        const idx = this.contacts.findIndex((c) => c.id === id);
        if (idx === -1)
            return false;
        this.contacts.splice(idx, 1);
        this.save();
        return true;
    }
    async search(query) {
        const lower = query.toLowerCase();
        return this.contacts.filter((c) => c.name.toLowerCase().includes(lower) ||
            (c.phone && c.phone.includes(lower)) ||
            (c.email && c.email.toLowerCase().includes(lower)));
    }
    generateId() {
        return `contact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    load() {
        try {
            if (existsSync(STORAGE_FILE)) {
                this.contacts = JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
            }
        }
        catch {
            this.contacts = [];
        }
    }
    save() {
        try {
            if (!existsSync(STORAGE_DIR))
                mkdirSync(STORAGE_DIR, { recursive: true });
            writeFileSync(STORAGE_FILE, JSON.stringify(this.contacts, null, 2), "utf-8");
        }
        catch { }
    }
}
