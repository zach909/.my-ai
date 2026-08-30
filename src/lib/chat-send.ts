/**
 * The chat page's send-gating and zip-loop-archive-outcome formatting,
 * pulled out of src/routes/app/chat.tsx as plain functions with no React and
 * no `@/`-aliased imports -- so they can be imported directly by both the
 * page (which needs the alias, resolved by vite) and by a plain vitest run
 * (which does not configure it -- see vitest.config.ts's own comment on why
 * it stays a minimal Node config).
 */

/**
 * Whether there is anything to send: typed text, a staged file, or both.
 *
 * The one gate the chat page's Send button `disabled` prop and its
 * handleSendMessage() guard both defer to, so a fix to one can never
 * quietly drift from the other -- which is exactly the shape of bug that
 * made a staged file unsendable in the first place: the button checked
 * only whether there was text typed, and so did the send guard, so neither
 * ever looked at whether a file was actually staged.
 */
export function canSend(input: string, stagedCount: number): boolean {
  return input.trim().length > 0 || stagedCount > 0
}

export interface ArchiveOutcome {
  ok: boolean
  error?: string
  bytesIn?: number
  sendTicks?: number
  complete?: boolean
}

/** Full assistant bubble -- what an attached FILE's zip-loop send outcome gets. */
export function formatArchiveMessage(names: string, outcome: ArchiveOutcome): string {
  if (!outcome.ok) return `Could not send ${names} into the network: ${outcome.error}`
  return outcome.complete
    ? `Sent ${names} into the network (${outcome.bytesIn} bytes zipped, ${outcome.sendTicks} ticks in). It stopped itself.`
    : `Sent ${names} into the network (${outcome.bytesIn} bytes zipped, ${outcome.sendTicks} ticks in). It hit the tick ceiling rather than stopping itself — it has not been trained to say when it is done.`
}

/** One-line caption -- what a plain typed message's zip-loop send outcome gets. */
export function formatArchiveCaption(outcome: ArchiveOutcome): string {
  if (!outcome.ok) return `⚠ not sent as a file: ${outcome.error}`
  return outcome.complete
    ? `📎 also sent as a file (${outcome.bytesIn}B, stopped itself)`
    : `📎 also sent as a file (${outcome.bytesIn}B, hit the tick ceiling)`
}
