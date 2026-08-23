/**
 * Microphone capture for the chat box.
 *
 * Records real audio from the user's microphone and posts it to the local
 * backend for transcription. Nothing leaves the machine: the recording goes to
 * this app's own server on loopback and no further.
 *
 * On transcription specifically — the browser's built-in SpeechRecognition API
 * is deliberately NOT used. In Chromium (and therefore Electron) it streams the
 * captured audio to Google's servers, which would quietly turn a local-first
 * agent into one that ships your voice off the machine. The backend instead
 * uses a local recogniser, and when none is installed it says so plainly rather
 * than inventing a transcript.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square, Loader2 } from 'lucide-react'

type State = 'idle' | 'recording' | 'transcribing'

/** Stop a runaway recording rather than filling memory if the user walks away. */
const MAX_RECORDING_MS = 60_000

export function VoiceInput({
  onTranscript,
  disabled,
}: {
  /** Called with recognised text, to be placed in the chat box. */
  onTranscript: (text: string) => void
  disabled?: boolean
}) {
  const [state, setState] = useState<State>('idle')
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

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState('transcribing')
      try {
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || `Transcription failed (${res.status})`)
          return
        }
        if (data.text) onTranscript(String(data.text))
        else setError(data?.error || 'No speech was recognised in that recording.')
      } catch {
        setError('Could not reach the local transcription service.')
      } finally {
        setState('idle')
      }
    },
    [onTranscript]
  )

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        releaseStream()
        // A blob this small is a mis-click, not speech.
        if (blob.size < 1024) {
          setState('idle')
          setError('That recording was too short to contain speech.')
          return
        }
        void transcribe(blob)
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
          ? 'Microphone access was denied.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : 'Could not start recording.'
      )
      setState('idle')
    }
  }, [releaseStream, transcribe])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const busy = state === 'transcribing'

  return (
    <>
      <Button
        type="button"
        variant={state === 'recording' ? 'destructive' : 'outline'}
        size="sm"
        onClick={state === 'recording' ? stop : start}
        disabled={disabled || busy}
        aria-label={
          state === 'recording' ? 'Stop recording' : busy ? 'Transcribing' : 'Record a voice message'
        }
        title={state === 'recording' ? 'Stop recording' : 'Record a voice message'}
        className="gap-2 active:scale-95 transition-all duration-150"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : state === 'recording' ? (
          <Square size={16} />
        ) : (
          <Mic size={16} />
        )}
      </Button>

      {/* Announced politely so a screen reader hears the outcome without the
          message stealing focus from the chat box. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'recording' ? 'Recording' : busy ? 'Transcribing' : error || ''}
      </span>

      {error && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
