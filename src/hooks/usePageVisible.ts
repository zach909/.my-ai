/**
 * Whether this page is currently visible to the user.
 *
 * Used to stop background work when nobody is looking. A desktop app spends
 * most of its life minimised or behind another window, and a poll that keeps
 * firing there costs the processor, the battery and the network for a result
 * no one can see. Every polling loop and every render loop in the app is gated
 * on this.
 *
 * Starts as `true` during server-side prerendering, where `document` does not
 * exist: assuming visible is the safe default, since the worst case is one
 * extra tick before the first visibility event arrives, whereas assuming
 * hidden would leave a genuinely visible page never starting its poll at all.
 */

import { useEffect, useState } from 'react'

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setVisible(document.visibilityState !== 'hidden')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return visible
}
