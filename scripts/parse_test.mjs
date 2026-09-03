/* Hand-written cases. Each one pins both halves of the job: what the parser
   must take from the sentence, and what it must leave alone. A parser tuned on
   its own generated templates can pass a benchmark while failing the next
   phrasing a person tries; these are the phrasings. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const E = require("../public/engine.js");

const CASES = [
  // --- budget, in the shapes people actually write it -------------------
  { s: "a belt under $40", budget: { max: 40 } },
  { s: "a belt not over $50", budget: { max: 50 } },
  { s: "a belt no more than $50", budget: { max: 50 } },
  { s: "a belt less than 25 dollars", budget: { max: 25 } },
  { s: "max $40 belt", budget: { max: 40 } },
  { s: "I have 40 dollars to spend on a belt", budget: { max: 40 } },
  { s: "a belt, up to $35", budget: { max: 35 } },
  { s: "my budget is $60 for a jacket", budget: { max: 60 } },
  { s: "a jacket between 80 and 150 dollars", budget: { min: 80, max: 150 } },
  { s: "a jacket in the $20-$30 range", budget: { min: 20, max: 30 } },
  { s: "a jacket $90-$120", budget: { min: 90, max: 120 } },
  { s: "a watch over $200", budget: { min: 200 } },
  { s: "a watch around $150", budget: { min: 120, max: 180 } },
  { s: "a wallet at most $25", budget: { max: 25 } },

  // --- numbers written as words -----------------------------------------
  { s: "a belt under fifty dollars", budget: { max: 50 } },
  { s: "a belt, no more than twenty five bucks", budget: { max: 25 } },
  { s: "a jacket around a hundred dollars", budget: { min: 80, max: 120 } },
  { s: "a watch, at most one hundred and fifty dollars", budget: { max: 150 } },
  { s: "a watch over two hundred", budget: { min: 200 } },
  { s: "a jacket for \u20ac40", budget: { max: 40 } },
  // words that are numbers but not money
  { s: "a one size cap", noBudget: true },
  { s: "a shirt with two pockets", noBudget: true },

  // --- numbers that are not money ---------------------------------------
  { s: "size 10 running shoes", noBudget: true, noTerm: ["10"] },
  { s: "a 41mm watch", noBudget: true, terms: ["41mm"] },
  { s: "size large flannel shirt", noBudget: true, attrs: ["material:flannel"] },
  { s: "a 3 pack of socks", noBudget: true },

  // --- refusals, in every shape -----------------------------------------
  { s: "a belt, not leather", excl: ["material:leather"], noAttrs: ["material:leather"] },
  { s: "a belt with no snap", excl: ["closure:snap"] },
  { s: "a jacket without a zip", excl: ["closure:zip"] },
  { s: "boots, nothing with laces", excl: ["closure:lace-up"] },
  { s: "a sweater, avoid wool", excl: ["material:wool"] },
  { s: "shoes, skip the suede", excl: ["material:suede"] },
  { s: "a wallet other than leather", excl: ["material:leather"] },
  { s: "a bag, I don't want nylon", excl: ["material:nylon"] },
  { s: "a shirt, anything except linen", excl: ["material:linen"] },

  // --- refusals that are not attribute values ---------------------------
  { s: "a jacket, not from Ridgeline", excl: ["brand:Ridgeline"], banned: ["ridgeline"] },
  { s: "a jacket, nothing from Ashford", excl: ["brand:Ashford"] },
  { s: "a jacket with no hood", banned: ["hood"] },

  // --- words that look like refusals and are not ------------------------
  { s: "no-show socks", noExcl: true, terms: ["no-show"] },
  { s: "a belt not over $50", noExcl: true, budget: { max: 50 } },
  { s: "a non-leather wallet", noTerm: [] },

  // --- waved through ----------------------------------------------------
  { s: "hiking boots, any material is fine", waived: ["material"], neverAsk: "material" },
  { s: "a belt, no preference on closure", waived: ["closure"], neverAsk: "closure" },
  { s: "a belt, material doesn't matter", waived: ["material"], neverAsk: "material" },
  { s: "boots, not fussy about the closure", waived: ["closure"], noExcl: true },
  { s: "a jacket, I don't care about the material", waived: ["material"] },

  // --- stated attributes, including the ones people say sideways --------
  { s: "waterproof jacket", attrs: ["feature:water resistant"] },
  { s: "something for the gym", attrs: ["occasion:athletic"] },
  { s: "a shirt for a wedding", attrs: ["occasion:formal"] },
  { s: "shoes for the office", attrs: ["occasion:work"] },
  { s: "a warm jacket", attrs: ["feature:insulated"] },
  { s: "a full-grain belt", attrs: ["material:leather"] },
  { s: "a stainless steel watch", attrs: ["material:stainless steel"] },
  { s: "a lace-up boot", attrs: ["closure:lace-up"] },
  { s: "a slip-on sneaker", attrs: ["closure:slip-on"] },

  // --- ordering ---------------------------------------------------------
  { s: "the cheapest running shoes you have", sort: "price-asc" },
  { s: "best rated wool sweater", sort: "rating", attrs: ["material:wool"] },
  { s: "most popular wallet", sort: "demand" },
  { s: "least expensive belt", sort: "price-asc" },

  // --- filler dropped, content kept -------------------------------------
  { s: "I'm looking for a leather belt for my brother's birthday, please",
    attrs: ["material:leather"], terms: ["belt"], noTerm: ["brother", "birthday", "please"] },
  { s: "do you have any cotton socks", attrs: ["material:cotton"], terms: ["socks"] },

  // --- everything at once -----------------------------------------------
  { s: "I'm looking for a leather belt, nothing with a snap, not over $50",
    attrs: ["material:leather"], excl: ["closure:snap"], budget: { max: 50 },
    terms: ["belt"] },
  { s: "cheapest waterproof hiking boots under $120, no laces",
    attrs: ["feature:water resistant", "occasion:outdoor"], excl: ["closure:lace-up"],
    budget: { max: 120 }, sort: "price-asc" },

  // --- a value said both ways -------------------------------------------
  { s: "running shoes but not for the gym", conflict: "athletic", conflictWhen: "running shoes" },

  // ===== harder: phrasings that ought to break it =======================

  // a ceiling written as a negated floor
  { s: "a watch, nothing over $200", budget: { max: 200 } },
  { s: "a watch, I'd rather not spend more than $60", budget: { max: 60 } },
  { s: "a jacket, nothing above $90", budget: { max: 90 } },

  // contractions
  { s: "a belt that isn't leather", excl: ["material:leather"] },
  { s: "a wallet that's not leather", excl: ["material:leather"] },
  { s: "socks, anything but wool", excl: ["material:wool"] },

  // a number with no money marker at all
  { s: "a jacket, not too expensive", noBudget: true },
  { s: "3 pairs of wool socks", noBudget: true, attrs: ["material:wool"] },

  // two refusals in one breath
  { s: "a sweater, no wool and no acrylic",
    excl: ["material:wool", "material:acrylic"] },
  { s: "a wallet, not leather, not suede",
    excl: ["material:leather", "material:suede"] },

  // requirement and refusal on the same facet
  { s: "a waterproof jacket that is not insulated",
    attrs: ["feature:water resistant"], excl: ["feature:insulated"] },

  // alternatives inside one facet
  { s: "a sweater in wool or cotton",
    attrs: ["material:wool", "material:cotton"] },

  // refusal of an occasion
  { s: "a shirt, nothing formal", excl: ["occasion:formal"] },

  // approximations
  { s: "a watch about $150", budget: { min: 120, max: 180 } },
  { s: "a watch roughly $150", budget: { min: 120, max: 180 } },

  // --- changing your mind -----------------------------------------------
  { s: "actually, ignore my earlier preference. what I need is a nylon belt",
    attrs: ["material:nylon"], retraction: "replace",
    noTerm: ["actually", "ignore", "earlier", "preference", "what"] },
  { s: "scratch that, a canvas belt", attrs: ["material:canvas"],
    retraction: "replace", noTerm: ["scratch"] },
  { s: "changed my mind, no leather", excl: ["material:leather"],
    retraction: "replace", noTerm: ["changed", "mind"] },
  { s: "forget everything, show me hiking boots", attrsAny: ["occasion:outdoor", "category:hiking & trekking"],
    retraction: "reset", noTerm: ["forget", "everything"] },
  { s: "let's start over, a wool sweater", attrs: ["material:wool"],
    retraction: "reset", noTerm: ["start", "over"] },
  { s: "a nylon belt instead of leather", attrs: ["material:nylon"],
    retraction: "replace", drops: ["leather"], noTerm: ["instead"] },
  { s: "on second thought, make it suede", attrs: ["material:suede"],
    retraction: "replace" },
  // a sentence that merely contains "forget" is not a retraction
  { s: "a wallet I won't forget", noRetraction: true },

  // the long one
  { s: "cheapest boots for hiking, no leather, size 11, under $130",
    attrs: ["occasion:outdoor"], excl: ["material:leather"],
    budget: { max: 130 }, sort: "price-asc", noTerm: ["11", "size"] }
];

// The order of the passes is the design. Pin it, so a reordering is a failing
// test and not a surprise in a benchmark.
const ORDER = ["contractions", "protected compounds", "size", "number words", "budget", "ordering",
  "waved through", "retraction", "refusals", "attributes", "filler", "title words", "conflicts"];
const actual = E.PASSES.map(p => p.name);
if (JSON.stringify(actual) !== JSON.stringify(ORDER)) {
  console.log("  FAIL  pass order changed\n        expected " + ORDER.join(" > ") + "\n        got      " + actual.join(" > "));
  process.exit(1);
}
console.log("  ok    pass order: " + ORDER.join(" > ") + "\n");

// Structural cases (budget, size, contractions, retraction, conjunctions)
// hold on any catalog. Cases that name a value or a brand hold only where the
// catalog carries it — on another catalog they are reported, not failed.
const VOC = E.attributeVocabulary();
const known = (facet, value) => facet === "brand"
  ? E.CATALOG.some(p => p.brand === value)
  : (VOC[facet] || []).some(o => o.value === value);
const applicable = (c) => {
  for (const a of (c.attrs || []).concat(c.excl || [])) {
    const [facet, value] = a.split(":");
    if (facet !== "word" && !known(facet, value)) return false;
  }
  return true;
};

let failed = 0, checks = 0, skipped = 0;
const fail = (s, msg) => { console.log("  FAIL  " + s + "\n        " + msg); failed++; };

for (const c of CASES) {
  if (!applicable(c)) { skipped++; console.log("  --    " + c.s + "   (vocabulary not in this catalog)"); continue; }
  const u = E.parse(c.s);
  const attrs = u.attributes.map(a => a.facet + ":" + a.value);
  const excl = u.exclusions.map(e => (e.facet || "word") + ":" + e.value);
  checks++;
  let ok = true;

  const need = (cond, msg) => { if (!cond) { fail(c.s, msg); ok = false; } };

  if (c.budget) {
    const b = u.budget || {};
    need(b.max === c.budget.max && (c.budget.min == null || b.min === c.budget.min),
      "budget expected " + JSON.stringify(c.budget) + " got " + JSON.stringify(u.budget));
  }
  if (c.noBudget) need(!u.budget, "should read no budget, got " + JSON.stringify(u.budget));
  if (c.sort) need(u.sort === c.sort, "sort expected " + c.sort + " got " + u.sort);

  for (const a of c.attrs || [])
    need(attrs.includes(a), "missing attribute " + a + " (read " + JSON.stringify(attrs) + ")");
  if (c.attrsAny)
    need(c.attrsAny.some(a => attrs.includes(a)), "expected one of " + JSON.stringify(c.attrsAny) + " (read " + JSON.stringify(attrs) + ")");
  for (const a of c.noAttrs || [])
    need(!attrs.includes(a), "should not have read attribute " + a);

  for (const e of c.excl || [])
    need(excl.includes(e), "missing exclusion " + e + " (read " + JSON.stringify(excl) + ")");
  if (c.noExcl) need(excl.length === 0, "should refuse nothing, read " + JSON.stringify(excl));

  for (const b of c.banned || [])
    need(u.bannedWords.includes(b), "should ban the word \u201c" + b + "\u201d (banned " +
      JSON.stringify(u.bannedWords) + ")");

  for (const w of c.waived || [])
    need(u.waived.includes(w), "should wave through " + w + " (waived " + JSON.stringify(u.waived) + ")");

  // a noun may be a title term, or — on a catalog with a category tree — the
  // category it names; either is the word being heard
  const heardAsCategory = (t) => u.attributes.some(a => a.facet === "category" &&
    (a.value === t || a.value === t + "s" || a.value.startsWith(t) || (a.said || "").startsWith(t)));
  for (const t of c.terms || [])
    need(u.terms.includes(t) || heardAsCategory(t), "missing title term " + t + " (terms " + JSON.stringify(u.terms) + ")");
  for (const t of c.noTerm || [])
    need(!u.terms.includes(t), "should not keep the word \u201c" + t + "\u201d as a term");

  if (c.retraction)
    need(u.retraction && u.retraction.kind === c.retraction,
      "retraction expected " + c.retraction + " got " +
      (u.retraction ? u.retraction.kind : "none"));
  if (c.noRetraction) need(!u.retraction, "should not read a retraction");
  for (const d of c.drops || [])
    need((u.retraction && u.retraction.drops || []).includes(d),
      "should record dropping " + d);

  if (c.conflict) {
    // a clash exists only where this catalog's vocabulary reads the positive
    // mention as the same value the negative one refuses
    const positive = E.parse(c.conflictWhen || c.s).attributes.some(a => a.value === c.conflict);
    if (positive) need(u.conflicts.includes(c.conflict), "should flag \u201c" + c.conflict + "\u201d said both ways");
    else { skipped++; console.log("  --    (no clash on this catalog: \u201c" + c.conflictWhen + "\u201d is not read as " + c.conflict + ")"); }
  }

  // a facet the shopper waved through must never come back as a question
  if (c.neverAsk) {
    let res = E.search(c.s, null);
    let guard = 0;
    while (res.status === "need_more_evidence" && guard++ < 5) {
      need(res.facet !== c.neverAsk, "asked about " + c.neverAsk + " after it was waved through");
      res = E.answer({ understood: res.understood, asked: res.asked, answers: res.answers,
        waived: res.waived, pendingFacet: res.facet }, ["no_preference"]);
    }
  }

  if (ok) console.log("  ok    " + c.s);
}

console.log("\n" + checks + " sentences, " + failed + " failed" + (skipped ? ", " + skipped + " not applicable to this catalog" : ""));
process.exit(failed ? 1 : 0);
