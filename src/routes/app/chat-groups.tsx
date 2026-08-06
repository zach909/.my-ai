/**
 * Chat Groups — hive-mind agents collaborating on a task (Spec Section 14).
 *
 * Backed by NeuroclawSystem.collaborate(): the default chat group's members
 * are drawn from the hive, discuss the submitted task, and vote on a
 * decision. This page is a thin client over /api/chat-groups/* — all the
 * discussion, trust weighting, and decision logic lives in
 * `models && skills/core/{hive-mind,chat-group}.ts`.
 *
 * Optionally locked behind its own password (NEUROCLAW_CHAT_GROUPS_PASSWORD
 * on the server, independent of the whole-server remote-access password) --
 * see interface/web-server.ts's chatGroupsLock. The password is kept only
 * in this component's React state, never localStorage/cookies/disk: it
 * lives exactly as long as the tab does.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Users, Send, Vote, Zap, Lock, EyeOff, History } from 'lucide-react'

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
      { title: 'Chat Groups · ASI Architect' },
      { name: 'description', content: 'Hive-mind agents collaborating on a task through a shared chat group.' },
    ],
  }),
  component: ChatGroupsPage,
})

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

/** Shown instead of the normal page while the server reports chat groups as locked and no valid password has been entered yet. */
function LockScreen({ onUnlock }: { onUnlock: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('')
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
    <div className="flex h-[calc(100vh-120px)] items-center justify-center p-4">
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
          <Label htmlFor="chat-groups-password" className="sr-only">
            Password
          </Label>
          <Input
            id="chat-groups-password"
            type="password"
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
            className="flex-1"
          />
          <Button
            onClick={submit}
            disabled={checking || !password}
            size="sm"
            className="active:scale-95 transition-all duration-150"
          >
            Unlock
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ChatGroupsPage() {
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

  // Arriving from the Chat History page (?thread=<id>) hydrates that round
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
    <div className="flex h-[calc(100vh-120px)] gap-4 p-4">
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
            <p className="text-sm text-muted-foreground">
              Submit a task below — the hive's chat group will discuss it and vote on a decision.
            </p>
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
              aria-label="Submit task to hive"
              title="Submit task to hive"
            >
              <Send size={16} />
              <span className="hidden sm:inline">Submit</span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
