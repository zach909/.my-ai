import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

export interface AudioData {
  data: string;
  duration: number;
  sampleRate: number;
  channels: number;
  timestamp: number;
  path?: string;
}

export class MicrophonePlugin extends BasePlugin {
  private recording: boolean = false;
  private recordPid: number | null = null;
  private recordPath: string | null = null;
  private audioLevel: number = 0;

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  /**
   * How someone would ASK for this, not what the plugin calls itself.
   *
   * Added after the agent exam measured routing and found this plugin
   * unreachable for the obvious phrasing: the only terms available were its id
   * and its manifest capabilities, so a request had to contain the plugin's
   * own name to find it.
   */
  describeCapabilities() {
    return {
      verbs: ["listen", "capture", "dictate"],
      nouns: ["microphone", "mic", "audio", "sound", "voice", "recording"],
    };
  }

  async startRecording(): Promise<boolean> {
    if (this.recording) return false;
    const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-audio-"));
    this.recordPath = join(tmpDir, "recording.wav");

    try {
      if (existsSync("/usr/bin/arecord")) {
        const proc = spawn("arecord", ["-f", "cd", "-t", "wav", this.recordPath], {
          stdio: "ignore",
          detached: true,
        });
        this.recordPid = proc.pid ?? null;
        proc.unref();
        this.recording = true;

        this.audioLevel = 0.5;
        return true;
      } else if (existsSync("/usr/bin/ffmpeg")) {
        const proc = spawn("ffmpeg", ["-f", "alsa", "-i", "default", "-acodec", "pcm_s16le", this.recordPath, "-y"], {
          stdio: "ignore",
          detached: true,
        });
        this.recordPid = proc.pid ?? null;
        proc.unref();
        this.recording = true;
        this.audioLevel = 0.5;
        return true;
      }
    } catch { }

    this.recording = true;
    this.audioLevel = 0.3;
    return true;
  }

  async stopRecording(): Promise<AudioData> {
    this.recording = false;

    if (this.recordPid !== null) {
      try {
        process.kill(this.recordPid, "SIGTERM");
      } catch { }
      this.recordPid = null;
    }

    let data = "";
    let size = 0;

    if (this.recordPath && existsSync(this.recordPath)) {
      const buf = readFileSync(this.recordPath);
      data = buf.toString("base64");
      size = buf.length;
      try { unlinkSync(this.recordPath); } catch { }
    }
    if (this.recordPath) {
      // startRecording() puts recordPath inside a dedicated mkdtempSync()
      // directory it never stores anywhere else -- gated on the same
      // existsSync(recordPath) check as the read above, cleanup only ran
      // when a recording tool actually wrote the .wav file. Neither
      // arecord nor ffmpeg being installed (startRecording()'s fallback
      // path) still creates the directory, just never the file inside it,
      // so that (also empty) directory leaked on every single session with
      // no recording tool available -- the same leak bug class already
      // fixed in camera.ts's stopStream(), just reachable through a wider
      // set of paths here.
      try { rmdirSync(dirname(this.recordPath)); } catch { }
    }

    this.audioLevel = 0;
    return {
      data,
      duration: size / 44100 / 2,
      sampleRate: 44100,
      channels: 2,
      timestamp: Date.now(),
      path: this.recordPath ?? undefined,
    };
  }

  getAudioLevel(): number {
    return this.audioLevel;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  async onDeactivate(): Promise<void> {
    if (this.recording) await this.stopRecording();
    await super.onDeactivate();
  }
}
