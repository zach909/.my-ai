import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CameraData {
  imageData: string;
  width: number;
  height: number;
  format: string;
  timestamp: number;
  path?: string;
}

export class CameraPlugin extends BasePlugin {
  private streaming: boolean = false;
  private streamDir: string | null = null;

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  async captureImage(): Promise<CameraData> {
    const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-cam-"));
    const outPath = join(tmpDir, "capture.jpeg");

    try {
      if (existsSync("/usr/bin/ffmpeg") || existsSync("/usr/bin/fswebcam")) {
        const cmd = existsSync("/usr/bin/fswebcam")
          ? `fswebcam --no-banner -r 1280x720 ${outPath} 2>/dev/null`
          : `ffmpeg -f video4linux2 -i /dev/video0 -vframes 1 ${outPath} -y 2>/dev/null`;
        execSync(cmd, { timeout: 10000 });
        if (existsSync(outPath)) {
          const data = readFileSync(outPath);
          return {
            imageData: data.toString("base64"),
            width: 1280,
            height: 720,
            format: "jpeg",
            timestamp: Date.now(),
            path: outPath,
          };
        }
      }
    } catch { }

    return {
      imageData: "",
      width: 0,
      height: 0,
      format: "none",
      timestamp: Date.now(),
    };
  }

  async startStream(): Promise<boolean> {
    if (this.streaming) return false;
    this.streamDir = mkdtempSync(join(tmpdir(), "neuroclaw-stream-"));
    this.streaming = true;
    return true;
  }

  async stopStream(): Promise<boolean> {
    if (!this.streaming) return false;
    this.streaming = false;
    if (this.streamDir && existsSync(this.streamDir)) {
      try { unlinkSync(join(this.streamDir, "frame.jpg")); } catch { }
      try { unlinkSync(this.streamDir); } catch { }
    }
    this.streamDir = null;
    return true;
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  async onDeactivate(): Promise<void> {
    if (this.streaming) await this.stopStream();
    await super.onDeactivate();
  }
}
