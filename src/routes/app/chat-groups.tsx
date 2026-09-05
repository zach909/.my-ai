/**
 * Chat Groups — hive-mind agents collaborating on a task (Spec Section 14),
 * plus Chat History and Memory as tabs alongside it. All three are views over
 * "what has this instance said, discussed, or remembered" -- they used to be
 * three separate nav entries; they are tabs of one page now.
 *
 * The Chat Groups tab is backed by NeuroclawSystem.collaborate(): the default
 * chat group's members are drawn from the hive, discuss the submitted task,
 * and vote on a decision. This page is a thin client over /api/chat-groups/*
 * -- all the discussion, trust weighting, and decision logic lives in
 * `models && skills/core/{hive-mind,chat-group}.ts`.
 *
 * Optionally locked behind its own password (NEUROCLAW_CHAT_GROUPS_PASSWORD
 * on the server, independent of the whole-server remote-access password) --
 * see interface/web-server.ts's chatGroupsLock. The password is kept only
 * in ChatGroupsPanel's React state, never localStorage/cookies/disk: it
 * lives exactly as long as the tab does. The lock applies only to the Chat
 * Groups tab itself -- Chat History and Memory are unrelated data and are
 * not gated by it.
 *
 * Chat History organizes every saved AI Chat / Chat Groups thread
 * automatically: every time a message is saved (POST /api/chat-history/save),
 * ChatOrganizer (models && skills/core/chat-organizer.ts) files that thread
 * into a group derived purely from the tokens the thread's own messages
 * contain -- there is no manual "create a group" action anywhere in this
 * tab, and no hardcoded category list. It's a read-only view over
 * GET /api/chat-history/groups plus an "Ungrouped" fallback list for any
 * saved thread that hasn't been filed anywhere.
 *
 * Memory is what the agent remembers, and the ability to change it. Reading
 * is open, because this is your own instance's knowledge. Forgetting is
 * destruction and goes through the gated route, the same rule the wiki and
 * the store follow.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Users, Send, Vote, Zap, Lock, Eye, EyeOff, History, Loader2, Sparkles,
  Folder, MessageSquare, RefreshCw, ChevronDown, ArrowRight, Search, X,
  Brain, Trash2, Pin, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  )
}

export const Route = createFileRoute('/app/chat-groups')({
  head: () => ({
    meta: [
      { title: 'Chat Groups · Corona' },
      { name: 'description', content: 'Hive-mind agents collaborating on a task, chat history, and memory management.' },
    ],
  }),
  component: ChatGroupsPage,
})

type ChatGroupsTab = 'groups' | 'history' | 'memory'

const CHAT_GROUPS_TABS: { key: ChatGroupsTab; label: string; icon: typeof Users }[] = [
  { key: 'groups', label: 'Chat Groups', icon: Users },
  { key: 'history', label: 'Chat History', icon: Folder },
  { key: 'memory', label: 'Memory', icon: Brain },
]

function ChatGroupsPage() {
  const [tab, setTab] = useState<ChatGroupsTab>('groups')

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col">
      <div className="flex gap-1 border-b border-border px-4 pt-2" role="tablist" aria-label="Chat Groups tabs">
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
        {tab === 'groups' && <ChatGroupsPanel />}
        {tab === 'history' && <ChatHistoryPanel />}
        {tab === 'memory' && <MemoryPanel />}
      </div>
    </div>
  )
}

interface HiveAgentSnapshot {
  id: string
  role: string
  specialization: string
  trust: number
}

interface Round {
  id: string
  task: string
  discussion: string[]
  decision: string
  complete: boolean
}

interface ChatMatch {
  threadId: string
  title: string
  score: number
  snippet: string
  updatedAt: number
}

function chatGroupsHeaders(password: string | null): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (password) headers['X-Chat-Groups-Password'] = password
  return headers
}

/** Shown instead of the normal panel while the server reports chat groups as locked and no valid password has been entered yet. */
function LockScreen({ onUnlock }: { onUnlock: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!password) return
    setChecking(true)
    setError(null)
    const ok = await onUnlock(password)
    if (!ok) setError('Incorrect password')
    setChecking(false)
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-3 p-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock size={14} />
          Chat Groups is locked
        </div>
        <p className="text-xs text-muted-foreground">
          This server requires a password to access chat groups.
        </p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <div className="relative flex-1 flex items-center">
            <Label htmlFor="chat-groups-password" className="sr-only">
              Password
            </Label>
            <Input
              id="chat-groups-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Password"
              disabled={checking}
              autoFocus
              className="flex-1 pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={checking || !password}
              className="absolute right-1 h-7 w-7 p-0 text-muted-foreground hover:text-foreground active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
          <Button
            onClick={submit}
            disabled={checking || !password}
            size="sm"
            className="active:scale-95 transition-all duration-150 gap-2"
            aria-label={checking ? "Unlocking Chat Groups" : "Unlock Chat Groups"}
          >
            {checking && <Loader2 size={14} className="animate-spin" />}
            {checking ? "Unlocking..." : "Unlock"}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ChatGroupsPanel() {
  // null = still checking server lock status; true/false once known.
  const [locked, setLocked] = useState<boolean | null>(null)
  const [password, setPassword] = useState<string | null>(null)

  const [agents, setAgents] = useState<HiveAgentSnapshot[]>([])
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incognito, setIncognito] = useState(false)
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const [pendingMatch, setPendingMatch] = useState<{ match: ChatMatch; text: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/chat-groups/lock-status')
      .then((res) => res.json())
      .then((data) => setLocked(!!data.locked))
      .catch(() => setLocked(false)) // fail open to "not locked" only for the status check itself -- the real gate is still enforced server-side on every /api/chat-groups/* call
  }, [])

  // Re-focus the input element once loading finishes
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus()
    }
  }, [loading])

  const refreshAgents = (pw: string | null) => {
    fetch('/api/chat-groups/agents', { headers: chatGroupsHeaders(pw) })
      .then(async (res) => {
        if (res.status === 401) {
          setLocked(true)
          setPassword(null)
          return
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load hive agents')
        setAgents(Array.isArray(data.agents) ? data.agents : [])
      })
      .catch((err) => setAgentsError(err instanceof Error ? err.message : String(err)))
  }

  // The hive spawns its default team lazily, on the first hive-based call
  // (collaborate/solve/autonomousTask) — so the roster is often empty here
  // and only appears once the first task below has been submitted. Runs
  // only on the locked -> false transition, not on every password change:
  // unlock() already applies its own response to `agents` directly, so
  // re-running this on `password` too would just be a redundant fetch.
  useEffect(() => {
    if (locked === false) refreshAgents(password)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rounds])

  // Arriving from the Chat History tab (?thread=<id>) hydrates that round
  // history immediately instead of starting a fresh session.
  useEffect(() => {
    const threadParam = new URLSearchParams(window.location.search).get('thread')
    if (threadParam) {
      continueThread({ threadId: threadParam, title: '', score: 1, snippet: '', updatedAt: Date.now() })
    }
  }, [])

  const unlock = async (candidate: string): Promise<boolean> => {
    const res = await fetch('/api/chat-groups/agents', { headers: chatGroupsHeaders(candidate) })
    if (res.status === 401) return false
    setPassword(candidate)
    setLocked(false)
    const data = await res.json().catch(() => null)
    if (data && Array.isArray(data.agents)) setAgents(data.agents)
    return true
  }

  // A round's discussion/decision/complete is packed into the assistant
  // message's content as JSON so continueThread() below can rebuild real
  // Round objects instead of losing that structure to plain text.
  const saveToHistory = async (role: 'user' | 'assistant', content: string, id: string | undefined): Promise<string | undefined> => {
    if (incognito) return id
    try {
      const res = await fetch('/api/chat-history/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: id, source: 'chat-group', role, content }),
      })
      if (!res.ok) return id
      const data = await res.json()
      return data.threadId ?? id
    } catch {
      return id
    }
  }

  const continueThread = async (match: ChatMatch) => {
    setPendingMatch(null)
    try {
      const res = await fetch(`/api/chat-history/threads/${encodeURIComponent(match.threadId)}`)
      if (!res.ok) return
      const data = await res.json()
      const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = data.thread?.messages ?? []
      const restored: Round[] = []
      for (let i = 0; i < msgs.length - 1; i += 2) {
        if (msgs[i].role !== 'user' || msgs[i + 1]?.role !== 'assistant') continue
        try {
          const parsed = JSON.parse(msgs[i + 1].content)
          restored.push({
            id: `restored_${i}`,
            task: msgs[i].content,
            discussion: Array.isArray(parsed.discussion) ? parsed.discussion : [],
            decision: parsed.decision ?? '',
            complete: !!parsed.complete,
          })
        } catch {
          // Older/foreign entry that isn't a packed round -- skip rather than crash the restore.
        }
      }
      if (restored.length > 0) setRounds(restored)
      setThreadId(match.threadId)
    } catch {
      // Match couldn't be loaded -- fall through and just keep the current session.
    }
  }

  const runRound = async (text: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat-groups/collaborate', {
        method: 'POST',
        headers: chatGroupsHeaders(password),
        body: JSON.stringify({ task: text }),
      })
      if (res.status === 401) {
        setLocked(true)
        setPassword(null)
        throw new Error('Chat groups is locked')
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Collaboration failed')
      const discussion = Array.isArray(data.discussion) ? data.discussion : []
      const decision = data.decision ?? ''
      const complete = !!data.complete
      setRounds((prev) => [...prev, { id: `round_${Date.now()}`, task: text, discussion, decision, complete }])
      const savedId = await saveToHistory('user', text, threadId)
      const finalId = await saveToHistory('assistant', JSON.stringify({ discussion, decision, complete }), savedId)
      if (finalId !== threadId) setThreadId(finalId)
      if (agents.length === 0) refreshAgents(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const submitTask = async () => {
    const text = task.trim()
    if (!text) return
    setTask('')

    // Only check for a match at the start of a genuinely new session (no
    // thread adopted, no rounds run yet) -- once a session is underway
    // there's nothing to "continue" into instead.
    if (!incognito && !threadId && rounds.length === 0) {
      try {
        const res = await fetch(`/api/chat-history/search?q=${encodeURIComponent(text)}&source=chat-group`)
        if (res.ok) {
          const data = await res.json()
          const best: ChatMatch | undefined = data.matches?.[0]
          if (best && best.score > 0.3) {
            setPendingMatch({ match: best, text })
            return
          }
        }
      } catch {
        // Search unavailable -- fall through and just run normally.
      }
    }

    await runRound(text)
  }

  if (locked === null) return null
  if (locked) return <LockScreen onUnlock={unlock} />

  return (
    <div className="flex h-full gap-4 p-4">
      <Card className="w-64 shrink-0 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users size={14} />
          Hive Team
        </div>
        {agentsError && <p className="text-xs text-destructive">{agentsError}</p>}
        {!agentsError && agents.length === 0 && (
          <p className="text-xs text-muted-foreground">No hive agents registered yet.</p>
        )}
        <div className="space-y-2">
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{agent.role}</span>
                <Chip className="bg-secondary text-secondary-foreground">
                  trust {agent.trust.toFixed(1)}
                </Chip>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{agent.specialization}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-end px-1 pb-2">
          <Button
            variant={incognito ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIncognito((v) => !v)}
            className="gap-1.5 text-xs active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            title={incognito ? 'Incognito: this session is not saved' : 'Turn on incognito mode (nothing gets saved)'}
            aria-pressed={incognito}
            aria-label={incognito ? 'Disable incognito mode' : 'Enable incognito mode'}
          >
            <EyeOff size={12} />
            {incognito ? 'Incognito on' : 'Incognito'}
          </Button>
        </div>

        <div role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
          {pendingMatch && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <History size={15} className="mt-0.5 shrink-0 text-primary" />
              <div className="flex-1 space-y-2">
                <p>
                  This looks like an earlier session <span className="font-medium">&ldquo;{pendingMatch.match.title}&rdquo;</span> — continue there instead?
                </p>
                <p className="text-xs text-muted-foreground">{pendingMatch.match.snippet}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="active:scale-95 transition-all duration-150"
                    onClick={() => continueThread(pendingMatch.match).then(() => runRound(pendingMatch.text))}
                  >
                    Continue there
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="active:scale-95 transition-all duration-150"
                    onClick={() => {
                      const text = pendingMatch.text
                      setPendingMatch(null)
                      runRound(text)
                    }}
                  >
                    Start new
                  </Button>
                </div>
              </div>
            </div>
          )}

          {rounds.length === 0 && !loading && (
            <div className="mx-auto my-auto flex max-w-md flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-card/40 p-6 text-center backdrop-blur-xs space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Hive Collaboration Ready</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Submit a task below — the hive&apos;s agents will discuss it, weigh trust, and vote on a consensus decision.
                </p>
              </div>
              <div className="space-y-1.5 pt-1 w-full">
                <p className="text-[11px] text-muted-foreground italic">Try a sample task:</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {[
                    'Analyze sandbox safety boundaries',
                    'Design consensus protocol',
                    'Evaluate system architecture',
                  ].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => {
                        setTask(sample)
                        inputRef.current?.focus()
                      }}
                      className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-foreground active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none cursor-pointer"
                      aria-label={`Use sample task: ${sample}`}
                    >
                      +{sample}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2">
                <Button asChild size="sm" variant="outline" className="active:scale-95 transition-all duration-150">
                  <Link to="/app/chat">
                    <Sparkles size={13} className="mr-1.5 text-primary" />
                    Start AI Chat
                  </Link>
                </Button>
              </div>
            </div>
          )}
          {rounds.map((round) => (
            <div key={round.id} className="space-y-2">
              <div className="max-w-xl rounded-lg border border-border bg-primary text-primary-foreground px-4 py-3 text-sm">
                {round.task}
              </div>
              <div className="space-y-1 rounded-lg border border-border bg-card px-4 py-3">
                {round.discussion.map((line, i) => (
                  <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                    {line}
                  </p>
                ))}
                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-sm">
                  <Vote size={13} className="text-primary" />
                  <span className="font-medium">Decision:</span>
                  <span>{round.decision}</span>
                  {round.complete && <Chip className="ml-auto">complete</Chip>}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <Zap size={14} className="animate-pulse" />
              Hive is discussing…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <Card className="mx-0 mt-2 space-y-2 rounded-none border-x-0 border-b-0 p-4">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Label htmlFor="task-input" className="sr-only">
              Task description
            </Label>
            <Input
              id="task-input"
              ref={inputRef}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitTask()
                }
              }}
              placeholder="Describe a task for the hive to collaborate on…"
              disabled={loading}
              autoFocus
              className="flex-1"
            />
            <Button
              onClick={submitTask}
              disabled={loading || !task.trim()}
              size="sm"
              className="gap-2 active:scale-95 transition-all duration-150"
              aria-label={loading ? "Submitting task to hive" : "Submit task to hive"}
              title={loading ? "Submitting..." : "Submit task to hive"}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              <span className="hidden sm:inline">
                {loading ? "Submitting..." : "Submit"}
              </span>
            </Button>
          </div>
        </Card>
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
