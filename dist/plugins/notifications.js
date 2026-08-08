import { BasePlugin } from "../plugin_manager/sdk.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const STORAGE_DIR = join(homedir(), ".neuroclaw", "notifications");
const STORAGE_FILE = join(STORAGE_DIR, "notifications.json");
export class NotificationsPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.notifications = [];
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
        this.loadFromStorage();
    }
    async show(title, body) {
        const id = this.generateId();
        this.notifications.push({ id, title, body, shown: true });
        this.saveToStorage();
        console.log(`[Notification] ${title}: ${body}`);
        if (process.env.DISPLAY) {
            try {
                const { execFileSync } = await import("node:child_process");
                // execFileSync (no shell) so title/body reach notify-send as literal
                // argv entries -- string-interpolating into execSync's shell command
                // would let `$(...)`/backticks in a title execute arbitrary commands.
                execFileSync("notify-send", [title, body], { timeout: 3000, stdio: "ignore" });
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
            if (!existsSync(STORAGE_DIR)) {
                mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
            }
            if (process.platform !== "win32" && typeof chmodSync === "function") {
                chmodSync(STORAGE_DIR, 0o700);
            }
            writeFileSync(STORAGE_FILE, JSON.stringify(this.notifications, null, 2), {
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
