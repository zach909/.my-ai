import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Contact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  group?: string;
  notes?: string;
}

const STORAGE_DIR = join(homedir(), ".neuroclaw", "contacts");
const STORAGE_FILE = join(STORAGE_DIR, "contacts.json");

export class ContactsPlugin extends BasePlugin {
  private contacts: Contact[] = [];

  constructor(definition: PluginDefinition) {
    super(definition);
  }

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

  async list(): Promise<Contact[]> {
    return [...this.contacts];
  }

  async get(id: string): Promise<Contact | undefined> {
    return this.contacts.find((c) => c.id === id);
  }

  async add(contact: Omit<Contact, "id">): Promise<Contact> {
    const newContact: Contact = { ...contact, id: this.generateId() };
    this.contacts.push(newContact);
    this.save();
    return newContact;
  }

  async update(id: string, updates: Partial<Contact>): Promise<boolean> {
    const idx = this.contacts.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.contacts[idx] = { ...this.contacts[idx], ...updates };
    this.save();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.contacts.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.contacts.splice(idx, 1);
    this.save();
    return true;
  }

  async search(query: string): Promise<Contact[]> {
    const lower = query.toLowerCase();
    return this.contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.phone && c.phone.includes(lower)) ||
        (c.email && c.email.toLowerCase().includes(lower)),
    );
  }

  private generateId(): string {
    return `contact-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private load(): void {
    try {
      if (existsSync(STORAGE_FILE)) {
        this.contacts = JSON.parse(readFileSync(STORAGE_FILE, "utf-8"));
      }
    } catch { this.contacts = []; }
  }

  private save(): void {
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
    } catch { }
  }
}
