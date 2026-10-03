/**
 * The full network on the phone: the engine bundled by mobile/brain
 * (npm run build:phone-brain) must run with nothing Node or browser gives it --
 * no require, Buffer, timers, console or TextEncoder -- because that is what a
 * phone's JavaScript runtime may lack.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

describe('the phone brain bundle', () => {
  it('runs the network in a bare JavaScript context', async () => {
    const ctx = vm.createContext({});
    vm.runInContext(readFileSync('mobile/brain/bundle/neuroclaw-brain.js', 'utf8'), ctx);
    ctx.model = readFileSync('models && skills/onebrain/model.json', 'utf8');

    const init = JSON.parse(vm.runInContext('NeuroClawBrain.init(model)', ctx));
    expect(init.ok).toBe(true);
    expect(init.value.oneBrainGrafted.connections).toBeGreaterThan(0);
    expect(init.value.regions).toContain('onebrain');

    // A message through the Zip Loop and back.
    const chat = JSON.parse(await vm.runInContext('NeuroClawBrain.chat("hi")', ctx));
    expect(chat.ok).toBe(true);
    expect(typeof chat.value.reply).toBe('string');

    // Yes/no on the phone.
    vm.runInContext('NeuroClawBrain.teach("Is this spam?","WIN a FREE prize click here",true); NeuroClawBrain.teach("Is this spam?","lunch tomorrow at noon?",false)', ctx);
    expect(JSON.parse(vm.runInContext('NeuroClawBrain.ask("Is this spam?","FREE prize, click here")', ctx)).value.answer).toBe('yes');

    // What it learned survives a restart.
    const saved = JSON.parse(vm.runInContext('NeuroClawBrain.exportState()', ctx)).value;
    ctx.saved = saved;
    const again = JSON.parse(vm.runInContext('NeuroClawBrain.init(model, saved)', ctx));
    expect(again.value.restored).toBe(true);
    expect(JSON.parse(vm.runInContext('NeuroClawBrain.ask("Is this spam?","FREE prize, click here")', ctx)).value.trained).toBe(true);
  }, 120_000);

  it('syncs with the PC: sends its yes/no examples, takes the PC\'s OneBrain and knowledge', () => {
    const ctx = vm.createContext({});
    vm.runInContext(readFileSync('mobile/brain/bundle/neuroclaw-brain.js', 'utf8'), ctx);
    const model = JSON.parse(readFileSync('models && skills/onebrain/model.json', 'utf8'));
    ctx.old = JSON.stringify({ ...model, modifiedAt: 1 });
    ctx.pc = JSON.stringify({ ...model, modifiedAt: 2 });
    vm.runInContext('NeuroClawBrain.init(old)', ctx);
    vm.runInContext('NeuroClawBrain.teach("Is this urgent?","server is down",true)', ctx);

    const out = JSON.parse(vm.runInContext('NeuroClawBrain.syncOut(false)', ctx)).value;
    expect(out.teach).toEqual([{ question: 'Is this urgent?', text: 'server is down', answer: true }]);
    expect(out.oneBrainVersion).toBe(1);
    vm.runInContext('NeuroClawBrain.syncOut(true)', ctx);
    expect(JSON.parse(vm.runInContext('NeuroClawBrain.syncOut(false)', ctx)).value.teach).toEqual([]);

    // What a PC sends back: a newer OneBrain and its yes/no knowledge.
    ctx.pcYesNo = JSON.stringify({ version: 2, questions: [{ question: 'is this urgent', sumYes: new Array(64).fill(0), sumNo: new Array(64).fill(0), countYes: 1, countNo: 1,
      samples: [{ v: new Array(64).fill(0), yes: true, text: 'server is down' }, { v: new Array(64).fill(0), yes: false, text: 'see you next week' }] }] });
    const after = JSON.parse(vm.runInContext('NeuroClawBrain.syncIn(pc, pcYesNo)', ctx)).value;
    expect(after.rebuilt).toBe(true);
    expect(after.oneBrainVersion).toBe(2);
    expect(JSON.parse(vm.runInContext('NeuroClawBrain.ask("Is this urgent?","the server is down")', ctx)).value.answer).toBe('yes');
  });
});
