/** node:zlib's gzipSync/gunzipSync, for the Zip Loop's archive, via fflate. */
import { gzipSync as gz, gunzipSync as gunz } from "fflate";
import { Buffer } from "buffer";

export function gzipSync(data: Uint8Array): Buffer {
  return Buffer.from(gz(new Uint8Array(data)));
}
export function gunzipSync(data: Uint8Array): Buffer {
  return Buffer.from(gunz(new Uint8Array(data)));
}
