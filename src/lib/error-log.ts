/**
 * App-wide error log — captures caught exceptions with enough context to
 * explain "what happened" after the fact, without exposing anything beyond
 * the app's own execution (no system/process/OS-level data).
 */

export interface LoggedError {
  id: string
  timestamp: number
  /** Where the error was caught, e.g. 'bot-service.processMessage'. */
  source: string
  message: string
  stack?: string
  /** Optional extra context relevant to the failure (e.g. the input that caused it). */
  context?: Record<string, unknown>
}

const MAX_ENTRIES = 100
const entries: LoggedError[] = []

export function logError(source: string, error: unknown, context?: Record<string, unknown>): LoggedError {
  const entry: LoggedError = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    source,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.shift()
  }

  return entry
}

export function getRecentErrors(limit = 10): LoggedError[] {
  return entries.slice(-limit)
}

export function getLastError(): LoggedError | undefined {
  return entries[entries.length - 1]
}

export function clearErrors() {
  entries.length = 0
}
