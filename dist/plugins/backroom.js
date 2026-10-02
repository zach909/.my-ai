import { BasePlugin } from "../plugin_manager/sdk.js";
import { Backroom, createOllamaChat, normalizeOllamaUrl, } from "../models && skills/core/backroom.js";
function envNumber(name) {
    const raw = process.env[name];
    if (!raw)
        return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}
/** A backroom between `system` and the Ollama model named by `opts.model` (default: gemma3). */
export function createBackroom(system, opts = {}) {
    const model = opts.model ?? process.env.NEUROCLAW_BACKROOM_MODEL ?? "gemma3";
    const url = normalizeOllamaUrl(opts.url ?? process.env.OLLAMA_HOST);
    const replyDeadlineMs = opts.replyDeadlineMs ?? 8000;
    const { url: _u, model: _m, replyDeadlineMs: _r, publish, ...config } = opts;
    const deps = {
        chat: createOllamaChat({ url, model }),
        reply: (heard, history) => system.speak(heard, {
            deadlineMs: replyDeadlineMs,
            history: history.filter(t => !t.silent && t.text).map(t => `${t.speaker === "ollama" ? "Other" : "NeuroClaw"}: ${t.text}`),
        }),
        remember: text => {
            system.memory.remember(`The other model said: ${text}`, { tags: ["backroom", "external-model"], importance: 0.3 });
        },
        train: lines => system.llm.learnText(lines.join("\n")),
        ...(publish === false ? {} : {
            publish: publish ?? (async (page) => {
                const { publishWikiPageAndSync } = await import("../models && skills/core/wiki-store.js");
                const { sync } = await publishWikiPageAndSync(page.name, page.title, page.content);
                return { pushed: sync.pushed, ...(sync.reason ? { reason: sync.reason } : {}) };
            }),
        }),
    };
    return new Backroom(deps, {
        modelLabel: `${model} (Ollama)`,
        publishEvery: envNumber("NEUROCLAW_BACKROOM_PUBLISH_EVERY") ?? 50,
        transcriptPath: `.neuroclaw/backroom/${config.runId ?? new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}.jsonl`,
        ...(envNumber("NEUROCLAW_BACKROOM_MAX_TURNS") !== undefined ? { maxTurns: envNumber("NEUROCLAW_BACKROOM_MAX_TURNS") } : {}),
        ...config,
    });
}
function describe(s) {
    const parts = [
        `${s.running ? "running" : `stopped (${s.stopReason ?? "not started"})`}`,
        `${s.turns} turns`,
        `${s.silentTurns} where NeuroClaw said nothing`,
        `${s.learned} new lines kept, ${s.trained} trained on, ${s.skippedRepeats} skipped as repeats`,
    ];
    if (s.published > 0) {
        parts.push(`${s.published} digest(s) published, last ${s.lastPublish?.pushed ? "pushed" : `saved locally only (${s.lastPublish?.reason ?? "unknown"})`}`);
    }
    if (s.failures > 0)
        parts.push(`${s.failures} failed request(s), last error: ${s.lastError}`);
    return parts.join("; ");
}
export class BackroomPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.current = null;
    }
    describeCapabilities() {
        return {
            verbs: ["backroom"],
            nouns: ["backroom", "ollama", "gemma"],
        };
    }
    async start(opts = {}) {
        if (this.current?.backroom.status().running)
            throw new Error("A backroom is already running. Stop it first.");
        const { getNeuroclawSystem } = await import("../src/index.js");
        const system = await getNeuroclawSystem();
        const backroom = createBackroom(system, opts);
        const controller = new AbortController();
        const done = backroom.run(controller.signal);
        this.current = { backroom, controller, done };
        return backroom;
    }
    async stop() {
        if (!this.current)
            return null;
        this.current.controller.abort();
        return this.current.done;
    }
    getStatus() {
        return this.current?.backroom.status() ?? null;
    }
    async onDeactivate() {
        await this.stop();
        await super.onDeactivate();
    }
    async onMessage(message) {
        const input = String(message).trim();
        if (/^\s*(?:please\s+)?stop\s+(?:the\s+)?backroom\s*[.!]?\s*$/i.test(input)) {
            const final = await this.stop();
            return final ? `[Backroom] Stopped. ${describe(final)}.` : "[Backroom] None is running.";
        }
        if (/^\s*(?:please\s+)?backroom\s+status\s*[.!?]?\s*$/i.test(input)) {
            const status = this.getStatus();
            return status ? `[Backroom] ${describe(status)}.` : "[Backroom] None has been started.";
        }
        const start = input.match(/^\s*(?:please\s+)?(?:start|begin)\s+(?:the\s+|a\s+)?backroom(?:\s+(?:about|on|with)\s+(.+?))?\s*[.!]?\s*$/i);
        if (!start)
            return null;
        try {
            const backroom = await this.start(start[1] ? { seed: start[1] } : {});
            return `[Backroom] Started with ${backroom.config.modelLabel}. It runs until you say "stop backroom". Say "backroom status" to see how it is going.`;
        }
        catch (e) {
            return `[Backroom] Did not start: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
