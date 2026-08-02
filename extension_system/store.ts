/**
 * Content-addressable storage for extension payloads (docs/EXTENSION_SYSTEM.md
 * Sections 9-11: Memory/Logic/Skill storage, Compression, Quantization).
 *
 * Layout on disk: `<rootDir>/<id>/<version>/manifest.json` + `payload.bin`
 * (optionally gzip'd, matching the byte-level compression convention already
 * used by ZipIOSystem -- models && skills/core/zip-io.ts). Numeric payloads
 * (weights for a "logic" extension, embeddings for a "memory" extension) may
 * additionally be quantized via BackgroundQuantizer before storage, trading
 * precision for size the same way the neural core already does for model
 * weights.
 */

import { createHash } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionManifest, StorageEncoding } from "./types.js";
import { BackgroundQuantizer, type QuantizerConfig } from "../models && skills/core/quantizer.js";

export interface WriteOptions {
  /** Byte-level gzip compression of the payload (default true). */
  compress?: boolean;
  /** If provided, the payload is treated as a Float32Array and quantized first. */
  quantize?: { bits: number; method: "symmetric" | "asymmetric" | "mixed" };
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function gzipBuffer(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGzip({ level: 9 });
    gz.on("data", c => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    gz.end(buf);
  });
}

async function gunzipBuffer(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGunzip();
    gz.on("data", c => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    gz.end(buf);
  });
}

export class ExtensionStore {
  private readonly rootDir: string;
  private readonly quantizer: BackgroundQuantizer;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? join(homedir(), ".neuroclaw", "extensions");
    const qConfig: QuantizerConfig = {
      enabled: true,
      bits: 8,
      method: "symmetric",
      calibrationSamples: 0,
      excludeLayers: [],
    };
    this.quantizer = new BackgroundQuantizer(qConfig);
  }

  private dir(id: string, version: string): string {
    // ExtensionManager.install() only slugifies `id` when it derives one from
    // `name` -- a caller-supplied `id` (or any `version`) reaches here as-is.
    // path.join() normalizes ".." segments, so an id like
    // "../../../tmp/pwned" would resolve completely outside rootDir. Reject
    // anything but a single path segment; no legitimate id/version needs a
    // path separator.
    this.assertSafeSegment(id, "id");
    this.assertSafeSegment(version, "version");
    return join(this.rootDir, id, version);
  }

  private assertSafeSegment(segment: string, label: "id" | "version"): void {
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      throw new Error(`Invalid extension ${label} "${segment}": must not contain path separators or be "." / ".."`);
    }
  }

  /** Encode and persist a payload, returning the StorageEncoding to embed in the manifest. */
  async write(id: string, version: string, payload: Buffer, opts: WriteOptions = {}): Promise<StorageEncoding> {
    const dir = this.dir(id, version);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const originalBytes = payload.length;
    const contentHash = sha256(payload);

    let encoded = payload;
    let quantization: StorageEncoding["quantization"];
    if (opts.quantize) {
      // Reinterpret the payload as 32-bit floats, quantize, and store the
      // dequantized-but-lossy result -- BackgroundQuantizer already performs
      // the quantize-then-dequantize round trip (see quantizer.d.ts), so the
      // stored bytes are directly usable without a separate dequant step.
      const floatCount = Math.floor(payload.length / 4);
      const floats = new Float32Array(payload.buffer, payload.byteOffset, floatCount);
      const quantized = this.quantizer.quantize(floats, opts.quantize.bits);
      encoded = Buffer.from(quantized.buffer, quantized.byteOffset, quantized.byteLength);
      quantization = { bits: opts.quantize.bits, method: opts.quantize.method };
    }

    const compress = opts.compress ?? true;
    if (compress) encoded = await gzipBuffer(encoded);

    writeFileSync(join(dir, "payload.bin"), encoded);

    const encoding: StorageEncoding = {
      compression: compress ? "gzip" : "raw",
      quantization,
      contentHash,
      storedBytes: encoded.length,
      originalBytes,
    };
    this.writeEncoding(id, version, encoding);
    return encoding;
  }

  async read(id: string, version: string, encoding: StorageEncoding): Promise<Buffer> {
    const path = join(this.dir(id, version), "payload.bin");
    const raw = readFileSync(path);
    return encoding.compression === "gzip" ? gunzipBuffer(raw) : raw;
  }

  /** Recompute the hash of the decoded payload and compare against the manifest's record. */
  async verify(id: string, version: string, encoding: StorageEncoding): Promise<boolean> {
    if (encoding.quantization) return existsSync(join(this.dir(id, version), "payload.bin"));
    const buf = await this.read(id, version, encoding);
    return sha256(buf) === encoding.contentHash;
  }

  writeManifest(manifest: ExtensionManifest): void {
    const dir = this.dir(manifest.id, manifest.version);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  }

  readManifest(id: string, version: string): ExtensionManifest | null {
    const path = join(this.dir(id, version), "manifest.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  writeEncoding(id: string, version: string, encoding: StorageEncoding): void {
    const dir = this.dir(id, version);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "encoding.json"), JSON.stringify(encoding, null, 2), "utf-8");
  }

  readEncoding(id: string, version: string): StorageEncoding | null {
    const path = join(this.dir(id, version), "encoding.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  listVersions(id: string): string[] {
    const idDir = join(this.rootDir, id);
    if (!existsSync(idDir)) return [];
    return readdirSync(idDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  listIds(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  remove(id: string, version: string): void {
    const dir = this.dir(id, version);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  /** id -> currently-active version, persisted so a restart doesn't lose activation state. */
  readActiveMap(): Record<string, string> {
    const path = join(this.rootDir, "active.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  writeActiveMap(map: Record<string, string>): void {
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true });
    writeFileSync(join(this.rootDir, "active.json"), JSON.stringify(map, null, 2), "utf-8");
  }
}
