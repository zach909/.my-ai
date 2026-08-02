import { BasePlugin } from "../plugin_manager/sdk.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
export class ScreenshotsPlugin extends BasePlugin {
    constructor(definition) { super(definition); }
    async capture(filename) {
        const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-ss-"));
        // basename() so a caller-supplied filename can't escape tmpDir via `../`;
        // execFileSync (no shell) below means it also can't inject shell commands.
        const outPath = join(tmpDir, filename ? basename(filename) : `screenshot-${Date.now()}.png`);
        try {
            if (existsSync("/usr/bin/import")) {
                execFileSync("import", ["-window", "root", outPath], { timeout: 10000 });
            }
            else if (existsSync("/usr/bin/gnome-screenshot")) {
                execFileSync("gnome-screenshot", ["-f", outPath], { timeout: 10000 });
            }
            else if (existsSync("/usr/bin/scrot")) {
                execFileSync("scrot", [outPath], { timeout: 10000 });
            }
            else if (existsSync("/usr/bin/spectacle")) {
                execFileSync("spectacle", ["-b", "-n", "-o", outPath], { timeout: 10000 });
            }
            else {
                try {
                    const dtype = process.env.DISPLAY ? "x11" : "pipe";
                    execFileSync("ffmpeg", ["-f", dtype, "-i", ":0.0", "-vframes", "1", outPath, "-y"], {
                        timeout: 10000,
                        stdio: ["ignore", "ignore", "ignore"],
                    });
                }
                catch { }
            }
            if (existsSync(outPath)) {
                const buf = readFileSync(outPath);
                const data = buf.toString("base64");
                try {
                    unlinkSync(outPath);
                }
                catch { }
                return { data, width: 1920, height: 1080, format: "png", timestamp: Date.now(), path: outPath };
            }
        }
        catch { }
        return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now() };
    }
    async captureArea(x, y, w, h) {
        const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-ss-"));
        const outPath = join(tmpDir, `area-${Date.now()}.png`);
        try {
            if (existsSync("/usr/bin/import")) {
                execFileSync("import", ["-window", "root", "-crop", `${w}x${h}+${x}+${y}`, outPath], { timeout: 10000 });
            }
            if (existsSync(outPath)) {
                const buf = readFileSync(outPath);
                return { data: buf.toString("base64"), width: w, height: h, format: "png", timestamp: Date.now(), path: outPath };
            }
        }
        catch { }
        return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now() };
    }
}
