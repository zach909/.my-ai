/**
 * Bot Service — AI agent that powers the chat interface.
 *
 * Handles message processing, response generation, and follow-up prompt
 * suggestions. Optionally integrates with NeuroclawSystem for reasoning,
 * memory, and planning; falls back to a simplified analytical mode when no
 * system instance is supplied.
 */

import type { NeuroclawSystem } from '../index'

/** A route the bot knows about and can reference/point users to. */
export interface AppRoute {
  path: string
  title: string
  description: string
}

/** Every route in the app, so the bot can tell users where to go. */
export const APP_ROUTES: AppRoute[] = [
  { path: '/', title: 'ASI Architect', description: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
  { path: '/desktop', title: 'Desktop', description: 'Desktop application shell.' },
  { path: '/builder', title: 'Extension Builder', description: 'Build and manage extensions.' },
  { path: '/app', title: 'Dashboard', description: 'ASI Architect — Prototype & Evaluate Superintelligence Modules.' },
  { path: '/app/chat', title: 'AI Chat', description: 'Talk to the AI assistant with agent-suggested follow-up prompts.' },
  { path: '/app/planning', title: 'Planning', description: 'Define goal hierarchies, task decomposition, and strategic planning for ASI agents.' },
  { path: '/app/architecture', title: 'Architecture', description: 'Define and compose superintelligence subsystems and data flows.' },
  { path: '/app/knowledge', title: 'Knowledge & Reasoning', description: 'Build knowledge graphs and inference engines for ASI cognition.' },
  { path: '/app/evaluation', title: 'Evaluation', description: 'Measure and benchmark ASI module performance against defined criteria.' },
  { path: '/app/experiments', title: 'Experiments', description: 'Design and run ASI module experiments with structured protocols.' },
  { path: '/app/chat-groups', title: 'Chat Groups', description: 'Hive-mind agents collaborating on a task through a shared chat group.' },
]

export interface BotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface BotResponse {
  message: string
  confidence: number
  reasoning?: string
  /** Suggested follow-up prompts the agent thinks the user may want to send next. */
  suggestions: string[]
  metadata?: {
    domain?: string
    usedMemory?: boolean
    usedPlanning?: boolean
  }
}

/**
 * ChatBot — the AI agent powering the chat interface.
 */
export class ChatBot {
  private system?: NeuroclawSystem
  private conversationHistory: BotMessage[] = []
  private contextWindow = 10 // Keep last N messages for context

  async initialize(system?: NeuroclawSystem) {
    this.system = system
    if (this.system) {
      await this.system.initialize()
    }
  }

  /** The underlying NeuroclawSystem, if one was supplied — undefined in fallback mode. */
  getSystem(): NeuroclawSystem | undefined {
    return this.system
  }

  /**
   * Process a user message and generate a response with follow-up suggestions.
   */
  async processMessage(userMessage: string): Promise<BotResponse> {
    const userMsg: BotMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    this.conversationHistory.push(userMsg)
    this.trimHistory()

    try {
      const response = this.system
        ? await this.processWithSystem(userMessage)
        : await this.processSimplified(userMessage)

      this.conversationHistory.push({
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
      })
      this.trimHistory()

      return response
    } catch (error) {
      console.error('Bot processing error:', error)
      return {
        message: 'I encountered an error processing your message. Please try again.',
        confidence: 0.3,
        suggestions: ['Try rephrasing your question', 'Ask something else'],
      }
    }
  }

  private async processWithSystem(userMessage: string): Promise<BotResponse> {
    if (!this.system) {
      throw new Error('System not initialized')
    }

    const intent = this.detectIntent(userMessage)

    switch (intent) {
      case 'route':
        return this.buildRouteResponse()

      case 'plan': {
        const result = await this.system.autonomousTask('user request', [userMessage])
        const message = result.results?.[0]?.result || 'Planning in progress...'
        return {
          message,
          confidence: 0.8,
          suggestions: this.generateSuggestions(userMessage, message, 'planning'),
          metadata: { domain: 'planning', usedPlanning: true },
        }
      }

      case 'recall': {
        const message = await this.system.processQuery(userMessage)
        return {
          message,
          confidence: 0.85,
          suggestions: this.generateSuggestions(userMessage, message, 'recall'),
          metadata: { usedMemory: true },
        }
      }

      case 'solve':
      default: {
        const result = await this.system.solve(userMessage)
        return {
          message: result.result,
          confidence: result.confidence,
          suggestions: this.generateSuggestions(userMessage, result.result, result.domain),
          metadata: { domain: result.domain },
        }
      }
    }
  }

  /**
   * Simplified processing without the full system (fallback mode).
   */
  private async processSimplified(userMessage: string): Promise<BotResponse> {
    if (this.isRouteQuery(userMessage.toLowerCase())) {
      return this.buildRouteResponse()
    }

    const response = this.generateResponse(userMessage)
    const suggestions = this.generateSuggestions(userMessage, response.message, response.domain)

    return {
      message: response.message,
      confidence: response.confidence,
      reasoning: response.reasoning,
      suggestions,
      metadata: { domain: response.domain },
    }
  }

  private detectIntent(message: string): 'plan' | 'recall' | 'solve' | 'help' | 'route' {
    const lower = message.toLowerCase()
    if (this.isRouteQuery(lower)) return 'route'
    if (lower.includes('plan') || lower.includes('schedule') || lower.includes('organize')) return 'plan'
    if (lower.includes('remember') || lower.includes('recall') || lower.includes('what was')) return 'recall'
    if (lower.includes('help') || lower.includes('how')) return 'solve'
    return 'solve'
  }

  private isRouteQuery(lowerMessage: string): boolean {
    return (
      /\b(where|which page|which route|navigate|go to|take me to)\b/.test(lowerMessage) &&
      /\b(page|pages|route|routes|section|screen|tab)\b/.test(lowerMessage)
    ) || /\blist (all )?(the )?(pages|routes)\b/.test(lowerMessage)
  }

  /** The bot always has awareness of every app route — no filtering or restriction. */
  private buildRouteResponse(): BotResponse {
    const list = APP_ROUTES.map((r) => `• **${r.title}** (\`${r.path}\`) — ${r.description}`).join('\n')
    return {
      message: `Here are all the pages in the app:\n\n${list}`,
      confidence: 0.9,
      suggestions: ['Take me to AI Chat', 'What can I do in Planning?', 'List all pages'],
      metadata: { domain: 'route' },
    }
  }

  private generateResponse(userMessage: string): {
    message: string
    confidence: number
    reasoning?: string
    domain: string
  } {
    const lower = userMessage.toLowerCase()

    if (lower.includes('hello') || lower.includes('hi')) {
      return {
        message:
          "Hello! I'm here to help you with analysis, planning, coding, problem-solving, and creative thinking. What would you like to work on?",
        confidence: 0.95,
        domain: 'greeting',
      }
    }

    if (lower.includes('help') || lower.includes('what can you')) {
      return {
        message:
          'I can help you with:\n\n• **Problem Solving**: Break down complex problems into steps\n• **Planning**: Create structured plans and strategies\n• **Coding**: Write, debug, and explain code\n• **Analysis**: Analyze data and identify patterns\n• **Creativity**: Generate ideas and solutions\n• **Learning**: Explain concepts and teach\n\nWhat would you like help with?',
        confidence: 0.9,
        domain: 'help',
      }
    }

    if (lower.includes('thank')) {
      return {
        message: "You're welcome! Feel free to ask if you need anything else.",
        confidence: 0.95,
        domain: 'social',
      }
    }

    const analysis = this.analyzeMessage(userMessage)
    return {
      message: this.buildAnalyticalResponse(userMessage, analysis),
      confidence: 0.7,
      reasoning: `Analyzed ${analysis.type} with ${analysis.keyPoints.length} key points`,
      domain: analysis.type,
    }
  }

  private analyzeMessage(message: string): { type: string; keyPoints: string[] } {
    const lower = message.toLowerCase()
    return {
      type: lower.includes('code')
        ? 'coding'
        : lower.includes('data') || lower.includes('analyze')
          ? 'analysis'
          : lower.includes('plan') || lower.includes('create')
            ? 'planning'
            : 'general',
      keyPoints: message.split(/[.!?]/).filter((s) => s.trim().length > 0),
    }
  }

  private buildAnalyticalResponse(userMessage: string, analysis: { type: string }): string {
    const responses: Record<string, string> = {
      coding: `I can help with coding. Looking at your request about "${userMessage.substring(0, 50)}...":\n\nLet's break this down:\n1. Understand the requirements\n2. Design the solution\n3. Implement step by step\n4. Test and validate\n\nWhat specific aspect would you like to focus on?`,
      analysis: `Great analytical question. Here's how I'd approach this:\n\n• Gather the data and context\n• Identify key variables and relationships\n• Look for patterns and anomalies\n• Draw conclusions\n• Consider implications\n\nWhat data or scenario are we analyzing?`,
      planning: `I can help you create a plan. For "${userMessage.substring(0, 40)}...":\n\n**Approach:**\n1. Define clear objectives\n2. Identify constraints and resources\n3. Break into manageable steps\n4. Assign timelines\n5. Plan for contingencies\n\nWhat's your timeline?`,
      general: `That's an interesting topic. Let me think through this:\n\n**Key considerations:**\n• What's the core objective?\n• What constraints apply?\n• What resources are available?\n• What are the success criteria?\n\nCould you elaborate on what you're trying to accomplish?`,
    }
    return responses[analysis.type] || responses.general
  }

  /**
   * Generate follow-up prompt suggestions based on the domain of the last
   * exchange — the agent proactively proposes what to ask next, rather than
   * relying on the user having saved anything themselves.
   */
  private generateSuggestions(userMessage: string, responseMessage: string, domain?: string): string[] {
    const byDomain: Record<string, string[]> = {
      coding: [
        'Show me example code for this',
        'What edge cases should I handle?',
        'How would I test this?',
      ],
      analysis: [
        'What patterns should I look for?',
        'Can you summarize the key findings?',
        'What are the implications of this?',
      ],
      planning: [
        'Break this into smaller milestones',
        'What are the biggest risks here?',
        'What should I prioritize first?',
      ],
      recall: [
        'What else do you remember about this?',
        'How does this relate to what we discussed before?',
      ],
      help: [
        'Help me break down a complex problem',
        'Create a detailed plan with milestones',
        'Show me best practices for this domain',
      ],
      greeting: [
        'Help me break down a complex problem',
        'What are potential risks or edge cases?',
        'Walk me through a step-by-step approach',
      ],
      social: [
        'What else can you help with?',
      ],
      general: [
        'Can you go deeper on this?',
        'What are the tradeoffs here?',
        'Give me a concrete example',
      ],
    }

    const pool = byDomain[domain ?? 'general'] ?? byDomain.general
    // Multiple-choice option lines already embedded in the response shouldn't
    // be duplicated as suggestions — those are handled inline by the UI.
    const hasInlineOptions = /\([A-Z]\)\s*[^\n]+/.test(responseMessage)
    const suggestions = hasInlineOptions ? [] : [...pool]

    // Always offer a way to keep going deeper on the current thread.
    if (!hasInlineOptions) {
      suggestions.push(`Tell me more about "${userMessage.slice(0, 30)}${userMessage.length > 30 ? '...' : ''}"`)
    }

    return suggestions.slice(0, 4)
  }

  private trimHistory() {
    if (this.conversationHistory.length > this.contextWindow * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.contextWindow)
    }
  }

  getHistory(): BotMessage[] {
    return [...this.conversationHistory]
  }

  clearHistory() {
    this.conversationHistory = []
  }

  getStatus(): {
    initialized: boolean
    hasSystem: boolean
    contextWindow: number
    historyLength: number
  } {
    return {
      initialized: true,
      hasSystem: !!this.system,
      contextWindow: this.contextWindow,
      historyLength: this.conversationHistory.length,
    }
  }
}

// Singleton instance
let botInstance: ChatBot | null = null

export async function getBot(system?: NeuroclawSystem): Promise<ChatBot> {
  if (!botInstance) {
    botInstance = new ChatBot()
    await botInstance.initialize(system)
  } else if (system && !botInstance.getStatus().hasSystem) {
    // The singleton was created by an earlier no-system call (fallback
    // mode) -- upgrade it now that a real system is available, instead of
    // silently discarding this argument and staying in fallback mode
    // forever, which is what happened before this fix.
    await botInstance.initialize(system)
  }
  return botInstance
}

export function resetBot() {
  botInstance = null
}
