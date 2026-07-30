/**
 * Bot Service — AI agent that powers the chat interface.
 *
 * Handles message processing, response generation, and integration with
 * the NeuroclawSystem for reasoning, memory, and planning capabilities.
 *
 * This service can be called from the chat UI or CLI to get agent responses.
 */

import type { NeuroclawSystem } from '../models && skills/index'

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
  multipleChoiceOptions?: string[]
  metadata?: {
    domain?: string
    usedMemory?: boolean
    usedPlanning?: boolean
  }
}

/**
 * ChatBot — the AI agent powering the chat interface.
 *
 * Integrates with NeuroclawSystem for:
 * - Memory recall and storage
 * - Reasoning and problem decomposition
 * - Planning and strategy
 * - Self-evaluation and learning
 */
export class ChatBot {
  private system?: NeuroclawSystem
  private conversationHistory: BotMessage[] = []
  private contextWindow = 10 // Keep last N messages for context

  /**
   * Initialize the bot with an optional NeuroclawSystem instance.
   * If no system is provided, the bot uses a simplified reasoning mode.
   */
  async initialize(system?: NeuroclawSystem) {
    this.system = system
    if (this.system) {
      await this.system.initialize()
    }
  }

  /**
   * Process a user message and generate a response.
   */
  async processMessage(userMessage: string): Promise<BotResponse> {
    // Store user message in history
    const userMsg: BotMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    this.conversationHistory.push(userMsg)
    this.trimHistory()

    try {
      // If we have a system, use it for reasoning
      if (this.system) {
        return await this.processWithSystem(userMessage)
      } else {
        return await this.processSimplified(userMessage)
      }
    } catch (error) {
      console.error('Bot processing error:', error)
      return {
        message: 'I encountered an error processing your message. Please try again.',
        confidence: 0.3,
      }
    }
  }

  /**
   * Process message using the full NeuroclawSystem.
   */
  private async processWithSystem(userMessage: string): Promise<BotResponse> {
    if (!this.system) {
      throw new Error('System not initialized')
    }

    // Try to route to the appropriate capability
    const intent = this.detectIntent(userMessage)

    let result
    switch (intent) {
      case 'plan':
        result = await this.system.autonomousTask('user request', [userMessage])
        return {
          message: result.results?.[0]?.result || 'Planning in progress...',
          confidence: 0.8,
          metadata: {
            domain: 'planning',
            usedPlanning: true,
          },
        }

      case 'recall':
        result = await this.system.processQuery(userMessage)
        return {
          message: result,
          confidence: 0.85,
          metadata: {
            usedMemory: true,
          },
        }

      case 'solve':
      default:
        result = await this.system.solve(userMessage)
        return {
          message: result.result,
          confidence: result.confidence,
          metadata: {
            domain: result.domain,
          },
        }
    }
  }

  /**
   * Simplified processing without the full system (fallback mode).
   * Still generates thoughtful responses with optional multiple-choice.
   */
  private async processSimplified(userMessage: string): Promise<BotResponse> {
    // Detect question type
    const isQuestion = userMessage.trim().endsWith('?')
    const isMultipleChoice = this.shouldGenerateMultipleChoice(userMessage)

    // Build context from conversation history
    const context = this.buildContext()

    // Generate response based on message content
    const response = this.generateResponse(userMessage, context)

    // Generate multiple-choice options if appropriate
    const options = isMultipleChoice ? this.generateOptions(userMessage) : undefined

    return {
      message: response.message,
      confidence: response.confidence,
      reasoning: response.reasoning,
      multipleChoiceOptions: options,
      metadata: {
        domain: response.domain,
      },
    }
  }

  /**
   * Detect the user's intent from their message.
   */
  private detectIntent(
    message: string
  ): 'plan' | 'recall' | 'solve' | 'help' {
    const lower = message.toLowerCase()

    if (lower.includes('plan') || lower.includes('schedule') || lower.includes('organize')) {
      return 'plan'
    }
    if (lower.includes('remember') || lower.includes('recall') || lower.includes('what was')) {
      return 'recall'
    }
    if (lower.includes('help') || lower.includes('how')) {
      return 'solve'
    }
    return 'solve'
  }

  /**
   * Build context from recent conversation history.
   */
  private buildContext(): string {
    return this.conversationHistory
      .slice(-this.contextWindow)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n')
  }

  /**
   * Decide whether to generate multiple-choice options.
   */
  private shouldGenerateMultipleChoice(message: string): boolean {
    const lower = message.toLowerCase()
    // Generate options for decision-making, approach, or strategy questions
    return (
      lower.includes('how should') ||
      lower.includes('what approach') ||
      lower.includes('which') ||
      lower.includes('options') ||
      Math.random() < 0.3 // ~30% of other messages
    )
  }

  /**
   * Generate a response to the user's message.
   */
  private generateResponse(
    userMessage: string,
    context: string
  ): {
    message: string
    confidence: number
    reasoning?: string
    domain?: string
  } {
    // Simple pattern matching for common scenarios
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

    // Default analytical response
    const analysis = this.analyzeMessage(userMessage)
    return {
      message: this.buildAnalyticalResponse(userMessage, analysis),
      confidence: 0.7,
      reasoning: `Analyzed ${analysis.type} with ${analysis.keyPoints.length} key points`,
      domain: analysis.type,
    }
  }

  /**
   * Analyze the structure and content of a message.
   */
  private analyzeMessage(message: string): {
    type: string
    keyPoints: string[]
    hasProblem: boolean
  } {
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
      hasProblem: lower.includes('problem') || lower.includes('issue') || lower.includes('wrong'),
    }
  }

  /**
   * Build an analytical response based on message analysis.
   */
  private buildAnalyticalResponse(userMessage: string, analysis: any): string {
    const responses: Record<string, string> = {
      coding: `I can help with coding. Looking at your request about "${userMessage.substring(0, 50)}...":\n\nLet's break this down:\n1. Understand the requirements\n2. Design the solution\n3. Implement step by step\n4. Test and validate\n\nWhat specific aspect would you like to focus on?`,
      analysis: `Great analytical question. Here's how I'd approach this:\n\n• Gather the data and context\n• Identify key variables and relationships\n• Look for patterns and anomalies\n• Draw conclusions\n• Consider implications\n\nWhat data or scenario are we analyzing?`,
      planning: `I can help you create a plan. For "${userMessage.substring(0, 40)}...":\n\n**Approach:**\n1. Define clear objectives\n2. Identify constraints and resources\n3. Break into manageable steps\n4. Assign timelines\n5. Plan for contingencies\n\nWhat's your timeline?`,
      general: `That's an interesting topic. Let me think through this:\n\n**Key considerations:**\n• What's the core objective?\n• What constraints apply?\n• What resources are available?\n• What are the success criteria?\n\nCould you elaborate on what you're trying to accomplish?`,
    }

    return responses[analysis.type] || responses.general
  }

  /**
   * Generate multiple-choice options for a topic.
   */
  private generateOptions(userMessage: string): string[] {
    const lower = userMessage.toLowerCase()

    // Approach options
    if (lower.includes('approach') || lower.includes('how should')) {
      return [
        '(A) Start with foundational research to understand core concepts',
        '(B) Jump directly to implementation using proven patterns',
        '(C) Combine both — research key areas while building a prototype',
      ]
    }

    // Focus options
    if (lower.includes('focus') || lower.includes('prioritize')) {
      return [
        '(A) Focus on the most critical/high-impact items first',
        '(B) Build foundational elements before advanced features',
        '(C) Parallel path — tackle critical and foundational in parallel',
      ]
    }

    // Strategy options
    if (lower.includes('strategy') || lower.includes('method')) {
      return [
        '(A) Structured approach with detailed planning upfront',
        '(B) Iterative approach with rapid feedback cycles',
        '(C) Hybrid approach — plan key milestones, iterate in between',
      ]
    }

    // Default options
    return [
      '(A) Explore this topic in more depth',
      '(B) Move forward with practical implementation',
      '(C) Identify risks and potential issues first',
    ]
  }

  /**
   * Keep conversation history within the context window.
   */
  private trimHistory() {
    if (this.conversationHistory.length > this.contextWindow * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.contextWindow)
    }
  }

  /**
   * Get conversation history.
   */
  getHistory(): BotMessage[] {
    return [...this.conversationHistory]
  }

  /**
   * Clear conversation history.
   */
  clearHistory() {
    this.conversationHistory = []
  }

  /**
   * Get bot status/capabilities.
   */
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

/**
 * Get or create the bot singleton.
 */
export async function getBot(system?: NeuroclawSystem): Promise<ChatBot> {
  if (!botInstance) {
    botInstance = new ChatBot()
    await botInstance.initialize(system)
  }
  return botInstance
}

/**
 * Reset the bot (clears history and creates new instance).
 */
export function resetBot() {
  botInstance = null
}
