import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BasePlugin } from "../plugin_manager/sdk.js";
const DATA_DIR = join(homedir(), '.neuroclaw', 'email');
export class EmailPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.emails = [];
        if (!existsSync(DATA_DIR))
            mkdirSync(DATA_DIR, { recursive: true });
        this.loadFromDisk();
    }
    async send(from, to, subject, body) {
        const email = {
            id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            from, to, subject, body, timestamp: Date.now(), read: true, folder: "sent",
        };
        const sent = this.trySendmail(email);
        this.emails.push(email);
        this.saveToDisk();
        if (!sent) {
            console.log(`[Email] Queued (no MTA): ${subject} to ${to.join(", ")}`);
        }
        return email;
    }
    async inbox() {
        return this.emails.filter(e => e.folder === "inbox").sort((a, b) => b.timestamp - a.timestamp);
    }
    async markRead(id) {
        const e = this.emails.find(em => em.id === id);
        if (!e)
            return false;
        e.read = true;
        this.saveToDisk();
        return true;
    }
    async search(query) {
        const lower = query.toLowerCase();
        return this.emails.filter(e => e.subject.toLowerCase().includes(lower) || e.body.toLowerCase().includes(lower));
    }
    async listSent() {
        return this.emails.filter(e => e.folder === "sent").sort((a, b) => b.timestamp - a.timestamp);
    }
    async listAll() {
        return [...this.emails].sort((a, b) => b.timestamp - a.timestamp);
    }
    trySendmail(email) {
        const sendmailPath = this.which('sendmail') || this.which('ssmtp') || this.which('msmtp');
        if (!sendmailPath)
            return false;
        try {
            const recipients = email.to.map(t => `<${t}>`).join(', ');
            const mime = [
                `From: ${email.from}`,
                `To: ${recipients}`,
                `Subject: ${email.subject}`,
                `Date: ${new Date(email.timestamp).toUTCString()}`,
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                email.body,
            ].join('\r\n');
            execSync(`echo "${mime.replace(/"/g, '\\"')}" | ${sendmailPath} -t -i`, { timeout: 10000 });
            return true;
        }
        catch {
            return false;
        }
    }
    which(cmd) {
        try {
            return execSync(`which ${cmd} 2>/dev/null`, { timeout: 2000, encoding: 'utf8' }).trim() || null;
        }
        catch {
            return null;
        }
    }
    loadFromDisk() {
        try {
            const data = JSON.parse(require('fs').readFileSync(join(DATA_DIR, 'emails.json'), 'utf-8'));
            this.emails = Array.isArray(data) ? data : [];
        }
        catch {
            this.emails = [];
        }
    }
    saveToDisk() {
        try {
            writeFileSync(join(DATA_DIR, 'emails.json'), JSON.stringify(this.emails), 'utf-8');
        }
        catch { /* non-fatal */ }
    }
}
