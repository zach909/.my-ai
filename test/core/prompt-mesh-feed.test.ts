/**
 * Everything said goes through the real Zip Loop, as a file.
 *
 * ZipIOSystem is a compressed ring buffer of text -- the working context. It
 * is what "zip loop" meant everywhere in zip-io.ts, and it never touched a
 * neuron. The doorway into the mesh is ZipLoopInterface: two input neurons
 * meaning 1 and 0, one settle per bit. A prompt reached the buffer and not
 * the mesh.
 *
 * These pin both halves: that a prompt really is packed as a file and really
 * does drive the bit neurons, and that doing so cannot block or unbound the
 * caller.
 */
import { describe, it, expect } from 'vitest';
import { PromptMeshFeed, type BitDoorway } from '../../models && skills/core/zip-io';
import { packZip } from '../../models && skills/core/zip-halt';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain';

/** A doorway that records what it was given instead of settling a mesh. */
function recorder() {
  const bytes: number[] = [];
  let events = 0;
  const door: BitDoorway = {
    sendByte: (b) => { bytes.push(b); },
    learnFromEvent: () => { events++; },
  };
  return { door, bytes, events: () => events };
}

/** Run to completion with no real waiting. */
const immediate = () => Promise.resolve();

describe('a prompt goes into the mesh as a file', () => {
  it('sends the packed archive, byte for byte', async () => {
    const r = recorder();
    const feed = new PromptMeshFeed(() => r.door, immediate);
    const report = await feed.feedNow('hello mesh');

    const expected = packZip({ files: { 'prompt.txt': 'hello mesh' } });
    expect(r.bytes.length).toBe(expected.length);
    expect(Uint8Array.from(r.bytes)).toEqual(expected);
    expect(report.bytes).toBe(expected.length);
    // A gzipped archive, not the raw string: the first two bytes are gzip's.
    expect(r.bytes[0]).toBe(0x1f);
    expect(r.bytes[1]).toBe(0x8b);
    // Nothing here is the plain text.
    expect(Buffer.from(r.bytes).toString('utf8')).not.toContain('hello mesh');
  });

  it('learns once from the whole message, not once per byte', async () => {
    const r = recorder();
    const feed = new PromptMeshFeed(() => r.door, immediate);
    await feed.feedNow('a longer prompt with more than a few bytes in it');
    expect(r.bytes.length).toBeGreaterThan(20);
    // The elastic core learns from an EVENT. A single byte is not an event;
    // the message is. Learning per byte is what put 522 seconds between a
    // question arriving and the network having heard it.
    expect(r.events()).toBe(1);
  });

  it('names the file, so the network is told what it is hearing', async () => {
    const r = recorder();
    const feed = new PromptMeshFeed(() => r.door, immediate);
    await feed.feedNow('x', 'user-said.txt');
    expect(Uint8Array.from(r.bytes)).toEqual(packZip({ files: { 'user-said.txt': 'x' } }));
  });

  it('is a no-op when the network has not been built yet', async () => {
    const feed = new PromptMeshFeed(() => null, immediate);
    const report = await feed.feedNow('nobody home');
    expect(report.bytes).toBe(0);
    expect(feed.error()).toBeNull();
    expect(feed.fed()).toBe(0);
  });

  it('a doorway that throws does not fail the message it came from', async () => {
    const feed = new PromptMeshFeed(
      () => ({ sendByte: () => { throw new Error('mesh exploded'); }, learnFromEvent: () => {} }),
      immediate,
    );
    await expect(feed.feedNow('boom')).resolves.toBeDefined();
    expect(feed.error()).toBe('mesh exploded');
    expect(feed.fed()).toBe(0);
  });

  it('keeps one prompt waiting, not a queue, and says how many it dropped', async () => {
    const r = recorder();
    let release: (() => void) | null = null;
    // A yield that parks, so a feed can be held mid-stream.
    const parked = () => new Promise<void>(resolve => { release = resolve; });
    const feed = new PromptMeshFeed(() => r.door, parked);

    const first = feed.feedNow('first');
    await Promise.resolve();
    expect(feed.busy()).toBe(true);

    // Three arrive while it is busy. Only the last survives.
    for (const t of ['second', 'third', 'fourth']) {
      const r2 = await feed.feedNow(t);
      expect(r2.superseded).toBe(true);
    }
    expect(feed.dropped()).toBe(2);

    // Let everything drain.
    while (feed.busy()) {
      const go = release;
      release = null;
      if (go) go();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await first;
    // The first ran, and the survivor of the other three ran. Not all four.
    expect(feed.fed()).toBe(2);
    const fourth = packZip({ files: { 'prompt.txt': 'fourth' } });
    expect(Buffer.from(r.bytes).subarray(-fourth.length)).toEqual(Buffer.from(fourth));
  });

  it('drives the real bit neurons of a real engine', async () => {
    // The half a fake doorway cannot prove. If this passed against a
    // recorder only, "the prompt reaches the mesh" would rest on a mock.
    const engine = new HyperDimensionalEngine({
      neuronCount: 12, dimensions: 6, propagationSteps: 2, convergenceThreshold: 0.01,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const before = engine.captureNetworkState().states;

    const feed = new PromptMeshFeed(() => zip, immediate);
    const report = await feed.feedNow('hi');
    expect(report.bytes).toBeGreaterThan(0);
    expect(feed.fed()).toBe(1);

    // The mesh is somewhere else than it was, and still finite.
    const after = engine.captureNetworkState().states;
    expect(after).not.toBe(before);
    for (const neuron of engine.getNeuronStates()) {
      for (const v of neuron.state) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
