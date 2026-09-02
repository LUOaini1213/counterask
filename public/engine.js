// Counterask retrieval and stopping policy.
//
// Everything here runs in the tab. No server, no model call, no token spend:
// a shopper's phrasing never leaves the page, and an agent that drives the
// store gets the same answers a person does, from the same code path.
//
// The interesting part is decide(). Most storefronts answer every query.
// This one works out whether answering is the best move it has, and when it
// isn't, it hands back the question worth asking instead.

// Words that carry no product meaning. Note what is *not* here: "shirt",
// "shoe", "belt". An earlier version stopped-out "shirt" as too common, which
// made "t-shirt" tokenize to nothing at all and quietly return the entire
// catalog ranked by popularity. A word being frequent is what IDF is for.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'this', 'that', 'from',
  'are', 'was', 'will', 'can', 'has', 'have', 'all', 'any', 'not', 'but',
  'men', 'mens', "men's", 'size', 'sizes', 'made', 'great', 'perfect',
  'quality', 'need', 'want', 'looking', 'find', 'some', 'something', 'would',
  'like', 'please', 'best', 'new', 'top',
]);

// Shoppers type plurals; catalogues are written in the singular, and vice
// versa. "chinos" returned nothing at all until this existed.
export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes'))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  const raw = (text || '').toLowerCase();
  const out = new Set();

  // Hyphenated and apostrophised compounds carry meaning as a unit *and* as
  // parts: "t-shirt" has to survive as "tshirt" and as "shirt", because the
  // catalogue writes it both ways.
  for (const compound of raw.match(/[a-z0-9]+(?:[-'][a-z0-9]+)+/g) ?? []) {
    const joined = compound.replace(/[-']/g, '');
    if (joined.length > 2) out.add(stem(joined));
  }
  for (const word of raw.match(/[a-z0-9]+/g) ?? []) {
    if (word.length <= 2 || STOP.has(word)) continue;
    out.add(stem(word));
  }
  return [...out];
}

// Attributes the shopper already stated, lifted straight out of their words.
//
// Without this the store treats "waterproof hiking boots" as three keywords
// and can then turn around and ask whether it should be waterproof. Anything
// they have already said is a constraint, not a search term to be weighed.
export function extractConstraints(query, facetValues, facetForms = null) {
  const text = ` ${(query || '').toLowerCase()} `;
  const found = {};
  const escape = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

  for (const [facet, values] of Object.entries(facetValues)) {
    for (const value of values) {
      // A shopper says "waterproof"; the catalog records "water resistant".
      // Matching only the canonical value found nothing on half the phrasings
      // people actually use, so match every surface form the builder mapped
      // onto this value. Whole words only, so "casual" does not fire on
      // "casualwear" nor "snap" on "snapback".
      const forms = facetForms?.[facet]?.[value] ?? [value];
      const hit = forms.some((form) =>
        new RegExp(`(^|[^a-z])${escape(form)}([^a-z]|$)`).test(text));
      if (hit) (found[facet] ??= []).push(value);
    }
  }
  return found;
}

export class Catalog {
  constructor(payload) {
    this.meta = payload.meta;
    this.facetValues = payload.facetValues;
    this.facetForms = payload.facetForms ?? null;
    this.items = payload.items;
    this.byId = new Map(this.items.map((it) => [it.id, it]));

    // Both sides of the match go through the same stemmer. Doing it here
    // rather than in the build script is deliberate: one stemmer, one file,
    // so a query token and an index token can never be normalised differently.
    this.postings = new Map();
    const add = (tok, i) => {
      let list = this.postings.get(tok);
      if (!list) this.postings.set(tok, (list = []));
      if (list[list.length - 1] !== i) list.push(i);
    };

    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      // Tokenize the title here, with the very function queries go through.
      // The build script's own tokenizer split "V-Neck T-Shirt" into neck and
      // shirt while this one also yields vneck and tshirt, so a product could
      // be missing from the results for a query written out of its own title.
      // Moving the stemmer over was not enough; the split has to match too.
      const terms = new Set(tokenize(it.t));
      // Attribute evidence is searchable too. "waterproof hiking boots" should
      // find a boot the catalogue only calls waterproof in its bullet points,
      // not just one that spells it out in the title.
      for (const vals of Object.values(it.f)) {
        for (const v of vals) for (const w of tokenize(v)) terms.add(w);
      }
      it.terms = terms;
      for (const t of terms) add(t, i);
    }
    this.N = this.items.length;
  }

  idf(token) {
    const df = this.postings.get(token)?.length ?? 0;
    return Math.log((this.N + 1) / (df + 1));
  }

  // Candidates matching every active constraint, scored against the free text.
  search(query, constraints = {}) {
    const qTokens = tokenize(query);
    const facetKeys = Object.keys(constraints);

    // An attribute the shopper stated is not a preference to be traded off,
    // it is a fact about what they will accept.
    const passes = (it) => {
      for (const facet of facetKeys) {
        const have = it.f[facet];
        if (!have || !constraints[facet].some((w) => have.includes(w))) return false;
      }
      return true;
    };

    if (!qTokens.length) {
      return this.items.filter(passes)
        .map((it) => ({ item: it, score: popularity(it), matched: [] }))
        .sort((a, b) => b.score - a.score);
    }

    // Only visit documents that contain at least one query term. Scanning all
    // 9,901 items per keystroke was pure waste — the postings list exists.
    const candidates = new Set();
    for (const tok of qTokens) {
      for (const i of this.postings.get(tok) ?? []) candidates.add(i);
    }

    const hits = [];
    for (const i of candidates) {
      const it = this.items[i];
      if (!passes(it)) continue;
      let weight = 0;
      const matched = [];
      for (const tok of qTokens) {
        if (it.terms.has(tok)) { weight += this.idf(tok); matched.push(tok); }
      }
      if (matched.length) hits.push({ item: it, weight, matched });
    }

    // Every word the shopper typed is a requirement, not a hint: "leather
    // belt" must not return more rows than "belt". So take the conjunction
    // first, and only relax when it would leave too little to choose from —
    // the same rule the filter stage uses on stated attributes.
    const need = qTokens.length;
    let keep = hits.filter((h) => h.matched.length === need);
    if (keep.length < 8 && need > 1) {
      const floor = Math.max(1, Math.ceil(need * 0.6));
      keep = hits.filter((h) => h.matched.length >= floor);
    }
    if (!keep.length) keep = hits;

    for (const h of keep) {
      h.score = h.weight * (0.5 + 0.5 * (h.matched.length / need)) + 0.35 * popularity(h.item);
    }
    keep.sort((a, b) => b.score - a.score);
    return keep;
  }
}

// A frozen catalog has no click log, so demand is proxied by review volume.
// log-scaled, because the difference between 20 and 200 reviews means more
// than the difference between 20,000 and 20,200.
function popularity(it) {
  const n = it.n || 0;
  const r = it.r || 3.5;
  return (Math.log10(1 + n) / 5) * (r / 5);
}

// --- the stopping policy ------------------------------------------------

// What asking about a facet is actually worth: the share of the candidate
// pool the answer is expected to remove.
//
// Entropy is the textbook move here and it is wrong for this data, because a
// product carries several values of the same facet at once — a shoe is both
// "athletic" and "casual" — so the value shares do not form a distribution and
// -Σp·log p means nothing. Counting the expected survivors does work, needs no
// such assumption, and says something a shopper can read: answering this cuts
// the pool by about this much.
export function splitValue(pool, facet) {
  const counts = new Map();
  let covered = 0;
  for (const it of pool) {
    const vals = it.f[facet];
    if (!vals?.length) continue;
    covered++;
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size < 2 || !pool.length) return { gain: 0, coverage: 0, counts };

  // Coverage is the trap here. A facet only 3% of the pool records would
  // "remove 97% of candidates" — but it removes them for having no data, not
  // for failing the shopper's requirement. Missing is not a mismatch, so the
  // reduction is measured inside the covered subset and then scaled by how
  // much of the pool that subset is.
  const coverage = covered / pool.length;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let expectedSurvivors = 0;
  for (const c of counts.values()) expectedSurvivors += (c / total) * c;

  const reduction = 1 - expectedSurvivors / covered;
  return { gain: Math.max(0, coverage * reduction), coverage, counts };
}

// How far clear of the pack the leader is.
//
// The first version compared the top score with the runner-up. On this data
// that gap is almost always noise — median 0.003 across a 50-query sweep, and
// the "clear leader" branch fired once in fifty. Two near-identical products
// scoring within a rounding error of each other says nothing about whether the
// *leader* is distinctive; it says those two are twins.
//
// Comparing the leader with the tenth-placed candidate asks the question the
// policy actually cares about: is there one obvious answer here, or a crowd?
export function separation(scored) {
  if (scored.length < 2) return 1;
  const top = scored[0].score;
  if (top <= 0) return 0;
  const pack = scored[Math.min(9, scored.length - 1)].score;
  return Math.max(0, (top - pack) / top);
}

export const POLICY = {
  // Below this many candidates the shopper can just look at the list.
  answerBelow: 12,
  // A leader this far clear of the pack will survive any extra question.
  // Calibrated, not guessed: across a 50-query sweep separation runs
  // p50 0.016 / p90 0.026 / max 0.262, so the old 0.18 sat above every
  // observation but one and the branch was dead code.
  decisiveSeparation: 0.05,
  // Not worth spending a turn on a question that splits the pool this poorly.
  minGain: 0.12,
  // Below this, the facet is too sparsely recorded to ask about: most of the
  // pool would be dropped for missing data rather than for not matching.
  minCoverage: 0.45,
  // Never ask more than this many times in one session.
  maxAsks: 3,
};

/**
 * The whole point of Counterask.
 *
 * Returns either an answer (here are the products) or a question (this is the
 * one attribute worth knowing before I answer), plus the reasoning behind the
 * choice so both the shopper and the agent can see why.
 */
export function decide(catalog, scored, constraints, asksSoFar = 0) {
  const pool = scored.map((s) => s.item);
  const sep = separation(scored);

  const reasons = [];
  const enoughAlready = pool.length <= POLICY.answerBelow;
  const clearLeader = sep >= POLICY.decisiveSeparation;
  const outOfBudget = asksSoFar >= POLICY.maxAsks;

  if (!pool.length) {
    return { action: 'empty', pool, reasons: ['No product matches every stated requirement.'] };
  }
  if (enoughAlready) reasons.push(`${pool.length} candidates left — small enough to show.`);
  if (clearLeader) reasons.push(`Top match is ${(sep * 100).toFixed(0)}% clear of the runner-up.`);
  if (outOfBudget) reasons.push(`Already asked ${asksSoFar} questions — answering now.`);

  if (enoughAlready || clearLeader || outOfBudget) {
    return { action: 'answer', pool, separation: sep, reasons };
  }

  // Evidence is thin. Find the question that would separate the pool most.
  let best = null;
  for (const facet of catalog.meta.facets) {
    if (constraints[facet]) continue; // already known
    const { gain, coverage, counts } = splitValue(pool, facet);
    if (coverage < POLICY.minCoverage) continue;
    if (!best || gain > best.gain) best = { facet, gain, coverage, counts };
  }

  if (!best || best.gain < POLICY.minGain) {
    reasons.push('No remaining question would meaningfully reorder these results.');
    return { action: 'answer', pool, separation: sep, reasons };
  }

  const options = [...best.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  reasons.push(
    `${pool.length} candidates, leader only ${(sep * 100).toFixed(0)}% ahead.`,
    `Asking "${best.facet}" (recorded on ${(best.coverage*100).toFixed(0)}% of them) `
      + `removes ~${(best.gain*100).toFixed(0)}% on average.`,
  );

  return {
    action: 'ask',
    facet: best.facet,
    options,
    pool,
    gain: best.gain,
    separation: sep,
    reasons,
    question: phrase(best.facet, options),
  };
}

function phrase(facet, options) {
  const list = options.map((o) => o.value).slice(0, 4).join(', ');
  const q = {
    material: `What material are you after — ${list}?`,
    closure: `How should it fasten — ${list}?`,
    sleeve: `Which sleeve length — ${list}?`,
    fit: `What fit do you want — ${list}?`,
    care: `Any laundry preference — ${list}?`,
    origin: `Does origin matter — ${list}?`,
    sole: `What sole are you looking for — ${list}?`,
    occasion: `What is the occasion — ${list}?`,
    pocket: `Do you need ${list}?`,
    waterproof: `Should it be ${list}?`,
  }[facet];
  return q || `Which ${facet} — ${list}?`;
}
