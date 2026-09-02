// Policy and retrieval measurement.
//
// Changing a stopping rule by feel is how you end up with a store that asks
// three questions about a wallet. This prints the numbers a change has to
// move: which branch of decide() fires, how big the pools are, how long a
// query takes, and how often the query's own words are being thrown away.

import { readFileSync } from 'node:fs';
import { Catalog, decide, separation, tokenize, extractConstraints, POLICY } from '../public/engine.js';

const payload = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const cat = new Catalog(payload);

// Queries a shopper would actually type, across specific -> vague.
export const QUERIES = [
  'belt', 'leather belt', 'black leather dress belt', 'ratchet belt',
  'wallet', 'rfid wallet', 'slim leather wallet',
  'running shoes', 'waterproof hiking boots', 'dress shoes', 'loafers',
  'sneakers', 'work boots', 'sandals',
  't-shirt', 'cotton t shirt', 'long sleeve shirt', 'dress shirt',
  'flannel shirt', 'polo shirt', 'hoodie', 'wool sweater', 'fleece jacket',
  'winter coat', 'rain jacket', 'puffer jacket',
  'jeans', 'slim fit jeans', 'chinos', 'cargo pants', 'shorts', 'swim trunks',
  'socks', 'wool socks', 'boxer briefs', 'pajamas',
  'watch', 'leather watch', 'sunglasses', 'baseball cap', 'beanie',
  'backpack', 'duffel bag', 'gym shorts', 'athletic socks',
  'tie', 'bow tie', 'suspenders', 'gloves', 'scarf',
];

function branchOf(d) {
  if (d.action === 'empty') return 'empty';
  if (d.action === 'ask') return 'ask';
  const r = (d.reasons || []).join(' ');
  if (r.includes('small enough')) return 'answer:small-pool';
  if (r.includes('clear of the runner-up')) return 'answer:clear-leader';
  if (r.includes('Already asked')) return 'answer:budget';
  if (r.includes('meaningfully reorder')) return 'answer:no-good-question';
  return 'answer:other';
}

export function run(queries = QUERIES, { verbose = false } = {}) {
  const branches = new Map();
  const pools = [];
  const seps = [];
  let totalMs = 0;
  let droppedTerms = 0;
  let totalTerms = 0;
  const rows = [];

  for (const q of queries) {
    const t0 = performance.now();
    // Same path the app takes: what the shopper already said is known.
    const stated = extractConstraints(q, cat.facetValues, cat.facetForms);
    const scored = cat.search(q, stated);
    const d = decide(cat, scored, stated, 0);
    totalMs += performance.now() - t0;

    const b = branchOf(d);
    branches.set(b, (branches.get(b) || 0) + 1);
    pools.push(d.pool.length);
    seps.push(separation(scored));

    // How much of what the shopper typed actually reached a candidate?
    // Compare like with like: the engine matches stemmed tokens, so the
    // question is how many of the *normalised* terms reached the top hit.
    const terms = tokenize(q);
    const used = new Set(scored[0]?.matched ?? []);
    totalTerms += terms.length;
    droppedTerms += terms.filter((t) => !used.has(t)).length;

    rows.push({ q, pool: d.pool.length, branch: b, sep: separation(scored) });
  }

  pools.sort((a, b) => a - b);
  const median = pools[Math.floor(pools.length / 2)];
  const p90 = pools[Math.floor(pools.length * 0.9)];

  const summary = {
    queries: queries.length,
    askRate: `${((branches.get('ask') || 0) / queries.length * 100).toFixed(0)}%`,
    poolMedian: median,
    poolP90: p90,
    poolMax: pools[pools.length - 1],
    emptyResults: branches.get('empty') || 0,
    sepMedian: +(seps.slice().sort((a, b) => a - b)[Math.floor(seps.length / 2)]).toFixed(3),
    sepAbove18pct: seps.filter((s) => s >= POLICY.decisiveSeparation).length,
    unmatchedQueryTerms: `${(100 * droppedTerms / Math.max(totalTerms, 1)).toFixed(0)}%`,
    msPerQuery: +(totalMs / queries.length).toFixed(2),
  };

  if (verbose) {
    console.table([...branches.entries()].map(([branch, n]) => ({ branch, n })));
    console.log('\nworst pools:');
    for (const r of rows.sort((a, b) => b.pool - a.pool).slice(0, 8)) {
      console.log(`  ${String(r.pool).padStart(4)}  ${r.branch.padEnd(24)} ${r.q}`);
    }
    console.log('\nempty / near-empty:');
    for (const r of rows.filter((r) => r.pool <= 2)) console.log(`  ${String(r.pool).padStart(4)}  ${r.q}`);
  }
  return summary;
}

if (process.argv[1]?.endsWith('eval.mjs')) {
  console.log(run(QUERIES, { verbose: true }));
}
