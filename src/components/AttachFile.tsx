import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip } from 'lucide-react'
import { AgentPulse } from '@/components/agent-pulse'
import { stageFile, StageError, type StagedFile } from '@/lib/stage-file'

/**
 * Put a file into the archive that is going into the network.
 *
 * Uploading and sending are separate on purpose. Placing bytes in the archive
 * is instant; pushing that archive through the two input neurons costs one
 * settle of the mesh per BIT. Keeping them apart lets several things -- a
 * recording, a file, the message itself -- be gathered and then zipped and
 * sent together, once, instead of each starting its own long run.
 */

export type { StagedFile }

export function AttachFile({
  onStaged,
  disabled,
  folder = 'prompt/',
}: {
  onStaged: (file: StagedFile) => void
  disabled?: boolean
  folder?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stage = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(true)
      try {
        onStaged(await stageFile(file, file.name, folder))
      } catch (err) {
        setError(err instanceof StageError ? err.message : 'Could not attach the file.')
      } finally {
        setBusy(false)
        // Cleared so the same file can be picked again -- without this,
        // choosing it twice fires no change event and looks broken.
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [folder, onStaged],
  )

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
          if (file) void stage(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label={busy ? 'Attaching the file' : 'Attach a file'}
        title="Attach a file — it goes into the network as a file, zipped with everything else"
        className="gap-2 active:scale-95 transition-all duration-150"
      >
        {busy ? <AgentPulse size={16} label="Attaching the file" /> : <Paperclip size={16} />}
      </Button>

      <span role="status" aria-live="polite" className="sr-only">
        {busy ? 'Attaching the file' : error || ''}
      </span>

      {error && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
