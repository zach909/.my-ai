# Elastic Value Budget

The Elastic Value Budget is a zero-sum neuron value allocation system that enables Prometheus Elastic Core to learn without forgetting.

## Overview

**Purpose**: Manage neuron learning rates based on importance through value ranges.

**Key Principle**: Total neurons = total value points (zero-sum game)

## How It Works

### Value Allocation

Each neuron is assigned a value that determines its stability:

- **Higher Value Neurons**: Change less (stable knowledge)
- **Lower Value Neurons**: Learn more (adaptive learning)

### Learning Rate Formula

```
change_rate ∝ input / value
```

Where:
- More input + less value = more change
- More value + less input = less change

### Zero-Sum Mechanism

The total value budget is fixed. To increase one neuron's value, another must decrease:

1. **Demotion**: Lower-value neurons free up value points
2. **Promotion**: Important neurons receive higher values
3. **Balance**: Total value remains constant

## Benefits

### Learn Without Forgetting

- Stable knowledge is protected by high values
- New information can be learned by low-value neurons
- No catastrophic forgetting of important concepts

### Adaptive Learning

- System automatically adjusts to new information
- Important patterns become more stable over time
- Unused knowledge gradually becomes more flexible

### Example Scenario

When the model encountered a "bad neuron":
1. Identified the neuron as producing poor outputs
2. Demoted the neuron (lowered its value)
3. Freed value points for better neurons
4. System improved without losing other capabilities

## Implementation

### ValueRangeAllocator

The ValueRangeAllocator manages the value budget:

```typescript
class ValueRangeAllocator {
    totalBudget: number;
    neurons: Map<string, Neuron>;
    
    allocate(neuronId: string, newValue: number): void {
        // Calculate value difference
        const diff = newValue - this.neurons.get(neuronId).value;
        
        // Check if within budget
        if (this.currentTotal + diff > this.totalBudget) {
            // Must demote other neurons first
            this.demoteOthers(diff);
        }
        
        // Update neuron value
        this.neurons.get(neuronId).value = newValue;
    }
    
    demoteOthers(amount: number): void {
        // Find lowest-value neurons
        // Reduce their values to free budget
        // Maintain minimum value threshold
    }
}
```

### Neuron Value Updates

Values are updated based on:
- **Usage Frequency**: Frequently used neurons gain value
- **Success Rate**: Successful outputs increase value
- **Error Rate**: Errors decrease value
- **Recency**: Recent activity affects value

## Configuration

### Budget Size

Default total budget is calculated based on:
- Number of neurons
- Desired stability level
- Available memory

### Value Ranges

Typical value ranges:
- **Critical Knowledge**: 80-100
- **Important Patterns**: 50-79
- **General Knowledge**: 20-49
- **Experimental/New**: 1-19

### Tuning Parameters

Adjust these for different behaviors:

| Parameter | Effect |
|-----------|--------|
| Total Budget | Overall system stability |
| Min Value | Flexibility for new learning |
| Max Value | Protection for critical knowledge |
| Decay Rate | How quickly unused neurons lose value |

## Use Cases

### Protecting Core Capabilities

High-value neurons protect:
- Basic language understanding
- Fundamental reasoning
- Safety constraints
- User preferences

### Rapid Skill Acquisition

Low-value neurons enable:
- Quick learning of new topics
- Experimental connections
- Temporary context
- Novel associations

### Balancing Stability and Plasticity

The system maintains balance between:
- **Stability**: Preserving important knowledge
- **Plasticity**: Adapting to new information

## Monitoring

### Value Distribution

Track value distribution across neurons:
```
Value Range    | Neurons | Percentage
---------------|---------|------------
80-100         | 1,250   | 12.5%
50-79          | 3,500   | 35.0%
20-49          | 4,000   | 40.0%
1-19           | 1,250   | 12.5%
```

### Learning Metrics

Monitor:
- Value changes over time
- Learning rate per value range
- Stability of high-value neurons
- Adaptation speed of low-value neurons

## Best Practices

1. **Start Conservative**: Begin with moderate values
2. **Monitor Distribution**: Ensure healthy value spread
3. **Adjust Gradually**: Make small budget adjustments
4. **Protect Criticals**: Keep essential neurons high-value
5. **Allow Experimentation**: Reserve budget for new learning

## Troubleshooting

### System Too Rigid

Symptoms: Cannot learn new information
Solution: Increase low-value neuron budget

### System Too Unstable

Symptoms: Forgets important knowledge
Solution: Increase high-value neuron protection

### Value Oscillation

Symptoms: Values fluctuate wildly
Solution: Reduce update frequency, increase thresholds

## See Also

- [[Home]] - Main wiki page
- [[Architecture]] - System architecture
- [[Quantization]] - Model quantization
- [[Neuron-Mesh]] - All-to-all connectivity
- [[RLM]] - Reinforcement learning module

---

*The Elastic Value Budget is key to Prometheus Elastic Core's ability to continuously learn while preserving important knowledge.*
