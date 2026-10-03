/**
 * The Memory tab's "About you" and "Goals" sections: type something and the
 * agent writes it down, kept across restarts in ~/.neuroclaw/profile.json and
 * pinned into long-term memory so it's recalled when answering. See
 * models && skills/core/user-profile-store.ts and /api/profile.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Check, Goal, Trash2, Users } from '@/components/icons'
import { cn } from '@/lib/utils'

interface Entry {
  id: string
  text: string
  createdAt: number
  done?: boolean
}

type List = 'about' | 'goals'

export function ProfileLists({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<Record<List, Entry[]>>({ about: [], goals: [] })
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setData({ about: body.about ?? [], goals: body.goals ?? [] })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { void load() }, [])

  const call = async (url: string, method: string, body?: unknown) => {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
      onChange?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section
        title="About you"
        icon={<Users className="h-4 w-4" />}
        hint="Tell it anything about yourself — your name, what you do, what you like. It writes it down and remembers."
        placeholder="e.g. I'm a student and I like building games"
        entries={data.about}
        onAdd={(text) => call('/api/profile/about', 'POST', { text })}
        onRemove={(id) => call(`/api/profile/about/${id}`, 'DELETE')}
      />
      <Section
        title="Goals"
        icon={<Goal className="h-4 w-4" />}
        hint="What do you want it to do for you? Its goals come from you. Check one off when it's done."
        placeholder="e.g. Help me learn to code every day"
        entries={data.goals}
        goals
        onAdd={(text) => call('/api/profile/goals', 'POST', { text })}
        onRemove={(id) => call(`/api/profile/goals/${id}`, 'DELETE')}
        onToggle={(e) => call(`/api/profile/goals/${e.id}`, 'PATCH', { done: !e.done })}
      />
      {error && <p className="text-sm text-destructive md:col-span-2">Couldn't update: {error}</p>}
    </div>
  )
}

function Section(props: {
  title: string
  icon: React.ReactNode
  hint: string
  placeholder: string
  entries: Entry[]
  goals?: boolean
  onAdd: (text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onToggle?: (e: Entry) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    setSaving(true)
    await props.onAdd(text)
    setDraft('')
    setSaving(false)
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-medium">{props.icon} {props.title}</h2>
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={props.placeholder} />
        <Button type="submit" disabled={!draft.trim() || saving}>{saving ? 'Saving…' : 'Remember'}</Button>
      </form>
      {props.entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="space-y-1">
          {props.entries.map((e) => (
            <li key={e.id} className="group flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              {props.goals && (
                <button
                  type="button"
                  onClick={() => void props.onToggle?.(e)}
                  aria-label={e.done ? 'Mark not done' : 'Mark done'}
                  className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    e.done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground')}
                >
                  {e.done && <Check className="h-3 w-3" />}
                </button>
              )}
              <span className={cn('flex-1 break-words', e.done && 'text-muted-foreground line-through')}>{e.text}</span>
              <button
                type="button"
                onClick={() => void props.onRemove(e.id)}
                aria-label="Forget"
                className="text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
