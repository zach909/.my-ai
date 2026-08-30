import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

export class toConvertAHeicPhotoFirstReadTheContainerHeaderThenExtractTheHevcPayloadNextDecodeEachTileFinallyWriteTheRgbRowsOutAsPngPlugin extends BasePlugin {
  constructor(definition: PluginDefinition) { super(definition); }

  async onMessage(message: unknown): Promise<unknown> {
    const input = String(message ?? '').trim();
    return { type: 'to-convert-a-heic-photo-first-read-the-container-header-then-extract-the-hevc-payload-next-decode-each-tile-finally-write-the-rgb-rows-out-as-png', input, processed: true, timestamp: Date.now() };
  }

  async onHealthCheck(): Promise<boolean> { return true; }
}

export const pluginDefinition: PluginDefinition = {
  id: "to-convert-a-heic-photo-first-read-the-container-header-then-extract-the-hevc-payload-next-decode-each-tile-finally-write-the-rgb-rows-out-as-png",
  name: "To convert a .heic photo: first, read the container header. Then extract the HEVC payload. Next, decode each tile. Finally, write the RGB rows out as PNG.",
  type: "api-connection",
  capabilities: ["convert"],
};
