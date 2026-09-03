/* Two-step greedy lookahead: built on a scratch copy of the engine, measured,
   and rejected. Kept so the README's numbers can be reproduced. The correctly
   formulated version lives in the engine as P.mode = "sequential"; see
   sequential.mjs and frontier.mjs. */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PUB, sessions, score, f3 } from "./lib/sessions.mjs";
const require = createRequire(import.meta.url);

let src = fs.readFileSync(path.join(PUB, "engine", "policy.js"), "utf8");
const anchor = "    const best = eligible.sort((a, b) => b.removed - a.removed)[0];";
if (!src.includes(anchor)) throw new Error("policy.js changed; update the lookahead anchor");
src = src.replace(anchor, `    let best = eligible.sort((a, b) => b.removed - a.removed)[0];
    if (P.lookahead && eligible.length > 1) {
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
src = src.replace('    mode: "myopic"', '    lookahead: false,\n    mode: "myopic"');
const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), ".policy-lookahead.cjs");
fs.writeFileSync(tmp, src);
// compose an engine from the real parts and the patched policy
const engineSrc = fs.readFileSync(path.join(PUB, "engine.js"), "utf8")
  .replace('require("./catalog.js")', 'require(' + JSON.stringify(path.join(PUB, "catalog.js")) + ')')
  .replace('require("./engine/vocabulary.js")', 'require(' + JSON.stringify(path.join(PUB, "engine/vocabulary.js")) + ')')
  .replace('require("./engine/parser.js")', 'require(' + JSON.stringify(path.join(PUB, "engine/parser.js")) + ')')
  .replace('require("./engine/retrieval.js")', 'require(' + JSON.stringify(path.join(PUB, "engine/retrieval.js")) + ')')
  .replace('require("./engine/policy.js")', 'require(' + JSON.stringify(tmp) + ')');
const tmpE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".engine-lookahead.cjs");
fs.writeFileSync(tmpE, engineSrc);
const E2 = require(tmpE);
fs.rmSync(tmp); fs.rmSync(tmpE);

const N = Number(process.argv[2]) || 600;
E2.policy.lookahead = false; const a = score(sessions(N, { engine: E2 }));
E2.policy.lookahead = true;  const b = score(sessions(N, { engine: E2 }));
console.log("             Hit@10  Hit@1   turns   final pool");
console.log("myopic       " + f3(a.hit10) + "   " + f3(a.hit1) + "   " + a.turns.toFixed(2) + "    " + a.pool.toFixed(1));
console.log("2-step       " + f3(b.hit10) + "   " + f3(b.hit1) + "   " + b.turns.toFixed(2) + "    " + b.pool.toFixed(1));
const d = b.hit10 - a.hit10;
console.log("delta        " + (d >= 0 ? "+" : "") + f3(d) + "\n");
const qs = ["belt", "running shoes", "a jacket", "socks", "a shirt", "a sweater", "a backpack", "a watch", "gloves", "a wallet"];
E2.policy.lookahead = false; const first = {}; for (const q of qs) first[q] = E2.search(q, null).facet;
E2.policy.lookahead = true; let diff = 0;
for (const q of qs) { const g = E2.search(q, null).facet; if (g !== first[q]) { diff++; console.log("  " + q + ": " + first[q] + " -> " + (g || "(does not ask)")); } }
console.log("first question changed on " + diff + "/" + qs.length + " broad queries");
console.log("\nselection used the two-step score; the worth-a-turn threshold still used the one-step score.\nthat mismatch is why it is worse. the fixed version is P.mode = \"sequential\".");
