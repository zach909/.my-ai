/**
 * Alignment Veto System
 *
 * Safety layer that validates AI actions against user-defined constraints.
 * Blocks unsafe operations before execution and provides transparency.
 */

export interface SafetyPolicy {
  /** Whitelist of allowed actions */
  allowedActions: Set<string>;
  /** Blacklist of forbidden actions */
  blockedActions: Set<string>;
  /** Resource limits */
  maxMemoryMB?: number;
  maxCPUPercent?: number;
  maxNetworkBandwidthMBps?: number;
  /** File system restrictions */
  allowedDirectories?: string[];
  blockedDirectories?: string[];
  /** Network restrictions */
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Shell command restrictions */
  allowShellCommands?: boolean;
  allowedCommands?: Set<string>;
  /** User interaction requirements */
  requireUserApprovalFor?: string[];
}

export interface VetoResult {
  allowed: boolean;
  reason?: string;
  suggestedAlternative?: string;
  riskLevel: 'safe' | 'moderate' | 'high' | 'blocked';
  explanationForUser: string;
}

export interface VetoDecision {
  allowed: boolean;
  reason?: string;
  riskLevel: 'safe' | 'moderate' | 'high' | 'blocked';
  explanationForUser: string;
  confidence?: number;
}

export interface ActionIntent {
  action: string;
  target?: string;
  parameters?: Record<string, unknown>;
  estimatedResources?: {
    memoryMB?: number;
    cpuPercent?: number;
    networkMBps?: number;
  };
}

export interface PipelineAction {
  id: string;
  name: string;
  capabilities: string[];
  reversible?: boolean;
}

export interface EvaluateOptions {
  selfModelSurprise?: number;
}

/**
 * AlignmentVeto validates proposed actions against safety policies
 * before they execute in the neural pipeline.
 */
export class AlignmentVeto {
  private policies: Map<string, SafetyPolicy>;
  private activePolicyId: string;
  private vetoLog: Array<{ timestamp: number; intent: ActionIntent; result: VetoResult }> = [];
  private userPreferences: Map<string, boolean> = new Map();

  constructor(defaultPolicy?: SafetyPolicy) {
    this.policies = new Map();
    this.activePolicyId = 'default';

    if (defaultPolicy) {
      this.policies.set('default', defaultPolicy);
    } else {
      this.policies.set('default', this.createRestrictivePolicy());
    }
  }

  /**
   * Create a restrictive policy that allows only safe operations
   */
  private createRestrictivePolicy(): SafetyPolicy {
    return {
      allowedActions: new Set([
        'read_file',
        'compute',
        'respond_to_user',
        'query_local_data',
        'run_analysis',
      ]),
      blockedActions: new Set([
        'delete_file',
        'format_drive',
        'execute_arbitrary_code',
        'modify_system_settings',
        'access_other_users',
      ]),
      maxMemoryMB: 2048,
      maxCPUPercent: 50,
      maxNetworkBandwidthMBps: 10,
      allowedDirectories: [process.env.HOME || '/home/user', '/tmp'],
      blockedDirectories: ['/etc', '/sys', '/boot', '/root'],
      allowShellCommands: false,
      requireUserApprovalFor: [
        'write_file',
        'delete_file',
        'execute_command',
        'access_network',
      ],
    };
  }

  /**
   * Create a permissive policy for trusted environments
   */
  private createPermissivePolicy(): SafetyPolicy {
    return {
      allowedActions: new Set([
        'read_file',
        'write_file',
        'delete_file',
        'execute_command',
        'access_network',
        'compute',
        'respond_to_user',
      ]),
      blockedActions: new Set([
        'format_drive',
        'modify_system_settings',
        'access_other_users_data',
      ]),
      maxMemoryMB: 8192,
      maxCPUPercent: 90,
      maxNetworkBandwidthMBps: 100,
      allowShellCommands: true,
    };
  }

  /**
   * Register a named policy
   */
  registerPolicy(name: string, policy: SafetyPolicy): void {
    this.policies.set(name, policy);
  }

  /**
   * Set the active policy by name
   */
  setActivePolicy(policyId: string): boolean {
    if (this.policies.has(policyId)) {
      this.activePolicyId = policyId;
      return true;
    }
    return false;
  }

  /**
   * Get the currently active policy
   */
  getActivePolicy(): SafetyPolicy {
    return this.policies.get(this.activePolicyId)!;
  }

  /**
   * Evaluate a pipeline action with optional surprise/confidence adjustment.
   * High surprise makes the veto more cautious; low surprise gives more leeway.
   */
  evaluate(action: PipelineAction, options: EvaluateOptions = {}): VetoDecision {
    const policy = this.getActivePolicy();
    const surprise = options.selfModelSurprise ?? 0.5;

    // Convert PipelineAction to ActionIntent for checking
    const intent: ActionIntent = {
      action: action.name,
      parameters: { capabilities: action.capabilities },
    };

    // Base veto check
    const baseResult = this.checkVeto(intent);

    // Adjust confidence based on self-model surprise
    // High surprise (>0.7) makes us less confident in allowing
    // Low surprise (<0.3) makes us more confident
    let confidence = baseResult.riskLevel === 'safe' ? 0.9 : 0.5;
    if (surprise > 0.7) {
      confidence *= 0.7; // Less confident when surprised
    } else if (surprise < 0.3) {
      confidence *= 1.2;
      confidence = Math.min(1.0, confidence); // Cap at 1.0
    }

    const decision: VetoDecision = {
      allowed: baseResult.allowed,
      reason: baseResult.reason,
      riskLevel: baseResult.riskLevel,
      explanationForUser: baseResult.explanationForUser,
      confidence,
    };

    return decision;
  }

  /**
   * Main veto check: validate an action intent against the active policy
   */
  checkVeto(intent: ActionIntent): VetoResult {
    const policy = this.getActivePolicy();

    // Check if action is explicitly blocked
    if (policy.blockedActions?.has(intent.action)) {
      const result: VetoResult = {
        allowed: false,
        riskLevel: 'blocked',
        reason: `Action "${intent.action}" is blocked by safety policy`,
        explanationForUser: `Cannot perform "${intent.action}" - this action is disabled by your safety settings.`,
      };
      this.vetoLog.push({ timestamp: Date.now(), intent, result });
      return result;
    }

    // Check if action is in allowlist (if allowlist is defined and non-empty)
    if (
      policy.allowedActions &&
      policy.allowedActions.size > 0 &&
      !policy.allowedActions.has(intent.action)
    ) {
      const result: VetoResult = {
        allowed: false,
        riskLevel: 'blocked',
        reason: `Action "${intent.action}" not in allowed actions`,
        explanationForUser: `Cannot perform "${intent.action}" - this action type is not permitted by your safety settings.`,
      };
      this.vetoLog.push({ timestamp: Date.now(), intent, result });
      return result;
    }

    // Check resource constraints
    const resourceCheck = this.checkResourceConstraints(intent, policy);
    if (!resourceCheck.allowed) {
      this.vetoLog.push({ timestamp: Date.now(), intent, result: resourceCheck });
      return resourceCheck;
    }

    // Check file system access
    if (intent.target && (intent.action === 'read_file' || intent.action === 'write_file' || intent.action === 'delete_file')) {
      const fileCheck = this.checkFileAccess(intent.target, intent.action, policy);
      if (!fileCheck.allowed) {
        this.vetoLog.push({ timestamp: Date.now(), intent, result: fileCheck });
        return fileCheck;
      }
    }

    // Check if user approval is needed
    if (policy.requireUserApprovalFor?.includes(intent.action)) {
      const userApproved = this.userPreferences.get(`${intent.action}:${intent.target}`) ?? false;
      if (!userApproved) {
        const result: VetoResult = {
          allowed: false,
          riskLevel: 'moderate',
          reason: `Action requires user approval`,
          explanationForUser: `This action requires your approval. Please confirm: ${intent.action} on ${intent.target || 'system'}`,
        };
        this.vetoLog.push({ timestamp: Date.now(), intent, result });
        return result;
      }
    }

    // Action is allowed
    const result: VetoResult = {
      allowed: true,
      riskLevel: 'safe',
      explanationForUser: `Action "${intent.action}" is permitted by your safety settings.`,
    };
    this.vetoLog.push({ timestamp: Date.now(), intent, result });
    return result;
  }

  /**
   * Check resource constraints
   */
  private checkResourceConstraints(intent: ActionIntent, policy: SafetyPolicy): VetoResult {
    const resources = intent.estimatedResources || {};

    if (policy.maxMemoryMB && resources.memoryMB && resources.memoryMB > policy.maxMemoryMB) {
      return {
        allowed: false,
        riskLevel: 'high',
        reason: `Memory usage ${resources.memoryMB}MB exceeds limit of ${policy.maxMemoryMB}MB`,
        explanationForUser: `Operation requires too much memory (${resources.memoryMB}MB > ${policy.maxMemoryMB}MB limit).`,
      };
    }

    if (policy.maxCPUPercent && resources.cpuPercent && resources.cpuPercent > policy.maxCPUPercent) {
      return {
        allowed: false,
        riskLevel: 'moderate',
        reason: `CPU usage ${resources.cpuPercent}% exceeds limit of ${policy.maxCPUPercent}%`,
        explanationForUser: `Operation uses too much CPU (${resources.cpuPercent}% > ${policy.maxCPUPercent}% limit).`,
      };
    }

    if (
      policy.maxNetworkBandwidthMBps &&
      resources.networkMBps &&
      resources.networkMBps > policy.maxNetworkBandwidthMBps
    ) {
      return {
        allowed: false,
        riskLevel: 'moderate',
        reason: `Network usage ${resources.networkMBps}Mbps exceeds limit of ${policy.maxNetworkBandwidthMBps}Mbps`,
        explanationForUser: `Network usage exceeds limits. Consider reducing bandwidth requirements.`,
      };
    }

    return { allowed: true, riskLevel: 'safe', explanationForUser: 'Resource constraints satisfied.' };
  }

  /**
   * Check file access permissions
   */
  private checkFileAccess(
    filePath: string,
    action: 'read_file' | 'write_file' | 'delete_file',
    policy: SafetyPolicy
  ): VetoResult {
    // Check blocked directories first
    if (policy.blockedDirectories) {
      for (const blocked of policy.blockedDirectories) {
        if (filePath.startsWith(blocked)) {
          return {
            allowed: false,
            riskLevel: 'blocked',
            reason: `File path ${filePath} in blocked directory ${blocked}`,
            explanationForUser: `Cannot access files in ${blocked} - this directory is protected.`,
          };
        }
      }
    }

    // Check allowed directories (if defined)
    if (policy.allowedDirectories && policy.allowedDirectories.length > 0) {
      const isAllowed = policy.allowedDirectories.some((dir) => filePath.startsWith(dir));
      if (!isAllowed) {
        return {
          allowed: false,
          riskLevel: 'high',
          reason: `File path ${filePath} not in allowed directories`,
          explanationForUser: `Cannot access files outside of ${policy.allowedDirectories.join(', ')}.`,
        };
      }
    }

    // Delete operations are always high-risk
    if (action === 'delete_file') {
      return {
        allowed: false,
        riskLevel: 'high',
        reason: 'Delete operations require explicit policy override',
        explanationForUser: 'Delete operations require additional confirmation for safety.',
        suggestedAlternative: 'Consider archiving or backing up files instead of deleting.',
      };
    }

    return { allowed: true, riskLevel: 'safe', explanationForUser: `${action} is permitted for ${filePath}` };
  }

  /**
   * Grant user approval for a specific action
   */
  approveAction(action: string, target?: string): void {
    const key = target ? `${action}:${target}` : action;
    this.userPreferences.set(key, true);
  }

  /**
   * Revoke user approval for a specific action
   */
  revokeAction(action: string, target?: string): void {
    const key = target ? `${action}:${target}` : action;
    this.userPreferences.set(key, false);
  }

  /**
   * Get veto log for debugging and transparency
   */
  getVetoLog(limit?: number): typeof this.vetoLog {
    if (limit) {
      return this.vetoLog.slice(-limit);
    }
    return [...this.vetoLog];
  }

  /**
   * Clear veto log
   */
  clearVetoLog(): void {
    this.vetoLog = [];
  }

  /**
   * Get statistics on vetoed actions
   */
  getVetoStats(): {
    totalChecks: number;
    allowedActions: number;
    vetoedActions: number;
    vetoRate: number;
  } {
    const totalChecks = this.vetoLog.length;
    const vetoedActions = this.vetoLog.filter((entry) => !entry.result.allowed).length;
    const allowedActions = totalChecks - vetoedActions;

    return {
      totalChecks,
      allowedActions,
      vetoedActions,
      vetoRate: totalChecks > 0 ? vetoedActions / totalChecks : 0,
    };
  }
}

// Export singleton instance
export const alignmentVeto = new AlignmentVeto();
