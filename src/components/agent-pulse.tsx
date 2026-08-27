import { useEffect, useRef, useState } from 'react'

/**
 * The "it is running" indicator: the icon's own wavy ring, alive.
 *
 * It used to be a lightning bolt on a CSS pulse, which says "loading" and
 * nothing else -- the same bolt whether the agent is thinking hard or idling
 * on a slow network. The ring is the product's own shape, and unlike a bolt it
 * has something to say: the waves get spikier and more numerous while there is
 * work happening, and settle back down as it eases off. Someone glancing at it
 * can tell the difference between busy and nearly done without reading a word.
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
const BASE_RADIUS = 17
/** Points around the ring. Enough that the lobes read as curves, few enough to rebuild every frame cheaply. */
const SEGMENTS = 96

/** Lobe count at rest and at full tilt -- "more waves and less waves". */
const LOBES_CALM = 6
const LOBES_BUSY = 14
/** Lobe depth at rest and at full tilt -- "more spiky and less spiky". */
const AMPLITUDE_CALM = 1.1
const AMPLITUDE_BUSY = 4.2

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
 * r(θ) = R + A·sin(kθ + φ), sampled into a closed path.
 *
 * k has to stay a whole number or the ring does not join up with itself: a
 * fractional lobe count leaves a visible step where θ wraps past 2π. The
 * animation therefore blends between whole lobe counts rather than sweeping k
 * continuously.
 */
function ringPath(lobes: number, amplitude: number, phase: number): string {
  const whole = Math.floor(lobes)
  const blend = lobes - whole
  let path = ''
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Math.PI * 2
    const wave =
      Math.sin(whole * theta + phase) * (1 - blend) +
      Math.sin((whole + 1) * theta + phase) * blend
    const r = BASE_RADIUS + amplitude * wave
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
  const [path, setPath] = useState(() => ringPath(LOBES_CALM, AMPLITUDE_CALM, 0))

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
      // Without a caller-supplied measure, breathe: a slow swell between calm
      // and busy so the ring is visibly alive rather than a static outline.
      const drive = activityRef.current ?? (Math.sin(t * 0.9) * 0.5 + 0.5)
      const eased = Math.max(0, Math.min(1, drive))
      const lobes = LOBES_CALM + (LOBES_BUSY - LOBES_CALM) * eased
      const amplitude = AMPLITUDE_CALM + (AMPLITUDE_BUSY - AMPLITUDE_CALM) * eased
      // Rotation speeds up with the work, so a busy ring reads as busy even in
      // a still screenshot's worth of attention.
      setPath(ringPath(lobes, amplitude, t * (0.8 + eased * 2.6)))
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
