/**
 * Things about the repository itself that must stay true.
 *
 * These are not unit tests of behaviour -- they are guards against a specific
 * class of accident that already happened once and cost 608 MB and a broken
 * clone for everyone.
 *
 * The `git clone` that used to sit at the top of scripts/install.sh ran on
 * every source, cloning the repository into whatever directory was current.
 * That produced a full copy of the repo inside itself, which was then
 * committed as a gitlink (mode 160000) with no .gitmodules -- so every fresh
 * clone got a submodule entry git had no way to populate.
 *
 * Nothing in the test suite noticed, because nothing was testing the shape of
 * the repository.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

function git(...args: string[]): string {
  // 64MB: this repository's tracked file list exceeds the 1MB default, and the
  // failure mode is ENOBUFS rather than anything that names the real problem.
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

describe('the repository does not contain itself', () => {
  it('tracks no gitlink (mode 160000) without a .gitmodules to explain it', () => {
    const gitlinks = git('ls-files', '-s')
      .split('\n')
      .filter(line => line.startsWith('160000'))
      .map(line => line.split('\t')[1])

    if (gitlinks.length > 0) {
      // A real submodule is fine; an unexplained one is the accident.
      expect(existsSync(path.join(ROOT, '.gitmodules')), `gitlinks with no .gitmodules: ${gitlinks.join(', ')}`).toBe(true)
      const declared = readFileSync(path.join(ROOT, '.gitmodules'), 'utf8')
      for (const link of gitlinks) expect(declared).toContain(link)
    }
    expect(gitlinks.filter(l => /(^|\/)\.my-ai$/.test(l))).toEqual([])
  })

  it('ignores a clone of itself, so the accident cannot be committed again', () => {
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.my-ai\/?$/m)
  })

  it('tracks no nested copy of ITSELF', () => {
    // Nested sub-projects are legitimate here (desktop-app, the model manager
    // UI, a vendored Go dependency). What must never appear is a package.json
    // carrying THIS package's own name, which is what a clone of the repo
    // inside the repo looks like from the index.
    const own = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name
    const copies = git('ls-files')
      .split('\n')
      .filter(f => /\/package\.json$/.test(f) && !f.includes('node_modules/'))
      .filter(f => {
        try {
          return JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')).name === own
        } catch {
          return false
        }
      })
    expect(copies, 'a package.json with this repo\'s own name means a copy of it got committed').toEqual([])
  })
})

describe('the installer cannot recreate it', () => {
  it('has no top-level git clone in install.sh', () => {
    const installer = readFileSync(path.join(ROOT, 'scripts/install.sh'), 'utf8')
    // Column zero: the clone inside fetch_source() is indented and correct.
    expect(installer).not.toMatch(/^git clone/m)
  })

  it('clones into a named directory rather than wherever it happens to be run', () => {
    const installer = readFileSync(path.join(ROOT, 'scripts/install.sh'), 'utf8')
    const clone = installer.match(/git clone [^\n]*/)?.[0] ?? ''
    expect(clone, 'install.sh should clone into an explicit target directory').toMatch(/\$REPO_DIR/)
  })
})
