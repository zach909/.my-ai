import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface Device {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  lastSeen: number;
}

export class OtherDevicesPlugin extends BasePlugin {
  private devices: Device[] = [];

  constructor(definition: PluginDefinition) { super(definition); }

  private validateString(value: any, paramName: string, maxLength: number = 100): void {
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

  async register(name: string, type: string): Promise<Device> {
    this.validateString(name, "Device name");
    this.validateString(type, "Device type");

    const dev: Device = {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name, type, connected: true, lastSeen: Date.now(),
    };
    this.devices.push(dev); return dev;
  }

  async list(): Promise<Device[]> { return [...this.devices]; }

  async disconnect(id: string): Promise<boolean> {
    this.validateString(id, "Device ID");
    const d = this.devices.find(dev => dev.id === id);
    if (!d) return false;
    d.connected = false; return true;
  }

  async reconnect(id: string): Promise<boolean> {
    this.validateString(id, "Device ID");
    const d = this.devices.find(dev => dev.id === id);
    if (!d) return false;
    d.connected = true; d.lastSeen = Date.now(); return true;
  }
}
