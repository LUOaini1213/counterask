/* One session generator for every benchmark, so every number in the README
   is measured on the same sentences. Before this each script carried its own
   copy and two of them had quietly drifted apart. */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
export const E = require(path.join(PUB, "engine.js"));
export { PUB };

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const SAY = {
  tuned: {
    budget: ["under $%d", "not over $%d", "less than $%d", "budget is $%d"],
    refuse: ["not %s", "no %s", "nothing with %s", "without %s"],
    open: ["I'm looking for", "I want", "show me", "do you have"]
  },
  holdout: {
    budget: ["max $%d", "I have %d dollars to spend", "no more than $%d", "up to $%d"],
    refuse: ["skip the %s", "avoid %s", "other than %s", "except %s"],
    open: ["I could use", "after", "hunting for", "need"]
  }
};

let VALUES = null;
function values() {
  if (VALUES) return VALUES;
  VALUES = {};
  const voc = E.attributeVocabulary();
  for (const f of E.FACETS) VALUES[f] = voc[f].map(x => x.value);
  return VALUES;
}

/* Build one case around a target product: a sentence a shopper could plausibly
   say about *that* product. Ground truth is self-supervised. */
export function makeCase(r, { holdout = false } = {}) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const say = holdout ? SAY.holdout : SAY.tuned;
  const target = pick(E.CATALOG);
  const parts = [pick(say.open), "a", target.family.toLowerCase()];

  const facets = E.FACETS.filter(f => target.attrs[f] && target.attrs[f].length);
  const stated = [];
  if (facets.length) {
    const f = pick(facets); const v = pick(target.attrs[f]);
    stated.push({ facet: f, value: v }); parts.push(v);
  }

  // refuse a value the target neither records nor names in its title — a
  // product called "Canvas Sneaker" is a correct casualty of "no canvas"
  let refusal = null;
  const rf = pick(["material", "closure"]);
  const title = target.title.toLowerCase();
  const missing = values()[rf].filter(v =>
    !(target.attrs[rf] || []).includes(v) && !title.includes(v.split(/[- ]/)[0]));
  if (missing.length && r() < 0.75) {
    refusal = { facet: rf, value: pick(missing) };
    parts.push(pick(say.refuse).replace("%s", refusal.value));
  }

  let budget = null;
  if (target.price != null && r() < 0.7) {
    budget = Math.ceil((target.price + 5 + r() * 40) / 5) * 5;
    parts.push(pick(say.budget).replace("%d", budget));
  }
  return { target, sentence: parts.join(" "), stated, refusal, budget };
}

/* A broad case: the shopper starts at a high node of the category tree —
   "shoes", "clothing", "a jacket" — with at most one attribute, and the store
   has to walk down. This is the shape a real session starts in, and the one
   the leaf-level benchmark cannot see. Only meaningful where the catalog has
   a category tree. */
export function makeBroadCase(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const withTree = E.CATALOG.filter(p => (p.attrs.category || []).length >= 2);
  const target = pick(withTree.length ? withTree : E.CATALOG);
  const path = target.attrs.category || [target.family];
  const depth = Math.min(path.length - 1, Math.floor(r() * 2));   // start at level 0 or 1
  const noun = path[depth];
  const parts = [pick(["I'm looking for", "show me", "I need", "do you have"]), noun];
  const stated = [];
  const facets = E.FACETS.filter(f => f !== "category" && target.attrs[f] && target.attrs[f].length);
  if (facets.length && r() < 0.6) {
    const f = pick(facets); const v = pick(target.attrs[f]);
    stated.push({ facet: f, value: v }); parts.push(v);
  }
  return { target, sentence: parts.join(" "), stated, refusal: null, budget: null, startDepth: depth };
}

export function broadSessions(n, { seed = 4242, engine = E } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = makeBroadCase(r);
    const { res, asked, turns } = converse(c, { engine });
    const at = res.allIds.indexOf(c.target.id);
    const catAsks = (res.asked || []).filter(f => f === "category").length;
    out.push({ c, res, asked, turns, ms: 0, rank: at, hit10: at >= 0 && at < 10 ? 1 : 0,
      hit1: at === 0 ? 1 : 0, rr: at >= 0 ? 1 / (at + 1) : 0, survived: at >= 0 ? 1 : 0,
      pool: res.allIds.length, catAsks });
  }
  return out;
}

/* Run the store the way an agent would: answer every question truthfully,
   from the target's own record; "no preference" when it has none. */
export function converse(c, { maxTurns = 8, engine = E } = {}) {
  let res = engine.search(c.sentence, null);
  let asked = 0;
  while (res.status === "need_more_evidence" && asked < maxTurns) {
    asked++;
    const have = c.target.attrs[res.facet];
    const vals = have && have.length ? have.filter(v => res.options.some(o => o.value === v)) : [];
    res = engine.answer({ understood: res.understood, asked: res.asked, answers: res.answers,
      waived: res.waived, pendingFacet: res.facet }, vals.length ? vals : ["no_preference"]);
  }
  return { res, asked, turns: asked + 1 };
}

/* One pass over n cases, returning per-session records; scorers below. */
export function sessions(n, { seed = 4242, holdout = false, engine = E } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = makeCase(r, { holdout });
    const t0 = process.hrtime.bigint();
    const { res, asked, turns } = converse(c, { engine });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const at = res.allIds.indexOf(c.target.id);
    out.push({ c, res, asked, turns, ms, rank: at, hit10: at >= 0 && at < 10 ? 1 : 0,
      hit1: at === 0 ? 1 : 0, rr: at >= 0 ? 1 / (at + 1) : 0,
      survived: at >= 0 ? 1 : 0, pool: res.allIds.length });
  }
  return out;
}

export function score(rows) {
  const n = rows.length;
  const mean = (k) => rows.reduce((a, x) => a + x[k], 0) / n;
  return {
    n, hit10: mean("hit10"), hit1: mean("hit1"), mrr: mean("rr"),
    turns: mean("turns"), asked: mean("asked"), pool: mean("pool"),
    survived: mean("survived"), ms: mean("ms"),
    // Hit@10 if order inside the final pool were a coin flip
    ceiling: rows.reduce((a, x) => a + (x.survived ? Math.min(10, x.pool) / x.pool : 0), 0) / n
  };
}

export const f3 = (x) => x.toFixed(3);

/* Shards: the same rows cut into k equal slices, scored separately, so every
   figure comes with the spread the third decimal has to survive. */
export function shards(rows, k = 8) {
  const size = Math.floor(rows.length / k);
  const per = [];
  for (let i = 0; i < k; i++) per.push(score(rows.slice(i * size, (i + 1) * size)));
  const keys = Object.keys(per[0]).filter(x => x !== "n");
  const out = {};
  for (const key of keys) {
    const v = per.map(p => p[key]);
    const mean = v.reduce((a, b) => a + b, 0) / k;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1));
    out[key] = { mean, sd, se: sd / Math.sqrt(k), min: Math.min(...v), max: Math.max(...v) };
  }
  return { k, per, ...out };
}

/* Paired comparison: two configurations on the same shards. The delta's
   spread across shards is what decides whether a difference is real. */
export function paired(rowsA, rowsB, k = 8, key = "hit10") {
  const a = shards(rowsA, k).per.map(p => p[key]);
  const b = shards(rowsB, k).per.map(p => p[key]);
  const d = a.map((x, i) => b[i] - x);
  const mean = d.reduce((x, y) => x + y, 0) / k;
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / (k - 1));
  const se = sd / Math.sqrt(k);
  const wins = d.filter(x => x > 0).length;
  return { mean, sd, se, t: se ? mean / se : 0, wins, k, deltas: d };
}

export const pm = (m, sd, digits = 3) => m.toFixed(digits) + " \u00b1 " + sd.toFixed(digits);
