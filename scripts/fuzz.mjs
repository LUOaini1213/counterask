/* Fuzzing the parser. The refusal loop that spun forever on "not too expensive"
   was found by accident; this looks for the rest of that family on purpose.
   Every case is written to a scratch file before it runs, so if the process
   hangs the offending sentence is still on disk. */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const E = require("../public/engine.js");

const SCRATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), ".fuzz-current");

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const r = rng(Number(process.argv[2]) || 90210);
const pick = (a) => a[Math.floor(r() * a.length)];

// Fragments drawn from every pass the parser has, plus the connective tissue
// that makes them collide.
const NEGATORS = ["not", "no", "nothing", "without", "avoid", "skip the",
  "other than", "except", "anything but", "don't want", "isn't", "nothing with",
  "nothing from", "not from", "not made of"];
const MONEY = ["$40", "40 dollars", "$0", "$0.5", "40", "$999999", "$-5", "$40.999",
  "40 bucks", "$", "$$40"];
const BUDGET_LEAD = ["under", "not over", "nothing over", "over", "above", "around",
  "about", "roughly", "up to", "at most", "at least", "between", "max", "budget is",
  "less than", "more than", "I have", "in the"];
const FACETY = ["material", "closure", "occasion", "fit", "price", "brand", "colour",
  "the material", "materials"];
const WAIVERS = ["any {f} is fine", "no preference on {f}", "{f} doesn't matter",
  "not fussy about the {f}", "don't care about {f}", "whatever {f}"];
const NOISE = ["the", "a", "and", "or", "but", "with", "for", "to", "of", "very",
  "too", "really", "please", "um", "-", ",", "'", "\"", "$", "%", "(", ")", "!",
  "no-show", "non-leather", "isn't", "can't", "won't", "size", "10", "41mm",
  "XXL", "2-pack", "e", "aa"];

const VALUES = [];
{
  const voc = E.attributeVocabulary();
  for (const f of E.FACETS) for (const o of voc[f]) VALUES.push(o.value);
}
const NOUNS = Array.from(new Set(E.CATALOG.map(p => p.family.toLowerCase())));
const BRANDS = Array.from(new Set(E.CATALOG.map(p => p.brand)));

function fragment() {
  switch (Math.floor(r() * 8)) {
    case 0: return pick(NEGATORS) + " " + pick(VALUES);
    case 1: return pick(BUDGET_LEAD) + " " + pick(MONEY);
    case 2: return pick(WAIVERS).replace("{f}", pick(FACETY));
    case 3: return pick(VALUES);
    case 4: return pick(NOUNS);
    case 5: return pick(NEGATORS) + " " + pick(BRANDS);
    case 6: return pick(NEGATORS) + " " + pick(NOISE);
    default: return pick(NOISE);
  }
}

function sentence() {
  const n = 1 + Math.floor(r() * 9);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(fragment());
  let s = parts.join(r() < 0.15 ? ", " : " ");
  if (r() < 0.1) s = s.toUpperCase();
  if (r() < 0.06) s = s.repeat(3);
  return s;
}

const N = Number(process.env.FUZZ_N || 4000);
let slowest = { ms: 0, s: "" };
const problems = [];

function note(s, msg) {
  problems.push({ s, msg });
  console.log("  PROBLEM  " + msg + "\n           input: " + JSON.stringify(s.slice(0, 160)));
}

for (let i = 0; i < N; i++) {
  const s = sentence();
  fs.writeFileSync(SCRATCH, s);           // survives a hang
  const t = process.hrtime.bigint();
  let u;
  try {
    u = E.parse(s);
  } catch (err) {
    note(s, "parse threw: " + err.message);
    continue;
  }
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  if (ms > slowest.ms) slowest = { ms, s };
  if (ms > 250) note(s, "parse took " + ms.toFixed(0) + " ms");

  // invariants the rest of the engine relies on
  if (!Array.isArray(u.attributes) || !Array.isArray(u.exclusions) || !Array.isArray(u.terms))
    note(s, "understood is malformed");
  if (u.budget && u.budget.min != null && u.budget.max != null && u.budget.min > u.budget.max)
    note(s, "budget inverted: " + JSON.stringify(u.budget));
  if (u.budget && (Number.isNaN(u.budget.min) || Number.isNaN(u.budget.max)))
    note(s, "budget is NaN: " + JSON.stringify(u.budget));
  for (const w of u.bannedWords) {
    if (!w || !w.trim()) note(s, "banned an empty word");
    if (w.length === 1) note(s, "banned a single character: " + JSON.stringify(w));
  }
  for (const t2 of u.terms) if (!t2 || !t2.trim()) note(s, "kept an empty term");
  for (const a of u.attributes) {
    if (!E.FACETS.includes(a.facet)) note(s, "attribute on unknown facet: " + a.facet);
  }

  // the whole pipeline, not just the parse
  let res;
  try {
    res = E.search(s, null);
  } catch (err) {
    note(s, "search threw: " + err.message);
    continue;
  }
  if (!["answer", "need_more_evidence"].includes(res.status))
    note(s, "unknown status: " + res.status);
  if (res.candidates < 0 || res.candidates > E.CATALOG.length)
    note(s, "impossible candidate count: " + res.candidates);
  if (res.status === "need_more_evidence") {
    if (!res.options || !res.options.length) note(s, "asked with no options");
    if (res.candidates <= 12) note(s, "asked with only " + res.candidates + " candidates");
    if (res.options.some(o => o.count <= 0)) note(s, "offered an option nothing matches");
  }
  if (res.products.length > 24) note(s, "returned more than a page");

  // answering must terminate and must never widen the pool
  let guard = 0, prev = res.candidates;
  let st = { understood: res.understood, asked: res.asked, answers: res.answers,
    waived: res.waived, pendingFacet: res.facet };
  while (res.status === "need_more_evidence" && guard++ < 10) {
    const vals = r() < 0.2 ? ["no_preference"] : [pick(res.options).value];
    try {
      res = E.answer(st, vals);
    } catch (err) { note(s, "answer threw: " + err.message); break; }
    if (res.candidates > prev) note(s, "answering widened the pool " + prev + " -> " + res.candidates);
    prev = res.candidates;
    st = { understood: res.understood, asked: res.asked, answers: res.answers,
      waived: res.waived, pendingFacet: res.facet };
  }
  if (guard >= 10) note(s, "the conversation never settled");
  if ((res.asked || []).length > 3) note(s, "asked " + res.asked.length + " questions");
  const flat = (res.asked || []).filter(f => f !== "category");
  if (new Set(flat).size !== flat.length)
    note(s, "asked the same facet twice: " + JSON.stringify(res.asked));
}

fs.rmSync(SCRATCH, { force: true });
console.log("\n" + N + " fuzzed sentences, " + problems.length + " problems");
console.log("slowest parse " + slowest.ms.toFixed(1) + " ms: " +
  JSON.stringify(slowest.s.slice(0, 90)));
process.exit(problems.length ? 1 : 0);
