/**
 * What the engine needs from Node, provided without Node, so the SAME engine
 * code runs inside a phone's JavaScript runtime (Android WebView, iOS
 * JavaScriptCore). Imported first by the bundle entry.
 */
import { Buffer } from "buffer";

const g = globalThis as Record<string, unknown>;
if (typeof g.Buffer === "undefined") g.Buffer = Buffer;
// A bare JavaScriptCore context (iOS) has no timers and no console; a
// microtask is enough for the engine, which only uses them to yield.
if (typeof g.setTimeout === "undefined") {
  g.setTimeout = (fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => { Promise.resolve().then(() => fn(...args)); return 0; };
}
if (typeof g.setImmediate === "undefined") {
  g.setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) => (g.setTimeout as typeof setTimeout)(() => fn(...args), 0);
}
if (typeof g.console === "undefined") {
  const noop = () => {};
  g.console = { log: noop, warn: noop, error: noop, info: noop, debug: noop };
}
if (typeof g.process === "undefined") g.process = { env: {} };
