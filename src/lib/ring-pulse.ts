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
 * needs to cache the last event.
 */

export type RingPulseEvent = 'pulse' | 'settle'

type Listener = (event: RingPulseEvent) => void

const listeners = new Set<Listener>()

/** Subscribe to ring energy events; returns the unsubscribe function. */
export function onRingEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A message was sent: the ring should surge into a faster spin. */
export function pulseRing(): void {
  for (const listener of listeners) listener('pulse')
}

/** The reply landed (or the send failed): ease back to idle speed. */
export function settleRing(): void {
  for (const listener of listeners) listener('settle')
}
