/**
 * How an all-connected network stops.
 *
 * There is no last layer to fall out of, so the halt has to come from the
 * network itself: a stop call it wrote into the output archive's plugins
 * folder. The tests that matter are the ones about when that call counts --
 * writing it and continuing to type is not finishing -- and about the run
 * that never asks to stop still terminating, distinguishably.
 */

import { describe, it, expect } from 'vitest';
import {
  packZip,
  unpackZip,
  runUntilStopped,
  ZIP_FOLDERS,
  STOP_CALL,
  NETWORK_STATE_FILE,
  type BitDoorway,
  type ZipTree,
} from '../../models && skills/core/zip-halt.js';

/** A doorway that replays a fixed archive, then goes quiet forever. */
function replay(tree: ZipTree, options: { trailingNoise?: number } = {}): BitDoorway {
  const bytes = packZip(tree);
  let i = 0;
  let noise = options.trailingNoise ?? 0;
  return {
    sendBytes: () => {},
    nextOutputByte: () => {
      if (i < bytes.length) return bytes[i++];
      // "Still typing": output that keeps arriving after the stop call is in
      // the stream, which must not be read as the end of the run.
      if (noise > 0) { noise--; return 0x20; }
      return null;
    },
  };
}

describe('the archive that goes through two neurons', () => {
  it('round-trips folders and files', () => {
    const tree = { files: { [`${ZIP_FOLDERS.prompt}ask.txt`]: 'what is this', [STOP_CALL]: '' } };
    expect(unpackZip(packZip(tree))).toEqual(tree);
  });

  it('packs the same tree to the same bytes whatever order the keys came in', () => {
    const a = packZip({ files: { 'b.txt': '2', 'a.txt': '1' } });
    const b = packZip({ files: { 'a.txt': '1', 'b.txt': '2' } });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('treats a half-arrived stream as not-yet-readable rather than an error', () => {
    // Every read during a live run lands mid-archive. If that threw, the run
    // could not be watched while it was happening at all.
    const partial = packZip({ files: { 'output/a.txt': 'hello' } }).slice(0, 5);
    expect(unpackZip(partial)).toBeNull();
  });

  it('treats a different plugin call as a plugin call, not as stopping', () => {
    // A network asking to search has not asked to finish. If any file under
    // plugins/ ended the run, the network could never call a plugin at all.
    const result = runUntilStopped(
      replay({ files: { [`${ZIP_FOLDERS.plugins}search`]: 'weather' } }),
      { files: {} },
      { quietTicks: 4, maxTicks: 120 },
    );
    expect(result.sawStop).toBe(false);
    expect(result.reason).toBe('ceiling');
  });
});

describe('stopping', () => {
  it('ends the run when the network asks to stop and then goes quiet', () => {
    const result = runUntilStopped(
      replay({ files: { [`${ZIP_FOLDERS.output}answer.txt`]: 'done', [STOP_CALL]: '' } }),
      { files: { [`${ZIP_FOLDERS.prompt}ask.txt`]: 'go' } },
      { quietTicks: 4, maxTicks: 5_000 },
    );
    expect(result.reason).toBe('stopped-itself');
    expect(result.complete).toBe(true);
    expect(result.tree?.files[`${ZIP_FOLDERS.output}answer.txt`]).toBe('done');
  });

  it('does not stop while output is still arriving after the stop call', () => {
    // The whole point of the quiet window: a stop call in the middle of a
    // larger output is the network mentioning stopping, not finishing.
    const noisy = 40;
    const quietTicks = 4;
    const result = runUntilStopped(
      replay({ files: { [STOP_CALL]: '' } }, { trailingNoise: noisy }),
      { files: {} },
      { quietTicks, maxTicks: 5_000 },
    );
    expect(result.reason).toBe('stopped-itself');
    // It waited out every noisy tick before the quiet window could complete.
    expect(result.ticks).toBeGreaterThan(noisy + quietTicks);
  });

  it('terminates a network that never asks to stop, and says that is what happened', () => {
    // A network not TAUGHT to emit the stop call never will. The ceiling has
    // to catch that, and must not be reported as a finished run.
    const forever: BitDoorway = { sendBytes: () => {}, nextOutputByte: () => 0x41 };
    const result = runUntilStopped(forever, { files: {} }, { quietTicks: 4, maxTicks: 200 });
    expect(result.halted).toBe(true);
    expect(result.reason).toBe('ceiling');
    expect(result.complete).toBe(false);
    expect(result.sawStop).toBe(false);
    expect(result.ticks).toBe(200);
  });

  it('never un-sees a stop call once it has been seen', () => {
    // Trailing noise makes every later read of the stream unparseable, so a
    // watcher that re-derived "did it ask to stop" from scratch each tick
    // would forget. It must not.
    const result = runUntilStopped(
      replay({ files: { [STOP_CALL]: '' } }, { trailingNoise: 12 }),
      { files: {} },
      { quietTicks: 3, maxTicks: 400 },
    );
    expect(result.sawStop).toBe(true);
    expect(result.reason).toBe('stopped-itself');
  });

  it('carries plugin errors back in through their own folder', () => {
    // The way a failed plugin call reaches the network is the same doorway as
    // everything else: a folder in the archive going in.
    const tree: ZipTree = {
      files: {
        [`${ZIP_FOLDERS.errors}search`]: 'no network',
        [`${ZIP_FOLDERS.promptingSkills}how-to-search.md`]: 'try again offline',
      },
    };
    const back = unpackZip(packZip(tree));
    expect(back?.files[`${ZIP_FOLDERS.errors}search`]).toBe('no network');
    expect(back?.files[`${ZIP_FOLDERS.promptingSkills}how-to-search.md`]).toBe('try again offline');
  });
});

describe('the real mesh doorway', () => {
  it('reports silence as silence rather than as a stream of zeros', async () => {
    // The distinction the whole halt condition rests on. receiveBits() always
    // returns a bit, so a dormant network reads as endless zeros; without
    // nextOutputByte() there is no way to tell "finished" from "emitting 0".
    //
    // Kept to a handful of bytes on a small engine on purpose: every bit is a
    // full settle() of the mesh (~15ms even at 8 dimensions), so a test that
    // streamed a real archive through here would take minutes.
    const { HyperDimensionalEngine, ZipLoopInterface } = await import('../../models && skills/core/onebrain.js');
    const engine = new HyperDimensionalEngine(8);
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });

    // Compile-time proof that the mesh is a doorway a run can be driven
    // through -- the cheapest possible version of the integration test.
    const doorway: BitDoorway = zip;

    let sawSilence = false;
    for (let i = 0; i < 6 && !sawSilence; i++) {
      if (doorway.nextOutputByte() === null) sawSilence = true;
    }
    expect(sawSilence).toBe(true);
  }, 20_000);
});

describe('what a stopped run keeps', () => {
  /** A doorway that stops immediately and reports a snapshot. */
  const withState = (state: unknown, opts: { readable?: boolean } = {}): BitDoorway => {
    const bytes = opts.readable === false ? new Uint8Array(0) : packZip({ files: { [STOP_CALL]: '' } });
    let i = 0;
    return {
      sendBytes: () => {},
      nextOutputByte: () => (i < bytes.length ? bytes[i++] : null),
      captureNetworkState: () => state,
    };
  };

  const fakeState = { shape: { neurons: 2, dimensions: 4 }, states: 'AA==' };

  it('saves what every neuron and connection was, into state/', () => {
    const result = runUntilStopped(withState(fakeState), { files: {} }, { quietTicks: 3, maxTicks: 500 });
    expect(result.reason).toBe('stopped-itself');
    expect(result.networkState).toEqual(fakeState);
    expect(JSON.parse(result.tree!.files[NETWORK_STATE_FILE])).toEqual(fakeState);
  });

  it('keeps memory/ for chat history rather than for network state', () => {
    // Two different things: what was said in other conversations, and what the
    // mesh was holding. A folder that mixed them would make them
    // indistinguishable to anything reading them back.
    const result = runUntilStopped(withState(fakeState), { files: {} }, { quietTicks: 3, maxTicks: 500 });
    expect(NETWORK_STATE_FILE.startsWith(ZIP_FOLDERS.state)).toBe(true);
    expect(Object.keys(result.tree!.files).some(f => f.startsWith(ZIP_FOLDERS.memory))).toBe(false);
  });

  it('saves the state of a run that was cut off, not just one that finished', () => {
    // The cut-off run is the one worth resuming. Saving only on the tidy
    // ending would lose exactly the state anyone would want back.
    const forever: BitDoorway = {
      sendBytes: () => {},
      nextOutputByte: () => 0x41,
      captureNetworkState: () => fakeState,
    };
    const result = runUntilStopped(forever, { files: {} }, { quietTicks: 3, maxTicks: 50 });
    expect(result.reason).toBe('ceiling');
    expect(result.networkState).toEqual(fakeState);
  });

  it('does not invent an archive out of the state it saved itself', () => {
    // A null tree means the network produced nothing readable. Manufacturing
    // one from our own snapshot would erase that distinction.
    const result = runUntilStopped(
      withState(fakeState, { readable: false }),
      { files: {} },
      { quietTicks: 2, maxTicks: 20 },
    );
    expect(result.tree).toBeNull();
    expect(result.networkState).toEqual(fakeState);
  });
});

describe('starting again in the same place', () => {
  it('restores the network exactly: states, energies and connections', async () => {
    const { HyperDimensionalEngine } = await import('../../models && skills/core/onebrain.js');
    const engine = new HyperDimensionalEngine({ neuronCount: 12, dimensions: 6 });

    engine.process(new Array(6).fill(0.7));
    const saved = engine.captureNetworkState();
    const before = engine.getNeuronStates().map(n => Array.from(n.state));
    const beforeEnergy = engine.getNeuronEnergy(0);

    // Move the network on -- and move the CONNECTIONS, not just the
    // activations, since learning is what makes resuming hard.
    for (let i = 0; i < 3; i++) engine.process(new Array(6).fill(-0.9));

    expect(engine.restoreNetworkState(saved)).toBe(true);
    expect(engine.getNeuronStates().map(n => Array.from(n.state))).toEqual(before);
    expect(engine.getNeuronEnergy(0)).toBeCloseTo(beforeEnergy, 10);

    // The real test of "same place": the same input now produces the same
    // next state it did the first time. That is only true if the connections
    // came back too.
    const replayed = engine.captureNetworkState();
    expect(replayed.connDiag).toBe(saved.connDiag);
    expect(replayed.connShift).toBe(saved.connShift);
  }, 30_000);

  it('refuses a snapshot from a network of a different shape', async () => {
    // Padding or truncating would hand the network a plausible-looking context
    // it never had -- worse than starting clean, because nothing looks wrong.
    const { HyperDimensionalEngine } = await import('../../models && skills/core/onebrain.js');
    const small = new HyperDimensionalEngine({ neuronCount: 4, dimensions: 4 });
    const large = new HyperDimensionalEngine({ neuronCount: 8, dimensions: 4 });
    expect(large.restoreNetworkState(small.captureNetworkState())).toBe(false);
  }, 30_000);

  it('refuses a snapshot whose arrays are the wrong length for its own shape', async () => {
    // Same shape, truncated payload -- the case a length-blind restore would
    // load halfway and leave the engine in a state that is neither.
    const { HyperDimensionalEngine } = await import('../../models && skills/core/onebrain.js');
    const engine = new HyperDimensionalEngine({ neuronCount: 4, dimensions: 4 });
    const snapshot = engine.captureNetworkState();
    expect(engine.restoreNetworkState({ ...snapshot, connDiag: snapshot.connDiag.slice(0, 8) })).toBe(false);
  }, 30_000);
});

describe('a file goes straight in', () => {
  it('carries bytes through the doorway without describing them as text first', () => {
    // A recording is already bits. Making it become a transcript on the way in
    // would throw away everything about it except the words.
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x7f]).toString('base64');
    const tree: ZipTree = {
      files: { [`${ZIP_FOLDERS.prompt}note.txt`]: 'said out loud' },
      binary: { [`${ZIP_FOLDERS.prompt}recording.webm`]: audio },
    };
    const back = unpackZip(packZip(tree));
    expect(back?.binary?.[`${ZIP_FOLDERS.prompt}recording.webm`]).toBe(audio);
    expect(back?.files[`${ZIP_FOLDERS.prompt}note.txt`]).toBe('said out loud');
  });

  it('keeps bytes out of the text map, so nothing has to guess which is which', () => {
    const tree: ZipTree = { files: {}, binary: { 'input/a.bin': 'AAEC' } };
    const back = unpackZip(packZip(tree));
    expect(back?.files['input/a.bin']).toBeUndefined();
    expect(back?.binary?.['input/a.bin']).toBe('AAEC');
  });

  it('packs an all-text tree exactly as before, with no empty binary map', () => {
    // Adding binary support must not change the bytes of a tree that has none:
    // the same input has to keep producing the same stream.
    const withoutKey = packZip({ files: { 'a.txt': '1' } });
    const withEmpty = packZip({ files: { 'a.txt': '1' }, binary: {} });
    expect(Buffer.from(withoutKey).equals(Buffer.from(withEmpty))).toBe(true);
  });
});

describe('the folders in the archive', () => {
  it('keeps a prompt, a plug-in and a prompting skill apart', () => {
    // Three different kinds of thing: what was asked, a capability with its
    // own instructions, and guidance about how to go about it. Flattened into
    // one pile, nothing downstream could tell which is which -- and guidance
    // spliced into the prompt would be indistinguishable from the request.
    expect(ZIP_FOLDERS.prompt).toBe('prompt/');
    expect(ZIP_FOLDERS.plugins).toBe('plugins/');
    expect(ZIP_FOLDERS.promptingSkills).toBe('prompting-skills/');
  });

  it('gives each plug-in and each prompting skill its own folder', () => {
    // A folder each, so both can be walked the same way and either can carry
    // more than one file.
    const tree: ZipTree = {
      files: {
        [`${ZIP_FOLDERS.prompt}prompt.txt`]: 'find out what changed today',
        [`${ZIP_FOLDERS.plugins}file-system/PLUGIN.json`]: '{"id":"file-system"}',
        [`${ZIP_FOLDERS.promptingSkills}recall-what-i-know/SKILL.json`]: '{"name":"recall-what-i-know"}',
      },
    };
    const back = unpackZip(packZip(tree));
    expect(Object.keys(back!.files).sort()).toEqual([
      'plugins/file-system/PLUGIN.json',
      'prompt/prompt.txt',
      'prompting-skills/recall-what-i-know/SKILL.json',
    ]);
  });

  it('has no folder for a net skill, because a net skill is not handed over', () => {
    // A net skill is neurons wired into the mesh -- part of the network rather
    // than something in the archive it reads.
    expect(Object.values(ZIP_FOLDERS)).not.toContain('net-skills/');
    expect(Object.values(ZIP_FOLDERS)).not.toContain('skills/');
  });
});
