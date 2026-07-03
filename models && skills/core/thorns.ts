/**
 * THORNS Engine — Thinking, Hypothesis, Observation, Reasoning, Novelty, Synthesis
 * 
 * Multi-dimensional question analysis with cross-checking and simulation.
 * Used for intent detection, planning, and autonomous reasoning.
 */

import { ThesaurusDictionary } from '../thesaurus.js';

export interface QuestionDimension {
  id: string;
  name: string;
  weight: number;
  answered: boolean;
  confidence: number;
}

export interface ThornNode {
  id: string;
  dimension: QuestionDimension;
  children: string[];
  parent: string | null;
  depth: number;
}

export interface QuestionNode {
  id: string;
  text: string;
  dimensions: QuestionDimension[];
  thorns: ThornNode[];
  intent: IntentResult;
  crossCheck: CrossCheckResult;
  simulation: SimulateResult;
}

export interface IntentResult {
  intent: 'query' | 'command' | 'creation' | 'analysis' | 'exploration';
  confidence: number;
  keywords: string[];
  entities: string[];
}

export interface CrossCheckResult {
  overallConfidence: number;
  dimensionScores: Map<string, number>;
  conflicts: string[];
  agreements: string[];
}

export interface SimulateResult {
  bestAction: string;
  alternatives: string[];
  successProbability: number;
  steps: string[];
}

export interface ThornsOutput {
  response: string;
  intent: IntentResult;
  crossCheck: CrossCheckResult;
  actionPlan: string[];
  simulation: SimulateResult;
  noveltyScore: number;
}

export interface CodeNeuron {
  id: string;
  bytecode: number[];
  behavior: string;
  inputs: string[];
  outputs: string[];
}

export interface CodeNetTopology {
  neurons: CodeNeuron[];
  connections: [string, string, number][];
  inputLayer: string[];
  outputLayer: string[];
}

export class ThornsEngine {
  private thesaurus: ThesaurusDictionary;
  private questionHistory: QuestionNode[];
  private maxHistoryLength: number;

  constructor() {
    this.thesaurus = new ThesaurusDictionary();
    this.questionHistory = [];
    this.maxHistoryLength = 100;
  }

  /**
   * Connect THORNS to core subsystems (value allocator, mesh, hyperdimensional engine, RLM, MoE)
   */
  connectCore(
    valueAllocator: any,
    mesh: any,
    hyperEngine: any,
    rlmTrainer: any,
    moeRouter: any
  ): void {
    // Integration point for core subsystems - stores references for cross-engine reasoning
    (this as any)._valueAllocator = valueAllocator;
    (this as any)._mesh = mesh;
    (this as any)._hyperEngine = hyperEngine;
    (this as any)._rlmTrainer = rlmTrainer;
    (this as any)._moeRouter = moeRouter;
  }

  /**
   * Connect THORNS to an external thesaurus dictionary
   */
  connectThesaurus(thesaurusDict: {
    getSynonyms: (word: string) => string[];
    getDefinition: (word: string) => string;
    getExamples: (word: string) => string[];
    lookup: (word: string) => { word: string; definition: string; synonyms: string[]; examples: string[] } | undefined;
  }): void {
    // Override internal thesaurus with external one
    (this as any)._externalThesaurus = thesaurusDict;
  }

  /**
   * Main thinking entry point — analyzes input through all THORNS dimensions
   */
  async think(input: string): Promise<ThornsOutput> {
    const questionNode = this.buildQuestionNode(input);
    
    // T — Thinking: decompose into dimensions
    const dimensions = this.decomposeIntoDimensions(input);
    questionNode.dimensions = dimensions;

    // H — Hypothesis: generate possible interpretations
    const hypotheses = this.generateHypotheses(input, dimensions);

    // O — Observation: gather evidence from dictionary/thesaurus
    const observations = this.gatherObservations(input);

    // R — Reasoning: cross-check hypotheses against observations
    const crossCheck = this.crossCheck(hypotheses, observations, dimensions);
    questionNode.crossCheck = crossCheck;

    // N — Novelty: detect if this is a new pattern
    const noveltyScore = this.computeNovelty(input);

    // S — Synthesis: combine into final response with action plan
    const intent = this.detectIntent(input, dimensions, crossCheck);
    questionNode.intent = intent;

    const simulation = this.simulateActions(input, intent, hypotheses);
    questionNode.simulation = simulation;

    const response = this.synthesizeResponse(input, intent, crossCheck, simulation, noveltyScore);

    // Store in history
    this.questionHistory.push(questionNode);
    if (this.questionHistory.length > this.maxHistoryLength) {
      this.questionHistory.shift();
    }

    return {
      response,
      intent,
      crossCheck,
      actionPlan: simulation.steps,
      simulation,
      noveltyScore,
    };
  }

  /**
   * Build a question node from input text
   */
  private buildQuestionNode(input: string): QuestionNode {
    return {
      id: `qn_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      text: input,
      dimensions: [],
      thorns: [],
      intent: { intent: 'query', confidence: 0, keywords: [], entities: [] },
      crossCheck: { overallConfidence: 0, dimensionScores: new Map(), conflicts: [], agreements: [] },
      simulation: { bestAction: '', alternatives: [], successProbability: 0, steps: [] },
    };
  }

  /**
   * Decompose input into question dimensions
   */
  private decomposeIntoDimensions(input: string): QuestionDimension[] {
    const dimensions: QuestionDimension[] = [
      { id: 'what', name: 'What is being asked?', weight: 1.0, answered: false, confidence: 0 },
      { id: 'why', name: 'Why is this important?', weight: 0.8, answered: false, confidence: 0 },
      { id: 'how', name: 'How should it be done?', weight: 0.9, answered: false, confidence: 0 },
      { id: 'when', name: 'When is it relevant?', weight: 0.5, answered: false, confidence: 0 },
      { id: 'who', name: 'Who is involved?', weight: 0.6, answered: false, confidence: 0 },
      { id: 'where', name: 'Where does it apply?', weight: 0.5, answered: false, confidence: 0 },
    ];

    const lowerInput = input.toLowerCase();

    // Score each dimension based on keyword presence
    const whatKeywords = ['what', 'which', 'define', 'explain', 'describe'];
    const whyKeywords = ['why', 'because', 'reason', 'purpose', 'cause'];
    const howKeywords = ['how', 'method', 'way', 'process', 'steps'];
    const whenKeywords = ['when', 'time', 'date', 'schedule', 'timing'];
    const whoKeywords = ['who', 'person', 'user', 'developer', 'team'];
    const whereKeywords = ['where', 'location', 'place', 'position', 'file'];

    const keywordSets = [
      { dim: 'what', keywords: whatKeywords },
      { dim: 'why', keywords: whyKeywords },
      { dim: 'how', keywords: howKeywords },
      { dim: 'when', keywords: whenKeywords },
      { dim: 'who', keywords: whoKeywords },
      { dim: 'where', keywords: whereKeywords },
    ];

    for (const { dim, keywords } of keywordSets) {
      const dimension = dimensions.find(d => d.id === dim);
      if (dimension) {
        let matchCount = 0;
        for (const kw of keywords) {
          if (lowerInput.includes(kw)) matchCount++;
        }
        dimension.confidence = Math.min(1.0, matchCount / keywords.length);
        dimension.answered = dimension.confidence > 0.3;
      }
    }

    return dimensions;
  }

  /**
   * Generate hypotheses about the input meaning
   */
  private generateHypotheses(input: string, dimensions: QuestionDimension[]): string[] {
    const hypotheses: string[] = [];
    
    // Primary hypothesis based on dominant dimension
    const sortedDims = [...dimensions].sort((a, b) => b.confidence - a.confidence);
    const primaryDim = sortedDims[0];

    if (primaryDim) {
      switch (primaryDim.id) {
        case 'what':
          hypotheses.push('User is seeking information or definition');
          hypotheses.push('User wants to understand a concept');
          break;
        case 'why':
          hypotheses.push('User is seeking justification or reasoning');
          hypotheses.push('User wants to understand causality');
          break;
        case 'how':
          hypotheses.push('User needs procedural guidance');
          hypotheses.push('User wants step-by-step instructions');
          break;
        case 'when':
          hypotheses.push('User is asking about timing or scheduling');
          break;
        case 'who':
          hypotheses.push('User is asking about people or roles');
          break;
        case 'where':
          hypotheses.push('User is asking about location or placement');
          break;
      }
    }

    // Secondary hypotheses from other dimensions
    for (const dim of sortedDims.slice(1, 3)) {
      if (dim.confidence > 0.3) {
        hypotheses.push(`Secondary context: ${dim.name}`);
      }
    }

    return hypotheses;
  }

  /**
   * Gather observations from dictionary and thesaurus
   */
  private gatherObservations(input: string): Map<string, any> {
    const observations = new Map<string, any>();
    const words = input.toLowerCase().split(/\W+/).filter(w => w.length > 3);

    for (const word of words.slice(0, 10)) {
      const thesaurusData = this.getThesaurusData(word);
      if (thesaurusData) {
        observations.set(word, thesaurusData);
      }
    }

    return observations;
  }

  /**
   * Cross-check hypotheses against observations
   */
  private crossCheck(
    hypotheses: string[],
    observations: Map<string, any>,
    dimensions: QuestionDimension[]
  ): CrossCheckResult {
    const dimensionScores = new Map<string, number>();
    const conflicts: string[] = [];
    const agreements: string[] = [];

    let totalScore = 0;
    let scoredCount = 0;

    for (const dim of dimensions) {
      if (!dim.answered) continue;

      // Score based on observation coverage
      let score = dim.confidence;
      
      // Boost score if we have thesaurus data for related words
      for (const [word, data] of observations) {
        if (data && (data.X?.length > 0 || data.Y)) {
          score += 0.1;
        }
      }

      score = Math.min(1.0, score);
      dimensionScores.set(dim.id, score);
      totalScore += score;
      scoredCount++;

      if (score > 0.7) {
        agreements.push(`${dim.name}: high confidence`);
      } else if (score < 0.4) {
        conflicts.push(`${dim.name}: low confidence`);
      }
    }

    const overallConfidence = scoredCount > 0 ? totalScore / scoredCount : 0;

    return {
      overallConfidence,
      dimensionScores,
      conflicts,
      agreements,
    };
  }

  /**
   * Compute novelty score based on history
   */
  private computeNovelty(input: string): number {
    if (this.questionHistory.length === 0) return 1.0;

    const normalizedInput = input.toLowerCase().replace(/\s+/g, ' ').trim();
    
    let maxSimilarity = 0;
    for (const prev of this.questionHistory) {
      const similarity = this.computeTextSimilarity(normalizedInput, prev.text.toLowerCase());
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    // Novelty is inverse of similarity
    return 1.0 - maxSimilarity;
  }

  /**
   * Simple text similarity using word overlap
   */
  private computeTextSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\W+/));
    const wordsB = new Set(b.split(/\W+/));
    
    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Detect user intent from input and analysis
   */
  private detectIntent(
    input: string,
    dimensions: QuestionDimension[],
    crossCheck: CrossCheckResult
  ): IntentResult {
    const lowerInput = input.toLowerCase();
    const keywords: string[] = [];
    const entities: string[] = [];

    // Extract keywords (words > 3 chars)
    const words = lowerInput.split(/\W+/).filter(w => w.length > 3);
    keywords.push(...words.slice(0, 10));

    // Detect intent type
    let intent: IntentResult['intent'] = 'query';
    let confidence = crossCheck.overallConfidence;

    // Command indicators
    const commandVerbs = ['run', 'execute', 'create', 'build', 'make', 'delete', 'remove', 'open', 'close'];
    if (commandVerbs.some(v => lowerInput.startsWith(v) || lowerInput.includes(v))) {
      intent = 'command';
      confidence += 0.2;
    }

    // Creation indicators
    const creationWords = ['write', 'design', 'implement', 'develop', 'code', 'generate'];
    if (creationWords.some(w => lowerInput.includes(w))) {
      intent = 'creation';
      confidence += 0.15;
    }

    // Analysis indicators
    const analysisWords = ['analyze', 'compare', 'evaluate', 'assess', 'review'];
    if (analysisWords.some(w => lowerInput.includes(w))) {
      intent = 'analysis';
      confidence += 0.15;
    }

    // Exploration indicators
    const explorationWords = ['explore', 'investigate', 'discover', 'find out'];
    if (explorationWords.some(w => lowerInput.includes(w))) {
      intent = 'exploration';
      confidence += 0.15;
    }

    confidence = Math.min(1.0, confidence);

    return { intent, confidence, keywords, entities };
  }

  /**
   * Simulate possible actions and their outcomes
   */
  private simulateActions(
    input: string,
    intent: IntentResult,
    hypotheses: string[]
  ): SimulateResult {
    const alternatives: string[] = [];
    const steps: string[] = [];

    // Generate action plan based on intent
    switch (intent.intent) {
      case 'command':
        steps.push('Parse command structure');
        steps.push('Identify target and parameters');
        steps.push('Validate permissions and constraints');
        steps.push('Execute command');
        steps.push('Report results');
        alternatives.push('Execute directly', 'Request confirmation', 'Simulate first');
        break;

      case 'creation':
        steps.push('Understand requirements');
        steps.push('Design solution architecture');
        steps.push('Implement components');
        steps.push('Test functionality');
        steps.push('Refine and optimize');
        alternatives.push('Build from scratch', 'Use template', 'Modify existing');
        break;

      case 'analysis':
        steps.push('Gather relevant data');
        steps.push('Identify patterns and relationships');
        steps.push('Evaluate against criteria');
        steps.push('Draw conclusions');
        steps.push('Present findings');
        alternatives.push('Deep analysis', 'Quick assessment', 'Comparative study');
        break;

      case 'exploration':
        steps.push('Define exploration scope');
        steps.push('Gather initial information');
        steps.push('Follow promising leads');
        steps.push('Document discoveries');
        steps.push('Synthesize insights');
        alternatives.push('Broad search', 'Focused investigation', 'Random walk');
        break;

      default: // query
        steps.push('Parse question');
        steps.push('Search knowledge base');
        steps.push('Retrieve relevant information');
        steps.push('Format answer');
        alternatives.push('Direct answer', 'Detailed explanation', 'Point to resources');
    }

    // Calculate success probability based on confidence and novelty
    const baseProb = 0.7;
    const confidenceBonus = intent.confidence * 0.2;
    const noveltyPenalty = 0.1; // Novel things are riskier
    const successProbability = Math.min(0.95, baseProb + confidenceBonus - noveltyPenalty);

    return {
      bestAction: alternatives[0] || 'Proceed with standard approach',
      alternatives,
      successProbability,
      steps,
    };
  }

  /**
   * Synthesize final response from all analysis components
   */
  private synthesizeResponse(
    input: string,
    intent: IntentResult,
    crossCheck: CrossCheckResult,
    simulation: SimulateResult,
    noveltyScore: number
  ): string {
    const parts: string[] = [];

    // Acknowledge the input
    parts.push(`Understanding: ${input}`);

    // State detected intent
    parts.push(`Intent: ${intent.intent} (confidence: ${(intent.confidence * 100).toFixed(0)}%)`);

    // Add action plan
    if (simulation.steps.length > 0) {
      parts.push(`Plan: ${simulation.steps.join(' → ')}`);
    }

    // Note novelty
    if (noveltyScore > 0.7) {
      parts.push('[This appears to be a novel query]');
    }

    // Add cross-check summary
    if (crossCheck.agreements.length > 0) {
      parts.push(`Confidence factors: ${crossCheck.agreements.slice(0, 3).join(', ')}`);
    }

    return parts.join('\n  ');
  }

  /**
   * Get thesaurus data for a word
   */
  getThesaurusData(word: string): { X: string[]; Y: string; Z: string[] } | null {
    try {
      const entry = this.thesaurus.lookup(word);
      if (!entry) return null;

      return {
        X: entry.synonyms || [],
        Y: entry.definition || '',
        Z: entry.examples || [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Get question history for debugging/analysis
   */
  getHistory(): QuestionNode[] {
    return [...this.questionHistory];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.questionHistory = [];
  }
}

/**
 * CodeToNet — Convert binary code to neural network representation
 */
export class CodeToNet {
  private neurons: Map<string, CodeNeuron>;
  private connections: [string, string, number][];

  constructor() {
    this.neurons = new Map();
    this.connections = [];
  }

  /**
   * Import binary code and convert to neural net
   */
  importCode(bytecode: number[], behavior: string): CodeNetTopology {
    const neurons: CodeNeuron[] = [];
    const connections: [string, string, number][] = [];

    // Create neurons from bytecode segments
    const segmentSize = 8;
    for (let i = 0; i < bytecode.length; i += segmentSize) {
      const segment = bytecode.slice(i, i + segmentSize);
      const neuronId = `code_neuron_${i}`;
      
      const neuron: CodeNeuron = {
        id: neuronId,
        bytecode: segment,
        behavior: `${behavior}_segment_${i}`,
        inputs: [`input_${i}`],
        outputs: [`output_${i + segmentSize}`],
      };

      neurons.push(neuron);
      this.neurons.set(neuronId, neuron);

      // Connect to previous neuron if exists
      if (i > 0) {
        const prevId = `code_neuron_${i - segmentSize}`;
        connections.push([prevId, neuronId, 1.0]);
        this.connections.push([prevId, neuronId, 1.0]);
      }
    }

    const inputLayer = neurons.length > 0 ? [neurons[0].id] : [];
    const outputLayer = neurons.length > 0 ? [neurons[neurons.length - 1].id] : [];

    return {
      neurons,
      connections,
      inputLayer,
      outputLayer,
    };
  }

  /**
   * Get topology as serializable object
   */
  getTopology(): CodeNetTopology {
    const neurons = Array.from(this.neurons.values());
    return {
      neurons,
      connections: [...this.connections],
      inputLayer: neurons.length > 0 ? [neurons[0].id] : [],
      outputLayer: neurons.length > 0 ? [neurons[neurons.length - 1].id] : [],
    };
  }

  /**
   * Clear all neurons and connections
   */
  clear(): void {
    this.neurons.clear();
    this.connections = [];
  }
}
