import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSystemPlugin } from "../../plugins/file-system.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
});
