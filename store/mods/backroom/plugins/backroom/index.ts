/**
 * Backroom, wired to a real NeuroClaw system. Ships as a mod: it only adds
 * files, and changes nothing in core. See docs/BACKROOM.md and engine.ts.
 *
 * NeuroClaw's side is answered here with llm.generate(), which is generation
 * only. NeuroclawSystem.askOneBrain() is deliberately not used: it reads
 * ``run `ls` `` as a command, and this text comes from another model.
 */
import { ONE_BRAIN_SILENT_REPLY } from "../../models && skills/llm.js";
import {
  Backroom,
  createOllamaChat,
  normalizeOllamaUrl,
  type BackroomConfig,
  type BackroomDeps,
} from "./engine.js";

export { Backroom, createOllamaChat, normalizeOllamaUrl } from "./engine.js";

/** The parts of NeuroclawSystem the backroom uses. */
export interface BackroomSystem {
  llm: {
    generate(input: string, options?: { deadlineMs?: number; memoryContext?: string[] }): Promise<string>;
    learnText(text: string): Promise<void>;
  };
  memory: { remember(content: string, opts?: { tags?: string[]; importance?: number }): unknown };
}

export interface BackroomOptions extends Partial<BackroomConfig> {
  url?: string;
  model?: string;
  /** How long NeuroClaw may take to answer one line. */
  replyDeadlineMs?: number;
  publish?: BackroomDeps["publish"] | false;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function looksLikeText(text: string): boolean {
  let printable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127 && code !== 0xfffd)) printable++;
  }
  return printable / Math.max(1, [...text].length) >= 0.9;
}

/** The brain's own words from a generate() reply, or null for silence and non-text bytes. */
export function brainText(reply: string): string | null {
  const text = reply.replace(/\n\nConfidence: \d+%[\s\S]*$/, "").trim();
  if (!text || text === ONE_BRAIN_SILENT_REPLY || !looksLikeText(text)) return null;
  return text;
}

/** A backroom between `system` and the Ollama model named by `opts.model` (default: gemma3). */
export function createBackroom(system: BackroomSystem, opts: BackroomOptions = {}): Backroom {
  const model = opts.model ?? process.env.NEUROCLAW_BACKROOM_MODEL ?? "gemma3";
  const url = normalizeOllamaUrl(opts.url ?? process.env.OLLAMA_HOST);
  const replyDeadlineMs = opts.replyDeadlineMs ?? 8000;
  const { url: _u, model: _m, replyDeadlineMs: _r, publish, ...config } = opts;

  const deps: BackroomDeps = {
    chat: createOllamaChat({ url, model }),
    reply: async (heard, history) =>
      brainText(await system.llm.generate(heard, {
        deadlineMs: replyDeadlineMs,
        memoryContext: history.filter(t => !t.silent && t.text).map(t => `${t.speaker === "ollama" ? "Other" : "NeuroClaw"}: ${t.text}`),
      })),
    remember: text => {
      system.memory.remember(`The other model said: ${text}`, { tags: ["backroom", "external-model"], importance: 0.3 });
    },
    train: lines => system.llm.learnText(lines.join("\n")),
    ...(publish === false ? {} : {
      publish: publish ?? (async page => {
        const { publishWikiPageAndSync } = await import("../../models && skills/core/wiki-store.js");
        const { sync } = await publishWikiPageAndSync(page.name, page.title, page.content);
        return { pushed: sync.pushed, ...(sync.reason ? { reason: sync.reason } : {}) };
      }),
    }),
  };

  return new Backroom(deps, {
    modelLabel: `${model} (Ollama)`,
    publishEvery: envNumber("NEUROCLAW_BACKROOM_PUBLISH_EVERY") ?? 50,
    transcriptPath: `.neuroclaw/backroom/${config.runId ?? new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}.jsonl`,
    ...(envNumber("NEUROCLAW_BACKROOM_MAX_TURNS") !== undefined ? { maxTurns: envNumber("NEUROCLAW_BACKROOM_MAX_TURNS")! } : {}),
    ...config,
  });
}
