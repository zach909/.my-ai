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

export interface CloneConfig {
  max_tokens: number;
  temperature: number;
  role: string;
  specialization?: string;
  [key: string]: any;
}

export interface CloneInstance {
  id: string;
  prompt: string;
  config: CloneConfig;
  status: string;
  createdAt: number;
  lastActivity: number;
  outputLog: Array<{
    timestamp: number;
    type: string;
    content: string;
    context?: string;
  }>;
}

export class SelfReplicatePlugin {
  name = "self_replicate";
  description = "Enables AI to clone itself and assign prompts to clones.";
  
  private clones: Map<string, CloneInstance> = new Map();
  private defaultConfig: CloneConfig = {
    max_tokens: 256,
    temperature: 0.7,
    role: 'assistant',
    specialization: undefined,
  };
  private cloneDir: string;

  constructor() {
    const root = path.dirname(path.dirname(__dirname));
    this.cloneDir = path.join(root, 'clones');
    
    // Ensure clone directory exists
    if (!fs.existsSync(this.cloneDir)) {
      fs.mkdirSync(this.cloneDir, { recursive: true });
    }
  }

  /**
   * Create a new AI clone with a specific prompt and configuration.
   */
  clone(
    prompt: string,
    config?: Partial<CloneConfig>,
    role?: string,
    specialization?: string
  ): { success: boolean; clone_id: string; prompt: string; config: CloneConfig; status: string; message: string } {
    const cloneId = `clone_${randomUUID().slice(0, 8)}`;
    const effectiveConfig: CloneConfig = { ...this.defaultConfig, ...config };
    
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

    const clone: CloneInstance = {
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
  listClones(activeOnly: boolean = false): { count: number; clones: CloneInstance[] } {
    const clones: CloneInstance[] = [];
    
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
  getClone(cloneId: string): CloneInstance | { error: string } {
    const clone = this.clones.get(cloneId);
    if (!clone) {
      return { error: `Clone ${cloneId} not found` };
    }
    return this.cloneToDict(clone);
  }

  /**
   * Send a prompt to a specific clone.
   */
  sendPrompt(
    cloneId: string,
    prompt: string,
    context?: string
  ): { clone_id: string; prompt: string; response: string; timestamp: number } | { error: string } {
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
  private processClonePrompt(
    clone: CloneInstance,
    prompt: string,
    context?: string
  ): string {
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
  terminateClone(cloneId: string, saveLog: boolean = true): { success: boolean; clone_id: string; message: string } | { error: string } {
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
  terminateAll(saveLogs: boolean = true): { success: boolean; terminated_count: number; total_count: number; terminated_ids: string[] } {
    const totalCount = this.clones.size;
    const terminated: string[] = [];

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
  cloneStatus(cloneId?: string): { 
    clone_id?: string;
    status?: string;
    uptime?: number;
    last_activity?: number;
    log_entries?: number;
    total_clones?: number;
    active_clones?: number;
    inactive_clones?: number;
    clone_ids?: string[];
  } | { error: string } {
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
  setCloneConfig(
    cloneId: string,
    updates: Partial<CloneConfig>
  ): { success: boolean; clone_id: string; config: CloneConfig } | { error: string } {
    const clone = this.clones.get(cloneId);
    if (!clone) {
      return { error: `Clone ${cloneId} not found` };
    }

    for (const [key, value] of Object.entries(updates)) {
      if (key in clone.config) {
        (clone.config as any)[key] = value;
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
  private saveCloneState(clone: CloneInstance): void {
    const stateFile = path.join(this.cloneDir, `${clone.id}.state.json`);
    try {
      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          id: clone.id,
          prompt: clone.prompt,
          config: clone.config,
          status: clone.status,
          created_at: clone.createdAt,
          last_activity: clone.lastActivity,
        }, null, 2)
      );
    } catch (error) {
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
  private saveCloneLog(clone: CloneInstance): void {
    const logFile = path.join(this.cloneDir, `${clone.id}.log.json`);
    try {
      fs.writeFileSync(logFile, JSON.stringify(clone.outputLog, null, 2));
    } catch (error) {
      console.error(`[self_replicate] Failed to save log for ${clone.id}:`, error);
    }
  }

  /**
   * Convert clone instance to dictionary format.
   */
  private cloneToDict(clone: CloneInstance): any {
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
  status(): { name: string; active_clones: number; total_clones: number } {
    const active = Array.from(this.clones.values()).filter(c => c.status === 'ready').length;
    return {
      name: this.name,
      active_clones: active,
      total_clones: this.clones.size,
    };
  }
}

// Export tools object for plugin manager compatibility
export const tools = {
  clone: (prompt: string, config?: any, role?: string, specialization?: string) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.clone(prompt, config, role, specialization);
  },
  list_clones: (activeOnly?: boolean) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.listClones(activeOnly);
  },
  get_clone: (cloneId: string) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.getClone(cloneId);
  },
  send_prompt: (cloneId: string, prompt: string, context?: string) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.sendPrompt(cloneId, prompt, context);
  },
  terminate_clone: (cloneId: string, saveLog?: boolean) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.terminateClone(cloneId, saveLog);
  },
  terminate_all: (saveLogs?: boolean) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.terminateAll(saveLogs);
  },
  clone_status: (cloneId?: string) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.cloneStatus(cloneId);
  },
  set_clone_config: (cloneId: string, updates: any) => {
    const plugin = new SelfReplicatePlugin();
    return plugin.setCloneConfig(cloneId, updates);
  },
};
