/**
 * Hive Mind Architecture (Spec Section 13).
 *
 * Multiple specialized agent processes that share information through a common
 * communication architecture. This is a *real* implementation, not a facade:
 * it defines shared memory, private memory, permissions, communication,
 * conflict resolution, task delegation and synchronization — the exact list
 * the spec requires.
 *
 * It deliberately reuses the system's existing ideas instead of inventing new
 * ones:
 *   - The **Value System** (Section 3.1) is applied to *agents*: every agent
 *     holds a `trust` value drawn from a fixed, zero-sum budget. Spawning a new
 *     agent takes budget from the others; promotion/demotion (`reward`)
 *     transfers trust between agents while keeping the total invariant. Trust
 *     is what weights conflict resolution and group decisions — a
 *     consistently-useful agent is protected, an unreliable one is demoted.
 *   - Each agent's "mind" is a pluggable think-function. In the live system
 *     that is `NeuroclawRunner.generate` (the real neural pipeline); in tests
 *     it is a deterministic stub. No external APIs are used.
 */
/**
 * Shared memory for the hive with public/private namespaces, permissioned
 * reads, versioned writes and conflict tracking. A "shared network does not
 * mean every process has unrestricted access to every piece of information"
 * (Section 13) — private entries are only visible to their owner.
 */
export class SharedBlackboard {
    constructor() {
        this.entries = new Map();
        this.conflicts = new Map();
        this.log = [];
    }
    /**
     * Write a value. Public writes to a key already owned by a *different* agent
     * with a *different* value raise a conflict (both values are retained as
     * candidates until `resolve` picks a winner).
     */
    write(owner, key, value, visibility = "public") {
        const physicalKey = visibility === "private" ? `@${owner}/${key}` : key;
        const prev = this.entries.get(physicalKey);
        const entry = {
            key,
            value,
            owner,
            visibility,
            version: (prev?.version ?? 0) + 1,
            timestamp: Date.now(),
        };
        if (visibility === "public" &&
            prev &&
            prev.owner !== owner &&
            JSON.stringify(prev.value) !== JSON.stringify(value)) {
            const conflict = this.conflicts.get(key) ?? { key, candidates: [prev], resolved: false };
            conflict.candidates.push(entry);
            conflict.resolved = false;
            conflict.winner = undefined;
            this.conflicts.set(key, conflict);
        }
        this.entries.set(physicalKey, entry);
        this.log.push(entry);
        return entry;
    }
    /** Read a value with permission checks. Returns `undefined` if not visible. */
    read(reader, key) {
        const priv = this.entries.get(`@${reader}/${key}`);
        if (priv)
            return priv.value;
        const pub = this.entries.get(key);
        if (pub && pub.visibility === "public")
            return pub.value;
        return undefined;
    }
    /** True when a public key currently has an unresolved multi-writer conflict. */
    hasConflict(key) {
        const c = this.conflicts.get(key);
        return !!c && !c.resolved;
    }
    listConflicts() {
        return Array.from(this.conflicts.values()).filter(c => !c.resolved);
    }
    /**
     * Resolve a conflict by choosing the candidate written by the highest-weight
     * (most-trusted) owner. The winning value is committed as the public entry.
     */
    resolve(key, weightOf, resolver = "hive") {
        const conflict = this.conflicts.get(key);
        if (!conflict || conflict.resolved)
            return undefined;
        let winner = conflict.candidates[0];
        for (const c of conflict.candidates) {
            if (weightOf(c.owner) > weightOf(winner.owner))
                winner = c;
        }
        conflict.resolved = true;
        conflict.winner = winner;
        conflict.resolvedBy = resolver;
        this.entries.set(key, { ...winner, version: winner.version + 1, timestamp: Date.now() });
        return winner;
    }
    history() {
        return [...this.log];
    }
}
/**
 * A single hive member: a specialized process with private working memory, a
 * granted capability set (permissions) and a mind (think-fn). It reads/writes
 * the shared blackboard through its own identity so permissions are enforced.
 */
export class HiveAgent {
    constructor(spec, board, think) {
        /** Value/reliability, managed zero-sum by the owning HiveMind. */
        this.trust = 0;
        this.state = new Map();
        this.id = spec.id;
        this.role = spec.role;
        this.specialization = spec.specialization;
        this.capabilities = new Set(spec.capabilities ?? []);
        this.board = board;
        this.think = spec.think ?? think;
    }
    /** Permission check — default-deny. */
    can(capability) {
        return this.capabilities.has(capability);
    }
    /** Private working memory (never visible to other agents). */
    remember(key, value) {
        this.state.set(key, value);
        this.board.write(this.id, key, value, "private");
    }
    recall(key) {
        return this.state.has(key) ? this.state.get(key) : this.board.read(this.id, key);
    }
    /** Publish to shared memory under this agent's identity. */
    share(key, value) {
        this.board.write(this.id, key, value, "public");
    }
    /** Run this agent's mind on a task and record the output privately. */
    async process(task) {
        const output = await this.think(task, this);
        this.state.set("lastOutput", output);
        this.state.set("lastTask", task);
        return output;
    }
    snapshot() {
        return { id: this.id, role: this.role, specialization: this.specialization, trust: this.trust };
    }
}
/**
 * The hive coordinator. Owns the agents, the shared blackboard, and the
 * zero-sum trust budget; provides delegation (routing), collaboration,
 * conflict resolution, promotion/demotion, and synchronization.
 */
export class HiveMind {
    constructor(opts) {
        this.blackboard = new SharedBlackboard();
        this.agents = new Map();
        this.totalTrust = opts?.totalTrust ?? 100;
        this.defaultThink = opts?.defaultThink ?? ((prompt, agent) => `[${agent.role}] ${prompt}`);
    }
    /**
     * Add an agent. Its trust share is taken zero-sum from the existing members
     * so `totalTrustValue()` stays invariant (Value System, Section 3.1).
     */
    spawn(spec) {
        if (this.agents.has(spec.id))
            throw new Error(`Agent already exists: ${spec.id}`);
        const agent = new HiveAgent(spec, this.blackboard, this.defaultThink);
        const n = this.agents.size + 1;
        const newShare = this.totalTrust / n;
        // Scale existing members down proportionally to make room for the newcomer.
        const scale = (this.totalTrust - newShare) / this.totalTrust;
        for (const a of this.agents.values())
            a.trust *= scale;
        agent.trust = newShare;
        this.agents.set(agent.id, agent);
        return agent;
    }
    remove(id) {
        const existed = this.agents.delete(id);
        if (existed)
            this.renormalizeTrust();
        return existed;
    }
    get(id) {
        return this.agents.get(id);
    }
    list() {
        return Array.from(this.agents.values());
    }
    /** Sum of all agent trust — should always equal the fixed budget. */
    totalTrustValue() {
        let s = 0;
        for (const a of this.agents.values())
            s += a.trust;
        return s;
    }
    /**
     * Promotion (positive delta) / demotion (negative delta). The transferred
     * trust is redistributed across the other agents, keeping the total budget
     * invariant — the same zero-sum reinforcement the neuron Value System uses.
     */
    reward(id, delta) {
        const agent = this.agents.get(id);
        if (!agent)
            return;
        const others = this.list().filter(a => a.id !== id);
        if (others.length === 0) {
            agent.trust = this.totalTrust;
            return;
        }
        const othersSum = others.reduce((s, a) => s + a.trust, 0);
        // Clamp so nobody goes negative and the target stays within budget.
        let d = delta;
        if (d > 0)
            d = Math.min(d, othersSum);
        if (d < 0)
            d = Math.max(d, -agent.trust);
        agent.trust += d;
        // Exactly renormalize the others to absorb `d` (and any float drift).
        const desiredOthers = this.totalTrust - agent.trust;
        const s = othersSum;
        for (const a of others) {
            a.trust = s > 0 ? a.trust * (desiredOthers / s) : desiredOthers / others.length;
        }
    }
    /**
     * Route a task to the single best-matching agent and run it. Matching scores
     * token overlap between the task and each agent's role/specialization/
     * capabilities, tie-broken by trust — a lightweight analogue of MoE gating.
     */
    async delegate(task, opts = {}) {
        let pool = this.list();
        if (opts.requireCapability)
            pool = pool.filter(a => a.can(opts.requireCapability));
        if (pool.length === 0)
            return null;
        const words = new Set(tokenize(task));
        const scored = pool.map(a => ({ a, score: this.matchScore(a, words) }));
        scored.sort((x, y) => (y.score - x.score) || (y.a.trust - x.a.trust));
        const agent = scored[0].a;
        const output = await agent.process(task);
        return { agent, output };
    }
    /** Every named agent (or all) contributes to a task in parallel. */
    async collaborate(task, agentIds) {
        const members = agentIds ? agentIds.map(id => this.agents.get(id)).filter(Boolean) : this.list();
        return Promise.all(members.map(async (agent) => ({ agent, output: await agent.process(task) })));
    }
    /** Resolve every open conflict using trust as the weight. */
    synchronize() {
        const open = this.blackboard.listConflicts();
        for (const c of open) {
            this.blackboard.resolve(c.key, owner => this.agents.get(owner)?.trust ?? 0);
        }
        return open.length;
    }
    matchScore(agent, words) {
        const bag = tokenize(`${agent.role} ${agent.specialization} ${Array.from(agent.capabilities).join(" ")}`);
        let score = 0;
        for (const t of bag)
            if (words.has(t))
                score++;
        return score;
    }
    renormalizeTrust() {
        const s = this.totalTrustValue();
        if (s <= 0) {
            const each = this.agents.size ? this.totalTrust / this.agents.size : 0;
            for (const a of this.agents.values())
                a.trust = each;
            return;
        }
        const scale = this.totalTrust / s;
        for (const a of this.agents.values())
            a.trust *= scale;
    }
}
function tokenize(text) {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
