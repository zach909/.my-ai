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
import { Send, Zap, Sparkles, EyeOff, History } from 'lucide-react'

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        <Button
          variant={incognito ? 'default' : 'outline'}
          size="sm"
          onClick={() => setIncognito((v) => !v)}
          className="gap-1.5 text-xs"
          title={incognito ? 'Incognito: this conversation is not saved' : 'Turn on incognito mode (nothing gets saved)'}
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
                <Button size="sm" onClick={() => continueThread(pendingMatch.match).then(() => sendMessage(pendingMatch.text))}>
                  Continue there
                </Button>
                <Button
                  size="sm"
                  variant="outline"
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
              className={`max-w-xl rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
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
            aria-label="Send message"
            title="Send message (or press Enter)"
          >
            <Send size={16} />
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
        <p className="text-muted-foreground py-1 text-[11px]">
          {messages.length} message{messages.length !== 1 ? 's' : ''} in chat
          {incognito && ' · incognito, nothing is saved'}
        </p>
      </Card>
    </div>
  )
}
