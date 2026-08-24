/**
 * Tools plugin — a package of small, exact, local utilities.
 *
 * These are the jobs a language model is worst at and a function is best at:
 * arithmetic, hashing, encoding, unit conversion, date maths. A generated
 * answer to "what is 8347 * 219" is a guess that happens to look like a
 * number; a computed one is correct. Each tool here is deterministic and
 * runs in-process, so the agent can be *right* rather than plausible.
 *
 * Everything is local: node builtins only, no network, no external service.
 *
 * Dispatch is deliberately strict. onMessage() returns null unless the text
 * actually names a tool, so a message routed here that this plugin cannot
 * genuinely answer falls through to the next candidate instead of this plugin
 * trivially "succeeding" on everything (the same rule terminal.ts follows).
 */

import { createHash, randomUUID } from "node:crypto";
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { evaluateExpression } from "../models && skills/core/math-engine.js";

export interface ToolResult {
  tool: string;
  result: string;
}

/** Length units, expressed in metres; mass in grams; the rest handled separately. */
const UNITS: Record<string, { base: number; kind: string }> = {
  mm: { base: 0.001, kind: "length" },
  cm: { base: 0.01, kind: "length" },
  m: { base: 1, kind: "length" },
  km: { base: 1000, kind: "length" },
  in: { base: 0.0254, kind: "length" },
  ft: { base: 0.3048, kind: "length" },
  yd: { base: 0.9144, kind: "length" },
  mi: { base: 1609.344, kind: "length" },
  mg: { base: 0.001, kind: "mass" },
  g: { base: 1, kind: "mass" },
  kg: { base: 1000, kind: "mass" },
  oz: { base: 28.349523125, kind: "mass" },
  lb: { base: 453.59237, kind: "mass" },
  st: { base: 6350.29318, kind: "mass" },
  ms: { base: 0.001, kind: "time" },
  s: { base: 1, kind: "time" },
  min: { base: 60, kind: "time" },
  h: { base: 3600, kind: "time" },
  day: { base: 86400, kind: "time" },
  week: { base: 604800, kind: "time" },
};

const TEMPERATURES = new Set(["c", "f", "k"]);

function toCelsius(value: number, unit: string): number {
  if (unit === "c") return value;
  if (unit === "f") return (value - 32) * (5 / 9);
  return value - 273.15;
}

function fromCelsius(celsius: number, unit: string): number {
  if (unit === "c") return celsius;
  if (unit === "f") return celsius * (9 / 5) + 32;
  return celsius + 273.15;
}

/** Trim floating-point noise without lying about precision. */
function tidy(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const rounded = Number(n.toFixed(10));
  return String(rounded);
}

export class ToolsPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) {
    super(definition);
  }

  // ── Individual tools ─────────────────────────────────────────────────────

  /** Exact arithmetic. Returns null when the text is not a valid expression. */
  calculate(expression: string): string | null {
    try {
      const value = evaluateExpression(expression);
      return Number.isFinite(value) ? tidy(value) : null;
    } catch {
      return null;
    }
  }

  /** md5 / sha1 / sha256 / sha512 of a string. */
  hash(algorithm: string, text: string): string | null {
    const algo = algorithm.toLowerCase().replace("-", "");
    if (!["md5", "sha1", "sha256", "sha512"].includes(algo)) return null;
    return createHash(algo).update(text, "utf8").digest("hex");
  }

  /** base64 / hex encode and decode. Decoding validates rather than returning mojibake. */
  encode(format: string, text: string): string | null {
    if (format === "base64") return Buffer.from(text, "utf8").toString("base64");
    if (format === "hex") return Buffer.from(text, "utf8").toString("hex");
    return null;
  }

  decode(format: string, text: string): string | null {
    try {
      if (format === "base64") {
        const buf = Buffer.from(text, "base64");
        // Buffer.from is famously lenient: it silently drops invalid
        // characters rather than failing, so a round-trip check is the only
        // way to know the input really was base64.
        if (buf.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "").replace(/\s/g, "")) return null;
        return buf.toString("utf8");
      }
      if (format === "hex") {
        if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) return null;
        return Buffer.from(text, "hex").toString("utf8");
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Convert between units of the same kind, including temperature. */
  convert(value: number, from: string, to: string): string | null {
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (!Number.isFinite(value)) return null;

    if (TEMPERATURES.has(f) && TEMPERATURES.has(t)) {
      return tidy(fromCelsius(toCelsius(value, f), t));
    }
    const uf = UNITS[f];
    const ut = UNITS[t];
    // Refusing a cross-kind conversion matters: silently returning a number
    // for "5 kg to metres" would be confidently wrong.
    if (!uf || !ut || uf.kind !== ut.kind) return null;
    return tidy((value * uf.base) / ut.base);
  }

  /** Word / character / line counts. */
  countText(text: string): { words: number; characters: number; lines: number } {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { words, characters: text.length, lines: text ? text.split(/\r?\n/).length : 0 };
  }

  /** A v4 UUID. */
  uuid(): string {
    return randomUUID();
  }

  /** Pretty-print JSON, or report why it is invalid. */
  formatJson(text: string): string | null {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }

  /** Current date and time, ISO-8601, in UTC and locally. */
  now(): { iso: string; utc: string; local: string; epochMs: number } {
    const d = new Date();
    return {
      iso: d.toISOString(),
      utc: d.toUTCString(),
      local: d.toString(),
      epochMs: d.getTime(),
    };
  }

  /** Whole days between two ISO dates (b - a). Null when either is unparseable. */
  daysBetween(a: string, b: string): number | null {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (Number.isNaN(da) || Number.isNaN(db)) return null;
    return Math.round((db - da) / 86_400_000);
  }

  /** Every tool this plugin provides, for listing in the UI or by the agent. */
  listTools(): Array<{ name: string; usage: string }> {
    return [
      { name: "calc", usage: "calc 8347 * 219" },
      { name: "hash", usage: "hash sha256 hello" },
      { name: "encode", usage: "encode base64 hello" },
      { name: "decode", usage: "decode base64 aGVsbG8=" },
      { name: "convert", usage: "convert 12 km to mi" },
      { name: "count", usage: "count words in <text>" },
      { name: "uuid", usage: "uuid" },
      { name: "json", usage: "json {\"a\":1}" },
      { name: "now", usage: "now" },
      { name: "days between", usage: "days between 2026-01-01 and 2026-03-01" },
      { name: "tools", usage: "tools" },
    ];
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Returns null for anything this plugin cannot genuinely answer, so
   * dispatch() falls through to the next candidate rather than this plugin
   * absorbing every message routed at it.
   */
  override async onMessage(message: unknown): Promise<unknown> {
    const input = (typeof message === "string" ? message : String(message ?? "")).trim();
    if (!input) return null;

    let m: RegExpMatchArray | null;

    if (/^tools?$|^list tools$/i.test(input)) {
      return {
        tool: "tools",
        result: this.listTools().map(t => `${t.name} — ${t.usage}`).join("\n"),
      } satisfies ToolResult;
    }

    if (/^uuid$/i.test(input)) return { tool: "uuid", result: this.uuid() } satisfies ToolResult;

    if (/^now$|^date$|^time$/i.test(input)) {
      const n = this.now();
      return { tool: "now", result: `${n.iso}\nlocal: ${n.local}` } satisfies ToolResult;
    }

    if ((m = input.match(/^(?:calc|calculate)\s*:?\s+([\s\S]+)$/i))) {
      const r = this.calculate(m[1]);
      return r === null ? null : ({ tool: "calc", result: `${m[1].trim()} = ${r}` } satisfies ToolResult);
    }

    if ((m = input.match(/^hash\s+(md5|sha1|sha256|sha512|sha-1|sha-256|sha-512)\s+([\s\S]+)$/i))) {
      const r = this.hash(m[1], m[2]);
      return r === null ? null : ({ tool: "hash", result: r } satisfies ToolResult);
    }

    if ((m = input.match(/^encode\s+(base64|hex)\s+([\s\S]+)$/i))) {
      const r = this.encode(m[1].toLowerCase(), m[2]);
      return r === null ? null : ({ tool: "encode", result: r } satisfies ToolResult);
    }

    if ((m = input.match(/^decode\s+(base64|hex)\s+([\s\S]+)$/i))) {
      const r = this.decode(m[1].toLowerCase(), m[2].trim());
      return r === null
        ? ({ tool: "decode", result: `That is not valid ${m[1].toLowerCase()}.` } satisfies ToolResult)
        : ({ tool: "decode", result: r } satisfies ToolResult);
    }

    if ((m = input.match(/^convert\s+(-?[\d.]+)\s*([a-z]+)\s+(?:to|in)\s+([a-z]+)$/i))) {
      const r = this.convert(Number(m[1]), m[2], m[3]);
      return r === null
        ? ({ tool: "convert", result: `Cannot convert ${m[2]} to ${m[3]} — different kinds of unit, or unknown unit.` } satisfies ToolResult)
        : ({ tool: "convert", result: `${m[1]} ${m[2]} = ${r} ${m[3]}` } satisfies ToolResult);
    }

    if ((m = input.match(/^count(?:\s+words)?(?:\s+in)?\s*:?\s+([\s\S]+)$/i))) {
      const c = this.countText(m[1]);
      return {
        tool: "count",
        result: `${c.words} word(s), ${c.characters} character(s), ${c.lines} line(s)`,
      } satisfies ToolResult;
    }

    if ((m = input.match(/^json\s*:?\s+([\s\S]+)$/i))) {
      const r = this.formatJson(m[1]);
      return r === null
        ? ({ tool: "json", result: "That is not valid JSON." } satisfies ToolResult)
        : ({ tool: "json", result: r } satisfies ToolResult);
    }

    if ((m = input.match(/^days?\s+between\s+(\S+)\s+(?:and|to)\s+(\S+)$/i))) {
      const d = this.daysBetween(m[1], m[2]);
      return d === null
        ? ({ tool: "days-between", result: "Could not read those as dates (try YYYY-MM-DD)." } satisfies ToolResult)
        : ({ tool: "days-between", result: `${d} day(s)` } satisfies ToolResult);
    }

    return null;
  }

  async onHealthCheck(): Promise<boolean> {
    return this.active;
  }
}
