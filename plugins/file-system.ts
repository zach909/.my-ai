import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { registerAttachment } from "../models && skills/core/chat-attachments.js";

/**
 * The command that hands a file to whatever program the OS has registered
 * for its type -- macOS's `open`, Windows' `start` (via cmd, which is how
 * `start` is actually invoked -- it isn't its own executable), and `xdg-open`
 * everywhere else (every mainstream Linux desktop ships it, wired to
 * whatever the desktop environment's own file-type associations are).
 * Exported (not inlined into openFile) so a test can assert the right
 * command gets picked per platform without actually spawning anything.
 */
export function openCommandFor(filePath: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [filePath] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", '""', filePath] };
  return { command: "xdg-open", args: [filePath] };
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

export class FileSystemPlugin extends BasePlugin {
  private rootDir: string = process.cwd();

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  setRootDir(dir: string): void {
    this.rootDir = dir;
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    return fs.readFileSync(fullPath, "utf-8");
  }

  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Buffer content (images, PDFs, zips, any binary response file) must
    // reach disk byte-for-byte -- passing an encoding for a Buffer is a
    // silent no-op in Node, but being explicit here means the string path
    // (the original, still-common case) keeps its exact prior behavior.
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(fullPath, content);
    } else {
      fs.writeFileSync(fullPath, content, "utf-8");
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      return false;
    }
    fs.unlinkSync(fullPath);
    return true;
  }

  async listDirectory(dirPath: string): Promise<FileEntry[]> {
    const fullPath = this.resolvePath(dirPath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    return entries.map((entry) => {
      const entryPath = path.join(fullPath, entry.name);
      const stats = fs.statSync(entryPath);
      return {
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        modifiedAt: stats.mtime,
      };
    });
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.existsSync(fullPath);
  }

  async mkdir(dirPath: string, recursive: boolean = true): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    fs.mkdirSync(fullPath, { recursive });
  }

  /**
   * Hands a file to the OS to open with whatever program owns its type --
   * "you will see it by having your system open it, not the app." This is
   * a local-first app: the backend process is already running on the
   * user's own machine, so unlike a browser page (which can never launch a
   * program on the user's computer) this can genuinely just shell out to
   * the platform's own opener. Detached and unref'd so the opened program
   * outlives this request and this process never waits on it.
   */
  async openFile(filePath: string): Promise<{ opened: boolean; reason?: string }> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      return { opened: false, reason: `No file at ${filePath}.` };
    }
    const { command, args } = openCommandFor(fullPath);
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      // A missing opener (e.g. no xdg-open on a headless box) fails async,
      // after spawn() has already returned -- without this listener that
      // becomes an unhandled 'error' event that can crash the process.
      child.on("error", () => {});
      child.unref();
      return { opened: true };
    } catch (err) {
      return { opened: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Save a response file and immediately open it -- the concrete "any
   * response file type... auto-open on arrival" path: content the AI
   * produces lands on disk under the plugin's root and is handed straight
   * to the system's default app for that type, rather than rendered or
   * previewed inside NeuroClaw's own UI.
   */
  async writeAndOpen(filePath: string, content: string | Buffer): Promise<{ opened: boolean; reason?: string }> {
    await this.writeFile(filePath, content);
    return this.openFile(filePath);
  }

  /**
   * Registers a file for the CHAT UI itself to download -- "I wanted to
   * download those files, not pull them as needed": the browser downloads
   * it the instant this reply arrives, rather than a link someone has to
   * separately click and fetch. openFile()/writeAndOpen() above hand a
   * file to the OS on THIS (the backend's) machine, which only helps when
   * the browser and the backend are the same computer; this works over a
   * network too, since it's the browser doing the actual downloading.
   * Returns null (never throws) for a path that doesn't exist -- see
   * chat-attachments.ts's own doc comment.
   */
  async sendFile(filePath: string): Promise<{ id: string; filename: string; bytes: number } | null> {
    const fullPath = this.resolvePath(filePath);
    return registerAttachment(fullPath);
  }

  private resolvePath(relativePath: string): string {
    if (typeof relativePath !== "string") {
      throw new Error("Security Error: Path must be a string");
    }
    if (relativePath.includes("\0")) {
      throw new Error(
        `Security Error: Null byte injection detected in path: ${relativePath}`
      );
    }
    const absoluteRoot = path.resolve(this.rootDir);
    const fullPath = path.resolve(absoluteRoot, relativePath);

    const relative = path.relative(absoluteRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Security Error: Path traversal detected for path: ${relativePath}`
      );
    }
    return fullPath;
  }

  /**
   * How someone would ASK for this, not what the plugin calls itself.
   *
   * Added after the agent exam measured routing and found this plugin
   * unreachable for the obvious phrasing: the only terms available were its id
   * and its manifest capabilities, so a request had to contain the plugin's
   * own name to find it.
   */
  describeCapabilities() {
    return {
      verbs: ["open", "save", "send", "download"],
      nouns: ["file", "folder", "directory", "disk", "document", "path"],
    };
  }

  override async onMessage(message: unknown): Promise<unknown> {
    // Case-insensitive on the command keyword only -- lowercasing the whole
    // input previously mangled the extracted path too (`MyDir/MyFile.TXT`
    // became `mydir/myfile.txt`), breaking every case-sensitive path on a
    // case-sensitive filesystem.
    const input = String(message).trim();
    // read <path>
    const readMatch = input.match(/\bread\s+(\S+)/i);
    if (readMatch?.[1]) {
      try {
        const content = await this.readFile(readMatch[1]);
        return `[FileSystem] ${readMatch[1]}: ${content.slice(0, 200)}`;
      } catch { return `[FileSystem] Cannot read ${readMatch[1]}`; }
    }
    // list <path>
    const listMatch = input.match(/\blist\s+(\S+)/i);
    if (listMatch?.[1]) {
      const entries = await this.listDirectory(listMatch[1]);
      if (entries.length === 0) return `[FileSystem] Empty or not found: ${listMatch[1]}`;
      return `[FileSystem] ${listMatch[1]}: ${entries.slice(0, 10).map(e => e.name).join(', ')}`;
    }
    // exists <path>
    const existsMatch = input.match(/\bexists?\s+(\S+)/i);
    if (existsMatch?.[1]) {
      const ok = await this.exists(existsMatch[1]);
      return `[FileSystem] ${existsMatch[1]}: ${ok ? 'exists' : 'not found'}`;
    }
    // open <path> -- describeCapabilities() has advertised "open" as one of
    // this plugin's verbs from the start; nothing here actually implemented
    // it until now, so a request routed here for it fell through to `null`.
    const openMatch = input.match(/\bopen\s+(\S+)/i);
    if (openMatch?.[1]) {
      const result = await this.openFile(openMatch[1]);
      return result.opened
        ? `[FileSystem] Opened ${openMatch[1]} with your system's default app.`
        : `[FileSystem] Could not open ${openMatch[1]}: ${result.reason}`;
    }
    // send/download <path> -- "download those files, not pull them as
    // needed". The [[ATTACH:<id>]] marker is agent-capabilities.ts's own
    // convention (see chat-attachments.ts's doc comment): it strips this
    // back out of the visible text and turns it into real attachment
    // metadata on BotResponse, so a browser downloads the actual file
    // instead of ever seeing this marker itself.
    const sendMatch = input.match(/\b(?:send|download)\s+(\S+)/i);
    if (sendMatch?.[1]) {
      const attachment = await this.sendFile(sendMatch[1]);
      return attachment
        ? `[FileSystem] Sending ${sendMatch[1]} for download. [[ATTACH:${attachment.id}]]`
        : `[FileSystem] Could not find ${sendMatch[1]} to send.`;
    }
    return null;
  }
}
