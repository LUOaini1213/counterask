// A/B: choose a question by what it removes now (myopic) or by that plus what
// the best follow-up would remove (lookahead), on both benchmarks and both
// shoppers. Same seeds, same targets; only the choice of question differs.
//
//   node scripts/ab_lookahead.mjs

import { POLICY } from '../public/engine.js';
import { bench } from './bench.mjs';
import { agentBench } from './agentbench.mjs';

const rows = [];
for (const shopper of ['oracle', 'menu']) {
  process.env.SHOPPER = shopper;
  for (const lookahead of [0, 1]) {
    POLICY.lookahead = lookahead;
    const k = bench({ n: 800 }).summary;
    const a = agentBench({ n: 800 }).summary;
    const h = agentBench({ n: 800, holdout: true }).summary;
    rows.push({
      shopper, lookahead,
      'kw Hit@10': k['Hit@10'], 'kw Hit@1': k['Hit@1'], 'kw MRR': k.MRR, 'kw turns': k.meanTurns,
      'ag Hit@10': a['Hit@10'], 'ag Hit@1': a['Hit@1'], 'ag MRR': a.MRR, 'ag turns': a.meanTurns,
      'ho Hit@10': h['Hit@10'], 'ho Hit@1': h['Hit@1'], 'ho MRR': h.MRR,
    });
  }
}
console.table(rows);
