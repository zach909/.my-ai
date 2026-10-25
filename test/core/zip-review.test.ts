/**
 * A zip is read back and judged before it goes out: yes, or no + edits + read
 * it again. See models && skills/core/zip-review.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readZip, writeZip } from "../../models && skills/core/zip-archive.js";
import { reviewZip, structuralJudge, type ZipJudge } from "../../models && skills/core/zip-review.js";
import { registerAttachment } from "../../models && skills/core/chat-attachments.js";
import { buildAgentCapabilities, type AgentHost } from "../../models && skills/core/agent-capabilities.js";

let tmp: string;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function makeZip(files: Record<string, string>, name = "out.zip"): string {
  tmp = mkdtempSync(path.join(tmpdir(), "zip-review-"));
  const file = path.join(tmp, name);
  writeFileSync(file, writeZip(Object.entries(files).map(([n, t]) => ({ name: n, data: Buffer.from(t) }))));
  return file;
}

const names = (file: string) => readZip(readFileSync(file)).map(e => e.name).sort();

describe("reviewZip", () => {
  it("approves a sound zip after one read", async () => {
    const file = makeZip({ "a.txt": "hello", "src/b.ts": "export {}" });
    const result = await reviewZip(file);
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(1);
  });

  it("shows the judge what is actually inside, as read from disk", async () => {
    const file = makeZip({ "a.txt": "hello" });
    let seen = "";
    await reviewZip(file, view => { seen = view.entries.map(e => `${e.name}:${e.preview}`).join(); return { verdict: "yes" }; });
    expect(seen).toBe("a.txt:hello");
  });

  it("on no: applies the edits, reads it again from disk, and approves once it is right", async () => {
    const file = makeZip({ "README.md": "TODO", "main.js": "x" });
    const rounds: string[] = [];
    const judge: ZipJudge = view => {
      const readme = view.entries.find(e => e.name === "README.md")?.preview;
      rounds.push(`${view.round}:${readme}`);
      if (readme === "TODO") return { verdict: "no", reasons: ["README is a placeholder"], edits: [{ op: "set", name: "README.md", text: "Real docs" }] };
      return { verdict: "yes" };
    };
    const result = await reviewZip(file, judge);
    expect(rounds).toEqual(["1:TODO", "2:Real docs"]);
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.trace.map(t => t.verdict)).toEqual(["no", "yes"]);
    expect(readZip(readFileSync(file)).find(e => e.name === "README.md")!.data.toString()).toBe("Real docs");
  });

  it("can delete and rename files", async () => {
    const file = makeZip({ "a.txt": "1", "junk.tmp": "2", "old.txt": "3" });
    let first = true;
    await reviewZip(file, () => {
      if (!first) return { verdict: "yes" };
      first = false;
      return { verdict: "no", reasons: ["clean up"], edits: [{ op: "delete", name: "junk.tmp" }, { op: "rename", from: "old.txt", to: "new.txt" }] };
    });
    expect(names(file)).toEqual(["a.txt", "new.txt"]);
  });

  it("does not claim approval when the judge keeps saying no: stops at maxRounds", async () => {
    const file = makeZip({ "a.txt": "1" });
    const result = await reviewZip(
      file,
      () => ({ verdict: "no", reasons: ["not good enough"], edits: [{ op: "set", name: "a.txt", text: "again" }] }),
      { maxRounds: 3 },
    );
    expect(result.approved).toBe(false);
    expect(result.rounds).toBe(3);
    expect(result.notes.join(" ")).toContain("Still not approved after 3 reads");
  });

  it("stops at once, unapproved, when the judge says no but changes nothing", async () => {
    const file = makeZip({ "a.txt": "1" });
    const result = await reviewZip(file, () => ({ verdict: "no", reasons: ["bad"], edits: [] }));
    expect(result.approved).toBe(false);
    expect(result.rounds).toBe(1);
  });

  it("an edit that names a missing file ends the review unapproved and leaves the zip as it was", async () => {
    const file = makeZip({ "a.txt": "1" });
    const before = readFileSync(file);
    const result = await reviewZip(file, () => ({ verdict: "no", reasons: ["x"], edits: [{ op: "delete", name: "nope.txt" }] }));
    expect(result.approved).toBe(false);
    expect(result.notes.join(" ")).toContain("not in the zip");
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("a judge that throws has not approved anything", async () => {
    const file = makeZip({ "a.txt": "1" });
    const result = await reviewZip(file, () => { throw new Error("model offline"); });
    expect(result.approved).toBe(false);
    expect(result.notes[0]).toContain("model offline");
  });

  it("a missing file is not approved", async () => {
    expect((await reviewZip("/no/such/file.zip")).approved).toBe(false);
  });
});

describe("structuralJudge (the default)", () => {
  it("refuses a file that is not a zip", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "zip-review-"));
    const file = path.join(tmp, "fake.zip");
    writeFileSync(file, "this is not a zip at all, just text");
    const result = await reviewZip(file, structuralJudge);
    expect(result.approved).toBe(false);
    expect(result.notes.join(" ")).toContain("not a zip");
  });

  it("refuses an empty zip", async () => {
    const file = makeZip({});
    expect((await reviewZip(file)).approved).toBe(false);
  });

  it("fixes a path that escapes the folder, then approves on the second read", async () => {
    const file = makeZip({ "../../evil.txt": "x", "ok.txt": "y" });
    const result = await reviewZip(file);
    expect(result.approved).toBe(true);
    expect(result.rounds).toBe(2);
    expect(names(file)).toEqual(["evil.txt", "ok.txt"]);
  });
});

describe("a zip handed out through the chat path is reviewed first", () => {
  function host(reply: string, zipJudge?: ZipJudge): AgentHost {
    return {
      zipJudge,
      pluginRegistry: {
        getPluginInstance: () => ({ onMessage: async () => reply }),
        rankPlugins: () => [{ id: "file-system", score: 1, reason: "test" }],
      },
    };
  }

  it("edits it when the judge says no, and says so in the reply and the attachment", async () => {
    const file = makeZip({ "app.js": "console.log(1)", "notes.md": "TODO" });
    const att = registerAttachment(file)!;
    const judge: ZipJudge = view =>
      view.entries.some(e => e.name === "notes.md")
        ? { verdict: "no", reasons: ["notes are a placeholder"], edits: [{ op: "delete", name: "notes.md" }] }
        : { verdict: "yes" };
    const sink: Array<{ id: string; filename: string; bytes: number; review?: { approved: boolean; rounds: number } }> = [];
    const caps = buildAgentCapabilities(host(`Sending out.zip. [[ATTACH:${att.id}]]`, judge), sink);

    const text = await caps.callPlugin!("file-system", "send out.zip");

    expect(text).toContain("out.zip: checked after 2 reads and approved.");
    expect(sink[0].review).toMatchObject({ approved: true, rounds: 2 });
    expect(names(file)).toEqual(["app.js"]);
    expect(sink[0].bytes).toBe(readFileSync(file).length);
  });

  it("says plainly when it could not be verified", async () => {
    const file = makeZip({ "a.txt": "1" });
    const att = registerAttachment(file)!;
    const caps = buildAgentCapabilities(host(`Sending. [[ATTACH:${att.id}]]`, () => ({ verdict: "no", reasons: ["wrong"], edits: [] })), []);
    const text = (await caps.callPlugin!("file-system", "send out.zip")) as string;
    expect(text).toContain("NOT verified");
  });

  it("does not touch a file that is not a zip", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "zip-review-"));
    const file = path.join(tmp, "notes.txt");
    writeFileSync(file, "plain");
    const att = registerAttachment(file)!;
    let called = false;
    const caps = buildAgentCapabilities(host(`Sending. [[ATTACH:${att.id}]]`, () => { called = true; return { verdict: "yes" }; }), []);
    const text = await caps.callPlugin!("file-system", "send notes.txt");
    expect(called).toBe(false);
    expect(text).toBe("Sending.");
    expect(existsSync(file)).toBe(true);
  });
});
