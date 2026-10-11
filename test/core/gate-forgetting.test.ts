import { describe, it, expect } from 'vitest';
import { ElasticCoreBlock } from '../../models && skills/core/onebrain';

const N=6, SD=4;
const mk=(seed:number)=>new ElasticCoreBlock({neuronCount:N,stateDim:SD,inputDim:SD,outputDim:2,maxTicks:8,seed});
const reset=(b:any)=>{b.state.fill(0); b.quantizationResidual.fill(0);};
const xA=Float32Array.from([1,0.6,0,0]), yA=[0.8,-0.5];
const xB=Float32Array.from([0.6,1,0.3,0]), yB=[-0.6,0.7];
const loss=(b:any,x:Float32Array,y:number[])=>{ reset(b); const o=b.forward(x).output as Float32Array; return ((o[0]-y[0])**2+(o[1]-y[1])**2)/2; };
function grad(b:any,x:Float32Array,y:number[]){
  const eps=1e-2, gw=new Float32Array(b.weights.length), gb=new Float32Array(b.bias.length);
  for (const [arr,g] of [[b.weights,gw],[b.bias,gb]] as const){
    for(let i=0;i<arr.length;i++){ const o=arr[i];
      arr[i]=o+eps; const lp=loss(b,x,y); arr[i]=o-eps; const lm=loss(b,x,y); arr[i]=o; g[i]=(lp-lm)/(2*eps); } }
  return {weights:gw,biases:gb};
}
function train(b:any,x:Float32Array,y:number[],steps:number,lr:number,vale?:Map<number,number>,scale=1){
  for(let s=0;s<steps;s++) b.applyGradients(grad(b,x,y),{learningRate:lr,vale,scale});
}
function importance(b:any,x:Float32Array){ reset(b); const d=(b.forward(x).stateDeltas as Map<number,number>); const mx=Math.max(...d.values())||1; const v=new Map<number,number>(); for(const [k,val] of d) v.set(k,0.9*val/mx); return v; }
const snap = (b: any) => ({ w: b.weights.slice(), b: b.bias.slice(), i: b.inputProjection.slice(), o: b.outputProjection.slice() });
const restore = (b: any, x: any) => { b.weights.set(x.w); b.bias.set(x.b); b.inputProjection.set(x.i); b.outputProjection.set(x.o); };

// Does the elastic gate protect task A while task B is learned? Slow (about a minute: gradients are
// finite differences through the settle), so it only runs with NEUROCLAW_SLOW=1.
// Conditions, all trained on B until B error <= 0.10 (or 500 steps):
//   none        no gate
//   importance  vale = 0.9 * stateDeltas/max measured on task A (the repo's own value-budget signal)
//   shuffled    the same vale numbers placed on the wrong neurons
//   uniform     no per-neuron gate, learning rate cut by the same average amount
// If importance beat the controls, protection would be about WHICH neurons are held. It does not.
describe.skipIf(!process.env.NEUROCLAW_SLOW)('Gate vs forgetting (slow)', () => {
  it('E13 the elastic gate does not protect task A better than slowing down uniformly', () => {
    const LR = 3, TARGET_B = 0.10, CHUNK = 25, MAXB = 500;
    for (let seed = 1; seed <= 3; seed++) {
      const b = mk(seed);
      const untrainedA = loss(b, xA, yA);
      train(b, xA, yA, 150, LR);
      const learnedA = loss(b, xA, yA);
      expect(learnedA).toBeLessThan(untrainedA * 0.5);
      const base = snap(b);
      const imp = importance(b, xA);
      const finalA: Record<string, number> = {};
      for (const cond of ['none', 'importance', 'shuffled', 'uniform'] as const) {
        restore(b, base);
        let vale: Map<number, number> | undefined;
        let scale = 1;
        if (cond === 'importance') vale = imp;
        if (cond === 'shuffled') {
          const vals = [...imp.values()];
          vale = new Map();
          [...imp.keys()].forEach((k, i) => vale!.set(k, vals[(i + 3) % vals.length]));
        }
        if (cond === 'uniform') scale = [...imp.values()].reduce((s, v) => s + (1 - v), 0) / imp.size;
        for (let steps = 0; steps < MAXB; steps += CHUNK) {
          train(b, xB, yB, CHUNK, LR, vale, scale);
          if (loss(b, xB, yB) <= TARGET_B) break;
        }
        finalA[cond] = loss(b, xA, yA);
      }
      // Task A ends up worse than never having learned it, with or without the gate...
      expect(finalA.none).toBeGreaterThan(untrainedA);
      expect(finalA.importance).toBeGreaterThan(untrainedA);
      // ...and choosing the "important" neurons is no better than the controls.
      expect(finalA.importance).toBeGreaterThan(finalA.uniform - 0.15);
      expect(finalA.importance).toBeGreaterThan(finalA.shuffled - 0.15);
    }
  }, 600000);
});
