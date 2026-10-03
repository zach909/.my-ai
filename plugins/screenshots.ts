import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";
import { selectBackend, type DesktopBackend } from "../models && skills/core/desktop/backends.js";
import { pngSize } from "../models && skills/core/desktop/png.js";

export interface ScreenshotData {
  data: string;
  width: number;
  height: number;
  format: string;
  timestamp: number;
  /** Set only when nothing was captured: the reason, in words. */
  reason?: string;
}

/**
 * Screen capture.
 *
 * Captures through the same native backends as the desktop layer (the display
 * server's own protocol on X11, the desktop portal on Wayland, the NeuroClaw
 * app on a phone), so no screenshot program is run, no temp file is written
 * and there is no command line for a filename to be injected into. The bytes
 * come back in memory.
 */
export class ScreenshotsPlugin extends BasePlugin {
  private readonly fixedBackend?: DesktopBackend;

  /** @param backend  Injectable for tests; by default chosen from the environment on each call. */
  constructor(definition: PluginDefinition, backend?: DesktopBackend) {
    super(definition);
    this.fixedBackend = backend;
  }

  private backend(): DesktopBackend {
    return this.fixedBackend ?? selectBackend();
  }

  private none(reason: string): ScreenshotData {
    return { data: "", width: 0, height: 0, format: "none", timestamp: Date.now(), reason };
  }

  /**
   * @param filename  Validated for callers that still pass one. Nothing is
   *                  written to disk any more, so it names nothing, but a
   *                  hostile value is still rejected rather than ignored.
   */
  async capture(filename?: string): Promise<ScreenshotData> {
    if (filename !== undefined) {
      if (typeof filename !== "string") {
        throw new Error("Security Error: filename must be a string.");
      }
      if (filename.startsWith("-")) {
        throw new Error("Security Error: Potential argument injection detected in filename.");
      }
    }

    try {
      const png = await this.backend().screenshot();
      const size = pngSize(png);
      return {
        data: png.toString("base64"),
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        format: "png",
        timestamp: Date.now(),
      };
    } catch (e) {
      return this.none((e as Error).message);
    }
  }

  async captureArea(x: number, y: number, w: number, h: number): Promise<ScreenshotData> {
    if (
      typeof x !== "number" || !Number.isFinite(x) || x < 0 ||
      typeof y !== "number" || !Number.isFinite(y) || y < 0
    ) {
      throw new Error("Security Error: x and y coordinates must be non-negative finite numbers.");
    }
    if (
      typeof w !== "number" || !Number.isFinite(w) || w <= 0 || !Number.isInteger(w) || w > 10000 ||
      typeof h !== "number" || !Number.isFinite(h) || h <= 0 || !Number.isInteger(h) || h > 10000
    ) {
      throw new Error("Security Error: w and h must be positive integers up to 10000.");
    }

    try {
      const png = await this.backend().screenshot({ x, y, width: w, height: h });
      const size = pngSize(png);
      return {
        data: png.toString("base64"),
        // The area actually returned, which is smaller than asked for when it
        // runs off the edge of the screen.
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        format: "png",
        timestamp: Date.now(),
      };
    } catch (e) {
      return this.none((e as Error).message);
    }
  }
}
