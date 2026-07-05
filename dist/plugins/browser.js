import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { URL } from 'node:url';
import { BasePlugin } from "../plugin_manager/sdk.js";
export class BrowserPlugin extends BasePlugin {
    history = [];
    bookmarks = [];
    currentUrl = "about:blank";
    constructor(definition) {
        super(definition);
    }
    async navigate(url) {
        this.currentUrl = url;
        this.history.push({
            url,
            title: `Page: ${url}`,
            visitedAt: Date.now(),
        });
        return true;
    }
    getHistory() {
        return [...this.history];
    }
    async bookmark(url, title) {
        if (this.bookmarks.some((b) => b.url === url))
            return false;
        this.bookmarks.push({ url, title, createdAt: Date.now() });
        return true;
    }
    getBookmarks() {
        return [...this.bookmarks];
    }
    async removeBookmark(url) {
        const index = this.bookmarks.findIndex((b) => b.url === url);
        if (index === -1)
            return false;
        this.bookmarks.splice(index, 1);
        return true;
    }
    async search(query) {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        try {
            const html = await this.fetchUrl(url);
            const results = this.parseDuckDuckGoResults(html);
            if (results.length > 0)
                return results;
        }
        catch { /* fall through to local cache */ }
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
    async fetchUrl(urlStr) {
        const url = new URL(urlStr);
        // Security Check: Prevent SSRF by blocking private/local addresses
        const hostname = url.hostname.toLowerCase();
        // 1. Check hostname string
        if (this.isPrivateHost(hostname)) {
            throw new Error(`Security Error: Access to private/local host "${hostname}" is forbidden.`);
        }
        // 2. DNS resolution check to prevent DNS Rebinding
        try {
            // dns.lookup doesn't like brackets for IPv6 literals
            const dnsHostname = url.hostname.replace(/^\[|\]$/g, "");
            const lookup = await dns.lookup(dnsHostname);
            if (this.isPrivateHost(lookup.address)) {
                throw new Error(`Security Error: Access to private/local address "${lookup.address}" is forbidden.`);
            }
        }
        catch (err) {
            // If DNS lookup fails, it's likely an invalid host, but we let the client handle it.
            // However, if we want to be strict, we could block it.
            if (err instanceof Error && err.message.includes('Security Error'))
                throw err;
        }
        const client = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = client.get(urlStr, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Neuroclaw)' } }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
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
    parseDuckDuckGoResults(html) {
        const results = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        const titles = [];
        const links = [];
        while ((m = resultRegex.exec(html)) !== null) {
            links.push(this.decodeHtml(m[1]));
            titles.push(this.stripHtml(m[2]));
        }
        const snippets = [];
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
    decodeHtml(str) {
        return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x2F;/g, '/');
    }
    stripHtml(str) {
        return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    }
    getCurrentUrl() {
        return this.currentUrl;
    }
    async clearHistory() {
        this.history = [];
    }
    async clearBookmarks() {
        this.bookmarks = [];
    }
    isPrivateHost(hostname) {
        // Exact matches for common local hosts
        // Note: url.hostname for [::1] returns "[::1]", but dns.lookup returns "::1"
        const host = hostname.replace(/^\[|\]$/g, "");
        if (host === "localhost" ||
            host === "127.0.0.1" ||
            host === "::1" ||
            host === "0.0.0.0" ||
            host === "::") {
            return true;
        }
        // IPv4 private ranges
        const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = host.match(ipv4Regex);
        if (match) {
            const a = Number(match[1]);
            const b = Number(match[2]);
            if (a === 10)
                return true; // 10.0.0.0/8
            if (a === 127)
                return true; // 127.0.0.0/8
            if (a === 172 && b >= 16 && b <= 31)
                return true; // 172.16.0.0/12
            if (a === 192 && b === 168)
                return true; // 192.168.0.0/16
            if (a === 169 && b === 254)
                return true; // 169.254.0.0/16 (Link-local)
        }
        // IPv6 private/link-local ranges
        if (host.startsWith("fe8") ||
            host.startsWith("fc") ||
            host.startsWith("fd")) {
            return true;
        }
        return false;
    }
    async onMessage(message) {
        const input = String(message).trim();
        if (/^https?:\/\//.test(input)) {
            try {
                const body = await this.fetchUrl(input);
                const title = body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? input;
                return `[Browser] Fetched ${input} (${body.length} bytes) — ${title.slice(0, 80)}`;
            }
            catch (e) {
                return `[Browser] Failed to fetch ${input}: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        if (/\b(read|write|list|exists?|mkdir|delete)\b/.test(input.toLowerCase()))
            return null;
        const results = await this.search(input);
        if (results.length === 0)
            return null;
        const top = results.slice(0, 3);
        return `[Browser] Search: ${top.map(r => `${r.title} — ${r.snippet}`).join(' | ')}`;
    }
}
