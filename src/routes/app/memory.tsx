/**
 * Memory files — what the agent remembers, and the ability to change it.
 *
 * The API for this existed before the page did, which meant "view and manage
 * what the agent remembers" was true only if you were willing to call it by
 * hand. Memory you cannot look at is memory you cannot correct.
 *
 * Reading is open, because this is your own instance's knowledge. Forgetting
 * is destruction and goes through the gated route, the same rule the wiki and
 * the store follow.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Brain, Loader2, RefreshCw, Trash2, Pin } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/app/memory')({
  head: () => ({
    meta: [
      { title: 'Memory · ASI Architect' },
      { name: 'description', content: 'View and manage what the agent remembers.' },
    ],
  }),
  component: MemoryPage,
})

interface MemoryItem {
  id: string
  content: string
  payload?: string
  tags: string[]
  importance: number
  accessCount: number
  timestamp: number
  /** Installed knowledge, exempt from capacity eviction. */
  pinned: boolean
}

interface MemoryResponse {
  total: number
  tagCounts: Record<string, number>
  memories: MemoryItem[]
}

function MemoryPage() {
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [forgetting, setForgetting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (query.trim()) params.set('q', query.trim())
      if (tag) params.set('tag', tag)
      const res = await fetch(`/api/memory?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [query, tag])

  useEffect(() => { void load() }, [load])

  const forget = async (item: MemoryItem) => {
    if (!window.confirm(`Forget this permanently?\n\n"${item.content.slice(0, 120)}"`)) return
    setForgetting(item.id)
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not forget it')
      toast.success('Forgotten')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setForgetting(null)
    }
  }

  const topTags = Object.entries(data?.tagCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  return (
    <div className="flex h-full flex-col gap-4 p-4 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Brain className="h-6 w-6 text-primary" />
          Memory
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything this instance remembers — what it was taught, what it learned from conversations,
          and the skills installed into it. {data ? <strong>{data.total.toLocaleString()}</strong> : '—'} memories.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search what it remembers…"
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Tag counts come from everything, not the filtered page, so the numbers
          do not silently change meaning as you search. */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTag('')}
          className={
            'rounded-full border px-3 py-1 text-xs transition-colors ' +
            (tag === '' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')
          }
        >
          All
        </button>
        {topTags.map(([name, count]) => (
          <button
            key={name}
            type="button"
            onClick={() => setTag(name === tag ? '' : name)}
            className={
              'rounded-full border px-3 py-1 text-xs transition-colors ' +
              (tag === name ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent')
            }
          >
            {name} ({count})
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading memory…
        </div>
      )}
      {error && (
        <Card className="p-4 border-destructive/40">
          <p className="text-sm text-destructive">Could not read memory: {error}</p>
        </Card>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-6">
        {!loading && !error && (data?.memories.length ?? 0) === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Nothing matches that.</p>
          </Card>
        )}
        {(data?.memories ?? []).map(item => (
          <Card key={item.id} className="p-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed break-words">{item.content}</p>
              {item.payload && (
                <p className="mt-1 text-xs text-muted-foreground break-words">
                  <span className="font-medium">answers with:</span> {item.payload}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {item.pinned && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-1.5 py-0.5 text-primary"
                    title="Installed knowledge — exempt from capacity eviction"
                  >
                    <Pin className="h-3 w-3" />
                    pinned
                  </span>
                )}
                {item.tags.slice(0, 5).map(t => (
                  <span key={t} className="rounded border border-border px-1.5 py-0.5 font-mono">{t}</span>
                ))}
                <span>recalled {item.accessCount}×</span>
                <span>{new Date(item.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 text-muted-foreground hover:text-destructive"
              disabled={forgetting === item.id}
              onClick={() => void forget(item)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {forgetting === item.id ? 'Forgetting…' : 'Forget'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}
