import { execSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { transcribeAudio } from '../models && skills/core/speech-to-text.js';

export interface VoiceCommand {
  transcript: string;
  confidence: number;
  timestamp: number;
  action?: string;
}

export class VoiceActivationPlugin extends BasePlugin {
  private listening: boolean = false;
  private commands: VoiceCommand[] = [];
  private wakeWord: string = "neuroclaw";
  private micProcess: ReturnType<typeof spawn> | null = null;

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  setWakeWord(word: string): void {
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
  getWakeWord(): string { return this.wakeWord; }

  async startListening(): Promise<boolean> {
    if (this.listening) return false;

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
        const transcript = this.transcribe(outPath);
        if (transcript) this.processTranscript(transcript);
        try { unlinkSync(outPath); } catch { /* ignore */ }
      }
    });

    return true;
  }

  async stopListening(): Promise<boolean> {
    if (!this.listening) return false;
    this.listening = false;
    if (this.micProcess) {
      this.micProcess.kill('SIGTERM');
      this.micProcess = null;
    }
    return true;
  }

  get isListening(): boolean { return this.listening; }

  async processTranscript(transcript: string): Promise<VoiceCommand | null> {
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

    let action: string | undefined;
    if (lower.includes("open") || lower.includes("launch")) action = "launch";
    else if (lower.includes("search") || lower.includes("find")) action = "search";
    else if (lower.includes("create") || lower.includes("make")) action = "create";
    else if (lower.includes("stop") || lower.includes("cancel")) action = "stop";
    else if (lower.includes("help")) action = "help";

    const cmd: VoiceCommand = { transcript, confidence, timestamp: Date.now(), action };
    if (confidence > 0.5) { this.commands.push(cmd); return cmd; }
    return null;
  }

  getCommandHistory(): VoiceCommand[] { return [...this.commands]; }
  clearHistory(): void { this.commands = []; }

  async onDeactivate(): Promise<void> {
    await this.stopListening();
    await super.onDeactivate();
  }

  private detectRecorder(): string[] | null {
    const candidates: string[][] = [
      ['arecord', '-f', 'cd', '-d', '3'],
      ['rec', '-q', '-r', '16000', '-c', '1'],
      ['ffmpeg', '-f', 'alsa', '-i', 'default', '-t', '3', '-acodec', 'pcm_s16le'],
    ];
    for (const cmd of candidates) {
      try {
        execSync(`which ${cmd[0]} 2>/dev/null`, { timeout: 2000 });
        return cmd;
      } catch { continue; }
    }
    return null;
  }

  /**
   * Transcribe a captured clip with a locally installed speech recogniser.
   *
   * This used to be simulateSTT(), which measured the clip's DURATION with
   * ffprobe and returned a synthetic string ("<wake word> audio-captured
   * duration-3s"). That is worse than returning nothing: processTranscript()
   * feeds the result straight into command matching, so the agent could act on
   * words nobody ever said. It now returns null when no recogniser is
   * installed, and the caller simply does not fire a command.
   */
  private transcribe(wavPath: string): string | null {
    try {
      const result = transcribeAudio(readFileSync(wavPath));
      return result.text;
    } catch {
      return null;
    }
  }
}
