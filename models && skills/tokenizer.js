export class Tokenizer {
    charToId = new Map();
    idToChar = new Map();
    vocabSize;
    specialTokens = {
        pad: 0,
        bos: 1,
        eos: 2,
        unk: 3,
    };
    constructor() {
        this.vocabSize = 4;
        this.buildVocab();
    }
    buildVocab() {
        const chars = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:'\"()-\n\t@#$%&*+=/\\[]{}|<>~`^_";
        for (const char of chars) {
            if (!this.charToId.has(char)) {
                this.charToId.set(char, this.vocabSize);
                this.idToChar.set(this.vocabSize, char);
                this.vocabSize++;
            }
        }
    }
    encode(text) {
        const tokens = [this.specialTokens.bos];
        for (const char of text) {
            tokens.push(this.charToId.get(char) ?? this.specialTokens.unk);
        }
        tokens.push(this.specialTokens.eos);
        return tokens;
    }
    decode(tokens) {
        let text = "";
        for (const token of tokens) {
            if (token === this.specialTokens.bos || token === this.specialTokens.eos || token === this.specialTokens.pad)
                continue;
            text += this.idToChar.get(token) ?? "?";
        }
        return text;
    }
    charToTokenId(char) {
        return this.charToId.get(char) ?? this.specialTokens.unk;
    }
    tokenIdToChar(tokenId) {
        return this.idToChar.get(tokenId) ?? "?";
    }
    tokenToEmbedding(tokenId, embeddingDim) {
        const embedding = new Float32Array(embeddingDim);
        const seed = tokenId * 2654435761;
        for (let i = 0; i < embeddingDim; i++) {
            const hash = ((seed + i * 1013904223) >>> 0) / 4294967296;
            embedding[i] = (hash - 0.5) * 2;
        }
        return embedding;
    }
    getVocabSize() {
        return this.vocabSize;
    }
    getSpecialTokens() {
        return { ...this.specialTokens };
    }
    getCharToId() {
        return new Map(this.charToId);
    }
    getIdToChar() {
        return new Map(this.idToChar);
    }
}
