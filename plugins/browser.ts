import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { URL } from 'node:url';
import type { PluginDefinition, ChromeAppConfig } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface Bookmark {
  url: string;
  title: string;
  createdAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class BrowserPlugin extends BasePlugin {
  private history: HistoryEntry[] = [];
  private bookmarks: Bookmark[] = [];
  private currentUrl: string = "about:blank";

  // Chrome Applications: local Chrome apps registered as supplementary data
  // sources / services (spec "Chrome Apps"). Each is a ChromeAppConfig the
  // system can connect to for additional local capabilities; connected apps
  // can be queried for data without leaving the local machine.
  private chromeApps = new Map<string, ChromeAppConfig>();
  private connectedApps = new Set<string>();
  private appData = new Map<string, Record<string, unknown>>();

  constructor(definition: PluginDefinition) {
    super(definition);
    this.registerDefaultChromeApps();
  }

  /** Seed the commonly available local Chrome apps. */
  private registerDefaultChromeApps(): void {
    const defaults: ChromeAppConfig[] = [
      { id: "chrome-files", name: "Files", url: "chrome://apps/files", permissions: ["file-system"], autoConnect: true, dataSync: false },
      { id: "chrome-media", name: "Media", url: "chrome://apps/media", permissions: ["media"], autoConnect: false, dataSync: false },
      { id: "chrome-web-store", name: "Web Store", url: "chrome://apps/webstore", permissions: ["install"], autoConnect: false, dataSync: true },
    ];
    for (const app of defaults) {
      this.chromeApps.set(app.id, app);
      if (app.autoConnect) void this.connectChromeApp(app.id);
    }
  }

  /** Register (install) a Chrome app as a local service/data source. */
  registerChromeApp(config: ChromeAppConfig): void {
    this.chromeApps.set(config.id, config);
    if (config.autoConnect) void this.connectChromeApp(config.id);
  }

  listChromeApps(): ChromeAppConfig[] {
    return [...this.chromeApps.values()];
  }

  /** Connect to a Chrome app so its local data/services become available. */
  async connectChromeApp(id: string): Promise<boolean> {
    const app = this.chromeApps.get(id);
    if (!app) return false;
    this.connectedApps.add(id);
    // Local, in-process connection — no external network call (spec: no
    // external APIs, data stays on the machine).
    this.appData.set(id, { connectedAt: Date.now(), permissions: app.permissions, dataSync: app.dataSync });
    return true;
  }

  isChromeAppConnected(id: string): boolean {
    return this.connectedApps.has(id);
  }

  /** Read data a connected Chrome app exposes to the system. */
  getChromeAppData(id: string): Record<string, unknown> | null {
    if (!this.connectedApps.has(id)) return null;
    return this.appData.get(id) ?? {};
  }

  async disconnectChromeApp(id: string): Promise<boolean> {
    if (!this.connectedApps.delete(id)) return false;
    this.appData.delete(id);
    return true;
  }

  async navigate(url: string): Promise<boolean> {
    this.currentUrl = url;
    this.history.push({
      url,
      title: `Page: ${url}`,
      visitedAt: Date.now(),
    });
    return true;
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  async bookmark(url: string, title: string): Promise<boolean> {
    if (this.bookmarks.some((b) => b.url === url)) return false;
    this.bookmarks.push({ url, title, createdAt: Date.now() });
    return true;
  }

  getBookmarks(): Bookmark[] {
    return [...this.bookmarks];
  }

  async removeBookmark(url: string): Promise<boolean> {
    const index = this.bookmarks.findIndex((b) => b.url === url);
    if (index === -1) return false;
    this.bookmarks.splice(index, 1);
    return true;
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
      const html = await this.fetchUrl(url);
      const results = this.parseDuckDuckGoResults(html);
      if (results.length > 0) return results;
    } catch { /* fall through to local cache */ }

    const cached = this.history.filter(h => h.url.toLowerCase().includes(query.toLowerCase()));
    if (cached.length > 0) {
      return cached.map(h => ({ title: h.title, url: h.url, snippet: `Visited ${new Date(h.visitedAt).toLocaleDateString()}` }));
    }

    return [{
      title: `Local search: ${query}`,
      url: `neuroclaw://search/${encodeURIComponent(query)}`,
      snippet: `No web results. Try the URL directly with navigate().`,
    }];
  }

  async fetchUrl(urlStr: string): Promise<string> {
    const url = new URL(urlStr);

    // Security Check: Prevent SSRF by blocking private/local addresses
    const hostname = url.hostname.toLowerCase();

    // 1. Check hostname string
    if (this.isPrivateHost(hostname)) {
      throw new Error(`Security Error: Access to private/local host "${hostname}" is forbidden.`);
    }

    let ipAddress = url.hostname;
    // 2. DNS resolution check to prevent DNS Rebinding
    try {
      // dns.lookup doesn't like brackets for IPv6 literals
      const dnsHostname = url.hostname.replace(/^\[|\]$/g, "");
      const lookup = await dns.lookup(dnsHostname);
      ipAddress = lookup.address;
      if (this.isPrivateHost(ipAddress)) {
        throw new Error(`Security Error: Access to private/local address "${ipAddress}" is forbidden.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Security Error')) throw err;
    }

    const client = url.protocol === 'https:' ? https : http;
    // Pin connection directly to resolved ipAddress to eliminate DNS rebinding TOCTOU window
    const requestOptions: http.RequestOptions & { servername?: string } = {
      hostname: ipAddress,
      port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Host': url.hostname,
        'User-Agent': 'Mozilla/5.0 (Neuroclaw)',
      },
      timeout: 10000,
    };
    if (url.protocol === 'https:') {
      requestOptions.servername = url.hostname;
    }

    return new Promise((resolve, reject) => {
      const req = client.get(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          this.currentUrl = urlStr;
          this.history.push({ url: urlStr, title: `Fetched ${url.hostname}`, visitedAt: Date.now() });
          resolve(body);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  private parseDuckDuckGoResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let m: RegExpExecArray | null;
    const titles: string[] = [];
    const links: string[] = [];
    while ((m = resultRegex.exec(html)) !== null) {
      links.push(this.decodeHtml(m[1]));
      titles.push(this.stripHtml(m[2]));
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(this.stripHtml(m[1]));
    }

    for (let i = 0; i < Math.min(links.length, 8); i++) {
      results.push({
        title: titles[i] ?? `Result ${i + 1}`,
        url: links[i] ?? '',
        snippet: snippets[i] ?? '',
      });
    }
    return results;
  }

  private decodeHtml(str: string): string {
    return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/');
  }

  private stripHtml(str: string): string {
    return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  async clearHistory(): Promise<void> {
    this.history = [];
  }

  async clearBookmarks(): Promise<void> {
    this.bookmarks = [];
  }

  private isPrivateHost(hostname: string): boolean {
    // Exact matches for common local hosts
    // Note: url.hostname for [::1] returns "[::1]", but dns.lookup returns "::1"
    let host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

    // Security: Normalize IPv4-mapped/compatible IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) to IPv4
    const mappedDotted = host.match(/^(?:::ffff:|::ffff:0:|0:0:0:0:0:(?:0|ffff):)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) {
      host = mappedDotted[1];
    } else {
      const mappedHex = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (mappedHex) {
        const h1 = parseInt(mappedHex[1], 16);
        const h2 = parseInt(mappedHex[2], 16);
        host = `${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`;
      }
    }

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "::"
    ) {
      return true;
    }

    // IPv4 private ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = host.match(ipv4Regex);
    if (match) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 127) return true; // 127.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local)
    }

    // IPv6 private/link-local ranges. fe80::/10 covers the first hex group
    // fe80-febf (only the top 10 bits are fixed, so the group's 3rd hex
    // digit ranges over 8-b) -- startsWith("fe8") alone only matched fe80-
    // fe8f, letting fe90::/16 through feb0::/16 (still genuinely link-local,
    // e.g. fe90::1) reach fetchUrl() as if they were public addresses.
    if (
      /^fe[89ab]/i.test(host) ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }

    return false;
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = String(message).trim();
    if (/^https?:\/\//.test(input)) {
      try {
        const body = await this.fetchUrl(input);
        const title = body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? input;
        return `[Browser] Fetched ${input} (${body.length} bytes) — ${title.slice(0, 80)}`;
      } catch (e) {
        return `[Browser] Failed to fetch ${input}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const lower = input.toLowerCase();
    if (/\b(read|write|list|exists?|mkdir|delete)\b/.test(lower)) return null;
    // Only act on inputs that explicitly ask the browser to do something.
    // Plain conversation ("hello, what can you do?") must fall through to
    // the neural generation path, not become a web search.
    const wantsSearch = /^(search|look\s?up|browse|google|web\s?search)\b/.test(lower)
      || /\b(search (for|the web)|on the web|online)\b/.test(lower);
    if (!wantsSearch) return null;
    const query = input.replace(/^(search( for| the web for)?|look\s?up|browse|google|web\s?search)\s*:?\s*/i, '').trim() || input;
    const results = await this.search(query);
    if (results.length === 0) return null;
    const top = results.slice(0, 3);
    return `[Browser] Search: ${top.map(r => `${r.title} — ${r.snippet}`).join(' | ')}`;
  }
}
