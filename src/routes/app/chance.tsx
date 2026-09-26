/**
 * Chance — a "surprise me" page. Click the button, get a random idea for
 * something to have the AI do, then send it straight into Chats or roll
 * again. Your own ideas can be added and are kept in localStorage.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MessageSquare, RefreshCw, Sparkles } from '@/components/icons'
import builtInIdeas from '@/lib/chance-ideas.json'

const CUSTOM_KEY = 'chance_custom_ideas'

export const Route = createFileRoute('/app/chance')({
  head: () => ({
    meta: [
      { title: 'Chance · Corona' },
      { name: 'description', content: 'Click for a random idea of something to do.' },
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

function ChancePage() {
  const navigate = useNavigate()
  const [custom, setCustom] = useState<string[]>([])
  const [idea, setIdea] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => { setCustom(loadCustom()) }, [])

  const all = [...(builtInIdeas as string[]), ...custom]

  const roll = () => {
    if (all.length === 0) return
    let next = all[Math.floor(Math.random() * all.length)]
    if (all.length > 1) while (next === idea) next = all[Math.floor(Math.random() * all.length)]
    setIdea(next)
  }

  const addIdea = () => {
    const text = draft.trim()
    if (!text) return
    const updated = [...custom, text]
    setCustom(updated)
    saveCustom(updated)
    setDraft('')
  }

  const removeIdea = (i: number) => {
    const updated = custom.filter((_, j) => j !== i)
    setCustom(updated)
    saveCustom(updated)
  }

  const tryIt = async () => {
    if (!idea) return
    try { await navigator.clipboard.writeText(idea) } catch { /* ignore */ }
    void navigate({ to: '/app/chat' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6" /> Chance
        </h1>
        <p className="text-sm text-muted-foreground">Not sure what to do? Click and let chance decide.</p>
      </div>

      <Card className="flex min-h-48 flex-col items-center justify-center gap-4 p-6 text-center">
        {idea ? (
          <p className="text-lg font-medium">{idea}</p>
        ) : (
          <p className="text-muted-foreground">Press the button for a random idea.</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={roll} size="lg">
            {idea ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {idea ? 'Roll again' : 'Surprise me'}
          </Button>
          {idea && (
            <Button variant="outline" size="lg" onClick={() => void tryIt()} title="Copies the idea and opens Chats">
              <MessageSquare className="mr-2 h-4 w-4" /> Try it in chat
            </Button>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Your own ideas</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addIdea() }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an idea to the pool…"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={!draft.trim()}>Add</Button>
        </form>
        {custom.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom ideas yet. They get mixed into the rolls.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {custom.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted">
                <span>{c}</span>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => removeIdea(i)} aria-label="Remove">×</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
