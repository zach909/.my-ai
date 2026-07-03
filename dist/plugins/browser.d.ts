import type { PluginDefinition } from "../plugin_manager/types.js";
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
export declare class BrowserPlugin extends BasePlugin {
    private history;
    private bookmarks;
    private currentUrl;
    constructor(definition: PluginDefinition);
    navigate(url: string): Promise<boolean>;
    getHistory(): HistoryEntry[];
    bookmark(url: string, title: string): Promise<boolean>;
    getBookmarks(): Bookmark[];
    removeBookmark(url: string): Promise<boolean>;
    search(query: string): Promise<SearchResult[]>;
    fetchUrl(urlStr: string): Promise<string>;
    private parseDuckDuckGoResults;
    private decodeHtml;
    private stripHtml;
    getCurrentUrl(): string;
    clearHistory(): Promise<void>;
    clearBookmarks(): Promise<void>;
    onMessage(message: unknown): Promise<unknown>;
}
