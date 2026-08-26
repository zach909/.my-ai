import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE_DIR = join(homedir(), ".neuroclaw", "contacts");
const STORAGE_FILE = join(STORAGE_DIR, "contacts.json");
export class ContactsPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.contacts = [];
    }
    /**
     * How someone would ASK for this, not what the plugin calls itself.
     *
     * Added after the agent exam measured routing and found this plugin
     * unreachable for the obvious phrasing: the only terms available were its id
     * and its manifest capabilities, so a request had to contain the plugin's
     * own name to find it.
     */
    describeCapabilities() {
        return {
            verbs: ["look"],
            nouns: ["contact", "person", "number", "addressbook", "phonebook"],
        };
    }
    async onActivate(context) {
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
        }
        catch { }
        this.load();
    }
    async list() {
        return [...this.contacts];
    }
    async get(id) {
        this.validateId(id);
        return this.contacts.find((c) => c.id === id);
    }
    async add(contact) {
        if (!contact || typeof contact !== "object") {
            throw new Error("Security Error: Contact data must be an object.");
        }
        this.validateContactFields(contact, true);
        const newContact = { ...contact, id: this.generateId() };
        this.contacts.push(newContact);
        this.save();
        return newContact;
    }
    async update(id, updates) {
        this.validateId(id);
        if (!updates || typeof updates !== "object") {
            throw new Error("Security Error: Updates must be an object.");
        }
        this.validateContactFields(updates, false);
        const idx = this.contacts.findIndex((c) => c.id === id);
        if (idx === -1)
            return false;
        this.contacts[idx] = { ...this.contacts[idx], ...updates };
        this.save();
        return true;
    }
    async remove(id) {
        this.validateId(id);
        const idx = this.contacts.findIndex((c) => c.id === id);
        if (idx === -1)
            return false;
        this.contacts.splice(idx, 1);
        this.save();
        return true;
    }
    async search(query) {
        if (typeof query !== "string") {
            throw new Error("Security Error: Search query must be a string.");
        }
        if (query.length > 100) {
            throw new Error("Security Error: Search query exceeds maximum length limit.");
        }
        const lower = query.toLowerCase();
        return this.contacts.filter((c) => c.name.toLowerCase().includes(lower) ||
            (c.phone && c.phone.includes(lower)) ||
            (c.email && c.email.toLowerCase().includes(lower)));
    }
    validateId(id) {
        if (typeof id !== "string") {
            throw new Error("Security Error: Contact ID must be a string.");
        }
        if (id.length > 100) {
            throw new Error("Security Error: Contact ID exceeds maximum length limit.");
        }
    }
    validateContactFields(fields, isNew) {
        if (isNew || fields.name !== undefined) {
            if (typeof fields.name !== "string") {
                throw new Error("Security Error: Contact name must be a string.");
            }
            if (!fields.name.trim()) {
                throw new Error("Security Error: Contact name cannot be empty.");
            }
            if (fields.name.length > 100) {
                throw new Error("Security Error: Contact name exceeds maximum length limit.");
            }
        }
        if (fields.phone !== undefined && fields.phone !== null) {
            if (typeof fields.phone !== "string") {
                throw new Error("Security Error: Phone must be a string.");
            }
            if (fields.phone.length > 100) {
                throw new Error("Security Error: Phone exceeds maximum length limit.");
            }
        }
        if (fields.email !== undefined && fields.email !== null) {
            if (typeof fields.email !== "string") {
                throw new Error("Security Error: Email must be a string.");
            }
            if (fields.email.length > 100) {
                throw new Error("Security Error: Email exceeds maximum length limit.");
            }
        }
        if (fields.group !== undefined && fields.group !== null) {
            if (typeof fields.group !== "string") {
                throw new Error("Security Error: Group must be a string.");
            }
            if (fields.group.length > 100) {
                throw new Error("Security Error: Group exceeds maximum length limit.");
            }
        }
        if (fields.address !== undefined && fields.address !== null) {
            if (typeof fields.address !== "string") {
                throw new Error("Security Error: Address must be a string.");
            }
            if (fields.address.length > 500) {
                throw new Error("Security Error: Address exceeds maximum length limit.");
            }
        }
        if (fields.notes !== undefined && fields.notes !== null) {
            if (typeof fields.notes !== "string") {
                throw new Error("Security Error: Notes must be a string.");
            }
            if (fields.notes.length > 500) {
                throw new Error("Security Error: Notes exceeds maximum length limit.");
            }
        }
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
            if (!existsSync(STORAGE_DIR)) {
                mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
            }
            if (process.platform !== "win32" && typeof chmodSync === "function") {
                chmodSync(STORAGE_DIR, 0o700);
            }
            writeFileSync(STORAGE_FILE, JSON.stringify(this.contacts, null, 2), {
                encoding: "utf-8",
                mode: 0o600,
            });
            if (process.platform !== "win32" && typeof chmodSync === "function") {
                chmodSync(STORAGE_FILE, 0o600);
            }
        }
        catch { }
    }
}
