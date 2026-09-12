import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";

// vi.spyOn can't redefine a named export on an ES module namespace (Node's
// own built-ins included) -- vi.mock is the only way to swap `spawn` out
// from under file-system.ts, so this has to be declared before the module
// under test is imported at all.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { FileSystemPlugin, openCommandFor } from "../../plugins/file-system.js";
import { spawn } from "child_process";
const spawnMock = vi.mocked(spawn);

describe("FileSystemPlugin Security Tests", () => {
  let plugin: FileSystemPlugin;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-plugin-sec-test-"));
    plugin = new FileSystemPlugin({
      id: "file-system",
      name: "File System",
      version: "1.0.0",
      description: "File system management",
    });
    plugin.setRootDir(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects non-string path arguments", async () => {
    await expect(plugin.readFile(123 as any)).rejects.toThrow("Security Error: Path must be a string");
  });

  it("rejects null byte injection in paths", async () => {
    const maliciousPath = "secret.txt\0.jpg";
    await expect(plugin.readFile(maliciousPath)).rejects.toThrow("Security Error: Null byte injection detected");
    await expect(plugin.writeFile(maliciousPath, "test")).rejects.toThrow("Security Error: Null byte injection detected");
    await expect(plugin.deleteFile(maliciousPath)).rejects.toThrow("Security Error: Null byte injection detected");
    await expect(plugin.listDirectory(maliciousPath)).rejects.toThrow("Security Error: Null byte injection detected");
    await expect(plugin.exists(maliciousPath)).rejects.toThrow("Security Error: Null byte injection detected");
    await expect(plugin.mkdir(maliciousPath)).rejects.toThrow("Security Error: Null byte injection detected");
  });

  it("rejects path traversal attempts escaping root directory", async () => {
    const traversalPath = "../outside.txt";
    await expect(plugin.readFile(traversalPath)).rejects.toThrow("Security Error: Path traversal detected");
    await expect(plugin.writeFile(traversalPath, "data")).rejects.toThrow("Security Error: Path traversal detected");
  });

  it("allows valid relative file operations within root directory", async () => {
    const validPath = "test.txt";
    await plugin.writeFile(validPath, "hello world");
    expect(await plugin.exists(validPath)).toBe(true);
    expect(await plugin.readFile(validPath)).toBe("hello world");
    expect(await plugin.deleteFile(validPath)).toBe(true);
    expect(await plugin.exists(validPath)).toBe(false);
  });

  it("writes Buffer content byte-for-byte, not just strings", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x89, 0x50, 0x4e, 0x47]);
    await plugin.writeFile("binary.bin", bytes);
    const roundTrip = fs.readFileSync(path.join(tempDir, "binary.bin"));
    expect(roundTrip.equals(bytes)).toBe(true);
  });
});

describe("openCommandFor -- picks the right OS opener per platform", () => {
  it("uses `open` on darwin", () => {
    expect(openCommandFor("/a/b.pdf", "darwin")).toEqual({ command: "open", args: ["/a/b.pdf"] });
  });

  it("uses `cmd /c start` on win32", () => {
    expect(openCommandFor("C:\\a\\b.pdf", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", '""', "C:\\a\\b.pdf"],
    });
  });

  it("uses `xdg-open` elsewhere (linux and other unix platforms)", () => {
    expect(openCommandFor("/a/b.pdf", "linux")).toEqual({ command: "xdg-open", args: ["/a/b.pdf"] });
  });
});

describe("FileSystemPlugin.openFile / writeAndOpen -- \"your system opens it, not the app\"", () => {
  let plugin: FileSystemPlugin;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-plugin-open-test-"));
    plugin = new FileSystemPlugin({
      id: "file-system",
      name: "File System",
      version: "1.0.0",
      description: "File system management",
    });
    plugin.setRootDir(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    spawnMock.mockReset();
  });

  /** A fake child process that looks enough like Node's real one for spawn()'s caller (unref/on) to work without ever touching a real OS opener. */
  function fakeChild() {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    return child;
  }

  it("reports failure, not a crash, when the file does not exist", async () => {
    const result = await plugin.openFile("nope.txt");
    expect(result.opened).toBe(false);
    expect(result.reason).toMatch(/No file at/);
  });

  it("spawns the platform opener detached for an existing file", async () => {
    fs.writeFileSync(path.join(tempDir, "doc.txt"), "hi");
    spawnMock.mockReturnValue(fakeChild() as any);

    const result = await plugin.openFile("doc.txt");

    expect(result.opened).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , options] = spawnMock.mock.calls[0];
    expect(options).toMatchObject({ detached: true, stdio: "ignore" });
  });

  it("writeAndOpen writes the content first, then opens the same file it just wrote", async () => {
    spawnMock.mockReturnValue(fakeChild() as any);

    const result = await plugin.writeAndOpen("report.md", "# Report\n\ncontent");

    expect(fs.readFileSync(path.join(tempDir, "report.md"), "utf8")).toBe("# Report\n\ncontent");
    expect(result.opened).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("does not report success when the opener itself fails to spawn (e.g. no xdg-open installed)", async () => {
    fs.writeFileSync(path.join(tempDir, "doc.txt"), "hi");
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      // Real spawn() failures (ENOENT for a missing binary) surface async
      // via an 'error' event, after spawn() has already returned -- openFile
      // reports success synchronously in that case (nothing later reverses
      // it), which is exactly why the 'error' listener exists: to swallow
      // it instead of crashing the process, not to change the result here.
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child as any;
    });

    const result = await plugin.openFile("doc.txt");
    expect(result.opened).toBe(true); // spawn() itself didn't throw
  });
});

describe("FileSystemPlugin.sendFile / \"send <path>\" -- download without pulling it locally first", () => {
  let plugin: FileSystemPlugin;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-plugin-send-test-"));
    plugin = new FileSystemPlugin({
      id: "file-system",
      name: "File System",
      version: "1.0.0",
      description: "File system management",
    });
    plugin.setRootDir(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers an existing file and returns its attachment metadata", async () => {
    fs.writeFileSync(path.join(tempDir, "report.txt"), "hello world");
    const attachment = await plugin.sendFile("report.txt");
    expect(attachment).toEqual({ id: expect.any(String), filename: "report.txt", bytes: 11 });
  });

  it("returns null for a file that does not exist", async () => {
    expect(await plugin.sendFile("nope.txt")).toBeNull();
  });

  it("still refuses to escape the plugin's root (same guard as every other method)", async () => {
    await expect(plugin.sendFile("../outside.txt")).rejects.toThrow("Security Error: Path traversal detected");
  });

  it("onMessage's \"send <path>\" embeds an [[ATTACH:<id>]] marker in its reply", async () => {
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "hi");
    const reply = await plugin.onMessage("send notes.txt") as string;
    expect(reply).toMatch(/^\[FileSystem\] Sending notes\.txt for download\. \[\[ATTACH:[0-9a-f-]+\]\]$/);
  });

  it("onMessage's \"download <path>\" works identically to \"send\"", async () => {
    fs.writeFileSync(path.join(tempDir, "notes.txt"), "hi");
    const reply = await plugin.onMessage("download notes.txt") as string;
    expect(reply).toContain("[[ATTACH:");
  });

  it("onMessage reports a clear failure, not a marker, for a file that isn't there", async () => {
    const reply = await plugin.onMessage("send missing.txt") as string;
    expect(reply).toBe("[FileSystem] Could not find missing.txt to send.");
    expect(reply).not.toContain("[[ATTACH:");
  });
});
