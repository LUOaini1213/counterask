import { readFileSync } from 'node:fs';
import { Catalog, decide } from '../public/engine.js';

const payload = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const cat = new Catalog(payload);
console.log(`catalog: ${cat.N} items · facets: ${cat.meta.facets.join(', ')}\n`);

function run(q, constraints = {}, asks = 0) {
  const scored = cat.search(q, constraints);
  const d = decide(cat, scored, constraints, asks);
  console.log(`"${q}"  ${JSON.stringify(constraints)}`);
  console.log(`  -> ${d.action.toUpperCase()}  pool=${d.pool.length}`);
  if (d.action === 'ask') console.log(`     Q: ${d.question}`);
  if (d.action === 'answer') scored.slice(0, 3).forEach((s, i) => console.log(`     ${i + 1}. ${s.item.t.slice(0, 62)}`));
  d.reasons.forEach((r) => console.log(`     · ${r}`));
  console.log();
}
run('belt');
run('leather belt');
run('leather belt', { material: ['leather'], closure: ['buckle'] });
run('running shoes');
run('waterproof hiking boots');
run('wallet');
