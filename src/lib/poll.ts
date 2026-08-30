/**
 * Polling that cannot pile up.
 *
 * Every poll in this app was `setInterval(poll, N)` around a `fetch` with no
 * timeout. Both halves of that are a problem, and together they compound.
 *
 * A fetch with no timeout waits as long as the network makes it wait. An
 * interval fires regardless of whether the previous request finished. So a
 * backend that stalls -- mid-training, mid-git-push, or simply busy -- gets a
 * new request every few seconds from every open tab, none of which ever
 * complete. Browsers cap concurrent connections per host at around six, so
 * within twenty seconds a single stalled endpoint can consume the entire
 * budget and starve everything else the page needs, including sending a chat
 * message. The symptom is "the whole app froze", and the cause is a status
 * indicator nobody was looking at.
 *
 * So: one request in flight at a time, each with a deadline, and the next
 * scheduled only after the last one settles.
 */

/** A fetch that gives up. Anything polled should have a deadline shorter than its interval. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  // AbortSignal.any so a caller's own signal still works -- taking a timeout
  // should not cost the ability to cancel.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return await fetch(input, { ...init, signal });
}

export interface PollHandle {
  /** Stops the loop. Safe to call more than once. */
  stop: () => void;
}

/**
 * Run `task` repeatedly, waiting `intervalMs` AFTER each run finishes.
 *
 * Deliberately not setInterval: the gap is measured from completion, not from
 * the previous start, so a slow response delays the next request instead of
 * overlapping with it. A task that throws is treated as a completed attempt --
 * the loop keeps going, because a status poll that stops forever on one
 * network blip is worse than one that retries.
 */
export function startPolling(task: () => Promise<void>, intervalMs: number): PollHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    if (stopped) return;
    try {
      await task();
    } catch {
      /* an attempt that failed is still an attempt; keep polling */
    }
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
  };

  void run();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
