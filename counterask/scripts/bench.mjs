/* Ground truth is self-supervised: pick a product, write a sentence a shopper
   could plausibly say about *that* product, then check the store gets it back.
   Truthful answers only — which is exactly this benchmark's blind spot, and
   why the ask threshold is set in absolute candidates rather than tuned here. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");

const holdout = process.argv.includes("--holdout");
const N = 800;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const r = rng(holdout ? 77003 : 4242);
const pick = (a) => a[Math.floor(r() * a.length)];

const SAY = {
  budget: (n) => holdout
    ? pick([`max $${n}`, `I have ${n} dollars to spend`, `no more than $${n}`, `up to $${n}`])
    : pick([`under $${n}`, `not over $${n}`, `less than $${n}`, `budget is $${n}`]),
  refuse: (w) => holdout
    ? pick([`skip the ${w}`, `avoid ${w}`, `other than ${w}`, `except ${w}`])
    : pick([`not ${w}`, `no ${w}`, `nothing with ${w}`, `without ${w}`]),
  open: () => holdout
    ? pick([`I could use`, `after`, `hunting for`, `need`])
    : pick([`I'm looking for`, `I want`, `show me`, `do you have`])
};

const ALL_VALUES = {};
for (const f of E.FACETS) ALL_VALUES[f] = E.attributeVocabulary()[f].map(x => x.value);

/* build one test case around a target product */
function makeCase() {
  const target = pick(E.CATALOG);
  const noun = target.family.toLowerCase();
  const parts = [SAY.open(), "a", noun];

  // one attribute the target really has
  const facets = E.FACETS.filter(f => target.attrs[f] && target.attrs[f].length);
  const stated = [];
  if (facets.length) {
    const f = pick(facets);
    const v = pick(target.attrs[f]);
    stated.push({ facet: f, value: v });
    parts.push(v);
  }

  // one refusal of a value the target genuinely does not have
  let refusal = null;
  const rf = pick(["material", "closure"]);
  // The refused word must not appear in the target's own title either. A
  // product called "Canvas Sneaker" is a correct casualty of "no canvas", so
  // asking the store to keep it would be testing the wrong thing.
  const title = target.title.toLowerCase();
  const missing = ALL_VALUES[rf].filter(v =>
    !(target.attrs[rf] || []).includes(v) && !title.includes(v.split(/[- ]/)[0]));
  if (missing.length && r() < 0.75) {
    refusal = { facet: rf, value: pick(missing) };
    parts.push(SAY.refuse(refusal.value));
  }

  // a budget the target satisfies
  let budget = null;
  if (target.price != null && r() < 0.7) {
    budget = Math.ceil((target.price + 5 + r() * 40) / 5) * 5;
    parts.push(SAY.budget(budget));
  }

  return { target, sentence: parts.join(" "), stated, refusal, budget };
}

/* the baseline: a search box. every content word must appear in the title. */
function keywordSearch(sentence) {
  const words = sentence.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const scored = E.CATALOG.map(p => {
    const t = p.title.toLowerCase();
    let s = 0;
    for (const w of words) if (t.includes(w)) s += 3;
    s += Math.log10(p.reviews + 1) * 0.7;
    return { p, s };
  }).filter(x => x.s > 1).sort((a, b) => b.s - a.s);
  return scored.map(x => x.p);
}

/* run the store the way an agent would: answer every question truthfully */
function converse(c) {
  let res = E.search(c.sentence, null);
  let turns = 1;
  let state = {
    understood: res.understood, asked: res.asked, answers: res.answers,
    waived: res.waived, pendingFacet: res.facet
  };
  while (res.status === "need_more_evidence" && turns < 6) {
    const have = c.target.attrs[res.facet];
    const values = have && have.length
      ? have.filter(v => res.options.some(o => o.value === v))
      : [];
    res = E.answer(state, values.length ? values : ["no_preference"]);
    state = {
      understood: res.understood, asked: res.asked, answers: res.answers,
      waived: res.waived, pendingFacet: res.facet
    };
    turns++;
  }
  return { res, turns };
}

const stats = {
  survived: 0, poolSum: 0, ceiling: 0,
  parser: { hit10: 0, hit1: 0, mrr: 0, turns: 0 },
  keyword: { hit10: 0, hit1: 0, mrr: 0 },
  fail: { refusalInverted: 0, refusedShown: 0, budgetBroken: 0, reAskedWaived: 0 },
  keywordFail: { refusalInverted: 0, refusedShown: 0, budgetBroken: 0 },
  n: 0
};

function record(bucket, ids, targetId) {
  const at = ids.indexOf(targetId);
  if (at >= 0 && at < 10) bucket.hit10++;
  if (at === 0) bucket.hit1++;
  if (at >= 0) bucket.mrr += 1 / (at + 1);
}

for (let i = 0; i < N; i++) {
  const c = makeCase();
  stats.n++;

  const { res, turns } = converse(c);
  stats.parser.turns += turns;
  record(stats.parser, res.allIds, c.target.id);

  // Did the store's reading ever throw away the product the shopper meant?
  // This is the check that matters; ranking inside a tie is a separate problem.
  const pool = res.allIds.length;
  stats.poolSum += pool;
  if (res.allIds.includes(c.target.id)) {
    stats.survived++;
    stats.ceiling += Math.min(10, pool) / pool; // Hit@10 if order within the pool were a coin flip
  }

  const kw = keywordSearch(c.sentence);
  record(stats.keyword, kw.map(p => p.id), c.target.id);

  // listening checks
  if (c.refusal) {
    const u = res.understood;
    const inverted = u.attributes.some(a => a.value === c.refusal.value);
    if (inverted) stats.fail.refusalInverted++;
    const top = res.products.slice(0, 10);
    if (top.some(p => (p.attrs[c.refusal.facet] || []).includes(c.refusal.value)))
      stats.fail.refusedShown++;

    const kwTop = kw.slice(0, 10);
    stats.keywordFail.refusalInverted++; // a keyword matcher has no concept of a refusal at all
    if (kwTop.some(p => (p.attrs[c.refusal.facet] || []).includes(c.refusal.value)))
      stats.keywordFail.refusedShown++;
  }
  if (c.budget != null) {
    if (res.products.slice(0, 10).some(p => p.price != null && p.price > c.budget))
      stats.fail.budgetBroken++;
    if (kw.slice(0, 10).some(p => p.price != null && p.price > c.budget))
      stats.keywordFail.budgetBroken++;
  }
  // never re-ask something the shopper waved through
  const waived = new Set(res.waived || []);
  for (const f of (res.asked || [])) {
    if (waived.has(f) && (res.asked.filter(x => x === f).length > 1)) stats.fail.reAskedWaived++;
  }
}

const pct = (x) => (x / stats.n).toFixed(3);
const row = (name, b) => `${name.padEnd(18)} Hit@10 ${pct(b.hit10)}  Hit@1 ${pct(b.hit1)}  MRR ${pct(b.mrr)}`;

console.log(`${stats.n} sentences${holdout ? " (held-out phrasings the parser was never tuned on)" : ""}\n`);
console.log(row("keyword matcher", stats.keyword));
console.log(row("sentence parser", stats.parser) + `  turns ${(stats.parser.turns / stats.n).toFixed(2)}`);
console.log("\nlistening checks                          keyword   parser");
const line = (label, a, b) => console.log(label.padEnd(42) + String(a).padStart(7) + String(b).padStart(9));
line("refusals inverted into requirements", stats.keywordFail.refusalInverted, stats.fail.refusalInverted);
line("refused value shown in top 10", stats.keywordFail.refusedShown, stats.fail.refusedShown);
line("budget broken in top 10", stats.keywordFail.budgetBroken, stats.fail.budgetBroken);
line("re-asked after \u201cno preference\u201d", "\u2014", stats.fail.reAskedWaived);

console.log("\nwhere the remaining loss is:");
console.log("  target wrongly filtered out      " +
  (100 - (stats.survived / stats.n) * 100).toFixed(1) + "% of cases");
console.log("  final candidates, mean           " + (stats.poolSum / stats.n).toFixed(1));
console.log("  Hit@10 if ranking inside the pool were random   " +
  (stats.ceiling / stats.n).toFixed(3));
console.log("  Hit@10 actually achieved                       " + pct(stats.parser.hit10));
