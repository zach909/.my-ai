/**
 * Whether the agent is currently doing work.
 *
 * Reads the backend's own continuous-loop status rather than guessing from UI
 * state, so the mark reflects what the agent is actually doing — including work
 * started somewhere other than the page you happen to be looking at.
 *
 * Polling is gated on page visibility for the same reason every other poll in
 * this app is: an animation nobody can see is not worth a request every few
 * seconds. It also fails quiet — if the backend is unreachable the agent is
 * reported as not running, because a mark stuck animating forever because a
 * fetch failed is worse than one that stops early.
 */

import { useEffect, useState } from 'react'
import { usePageVisible } from './usePageVisible'
import { fetchWithTimeout, startPolling } from '@/lib/poll'

const POLL_MS = 3000

export function useAgentRunning(): boolean {
  const [running, setRunning] = useState(false)
  const visible = usePageVisible()

  useEffect(() => {
    if (!visible) return
    let cancelled = false

    const poll = async () => {
      try {
        // Deadline shorter than the interval, and the next poll is scheduled
        // only after this one settles -- see src/lib/poll.ts for why an
        // interval around an untimed fetch can starve the whole page.
        const res = await fetchWithTimeout('/api/continuous/status', {}, 2500)
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (cancelled) return
        // Treat queued input as running too: the agent has work in hand even
        // between ticks, and flickering the mark off in those gaps would read
        // as "finished" when it is not.
        setRunning(Boolean(data?.running) || Number(data?.pendingInputCount ?? 0) > 0)
      } catch {
        if (!cancelled) setRunning(false)
      }
    }

    const handle = startPolling(poll, POLL_MS)
    return () => {
      cancelled = true
      handle.stop()
    }
  }, [visible])

  return running
}
