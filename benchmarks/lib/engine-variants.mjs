// Shared by the experiment scripts: build the engine with config overrides and, optionally,
// keep only a fraction of the connections (a sparse mesh made by zeroing weights).
//
//   --engine '{"waveGain":0}'   merged over the script's own config
//   --density 0.5               keep this fraction of the connDiag / connShift weights (seeded mask)
//
// Density 1 (the default) touches nothing. The mask is applied once, after construction; the
// scripts that use it read the mesh without learning, so the zeros stay zero.
export function parseVariant(args) {
  const opt = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : f; };
  return { engineOverrides: JSON.parse(opt('engine', '{}')), density: Number(opt('density', 1)) };
}

export function applyDensity(engine, density, seed) {
  if (density >= 1) return { kept: 1 };
  let a = (seed * 2654435761) >>> 0;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = engine.getNeuronCount(), D = engine.getDimensions() + 1;
  let kept = 0, total = 0;
  // Keep a connection (sender j -> receiver i) for every dimension together, so a "connection" is whole.
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    total++;
    if (rand() < density) { kept++; continue; }
    for (let d = 0; d < D; d++) { engine.connDiag[i * D * N + d * N + j] = 0; engine.connShift[i * D * N + d * N + j] = 0; }
  }
  return { kept: kept / total };
}
