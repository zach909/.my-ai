import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Pencil, X, Check } from 'lucide-react'

/**
 * The pen underneath an assistant reply: rewrite what it said.
 *
 * A correction is the most valuable signal this system gets, and there was
 * no way to give it -- the chat could COPY a wrong answer but not fix one, so
 * it stayed wrong in the transcript, in long-term memory, and in whatever the
 * next turn was grounded on. Saving here replaces the wrong answer in memory
 * (not beside it -- see NeuroclawSystem.recordCorrection), records it as a
 * reasoning mistake with the fix as the prevention, and feeds the correction
 * back through the Zip Loop, because editing a reply IS saying something.
 *
 * The transcript updates the moment Save is pressed, before the network
 * request resolves -- what you typed is not held hostage by whether the fetch
 * succeeds, and a failed filing is reported without undoing the edit onscreen.
 */
export function EditMessage({
  content,
  prompt,
  onSaved,
}: {
  content: string
  /** The user turn that produced this reply, for the mistake record. */
  prompt: string
  onSaved: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [error, setError] = useState<string | null>(null)

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-9 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 active:scale-95 text-muted-foreground hover:text-foreground hover:bg-muted"
        onClick={() => {
          setDraft(content)
          setError(null)
          setEditing(true)
        }}
        aria-label="Edit what the AI said"
        title="Edit what the AI said"
      >
        <Pencil size={14} />
      </Button>
    )
  }

  const save = async () => {
    const next = draft.trim()
    if (!next || next === content) {
      setEditing(false)
      return
    }
    // Applied to the transcript first: the user's own correction must not
    // depend on the network to take effect.
    onSaved(next)
    setEditing(false)
    try {
      const res = await fetch('/api/chat/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: content, corrected: next, prompt }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'Saved here, but the correction was not filed.')
      }
    } catch {
      setError('Saved here, but could not reach the server to file the correction.')
    }
  }

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save()
          }
        }}
        rows={Math.min(10, Math.max(3, draft.split('\n').length))}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Edit the assistant's reply"
      />
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" className="gap-1.5 active:scale-95" onClick={() => void save()}>
          <Check size={13} />
          Save
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 active:scale-95" onClick={() => setEditing(false)}>
          <X size={13} />
          Cancel
        </Button>
        <span className="self-center text-[11px] text-muted-foreground">⌘/Ctrl+Enter to save, Esc to cancel</span>
      </div>
    </div>
  )
}
