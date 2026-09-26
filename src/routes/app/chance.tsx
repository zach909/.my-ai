/**
 * Chance — an endless, shuffled feed of ideas for something to have the AI
 * do. Scroll to load more, "Try it" copies one and opens Chats. Your own
 * ideas can be posted to the feed and are kept in localStorage.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MessageSquare, RefreshCw, Sparkles } from '@/components/icons'
import builtInIdeas from '@/lib/chance-ideas.json'

const CUSTOM_KEY = 'chance_custom_ideas'

export const Route = createFileRoute('/app/chance')({
  head: () => ({
    meta: [
      { title: 'Chance · Corona' },
      { name: 'description', content: 'An endless feed of ideas for things to try.' },
    ],
  }),
  component: ChancePage,
})

function loadCustom(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

function saveCustom(ideas: string[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(ideas)) } catch { /* ignore */ }
}

const PAGE_SIZE = 8

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function ChancePage() {
  const navigate = useNavigate()
  const [custom, setCustom] = useState<string[]>([])
  const [feed, setFeed] = useState<{ id: number; text: string }[]>([])
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)
  const deck = useRef<string[]>([])

  const pool = () => [...(builtInIdeas as string[]), ...loadCustom()]

  // Deal ideas from a shuffled deck; reshuffle when empty so the feed never
  // runs out, avoiding the same idea twice in a row across reshuffles.
  const loadMore = useCallback(() => {
    const all = pool()
    if (all.length === 0) return
    const batch: { id: number; text: string }[] = []
    for (let i = 0; i < PAGE_SIZE; i++) {
      if (deck.current.length === 0) deck.current = shuffle(all)
      const text = deck.current.pop()!
      batch.push({ id: nextId.current++, text })
    }
    setFeed((f) => [...f, ...batch])
  }, [])

  useEffect(() => {
    setCustom(loadCustom())
    loadMore()
  }, [loadMore])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore()
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const refresh = () => {
    deck.current = []
    setFeed([])
    loadMore()
  }

  const addIdea = () => {
    const text = draft.trim()
    if (!text) return
    const updated = [...custom, text]
    setCustom(updated)
    saveCustom(updated)
    setDraft('')
    setFeed((f) => [{ id: nextId.current++, text }, ...f])
  }

  const removeIdea = (i: number) => {
    const updated = custom.filter((_, j) => j !== i)
    setCustom(updated)
    saveCustom(updated)
  }

  const dismiss = (id: number) => setFeed((f) => f.filter((x) => x.id !== id))

  const tryIt = async (text: string, id: number) => {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
    setCopied(id)
    void navigate({ to: '/app/chat' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Sparkles className="h-6 w-6" /> Chance
          </h1>
          <p className="text-sm text-muted-foreground">A never-ending feed of things to try. Scroll, pick one, go.</p>
        </div>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" /> Shuffle
        </Button>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addIdea() }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Post your own idea to the feed…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={!draft.trim()}>Post</Button>
      </form>

      <div className="space-y-3">
        {feed.map((item) => (
          <Card key={item.id} className="space-y-3 p-4">
            <p className="text-base">{item.text}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void tryIt(item.text, item.id)} title="Copies the idea and opens Chats">
                <MessageSquare className="mr-2 h-4 w-4" /> {copied === item.id ? 'Copied!' : 'Try it'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>Not for me</Button>
            </div>
          </Card>
        ))}
        <div ref={sentinel} className="py-4 text-center text-sm text-muted-foreground">Loading more ideas…</div>
      </div>

      {custom.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Your ideas</h2>
          <ul className="space-y-1 text-sm">
            {custom.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted">
                <span>{c}</span>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => removeIdea(i)} aria-label="Remove">×</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
