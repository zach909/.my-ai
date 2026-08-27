import { execSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BasePlugin } from "../plugin_manager/sdk.js";
export class VoiceActivationPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.listening = false;
        this.commands = [];
        this.wakeWord = "neuroclaw";
        this.micProcess = null;
        /** Paths of clips recorded and not yet collected. */
        this.captured = [];
    }
    setWakeWord(word) {
        if (!word || typeof word !== "string") {
            throw new Error("Security Error: Wake word must be a non-empty string.");
        }
        if (word.length > 64) {
            throw new Error("Security Error: Wake word exceeds maximum length of 64 characters.");
        }
        if (word.startsWith("-")) {
            throw new Error("Security Error: Wake word cannot start with a hyphen to prevent argument injection.");
        }
        const safeRegex = /^[a-zA-Z0-9_-]+$/;
        if (!safeRegex.test(word)) {
            throw new Error("Security Error: Wake word contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed.");
        }
        this.wakeWord = word;
    }
    getWakeWord() { return this.wakeWord; }
    async startListening() {
        if (this.listening)
            return false;
        const recordCmd = this.detectRecorder();
        if (!recordCmd) {
            console.log("[VoiceActivation] No audio recorder found. Using text fallback.");
            this.listening = true;
            return true;
        }
        this.listening = true;
        const [cmd, ...args] = recordCmd;
        const outPath = join(tmpdir(), `neuroclaw_voice_${Date.now()}.wav`);
        this.micProcess = spawn(cmd, [...args, outPath], { stdio: 'ignore', detached: false });
        this.micProcess.on('exit', (code) => {
            if (code === 0 && existsSync(outPath)) {
                // The clip is kept as a clip. It used to be handed to a local speech
                // recogniser and thrown away, which meant a recording could only ever
                // reach the agent as whatever words a transcriber happened to hear --
                // everything else about it discarded before anything saw it. Now it is
                // a file, and a file goes into the network as a file.
                this.captured.push(this.keepClip(outPath));
            }
        });
        return true;
    }
    async stopListening() {
        if (!this.listening)
            return false;
        this.listening = false;
        if (this.micProcess) {
            this.micProcess.kill('SIGTERM');
            this.micProcess = null;
        }
        return true;
    }
    get isListening() { return this.listening; }
    async processTranscript(transcript) {
        if (typeof transcript !== "string") {
            throw new Error("Security Error: Transcript must be a string.");
        }
        if (transcript.trim() === "") {
            throw new Error("Security Error: Transcript cannot be empty.");
        }
        if (transcript.length > 1000) {
            throw new Error("Security Error: Transcript exceeds maximum length limit.");
        }
        const lower = transcript.toLowerCase();
        const confidence = lower.includes(this.wakeWord.toLowerCase()) ? 0.9 : 0.3;
        let action;
        if (lower.includes("open") || lower.includes("launch"))
            action = "launch";
        else if (lower.includes("search") || lower.includes("find"))
            action = "search";
        else if (lower.includes("create") || lower.includes("make"))
            action = "create";
        else if (lower.includes("stop") || lower.includes("cancel"))
            action = "stop";
        else if (lower.includes("help"))
            action = "help";
        const cmd = { transcript, confidence, timestamp: Date.now(), action };
        if (confidence > 0.5) {
            this.commands.push(cmd);
            return cmd;
        }
        return null;
    }
    getCommandHistory() { return [...this.commands]; }
    clearHistory() { this.commands = []; }
    async onDeactivate() {
        await this.stopListening();
        await super.onDeactivate();
    }
    detectRecorder() {
        const candidates = [
            ['arecord', '-f', 'cd', '-d', '3'],
            ['rec', '-q', '-r', '16000', '-c', '1'],
            ['ffmpeg', '-f', 'alsa', '-i', 'default', '-t', '3', '-acodec', 'pcm_s16le'],
        ];
        for (const cmd of candidates) {
            try {
                execSync(`which ${cmd[0]} 2>/dev/null`, { timeout: 2000 });
                return cmd;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    /**
     * Move a finished clip somewhere it will still exist when someone wants it.
     *
     * The recorder writes to a temp path that the old flow deleted the moment it
     * had a transcript. A recording that is going to be sent into the network as
     * a file has to outlive the recording itself.
     */
    keepClip(tempPath) {
        const dir = join(tmpdir(), 'neuroclaw-recordings');
        try {
            mkdirSync(dir, { recursive: true });
            const kept = join(dir, `recording_${Date.now()}.wav`);
            renameSync(tempPath, kept);
            return kept;
        }
        catch {
            // Could not move it; the original is still a real file and still usable.
            return tempPath;
        }
    }
    /** Clips captured since the last collection, oldest first. */
    takeCaptured() {
        return this.captured.splice(0, this.captured.length);
    }
    /** Discard captured clips and the files behind them. */
    discardCaptured() {
        for (const path of this.captured.splice(0, this.captured.length)) {
            try {
                unlinkSync(path);
            }
            catch { /* already gone */ }
        }
    }
}
