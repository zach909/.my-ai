/**
 * A tiny pub/sub channel for the crown ring's "energy" — how fast it should
 * be spinning right now.
 *
 * Why an event bus instead of props: the ring lives in a three.js canvas that
 * is mounted as a full-page backdrop, while the thing that makes it worth
 * spinning is a chat send happening somewhere else in the tree. Threading a
 * callback through the router to get there would couple pages to a decorative
 * component; this keeps them strangers.
 *
 * Semantics are deliberately push-only and stateless: `pulseRing()` tells any
 * mounted ring "a message just went out", and `settleRing()` says "the reply
 * landed, wind back down". A ring mounted *after* a pulse simply misses it —
 * correct behaviour for a live reaction effect, and the reason nothing here
 * needs to cache the last event. The one exception is `THINKING`: whether the
 * assistant is mid-reply is sustained state rather than a moment, so the bus
 * caches it (and replays it on subscribe) for rings mounted after the send.
 */

export type RingPulseEvent = 'pulse' | 'settle' | 'thinking' | 'idle'

type Listener = (event: RingPulseEvent) => void

const listeners = new Set<Listener>()

/** Whether the assistant is currently composing a reply (drives the fast spin). */
let thinkingActive = false

/** Subscribe to ring energy events; returns the unsubscribe function.
 *  On subscribe, a currently-active `thinking` state is replayed so a ring
 *  mounted mid-conversation still knows it should be spinning flat-out. */
export function onRingEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (thinkingActive) listener('thinking')
  return () => { listeners.delete(listener) }
}

/** The assistant started composing: hold the ring at infinite speed. */
export function setRingThinking(active: boolean): void {
  thinkingActive = active
  for (const listener of listeners) listener(active ? 'thinking' : 'idle')
}

/** A message was sent: the ring should surge into a faster spin. */
export function pulseRing(): void {
  for (const listener of listeners) listener('pulse')
}

/** The reply landed (or the send failed): ease back to idle speed. */
export function settleRing(): void {
  for (const listener of listeners) listener('settle')
}
