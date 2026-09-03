/* What the store actually does across a spread of queries: how often it asks,
   how big the pools are, and how long a search takes. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");

const QUERIES = [
  "belt", "leather belt", "wallet", "running shoes", "hiking boots", "sneakers",
  "dress shoes", "sweater", "shirt", "jacket", "chinos", "socks", "backpack",
  "watch", "gloves", "cap", "tie", "wool sweater", "cotton shirt", "nylon jacket",
  "waterproof jacket", "leather wallet", "slim wallet", "a belt under $30",
  "a jacket under $100", "shoes for the office", "something for the gym",
  "boots for hiking", "a shirt for a wedding", "cheapest wool sweater",
  "best rated leather belt", "most popular backpack",
  "a wallet that is not leather, under $30",
  "waterproof hiking boots, no laces",
  "I'm looking for a leather belt, nothing with a snap, not over $50",
  "a jacket, not from Ridgeline, between 80 and 150 dollars",
  "hiking boots, any material is fine", "a watch, nothing over $200",
  "no-show socks", "a sweater, no wool and no acrylic",
  "insulated gloves under $40", "a canvas backpack for work",
  "silk tie under $50", "running shoes but not for the gym",
  "a cap, no snap", "a linen shirt", "suede boots", "denim jacket",
  "a belt that isn't leather"
];

let asked = 0, answered = 0, poolSum = 0, turnsSum = 0, emptied = 0;
const askedAbout = new Map();
const t0 = process.hrtime.bigint();
let searches = 0;

for (const q of QUERIES) {
  let res = E.search(q, null);
  searches++;
  const first = res.status;
  if (first === "need_more_evidence") {
    asked++;
    askedAbout.set(res.facet, (askedAbout.get(res.facet) || 0) + 1);
  } else {
    answered++;
  }
  let turns = 1;
  while (res.status === "need_more_evidence" && turns < 6) {
    res = E.answer({ understood: res.understood, asked: res.asked, answers: res.answers,
      waived: res.waived, pendingFacet: res.facet }, [res.options[0].value]);
    searches++;
    turns++;
  }
  turnsSum += turns;
  poolSum += res.candidates;
  if (res.candidates === 0) emptied++;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log(QUERIES.length + " queries over " + E.CATALOG.length.toLocaleString() + " products\n");
console.log("  asks a question first        " + asked + " (" +
  Math.round(asked / QUERIES.length * 100) + "%)");
console.log("  answers straight away        " + answered);
console.log("  mean turns to an answer      " + (turnsSum / QUERIES.length).toFixed(2));
console.log("  mean final candidates        " + (poolSum / QUERIES.length).toFixed(1));
console.log("  emptied the catalog          " + emptied);
console.log("\n  what it asks about");
for (const [f, n] of Array.from(askedAbout).sort((a, b) => b[1] - a[1]))
  console.log("    " + (E.FACET_LABEL[f] || f).padEnd(14) + n);
console.log("\n  " + searches + " retrievals in " + ms.toFixed(0) + " ms  \u2014  " +
  (ms / searches).toFixed(2) + " ms each");
