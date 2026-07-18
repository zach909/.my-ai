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
        const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
        if (!d)
            return false;
        d.enabled = true;
        return true;
    }
    async disable(name) {
        const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
        if (!d)
            return false;
        d.enabled = false;
        return true;
    }
    async scan(type) {
        const targets = type ? this.devices.filter(d => d.type === type) : this.devices;
        return targets.filter(d => d.enabled).map(d => `${d.name} (${d.type})`);
    }
}
