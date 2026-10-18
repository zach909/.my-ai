/**
 * A small D-Bus client over Node's own `node:net`, replacing gdbus.
 *
 * D-Bus is how a Linux desktop session talks to its services, and on Wayland
 * it is the only sanctioned way for a program to ask for a screenshot: the
 * compositor will not hand out the screen, but the desktop portal
 * (org.freedesktop.portal.*) will, after asking the user. gdbus is a command
 * line wrapper around exactly this wire protocol, so this speaks the protocol.
 *
 * Covered: the SASL EXTERNAL handshake, the binary message format (little
 * endian), the common types (y b n q i u x t d s o g v a () {}), method calls
 * with replies and errors, signals with match rules, and enough of the server
 * side (owning a name, answering calls) to be tested against a real bus
 * daemon without any other program.
 *
 * Not covered, deliberately: file-descriptor passing and big-endian peers.
 */
import net from "node:net";
import fs from "node:fs";
export class DBusError extends Error {
    constructor(message, name_) {
        super(message);
        this.name_ = name_;
    }
}
/** A value with an explicit signature, for the `v` type. */
export class Variant {
    constructor(sig, value) {
        this.sig = sig;
        this.value = value;
    }
}
function parseOne(sig, at) {
    const c = sig[at.i++];
    if (c === "a")
        return { t: "a", el: parseOne(sig, at) };
    if (c === "(") {
        const fields = [];
        while (sig[at.i] !== ")") {
            if (at.i >= sig.length)
                throw new DBusError(`Unterminated struct in signature "${sig}".`);
            fields.push(parseOne(sig, at));
        }
        at.i++;
        return { t: "(", fields };
    }
    if (c === "{") {
        const key = parseOne(sig, at);
        const val = parseOne(sig, at);
        if (sig[at.i++] !== "}")
            throw new DBusError(`Unterminated dict entry in signature "${sig}".`);
        return { t: "{", key, val };
    }
    if (c && "ybnqiuxtdsogv".includes(c))
        return { t: c };
    throw new DBusError(`Unsupported signature "${sig}" at ${at.i - 1}.`);
}
function parseSig(sig) {
    const at = { i: 0 };
    const out = [];
    while (at.i < sig.length)
        out.push(parseOne(sig, at));
    return out;
}
function alignOf(t) {
    switch (t.t) {
        case "y":
        case "g":
        case "v": return 1;
        case "n":
        case "q": return 2;
        case "b":
        case "i":
        case "u":
        case "s":
        case "o":
        case "a": return 4;
        default: return 8; // x t d ( {
    }
}
function sigOf(t) {
    switch (t.t) {
        case "a": return "a" + sigOf(t.el);
        case "(": return "(" + t.fields.map(sigOf).join("") + ")";
        case "{": return "{" + sigOf(t.key) + sigOf(t.val) + "}";
        default: return t.t;
    }
}
// ── marshalling ───────────────────────────────────────────────────────────
class Writer {
    constructor() {
        this.buf = Buffer.alloc(256);
        this.len = 0;
    }
    need(n) {
        if (this.len + n <= this.buf.length)
            return;
        const next = Buffer.alloc(Math.max(this.buf.length * 2, this.len + n));
        this.buf.copy(next, 0, 0, this.len);
        this.buf = next;
    }
    align(n) {
        const pad = (n - (this.len % n)) % n;
        this.need(pad);
        this.buf.fill(0, this.len, this.len + pad);
        this.len += pad;
    }
    u8(v) { this.need(1); this.buf[this.len++] = v; }
    u16(v) { this.align(2); this.need(2); this.buf.writeUInt16LE(v, this.len); this.len += 2; }
    i16(v) { this.align(2); this.need(2); this.buf.writeInt16LE(v, this.len); this.len += 2; }
    u32(v) { this.align(4); this.need(4); this.buf.writeUInt32LE(v >>> 0, this.len); this.len += 4; }
    i32(v) { this.align(4); this.need(4); this.buf.writeInt32LE(v, this.len); this.len += 4; }
    u64(v) { this.align(8); this.need(8); this.buf.writeBigUInt64LE(BigInt(v), this.len); this.len += 8; }
    i64(v) { this.align(8); this.need(8); this.buf.writeBigInt64LE(BigInt(v), this.len); this.len += 8; }
    f64(v) { this.align(8); this.need(8); this.buf.writeDoubleLE(v, this.len); this.len += 8; }
    bytes(b) { this.need(b.length); b.copy(this.buf, this.len); this.len += b.length; }
    patchU32(at, v) { this.buf.writeUInt32LE(v >>> 0, at); }
    done() { return Buffer.from(this.buf.subarray(0, this.len)); }
}
function write(w, t, v) {
    switch (t.t) {
        case "y":
            w.u8(Number(v));
            return;
        case "b":
            w.u32(v ? 1 : 0);
            return;
        case "n":
            w.i16(Number(v));
            return;
        case "q":
            w.u16(Number(v));
            return;
        case "i":
            w.i32(Number(v));
            return;
        case "u":
            w.u32(Number(v));
            return;
        case "x":
            w.i64(v);
            return;
        case "t":
            w.u64(v);
            return;
        case "d":
            w.f64(Number(v));
            return;
        case "s":
        case "o": {
            const b = Buffer.from(String(v), "utf8");
            w.u32(b.length);
            w.bytes(b);
            w.u8(0);
            return;
        }
        case "g": {
            const b = Buffer.from(String(v), "utf8");
            w.u8(b.length);
            w.bytes(b);
            w.u8(0);
            return;
        }
        case "v": {
            const variant = v instanceof Variant ? v : inferVariant(v);
            write(w, { t: "g" }, variant.sig);
            write(w, parseOne(variant.sig, { i: 0 }), variant.value);
            return;
        }
        case "a": {
            w.align(4);
            const lenAt = w.len;
            w.u32(0);
            w.align(alignOf(t.el));
            const start = w.len;
            if (t.el.t === "{") {
                const entries = v instanceof Map ? [...v.entries()] : Array.isArray(v) ? v : Object.entries(v);
                for (const [k, val] of entries) {
                    w.align(8);
                    write(w, t.el.key, k);
                    write(w, t.el.val, val);
                }
            }
            else {
                for (const item of v)
                    write(w, t.el, item);
            }
            w.patchU32(lenAt, w.len - start);
            return;
        }
        case "(": {
            w.align(8);
            const items = v;
            t.fields.forEach((f, i) => write(w, f, items[i]));
            return;
        }
        case "{": throw new DBusError("A dict entry can only appear inside an array.");
    }
}
function inferVariant(v) {
    if (typeof v === "string")
        return new Variant("s", v);
    if (typeof v === "boolean")
        return new Variant("b", v);
    if (typeof v === "number")
        return Number.isInteger(v) ? new Variant("i", v) : new Variant("d", v);
    throw new DBusError("A variant needs an explicit signature for this value; wrap it in new Variant(sig, value).");
}
class Reader {
    constructor(buf) {
        this.buf = buf;
        this.off = 0;
    }
    align(n) { this.off += (n - (this.off % n)) % n; }
    take(n) {
        if (this.off + n > this.buf.length)
            throw new DBusError("Truncated D-Bus message.");
        const at = this.off;
        this.off += n;
        return at;
    }
    u8() { return this.buf[this.take(1)]; }
    u16() { this.align(2); return this.buf.readUInt16LE(this.take(2)); }
    i16() { this.align(2); return this.buf.readInt16LE(this.take(2)); }
    u32() { this.align(4); return this.buf.readUInt32LE(this.take(4)); }
    i32() { this.align(4); return this.buf.readInt32LE(this.take(4)); }
    u64() { this.align(8); return this.buf.readBigUInt64LE(this.take(8)); }
    i64() { this.align(8); return this.buf.readBigInt64LE(this.take(8)); }
    f64() { this.align(8); return this.buf.readDoubleLE(this.take(8)); }
    str(n) { const at = this.take(n); return this.buf.toString("utf8", at, at + n); }
}
function read(r, t) {
    switch (t.t) {
        case "y": return r.u8();
        case "b": return r.u32() !== 0;
        case "n": return r.i16();
        case "q": return r.u16();
        case "i": return r.i32();
        case "u": return r.u32();
        case "x": return r.i64();
        case "t": return r.u64();
        case "d": return r.f64();
        case "s":
        case "o": {
            const n = r.u32();
            const s = r.str(n);
            r.u8();
            return s;
        }
        case "g": {
            const n = r.u8();
            const s = r.str(n);
            r.u8();
            return s;
        }
        case "v": {
            const sig = read(r, { t: "g" });
            return new Variant(sig, read(r, parseOne(sig, { i: 0 })));
        }
        case "a": {
            const n = r.u32();
            r.align(alignOf(t.el));
            const end = r.off + n;
            if (t.el.t === "{") {
                const m = new Map();
                while (r.off < end) {
                    r.align(8);
                    const k = read(r, t.el.key);
                    m.set(k, read(r, t.el.val));
                }
                return m;
            }
            const out = [];
            while (r.off < end)
                out.push(read(r, t.el));
            return out;
        }
        case "(": {
            r.align(8);
            return t.fields.map(f => read(r, f));
        }
        case "{": throw new DBusError("A dict entry can only appear inside an array.");
    }
}
// ── messages ──────────────────────────────────────────────────────────────
const METHOD_CALL = 1, METHOD_RETURN = 2, ERROR = 3, SIGNAL = 4;
const H_PATH = 1, H_INTERFACE = 2, H_MEMBER = 3, H_ERROR_NAME = 4, H_REPLY_SERIAL = 5, H_DESTINATION = 6, H_SENDER = 7, H_SIGNATURE = 8;
function encode(msg) {
    const body = new Writer();
    parseSig(msg.signature).forEach((t, i) => write(body, t, msg.body[i]));
    const bodyBytes = body.done();
    const fields = [];
    if (msg.path !== undefined)
        fields.push([H_PATH, new Variant("o", msg.path)]);
    if (msg.interface !== undefined)
        fields.push([H_INTERFACE, new Variant("s", msg.interface)]);
    if (msg.member !== undefined)
        fields.push([H_MEMBER, new Variant("s", msg.member)]);
    if (msg.errorName !== undefined)
        fields.push([H_ERROR_NAME, new Variant("s", msg.errorName)]);
    if (msg.replySerial !== undefined)
        fields.push([H_REPLY_SERIAL, new Variant("u", msg.replySerial)]);
    if (msg.destination !== undefined)
        fields.push([H_DESTINATION, new Variant("s", msg.destination)]);
    if (msg.signature)
        fields.push([H_SIGNATURE, new Variant("g", msg.signature)]);
    const w = new Writer();
    w.u8(0x6c); // little-endian
    w.u8(msg.type);
    w.u8(0); // flags
    w.u8(1); // protocol version
    w.u32(bodyBytes.length);
    w.u32(msg.serial);
    write(w, { t: "a", el: { t: "(", fields: [{ t: "y" }, { t: "v" }] } }, fields);
    w.align(8);
    w.bytes(bodyBytes);
    return w.done();
}
/** Returns the message and how many bytes it used, or null when more bytes are needed. */
function decode(buf) {
    if (buf.length < 16)
        return null;
    if (buf[0] !== 0x6c)
        throw new DBusError("The bus sent a big-endian message, which this client does not read.");
    const bodyLen = buf.readUInt32LE(4);
    const fieldsLen = buf.readUInt32LE(12);
    const headerLen = 16 + fieldsLen + ((8 - ((16 + fieldsLen) % 8)) % 8);
    const total = headerLen + bodyLen;
    if (buf.length < total)
        return null;
    const r = new Reader(buf.subarray(0, headerLen));
    r.off = 12;
    const fields = read(r, { t: "a", el: { t: "(", fields: [{ t: "y" }, { t: "v" }] } });
    const msg = { type: buf[1], serial: buf.readUInt32LE(8), signature: "", body: [] };
    for (const [code, v] of fields) {
        switch (code) {
            case H_PATH:
                msg.path = v.value;
                break;
            case H_INTERFACE:
                msg.interface = v.value;
                break;
            case H_MEMBER:
                msg.member = v.value;
                break;
            case H_ERROR_NAME:
                msg.errorName = v.value;
                break;
            case H_REPLY_SERIAL:
                msg.replySerial = v.value;
                break;
            case H_DESTINATION:
                msg.destination = v.value;
                break;
            case H_SENDER:
                msg.sender = v.value;
                break;
            case H_SIGNATURE:
                msg.signature = v.value;
                break;
        }
    }
    const br = new Reader(buf.subarray(headerLen, total));
    msg.body = parseSig(msg.signature).map(t => read(br, t));
    return { msg, used: total };
}
// ── connection ────────────────────────────────────────────────────────────
function busAddress() {
    const raw = process.env.DBUS_SESSION_BUS_ADDRESS;
    if (raw) {
        for (const entry of raw.split(";")) {
            const m = /^unix:(.*)$/.exec(entry);
            if (!m)
                continue;
            const kv = Object.fromEntries(m[1].split(",").map(p => p.split("=")));
            if (kv.path)
                return { path: kv.path };
            if (kv.abstract)
                return { path: "\0" + kv.abstract };
        }
    }
    const uid = process.getuid?.();
    const fallback = `/run/user/${uid}/bus`;
    if (uid !== undefined && fs.existsSync(fallback))
        return { path: fallback };
    throw new DBusError("There is no D-Bus session bus (DBUS_SESSION_BUS_ADDRESS is not set).");
}
export class DBusConnection {
    constructor(sock) {
        this.sock = sock;
        this.buf = Buffer.alloc(0);
        this.serial = 0;
        this.authed = false;
        this.waiting = new Map();
        this.signalHandlers = new Set();
        this.callHandler = null;
        this.closedWith = null;
        this.uniqueName = "";
        sock.on("data", (chunk) => {
            this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
            try {
                this.drain();
            }
            catch (e) {
                this.fail(e);
            }
        });
        sock.on("error", err => this.fail(new DBusError(`Lost the D-Bus connection: ${err.message}`)));
        sock.on("close", () => this.fail(new DBusError("The D-Bus connection closed.")));
    }
    static async connect(opts = busAddress()) {
        const sock = await new Promise((resolve, reject) => {
            const s = net.connect(opts);
            s.once("connect", () => resolve(s));
            s.once("error", e => reject(new DBusError(`Could not reach the D-Bus session bus: ${e.message}`)));
        });
        const c = new DBusConnection(sock);
        const authed = new Promise((resolve, reject) => {
            c.authDone = resolve;
            c.authFail = reject;
        });
        const uid = String(process.getuid?.() ?? 0);
        sock.write(Buffer.concat([Buffer.from([0]), Buffer.from(`AUTH EXTERNAL ${Buffer.from(uid).toString("hex")}\r\n`)]));
        const timer = setTimeout(() => c.authFail(new DBusError("The bus did not answer the handshake.")), 5000);
        try {
            await authed;
        }
        catch (e) {
            sock.destroy();
            throw e;
        }
        finally {
            clearTimeout(timer);
        }
        const [name] = await c.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "Hello");
        c.uniqueName = name;
        return c;
    }
    close() {
        this.sock.destroy();
    }
    fail(err) {
        if (this.closedWith)
            return;
        this.closedWith = err;
        if (!this.authed)
            this.authFail(err);
        for (const w of this.waiting.values()) {
            clearTimeout(w.timer);
            w.reject(err);
        }
        this.waiting.clear();
    }
    drain() {
        if (!this.authed) {
            const end = this.buf.indexOf("\r\n");
            if (end < 0)
                return;
            const line = this.buf.toString("latin1", 0, end);
            this.buf = this.buf.subarray(end + 2);
            if (line.startsWith("OK")) {
                this.authed = true;
                this.sock.write("BEGIN\r\n");
                this.authDone();
            }
            else {
                this.authFail(new DBusError(`The bus refused authentication: ${line}`));
                return;
            }
        }
        for (;;) {
            const got = decode(this.buf);
            if (!got)
                return;
            this.buf = this.buf.subarray(got.used);
            this.dispatch(got.msg);
        }
    }
    dispatch(msg) {
        if (msg.type === METHOD_RETURN || msg.type === ERROR) {
            const w = msg.replySerial !== undefined ? this.waiting.get(msg.replySerial) : undefined;
            if (!w)
                return;
            this.waiting.delete(msg.replySerial);
            clearTimeout(w.timer);
            if (msg.type === ERROR)
                w.reject(new DBusError(`${msg.errorName}: ${msg.body[0] ?? ""}`, msg.errorName));
            else
                w.resolve(msg);
        }
        else if (msg.type === SIGNAL) {
            for (const h of this.signalHandlers)
                h(msg);
        }
        else if (msg.type === METHOD_CALL) {
            this.callHandler?.(msg);
        }
    }
    send(msg) {
        if (this.closedWith)
            throw this.closedWith;
        const serial = ++this.serial;
        this.sock.write(encode({ ...msg, serial, body: msg.body ?? [] }));
        return serial;
    }
    /** Call a method and resolve with the reply's body. */
    call(destination, path, iface, member, signature = "", body = [], timeoutMs = 25000) {
        return new Promise((resolve, reject) => {
            let serial;
            try {
                serial = this.send({ type: METHOD_CALL, destination, path, interface: iface, member, signature, body });
            }
            catch (e) {
                reject(e);
                return;
            }
            const timer = setTimeout(() => {
                this.waiting.delete(serial);
                reject(new DBusError(`${iface}.${member} did not answer within ${timeoutMs / 1000}s.`));
            }, timeoutMs);
            this.waiting.set(serial, { resolve: m => resolve(m.body), reject, timer });
        });
    }
    onSignal(handler) {
        this.signalHandlers.add(handler);
        return () => this.signalHandlers.delete(handler);
    }
    addMatch(rule) {
        return this.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "AddMatch", "s", [rule]);
    }
    // The server half: just enough to own a name and answer calls.
    async requestName(name) {
        const [code] = await this.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName", "su", [name, 0]);
        if (code !== 1)
            throw new DBusError(`Could not own the bus name ${name} (code ${code}).`);
    }
    onMethodCall(handler) {
        this.callHandler = handler;
    }
    reply(call, signature = "", body = []) {
        this.send({ type: METHOD_RETURN, destination: call.sender, replySerial: call.serial, signature, body });
    }
    replyError(call, errorName, text) {
        this.send({ type: ERROR, destination: call.sender, replySerial: call.serial, errorName, signature: "s", body: [text] });
    }
    emitSignal(path, iface, member, signature = "", body = [], destination) {
        this.send({ type: SIGNAL, path, interface: iface, member, destination, signature, body });
    }
}
/**
 * Make a portal call that answers later through a Response signal.
 *
 * The signal's path is derived from our bus name and a token we choose, so the
 * match rule is installed BEFORE the call -- otherwise a fast portal could
 * answer before anyone was listening.
 */
export async function portalRequest(bus, iface, member, signature, makeArgs, timeoutMs = 60000) {
    const token = `neuroclaw${Math.random().toString(36).slice(2, 10)}`;
    const sender = bus.uniqueName.replace(/^:/, "").replace(/\./g, "_");
    const expected = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
    const paths = new Set([expected]);
    let settle;
    const answered = new Promise(resolve => (settle = resolve));
    const off = bus.onSignal(m => {
        if (m.interface === "org.freedesktop.portal.Request" && m.member === "Response" && m.path && paths.has(m.path)) {
            settle({ response: m.body[0], results: m.body[1] });
        }
    });
    try {
        await bus.addMatch(`type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${expected}'`);
        const [handle] = await bus.call("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", iface, member, signature, makeArgs(token));
        if (typeof handle === "string" && handle !== expected) {
            // An older portal that did not honour handle_token: listen on what it returned.
            paths.add(handle);
            await bus.addMatch(`type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${handle}'`);
        }
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new DBusError(`The portal did not answer ${member} within ${timeoutMs / 1000}s.`)), timeoutMs);
        });
        try {
            return await Promise.race([answered, timeout]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    finally {
        off();
    }
}
/** Render a decoded value the way `gsettings get` prints it, closely enough to read. */
export function variantText(v) {
    if (v instanceof Variant)
        return variantText(v.value);
    if (typeof v === "string")
        return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    if (typeof v === "boolean")
        return v ? "true" : "false";
    if (typeof v === "bigint" || typeof v === "number")
        return String(v);
    if (v instanceof Map)
        return `{${[...v.entries()].map(([k, x]) => `${variantText(k)}: ${variantText(x)}`).join(", ")}}`;
    if (Array.isArray(v))
        return `[${v.map(variantText).join(", ")}]`;
    return String(v);
}
