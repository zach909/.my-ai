/**
 * Prompt Clips Panel — sidebar for managing and accessing saved prompt clips.
 *
 * Shows recently used prompts, allows selection to send as input, and deletion.
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { PromptClips, type PromptClip } from '@/lib/prompt-clips'
import { Trash2, Copy, ChevronDown } from 'lucide-react'

interface PromptClipsPanelProps {
  /** Callback when user selects a clip to use as prompt */
  onSelectClip: (text: string, clipId: string) => void
}

export function PromptClipsPanel({ onSelectClip }: PromptClipsPanelProps) {
  const [clips, setClips] = useState<PromptClip[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // Load frequent clips on mount
    setClips(PromptClips.frequent(8))
  }, [])

  const handleSelectClip = (clip: PromptClip) => {
    PromptClips.use(clip.id)
    onSelectClip(clip.text, clip.id)
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirm('Delete this prompt clip?')) {
      PromptClips.delete(id)
      setClips((prev) => prev.filter((c) => c.id !== id))
    }
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
        <p>No saved prompt clips yet.</p>
        <p className="mt-1 text-[11px]">Use the "Save clip" button on responses to build your library.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-muted"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          💾 Quick prompts ({clips.length})
        </span>
        <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-1 border-t border-border p-2">
          {clips.map((clip) => (
            <button
              key={clip.id}
              onClick={() => handleSelectClip(clip)}
              className="group relative w-full text-left transition-colors hover:bg-muted/80"
            >
              <div className="flex items-start gap-2 rounded px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground group-hover:text-primary">
                    {clip.text.substring(0, 60)}
                    {clip.text.length > 60 ? '…' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Used {clip.usageCount}x • {new Date(clip.created).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(clip.text)
                    }}
                    title="Copy to clipboard"
                    className="rounded p-0.5 hover:bg-muted"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, clip.id)}
                    title="Delete clip"
                    className="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
