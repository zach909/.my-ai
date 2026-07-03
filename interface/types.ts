export interface NeuronState {
  id: string;
  name: string;
  value: number;
  learningRate: number;
  states: Map<string, number>;
  connections: Map<string, number>;
  expertGroup: number | null;
  active: boolean;
}

export interface NeuronMessage {
  fromId: string;
  toId: string;
  signal: number;
  timestamp: number;
  stateVector: Float64Array;
}

export type ActivationFn = 'relu' | 'sigmoid' | 'tanh' | 'gelu' | 'silu' | 'linear' | 'softmax';

export interface LayerConfig {
  neuronCount: number;
  activationFn: ActivationFn;
  moeEnabled: boolean;
  expertCount: number;
  fullyConnected: boolean;
  hyperdimensional: boolean;
  dimensions: number;
}

export interface ModelConfig {
  name?: string;
  layers?: LayerConfig[];
  quantization: QuantizationConfig;
  valueRange: ValueRangeConfig;
  moe: MoEConfig;
  rlm: RLMConfig;
  totalValuePoints?: number;
}

export interface QuantizationConfig {
  enabled: boolean;
  bits: 2 | 3 | 4 | 5 | 6 | 8 | 16;
  method: 'symmetric' | 'asymmetric' | 'mixed';
  calibrationSamples: number;
  excludeLayers: string[];
}

export interface ValueRangeConfig {
  enabled: boolean;
  totalPoints: number;
  minLearningRate: number;
  maxLearningRate: number;
  redistributionInterval: number;
  decayFactor: number;
}

export interface MoEConfig {
  enabled: boolean;
  numExperts: number;
  topK: number;
  loadBalancingLoss: boolean;
  routerType: string;
  auxiliaryLoss: number;
}

export interface RLMConfig {
  enabled: boolean;
  explorationRate: number;
  discountFactor: number;
  replayBufferSize: number;
  batchSize: number;
  thinkSteps: number;
  rewardShaping: boolean;
}

export interface BuilderProject {
  id: string;
  name: string;
  description: string;
  neurons: Map<string, NeuronState>;
  layers: Map<string, LayerConfig>;
  connections: Map<string, Map<string, number>>;
  labels: Map<string, string>;
  apiOutputConfig: object | null;
  savedWithQuantization: boolean;
}

export interface SystemAccessConfig {
  terminal: boolean;
  fileSystem: boolean;
  multiDesktop: boolean;
  multiMouse: boolean;
  multiKeyboard: boolean;
  desktopCount: number;
  isolateUserInput: boolean;
}

export type EncryptionAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

export type KeyDerivation = 'argon2id' | 'scrypt' | 'pbkdf2';

export interface EncryptionConfig {
  algorithm: EncryptionAlgorithm;
  keyDerivation: KeyDerivation;
  keyLength: number;
  ivLength: number;
  tagLength: number;
}
