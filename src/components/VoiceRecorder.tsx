import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square } from 'lucide-react'
import { AgentPulse } from '@/components/agent-pulse'

/**
 * A recorder. Not a transcriber.
 *
 * This used to record audio, post it to a local Whisper/Vosk install, and hand
 * back whatever words came out -- so a recording could only ever reach the
 * agent as a transcript, with everything else about it thrown away before
 * anything saw it. And when no recogniser was installed, which is most
 * machines, it reached the agent as nothing at all.
 *
 * Now the recording becomes a file, the file is uploaded into the archive, and
 * it is zipped with everything else going in. The doorway into the mesh takes
 * bits; audio is already bits. Nothing has to be turned into words first.
 */

/** Stop a runaway recording rather than filling memory if someone walks away. */
const MAX_RECORDING_MS = 60_000

/** Below this it is a mis-click, not a recording. */
const MIN_BYTES = 1024

export interface RecordedFile {
  path: string
  bytes: number
  /** Ready to send: { "input/recording-....webm": "<base64>" } */
  binary: Record<string, string>
}

export function VoiceRecorder({
  onRecorded,
  disabled,
  folder = 'input/',
}: {
  /** The recording, uploaded and placed in the archive, ready to zip with the rest. */
  onRecorded: (file: RecordedFile) => void
  disabled?: boolean
  folder?: string
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Release the mic. Leaving tracks live keeps the OS recording indicator on. */
  const releaseStream = useCallback(() => {
    const rec = recorderRef.current
    rec?.stream?.getTracks().forEach(t => t.stop())
    recorderRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => releaseStream, [releaseStream])

  /**
   * Upload the clip as a file. The body IS the recording -- no form encoding,
   * no transcript, no describing it in words on the way in.
   */
  const upload = useCallback(
    async (blob: Blob) => {
      setState('uploading')
      try {
        const extension = (blob.type.split('/')[1] || 'webm').split(';')[0]
        const name = `recording-${Date.now()}.${extension}`
        const res = await fetch(`/api/zip-loop/file?path=${encodeURIComponent(`${folder}${name}`)}`, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || `Could not upload the recording (${res.status})`)
          return
        }
        onRecorded({ path: data.path, bytes: data.bytes, binary: data.binary })
      } catch {
        setError('Could not reach the local network.')
      } finally {
        setState('idle')
      }
    },
    [folder, onRecorded],
  )

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        releaseStream()
        if (blob.size < MIN_BYTES) {
          setState('idle')
          setError('That recording was too short to contain anything.')
          return
        }
        void upload(blob)
      }

      rec.start()
      setState('recording')
      timerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      }, MAX_RECORDING_MS)
    } catch (e) {
      const name = (e as { name?: string })?.name
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was refused.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : 'Could not start recording.',
      )
      setState('idle')
    }
  }, [releaseStream, upload])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const busy = state === 'uploading'

  return (
    <>
      <Button
        type="button"
        variant={state === 'recording' ? 'destructive' : 'outline'}
        size="sm"
        onClick={state === 'recording' ? stop : start}
        disabled={disabled || busy}
        aria-label={
          state === 'recording' ? 'Stop recording' : busy ? 'Uploading the recording' : 'Record'
        }
        title={state === 'recording' ? 'Stop recording' : 'Record — the clip goes in as a file'}
        className="gap-2 active:scale-95 transition-all duration-150"
      >
        {busy ? (
          <AgentPulse size={16} label="Uploading the recording" />
        ) : state === 'recording' ? (
          <Square size={16} />
        ) : (
          <Mic size={16} />
        )}
      </Button>

      {/* Announced politely so a screen reader hears the outcome without the
          message stealing focus from the chat box. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'recording' ? 'Recording' : busy ? 'Uploading the recording' : error || ''}
      </span>

      {error && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
