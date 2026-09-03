/* Pricing a question: with a per-question hazard h, E[hit] = Σ (1-h)^asked × hit.
   For each h, the threshold that maximises it. The store cannot measure h; this
   says what follows from each belief about it. */
import { E, sessions, f3 } from "./lib/sessions.mjs";
const N = Number(process.argv[2]) || 800, COSTS = [3, 5, 8, 10, 14, 20, 30], HAZ = [0, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30];
const base = E.policy.minRemoved, runs = {};
for (const c of COSTS) { E.policy.minRemoved = c; runs[c] = sessions(N); }
E.policy.minRemoved = base;
const expHit = (rows, h) => rows.reduce((a, s) => a + Math.pow(1 - h, s.asked) * s.hit10, 0) / rows.length;
const asked = (rows) => rows.reduce((a, s) => a + s.asked, 0) / rows.length;
console.log("expected Hit@10 when a shopper walks away with probability h at each question\n");
console.log("cost  asked  | " + HAZ.map(h => ("h=" + h).padEnd(7)).join(""));
for (const c of COSTS) console.log(String(c).padEnd(6) + asked(runs[c]).toFixed(2).padEnd(7) + "| " + HAZ.map(h => f3(expHit(runs[c], h)).padEnd(7)).join(""));
console.log("\nthe threshold each belief about patience implies:\nh       best cost   E[hit]   asked");
for (const h of HAZ) {
  let best = null;
  for (const c of COSTS) { const v = expHit(runs[c], h); if (!best || v > best.v) best = { c, v }; }
  console.log(String(h).padEnd(8) + String(best.c).padEnd(12) + f3(best.v) + "    " + asked(runs[best.c]).toFixed(2) + (best.c === base ? "   <- shipped" : ""));
}
const se = Math.sqrt(0.7 * 0.3 / N), fine = [];
for (let h = 0; h <= 0.4001; h += 0.01) fine.push(+h.toFixed(2));
const okH = fine.filter(h => Math.max(...COSTS.map(c => expHit(runs[c], h))) - expHit(runs[base], h) <= se);
console.log("\nstandard error at N=" + N + " is about " + f3(se) + "; differences inside that are noise.");
console.log(okH.length
  ? "the shipped cost of " + base + " is within one standard error of the best for h in [" + okH[0] + ", " + okH[okH.length - 1] + "] \u2014 that is the belief about patience it quietly encodes."
  : "the shipped cost of " + base + " is more than one standard error below the best at every h tried.");
console.log("believe shoppers are more patient than that and the store should ask more; less, and it\nshould ask less. h is the one number the store cannot measure; this is what each value implies.");
