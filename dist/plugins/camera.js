import { BasePlugin } from "../plugin_manager/sdk.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
export class CameraPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.streaming = false;
        this.streamDir = null;
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
            verbs: ["photograph", "capture", "snap", "shoot", "film"],
            nouns: ["camera", "photo", "picture", "image", "selfie", "webcam", "lens"],
        };
    }
    async captureImage() {
        const tmpDir = mkdtempSync(join(tmpdir(), "neuroclaw-cam-"));
        const outPath = join(tmpDir, "capture.jpeg");
        try {
            if (existsSync("/usr/bin/fswebcam")) {
                execFileSync("fswebcam", ["--no-banner", "-r", "1280x720", outPath], { timeout: 10000, stdio: "ignore" });
            }
            else if (existsSync("/usr/bin/ffmpeg")) {
                execFileSync("ffmpeg", ["-f", "video4linux2", "-i", "/dev/video0", "-vframes", "1", outPath, "-y"], { timeout: 10000, stdio: "ignore" });
            }
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
        catch { }
        finally {
            // mkdtempSync() above runs on every call regardless of outcome (no
            // camera tool found, the tool failed, outPath never written) -- same
            // unbounded resource leak already fixed in screenshots.ts/
            // microphone.ts, just via a directory this method alone never cleaned
            // up on any path.
            try {
                unlinkSync(outPath);
            }
            catch { }
            try {
                rmdirSync(tmpDir);
            }
            catch { }
        }
        return {
            imageData: "",
            width: 0,
            height: 0,
            format: "none",
            timestamp: Date.now(),
        };
    }
    async startStream() {
        if (this.streaming)
            return false;
        this.streamDir = mkdtempSync(join(tmpdir(), "neuroclaw-stream-"));
        this.streaming = true;
        return true;
    }
    async stopStream() {
        if (!this.streaming)
            return false;
        this.streaming = false;
        if (this.streamDir && existsSync(this.streamDir)) {
            try {
                unlinkSync(join(this.streamDir, "frame.jpg"));
            }
            catch { }
            // unlinkSync() only removes files -- it always throws EISDIR on a
            // directory, so this never actually cleaned up the mkdtempSync()
            // directory startStream() created; every start/stop cycle leaked one
            // permanently, the same "unbounded growth" bug class already fixed
            // elsewhere this session, just via always-thrown-and-caught errors
            // instead of an unbounded list.
            try {
                rmdirSync(this.streamDir);
            }
            catch { }
        }
        this.streamDir = null;
        return true;
    }
    get isStreaming() {
        return this.streaming;
    }
    async onDeactivate() {
        if (this.streaming)
            await this.stopStream();
        await super.onDeactivate();
    }
}
