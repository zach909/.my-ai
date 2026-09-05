/**
 * Chat History — every saved AI Chat thread, plus Memory, as tabs of one
 * page. Both are views over "what has this instance said or remembered" --
 * they used to be two separate nav entries; they are tabs of one page now.
 *
 * This page used to also host a "Chat Groups" hive-collaboration tab (submit
 * a task, the hive's agents discuss it and vote on a decision). "the idea of
 * hive mind is the ai can tell a nouther ai what to do" -- that discuss-and-
 * vote UI didn't match what hive mind is actually for, so it's gone. One AI
 * directing another is now a plugin instead (plugins/hive.ts's `hive ask
 * <role>: <task>` and `hive summon ...`), reachable from any chat rather
 * than needing its own page. The underlying hive-mind engine
 * (`models && skills/core/hive-mind.ts`) and its /api/chat-groups/* routes
 * are unchanged and still used by that plugin -- only this page's UI for it
 * is removed. A "chat-group" thread saved from an earlier session can still
 * show up below (chat history is a record of everything ever saved,
 * regardless of source); there is just no page left to replay its
 * discussion/decision content.
 *
 * Chat History organizes every saved thread automatically: every time a
 * message is saved (POST /api/chat-history/save), ChatOrganizer
 * (models && skills/core/chat-organizer.ts) files that thread into a group
 * derived purely from the tokens the thread's own messages contain -- there
 * is no manual "create a group" action anywhere in this tab, and no
 * hardcoded category list. It's a read-only view over
 * GET /api/chat-history/groups plus an "Ungrouped" fallback list for any
 * saved thread that hasn't been filed anywhere.
 *
 * Memory is what the agent remembers, and the ability to change it. Reading
 * is open, because this is your own instance's knowledge. Forgetting is
 * destruction and goes through the gated route, the same rule the wiki and
 * the store follow.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Users, Loader2, Sparkles,
  Folder, MessageSquare, RefreshCw, ChevronDown, ArrowRight, Search, X,
  Brain, Trash2, Pin, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/app/chat-groups')({
  head: () => ({
    meta: [
      { title: 'Chat History · Corona' },
      { name: 'description', content: 'Past chats, automatically organized into topic groups, and memory management.' },
    ],
  }),
  component: ChatGroupsPage,
})

type ChatGroupsTab = 'history' | 'memory'

const CHAT_GROUPS_TABS: { key: ChatGroupsTab; label: string; icon: typeof Folder }[] = [
  { key: 'history', label: 'Chat History', icon: Folder },
  { key: 'memory', label: 'Memory', icon: Brain },
]

function ChatGroupsPage() {
  const [tab, setTab] = useState<ChatGroupsTab>('history')

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col">
      <div className="flex gap-1 border-b border-border px-4 pt-2" role="tablist" aria-label="Chat History tabs">
        {CHAT_GROUPS_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'history' && <ChatHistoryPanel />}
        {tab === 'memory' && <MemoryPanel />}
      </div>
    </div>
  )
}

interface ThreadSummary {
  id: string
  title: string
  source: 'chat' | 'chat-group'
  updatedAt: number
  createdAt?: number
}

interface GroupWithThreads {
  id: string
  name: string
  keywords: string[]
  threadIds: string[]
  updatedAt: number
  threads: ThreadSummary[]
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ThreadRow({ thread }: { thread: ThreadSummary }) {
  const href = thread.source === 'chat-group' ? '/app/chat-groups' : '/app/chat'
  const sourceName = thread.source === 'chat-group' ? 'hive discussion' : 'AI chat'
  const titleText = thread.title || 'untitled'

  return (
    <Link
      to={href}
      search={{ thread: thread.id }}
      aria-label={`Continue ${sourceName}: ${titleText}`}
      className="group flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm transition-all duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98]"
    >
      <div className="flex min-w-0 items-center gap-2">
        {thread.source === 'chat-group' ? (
          <Users size={13} className="shrink-0 text-muted-foreground" />
        ) : (
          <MessageSquare size={13} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate group-hover:text-primary transition-colors">{titleText}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[11px] text-muted-foreground">{timeAgo(thread.updatedAt)}</span>
        <ArrowRight
          size={13}
          className="text-primary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus:opacity-100 group-focus:translate-x-0 transition-all duration-150"
          aria-hidden="true"
        />
      </div>
    </Link>
  )
}

function GroupCard({ group }: { group: GroupWithThreads }) {
  const [open, setOpen] = useState(true)
  return (
    <Card className="space-y-2 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left rounded-md p-1 -m-1 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none transition-all duration-200 active:scale-95 cursor-pointer"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name} group, containing ${group.threads.length} chat${group.threads.length !== 1 ? 's' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Folder size={14} className="shrink-0 text-primary" />
          <span className="truncate">{group.name}</span>
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
            ({group.threads.length})
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span>{timeAgo(group.updatedAt)}</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && (
        <div className="space-y-1.5 pt-1">
          {group.threads.map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </div>
      )}
    </Card>
  )
}

/** Was the standalone /app/chat-history page. */
function ChatHistoryPanel() {
  const [groups, setGroups] = useState<GroupWithThreads[]>([])
  const [ungrouped, setUngrouped] = useState<ThreadSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [groupsRes, threadsRes] = await Promise.all([
        fetch('/api/chat-history/groups'),
        fetch('/api/chat-history/threads'),
      ])
      const groupsData = await groupsRes.json()
      const threadsData = await threadsRes.json()
      const groupList: GroupWithThreads[] = Array.isArray(groupsData.groups) ? groupsData.groups : []
      const allThreads: ThreadSummary[] = Array.isArray(threadsData.threads) ? threadsData.threads : []
      const grouped = new Set(groupList.flatMap((g) => g.threadIds))
      setGroups(groupList.sort((a, b) => b.updatedAt - a.updatedAt))
      setUngrouped(allThreads.filter((t) => !grouped.has(t.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const totalChats = groups.reduce((s, g) => s + g.threads.length, 0) + ungrouped.length

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) {
      return { groups, ungrouped, totalFilteredChats: totalChats }
    }

    const filteredGroups = groups
      .map((g) => {
        const groupNameMatches = g.name.toLowerCase().includes(q)
        const matchingThreads = g.threads.filter((t) => (t.title || 'untitled').toLowerCase().includes(q))
        if (groupNameMatches) {
          return g
        }
        if (matchingThreads.length > 0) {
          return { ...g, threads: matchingThreads }
        }
        return null
      })
      .filter((g): g is GroupWithThreads => g !== null)

    const filteredUngrouped = ungrouped.filter((t) => (t.title || 'untitled').toLowerCase().includes(q))

    const totalFilteredChats =
      filteredGroups.reduce((s, g) => s + g.threads.length, 0) + filteredUngrouped.length

    return { groups: filteredGroups, ungrouped: filteredUngrouped, totalFilteredChats }
  }, [groups, ungrouped, searchQuery, totalChats])

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      {/* Live ARIA status region for screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {searchQuery.trim()
          ? `Found ${filteredData.totalFilteredChats} chat${filteredData.totalFilteredChats !== 1 ? 's' : ''} matching "${searchQuery.trim()}"`
          : `${totalChats} total chat${totalChats !== 1 ? 's' : ''} available`}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {totalChats} chat{totalChats !== 1 ? 's' : ''} across {groups.length} auto-organized group{groups.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={load}
          disabled={loading}
          variant="outline"
          size="sm"
          aria-label="Refresh chat history"
          title="Refresh chat history"
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground active:scale-95 self-start sm:self-auto"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
          Refresh
        </Button>
      </div>

      {totalChats > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="chat-history-search" className="sr-only">
            Filter chat history
          </Label>
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="chat-history-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats or groups…"
              className="pl-9 pr-8 text-xs h-9"
              aria-label="Filter chat history"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search filter"
                title="Clear search filter"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      {!loading && totalChats === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center max-w-md mx-auto my-6 space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground text-sm">No saved chats yet</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Anything you send in AI Chat or Chat Groups (outside incognito mode) will show up here, automatically grouped by topic.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild size="sm" className="active:scale-95 transition-all duration-150">
              <Link to="/app/chat">
                <Sparkles size={13} className="mr-1" />
                Start AI Chat
              </Link>
            </Button>
          </div>
        </div>
      )}

      {!loading && totalChats > 0 && filteredData.totalFilteredChats === 0 && searchQuery.trim() !== '' && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center max-w-sm mx-auto my-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            No conversations or topic groups matching &ldquo;{searchQuery}&rdquo;
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchQuery('')}
            className="text-xs active:scale-95 transition-all duration-150"
            aria-label="Clear search query filter"
          >
            Clear Filter
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredData.groups.map((g) => (
          <GroupCard key={g.id} group={g} />
        ))}
      </div>

      {filteredData.ungrouped.length > 0 && (
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Folder size={14} />
            Ungrouped
          </div>
          <div className="space-y-1.5">
            {filteredData.ungrouped.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

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

/** Was the standalone /app/memory page. */
function MemoryPanel() {
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [wiping, setWiping] = useState(false)

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

  /**
   * Forget everything: every memory, every AI Chat thread, every shared chat
   * room. Two confirmations, because there is no undo and the second one is
   * cheap.
   *
   * The server asks for the confirm phrase too. That is not this dialog
   * repeated -- it is the route refusing to fire for anything that did not
   * come from a person who meant it, including a stray DELETE from some other
   * tool that never saw this page.
   */
  const deleteEverything = async () => {
    if (!window.confirm(
      'Delete ALL memory and chats?\n\n' +
      'Everything this instance remembers, every AI Chat thread, and every shared chat room. ' +
      'This cannot be undone.'
    )) return
    if (!window.confirm('Really delete all of it? There is no undo.')) return
    setWiping(true)
    try {
      const res = await fetch('/api/memory/all', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete everything' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not delete it')
      toast.success(
        `Deleted ${body.memories} memories, ${body.threads} chat threads and ${body.rooms} chat rooms`
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setWiping(false)
    }
  }

  const topTags = Object.entries(data?.tagCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <p className="text-sm text-muted-foreground">
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
        {/* Last in the row and visually apart: this is the one control here
            that cannot be taken back. */}
        <Button
          variant="destructive"
          size="sm"
          disabled={wiping}
          onClick={() => void deleteEverything()}
          className="ml-auto gap-2"
        >
          {wiping ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          {wiping ? 'Deleting…' : 'Delete all memory and chats'}
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
