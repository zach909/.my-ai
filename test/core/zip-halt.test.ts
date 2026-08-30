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
  STOP_REPORT_FILE,
  runStopCommand,
  type BitDoorway,
  type ZipTree,
} from '../../models && skills/core/zip-halt.js';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';

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
    // The claim here is sawStop: calling `search` is not asking to finish. The
    // ENDING is now "went-quiet" rather than "ceiling", because the replay
    // falls silent after its one call and silence held long enough is itself a
    // way of stopping. Neither is "complete" -- the network never said it was
    // done -- so nothing about "a plugin call is not a stop call" has moved.
    expect(result.reason).toBe('went-quiet');
    expect(result.complete).toBe(false);
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
    // The ceiling bounds the WHOLE run, input included, not just the answer.
    // It used to cap output bytes only, so the bits going in were unbounded --
    // and the packed form of even a two-character prompt is 408 of them. A
    // caller asking for a ceiling of six still waited through all of that
    // before the cap could apply to anything, which is why a bounded run
    // could take minutes and never come back. Here the empty tree still packs
    // to a real archive, so the output budget is 200 minus that.
    expect(result.ticks).toBeLessThanOrEqual(200);
    expect(result.ticks).toBeGreaterThan(100);
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

describe('the stop command', () => {
  /**
   * "When it stops it will run a command that will stop it and see if all the
   * neuron states."
   *
   * The second half was never happening. `plugins/stop` existed only as a
   * STRING to look for: asksToStop() checked whether the network had written
   * that path, and if it had, the run ended. Nothing was ever executed, and
   * nothing ever looked at the neurons beyond serialising them -- a capture
   * holding 300 states for 336 neurons, or a column of NaN from a graft that
   * went wrong, travelled back looking exactly like a healthy one.
   */
  const snapshotOf = (neurons: number, dimensions: number, fill: number) => {
    const per = dimensions + 1;
    const values = new Float32Array(neurons * per);
    values.fill(fill);
    return { values, neurons, dimensions };
  };
  const encode = (s: { values: Float32Array; neurons: number; dimensions: number }) => ({
    shape: { neurons: s.neurons, dimensions: s.dimensions },
    states: Buffer.from(s.values.buffer, s.values.byteOffset, s.values.byteLength).toString('base64'),
  });

  it('accounts for every neuron on a healthy run', () => {
    const report = runStopCommand(encode(snapshotOf(16, 8, 0.2)), 'settled');
    expect(report.reason).toBe('settled');
    expect(report.expectedNeurons).toBe(16);
    expect(report.statesFound).toBe(16);
    expect(report.finite).toBe(16);
    expect(report.allAccountedFor).toBe(true);
    expect(report.notes).toEqual([]);
  });

  it('says so when neurons are missing from the capture', () => {
    // The network claims 64; only 50 states came back.
    const short = encode(snapshotOf(50, 16, 0.2));
    short.shape.neurons = 64;
    const report = runStopCommand(short, 'settled');
    expect(report.allAccountedFor).toBe(false);
    expect(report.notes.join(' ')).toContain('64 neurons but 50 states');
  });

  it('says so when a neuron comes back holding something that is not a number', () => {
    // The failure a bad graft produced once: whole neurons of NaN, which
    // serialise and travel back looking like any other state.
    const broken = snapshotOf(8, 4, 0.2);
    broken.values[3 * 8 + 1] = NaN;
    broken.values[2 * 8 + 5] = NaN;
    const report = runStopCommand(encode(broken), 'settled');
    expect(report.finite).toBe(6);
    expect(report.allAccountedFor).toBe(false);
    expect(report.notes.join(' ')).toContain('not a number');
  });

  it('says so when the mesh came back pinned at the rail', () => {
    const report = runStopCommand(encode(snapshotOf(16, 8, 1)), 'ceiling');
    expect(report.saturated).toBeGreaterThan(0);
    expect(report.notes.join(' ')).toContain('pinned at the rail');
  });

  it('says so when there is nothing to look at', () => {
    const report = runStopCommand(undefined, undefined);
    expect(report.reason).toBe('unknown');
    expect(report.allAccountedFor).toBe(false);
    expect(report.notes.join(' ')).toContain('no states at all');
  });

  it('runs on a real stopped run and leaves its findings in the tree', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 64, dimensions: 16, propagationSteps: 16,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const result = runUntilStopped(zip, { files: { 'prompt/prompt.txt': 'hi' } }, { quietTicks: 3, maxTicks: 120 });

    expect(result.stopReport).toBeTruthy();
    expect(result.stopReport!.expectedNeurons).toBe(64);
    expect(result.stopReport!.allAccountedFor).toBe(true);
    // The report comes back whatever happened, because a run that produced
    // nothing readable is exactly when you want to know what state it left.
    // It also rides IN the output tree -- but only when there is one: a null
    // tree means the network said nothing, and manufacturing a tree out of
    // files we wrote ourselves would erase that distinction.
    if (result.tree) {
      expect(Object.keys(result.tree.files)).toContain(STOP_REPORT_FILE);
    }
  }, 60_000);
});
