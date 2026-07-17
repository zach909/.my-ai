// Guard against typo'd design-token utility classes (e.g. `bg-primry`,
// `text-forground`) that Tailwind would otherwise silently drop — no error,
// just an unstyled element, which is close to invisible in review. Flags any
// bg-/text-/border-/ring-/fill-/stroke-/from-/via-/to- class whose suffix is
// close (small edit distance) to a real design token from src/index.css but
// doesn't exactly match one. Standard Tailwind utilities (text-center,
// border-b, ring-offset-2, palette colors like bg-sky-500, arbitrary values
// like bg-[#fff]) are structurally far from any token name, so they don't
// trigger a false positive.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const TOKENS_FILE = join(ROOT, 'src', 'index.css');
const SRC_DIR = join(ROOT, 'src');
const SCAN_EXT = new Set(['.tsx', '.ts']);
const COLOR_PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'via', 'to',
  'outline', 'divide', 'accent', 'caret', 'decoration', 'placeholder'];
const MAX_DISTANCE = 2;

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

function colorTokenNames(css) {
  const block = extractBlock(css, '@theme inline');
  const names = new Set();
  if (!block) return names;
  for (const m of block.matchAll(/--color-([a-zA-Z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function closestToken(suffix, tokens) {
  let best = null;
  let bestDist = Infinity;
  for (const t of tokens) {
    const d = levenshtein(suffix, t);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return { token: best, distance: bestDist };
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
  const tokens = colorTokenNames(css);
  if (tokens.size === 0) {
    console.error('✗ no --color-* tokens found in @theme inline — is src/index.css intact?');
    process.exit(1);
  }

  const prefixAlt = COLOR_PREFIXES.join('|');
  // word-boundary-delimited utility token: prefix-suffix, suffix has no
  // further '-number' shade (bg-sky-500) or '[' (arbitrary value) immediately
  // recognizable as non-token, but we still edit-distance everything and rely
  // on distance to filter noise.
  const classRe = new RegExp(`(?:^|[\\s"'\`:])(?:${prefixAlt})-([a-zA-Z][a-zA-Z-]*)`, 'g');

  let problems = 0;
  const files = walk(SRC_DIR);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(classRe)) {
      const suffix = m[1].replace(/-$/, '');
      if (tokens.has(suffix)) continue; // exact match, fine
      const { token, distance } = closestToken(suffix, tokens);
      if (distance > 0 && distance <= MAX_DISTANCE && suffix.length > 3) {
        const line = content.slice(0, m.index).split('\n').length;
        console.error(`✗ ${file.replace(ROOT + '/', '')}:${line}: class suffix "${suffix}" ` +
          `looks like a typo of design token "${token}" (edit distance ${distance})`);
        problems++;
      }
    }
  }

  if (problems > 0) {
    console.error(`\n${problems} possible design-token typo(s) found.`);
    process.exit(1);
  }
  console.log(`✓ CSS utility classes consistent: ${tokens.size} design token(s), ` +
    `${files.length} file(s) scanned, no likely typos found.`);
}

main();
