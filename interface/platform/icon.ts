/**
 * The app icon, drawn in code.
 *
 * The owner's rule is that the app's look is the coral cord turning around a
 * glowing sphere, and that no picture or logo stands in for it. So the icon is
 * that same scene (the cord seen at a tilt, six rises and six dips, around a
 * dark glowing sphere, on the warm dark ground), rendered here with plain maths
 * into a PNG. Nothing is drawn from a file and no image tool is involved.
 *
 * Used for the install icons of the web app (served at /app-icon-192.png and
 * /app-icon-512.png), for the Chrome extension (16/32/48/128) and the desktop
 * and phone packaging, so every platform shows the same mark.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode 8-bit RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const cache = new Map<string, Buffer>();

/**
 * Render the icon at `size` pixels square.
 * `maskable` keeps everything inside the central 80% so a launcher may crop it to a circle.
 */
export function renderIconPng(size: number, maskable = false): Buffer {
  const key = `${size}:${maskable}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const SS = size >= 96 ? 2 : 3;               // supersampling, then averaged down
  const W = size * SS;
  const px = new Float32Array(W * W * 4);      // premultiplied-free RGBA in 0..1
  const cx = W / 2, cy = W / 2;
  const fit = maskable ? 0.78 : 0.94;

  // Ground: the page's warm dark radial fade.
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / (W * 0.72);
      const t = Math.min(1, d);
      const i = (y * W + x) * 4;
      px[i] = (0x1b + (0x11 - 0x1b) * t) / 255;
      px[i + 1] = (0x12 + (0x0c - 0x12) * t) / 255;
      px[i + 2] = (0x16 + (0x0e - 0x16) * t) / 255;
      px[i + 3] = 1;
    }
  }

  const blend = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * W + x) * 4;
    px[i] = px[i] * (1 - a) + r * a;
    px[i + 1] = px[i + 1] * (1 - a) + g * a;
    px[i + 2] = px[i + 2] * (1 - a) + b * a;
  };

  const disc = (ox: number, oy: number, rad: number, shade: (nx: number, ny: number, nz: number) => [number, number, number], softEdge = 1.2) => {
    const x0 = Math.max(0, Math.floor(ox - rad - 1)), x1 = Math.min(W - 1, Math.ceil(ox + rad + 1));
    const y0 = Math.max(0, Math.floor(oy - rad - 1)), y1 = Math.min(W - 1, Math.ceil(oy + rad + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        const d = Math.hypot(dx, dy);
        if (d > rad + softEdge) continue;
        const a = d <= rad - softEdge ? 1 : Math.max(0, Math.min(1, (rad + softEdge - d) / (2 * softEdge)));
        const nx = dx / rad, ny = dy / rad;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const [r, g, b] = shade(nx, ny, nz);
        blend(x, y, r, g, b, a);
      }
    }
  };

  // Glow behind the sphere.
  const sphereR = W * 0.2 * fit;
  const glowR = sphereR * 1.9;
  for (let y = Math.max(0, Math.floor(cy - glowR)); y < Math.min(W, Math.ceil(cy + glowR)); y++) {
    for (let x = Math.max(0, Math.floor(cx - glowR)); x < Math.min(W, Math.ceil(cx + glowR)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > glowR) continue;
      const t = (d - sphereR * 0.8) / (glowR - sphereR * 0.8);
      const a = t <= 0 ? 0.26 : 0.26 * Math.pow(1 - t, 2);
      blend(x, y, 1, 0.54, 0.44, a);
    }
  }

  // The cord: a closed wave, six rises and six dips, tips tucked in and the middle eased out, tilted toward the viewer.
  const N = 360;
  const R = W * 0.36 * fit;
  const tilt = 1.02;                          // radians about the x axis
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const beads: Array<{ x: number; y: number; z: number }> = [];
  for (let n = 0; n < N; n++) {
    const th = (n / N) * Math.PI * 2;
    const rad = R * (1 + 0.04 - 0.14 * (0.5 + 0.5 * Math.cos(12 * th)));
    const x = rad * Math.cos(th);
    const z0 = -rad * Math.sin(th);
    const y0 = R * 0.085 * Math.cos(6 * th);
    beads.push({ x, y: y0 * ct - z0 * st, z: y0 * st + z0 * ct });
  }
  beads.sort((a, b) => a.z - b.z);
  const beadR = W * 0.034 * fit;
  const light = [-0.45, -0.55, 0.7];
  const cord = (depth: number) => (nx: number, ny: number, nz: number): [number, number, number] => {
    const lam = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    const spec = Math.pow(Math.max(0, lam), 14) * 0.35;
    const k = (0.55 + 0.55 * depth) * (0.62 + 0.5 * lam);
    return [Math.min(1, (0.95 * k) + spec), Math.min(1, (0.56 * k) + spec), Math.min(1, (0.47 * k) + spec)];
  };
  const drawBeads = (front: boolean) => {
    for (const b of beads) {
      if ((b.z > 0) !== front) continue;
      const depth = Math.max(0, Math.min(1, (b.z / R + 1) / 2));
      disc(cx + b.x, cy + b.y, beadR, cord(depth));
    }
  };
  drawBeads(false);

  // The sphere in the centre.
  disc(cx, cy, sphereR, (nx, ny, nz) => {
    const lam = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
    return [(26 + 70 * lam) / 255, (13 + 38 * lam) / 255, (16 + 38 * lam) / 255];
  }, 1.6);

  drawBeads(true);

  // Average down.
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2];
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      out[o] = Math.round((r / n) * 255);
      out[o + 1] = Math.round((g / n) * 255);
      out[o + 2] = Math.round((b / n) * 255);
      out[o + 3] = 255;
    }
  }
  const png = encodePng(size, size, out);
  cache.set(key, png);
  return png;
}
