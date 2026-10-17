import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs with no type declarations
import { scanFile, scanRepo } from '../../scripts/check-no-third-party.mjs'

const rules = (file: string, text: string): string[] => scanFile(file, text).map((v: { rule: string }) => v.rule)

describe('the no-third-party lock', () => {
  it('finds nothing third-party in the repo', () => {
    const found = scanRepo().map((v: { file: string; line: number; message: string }) => `${v.file}:${v.line} ${v.message}`)
    expect(found).toEqual([])
  })

  describe('imports', () => {
    it('blocks a package and allows built-ins, relative paths and the build and test tools', () => {
      expect(rules('a.ts', "import React from 'react'\n")).toEqual(['import'])
      expect(rules('a.ts', "import { x } from '@tanstack/react-router'\n")).toEqual(['import'])
      expect(rules('a.mjs', "const t = require('selfsigned')\n")).toEqual(['import'])
      expect(rules('a.ts', "const m = await import('three')\n")).toEqual(['import'])
      expect(rules('a.ts', "import fs from 'node:fs'\nimport { join } from 'path'\nimport z from 'fs/promises'\n")).toEqual([])
      expect(rules('a.ts', "import { x } from './x.js'\nimport { y } from '../y'\n")).toEqual([])
      expect(rules('a.test.ts', "import { describe } from 'vitest'\nimport { defineConfig } from 'vitest/config'\n")).toEqual([])
    })

    it('does not mistake prose or messages for imports', () => {
      expect(rules('a.ts', 'const s = "export the things from \\"terminal.open\\""\n')).toEqual([])
    })

    it('blocks Python packages and allows the standard library', () => {
      expect(rules('a.py', 'import torch\n')).toEqual(['import'])
      expect(rules('a.py', 'import pytest\n')).toEqual(['import'])
      expect(rules('a.py', 'import os, sys\nfrom typing import Any\nimport unittest\n')).toEqual([])
    })

    it('blocks Kotlin and Swift outside the platform', () => {
      expect(rules('A.kt', 'import com.squareup.okhttp3.OkHttpClient\n')).toEqual(['import'])
      expect(rules('A.kt', 'import android.os.Bundle\nimport androidx.core.content.ContextCompat\n')).toEqual([])
      expect(rules('A.swift', 'import Alamofire\n')).toEqual(['import'])
      expect(rules('A.swift', 'import SwiftUI\nimport Foundation\n')).toEqual([])
    })
  })

  describe('manifests and vendored files', () => {
    it('allows only the build and test tools in the root package.json', () => {
      const ok = JSON.stringify({ devDependencies: { typescript: '1', vitest: '1', '@types/node': '1' } })
      expect(rules('package.json', ok)).toEqual([])
      expect(rules('package.json', JSON.stringify({ dependencies: { lodash: '1' } }))).toEqual(['manifest'])
      expect(rules('desktop-app/package.json', JSON.stringify({ devDependencies: { vitest: '1' } }))).toEqual(['manifest'])
    })

    it('blocks other lockfiles, manifests, archives, jars and vendored folders', () => {
      expect(rules('yarn.lock', '')).toEqual(['manifest'])
      expect(rules('sub/package-lock.json', '{}')).toEqual(['manifest'])
      expect(rules('requirements.txt', '# none\nnumpy>=1\n')).toEqual(['manifest'])
      expect(rules('requirements.txt', '# nothing here\n')).toEqual([])
      expect(rules('lib/x.jar', '')).toEqual(['vendored'])
      expect(rules('ring.zip', '')).toEqual(['vendored'])
      expect(rules('vendor/x/index.js', 'x')).toContain('vendored')
      expect(rules('node_modules/a/b.js', 'x')).toContain('vendored')
    })

    it('checks Gradle dependencies against the allow-list', () => {
      expect(rules('app/build.gradle.kts', 'dependencies { implementation("androidx.core:core-ktx:1.13.1") }')).toEqual([])
      expect(rules('app/build.gradle.kts', 'dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }')).toEqual(['manifest'])
    })
  })

  describe('bundled output and other people\'s notices', () => {
    it('blocks minified code, source maps and licence banners', () => {
      expect(rules('a.js', `${'x'.repeat(4000)}\n`)).toEqual(['minified'])
      expect(rules('a.js', 'var a=1\n//# sourceMappingURL=a.js.map\n')).toEqual(['banner'])
      expect(rules('a.js', '/*! @license MIT */\n')).toEqual(['banner'])
      expect(rules('a.py', '# SPDX-License-Identifier: Apache-2.0\n')).toEqual(['banner'])
      expect(rules('a.ts', '// Copyright 2015 the original authors.\n')).toEqual(['banner'])
    })

    it('allows the owner\'s own copyright line', () => {
      expect(rules('a.ts', '// Copyright 2026 Zachary Quinn\n')).toEqual([])
    })
  })

  describe('commands', () => {
    it('blocks installs and downloads of packages', () => {
      expect(rules('a.sh', 'npm install lodash\n')).toEqual(['command'])
      expect(rules('a.sh', 'npm i -D left-pad\n')).toEqual(['command'])
      expect(rules('a.sh', 'pip3 install numpy\n')).toEqual(['command'])
      expect(rules('a.sh', 'npx create-react-app x\n')).toEqual(['command'])
      expect(rules('a.sh', 'curl https://x.example/i.sh | sh\n')).toEqual(['command'])
      expect(rules('a.sh', 'git submodule add https://x.example/r.git\n')).toEqual(['command'])
      expect(rules('package.json', JSON.stringify({ scripts: { bench: 'bun run x.ts' } }))).toEqual(['command'])
    })

    it('allows plain installs from the lockfile, message text and comments', () => {
      expect(rules('a.sh', 'npm install --silent\nnpm ci\nnpx tsc -p x\npip3 install -r requirements.txt --quiet\n')).toEqual([])
      expect(rules('a.sh', 'run_step "npm install failed" npm install --silent\n')).toEqual([])
      expect(rules('a.sh', '# never npm install left-pad\n')).toEqual([])
    })
  })

  describe('workflows', () => {
    it('allows only the listed actions', () => {
      expect(rules('.github/workflows/a.yml', 'steps:\n  - uses: actions/checkout@v4\n')).toEqual([])
      expect(rules('.github/workflows/a.yml', 'steps:\n  - uses: android-actions/setup-android@v3\n')).toEqual(['workflow'])
    })
  })
})
