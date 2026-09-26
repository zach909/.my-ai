/**
 * Activity — a live view of what the agent is doing: chat turns as they
 * run and every tool call it makes (which tool, who triggered it, the
 * arguments, and what came back). Polls GET /api/activity every 2s.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Activity, Loader2, MessageSquare, Pause, Play, Wrench } from '@/components/icons'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/app/activity')({
  head: () => ({
    meta: [
      { title: 'Activity · Corona' },
      { name: 'description', content: 'Live view of what the agent is doing and the tools it calls.' },
    ],
  }),
  component: ActivityPage,
})

interface ActivityEvent {
  id: string | number
  kind: 'chat' | 'tool'
  status: 'running' | 'ok' | 'error'
  title: string
  detail?: string
  args?: string
  origin?: string
  startedAt: number
  endedAt?: number
}

type Filter = 'all' | 'tool' | 'chat'

function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | number | null>(null)

  useEffect(() => {
    if (!live) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/activity')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (cancelled) return
        setEvents(Array.isArray(body.events) ? body.events : [])
        setToolsEnabled(body.toolsEnabled !== false)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [live])

  const shown = filter === 'all' ? events : events.filter((e) => e.kind === filter)
  const running = events.filter((e) => e.status === 'running')

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Activity className="h-6 w-6" /> Activity
          </h1>
          <p className="text-sm text-muted-foreground">
            {running.length > 0
              ? `Working now: ${running.map((r) => r.title).join(', ')}`
              : 'Idle. Chats and tool calls show up here as they happen.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setLive((v) => !v)}>
          {live ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
          {live ? 'Pause' : 'Resume'}
        </Button>
      </div>

      <div className="flex gap-2">
        {(['all', 'tool', 'chat'] as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'ghost'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'tool' ? 'Tool calls' : 'Chats'}
          </Button>
        ))}
      </div>

      {!toolsEnabled && (
        <p className="text-sm text-muted-foreground">The tool layer isn't attached, so only chat activity is shown.</p>
      )}
      {error && <p className="text-sm text-destructive">Couldn't load activity: {error}</p>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nothing yet.</Card>
      ) : (
        <div className="space-y-2">
          {shown.map((e) => {
            const expanded = open === e.id
            const ms = e.endedAt ? e.endedAt - e.startedAt : null
            return (
              <Card key={e.id} className="cursor-pointer p-3" onClick={() => setOpen(expanded ? null : e.id)}>
                <div className="flex items-center gap-3">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full',
                    e.status === 'ok' && 'bg-green-500',
                    e.status === 'error' && 'bg-red-500',
                    e.status === 'running' && 'animate-pulse bg-yellow-500')} />
                  {e.kind === 'tool'
                    ? <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className={cn('flex-1 truncate text-sm', e.kind === 'tool' && 'font-mono')}>{e.title}</span>
                  {e.origin && <span className="text-xs text-muted-foreground">{e.origin}</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(e.startedAt).toLocaleTimeString()}
                    {ms !== null && ` · ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}`}
                  </span>
                </div>
                {expanded && (
                  <div className="mt-3 space-y-2 text-xs">
                    {e.args && (
                      <div><div className="font-medium">Arguments</div>
                        <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2">{e.args}</pre></div>
                    )}
                    {e.detail && (
                      <div><div className="font-medium">{e.status === 'error' ? 'Error' : e.kind === 'tool' ? 'Result' : 'Details'}</div>
                        <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2">{e.detail}</pre></div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
