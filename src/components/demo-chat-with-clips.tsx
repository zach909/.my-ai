/**
 * Demo Chat Interface — shows ResponseActions + PromptClipsPanel integration.
 *
 * This is an example of how to integrate prompt clips and multiple-choice UI
 * into a chat interface. Can be adapted for any response-based workflow.
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResponseActions } from '@/components/response-actions'
import { PromptClipsPanel } from '@/components/prompt-clips-panel'
import { PromptClips } from '@/lib/prompt-clips'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
}

export function DemoChatWithClips() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'agent',
      content:
        'Which task would you like to work on?\n\n(A) Generate a summary of the document\n(B) Extract key findings from the report\n(C) Create an action plan based on recommendations',
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

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return

    // Add user message
    const userMsg: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    // Simulate agent response (in real app, this would call an actual agent API)
    setLoading(true)
    setTimeout(() => {
      const responses = [
        'The document contains several key insights about project management and team collaboration. Would you like me to (A) Elaborate on the team dynamics (B) Focus on project timelines (C) Discuss resource allocation?',
        'Here are the findings:\n1. First finding\n2. Second finding\n3. Third finding\n\nWhich would you like to explore further? (A) First finding details (B) Second finding analysis (C) Third finding implications',
        `That's an interesting point. Based on your input, here's what I recommend: Start with foundational work, then move to implementation, and finally validate results.`,
      ]
      const response = responses[Math.floor(Math.random() * responses.length)]
      const agentMsg: Message = {
        id: `msg_${Date.now()}_agent`,
        role: 'agent',
        content: response,
      }
      setMessages((prev) => [...prev, agentMsg])
      setLoading(false)
    }, 1000)
  }

  const handleUseAsPrompt = (text: string) => {
    handleSendMessage(text)
  }

  const handleSelectClip = (text: string) => {
    setInput(text)
  }

  return (
    <div className="flex h-screen flex-col gap-4 p-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Chat with Prompt Clips Demo</h1>
        <p className="text-sm text-muted-foreground">
          Responses have quick-action buttons. Multiple-choice options become clickable.
        </p>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left sidebar - Clips panel */}
        <aside className="w-64 space-y-4 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
          <PromptClipsPanel onSelectClip={handleSelectClip} />
        </aside>

        {/* Center - Chat messages */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-md rounded-lg p-3 ${
                    msg.role === 'user'
                      ? 'bg-primary/15 text-foreground'
                      : 'bg-muted/50 border border-border text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                  {/* Show response actions only for agent messages */}
                  {msg.role === 'agent' && (
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
                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  Agent thinking…
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="mt-4 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage(input)
                }
              }}
              placeholder="Type a message or select from clips…"
              disabled={loading}
              className="flex-1"
            />
            <Button
              onClick={() => handleSendMessage(input)}
              disabled={loading || !input.trim()}
              className="px-4"
            >
              Send
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // Save current input as a clip
                if (input.trim()) {
                  PromptClips.save(input, 'manual')
                  alert('Clip saved!')
                }
              }}
              disabled={!input.trim()}
              title="Save input as a reusable clip"
            >
              Save clip
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
