// Policy behaviour on the sample queries, through the production path: the
// sentence parser first, then retrieval, then the stopping policy.
import { readFileSync } from 'node:fs';
import { Catalog, decide, parseRequest } from '../public/engine.js';

const payload = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const cat = new Catalog(payload);
console.log(`catalog: ${cat.N} items · facets: ${cat.meta.facets.join(', ')}\n`);

function run(text, extraConstraints = {}, asks = 0) {
  const req = parseRequest(text, cat);
  const constraints = { ...req.constraints, ...extraConstraints };
  const scored = cat.search(req.query, constraints, req);
  const d = decide(cat, scored, constraints, asks);
  const read = [];
  if (Object.keys(constraints).length) read.push(`requires ${JSON.stringify(constraints)}`);
  if (Object.keys(req.exclude).length) read.push(`refuses ${JSON.stringify(req.exclude)}`);
  if (req.excludeTerms.length) read.push(`bans ${JSON.stringify(req.excludeTerms)}`);
  if (req.budget) read.push(`budget ${JSON.stringify(req.budget)}`);
  if (req.sort !== 'relevance') read.push(`sort ${req.sort}`);
  console.log(`"${text}"`);
  if (read.length) console.log(`  read as: query="${req.query}"  ${read.join('  ')}`);
  console.log(`  -> ${d.action.toUpperCase()}  pool=${d.pool.length}`);
  if (d.action === 'ask') console.log(`     Q: ${d.question}`);
  if (d.action === 'answer') {
    scored.slice(0, 3).forEach((s, i) => console.log(`     ${i + 1}. ${typeof s.item.p === 'number' ? `$${s.item.p}` : '   —  '}  ${s.item.t.slice(0, 58)}`));
    for (const diff of d.differentiators ?? []) {
      console.log(`     differ by ${diff.facet}: ${diff.splits.map((x) => `${x.value} ${x.count}`).join(', ')}`);
    }
  }
  d.reasons.forEach((r) => console.log(`     · ${r}`));
  console.log();
}

run('belt');
run('leather belt');
run('leather belt', { closure: ['buckle'] });
run('running shoes');
run('waterproof hiking boots');
run('wallet');
run('waterproof hiking boots, no laces');
run('a wallet that is not leather, under $30');
run('cheapest wool sweater');
run("I'm looking for a leather belt, nothing with a snap, not over $50");
