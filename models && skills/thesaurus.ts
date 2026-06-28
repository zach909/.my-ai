/**
 * Thesaurus and Dictionary System for LLM Building
 * 
 * Features:
 * - Temporary file storage for thesaurus and dictionary data
 * - X = synonym
 * - Z = example
 * - Y = definition
 * - L = Thesaurus/Dictionary lookup
 * - Used in LLM creation pipeline
 */

export interface DictionaryEntry {
  word: string;
  definition: string; // Y
  synonyms: string[]; // X
  examples: string[]; // Z
  partOfSpeech?: string;
  etymology?: string;
}

export interface ThesaurusData {
  entries: Map<string, DictionaryEntry>;
  temporary: boolean;
  createdAt: number;
  lastAccessed: number;
}

export class ThesaurusDictionary {
  private data: ThesaurusData;
  private temporaryFilePath: string | null = null;

  constructor() {
    this.data = {
      entries: new Map(),
      temporary: true,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };
  }

  /**
   * Add a word to the dictionary
   */
  addWord(entry: DictionaryEntry): void {
    this.data.entries.set(entry.word.toLowerCase(), entry);
    this.data.lastAccessed = Date.now();
  }

  /**
   * Get definition (Y) for a word
   */
  getDefinition(word: string): string | undefined {
    this.data.lastAccessed = Date.now();
    return this.data.entries.get(word.toLowerCase())?.definition;
  }

  /**
   * Get synonyms (X) for a word
   */
  getSynonyms(word: string): string[] {
    this.data.lastAccessed = Date.now();
    return this.data.entries.get(word.toLowerCase())?.synonyms ?? [];
  }

  /**
   * Get examples (Z) for a word
   */
  getExamples(word: string): string[] {
    this.data.lastAccessed = Date.now();
    return this.data.entries.get(word.toLowerCase())?.examples ?? [];
  }

  /**
   * Full lookup (L) - returns all data
   */
  lookup(word: string): DictionaryEntry | undefined {
    this.data.lastAccessed = Date.now();
    return this.data.entries.get(word.toLowerCase());
  }

  /**
   * Search for words by pattern
   */
  search(pattern: string): DictionaryEntry[] {
    this.data.lastAccessed = Date.now();
    const regex = new RegExp(pattern, 'i');
    const results: DictionaryEntry[] = [];

    for (const entry of this.data.entries.values()) {
      if (regex.test(entry.word) || 
          regex.test(entry.definition) ||
          entry.synonyms.some(s => regex.test(s))) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Generate LLM training data from thesaurus
   * Format: X=synonym, Z=example, Y=definition
   */
  generateTrainingData(): Array<{
    word: string;
    X: string[]; // synonyms
    Y: string; // definition
    Z: string[]; // examples
  }> {
    const trainingData: Array<{
      word: string;
      X: string[];
      Y: string;
      Z: string[];
    }> = [];

    for (const [word, entry] of this.data.entries) {
      trainingData.push({
        word,
        X: entry.synonyms,
        Y: entry.definition,
        Z: entry.examples,
      });
    }

    return trainingData;
  }

  /**
   * Load from temporary file
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const content = await this.readFile(filePath);
      const parsed = JSON.parse(content);
      
      this.data.entries = new Map(
        Object.entries(parsed.entries).map(([k, v]) => [k, v as DictionaryEntry])
      );
      this.data.temporary = parsed.temporary;
      this.data.createdAt = parsed.createdAt;
      this.data.lastAccessed = Date.now();
      this.temporaryFilePath = filePath;
    } catch (error) {
      throw new Error(`Failed to load thesaurus: ${error}`);
    }
  }

  /**
   * Save to temporary file
   */
  async saveToFile(filePath: string): Promise<void> {
    try {
      const content = JSON.stringify({
        entries: Object.fromEntries(this.data.entries),
        temporary: this.data.temporary,
        createdAt: this.data.createdAt,
        lastAccessed: this.data.lastAccessed,
      }, null, 2);
      
      await this.writeFile(filePath, content);
      this.temporaryFilePath = filePath;
    } catch (error) {
      throw new Error(`Failed to save thesaurus: ${error}`);
    }
  }

  /**
   * Clear all entries (for temporary cleanup)
   */
  clear(): void {
    this.data.entries.clear();
    this.data.lastAccessed = Date.now();
  }

  /**
   * Get statistics
   */
  getStats(): {
    wordCount: number;
    totalSynonyms: number;
    totalExamples: number;
    age: number;
    temporary: boolean;
  } {
    let totalSynonyms = 0;
    let totalExamples = 0;

    for (const entry of this.data.entries.values()) {
      totalSynonyms += entry.synonyms.length;
      totalExamples += entry.examples.length;
    }

    return {
      wordCount: this.data.entries.size,
      totalSynonyms,
      totalExamples,
      age: Date.now() - this.data.createdAt,
      temporary: this.data.temporary,
    };
  }

  /**
   * Export data
   */
  exportData(): any {
    return {
      entries: Object.fromEntries(this.data.entries),
      temporary: this.data.temporary,
      createdAt: this.data.createdAt,
      lastAccessed: this.data.lastAccessed,
    };
  }

  /**
   * Import data
   */
  importData(data: any): void {
    this.data.entries = new Map(
      Object.entries(data.entries).map(([k, v]) => [k, v as DictionaryEntry])
    );
    this.data.temporary = data.temporary;
    this.data.createdAt = data.createdAt;
    this.data.lastAccessed = Date.now();
  }

  /**
   * Helper: Read file (Node.js)
   */
  private async readFile(filePath: string): Promise<string> {
    // In browser environment, would use fetch
    if (typeof window !== 'undefined') {
      const response = await fetch(filePath);
      return response.text();
    }
    // In Node.js environment
    // @ts-ignore - fs/promises is Node.js specific
    const fs = await import('fs/promises');
    return await fs.readFile(filePath, 'utf-8');
  }

  /**
   * Helper: Write file (Node.js)
   */
  private async writeFile(filePath: string, content: string): Promise<void> {
    // In browser environment, would use download
    if (typeof window !== 'undefined') {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    // In Node.js environment
    // @ts-ignore - fs/promises is Node.js specific
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Delete temporary file if exists
   */
  async deleteTemporaryFile(): Promise<void> {
    if (this.temporaryFilePath && typeof window === 'undefined') {
      try {
        // @ts-ignore - fs/promises is Node.js specific
        const fs = await import('fs/promises');
        await fs.unlink(this.temporaryFilePath);
        this.temporaryFilePath = null;
      } catch (error) {
        // File might not exist
      }
    }
  }
}

/**
 * Factory for creating pre-populated thesaurus
 */
export class ThesaurusFactory {
  /**
   * Create a basic thesaurus with common words
   */
  static createBasic(): ThesaurusDictionary {
    const thesaurus = new ThesaurusDictionary();

    const entries: DictionaryEntry[] = [
      // Emotions
      { word: 'happy', definition: 'feeling or showing pleasure or contentment', synonyms: ['joyful', 'cheerful', 'delighted', 'glad', 'pleased'], examples: ['She was happy to see her friend.', 'The happy dog wagged its tail.'], partOfSpeech: 'adjective' },
      { word: 'sad', definition: 'feeling or showing sorrow; unhappy', synonyms: ['unhappy', 'sorrowful', 'depressed', 'mournful', 'gloomy'], examples: ['He felt sad after the news.', 'The sad movie made everyone cry.'], partOfSpeech: 'adjective' },
      { word: 'fast', definition: 'moving or capable of moving at high speed', synonyms: ['quick', 'rapid', 'swift', 'speedy', 'brisk'], examples: ['The fast car zoomed past.', 'He made a fast decision.'], partOfSpeech: 'adjective' },
      { word: 'slow', definition: 'moving or operating at a low speed', synonyms: ['sluggish', 'gradual', 'unhurried', 'leisurely', 'delayed'], examples: ['The slow process took hours.', 'Traffic was slow on the highway.'], partOfSpeech: 'adjective' },
      { word: 'good', definition: 'having the qualities required for a particular role; of high quality', synonyms: ['excellent', 'great', 'fine', 'superior', 'worthy'], examples: ['That is a good idea.', 'She did good work on the project.'], partOfSpeech: 'adjective' },
      { word: 'smart', definition: 'having or showing a quick-witted intelligence', synonyms: ['intelligent', 'clever', 'bright', 'wise', 'sharp'], examples: ['The smart student solved it quickly.', 'A smart system adapts to its environment.'], partOfSpeech: 'adjective' },
      { word: 'simple', definition: 'easily understood or done; presenting no difficulty', synonyms: ['easy', 'straightforward', 'basic', 'plain', 'uncomplicated'], examples: ['The solution is simple.', 'Use a simple approach first.'], partOfSpeech: 'adjective' },
      { word: 'complex', definition: 'consisting of many different and connected parts', synonyms: ['complicated', 'intricate', 'involved', 'elaborate', 'sophisticated'], examples: ['The system is complex.', 'Neural networks have complex architectures.'], partOfSpeech: 'adjective' },
      { word: 'real', definition: 'actually existing or occurring; not imagined or supposed', synonyms: ['actual', 'genuine', 'true', 'authentic', 'concrete'], examples: ['Build a real working implementation.', 'The real data showed different results.'], partOfSpeech: 'adjective' },
      { word: 'local', definition: 'belonging or relating to a particular area or one\'s neighborhood', synonyms: ['nearby', 'regional', 'native', 'resident', 'on-device'], examples: ['Run the model locally.', 'Local inference avoids API calls.'], partOfSpeech: 'adjective' },
      { word: 'new', definition: 'not existing before; made, introduced, or discovered recently', synonyms: ['novel', 'fresh', 'recent', 'modern', 'innovative'], examples: ['Create a new extension.', 'The new algorithm performs better.'], partOfSpeech: 'adjective' },
      // Common verbs
      { word: 'think', definition: 'have a particular opinion, belief, or idea about someone or something', synonyms: ['believe', 'consider', 'reason', 'ponder', 'reflect'], examples: ['I think it will rain today.', 'Think through each possibility carefully.'], partOfSpeech: 'verb' },
      { word: 'create', definition: 'bring something into existence', synonyms: ['make', 'produce', 'generate', 'build', 'construct'], examples: ['Artists create beautiful paintings.', 'Create a new neural extension.'], partOfSpeech: 'verb' },
      { word: 'learn', definition: 'gain or acquire knowledge or skill through experience or study', synonyms: ['study', 'train', 'acquire', 'absorb', 'master'], examples: ['The model learns from examples.', 'Neural networks learn patterns from data.'], partOfSpeech: 'verb' },
      { word: 'find', definition: 'discover or locate by searching or effort', synonyms: ['locate', 'discover', 'uncover', 'detect', 'identify'], examples: ['Find the relevant neurons.', 'Search to find matching patterns.'], partOfSpeech: 'verb' },
      { word: 'run', definition: 'execute a program or process', synonyms: ['execute', 'launch', 'start', 'perform', 'operate'], examples: ['Run the model.', 'Execute the pipeline.'], partOfSpeech: 'verb' },
      { word: 'use', definition: 'take, hold, or deploy as a means of accomplishing something', synonyms: ['apply', 'employ', 'utilize', 'leverage', 'operate'], examples: ['Use quantization to compress the model.', 'Employ MoE routing for efficiency.'], partOfSpeech: 'verb' },
      { word: 'help', definition: 'make it easier for someone to do something; assist', synonyms: ['assist', 'support', 'aid', 'guide', 'facilitate'], examples: ['Help me build the system.', 'The plugin helps users automate tasks.'], partOfSpeech: 'verb' },
      { word: 'know', definition: 'be aware of through observation, inquiry, or information', synonyms: ['understand', 'comprehend', 'recognize', 'realize', 'grasp'], examples: ['Know your intent before generating.', 'The system knows its own state.'], partOfSpeech: 'verb' },
      { word: 'write', definition: 'mark letters, words, or other symbols on a surface', synonyms: ['compose', 'author', 'draft', 'code', 'generate'], examples: ['Write a function.', 'The AI writes code from a description.'], partOfSpeech: 'verb' },
      { word: 'show', definition: 'make visible; display', synonyms: ['display', 'present', 'reveal', 'demonstrate', 'exhibit'], examples: ['Show the model status.', 'Display the neuron activations.'], partOfSpeech: 'verb' },
      { word: 'load', definition: 'place a load on or in; read data into memory', synonyms: ['import', 'read', 'fetch', 'retrieve', 'mount'], examples: ['Load the saved model.', 'Load the extension into MoE.'], partOfSpeech: 'verb' },
      { word: 'save', definition: 'keep safe or rescue from harm; write data to storage', synonyms: ['store', 'preserve', 'export', 'persist', 'write'], examples: ['Save the model without quantization.', 'Persist the state to disk.'], partOfSpeech: 'verb' },
      { word: 'train', definition: 'teach a person or animal a skill through practice', synonyms: ['teach', 'educate', 'optimize', 'fit', 'calibrate'], examples: ['Train the model on examples.', 'Fine-tune the neural network.'], partOfSpeech: 'verb' },
      { word: 'build', definition: 'construct by putting parts together', synonyms: ['construct', 'assemble', 'create', 'compile', 'form'], examples: ['Build the neural network.', 'Assemble the pipeline components.'], partOfSpeech: 'verb' },
      { word: 'connect', definition: 'join or link together', synonyms: ['link', 'attach', 'join', 'wire', 'bridge'], examples: ['Connect neurons together.', 'Wire the THORNS engine to the MoE router.'], partOfSpeech: 'verb' },
      { word: 'analyze', definition: 'examine methodically and in detail', synonyms: ['examine', 'inspect', 'evaluate', 'study', 'assess'], examples: ['Analyze the model output.', 'Examine the neuron activations.'], partOfSpeech: 'verb' },
      { word: 'predict', definition: 'say or estimate that something will happen in the future', synonyms: ['forecast', 'estimate', 'anticipate', 'project', 'infer'], examples: ['Predict the next token.', 'The model predicts user intent.'], partOfSpeech: 'verb' },
      { word: 'compute', definition: 'calculate or reckon using a computer', synonyms: ['calculate', 'process', 'evaluate', 'solve', 'derive'], examples: ['Compute the embedding vector.', 'Process the input through all layers.'], partOfSpeech: 'verb' },
      { word: 'test', definition: 'take measures to check the quality, performance, or reliability of', synonyms: ['check', 'verify', 'validate', 'evaluate', 'examine'], examples: ['Test the model output.', 'Verify the plugin integration.'], partOfSpeech: 'verb' },
      { word: 'fix', definition: 'repair or correct something that is broken or wrong', synonyms: ['repair', 'correct', 'resolve', 'patch', 'debug'], examples: ['Fix the bug in the code.', 'Resolve the connection error.'], partOfSpeech: 'verb' },
      { word: 'add', definition: 'join to or put with something else', synonyms: ['append', 'include', 'insert', 'attach', 'extend'], examples: ['Add a new expert to MoE.', 'Include the plugin in the registry.'], partOfSpeech: 'verb' },
      { word: 'remove', definition: 'take away or off; eliminate', synonyms: ['delete', 'eliminate', 'drop', 'erase', 'discard'], examples: ['Remove the inactive neuron.', 'Delete the old extension.'], partOfSpeech: 'verb' },
      { word: 'search', definition: 'try to find something by looking or otherwise seeking', synonyms: ['seek', 'look', 'query', 'scan', 'explore'], examples: ['Search the neuron database.', 'Query the net for relevant terms.'], partOfSpeech: 'verb' },
      { word: 'generate', definition: 'produce or create', synonyms: ['produce', 'create', 'output', 'synthesize', 'emit'], examples: ['Generate a response.', 'Produce the embedding vector.'], partOfSpeech: 'verb' },
      // AI/ML nouns
      { word: 'neural', definition: 'relating to a nerve or the nervous system; or neural network', synonyms: ['network', 'brain', 'neuron', 'synapse', 'cortical'], examples: ['A neural network processes information.', 'The neural architecture has multiple layers.'], partOfSpeech: 'adjective' },
      { word: 'model', definition: 'a simplified mathematical representation of a system', synonyms: ['network', 'system', 'architecture', 'representation', 'framework'], examples: ['Train the language model.', 'The model predicts the next token.'], partOfSpeech: 'noun' },
      { word: 'data', definition: 'facts and statistics collected for reference or analysis', synonyms: ['information', 'input', 'samples', 'examples', 'dataset'], examples: ['The model trains on data.', 'Provide data to calibrate the system.'], partOfSpeech: 'noun' },
      { word: 'code', definition: 'instructions for a computer written in a programming language', synonyms: ['program', 'script', 'source', 'software', 'algorithm'], examples: ['Write clean code.', 'The code compiles without errors.'], partOfSpeech: 'noun' },
      { word: 'algorithm', definition: 'a process or set of rules followed in calculations', synonyms: ['procedure', 'method', 'process', 'technique', 'logic'], examples: ['The algorithm sorts items efficiently.', 'Design an algorithm for search.'], partOfSpeech: 'noun' },
      { word: 'network', definition: 'a system of things or people interconnected', synonyms: ['graph', 'mesh', 'web', 'grid', 'system'], examples: ['The neural network has many layers.', 'Build a fully connected network.'], partOfSpeech: 'noun' },
      { word: 'layer', definition: 'a sheet, quantity, or thickness of material laid over a surface', synonyms: ['level', 'tier', 'stratum', 'depth', 'stage'], examples: ['The hidden layer transforms inputs.', 'Add another layer to the network.'], partOfSpeech: 'noun' },
      { word: 'weight', definition: 'a numerical value assigned to a connection in a neural network', synonyms: ['parameter', 'coefficient', 'factor', 'strength', 'value'], examples: ['Adjust the weights during training.', 'High-weight connections are stronger.'], partOfSpeech: 'noun' },
      { word: 'input', definition: 'data fed into a system for processing', synonyms: ['entry', 'feed', 'prompt', 'signal', 'stimulus'], examples: ['The input is encoded into an embedding.', 'Provide the input to the first layer.'], partOfSpeech: 'noun' },
      { word: 'output', definition: 'the result produced by a system', synonyms: ['result', 'response', 'prediction', 'signal', 'answer'], examples: ['The output is a probability distribution.', 'Read the output from the final layer.'], partOfSpeech: 'noun' },
      // Common nouns
      { word: 'file', definition: 'a collection of data or information stored under a name', synonyms: ['document', 'record', 'resource', 'module', 'script'], examples: ['Save the file to disk.', 'Load the model file.'], partOfSpeech: 'noun' },
      { word: 'text', definition: 'written or printed words', synonyms: ['string', 'content', 'words', 'sentence', 'passage'], examples: ['Process the input text.', 'Generate a text response.'], partOfSpeech: 'noun' },
      { word: 'system', definition: 'a set of things working together as parts of a mechanism', synonyms: ['framework', 'platform', 'environment', 'infrastructure', 'setup'], examples: ['The system runs locally.', 'Configure the AI system.'], partOfSpeech: 'noun' },
      { word: 'user', definition: 'a person who uses or operates something', synonyms: ['person', 'operator', 'client', 'human', 'agent'], examples: ['The user types a prompt.', 'Respond to user queries.'], partOfSpeech: 'noun' },
      { word: 'task', definition: 'a piece of work to be done or undertaken', synonyms: ['job', 'assignment', 'action', 'goal', 'objective'], examples: ['Complete the task efficiently.', 'The agent handles complex tasks.'], partOfSpeech: 'noun' },
      { word: 'plan', definition: 'a detailed proposal for doing or achieving something', synonyms: ['strategy', 'scheme', 'design', 'approach', 'roadmap'], examples: ['Build a plan before executing.', 'The action plan guides execution.'], partOfSpeech: 'noun' },
      { word: 'idea', definition: 'a thought or suggestion as to a possible course of action', synonyms: ['concept', 'notion', 'thought', 'proposal', 'insight'], examples: ['That is a great idea.', 'Explore the idea further.'], partOfSpeech: 'noun' },
      { word: 'step', definition: 'an action or operation in a sequence', synonyms: ['stage', 'phase', 'move', 'action', 'process'], examples: ['Follow each step carefully.', 'The pipeline runs in steps.'], partOfSpeech: 'noun' },
      { word: 'word', definition: 'a single distinct meaningful element of speech or writing', synonyms: ['term', 'token', 'symbol', 'lexeme', 'expression'], examples: ['Each word is tokenized.', 'Look up the word in the dictionary.'], partOfSpeech: 'noun' },
      { word: 'memory', definition: 'the faculty by which the mind stores and remembers information', synonyms: ['storage', 'recall', 'retention', 'cache', 'buffer'], examples: ['Store patterns in memory.', 'The system recalls previous conversations.'], partOfSpeech: 'noun' },
      { word: 'time', definition: 'the indefinite continued progress of existence and events', synonyms: ['duration', 'period', 'moment', 'interval', 'span'], examples: ['Training takes time.', 'Measure the inference time.'], partOfSpeech: 'noun' },
      { word: 'point', definition: 'a value or unit; a location in space', synonyms: ['position', 'location', 'unit', 'value', 'score'], examples: ['Each neuron has value points.', 'The zero-sum points are redistributed.'], partOfSpeech: 'noun' },
    ];

    for (const entry of entries) thesaurus.addWord(entry);
    return thesaurus;
  }

  /**
   * Create a technical thesaurus for coding
   */
  static createTechnical(): ThesaurusDictionary {
    const thesaurus = new ThesaurusDictionary();

    const entries: DictionaryEntry[] = [
      { word: 'function', definition: 'a block of code designed to perform a particular task', synonyms: ['procedure', 'method', 'routine', 'subroutine', 'handler'], examples: ['Write a function to calculate the sum.', 'The function returns a value.'], partOfSpeech: 'noun' },
      { word: 'variable', definition: 'a storage location paired with an associated symbolic name', synonyms: ['identifier', 'binding', 'symbol', 'reference', 'slot'], examples: ['Declare a variable to store the result.', 'The variable holds the user input.'], partOfSpeech: 'noun' },
      { word: 'compile', definition: 'convert source code into executable code', synonyms: ['build', 'assemble', 'transpile', 'translate', 'process'], examples: ['Compile the program before running it.', 'The compiler found an error.'], partOfSpeech: 'verb' },
      { word: 'debug', definition: 'identify and remove errors from software', synonyms: ['fix', 'troubleshoot', 'trace', 'diagnose', 'correct'], examples: ['Debug the code to find the bug.', 'Trace execution to find the issue.'], partOfSpeech: 'verb' },
      { word: 'class', definition: 'a blueprint for creating objects in object-oriented programming', synonyms: ['type', 'blueprint', 'template', 'prototype', 'definition'], examples: ['Define a class for the neural engine.', 'The class encapsulates neuron state.'], partOfSpeech: 'noun' },
      { word: 'interface', definition: 'a shared boundary defining how components interact', synonyms: ['contract', 'protocol', 'api', 'specification', 'boundary'], examples: ['The CLI is the user interface.', 'Define an interface for the plugin system.'], partOfSpeech: 'noun' },
      { word: 'module', definition: 'a self-contained unit of code with a defined interface', synonyms: ['package', 'component', 'library', 'unit', 'plugin'], examples: ['Import the thesaurus module.', 'Each module handles one subsystem.'], partOfSpeech: 'noun' },
      { word: 'import', definition: 'bring code from an external module into scope', synonyms: ['include', 'require', 'load', 'fetch', 'reference'], examples: ['Import the MoE router.', 'Include the THORNS engine.'], partOfSpeech: 'verb' },
      { word: 'export', definition: 'make code from a module available to other modules', synonyms: ['expose', 'publish', 'share', 'provide', 'emit'], examples: ['Export the NeuroclawLLM class.', 'The module exports a factory function.'], partOfSpeech: 'verb' },
      { word: 'async', definition: 'allowing execution to continue without waiting for a result', synonyms: ['asynchronous', 'non-blocking', 'concurrent', 'parallel', 'deferred'], examples: ['Use async/await for IO operations.', 'The generate function is async.'], partOfSpeech: 'adjective' },
      { word: 'token', definition: 'a smallest unit in a text or programming language', synonyms: ['character', 'symbol', 'lexeme', 'unit', 'element'], examples: ['Each token maps to an embedding.', 'Tokenize the input before processing.'], partOfSpeech: 'noun' },
      { word: 'embed', definition: 'represent data as a dense vector in a high-dimensional space', synonyms: ['encode', 'vectorize', 'represent', 'project', 'transform'], examples: ['Embed the token into a 64-dim vector.', 'The embedding captures semantic meaning.'], partOfSpeech: 'verb' },
      { word: 'quantize', definition: 'reduce the precision of numerical values to save space', synonyms: ['compress', 'reduce', 'truncate', 'approximate', 'pack'], examples: ['Quantize the model to 4-bit precision.', 'Install with quantization for deployment.'], partOfSpeech: 'verb' },
      { word: 'router', definition: 'a component that selects which expert or path to use', synonyms: ['dispatcher', 'selector', 'gate', 'scheduler', 'arbiter'], examples: ['The MoE router selects top-K experts.', 'Route the input to the best expert.'], partOfSpeech: 'noun' },
      { word: 'expert', definition: 'a specialized sub-network in a Mixture of Experts architecture', synonyms: ['specialist', 'module', 'network', 'component', 'skill'], examples: ['Each expert handles a different task type.', 'The router activates top-2 experts.'], partOfSpeech: 'noun' },
      { word: 'pipeline', definition: 'a series of processing stages through which data flows', synonyms: ['workflow', 'chain', 'sequence', 'process', 'flow'], examples: ['The 6-stage pipeline processes inputs.', 'Data flows through the pipeline.'], partOfSpeech: 'noun' },
      { word: 'extension', definition: 'a plugin or add-on that extends system capabilities', synonyms: ['plugin', 'addon', 'module', 'skill', 'component'], examples: ['Build an extension for image processing.', 'Extensions are installed with quantization.'], partOfSpeech: 'noun' },
      { word: 'encryption', definition: 'the process of encoding information to prevent unauthorized access', synonyms: ['encoding', 'ciphering', 'securing', 'protecting', 'hashing'], examples: ['End-to-end encryption protects data.', 'All stored data uses encryption.'], partOfSpeech: 'noun' },
    ];

    for (const entry of entries) thesaurus.addWord(entry);
    return thesaurus;
  }
}
