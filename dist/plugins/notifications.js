import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE_DIR = join(homedir(), ".neuroclaw", "notifications");
const STORAGE_FILE = join(STORAGE_DIR, "notifications.json");
export class NotificationsPlugin extends BasePlugin {
    notifications = [];
    constructor(definition) {
        super(definition);
    }
    async onActivate(context) {
        await super.onActivate(context);
        this.loadFromStorage();
    }
    async show(title, body) {
        const id = this.generateId();
        this.notifications.push({ id, title, body, shown: true });
        this.saveToStorage();
        console.log(`[Notification] ${title}: ${body}`);
        if (process.env.DISPLAY) {
            try {
                const { execSync } = await import("node:child_process");
                execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${body.replace(/"/g, '\\"')}"`, { timeout: 3000, stdio: "ignore" });
            }
            catch { }
        }
        return id;
    }
    async schedule(title, body, delayMs) {
        const id = this.generateId();
        const scheduledAt = Date.now() + delayMs;
        this.notifications.push({ id, title, body, scheduledAt, shown: false });
        this.saveToStorage();
        setTimeout(() => {
            const notif = this.notifications.find((n) => n.id === id);
            if (notif) {
                notif.shown = true;
                console.log(`[Notification] ${title}: ${body}`);
                this.saveToStorage();
            }
        }, delayMs);
        return id;
    }
    async dismiss(id) {
        const index = this.notifications.findIndex((n) => n.id === id);
        if (index === -1)
            return false;
        this.notifications.splice(index, 1);
        this.saveToStorage();
        return true;
    }
    listActive() {
        return this.notifications.filter((n) => !n.shown);
    }
    generateId() {
        return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    loadFromStorage() {
        try {
            if (existsSync(STORAGE_FILE)) {
                const stored = readFileSync(STORAGE_FILE, "utf-8");
                this.notifications = JSON.parse(stored);
            }
        }
        catch {
            this.notifications = [];
        }
    }
    saveToStorage() {
        try {
            if (!existsSync(STORAGE_DIR))
                mkdirSync(STORAGE_DIR, { recursive: true });
            writeFileSync(STORAGE_FILE, JSON.stringify(this.notifications, null, 2), "utf-8");
        }
        catch { }
    }
}
