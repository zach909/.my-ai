import { useEffect, useRef, useState } from 'react'

/**
 * The "it is running" indicator: the icon's own wavy ring, alive.
 *
 * It used to be a lightning bolt on a CSS pulse, which says "loading" and
 * nothing else -- the same bolt whether the agent is thinking hard or idling
 * on a slow network. The ring is the product's own shape, and unlike a bolt it
 * has something to say: its six points stretch out and sharpen while there is
 * work happening, and relax back toward a circle as it eases off. Someone
 * glancing at it can tell busy from nearly-done without reading a word.
 *
 * It does not turn. Expanding and contracting is the whole motion -- a ring
 * that also rotates is a spinner, which is the thing this replaced.
 *
 * Two things drive it. `activity` (0..1) is the caller's own measure when it
 * has one -- tokens arriving, ticks propagating, agents running. When it does
 * not, the ring still breathes on its own slow cycle, so "running" never looks
 * like "frozen".
 *
 * Respects prefers-reduced-motion by drawing one calm ring and stopping: an
 * indicator is not worth making someone motion-sick over.
 */

/** Ring geometry in the SVG's own units. */
const VIEW = 48
const CENTRE = VIEW / 2
const BASE_RADIUS = 14
/** Points around the ring. Enough that the lobes read as curves, few enough to rebuild every frame cheaply. */
const SEGMENTS = 120

/**
 * Six points. Always six.
 *
 * The first version animated the NUMBER of lobes as well as their depth, which
 * made the ring look like a different shape from moment to moment rather than
 * one shape doing something. Six is the icon's count, and it stays six: what
 * changes is how far the points are stretched out.
 */
const POINTS = 6

/**
 * Lobe depth: near-nothing (a circle) to far out (a six-pointed star).
 *
 * The busy end is bounded by the viewBox, not by taste. The stroke is
 * non-scaling, so at a 20px render a 2.2px line is about 5 viewBox units
 * wide -- the tips need to stay that far inside the edge or they get clipped
 * exactly when the shape is at its most expressive.
 */
const AMPLITUDE_CALM = 0.4
const AMPLITUDE_BUSY = 7

/**
 * How sharp the points are.
 *
 * A plain sine gives soft, wide lobes however tall they get -- more of a
 * flower than a star. Raising it to an odd power narrows the peaks and
 * flattens everything between them, so the shape reads as points being pulled
 * out of a ring rather than as bumps growing on one. 1 is the untouched sine;
 * the busy end is where the points get their edge.
 */
const SHARPNESS_CALM = 1
const SHARPNESS_BUSY = 3.4

export interface AgentPulseProps {
  /**
   * How hard it is working, 0..1. Omit and the ring breathes on its own --
   * which is the honest default, because most callers genuinely do not know.
   */
  activity?: number
  /** Rendered size in px. */
  size?: number
  className?: string
  /** Announced to screen readers; the ring itself is decorative without it. */
  label?: string
}

/**
 * r(θ) = R + A · shape(sin(6θ + φ)), sampled into a closed path.
 *
 * `shape` is the odd power that turns a soft sine into something with points
 * on it. Odd on purpose: an even power would fold the troughs up into peaks
 * and give twelve bumps instead of six.
 *
 * `phase` is where the points sit. The animation holds it at zero -- the
 * points are anchored, and only their reach changes -- but it stays a
 * parameter so the shape can be drawn at any orientation.
 */
function ringPath(amplitude: number, sharpness: number, phase: number): string {
  let path = ''
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Math.PI * 2
    const wave = Math.sin(POINTS * theta + phase)
    const shaped = Math.sign(wave) * Math.pow(Math.abs(wave), sharpness)
    const r = BASE_RADIUS + amplitude * shaped
    const x = CENTRE + r * Math.cos(theta)
    const y = CENTRE + r * Math.sin(theta)
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return `${path}Z`
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function AgentPulse({ activity, size = 20, className, label }: AgentPulseProps) {
  const still = prefersReducedMotion()
  const [path, setPath] = useState(() => ringPath(AMPLITUDE_CALM, SHARPNESS_CALM, 0))

  // The latest activity without restarting the animation loop: a prop that
  // changes on every streamed token would otherwise tear the loop down and
  // build it again dozens of times a second.
  const activityRef = useRef(activity)
  activityRef.current = activity

  useEffect(() => {
    if (still) return
    let frame = 0
    let running = true
    const start = performance.now()

    const draw = (now: number) => {
      if (!running) return
      const t = (now - start) / 1000
      // Without a caller-supplied measure, breathe: a swell between calm and
      // busy so the ring is visibly alive rather than a static outline. Pure
      // amplitude, still -- the points only reach further out and pull back
      // in, never sideways or around, which is what makes this a pulse and
      // not a spinner. 9, not 0.9: ten times the original rate.
      const drive = activityRef.current ?? (Math.sin(t * 9) * 0.5 + 0.5)
      const eased = Math.max(0, Math.min(1, drive))
      // One shape, stretched: the points go from barely there to pulled well
      // out, and sharpen as they go. The count never changes.
      const amplitude = AMPLITUDE_CALM + (AMPLITUDE_BUSY - AMPLITUDE_CALM) * eased
      const sharpness = SHARPNESS_CALM + (SHARPNESS_BUSY - SHARPNESS_CALM) * eased
      // The points stay where they are. The ring used to turn as well, and a
      // turning ring reads as a spinner -- the generic "waiting" animation
      // this exists precisely not to be. Only the reach of the points moves.
      setPath(ringPath(amplitude, sharpness, 0))
      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => {
      running = false
      cancelAnimationFrame(frame)
    }
  }, [still])

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
