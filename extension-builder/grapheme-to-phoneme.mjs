/**
 * grapheme-to-phoneme.mjs — a small, hand-written, rule-based English
 * grapheme-to-phoneme (G2P) converter.
 *
 * Turns spelling into an approximate ARPAbet-style pronunciation using
 * nothing but English letter-pattern rules: digraph tables, a per-letter
 * fallback, and a "magic e" check. No dictionary, no lookup table of real
 * words -- every pronunciation this produces is *derived* from the letters
 * themselves, not recalled from a stored answer.
 *
 * English spelling is not phonetic, so this is necessarily approximate:
 * common patterns (silent final "e", "th"/"sh"/"ch" digraphs, vowel teams
 * like "ee"/"oa") come out reasonably, genuinely irregular words ("colonel",
 * "yacht", "choir") will not. That tradeoff is the point here: this
 * replaces a vendored 135k-entry pronunciation dictionary (CMUDict) as the
 * training-sample source for extension-builder/build-main-network.mjs's
 * pronunciation-training demo -- approximate-but-original beats
 * exact-but-borrowed for that purpose, where the goal is exercising real
 * gradient descent on *some* non-trivial target, not linguistic accuracy.
 */

const VOWEL_DIGRAPHS = [
  ['ai', 'EY'], ['ay', 'EY'], ['ea', 'IY'], ['ee', 'IY'], ['oa', 'OW'],
  ['oo', 'UW'], ['ou', 'AW'], ['ow', 'AW'], ['oy', 'OY'], ['au', 'AO'],
  ['aw', 'AO'], ['ie', 'IY'], ['ue', 'UW'], ['ei', 'EY'], ['oe', 'OW'],
];

const CONSONANT_DIGRAPHS = [
  ['th', 'TH'], ['sh', 'SH'], ['ch', 'CH'], ['ph', 'F'], ['ck', 'K'],
  ['ng', 'NG'], ['wh', 'W'], ['qu', 'K W'],
  ['gh', ''], // silent far more often than not ("night", "though", "high")
];

const SINGLE_LETTERS = {
  a: 'AE', b: 'B', c: 'K', d: 'D', e: 'EH', f: 'F', g: 'G', h: 'HH',
  i: 'IH', j: 'JH', k: 'K', l: 'L', m: 'M', n: 'N', o: 'AA', p: 'P',
  q: 'K', r: 'R', s: 'S', t: 'T', u: 'AH', v: 'V', w: 'W', x: 'K S',
  y: 'IY', z: 'Z',
};

// "c"/"g" soften before e/i/y (cent, city, cycle; gem, gin, gym) -- an
// approximation that also mispronounces real exceptions like "get"/"give",
// acceptable for a rule engine that never claims to be exact.
const SOFTENS_C_AND_G = new Set(['e', 'i', 'y']);

const isVowelLetter = (c) => 'aeiou'.includes(c);

function stripSilentFinalE(word) {
  // "Magic e": consonant-vowel-consonant-e (make, time, hope) lengthens the
  // preceding vowel and the trailing "e" itself is silent.
  if (word.length > 3 && word.endsWith('e')) {
    const c1 = word[word.length - 2];
    const v = word[word.length - 3];
    const c2 = word[word.length - 4];
    if (!isVowelLetter(c1) && isVowelLetter(v) && !isVowelLetter(c2)) {
      return word.slice(0, -1);
    }
  }
  return word;
}

/** Derive an approximate ARPAbet-style pronunciation for an English word
 * from its spelling alone. See file header for what this is and isn't. */
export function pronounce(rawWord) {
  const word = stripSilentFinalE(String(rawWord).toLowerCase().replace(/[^a-z]/g, ''));
  if (!word) return '';

  const phones = [];
  let i = 0;
  while (i < word.length) {
    const two = word.slice(i, i + 2);
    const digraph = CONSONANT_DIGRAPHS.find(([g]) => g === two)
      ?? VOWEL_DIGRAPHS.find(([g]) => g === two);
    if (digraph) {
      if (digraph[1]) phones.push(digraph[1]);
      i += 2;
      continue;
    }

    const ch = word[i];
    const next = word[i + 1];
    if (ch === 'c' && next && SOFTENS_C_AND_G.has(next)) {
      phones.push('S');
    } else if (ch === 'g' && next && SOFTENS_C_AND_G.has(next)) {
      phones.push('JH');
    } else if (SINGLE_LETTERS[ch]) {
      phones.push(SINGLE_LETTERS[ch]);
    }
    i += 1;
  }
  return phones.join(' ');
}
