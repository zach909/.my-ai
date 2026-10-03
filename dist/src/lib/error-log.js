/**
 * App-wide error log — captures caught exceptions with enough context to
 * explain "what happened" after the fact, without exposing anything beyond
 * the app's own execution (no system/process/OS-level data).
 */
const MAX_ENTRIES = 100;
const entries = [];
export function logError(source, error, context) {
    const entry = {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        source,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.shift();
    }
    return entry;
}
export function getRecentErrors(limit = 10) {
    return entries.slice(-limit);
}
export function getLastError() {
    return entries[entries.length - 1];
}
export function clearErrors() {
    entries.length = 0;
}
