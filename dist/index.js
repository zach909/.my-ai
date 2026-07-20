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
        // 3. Gate the "respond" action through the AlignmentVeto before running.
        //    A negative-valence user under high arousal lowers our confidence,
        //    surfacing as self-model surprise the veto can escalate on.
        const decision = this.veto.evaluate({ id: `respond:${Date.now()}`, name: "respond to user", capabilities: ["text-generate"], reversible: true }, { selfModelSurprise: emotion.valence < 0 ? emotion.arousal * 0.5 : 0 });
        if (!decision.allowed) {
            const blocked = `[Withheld] ${decision.reasons.join("; ")}`;
            await this.zipIO.emit(blocked);
            return blocked;
        }
        // 4. If the user is explicitly asking to recall the conversation, answer
        //    directly from long-term memory (retrieval over chat history) instead
        //    of generating fresh — this is what makes the memory *usable*, not
        //    just stored.
        const wantsRecall = /\b(recall|remember|earlier|previously|before|recap|last time|we (talked|discussed|spoke|said)|what did we|did we (talk|discuss))\b/i.test(input);
        if (wantsRecall && priorHistory.length > 0) {
            const recalled = priorHistory.map(h => `• ${h.item.content}`).join("\n");
            const response = `From our earlier conversation, here's what's relevant:\n${recalled}`;
            await this.zipIO.emit(response);
            this.memory.remember(`AI: ${response}`, { tags: ["chat-turn", "assistant"], importance: turnImportance });
            return response;
        }
        // 5. Run the query through the real neural runner (THORNS intent →
        //    plugin/skill dispatch → mesh + hyperdimensional + MoE generation).
        try {
            let result = await this.runner.generate(input);
            if (decision.requiresConfirmation) {
                result = `${result}\n  [Confirm before acting: ${decision.reasons.join("; ")}]`;
            }
            // 6. Store the (compressed) output in the ZIP-IO output loop, and commit
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
