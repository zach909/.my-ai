import { BasePlugin } from "../plugin_manager/sdk.js";
export class OtherDevicesPlugin extends BasePlugin {
    devices = [];
    constructor(definition) { super(definition); }
    async register(name, type) {
        const dev = {
            id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name, type, connected: true, lastSeen: Date.now(),
        };
        this.devices.push(dev);
        return dev;
    }
    async list() { return [...this.devices]; }
    async disconnect(id) {
        const d = this.devices.find(dev => dev.id === id);
        if (!d)
            return false;
        d.connected = false;
        return true;
    }
    async reconnect(id) {
        const d = this.devices.find(dev => dev.id === id);
        if (!d)
            return false;
        d.connected = true;
        d.lastSeen = Date.now();
        return true;
    }
}
