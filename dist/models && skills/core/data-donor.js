/**
 * Data donor: let this computer's own senses be training data.
 *
 * Off by default, and every part of it is a separate switch the owner turns on
 * knowingly. When on, what this computer sees (screen) and hears (audio) is
 * spooled to disk as the raw bytes it is, and a trainer drains the spool. No
 * transcription and no tokenizer: the project's rule is that text, audio and
 * images all enter the mesh as bits through the Zip Loop, so the spool is just
 * bytes in the order they arrived.
 *
 * ── Where the data goes ────────────────────────────────────────────────
 *
 * Nowhere off this machine. There is no upload path in this file, by design:
 * the spool is read by the local trainer and by nothing else, which is the same
 * structural boundary conversation-learning-agent.mjs keeps. What other
 * installs can ever receive is the numeric learning that comes out of training
 * (see NEUROCLAW_SHARED_LEARNING in the privacy policy), never the capture.
 * Sharing raw screen and audio would also record other people -- whoever is on
 * a call, in the room, on screen -- who agreed to nothing, and in many places
 * recording a voice without consent is unlawful. The owner can only consent
 * for themselves.
 *
 * ── Guard rails that are the point, not decoration ─────────────────────
 *
 *   - Consent is recorded when a source is first switched on, and "always
 *     listening" is shown as a state (status().recording) a UI can display.
 *   - Pause (for N minutes) and quiet hours stop capture without losing
 *     settings. Turning a source off stops it at once: every ingest re-reads
 *     the settings, nothing is cached.
 *   - The spool is a ring: when it reaches its size cap the OLDEST chunks are
 *     deleted first, so this can never fill a disk.
 *   - eraseAll() deletes everything captured and is not gated.
 *   - The spool is written 0600 under ~/.neuroclaw and is gitignored.
 *
 *   ~/.neuroclaw/donor/settings.json, ~/.neuroclaw/donor/spool/    (override: CORONA_DONOR_DIR)
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.js";
export class DonorError extends Error {
}
export const DONOR_SOURCES = ["screen", "audio"];
const MAX_CHUNK_BYTES = { screen: 8 * 1024 * 1024, audio: 4 * 1024 * 1024 };
export function donorDir() {
    return process.env.CORONA_DONOR_DIR ? path.resolve(process.env.CORONA_DONOR_DIR) : path.join(homedir(), ".neuroclaw", "donor");
}
const settingsFile = () => path.join(donorDir(), "settings.json");
const spoolDir = () => path.join(donorDir(), "spool");
export const defaultDonorSettings = () => ({
    enabled: false,
    sources: { screen: false, audio: false },
    consentAt: { screen: null, audio: null },
    pausedUntil: null,
    quietHours: null,
    maxSpoolMb: 512,
    screenIntervalSec: 30,
});
const validClock = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Never throws. Anything unreadable means the safe default: off. */
export function loadDonorSettings() {
    const d = defaultDonorSettings();
    try {
        const raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
        d.enabled = raw.enabled === true;
        for (const s of DONOR_SOURCES) {
            d.sources[s] = raw.sources?.[s] === true;
            const at = raw.consentAt?.[s];
            d.consentAt[s] = typeof at === "number" ? at : null;
        }
        d.pausedUntil = typeof raw.pausedUntil === "number" ? raw.pausedUntil : null;
        d.quietHours = raw.quietHours && validClock(raw.quietHours.from) && validClock(raw.quietHours.to) ? raw.quietHours : null;
        if (typeof raw.maxSpoolMb === "number" && raw.maxSpoolMb >= 16 && raw.maxSpoolMb <= 20000)
            d.maxSpoolMb = raw.maxSpoolMb;
        if (typeof raw.screenIntervalSec === "number" && raw.screenIntervalSec >= 5 && raw.screenIntervalSec <= 3600)
            d.screenIntervalSec = raw.screenIntervalSec;
    }
    catch {
        // Missing or corrupt: defaults, which capture nothing.
    }
    return d;
}
export const DONOR_DISCLOSURE = {
    screen: "Screenshots of everything on this computer's display, every few seconds, including passwords typed in the open, private messages, and other people's faces and words on screen. Stored on this device only and used to train this device's network.",
    audio: "Continuous audio from the microphone, including your voice, other people in the room and anyone on a call. Stored on this device only and used to train this device's network. Tell the people around you.",
};
export function updateDonorSettings(update, now = Date.now()) {
    const s = loadDonorSettings();
    if (update.sources) {
        for (const src of DONOR_SOURCES) {
            const want = update.sources[src];
            if (typeof want !== "boolean")
                continue;
            if (want && !s.sources[src]) {
                if (update.acknowledge !== true) {
                    throw new DonorError(`Turning on ${src} needs "acknowledge": true. It captures: ${DONOR_DISCLOSURE[src]}`);
                }
                s.consentAt[src] = now;
            }
            s.sources[src] = want;
        }
        for (const k of Object.keys(update.sources)) {
            if (!DONOR_SOURCES.includes(k))
                throw new DonorError(`"${k}" is not a source. Expected: ${DONOR_SOURCES.join(", ")}.`);
        }
    }
    if (typeof update.enabled === "boolean")
        s.enabled = update.enabled;
    if (update.quietHours === null)
        s.quietHours = null;
    else if (update.quietHours) {
        if (!validClock(update.quietHours.from) || !validClock(update.quietHours.to))
            throw new DonorError("quietHours is {from, to} as HH:MM, 24-hour.");
        s.quietHours = { from: update.quietHours.from, to: update.quietHours.to };
    }
    if (update.maxSpoolMb !== undefined) {
        if (!Number.isFinite(update.maxSpoolMb) || update.maxSpoolMb < 16 || update.maxSpoolMb > 20000)
            throw new DonorError("maxSpoolMb is 16 to 20000.");
        s.maxSpoolMb = update.maxSpoolMb;
    }
    if (update.screenIntervalSec !== undefined) {
        if (!Number.isFinite(update.screenIntervalSec) || update.screenIntervalSec < 5 || update.screenIntervalSec > 3600)
            throw new DonorError("screenIntervalSec is 5 to 3600.");
        s.screenIntervalSec = update.screenIntervalSec;
    }
    mkdirSync(donorDir(), { recursive: true, mode: 0o700 });
    writeJsonAtomic(settingsFile(), s);
    return s;
}
/** Stop capturing for a while without touching any other setting. 0 clears a pause. */
export function pauseDonor(minutes, now = Date.now()) {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 7 * 24 * 60)
        throw new DonorError("Pause is 0 to 10080 minutes.");
    const s = loadDonorSettings();
    s.pausedUntil = minutes === 0 ? null : now + minutes * 60000;
    mkdirSync(donorDir(), { recursive: true, mode: 0o700 });
    writeJsonAtomic(settingsFile(), s);
    return s;
}
function inQuietHours(q, at) {
    if (!q)
        return false;
    const mins = (c) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));
    const cur = at.getHours() * 60 + at.getMinutes();
    const from = mins(q.from);
    const to = mins(q.to);
    if (from === to)
        return false;
    return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}
/** Why capture is not happening for a source right now, or null if it is. */
export function captureBlocked(source, s = loadDonorSettings(), now = Date.now()) {
    if (!s.enabled)
        return "The data donor is off.";
    if (!s.sources[source])
        return `${source} is not switched on.`;
    if (s.pausedUntil && now < s.pausedUntil)
        return "Paused.";
    if (inQuietHours(s.quietHours, new Date(now)))
        return "Quiet hours.";
    return null;
}
function spoolFiles() {
    const dir = spoolDir();
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const name of readdirSync(dir)) {
        // <epoch-ms 13 digits>-<source>-<hex>.bin ; names sort oldest first.
        const m = /^(\d{13})-(screen|audio)-[0-9a-f]{8}\.bin$/.exec(name);
        if (!m)
            continue;
        try {
            out.push({ name, source: m[2], bytes: statSync(path.join(dir, name)).size });
        }
        catch {
            // Vanished between readdir and stat; nothing to count.
        }
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
export function spoolStatus() {
    const st = { chunks: 0, bytes: 0, bySource: { screen: { chunks: 0, bytes: 0 }, audio: { chunks: 0, bytes: 0 } } };
    for (const f of spoolFiles()) {
        st.chunks++;
        st.bytes += f.bytes;
        st.bySource[f.source].chunks++;
        st.bySource[f.source].bytes += f.bytes;
    }
    return st;
}
/**
 * Take one chunk of what the computer saw or heard. Re-reads the settings every
 * time, so switching a source off takes effect on the very next chunk.
 */
export function ingestDonation(source, bytes, now = Date.now()) {
    if (!DONOR_SOURCES.includes(source))
        return { accepted: false, reason: `Unknown source "${source}".` };
    const settings = loadDonorSettings();
    const blocked = captureBlocked(source, settings, now);
    if (blocked)
        return { accepted: false, reason: blocked };
    if (bytes.byteLength === 0)
        return { accepted: false, reason: "Empty chunk." };
    if (bytes.byteLength > MAX_CHUNK_BYTES[source])
        return { accepted: false, reason: `A ${source} chunk is at most ${MAX_CHUNK_BYTES[source]} bytes.` };
    const dir = spoolDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = `${String(now).padStart(13, "0")}-${source}-${randomBytes(4).toString("hex")}.bin`;
    const file = path.join(dir, name);
    writeFileAtomic(file, Buffer.from(bytes));
    try {
        chmodSync(file, 0o600);
    }
    catch {
        // Not every filesystem has modes.
    }
    enforceRing(settings.maxSpoolMb * 1024 * 1024);
    return { accepted: true, bytes: bytes.byteLength };
}
/** Delete oldest chunks until the spool fits. */
function enforceRing(maxBytes) {
    const files = spoolFiles();
    let total = files.reduce((n, f) => n + f.bytes, 0);
    for (const f of files) {
        if (total <= maxBytes)
            break;
        try {
            rmSync(path.join(spoolDir(), f.name), { force: true });
            total -= f.bytes;
        }
        catch {
            // Leave it for the next pass.
        }
    }
}
/**
 * Hand the oldest chunks to the trainer. A chunk is deleted only AFTER the sink
 * resolves, so a crash or a failed training pass loses nothing and a chunk is
 * never learned from twice.
 */
export async function drainDonations(sink, maxChunks = 32) {
    let trained = 0;
    let failed = 0;
    for (const f of spoolFiles().slice(0, maxChunks)) {
        const full = path.join(spoolDir(), f.name);
        try {
            await sink(f.source, readFileSync(full));
            rmSync(full, { force: true });
            trained++;
        }
        catch {
            failed++;
            break; // The trainer is unwell; keep order and try again later.
        }
    }
    return { trained, failed };
}
/** Delete everything captured. Never gated: the owner can always take their data back. */
export function eraseAllDonations() {
    const files = spoolFiles();
    for (const f of files)
        rmSync(path.join(spoolDir(), f.name), { force: true });
    return files.length;
}
export function donorStatus(now = Date.now()) {
    const settings = loadDonorSettings();
    const recording = { screen: false, audio: false };
    for (const s of DONOR_SOURCES)
        recording[s] = captureBlocked(s, settings, now) === null;
    return { settings, recording, anyRecording: DONOR_SOURCES.some(s => recording[s]), spool: spoolStatus(), disclosure: DONOR_DISCLOSURE };
}
/**
 * Sample the screen on the owner's schedule. `capture` is whatever takes a
 * screenshot on this machine (the desktop layer). Settings are re-read each
 * tick, so the interval, pause and off all apply without a restart. Returns a
 * stop function.
 */
export function startScreenDonor(capture) {
    let stopped = false;
    let timer;
    const tick = async () => {
        if (stopped)
            return;
        const s = loadDonorSettings();
        try {
            if (captureBlocked("screen", s) === null) {
                const shot = await capture();
                ingestDonation("screen", shot);
            }
        }
        catch {
            // No display, no permission, a screenshot that failed: skip this sample.
        }
        if (!stopped)
            timer = setTimeout(tick, s.screenIntervalSec * 1000);
    };
    timer = setTimeout(tick, 5000);
    return () => {
        stopped = true;
        if (timer)
            clearTimeout(timer);
    };
}
