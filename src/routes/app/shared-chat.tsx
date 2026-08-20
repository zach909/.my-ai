/**
 * Shared Chat — one room every visitor to this app reads and posts into,
 * with the bot as one participant rather than the exclusive other side of
 * the conversation. Backed by /api/shared-chat[/ask] and
 * `models && skills/core/shared-chat-store.ts`.
 *
 * Different from the two existing chat surfaces:
 *  - /app/chat ("AI Chat") is always exactly one human talking to the bot,
 *    in a private thread only that browser ever sees.
 *  - /app/chat-groups is multiple AI *agent* personas collaborating with
 *    each other -- no humans in the room at all.
 *  - This page (/app/shared-chat) is real people, in one flat log
 *    everyone who opens it sees. The bot never auto-replies to a plain
 *    message -- it only speaks when summoned with "Ask the bot", so it
 *    doesn't own the conversation the way /app/chat's bot does.
 *
 * A display name is picked once and remembered in localStorage (not an
 * account system -- this app has no login beyond the optional whole-server
 * password, see interface/web-server.ts's remoteAccessLock) so messages
 * from the same browser look consistent across visits.
 *
 * New messages are picked up by polling GET /api/shared-chat?since=<id>
 * every few seconds rather than a persistent connection -- the backend is
 * a plain request/response http.Server (interface/web-server.ts), with no
 * WebSocket support to build this on top of.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Send, Users, Sparkles, Loader2, Bot } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/app/shared-chat')({
  head: () => ({
    meta: [
      { title: 'Shared Chat · ASI Architect' },
      { name: 'description', content: 'A chat room shared by everyone who has this app, with the bot as one participant.' },
    ],
  }),
  component: SharedChatPage,
})

interface SharedMessage {
  id: string
  author: string
  text: string
  isBot: boolean
  time: number
}

const NAME_KEY = 'shared_chat_display_name'
const POLL_MS = 3000

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function SharedChatPage() {
  const [name, setName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [messages, setMessages] = useState<SharedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [asking, setAsking] = useState(false)
  const lastIdRef = useRef<string | undefined>(undefined)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(NAME_KEY)
    if (stored) setName(stored)
  }, [])

  // Arriving from the Wiki page's "Chat" button (?topic=<title>) pre-fills
  // the composer with a starting line about that page instead of posting
  // anything on its own -- unlike the old /app/chat behavior this replaced,
  // landing here doesn't broadcast a message to the whole room before the
  // person decided they actually want to send one.
  useEffect(() => {
    const topic = new URLSearchParams(window.location.search).get('topic')
    if (!topic) return
    window.history.replaceState({}, '', window.location.pathname)
    setDraft(`Let's talk about the wiki page "${topic}" -- `)
    // One-time "arrived with a topic" prefill, not something that should
    // re-run as chat state changes.
  }, [])

  const fetchNew = useCallback(async () => {
    try {
      const url = lastIdRef.current
        ? `/api/shared-chat?since=${encodeURIComponent(lastIdRef.current)}`
        : '/api/shared-chat'
      const res = await fetch(url)
      if (!res.ok) return
      const data: { messages: SharedMessage[] } = await res.json()
      if (data.messages.length === 0) return
      lastIdRef.current = data.messages[data.messages.length - 1].id
      setMessages(prev => [...prev, ...data.messages])
    } catch {
      // Polling failure is silent -- the next tick tries again, and there's
      // nothing actionable for the user to do about one missed poll.
    }
  }, [])

  useEffect(() => {
    if (!name) return
    fetchNew()
    pollRef.current = setInterval(fetchNew, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [name, fetchNew])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const chooseName = () => {
    const trimmed = nameDraft.trim().slice(0, 40)
    if (!trimmed) return
    localStorage.setItem(NAME_KEY, trimmed)
    setName(trimmed)
  }

  const post = async (endpoint: '/api/shared-chat' | '/api/shared-chat/ask') => {
    const text = draft.trim()
    if (!text) return
    const setBusy = endpoint === '/api/shared-chat/ask' ? setAsking : setSending
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: name, text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to send message')
      setDraft('')
      await fetchNew()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setBusy(false)
    }
  }

  if (!name) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <Card className="w-full max-w-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h1 className="font-semibold text-sm">Join Shared Chat</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Pick a display name. It's remembered on this browser only -- there's no account system.
          </p>
          <Input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && chooseName()}
            placeholder="Display name"
            autoFocus
          />
          <Button className="w-full" onClick={chooseName} disabled={!nameDraft.trim()}>
            Join
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border px-4 py-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <div>
          <h1 className="font-semibold text-sm">Shared Chat</h1>
          <p className="text-[11px] text-muted-foreground">
            Posting as <span className="font-medium text-foreground">{name}</span> -- everyone with this app sees this room.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No messages yet -- say something.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex gap-2 ${m.isBot ? 'items-start' : 'items-start'}`}>
            <div
              className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                m.isBot ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              {m.isBot ? <Bot size={12} /> : m.author.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium">{m.author}</span>
                <span className="text-[10px] text-muted-foreground">{formatTime(m.time)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-border p-3 space-y-2">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && post('/api/shared-chat')}
            placeholder="Message the room..."
            disabled={sending || asking}
          />
          <Button onClick={() => post('/api/shared-chat')} disabled={!draft.trim() || sending || asking}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            onClick={() => post('/api/shared-chat/ask')}
            disabled={!draft.trim() || sending || asking}
            title="Send this to the room and ask the bot to reply, visible to everyone"
          >
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-1.5 hidden sm:inline">Ask the bot</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
