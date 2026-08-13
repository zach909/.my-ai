import { describe, it, expect } from "vitest";
import { OtherDevicesPlugin } from "../../plugins/other-devices";

describe("OtherDevicesPlugin Security and Input Validation", () => {
  const pluginDef = {
    id: "other-devices",
    name: "Other Devices",
    type: "api-connection",
    capabilities: ["other-devices"],
  } as any;

  it("allows registering, listing, disconnecting, and reconnecting with valid parameters", async () => {
    const plugin = new OtherDevicesPlugin(pluginDef);

    // Register a valid device
    const dev = await plugin.register("My Android Phone", "phone");
    expect(dev).toBeDefined();
    expect(dev.id).toBeDefined();
    expect(dev.name).toBe("My Android Phone");
    expect(dev.type).toBe("phone");
    expect(dev.connected).toBe(true);
    expect(dev.lastSeen).toBeLessThanOrEqual(Date.now());

    // List devices
    const list = await plugin.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(dev.id);

    // Disconnect the device
    const disconnected = await plugin.disconnect(dev.id);
    expect(disconnected).toBe(true);

    const listAfterDisconnect = await plugin.list();
    expect(listAfterDisconnect[0].connected).toBe(false);

    // Reconnect the device
    const reconnected = await plugin.reconnect(dev.id);
    expect(reconnected).toBe(true);

    const listAfterReconnect = await plugin.list();
    expect(listAfterReconnect[0].connected).toBe(true);
  });

  describe("register() input validation", () => {
    it("rejects non-string names", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.register(null as any, "phone")).rejects.toThrow(/Security Error: Device name must be a string/);
      await expect(plugin.register(123 as any, "phone")).rejects.toThrow(/Security Error: Device name must be a string/);
      await expect(plugin.register({} as any, "phone")).rejects.toThrow(/Security Error: Device name must be a string/);
    });

    it("rejects non-string types", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.register("DeviceName", null as any)).rejects.toThrow(/Security Error: Device type must be a string/);
      await expect(plugin.register("DeviceName", 123 as any)).rejects.toThrow(/Security Error: Device type must be a string/);
      await expect(plugin.register("DeviceName", {} as any)).rejects.toThrow(/Security Error: Device type must be a string/);
    });

    it("rejects empty or whitespace names", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.register("", "phone")).rejects.toThrow(/Security Error: Device name cannot be empty/);
      await expect(plugin.register("   ", "phone")).rejects.toThrow(/Security Error: Device name cannot be empty/);
    });

    it("rejects empty or whitespace types", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.register("Phone", "")).rejects.toThrow(/Security Error: Device type cannot be empty/);
      await expect(plugin.register("Phone", "   ")).rejects.toThrow(/Security Error: Device type cannot be empty/);
    });

    it("rejects names longer than 100 characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const longName = "a".repeat(101);
      await expect(plugin.register(longName, "phone")).rejects.toThrow(/Security Error: Device name exceeds maximum length limit/);
    });

    it("rejects types longer than 100 characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const longType = "b".repeat(101);
      await expect(plugin.register("Phone", longType)).rejects.toThrow(/Security Error: Device type exceeds maximum length limit/);
    });

    it("rejects names/types containing invalid characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const unsafeStrings = ["<script>", "user;drop", "abc\ndef", "\\unsafe", "phone&whoami"];
      for (const input of unsafeStrings) {
        await expect(plugin.register(input, "phone")).rejects.toThrow(/Security Error: Device name contains invalid characters/);
        await expect(plugin.register("Phone", input)).rejects.toThrow(/Security Error: Device type contains invalid characters/);
      }
    });

    it("allows valid safe characters including brackets, quotes, and parentheses", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const safeNames = [
        "Pixel 8 Pro",
        "iPhone_15",
        "smart-tv",
        "My-Phone-123",
        "Tablet.Home",
        "John's iPad",
        "iPad (3)",
        "Nest Mini [Kitchen]",
        "Office, Printer",
        "Device#1",
        "Phone+Charger",
      ];
      for (const name of safeNames) {
        const dev = await plugin.register(name, "phone");
        expect(dev.name).toBe(name);
      }
    });
  });

  describe("disconnect() input validation", () => {
    it("rejects non-string IDs", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.disconnect(null as any)).rejects.toThrow(/Security Error: Device ID must be a string/);
      await expect(plugin.disconnect(456 as any)).rejects.toThrow(/Security Error: Device ID must be a string/);
    });

    it("rejects IDs longer than 100 characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const longId = "b".repeat(101);
      await expect(plugin.disconnect(longId)).rejects.toThrow(/Security Error: Device ID exceeds maximum length limit/);
    });

    it("rejects IDs with unsafe characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.disconnect("dev-id; rm -rf")).rejects.toThrow(/Security Error: Device ID contains invalid characters/);
    });
  });

  describe("reconnect() input validation", () => {
    it("rejects non-string IDs", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.reconnect(null as any)).rejects.toThrow(/Security Error: Device ID must be a string/);
      await expect(plugin.reconnect(456 as any)).rejects.toThrow(/Security Error: Device ID must be a string/);
    });

    it("rejects IDs longer than 100 characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      const longId = "b".repeat(101);
      await expect(plugin.reconnect(longId)).rejects.toThrow(/Security Error: Device ID exceeds maximum length limit/);
    });

    it("rejects IDs with unsafe characters", async () => {
      const plugin = new OtherDevicesPlugin(pluginDef);
      await expect(plugin.reconnect("dev-id; rm -rf")).rejects.toThrow(/Security Error: Device ID contains invalid characters/);
    });
  });
});
