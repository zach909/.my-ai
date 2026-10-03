/**
 * A direct X11 client, written against the protocol and Node's own `node:net`.
 *
 * This replaces wmctrl, xdotool and gnome-screenshot. Those are three programs
 * somebody else wrote, that a machine may or may not have, that a phone never
 * has, and that all do the same thing underneath: open the display's socket and
 * send it requests. So this does that itself.
 *
 * What it speaks:
 *   - the connection handshake, including the MIT-MAGIC-COOKIE-1 from
 *     $XAUTHORITY / ~/.Xauthority;
 *   - core requests: InternAtom, GetProperty, ChangeProperty, GetGeometry,
 *     QueryTree, TranslateCoordinates, SendEvent, ConfigureWindow,
 *     SetInputFocus / GetInputFocus, GetImage, GetKeyboardMapping,
 *     ChangeKeyboardMapping, QueryExtension;
 *   - the XTEST extension's FakeInput, which is how synthetic keys and clicks
 *     are delivered the same way a real device would.
 *   - the EWMH conventions window managers agree on: _NET_CLIENT_LIST,
 *     _NET_ACTIVE_WINDOW, _NET_CLOSE_WINDOW, _NET_MOVERESIZE_WINDOW.
 *
 * It does NOT speak Wayland. A Wayland compositor does not let a client list
 * other clients' windows or inject input into them -- that is the design, not
 * a gap here -- so on a Wayland session this only sees XWayland clients.
 *
 * Every method that changes something is followed by a round trip, so a
 * rejected request surfaces as an error at the call that caused it rather than
 * vanishing into a later, unrelated one.
 */

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import { encodePng } from "./png.js";

const REQUEST_TIMEOUT_MS = 8_000;
const PAD = (n: number) => (4 - (n % 4)) % 4;

export class X11Error extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

/** Could not reach or authenticate with the display at all. */
export class X11Unreachable extends X11Error {}

const ERROR_NAMES: Record<number, string> = {
  1: "BadRequest", 2: "BadValue", 3: "BadWindow", 4: "BadPixmap", 5: "BadAtom", 6: "BadCursor",
  7: "BadFont", 8: "BadMatch", 9: "BadDrawable", 10: "BadAccess", 11: "BadAlloc", 12: "BadColormap",
  13: "BadGC", 14: "BadIDChoice", 15: "BadName", 16: "BadLength", 17: "BadImplementation",
};

// ── display and authority ─────────────────────────────────────────────────

export interface DisplayAddress {
  host: string;
  display: number;
  screen: number;
}

export function parseDisplay(value: string): DisplayAddress {
  const m = /^(.*):(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new X11Unreachable(`"${value}" is not a display address like ":0".`);
  return { host: m[1], display: Number(m[2]), screen: m[3] ? Number(m[3]) : 0 };
}

interface AuthEntry {
  family: number;
  address: string;
  number: string;
  name: string;
  data: Buffer;
}

/** Parse an Xauthority file: repeated (family, address, number, name, data) records. */
export function parseXauthority(buf: Buffer): AuthEntry[] {
  const out: AuthEntry[] = [];
  let off = 0;
  const str = () => {
    if (off + 2 > buf.length) throw new RangeError("truncated");
    const n = buf.readUInt16BE(off);
    off += 2;
    if (off + n > buf.length) throw new RangeError("truncated");
    const b = buf.subarray(off, off + n);
    off += n;
    return b;
  };
  try {
    while (off + 2 <= buf.length) {
      const family = buf.readUInt16BE(off);
      off += 2;
      out.push({
        family,
        address: str().toString("latin1"),
        number: str().toString("latin1"),
        name: str().toString("latin1"),
        data: Buffer.from(str()),
      });
    }
  } catch {
    // A truncated trailing record is ignored; the ones before it are good.
  }
  return out;
}

function findAuth(addr: DisplayAddress): { name: string; data: Buffer } | null {
  const file = process.env.XAUTHORITY || `${os.homedir()}/.Xauthority`;
  let entries: AuthEntry[];
  try {
    entries = parseXauthority(fs.readFileSync(file));
  } catch {
    return null;
  }
  const local = addr.host === "" || addr.host === "unix";
  const hostname = os.hostname();
  const hit = entries.find(e => {
    if (e.name !== "MIT-MAGIC-COOKIE-1") return false;
    if (e.number !== "" && e.number !== String(addr.display)) return false;
    if (e.family === 0xffff) return true; // wildcard
    if (e.family === 256) return e.address === (local ? hostname : addr.host); // "Local"
    return false;
  });
  return hit ? { name: hit.name, data: hit.data } : null;
}

function openSocket(addr: DisplayAddress): Promise<net.Socket> {
  const attempt = (opts: net.NetConnectOpts) =>
    new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(opts);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
  const local = addr.host === "" || addr.host === "unix";
  if (!local) return attempt({ host: addr.host, port: 6000 + addr.display });
  const path = `/tmp/.X11-unix/X${addr.display}`;
  // Abstract socket (Linux) second: some servers listen only there.
  return attempt({ path }).catch(() => attempt({ path: "\0" + path }));
}

// ── connection ────────────────────────────────────────────────────────────

export interface X11Setup {
  ridBase: number;
  ridMask: number;
  imageByteOrder: number; // 0 = least significant byte first
  minKeycode: number;
  maxKeycode: number;
  formats: Array<{ depth: number; bitsPerPixel: number; scanlinePad: number }>;
  root: number;
  width: number;
  height: number;
  rootVisual: number;
  rootDepth: number;
  visuals: Map<number, { red: number; green: number; blue: number }>;
}

interface Pending {
  seq: number;
  resolve: (reply: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface X11Window {
  /** `0x%08x`, the way a window manager lists it. */
  id: string;
  desktop: string;
  pid: number;
  host: string;
  title: string;
}

// Predefined atoms from the core protocol.
const ATOM_ATOM = 4;
const ATOM_CARDINAL = 6;
const ATOM_STRING = 31;
const ATOM_WINDOW = 33;

const SUBSTRUCTURE_MASK = 0x100000 | 0x80000; // SubstructureRedirect | SubstructureNotify

export class X11 {
  private buf: Buffer = Buffer.alloc(0);
  private seq = 0;
  private pending: Pending[] = [];
  private unclaimedErrors: X11Error[] = [];
  private closedWith: Error | null = null;
  private setupResolve!: (s: X11Setup) => void;
  private setupReject!: (e: Error) => void;
  private setupDone = false;
  private atomCache = new Map<string, number>();
  private xtest: number | null | undefined;
  setup!: X11Setup;
  /** Called with each raw 32-byte event, for windows this connection created. */
  onEvent: ((event: Buffer) => void) | null = null;
  private nextResource = 1;

  private constructor(private readonly sock: net.Socket) {
    sock.on("data", (chunk: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.drain();
    });
    sock.on("error", err => this.fail(new X11Unreachable(`Lost the connection to the display: ${err.message}`)));
    sock.on("close", () => this.fail(new X11Unreachable("The display closed the connection.")));
  }

  /** Connect to `display` (default $DISPLAY), authenticate and read the server's setup. */
  static async connect(display: string | undefined = process.env.DISPLAY): Promise<X11> {
    if (!display) throw new X11Unreachable("DISPLAY is not set.");
    const addr = parseDisplay(display);
    let sock: net.Socket;
    try {
      sock = await openSocket(addr);
    } catch (e) {
      throw new X11Unreachable(`Could not connect to the X display "${display}": ${(e as Error).message}`);
    }
    const x = new X11(sock);
    const ready = new Promise<X11Setup>((resolve, reject) => {
      x.setupResolve = resolve;
      x.setupReject = reject;
    });
    const auth = findAuth(addr);
    const name = Buffer.from(auth?.name ?? "", "latin1");
    const data = auth?.data ?? Buffer.alloc(0);
    const hello = Buffer.alloc(12 + name.length + PAD(name.length) + data.length + PAD(data.length));
    hello[0] = 0x6c; // 'l': we are little-endian
    hello.writeUInt16LE(11, 2);
    hello.writeUInt16LE(0, 4);
    hello.writeUInt16LE(name.length, 6);
    hello.writeUInt16LE(data.length, 8);
    name.copy(hello, 12);
    data.copy(hello, 12 + name.length + PAD(name.length));
    sock.write(hello);
    const timer = setTimeout(() => x.setupReject(new X11Unreachable("The display did not answer the handshake.")), REQUEST_TIMEOUT_MS);
    try {
      x.setup = await ready;
    } catch (e) {
      sock.destroy();
      throw e;
    } finally {
      clearTimeout(timer);
    }
    return x;
  }

  /** Run `fn` against a fresh connection and always close it. */
  static async with<T>(fn: (x: X11) => Promise<T>, display?: string): Promise<T> {
    const x = await X11.connect(display);
    try {
      return await fn(x);
    } finally {
      x.close();
    }
  }

  close(): void {
    this.sock.destroy();
  }

  private fail(err: Error): void {
    if (this.closedWith) return;
    this.closedWith = err;
    if (!this.setupDone) this.setupReject(err);
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  // ── wire ────────────────────────────────────────────────────────────────

  private drain(): void {
    if (!this.setupDone) {
      if (this.buf.length < 8) return;
      const status = this.buf[0];
      const total = 8 + this.buf.readUInt16LE(6) * 4;
      if (this.buf.length < total) return;
      const packet = this.buf.subarray(0, total);
      this.buf = this.buf.subarray(total);
      if (status !== 1) {
        const reason = packet.toString("utf8", 8, 8 + packet[1]).trim();
        this.setupDone = true;
        this.setupReject(
          new X11Unreachable(
            status === 2
              ? "The display wants further authentication that this client cannot give."
              : `The display refused the connection${reason ? `: ${reason}` : "."}${
                  /authoriz|protocol not supported/i.test(reason) ? " (Check XAUTHORITY.)" : ""
                }`,
          ),
        );
        return;
      }
      this.setupDone = true;
      try {
        this.setupResolve(this.parseSetup(packet.subarray(8)));
      } catch (e) {
        this.setupReject(e as Error);
      }
    }
    while (this.buf.length >= 32) {
      const kind = this.buf[0];
      const total = kind === 1 || kind === 35 ? 32 + this.buf.readUInt32LE(4) * 4 : 32;
      if (this.buf.length < total) return;
      const packet = this.buf.subarray(0, total);
      this.buf = this.buf.subarray(total);
      if (kind === 1) {
        const seq = packet.readUInt16LE(2);
        const at = this.pending.findIndex(p => p.seq === seq);
        if (at >= 0) {
          const [p] = this.pending.splice(at, 1);
          clearTimeout(p.timer);
          p.resolve(packet);
        }
      } else if (kind === 0) {
        const code = packet[1];
        const seq = packet.readUInt16LE(2);
        const err = new X11Error(
          `X error ${ERROR_NAMES[code] ?? code} (request ${packet[10]}.${packet.readUInt16LE(8)}, resource 0x${packet.readUInt32LE(4).toString(16)})`,
          code,
        );
        const at = this.pending.findIndex(p => p.seq === seq);
        if (at >= 0) {
          const [p] = this.pending.splice(at, 1);
          clearTimeout(p.timer);
          p.reject(err);
        } else {
          this.unclaimedErrors.push(err);
        }
      }
      else this.onEvent?.(Buffer.from(packet));
    }
  }

  private parseSetup(b: Buffer): X11Setup {
    const vendorLen = b.readUInt16LE(16);
    const nRoots = b[20];
    const nFormats = b[21];
    let off = 32 + vendorLen + PAD(vendorLen);
    const formats: X11Setup["formats"] = [];
    for (let i = 0; i < nFormats; i++, off += 8) {
      formats.push({ depth: b[off], bitsPerPixel: b[off + 1], scanlinePad: b[off + 2] });
    }
    if (nRoots < 1) throw new X11Unreachable("The display reported no screens.");
    const s = off;
    const setup: X11Setup = {
      ridBase: b.readUInt32LE(4),
      ridMask: b.readUInt32LE(8),
      imageByteOrder: b[22],
      minKeycode: b[26],
      maxKeycode: b[27],
      formats,
      root: b.readUInt32LE(s),
      width: b.readUInt16LE(s + 20),
      height: b.readUInt16LE(s + 22),
      rootVisual: b.readUInt32LE(s + 32),
      rootDepth: b[s + 38],
      visuals: new Map(),
    };
    let d = s + 40;
    for (let i = 0; i < b[s + 39]; i++) {
      const nVisuals = b.readUInt16LE(d + 2);
      d += 8;
      for (let v = 0; v < nVisuals; v++, d += 24) {
        setup.visuals.set(b.readUInt32LE(d), {
          red: b.readUInt32LE(d + 8),
          green: b.readUInt32LE(d + 12),
          blue: b.readUInt32LE(d + 16),
        });
      }
    }
    return setup;
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) & 0xffff;
    return this.seq;
  }

  /** `body` must already be padded to a multiple of 4 bytes. */
  private frame(opcode: number, byte1: number, body: Buffer): Buffer {
    const req = Buffer.alloc(4 + body.length);
    req[0] = opcode;
    req[1] = byte1;
    req.writeUInt16LE(req.length / 4, 2);
    body.copy(req, 4);
    return req;
  }

  private send(req: Buffer): void {
    if (this.closedWith) throw this.closedWith;
    this.nextSeq();
    this.sock.write(req);
  }

  private request(req: Buffer): Promise<Buffer> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const seq = this.nextSeq();
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter(p => p.seq !== seq);
        reject(new X11Error("The display did not answer in time."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.push({ seq, resolve, reject, timer });
      this.sock.write(req);
    });
  }

  /** A round trip. After it returns, every earlier request has been processed. */
  async sync(): Promise<void> {
    await this.request(this.frame(43, 0, Buffer.alloc(0))); // GetInputFocus
    const err = this.unclaimedErrors.shift();
    this.unclaimedErrors = [];
    if (err) throw err;
  }

  // ── atoms and properties ────────────────────────────────────────────────

  async atom(name: string, onlyIfExists = false): Promise<number> {
    const cached = this.atomCache.get(name);
    if (cached !== undefined) return cached;
    const nameBytes = Buffer.from(name, "latin1");
    const body = Buffer.alloc(4 + nameBytes.length + PAD(nameBytes.length));
    body.writeUInt16LE(nameBytes.length, 0);
    nameBytes.copy(body, 4);
    const reply = await this.request(this.frame(16, onlyIfExists ? 1 : 0, body));
    const id = reply.readUInt32LE(8);
    this.atomCache.set(name, id);
    return id;
  }

  async getProperty(
    window: number,
    property: string | number,
    type = 0,
  ): Promise<{ type: number; format: number; value: Buffer }> {
    const prop = typeof property === "number" ? property : await this.atom(property, true);
    if (!prop) return { type: 0, format: 0, value: Buffer.alloc(0) };
    const body = Buffer.alloc(20);
    body.writeUInt32LE(window, 0);
    body.writeUInt32LE(prop, 4);
    body.writeUInt32LE(type, 8);
    body.writeUInt32LE(0, 12);
    body.writeUInt32LE(0x10000, 16); // up to 256 KiB
    const reply = await this.request(this.frame(20, 0, body));
    const format = reply[1];
    const len = reply.readUInt32LE(16) * (format / 8);
    return { type: reply.readUInt32LE(8), format, value: Buffer.from(reply.subarray(32, 32 + len)) };
  }

  async getCardinals(window: number, property: string): Promise<number[]> {
    const p = await this.getProperty(window, property);
    if (p.format !== 32) return [];
    const out: number[] = [];
    for (let i = 0; i + 4 <= p.value.length; i += 4) out.push(p.value.readUInt32LE(i));
    return out;
  }

  async getText(window: number, property: string): Promise<string | null> {
    const p = await this.getProperty(window, property);
    if (p.format !== 8 || p.value.length === 0) return null;
    // STRING is Latin-1; UTF8_STRING (and the _NET_ names) are UTF-8.
    return p.value.toString(p.type === ATOM_STRING ? "latin1" : "utf8").replace(/\0+$/, "");
  }

  async setText(window: number, property: string, value: string): Promise<void> {
    await this.setProperty(window, property, "UTF8_STRING", Buffer.from(value, "utf8"));
    await this.sync();
  }

  // ── windows ─────────────────────────────────────────────────────────────

  get root(): number {
    return this.setup.root;
  }

  async hasWindowManager(): Promise<boolean> {
    const p = await this.getProperty(this.root, "_NET_SUPPORTING_WM_CHECK");
    return p.format === 32 && p.value.length >= 4;
  }

  async queryTree(window: number): Promise<number[]> {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(window, 0);
    const reply = await this.request(this.frame(15, 0, body));
    const n = reply.readUInt16LE(16);
    const kids: number[] = [];
    for (let i = 0; i < n; i++) kids.push(reply.readUInt32LE(32 + i * 4));
    return kids;
  }

  async geometry(window: number): Promise<{ x: number; y: number; width: number; height: number }> {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(window, 0);
    const r = await this.request(this.frame(14, 0, body));
    return { x: r.readInt16LE(12), y: r.readInt16LE(14), width: r.readUInt16LE(16), height: r.readUInt16LE(18) };
  }

  /** A point in `window`'s own coordinates, expressed in root (screen) coordinates. */
  async toRoot(window: number, x: number, y: number): Promise<{ x: number; y: number }> {
    const body = Buffer.alloc(12);
    body.writeUInt32LE(window, 0);
    body.writeUInt32LE(this.root, 4);
    body.writeInt16LE(x, 8);
    body.writeInt16LE(y, 10);
    const r = await this.request(this.frame(40, 0, body));
    return { x: r.readInt16LE(12), y: r.readInt16LE(14) };
  }

  private async describeWindow(id: number): Promise<X11Window> {
    const [net, plain, pids, desks, host] = await Promise.all([
      this.getText(id, "_NET_WM_NAME"),
      this.getText(id, "WM_NAME"),
      this.getCardinals(id, "_NET_WM_PID"),
      this.getCardinals(id, "_NET_WM_DESKTOP"),
      this.getText(id, "WM_CLIENT_MACHINE"),
    ]);
    const desk = desks[0];
    return {
      id: `0x${id.toString(16).padStart(8, "0")}`,
      desktop: desk === undefined ? "-1" : desk === 0xffffffff ? "-1" : String(desk),
      pid: pids[0] ?? 0,
      host: host ?? os.hostname(),
      title: net ?? plain ?? "",
    };
  }

  /**
   * Every top-level window. Uses the window manager's own list when there is
   * one; with no window manager (a bare X server) it falls back to the root's
   * children that carry a name.
   */
  async listWindows(): Promise<X11Window[]> {
    const listed = await this.getProperty(this.root, "_NET_CLIENT_LIST", ATOM_WINDOW);
    let ids: number[] = [];
    if (listed.format === 32) {
      for (let i = 0; i + 4 <= listed.value.length; i += 4) ids.push(listed.value.readUInt32LE(i));
    } else {
      for (const kid of await this.queryTree(this.root)) {
        const [a, b] = await Promise.all([this.getProperty(kid, "_NET_WM_NAME"), this.getProperty(kid, "WM_NAME")]);
        if (a.value.length || b.value.length) ids.push(kid);
      }
    }
    return Promise.all(ids.map(id => this.describeWindow(id)));
  }

  private clientMessage(opts: { destination: number; window: number; type: number; data: number[]; mask: number }): void {
    const body = Buffer.alloc(40);
    body.writeUInt32LE(opts.destination, 0);
    body.writeUInt32LE(opts.mask, 4);
    const ev = body.subarray(8);
    ev[0] = 33; // ClientMessage
    ev[1] = 32; // format
    ev.writeUInt32LE(opts.window, 4);
    ev.writeUInt32LE(opts.type, 8);
    for (let i = 0; i < 5; i++) ev.writeUInt32LE((opts.data[i] ?? 0) >>> 0, 12 + i * 4);
    this.send(this.frame(25, 0, body)); // SendEvent
  }

  async activeWindow(): Promise<number | null> {
    const p = await this.getProperty(this.root, "_NET_ACTIVE_WINDOW", ATOM_WINDOW);
    return p.format === 32 && p.value.length >= 4 ? p.value.readUInt32LE(0) || null : null;
  }

  async inputFocus(): Promise<number> {
    const r = await this.request(this.frame(43, 0, Buffer.alloc(0)));
    return r.readUInt32LE(8);
  }

  /**
   * Give `window` the keyboard focus and confirm that it actually got it.
   *
   * Synthetic input goes wherever focus is, so "asked for focus" is not enough:
   * this returns only once the display says the window has it, and throws if it
   * never does. That is what stops the agent typing into the wrong window.
   */
  async focus(window: number): Promise<void> {
    if (await this.hasWindowManager()) {
      this.clientMessage({
        destination: this.root,
        window,
        type: await this.atom("_NET_ACTIVE_WINDOW"),
        data: [1, 0, 0],
        mask: SUBSTRUCTURE_MASK,
      });
      await this.sync();
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if ((await this.activeWindow()) === window) return;
        await new Promise(r => setTimeout(r, 25));
      }
      throw new X11Error(`The window manager did not give window 0x${window.toString(16)} the focus.`);
    }
    // No window manager: set focus directly and raise.
    const focus = Buffer.alloc(8);
    focus.writeUInt32LE(window, 0);
    focus.writeUInt32LE(0, 4); // CurrentTime
    this.send(this.frame(42, 1, focus)); // SetInputFocus, revert to PointerRoot
    const raise = Buffer.alloc(12);
    raise.writeUInt32LE(window, 0);
    raise.writeUInt16LE(0x40, 4); // stack-mode
    raise.writeUInt32LE(0, 8); // Above
    this.send(this.frame(12, 0, raise));
    await this.sync();
    if ((await this.inputFocus()) !== window) {
      throw new X11Error(`Window 0x${window.toString(16)} did not take the focus.`);
    }
  }

  async moveResize(window: number, x: number, y: number, width: number, height: number): Promise<void> {
    if (await this.hasWindowManager()) {
      // x, y, width, height all present (bits 8-11), source indication "pager" (bit 13).
      this.clientMessage({
        destination: this.root,
        window,
        type: await this.atom("_NET_MOVERESIZE_WINDOW"),
        data: [(1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 13), x, y, width, height],
        mask: SUBSTRUCTURE_MASK,
      });
    } else {
      const body = Buffer.alloc(8 + 16);
      body.writeUInt32LE(window, 0);
      body.writeUInt16LE(0x1 | 0x2 | 0x4 | 0x8, 4);
      body.writeInt32LE(x, 8);
      body.writeInt32LE(y, 12);
      body.writeUInt32LE(width, 16);
      body.writeUInt32LE(height, 20);
      this.send(this.frame(12, 0, body));
    }
    await this.sync();
  }

  async closeWindow(window: number): Promise<void> {
    if (await this.hasWindowManager()) {
      this.clientMessage({
        destination: this.root,
        window,
        type: await this.atom("_NET_CLOSE_WINDOW"),
        data: [0, 2],
        mask: SUBSTRUCTURE_MASK,
      });
    } else {
      // Ask politely, the way a window manager would: WM_DELETE_WINDOW.
      this.clientMessage({
        destination: window,
        window,
        type: await this.atom("WM_PROTOCOLS"),
        data: [await this.atom("WM_DELETE_WINDOW"), 0],
        mask: 0,
      });
    }
    await this.sync();
  }

  /**
   * Create and map a plain top-level window owned by this connection.
   *
   * The window lives only as long as the connection does, which is the right
   * lifetime for a window the agent opens for itself: it cannot be orphaned.
   * Pass `events` to receive key presses and button presses on it.
   */
  async createWindow(opts: { title: string; x?: number; y?: number; width: number; height: number; events?: boolean }): Promise<number> {
    const id = (this.setup.ridBase | (this.nextResource++ & this.setup.ridMask)) >>> 0;
    const body = Buffer.alloc(28 + 8);
    body.writeUInt32LE(id, 0);
    body.writeUInt32LE(this.root, 4);
    body.writeInt16LE(opts.x ?? 0, 8);
    body.writeInt16LE(opts.y ?? 0, 10);
    body.writeUInt16LE(opts.width, 12);
    body.writeUInt16LE(opts.height, 14);
    body.writeUInt16LE(0, 16); // border
    body.writeUInt16LE(1, 18); // InputOutput
    body.writeUInt32LE(0, 20); // visual: CopyFromParent
    body.writeUInt32LE(0x2 | 0x800, 24); // CWBackPixel | CWEventMask
    body.writeUInt32LE(0xffffff, 28); // white
    body.writeUInt32LE(opts.events ? 0x1 | 0x2 | 0x4 | 0x8 | 0x20000 : 0, 32); // key/button press+release, structure
    this.send(this.frame(1, 0, body)); // CreateWindow, depth 0 = copy from parent
    await this.setProperty(id, "_NET_WM_NAME", "UTF8_STRING", Buffer.from(opts.title, "utf8"));
    await this.setProperty(id, "WM_NAME", "STRING", Buffer.from(opts.title, "latin1"));
    const map = Buffer.alloc(4);
    map.writeUInt32LE(id, 0);
    this.send(this.frame(8, 0, map)); // MapWindow
    await this.sync();
    return id;
  }

  private async setProperty(window: number, property: string, type: string, data: Buffer): Promise<void> {
    const body = Buffer.alloc(20 + data.length + PAD(data.length));
    body.writeUInt32LE(window, 0);
    body.writeUInt32LE(await this.atom(property), 4);
    body.writeUInt32LE(await this.atom(type), 8);
    body[12] = 8;
    body.writeUInt32LE(data.length, 16);
    data.copy(body, 20);
    this.send(this.frame(18, 0, body)); // ChangeProperty, mode Replace
  }

  // ── pixels ──────────────────────────────────────────────────────────────

  /** The whole screen, or a rectangle of it, as PNG bytes. */
  async screenshot(region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    const { root } = this.setup;
    // Clamp to the screen: GetImage rejects a rectangle that is not wholly on it.
    const x0 = Math.max(0, Math.floor(region?.x ?? 0));
    const y0 = Math.max(0, Math.floor(region?.y ?? 0));
    const width = Math.min(this.setup.width, x0 + (region?.width ?? this.setup.width)) - x0;
    const height = Math.min(this.setup.height, y0 + (region?.height ?? this.setup.height)) - y0;
    if (width <= 0 || height <= 0) throw new X11Error("That area is outside the screen.");
    const body = Buffer.alloc(16);
    body.writeUInt32LE(root, 0);
    body.writeInt16LE(x0, 4);
    body.writeInt16LE(y0, 6);
    body.writeUInt16LE(width, 8);
    body.writeUInt16LE(height, 10);
    body.writeUInt32LE(0xffffffff, 12);
    const reply = await this.request(this.frame(73, 2, body)); // ZPixmap
    const depth = reply[1];
    const visual = this.setup.visuals.get(reply.readUInt32LE(8)) ?? this.setup.visuals.get(this.setup.rootVisual);
    const fmt = this.setup.formats.find(f => f.depth === depth);
    if (!visual || !fmt) throw new X11Error(`The screen uses a pixel format this client cannot read (depth ${depth}).`);
    const rgb = convertPixels(reply.subarray(32), width, height, fmt.bitsPerPixel, fmt.scanlinePad, this.setup.imageByteOrder, visual);
    return encodePng(width, height, rgb);
  }

  // ── input ───────────────────────────────────────────────────────────────

  private async xtestOpcode(): Promise<number> {
    if (this.xtest === undefined) {
      const name = Buffer.from("XTEST", "latin1");
      const body = Buffer.alloc(4 + name.length + PAD(name.length));
      body.writeUInt16LE(name.length, 0);
      name.copy(body, 4);
      const r = await this.request(this.frame(98, 0, body));
      this.xtest = r[8] ? r[9] : null;
    }
    if (this.xtest === null) {
      throw new X11Error("This display does not offer the XTEST extension, so input cannot be synthesised.");
    }
    return this.xtest;
  }

  /** Whether the display offers XTEST, i.e. whether input can be synthesised at all. */
  async hasXtest(): Promise<boolean> {
    try {
      await this.xtestOpcode();
      return true;
    } catch (e) {
      if (e instanceof X11Error && /XTEST/.test(e.message)) return false;
      throw e;
    }
  }

  private async fakeInput(type: number, detail: number, x = 0, y = 0): Promise<void> {
    const major = await this.xtestOpcode();
    const body = Buffer.alloc(32);
    body[0] = type;
    body[1] = detail;
    body.writeUInt32LE(0, 4); // time: now
    body.writeUInt32LE(type === 6 ? this.root : 0, 8);
    body.writeInt16LE(x, 20);
    body.writeInt16LE(y, 22);
    this.send(this.frame(major, 2, body)); // minor opcode 2 = FakeInput
  }

  /** Move the pointer to absolute screen coordinates. */
  async movePointer(screenX: number, screenY: number): Promise<void> {
    await this.fakeInput(6, 0, Math.round(screenX), Math.round(screenY));
    await this.sync();
  }

  /** Move the pointer to absolute screen coordinates and press/release a button. */
  async clickAt(screenX: number, screenY: number, button = 1): Promise<void> {
    if (!Number.isInteger(button) || button < 1 || button > 9) throw new X11Error(`"${button}" is not a mouse button.`);
    await this.fakeInput(6, 0, Math.round(screenX), Math.round(screenY)); // MotionNotify, absolute
    await this.fakeInput(4, button);
    await this.fakeInput(5, button);
    await this.sync();
  }

  async keyboardMapping(): Promise<{ perKeycode: number; syms: number[][] }> {
    const { minKeycode, maxKeycode } = this.setup;
    const count = maxKeycode - minKeycode + 1;
    const body = Buffer.alloc(4);
    body[0] = minKeycode;
    body[1] = count;
    const r = await this.request(this.frame(101, 0, body));
    const per = r[1];
    const syms: number[][] = [];
    for (let k = 0; k < count; k++) {
      const row: number[] = [];
      for (let c = 0; c < per; c++) row.push(r.readUInt32LE(32 + (k * per + c) * 4));
      syms.push(row);
    }
    return { perKeycode: per, syms };
  }

  private async setKeyMapping(keycode: number, perKeycode: number, keysym: number): Promise<void> {
    const body = Buffer.alloc(4 + perKeycode * 4);
    body[0] = keycode;
    body[1] = perKeycode;
    for (let i = 0; i < perKeycode; i++) body.writeUInt32LE(keysym >>> 0, 4 + i * 4);
    this.send(this.frame(100, 1, body));
    await this.sync();
  }

  /**
   * Type text into whatever has the focus.
   *
   * Each character is turned into a keysym, found on the keyboard (unshifted
   * or with Shift), and sent as key down/up. A character the layout has no key
   * for -- most non-Latin text, emoji -- is typed by temporarily binding an
   * unused keycode to it, then putting that keycode back.
   */
  async typeText(text: string, delayMs = 12): Promise<void> {
    const { perKeycode, syms } = await this.keyboardMapping();
    const first = this.setup.minKeycode;
    const find = (sym: number, column: number) => {
      const i = syms.findIndex(row => row[column] === sym);
      return i < 0 ? 0 : first + i;
    };
    const shift = find(0xffe1, 0) || find(0xffe2, 0);
    const spare = (() => {
      const i = syms.findIndex(row => row.every(s => s === 0));
      return i < 0 ? 0 : first + i;
    })();

    for (const ch of text) {
      const sym = keysymFor(ch);
      if (sym === null) continue;
      let keycode = find(sym, 0);
      let shifted = false;
      if (!keycode && perKeycode > 1) {
        keycode = find(sym, 1);
        shifted = keycode !== 0 && shift !== 0;
        if (!shifted) keycode = 0;
      }
      let remapped = false;
      if (!keycode) {
        if (!spare) throw new X11Error(`There is no key for "${ch}" and no spare keycode to bind it to.`);
        await this.setKeyMapping(spare, perKeycode, sym);
        await new Promise(r => setTimeout(r, 30)); // let clients see the MappingNotify
        keycode = spare;
        remapped = true;
      }
      if (shifted) await this.fakeInput(2, shift);
      await this.fakeInput(2, keycode);
      await this.fakeInput(3, keycode);
      if (shifted) await this.fakeInput(3, shift);
      await this.sync();
      if (remapped) {
        await new Promise(r => setTimeout(r, 30));
        await this.setKeyMapping(spare, perKeycode, 0);
      }
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

/** The X keysym for one character, or null for a control character with no key. */
export function keysymFor(ch: string): number | null {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x0a || cp === 0x0d) return 0xff0d; // Return
  if (cp === 0x09) return 0xff09; // Tab
  if (cp === 0x08) return 0xff08; // BackSpace
  if (cp === 0x1b) return 0xff1b; // Escape
  if (cp < 0x20 || cp === 0x7f) return null;
  if (cp <= 0xff) return cp; // Latin-1 keysyms equal their code point
  return 0x01000000 + cp; // Unicode keysym
}

function channel(mask: number): { shift: number; bits: number } {
  if (mask === 0) return { shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { shift, bits };
}

/** Turn a ZPixmap reply into tightly-packed RGB, whatever the server's pixel layout. */
export function convertPixels(
  data: Buffer,
  width: number,
  height: number,
  bitsPerPixel: number,
  scanlinePad: number,
  byteOrder: number,
  masks: { red: number; green: number; blue: number },
): Buffer {
  const bytesPP = bitsPerPixel / 8;
  if (![2, 3, 4].includes(bytesPP)) throw new X11Error(`${bitsPerPixel} bits per pixel is not supported.`);
  const stride = Math.ceil((width * bitsPerPixel) / scanlinePad) * (scanlinePad / 8);
  if (data.length < stride * height) throw new X11Error("The display returned fewer pixels than the screen holds.");
  const out = Buffer.alloc(width * height * 3);

  // The common case, spelled out: little-endian 32-bit 0x00RRGGBB.
  if (bytesPP === 4 && byteOrder === 0 && masks.red === 0xff0000 && masks.green === 0xff00 && masks.blue === 0xff) {
    let o = 0;
    for (let y = 0; y < height; y++) {
      let i = y * stride;
      for (let x = 0; x < width; x++, i += 4) {
        out[o++] = data[i + 2];
        out[o++] = data[i + 1];
        out[o++] = data[i];
      }
    }
    return out;
  }

  const r = channel(masks.red), g = channel(masks.green), b = channel(masks.blue);
  const scale = (v: number, c: { bits: number }) =>
    c.bits === 0 ? 0 : c.bits === 8 ? v : Math.round((v * 255) / ((1 << c.bits) - 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    let i = y * stride;
    for (let x = 0; x < width; x++, i += bytesPP) {
      let px = 0;
      if (byteOrder === 0) for (let k = bytesPP - 1; k >= 0; k--) px = px * 256 + data[i + k];
      else for (let k = 0; k < bytesPP; k++) px = px * 256 + data[i + k];
      out[o++] = scale((px >>> r.shift) & ((1 << r.bits) - 1), r);
      out[o++] = scale((px >>> g.shift) & ((1 << g.bits) - 1), g);
      out[o++] = scale((px >>> b.shift) & ((1 << b.bits) - 1), b);
    }
  }
  return out;
}
