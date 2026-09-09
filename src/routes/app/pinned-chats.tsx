/**
 * Pinned Chats — every thread pinned from Chat History, on its own nav
 * entry so it doesn't need digging through the full (auto-grouped, mostly
 * unpinned) history to find. Read-only list over
 * GET /api/chat-history/threads?pinned=true plus the same unpin action
 * Chat History's own pin button uses (setThreadPinned) -- one source of
 * truth for pinned state, two places to see/change it.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Loader2, MessageSquare, Pin, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ThreadRow, type ThreadSummary } from './chat-groups'
import { setThreadPinned } from '@/lib/chat-pins'

export const Route = createFileRoute('/app/pinned-chats')({
  head: () => ({
    meta: [
      { title: 'Pinned Chats · Corona' },
      { name: 'description', content: 'Chats you have pinned, kept out of the way of everything else in Chat History.' },
    ],
  }),
  component: PinnedChatsPage,
})

function PinnedChatsPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat-history/threads?pinned=true')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setThreads(Array.isArray(body.threads) ? body.threads : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // Unpinning here means "leave this list" -- so instead of an optimistic
  // in-place flip (Chat History's own togglePin), it removes the row on
  // success and puts it back on failure. That's the only thing meaningfully
  // different about pinning from *this* page.
  const unpin = async (thread: ThreadSummary) => {
    setThreads((ts) => ts.filter((t) => t.id !== thread.id))
    try {
      await setThreadPinned(thread.id, false)
    } catch (err) {
      setThreads((ts) => [...ts, thread].sort((a, b) => b.updatedAt - a.updatedAt))
      toast.error(err instanceof Error ? err.message : 'Could not unpin')
    }
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-primary" />
          <p className="text-xs text-muted-foreground">
            {threads.length} pinned chat{threads.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={load}
          disabled={loading}
          variant="outline"
          size="sm"
          aria-label="Refresh pinned chats"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground active:scale-95 self-start sm:self-auto"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          Refresh
        </Button>
      </div>

      {loading && threads.length === 0 && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      {!loading && threads.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center max-w-md mx-auto my-6 space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Pin className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground text-sm">No pinned chats yet</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Pin a conversation from Chat History to keep it here, out of the way of everything else.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
              <Link to="/app/chat-groups">
                <MessageSquare size={13} className="mr-1" />
                Open Chat History
              </Link>
            </Button>
            <Button asChild size="sm" className="active:scale-95 transition-all duration-150">
              <Link to="/app/chat">
                <Sparkles size={13} className="mr-1" />
                Start AI Chat
              </Link>
            </Button>
          </div>
        </div>
      )}

      {threads.length > 0 && (
        <Card className="space-y-1.5 p-4">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} onTogglePin={unpin} />
          ))}
        </Card>
      )}
    </div>
  )
}
