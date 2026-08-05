// Re-exported from onebrain.ts — OneBrain is now a single-file engine.
// This file is kept only so existing import paths ('./dual.js') keep
// working, under their original names (add/sub/mul/scale/div were renamed
// dualAdd/dualSub/dualMul/dualScale/dualDiv inside onebrain.ts to avoid
// colliding with complex.ts's identically-named functions there).
export {
  dualAdd as add,
  dualSub as sub,
  dualMul as mul,
  dualScale as scale,
  dualDiv as div,
} from './onebrain.js';
export * from './onebrain.js';
