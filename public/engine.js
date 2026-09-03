/* Engine — assembles the parts and exposes the one entry point both surfaces
   use. In the browser the parts are loaded first as classic scripts; in Node
   they are required. No model call, no server. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    const cat = require("./catalog.js");
    module.exports = factory(cat.CATALOG, cat.CATALOG_META || null, {
      vocabulary: require("./engine/vocabulary.js"),
      parser: require("./engine/parser.js"),
      retrieval: require("./engine/retrieval.js"),
      policy: require("./engine/policy.js")
    });
  } else {
    root.Engine = factory(root.CATALOG, root.CATALOG_META || null, root.CounteraskParts);
  }
})(typeof window !== "undefined" ? window : globalThis, function (CATALOG, META, parts) {
  "use strict";

  const V = parts.vocabulary(META);
  const BRANDS = Array.from(new Set(CATALOG.map(p => p.brand)));
  const { parse, PASSES } = parts.parser(V, BRANDS);
  const R = parts.retrieval(CATALOG, V);
  const { retrieve, rank, W } = R;
  const { P, evidence, decide, differentiators, relaxations, budgetLabel } = parts.policy(V, R);
  const { FACETS, FACET_LABEL } = V;

  /* ---------- the one entry point both surfaces use ----------------------- */

  function search(sentence, state, structured) {
    const understood = parse(sentence);
    const retraction = understood.retraction;

    // The agent's knowledge wins — except where the shopper has just taken it
    // back. A reset drops everything carried in; a scoped change drops what it
    // names and anything on a facet it has just restated. The store records what
    // it dropped, so the agent can see the change was heard rather than quietly
    // ignored.
    if (structured) {
      const drop = new Set(((retraction && retraction.drops) || []).map(d => String(d).toLowerCase()));
      const wipe = !!retraction && retraction.kind === "reset";
      const restated = new Set(understood.attributes.map(a => a.facet));

      for (const a of structured.attributes || []) {
        const v = String(a.value).toLowerCase();
        if (wipe || drop.has(v) || (retraction && restated.has(a.facet))) {
          understood.superseded.push({ facet: a.facet, value: a.value });
          continue;
        }
        if (!understood.attributes.find(x => x.facet === a.facet && x.value === a.value))
          understood.attributes.push({ facet: a.facet, value: a.value, said: a.value, fromAgent: true });
      }
      for (const e of structured.exclusions || []) {
        const v = String(e.value).toLowerCase();
        if (wipe || drop.has(v)) {
          understood.superseded.push({ facet: e.facet || null, value: e.value, wasRefusal: true });
          continue;
        }
        understood.exclusions.push({ facet: e.facet || null, value: e.value, said: e.value, fromAgent: true });
        if (!e.facet) understood.bannedWords.push(v);
      }
      if (structured.budget) {
        if (wipe) understood.superseded.push({ facet: "budget", value: budgetLabel(structured.budget) });
        else understood.budget = understood.budget || structured.budget;
      }
      if (structured.no_preference && !wipe) understood.waived.push(...structured.no_preference);
    }

    // A reset also spends the question budget again — it is a new conversation.
    const carry = state && state.keepAsked && !(retraction && retraction.kind === "reset");
    const next = {
      understood,
      asked: carry ? state.asked : [],
      answers: carry ? state.answers : [],
      waived: carry ? state.waived : []
    };
    return finish(next);
  }

  function finish(state) {
    const pool = retrieve(state);
    state.lastCount = pool.length;
    const ranked = rank(pool, state);
    const verdict = decide(pool, state);

    const result = {
      status: verdict.status,
      candidates: pool.length,
      understood: state.understood,
      asked: state.asked,
      answers: state.answers,
      waived: state.waived,
      why: verdict.why,
      products: ranked.slice(0, 24),
      allIds: ranked.map(p => p.id)
    };

    if (verdict.status === "need_more_evidence") {
      result.question = verdict.question;
      result.facet = verdict.facet;
      result.options = verdict.options;
      result.note = "Answering now would be a guess. Put this question to the shopper, then call answer_question.";
      result.products = ranked.slice(0, 24);
    } else {
      result.differentiators = differentiators(ranked.slice(0, 24));
    }

    if (pool.length < 4) result.relax = relaxations(state);
    return result;
  }

  function answer(state, values) {
    const facet = state.pendingFacet;
    if (!facet) return null;
    const vals = Array.isArray(values) ? values : [values];
    state.asked = (state.asked || []).concat([facet]);
    if (vals.length === 1 && vals[0] === "no_preference") {
      state.waived = (state.waived || []).concat([facet]);
    } else {
      state.answers = (state.answers || []).concat([{ facet, values: vals }]);
    }
    return finish(state);
  }

  function attributeVocabulary() {
    const out = {};
    for (const f of FACETS) {
      const counts = new Map();
      for (const p of CATALOG) for (const v of (p.attrs[f] || [])) counts.set(v, (counts.get(v) || 0) + 1);
      out[f] = Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    }
    return out;
  }

  return {
    CATALOG, FACETS, FACET_LABEL, parse, PASSES, search, finish, answer, retrieve, rank,
    evidence, decide, differentiators, relaxations, attributeVocabulary,
    budgetLabel, weights: W, policy: P, META, byId: (id) => CATALOG.find(p => p.id === id)
  };
});
