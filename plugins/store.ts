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
import {
  installPromptingSkill,
  listInstalled,
  loadRegistry,
  publishPromptingSkill,
} from "../models && skills/core/prompting-skill-store.js";
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
import {
  installItem,
  isInstalled,
  listInstalledItems,
  outdatedInstalls,
  uninstallItem,
  updateInstalls,
} from "../models && skills/core/store-install.js";

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
  /**
   * Read a published file, downloading it first if this device does not have
   * it.
   *
   * Fetch-aware on purpose: the store now shows every item while holding only
   * the files someone clicked, so an agent restricted to already-downloaded
   * files could only edit the handful it happened to have. Editing anything in
   * the catalogue is the point.
   */
  async readFile(kind: string, name: string, filename: string): Promise<string | null> {
    const local = readItemFile(kind, name, filename);
    if (local) return local.toString("utf8");
    try {
      const { fetchItemFile } = await import("../models && skills/core/store-fetch.js");
      const { buf } = await fetchItemFile(kind, name, filename);
      return buf.toString("utf8");
    } catch {
      // Unreachable or genuinely absent: null either way, and the caller has
      // to handle "no content" regardless.
      return null;
    }
  }

  /**
   * Edit an existing item's file by replacing its whole contents. Refuses when
   * the item does not exist, rather than silently creating one under a
   * mistyped name — a publish and an edit are different intentions and a typo
   * should not turn one into the other.
   */
  async editFile(kind: string, name: string, filename: string, content: string) {
    // async, so the refusal REJECTS rather than throwing synchronously out of a
    // method that otherwise returns a promise -- a caller using .catch() would
    // miss a synchronous throw entirely.
    const existing = readItem(kind, name);
    if (!existing) {
      throw new Error(`No "${name}" in ${kind} to edit. Publish it first.`);
    }
    return publishAndSync({ kind, name, files: [{ filename, content }] });
  }

  /**
   * Add or replace a single file on an existing item, leaving its other files
   * alone.
   *
   * publishAndSync() merges rather than replaces, so this and editFile() are
   * the same underlying operation with different intentions in front of them:
   * editFile refuses when the item is missing, addFile does not, because
   * adding a file to something you are still assembling is normal.
   */
  addFile(kind: string, name: string, filename: string, content: string, encoding: "utf8" | "base64" = "utf8") {
    return publishAndSync({ kind, name, files: [{ filename, content, encoding }] });
  }

  /**
   * Change an item's description without touching its files.
   *
   * Small, but the alternative was re-publishing every file to fix a typo in a
   * sentence, which is how catalogue text stops getting corrected.
   */
  async describe(kind: string, name: string, fields: { title?: string; description?: string }) {
    // async for the same reason as editFile above.
    const existing = readItem(kind, name);
    if (!existing) throw new Error(`No "${name}" in ${kind} to describe.`);
    return publishAndSync({ kind, name, ...fields, files: [] });
  }

  /**
   * Bring a published item onto this device: download every file it has and
   * record what was installed.
   *
   * Installing is deliberately separate from browsing and from publishing.
   * Nothing installs itself -- this only runs because something asked for it.
   */
  install(kind: string, name: string) {
    return installItem(kind, name);
  }

  /** Remove this device's copy. Open, because it destroys nobody else's work. */
  uninstall(kind: string, name: string) {
    return uninstallItem(kind, name);
  }

  /** Everything installed on this device, newest first. */
  installed() {
    return listInstalledItems();
  }

  /** Installed items the store has moved on from, and what changed. */
  outdated() {
    return outdatedInstalls();
  }

  /** Reinstall everything that has moved on. */
  update() {
    return updateInstalls();
  }

  /**
   * Publish a prompting skill -- one of the modular functions the agent calls
   * inside its own perceive-think-act loop.
   *
   * This is the agent writing down how it works so other people's agents can
   * work that way too. Publishing shares the document with everyone who pulls;
   * it does not install it on anyone's machine, including this one.
   */
  publishPromptingSkill(skill: unknown) {
    return publishPromptingSkill(skill);
  }

  /**
   * Install (or edit) a prompting skill on THIS machine, changing how this
   * agent's own loop behaves from the next iteration on. Re-installing under
   * an existing name is how an edit takes effect.
   */
  installPromptingSkill(skill: unknown) {
    return installPromptingSkill(skill);
  }

  /** Every prompting skill this agent is currently running with, in run order. */
  promptingSkills() {
    return { installed: listInstalled(), active: loadRegistry().all() };
  }

  /**
   * What this plug-in handles. The command list is what makes "store install
   * skills X" route here decisively rather than competing on word overlap with
   * whatever else happens to mention "install".
   */
  describeCapabilities() {
    return {
      commands: [
        "store", "store show", "store install", "store uninstall", "store installed",
        "store outdated", "store update", "store updates", "store publish",
        "store describe", "store read", "store get", "list store", "store catalog",
      ],
      verbs: ["publish", "install", "uninstall", "download", "upload", "share", "catalog"],
      nouns: ["store", "skill", "plugin", "package", "item", "marketplace"],
    };
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
      const kind = show[1].toLowerCase();
      const item = this.get(kind, show[2]);
      if (!item) return { tool: "store", result: `No "${show[2]}" in ${show[1]}.` };
      const here = isInstalled(kind, item.name);
      return {
        tool: "store",
        result:
          `${item.title} (${item.kind}/${item.name}) by ${item.author}\n` +
          `${item.description || "(no description)"}\n` +
          `files: ${item.files.map(f => `${f.filename} (${f.bytes}B)${f.local ? "" : " — not downloaded"}`).join(", ")}\n` +
          (here ? "installed on this device" : `not installed — "store install ${item.kind} ${item.name}" to install it`),
      };
    }

    // Publishing from a message. The first line names where it goes, and
    // everything after it is the file -- a store command language that cannot
    // express file contents can only ever manage things somebody else
    // uploaded, which is half a store.
    const publishHead = input.match(/^store\s+publish\s+([a-z]+)\s+([A-Za-z0-9._-]+)\s+(\S+)\s*\n([\s\S]*)$/i);
    if (publishHead) {
      const [, kind, name, filename, content] = publishHead;
      try {
        const { item, sync } = await this.publish({
          kind: kind.toLowerCase(),
          name,
          files: [{ filename, content }],
        });
        return {
          tool: "store",
          result:
            `Published ${item.kind}/${item.name} — ${filename} (${content.length} bytes).\n` +
            // Said plainly, because "saved" and "everyone has it" are
            // different outcomes and only one of them is publishing.
            (sync.pushed
              ? `Pushed${sync.branch ? ` to ${sync.branch}` : ""}. Anyone who pulls now gets it.`
              : `Saved on this device only — ${sync.reason ?? "it has not reached anyone else yet"}.`),
        };
      } catch (err) {
        return { tool: "store", result: err instanceof Error ? err.message : String(err) };
      }
    }

    // The same shape without a filename is the mistake worth catching: it
    // would otherwise fall through to null and look like the plug-in simply
    // did not understand, when the request was nearly right.
    if (/^store\s+publish\b/i.test(input) && !publishHead) {
      return {
        tool: "store",
        result:
          'To publish, put the file on the lines after the command:\n' +
          'store publish <kind> <name> <filename>\n<the file contents>\n\n' +
          `Kinds: ${(STORE_KINDS as readonly StoreKind[]).join(", ")}.`,
      };
    }

    const describe = input.match(/^store\s+describe\s+([a-z]+)\s+([A-Za-z0-9._-]+)\s+([\s\S]+)$/i);
    if (describe) {
      try {
        const { item } = await this.describe(describe[1].toLowerCase(), describe[2], {
          description: describe[3].trim(),
        });
        return { tool: "store", result: `Updated the description of ${item.kind}/${item.name}.` };
      } catch (err) {
        return { tool: "store", result: err instanceof Error ? err.message : String(err) };
      }
    }

    // Installing is a real change to this machine, so it needs an explicit
    // sentence naming the item. Nothing here installs on a vague request.
    const install = input.match(/^store\s+install\s+([a-z]+)\s+([A-Za-z0-9._-]+)$/i);
    if (install) {
      try {
        const { record, downloaded, missing } = await this.install(install[1].toLowerCase(), install[2]);
        const notes = [
          `Installed ${record.kind}/${record.name} (${record.files.length} file${record.files.length === 1 ? "" : "s"}).`,
          downloaded.length ? `Downloaded: ${downloaded.join(", ")}.` : "Everything was already on this device.",
          // Reported rather than swallowed: a partial install that looks
          // complete is how someone discovers the missing piece at the worst
          // possible moment.
          missing.length ? `Could not get: ${missing.map(m => m.filename).join(", ")}.` : "",
        ].filter(Boolean);
        return { tool: "store", result: notes.join("\n") };
      } catch (err) {
        return { tool: "store", result: err instanceof Error ? err.message : String(err) };
      }
    }

    const uninstall = input.match(/^store\s+uninstall\s+([a-z]+)\s+([A-Za-z0-9._-]+)$/i);
    if (uninstall) {
      const kind = uninstall[1].toLowerCase();
      const gone = this.uninstall(kind, uninstall[2]);
      return {
        tool: "store",
        result: gone
          ? `Removed this device's copy of ${kind}/${uninstall[2]}. It is still published for everyone else.`
          : `${kind}/${uninstall[2]} is not installed here.`,
      };
    }

    if (/^store\s+installed$/i.test(input)) {
      const items = this.installed();
      if (items.length === 0) return { tool: "store", result: "Nothing from the store is installed on this device." };
      return {
        tool: "store",
        result: items
          .map(r => `${r.kind}/${r.name} — ${r.title} (${r.files.length} files, installed ${new Date(r.installedAt).toLocaleDateString()})`)
          .join("\n"),
      };
    }

    if (/^store\s+(outdated|updates?)$/i.test(input)) {
      const out = this.outdated();
      if (out.length === 0) return { tool: "store", result: "Everything installed is up to date." };
      return {
        tool: "store",
        result: out.map(o => `${o.record.kind}/${o.record.name} — published ${o.published.updatedAt}, installed ${o.record.installedVersion}`).join("\n"),
      };
    }

    if (/^store\s+update$/i.test(input)) {
      const { updated, failed } = await this.update();
      if (updated.length === 0 && failed.length === 0) {
        return { tool: "store", result: "Everything installed is already up to date." };
      }
      return {
        tool: "store",
        result: [
          updated.length ? `Updated: ${updated.map(r => `${r.kind}/${r.name}`).join(", ")}.` : "",
          failed.length ? `Failed: ${failed.map(f => `${f.kind}/${f.name} (${f.reason})`).join("; ")}.` : "",
        ].filter(Boolean).join("\n"),
      };
    }

    // Reading a file downloads it first when this device does not have it,
    // which is what makes editing anything in the catalogue possible rather
    // than only the handful already here.
    const read = input.match(/^store\s+(?:read|get)\s+([a-z]+)\s+([A-Za-z0-9._-]+)\s+(\S+)$/i);
    if (read) {
      const text = await this.readFile(read[1].toLowerCase(), read[2], read[3]);
      return {
        tool: "store",
        result: text === null ? `Could not read "${read[3]}" from ${read[1]}/${read[2]}.` : text.slice(0, 4000),
      };
    }

    return null;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
