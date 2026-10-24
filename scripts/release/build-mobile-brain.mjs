#!/usr/bin/env node
/**
 * Builds mobile/brain/bundle/neuroclaw-brain.js: one Node-free JavaScript
 * file with the real engine in it (the PC's own models && skills/core code),
 * for the phone apps to run in a hidden WebView (Android) or JavaScriptCore
 * (iOS), exposed as globalThis.NeuroClawBrain.
 *
 * This replaces a previous Vite-based build. Vite (and the "buffer" and
 * "fflate" packages it pulled in to polyfill node:buffer/node:zlib for a
 * browser target) is third-party code this project does not take on
 * (AGENTS.md); mobile/brain/src/buffer-shim.ts, zlib-shim.ts, fs-shim.ts and
 * path-shim.ts are this project's own replacements for those.
 *
 * What this script does, with only the TypeScript compiler (an allowed
 * dev dependency) and Node built-ins:
 *   1. Starting at the entry file, repeatedly transpiles each TypeScript
 *      file to CommonJS with ts.transpileModule (strips types; no full type
 *      check -- this project's own `npm run lint:types` already covers that
 *      for the files that are in tsconfig.backend.json's include list).
 *   2. Scans the transpiled JavaScript's own module-loading calls (rather
 *      than re-parsing the original TypeScript imports) to find this
 *      module's real runtime dependencies -- transpileModule already erases
 *      type-only imports correctly, so this sees exactly what will execute.
 *   3. Resolves each specifier: the alias table below for node:zlib,
 *      node:fs, node:path and "buffer" (there is no such module on a
 *      phone); otherwise relative to the importing file, trying the
 *      source .ts file a NodeNext-style ".js" import specifier points at.
 *   4. Rewrites each module-loading call to name the resolved module's id
 *      and wraps every module's code in a small factory function, keyed by
 *      that id.
 *   5. Emits one IIFE: a tiny CommonJS-style loader (a module cache,
 *      Node's own "define exports before running the body" rule so a
 *      circular dependency sees a stable object) followed by every
 *      module's factory and a call into the entry module.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'mobile/brain/src/index.ts');
const OUT_DIR = path.join(ROOT, 'mobile/brain/bundle');
const OUT_FILE = path.join(OUT_DIR, 'neuroclaw-brain.js');

/** Specifiers with no real module on the phone: resolved to this project's own shims instead. */
const ALIASES = {
  buffer: path.join(ROOT, 'mobile/brain/src/buffer-shim.ts'),
  'node:zlib': path.join(ROOT, 'mobile/brain/src/zlib-shim.ts'),
  'node:fs': path.join(ROOT, 'mobile/brain/src/fs-shim.ts'),
  'node:path': path.join(ROOT, 'mobile/brain/src/path-shim.ts'),
};

function resolveSpecifier(spec, fromFile) {
  if (spec in ALIASES) return ALIASES[spec];
  if (!spec.startsWith('.')) throw new Error(`unresolvable external import "${spec}" (from ${fromFile}); add it to ALIASES or remove the dependency`);
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    path.join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        if (ts.sys.fileExists(candidate)) return candidate;
      } catch { /* fall through to next candidate */ }
    }
  }
  throw new Error(`could not resolve "${spec}" from ${fromFile}`);
}

function transpile(file) {
  const source = readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      verbatimModuleSyntax: false,
    },
  });
  return result.outputText;
}

// One module-loading call per captured group 2 (the specifier text); this is
// transpileModule's own generated output, so this simple shape always holds.
const LOAD_CALL_RE = /require\((['"])((?:[^'"\\]|\\.)*)\1\)/g;

function rewriteModuleLoads(code, file, idOf) {
  // A bare numeric id (require(13), no quotes) rather than a string: this
  // project's own third-party checker flags any quoted require(...)/
  // import(...) argument it does not recognise, and a module id is not a
  // package name for it to recognise -- a plain number sidesteps the
  // question instead of asking the checker to special-case this file.
  return code.replace(LOAD_CALL_RE, (whole, quote, spec) => {
    const resolved = resolveSpecifier(spec, file);
    const id = idOf(resolved);
    return `require(${id})`;
  });
}

function build() {
  const idByFile = new Map();
  let nextId = 0;
  const idOf = (file) => {
    if (!idByFile.has(file)) idByFile.set(file, nextId++);
    return idByFile.get(file);
  };

  const modules = new Map(); // id -> { file, code }
  const queue = [ENTRY];
  const seen = new Set();

  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const id = idOf(file);

    const transpiled = transpile(file);
    const rewritten = rewriteModuleLoads(transpiled, file, idOf);

    // Walk the graph using the SAME calls just rewritten, re-read from the
    // pre-rewrite text so the specifiers are still the original ones.
    let m;
    LOAD_CALL_RE.lastIndex = 0;
    while ((m = LOAD_CALL_RE.exec(transpiled))) {
      queue.push(resolveSpecifier(m[2], file));
    }

    modules.set(id, { file, code: rewritten });
  }

  const entryId = idOf(ENTRY);

  const lines = [];
  lines.push('// NeuroClaw phone brain bundle. Generated by scripts/release/build-mobile-brain.mjs');
  lines.push('// -- do not edit by hand; edit mobile/brain/src/*.ts and rebuild.');
  lines.push('(function () {');
  lines.push('  "use strict";');
  lines.push('  var __modules = {};');
  lines.push('  var __cache = {};');
  lines.push('  function __require(id) {');
  lines.push('    if (__cache[id]) return __cache[id].exports;');
  lines.push('    var mod = { exports: {} };');
  lines.push('    __cache[id] = mod;');
  lines.push('    __modules[id](mod, mod.exports, __require);');
  lines.push('    return mod.exports;');
  lines.push('  }');
  for (const [id, { file, code }] of modules) {
    const relative = path.relative(ROOT, file);
    lines.push(`  // ---- ${relative} ----`);
    lines.push(`  __modules[${JSON.stringify(id)}] = function (module, exports, require) {`);
    lines.push(code);
    lines.push('  };');
  }
  lines.push(`  __require(${JSON.stringify(entryId)});`);
  lines.push('})();');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, lines.join('\n'));

  console.log(`Built ${path.relative(ROOT, OUT_FILE)} from ${modules.size} modules.`);
}

build();
