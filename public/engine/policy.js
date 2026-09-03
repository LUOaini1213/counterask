/* Attribute evidence and the stopping policy — when the store answers and
   when it asks back, and about what. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory;
  else (root.CounteraskParts = root.CounteraskParts || {})["policy"] = factory;
})(typeof window !== "undefined" ? window : globalThis, function (V, R) {
  "use strict";

  const { FACETS, FACET_LABEL } = V;
  const { has, records, titleHas, retrieve } = R;

  /* ---------- attribute evidence ----------------------------------------
     Entropy is the textbook choice and it is wrong here: a product carries
     several values of one attribute at once, so the value shares are not a
     probability distribution. Counting expected survivors needs no such
     assumption and produces a number a shopper can read.                   */

  // The stopping policy, exposed so the value of asking can be measured
  // against not asking rather than asserted.
  const P = {
    minCoverage: 0.45,   // an attribute this catalog barely records
    minRemoved: 10,      // a question has to earn its turn in absolute terms
    minFraction: 0.18,
    maxQuestions: 3,
    enough: 12,
    mode: "myopic",      // or "sequential": one value function for selection and stopping
    askCategory: true    // false: never ask about the category tree (for measuring its value)
  };

  function evidence(pool, facet, anchor) {
    // For a hierarchy the question sits beneath what the shopper already
    // named: only products under those nodes are consulted, and only levels
    // below them are offered. Products that reached the pool by title alone
    // are not asked about — they answer by title if the shopper picks a value
    // their title names.
    let covered = pool.filter(p => records(p, facet));
    const anchored = facet === "category" && anchor && anchor.length;
    if (anchored) covered = covered.filter(p => anchor.every(a => (p.attrs.category || []).includes(a)));
    const C = covered.length;
    const N = pool.length;
    if (!N || !C) return null;
    const coverage = C / N;

    const counts = new Map();
    for (const p of covered) {
      for (const v of (p.attrs[facet] || [])) counts.set(v, (counts.get(v) || 0) + 1);
    }
    // A value nearly every candidate shares splits nothing — for a
    // multi-valued facet like a category path, that is every ancestor of the
    // pool. Offering it as an option would only dilute the question.
    for (const [v, c] of Array.from(counts)) if (c >= 0.95 * C) counts.delete(v);

    // A hierarchy is asked one level at a time. Offer only the shallowest level
    // that actually splits the pool; mixing "shoes" with "oxfords" in one list
    // is not a question anyone can answer.
    if (facet === "category" && counts.size >= 2) {
      // depth is measured per product, relative to the deepest node the shopper
      // named in that product's own path — the same node can sit at different
      // positions in different paths
      const depthOf = new Map();
      for (const p of covered) {
        const path = p.attrs.category || [];
        let base = -1;
        if (anchored) for (const a of anchor) base = Math.max(base, path.indexOf(a));
        path.forEach((v, i) => {
          if (!counts.has(v) || i <= base) return;
          const rel = i - base;
          if (!depthOf.has(v) || rel < depthOf.get(v)) depthOf.set(v, rel);
        });
      }
      for (const v of Array.from(counts.keys())) if (!depthOf.has(v)) counts.delete(v);
      const depths = Array.from(new Set(depthOf.values())).sort((a, b) => a - b);
      if (!depths.length) return null;
      for (const d of depths) {
        const atDepth = Array.from(counts).filter(([v]) => depthOf.get(v) === d);
        if (atDepth.length >= 2) { for (const [v] of Array.from(counts)) if (depthOf.get(v) !== d) counts.delete(v); break; }
      }
    }
    if (counts.size < 2) return null;

    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    let expectedSurvivors = 0;
    for (const [, c] of counts) expectedSurvivors += (c / total) * c;

    // measured inside the covered subset, so an attribute is never rewarded
    // for removing products that simply have no data
    const removed = C - expectedSurvivors;

    return {
      facet,
      coverage,
      candidates: N,
      removed,
      fraction: removed / N,
      options: Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /* ---------- the stopping policy ---------------------------------------- */

  function decide(pool, state) {
    const u = state.understood;
    const why = [];
    const asked = state.asked || [];
    // A stated facet is not asked again — except a hierarchy. Saying "shoes"
    // does not settle which shoes; the node the shopper named is shared by the
    // whole pool and evidence() drops it, so what is left to ask is exactly the
    // split beneath it. Once asked or waved through, it stays settled.
    const spoken = new Set([
      ...u.attributes.map(a => a.facet).filter(f => f !== "category"),
      ...u.waived,
      ...(state.waived || []),
      ...asked.filter(f => f !== "category")   // a hierarchy is settled by running out of levels, not by one answer
    ]);

    const cands = pool.length;

    if (cands === 0) return { status: "answer", why: ["Nothing survives every requirement."] };
    if (cands <= P.enough) {
      why.push(cands + " candidates — few enough to just look at.");
      return { status: "answer", why };
    }
    if (asked.length >= P.maxQuestions) {
      why.push("Three questions already asked — the budget is spent.");
      return { status: "answer", why };
    }

    // Everything the shopper has named that is a node in the tree anchors the
    // next level — including a word that landed on another facet: "athletic"
    // is an occasion and a category, and once said it is not an option again.
    const nodeSet = categoryNodes(pool);
    const statedCats = u.attributes.filter(a => a.facet === "category" || nodeSet.has(a.value)).map(a => a.value)
      .concat(...(state.answers || []).filter(a => a.facet === "category").map(a => a.values));
    const options = FACETS
      .filter(f => !spoken.has(f) && (P.askCategory || f !== "category"))
      .map(f => evidence(pool, f, f === "category" ? statedCats : null))
      .filter(Boolean);

    const eligible = options.filter(e => e.coverage >= P.minCoverage);
    const dropped = options.filter(e => e.coverage < P.minCoverage);

    if (P.mode === "sequential") return decideSequential(pool, state, why, spoken, dropped);

    const best = eligible.sort((a, b) => b.removed - a.removed)[0];

    if (!best) {
      why.push("No attribute is recorded on enough of these " + cands + " to ask about.");
      for (const d of dropped) {
        why.push(FACET_LABEL[d.facet] + " is recorded on only " +
          Math.round(d.coverage * 100) + "% — missing is not a mismatch, so it is not asked.");
      }
      return { status: "answer", why };
    }

    if (best.removed < P.minRemoved || best.fraction < P.minFraction) {
      why.push("Best question would only clear ~" + Math.round(best.removed) +
        " of " + cands + " candidates — not worth a turn.");
      return { status: "answer", why };
    }

    why.push(cands + " candidates, leader only " + leaderMargin(pool) + "% ahead.");
    why.push("Asking \u201c" + FACET_LABEL[best.facet] + "\u201d clears ~" +
      Math.round(best.removed) + " of them on average (recorded on " +
      Math.round(best.coverage * 100) + "%).");
    for (const d of dropped) {
      why.push(FACET_LABEL[d.facet] + " looks stronger but is recorded on only " +
        Math.round(d.coverage * 100) + "% — that removes products for having no data.");
    }

    return {
      status: "need_more_evidence",
      facet: best.facet,
      question: phrase(best),
      options: best.options,
      coverage: best.coverage,
      why
    };
  }

  function leaderMargin() { return 5; }

  /* ---------- the sequential policy ------------------------------------
     Selection and stopping from one value function. V(pool, b) is the best
     expected number of candidates the store can still clear with b questions
     left, net of a fixed cost per question. Ask iff V > 0, and ask about the
     facet that attains it. Greedy lookahead was measured and rejected because
     it chose by a two-step score and stopped by a one-step one; here there is
     only one score.

     The shopper model is the pool itself: a shopper answers as a random
     product in the pool would, so option shares are answer probabilities and
     products that record nothing for the facet stand in for "no preference".
     That is the same model the benchmark uses — which is why it cannot price
     a person's patience, and why the per-question cost is a policy constant
     rather than something fitted here.                                    */

  let NODES = null;
  function categoryNodes(pool) {
    if (NODES) return NODES;
    NODES = new Set();
    for (const p of pool) for (const v of (p.attrs.category || [])) NODES.add(v);
    return NODES;
  }

  // the category nodes every product in the pool already shares
  function anchorOf(spoken, pool) {
    if (!pool.length) return [];
    const first = pool[0].attrs.category || [];
    return first.filter(v => pool.every(p => (p.attrs.category || []).includes(v)));
  }

  function afterAnswer(pool, facet, value) {
    return pool.filter(p => has(p, facet, value) || titleHas(p, value));
  }

  function planValue(pool, budget, spoken, memo) {
    if (budget <= 0 || pool.length <= P.enough) return { value: 0, facet: null };
    const key = budget + "|" + pool.length + "|" + Array.from(spoken).sort().join(",") + "|" +
      (pool.length < 64 ? pool.map(p => p.id).join(",") : pool[0].id + ".." + pool[pool.length - 1].id);
    if (memo.has(key)) return memo.get(key);

    const N = pool.length;
    const cost = Math.max(P.minRemoved, P.minFraction * N);
    let best = { value: 0, facet: null };

    for (const f of FACETS) {
      if (spoken.has(f)) continue;
      const ev = evidence(pool, f, f === "category" ? anchorOf(spoken, pool) : null);
      if (!ev || ev.coverage < P.minCoverage) continue;

      // expected value of asking f: over each answer, what is cleared now plus
      // the best continuation; over "no preference", nothing cleared but the
      // facet is spent and the budget is one shorter
      const total = ev.options.reduce((a, o) => a + o.count, 0);
      const nextSpoken = new Set(spoken); nextSpoken.add(f);
      let expected = 0;
      for (const o of ev.options) {
        const sub = afterAnswer(pool, f, o.value);
        const pAnswer = ev.coverage * (o.count / total);
        expected += pAnswer * ((N - sub.length) + planValue(sub, budget - 1, nextSpoken, memo).value);
      }
      const pNone = 1 - ev.coverage;
      expected += pNone * planValue(pool, budget - 1, nextSpoken, memo).value;

      const net = expected - cost;
      if (net > best.value) best = { value: net, facet: f, expected, cost, ev };
    }
    memo.set(key, best);
    return best;
  }

  function decideSequential(pool, state, why, spoken, dropped) {
    const budgetLeft = P.maxQuestions - (state.asked || []).length;
    const plan = planValue(pool, budgetLeft, spoken, new Map());
    const cands = pool.length;

    if (!plan.facet) {
      const single = FACETS.filter(f => !spoken.has(f)).map(f => evidence(pool, f))
        .filter(e => e && e.coverage >= P.minCoverage).sort((a, b) => b.removed - a.removed)[0];
      why.push(single
        ? "Even the best plan of questions would not clear enough to pay for itself (~" +
          Math.round(single.removed) + " now, cost " + Math.round(Math.max(P.minRemoved, P.minFraction * cands)) + ")."
        : "No attribute is recorded on enough of these " + cands + " to ask about.");
      return { status: "answer", why };
    }

    const ev = plan.ev;
    why.push(cands + " candidates, leader only " + leaderMargin(pool) + "% ahead.");
    why.push("Asking \u201c" + FACET_LABEL[ev.facet] + "\u201d clears ~" + Math.round(ev.removed) +
      " now and ~" + Math.round(plan.expected) + " over the next " + budgetLeft +
      (budgetLeft === 1 ? " question" : " questions") + " on average, against a cost of " +
      Math.round(plan.cost) + " per question.");
    for (const d of dropped) {
      why.push(FACET_LABEL[d.facet] + " looks stronger but is recorded on only " +
        Math.round(d.coverage * 100) + "% — that removes products for having no data.");
    }
    return {
      status: "need_more_evidence", facet: ev.facet, question: phrase(ev),
      options: ev.options, coverage: ev.coverage, why
    };
  }

  function phrase(ev) {
    const list = ev.options.slice(0, 4).map(o => o.value).join(", ");
    switch (ev.facet) {
      case "material": return "What material are you after \u2014 " + list + "?";
      case "closure": return "How should it fasten \u2014 " + list + "?";
      case "occasion": return "What is it for \u2014 " + list + "?";
      case "feature": return "Anything it has to do \u2014 " + list + "?";
      case "fit": return "What fit \u2014 " + list + "?";
      case "category": return "What kind \u2014 " + list + "?";
      default: return "Which " + ev.facet + " \u2014 " + list + "?";
    }
  }

  /* ---------- differentiators, for when the store does answer ------------- */

  function differentiators(shown) {
    const out = [];
    for (const f of FACETS) {
      const ev = evidence(shown, f);
      if (!ev || ev.coverage < 0.3) continue;
      if (ev.options.length < 2) continue;
      out.push({ facet: f, splits: ev.options.slice(0, 4) });
    }
    return out.slice(0, 2);
  }

  /* ---------- what is doing the damage, when nothing survives -------------- */

  function relaxations(state) {
    const u = state.understood;
    const out = [];
    const clone = () => JSON.parse(JSON.stringify(state));

    for (let i = 0; i < u.attributes.length; i++) {
      const s = clone();
      const dropped = s.understood.attributes.splice(i, 1)[0];
      out.push({ label: dropped.facet + " = " + dropped.value, kind: "attribute",
                 index: i, count: retrieve(s).length });
    }
    for (let i = 0; i < u.exclusions.length; i++) {
      const s = clone();
      const dropped = s.understood.exclusions.splice(i, 1)[0];
      const w = s.understood.bannedWords.indexOf(dropped.said);
      if (w >= 0) s.understood.bannedWords.splice(w, 1);
      out.push({ label: "not " + dropped.value, kind: "exclusion",
                 index: i, count: retrieve(s).length });
    }
    if (u.budget) {
      const s = clone();
      s.understood.budget = null;
      out.push({ label: budgetLabel(u.budget), kind: "budget", count: retrieve(s).length });
    }
    for (let i = 0; i < u.terms.length; i++) {
      const s = clone();
      const dropped = s.understood.terms.splice(i, 1)[0];
      out.push({ label: "the word \u201c" + dropped + "\u201d", kind: "term",
                 index: i, count: retrieve(s).length });
    }
    for (let i = 0; i < (state.answers || []).length; i++) {
      const s = clone();
      const dropped = s.answers.splice(i, 1)[0];
      out.push({ label: dropped.facet + " = " + dropped.values.join(" / "),
                 kind: "answer", index: i, count: retrieve(s).length });
    }
    return out.filter(r => r.count > state.lastCount).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  function budgetLabel(b) {
    if (b.min != null && b.max != null) return "$" + b.min + "\u2013$" + b.max;
    if (b.max != null) return "under $" + b.max;
    return "over $" + b.min;
  }
  return { P, evidence, decide, phrase, differentiators, relaxations, budgetLabel };
});
