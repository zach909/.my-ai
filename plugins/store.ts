/**
 * Store plugin — gives the agent its own hands on the public store.
 *
 * The store is meant to be a shared, growing catalogue, so the agent needs to
 * be able to publish and revise items itself rather than only ever describing
 * what a human should upload. It writes to the same `store/` folder the web
 * UI and every clone of the repository read from, so anything the agent
 * publishes reaches everyone who pulls.
 *
 * Publishing and editing are available; deleting is not exposed here on
 * purpose. Removal is privileged everywhere else in this system (the wiki, the
 * store's HTTP layer), and an agent that can quietly delete other people's
 * published work is a worse failure than one that cannot tidy up.
 *
 * Dispatch is strict: onMessage() returns null unless the text actually names
 * a store command, so messages routed here that this plugin cannot handle fall
 * through to the next candidate.
 */

import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import {
  STORE_KINDS,
  STORE_KIND_LABELS,
  listCatalog,
  publishAndSync,
  readItem,
  readItemFile,
  type StoreKind,
} from "../models && skills/core/store.js";

export class StorePlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  /** Publish or update an item. Returns the stored item. */
  publish(input: {
    kind: string;
    name: string;
    title?: string;
    description?: string;
    author?: string;
    files: Array<{ filename: string; content: string; encoding?: "utf8" | "base64" }>;
  }) {
    // Commits and pushes, so a skill the agent publishes survives this
    // machine and reaches everyone else's clone. The returned `sync` says
    // whether it really left the device.
    return publishAndSync({ ...input, author: input.author ?? "neuroclaw-agent" });
  }

  /** Everything published, grouped by section. */
  catalog() {
    return listCatalog();
  }

  /** One item's metadata and file list. */
  get(kind: string, name: string) {
    return readItem(kind, name);
  }

  /** One published file's contents as text (null when absent or binary-unsafe). */
  readFile(kind: string, name: string, filename: string): string | null {
    const buf = readItemFile(kind, name, filename);
    return buf ? buf.toString("utf8") : null;
  }

  /**
   * Edit an existing item's file by replacing its whole contents. Refuses when
   * the item does not exist, rather than silently creating one under a
   * mistyped name — a publish and an edit are different intentions and a typo
   * should not turn one into the other.
   */
  editFile(kind: string, name: string, filename: string, content: string) {
    const existing = readItem(kind, name);
    if (!existing) {
      throw new Error(`No "${name}" in ${kind} to edit. Publish it first.`);
    }
    return publishAndSync({ kind, name, files: [{ filename, content }] });
  }

  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!input) return null;

    if (/^store$|^list store$|^store catalog$/i.test(input)) {
      const cat = this.catalog();
      const lines = (STORE_KINDS as readonly StoreKind[]).map(k => {
        const items = cat[k];
        return `${STORE_KIND_LABELS[k]}: ${items.length}` +
          (items.length ? ` — ${items.slice(0, 5).map(i => i.name).join(", ")}${items.length > 5 ? ", …" : ""}` : "");
      });
      return { tool: "store", result: lines.join("\n") };
    }

    const show = input.match(/^store\s+show\s+([a-z]+)\s+([A-Za-z0-9._-]+)$/i);
    if (show) {
      const item = this.get(show[1].toLowerCase(), show[2]);
      if (!item) return { tool: "store", result: `No "${show[2]}" in ${show[1]}.` };
      return {
        tool: "store",
        result:
          `${item.title} (${item.kind}/${item.name}) by ${item.author}\n` +
          `${item.description || "(no description)"}\n` +
          `files: ${item.files.map(f => `${f.filename} (${f.bytes}B)`).join(", ")}`,
      };
    }

    return null;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
