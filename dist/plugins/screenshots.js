import { BasePlugin } from "../plugin_manager/sdk.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
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
        finally {
            // tmpDir is created unconditionally above, but every early-return path
            // (no capture tool available, the tool failed, outPath was never
            // written) skipped removing it -- the same "unbounded resource leak"
            // bug class already fixed in camera.ts/microphone.ts, just via a
            // directory created on literally every call rather than only some.
            try {
                rmdirSync(tmpDir);
            }
            catch { }
        }
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
                const data = buf.toString("base64");
                // capture() above already unlinks outPath before returning --
                // this method never did, leaving the actual screenshot image (not
                // just an empty directory) behind on disk after every single call.
                try {
                    unlinkSync(outPath);
                }
                catch { }
                return { data, width: w, height: h, format: "png", timestamp: Date.now(), path: outPath };
            }
        }
        catch { }
        finally {
            try {
                rmdirSync(tmpDir);
            }
            catch { }
        }
        return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now() };
    }
}
