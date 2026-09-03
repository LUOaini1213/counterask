import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");

console.log("catalog:", E.CATALOG.length, "products\n");

const queries = [
  "belt",
  "leather belt",
  "running shoes",
  "waterproof hiking boots, no laces",
  "a wallet that is not leather, under $30",
  "cheapest wool sweater",
  "I'm looking for a leather belt, nothing with a snap, not over $50",
  "no-show socks",
  "size 10 running shoes",
  "a 41mm watch",
  "hiking boots, any material is fine",
  "a jacket, not from Ridgeline, between 80 and 150 dollars",
  "something for the gym",
  "running shoes but not for the gym",
  "waterproof insulated silk gloves under $15"
];

for (const q of queries) {
  const r = E.search(q, null);
  const u = r.understood;
  console.log("— " + q);
  console.log("   read: attrs=" + JSON.stringify(u.attributes.map(a => a.facet + ":" + a.value)) +
    " excl=" + JSON.stringify(u.exclusions.map(e => (e.facet || "word") + ":" + e.value)) +
    " budget=" + (u.budget ? E.budgetLabel(u.budget) : "-") +
    " sort=" + (u.sort || "-") +
    " terms=" + JSON.stringify(u.terms) +
    (u.waived.length ? " waived=" + JSON.stringify(u.waived) : "") +
    (u.conflicts.length ? " CONFLICT=" + JSON.stringify(u.conflicts) : ""));
  console.log("   " + r.candidates + " candidates -> " + r.status +
    (r.question ? "  Q: " + r.question : ""));
  console.log("   why: " + r.why.join(" | "));
  if (r.relax) console.log("   relax: " + r.relax.map(x => x.label + "->" + x.count).join(", "));
  if (r.differentiators && r.differentiators.length)
    console.log("   differ: " + r.differentiators.map(d => d.facet + " " +
      d.splits.map(s => s.count + " " + s.value).join(", ")).join(" | "));
  console.log("   top: " + r.products.slice(0, 2).map(p => p.title + (p.price ? " $" + p.price : " (no price)")).join(" / "));
  console.log();
}
