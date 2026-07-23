/**
 * Chat Groups (Spec Section 14).
 *
 * A group of specialized agents that collaborate on a task. Members are drawn
 * from a HiveMind, so they share context through the hive's blackboard and are
 * weighted by the same zero-sum trust budget. This module supplies the pieces
 * Section 14 requires: group membership, agent roles, message routing, shared
 * context, message history, decision-making, conflict resolution and task
 * completion — without every agent having to perform every part of the task.
 */

import { HiveMind, HiveAgent } from "./hive-mind.js";

export interface ChatMessage {
  id: string;
  from: string;
  /** Target member id, or undefined for a broadcast. */
  to?: string;
  content: string;
  timestamp: number;
}

export interface Decision {
  question: string;
  decision: string;
  tally: Record<string, number>;
  votes: Array<{ agent: string; option: string; weight: number }>;
}

export class ChatGroup {
  readonly id: string;
  readonly name: string;

  private hive: HiveMind;
  private members = new Set<string>();
  private messages: ChatMessage[] = [];
  private completed = false;
  private result: string | null = null;
  private seq = 0;
  /**
   * NeuroclawSystem.collaborate() reuses one persistent ChatGroup instance
   * for the process's whole lifetime, and post() had no bound at all --
   * the same unbounded-growth pattern already fixed this session for
   * SharedBlackboard's log and PredictionEngine's prediction store. A FIFO
   * cap is the honest fit here too: getHistory() is a plain audit trail,
   * and neither decide() nor discuss() ever reads past messages back in, so
   * trimming old entries changes nothing about decision-making.
   */
  private readonly messagesCapacity = 5000;

  constructor(id: string, name: string, hive: HiveMind) {
    this.id = id;
    this.name = name;
    this.hive = hive;
  }

  addMember(agentId: string): void {
    if (!this.hive.get(agentId)) throw new Error(`No such hive agent: ${agentId}`);
    this.members.add(agentId);
  }
  removeMember(agentId: string): void {
    this.members.delete(agentId);
  }
  getMembers(): HiveAgent[] {
    return Array.from(this.members).map(id => this.hive.get(id)!).filter(Boolean);
  }

  /**
   * Post a message. With `to`, it is routed to that member; otherwise it is a
   * broadcast written to the group's shared-context slot on the blackboard so
   * every member can read it.
   */
  post(from: string, content: string, to?: string): ChatMessage {
    const msg: ChatMessage = {
      id: `${this.id}-m${++this.seq}`,
      from,
      to,
      content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > this.messagesCapacity) {
      this.messages = this.messages.slice(-this.messagesCapacity);
    }
    const author = this.hive.get(from);
    if (author) {
      // Shared context: the latest broadcast/message is visible to the group.
      author.share(`chat:${this.id}:last`, { from, to, content });
    }
    return msg;
  }

  /** Each member contributes its view on a topic; contributions are recorded. */
  async discuss(topic: string): Promise<ChatMessage[]> {
    const ids = Array.from(this.members);
    const contributions = await this.hive.collaborate(topic, ids);
    const out: ChatMessage[] = [];
    for (const { agent, output } of contributions) {
      out.push(this.post(agent.id, output));
    }
    return out;
  }

  /**
   * Trust-weighted group decision. Every member votes for the option that best
   * matches its own reasoning (its process() output plus role/specialization);
   * votes are tallied by the member's hive trust, so a more-reliable member has
   * more sway. Ties are broken deterministically by option order — this is the
   * group's conflict-resolution rule.
   */
  async decide(question: string, options: string[]): Promise<Decision> {
    if (options.length === 0) throw new Error("decide requires at least one option");
    const tally: Record<string, number> = Object.fromEntries(options.map(o => [o, 0]));
    const votes: Decision["votes"] = [];

    for (const agent of this.getMembers()) {
      const rationale = await agent.process(`${question}\nOptions: ${options.join(", ")}`);
      const basis = tokenize(`${rationale} ${agent.role} ${agent.specialization}`);
      const basisSet = new Set(basis);
      let best = options[0];
      let bestScore = -1;
      for (const opt of options) {
        let score = 0;
        for (const t of tokenize(opt)) if (basisSet.has(t)) score++;
        if (score > bestScore) {
          bestScore = score;
          best = opt;
        }
      }
      const weight = agent.trust;
      tally[best] += weight;
      votes.push({ agent: agent.id, option: best, weight });
    }

    let decision = options[0];
    for (const opt of options) {
      if (tally[opt] > tally[decision]) decision = opt;
    }
    return { question, decision, tally, votes };
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  complete(result: string): void {
    this.completed = true;
    this.result = result;
  }
  isComplete(): boolean {
    return this.completed;
  }
  getResult(): string | null {
    return this.result;
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
