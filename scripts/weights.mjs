/* Knock out one ranking weight at a time and see what it was worth. */
import { E, sessions, score, f3 } from "./lib/sessions.mjs";
const W = E.weights, BASE = { ...W }, N = Number(process.argv[2]) || 500;
const run = () => score(sessions(N));
const base = run();
console.log("baseline");
console.log("  Hit@10 " + f3(base.hit10) + "  Hit@1 " + f3(base.hit1) + "  MRR " + f3(base.mrr) +
  "  (random-order ceiling " + f3(base.ceiling) + ")\n");
console.log("knocking out one weight at a time (\u0394 Hit@10 against baseline)");
for (const k of Object.keys(BASE)) {
  if (BASE[k] === 0) continue;
  W[k] = 0; const r = run(); W[k] = BASE[k];
  const d = r.hit10 - base.hit10;
  console.log("  " + (k + " = 0").padEnd(28) + "Hit@10 " + f3(r.hit10) + "  (" + (d > 0 ? "+" : "") + f3(d) + ")" +
    (d > 0.005 ? "   <- this weight is costing accuracy here" : ""));
}
console.log("\nsweeping demand");
for (const v of [0, 0.15, 0.3, 0.5, 0.7, 1.0]) {
  W.demand = v; const r = run();
  console.log("  demand = " + String(v).padEnd(6) + "Hit@10 " + f3(r.hit10) + "  Hit@1 " + f3(r.hit1) + "  MRR " + f3(r.mrr));
}
W.demand = BASE.demand;
