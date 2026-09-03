/* Retrieval and ranking over a reading. Requirements are met by the recorded
   value or the title saying so; refusals exclude a recorded mismatch and never
   a missing one; unpriced products survive a budget and rank after. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory;
  else (root.CounteraskParts = root.CounteraskParts || {})["retrieval"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function (CATALOG, V) {
  "use strict";

  const { FACETS } = V;

  function has(product, facet, value) {
    if (facet === "brand") return product.brand === value;
    const vals = product.attrs[facet];
    return Array.isArray(vals) && vals.includes(value);
  }

  function anyFacetHas(product, value) {
    for (const f in product.attrs) if (Array.isArray(product.attrs[f]) && product.attrs[f].includes(value)) return true;
    return false;
  }

  function records(product, facet) {
    if (facet === "brand") return true;
    return Array.isArray(product.attrs[facet]) && product.attrs[facet].length > 0;
  }

  function retrieve(state) {
    const u = state.understood;
    const terms = u.terms;
    let pool = CATALOG;

    // Requirements, grouped by facet. Two values of one facet are alternatives,
    // not a conjunction — "a hiking boot for work" is outdoor *or* work, and
    // reading it as both empties the shelf.
    const wanted = new Map();
    for (const a of u.attributes) {
      if (!wanted.has(a.facet)) wanted.set(a.facet, []);
      wanted.get(a.facet).push(a.value);
    }
    // A requirement is met by the recorded value, or by the title saying so
    // outright. A boot the catalogue forgot to tag but that is called a Hiking
    // Boot is not a mismatch; a wallet that neither records linen nor says it
    // is one, is.
    // …or by any field recording the value: "athletic" is an occasion in the
    // vocabulary and a node in the category tree, and a product that carries
    // it in either place is what the shopper meant.
    for (const [facet, values] of wanted) {
      const said = u.attributes.filter(a => a.facet === facet).map(a => a.said);
      pool = pool.filter(p =>
        values.some(v => has(p, facet, v)) ||
        values.some(v => anyFacetHas(p, v)) ||
        values.some(v => titleHas(p, v)) ||
        said.some(w => titleHas(p, w)));
    }

    // refusals: a recorded mismatch excludes; missing does not. The banned word
    // is separately kept out of titles.
    for (const ex of u.exclusions) {
      if (ex.facet) pool = pool.filter(p => !has(p, ex.facet, ex.value));
    }
    for (const w of u.bannedWords) {
      const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      pool = pool.filter(p => !re.test(p.title));
    }

    // budget: priced-outside is out, unpriced survives and is ranked after
    if (u.budget) {
      pool = pool.filter(p => {
        if (p.price == null) return true;
        if (u.budget.max != null && p.price > u.budget.max) return false;
        if (u.budget.min != null && p.price < u.budget.min) return false;
        return true;
      });
    }

    // answers given to the store's own questions
    for (const ans of state.answers || []) {
      if (ans.value === "no_preference") continue;
      pool = pool.filter(p =>
        ans.values.some(v => has(p, ans.facet, v)) ||
        ans.values.some(v => titleHas(p, v)));
    }

    // Title terms narrow only if they leave something to look at. The mode is
    // decided once and then frozen on the reading: without that, answering a
    // question can shrink the strict set below the threshold, the filter drops
    // away, and the shopper watches the pool grow because they answered.
    // Leftover words filter only while the noun is unaccounted for. Once the
    // shopper's noun has been read as a category, the pool is already theirs,
    // and a stray word that happens to appear in a few titles must not cut it
    // down further — those words rank, they do not exclude. Without a
    // category tree the noun is a title word, and title words are the filter.
    const nounRead = u.attributes.some(a => a.facet === "category");
    if (terms.length && !nounRead) {
      if (!u.termMode) {
        const strict0 = pool.filter(p => terms.every(t => titleHas(p, t)));
        const loose0 = pool.filter(p => terms.some(t => titleHas(p, t)));
        u.termMode = strict0.length >= 4 ? "all" : (loose0.length >= 4 ? "any" : "none");
      }
      if (u.termMode === "all") pool = pool.filter(p => terms.every(t => titleHas(p, t)));
      else if (u.termMode === "any") pool = pool.filter(p => terms.some(t => titleHas(p, t)));
    }

    return pool;
  }

  // A shopper says "boots"; the catalog says "Boot". Neither is wrong.
  function titleHas(product, term) {
    const t = product.title.toLowerCase();
    if (t.includes(term)) return true;
    if (term.endsWith("es") && t.includes(term.slice(0, -2))) return true;
    if (term.endsWith("s") && t.includes(term.slice(0, -1))) return true;
    return t.includes(term + "s");
  }

  // Ranking weights, exposed so they can be swept rather than guessed at.
  const W = {
    term: 3, attrMatch: 1.2, attrUnrecorded: -0.9, attrInTitle: 0.8,
    demand: 0.7, rating: 0.4, unpricedUnderBudget: -1.2
  };

  function rank(pool, state) {
    const u = state.understood;
    const scored = pool.map(p => {
      let s = 0;
      for (const t of u.terms) if (titleHas(p, t)) s += W.term;
      for (const a of u.attributes) {
        if (has(p, a.facet, a.value)) s += W.attrMatch;
        else if (!records(p, a.facet)) s += W.attrUnrecorded;
        if (titleHas(p, a.said)) s += W.attrInTitle;
      }
      for (const ans of state.answers || []) {
        if (ans.values.some(v => has(p, ans.facet, v))) s += W.attrMatch;
        else if (!records(p, ans.facet)) s += W.attrUnrecorded;
      }
      s += Math.log10(p.reviews + 1) * W.demand;   // demand, log-scaled
      s += (p.rating - 4) * W.rating;
      if (p.price == null && u.budget) s += W.unpricedUnderBudget;
      return { p, s };
    });
    if (u.sort === "price-asc") scored.sort((a, b) => price(a.p) - price(b.p) || b.s - a.s);
    else if (u.sort === "price-desc") scored.sort((a, b) => price(b.p, -1) - price(a.p, -1) || b.s - a.s);
    else if (u.sort === "rating") scored.sort((a, b) => b.p.rating - a.p.rating || b.s - a.s);
    else if (u.sort === "demand") scored.sort((a, b) => b.p.reviews - a.p.reviews || b.s - a.s);
    else scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.p);
  }

  function price(p, missing) {
    return p.price == null ? (missing === -1 ? -1 : Infinity) : p.price;
  }
  return { W, has, records, titleHas, retrieve, rank };
});
