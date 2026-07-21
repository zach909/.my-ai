import { realpathSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NeuroclawLLM } from "./models && skills/llm.js";
import { NeuroPipeline } from "./models && skills/core/pipeline.js";
import { ThesaurusDictionary } from "./models && skills/thesaurus.js";
import { PluginRegistry } from "./plugin_manager/registry.js";
import { NeuroclawRunner } from "./interface/runner.js";
import { WebServer } from "./interface/web-server.js";
import { CLI } from "./interface/cli.js";
import { AlignmentVeto } from "./models && skills/core/alignment-veto.js";
import { ZipIOSystem } from "./models && skills/core/zip-io.js";
import { EmpathyEngine } from "./models && skills/core/empathy.js";
import { HiveMind } from "./models && skills/core/hive-mind.js";
import { ChatGroup } from "./models && skills/core/chat-group.js";
import { LongTermMemory } from "./models && skills/core/long-term-memory.js";
import { PlanTracker } from "./models && skills/core/plan-tracker.js";
import { SelfHealer } from "./models && skills/core/self-healer.js";
import { ContextCompressor } from "./models && skills/core/context-compressor.js";
import { IntentRouter } from "./models && skills/core/intent-router.js";
import { SelfMonitor } from "./models && skills/core/self-monitor.js";
import { MistakeTracker } from "./models && skills/core/mistake-tracker.js";
import { KnowledgeGraph } from "./models && skills/core/knowledge-graph.js";
import { ReasoningEngine } from "./models && skills/core/reasoning-engine.js";
import { KnowledgeTransfer } from "./models && skills/core/knowledge-transfer.js";
import { SelfModel } from "./models && skills/core/self-model.js";
import { SelfImprovement } from "./models && skills/core/self-improvement.js";
import { AutonomousLearner } from "./models && skills/core/autonomous-learner.js";
import { PredictionEngine } from "./models && skills/core/prediction-engine.js";
import { DiscoveryEngine } from "./models && skills/core/discovery-engine.js";

// Plugins & skills — the whole extension catalog is instantiated through the
// shared factory so every entry in `pluginExtensions` gets a real
// implementation, not just a hand-picked subset.
import { CallHistoryPlugin } from "./plugins/call-history.js";
import { PhoneCallsPlugin } from "./plugins/phone-calls.js";
import { createPluginInstance, pluginExtensions } from "./plugins/index.js";
import type { SkillDefinition } from "./plugin_manager/types.js";

/**
 * Neuroclaw System - Complete AI with neural networks, extensions, and safety
 *
 * Core subsystems:
 * - NeuroPipeline: orchestrates all computation
 * - AlignmentVeto: safety layer ensuring actions are user-aligned
 * - ZipIOSystem: circular buffer for extended context
 * - EmpathyEngine: tracks user emotion and alignment
 * - PluginRegistry: manages all plugins and skills
 */
export class NeuroclawSystem {
  llm: NeuroclawLLM;
  pipeline: NeuroPipeline;
  thesaurus: ThesaurusDictionary;
  pluginRegistry: PluginRegistry;
  veto: AlignmentVeto;
  zipIO: ZipIOSystem;
  empathy: EmpathyEngine;
  runner: NeuroclawRunner;
  hive: HiveMind;
  memory: LongTermMemory;
  plan: PlanTracker;
  healer: SelfHealer;
  compressor: ContextCompressor;
  router: IntentRouter;
  // AGI / ASI capability layer (integrated in solve()).
  monitor: SelfMonitor;
  mistakes: MistakeTracker;
  knowledge: KnowledgeGraph;
  reasoner: ReasoningEngine;
  transfer: KnowledgeTransfer;
  selfModel: SelfModel;
  improvement: SelfImprovement;
  learner: AutonomousLearner;
  predictor: PredictionEngine;
  discovery: DiscoveryEngine;

  private initialized = false;
  private contextCapacityGB: number;
  private chatGroup: ChatGroup | null = null;
  /** Bias per reasoning strategy derived from discovered outcome regularities (§5/§12). */
  private approachBiasMap = new Map<string, number>();
  /** Which hive agent handled each subproblem in the current solve() call, so its outcome can reward/demote that agent (§8/§12). */
  private lastDelegations = new Map<string, string>();

  constructor(config?: { maxContextGB?: number }) {
    this.llm = new NeuroclawLLM({});
    this.pipeline = new NeuroPipeline({});
    this.thesaurus = new ThesaurusDictionary();
    this.pluginRegistry = new PluginRegistry();
    this.veto = new AlignmentVeto();
    this.contextCapacityGB = config?.maxContextGB || 200000;
    this.zipIO = new ZipIOSystem(this.contextCapacityGB);
    this.empathy = new EmpathyEngine();
    this.runner = new NeuroclawRunner(this.llm, this.pipeline, this.thesaurus, this.pluginRegistry);
    // Hive Mind (Section 13): each agent's mind is the real neural runner, so
    // multi-agent collaboration runs through the same pipeline as a single query.
    this.hive = new HiveMind({ defaultThink: (prompt) => this.runner.generate(prompt) });
    // Long-term memory (Section 7): a persistent, relevance-retrievable store,
    // complementary to the ZipIO working-context buffer.
    this.memory = new LongTermMemory();
    // Plan tracker (Section 10): structured objective/step record that keeps
    // autonomous execution aligned and prevents repeating completed steps.
    this.plan = new PlanTracker();
    // Self-healer (Section 24): component registry with testable detect →
    // repair → revert-to-known-good → report recovery.
    this.healer = new SelfHealer();
    // Context compressor (Section 7): semantic (not just byte-level) compaction
    // of long conversation context into a salient summary.
    this.compressor = new ContextCompressor();
    // Capability router (Section 6): decides which high-level capability a
    // query activates (recall / summarize / heal / generate).
    this.router = new IntentRouter();

    // AGI / ASI capability layer. These are wired together — the reasoner draws
    // available info from memory, avoids known mistakes, delegates subproblems
    // to the hive, and reads competence from the self-model — so intelligence
    // emerges from their interaction (ASI §12), not from any one in isolation.
    this.monitor = new SelfMonitor();
    this.mistakes = new MistakeTracker();
    this.knowledge = new KnowledgeGraph();
    this.transfer = new KnowledgeTransfer();
    this.selfModel = new SelfModel();
    this.improvement = new SelfImprovement();
    this.reasoner = new ReasoningEngine({
      recall: (q) => this.memory.retrieve(q, { topK: 5 }).map(h => h.item.content),
      lessons: (task) => this.mistakes.lessons(task),
      // ASI §8 requires recursive intelligence to integrate with the existing
      // Hive Mind, not just the single neural runner — each subproblem is
      // delegated to whichever agent (planner/coder/reviewer) best matches its
      // content; the runner is a fallback only when no agent matches at all
      // (delegate() itself still runs each agent's mind through the runner).
      solveSub: async (sub) => {
        this.ensureDefaultTeam();
        const routed = await this.hive.delegate(sub);
        if (routed) {
          this.lastDelegations.set(sub, routed.agent.id);
          // ASI §8/§13: "combine information across the hive" — publish the
          // result to the shared blackboard under the subproblem itself, so a
          // later subproblem (in this or a future solve()) that revisits the
          // same ground can see what another agent already produced, instead
          // of every delegated result vanishing the moment it's returned.
          routed.agent.share(sub, routed.output);
        }
        return routed ? routed.output : this.runner.generate(sub);
      },
      competence: (problem) => this.selfModel.competence(classifyDomain(problem)),
      // ASI §1/§4: don't just report a knowledge gap — actively search the
      // knowledge graph for it before giving up on a missing term, and
      // "combine information from multiple memories" (§4) by following each
      // direct hit's own outward relations one hop further, so a term that
      // only has an indirect connection (e.g. found via a related concept,
      // not a definition mentioning it verbatim) still resolves.
      search: (term) => {
        const hits = this.knowledge.search(term, 2);
        const direct = hits.map(h => h.concept.definition || h.concept.name);
        const combined = hits.flatMap(h => this.knowledge.follow(h.concept.name, [], 1).map(c => c.definition || c.name));
        return Array.from(new Set([...direct, ...combined])).filter(Boolean);
      },
      // ASI §5/§12: bias approach scoring by discovered outcome regularities
      // (refreshed after each solve() — see refreshApproachBias()).
      approachBias: (strategy) => this.approachBiasMap.get(strategy) ?? 1,
      // ASI §11: when search can't resolve a gap, try a creative combination
      // of the still-missing terms instead of only ever reporting the gap.
      combine: (a, b) => this.discovery.combine(a, b),
      // ASI §2 step 6/§10: predict the consequence of each candidate approach
      // through the real PredictionEngine, so a genuinely dangerous approach
      // (not just a task-wide flat penalty) is demoted specifically.
      predictConsequence: (approachAction) => {
        const p = this.predictor.predict(approachAction);
        return { dangerous: p.outcomes.some(o => o.dangerous), likelihood: p.mostLikely.likelihood };
      },
    });
    // Autonomous learning (ASI §3): decides store/update/conflict-preserve/
    // recommend-skill/recommend-extension for new information, on the same
    // knowledge graph the reasoner and solve() read from.
    this.learner = new AutonomousLearner(this.knowledge);
    // Prediction & simulation (ASI §10): predict-before-act / compare-after,
    // wired into processQuery below and feeding SelfMonitor as a learning signal.
    this.predictor = new PredictionEngine();
    // Scientific & creative discovery (ASI §11): hypothesis generation/testing
    // and creative concept combination over the same knowledge graph.
    this.discovery = new DiscoveryEngine(this.knowledge);
  }

  /**
   * Initialize all subsystems
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("Initializing Neuroclaw core subsystems...");
    await this.pluginRegistry.bootstrap();

    // Register a real implementation for every extension in the catalog.
    // Skill-type experts (coding, image, video, game, universal-language)
    // also get a MoE SkillDefinition so they register as experts in the mesh.
    for (const [key, def] of Object.entries(pluginExtensions)) {
      const skillDef: SkillDefinition | undefined =
        def.type === "skill-expert"
          ? {
              id: def.id,
              name: def.name,
              description: `${def.name} MoE expert`,
              expertIndex: this.pluginRegistry.getSkillCount(),
              specialization: def.capabilities[0] ?? def.id,
              selfAuthored: false,
            }
          : undefined;
      try {
        const instance = createPluginInstance(def.name, def, skillDef);
        this.pluginRegistry.register(def, instance);
        if (skillDef) this.pluginRegistry.registerSkill(skillDef, def.id);
      } catch (e) {
        console.warn(`Failed to instantiate extension "${key}":`, e);
      }
    }

    // Wire dependencies
    const callHistoryInstance = (this.pluginRegistry as any).plugins.get("call-history") as CallHistoryPlugin;
    const phoneCallsInstance = (this.pluginRegistry as any).plugins.get("phone-calls") as PhoneCallsPlugin;
    if (callHistoryInstance && phoneCallsInstance) {
      callHistoryInstance.setSource(phoneCallsInstance);
    }

    // Activate all plugins
    console.log("Activating registered extensions & MoE experts...");
    for (const id of Object.keys(pluginExtensions)) {
      try {
        await this.pluginRegistry.activate(id);
      } catch (e) {
        console.warn(`Failed to activate plugin "${id}":`, e);
      }
    }

    // Self-healing (Section 24): register recoverable components with real
    // health checks. The plugin registry can be re-activated if it goes dark;
    // the hive's trust budget invariant is monitored. Capture a known-good
    // baseline for revert-to-known-good.
    this.healer.register({
      name: "plugin-registry",
      check: () => this.pluginRegistry.listActivePlugins().length > 0,
      repair: async () => {
        for (const id of Object.keys(pluginExtensions)) {
          try { await this.pluginRegistry.activate(id); } catch { /* skip individual failures */ }
        }
      },
    });
    this.healer.register({
      name: "hive-trust-invariant",
      check: () => this.hive.list().length === 0 || Math.abs(this.hive.totalTrustValue() - 100) < 1e-3,
    });
    this.healer.snapshotAll();

    this.initialized = true;
    console.log("Neuroclaw subsystems initialized successfully");
  }

  /**
   * Process a user query through the complete pipeline
   */
  async processQuery(input: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    // 1. Read the user's emotional state / intent so downstream decisions
    //    stay aligned (Empathy).
    this.empathy.updateUserContext(input);
    const emotion = this.empathy.analyzeEmotion(input);

    // 2. Store the (compressed) input in the circular ZIP-IO context buffer
    //    (working context) and commit it to long-term memory (Section 7). The
    //    emotional arousal of the message sets its importance, so urgent/
    //    emotionally-charged messages are retained more strongly and evicted
    //    last under capacity pressure.
    await this.zipIO.ingest(input);
    const turnImportance = Math.min(1, 0.4 + Math.max(0, emotion.arousal) * 0.4);
    // Retrieve relevant prior conversation turns *before* recording the current
    // one (so the current message can't match itself). This is the continuous-
    // context step: previous information is carried into the current response.
    const priorHistory = this.memory
      .retrieve(input, { topK: 3, tag: "chat-turn" })
      .filter(h => h.similarity >= 0.1);
    this.memory.remember(`User: ${input}`, { tags: ["chat-turn", "user"], importance: turnImportance });

    // 2b. Section 3's *other* alignment veto: EmpathyEngine.shouldVeto() asks
    // a distinct question from AlignmentVeto below — not "is this action
    // dangerous" but "does my read of this specific user relationship still
    // support trusting my own judgement at all". A confidence proxy derived
    // from the same valence signal already used above keeps this consistent
    // with the rest of the method rather than an unrelated fabricated number.
    // Fails safe: low alignment *and* low confidence withholds the response
    // instead of guessing — but the turn is still recorded above, so context
    // isn't silently dropped even when the response is withheld.
    const empathyConfidence = emotion.valence < 0 ? 0.3 : 0.7;
    if (this.empathy.shouldVeto(0, empathyConfidence)) {
      const blocked = `[Withheld] Alignment with the current conversation (${this.empathy.getAlignmentScore().toFixed(2)}) is too low to confidently proceed.`;
      return this.respondDirect(blocked, turnImportance);
    }

    // 3. ASI §10: simulate the likely consequences of responding *before*
    //    gating the action, so a genuinely dangerous request (not a fixed
    //    "reversible: true" regardless of content) actually reaches the
    //    AlignmentVeto's irreversible/external-effect confirmation rule.
    const prediction = this.predictor.predict(`respond to: ${input}`);
    const predictedDanger = prediction.outcomes.some(o => o.dangerous);

    // 4. Gate the "respond" action through the AlignmentVeto before running.
    //    A negative-valence user under high arousal lowers our confidence,
    //    surfacing as self-model surprise the veto can escalate on.
    const decision = this.veto.evaluate(
      {
        id: `respond:${Date.now()}`,
        name: "respond to user",
        capabilities: ["text-generate"],
        reversible: !predictedDanger,
        externalEffect: predictedDanger,
      },
      { selfModelSurprise: emotion.valence < 0 ? emotion.arousal * 0.5 : 0 }
    );
    if (!decision.allowed) {
      const blocked = `[Withheld] ${decision.reasons.join("; ")}`;
      await this.zipIO.emit(blocked);
      return blocked;
    }

    // 5. Route the query to a high-level capability (Section 6): a summarize,
    //    recall or self-heal request is served directly by the matching
    //    subsystem instead of full neural generation. Anything else — and any
    //    routed capability that has nothing to act on — falls through to
    //    generation.
    const route = this.router.route(input);
    if (route.capability === "summarize") {
      const summary = this.compressContext(600);
      if (summary) return this.respondDirect(`Summary of our conversation:\n${summary}`, turnImportance);
    }
    if (route.capability === "heal") {
      const report = await this.selfHeal();
      const issues = report.unrecoverable.length ? `; unresolved: ${report.unrecoverable.join(", ")}` : "";
      return this.respondDirect(`System health: ${report.healthy}/${report.checked} components healthy, ${report.repaired} repaired, ${report.restored} restored${issues}.`, turnImportance);
    }
    if (route.capability === "recall" && priorHistory.length > 0) {
      const recalled = priorHistory.map(h => `• ${h.item.content}`).join("\n");
      return this.respondDirect(`From our earlier conversation, here's what's relevant:\n${recalled}`, turnImportance);
    }

    // 6. Run the query through the real neural runner (THORNS intent →
    //    plugin/skill dispatch → mesh + hyperdimensional + MoE generation),
    //    grounded in any relevant prior conversation turns so the response
    //    integrates previous context instead of treating the prompt as an
    //    isolated event (continuous context, Section 7).
    try {
      let result = await this.runner.generate(input, priorHistory.map(h => h.item.content));
      // EmpathyEngine.adjustDecision() was built and tested but never called:
      // when alignment supports genuine autonomous judgement, adapt tone to
      // the user's actual emotional state (supportive/enthusiastic/direct);
      // when it doesn't (below canMakeAutonomousDecision()'s threshold, but
      // not low enough to trip shouldVeto() above), flag the uncertainty
      // honestly instead of answering as confidently as always.
      result = this.empathy.adjustDecision(result, input);
      if (decision.requiresConfirmation) {
        result = `${result}\n  [Confirm before acting: ${decision.reasons.join("; ")}]`;
      }

      // ASI §10: compare the predicted outcome with the actual one; the
      // divergence ("surprise") is a learning signal fed to the system-level
      // self-monitor, connecting prediction to the existing self-awareness /
      // live-correction loop rather than leaving it a standalone forecast.
      const comparison = this.predictor.observe(prediction.id, result);
      // No explicit `expected` here: the monitor should learn this query's
      // typical surprise level and flag a genuine spike above *that* norm, not
      // compare against a fixed zero (which would make ordinary token-overlap
      // noise register as a failure on every single call).
      if (comparison) this.monitor.observe("prediction.surprise", comparison.surprise);

      // 7. Store the (compressed) output in the ZIP-IO output loop, and commit
      //    the assistant turn to long-term memory so the whole exchange becomes
      //    retrievable chat history (Section 7).
      await this.zipIO.emit(result);
      this.memory.remember(`AI: ${result}`, { tags: ["chat-turn", "assistant"], importance: turnImportance });
      return result;
    } catch (error) {
      console.error("Error processing query:", error);
      throw error;
    }
  }

  /**
   * ASI §3: ingest new information. Determines reliability, checks for a
   * conflict with existing knowledge (preserving both rather than overwriting
   * when one is found), and decides whether to store it, update an existing
   * concept, or — for a recurring procedural capability — recommend creating a
   * skill or extension, in which case the real skill/plugin-maker machinery is
   * invoked (the same "creation" path a user request would trigger) rather
   * than a parallel mechanism.
   */
  async learn(information: string, opts?: import("./models && skills/core/autonomous-learner.js").LearnOptions) {
    if (!this.initialized) await this.initialize();
    const result = this.learner.learn(information, opts);
    if (result.decision === "recommend-skill" || result.decision === "recommend-extension") {
      const created = await this.pluginRegistry.dispatch(information, "creation");
      return { ...result, created: created ?? undefined };
    }
    return result;
  }

  /** Emit + record a direct (non-generated) assistant response and return it. */
  private async respondDirect(response: string, importance: number): Promise<string> {
    await this.zipIO.emit(response);
    this.memory.remember(`AI: ${response}`, { tags: ["chat-turn", "assistant"], importance });
    return response;
  }

  /**
   * Sections 13-14: spin up (once) a small specialized team and let it
   * collaborate on a task through a chat group. Each agent's mind is the real
   * neural runner, so this is genuine multi-agent processing, not a mock. The
   * team discusses the task, then reaches a trust-weighted group decision, and
   * the hive synchronizes any shared-memory conflicts before returning.
   */
  async collaborate(task: string): Promise<{ discussion: string[]; decision: string; complete: boolean }> {
    if (!this.initialized) await this.initialize();
    this.ensureDefaultTeam();
    if (!this.chatGroup) {
      this.chatGroup = new ChatGroup("default", "Default Team", this.hive);
      for (const a of this.hive.list()) this.chatGroup.addMember(a.id);
    }
    const msgs = await this.chatGroup.discuss(task);
    const decision = await this.chatGroup.decide(`How should we handle: ${task}`, ["proceed", "revise", "reject"]);
    this.hive.synchronize();
    // ASI §8: "monitor progress... re-evaluate the complete solution" needs a
    // real completion marker, not just a returned value nobody records. The
    // group's own `complete()`/`isComplete()`/`getResult()` existed but were
    // never called — a decision was reached but the group never recorded
    // itself as done, so a later caller checking `isComplete()` would always
    // see false regardless of what actually happened.
    this.chatGroup.complete(decision.decision);
    return { discussion: msgs.map(m => `${m.from}: ${m.content}`), decision: decision.decision, complete: this.chatGroup.isComplete() };
  }

  /** The default chat group's recorded outcome, once `collaborate()` has completed it. */
  collaborationResult(): string | null {
    return this.chatGroup?.getResult() ?? null;
  }

  /**
   * Section 10: run a multi-step plan toward an objective. Each pending step is
   * executed through the real neural runner; steps that were already completed
   * (same description, e.g. from an earlier call) are skipped rather than
   * repeated. Returns per-step results and whether the plan is complete.
   */
  async executePlan(objective: string, steps: string[]): Promise<{
    objective: string;
    results: Array<{ step: string; status: "completed" | "failed" | "skipped"; result: string }>;
    complete: boolean;
  }> {
    if (!this.initialized) await this.initialize();
    this.plan.setObjective(objective);
    const results: Array<{ step: string; status: "completed" | "failed" | "skipped"; result: string }> = [];
    for (const desc of steps) {
      if (!this.plan.shouldPerform(desc)) {
        results.push({ step: desc, status: "skipped", result: "already completed" });
        continue;
      }
      const step = this.plan.addStep(desc);
      this.plan.start(step.id);
      try {
        const out = await this.runner.generate(desc);
        this.plan.complete(step.id, out);
        results.push({ step: desc, status: "completed", result: out });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.plan.fail(step.id, reason);
        results.push({ step: desc, status: "failed", result: reason });
      }
    }
    return { objective, results, complete: this.plan.isComplete() };
  }

  /**
   * Integrated autonomous execution (§27.17 — the subsystems working together).
   * Combines the PlanTracker (§10, no-repeat), the Hive Mind (§13-14, each step
   * delegated to the best-matching agent whose mind is the real neural runner),
   * long-term memory (§7, results recorded), and self-healing (§24, run if a
   * step fails). One objective → a plan → multi-agent execution → memory →
   * recovery, rather than a collection of unrelated methods.
   */
  async autonomousTask(objective: string, steps: string[]): Promise<{
    objective: string;
    results: Array<{ step: string; agent: string; status: "completed" | "failed" | "skipped"; result: string }>;
    complete: boolean;
    healed: boolean | null;
  }> {
    if (!this.initialized) await this.initialize();
    this.ensureDefaultTeam();
    this.plan.setObjective(objective);
    // ASI §10 / Section 10: a plan also records constraints and decisions, not
    // just steps. This is a real, always-true operating constraint (the
    // project's own build directive), not a fabricated one.
    this.plan.addConstraint("no external APIs — all execution stays local");
    const results: Array<{ step: string; agent: string; status: "completed" | "failed" | "skipped"; result: string }> = [];
    for (const desc of steps) {
      if (!this.plan.shouldPerform(desc)) {
        results.push({ step: desc, agent: "-", status: "skipped", result: "already completed" });
        continue;
      }
      const step = this.plan.addStep(desc);
      this.plan.start(step.id);
      const routed = await this.hive.delegate(desc);
      if (routed) {
        this.plan.complete(step.id, routed.output);
        // Record the real delegation decision: which agent was chosen and why.
        this.plan.addDecision(`"${desc}" -> delegated to ${routed.agent.role} (${routed.agent.id}, trust ${routed.agent.trust.toFixed(1)})`);
        this.memory.remember(`Task step: ${desc} -> ${routed.output}`, { tags: ["task"], importance: 0.6 });
        results.push({ step: desc, agent: routed.agent.id, status: "completed", result: routed.output });
      } else {
        this.plan.fail(step.id, "no agent available");
        // Record the alternative that was considered: expanding the team
        // would let a future retry succeed where this attempt could not.
        this.plan.addAlternative(step.id, "spawn or register an agent whose role/capabilities match this step, then retry");
        results.push({ step: desc, agent: "-", status: "failed", result: "no agent available" });
      }
    }
    // If the plan didn't fully succeed, attempt recovery.
    let healed: boolean | null = null;
    if (!this.plan.isAchieved()) {
      const report = await this.selfHeal();
      healed = report.unrecoverable.length === 0;
    }
    return { objective, results, complete: this.plan.isComplete(), healed };
  }

  /**
   * ASI §12 — the integrated intelligence loop. Solve a problem with reasoning
   * (§2/§8) that uses long-term memory for available information (§4), avoids
   * known mistakes (§6), delegates subproblems to the hive (§8), and reads
   * competence from the self-model (§9); pulls cross-domain method hints via
   * knowledge transfer (§7); calibrates its confidence honestly (§9); then
   * records the outcome back into the self-model, mistake tracker, knowledge
   * graph and long-term memory so memory improves reasoning, reasoning improves
   * learning, and the self-model tracks where the system needs to improve.
   */
  async solve(problem: string, opts?: { depth?: number }): Promise<{
    result: string;
    confidence: number;
    verified: boolean;
    domain: string;
    approach: string;
    transfers: string[];
    subresults: number;
    contradictions: string[];
  }> {
    if (!this.initialized) await this.initialize();
    // Track which hive agent (if any) handles each subproblem in *this*
    // solve() call only, so the outcome below can reward/demote the right
    // agent rather than one from a stale prior call.
    this.lastDelegations.clear();
    const domain = classifyDomain(problem);
    // ASI §7: structurally-similar past problems from other domains + their method.
    const transferHits = this.transfer.transfer(problem, { domain });
    const transfers = transferHits.map(t => `${t.source.domain}: ${t.source.method}`);
    // ASI §1/§2/§8: reason (memory + mistakes + hive + self-model via injected
    // deps). The strongest cross-domain transfer is offered as a real,
    // choosable approach (not just the `transfers` metadata above), so the
    // reasoner can genuinely combine knowledge from another field into the
    // solution instead of only ever using a single specialized approach.
    const r = await this.reasoner.reason(problem, {
      depth: opts?.depth ?? 1,
      transferHint: transferHits[0]
        ? { domain: transferHits[0].source.domain, method: transferHits[0].source.method, similarity: transferHits[0].similarity }
        : undefined,
    });
    // ASI §8/§12: "assign subproblems to specialized systems... re-evaluate
    // the complete solution" implies feeding the outcome back to whoever did
    // the work, not just to the reasoning approach as a whole. HiveMind.reward()
    // existed and was unit-tested but was never called from live delegation —
    // an agent whose subproblem resolved cleanly is rewarded (more trust, so
    // future delegation prefers it under a tie), one whose subproblem failed
    // is demoted, using the same zero-sum trust mechanism promotion already
    // uses elsewhere in the hive.
    for (const s of r.subresults) {
      const agentId = this.lastDelegations.get(s.subproblem);
      if (!agentId) continue;
      const failed = /\[(error|unsolved|base):/i.test(s.result);
      this.hive.reward(agentId, failed ? -3 : 3);
    }
    // Resolve any blackboard conflicts from the sharing above (e.g. two
    // different solve() calls delegating the same subproblem text to
    // different agents with different results) the same way collaborate()
    // already does — trust-weighted, not left permanently unresolved.
    if (this.lastDelegations.size > 0) this.hive.synchronize();
    // ASI §9: never claim more certainty than the track record supports.
    let confidence = this.selfModel.calibrate(r.confidence, domain);
    // ASI §3/§5/§6/§9: learn from the outcome.
    this.selfModel.record(domain, r.verified);
    if (!r.verified) {
      const unresolved = r.subresults.filter(s => /\[(error|unsolved|base):/i.test(s.result)).length;
      this.mistakes.record({
        task: problem,
        description: `Reasoning left ${unresolved} subproblem(s) unresolved`,
        cause: r.available.length === 0 ? "missing-knowledge" : "reasoning",
        failedStep: r.chosen,
        prevention: `Gather information before choosing "${r.chosen}" for: ${r.objective}`,
      });
    } else {
      // A verified solution is a reusable method (§7) and semantic knowledge (§4).
      this.transfer.register(problem, domain, r.chosen);
      this.knowledge.integrate(r.objective, problem);
      // ASI §6: this exact task has now succeeded — any prior recorded failure
      // for it is resolved, not left counting toward repeated() forever (which
      // would otherwise keep demoting an approach that has since improved).
      const normalizedProblem = normalizeText(problem);
      for (const m of this.mistakes.all()) {
        if (!m.resolved && normalizeText(m.task) === normalizedProblem) this.mistakes.resolve(m.id);
      }
    }
    // ASI §4: "identify contradictions" — surface (not silently ignore) any
    // known contradiction touching this problem's central concept, so a
    // confident-looking answer doesn't hide that the knowledge graph holds
    // two things it flatly disagrees about on the same topic.
    const objectiveKey = normalizeText(r.objective);
    const contradictions = this.knowledge
      .findContradictions()
      .filter(c => normalizeText(c.a.from) === objectiveKey || normalizeText(c.a.to) === objectiveKey)
      .map(c => `"${c.a.from} ${c.a.type} ${c.a.to}" vs "${c.b.from} ${c.b.type} ${c.b.to}"`);
    // A known, unresolved contradiction on the topic at hand is itself
    // evidence the system shouldn't be fully confident — a deserved
    // reduction, not an arbitrary penalty.
    if (contradictions.length > 0) confidence = Math.max(0, confidence - 0.15);
    // ASI §5: "which memories are unreliable" — reinforce or demote the
    // specific long-term memories that grounded this reasoning pass (r.available),
    // based on whether the outcome actually verified. A memory that repeatedly
    // grounds failed reasoning becomes less trusted (lower importance, more
    // likely to be evicted under capacity pressure); one behind a verified
    // solution is reinforced — real consequences, not just a log entry.
    for (const content of r.available) {
      const grounding = this.memory.all().find(m => m.content === content);
      if (grounding) this.memory.reinforce(grounding.id, r.verified ? 0.05 : -0.1);
    }
    this.memory.remember(`Solved [${domain}]: ${problem} -> ${r.result.slice(0, 200)}`, { tags: ["solution", domain], importance: 0.7 });
    // ASI §11: test every currently-active hypothesis against this fresh
    // observation *before* folding it into the raw log — "design tests,
    // analyze results, reject failed explanations" made real: a hypothesis
    // that stops holding gets rejected (activeHypotheses() then excludes it),
    // rather than every regularity being generated once and trusted forever.
    const observation = `${domain} ${r.chosen} ${r.verified ? "verified" : "unverified"}`;
    for (const h of this.discovery.activeHypotheses()) {
      this.discovery.test(h.id, observation);
    }
    // ASI §5/§11: feed this solve's (domain, approach, outcome) into the
    // discovery engine as an observation. Across many solves this lets the
    // system discover real regularities — e.g. "domain X tends toward
    // verified outcomes with approach Y" — a scientific-method analysis of its
    // own reasoning performance, not a separate hard-coded self-improvement
    // rule. See discoverPatterns().
    this.discovery.observe(observation);
    // ASI §5/§12: turn the discovery into actual behavior change — bias future
    // approach selection by what has been found to correlate with verified vs
    // unverified outcomes, closing the loop instead of leaving it an inert log.
    await this.refreshApproachBias();
    // ASI §9/§10: track the confidence signal for self-monitoring. A
    // failure-level anomaly (real divergence from the adaptive baseline, not
    // ordinary noise) is the signal self-monitor.ts documents as the trigger
    // for self-healing (§24) — so a genuinely destabilized solve loop attempts
    // real recovery rather than just being logged.
    this.monitor.observe("solve.confidence", confidence);
    if (this.monitor.hasFailure()) {
      await this.selfHeal();
    }
    return { result: r.result, confidence, verified: r.verified, domain, approach: r.chosen, transfers, subresults: r.subresults.length, contradictions };
  }

  /**
   * ASI §5/§11: surface regularities the discovery engine has found across
   * past solve() calls — e.g. that a particular domain/approach combination
   * tends toward verified or unverified outcomes. This is real self-analysis
   * of reasoning performance built from accumulated operational history, the
   * mechanism §5 asks for ("analyze which reasoning processes are
   * inefficient") applied via the scientific-method hypothesis engine (§11)
   * rather than a bespoke rule set.
   */
  discoverPatterns(topK = 5) {
    return this.discovery.generateHypotheses(topK);
  }

  /** ASI §4: "identify contradictions" — every unresolved contradiction currently known. */
  findContradictions() {
    return this.knowledge.findContradictions();
  }

  /** ASI §4: "combine information from multiple memories" — follow a concept's relations outward and return what's reachable. */
  combineKnowledge(concept: string, depth = 2): string[] {
    return this.knowledge.follow(concept, [], depth).map(c => c.definition || c.name);
  }

  /**
   * ASI §5: "propose improvements" has to start from an actual weak-point
   * analysis, not a guess — `SelfModel.gaps()` (low-competence domains with
   * enough evidence to trust) and `MistakeTracker.causeBreakdown()` (which
   * root cause dominates failures) were both built and tested but never once
   * consulted together to say where the system should focus. This surfaces
   * that combined picture as a single, real, callable report: the domains
   * with demonstrated weak performance, and the failure cause responsible for
   * the most recorded mistakes — the two concrete inputs §5 asks
   * self-improvement to analyze before proposing anything.
   */
  improvementTargets(): { weakDomains: string[]; dominantCause: string; causeBreakdown: Record<string, number> } {
    const breakdown = this.mistakes.causeBreakdown();
    const dominantCause = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    return { weakDomains: this.selfModel.gaps(), dominantCause, causeBreakdown: breakdown };
  }

  /**
   * ASI §9: the self-model should answer both halves of "what it knows" —
   * `gaps()` (above, via `improvementTargets()`) covers demonstrated
   * weaknesses, but `SelfModel.knows()` — the positive counterpart, domains
   * with enough evidence *and* a track record above threshold — was built
   * and unit-tested in isolation only, never called from live code. Distinct
   * from confidence *calibration* (which only shades a single query's
   * number): this is a real inventory, "which domains has the system
   * actually demonstrated competence in", callable on its own.
   */
  knownDomains(): string[] {
    return this.selfModel.summary()
      .map(s => s.domain)
      .filter(domain => this.selfModel.knows(domain));
  }

  /**
   * ASI §5: every proposed change `refreshApproachBias()` tested, kept or
   * discarded — `SelfImprovement.kept()`/`history()` existed and were
   * unit-tested but never surfaced, so there was no way to see which
   * correlations actually passed the chance-level test versus which were
   * discarded as noise.
   */
  improvementHistory(): { kept: number; discarded: number; recent: ReturnType<SelfImprovement["history"]> } {
    const history = this.improvement.history();
    const kept = this.improvement.kept().length;
    return { kept, discarded: history.length - kept, recent: history.slice(-10) };
  }

  /**
   * Lazily spawn the default planner/coder/reviewer team the first time any
   * hive-based capability is used (collaborate, autonomousTask, or solve()'s
   * subproblem delegation), so they all share one team and trust budget
   * instead of each maintaining its own copy of this bootstrap logic.
   */
  private ensureDefaultTeam(): void {
    if (this.hive.list().length > 0) return;
    this.hive.spawn({ id: "planner", role: "planner", specialization: "planning", capabilities: ["planning"] });
    this.hive.spawn({ id: "coder", role: "coder", specialization: "coding", capabilities: ["coding"] });
    this.hive.spawn({ id: "reviewer", role: "reviewer", specialization: "review", capabilities: ["self-heal"] });
  }

  /**
   * ASI §5/§12: recompute the approach-selection bias from the discovery
   * engine's current hypotheses. A strategy correlated with "verified" gets a
   * boost, one correlated with "unverified" gets demoted, bounded to keep any
   * single regularity from dominating reasoning entirely.
   *
   * §5 also asks that a proposed change be "tested... compared against the
   * previous version, and kept only if it produces a measurable benefit" —
   * `SelfImprovement.evaluate()` existed and was unit-tested but was never
   * actually called anywhere, so every correlation got applied unconditionally
   * no matter how weak or contradiction-eroded. Each candidate bias change is
   * now gated through a real `evaluate()` call: the hypothesis's confidence
   * (candidate) against chance-level 0.5 (baseline, "the previous, unadjusted
   * version") — a correlation no better than a coin flip is discarded rather
   * than perturbing reasoning on noise.
   *
   * The resulting bias map is also versioned via `SelfImprovement.snapshot()`
   * (below) — "maintain versioned copies... so failed changes can be
   * identified and reversed" — so `rollbackApproachBias()` can undo the most
   * recent refresh if later evidence shows it was a regression. This is
   * honest about what it is: a single solve's outcome can't rigorously prove
   * a bias change was good or bad on its own (the bias only affects *future*
   * reasoning), so this versions the change rather than claiming to
   * auto-validate the map as a whole.
   */
  private async refreshApproachBias(): Promise<void> {
    const knownStrategies = ["decompose", "analogy", "first-principles", "transfer"];
    for (const h of this.discovery.generateHypotheses(10)) {
      let strategy: string | undefined;
      let outcome: string | undefined;
      if (knownStrategies.includes(h.cause)) { strategy = h.cause; outcome = h.effect; }
      else if (knownStrategies.includes(h.effect)) { strategy = h.effect; outcome = h.cause; }
      if (!strategy || (outcome !== "verified" && outcome !== "unverified")) continue;
      const tested = await this.improvement.evaluate(
        `approachBias:${strategy}`,
        `${strategy} correlates with ${outcome} at confidence ${h.confidence.toFixed(2)}`,
        () => 0.5,
        () => h.confidence,
      );
      if (!tested.kept) continue;
      const bias = outcome === "verified" ? 1 + h.confidence * 0.3 : 1 - h.confidence * 0.3;
      this.approachBiasMap.set(strategy, Math.max(0.4, Math.min(1.6, bias)));
    }
    // ASI §6: "repeated failures should cause the relevant reasoning method to
    // be evaluated and improved" — a repeated mistake is direct evidence
    // against the approach that was tried and failed, not a soft correlation,
    // so it demotes (never boosts) that approach independently of discovery.
    for (const m of this.mistakes.repeated(2)) {
      if (m.failedStep && knownStrategies.includes(m.failedStep)) {
        const current = this.approachBiasMap.get(m.failedStep) ?? 1;
        this.approachBiasMap.set(m.failedStep, Math.max(0.4, Math.min(current, 0.7)));
      }
    }
    // Version the resulting state (after the change, matching SelfImprovement's
    // "each snapshot is a committed version" model — rollback() discards the
    // latest and returns the one before it).
    this.improvement.snapshot("approachBias", Object.fromEntries(this.approachBiasMap));
  }

  /**
   * ASI §5: revert the approach-selection bias to its previous version — the
   * "failed changes can be identified and reversed" guarantee, made concrete
   * and callable rather than aspirational.
   */
  rollbackApproachBias(): boolean {
    if (this.improvement.versionCount("approachBias") < 2) return false;
    const previous = this.improvement.rollback("approachBias") as Record<string, number> | undefined;
    if (!previous) return false;
    this.approachBiasMap = new Map(Object.entries(previous));
    return true;
  }

  /** ASI §9/§11: current self-monitor anomalies and whether recovery is warranted. */
  selfIntegrity(): { anomalies: ReturnType<SelfMonitor["anomalies"]>; hasFailure: boolean } {
    return { anomalies: this.monitor.anomalies(), hasFailure: this.monitor.hasFailure() };
  }

  /**
   * ASI §9: "what it knows" includes its own repair history, not just current
   * anomalies — `SelfHealer.getLog()` existed and was unit-tested but was
   * never surfaced anywhere a caller could actually inspect it without
   * triggering a *new* heal cycle first (§24's own "every heal step is
   * logged, never silent" guarantee needs a way to read that log later).
   */
  healLog(): string[] {
    return this.healer.getLog();
  }

  /**
   * Section 24: run the self-healer — detect unhealthy components and attempt
   * repair / revert-to-known-good, reporting anything unrecoverable.
   */
  async selfHeal() {
    if (!this.initialized) await this.initialize();
    return this.healer.heal();
  }

  /** Section 24: current health of every registered component (no repairs). */
  async healthReport() {
    if (!this.initialized) await this.initialize();
    return this.healer.healthReport();
  }

  /**
   * Section 7: retrieve relevant long-term memories for a query, ranked by
   * semantic similarity and modulated by importance/recency. Retrieval
   * reinforces what it returns.
   */
  recall(query: string, topK = 5): string[] {
    return this.memory.retrieve(query, { topK }).map(h => h.item.content);
  }

  /**
   * Section 7: retrieve the most relevant past conversation turns for a query
   * — long-term memory retrieval scoped to chat history. Every user/assistant
   * turn is committed as a "chat-turn" memory in processQuery, so this surfaces
   * earlier exchanges by relevance rather than only the most recent ones.
   */
  recallHistory(query: string, topK = 5): string[] {
    return this.memory.retrieve(query, { topK, tag: "chat-turn" }).map(h => h.item.content);
  }

  /**
   * Section 7: compress the recent conversation into a compact, salient
   * summary (semantic compression, distinct from ZipIO's byte-level gzip).
   * Optionally store the summary back as a "compressed" memory so a long
   * history can be represented cheaply.
   */
  compressContext(maxChars = 600, store = false): string {
    // Compress the user's turns — they carry the actual information; the
    // assistant's templated replies are derived and would only add noise.
    const turns = this.memory
      .all()
      .filter(m => m.tags.includes("chat-turn") && m.tags.includes("user"))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(m => m.content);
    const { summary } = this.compressor.compress(turns, { maxChars });
    if (store && summary) {
      this.memory.remember(summary, { tags: ["compressed"], importance: 0.6 });
    }
    return summary;
  }

  /** The recent conversation turns in chronological order (working transcript). */
  chatHistory(limit = 20): string[] {
    return this.memory
      .all()
      .filter(m => m.tags.includes("chat-turn"))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit)
      .map(m => m.content);
  }

  /**
   * ASI §4: "maintain continuity over extremely long periods of time" — every
   * `NeuroclawSystem` instance starts with empty long-term memory and nothing
   * ever persisted it, despite `LongTermMemory.serialize()`/`deserialize()`
   * existing and being fully unit-tested (a round-trip that works, but that
   * nothing in the live system ever reached for). This is the missing local
   * disk I/O that makes that round-trip actually useful across restarts —
   * consistent with the project's "no external APIs, all execution stays
   * local" constraint and the same `fs/promises` pattern `InfiniteZipLoop`
   * already uses for its own disk spill.
   */
  async saveMemory(path: string): Promise<void> {
    await writeFile(path, this.memory.serialize(), "utf-8");
  }

  /** Replace the current long-term memory with a previously saved snapshot. */
  async loadMemory(path: string): Promise<void> {
    const json = await readFile(path, "utf-8");
    this.memory = LongTermMemory.deserialize(json);
  }

  /**
   * Get system status
   */
  getStatus(): {
    initialized: boolean;
    activePlugins: number;
    contextCapacity: string;
    alignment: number;
    hiveAgents: number;
    memories: number;
    transferredMethods: number;
    trackedPredictions: number;
  } {
    return {
      initialized: this.initialized,
      activePlugins: this.pluginRegistry.listActivePlugins().length,
      contextCapacity: `${this.contextCapacityGB}GB available`,
      alignment: this.empathy.getAlignmentScore(),
      hiveAgents: this.hive.list().length,
      memories: this.memory.size(),
      // ASI §7/§10: KnowledgeTransfer.size() and PredictionEngine.size() were
      // built and unit-tested but never surfaced anywhere — real counts of
      // how much cross-domain method transfer and outcome-prediction history
      // has actually accumulated, not just that the subsystems exist.
      transferredMethods: this.transfer.size(),
      trackedPredictions: this.predictor.size(),
    };
  }
}

/** Coarse domain label for a problem — used by the self-model and knowledge transfer. */
function classifyDomain(text: string): string {
  const t = (text || "").toLowerCase();
  const has = (words: string[]) => words.some(w => t.includes(w));
  if (has(["code", "coding", "program", "function", "bug", "compile", "api", "algorithm"])) return "coding";
  if (has(["math", "equation", "number", "calculate", "compute", "proof", "geometry", "algebra"])) return "math";
  if (has(["science", "physics", "chemistry", "biology", "experiment", "hypothesis", "energy"])) return "science";
  if (has(["plan", "schedule", "steps", "roadmap", "organize", "strategy"])) return "planning";
  if (has(["design", "engineer", "build", "system", "architecture", "circuit"])) return "engineering";
  if (has(["write", "essay", "story", "language", "translate", "grammar", "poem"])) return "language";
  return "general";
}

/** Case/whitespace-insensitive text key, matching the normalization used across the core modules. */
function normalizeText(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Singleton instance for module-level access
let system: NeuroclawSystem | null = null;

/**
 * Get or create the Neuroclaw system singleton
 */
export async function getNeuroclawSystem(): Promise<NeuroclawSystem> {
  if (!system) {
    system = new NeuroclawSystem();
    await system.initialize();
  }
  return system;
}

/**
 * Main entry point
 */
async function main() {
  const system = await getNeuroclawSystem();

  const mode = process.argv[2];
  if (mode === "web") {
    const port = parseInt(process.argv[3] || "3000", 10);
    console.log(`Starting TS backend web server on port ${port}...`);
    const webServer = new WebServer(system.runner);
    await webServer.start(port);
    console.log(`Neuroclaw TS backend online at http://localhost:${port}`);
  } else if (mode === "cli") {
    console.log("Launching interactive Neuroclaw command-line interface...");
    const cli = new CLI(system.llm, system.pipeline, system.thesaurus, system.pluginRegistry);
    await cli.startInteractive();
  } else {
    // Default mode: start on port 3000
    const port = 3000;
    console.log(`No mode specified. Starting default web server on port ${port}...`);
    const webServer = new WebServer(system.runner);
    await webServer.start(port);
    console.log(`Neuroclaw operational at http://localhost:${port}`);
  }
}

/** True when this module is the process entry point (not merely imported). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main().catch((err) => {
  console.error("Fatal startup error in Neuroclaw launcher:", err);
  process.exit(1);
});
