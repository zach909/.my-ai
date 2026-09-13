/**
 * The other half of chat-attachments.ts's contract: agent-capabilities.ts's
 * callPlugin()/useBestTool() strip a plugin's `[[ATTACH:<id>]]` marker back
 * out of the visible text and turn it into real ChatAttachment metadata --
 * the one place that convention is interpreted, so a plugin author never
 * has to know how attachments actually reach the browser.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerAttachment } from "../../models && skills/core/chat-attachments.js";
import { buildAgentCapabilities, type AgentHost } from "../../models && skills/core/agent-capabilities.js";

describe("attachment markers are stripped and resolved through callPlugin/useBestTool", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function hostWithPlugin(reply: unknown): AgentHost {
    return {
      pluginRegistry: {
        getPluginInstance: () => ({ onMessage: async () => reply }),
        rankPlugins: () => [{ id: "file-system", score: 1, reason: "test" }],
      },
    };
  }

  it("callPlugin strips the marker from the returned text and pushes real attachment metadata", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-marker-"));
    const file = path.join(tmp, "report.txt");
    writeFileSync(file, "hello");
    const attachment = registerAttachment(file)!;

    const attachments: Array<{ id: string; filename: string; bytes: number }> = [];
    const caps = buildAgentCapabilities(
      hostWithPlugin(`[FileSystem] Sending report.txt for download. [[ATTACH:${attachment.id}]]`),
      attachments,
    );

    const result = await caps.callPlugin!("file-system", "send report.txt");

    expect(result).toBe("[FileSystem] Sending report.txt for download.");
    expect(attachments).toEqual([{ id: attachment.id, filename: "report.txt", bytes: 5 }]);
  });

  it("useBestTool does the same stripping/resolving", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-attachments-marker-"));
    const file = path.join(tmp, "data.bin");
    writeFileSync(file, Buffer.from([1, 2, 3]));
    const attachment = registerAttachment(file)!;

    const attachments: Array<{ id: string; filename: string; bytes: number }> = [];
    const caps = buildAgentCapabilities(
      hostWithPlugin(`[FileSystem] Sending data.bin for download. [[ATTACH:${attachment.id}]]`),
      attachments,
    );

    const chosen = await caps.useBestTool!("send data.bin");

    expect(chosen?.result).toBe("[FileSystem] Sending data.bin for download.");
    expect(attachments).toEqual([{ id: attachment.id, filename: "data.bin", bytes: 3 }]);
  });

  it("an id that no longer resolves is dropped silently, leaving no raw marker text visible", async () => {
    const attachments: Array<{ id: string; filename: string; bytes: number }> = [];
    const caps = buildAgentCapabilities(
      hostWithPlugin("[FileSystem] Sending ghost.txt for download. [[ATTACH:00000000-0000-0000-0000-000000000000]]"),
      attachments,
    );

    const result = await caps.callPlugin!("file-system", "send ghost.txt");

    expect(result).toBe("[FileSystem] Sending ghost.txt for download.");
    expect(attachments).toEqual([]);
  });

  it("text with no marker at all passes through unchanged, with no attachments added", async () => {
    const attachments: Array<{ id: string; filename: string; bytes: number }> = [];
    const caps = buildAgentCapabilities(hostWithPlugin("[FileSystem] doc.txt: exists"), attachments);

    const result = await caps.callPlugin!("file-system", "exists doc.txt");

    expect(result).toBe("[FileSystem] doc.txt: exists");
    expect(attachments).toEqual([]);
  });
});
