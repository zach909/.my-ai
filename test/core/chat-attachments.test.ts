/**
 * "I wanted to download those files, not pull them as needed" -- the
 * registry a chat turn uses to hand the browser a real file, plus the
 * [[ATTACH:<id>]] marker convention agent-capabilities.ts strips out of a
 * plugin's text reply. See chat-attachments.ts's own doc comment for why
 * this exists as a side-channel rather than a pipeline-wide type change.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerAttachment, resolveAttachment, attachmentMetadata } from "../../models && skills/core/chat-attachments.js";

describe("registerAttachment / resolveAttachment / attachmentMetadata", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("registers a real file and resolves it back by id", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-"));
    const file = path.join(tmp, "report.txt");
    writeFileSync(file, "hello world");

    const attachment = registerAttachment(file);
    expect(attachment).not.toBeNull();
    expect(attachment!.filename).toBe("report.txt");
    expect(attachment!.bytes).toBe(11);

    const resolved = resolveAttachment(attachment!.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.absPath).toBe(file);
    expect(resolved!.filename).toBe("report.txt");
  });

  it("attachmentMetadata round-trips the same id back into ChatAttachment shape", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-"));
    const file = path.join(tmp, "data.bin");
    writeFileSync(file, Buffer.from([1, 2, 3, 4, 5]));

    const attachment = registerAttachment(file);
    const meta = attachmentMetadata(attachment!.id);
    expect(meta).toEqual({ id: attachment!.id, filename: "data.bin", bytes: 5 });
  });

  it("returns null for a path that does not exist", () => {
    expect(registerAttachment("/definitely/does/not/exist/anywhere.txt")).toBeNull();
  });

  it("returns null for a directory, not just a missing path", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-"));
    expect(registerAttachment(tmp)).toBeNull();
  });

  it("returns null for an id that was never registered", () => {
    expect(resolveAttachment("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(attachmentMetadata("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("stops resolving once the underlying file is removed from disk", () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-"));
    const file = path.join(tmp, "gone.txt");
    writeFileSync(file, "temporary");
    const attachment = registerAttachment(file);
    rmSync(file);
    expect(resolveAttachment(attachment!.id)).toBeNull();
  });
});
