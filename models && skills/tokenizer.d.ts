export declare class Tokenizer {
    private charToId;
    private idToChar;
    private vocabSize;
    private specialTokens;
    constructor();
    private buildVocab;
    encode(text: string): number[];
    decode(tokens: number[]): string;
    charToTokenId(char: string): number;
    tokenIdToChar(tokenId: number): string;
    tokenToEmbedding(tokenId: number, embeddingDim: number): Float32Array;
    getVocabSize(): number;
    getSpecialTokens(): {
        pad: number;
        bos: number;
        eos: number;
        unk: number;
    };
    getCharToId(): Map<string, number>;
    getIdToChar(): Map<number, string>;
}
