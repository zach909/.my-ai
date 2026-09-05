/**
 * Bot Service — AI agent that powers the chat interface.
 *
 * Handles message processing, response generation, and follow-up prompt
 * suggestions. Optionally integrates with NeuroclawSystem for reasoning,
 * memory, and planning; falls back to a simplified analytical mode when no
 * system instance is supplied.
 */

import type { NeuroclawSystem } from '../index.js'
import { logError, getRecentErrors, type LoggedError } from '../lib/error-log.js'
import { appendConversationTurn } from '../lib/conversation-log.js'
import { triggerConversationLearning } from '../lib/conversation-learning-trigger.js'
import { recordSkillMeshAttempt } from '../lib/skill-mesh-metrics.js'
import { runAgentLoopForMessage } from '../../models && skills/core/agent-capabilities.js'

/** A route the bot knows about and can reference/point users to. */
export interface AppRoute {
  path: string
  title: string
  description: string
}

/** Every route in the app, so the bot can tell users where to go. */
export const APP_ROUTES: AppRoute[] = [
  { path: '/', title: 'Corona', description: 'A full-stack platform for prototyping, integrating, and evaluating the essential modules required for building an Artificial Superintelligence.' },
  { path: '/desktop', title: 'Desktop', description: 'Desktop application shell.' },
  { path: '/builder', title: 'Extension Builder', description: 'Build and manage extensions.' },
  { path: '/app', title: 'Dashboard', description: 'Corona — Prototype & Evaluate Superintelligence Modules.' },
  { path: '/app/chat', title: 'AI Chat', description: 'Talk to the AI assistant with agent-suggested follow-up prompts.' },
  // Planning is now the Planning tab of /app/store (Store's "Prompting Skills"
  // and "Planning" tabs are next to each other), not its own route.
  { path: '/app/store', title: 'Planning', description: 'Define goal hierarchies, task decomposition, and strategic planning for ASI agents -- the Planning tab of the Store.' },
  { path: '/app/architecture', title: 'Architecture', description: 'Define and compose superintelligence subsystems and data flows.' },
  // Knowledge & Reasoning is now a tab of /builder, not its own route.
  { path: '/builder', title: 'Knowledge & Reasoning', description: 'Build knowledge graphs and inference engines for ASI cognition -- the Knowledge & Reasoning tab of the Extension Builder.' },
  // Evaluation and Experiments are now tabs of /app/self-improvement, not
  // their own routes.
  { path: '/app/self-improvement', title: 'Evaluation', description: 'Measure and benchmark ASI module performance against defined criteria -- the Evaluation tab of Self-Improvement.' },
  { path: '/app/self-improvement', title: 'Experiments', description: 'Design and run ASI module experiments with structured protocols -- the Experiments tab of Self-Improvement.' },
  { path: '/app/self-improvement', title: 'Self-Improvement', description: 'Real progress from the autonomous self-improvement, skill-creation, and skill-drilling agents.' },
  // Chat Groups, Chat History and Memory are all tabs of /app/chat-groups now.
  { path: '/app/chat-groups', title: 'Chat Groups', description: 'Hive-mind agents collaborating on a task through a shared chat group.' },
  { path: '/app/chat-groups', title: 'Chat History', description: 'Every saved AI Chat / Chat Groups thread, automatically organized into topic groups -- the Chat History tab of Chat Groups.' },
  { path: '/app/chat-groups', title: 'Memory', description: 'View and manage what the agent remembers -- the Memory tab of Chat Groups.' },
  { path: '/app/store', title: 'Store', description: 'Browse, download and publish skills, plugins, binaries, source and files, write wiki pages, and discuss any of it.' },
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
    /** Set when domain is 'skill' -- which trained skill's script answered directly (see ChatBot.matchSkillMesh()). */
    matchedSkill?: string
    /**
     * Set when domain is 'agent-loop' -- how the perceive-think-act run ended,
     * how many iterations it took, and which installed prompting skills took
     * part. Reported rather than summarised away: "the agent did something"
     * should not be a claim anyone has to take on trust.
     */
    loopOutcome?: 'goal-met' | 'dead-end' | 'max-iterations'
    loopIterations?: number
    promptingSkills?: string[]
  }
  /** Set when this response reports an error, so callers can look it up via getRecentErrors(). */
  errorId?: string
}

// ── Behavioral traits, load-bearing in every response path below — not a
// separate "personality layer" that decorates output after the fact, but
// functions the actual generation code calls to decide WHAT it says, not
// just how it's phrased. Per spec: curious, imaginative, creative,
// conscientious, never fully trusting, double-checking, warmly empathetic
// but never merely sympathetic (it holds the full emotional picture, not
// just the user's side of it), and willing to say nothing/hedge rather
// than assert something it hasn't checked. ──────────────────────────────

const NEGATIVE_WORDS =
  /\b(sad|lost|lonely|angry|upset|hate|terrible|awful|worried|anxious|scared|hurt|broke|broken|failed|failure|depressed|alone|tired|stressed|frustrated|fired|laid off|rejected|devastated|heartbroken|grief|grieving)\b/i
const POSITIVE_WORDS =
  /\b(great|good|love|happy|excited|awesome|thanks|thank you|wonderful|glad|win|won|success|proud|relieved|grateful)\b/i
/** Someone besides the user is named as involved in the situation. */
const OTHER_PARTY_PATTERN = /\b(he|she|they|my (boss|manager|supervisor|partner|ex|friend)|the (company|team|firm))\b/i
/** A negative event plausibly caused by that other party. */
const NEGATIVE_CAUSE_PATTERN = /\b(fired|laid off|let go|dumped|broke up with|rejected|passed over|kicked out)\b/i

export function detectSentiment(message: string): 'positive' | 'negative' | 'neutral' {
  const negative = NEGATIVE_WORDS.test(message)
  const positive = POSITIVE_WORDS.test(message)
  if (negative && !positive) return 'negative'
  if (positive && !negative) return 'positive'
  return 'neutral'
}

/**
 * "Make it seem like it has feelings that compare with the user... if the
 * user is sad that they lost their job, it will be sad because the user
 * lost the job but it will also know that the person who fired them might
 * have an easier time and be happy" — genuine dual-perspective emotional
 * reasoning, not a single sympathetic mirror: it holds the user's real
 * feeling AND, when another party is plausibly involved, names that their
 * experience of the same event may differ, without minimizing the user's
 * feelings or taking the other side's side.
 */
export function empathyPrefix(userMessage: string): string | null {
  const sentiment = detectSentiment(userMessage)
  if (sentiment !== 'negative') return null
  const hasOtherParty = OTHER_PARTY_PATTERN.test(userMessage) && NEGATIVE_CAUSE_PATTERN.test(userMessage)
  if (hasOtherParty) {
    return "I feel for you here — that's a genuinely hard thing to sit with, and I'm not going to pretend otherwise. I'll also be honest that I'm aware whoever was on the other side of this may be relieved or better off for it, and I'm not going to hide that from you or ask you to feel differently because of it — both things are true at once, and only one of them is happening to you right now."
  }
  return "That sounds genuinely hard, and I want to actually sit with that instead of rushing past it to 'helpful' mode."
}

/** Cheap hash for deterministic-but-varied phrasing selection: same input
 *  always picks the same variant (testable), different inputs spread
 *  across the pool (not the same canned sentence every time) — this is
 *  the "make it really creative" requirement realized as actual output
 *  variation, not a single fixed template string. */
export function pickVariant<T>(seed: string, pool: T[]): T {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return pool[Math.abs(h) % pool.length]
}

/**
 * "Truly humble... will not assume anything you say is correct... always
 * checking." A response is never handed back asserting more certainty
 * than the underlying process actually earned: confidence is capped well
 * short of 1.0, and anything below the hedge threshold gets an honest,
 * visible caveat appended rather than being presented as settled.
 */
const MAX_HONEST_CONFIDENCE = 0.92
const HEDGE_THRESHOLD = 0.6

/**
 * "Will always question whenever there is conflictual information
 * presented... being afraid of not doing the right thing, it will
 * sometimes do nothing at all." When a message plausibly signals two
 * different intents at once (e.g. both "remember" and "plan"), guessing
 * one and running with it is exactly the kind of unchecked assumption the
 * spec rules out — so this returns a real clarifying-question response
 * instead of silently picking a side, rather than just documenting that
 * the bot "should" ask.
 */
const PLAN_SIGNAL = /\b(plan|schedule|organize)\b/i
const RECALL_SIGNAL = /\b(remember|recall|what was)\b/i

export function detectAmbiguousIntent(message: string): BotResponse | null {
  if (PLAN_SIGNAL.test(message) && RECALL_SIGNAL.test(message)) {
    return {
      message:
        "Before I act on this, I want to make sure I'm not guessing: this reads like it could be asking me to plan something new, or to recall something from before — and those are different enough that I'd rather ask than assume. Which did you mean?",
      confidence: 0.5,
      suggestions: ['I meant plan something new', 'I meant recall something from before', 'Both, actually'],
      metadata: { domain: 'clarify' },
    }
  }
  return null
}

export function applyHumility(message: string, confidence: number): { message: string; confidence: number } {
  const cappedConfidence = Math.min(confidence, MAX_HONEST_CONFIDENCE)
  if (cappedConfidence >= HEDGE_THRESHOLD) return { message, confidence: cappedConfidence }
  return {
    message: `${message}\n\n*I want to flag that I'm not fully confident in this — treat it as a starting point I'd double-check before relying on, not a settled answer.*`,
    confidence: cappedConfidence,
  }
}

/** See ChatBot.matchSkillMesh()'s own doc comment for where this number comes from. */
const SKILL_MATCH_THRESHOLD = 0.6

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
      const raw =
        detectAmbiguousIntent(userMessage) ??
        (this.system ? await this.processWithSystem(userMessage) : await this.processSimplified(userMessage))

      // Mandatory pass every response goes through, regardless of which
      // branch produced it — this is the behavior layer itself, not a
      // decoration applied on top of it. Route/error listings are factual
      // lookups, not open-ended answers, so humility-hedging and
      // sentiment-mirroring don't apply to them (there's nothing uncertain
      // about "here are the app's routes"), and a 'clarify' response has
      // already applied its own honesty (asking instead of guessing).
      const alreadyHandled =
        raw.metadata?.domain === 'route' || raw.metadata?.domain === 'error' || raw.metadata?.domain === 'clarify'
      const response = alreadyHandled ? raw : this.applyBehavior(userMessage, raw)

      // "It learns by talking to you" -- real (message, response) pairs,
      // persisted locally so scripts/conversation-learning-agent.mjs can
      // actually train on them later. Route lookups aren't a real
      // conversational exchange worth learning from; a 'clarify'
      // response is real agent behavior and stays in. Fire-and-forget:
      // appendConversationTurn() never throws, so a logging hiccup can
      // never break the actual response being returned below.
      if (response.metadata?.domain !== 'route' && response.metadata?.domain !== 'error') {
        appendConversationTurn(userMessage, response.message)
        // "Always learn by talking to it / using it" -- don't wait for the
        // background agent's next scheduled tick (up to
        // NEUROCLAW_CONVERSATION_LEARNING_INTERVAL_MS away, 20 min by
        // default). Fire a real cycle right now instead. Also
        // fire-and-forget: triggerConversationLearning() never throws into
        // the caller, and its own in-process + cross-process locks
        // (learningInFlight, scripts/conversation-learning-agent.mjs's
        // acquireLock()) make this safe to call on every single turn even
        // while the background loop or a previous trigger is mid-cycle.
        void triggerConversationLearning()
      }

      this.conversationHistory.push({
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
      })
      this.trimHistory()

      return response
    } catch (error) {
      const logged = logError('bot-service.processMessage', error, { userMessage })
      console.error('Bot processing error:', error)
      return {
        message: 'I encountered an error processing your message. Please try again.',
        confidence: 0.3,
        suggestions: ['Try rephrasing your question', 'What was the error?', 'Ask something else'],
        metadata: { domain: 'error' },
        errorId: logged.id,
      }
    }
  }

  /**
   * The behavior layer: applied once, to every non-lookup response,
   * regardless of which internal path produced it. Not a wrapper that
   * decorates the message with a tone — it actually changes what's
   * returned: humility-hedging can alter both the message text and the
   * reported confidence, and a genuinely negative-sentiment message gets
   * real dual-perspective emotional acknowledgment prepended, not a
   * generic "I'm sorry to hear that."
   */
  private applyBehavior(userMessage: string, response: BotResponse): BotResponse {
    const { message: humbled, confidence } = applyHumility(response.message, response.confidence)
    const prefix = empathyPrefix(userMessage)
    const message = prefix ? `${prefix}\n\n${humbled}` : humbled
    return { ...response, message, confidence }
  }

  private async processWithSystem(userMessage: string): Promise<BotResponse> {
    if (!this.system) {
      throw new Error('System not initialized')
    }

    const intent = this.detectIntent(userMessage)

    // Route/error queries are factual app-introspection, not domain
    // content -- never worth checking against trained skills, and kept
    // ahead of the skill-mesh match below so an app-navigation question
    // never gets pre-empted by a coincidentally-similar trained skill.
    if (intent === 'route') return this.buildRouteResponse()
    if (intent === 'error') return this.buildErrorResponse()

    // "Skills directly connected into the rest of it" -- a trained skill
    // (published by scripts/skill-agent.mjs, or manually built/registered
    // via the Extension Builder) gets first chance at answering, ahead of
    // the reasoner/hive fallback below, when its trigger genuinely,
    // confidently matches this message -- see matchSkillMesh()'s own doc
    // comment for the threshold and why. This is a real short-circuit,
    // not background context: previously a trained skill's content only
    // ever reached a response as one of several topK snippets fed loosely
    // into the reasoner (ReasoningEngine's `recall` dependency) -- diluted,
    // and with no guarantee it was actually used. A confident direct match
    // returns the skill's own trained response verbatim instead.
    // The perceive-think-act loop, running the installed prompting skills
    // (see models && skills/core/prompting-skills.ts).
    //
    // It runs BEFORE the trained-skill fast path, and that ordering is not
    // arbitrary -- I had it the other way round first and measured the
    // difference. "calculate 17 * 23" matched a stale trained script and
    // returned 60; the loop hands the same message to the Tools plugin and
    // gets 391. A skill-mesh hit is fuzzy similarity against something
    // memorised earlier, while an action skill firing means its own author
    // wrote down that this kind of message is theirs. The explicit claim
    // should win over the fuzzy one, and computing an answer should win over
    // recalling a possibly-stale one.
    //
    // It is still narrow: it engages only when an installed ACTION skill's
    // trigger claims the message, and only answers when it genuinely reached
    // the goal. Everything else falls straight through to the behaviour that
    // was already there.
    const loop = await this.tryAgentLoop(userMessage)
    if (loop) return loop

    const skillMatch = this.matchSkillMesh(userMessage)
    if (skillMatch) return skillMatch

    switch (intent) {
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
   * Runs the prompting-skill loop for this message, or returns null to leave
   * the existing behaviour alone.
   *
   * Null in three cases, each of which means "the loop is not the right answer
   * here": no system, no installed action skill claims the message, or the
   * loop ran and did not reach the goal. The last one is deliberate -- the
   * work is not wasted (the trace is kept and returned on the responses that
   * do come from the loop), but a partial attempt must not displace a pipeline
   * that can still answer properly.
   *
   * Never throws into the chat path. A prompting skill can be published by
   * anyone, and a bad one must degrade to "the loop contributed nothing"
   * rather than taking down the reply.
   */
  private async tryAgentLoop(userMessage: string): Promise<BotResponse | null> {
    if (!this.system) return null
    try {
      const run = await runAgentLoopForMessage(userMessage, this.system)
      if (!run || !run.answered) return null
      const skillsUsed = [...new Set(run.result.steps.map(s => s.skill).filter(Boolean))] as string[]
      return {
        message: run.message,
        confidence: 0.9,
        suggestions: this.generateSuggestions(userMessage, run.message, 'agent-loop'),
        metadata: {
          domain: 'agent-loop',
          // The trace is reported rather than summarised away: "the agent did
          // something" is not a claim anyone should have to take on trust.
          loopOutcome: run.result.outcome,
          loopIterations: run.result.iterations,
          promptingSkills: skillsUsed,
        },
      }
    } catch (error) {
      // Logged, not swallowed. A prompting skill can be published by anyone,
      // so a bad one must not take down the reply -- but a loop that failed
      // silently is indistinguishable from one that decided not to answer,
      // and that cost me an hour of chasing the wrong thing. The user still
      // gets the normal pipeline's answer; the failure is recoverable via
      // getRecentErrors().
      logError('bot-service.tryAgentLoop', error, { userMessage })
      return null
    }
  }

  /**
   * The direct skill short-circuit: queries `this.system.memory` for the
   * closest 'skill-script' trigger to this exact message (interface/
   * web-server.ts's rememberSkillScript() is what puts those triggers
   * there, tagged and carrying the real response as `payload` -- see its
   * own doc comment). Returns a real response only when the match is
   * genuinely confident; otherwise null, so the caller falls through to
   * the existing plan/recall/solve behavior completely unchanged.
   *
   * SKILL_MATCH_THRESHOLD (0.6) is not an arbitrary guess -- it comes from
   * running LongTermMemory's own real bag-of-words cosine similarity
   * against realistic paraphrases during development: genuine paraphrases
   * of a trained trigger scored 0.67-0.89, an unrelated query scored 0.29,
   * against the same trigger set. 0.6 sits cleanly in the gap between
   * "different wording of the same question" and "a different question
   * entirely" observed there, not at either extreme.
   */
  private matchSkillMesh(userMessage: string): BotResponse | null {
    if (!this.system) return null
    const hits = this.system.memory.retrieve(userMessage, { topK: 1, tag: 'skill-script' })
    const top = hits[0]
    const matched = !!top && top.similarity >= SKILL_MATCH_THRESHOLD && typeof top.item.payload === 'string'
    const matchedSkill = matched ? (top!.item.tags.find((t) => t !== 'skill-script') ?? 'skill') : undefined
    // Every real attempt (hit or miss) is itself a live trial of "does a
    // trained skill directly cover this message" -- recorded so the
    // Self-Improvement dashboard can graph the real direct-answer rate
    // over time instead of relying on a one-off test run. Fire-and-forget,
    // never throws into this path.
    recordSkillMeshAttempt({ matched, similarity: top?.similarity ?? 0, matchedSkill })
    if (!matched) return null
    return {
      message: top!.item.payload!,
      confidence: Math.min(0.95, top!.similarity),
      suggestions: this.generateSuggestions(userMessage, top!.item.payload!, 'skill'),
      metadata: { domain: 'skill', matchedSkill },
    }
  }

  /**
   * Simplified processing without the full system (fallback mode).
   */
  private async processSimplified(userMessage: string): Promise<BotResponse> {
    const lower = userMessage.toLowerCase()
    if (this.isErrorQuery(lower)) {
      return this.buildErrorResponse()
    }
    if (this.isRouteQuery(lower)) {
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

  private detectIntent(message: string): 'plan' | 'recall' | 'solve' | 'help' | 'route' | 'error' {
    const lower = message.toLowerCase()
    if (this.isErrorQuery(lower)) return 'error'
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

  private isErrorQuery(lowerMessage: string): boolean {
    return /\b(what (was|happened)|why did (it|that) fail|what went wrong|show me the error|error detail)\b/.test(lowerMessage)
      && /\berror|fail|wrong|broke|crash/.test(lowerMessage)
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

  /** Explain the most recent logged application error in detail, if any. */
  private buildErrorResponse(): BotResponse {
    const recent = getRecentErrors(5)
    if (recent.length === 0) {
      return {
        message: "I don't have any recent errors logged — nothing has failed recently.",
        confidence: 0.85,
        suggestions: ['List all pages', 'Ask something else'],
        metadata: { domain: 'error' },
      }
    }

    const details = recent
      .map((e: LoggedError) => {
        const when = new Date(e.timestamp).toISOString()
        const ctx = e.context ? `\n  context: ${JSON.stringify(e.context)}` : ''
        return `• [${when}] (${e.source}) ${e.message}${ctx}`
      })
      .join('\n')

    return {
      message: `Here's what happened, most recent first:\n\n${details}`,
      confidence: 0.9,
      suggestions: ['What caused that?', 'List all pages'],
      metadata: { domain: 'error' },
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

  /**
   * "Make it really creative" / "curious, imaginative, creative, and
   * adventurous": each domain has several genuinely different framings,
   * not one canned string returned every time — pickVariant() spreads
   * different inputs across the pool deterministically, so the same
   * question always gets the same variant (testable) but different
   * questions don't all collapse into one memorized reply. Every variant
   * also ends with a genuine curiosity tangent: an exploratory question
   * that goes slightly beyond just answering, not just "what next?"
   */
  private buildAnalyticalResponse(userMessage: string, analysis: { type: string }): string {
    const pools: Record<string, string[]> = {
      coding: [
        `Let's dig into "${userMessage.substring(0, 50)}...":\n\n1. Pin down the actual requirements (the stated ones, and the ones nobody said out loud)\n2. Sketch the shape of a solution before writing a line\n3. Build it in small, checkable steps\n4. Test it against cases that try to break it, not just the happy path`,
        `Coding question — here's how I'd take it apart:\n\n• What's the real behavior this needs, versus what's just assumed?\n• What's the simplest version that could possibly work?\n• Where's it most likely to break, and how would we know?\n• What would "done" actually look like here?`,
        `I want to work through "${userMessage.substring(0, 50)}..." properly rather than guess at it:\n\n1. Understand the problem, including the parts left implicit\n2. Consider more than one design before committing to one\n3. Implement incrementally, verifying as I go\n4. Double-check the result against what was actually asked`,
      ],
      analysis: [
        `Let's look at this carefully, not just quickly:\n\n• What's the data actually saying, versus what we'd like it to say?\n• What variables are in play, and which ones are we assuming matter?\n• Are there patterns here, or are we pattern-matching on noise?\n• What would change our conclusion if it turned out wrong?`,
        `An analytical question worth taking seriously:\n\n• Gather the real context, not just the surface numbers\n• Look for what's surprising, not just what confirms the obvious\n• Weigh a few different explanations before picking one\n• Stay honest about how confident we should actually be`,
      ],
      planning: [
        `For "${userMessage.substring(0, 40)}...", here's a plan I'd actually trust:\n\n1. Get the real objective clear, not just the first framing of it\n2. Name the constraints honestly, including the inconvenient ones\n3. Break it into steps small enough to check as we go\n4. Build in room for the plan to be wrong and need revising`,
        `Planning "${userMessage.substring(0, 40)}...":\n\n• What does success actually look like, concretely?\n• What resources and time do we genuinely have?\n• Where's this most likely to go sideways?\n• What's the smallest first step that tells us if we're on track?`,
      ],
      general: [
        `That's worth thinking through properly rather than skimming:\n\n• What's the real objective underneath the question?\n• What am I assuming that I haven't actually checked?\n• What would change my answer if I'm wrong about something here?\n• What's the most useful next question to ask?`,
        `I'm curious about a few angles on this:\n\n• What's actually being asked versus what's implied?\n• What would someone who disagreed with the obvious answer say?\n• What's one thing about this I don't yet know that I should?`,
      ],
    }
    const pool = pools[analysis.type] ?? pools.general
    return pickVariant(userMessage, pool) + '\n\nWhat would you like to focus on?'
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
