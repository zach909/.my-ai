/**
 * Self-replication plugin — allows the AI to clone itself with new prompts.
 *
 * This plugin enables the AI system to spawn child instances with customized
 * prompts, configurations, and specialized roles. Each clone operates as an
 * independent agent that can be given specific tasks or personas.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class SelfReplicatePlugin {
    constructor() {
        this.name = "self_replicate";
        this.description = "Enables AI to clone itself and assign prompts to clones.";
        this.clones = new Map();
        this.defaultConfig = {
            max_tokens: 256,
            temperature: 0.7,
            role: 'assistant',
            specialization: undefined,
        };
        const root = path.dirname(path.dirname(__dirname));
        this.cloneDir = path.join(root, 'clones');
        // Ensure clone directory exists
        if (!fs.existsSync(this.cloneDir)) {
            fs.mkdirSync(this.cloneDir, { recursive: true, mode: 0o700 });
        }
        if (process.platform !== 'win32' && typeof fs.chmodSync === 'function') {
            try {
                fs.chmodSync(this.cloneDir, 0o700);
            }
            catch { }
        }
    }
    /**
     * Create a new AI clone with a specific prompt and configuration.
     */
    clone(prompt, config, role, specialization) {
        const cloneId = `clone_${randomUUID().slice(0, 8)}`;
        const effectiveConfig = { ...this.defaultConfig, ...config };
        if (role) {
            effectiveConfig.role = role;
        }
        if (specialization) {
            effectiveConfig.specialization = specialization;
        }
        // Build the full system prompt for the clone
        const systemPrompt = `You are a cloned instance of the AI system.
Clone ID: ${cloneId}
Role: ${effectiveConfig.role}
Specialization: ${effectiveConfig.specialization || 'general'}

Your primary instruction: ${prompt}

You should focus on this task while maintaining helpful, accurate responses.
When relevant, mention your clone ID and specialization.
`;
        const clone = {
            id: cloneId,
            prompt: systemPrompt,
            config: effectiveConfig,
            status: 'ready',
            createdAt: Date.now(),
            lastActivity: Date.now(),
            outputLog: [],
        };
        this.clones.set(cloneId, clone);
        this.saveCloneState(clone);
        return {
            success: true,
            clone_id: cloneId,
            prompt: prompt,
            config: effectiveConfig,
            status: clone.status,
            message: `Clone created successfully with ID: ${cloneId}`,
        };
    }
    /**
     * List all AI clones.
     */
    listClones(activeOnly = false) {
        const clones = [];
        for (const [cloneId, clone] of this.clones) {
            if (activeOnly && clone.status !== 'ready') {
                continue;
            }
            clones.push(clone);
        }
        return {
            count: clones.length,
            clones: clones.map(c => this.cloneToDict(c)),
        };
    }
    /**
     * Get details of a specific clone.
     */
    getClone(cloneId) {
        const clone = this.clones.get(cloneId);
        if (!clone) {
            return { error: `Clone ${cloneId} not found` };
        }
        return this.cloneToDict(clone);
    }
    /**
     * Send a prompt to a specific clone.
     */
    sendPrompt(cloneId, prompt, context) {
        const clone = this.clones.get(cloneId);
        if (!clone) {
            return { error: `Clone ${cloneId} not found` };
        }
        if (clone.status !== 'ready') {
            return { error: `Clone ${cloneId} is not ready (status: ${clone.status})` };
        }
        clone.lastActivity = Date.now();
        // Log the interaction
        clone.outputLog.push({
            timestamp: Date.now(),
            type: 'prompt',
            content: prompt,
            context: context,
        });
        // Process the prompt through the clone
        const response = this.processClonePrompt(clone, prompt, context);
        // Log the response
        clone.outputLog.push({
            timestamp: Date.now(),
            type: 'response',
            content: response,
        });
        this.saveCloneState(clone);
        return {
            clone_id: cloneId,
            prompt: prompt,
            response: response,
            timestamp: clone.outputLog[clone.outputLog.length - 2].timestamp,
        };
    }
    /**
     * Process a prompt through the clone's configuration.
     */
    processClonePrompt(clone, prompt, context) {
        // In a full implementation, this would:
        // 1. Combine clone.prompt + context + prompt
        // 2. Call the model with clone.config parameters
        // 3. Return the generated response
        const truncatedPrompt = prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt;
        return `[Clone ${clone.id}] Received: '${truncatedPrompt}' | Role: ${clone.config.role} | Specialization: ${clone.config.specialization || 'general'}`;
    }
    /**
     * Terminate a specific clone.
     */
    terminateClone(cloneId, saveLog = true) {
        const clone = this.clones.get(cloneId);
        if (!clone) {
            return { error: `Clone ${cloneId} not found` };
        }
        if (saveLog) {
            this.saveCloneLog(clone);
        }
        this.clones.delete(cloneId);
        return {
            success: true,
            clone_id: cloneId,
            message: `Clone ${cloneId} terminated`,
        };
    }
    /**
     * Terminate all clones.
     */
    terminateAll(saveLogs = true) {
        const totalCount = this.clones.size;
        const terminated = [];
        for (const cloneId of this.clones.keys()) {
            const result = this.terminateClone(cloneId, saveLogs);
            if ('success' in result) {
                terminated.push(cloneId);
            }
        }
        return {
            success: true,
            terminated_count: terminated.length,
            total_count: totalCount,
            terminated_ids: terminated,
        };
    }
    /**
     * Get status information about clones.
     */
    cloneStatus(cloneId) {
        if (cloneId) {
            const clone = this.clones.get(cloneId);
            if (!clone) {
                return { error: `Clone ${cloneId} not found` };
            }
            return {
                clone_id: cloneId,
                status: clone.status,
                uptime: (Date.now() - clone.createdAt) / 1000,
                last_activity: clone.lastActivity,
                log_entries: clone.outputLog.length,
            };
        }
        const total = this.clones.size;
        const active = Array.from(this.clones.values()).filter(c => c.status === 'ready').length;
        return {
            total_clones: total,
            active_clones: active,
            inactive_clones: total - active,
            clone_ids: Array.from(this.clones.keys()),
        };
    }
    /**
     * Update configuration for a clone.
     */
    setCloneConfig(cloneId, updates) {
        const clone = this.clones.get(cloneId);
        if (!clone) {
            return { error: `Clone ${cloneId} not found` };
        }
        for (const [key, value] of Object.entries(updates)) {
            if (key in clone.config) {
                clone.config[key] = value;
            }
        }
        this.saveCloneState(clone);
        return {
            success: true,
            clone_id: cloneId,
            config: clone.config,
        };
    }
    /**
     * Save clone state to disk.
     */
    saveCloneState(clone) {
        const stateFile = path.join(this.cloneDir, `${clone.id}.state.json`);
        try {
            fs.writeFileSync(stateFile, JSON.stringify({
                id: clone.id,
                prompt: clone.prompt,
                config: clone.config,
                status: clone.status,
                created_at: clone.createdAt,
                last_activity: clone.lastActivity,
            }, null, 2), { encoding: 'utf8', mode: 0o600 });
            if (process.platform !== 'win32' && typeof fs.chmodSync === 'function') {
                try {
                    fs.chmodSync(stateFile, 0o600);
                }
                catch { }
            }
        }
        catch (error) {
            clone.outputLog.push({
                timestamp: Date.now(),
                type: 'error',
                content: `Failed to save state: ${error}`,
            });
        }
    }
    /**
     * Save clone's interaction log to disk.
     */
    saveCloneLog(clone) {
        const logFile = path.join(this.cloneDir, `${clone.id}.log.json`);
        try {
            fs.writeFileSync(logFile, JSON.stringify(clone.outputLog, null, 2), { encoding: 'utf8', mode: 0o600 });
            if (process.platform !== 'win32' && typeof fs.chmodSync === 'function') {
                try {
                    fs.chmodSync(logFile, 0o600);
                }
                catch { }
            }
        }
        catch (error) {
            console.error(`[self_replicate] Failed to save log for ${clone.id}:`, error);
        }
    }
    /**
     * Convert clone instance to dictionary format.
     */
    cloneToDict(clone) {
        return {
            id: clone.id,
            prompt: clone.prompt,
            config: clone.config,
            status: clone.status,
            created_at: clone.createdAt,
            last_activity: clone.lastActivity,
            uptime: (Date.now() - clone.createdAt) / 1000,
        };
    }
    /**
     * Get plugin status.
     */
    status() {
        const active = Array.from(this.clones.values()).filter(c => c.status === 'ready').length;
        return {
            name: this.name,
            active_clones: active,
            total_clones: this.clones.size,
        };
    }
}
// Export tools object for plugin manager compatibility. Every entry must
// share one SelfReplicatePlugin instance -- clones live in `this.clones`
// (instance state), so constructing `new SelfReplicatePlugin()` inside each
// individual tool call (as this used to do) gave clone() a Map that every
// other tool's own fresh instance could never see: list_clones() always
// reported zero clones, get_clone()/send_prompt()/terminate_clone()/
// clone_status()/set_clone_config() always reported "not found", even
// immediately after clone() itself returned success.
const sharedPlugin = new SelfReplicatePlugin();
export const tools = {
    clone: (prompt, config, role, specialization) => {
        return sharedPlugin.clone(prompt, config, role, specialization);
    },
    list_clones: (activeOnly) => {
        return sharedPlugin.listClones(activeOnly);
    },
    get_clone: (cloneId) => {
        return sharedPlugin.getClone(cloneId);
    },
    send_prompt: (cloneId, prompt, context) => {
        return sharedPlugin.sendPrompt(cloneId, prompt, context);
    },
    terminate_clone: (cloneId, saveLog) => {
        return sharedPlugin.terminateClone(cloneId, saveLog);
    },
    terminate_all: (saveLogs) => {
        return sharedPlugin.terminateAll(saveLogs);
    },
    clone_status: (cloneId) => {
        return sharedPlugin.cloneStatus(cloneId);
    },
    set_clone_config: (cloneId, updates) => {
        return sharedPlugin.setCloneConfig(cloneId, updates);
    },
};
