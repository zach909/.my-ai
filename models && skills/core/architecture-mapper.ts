/**
 * Architecture Mapper - Maps system components, dependencies, and information flow.
 * 
 * Implements PHASE 1 steps 1-7:
 * - Complete map of system architecture
 * - Component identification and classification
 * - Information flow tracking
 * - Dependency analysis
 * - Bottleneck identification
 * - Resource waste detection
 */

export interface ComponentInfo {
  id: string;
  name: string;
  type: ComponentType;
  description: string;
  dependencies: string[];
  dependents: string[];
  inputs: string[];
  outputs: string[];
  resourceUsage?: ResourceUsage;
  performanceMetrics?: PerformanceMetrics;
}

export type ComponentType =
  | 'reasoning'
  | 'memory'
  | 'learning'
  | 'planning'
  | 'tool'
  | 'communication'
  | 'safety'
  | 'monitoring'
  | 'input'
  | 'output'
  | 'core';

export interface ResourceUsage {
  memoryMB: number;
  cpuPercent: number;
  latencyMs: number;
  callsPerSecond: number;
}

export interface PerformanceMetrics {
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  throughput: number;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  dataType: string;
  frequency: 'high' | 'medium' | 'low';
  size: 'large' | 'medium' | 'small';
}

export interface Bottleneck {
  componentId: string;
  type: 'cpu' | 'memory' | 'io' | 'algorithmic' | 'dependency';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  impact: string;
  suggestion: string;
}

export interface WasteReport {
  componentId: string;
  type: 'memory' | 'energy' | 'time' | 'computation';
  description: string;
  estimatedWaste: number;
  recommendation: string;
}

export class ArchitectureMapper {
  private components = new Map<string, ComponentInfo>();
  private dataFlows: DataFlowEdge[] = [];
  private bottlenecks: Bottleneck[] = [];
  private wasteReports: WasteReport[] = [];

  /** Register a component in the architecture map */
  registerComponent(component: ComponentInfo): void {
    this.components.set(component.id, component);
    // Update dependency graphs
    for (const dep of component.dependencies) {
      const depComp = this.components.get(dep);
      if (depComp && !depComp.dependents.includes(component.id)) {
        depComp.dependents.push(component.id);
      }
    }
  }

  /** Get all components of a specific type */
  getByType(type: ComponentType): ComponentInfo[] {
    return Array.from(this.components.values()).filter(c => c.type === type);
  }

  /** Get component by ID */
  getComponent(id: string): ComponentInfo | undefined {
    return this.components.get(id);
  }

  /** Get all components */
  getAllComponents(): ComponentInfo[] {
    return Array.from(this.components.values());
  }

  /** Record a data flow between components */
  recordDataFlow(edge: DataFlowEdge): void {
    this.dataFlows.push(edge);
  }

  /** Get all data flows for a component */
  getDataFlows(componentId: string): DataFlowEdge[] {
    return this.dataFlows.filter(
      e => e.from === componentId || e.to === componentId
    );
  }

  /** Get full data flow graph */
  getAllDataFlows(): DataFlowEdge[] {
    return [...this.dataFlows];
  }

  /** Identify bottlenecks based on performance metrics */
  identifyBottlenecks(): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    for (const comp of this.components.values()) {
      const metrics = comp.performanceMetrics;
      const resources = comp.resourceUsage;

      if (!metrics && !resources) continue;

      // High latency bottleneck
      if (metrics && metrics.avgLatency > 1000) {
        bottlenecks.push({
          componentId: comp.id,
          type: 'io',
          severity: metrics.avgLatency > 5000 ? 'critical' : 'high',
          description: `High average latency: ${metrics.avgLatency.toFixed(0)}ms`,
          impact: 'Slows down dependent components and overall system response',
          suggestion: 'Consider caching, optimization, or async processing',
        });
      }

      // High CPU usage bottleneck
      if (resources && resources.cpuPercent > 80) {
        bottlenecks.push({
          componentId: comp.id,
          type: 'cpu',
          severity: resources.cpuPercent > 95 ? 'critical' : 'high',
          description: `High CPU usage: ${resources.cpuPercent.toFixed(1)}%`,
          impact: 'May cause system-wide slowdowns and increased latency',
          suggestion: 'Profile algorithms, consider parallelization or offloading',
        });
      }

      // High memory usage bottleneck
      if (resources && resources.memoryMB > 500) {
        bottlenecks.push({
          componentId: comp.id,
          type: 'memory',
          severity: resources.memoryMB > 2000 ? 'critical' : 'medium',
          description: `High memory usage: ${resources.memoryMB.toFixed(0)}MB`,
          impact: 'May cause GC pressure and memory pressure on system',
          suggestion: 'Review data structures, implement streaming or pagination',
        });
      }

      // High error rate bottleneck
      if (metrics && metrics.errorRate > 0.05) {
        bottlenecks.push({
          componentId: comp.id,
          type: 'algorithmic',
          severity: metrics.errorRate > 0.2 ? 'critical' : 'high',
          description: `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
          impact: 'Reduces system reliability and may cascade failures',
          suggestion: 'Add error handling, retry logic, or fallback mechanisms',
        });
      }
    }

    // Check for dependency bottlenecks (components with many dependents)
    for (const comp of this.components.values()) {
      if (comp.dependents.length >= 5) {
        bottlenecks.push({
          componentId: comp.id,
          type: 'dependency',
          severity: comp.dependents.length >= 10 ? 'high' : 'medium',
          description: `High dependency count: ${comp.dependents.length} components depend on this`,
          impact: 'Single point of failure; changes affect many components',
          suggestion: 'Consider adding redundancy or breaking into smaller services',
        });
      }
    }

    this.bottlenecks = bottlenecks;
    return bottlenecks;
  }

  /** Identify resource waste */
  identifyWaste(): WasteReport[] {
    const wastes: WasteReport[] = [];

    for (const comp of this.components.values()) {
      const resources = comp.resourceUsage;

      if (!resources) continue;

      // Memory waste: high memory with low call frequency
      if (resources.memoryMB > 100 && resources.callsPerSecond < 1) {
        wastes.push({
          componentId: comp.id,
          type: 'memory',
          description: `High memory (${resources.memoryMB.toFixed(0)}MB) with low usage`,
          estimatedWaste: resources.memoryMB * 0.5, // Estimate 50% could be freed
          recommendation: 'Implement lazy loading or reduce cache size',
        });
      }

      // Time waste: high latency with low throughput
      if (resources.latencyMs > 500 && resources.callsPerSecond < 10) {
        wastes.push({
          componentId: comp.id,
          type: 'time',
          description: `High latency (${resources.latencyMs.toFixed(0)}ms) with moderate load`,
          estimatedWaste: resources.latencyMs * resources.callsPerSecond,
          recommendation: 'Optimize hot paths or add caching',
        });
      }

      // Computation waste: high CPU with low throughput
      if (resources.cpuPercent > 50 && resources.callsPerSecond < 5) {
        wastes.push({
          componentId: comp.id,
          type: 'computation',
          description: `High CPU (${resources.cpuPercent.toFixed(1)}%) with low throughput`,
          estimatedWaste: resources.cpuPercent * 0.3,
          recommendation: 'Profile and optimize algorithms',
        });
      }
    }

    // Check for duplicated work (components with similar inputs/outputs)
    const componentList = Array.from(this.components.values());
    for (let i = 0; i < componentList.length; i++) {
      for (let j = i + 1; j < componentList.length; j++) {
        const a = componentList[i];
        const b = componentList[j];
        
        // Check for overlapping functionality
        const commonInputs = a.inputs.filter(x => b.inputs.includes(x));
        const commonOutputs = a.outputs.filter(x => b.outputs.includes(x));
        
        if (commonInputs.length >= 2 && commonOutputs.length >= 1) {
          wastes.push({
            componentId: `${a.id}|${b.id}`,
            type: 'computation',
            description: `Potential duplicate work: ${a.name} and ${b.name} share inputs/outputs`,
            estimatedWaste: 25, // Estimated 25% waste from duplication
            recommendation: 'Consider merging or clarifying responsibilities',
          });
        }
      }
    }

    this.wasteReports = wastes;
    return wastes;
  }

  /** Get identified bottlenecks */
  getBottlenecks(): Bottleneck[] {
    return this.bottlenecks.length > 0 
      ? this.bottlenecks 
      : this.identifyBottlenecks();
  }

  /** Get waste reports */
  getWasteReports(): WasteReport[] {
    return this.wasteReports.length > 0 
      ? this.wasteReports 
      : this.identifyWaste();
  }

  /** Generate architecture summary */
  generateSummary(): {
    totalComponents: number;
    componentsByType: Record<ComponentType, number>;
    totalDataFlows: number;
    bottleneckCount: number;
    wasteCount: number;
  } {
    const byType: Record<ComponentType, number> = {
      reasoning: 0,
      memory: 0,
      learning: 0,
      planning: 0,
      tool: 0,
      communication: 0,
      safety: 0,
      monitoring: 0,
      input: 0,
      output: 0,
      core: 0,
    };

    for (const comp of this.components.values()) {
      byType[comp.type]++;
    }

    return {
      totalComponents: this.components.size,
      componentsByType: byType,
      totalDataFlows: this.dataFlows.length,
      bottleneckCount: this.getBottlenecks().length,
      wasteCount: this.getWasteReports().length,
    };
  }

  /** Export architecture as JSON */
  export(): string {
    return JSON.stringify({
      components: this.getAllComponents(),
      dataFlows: this.getAllDataFlows(),
      bottlenecks: this.getBottlenecks(),
      waste: this.getWasteReports(),
      summary: this.generateSummary(),
    }, null, 2);
  }

  /** Clear all data */
  reset(): void {
    this.components.clear();
    this.dataFlows = [];
    this.bottlenecks = [];
    this.wasteReports = [];
  }
}
