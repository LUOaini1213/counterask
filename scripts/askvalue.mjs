/* Does asking actually pay? The store asks on 84% of queries; that is only
   justified if the extra turns buy the shopper something. This runs the same
   800 sentences under different question budgets and reports what each turn
   is worth. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");
const P = E.policy;
const BASE = { ...P };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function run(n) {
  const r = rng(4242);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const voc = E.attributeVocabulary();
  const VALS = {};
  for (const f of E.FACETS) VALS[f] = voc[f].map(x => x.value);

  let hit10 = 0, hit1 = 0, mrr = 0, turns = 0, pool = 0, asked = 0;

  for (let i = 0; i < n; i++) {
    const target = pick(E.CATALOG);
    const parts = ["I'm looking for", "a", target.family.toLowerCase()];
    const facets = E.FACETS.filter(f => target.attrs[f] && target.attrs[f].length);
    if (facets.length) { const f = pick(facets); parts.push(pick(target.attrs[f])); }
    const rf = pick(["material", "closure"]);
    const title = target.title.toLowerCase();
    const missing = VALS[rf].filter(v =>
      !(target.attrs[rf] || []).includes(v) && !title.includes(v.split(/[- ]/)[0]));
    if (missing.length && r() < 0.75) parts.push("not " + pick(missing));
    if (target.price != null && r() < 0.7)
      parts.push("under $" + Math.ceil((target.price + 5 + r() * 40) / 5) * 5);

    let res = E.search(parts.join(" "), null);
    let t = 1;
    while (res.status === "need_more_evidence" && t < 8) {
      asked++;
      const have = target.attrs[res.facet];
      const vals = have ? have.filter(v => res.options.some(o => o.value === v)) : [];
      res = E.answer({ understood: res.understood, asked: res.asked, answers: res.answers,
        waived: res.waived, pendingFacet: res.facet }, vals.length ? vals : ["no_preference"]);
      t++;
    }
    turns += t;
    pool += res.allIds.length;
    const at = res.allIds.indexOf(target.id);
    if (at >= 0) { if (at < 10) hit10++; if (at === 0) hit1++; mrr += 1 / (at + 1); }
  }
  return { hit10: hit10 / n, hit1: hit1 / n, mrr: mrr / n,
           turns: turns / n, pool: pool / n, asked: asked / n };
}

const N = 600;
console.log("what each question is worth, over " + N + " sentences\n");
console.log("budget   Hit@10   Hit@1    MRR     final pool   questions asked");
for (const q of [0, 1, 2, 3, 4, 5]) {
  P.maxQuestions = q;
  const r = run(N);
  console.log(
    String(q).padEnd(9) +
    r.hit10.toFixed(3).padEnd(9) +
    r.hit1.toFixed(3).padEnd(9) +
    r.mrr.toFixed(3).padEnd(8) +
    r.pool.toFixed(1).padEnd(13) +
    r.asked.toFixed(2));
}
P.maxQuestions = BASE.maxQuestions;

console.log("\nhow eagerly it should ask (\u201cenough\u201d = stop asking at this pool size)");
console.log("enough   Hit@10   Hit@1    final pool   questions asked");
for (const e of [4, 8, 12, 20, 40, 80]) {
  P.enough = e;
  const r = run(N);
  console.log(
    String(e).padEnd(9) +
    r.hit10.toFixed(3).padEnd(9) +
    r.hit1.toFixed(3).padEnd(9) +
    r.pool.toFixed(1).padEnd(13) +
    r.asked.toFixed(2));
}
P.enough = BASE.enough;

console.log("\nhow hard a question must work to earn its turn");
console.log("minRemoved  Hit@10   Hit@1    final pool   questions asked");
for (const m of [0, 5, 10, 25, 50, 200]) {
  P.minRemoved = m;
  const r = run(N);
  console.log(
    String(m).padEnd(12) +
    r.hit10.toFixed(3).padEnd(9) +
    r.hit1.toFixed(3).padEnd(9) +
    r.pool.toFixed(1).padEnd(13) +
    r.asked.toFixed(2));
}
P.minRemoved = BASE.minRemoved;
