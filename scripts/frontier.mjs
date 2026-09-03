/* Two policies, one frontier each: Hit@10 against questions asked, swept over
   the per-question cost, then compared at equal questions asked. */
import { E, sessions, score, f3 } from "./lib/sessions.mjs";
const N = Number(process.argv[2]) || 500, base = { ...E.policy }, rows = {};
for (const mode of ["myopic", "sequential"]) {
  rows[mode] = [];
  for (const c of [3, 5, 8, 10, 14, 20, 30]) {
    E.policy.mode = mode; E.policy.minRemoved = c;
    rows[mode].push({ c, ...score(sessions(N)) });
  }
}
Object.assign(E.policy, base);
console.log("cost   | myopic: asked  Hit@10  pool | sequential: asked  Hit@10  pool");
rows.myopic.forEach((m, i) => { const s = rows.sequential[i];
  console.log(String(m.c).padEnd(6) + " | " + m.asked.toFixed(2) + "   " + f3(m.hit10) + "   " + m.pool.toFixed(1).padEnd(5) +
    " | " + s.asked.toFixed(2) + "   " + f3(s.hit10) + "   " + s.pool.toFixed(1)); });
function at(curve, asked) {
  const p = curve.slice().sort((a, b) => a.asked - b.asked);
  if (asked <= p[0].asked) return p[0].hit10;
  if (asked >= p[p.length - 1].asked) return p[p.length - 1].hit10;
  for (let i = 1; i < p.length; i++) if (asked <= p[i].asked) {
    const a = p[i - 1], b = p[i], w = (asked - a.asked) / (b.asked - a.asked || 1);
    return a.hit10 + w * (b.hit10 - a.hit10);
  }
}
console.log("\nat equal questions asked:\nasked   myopic   sequential   delta");
for (const q of [0.4, 0.6, 0.8, 1.0]) {
  const m = at(rows.myopic, q), s = at(rows.sequential, q);
  console.log(q.toFixed(1).padEnd(8) + f3(m) + "    " + f3(s) + "        " + (s - m >= 0 ? "+" : "") + f3(s - m));
}
