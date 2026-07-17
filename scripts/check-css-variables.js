// Guard the app's single design-tokens file (src/index.css: "THE ONLY
// design-tokens file... No other file. No second config file, no component
// edits.") against drift: every `var(--token)` used anywhere in src/ must
// actually be defined there, and :root / .dark must define the same token
// set — a token added to one and forgotten in the other silently breaks
// theming instead of failing a build.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const TOKENS_FILE = join(ROOT, 'src', 'index.css');
const SRC_DIR = join(ROOT, 'src');
const SCAN_EXT = new Set(['.ts', '.tsx', '.css']);

function extractBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  let depth = 0;
  let i = css.indexOf('{', start);
  const bodyStart = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(bodyStart, i);
    }
  }
  return null;
}

function extractDefinedTokens(block) {
  if (!block) return new Set();
  const tokens = new Set();
  for (const m of block.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) tokens.add(m[1]);
  return tokens;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(abs, out);
    } else if (SCAN_EXT.has(extname(entry))) {
      out.push(abs);
    }
  }
  return out;
}

function main() {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  const rootTokens = extractDefinedTokens(extractBlock(css, ':root'));
  const darkTokens = extractDefinedTokens(extractBlock(css, '.dark'));
  const themeTokens = extractDefinedTokens(extractBlock(css, '@theme inline'));
  // A token is "defined" if :root declares it directly, or @theme inline
  // aliases it (e.g. --radius-sm: calc(var(--radius) - 4px)).
  const defined = new Set([...rootTokens, ...themeTokens]);

  let problems = 0;

  // 1. :root / .dark parity — every themeable color token should exist in
  // both palettes (radius/font/shadow tokens are palette-independent and
  // intentionally live only in :root, so only compare the overlap).
  const paletteLike = (t) => rootTokens.has(t) && !['radius', 'font-sans', 'font-serif',
    'font-mono', 'shadow-sm', 'shadow-md', 'shadow-lg'].includes(t);
  for (const t of rootTokens) {
    if (paletteLike(t) && !darkTokens.has(t)) {
      console.error(`✗ --${t} is defined in :root but missing from .dark`);
      problems++;
    }
  }
  for (const t of darkTokens) {
    if (!rootTokens.has(t)) {
      console.error(`✗ --${t} is defined in .dark but missing from :root`);
      problems++;
    }
  }

  // 2. every var(--token) reference anywhere in src/ must be defined
  const files = walk(SRC_DIR);
  const usageRe = /var\(\s*--([a-zA-Z0-9-]+)/g;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(usageRe)) {
      const token = m[1];
      if (!defined.has(token)) {
        const line = content.slice(0, m.index).split('\n').length;
        console.error(`✗ ${file.replace(ROOT + '/', '')}:${line}: var(--${token}) is not defined in src/index.css`);
        problems++;
      }
    }
  }

  if (problems > 0) {
    console.error(`\n${problems} CSS variable problem(s) found.`);
    process.exit(1);
  }
  console.log(`✓ CSS variables consistent: ${defined.size} token(s) defined, ` +
    `${files.length} file(s) scanned, :root/.dark palettes match.`);
}

main();
