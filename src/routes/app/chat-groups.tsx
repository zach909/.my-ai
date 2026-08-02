/**
 * Chat Groups — hive-mind agents collaborating on a task (Spec Section 14).
 *
 * Backed by NeuroclawSystem.collaborate(): the default chat group's members
 * are drawn from the hive, discuss the submitted task, and vote on a
 * decision. This page is a thin client over /api/chat-groups/* — all the
 * discussion, trust weighting, and decision logic lives in
 * `models && skills/core/{hive-mind,chat-group}.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Users, Send, Vote, Zap } from 'lucide-react'

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

function ChatGroupsPage() {
  const [agents, setAgents] = useState<HiveAgentSnapshot[]>([])
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-focus the input element once loading finishes
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus()
    }
  }, [loading])

  const refreshAgents = () => {
    fetch('/api/chat-groups/agents')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load hive agents')
        setAgents(Array.isArray(data.agents) ? data.agents : [])
      })
      .catch((err) => setAgentsError(err instanceof Error ? err.message : String(err)))
  }

  // The hive spawns its default team lazily, on the first hive-based call
  // (collaborate/solve/autonomousTask) — so the roster is often empty here
  // and only appears once the first task below has been submitted.
  useEffect(() => {
    refreshAgents()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rounds])

  const submitTask = async () => {
    const text = task.trim()
    if (!text) return
    setTask('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat-groups/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Collaboration failed')
      setRounds((prev) => [
        ...prev,
        {
          id: `round_${Date.now()}`,
          task: text,
          discussion: Array.isArray(data.discussion) ? data.discussion : [],
          decision: data.decision ?? '',
          complete: !!data.complete,
        },
      ])
      if (agents.length === 0) refreshAgents()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

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
        <div role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto px-1 py-1">
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
