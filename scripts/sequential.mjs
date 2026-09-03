/* Myopic vs sequential stopping policy on the same sentences. */
import { E, sessions, score, f3 } from "./lib/sessions.mjs";
const N = Number(process.argv[2]) || 600;
console.log("policy                Hit@10  Hit@1   MRR    turns  asked  final pool  ms/search");
for (const holdout of [false, true]) {
  for (const mode of ["myopic", "sequential"]) {
    E.policy.mode = mode;
    const r = score(sessions(N, { seed: holdout ? 77003 : 4242, holdout }));
    console.log((mode + (holdout ? " (holdout)" : "")).padEnd(22) + f3(r.hit10) + "   " + f3(r.hit1) + "   " +
      f3(r.mrr) + "  " + r.turns.toFixed(2) + "   " + r.asked.toFixed(2) + "   " + r.pool.toFixed(1).padEnd(11) + r.ms.toFixed(1));
  }
  if (!holdout) console.log();
}
E.policy.mode = "myopic";
