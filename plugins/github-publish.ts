/**
 * GithubPublishPlugin — pushing something public to GitHub with no sign-up
 * and no sign-in.
 *
 * The store (store.ts / store-sync.ts) already does the real work this needs:
 * publishAndSync() writes files into `store/`, commits them, and pushes --
 * using the git identity this machine's deployment already has, the same one
 * that already pushes wiki edits and every other store item. Nobody who
 * publishes through it has ever needed a GitHub account, a token, or a
 * browser OAuth redirect, because the PERSON publishing and the CREDENTIAL
 * doing the pushing are different things: the credential belongs to the
 * deployment, not to them.
 *
 * What that mechanism does not do is:
 *
 *   1. Say so. A publish through /api/store returns a commit outcome
 *      (committed/pushed/branch) -- true, but not something a person can DO
 *      anything with. This hands back the actual github.com URL the content
 *      landed at, built from the remote git was pushed to (github-link.ts),
 *      or a plain reason it could not.
 *
 *   2. Refuse a third-party model's weights. "Do not redistribute
 *      third-party model weights" is a standing rule of this project and
 *      nothing in store.ts enforces it -- store.ts's own "binaries" kind is
 *      for skills this agent trained itself, which is a different case. A
 *      person pushing "their public stuff" through THIS door is publishing
 *      to GitHub specifically, so the check belongs here rather than
 *      loosened onto every store publish.
 *
 * Nothing here creates a repository, requests a token, or talks to the
 * GitHub API. It writes files, uses git, and reads back the URL git's own
 * remote implies -- the same three things a person could do by hand if they
 * had this machine's credentials, which they never need to.
 */

import path from "node:path";
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { publishAndSync, itemDir, StoreError, type StoreFile } from "../models && skills/core/store.js";
import { githubDirUrl, githubFileUrl } from "../models && skills/core/github-link.js";

/**
 * Extensions that mean "this file is a trained model's weights", not source
 * or a document. Checked against the filename only -- content sniffing every
 * upload would be its own can of false positives, and a renamed weight file
 * is a determined attempt this check was never going to catch anyway. It
 * catches the ordinary case: someone drags a .safetensors file in because it
 * is "their public stuff" without meaning "a model I did not train".
 */
const WEIGHT_EXTENSIONS = [
  ".safetensors", ".gguf", ".ggml", ".bin", ".ckpt", ".pt", ".pth",
  ".onnx", ".h5", ".pb", ".msgpack", ".npz", ".mlmodel",
];

function looksLikeWeights(filename: string): boolean {
  const lower = filename.toLowerCase();
  return WEIGHT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export interface GithubPublishResult {
  /** True only when the content actually reached GitHub. */
  pushed: boolean;
  /** The browsable URL, when one could be resolved. */
  url: string | null;
  /** Why not, when pushed is false or url is null. */
  reason?: string;
  branch?: string;
  files: string[];
}

export class GithubPublishPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  /**
   * Push files to GitHub. `name` becomes the path they live under; anyone
   * with the resulting URL (or anyone who clones the repo) can see them --
   * "public stuff", exactly as asked for. No credential is read from or
   * asked of the caller anywhere in this call.
   */
  async push(input: {
    name: string;
    title?: string;
    description?: string;
    /** A free-form label, e.g. what the publisher wants to be called. Never verified -- see StoreItem.author. */
    author?: string;
    files: StoreFile[];
  }): Promise<GithubPublishResult> {
    // StoreError, not a plain Error: everything this method itself refuses is
    // exactly the same KIND of failure publishAndSync() below refuses with
    // (a caller mistake, not a server fault), and sharing the type lets one
    // check at the HTTP layer treat both the same way instead of pattern-
    // matching error text.
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new StoreError("Nothing to push -- at least one file is required.");
    }
    const weighty = input.files.filter(f => looksLikeWeights(f.filename));
    if (weighty.length > 0) {
      throw new StoreError(
        `Refusing to publish ${weighty.map(f => f.filename).join(", ")}: this looks like model weights, ` +
        `and this project does not redistribute third-party model weights. Push source, documents, or a ` +
        `skill this agent trained itself (the store's own "binaries" section) instead.`,
      );
    }

    // "files" kind: the general-purpose public bucket, not "source" (code
    // meant to run as part of the agent) or "binaries" (this agent's own
    // trained skills) -- pushing arbitrary public stuff is closer to what
    // "files" already means than either of those.
    const { item, sync } = await publishAndSync({
      kind: "files",
      name: input.name,
      title: input.title,
      description: input.description,
      author: input.author,
      files: input.files,
    });

    const filenames = item.files.map(f => f.filename);
    if (!sync.pushed) {
      return { pushed: false, url: null, reason: sync.reason, branch: sync.branch, files: filenames };
    }

    const dir = itemDir(item.kind, item.name);
    const link = filenames.length === 1
      ? await githubFileUrl(path.join(dir, filenames[0]), sync.branch!)
      : await githubDirUrl(dir, sync.branch!);

    return { pushed: true, url: link.url, reason: link.reason, branch: sync.branch, files: filenames };
  }

  describeCapabilities() {
    return {
      commands: ["push to github", "github push", "publish to github"],
      verbs: ["push", "publish", "share", "upload"],
      nouns: ["github", "repo", "repository", "link"],
    };
  }

  /**
   * Chat surface: "github push <name> <filename>\n<content>", the same
   * shape StorePlugin's chat command uses for the same reason -- a command
   * language that cannot express file contents can only manage things
   * someone else already uploaded.
   */
  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!input) return null;

    const pushCmd = /^(?:github\s+push|push\s+to\s+github|publish\s+to\s+github)\s+([A-Za-z0-9._-]+)\s+(\S+)\s*\n([\s\S]*)$/i.exec(input);
    if (pushCmd) {
      const [, name, filename, content] = pushCmd;
      try {
        const result = await this.push({ name, files: [{ filename, content }] });
        if (!result.pushed) {
          return { tool: "github-publish", result: `Saved, but not on GitHub yet: ${result.reason ?? "unknown reason"}.` };
        }
        return {
          tool: "github-publish",
          result: result.url
            ? `Pushed. ${result.url}`
            : `Pushed to ${result.branch ?? "the repository"}, but could not build a link: ${result.reason ?? ""}`,
        };
      } catch (err) {
        return { tool: "github-publish", result: err instanceof Error ? err.message : String(err) };
      }
    }

    if (/^(?:github\s+push|push\s+to\s+github|publish\s+to\s+github)\b/i.test(input) && !pushCmd) {
      return {
        tool: "github-publish",
        result:
          "To push, put the file on the lines after the command:\n" +
          "github push <name> <filename>\n<the file contents>\n\n" +
          "No GitHub account needed -- this pushes through the app's own credentials.",
      };
    }

    return null;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
