export declare class Neuron {
    id: string;
    name: string;
    value: number;
    learningRate: number;
    states: Map<string, number>;
    connections: Map<string, number>;
    expertGroup: number | null;
    active: boolean;
    constructor(name: string, value?: number, totalValuePoints?: number);
    connectTo(targetNeuronId: string, weight: number): void;
    disconnectFrom(targetNeuronId: string): void;
    adjustValue(delta: number): void;
    activate(input: number): number;
    setAsExpert(): void;
    setAsPlugin(): void;
    getSerializedState(): string;
    static fromSerializedState(serialized: string): Neuron;
}
export type NeuronState = import("../interface/types.js").NeuronState;
