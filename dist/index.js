import { realpathSync } from "node:fs";
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
import { createPluginInstance, pluginExtensions } from "./plugins/index.js";
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
    constructor(config) {
        this.initialized = false;
        this.chatGroup = null;
        /** Bias per reasoning strategy derived from discovered outcome regularities (§5/§12). */
        this.approachBiasMap = new Map();
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
            solveSub: (sub) => this.runner.generate(sub),
            competence: (problem) => this.selfModel.competence(classifyDomain(problem)),
            // ASI §1: don't just report a knowledge gap — actively search the
            // knowledge graph for it before giving up on a missing term.
            search: (term) => this.knowledge.search(term, 2).map(h => h.concept.definition || h.concept.name),
            // ASI §5/§12: bias approach scoring by discovered outcome regularities
            // (refreshed after each solve() — see refreshApproachBias()).
            approachBias: (strategy) => this.approachBiasMap.get(strategy) ?? 1,
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
    async initialize() {
        if (this.initialized)
            return;
        console.log("Initializing Neuroclaw core subsystems...");
        await this.pluginRegistry.bootstrap();
        // Register a real implementation for every extension in the catalog.
        // Skill-type experts (coding, image, video, game, universal-language)
        // also get a MoE SkillDefinition so they register as experts in the mesh.
        for (const [key, def] of Object.entries(pluginExtensions)) {
            const skillDef = def.type === "skill-expert"
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
                if (skillDef)
                    this.pluginRegistry.registerSkill(skillDef, def.id);
            }
            catch (e) {
                console.warn(`Failed to instantiate extension "${key}":`, e);
            }
        }
        // Wire dependencies
        const callHistoryInstance = this.pluginRegistry.plugins.get("call-history");
        const phoneCallsInstance = this.pluginRegistry.plugins.get("phone-calls");
        if (callHistoryInstance && phoneCallsInstance) {
            callHistoryInstance.setSource(phoneCallsInstance);
        }
        // Activate all plugins
        console.log("Activating registered extensions & MoE experts...");
        for (const id of Object.keys(pluginExtensions)) {
            try {
                await this.pluginRegistry.activate(id);
            }
            catch (e) {
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
                    try {
                        await this.pluginRegistry.activate(id);
                    }
                    catch { /* skip individual failures */ }
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
    async processQuery(input) {
        if (!this.initialized)
            await this.initialize();
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
        // 3. ASI §10: simulate the likely consequences of responding *before*
        //    gating the action, so a genuinely dangerous request (not a fixed
        //    "reversible: true" regardless of content) actually reaches the
        //    AlignmentVeto's irreversible/external-effect confirmation rule.
        const prediction = this.predictor.predict(`respond to: ${input}`);
        const predictedDanger = prediction.outcomes.some(o => o.dangerous);
        // 4. Gate the "respond" action through the AlignmentVeto before running.
        //    A negative-valence user under high arousal lowers our confidence,
        //    surfacing as self-model surprise the veto can escalate on.
        const decision = this.veto.evaluate({
            id: `respond:${Date.now()}`,
            name: "respond to user",
            capabilities: ["text-generate"],
            reversible: !predictedDanger,
            externalEffect: predictedDanger,
        }, { selfModelSurprise: emotion.valence < 0 ? emotion.arousal * 0.5 : 0 });
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
            if (summary)
                return this.respondDirect(`Summary of our conversation:\n${summary}`, turnImportance);
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
            if (comparison)
                this.monitor.observe("prediction.surprise", comparison.surprise);
            // 7. Store the (compressed) output in the ZIP-IO output loop, and commit
            //    the assistant turn to long-term memory so the whole exchange becomes
            //    retrievable chat history (Section 7).
            await this.zipIO.emit(result);
            this.memory.remember(`AI: ${result}`, { tags: ["chat-turn", "assistant"], importance: turnImportance });
            return result;
        }
        catch (error) {
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
    async learn(information, opts) {
        if (!this.initialized)
            await this.initialize();
        const result = this.learner.learn(information, opts);
        if (result.decision === "recommend-skill" || result.decision === "recommend-extension") {
            const created = await this.pluginRegistry.dispatch(information, "creation");
            return { ...result, created: created ?? undefined };
        }
        return result;
    }
    /** Emit + record a direct (non-generated) assistant response and return it. */
    async respondDirect(response, importance) {
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
    async collaborate(task) {
        if (!this.initialized)
            await this.initialize();
        if (this.hive.list().length === 0) {
            this.hive.spawn({ id: "planner", role: "planner", specialization: "planning", capabilities: ["planning"] });
            this.hive.spawn({ id: "coder", role: "coder", specialization: "coding", capabilities: ["coding"] });
            this.hive.spawn({ id: "reviewer", role: "reviewer", specialization: "review", capabilities: ["self-heal"] });
        }
        if (!this.chatGroup) {
            this.chatGroup = new ChatGroup("default", "Default Team", this.hive);
            for (const a of this.hive.list())
                this.chatGroup.addMember(a.id);
        }
        const msgs = await this.chatGroup.discuss(task);
        const decision = await this.chatGroup.decide(`How should we handle: ${task}`, ["proceed", "revise", "reject"]);
        this.hive.synchronize();
        return { discussion: msgs.map(m => `${m.from}: ${m.content}`), decision: decision.decision };
    }
    /**
     * Section 10: run a multi-step plan toward an objective. Each pending step is
     * executed through the real neural runner; steps that were already completed
     * (same description, e.g. from an earlier call) are skipped rather than
     * repeated. Returns per-step results and whether the plan is complete.
     */
    async executePlan(objective, steps) {
        if (!this.initialized)
            await this.initialize();
        this.plan.setObjective(objective);
        const results = [];
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
            }
            catch (e) {
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
    async autonomousTask(objective, steps) {
        if (!this.initialized)
            await this.initialize();
        if (this.hive.list().length === 0) {
            this.hive.spawn({ id: "planner", role: "planner", specialization: "planning", capabilities: ["planning"] });
            this.hive.spawn({ id: "coder", role: "coder", specialization: "coding", capabilities: ["coding"] });
            this.hive.spawn({ id: "reviewer", role: "reviewer", specialization: "review", capabilities: ["self-heal"] });
        }
        this.plan.setObjective(objective);
        const results = [];
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
                this.memory.remember(`Task step: ${desc} -> ${routed.output}`, { tags: ["task"], importance: 0.6 });
                results.push({ step: desc, agent: routed.agent.id, status: "completed", result: routed.output });
            }
            else {
                this.plan.fail(step.id, "no agent available");
                results.push({ step: desc, agent: "-", status: "failed", result: "no agent available" });
            }
        }
        // If the plan didn't fully succeed, attempt recovery.
        let healed = null;
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
    async solve(problem, opts) {
        if (!this.initialized)
            await this.initialize();
        const domain = classifyDomain(problem);
        // ASI §7: structurally-similar past problems from other domains + their method.
        const transfers = this.transfer.transfer(problem, { domain }).map(t => `${t.source.domain}: ${t.source.method}`);
        // ASI §2/§8: reason (memory + mistakes + hive + self-model via injected deps).
        const r = await this.reasoner.reason(problem, { depth: opts?.depth ?? 1 });
        // ASI §9: never claim more certainty than the track record supports.
        const confidence = this.selfModel.calibrate(r.confidence, domain);
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
        }
        else {
            // A verified solution is a reusable method (§7) and semantic knowledge (§4).
            this.transfer.register(problem, domain, r.chosen);
            this.knowledge.integrate(r.objective, problem);
        }
        // ASI §5: "which memories are unreliable" — reinforce or demote the
        // specific long-term memories that grounded this reasoning pass (r.available),
        // based on whether the outcome actually verified. A memory that repeatedly
        // grounds failed reasoning becomes less trusted (lower importance, more
        // likely to be evicted under capacity pressure); one behind a verified
        // solution is reinforced — real consequences, not just a log entry.
        for (const content of r.available) {
            const grounding = this.memory.all().find(m => m.content === content);
            if (grounding)
                this.memory.reinforce(grounding.id, r.verified ? 0.05 : -0.1);
        }
        this.memory.remember(`Solved [${domain}]: ${problem} -> ${r.result.slice(0, 200)}`, { tags: ["solution", domain], importance: 0.7 });
        // ASI §5/§11: feed this solve's (domain, approach, outcome) into the
        // discovery engine as an observation. Across many solves this lets the
        // system discover real regularities — e.g. "domain X tends toward
        // verified outcomes with approach Y" — a scientific-method analysis of its
        // own reasoning performance, not a separate hard-coded self-improvement
        // rule. See discoverPatterns().
        this.discovery.observe(`${domain} ${r.chosen} ${r.verified ? "verified" : "unverified"}`);
        // ASI §5/§12: turn the discovery into actual behavior change — bias future
        // approach selection by what has been found to correlate with verified vs
        // unverified outcomes, closing the loop instead of leaving it an inert log.
        this.refreshApproachBias();
        // ASI §9/§10: track the confidence signal for self-monitoring. A
        // failure-level anomaly (real divergence from the adaptive baseline, not
        // ordinary noise) is the signal self-monitor.ts documents as the trigger
        // for self-healing (§24) — so a genuinely destabilized solve loop attempts
        // real recovery rather than just being logged.
        this.monitor.observe("solve.confidence", confidence);
        if (this.monitor.hasFailure()) {
            await this.selfHeal();
        }
        return { result: r.result, confidence, verified: r.verified, domain, approach: r.chosen, transfers, subresults: r.subresults.length };
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
    /**
     * ASI §5/§12: recompute the approach-selection bias from the discovery
     * engine's current hypotheses. A strategy correlated with "verified" gets a
     * boost, one correlated with "unverified" gets demoted, bounded to keep any
     * single regularity from dominating reasoning entirely.
     *
     * Each resulting bias map is versioned via `SelfImprovement` (§5 — "maintain
     * versioned copies... so failed changes can be identified and reversed"),
     * so `rollbackApproachBias()` can undo the most recent refresh if later
     * evidence shows it was a regression. This is honest about what it is: a
     * single solve's outcome can't rigorously prove a bias change was good or
     * bad on its own (the bias only affects *future* reasoning), so this
     * versions the change rather than claiming to auto-validate it.
     */
    refreshApproachBias() {
        const knownStrategies = ["decompose", "analogy", "first-principles"];
        for (const h of this.discovery.generateHypotheses(10)) {
            let strategy;
            let outcome;
            if (knownStrategies.includes(h.cause)) {
                strategy = h.cause;
                outcome = h.effect;
            }
            else if (knownStrategies.includes(h.effect)) {
                strategy = h.effect;
                outcome = h.cause;
            }
            if (!strategy || (outcome !== "verified" && outcome !== "unverified"))
                continue;
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
    rollbackApproachBias() {
        if (this.improvement.versionCount("approachBias") < 2)
            return false;
        const previous = this.improvement.rollback("approachBias");
        if (!previous)
            return false;
        this.approachBiasMap = new Map(Object.entries(previous));
        return true;
    }
    /** ASI §9/§11: current self-monitor anomalies and whether recovery is warranted. */
    selfIntegrity() {
        return { anomalies: this.monitor.anomalies(), hasFailure: this.monitor.hasFailure() };
    }
    /**
     * Section 24: run the self-healer — detect unhealthy components and attempt
     * repair / revert-to-known-good, reporting anything unrecoverable.
     */
    async selfHeal() {
        if (!this.initialized)
            await this.initialize();
        return this.healer.heal();
    }
    /** Section 24: current health of every registered component (no repairs). */
    async healthReport() {
        if (!this.initialized)
            await this.initialize();
        return this.healer.healthReport();
    }
    /**
     * Section 7: retrieve relevant long-term memories for a query, ranked by
     * semantic similarity and modulated by importance/recency. Retrieval
     * reinforces what it returns.
     */
    recall(query, topK = 5) {
        return this.memory.retrieve(query, { topK }).map(h => h.item.content);
    }
    /**
     * Section 7: retrieve the most relevant past conversation turns for a query
     * — long-term memory retrieval scoped to chat history. Every user/assistant
     * turn is committed as a "chat-turn" memory in processQuery, so this surfaces
     * earlier exchanges by relevance rather than only the most recent ones.
     */
    recallHistory(query, topK = 5) {
        return this.memory.retrieve(query, { topK, tag: "chat-turn" }).map(h => h.item.content);
    }
    /**
     * Section 7: compress the recent conversation into a compact, salient
     * summary (semantic compression, distinct from ZipIO's byte-level gzip).
     * Optionally store the summary back as a "compressed" memory so a long
     * history can be represented cheaply.
     */
    compressContext(maxChars = 600, store = false) {
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
    chatHistory(limit = 20) {
        return this.memory
            .all()
            .filter(m => m.tags.includes("chat-turn"))
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-limit)
            .map(m => m.content);
    }
    /**
     * Get system status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            activePlugins: this.pluginRegistry.listActivePlugins().length,
            contextCapacity: `${this.contextCapacityGB}GB available`,
            alignment: this.empathy.getAlignmentScore(),
            hiveAgents: this.hive.list().length,
            memories: this.memory.size(),
        };
    }
}
/** Coarse domain label for a problem — used by the self-model and knowledge transfer. */
function classifyDomain(text) {
    const t = (text || "").toLowerCase();
    const has = (words) => words.some(w => t.includes(w));
    if (has(["code", "coding", "program", "function", "bug", "compile", "api", "algorithm"]))
        return "coding";
    if (has(["math", "equation", "number", "calculate", "compute", "proof", "geometry", "algebra"]))
        return "math";
    if (has(["science", "physics", "chemistry", "biology", "experiment", "hypothesis", "energy"]))
        return "science";
    if (has(["plan", "schedule", "steps", "roadmap", "organize", "strategy"]))
        return "planning";
    if (has(["design", "engineer", "build", "system", "architecture", "circuit"]))
        return "engineering";
    if (has(["write", "essay", "story", "language", "translate", "grammar", "poem"]))
        return "language";
    return "general";
}
// Singleton instance for module-level access
let system = null;
/**
 * Get or create the Neuroclaw system singleton
 */
export async function getNeuroclawSystem() {
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
    }
    else if (mode === "cli") {
        console.log("Launching interactive Neuroclaw command-line interface...");
        const cli = new CLI(system.llm, system.pipeline, system.thesaurus, system.pluginRegistry);
        await cli.startInteractive();
    }
    else {
        // Default mode: start on port 3000
        const port = 3000;
        console.log(`No mode specified. Starting default web server on port ${port}...`);
        const webServer = new WebServer(system.runner);
        await webServer.start(port);
        console.log(`Neuroclaw operational at http://localhost:${port}`);
    }
}
/** True when this module is the process entry point (not merely imported). */
function isEntryPoint() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isEntryPoint())
    main().catch((err) => {
        console.error("Fatal startup error in Neuroclaw launcher:", err);
        process.exit(1);
    });
