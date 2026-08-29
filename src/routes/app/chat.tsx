/**
 * AI Chat — conversation with agent-generated follow-up prompt suggestions.
 *
 * After every assistant reply, the agent proposes a handful of prompts the
 * user might want to send next (based on the domain of the exchange, e.g.
 * coding vs. planning vs. analysis). Clicking a suggestion sends it
 * immediately. There is no manual "save prompt" step — the suggestions are
 * generated fresh by the bot on each turn.
 *
 * Persists to disk by default (models && skills/core/chat-history-store.ts,
 * via /api/chat-history/*) so a new conversation can be matched against past
 * ones and offered as a continuation. Incognito mode opts a session out of
 * that entirely — no save/search calls are made, so nothing about an
 * incognito conversation is ever written anywhere.
 */

import { createFileRoute } from '@tanstack/react-router'
import { fetchWithTimeout, startPolling } from '@/lib/poll'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Send, Sparkles, EyeOff, History, Loader2, Copy, Check, Plus } from 'lucide-react'
import { AgentPulse } from '@/components/agent-pulse'
import { toast } from 'sonner'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { AttachFile } from '@/components/AttachFile'
import { stageFile, StageError, generatedName, type StagedFile } from '@/lib/stage-file'
import { usePageVisible } from '@/hooks/usePageVisible'

export const Route = createFileRoute('/app/chat')({
  head: () => ({
    meta: [
      { title: 'AI Chat · Corona' },
      { name: 'description', content: 'Chat with the AI assistant and follow agent-suggested prompts.' },
    ],
  }),
  component: ChatPage,
})

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  suggestions?: string[]
}

interface ChatMatch {
  threadId: string
  title: string
  score: number
  snippet: string
  updatedAt: number
}

const INITIAL_SUGGESTIONS = [
  'Help me break down a complex problem',
  'Create a detailed plan with milestones',
  'Help me write and test code for this',
  'What are potential risks or edge cases?',
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 active:scale-95 text-muted-foreground hover:text-foreground hover:bg-muted"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy assistant message'}
      title={copied ? 'Copied' : 'Copy assistant message'}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </Button>
  )
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init_0',
      role: 'assistant',
      content:
        "Hello! I'm your AI assistant. Ask me anything, and I can help with analysis, coding, planning, or creative work. What would you like to work on today?",
      timestamp: Date.now(),
      suggestions: INITIAL_SUGGESTIONS,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [incognito, setIncognito] = useState(false)
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  // Set once, the first time a would-be-new conversation matches an earlier
  // one; cleared as soon as the user picks continue-there or start-new.
  const [pendingMatch, setPendingMatch] = useState<{ match: ChatMatch; text: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Section 4.1: the continuous output loop (interface/runner.ts) runs for
  // the whole life of the backend process, independent of any single
  // request/response -- it never actually stops. Polling its real state
  // here is what makes that observable at all: previously nothing anywhere
  // in the app ever called GET /api/continuous/status (the endpoint itself
  // didn't exist), so the loop ran invisibly and every chat turn looked
  // exactly like a normal one-shot request/response with no sign the
  // system was still doing anything once a reply arrived.
  const [continuousStatus, setContinuousStatus] = useState<{
    running: boolean
    tickCount: number
    pendingInputCount: number
    contextItemsHeld?: { input: number; output: number }
  } | null>(null)

  // Gated on visibility: this is a purely informational status readout, and a
  // request every three seconds forever while the window is minimised costs
  // the processor, the battery and the network for something nobody can see.
  // It polls immediately on becoming visible again, so the display is current
  // the moment it matters rather than up to three seconds stale.
  const pageVisible = usePageVisible()
  useEffect(() => {
    if (!pageVisible) return
    let cancelled = false
    const poll = async () => {
      try {
        // Timed, and self-scheduling rather than on an interval: this is the
        // endpoint most likely to stall (it reports on work in progress), and
        // an untimed poll of it on a fixed interval is exactly what can eat
        // the browser's per-host connection budget and freeze the chat itself.
        const res = await fetchWithTimeout('/api/continuous/status', {}, 2500)
        if (res.ok && !cancelled) setContinuousStatus(await res.json())
      } catch {
        // Backend unreachable this tick -- leave the last known status up
        // rather than flashing an error for a purely informational poll.
      }
    }
    const handle = startPolling(poll, 3000)
    return () => {
      cancelled = true
      handle.stop()
    }
  }, [pageVisible])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Arriving from the Chat History page (?thread=<id>) hydrates that thread
  // immediately instead of starting a fresh conversation.
  useEffect(() => {
    const threadParam = new URLSearchParams(window.location.search).get('thread')
    if (threadParam) {
      continueThread({ threadId: threadParam, title: '', score: 1, snippet: '', updatedAt: Date.now() })
    }
  }, [])

  // Keyboard shortcut (Alt+I) to toggle Incognito mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'i') {
        const activeTag = document.activeElement?.tagName
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
          return
        }
        e.preventDefault()
        setIncognito((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Re-focus the input element once loading finishes
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus()
    }
  }, [loading])

  const callBotAPI = async (
    userMessage: string
  ): Promise<{ message: string; suggestions: string[] }> => {
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to get response')
      }
      const data = await response.json()
      return {
        message: data.message,
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      }
    } catch (error) {
      console.error('Bot API error:', error)
      return {
        message: 'I encountered an error processing your message. Please try again.',
        suggestions: [],
      }
    }
  }

  const saveToHistory = async (role: 'user' | 'assistant', content: string, id: string | undefined): Promise<string | undefined> => {
    if (incognito) return id
    try {
      const res = await fetch('/api/chat-history/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: id, source: 'chat', role, content }),
      })
      if (!res.ok) return id
      const data = await res.json()
      return data.threadId ?? id
    } catch {
      return id
    }
  }

  /** Continue an earlier matched thread: hydrate its messages and adopt its id. */
  const continueThread = async (match: ChatMatch) => {
    setPendingMatch(null)
    try {
      const res = await fetch(`/api/chat-history/threads/${encodeURIComponent(match.threadId)}`)
      if (res.ok) {
        const data = await res.json()
        const hydrated: Message[] = (data.thread?.messages ?? []).map(
          (m: { role: 'user' | 'assistant'; content: string; timestamp: number }, i: number) => ({
            id: `restored_${i}`,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })
        )
        if (hydrated.length > 0) setMessages(hydrated)
        setThreadId(match.threadId)
      }
    } catch {
      // Match couldn't be loaded -- fall through and just keep the current thread.
    }
  }

  const handleNewChat = () => {
    setMessages([
      {
        id: `init_${Date.now()}`,
        role: 'assistant',
        content:
          "Hello! I'm your AI assistant. Ask me anything, and I can help with analysis, coding, planning, or creative work. What would you like to work on today?",
        timestamp: Date.now(),
        suggestions: INITIAL_SUGGESTIONS,
      },
    ])
    setThreadId(undefined)
    setPendingMatch(null)
    setInput('')
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    toast.success('Started a new chat session')
    inputRef.current?.focus()
  }

  /**
   * What was typed while it was still working.
   *
   * The input used to be disabled during a reply, which meant a thought you
   * had mid-answer was one you had to hold until it finished. Now it is
   * always typeable -- but a second request must not go out on top of the
   * first, or two answers race and land in whichever order the network
   * decides. So the REPLY queues, in the order it was typed, and goes as soon
   * as the current one is done.
   *
   * The text itself does not wait. It goes straight onto the running loop's
   * zip input the moment it is typed, so the network is already working with
   * it while it finishes what it was saying. Waiting for a turn is about not
   * racing two answers; it was never a reason to keep what you said from the
   * thing that is thinking.
   *
   * The ref is what the send loop reads (a plain function closing over state
   * would see whatever was true when it started); the state is what the
   * screen shows.
   */
  const queuedRef = useRef<string[]>([])
  const [queued, setQueued] = useState<string[]>([])

  const enqueue = useCallback((text: string) => {
    queuedRef.current = [...queuedRef.current, text]
    setQueued(queuedRef.current)
    // Into the zip input now, not when its turn comes. Deliberately not
    // awaited and deliberately swallowing its own failure: this is an extra
    // path into the network, and the message is still going to be sent
    // properly when the current reply finishes. A failure here must not
    // become an error in the transcript for a message that has not been
    // sent yet.
    void fetch('/api/continuous/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker: 'user' }),
    }).catch(() => {})
  }, [])

  const takeNext = useCallback((): string | undefined => {
    const [next, ...rest] = queuedRef.current
    queuedRef.current = rest
    setQueued(rest)
    return next
  }, [])

  const sendMessage = async (messageText: string) => {
    const userMsg: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const savedId = await saveToHistory('user', messageText, threadId)
      if (savedId !== threadId) setThreadId(savedId)

      // Everything staged goes in with this message, zipped together into one
      // archive rather than one run each.
      if (staged.length > 0) {
        const attached = staged
        setStaged([])
        const outcome = await sendArchive(messageText, attached)
        setMessages((prev) => [
          ...prev,
          { id: `msg_${Date.now()}_archive`, role: 'assistant', content: outcome, timestamp: Date.now() },
        ])
      }

      const response = await callBotAPI(messageText)
      const agentMsg: Message = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
        suggestions: response.suggestions,
      }
      setMessages((prev) => [...prev, agentMsg])
      await saveToHistory('assistant', response.message, savedId)
    } catch (err) {
      // Said in the transcript rather than thrown into the console. A reply
      // that failed while three more were queued behind it used to escape as
      // an unhandled rejection: nothing on screen changed, and the only clue
      // was in devtools.
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_error`,
          role: 'assistant',
          content: `That did not get through: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setLoading(false)
      // Whatever was typed while this one was running goes now, in the order
      // it was typed.
      const next = takeNext()
      if (next !== undefined) void sendMessage(next)
    }
  }

  /**
   * Files waiting to go in with the next message: recordings, uploads,
   * anything. They are already uploaded -- what is still to happen is the
   * zipping and the run, which is the expensive half and only worth doing
   * once for everything together.
   */
  const [staged, setStaged] = useState<StagedFile[]>([])

  const [pasteError, setPasteError] = useState<string | null>(null)

  /**
   * Anything pasted goes in as a file.
   *
   * An image off the clipboard is already a file and always was one -- it just
   * had nowhere to go before. Pasted TEXT becomes a file too, which is the
   * part worth being deliberate about: a pasted log, document or block of code
   * is a thing in its own right, and flattening it into the middle of a
   * sentence loses where it started and where it ended.
   *
   * Nothing is lost if that was not what you wanted: what was pasted appears
   * in the tray below with an x, so it can be dropped and typed instead.
   */
  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLInputElement>) => {
      const clipboard = event.clipboardData
      if (!clipboard) return

      const files = Array.from(clipboard.files)
      const text = clipboard.getData('text/plain')
      if (files.length === 0 && !text.trim()) return

      // Taken over entirely: half-pasting -- a file staged AND the text landing
      // in the box -- would be the worst of both.
      event.preventDefault()
      setPasteError(null)

      try {
        for (const file of files) {
          const staged = await stageFile(file, file.name || generatedName('pasted', 'bin'))
          setStaged((prev) => [...prev, staged])
        }
        if (files.length === 0 && text) {
          const blob = new Blob([text], { type: 'text/plain' })
          const staged = await stageFile(blob, generatedName('pasted', 'txt'))
          setStaged((prev) => [...prev, staged])
        }
      } catch (err) {
        setPasteError(err instanceof StageError ? err.message : 'Could not attach what was pasted.')
      }
    },
    [],
  )

  const addStaged = useCallback((file: StagedFile) => {
    setStaged((prev) => [...prev.filter((f) => f.path !== file.path), file])
  }, [])

  /**
   * Zip the message together with everything staged and send it through the
   * two input neurons.
   *
   * Reported honestly: "ceiling" means the run was cut off at its tick budget
   * rather than the network deciding it was done, and one settle per BIT means
   * even a small file is thousands of ticks. Saying "sent" for a run that was
   * cut off would be a lie the next person has to discover themselves.
   */
  const sendArchive = async (messageText: string, files: StagedFile[]): Promise<string> => {
    const binary: Record<string, string> = {}
    for (const file of files) Object.assign(binary, file.binary)
    const names = files.map((f) => f.path).join(', ')
    try {
      const res = await fetch('/api/zip-loop/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: messageText, binary, maxTicks: 512 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return `Could not send ${names} into the network: ${data?.error ?? res.status}`
      return data.complete
        ? `Sent ${names} into the network (${data.bytesIn} bytes zipped, ${data.sendTicks} ticks in). It stopped itself.`
        : `Sent ${names} into the network (${data.bytesIn} bytes zipped, ${data.sendTicks} ticks in). It hit the tick ceiling rather than stopping itself — it has not been trained to say when it is done.`
    } catch (err) {
      return `Could not reach the network: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const handleSendMessage = async (text?: string) => {
    const messageText = (text ?? input).trim()
    if (!messageText) return

    // Still working: take it now, send it next. Typing is never blocked, and
    // two requests never go out at once.
    if (loading) {
      enqueue(messageText)
      setInput('')
      return
    }

    // Only check for a match at the start of a genuinely new conversation
    // (no thread adopted yet, nothing sent this session) -- once a thread is
    // underway there's nothing to "continue" into instead.
    if (!incognito && !threadId && messages.length === 1) {
      try {
        const res = await fetch(`/api/chat-history/search?q=${encodeURIComponent(messageText)}&source=chat`)
        if (res.ok) {
          const data = await res.json()
          const best: ChatMatch | undefined = data.matches?.[0]
          if (best && best.score > 0.3) {
            setInput('')
            setPendingMatch({ match: best, text: messageText })
            return
          }
        }
      } catch {
        // Search unavailable -- fall through and just send normally.
      }
    }

    await sendMessage(messageText)
  }

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col">
      <div className="flex items-center justify-end gap-2 px-4 pt-2">
        {(messages.length > 1 || threadId !== undefined) && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewChat}
            disabled={loading}
            className="gap-1.5 text-xs active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            title="Start a new chat session"
            aria-label="Start a new chat session"
          >
            <Plus size={12} />
            New Chat
          </Button>
        )}
        <Button
          variant={incognito ? 'default' : 'outline'}
          size="sm"
          onClick={() => setIncognito((v) => !v)}
          className="gap-1.5 text-xs active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          title={incognito ? 'Incognito: this conversation is not saved (Alt+I)' : 'Turn on incognito mode (nothing gets saved) (Alt+I)'}
          aria-pressed={incognito}
          aria-label={incognito ? 'Disable incognito mode (Alt+I)' : 'Enable incognito mode (Alt+I)'}
        >
          <EyeOff size={12} />
          {incognito ? 'Incognito on' : 'Incognito'}
        </Button>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-atomic="false"
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {pendingMatch && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
            <History size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="flex-1 space-y-2">
              <p>
                This looks like your earlier chat <span className="font-medium">&ldquo;{pendingMatch.match.title}&rdquo;</span> — continue there instead?
              </p>
              <p className="text-xs text-muted-foreground">{pendingMatch.match.snippet}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="active:scale-95 transition-all duration-150"
                  onClick={() => continueThread(pendingMatch.match).then(() => sendMessage(pendingMatch.text))}
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
                    sendMessage(text)
                  }}
                >
                  Start new
                </Button>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`group relative max-w-xl rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground pr-10'
              }`}
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
              {msg.role === 'assistant' && <CopyButton text={msg.content} />}
            </div>

            {/* Agent-suggested follow-up prompts */}
            {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
              <div className="flex max-w-xl flex-wrap gap-2">
                {msg.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSendMessage(suggestion)}
                    disabled={loading}
                    aria-label={`Ask: "${suggestion}"`}
                    title={`Ask: "${suggestion}"`}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-all duration-150 hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    <Sparkles size={11} className="shrink-0 text-primary" />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <AgentPulse size={18} className="text-primary" label="The agent is working" />
                Thinking…
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <Card className="border-t border-x-0 border-b-0 rounded-none mx-0 p-4 space-y-2">
        {/* What is waiting to go in with the next message. Shown because
            attaching and sending are separate steps here, and something
            staged but invisible would be a surprise either way -- forgotten,
            or sent when it was not meant to be. */}
        {queued.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Waiting to send">
            {queued.map((text, index) => (
              <li key={`${index}-${text}`} className="flex items-center gap-1.5">
                {/* "in" rather than "next": it is already in the network's
                    input. What is waiting is its reply, not the message. */}
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5"
                  title="Already added to what the network is working on; its reply comes when the current one finishes"
                >
                  in
                </span>
                <span className="truncate">{text}</span>
              </li>
            ))}
          </ul>
        )}
        {pasteError && (
          <p className="text-xs text-destructive" role="alert">{pasteError}</p>
        )}
        {staged.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Files going in with this message">
            {staged.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1"
              >
                <span className="font-mono">{file.path}</span>
                <span className="text-muted-foreground">{(file.bytes / 1024).toFixed(1)}KB</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${file.path}`}
                  onClick={() => setStaged((prev) => prev.filter((f) => f.path !== file.path))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Label htmlFor="chat-message-input" className="sr-only">Chat message input</Label>
          <Input
            id="chat-message-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            onPaste={handlePaste}
            placeholder={loading ? 'Type while it is working…' : 'Ask anything… (Shift+Enter for new line)'}
            autoFocus
            className="flex-1"
          />
          {/* A file goes in as a file, and a recording goes in as a recording.
              The doorway takes bytes, so neither has to become words first --
              a transcript would arrive with everything about the audio except
              the words already thrown away. */}
          <AttachFile onStaged={addStaged} />
          <VoiceRecorder onRecorded={addStaged} />
          <Button
            onClick={() => handleSendMessage()}
            disabled={!input.trim()}
            size="sm"
            className="gap-2 active:scale-95 transition-all duration-150"
            aria-label={loading ? 'Queue message' : 'Send message'}
            title={loading ? 'It is still working — this goes next' : 'Send message (or press Enter)'}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            <span className="hidden sm:inline">
              {loading ? "Sending..." : "Send"}
            </span>
          </Button>
        </div>
        <p className="text-muted-foreground py-1 text-[11px]">
          {messages.length} message{messages.length !== 1 ? 's' : ''} in chat
          {incognito && ' · incognito, nothing is saved'}
        </p>
        {continuousStatus?.running && (
          <p className="text-muted-foreground/70 py-0.5 text-[11px]" title="Section 4.1's continuous output loop — real state, polled from the running backend, not simulated">
            🔄 Zipping — tick #{continuousStatus.tickCount}
            {continuousStatus.pendingInputCount > 0 && ` · ${continuousStatus.pendingInputCount} more queued, not yet processed`}
            {continuousStatus.contextItemsHeld && (
              ` · ${continuousStatus.contextItemsHeld.input + continuousStatus.contextItemsHeld.output} item(s) held in the zip loop, not shown above`
            )}
          </p>
        )}
      </Card>
    </div>
  )
}
