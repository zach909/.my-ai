import { BasePlugin } from "../plugin_manager/sdk.js";
export class RadiosPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.devices = [
            { name: "Wi-Fi", type: "wifi", enabled: true, power: 100 },
            { name: "Bluetooth", type: "bluetooth", enabled: false, power: 50 },
        ];
    }
    async list() { return [...this.devices]; }
    async enable(name) {
        if (typeof name !== "string") {
            throw new Error("Security Error: name must be a string");
        }
        if (!name.trim()) {
            throw new Error("Security Error: name cannot be empty");
        }
        if (name.length > 100) {
            throw new Error("Security Error: name exceeds maximum length limit of 100 characters");
        }
        const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
        if (!d)
            return false;
        d.enabled = true;
        return true;
    }
    async disable(name) {
        if (typeof name !== "string") {
            throw new Error("Security Error: name must be a string");
        }
        if (!name.trim()) {
            throw new Error("Security Error: name cannot be empty");
        }
        if (name.length > 100) {
            throw new Error("Security Error: name exceeds maximum length limit of 100 characters");
        }
        const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
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
        const targets = type ? this.devices.filter(d => d.type === type) : this.devices;
        return targets.filter(d => d.enabled).map(d => `${d.name} (${d.type})`);
    }
}
