import { describe, it, expect, beforeEach } from "vitest";
import { RadiosPlugin } from "../../plugins/radios.js";
import type { PluginDefinition } from "../../plugin_manager/types.js";

describe("RadiosPlugin Security and Validation", () => {
  let plugin: RadiosPlugin;

  beforeEach(() => {
    const dummyDef: PluginDefinition = {
      id: "radios",
      name: "Radios Control",
      version: "1.0.0",
      description: "Handles device radio devices",
      enabled: true,
    };
    plugin = new RadiosPlugin(dummyDef);
  });

  describe("enable method", () => {
    it("allows valid parameters", async () => {
      const result = await plugin.enable("Wi-Fi");
      expect(result).toBe(true);
    });

    it("rejects non-string name parameter", async () => {
      await expect(plugin.enable(123 as any)).rejects.toThrow("Security Error: name must be a string");
      await expect(plugin.enable({} as any)).rejects.toThrow("Security Error: name must be a string");
      await expect(plugin.enable(null as any)).rejects.toThrow("Security Error: name must be a string");
    });

    it("rejects empty or whitespace-only name parameter", async () => {
      await expect(plugin.enable("")).rejects.toThrow("Security Error: name cannot be empty");
      await expect(plugin.enable("   ")).rejects.toThrow("Security Error: name cannot be empty");
    });

    it("rejects name parameters exceeding 100 characters", async () => {
      const longName = "A".repeat(101);
      await expect(plugin.enable(longName)).rejects.toThrow("Security Error: name exceeds maximum length limit of 100 characters");
    });
  });

  describe("disable method", () => {
    it("allows valid parameters", async () => {
      const result = await plugin.disable("Wi-Fi");
      expect(result).toBe(true);
    });

    it("rejects non-string name parameter", async () => {
      await expect(plugin.disable(123 as any)).rejects.toThrow("Security Error: name must be a string");
      await expect(plugin.disable({} as any)).rejects.toThrow("Security Error: name must be a string");
      await expect(plugin.disable(null as any)).rejects.toThrow("Security Error: name must be a string");
    });

    it("rejects empty or whitespace-only name parameter", async () => {
      await expect(plugin.disable("")).rejects.toThrow("Security Error: name cannot be empty");
      await expect(plugin.disable("   ")).rejects.toThrow("Security Error: name cannot be empty");
    });

    it("rejects name parameters exceeding 100 characters", async () => {
      const longName = "A".repeat(101);
      await expect(plugin.disable(longName)).rejects.toThrow("Security Error: name exceeds maximum length limit of 100 characters");
    });
  });

  describe("scan method", () => {
    it("allows valid undefined type", async () => {
      const result = await plugin.scan();
      expect(result).toContain("Wi-Fi (wifi)");
    });

    it("allows valid defined type", async () => {
      const result = await plugin.scan("wifi");
      expect(result).toContain("Wi-Fi (wifi)");
    });

    it("rejects non-string type parameter", async () => {
      await expect(plugin.scan(123 as any)).rejects.toThrow("Security Error: type must be a string");
      await expect(plugin.scan({} as any)).rejects.toThrow("Security Error: type must be a string");
    });

    it("rejects invalid enum type values", async () => {
      await expect(plugin.scan("invalid-type" as any)).rejects.toThrow("Security Error: invalid radio type");
      await expect(plugin.scan("WIFI" as any)).rejects.toThrow("Security Error: invalid radio type");
    });
  });
});
