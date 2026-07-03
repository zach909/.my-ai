export class Neuron {
  public id: string;
  public name: string;
  public value: number;
  public learningRate: number;
  public states: Map<string, number>;
  public connections: Map<string, number>;
  public expertGroup: number | null;
  public active: boolean;

  constructor(name: string, value: number = 0, totalValuePoints: number = 1000) {
    this.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.name = name;
    this.value = value;
    this.learningRate = 0.01 - (value / totalValuePoints) * 0.0099;
    this.states = new Map();
    this.connections = new Map();
    this.expertGroup = null;
    this.active = true;
  }

  connectTo(targetNeuronId: string, weight: number): void {
    this.connections.set(targetNeuronId, weight);
  }

  disconnectFrom(targetNeuronId: string): void {
    this.connections.delete(targetNeuronId);
  }

  adjustValue(delta: number): void {
    this.value = Math.max(0, this.value + delta);
  }

  activate(input: number): number {
    const weightedInput = input + Array.from(this.connections.values()).reduce((s, w) => s + w * input, 0);
    const activation = 1 / (1 + Math.exp(-weightedInput));
    this.states.set('activation', activation);
    this.states.set('energy', activation * this.value);
    return activation;
  }

  setAsExpert(): void { this.expertGroup = 1; }
  setAsPlugin(): void { this.expertGroup = 2; }

  getSerializedState(): string {
    return JSON.stringify({
      id: this.id, name: this.name, value: this.value,
      learningRate: this.learningRate,
      states: Object.fromEntries(this.states),
      connections: Object.fromEntries(this.connections),
      expertGroup: this.expertGroup, active: this.active,
    });
  }

  static fromSerializedState(serialized: string): Neuron {
    const data = JSON.parse(serialized);
    const n = new Neuron(data.name, data.value);
    n.id = data.id; n.learningRate = data.learningRate;
    n.states = new Map(Object.entries(data.states || {}));
    n.connections = new Map(Object.entries(data.connections || {}));
    n.expertGroup = data.expertGroup; n.active = data.active;
    return n;
  }
}

export type NeuronState = import("../interface/types.js").NeuronState;
