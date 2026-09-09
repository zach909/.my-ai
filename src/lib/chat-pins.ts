/**
 * Pinning a chat thread -- one fetch helper shared by every page that shows
 * a pin toggle (Chat History and Pinned Chats), so there is exactly one
 * place that knows the endpoint and request shape instead of it drifting
 * between two hand-rolled fetch() calls.
 */
export async function setThreadPinned(id: string, pinned: boolean): Promise<boolean> {
  const res = await fetch(`/api/chat-history/threads/${encodeURIComponent(id)}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { pinned?: boolean }
  return body.pinned === true
}
