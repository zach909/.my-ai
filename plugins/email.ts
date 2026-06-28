import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";

export interface Email {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  timestamp: number;
  read: boolean;
  folder: "inbox" | "sent" | "drafts" | "trash";
}

const DATA_DIR = join(homedir(), '.neuroclaw', 'email');

export class EmailPlugin extends BasePlugin {
  private emails: Email[] = [];

  constructor(definition: PluginDefinition) {
    super(definition);
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    this.loadFromDisk();
  }

  async send(from: string, to: string[], subject: string, body: string): Promise<Email> {
    const email: Email = {
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

  async inbox(): Promise<Email[]> {
    return this.emails.filter(e => e.folder === "inbox").sort((a, b) => b.timestamp - a.timestamp);
  }

  async markRead(id: string): Promise<boolean> {
    const e = this.emails.find(em => em.id === id);
    if (!e) return false;
    e.read = true;
    this.saveToDisk();
    return true;
  }

  async search(query: string): Promise<Email[]> {
    const lower = query.toLowerCase();
    return this.emails.filter(e => e.subject.toLowerCase().includes(lower) || e.body.toLowerCase().includes(lower));
  }

  async listSent(): Promise<Email[]> {
    return this.emails.filter(e => e.folder === "sent").sort((a, b) => b.timestamp - a.timestamp);
  }

  async listAll(): Promise<Email[]> {
    return [...this.emails].sort((a, b) => b.timestamp - a.timestamp);
  }

  private trySendmail(email: Email): boolean {
    const sendmailPath = this.which('sendmail') || this.which('ssmtp') || this.which('msmtp');
    if (!sendmailPath) return false;

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
    } catch {
      return false;
    }
  }

  private which(cmd: string): string | null {
    try {
      return execSync(`which ${cmd} 2>/dev/null`, { timeout: 2000, encoding: 'utf8' }).trim() || null;
    } catch { return null; }
  }

  private loadFromDisk(): void {
    try {
      const data = JSON.parse(require('fs').readFileSync(join(DATA_DIR, 'emails.json'), 'utf-8'));
      this.emails = Array.isArray(data) ? data : [];
    } catch { this.emails = []; }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(join(DATA_DIR, 'emails.json'), JSON.stringify(this.emails), 'utf-8');
    } catch { /* non-fatal */ }
  }
}
