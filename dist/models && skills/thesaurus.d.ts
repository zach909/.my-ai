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
    definition: string;
    synonyms: string[];
    examples: string[];
    partOfSpeech?: string;
    etymology?: string;
}
export interface ThesaurusData {
    entries: Map<string, DictionaryEntry>;
    temporary: boolean;
    createdAt: number;
    lastAccessed: number;
}
export declare class ThesaurusDictionary {
    private data;
    private temporaryFilePath;
    constructor();
    /**
     * Add a word to the dictionary
     */
    addWord(entry: DictionaryEntry): void;
    /**
     * Get definition (Y) for a word
     */
    getDefinition(word: string): string | undefined;
    /**
     * Get synonyms (X) for a word
     */
    getSynonyms(word: string): string[];
    /**
     * Get examples (Z) for a word
     */
    getExamples(word: string): string[];
    /**
     * Full lookup (L) - returns all data
     */
    lookup(word: string): DictionaryEntry | undefined;
    /**
     * Search for words by pattern
     */
    search(pattern: string): DictionaryEntry[];
    /**
     * Generate LLM training data from thesaurus
     * Format: X=synonym, Z=example, Y=definition
     */
    generateTrainingData(): Array<{
        word: string;
        X: string[];
        Y: string;
        Z: string[];
    }>;
    /**
     * Load from temporary file
     */
    loadFromFile(filePath: string): Promise<void>;
    /**
     * Save to temporary file
     */
    saveToFile(filePath: string): Promise<void>;
    /**
     * Clear all entries (for temporary cleanup)
     */
    clear(): void;
    /**
     * Get statistics
     */
    getStats(): {
        wordCount: number;
        totalSynonyms: number;
        totalExamples: number;
        age: number;
        temporary: boolean;
    };
    /**
     * Export data
     */
    exportData(): any;
    /**
     * Import data
     */
    importData(data: any): void;
    /**
     * Helper: Read file (Node.js)
     */
    private readFile;
    /**
     * Helper: Write file (Node.js)
     */
    private writeFile;
    /**
     * Delete temporary file if exists
     */
    deleteTemporaryFile(): Promise<void>;
}
/**
 * Factory for creating pre-populated thesaurus
 */
export declare class ThesaurusFactory {
    /**
     * Create a basic thesaurus with common words
     */
    static createBasic(): ThesaurusDictionary;
    /**
     * Create a technical thesaurus for coding
     */
    static createTechnical(): ThesaurusDictionary;
}
