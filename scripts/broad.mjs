/* What the category question is worth. The leaf-level benchmark starts every
   sentence at the product's own category, so the tree is never walked. These
   sessions start at "shoes" or "clothing" and let the store ask its way down;
   the same sessions with category asking switched off show what the walk
   buys. Meaningful only on a catalog with a category tree. */
import { E, broadSessions, score, shards, paired, pm } from "./lib/sessions.mjs";
const N = Number(process.argv[2]) || 600, K = 8;
if (!E.FACETS.includes("category")) {
  console.log("this catalog has no category tree; nothing to measure. Build the real catalog first.");
  process.exit(0);
}
console.log("broad-start sessions on " + E.CATALOG.length.toLocaleString() + " products, " + N + " sessions\n");
E.policy.askCategory = true;  const on = broadSessions(N);
E.policy.askCategory = false; const off = broadSessions(N);
E.policy.askCategory = true;
const so = shards(on, K), sf = shards(off, K);
const row = (label, sh, rows) => console.log(label.padEnd(24) +
  pm(sh.hit10.mean, sh.hit10.se).padEnd(18) + pm(sh.mrr.mean, sh.mrr.se).padEnd(18) +
  sh.asked.mean.toFixed(2).padEnd(8) + sh.pool.mean.toFixed(0).padEnd(10) +
  (rows.reduce((a, x) => a + x.catAsks, 0) / rows.length).toFixed(2));
console.log("policy                  Hit@10 \u00b1 se       MRR \u00b1 se          asked   pool      category asks");
row("category asked", so, on);
row("category never asked", sf, off);
console.log();
for (const key of ["hit10", "pool", "asked"]) {
  const p = paired(off, on, K, key);
  console.log(("\u0394 " + key + " (asked \u2212 never)").padEnd(30) + (p.mean >= 0 ? "+" : "") + pm(p.mean, p.sd, key === "pool" ? 0 : 3) +
    "   wins " + p.wins + "/" + p.k + "   t " + p.t.toFixed(1) + "   " + (Math.abs(p.t) >= 2.4 ? "clear" : Math.abs(p.t) >= 1.5 ? "suggestive" : "noise"));
}
const byDepth = {};
for (const x of on) { const d = x.c.startDepth; (byDepth[d] = byDepth[d] || []).push(x); }
console.log("\nby where the shopper started:");
for (const d of Object.keys(byDepth).sort()) {
  const sc = score(byDepth[d]);
  console.log("  level " + d + "  n=" + String(byDepth[d].length).padEnd(5) + "Hit@10 " + sc.hit10.toFixed(2) + "   asked " + sc.asked.toFixed(2) + "   pool " + sc.pool.toFixed(0));
}
