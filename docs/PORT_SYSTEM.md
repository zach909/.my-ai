# Port System

Design specification for the communication layer that lets the AI accept and
emit many simultaneous, independent streams of information — from users,
external software, hardware, plugins, extensions, and its own internal
subsystems — without collapsing them onto a single serial input/output path.

This document assumes familiarity with the existing systems the Port System
sits between rather than replaces:

| Existing system | File | Role relative to the Port System |
|---|---|---|
| Neural core | `asi_core/neural_core.py` | The destination/source of translated signal. Ports never touch neurons directly — they hand `NeuralCore.inject_input()` a layer id and a pattern, and read layer activations back out. |
| Neural mesh | `src/features/mesh/mesh-engine.ts` | Alternate/higher-dimensional core a port can target instead of `NeuralCore`, selected per-port via `coreTarget`. |
| Plugin runtime | `plugin_manager/{types,sdk,registry,loader}.ts` | Owns *what a plugin can do*; a plugin port is a transport wrapper around one `PluginDefinition`'s existing dispatch entrypoint. |
| Extension system | `extension_system/{manager,types}.ts` | Owns lifecycle/versioning/permissions for durable artifacts. Port *definitions* and *grants* are themselves persisted as `kind: "plugin"`-adjacent extension records so they survive restarts and get the same audit trail. |
| Extension permissions | `plugin_manager/types.ts` (`ExtensionPermission`) | Reused as-is for port grants — see Section 13. |
| Interface layer | `interface/{web-server,cli,main}.ts` | Today's ad hoc single HTTP port and CLI stdin/stdout. The Port System generalizes these into two of many concurrently open ports rather than the only two channels. |
| Long-term memory | `models && skills/core/long-term-memory.ts` | One of the internal consumers ports route decoded input to and read consolidated output from. |
| Alignment veto | `models && skills/core/alignment-veto.ts` | Sits between a port's decoded output and any external-effect action that output would trigger — see Section 15. |

---

## 1. Purpose

A conventional assistant has exactly one input channel (the current prompt)
and one output channel (the current response). That model breaks down the
moment the AI needs to: watch a webcam feed while answering a chat message;
stream partial output to a UI while a background plugin call is still
running; hold open a websocket to one user while a cron-triggered extension
job talks to another; or receive a hardware sensor event mid-thought without
discarding the conversation it interrupted.

The Port System exists to remove the single-channel limitation. It gives the
AI:

- **Many inputs at once** — user messages, plugin callbacks, hardware
  events, extension jobs, and scheduled triggers all arrive concurrently
  instead of queueing behind one channel.
- **Many outputs at once** — responses, telemetry, plugin invocations, and
  hardware actuation can all be in flight simultaneously.
- **Context isolation without context loss** — each stream keeps its own
  identity and history, but all streams remain visible to the neural core
  and memory systems that need cross-stream awareness (e.g. noticing the
  same user talking through two different ports).
- **A single, uniform boundary** — every external thing the AI talks to
  (human, API, device, plugin, extension) looks the same from the neural
  core's side: a port that emits and accepts frames in the internal signal
  format. Nothing outside the Port System needs to know whether it's talking
  to a websocket, a serial device, or an in-process plugin call.

## 2. How the Port System works

At the center is the **Port Manager**, a singleton service that owns the set
of open ports, the routing table, the scheduler, and the translation
pipeline. It sits between the outside world and the neural core:

```
 users / external software / hardware / plugins / extensions
        │            │            │         │          │
     [Port]       [Port]       [Port]    [Port]      [Port]
        └────────────┴─────┬──────┴─────────┴──────────┘
                            ▼
                      PORT MANAGER
        ┌──────────────┬────────────┬───────────────┐
        │  Router       │ Scheduler  │ Translator     │
        │ (Section 10)  │(Section 9) │ (Section 5)    │
        └──────────────┴────────────┴───────────────┘
                            │
                            ▼
                       NEURAL CORE
              (asi_core/neural_core.py, mesh-engine.ts)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           Memory      Extensions      Skills
     (long-term-memory) (extension_   (skill-library,
                          system)       models && skills)
```

Every port is a **bidirectional, independently-stateful pipe**. Data flows
in six stages, identical in shape for every port regardless of what's on the
other end:

1. **Ingress** — raw bytes/events arrive on the port's transport.
2. **Framing** — raw data is split into discrete `PortFrame`s (Section 6).
3. **Translation** — a frame's external format is decoded into the
   internal **neural signal format** (Section 5).
4. **Routing** — the Router decides which core target(s), memory,
   extension, or skill the decoded signal is delivered to (Section 10).
5. **Processing** — the neural core / memory / extension / skill acts on
   it and may produce a response signal.
6. **Egress** — a response signal is translated back to the port's
   external format and written out through the same or a different port.

Because every port goes through the same six stages, the neural core never
special-cases "this came from a human" vs. "this came from a plugin" — it
only ever sees signals, tagged with a `PortId` and a `Priority` (Section 4),
arriving on whatever cadence the Scheduler admits them.

## 3. Port structure

A port is defined by a single record, `PortDescriptor`, which is what gets
registered with the Port Manager and (optionally) persisted as an extension
record for durability:

```ts
type PortDescriptor = {
  id: string;                      // stable unique id, e.g. "user:cli:main"
  kind: PortKind;                  // see below
  direction: "input" | "output" | "duplex";
  transport: TransportKind;        // stdio | http | websocket | serial | usb | bluetooth | ipc | in-process
  protocol: PortProtocol;          // Section 7
  dataFormat: PortDataFormat;      // Section 8
  coreTarget: CoreTargetSpec;      // which NeuralCore/mesh layer(s) this feeds
  owner: string;                   // plugin id, extension id, "system", or "user"
  permissions: ExtensionPermission[]; // reused from plugin_manager/types.ts
  priority: PriorityClass;         // Section 4
  state: PortState;                // Section 4
  createdAt: number;
  lastActivityAt: number;
  metadata: Record<string, unknown>;
};

type PortKind =
  | "user"        // human-facing: chat UI, CLI, voice
  | "plugin"      // plugin_manager PluginDefinition dispatch channel
  | "extension"   // extension_system job/event channel
  | "hardware"    // sensors, actuators, cameras, microphones, robotics
  | "external-api"// third-party services
  | "internal";   // core-to-core, e.g. mesh <-> NeuralCore bridge, skill <-> memory
```

Each `PortDescriptor` owns exactly one **inbound queue** and one **outbound
queue** (even `duplex` ports keep them separate), so read and write pressure
on a port never block each other.

## 4. Port states

```
        register()                  open()
(none) ───────────► registered ─────────────► open ⇄ active
                         │                      │  │
                         │                      │  └──idle()──► idle ──► active (resume)
                      close()                   │
                         │◄──────────────────────┘
                         ▼
                      closed ──── deregister() ──► (gone)
                         │
                      error() (from any state)
                         ▼
                      faulted ──── recover() ──► open
                                 └── deregister() ──► (gone)
```

- **`registered`** — descriptor exists in the Port Manager's table; no
  transport connection has been made yet.
- **`open`** — transport connection established; queues are live but no
  traffic has been scheduled yet this tick.
- **`active`** — currently has frames in flight (being translated, routed,
  or processed).
- **`idle`** — open but no traffic for longer than `idleTimeoutMs`; still
  scheduled for polling, just deprioritized (Section 9).
- **`faulted`** — the transport or translator raised an error; queues are
  frozen and no new frames are accepted until `recover()` succeeds
  (Section 15).
- **`closed`** — transport connection torn down deliberately; descriptor
  remains registered (so it can `open()` again) until explicitly
  deregistered.

`PriorityClass` (Section 4/9) is one of `realtime` (hardware safety signals,
active user turn), `interactive` (open user/plugin conversation), `background`
(extension jobs, telemetry), `bulk` (batch imports, log replays) — used
purely for scheduling weight, not for permission or routing decisions.

## 5. Translating between external formats and the internal neural language

External systems speak JSON, raw audio, video frames, serial byte streams,
binary sensor telemetry, or plain text. The neural core only understands
numeric activation patterns keyed by neuron/layer id
(`Dict[str, float]` in `NeuralCore.inject_input()`, or the mesh's
dimensioned state vectors in `mesh-engine.ts`). The **Translator** is the
component that bridges the two, and it is the only place in the system that
needs to know both worlds.

Translation is a two-step, per-`dataFormat` pipeline:

1. **Decode → Neural Intermediate Representation (NIR).** A format-specific
   `Decoder` turns a `PortFrame`'s raw payload into a `NeuralIntermediate`:
   a normalized, format-agnostic structure —
   `{ tokens?, embedding?, features?, events? }` — that already looks like
   something a core can consume but hasn't yet been bound to specific
   neuron ids.
   - Text → tokenized/embedded via the existing model tokenizer.
   - JSON/structured → flattened into named numeric feature vectors.
   - Audio/video/sensor streams → passed through the relevant
     `models && skills` feature extractor (spectrogram, frame diff, etc.)
     into a feature vector.
   - Binary/serial (hardware) → mapped via a per-device `signal map`
     (declared on the `PortDescriptor.metadata`) from byte offsets to
     named features.
2. **Bind → core injection.** A `CoreBinder` maps the NIR's named
   features/tokens onto `coreTarget`'s specific layer and neuron ids and
   calls `NeuralCore.inject_input(layer_id, pattern)` (or the mesh
   equivalent). This is where `PortDescriptor.coreTarget` is consulted —
   different ports can bind into different layers (e.g. all `hardware`
   ports bind into a `sensory` layer; `user` ports bind into `input`).

Egress is the mirror image: a core's output activations (or a memory/skill
result) are read as a `NeuralIntermediate`, then encoded by the format's
`Encoder` back into the port's external `dataFormat` (JSON response, audio
buffer, actuator command bytes, plain text) before being written to the
transport.

Decoders/encoders are registered per `PortDataFormat` in a pluggable
registry (`Translator.register(format, decoder, encoder)`), so adding
support for a new external format (e.g. a new sensor protocol) never
requires touching the neural core, the router, or any other port.

## 6. Port frames

The unit of data moving through a port, both pre- and post-translation:

```ts
type PortFrame = {
  frameId: string;
  portId: string;
  direction: "in" | "out";
  seq: number;                 // monotonic per-port sequence number
  timestamp: number;
  raw?: Buffer | string;       // present pre-translation
  nir?: NeuralIntermediate;    // present post-translation / pre-encoding
  priority: PriorityClass;
  correlationId?: string;      // ties a response frame back to its request frame
  final: boolean;              // true on the last frame of a streamed exchange
};
```

Streaming exchanges (partial tokens, chunked audio) are modeled as a
sequence of frames sharing a `correlationId`, with `final: true` marking the
end — this is what lets a port emit partial output incrementally instead of
buffering an entire response before writing anything out.

## 7. Port protocols

`PortProtocol` governs the *handshake and framing discipline* on top of the
raw transport, independent of `dataFormat` (what the bytes mean):

| Protocol | Framing discipline | Typical transport |
|---|---|---|
| `stream` | Continuous frame sequence, no explicit end until `close()` | websocket, serial, stdio |
| `request-response` | One outbound frame per inbound frame, matched by `correlationId` | http, in-process plugin call |
| `event` | Fire-and-forget, no response expected | hardware sensor push, telemetry |
| `pubsub` | One inbound frame fans out to N subscriber ports | internal core broadcasts, shared-wiki updates |
| `batch` | Frames accumulate until a size/time threshold, then flush together | bulk import, log replay |

A `PortDescriptor` declares exactly one protocol; a transport that needs to
expose more than one (e.g. an HTTP server offering both request-response
REST calls and a websocket stream) is represented as two separate ports
sharing the same underlying listener.

## 8. Port data formats

`PortDataFormat` is the payload encoding a decoder/encoder pair is
registered against: `text`, `json`, `binary`, `audio-pcm`, `video-frame`,
`sensor-telemetry`, `neural-intermediate` (for `internal` ports that skip
translation because both ends already speak NIR — e.g. mesh-to-core
bridges). New formats are added by registering a decoder/encoder pair
(Section 5); nothing else in the Port System needs to change.

## 9. Port scheduling system

Because many ports can have frames ready simultaneously, the **Scheduler**
decides *which port gets processed this tick* without starving any of them.
It runs a weighted round-robin over open/active ports, gated by
`PriorityClass`:

- Each `PriorityClass` gets a tick-budget share (`realtime` gets first
  claim up to a hard cap so it can never be starved out by volume;
  remaining budget is split `interactive : background : bulk` in a
  configurable ratio, default `4:2:1`).
- Within a class, ports are served round-robin by `lastServedAt` so no
  single high-volume port monopolizes its class's share.
- A port that has been `idle` longer than `idleTimeoutMs` is polled at a
  reduced cadence (e.g. once per N ticks) rather than every tick, freeing
  budget for active ports.
- `realtime`-class hardware ports (e.g. a safety interlock) can be flagged
  `preemptive: true`, letting them jump the queue outside the normal budget
  split — used sparingly, and only for ports whose `permissions` include a
  safety-relevant grant.

The Scheduler is what makes "many ports operate at the same time" concrete:
it is a single-threaded cooperative loop (matching the neural core's own
tick-based `update()` model) rather than one OS thread per port, so
concurrency here means *interleaved fairness per tick*, not literal
parallel execution — actual I/O waits (socket reads, device polls) happen
asynchronously underneath so they don't block the tick loop.

## 10. Port routing system

The **Router** decides, for each decoded `NeuralIntermediate`, where it goes
after translation:

1. **Core routing** — always: delivered to `coreTarget` (a specific
   `NeuralCore` layer id, or a mesh region) per Section 5.
2. **Memory routing** — if `PortDescriptor.metadata.recordToMemory` (default
   `true` for `user` and `plugin` ports), the NIR is also appended to
   `LongTermMemory` tagged with `portId` and `correlationId`, so
   conversations/events on a port remain retrievable across sessions.
3. **Extension/skill routing** — if the NIR matches a registered trigger
   pattern (declared by an installed `extension_system` record or a
   `models && skills` skill), it is additionally dispatched to that
   extension's/skill's handler. This is how, e.g., a hardware port's motion
   event can both feed the sensory layer *and* invoke a `skill` extension
   that was written to react to motion.
4. **Fan-out (`pubsub` protocol only)** — the frame is duplicated to every
   port subscribed to the originating port's topic.

Routing decisions are declarative, not hardcoded: each `PortDescriptor` (and
each extension/skill trigger) contributes routing rules to a shared table
the Router consults per frame, so adding a new consumer of a port's traffic
never requires changing the port itself.

Egress routing is simpler and reverse-directed: a response signal carries
the `correlationId`/`portId` of the frame that caused it, and the Router
looks up the originating port(s) to write the encoded response back to —
this is also how the same input can address a response to more than one
output port (e.g. answer the user *and* push a status update to a
monitoring dashboard port) when a handler names extra target ports.

## 11. Port synchronization system

Multiple ports feeding the same core target, or one exchange spanning
several frames, need consistent ordering guarantees:

- **Per-port ordering** — frames on a single port are always delivered to
  the Router in `seq` order; out-of-order transport delivery (e.g. UDP-like
  hardware links) is reordered by the Translator using a small reorder
  buffer keyed on `seq` before frames reach the Router.
- **Cross-port tick barrier** — the neural core's `update(dt)` advances in
  discrete ticks (`asi_core/neural_core.py`); the Scheduler batches all
  frames it admits within a tick and applies them as one `inputs` map to
  `NeuralCore.update()`, so two ports feeding the same tick are applied
  atomically rather than interleaved mid-update.
- **Correlation joins** — a handler that needs input from two ports before
  it can respond (e.g. combining a voice port's audio with a camera port's
  video for one skill invocation) registers a `correlationId` join with the
  Router, which holds the first-arriving frame until its partner arrives or
  a `joinTimeoutMs` elapses (after which it proceeds degraded, flagged
  `partial: true`, or fails per the handler's declared policy).
- **Clock** — every `PortFrame.timestamp` is stamped by the Port Manager at
  ingress, not by the external source, so synchronization logic never
  trusts a potentially skewed remote clock.

## 12. Port management: registration, updates, removal, control

The **Port Manager** exposes a small, uniform lifecycle API used by
plugins, extensions, the interface layer, and the AI itself:

```ts
interface PortManager {
  register(descriptor: PortDescriptorInput): PortId;
  open(portId: PortId): Promise<void>;
  close(portId: PortId): Promise<void>;
  update(portId: PortId, patch: Partial<PortDescriptor>): void;
  deregister(portId: PortId): void;

  pause(portId: PortId): void;   // stop scheduling, keep transport connected
  resume(portId: PortId): void;

  send(portId: PortId, payload: unknown, opts?: { correlationId?: string }): Promise<void>;
  onFrame(portId: PortId, handler: (frame: PortFrame) => void): Unsubscribe;

  list(filter?: Partial<Pick<PortDescriptor, "kind" | "state" | "owner">>): PortDescriptor[];
  stats(portId: PortId): PortStats;
}
```

- **Creation** — a new port is always created via `register()` with a full
  `PortDescriptor`; there is no implicit port creation from raw traffic
  arriving unannounced. A plugin gains a port the same way it gains any
  other capability: its manifest (`plugin_manager` `ExtensionManifest`)
  declares the port it needs, and `PermissionGuard` (Section 13) approves
  it before `register()` succeeds.
- **Dynamic ports** — the AI can call `register()`/`open()` itself at
  runtime (e.g. opening a new websocket to a service it just discovered, or
  spinning up an internal port to bridge a newly-created extension into the
  core) — this is what "dynamic connections" means: ports are not fixed at
  boot, they come and go with need.
- **Persistence** — a `PortDescriptor` for anything other than a transient
  one-off (`kind !== "internal"` or explicitly flagged `durable: true`) is
  mirrored into `extension_system` as a lightweight record so it survives a
  restart and re-opens automatically; ephemeral internal bridges are not
  persisted.
- **Updates** — `update()` patches mutable fields (`priority`, `metadata`,
  `permissions` narrowing) without tearing down the transport; changing
  `transport`, `protocol`, or `dataFormat` requires `close()` +
  `deregister()` + a fresh `register()`, since those define the pipe
  itself.
- **Removal** — `deregister()` refuses on a port still `active` with
  in-flight frames unless `force: true` is passed, mirroring
  `extension_system`'s refuse-unless-forced pattern for in-use resources.
- **Control** — `pause()`/`resume()` let the Scheduler stop admitting a
  port's frames without dropping its transport connection, used for
  backpressure (Section 14) or deliberate throttling (e.g. a bulk-import
  port paused while a `realtime` incident is being handled).

## 13. Port permissions and security

Every port carries a `permissions: ExtensionPermission[]` list drawn from
the same vocabulary `plugin_manager/types.ts` already defines
(`camera`, `microphone`, `file-system`, `multi-input`, etc.), so a hardware
port requesting the camera goes through the identical grant path a plugin
requesting camera access would. Concretely:

- **Grant-gated registration** — `register()` calls `PermissionGuard` with
  the requested `permissions`; a port whose owner lacks a requested
  permission is registered in a `disabled` sub-state and never reaches
  `open()`.
- **Least-privilege translation** — a port's `coreTarget` and routing rules
  are scoped to what its permissions justify; e.g. a port with only
  `messaging` cannot be routed to a `file-system`-tagged extension handler
  even if a routing rule superficially matches, because the Router
  cross-checks the target's required permission against the source port's
  grants.
- **Per-frame provenance** — every `PortFrame` and the `NeuralIntermediate`
  it produces carries `portId`/`owner`, so downstream systems (memory,
  extensions, the alignment veto) can always answer "who said this" rather
  than treating all core input as equally trusted.
- **Isolation** — one port's queue, translator state, and error state never
  leak into another's; a malformed or hostile frame on one port can corrupt
  at most that port's pipeline, not the shared Router or Scheduler state.
- **Irreversible-effect gating** — any egress that would trigger an
  external-effect action (per `AlignmentVetoConfig.confirmIrreversible`,
  `models && skills/core/alignment-veto.ts`) is evaluated by the alignment
  veto layer before the Translator's `Encoder`/transport write, exactly as
  it would be for a non-port-mediated action; the Port System does not
  bypass it.
- **Revocation** — revoking a permission (via the same mechanism that
  revokes an `ExtensionPermission` elsewhere) immediately transitions any
  port relying on it to `faulted`, forcing an explicit `recover()` (which
  re-runs the permission check) rather than silently continuing degraded.

## 14. Managing many active connections and backpressure

With potentially dozens of open ports, the Port Manager bounds resource use
rather than assuming unlimited concurrency:

- **Queue caps** — each port's inbound/outbound queue has a configurable
  max depth (`maxQueueDepth`, default scaled by `PriorityClass`); once full,
  new frames are rejected at ingress (`event`/`pubsub` protocols drop
  oldest-first; `request-response`/`stream` protocols signal backpressure
  to the transport, e.g. TCP flow control or an HTTP 429).
- **Idle demotion** — ports with no traffic transition to `idle`
  (Section 4) and are polled at reduced cadence, freeing Scheduler budget
  without requiring the port to close.
- **Health accounting** — `PortManager.stats(portId)` exposes queue depth,
  frame throughput, translation error rate, and average round-trip latency;
  the Port Manager itself watches these to auto-pause a port whose error
  rate crosses a threshold (transitioning it to `faulted` rather than
  letting it keep failing silently).
- **Global cap** — a system-wide `maxOpenPorts` limit prevents unbounded
  port creation (e.g. from a misbehaving plugin); `register()` past the cap
  fails fast rather than degrading every existing port's scheduling share.

## 15. Failure handling and recovery

- **Transport failure** (socket drop, device disconnect) → port moves to
  `faulted`; queued outbound frames are retained up to `maxQueueDepth` for
  replay on `recover()`; queued inbound frames are discarded (the external
  side, not the AI, owns retry semantics for input it already sent).
- **Translation failure** (undecodable payload) → the single offending
  `PortFrame` is dropped and logged with `frameId`/`portId`; the port
  itself stays `active` — one bad frame never faults the whole port.
- **Routing/handler failure** (a skill or extension handler throws) → the
  error is attributed to that handler, not the port; the port's own state
  is untouched, and the Router logs the failure for the extension system's
  own error accounting.
- **Core overload** (Scheduler budget exhausted every tick) → lower-priority
  ports are held in their queues (subject to `maxQueueDepth`) rather than
  dropped, so a burst degrades to added latency, not lost input, until
  demand subsides.
- **Recovery** — `recover(portId)` re-validates permissions, re-establishes
  the transport, and replays any retained outbound frames before returning
  the port to `open`; recovery is always explicit (manual or via a
  supervising extension's retry policy), never automatic-and-silent, so a
  persistently failing port doesn't spin unnoticed.

## 16. Integration with the rest of the architecture

The Port System is a boundary layer, not a new brain: it deliberately owns
no reasoning, memory, or capability logic of its own.

- **Neural core / mesh** — sole consumer of translated input and sole
  source of output signal (Sections 2, 5). The Port System has no
  understanding of what a signal *means*; it only knows how to get it in
  and out.
- **Plugin manager** — every `plugin` port is a transport wrapper around an
  existing `PluginDefinition`; the Port System adds concurrency and framing
  around plugin calls, it does not change what plugins can do
  (`plugin_manager` permissions remain authoritative).
- **Extension system** — supplies durability for port definitions and
  grants (Section 12), and is itself addressable via `extension` ports so
  extension jobs can stream progress/results the same way any other port
  would.
- **Memory / skills** — receive routed copies of port traffic (Section 10)
  and can register routing triggers, but never talk to a transport
  directly; if a skill needs to reach the outside world, it does so by
  asking the Port Manager to `send()` on an existing port or `register()` a
  new one, keeping the permission boundary in one place.
- **Interface layer** — `interface/web-server.ts` and `interface/cli.ts`
  become the first two concrete `PortDescriptor` instances (`kind: "user"`,
  `protocol: "request-response"`/`"stream"`) rather than special-cased
  entrypoints, so any future UI (voice, desktop, robotics teleoperation)
  is "add a port," not "add a new I/O subsystem."
- **Alignment veto** — remains the last gate before any egress with
  external effect, unchanged in authority, just now invoked uniformly from
  the Translator's egress path for every port kind (Section 13).

This makes the Port System the single place in the architecture where "how
many things can the AI talk to right now, and how" is answered — every
other system answers "what happens once something arrives" or "what is the
AI allowed to do," and treats the Port System as the reason those questions
can be asked about several independent conversations at once instead of
one.
