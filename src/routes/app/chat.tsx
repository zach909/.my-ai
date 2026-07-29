/**
 * AI Chat — interactive conversation with prompt clips and quick actions.
 *
 * Features:
 * - Send messages to the AI agent
 * - Auto-detect and render multiple-choice options as clickable buttons
 * - "Use as prompt" button on responses to save typing
 * - Sidebar with frequently-used prompt clips
 * - Save any message as a reusable clip
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ResponseActions } from '@/components/response-actions'
import { PromptClipsPanel } from '@/components/prompt-clips-panel'
import { ChatQuickQuestions } from '@/components/chat-quick-questions'
import { PromptClips } from '@/lib/prompt-clips'
import { Send, Zap } from 'lucide-react'

export const Route = createFileRoute('/app/chat')({
  head: () => ({
    meta: [
      { title: 'AI Chat · ASI Architect' },
      { name: 'description', content: 'Chat with the AI assistant with prompt clips and quick actions.' },
    ],
  }),
  component: ChatPage,
})

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init_0',
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant. Ask me anything, and I can help with analysis, coding, planning, or creative work. What would you like to work on today?',
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const simulateAgentResponse = (userMessage: string): string => {
    // Simple response simulation — in production, this would call a real API
    const responses = [
      `You asked: "${userMessage}"\n\nHere are some approaches to consider:\n\n(A) Start with foundational research to understand the core concepts\n(B) Jump directly to implementation using proven patterns\n(C) Combine both — research key areas while building a prototype`,
      `That's an interesting question. Let me break it down:\n\n1. First step: Define the scope and requirements\n2. Second step: Identify key constraints and dependencies\n3. Third step: Design the solution architecture\n4. Fourth step: Implement and validate\n\nWhich of these would you like to explore further? (A) Step 1 details (B) Step 2 analysis (C) Full implementation guide`,
      `Based on your input, here are the key considerations:\n- **Performance**: Critical factor for this type of work\n- **Scalability**: Important for long-term sustainability\n- **Maintainability**: Essential for team collaboration\n\nWould you like me to (A) Deep-dive into performance optimization (B) Focus on scalability strategies (C) Discuss maintenance best practices?`,
      `I can help with that! Here's what I recommend:\n\n✓ Break down the problem into smaller, manageable pieces\n✓ Validate assumptions at each step\n✓ Document your reasoning for future reference\n✓ Test your solution against edge cases\n\nReady to start? (A) Yes, let's begin (B) I need more clarification (C) Let me gather more information first`,
    ]
    return responses[Math.floor(Math.random() * responses.length)]
  }

  const handleSendMessage = (text?: string) => {
    const messageText = text || input
    if (!messageText.trim()) return

    // Add user message
    const userMsg: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    // Simulate agent response
    setLoading(true)
    setTimeout(() => {
      const agentResponse = simulateAgentResponse(messageText)
      const agentMsg: Message = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: agentResponse,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, agentMsg])
      setLoading(false)
    }, 800)
  }

  const handleUseAsPrompt = (text: string) => {
    handleSendMessage(text)
  }

  const handleSelectClip = (text: string) => {
    setInput(text)
  }

  const handleSaveClip = () => {
    if (!input.trim()) return
    PromptClips.save(input.trim(), 'chat')
    // Briefly show feedback
    const btn = document.activeElement as HTMLButtonElement
    const originalText = btn?.textContent
    if (btn) {
      btn.textContent = 'Saved!'
      setTimeout(() => {
        btn.textContent = originalText
      }, 1500)
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* Left sidebar - Prompt clips */}
      <aside className="w-72 space-y-4 overflow-y-auto border-r border-border bg-muted/30 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">💾 Prompt Clips</h2>
          <p className="text-xs text-muted-foreground mt-1">Quick access to your saved prompts</p>
        </div>
        <PromptClipsPanel onSelectClip={handleSelectClip} />
      </aside>

      {/* Center - Chat messages */}
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Show quick questions if only initial message */}
          {messages.length === 1 && (
            <div className="space-y-4 max-w-2xl">
              <ChatQuickQuestions onSelectQuestion={handleSendMessage} disabled={loading} />
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xl rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border text-foreground'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>

                {/* Response actions for assistant messages */}
                {msg.role === 'assistant' && (
                  <ResponseActions
                    response={msg.content}
                    onUseAsPrompt={handleUseAsPrompt}
                    onSelectOption={(option) => handleUseAsPrompt(option)}
                  />
                )}
              </div>
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
            <Input
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
              className="gap-2"
              title="Send message (or press Enter)"
            >
              <Send size={16} />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>

          {/* Quick actions row */}
          <div className="flex gap-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveClip}
              disabled={!input.trim()}
              className="h-7"
              title="Save your input as a reusable prompt clip"
            >
              💾 Save clip
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInput('')}
              className="h-7 text-muted-foreground"
              disabled={!input.trim()}
            >
              Clear
            </Button>
            <div className="flex-1" />
            <p className="text-muted-foreground py-1 text-[11px]">
              {messages.length} message{messages.length !== 1 ? 's' : ''} in chat
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
