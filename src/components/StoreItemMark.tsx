/**
 * A generated graphic for a store item.
 *
 * Store items are files people publish — nobody uploads cover art, and asking
 * them to would be friction for no benefit. So every item gets a mark derived
 * from its own name, in the same visual language as the app icon: the polar
 * wave r(t) = R + A*cos(k*t), with the lobe count, amplitude, rotation and hue
 * all read out of a hash of the name.
 *
 * Deterministic, which is the point. The same item looks the same on every
 * machine that pulls the repository, with nothing stored and nothing to sync —
 * the same property the store itself has. Two different items look reliably
 * different, so the catalogue is scannable by shape rather than by reading
 * every title.
 */

/** FNV-1a. Small, fast, and good enough to spread names across the parameters. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const SEGMENTS = 72
const BASE_RADIUS = 150

/** Build the wave path for a given lobe count and amplitude. */
function wavePath(lobes: number, amplitude: number, rotation: number): string {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < SEGMENTS; i++) {
    const t = rotation + (i / SEGMENTS) * Math.PI * 2
    const r = BASE_RADIUS + amplitude * Math.cos(lobes * (t - rotation))
    pts.push([256 + r * Math.cos(t), 256 + r * Math.sin(t)])
  }
  const at = (i: number) => pts[((i % SEGMENTS) + SEGMENTS) % SEGMENTS]
  let d = `M ${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`
  for (let i = 0; i < SEGMENTS; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d + ' Z'
}

/** Each store section gets its own hue family, so kind is readable at a glance. */
const KIND_HUE: Record<string, number> = {
  skills: 205,
  plugins: 265,
  binaries: 25,
  source: 150,
  files: 320,
  wiki: 45,
}

export function StoreItemMark({
  name,
  kind = 'files',
  size = 64,
}: {
  name: string
  kind?: string
  size?: number
}) {
  const h = hash(`${kind}/${name}`)

  // Spread across visibly distinct shapes: 3-8 lobes, and an amplitude from
  // near-circular to strongly starred so items do not all look alike.
  const lobes = 3 + (h % 6)
  const amplitude = 8 + ((h >> 3) % 34)
  const rotation = ((h >> 9) % 360) * (Math.PI / 180)
  // Hue drifts around the section's family rather than being fully random, so
  // items read as belonging to their section while staying individual.
  const hue = ((KIND_HUE[kind] ?? 210) + (((h >> 17) % 40) - 20) + 360) % 360
  const inner = wavePath(lobes, amplitude, rotation)
  const outer = wavePath(lobes, amplitude * 0.55, rotation + Math.PI / lobes)
  const id = `sim-${kind}-${name.replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={`${name} mark`}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 30% 16%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 40% 8%)`} />
        </linearGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 75% 78%)`} />
          <stop offset="55%" stopColor={`hsl(${hue} 55% 55%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 80% 72%)`} />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${id}-bg)`} />
      {/* A second, counter-rotated wave at half amplitude gives the mark some
          depth without needing per-item artwork. */}
      <path d={outer} fill="none" stroke={`hsl(${hue} 60% 60%)`} strokeOpacity="0.28" strokeWidth="10" strokeLinejoin="round" />
      <path d={inner} fill="none" stroke={`url(#${id}-ring)`} strokeWidth="18" strokeLinejoin="round" />
    </svg>
  )
}
