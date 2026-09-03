/* Build public/catalog.js from a real catalog: the 9,901-item menswear slice of
   the frozen Amazon Reviews 2023 catalog (McAuley Lab, UCSD), as extracted by
   LUOaini1213/counterask. Emits the product shape the engine reads, plus the
   vocabulary the parser should use — the surface forms come from the data, not
   from a hand-written table.

   usage: node scripts/catalog_real.mjs /path/to/catalog.json */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

const src = process.argv.find(a => a.endsWith(".json"));
const backfill = !process.argv.includes("--no-backfill");
if (!src) { console.error("usage: node scripts/catalog_real.mjs <catalog.json> [--no-backfill]"); process.exit(2); }
const d = JSON.parse(fs.readFileSync(src, "utf8"));

const LABEL = {
  material: "material", closure: "closure", sleeve: "sleeve length", fit: "fit",
  care: "care", origin: "origin", sole: "sole", occasion: "what it's for",
  pocket: "pockets", waterproof: "weather"
};

// every facet the extractor knows. A single-value facet (waterproof, pockets)
// is never asked about — evidence() needs two options — but it is still a
// requirement a shopper can state and a refusal they can make.
const facets = d.meta.facets.slice();

// The category tree is data. A shopper's noun should match the category a
// product sits in, not only the words in its title — half of real titles do
// not name their category. Every node on the path is a value, so "shoes"
// matches all shoes and "running" the running ones: multi-valued on purpose.
const products = d.items.map(x => {
  const path = (x.c || []).map(c => c.toLowerCase());
  const attrs = Object.fromEntries(Object.entries(x.f || {}).filter(([f, v]) => facets.includes(f) && v && v.length));
  if (path.length) attrs.category = path;
  return {
    id: x.id, title: x.t, brand: x.b || "",
    family: path.length ? path[path.length - 1] : "item",
    attrs, price: x.p == null ? null : x.p, reviews: x.n || 0, rating: x.r || 0
  };
});
facets.push("category");

// surface forms: every form the extractor knew, mapped to its canonical value.
// Multi-word forms first happens in the engine; here we just collect.
const surface = {};
for (const f of facets) {
  surface[f] = {};
  for (const [value, forms] of Object.entries(d.facetForms[f] || {})) {
    for (const form of forms) surface[f][form.toLowerCase()] = value;
    surface[f][value.toLowerCase()] = value;
  }
}
// category surface forms, generated from the tree: the node name, each side
// of an "&", and singulars — "loafers & slip-ons" is said as loafers, loafer,
// slip-ons or slip-on.
surface.category = {};
const singular = (w) => w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("ses") || w.endsWith("xes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
const nodes = new Set();
for (const p of products) for (const c of (p.attrs.category || [])) nodes.add(c);
for (const node of nodes) {
  const forms = new Set([node]);
  for (const side of node.split(/\s*&\s*|\s*,\s*/)) {
    const t = side.trim(); if (!t) continue;
    forms.add(t);
    forms.add(t.split(" ").map((w, i, a) => i === a.length - 1 ? singular(w) : w).join(" "));
  }
  for (const f of forms) if (f.length > 2) surface.category[f] = node;
}
// ways of saying a category the tree does not spell out
Object.assign(surface.category, {
  "t-shirt": "t-shirts", tee: "t-shirts", tees: "t-shirts", tshirt: "t-shirts", tshirts: "t-shirts",
  sneaker: "fashion sneakers", trainers: "fashion sneakers", trainer: "fashion sneakers",
  "running shoe": "running", "running shoes": "running",
  "hiking boot": "hiking & trekking", "hiking boots": "hiking & trekking",
  watch: "wrist watches", watches: "wrist watches",
  cap: "baseball caps", caps: "baseball caps", hat: "hats & caps", hats: "hats & caps",
  loafer: "loafers & slip-ons", loafers: "loafers & slip-ons",
  "dress shoe": "oxfords", "dress shoes": "oxfords"
});
LABEL.category = "kind";

// a few things shoppers say that an extractor tuned on listings will not have
Object.assign(surface.occasion = surface.occasion || {}, {
  gym: "athletic", running: "athletic", workout: "athletic", sport: "athletic", sports: "athletic",
  hiking: "outdoor", hike: "outdoor", camping: "outdoor", trail: "outdoor",
  wedding: "formal", office: "formal", dressy: "formal", weekend: "casual", everyday: "casual"
});
if (surface.closure) Object.assign(surface.closure, {
  laces: "lace-up", lace: "lace-up", "lace up": "lace-up", zip: "zipper", zippered: "zipper", zips: "zipper",
  velcro: "hook and loop", buckles: "buckle", snaps: "snap", buttons: "button", "slip on": "pull-on", "slip-on": "pull-on"
});
if (surface.material) Object.assign(surface.material, { "full-grain": "leather", "full grain": "leather", steel: "stainless steel" });
if (surface.waterproof) Object.assign(surface.waterproof, { waterproof: "water resistant", rainproof: "water resistant", "water-resistant": "water resistant" });
if (surface.fit) Object.assign(surface.fit, { slim: "slim fit", relaxed: "relaxed fit", regular: "regular fit", baggy: "relaxed fit" });

/* Backfill from titles. The extractor read structured fields; titles say more
   — "Slip-on Sandal", "Long Sleeve", "Waterproof Hiking Boots". The engine
   already treats a title saying a value as that value; doing it at build time
   makes it explicit, counts it toward coverage, and lets the store ask about
   what the listings actually say. Category is never backfilled: it comes from
   the tree. A negated mention ("faux leather", "vegan leather") is skipped. */
const NEGATE = /\b(?:faux|vegan|synthetic|imitation|non|no|not|without|free)[- ]$/;
const backfilled = {};
if (backfill) {
  // longest forms first so "stainless steel" beats "steel"
  const forms = [];
  for (const f of facets) {
    if (f === "category") continue;
    for (const [form, value] of Object.entries(surface[f] || {})) forms.push({ f, form, value });
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  const rx = forms.map(x => ({ ...x, re: new RegExp("(^|[^a-z0-9])" + x.form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9])", "g") }));

  for (const p of products) {
    const t = p.title.toLowerCase();
    const claimed = [];   // [start, end] spans already read, so "leather" inside "faux leather" is not re-read
    for (const x of rx) {
      x.re.lastIndex = 0;
      let m;
      while ((m = x.re.exec(t))) {
        const start = m.index + m[1].length, end = start + x.form.length;
        if (claimed.some(([a, b]) => start < b && end > a)) continue;
        if (NEGATE.test(t.slice(Math.max(0, start - 12), start))) { claimed.push([start, end]); continue; }
        claimed.push([start, end]);
        const have = p.attrs[x.f] || [];
        if (!have.includes(x.value)) {
          p.attrs[x.f] = have.concat([x.value]);
          (p.fromTitle = p.fromTitle || {})[x.f] = (p.fromTitle[x.f] || []).concat([x.value]);
          backfilled[x.f] = (backfilled[x.f] || 0) + 1;
        }
      }
    }
  }
}

const meta = {
  source: d.meta.source, slice: d.meta.slice, count: products.length,
  facets, labels: Object.fromEntries(facets.map(f => [f, LABEL[f] || f])),
  surface
};

const out = `/* Catalog — ${products.length} real products. ${d.meta.source}.
   Generated by scripts/catalog_real.mjs; do not edit by hand. */
(function (root) {
  const CATALOG = ${JSON.stringify(products)};
  const CATALOG_META = ${JSON.stringify(meta)};
  if (typeof module !== "undefined" && module.exports) module.exports = { CATALOG, CATALOG_META };
  else { root.CATALOG = CATALOG; root.CATALOG_META = CATALOG_META; }
})(typeof window !== "undefined" ? window : globalThis);
`;
fs.writeFileSync(path.join(PUB, "catalog.js"), out);
const cov = {};
for (const f of facets) cov[f] = Math.round(products.filter(p => p.attrs[f]).length / products.length * 100) + "%";
console.log("wrote public/catalog.js: " + products.length + " products, " + (out.length / 1024).toFixed(0) + " KB");
console.log("facets:", facets.join(", "));
console.log("coverage:", JSON.stringify(cov));
console.log("priced:", Math.round(products.filter(p => p.price != null).length / products.length * 100) + "%");
if (backfill) console.log("backfilled from titles:", JSON.stringify(backfilled));
