/**
 * The app's own settings: the ones every platform's interface shares.
 *
 * One file (`settings.json` in the user's data folder), one schema, one
 * validator. The web page, the browser extension and the phone apps' web view
 * all read and write it through /api/app-settings, so a choice made on one
 * device is what every other device of the same server shows.
 *
 * Only options that do something are listed. Each field says what it does and
 * where the effect is applied, and test/platform/settings.test.mjs checks that
 * every field has an effect consumer. Anything not in the schema is rejected
 * rather than stored, so the file cannot grow settings nothing reads.
 *
 * Saving is atomic and reports failure: a read-only folder produces an error
 * that says so (and the in-memory value is NOT changed), never a silent loss
 * or a crash. A damaged file falls back to defaults and is left in place until
 * the next successful save.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../../models && skills/core/atomic-write.js';
import { configFile } from './app-paths.js';
import { isAcceptableManifestUrl } from './update.js';
export const DEFAULT_SETTINGS = {
    appearance: { ambient: true, reduceMotion: 'system' },
    chat: { keepLocalHistory: true },
    updates: { channel: 'stable', checkAutomatically: false, manifestUrl: 'https://github.com/zach909/.my-ai/releases/latest/download/release-manifest.json' },
};
/** What each field is, for the settings page and for the effects test. */
export const SETTINGS_FIELDS = [
    { path: 'appearance.ambient', type: 'boolean', label: 'Ring and glow background', help: 'Turn off for a plain dark background (saves battery on phones).', effect: 'interface/ambient.ts: hides #nc-ambient' },
    { path: 'appearance.reduceMotion', type: 'enum', values: ['system', 'on', 'off'], label: 'Reduce motion', help: 'System follows your device. On keeps the ring nearly still. Off keeps full motion.', effect: 'interface/ambient.ts: ring speed' },
    { path: 'chat.keepLocalHistory', type: 'boolean', label: 'Remember the chat on this device', help: 'Keeps the conversation on the home page in this browser. Turn off and it is cleared on reload.', effect: 'interface/web-server.ts HTML_TEMPLATE: localStorage nc_hist' },
    { path: 'updates.channel', type: 'enum', values: ['stable', 'beta'], label: 'Update channel', help: 'Stable only offers finished releases.', effect: 'interface/platform/update.ts' },
    { path: 'updates.checkAutomatically', type: 'boolean', label: 'Check for updates when Settings opens', help: 'Contacts the update address below. Nothing is downloaded or installed.', effect: 'interface/platform/settings-page.ts' },
    { path: 'updates.manifestUrl', type: 'url', label: 'Update address', help: 'Where the release manifest is published. Must be https (or local http). Empty turns update checks off.', effect: 'interface/platform/update.ts' },
];
export class SettingsError extends Error {
    constructor(message, status = 400, field) {
        super(message);
        this.status = status;
        this.field = field;
    }
}
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function clone(s) { return JSON.parse(JSON.stringify(s)); }
/**
 * Apply a partial change to settings. Unknown groups or fields, and values of
 * the wrong type, throw SettingsError naming the field. Returns a new object.
 */
export function applyPatch(current, patch) {
    if (!isObj(patch))
        throw new SettingsError('Send a JSON object of settings to change.');
    const next = clone(current);
    for (const [group, values] of Object.entries(patch)) {
        if (!(group in DEFAULT_SETTINGS))
            throw new SettingsError(`Unknown settings group "${group}".`, 400, group);
        if (!isObj(values))
            throw new SettingsError(`"${group}" must be an object.`, 400, group);
        for (const [key, value] of Object.entries(values)) {
            const field = `${group}.${key}`;
            const spec = SETTINGS_FIELDS.find((f) => f.path === field);
            if (!spec)
                throw new SettingsError(`Unknown setting "${field}".`, 400, field);
            if (spec.type === 'boolean') {
                if (typeof value !== 'boolean')
                    throw new SettingsError(`${spec.label} must be on or off.`, 400, field);
            }
            else if (spec.type === 'enum') {
                if (typeof value !== 'string' || !spec.values.includes(value))
                    throw new SettingsError(`${spec.label} must be one of: ${spec.values.join(', ')}.`, 400, field);
            }
            else if (spec.type === 'url') {
                if (typeof value !== 'string' || value.length > 500)
                    throw new SettingsError(`${spec.label} must be text under 500 characters.`, 400, field);
                const v = value.trim();
                if (v !== '' && !isAcceptableManifestUrl(v))
                    throw new SettingsError(`${spec.label} must start with https:// (or be a local http:// address).`, 400, field);
                next[group][key] = v;
                continue;
            }
            next[group][key] = value;
        }
    }
    return next;
}
/** Fill gaps and drop anything invalid from whatever was on disk. Never throws. */
export function normalize(raw) {
    let out = clone(DEFAULT_SETTINGS);
    if (!isObj(raw))
        return out;
    // Apply field by field so one bad value does not discard the good ones.
    for (const [group, values] of Object.entries(raw)) {
        if (!isObj(values))
            continue;
        for (const [key, value] of Object.entries(values)) {
            try {
                out = applyPatch(out, { [group]: { [key]: value } });
            }
            catch { /* keep the default for this field */ }
        }
    }
    return out;
}
export class SettingsStore {
    constructor(fileOverride) {
        this.fileOverride = fileOverride;
        this.cache = null;
        this.lastSave = { ok: true, error: null, file: '' };
    }
    get file() {
        return configFile('settings.json', this.fileOverride ?? process.env.NEUROCLAW_SETTINGS_FILE).write;
    }
    load() {
        if (this.cache)
            return clone(this.cache);
        const { read } = configFile('settings.json', this.fileOverride ?? process.env.NEUROCLAW_SETTINGS_FILE);
        let raw = null;
        try {
            if (existsSync(read))
                raw = JSON.parse(readFileSync(read, 'utf8'));
        }
        catch {
            raw = null;
        }
        this.cache = normalize(raw);
        return clone(this.cache);
    }
    /** Validate, write atomically, and only then remember. Throws SettingsError (400 bad input, 500 cannot save). */
    update(patch) {
        const next = applyPatch(this.load(), patch);
        const file = this.file;
        try {
            writeJsonAtomic(file, next);
        }
        catch (err) {
            const code = err?.code;
            const why = code === 'EACCES' || code === 'EROFS' || code === 'EPERM'
                ? `${path.dirname(file)} is not writable for this user`
                : code === 'ENOSPC' ? 'the disk is full' : err instanceof Error ? err.message : String(err);
            this.lastSave = { ok: false, error: `Settings were not saved: ${why}.`, file };
            throw new SettingsError(this.lastSave.error, 500);
        }
        this.lastSave = { ok: true, error: null, file };
        this.cache = next;
        return clone(next);
    }
    /** Forget the cached copy so the next load reads the file again (tests, and a restart in miniature). */
    reset() { this.cache = null; }
}
let shared = null;
export function sharedSettings() {
    if (!shared)
        shared = new SettingsStore();
    return shared;
}
export function resetSharedSettings() { shared = null; }
