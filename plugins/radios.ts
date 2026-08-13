import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export interface RadioDevice {
  name: string;
  type: "wifi" | "bluetooth" | "cellular" | "nfc";
  enabled: boolean;
  power: number;
}

export class RadiosPlugin extends BasePlugin {
  private devices: RadioDevice[] = [
    { name: "Wi-Fi", type: "wifi", enabled: true, power: 100 },
    { name: "Bluetooth", type: "bluetooth", enabled: false, power: 50 },
  ];

  constructor(definition: PluginDefinition) { super(definition); }

  async list(): Promise<RadioDevice[]> { return [...this.devices]; }

  async enable(name: string): Promise<boolean> {
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
    if (!d) return false;
    d.enabled = true; return true;
  }

  async disable(name: string): Promise<boolean> {
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
    if (!d) return false;
    d.enabled = false; return true;
  }

  async scan(type?: RadioDevice["type"]): Promise<string[]> {
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
