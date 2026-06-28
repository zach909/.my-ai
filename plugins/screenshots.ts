import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ScreenshotData {
  data: string;
  width: number;
  height: number;
  format: string;
  timestamp: number;
  path?: string;
}

export class ScreenshotsPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) { super(definition); }

  async capture(filename?: string): Promise<ScreenshotData> {
    const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-ss-"));
    const outPath = join(tmpDir, filename ?? `screenshot-${Date.now()}.png`);

    try {
      if (existsSync("/usr/bin/import")) {
        execSync(`import -window root ${outPath}`, { timeout: 10000 });
      } else if (existsSync("/usr/bin/gnome-screenshot")) {
        execSync(`gnome-screenshot -f ${outPath}`, { timeout: 10000 });
      } else if (existsSync("/usr/bin/scrot")) {
        execSync(`scrot ${outPath}`, { timeout: 10000 });
      } else if (existsSync("/usr/bin/spectacle")) {
        execSync(`spectacle -b -n -o ${outPath}`, { timeout: 10000 });
      } else {
        try {
          const dtype = process.env.DISPLAY ? "x11" : "pipe";
          execSync(`ffmpeg -f ${dtype} -i :0.0 -vframes 1 ${outPath} -y 2>/dev/null`, { timeout: 10000 });
        } catch { }
      }

      if (existsSync(outPath)) {
        const buf = readFileSync(outPath);
        const data = buf.toString("base64");
        try { unlinkSync(outPath); } catch { }
        return { data, width: 1920, height: 1080, format: "png", timestamp: Date.now(), path: outPath };
      }
    } catch { }

    return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now() };
  }

  async captureArea(x: number, y: number, w: number, h: number): Promise<ScreenshotData> {
    const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-ss-"));
    const outPath = join(tmpDir, `area-${Date.now()}.png`);
    try {
      if (existsSync("/usr/bin/import")) {
        execSync(`import -window root -crop ${w}x${h}+${x}+${y} ${outPath}`, { timeout: 10000 });
      }
      if (existsSync(outPath)) {
        const buf = readFileSync(outPath);
        return { data: buf.toString("base64"), width: w, height: h, format: "png", timestamp: Date.now(), path: outPath };
      }
    } catch { }
    return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now() };
  }
}
