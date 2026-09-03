/* What each question is worth: the same sentences under different budgets. */
import { E, sessions, score, f3 } from "./lib/sessions.mjs";
const P = E.policy, BASE = { ...P }, N = Number(process.argv[2]) || 600;
const row = (label, r) => console.log(label.padEnd(9) + f3(r.hit10).padEnd(9) + f3(r.hit1).padEnd(9) +
  f3(r.mrr).padEnd(8) + r.pool.toFixed(1).padEnd(13) + r.asked.toFixed(2));
console.log("what each question is worth, over " + N + " sentences\n");
console.log("budget   Hit@10   Hit@1    MRR     final pool   questions asked");
for (const q of [0, 1, 2, 3, 4, 5]) { P.maxQuestions = q; row(String(q), score(sessions(N))); }
P.maxQuestions = BASE.maxQuestions;
console.log("\nhow eagerly it should ask (\u201cenough\u201d = stop asking at this pool size)");
console.log("enough   Hit@10   Hit@1    MRR     final pool   questions asked");
for (const e of [4, 8, 12, 20, 40, 80]) { P.enough = e; row(String(e), score(sessions(N))); }
P.enough = BASE.enough;
console.log("\nhow hard a question must work to earn its turn");
console.log("minRemoved  Hit@10   Hit@1    MRR     final pool   questions asked");
for (const m of [0, 5, 10, 25, 50, 200]) { P.minRemoved = m; row(String(m).padEnd(12), score(sessions(N))); }
P.minRemoved = BASE.minRemoved;
