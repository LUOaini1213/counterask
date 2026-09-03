/* Knock out one ranking weight at a time and see what it was worth. Run this
   before touching a weight: on this benchmark the shopper's target is drawn
   uniformly from the catalog, which prices some signals unfairly and others
   not at all. Knowing which is which is the point. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");
const W = E.weights;
const BASE = { ...W };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function run(n = 500) {
  const r = rng(4242);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const voc = E.attributeVocabulary();
  const VALS = {};
  for (const f of E.FACETS) VALS[f] = voc[f].map(x => x.value);

  let hit10 = 0, hit1 = 0, mrr = 0, survived = 0, ceiling = 0;

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
    let guard = 0;
    while (res.status === "need_more_evidence" && guard++ < 5) {
      const have = target.attrs[res.facet];
      const vals = have ? have.filter(v => res.options.some(o => o.value === v)) : [];
      res = E.answer({ understood: res.understood, asked: res.asked, answers: res.answers,
        waived: res.waived, pendingFacet: res.facet }, vals.length ? vals : ["no_preference"]);
    }
    const at = res.allIds.indexOf(target.id);
    if (at >= 0) {
      survived++;
      ceiling += Math.min(10, res.allIds.length) / res.allIds.length;
      if (at < 10) hit10++;
      if (at === 0) hit1++;
      mrr += 1 / (at + 1);
    }
  }
  return { hit10: hit10 / n, hit1: hit1 / n, mrr: mrr / n,
           survived: survived / n, ceiling: ceiling / n };
}

const base = run();
console.log("baseline");
console.log("  Hit@10 " + base.hit10.toFixed(3) + "  Hit@1 " + base.hit1.toFixed(3) +
  "  MRR " + base.mrr.toFixed(3) + "  (random-order ceiling " + base.ceiling.toFixed(3) + ")\n");

console.log("knocking out one weight at a time (\u0394 Hit@10 against baseline)");
for (const k of Object.keys(BASE)) {
  if (BASE[k] === 0) continue;
  W[k] = 0;
  const r = run();
  W[k] = BASE[k];
  const d = r.hit10 - base.hit10;
  const sign = d > 0 ? "+" : "";
  console.log("  " + (k + " = 0").padEnd(28) + "Hit@10 " + r.hit10.toFixed(3) +
    "  (" + sign + d.toFixed(3) + ")" +
    (d > 0.005 ? "   <- this weight is costing accuracy here" : ""));
}

console.log("\nsweeping demand");
for (const v of [0, 0.15, 0.3, 0.5, 0.7, 1.0]) {
  W.demand = v;
  const r = run();
  console.log("  demand = " + String(v).padEnd(6) + "Hit@10 " + r.hit10.toFixed(3) +
    "  Hit@1 " + r.hit1.toFixed(3) + "  MRR " + r.mrr.toFixed(3));
}
W.demand = BASE.demand;
