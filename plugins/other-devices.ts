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

  async register(name: string, type: string): Promise<Device> {
    const dev: Device = {
      id: `dev-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      name, type, connected: true, lastSeen: Date.now(),
    };
    this.devices.push(dev); return dev;
  }

  async list(): Promise<Device[]> { return [...this.devices]; }

  async disconnect(id: string): Promise<boolean> {
    const d = this.devices.find(dev => dev.id === id);
    if (!d) return false;
    d.connected = false; return true;
  }

  async reconnect(id: string): Promise<boolean> {
    const d = this.devices.find(dev => dev.id === id);
    if (!d) return false;
    d.connected = true; d.lastSeen = Date.now(); return true;
  }
}
