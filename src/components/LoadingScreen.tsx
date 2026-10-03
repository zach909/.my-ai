/**
 * Full-screen loading state: the articulated crown ring from ring.zip
 * spinning on a dark field, with the wordmark under it.
 *
 * Used as the router's default pending component (src/router.tsx), so it
 * covers the gap between a navigation starting and the destination route being
 * ready — including the first paint when the desktop app opens, which is the
 * longest wait the user sees.
 */

import { Suspense, lazy } from 'react'
import { RingSpinner } from './RingSpinner'

/**
 * The 3D crown is code-split. Importing it directly pulls three.js and
 * react-three-fiber into the entry chunk, which would mean the loading screen
 * could not paint until a 3D engine had downloaded — the exact opposite of
 * what a loading screen is for. It is fetched in the background behind the
 * instant SVG ring, and swapped in when it arrives.
 */
const RingCrownSpinner = lazy(() =>
  import('./RingCrownSpinner').then(m => ({ default: m.RingCrownSpinner }))
)

export function LoadingScreen({
  /** Optional line under the wordmark, e.g. what is being waited on. */
  detail,
  /** Fill the viewport (default) or just the parent box. */
  fullScreen = true,
}: {
  detail?: string
  fullScreen?: boolean
}) {
  return (
    <div
      className={
        (fullScreen ? 'fixed inset-0 z-50 ' : 'absolute inset-0 ') +
        'flex flex-col items-center justify-center gap-6 bg-[#0d0d0f] text-white'
      }
      role="status"
      aria-live="polite"
    >
      {/* The spinner carries its own aria-label; silence it here so screen
          readers announce this region once, not twice. */}
      <div aria-hidden="true">
        <Suspense fallback={<RingSpinner size={140} />}>
          <RingCrownSpinner size={140} />
        </Suspense>
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="text-sm font-medium tracking-[0.18em] text-white/80 uppercase">
          Corona
        </span>
        {detail ? (
          <span className="text-xs text-white/45">{detail}</span>
        ) : (
          <span className="sr-only">Loading</span>
        )}
      </div>
    </div>
  )
}
