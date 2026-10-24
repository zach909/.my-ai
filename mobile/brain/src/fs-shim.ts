/**
 * A stand-in for node:fs on the phone, where there is no node:fs.
 *
 * The engine code that reaches the phone bundle (models && skills/core/
 * net-skill-accuracy.ts's SkillAccuracyLedger, models && skills/core/
 * atomic-write.ts) only touches these functions through a `save()`/`load()`
 * path that is gated on a `file` path being set -- and the phone's
 * PhoneBrain never sets one (see mobile/brain/src/index.ts), so none of
 * these are ever actually called there. They exist only so the module graph
 * resolves at bundle time; each throws plainly if that assumption is ever
 * wrong, rather than silently doing nothing.
 */
function unavailable(name: string): never {
  throw new Error(`node:fs.${name} is not available on this platform (the phone brain keeps no on-disk state)`);
}

export function existsSync(): boolean { return false; }
export function mkdirSync(): void { unavailable("mkdirSync"); }
export function readFileSync(): never { unavailable("readFileSync"); }
export function readdirSync(): never { unavailable("readdirSync"); }
export function renameSync(): void { unavailable("renameSync"); }
export function rmSync(): void { unavailable("rmSync"); }
export function statSync(): never { unavailable("statSync"); }
export function writeSync(): never { unavailable("writeSync"); }
export function openSync(): never { unavailable("openSync"); }
export function closeSync(): void { unavailable("closeSync"); }
export function fsyncSync(): void { unavailable("fsyncSync"); }
