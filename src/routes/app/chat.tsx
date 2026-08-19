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
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Send, Zap, Sparkles, EyeOff, History, Loader2, Copy, Check, Plus } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/app/chat')({
  head: () => ({
    meta: [
      { title: 'AI Chat · ASI Architect' },
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

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/continuous/status')
        if (res.ok && !cancelled) setContinuousStatus(await res.json())
      } catch {
        // Backend unreachable this tick -- leave the last known status up
        // rather than flashing an error for a purely informational poll.
      }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

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

  // Arriving from the Wiki page's "Chat" button (?page=<name>) fetches that
  // page's real, current content (not whatever the wiki tab last had
  // loaded -- this is a fresh navigation) and opens the conversation with
  // it already in context, so the first message doesn't have to be "here's
  // a page, let me paste it in" -- the AI can discuss it or (for a
  // bot-published page) actually go fix it via WikiPlugin.edit() right
  // there in the same conversation.
  useEffect(() => {
    const pageParam = new URLSearchParams(window.location.search).get('page')
    if (!pageParam) return
    window.history.replaceState({}, '', window.location.pathname)
    ;(async () => {
      try {
        const res = await fetch(`/api/wiki/${encodeURIComponent(pageParam)}`)
        if (!res.ok) throw new Error(`Page "${pageParam}" not found`)
        const page: { name: string; title: string; source: 'human' | 'bot'; content: string } = await res.json()
        const editableNote =
          page.source === 'bot'
            ? `It's a bot-published page (wiki/bot/${page.name}.md) -- if we land on a fix, I can go make it on the Wiki page's own Edit form.`
            : `It's a curated page (wiki/${page.name}.md), so any fix needs a real commit rather than an in-app edit.`
        await sendMessage(
          `Let's talk about the wiki page "${page.title}". ${editableNote}\n\nCurrent content:\n\n${page.content}`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to load wiki page "${pageParam}"`)
      }
    })()
    // Deliberately empty deps -- this is a one-time "arrived with a page to
    // discuss" action, same as the ?thread= effect above, not something
    // that should re-run as chat state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (text?: string) => {
    const messageText = (text ?? input).trim()
    if (!messageText) return

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
                <Zap size={14} className="animate-pulse" />
                Thinking…
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <Card className="border-t border-x-0 border-b-0 rounded-none mx-0 p-4 space-y-2">
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
            placeholder="Ask anything… (Shift+Enter for new line)"
            disabled={loading}
            autoFocus
            className="flex-1"
          />
          <Button
            onClick={() => handleSendMessage()}
            disabled={loading || !input.trim()}
            size="sm"
            className="gap-2 active:scale-95 transition-all duration-150"
            aria-label={loading ? "Sending message" : "Send message"}
            title={loading ? "Sending..." : "Send message (or press Enter)"}
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
