import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { BasePlugin } from "../plugin_manager/sdk";
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
