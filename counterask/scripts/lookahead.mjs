/* Two-step lookahead for the stopping policy: built, measured, and rejected.
   The shipped engine is left untouched. This script loads engine.js as text,
   applies the lookahead patch in memory, and runs both variants on the same
   sentences, so the README's numbers can be reproduced without shipping a
   policy that measured worse. See README, "Two-step lookahead, measured and
   rejected". */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

let src = fs.readFileSync(path.join(PUB, "engine.js"), "utf8");
src = src.replace('require("./catalog.js")', 'require(' + JSON.stringify(path.join(PUB, "catalog.js")) + ')');
const anchor = "    const best = eligible.sort((a, b) => b.removed - a.removed)[0];";
if (!src.includes(anchor)) throw new Error("engine.js changed; update the lookahead anchor");
src = src.replace(anchor, `    let best = eligible.sort((a, b) => b.removed - a.removed)[0];
    if (P.lookahead && eligible.length > 1) {
      // expected removal from asking f now plus the best follow-up after each
      // possible answer, weighted by answer share — the answer semantics match
      // retrieve(): a product survives if it records the value or its title says it
      const score2 = (ev) => {
        const total = ev.options.reduce((a, o) => a + o.count, 0);
        let exp = 0;
        for (const o of ev.options) {
          const sub = pool.filter(p => has(p, ev.facet, o.value) || titleHas(p, o.value));
          const next = FACETS.filter(f => f !== ev.facet && !spoken.has(f))
            .map(f => evidence(sub, f)).filter(e => e && e.coverage >= P.minCoverage)
            .sort((a, b) => b.removed - a.removed)[0];
          exp += (o.count / total) * ((pool.length - sub.length) + (next ? next.removed : 0));
        }
        return exp;
      };
      best = eligible.slice(0, 3).map(e => ({ e, s2: score2(e) })).sort((a, b) => b.s2 - a.s2)[0].e;
    }`);
src = src.replace("    enough: 12\n  };", "    enough: 12,\n    lookahead: false\n  };");
const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), ".engine-lookahead.cjs");
fs.writeFileSync(tmp, src);
const E = require(tmp);
fs.rmSync(tmp);

function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function run(n) {
  const r = rng(4242); const pick = a => a[Math.floor(r() * a.length)];
  const voc = E.attributeVocabulary(); const V = {}; for (const f of E.FACETS) V[f] = voc[f].map(x => x.value);
  let hit10 = 0, hit1 = 0, turns = 0, pool = 0;
  for (let i = 0; i < n; i++) {
    const t = pick(E.CATALOG); const parts = ["I'm looking for", "a", t.family.toLowerCase()];
    const fs2 = E.FACETS.filter(f => t.attrs[f] && t.attrs[f].length);
    if (fs2.length) { const f = pick(fs2); parts.push(pick(t.attrs[f])); }
    const rf = pick(["material", "closure"]); const title = t.title.toLowerCase();
    const miss = V[rf].filter(v => !(t.attrs[rf] || []).includes(v) && !title.includes(v.split(/[- ]/)[0]));
    if (miss.length && r() < 0.75) parts.push("not " + pick(miss));
    if (t.price != null && r() < 0.7) parts.push("under $" + Math.ceil((t.price + 5 + r() * 40) / 5) * 5);
    let res = E.search(parts.join(" "), null); let k = 1;
    while (res.status === "need_more_evidence" && k < 8) {
      const have = t.attrs[res.facet]; const vals = have ? have.filter(v => res.options.some(o => o.value === v)) : [];
      res = E.answer({ understood: res.understood, asked: res.asked, answers: res.answers, waived: res.waived, pendingFacet: res.facet }, vals.length ? vals : ["no_preference"]); k++;
    }
    turns += k; pool += res.allIds.length;
    const at = res.allIds.indexOf(t.id); if (at >= 0) { if (at < 10) hit10++; if (at === 0) hit1++; }
  }
  return { hit10: hit10 / n, hit1: hit1 / n, turns: turns / n, pool: pool / n };
}
const N = 600, f = x => x.toFixed(3);
E.policy.lookahead = false; const a = run(N);
E.policy.lookahead = true; const b = run(N);
console.log("             Hit@10  Hit@1   turns   final pool");
console.log("myopic       " + f(a.hit10) + "   " + f(a.hit1) + "   " + a.turns.toFixed(2) + "    " + a.pool.toFixed(1));
console.log("2-step       " + f(b.hit10) + "   " + f(b.hit1) + "   " + b.turns.toFixed(2) + "    " + b.pool.toFixed(1));
const d = b.hit10 - a.hit10;
console.log("delta        " + (d >= 0 ? "+" : "") + f(d) + "\n");
const qs = ["belt", "running shoes", "a jacket", "socks", "a shirt", "a sweater", "a backpack", "a watch", "gloves", "a wallet"];
E.policy.lookahead = false; const first = {}; for (const q of qs) first[q] = E.search(q, null).facet;
E.policy.lookahead = true; let diff = 0;
for (const q of qs) { const g = E.search(q, null).facet; if (g !== first[q]) { diff++; console.log("  " + q + ": " + first[q] + " -> " + (g || "(does not ask)")); } }
console.log("first question changed on " + diff + "/" + qs.length + " broad queries");
console.log("\nselection uses the two-step score; the worth-a-turn threshold still uses the one-step score.\nthat mismatch is why it is worse — see README.");
