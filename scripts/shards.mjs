/* Every headline figure with its spread over 8 shards of 100 sentences, and
   paired shard comparisons for the two claims a third decimal cannot carry on
   its own: the sequential policy against the myopic one, and the ask
   threshold at 10 against 5. Reports mean ± sd across shards; the standard
   error of the mean is sd / √8. */
import { E, sessions, shards, paired, pm } from "./lib/sessions.mjs";
const N = Number(process.argv[2]) || 800, K = 8;

const label = E.META ? E.CATALOG.length.toLocaleString() + " real products" : "synthetic catalog";
console.log("spread over " + K + " shards of " + (N / K) + " sentences \u2014 " + label + "\n");

for (const holdout of [false, true]) {
  const rows = sessions(N, { seed: holdout ? 77003 : 4242, holdout });
  const sh = shards(rows, K);
  console.log((holdout ? "held-out phrasings" : "tuned phrasings"));
  const line = (name, key, d = 3) =>
    console.log("  " + name.padEnd(22) + pm(sh[key].mean, sh[key].sd, d) +
      "   se " + sh[key].se.toFixed(d) + "   range " + sh[key].min.toFixed(d) + "\u2013" + sh[key].max.toFixed(d));
  line("Hit@10", "hit10"); line("Hit@1", "hit1"); line("MRR", "mrr");
  line("target survived", "survived");
  line("questions asked", "asked", 2); line("final pool", "pool", 1);
  console.log();
}

console.log("paired comparisons (same shards, delta = B \u2212 A)\n");
const base = { ...E.policy };
const report = (name, rowsA, rowsB) => {
  for (const key of ["hit10", "asked"]) {
    const p = paired(rowsA, rowsB, K, key);
    const verdict = Math.abs(p.t) >= 2.4 ? "clear" : Math.abs(p.t) >= 1.5 ? "suggestive" : "noise";
    console.log("  " + (name + "  " + key).padEnd(44) + "\u0394 " + (p.mean >= 0 ? "+" : "") + pm(p.mean, p.sd) +
      "   B wins " + p.wins + "/" + p.k + "   t " + p.t.toFixed(1) + "   " + verdict);
  }
  console.log();
};

E.policy.mode = "myopic";     const my = sessions(N);
E.policy.mode = "sequential"; const sq = sessions(N);
E.policy.mode = base.mode;
report("A myopic vs B sequential", my, sq);

E.policy.minRemoved = 10; const c10 = sessions(N);
E.policy.minRemoved = 5;  const c5 = sessions(N);
E.policy.minRemoved = base.minRemoved;
report("A cost 10 vs B cost 5", c10, c5);

console.log("\u201cclear\u201d is |t| \u2265 2.4 over 8 shards (about p < 0.05 for a paired difference); anything\nlabelled noise should not be quoted as a difference at all.");
