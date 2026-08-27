import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip } from 'lucide-react'
import { AgentPulse } from '@/components/agent-pulse'

/**
 * Put a file into the neural network.
 *
 * Not "attach a file to a message". The archive that goes through the two
 * input neurons carries bytes as well as text, so a file goes in AS a file --
 * a recording stays a recording, an image stays an image. Describing it in
 * words first would throw away everything about it except the description.
 *
 * Two steps, deliberately: the bytes are placed in the archive (POST
 * /api/zip-loop/file), and only then sent through the doorway (POST
 * /api/zip-loop/run). Placing is cheap; sending costs one settle of the mesh
 * per BIT, so a file of any size is slow by construction and the caller is
 * told what it will cost before it starts.
 */

/** Generous for a recording or a document, bounded so a mis-click cannot try to send a disc image. */
const MAX_BYTES = 25 * 1024 * 1024

export interface FileToNetworkResult {
  path: string
  bytes: number
  /** What the network produced, as far as it could be read. */
  reason?: string
  complete?: boolean
  ticks?: number
}

export function FileToNetwork({
  disabled,
  folder = 'input/',
  onSent,
}: {
  disabled?: boolean
  /** Where in the archive the file lands. */
  folder?: string
  onSent?: (result: FileToNetworkResult) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<'idle' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const send = useCallback(
    async (file: File) => {
      setError(null)
      setNote(null)
      if (file.size === 0) {
        setError('That file is empty — there is nothing to send in.')
        return
      }
      if (file.size > MAX_BYTES) {
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The doorway takes up to 25MB in one go.`)
        return
      }

      setState('sending')
      try {
        // Step 1: the bytes, as bytes. The body IS the file.
        const placed = await fetch(
          `/api/zip-loop/file?path=${encodeURIComponent(`${folder}${file.name}`)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          },
        )
        const placedBody = await placed.json().catch(() => ({}))
        if (!placed.ok) {
          setError(placedBody?.error || `Could not place the file (${placed.status})`)
          return
        }

        // Step 2: through the two input neurons, one bit at a time.
        const ran = await fetch('/api/zip-loop/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binary: placedBody.binary, maxTicks: 512 }),
        })
        const ranBody = await ran.json().catch(() => ({}))
        if (!ran.ok) {
          setError(ranBody?.error || `The file went in but the run failed (${ran.status})`)
          return
        }

        // Said plainly. "Ceiling" means the run was cut off rather than
        // finished, and calling that a success would be a lie the next person
        // has to discover for themselves.
        setNote(
          ranBody.complete
            ? `${file.name} went in (${placedBody.bytes} bytes) and the network finished on its own.`
            : `${file.name} went in (${placedBody.bytes} bytes). The network hit the tick ceiling rather than stopping itself — it has not been trained to say when it is done.`,
        )
        onSent?.({
          path: placedBody.path,
          bytes: placedBody.bytes,
          reason: ranBody.reason,
          complete: ranBody.complete,
          ticks: ranBody.ticks,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach the local network.')
      } finally {
        setState('idle')
        // Cleared so the same file can be picked again -- without this, choosing
        // the same file twice fires no change event and looks broken.
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [folder, onSent],
  )

  const busy = state === 'sending'

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void send(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label={busy ? 'Sending the file into the network' : 'Send a file into the network'}
        title="Send a file straight into the neural network, as a file"
        className="gap-2 active:scale-95 transition-all duration-150"
      >
        {busy ? <AgentPulse size={16} label="Sending the file into the network" /> : <Paperclip size={16} />}
      </Button>

      <span role="status" aria-live="polite" className="sr-only">
        {busy ? 'Sending the file into the network' : note || error || ''}
      </span>

      {note && !error && (
        <p className="basis-full text-xs text-muted-foreground">{note}</p>
      )}
      {error && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
