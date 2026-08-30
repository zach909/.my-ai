import { execFileSync } from 'node:child_process';
import { BasePlugin } from "../plugin_manager/sdk.js";
/**
 * Other Devices plugin — real locally-visible peripherals via `lsusb` (USB)
 * and `bluetoothctl devices` (paired Bluetooth), which are what "other
 * devices connected to this machine" plausibly means with no external/cloud
 * API involved. Manually `register()`ed devices (e.g. ones discovered
 * through some other in-app flow) are kept in the same in-memory table and
 * merged with the real scan so both sources show up in `list()`.
 *
 * A full desktop deployment additionally wants live connect state (not just
 * "paired") from `bluetoothctl info <mac>`'s `Connected: yes/no` line, and
 * hot-plug notifications via udev/`udevadm monitor` instead of a point-in-
 * time scan on each `list()` call.
 */
export class OtherDevicesPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.devices = [];
        this.disconnected = new Set();
    }
    validateString(value, paramName, maxLength = 100) {
        if (typeof value !== "string") {
            throw new Error(`Security Error: ${paramName} must be a string`);
        }
        if (value.trim() === "") {
            throw new Error(`Security Error: ${paramName} cannot be empty`);
        }
        if (value.length > maxLength) {
            throw new Error(`Security Error: ${paramName} exceeds maximum length limit`);
        }
        const safeRegex = /^[a-zA-Z0-9. _()'\"\[\]~+,#:-]+$/;
        if (!safeRegex.test(value)) {
            throw new Error(`Security Error: ${paramName} contains invalid characters`);
        }
    }
    /** Real USB devices from `lsusb`, one line per device (Bus/Device/ID/name). */
    scanUsb() {
        try {
            const out = execFileSync('lsusb', [], { timeout: 3000, encoding: 'utf8' });
            const now = Date.now();
            return out.split('\n').filter(Boolean).map(line => {
                // "Bus 001 Device 002: ID 8087:0aaa Intel Corp. ..."
                const idMatch = line.match(/ID\s+([0-9a-fA-F]{4}:[0-9a-fA-F]{4})/);
                const id = idMatch ? `usb-${idMatch[1]}` : `usb-${line.slice(0, 20).replace(/\s+/g, '-')}`;
                const name = line.replace(/^Bus \d+ Device \d+:\s*(ID\s+\S+\s*)?/, '').trim() || line.trim();
                return { id, name, type: 'usb', connected: true, lastSeen: now };
            });
        }
        catch {
            return [];
        }
    }
    /** Real paired Bluetooth devices from `bluetoothctl devices`. */
    scanBluetooth() {
        try {
            const out = execFileSync('bluetoothctl', ['devices'], { timeout: 3000, encoding: 'utf8' });
            const now = Date.now();
            return out.split('\n').filter(Boolean).map(line => {
                // "Device AA:BB:CC:DD:EE:FF Some Device Name"
                const m = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.*)$/);
                if (!m)
                    return null;
                return { id: `bt-${m[1]}`, name: m[2] || m[1], type: 'bluetooth', connected: true, lastSeen: now };
            }).filter((d) => d !== null);
        }
        catch {
            return [];
        }
    }
    /** Merge a live OS scan with manually-registered devices; scan failures never hide registered ones. */
    scanReal() {
        return [...this.scanUsb(), ...this.scanBluetooth()];
    }
    async register(name, type) {
        this.validateString(name, "Device name");
        this.validateString(type, "Device type");
        const dev = {
            id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name, type, connected: true, lastSeen: Date.now(),
        };
        this.devices.push(dev);
        return dev;
    }
    async list() {
        const real = this.scanReal().filter(d => !this.disconnected.has(d.id));
        return [...real, ...this.devices];
    }
    async disconnect(id) {
        this.validateString(id, "Device ID");
        const registered = this.devices.find(dev => dev.id === id);
        if (registered) {
            registered.connected = false;
            return true;
        }
        // Real (lsusb/bluetoothctl-sourced) devices can't be unplugged by this
        // process, so "disconnect" records the id as hidden from list() rather
        // than claiming a hardware action that didn't happen.
        const real = this.scanReal().find(d => d.id === id);
        if (!real)
            return false;
        this.disconnected.add(id);
        return true;
    }
    async reconnect(id) {
        this.validateString(id, "Device ID");
        const registered = this.devices.find(dev => dev.id === id);
        if (registered) {
            registered.connected = true;
            registered.lastSeen = Date.now();
            return true;
        }
        if (this.disconnected.has(id)) {
            this.disconnected.delete(id);
            return true;
        }
        return false;
    }
    async onHealthCheck() { return true; }
}
