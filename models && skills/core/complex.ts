// Re-exported from onebrain.ts — OneBrain is now a single-file engine.
// This file is kept only so existing import paths ('./complex.js') keep
// working, under their original names (add/sub/mul/scale/div were renamed
// complexAdd/complexSub/complexMul/complexScale/complexDiv inside onebrain.ts
// to avoid colliding with dual.ts's identically-named functions there).
export {
  complexAdd as add,
  complexSub as sub,
  complexMul as mul,
  complexScale as scale,
  complexDiv as div,
} from './onebrain.js';
export * from './onebrain.js';
