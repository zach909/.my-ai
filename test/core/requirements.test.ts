/**
 * The requirements file, and the claim it makes.
 *
 * Corona's neural network is an all-to-all mesh implemented directly, in both
 * TypeScript and Python, on nothing but the standard library. The root
 * requirements.txt says so and declares no packages, which means a default
 * install downloads nothing.
 *
 * That claim is only worth making if it stays true, and it is exactly the kind
 * of claim that rots: someone adds `import numpy` to the mesh for one
 * convenience, and the file quietly becomes a lie that costs every future
 * installer 2.5GB of PyTorch. So it is checked rather than asserted in a
 * comment -- which is what the previous version did, and it was wrong.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const MESH = 'asi_core/neural_mesh.py'

/** Lines that actually declare a package, ignoring comments and blanks. */
function declaredPackages(file: string): string[] {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

describe('the default install', () => {
  it('has a requirements.txt at all, since install.sh looks for one there', () => {
    // Without it the installer's pip step is skipped silently, which is an
    // accident that happens to be harmless rather than a decision.
    expect(existsSync(path.join(ROOT, 'requirements.txt'))).toBe(true)
  })

  it('declares no packages', () => {
    expect(declaredPackages('requirements.txt')).toEqual([])
  })

  it('explains why it is empty, rather than looking forgotten', () => {
    const text = readFileSync(path.join(ROOT, 'requirements.txt'), 'utf8')
    expect(text).toMatch(/standard library/i)
    expect(text).toMatch(/asi_core\/neural_mesh\.py/)
  })
})

describe('the mesh really does run on the standard library', () => {
  it('imports with site-packages disabled', () => {
    // -S is what makes this proof rather than assertion: it removes every
    // installed package, so an accidental third-party import cannot hide.
    const out = execFileSync(
      'python3',
      [
        '-S',
        '-c',
        `import importlib.util, sys; sys.path.insert(0, ${JSON.stringify(ROOT)}); ` +
          `s = importlib.util.spec_from_file_location('m', ${JSON.stringify(path.join(ROOT, MESH))}); ` +
          `m = importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.NeuralMesh.__name__)`,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )
    expect(out.trim()).toBe('NeuralMesh')
  })

  it('imports nothing outside the standard library', () => {
    const source = readFileSync(path.join(ROOT, MESH), 'utf8')
    const imported = [...source.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][\w.]*)/gm)].map(m => m[1].split('.')[0])
    const stdlib = new Set([
      'math', 'time', 'random', 'dataclasses', 'typing', 'enum', 'json', 'os', 'sys',
      'collections', 'itertools', 'functools', 're', 'abc', 'copy', '__future__',
    ])
    const outside = [...new Set(imported)].filter(name => !stdlib.has(name))
    expect(outside, `${MESH} imports non-stdlib: ${outside.join(', ')}`).toEqual([])
  })
})

describe('the heavy tiers stay opt-in', () => {
  it('keeps torch out of the default install', () => {
    const all = declaredPackages('requirements.txt').join(' ')
    expect(all).not.toMatch(/torch|transformers|numpy/i)
  })

  it('still declares torch where it is genuinely needed', () => {
    // The Python mesh track (neurolang.py, the value system) uses tensors.
    // Making the default install empty must not mean pretending it has no
    // needs. The TinyGPT transformer that used to live here is gone -- torch
    // is still declared, for the track that genuinely still uses it.
    expect(declaredPackages('model && skills manager/requirements.txt').join(' ')).toMatch(/torch/)
  })

  it('no longer claims torch is what the all-to-all mesh needs', () => {
    const text = readFileSync(path.join(ROOT, 'model && skills manager/requirements.txt'), 'utf8')
    expect(text).not.toMatch(/all the canonical all-to-all mesh needs/)
  })
})
