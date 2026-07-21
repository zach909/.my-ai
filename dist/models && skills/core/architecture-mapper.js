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
export class ArchitectureMapper {
    constructor() {
        this.components = new Map();
        this.dataFlows = [];
        this.bottlenecks = [];
        this.wasteReports = [];
    }
    /** Register a component in the architecture map */
    registerComponent(component) {
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
    getByType(type) {
        return Array.from(this.components.values()).filter(c => c.type === type);
    }
    /** Get component by ID */
    getComponent(id) {
        return this.components.get(id);
    }
    /** Get all components */
    getAllComponents() {
        return Array.from(this.components.values());
    }
    /** Record a data flow between components */
    recordDataFlow(edge) {
        this.dataFlows.push(edge);
    }
    /** Get all data flows for a component */
    getDataFlows(componentId) {
        return this.dataFlows.filter(e => e.from === componentId || e.to === componentId);
    }
    /** Get full data flow graph */
    getAllDataFlows() {
        return [...this.dataFlows];
    }
    /** Identify bottlenecks based on performance metrics */
    identifyBottlenecks() {
        const bottlenecks = [];
        for (const comp of this.components.values()) {
            const metrics = comp.performanceMetrics;
            const resources = comp.resourceUsage;
            if (!metrics && !resources)
                continue;
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
    identifyWaste() {
        const wastes = [];
        for (const comp of this.components.values()) {
            const resources = comp.resourceUsage;
            if (!resources)
                continue;
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
    getBottlenecks() {
        return this.bottlenecks.length > 0
            ? this.bottlenecks
            : this.identifyBottlenecks();
    }
    /** Get waste reports */
    getWasteReports() {
        return this.wasteReports.length > 0
            ? this.wasteReports
            : this.identifyWaste();
    }
    /** Generate architecture summary */
    generateSummary() {
        const byType = {
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
    export() {
        return JSON.stringify({
            components: this.getAllComponents(),
            dataFlows: this.getAllDataFlows(),
            bottlenecks: this.getBottlenecks(),
            waste: this.getWasteReports(),
            summary: this.generateSummary(),
        }, null, 2);
    }
    /** Clear all data */
    reset() {
        this.components.clear();
        this.dataFlows = [];
        this.bottlenecks = [];
        this.wasteReports = [];
    }
}
