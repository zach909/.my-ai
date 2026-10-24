/**
 * A minimal Buffer, for the phone's JS runtime (no node:buffer there, and no
 * third-party browser-Buffer polyfill package: AGENTS.md).
 *
 * Covers exactly what the engine's phone-reachable code uses:
 *   - Buffer.from(string, "utf8" | "base64")
 *   - Buffer.from(arrayBuffer, byteOffset?, length?) -- a VIEW sharing memory
 *     with that ArrayBuffer, same as Node's Buffer.from(arrayBuffer, ...);
 *     models && skills/core/onebrain.ts relies on this to decode straight
 *     into a Float32Array/Float64Array's own backing memory.
 *   - Buffer.from(arrayLikeOfBytes) -- copies, same as Node's Buffer.from(array)
 *   - Buffer.concat(list)
 *   - buffer.toString("utf8" | "base64")
 *
 * UTF-8 is hand-rolled rather than built on TextEncoder/TextDecoder: those are
 * Web APIs that a bare JavaScriptCore context (iOS, no WKWebView) does not
 * provide, the same reason mobile/brain/src/shims.ts hand-polyfills
 * setTimeout and console instead of assuming a browser environment.
 */

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + BASE64_CHARS[(n >> 6) & 63] + BASE64_CHARS[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + "==";
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + BASE64_CHARS[(n >> 6) & 63] + "=";
  }
  return out;
}

function base64Decode(text: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i++) lookup[BASE64_CHARS.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.ceil((text.length * 6) / 8));
  let bitBuf = 0;
  let bitCount = 0;
  let pos = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? lookup[code] : -1;
    if (value < 0) continue; // padding '=' or whitespace: skip
    bitBuf = (bitBuf << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[pos++] = (bitBuf >> bitCount) & 0xff;
    }
  }
  return out.subarray(0, pos);
}

/** RFC 3629 UTF-8, encoding each Unicode code point (surrogate pairs combined first). */
function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

/** RFC 3629 UTF-8 decode, combining 4-byte sequences back into surrogate pairs for charCodeAt-based strings. */
function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let code: number;
    let len: number;
    if (b0 < 0x80) { code = b0; len = 1; }
    else if ((b0 & 0xe0) === 0xc0) { code = b0 & 0x1f; len = 2; }
    else if ((b0 & 0xf0) === 0xe0) { code = b0 & 0x0f; len = 3; }
    else if ((b0 & 0xf8) === 0xf0) { code = b0 & 0x07; len = 4; }
    else { i++; continue; } // invalid leading byte: skip it
    if (i + len > bytes.length) break;
    for (let k = 1; k < len; k++) code = (code << 6) | (bytes[i + k] & 0x3f);
    i += len;
    if (code < 0x10000) {
      out += String.fromCharCode(code);
    } else {
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
  }
  return out;
}

type Encoding = "utf8" | "utf-8" | "base64";

// Node's own Buffer.from narrows Uint8Array.from's (iterable-of-numbers)
// signature the same way; intentional here too.
// @ts-expect-error -- Buffer.from intentionally narrows Uint8Array.from's static signature
export class Buffer extends Uint8Array {
  static from(input: string, encoding?: Encoding): Buffer;
  static from(input: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
  static from(input: ArrayLike<number> | Uint8Array): Buffer;
  static from(input: string | ArrayBuffer | ArrayLike<number> | Uint8Array, encodingOrOffset?: Encoding | number, length?: number): Buffer {
    if (typeof input === "string") {
      const encoding = (encodingOrOffset as Encoding | undefined) ?? "utf8";
      const bytes = encoding === "base64" ? base64Decode(input) : utf8Encode(input);
      const out = new Buffer(bytes.length);
      out.set(bytes);
      return out;
    }
    if (input instanceof ArrayBuffer) {
      return new Buffer(input, (encodingOrOffset as number | undefined) ?? 0, length);
    }
    const src = input as ArrayLike<number>;
    const out = new Buffer(src.length);
    out.set(src);
    return out;
  }

  static concat(list: Uint8Array[]): Buffer {
    const total = list.reduce((sum, b) => sum + b.length, 0);
    const out = new Buffer(total);
    let offset = 0;
    for (const b of list) {
      out.set(b, offset);
      offset += b.length;
    }
    return out;
  }

  toString(encoding: Encoding = "utf8"): string {
    return encoding === "base64" ? base64Encode(this) : utf8Decode(this);
  }
}
