import { BasePlugin } from "../plugin_manager/sdk.js";
export class OtherDevicesPlugin extends BasePlugin {
    constructor(definition) {
        super(definition);
        this.devices = [];
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
        const safeRegex = /^[a-zA-Z0-9. _()'\"\[\]~+,#-]+$/;
        if (!safeRegex.test(value)) {
            throw new Error(`Security Error: ${paramName} contains invalid characters`);
        }
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
    async list() { return [...this.devices]; }
    async disconnect(id) {
        this.validateString(id, "Device ID");
        const d = this.devices.find(dev => dev.id === id);
        if (!d)
            return false;
        d.connected = false;
        return true;
    }
    async reconnect(id) {
        this.validateString(id, "Device ID");
        const d = this.devices.find(dev => dev.id === id);
        if (!d)
            return false;
        d.connected = true;
        d.lastSeen = Date.now();
        return true;
    }
}
