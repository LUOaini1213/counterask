/* Retrieval and listening, on self-supervised ground truth. See lib/sessions
   for how a case is built; --holdout re-runs the same targets under phrasings
   the parser was never tuned on. */
import { E, rng, makeCase, converse, sessions, score, f3 } from "./lib/sessions.mjs";

const holdout = process.argv.includes("--holdout");
const N = Number(process.argv.find(a => /^\d+$/.test(a))) || 800;

/* the baseline: a search box. every content word must appear in the title. */
function keywordSearch(sentence) {
  const words = sentence.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  return E.CATALOG.map(p => {
    const t = p.title.toLowerCase();
    let s = 0;
    for (const w of words) if (t.includes(w)) s += 3;
    s += Math.log10(p.reviews + 1) * 0.7;
    return { p, s };
  }).filter(x => x.s > 1).sort((a, b) => b.s - a.s).map(x => x.p);
}

const rows = sessions(N, { seed: holdout ? 77003 : 4242, holdout });
const parser = score(rows);

// the same sentences through the keyword matcher
const kw = { hit10: 0, hit1: 0, mrr: 0 };
const fail = { refusalInverted: 0, refusedShown: 0, budgetBroken: 0, reAskedWaived: 0 };
const kwFail = { refusalInverted: 0, refusedShown: 0, budgetBroken: 0 };

for (const row of rows) {
  const { c, res } = row;
  const k = keywordSearch(c.sentence);
  const at = k.findIndex(p => p.id === c.target.id);
  if (at >= 0 && at < 10) kw.hit10++;
  if (at === 0) kw.hit1++;
  if (at >= 0) kw.mrr += 1 / (at + 1);

  if (c.refusal) {
    if (res.understood.attributes.some(a => a.value === c.refusal.value)) fail.refusalInverted++;
    if (res.products.slice(0, 10).some(p => (p.attrs[c.refusal.facet] || []).includes(c.refusal.value))) fail.refusedShown++;
    kwFail.refusalInverted++;   // a keyword matcher has no concept of a refusal at all
    if (k.slice(0, 10).some(p => (p.attrs[c.refusal.facet] || []).includes(c.refusal.value))) kwFail.refusedShown++;
  }
  if (c.budget != null) {
    if (res.products.slice(0, 10).some(p => p.price != null && p.price > c.budget)) fail.budgetBroken++;
    if (k.slice(0, 10).some(p => p.price != null && p.price > c.budget)) kwFail.budgetBroken++;
  }
  const waived = new Set(res.waived || []);
  for (const f of (res.asked || [])) if (waived.has(f) && res.asked.filter(x => x === f).length > 1) fail.reAskedWaived++;
}

const pct = (x) => (x / N).toFixed(3);
console.log(`${N} sentences${holdout ? " (held-out phrasings the parser was never tuned on)" : ""}\n`);
console.log("keyword matcher".padEnd(18) + `Hit@10 ${pct(kw.hit10)}  Hit@1 ${pct(kw.hit1)}  MRR ${pct(kw.mrr)}`);
console.log("sentence parser".padEnd(18) + `Hit@10 ${f3(parser.hit10)}  Hit@1 ${f3(parser.hit1)}  MRR ${f3(parser.mrr)}  turns ${parser.turns.toFixed(2)}`);
console.log("\nlistening checks                          keyword   parser");
const line = (l, a, b) => console.log(l.padEnd(42) + String(a).padStart(7) + String(b).padStart(9));
line("refusals inverted into requirements", kwFail.refusalInverted, fail.refusalInverted);
line("refused value shown in top 10", kwFail.refusedShown, fail.refusedShown);
line("budget broken in top 10", kwFail.budgetBroken, fail.budgetBroken);
line("re-asked after \u201cno preference\u201d", "\u2014", fail.reAskedWaived);
console.log("\nwhere the remaining loss is:");
console.log("  target wrongly filtered out      " + (100 - parser.survived * 100).toFixed(1) + "% of cases");
console.log("  final candidates, mean           " + parser.pool.toFixed(1));
console.log("  Hit@10 if ranking inside the pool were random   " + f3(parser.ceiling));
console.log("  Hit@10 actually achieved                       " + f3(parser.hit10));
