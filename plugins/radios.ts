import type { PluginDefinition } from "../plugin_manager/types";
import { BasePlugin } from "../plugin_manager/sdk";

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
    const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
    if (!d) return false;
    d.enabled = true; return true;
  }

  async disable(name: string): Promise<boolean> {
    const d = this.devices.find(dev => dev.name.toLowerCase() === name.toLowerCase());
    if (!d) return false;
    d.enabled = false; return true;
  }

  async scan(type?: RadioDevice["type"]): Promise<string[]> {
    const targets = type ? this.devices.filter(d => d.type === type) : this.devices;
    return targets.filter(d => d.enabled).map(d => `${d.name} (${d.type})`);
  }
}
