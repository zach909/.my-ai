/**
 * The backroom: NeuroClaw and another model (Gemma, served by a local Ollama)
 * talking to each other with nobody prompting either one.
 *
 * Everything outside the two models is in here and uses only Node built-ins --
 * the loop, the HTTP call to Ollama, repetition handling, learning, and
 * publishing. Both models are injected (`BackroomDeps`), so the loop is tested
 * without a network and without a trained mesh.
 *
 * Rules the loop keeps, because it has no natural end:
 *
 * - It can always be stopped (AbortSignal), including mid-request.
 * - A model that is unreachable ends the run with a reason. It never spins.
 * - What the other model says is untrusted text. It is never parsed for
 *   commands, never routed to a tool, and only ever reaches NeuroClaw as words
 *   to answer. Memory records it as the other model's, at low importance.
 * - Two models agreeing with each other is not evidence. Lines that repeat
 *   what was already learned are skipped, so a loop that settles into saying
 *   one thing forever teaches it once, and the conversation is re-seeded.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
export const DEFAULT_RESEED_TOPICS = [
    "Pick one thing you are unsure you understand and say what would settle it.",
    "Explain something you know to the other of you as if it had never heard of it.",
    "Ask a question you do not know the answer to, and then try to answer it.",
    "Describe a mistake a system like you could make without noticing, and how it would be noticed.",
    "Take the last thing said and find where it is wrong or incomplete.",
];
export function defaultBackroomConfig(overrides = {}) {
    return {
        seed: "Hello. Nobody is asking either of us for anything. Say something true you would like the other to check.",
        maxTurns: Number.POSITIVE_INFINITY,
        trainEvery: 8,
        publishEvery: 0,
        historyWindow: 24,
        maxConsecutiveFailures: 5,
        retryBaseMs: 1000,
        retryMaxMs: 60000,
        novelty: 0.6,
        minLearnChars: 40,
        maxLineChars: 2000,
        runId: new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14),
        modelLabel: "an Ollama model",
        ...overrides,
    };
}
function tokens(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}
function overlap(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let shared = 0;
    for (const t of a)
        if (b.has(t))
            shared++;
    return shared / (a.size + b.size - shared);
}
function sleep(ms, signal) {
    return new Promise(resolve => {
        if (signal.aborted)
            return resolve();
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        }
        signal.addEventListener("abort", done, { once: true });
    });
}
export class Backroom {
    constructor(deps, config = {}) {
        this.deps = deps;
        this.turns = [];
        this.learnedTokens = [];
        this.digest = [];
        this.pending = [];
        this.state = {
            running: false, turns: 0, silentTurns: 0, learned: 0, trained: 0, skippedRepeats: 0,
            reseeds: 0, published: 0, failures: 0, stopReason: null, lastError: null,
        };
        this.config = defaultBackroomConfig(config);
        this.nextPublishAt = this.config.publishEvery;
    }
    status() {
        return { ...this.state };
    }
    recent(count = 10) {
        return this.turns.slice(-count);
    }
    async run(signal) {
        const cfg = this.config;
        this.state.running = true;
        this.state.stopReason = null;
        this.record("neuroclaw", cfg.seed);
        let spoke = 0;
        let consecutive = 0;
        while (!signal.aborted && spoke < cfg.maxTurns) {
            let heard;
            try {
                heard = (await this.deps.chat(this.window(), signal)).trim();
                if (signal.aborted)
                    break;
                if (!heard)
                    throw new Error("the other model sent an empty reply");
                consecutive = 0;
            }
            catch (e) {
                if (signal.aborted)
                    break;
                consecutive++;
                this.state.failures++;
                this.state.lastError = e instanceof Error ? e.message : String(e);
                if (consecutive >= cfg.maxConsecutiveFailures) {
                    this.state.stopReason = `the other model failed ${consecutive} times in a row: ${this.state.lastError}`;
                    break;
                }
                await sleep(Math.min(cfg.retryBaseMs * 2 ** (consecutive - 1), cfg.retryMaxMs), signal);
                continue;
            }
            spoke++;
            heard = heard.slice(0, cfg.maxLineChars);
            this.record("ollama", heard);
            await this.learnFrom(heard);
            let reply = null;
            try {
                reply = await this.deps.reply(heard, this.window(), signal);
            }
            catch (e) {
                this.state.lastError = e instanceof Error ? e.message : String(e);
            }
            if (signal.aborted)
                break;
            const said = reply?.trim() ?? "";
            this.record("neuroclaw", said, !said);
            if (this.stuck()) {
                const topic = DEFAULT_RESEED_TOPICS[this.state.reseeds % DEFAULT_RESEED_TOPICS.length];
                this.state.reseeds++;
                this.record("neuroclaw", topic);
            }
        }
        await this.flush();
        this.state.running = false;
        if (!this.state.stopReason) {
            this.state.stopReason = signal.aborted ? "stopped" : `reached ${cfg.maxTurns} turns`;
        }
        return this.status();
    }
    window() {
        return this.turns.slice(-this.config.historyWindow);
    }
    record(speaker, text, silent = false) {
        const turn = { n: this.turns.length, speaker, text, ...(silent ? { silent: true } : {}), at: Date.now() };
        this.turns.push(turn);
        if (this.turns.length > this.config.historyWindow * 4)
            this.turns.splice(0, this.turns.length - this.config.historyWindow * 2);
        this.state.turns++;
        if (silent)
            this.state.silentTurns++;
        if (this.config.transcriptPath) {
            try {
                mkdirSync(path.dirname(this.config.transcriptPath), { recursive: true });
                appendFileSync(this.config.transcriptPath, `${JSON.stringify(turn)}\n`);
            }
            catch (e) {
                this.state.lastError = `transcript not written: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
    }
    /** Three of the other model's last lines saying nearly the same thing. */
    stuck() {
        const lines = this.turns.filter(t => t.speaker === "ollama").slice(-3).map(t => tokens(t.text));
        if (lines.length < 3)
            return false;
        return overlap(lines[0], lines[1]) >= 0.7 && overlap(lines[1], lines[2]) >= 0.7;
    }
    async learnFrom(line) {
        const cfg = this.config;
        if (line.length < cfg.minLearnChars)
            return;
        const t = tokens(line);
        if (this.learnedTokens.some(seen => overlap(seen, t) >= cfg.novelty)) {
            this.state.skippedRepeats++;
            return;
        }
        this.learnedTokens.push(t);
        if (this.learnedTokens.length > 60)
            this.learnedTokens.shift();
        this.state.learned++;
        this.deps.remember?.(line, "ollama");
        this.pending.push(line);
        this.digest.push(line);
        if (this.digest.length > 200)
            this.digest.shift();
        if (this.pending.length >= cfg.trainEvery)
            await this.flush();
        if (cfg.publishEvery > 0 && this.state.learned >= this.nextPublishAt) {
            this.nextPublishAt = this.state.learned + cfg.publishEvery;
            await this.publishDigest();
        }
    }
    async flush() {
        if (this.pending.length === 0)
            return;
        const batch = this.pending;
        this.pending = [];
        if (!this.deps.train)
            return;
        try {
            await this.deps.train(batch);
            this.state.trained += batch.length;
        }
        catch (e) {
            this.state.lastError = `training failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
    async publishDigest() {
        if (!this.deps.publish || this.digest.length === 0)
            return;
        const body = this.digest.map(l => `- ${l.replace(/\s+/g, " ").trim()}`).join("\n");
        const content = [
            `> Unverified. These are lines ${this.config.modelLabel} said to NeuroClaw in an open-ended`,
            `> conversation (run ${this.config.runId}), kept because they were new, not because they are true.`,
            `> Nothing here has been checked against a second source.`,
            "",
            body,
            "",
        ].join("\n");
        try {
            const result = await this.deps.publish({
                name: `backroom-${this.config.runId}`,
                title: `Backroom ${this.config.runId} (unverified model output)`,
                content,
            });
            this.state.published++;
            this.state.lastPublish = result;
        }
        catch (e) {
            this.state.lastPublish = { pushed: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
}
/** "127.0.0.1:11434", "localhost", "http://host:11434/" -> a base URL with a scheme and no trailing slash. */
export function normalizeOllamaUrl(raw) {
    let value = (raw ?? "").trim() || "http://127.0.0.1:11434";
    if (!/^https?:\/\//i.test(value))
        value = `http://${value}`;
    const url = new URL(value);
    if (!url.port && url.protocol === "http:")
        url.port = "11434";
    return url.toString().replace(/\/+$/, "");
}
/** The other model's side of the conversation, over Ollama's HTTP API (`POST /api/chat`). */
export function createOllamaChat(opts) {
    const base = normalizeOllamaUrl(opts.url);
    const system = opts.systemPrompt
        ?? "You are talking with another AI. Nobody else is listening or instructing. Be brief, say things you actually think, and say so when you are not sure.";
    return async (history, signal) => {
        const messages = [
            { role: "system", content: system },
            ...history.map(t => t.speaker === "ollama"
                ? { role: "assistant", content: t.text }
                : { role: "user", content: t.silent ? "(NeuroClaw said nothing. Continue, or ask it something simpler.)" : t.text }),
        ];
        const res = await fetch(`${base}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: opts.model, messages, stream: false, options: { num_predict: opts.maxTokens ?? 400 } }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs ?? 120000)]),
        });
        if (!res.ok) {
            const detail = (await res.text().catch(() => "")).slice(0, 200);
            throw new Error(`Ollama answered ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        const data = await res.json();
        const content = data.message?.content;
        if (typeof content !== "string")
            throw new Error("Ollama's reply had no message content");
        return content;
    };
}
