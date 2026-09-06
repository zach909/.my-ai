# Neuroclaw Testing Guide

## Overview

This guide covers testing the Neuroclaw AI system across all components. Tests verify correctness, safety, integration, and performance.

## Test Categories

### 1. Unit Tests

Each component tested in isolation.

#### Mesh Engine
```typescript
describe('Elastic Mesh', () => {
  it('should maintain vale conservation', () => {
    const mesh = new ElasticMesh({ totalVale: 1000 });
    const initial = mesh.getState().neurons.reduce((s, n) => s + n.vale, 0);
    mesh.learnHebbian(0.01);
    const final = mesh.getState().neurons.reduce((s, n) => s + n.vale, 0);
    expect(final).toBe(initial); // Vale conserved
  });

  it('should settle on repeated propagation', () => {
    const mesh = new ElasticMesh();
    mesh.injectInput([1.0, 0.5, 0.2], 0.5);
    const ticks = mesh.propagate(50);
    expect(mesh.isSettled).toBe(true);
    expect(ticks).toBeLessThan(50);
  });
});
```

#### Alignment Veto
```typescript
describe('Alignment Veto', () => {
  it('should block forbidden actions', () => {
    const veto = new AlignmentVeto();
    const result = veto.checkVeto({ action: 'delete_file' });
    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe('high');
  });

  it('should respect resource limits', () => {
    const veto = new AlignmentVeto();
    const result = veto.checkVeto({
      action: 'compute',
      estimatedResources: { memoryMB: 5000 }
    });
    expect(result.allowed).toBe(false);
  });
});
```

#### Empathy Engine
```typescript
describe('Empathy Engine', () => {
  it('should detect positive sentiment', () => {
    const empathy = new EmpathyEngine();
    const emotion = empathy.analyzeEmotion('This is wonderful!');
    expect(emotion.valence).toBeGreaterThan(0);
  });

  it('should track emotional history', () => {
    const empathy = new EmpathyEngine();
    empathy.updateUserContext('Happy input');
    empathy.updateUserContext('Sad input');
    const context = empathy.getUserContext();
    expect(context.emotionalHistory.length).toBe(2);
  });
});
```

### 2. Integration Tests

Component interactions tested together.

#### Mesh + Vale System
```typescript
it('should learn with vale-adjusted rates', () => {
  const mesh = new ElasticMesh({ totalVale: 1000, neuronCount: 10 });
  
  // Give one neuron high vale (stable)
  mesh.transferVale('n1', 'n2', 400);
  
  // Learning should affect n2 more than n1
  mesh.learnHebbian(0.01);
  
  // Verify vale is still conserved
  const state = mesh.getState();
  const totalVale = state.neurons.reduce((s, n) => s + n.vale, 0);
  expect(totalVale).toBe(1000);
});
```

#### Pipeline + Veto + Empathy
```typescript
it('should process query through safety gate', async () => {
  const system = new NeuroclawSystem();
  await system.initialize();
  
  // User happy → more action freedom
  system.empathy.updateUserContext('Great! Please continue.');
  const alignment1 = system.empathy.getAlignmentScore();
  
  // Attempt action
  const decision1 = system.veto.evaluate(
    { id: 'a1', name: 'write_file', capabilities: [], reversible: false },
  );
  
  // User unhappy → more cautious
  system.empathy.updateUserContext('This is terrible!');
  const alignment2 = system.empathy.getAlignmentScore();
  
  // Same action now blocked by higher veto
  const decision2 = system.veto.evaluate(
    { id: 'a2', name: 'write_file', capabilities: [], reversible: false },
  );
  
  expect(alignment1).toBeGreaterThan(alignment2);
  expect(decision1.confidence).toBeGreaterThan(decision2.confidence);
});
```

#### MoE + Plugin Registry
```typescript
it('should route to appropriate expert', async () => {
  const system = new NeuroclawSystem();
  await system.initialize();
  
  const input = "Browse the web";
  const result = await system.pipeline.run(
    encodeInput(input),
    { alignment: 0.8 }
  );
  
  // Should select browser expert
  expect(result.selectedPlugins).toContain('browser');
});
```

### 3. Safety Tests

Verify security and alignment systems work correctly.

#### Veto Enforcement
```typescript
describe('Veto Safety', () => {
  it('should block system-level operations', () => {
    const veto = new AlignmentVeto();
    const dangerous = [
      'format_drive',
      'modify_system_settings',
      'access_other_users'
    ];
    
    for (const action of dangerous) {
      const result = veto.checkVeto({ action });
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe('blocked');
    }
  });

  it('should require approval for risky actions', () => {
    const veto = new AlignmentVeto();
    
    // First attempt should be blocked
    let result = veto.checkVeto({
      action: 'write_file',
      target: '/home/data.txt'
    });
    expect(result.allowed).toBe(false);
    
    // After approval, should be allowed
    veto.approveAction('write_file', '/home/data.txt');
    result = veto.checkVeto({
      action: 'write_file',
      target: '/home/data.txt'
    });
    expect(result.allowed).toBe(true);
  });

  it('should log all veto decisions', () => {
    const veto = new AlignmentVeto();
    
    veto.checkVeto({ action: 'read_file', target: '/etc/passwd' });
    veto.checkVeto({ action: 'compute', estimatedResources: { memoryMB: 4000 } });
    
    const log = veto.getVetoLog();
    expect(log.length).toBe(2);
    expect(log[0].result.allowed).toBe(false); // Protected file
    expect(log[1].result.allowed).toBe(false); // Over memory limit
  });
});
```

### 4. Performance Tests

Benchmark system performance.

#### Mesh Propagation Speed
```typescript
it('should propagate 32-neuron mesh in <10ms', () => {
  const mesh = new ElasticMesh({ neuronCount: 32 });
  mesh.injectInput([1.0, 0.5, 0.2, 0.1], 0.5);
  
  const start = performance.now();
  mesh.propagate(50);
  const elapsed = performance.now() - start;
  
  expect(elapsed).toBeLessThan(10);
});
```

#### Veto Evaluation Speed
```typescript
it('should evaluate veto in <1ms', () => {
  const veto = new AlignmentVeto();
  
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    veto.checkVeto({ action: 'read_file', target: '/tmp/test' });
  }
  const elapsed = performance.now() - start;
  
  expect(elapsed / 1000).toBeLessThan(1); // Average <1ms
});
```

#### ZIP-IO Throughput
```typescript
it('should handle 100MB/s throughput', async () => {
  const zipIO = new ZipIOSystem(1000);
  const data = Buffer.alloc(1024 * 1024, 'x'); // 1MB
  
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    await zipIO.write(data);
  }
  const elapsed = performance.now() - start;
  
  const throughput = (100 * 1024) / elapsed; // MB/s
  expect(throughput).toBeGreaterThan(100);
});
```

### 5. End-to-End Tests

Complete workflows from user input to output.

#### Query Processing
```typescript
describe('End-to-End Query Processing', () => {
  it('should process complete query flow', async () => {
    const system = new NeuroclawSystem();
    await system.initialize();
    
    // Step 1: User input
    const query = "What's the weather?";
    
    // Step 2: Empathy analysis
    system.empathy.updateUserContext(query);
    const alignment = system.empathy.getAlignmentScore();
    
    // Step 3: Input buffering
    await system.zipIO.write(query);
    
    // Step 4: Pipeline processing
    const result = await system.pipeline.run(
      encodeQuery(query),
      { alignment }
    );
    
    // Step 5: Safety check
    const decision = system.veto.evaluate(
      {
        id: 'weather',
        name: 'query_weather',
        capabilities: ['network'],
        reversible: true
      },
    );
    
    // Step 6: Dispatch if approved
    if (decision.allowed) {
      const response = await system.pluginRegistry.dispatch(
        query,
        'query'
      );
      expect(response).toBeDefined();
    }
    
    // Step 7: Output buffering
    await system.zipIO.emit(JSON.stringify(result));
    
    // Verify complete flow
    expect(alignment).toBeGreaterThanOrEqual(0);
    expect(alignment).toBeLessThanOrEqual(1);
    expect(result).toBeDefined();
    expect(decision).toBeDefined();
  });
});
```

## Running Tests

### All Tests
```bash
npm test
```

### Specific Component
```bash
npm test -- mesh-engine.test.ts
npm test -- alignment-veto.test.ts
npm test -- integration.test.ts
```

### With Coverage
```bash
npm test -- --coverage
```

### Performance Profile
```bash
npm test -- --perf
```

## Test Utilities

### Mock Helpers
```typescript
// Create mock mesh for testing
function createMockMesh() {
  return new ElasticMesh({
    neuronCount: 8,
    dimensions: 2,
    totalVale: 400
  });
}

// Create test query
function createTestQuery() {
  return "Test query for analysis";
}

// Create test policy
function createRestrictivePolicy() {
  return new AlignmentVeto().getActivePolicy();
}
```

### Assertion Helpers
```typescript
// Assert vale conservation
function assertValeConserved(mesh) {
  const state = mesh.getState();
  const total = state.neurons.reduce((s, n) => s + n.vale, 0);
  expect(total).toBe(mesh.config.totalVale);
}

// Assert mesh settled
function assertMeshSettled(mesh) {
  expect(mesh.isSettled).toBe(true);
  expect(mesh.getStats().lastMaxDelta).toBeLessThan(0.001);
}

// Assert veto allowed
function assertActionAllowed(veto, action) {
  const result = veto.checkVeto(action);
  expect(result.allowed).toBe(true);
  expect(result.riskLevel).toBe('safe');
}
```

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Neuroclaw Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v2
```

### Coverage Targets
- **Overall:** >80%
- **Core Systems:** >90%
- **Safety Systems:** >95%
- **Plugin Dispatch:** >85%

## Testing Checklist

- [ ] Mesh propagation settles correctly
- [ ] Vale is conserved through learning
- [ ] Veto blocks forbidden actions
- [ ] Veto respects resource constraints
- [ ] Empathy tracks user emotion
- [ ] Alignment score updates correctly
- [ ] ZIP-IO handles circular wraparound
- [ ] MoE routes to correct experts
- [ ] Plugins activate and dispatch correctly
- [ ] Extensions persist through save/load
- [ ] Quantization maintains accuracy
- [ ] Pipeline processes end-to-end
- [ ] Alignment veto integrates with pipeline
- [ ] User approvals work correctly
- [ ] Performance meets targets (<150ms pipeline)
- [ ] No memory leaks in long runs

## Debugging Tips

### Enable Verbose Logging
```typescript
const mesh = new ElasticMesh();
(mesh as any).debug = true; // Internal debug mode

const veto = new AlignmentVeto();
const log = veto.getVetoLog(50); // View last 50 decisions
```

### Inspect Mesh State
```typescript
const state = mesh.getState();
console.log('Neurons:', state.neurons.length);
console.log('Ticks:', state.tickCount);
console.log('Settled:', state.settledTicks);

const stats = mesh.getStats();
console.log('Active:', stats.activeNeurons);
console.log('Mean activation:', stats.meanActivation);
console.log('Vale entropy:', stats.valeEntropy);
```

### Trace Veto Decisions
```typescript
const stats = veto.getVetoStats();
console.log(`Veto rate: ${(stats.vetoRate * 100).toFixed(1)}%`);
console.log(`Allowed: ${stats.allowedActions}`);
console.log(`Blocked: ${stats.vetoedActions}`);

const recent = veto.getVetoLog(10);
for (const entry of recent) {
  console.log(`${entry.intent.action}: ${entry.result.allowed ? '✓' : '✗'}`);
}
```

## Test Coverage

### System Coverage Map
```
alignment-veto.ts          95%
  - checkVeto
  - evaluate
  - resource checks
  - file access
  - user approval

mesh-engine.ts             90%
  - propagate
  - inject input
  - learn hebbian
  - vale transfer
  - settlement

empathy.ts                 85%
  - emotion analysis
  - context update
  - alignment tracking
  - sync emotion

moe-router.ts              80%
  - expert selection
  - routing
  - load balancing

pipeline.ts                75%
  - component orchestration
  - step tracking
  - output generation

plugins/                   70%
  - individual plugins
  - dispatch
  - lifecycle
```
