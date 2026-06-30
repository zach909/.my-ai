export interface DictionaryEntry {
    word: string;
    definition: string;
    partOfSpeech: string;
    example: string;
    source: string;
}
export interface ThesaurusEntry {
    word: string;
    synonyms: string[];
    antonyms: string[];
    source: string;
}
export interface WordLookup {
    word: string;
    definitions: DictionaryEntry[];
    synonyms: string[];
    antonyms: string[];
    relatedWords: string[];
}
export declare function lookupDictionary(word: string): Promise<DictionaryEntry[]>;
export declare function lookupThesaurus(word: string): Promise<ThesaurusEntry>;
export declare function lookupWord(word: string): Promise<WordLookup>;
export declare function searchImages(query: string, count?: number): Promise<Array<{
    url: string;
    title: string;
    source: string;
}>>;
