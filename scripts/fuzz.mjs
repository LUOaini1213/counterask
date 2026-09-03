// Sentences nobody wrote, by the thousand.
//
// parse_test.mjs pins down sentences a person thought of. This builds ones
// nobody did — fragments from every pass of the parser, in random order and
// random number — and checks the two things that must hold for every one of
// them: the parser never throws, and a refused value never comes back as a
// requirement. It also reports how often each pass fired, so a pass that
// silently stopped matching shows up as a number, not as a missing failure.
//
// Borrowed as an idea from the parallel implementation on the cuizi-rewrite
// branch, rewritten against this parser.
//
//   node scripts/fuzz.mjs            # 4000 sentences, seeded
//   node scripts/fuzz.mjs 20000 7    # count, seed

import { readFileSync } from 'node:fs';
import { Catalog, parseRequest } from '../public/engine.js';
import { mulberry32 } from './bench.mjs';

const cat = new Catalog(JSON.parse(
  readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8')));

const PRODUCTS = ['belt', 'wallet', 'running shoes', 'dress shirt', 'hoodie', 'wool socks', 'hiking boots', 'jeans', 'watch', 'sunglasses', 'a jacket', 'some shorts'];
const FILLER = ["I'm looking for", 'find me', 'do you have', 'show me', 'can you recommend', 'I need', 'what about', 'any chance you have'];
const TAIL = ['please', 'for my brother', 'for work', 'for the weekend', 'for a wedding', 'thanks', 'ideally', 'for my dad\'s birthday'];
const BUDGET = ['under $40', 'between 20 and 30 dollars', 'not over $50', 'around $25', 'for less than 60 bucks', 'max $35', 'I have 40 dollars to spend', '$20-$30', 'over $100'];
const SORT = ['cheapest', 'best rated', 'most popular', 'cheap'];
const WAVE = ['any material is fine', "fit doesn't matter", 'no preference on closure', 'whatever fabric works', "I don't mind the sleeves"];
const NEG = ['not', 'no', 'without', 'nothing with', "I don't want", 'skip the', 'avoid', 'anything but', 'other than'];
const forms = [];
for (const [facet, values] of Object.entries(cat.facetForms ?? {})) {
  for (const [value, list] of Object.entries(values)) for (const form of list) forms.push({ facet, value, form });
}
const WORDS = ['nike', 'hood', 'logo', 'stripes', 'laces', 'snap', 'zip', 'blue', 'thick'];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function compose(rng) {
  const parts = [];
  const truth = { refused: [] };
  const fired = new Set();
  if (rng() < 0.7) { parts.push(pick(rng, FILLER)); fired.add('filler'); }
  parts.push(pick(rng, PRODUCTS));
  const n = Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (r < 0.3) { const f = pick(rng, forms); parts.push(f.form); fired.add('stated'); }
    else if (r < 0.55) {
      const f = pick(rng, forms);
      parts.push(`${pick(rng, NEG)} ${f.form}`);
      truth.refused.push(f);
      fired.add('refusal');
    } else if (r < 0.7) { parts.push(`${pick(rng, NEG)} ${pick(rng, WORDS)}`); fired.add('refusal-word'); }
    else if (r < 0.85) { parts.push(pick(rng, BUDGET)); fired.add('budget'); }
    else if (r < 0.93) { parts.push(pick(rng, WAVE)); fired.add('waved'); }
    else { parts.push(pick(rng, SORT)); fired.add('sort'); }
  }
  if (rng() < 0.5) { parts.push(pick(rng, TAIL)); fired.add('tail'); }
  // Random joiners: commas, dashes, nothing.
  const joiners = [', ', ' ', ' — ', ' and ', '; '];
  let s = parts[0];
  for (let i = 1; i < parts.length; i++) s += pick(rng, joiners) + parts[i];
  if (rng() < 0.3) s = s.toUpperCase();
  return { sentence: s, truth, fired };
}

export function fuzz({ n = 4000, seed = 2026 } = {}) {
  const rng = mulberry32(seed);
  const counts = { threw: 0, inverted: 0, emptyQuery: 0 };
  const fired = {};
  const read = { budget: 0, refusal: 0, stated: 0, waved: 0, sort: 0 };
  const failures = [];
  for (let i = 0; i < n; i++) {
    const { sentence, truth, fired: f } = compose(rng);
    for (const k of f) fired[k] = (fired[k] || 0) + 1;
    let out;
    try {
      out = parseRequest(sentence, cat);
    } catch (err) {
      counts.threw++;
      if (failures.length < 8) failures.push({ sentence, error: String(err) });
      continue;
    }
    if (out.budget) read.budget++;
    if (Object.keys(out.exclude).length || out.excludeTerms.length) read.refusal++;
    if (Object.keys(out.constraints).length) read.stated++;
    if (out.noPreference.length) read.waved++;
    if (out.sort !== 'relevance') read.sort++;
    if (!out.query && !Object.keys(out.constraints).length && !Object.keys(out.exclude).length) counts.emptyQuery++;
    // A refusal that came back as a requirement, without the parser having
    // flagged the collision: the one thing that must never happen.
    for (const r of truth.refused) {
      const clash = out.conflicts.some((c) => c.facet === r.facet && c.value === r.value);
      if (out.constraints[r.facet]?.includes(r.value) && !clash) {
        counts.inverted++;
        if (failures.length < 8) failures.push({ sentence, inverted: `${r.facet}=${r.value}` });
      }
    }
  }
  return { n, counts, fired, read, failures };
}

if (/[\\/]fuzz\.mjs$/.test(process.argv[1] ?? '')) {
  const n = Number(process.argv[2]) || 4000;
  const seed = Number(process.argv[3]) || 2026;
  const r = fuzz({ n, seed });
  console.log(`${r.n} sentences, seed ${seed}`);
  console.log('  never threw:', r.counts.threw === 0 ? 'yes' : `NO — ${r.counts.threw}`);
  console.log('  refusal inverted into a requirement:', r.counts.inverted);
  console.log('  read as nothing at all:', r.counts.emptyQuery);
  console.log('  passes fired (composed → read):',
    Object.entries(r.read).map(([k, v]) => `${k} ${v}`).join(', '));
  for (const f of r.failures) console.log('  FAIL', JSON.stringify(f));
  if (r.counts.threw || r.counts.inverted) process.exitCode = 1;
}
