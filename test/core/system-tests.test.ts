/**
 * Test suite for ArchitectureMapper and PerformanceMonitor.
 * Implements PHASE 2 steps 23-34: Automated testing framework.
 */

import { ArchitectureMapper } from '../../models && skills/core/architecture-mapper.js';
import { PerformanceMonitor } from '../../models && skills/core/performance-monitor.js';
import { MistakeTracker } from '../../models && skills/core/mistake-tracker.js';
import { SelfImprovement } from '../../models && skills/core/self-improvement.js';

describe('ArchitectureMapper', () => {
  let mapper: ArchitectureMapper;

  beforeEach(() => {
    mapper = new ArchitectureMapper();
  });

  test('should register components', () => {
    mapper.registerComponent({
      id: 'reasoning-engine',
      name: 'Reasoning Engine',
      type: 'reasoning',
      description: 'Core reasoning system',
      dependencies: [],
      dependents: [],
      inputs: ['query'],
      outputs: ['answer'],
    });

    expect(mapper.getComponent('reasoning-engine')).toBeDefined();
    expect(mapper.getAllComponents()).toHaveLength(1);
  });

  test('should track component dependencies', () => {
    mapper.registerComponent({
      id: 'memory',
      name: 'Memory System',
      type: 'memory',
      description: 'Long-term memory',
      dependencies: [],
      dependents: [],
      inputs: ['key'],
      outputs: ['value'],
    });

    mapper.registerComponent({
      id: 'reasoning',
      name: 'Reasoning',
      type: 'reasoning',
      description: 'Reasoning engine',
      dependencies: ['memory'],
      dependents: [],
      inputs: ['query'],
      outputs: ['answer'],
    });

    const memory = mapper.getComponent('memory');
    expect(memory?.dependents).toContain('reasoning');
  });

  test('should identify bottlenecks', () => {
    mapper.registerComponent({
      id: 'slow-component',
      name: 'Slow Component',
      type: 'core',
      description: 'A slow component',
      dependencies: [],
      dependents: [],
      inputs: [],
      outputs: [],
      performanceMetrics: {
        avgLatency: 6000,
        p95Latency: 8000,
        p99Latency: 10000,
        errorRate: 0.1,
        throughput: 10,
      },
    });

    const bottlenecks = mapper.identifyBottlenecks();
    expect(bottlenecks.length).toBeGreaterThan(0);
    expect(bottlenecks.some(b => b.severity === 'critical')).toBe(true);
  });

  test('should identify resource waste', () => {
    mapper.registerComponent({
      id: 'wasteful',
      name: 'Wasteful Component',
      type: 'core',
      description: 'Wastes resources',
      dependencies: [],
      dependents: [],
      inputs: [],
      outputs: [],
      resourceUsage: {
        memoryMB: 500,
        cpuPercent: 80,
        latencyMs: 100,
        callsPerSecond: 0.5,
      },
    });

    const wastes = mapper.identifyWaste();
    expect(wastes.length).toBeGreaterThan(0);
  });

  test('should generate summary', () => {
    mapper.registerComponent({
      id: 'comp1',
      name: 'Component 1',
      type: 'reasoning',
      description: 'Test',
      dependencies: [],
      dependents: [],
      inputs: [],
      outputs: [],
    });

    mapper.registerComponent({
      id: 'comp2',
      name: 'Component 2',
      type: 'memory',
      description: 'Test',
      dependencies: [],
      dependents: [],
      inputs: [],
      outputs: [],
    });

    const summary = mapper.generateSummary();
    expect(summary.totalComponents).toBe(2);
    expect(summary.componentsByType.reasoning).toBe(1);
    expect(summary.componentsByType.memory).toBe(1);
  });
});

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  test('should record metrics', () => {
    monitor.record('cpu', 45.5, '%');
    monitor.record('cpu', 50.2, '%');

    const history = monitor.getMetricHistory('cpu');
    expect(history).toHaveLength(2);
    expect(history[0].value).toBe(45.5);
  });

  test('should update component metrics', () => {
    monitor.updateComponentMetrics({
      componentId: 'test-comp',
      cpuPercent: 75,
      memoryMB: 512,
      latencyMs: 100,
      throughput: 100,
      errorRate: 0.01,
      lastUpdated: Date.now(),
    });

    const metrics = monitor.getComponentMetrics('test-comp');
    expect(metrics).toBeDefined();
    expect(metrics?.cpuPercent).toBe(75);
  });

  test('should detect anomalies', () => {
    monitor.updateComponentMetrics({
      componentId: 'high-cpu',
      cpuPercent: 98,
      memoryMB: 100,
      latencyMs: 50,
      throughput: 10,
      errorRate: 0.01,
      lastUpdated: Date.now(),
    });

    const anomalies = monitor.getAnomalies();
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.some(a => a.severity === 'critical')).toBe(true);
  });

  test('should track prediction accuracy', () => {
    monitor.recordPrediction('latency-prediction', 100, 105);
    monitor.recordPrediction('latency-prediction', 100, 95);
    monitor.recordPrediction('latency-prediction', 100, 150);

    const accuracy = monitor.getPredictionAccuracy('latency-prediction');
    expect(accuracy).not.toBeNull();
    expect(accuracy!.count).toBe(3);
    expect(accuracy!.avgAccuracy).toBeLessThan(1);
  });

  test('should calculate metric statistics', () => {
    for (let i = 0; i < 100; i++) {
      monitor.record('response-time', i * 10, 'ms');
    }

    const stats = monitor.getMetricStats('response-time');
    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(0);
    expect(stats!.max).toBe(990);
    expect(stats!.avg).toBeCloseTo(495, -1);
  });

  test('should report system health', () => {
    monitor.updateComponentMetrics({
      componentId: 'comp1',
      cpuPercent: 50,
      memoryMB: 256,
      latencyMs: 100,
      throughput: 50,
      errorRate: 0.01,
      lastUpdated: Date.now(),
    });

    monitor.updateComponentMetrics({
      componentId: 'comp2',
      cpuPercent: 60,
      memoryMB: 512,
      latencyMs: 150,
      throughput: 75,
      errorRate: 0.02,
      lastUpdated: Date.now(),
    });

    const health = monitor.getSystemHealth();
    expect(health.status).toBe('healthy');
    expect(health.activeComponents).toBe(2);
    expect(health.overallCpu).toBeCloseTo(55, 0);
  });

  test('should limit metric history', () => {
    for (let i = 0; i < 1500; i++) {
      monitor.record('test-metric', i, '');
    }

    const history = monitor.getMetricHistory('test-metric');
    expect(history.length).toBeLessThanOrEqual(1000);
  });
});

describe('MistakeTracker Integration', () => {
  let tracker: MistakeTracker;

  beforeEach(() => {
    tracker = new MistakeTracker();
  });

  test('should track mistakes by cause', () => {
    tracker.record({
      task: 'Solve math problem',
      description: 'Incorrect calculation',
      cause: 'reasoning',
    });

    tracker.record({
      task: 'Recall fact',
      description: 'Wrong memory retrieval',
      cause: 'bad-memory',
    });

    const breakdown = tracker.causeBreakdown();
    expect(breakdown.reasoning).toBe(1);
    expect(breakdown['bad-memory']).toBe(1);
  });

  test('should find similar mistakes', () => {
    tracker.record({
      task: 'Calculate derivative',
      description: 'Wrong formula applied',
      cause: 'missing-knowledge',
    });

    const similar = tracker.similar('Calculate integral');
    expect(similar.length).toBeGreaterThan(0);
  });

  test('should extract lessons', () => {
    tracker.record({
      task: 'Plan execution',
      description: 'Failed to consider edge case',
      cause: 'reasoning',
      prevention: 'Always check boundary conditions',
    });

    const lessons = tracker.lessons('Execute plan');
    expect(lessons).toContain('Always check boundary conditions');
  });
});

describe('SelfImprovement Integration', () => {
  let improvement: SelfImprovement;

  beforeEach(() => {
    improvement = new SelfImprovement({ margin: 0.01 });
  });

  test('should evaluate improvements', async () => {
    const result = await improvement.evaluate(
      'test-target',
      'Test improvement',
      () => 0.75,
      () => 0.85
    );

    expect(result.kept).toBe(true);
    expect(result.baselineScore).toBe(0.75);
    expect(result.candidateScore).toBe(0.85);
  });

  test('should reject small improvements below margin', async () => {
    const result = await improvement.evaluate(
      'test-target',
      'Marginal improvement',
      () => 0.75,
      () => 0.755
    );

    expect(result.kept).toBe(false);
  });

  test('should track kept improvements', async () => {
    await improvement.evaluate('target1', 'Good improvement', () => 0.5, () => 0.7);
    await improvement.evaluate('target2', 'Bad improvement', () => 0.8, () => 0.7);

    const kept = improvement.kept();
    expect(kept.length).toBe(1);
    expect(kept[0].description).toBe('Good improvement');
  });
});
