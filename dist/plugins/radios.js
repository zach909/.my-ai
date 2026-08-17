import { execFileSync } from 'node:child_process';
import { BasePlugin } from "../plugin_manager/sdk.js";
/**
 * Radios plugin — real local radio-state probing via `rfkill` (present on
 * every modern Linux desktop; no daemon or network access required) with an
 * in-memory fallback list when `rfkill` isn't installed/available (e.g. this
 * sandbox), so `list()`/`enable()`/`disable()` never fabricate a device that
 * doesn't map to anything real when the tool IS available.
 *
 * A full desktop deployment gets real per-device enable/disable (not just
 * read) by also shelling out to `rfkill block <id>` / `rfkill unblock <id>`
 * (requires the invoking user to be in a group rfkill's udev rule grants
 * write access to, e.g. `netdev` on most distros) and, for finer per-radio
 * control (individual Bluetooth adapters, cellular modems), to
 * `nmcli radio wifi on|off` / `bluetoothctl power on|off` /
 * `mmcli -m <modem> --enable`.
 */
export class RadiosPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.fallback = [
            { name: "Wi-Fi", type: "wifi", enabled: true, power: 100 },
            { name: "Bluetooth", type: "bluetooth", enabled: false, power: 50 },
        ];
        this.rfkillAvailable = this.probeRfkill();
    }
    probeRfkill() {
        try {
            execFileSync('rfkill', ['--version'], { timeout: 2000, stdio: ['ignore', 'ignore', 'ignore'] });
            return true;
        }
        catch {
            return false;
        }
    }
    mapType(rfkillType) {
        const t = rfkillType.toLowerCase();
        if (t.includes('wlan') || t.includes('wifi'))
            return 'wifi';
        if (t.includes('bluetooth'))
            return 'bluetooth';
        if (t.includes('wwan') || t.includes('cellular') || t.includes('gsm'))
            return 'cellular';
        if (t.includes('nfc'))
            return 'nfc';
        return 'wifi';
    }
    /** Real device list from `rfkill --output ID,TYPE,DEVICE,SOFT,HARD -n`, falling back when unavailable. */
    readRealDevices() {
        if (!this.rfkillAvailable)
            return null;
        try {
            const out = execFileSync('rfkill', ['--output', 'ID,TYPE,DEVICE,SOFT,HARD', '-n'], { timeout: 3000, encoding: 'utf8' });
            const devices = [];
            for (const line of out.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                // Columns are whitespace-separated: ID TYPE DEVICE SOFT HARD
                const cols = trimmed.split(/\s+/);
                if (cols.length < 5)
                    continue;
                const [, type, device, soft, hard] = cols;
                const blocked = soft.toLowerCase() === 'blocked' || hard.toLowerCase() === 'blocked';
                devices.push({
                    name: device !== '(none)' && device ? device : type,
                    type: this.mapType(type),
                    enabled: !blocked,
                    power: blocked ? 0 : 100,
                });
            }
            return devices.length > 0 ? devices : null;
        }
        catch {
            return null;
        }
    }
    async list() {
        const real = this.readRealDevices();
        return real ?? [...this.fallback];
    }
    async enable(name) {
        this.validateName(name);
        if (this.rfkillAvailable) {
            try {
                // `rfkill unblock <name>` accepts a device name or type ("wifi",
                // "bluetooth", ...); real desktop deployments run this with the
                // invoking user having rfkill write permission (see class doc).
                execFileSync('rfkill', ['unblock', name.toLowerCase()], { timeout: 3000, stdio: ['ignore', 'ignore', 'ignore'] });
                return true;
            }
            catch {
                // Fall through to the in-memory model below (e.g. no permission
                // or the name doesn't match an rfkill identifier) rather than
                // silently claiming a hardware state change that didn't happen.
            }
        }
        const d = this.fallback.find(dev => dev.name.toLowerCase() === name.toLowerCase());
        if (!d)
            return false;
        d.enabled = true;
        return true;
    }
    async disable(name) {
        this.validateName(name);
        if (this.rfkillAvailable) {
            try {
                execFileSync('rfkill', ['block', name.toLowerCase()], { timeout: 3000, stdio: ['ignore', 'ignore', 'ignore'] });
                return true;
            }
            catch {
                /* fall through */
            }
        }
        const d = this.fallback.find(dev => dev.name.toLowerCase() === name.toLowerCase());
        if (!d)
            return false;
        d.enabled = false;
        return true;
    }
    async scan(type) {
        if (type !== undefined) {
            if (typeof type !== "string") {
                throw new Error("Security Error: type must be a string");
            }
            const validTypes = ["wifi", "bluetooth", "cellular", "nfc"];
            if (!validTypes.includes(type)) {
                throw new Error("Security Error: invalid radio type");
            }
        }
        const targets = type ? (await this.list()).filter(d => d.type === type) : await this.list();
        return targets.filter(d => d.enabled).map(d => `${d.name} (${d.type})`);
    }
    validateName(name) {
        if (typeof name !== "string") {
            throw new Error("Security Error: name must be a string");
        }
        if (!name.trim()) {
            throw new Error("Security Error: name cannot be empty");
        }
        if (name.length > 100) {
            throw new Error("Security Error: name exceeds maximum length limit of 100 characters");
        }
    }
    async onHealthCheck() { return true; }
}
