/**
 * Chat History — every saved AI Chat / Chat Groups thread, automatically
 * organized into topic groups.
 *
 * The organizing itself happens server-side and automatically: every time a
 * message is saved (POST /api/chat-history/save), ChatOrganizer
 * (models && skills/core/chat-organizer.ts) files that thread into a group
 * derived purely from the tokens the thread's own messages contain — there
 * is no manual "create a group" action anywhere in this page, and no
 * hardcoded category list. This page is a read-only view over
 * GET /api/chat-history/groups plus an "Ungrouped" fallback list for any
 * saved thread that hasn't been filed anywhere.
 *
 * Distinct from the "Chat Groups" nav item (hive-mind agents collaborating
 * on a live task, Spec Section 14) — that's a different feature entirely;
 * this page is a folder view over past conversation history.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Folder, MessageSquare, Users, RefreshCw, ChevronDown } from 'lucide-react'

export const Route = createFileRoute('/app/chat-history')({
  head: () => ({
    meta: [
      { title: 'Chat History · ASI Architect' },
      { name: 'description', content: 'Past chats, automatically organized into topic groups.' },
    ],
  }),
  component: ChatHistoryPage,
})

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
  return (
    <Link
      to={href}
      search={{ thread: thread.id }}
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm transition-all duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex min-w-0 items-center gap-2">
        {thread.source === 'chat-group' ? (
          <Users size={13} className="shrink-0 text-muted-foreground" />
        ) : (
          <MessageSquare size={13} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{thread.title || '(untitled)'}</span>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(thread.updatedAt)}</span>
    </Link>
  )
}

function GroupCard({ group }: { group: GroupWithThreads }) {
  const [open, setOpen] = useState(true)
  const labelText = open ? `Collapse ${group.name} group` : `Expand ${group.name} group`
  return (
    <Card className="space-y-2 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-95 transition-all duration-150 p-1"
        aria-expanded={open}
        aria-label={labelText}
        title={labelText}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Folder size={14} className="text-primary" />
          {group.name}
          <span className="text-[11px] font-normal text-muted-foreground">
            ({group.threads.length} chat{group.threads.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-muted-foreground">{timeAgo(group.updatedAt)}</span>
          <ChevronDown
            size={14}
            className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
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

function ChatHistoryPage() {
  const [groups, setGroups] = useState<GroupWithThreads[]>([])
  const [ungrouped, setUngrouped] = useState<ThreadSummary[]>([])
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

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Chat History</h1>
          <p className="text-xs text-muted-foreground">
            {totalChats} chat{totalChats !== 1 ? 's' : ''} across {groups.length} auto-organized group{groups.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground disabled:opacity-50 active:scale-95"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && totalChats === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          No saved chats yet — anything you send in AI Chat or Chat Groups (outside incognito mode) will show up here, automatically grouped by topic.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <GroupCard key={g.id} group={g} />
        ))}
      </div>

      {ungrouped.length > 0 && (
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Folder size={14} />
            Ungrouped
          </div>
          <div className="space-y-1.5">
            {ungrouped.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
