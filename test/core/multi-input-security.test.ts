import { describe, test, expect, beforeEach } from "vitest";
import { MultiInputPlugin } from "../../plugins/multi-input.js";

describe("MultiInputPlugin Security & Validation", () => {
  let plugin: MultiInputPlugin;

  beforeEach(() => {
    plugin = new MultiInputPlugin({
      id: "multi-input",
      name: "Multi-Input Plugin",
      version: "1.0.0",
      description: "Handles virtual input and multi-desktop isolation",
    });
  });

  describe("type command validation", () => {
    test("rejects non-string text parameter", async () => {
      await expect(
        plugin.onMessage({ type: "type", text: 12345 })
      ).rejects.toThrow("Security Error: Text must be a string.");

      await expect(
        plugin.onMessage({ type: "type", text: null })
      ).rejects.toThrow("Security Error: Text must be a string.");
    });

    test("rejects empty or whitespace-only text", async () => {
      await expect(
        plugin.onMessage({ type: "type", text: "" })
      ).rejects.toThrow("Security Error: Text cannot be empty.");

      await expect(
        plugin.onMessage({ type: "type", text: "   \t\n  " })
      ).rejects.toThrow("Security Error: Text cannot be empty.");
    });

    test("rejects excessively long text (> 1000 chars)", async () => {
      const longText = "a".repeat(1001);
      await expect(
        plugin.onMessage({ type: "type", text: longText })
      ).rejects.toThrow("Security Error: Text exceeds maximum length limit of 1000 characters.");
    });

    test("allows valid text payload", async () => {
      const res = (await plugin.onMessage({ type: "type", text: "Hello World!" })) as {
        typed: number;
        text: string;
      };
      expect(res.typed).toBe(12);
      expect(res.text).toBe("Hello World!");
    });
  });

  describe("click and moveto coordinate and button validation", () => {
    test("rejects non-finite, negative, or out-of-bounds coordinates in moveto", async () => {
      await expect(
        plugin.onMessage({ type: "moveto", x: -10, y: 100 })
      ).rejects.toThrow("Security Error: x must be a finite number between 0 and 10000.");

      await expect(
        plugin.onMessage({ type: "moveto", x: 100, y: 20000 })
      ).rejects.toThrow("Security Error: y must be a finite number between 0 and 10000.");

      await expect(
        plugin.onMessage({ type: "moveto", x: NaN, y: 100 })
      ).rejects.toThrow("Security Error: x must be a finite number between 0 and 10000.");

      await expect(
        plugin.onMessage({ type: "moveto", x: "100", y: 100 })
      ).rejects.toThrow("Security Error: x must be a finite number between 0 and 10000.");
    });

    test("rejects invalid button values in click", async () => {
      await expect(
        plugin.onMessage({ type: "click", button: 5 })
      ).rejects.toThrow("Security Error: Button must be 1, 2, or 3.");

      await expect(
        plugin.onMessage({ type: "click", button: "1" })
      ).rejects.toThrow("Security Error: Button must be 1, 2, or 3.");
    });

    test("allows valid click and moveto coordinates", async () => {
      const moveRes = (await plugin.onMessage({ type: "moveto", x: 500, y: 300 })) as {
        moved: boolean;
        x: number;
        y: number;
      };
      expect(moveRes.moved).toBe(true);
      expect(moveRes.x).toBe(500);
      expect(moveRes.y).toBe(300);

      const clickRes = (await plugin.onMessage({ type: "click", button: 1, x: 100, y: 200 })) as {
        clicked: boolean;
        button: number;
      };
      expect(clickRes.clicked).toBe(true);
      expect(clickRes.button).toBe(1);
    });
  });

  describe("device binding parameter validation", () => {
    test("rejects invalid or unsafe deviceId in bind-device and unbind-device", async () => {
      await expect(
        plugin.onMessage({ type: "bind-device", deviceId: 123, workspace: "ai" })
      ).rejects.toThrow("Security Error: deviceId must be a string.");

      await expect(
        plugin.onMessage({ type: "bind-device", deviceId: "   ", workspace: "ai" })
      ).rejects.toThrow("Security Error: deviceId cannot be empty.");

      await expect(
        plugin.onMessage({
          type: "bind-device",
          deviceId: "dev; rm -rf /",
          workspace: "ai",
        })
      ).rejects.toThrow("Security Error: deviceId contains invalid characters.");

      await expect(
        plugin.onMessage({ type: "unbind-device", deviceId: "dev@invalid!" })
      ).rejects.toThrow("Security Error: deviceId contains invalid characters.");
    });

    test("rejects invalid or unsafe workspace in bind-device", async () => {
      await expect(
        plugin.onMessage({ type: "bind-device", deviceId: "mouse1", workspace: "ws; calc" })
      ).rejects.toThrow("Security Error: workspace contains invalid characters.");

      await expect(
        plugin.onMessage({ type: "bind-device", deviceId: "mouse1", workspace: " " })
      ).rejects.toThrow("Security Error: workspace cannot be empty.");
    });

    test("allows valid device binding and unbinding", async () => {
      // Register input device first so assignDeviceToDevice succeeds
      (plugin as any).desktopManager.registerInputDevice({
        id: "mouse_phys_1",
        type: "mouse",
        name: "Physical Mouse 1",
        assignedDesktop: null,
      });

      const bindRes = (await plugin.onMessage({
        type: "bind-device",
        deviceId: "mouse_phys_1",
        workspace: "user_desktop",
      })) as { bound: boolean; deviceId: string; workspace: string };
      expect(bindRes.bound).toBe(true);
      expect(bindRes.deviceId).toBe("mouse_phys_1");
      expect(bindRes.workspace).toBe("user_desktop");

      const unbindRes = (await plugin.onMessage({
        type: "unbind-device",
        deviceId: "mouse_phys_1",
      })) as { unbound: boolean; deviceId: string };
      expect(unbindRes.unbound).toBe(true);
    });
  });

  describe("release-input validation", () => {
    test("rejects missing or invalid release type", async () => {
      await expect(
        plugin.onMessage({ type: "release-input", releaseType: "invalid-type" })
      ).rejects.toThrow("Security Error: Invalid or missing release type.");
    });

    test("validates parameters based on release type", async () => {
      await expect(
        plugin.onMessage({ type: "release-input", releaseType: "motion", x: -1, y: 10 })
      ).rejects.toThrow("Security Error: x must be a finite number between 0 and 10000.");

      await expect(
        plugin.onMessage({ type: "release-input", releaseType: "key", key: 12345 })
      ).rejects.toThrow("Security Error: Key must be a string.");

      await expect(
        plugin.onMessage({ type: "release-input", releaseType: "key", key: "a".repeat(33) })
      ).rejects.toThrow("Security Error: Key exceeds maximum length limit of 32 characters.");
    });
  });
});
