/* The tool surface as data, and the registration that keeps answer_question
   in step with the open question. */
(function (App) {
  "use strict";
  const { S, $, el, mc, live, E } = App;
  /* ---------- tools ------------------------------------------------------ */

  let answerController = null;
  const baseController = new AbortController();

  // Registration that survives the spec's edges: a native implementation may
  // throw on a duplicate name, may honour the AbortSignal, or may only expose
  // unregisterTool. Do the safe thing under all three.
  function safeRegister(def, controller) {
    try {
      const r = mc.registerTool(def, { signal: controller.signal });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch (err) {
      if (typeof mc.unregisterTool === "function") {
        try { mc.unregisterTool(def.name); } catch (e) { /* not registered */ }
        try { mc.registerTool(def, { signal: controller.signal }); }
        catch (e2) { console.warn("registerTool failed for " + def.name, e2); }
      } else {
        console.warn("registerTool failed for " + def.name, err);
      }
    }
  }
  function safeUnregister(name, controller) {
    controller.abort();   // the spec's own way to remove a tool
    if (typeof mc.unregisterTool === "function") {
      try { mc.unregisterTool(name); } catch (e) { /* already gone via the signal */ }
    }
  }

  function syncTools() {
    const open = !!S.pendingFacet;
    if (open && !answerController) {
      answerController = new AbortController();
      safeRegister({
        name: "answer_question",
        title: "Answer the store's question",
        description: "Answer the question the store just asked. Pass one or more option " +
          "values, or no_preference — which is remembered and never asked about again.",
        inputSchema: {
          type: "object",
          properties: {
            values: { type: "array", items: { type: "string" },
              description: "Option values, or the single value no_preference." }
          },
          required: ["values"]
        },
        execute: async (input) => {
          const out = App.doAnswer(input.values);
          App.logCall("answer_question", input, out);
          return App.wrap(out);
        }
      }, answerController);
    } else if (!open && answerController) {
      safeUnregister("answer_question", answerController);
      answerController = null;
    }
    App.renderTools();
  }


  /* ---------- the tool surface, as data ----------------------------------
     Every tool is one row: name, what it does, its schema, whether it only
     reads, and a handler that returns a plain object. Registration, logging,
     MCP shaping and the on-page tool list all read this table; a tool cannot
     be registered without a description, and the tests iterate the same rows.
     answer_question is the one exception — it comes and goes with the open
     question and is registered in syncTools. */

  const TOOLS = [
    {
      name: "search_products",
      title: "Search the store",
      description: "Search this menswear catalog. Pass the shopper's request in their own " +
        "words — refusals, budget and all. Returns products, or a question when answering " +
        "would be a guess. Anything you already know can be passed structured and will " +
        "override the parse.",
      input: {
        query: { type: "string", description: "The shopper's request, verbatim." },
        attributes: { type: "array", items: { type: "object" }, description: "Known requirements as {facet, value}." },
        exclusions: { type: "array", items: { type: "object" }, description: "Known refusals as {facet, value}." },
        budget: { type: "object", description: "{min, max} in dollars." },
        no_preference: { type: "array", items: { type: "string" }, description: "Facets the shopper has said they do not mind." }
      },
      required: ["query"],
      run: (input) => App.doSearch(input.query, input)
    },
    {
      name: "parse_only",
      title: "See how the store would read a sentence",
      description: "A dry run. Returns how the store would read the shopper's words — " +
        "what it takes as a requirement, a refusal, a budget, an ordering, a change of " +
        "mind, and what it ignores — without searching or changing anything. Use it to " +
        "check the reading before you commit, or to show the shopper what was heard.",
      input: { query: { type: "string", description: "The shopper's request, verbatim." } },
      required: ["query"],
      readOnly: true,
      run: (input) => {
        const u = E.parse(input.query || "");
        return {
          query: u.query,
          attributes: u.attributes.map(a => ({ facet: a.facet, value: a.value, said: a.said })),
          exclusions: u.exclusions.map(e => ({ facet: e.facet, value: e.value, said: e.said })),
          budget: u.budget, sort: u.sort, no_preference: u.waived,
          retraction: u.retraction, conflicts: u.conflicts, ignored: u.ignored, title_words: u.terms,
          // the audit: which words were read by which pass as what, in the
          // order the passes ran
          trace: u.claims,
          note: "Nothing was searched. Call search_products to act on this reading, or pass " +
            "the parts you agree with as structured input."
        };
      }
    },
    {
      name: "refine_search",
      title: "Add one requirement or one refusal",
      description: "Narrow the current search by one attribute value, or rule one out.",
      input: {
        require: { type: "string", description: "An attribute value to require." },
        refuse: { type: "string", description: "An attribute value or word to rule out." }
      },
      run: (input) => App.doRefine(input)
    },
    {
      name: "revise_search",
      title: "Take something back",
      description: "The shopper changed their mind. Drop one thing they had said — an " +
        "attribute value, a refusal, an answer, a facet name, or \"budget\" — and keep " +
        "the rest. Pass drop_all to start the request over; the cart is kept. The store " +
        "reports what it dropped so you can tell the shopper it heard them.",
      input: {
        drop: { type: "array", items: { type: "string" }, description: "Values, facet names, or \"budget\" to take back." },
        drop_all: { type: "boolean", description: "Take the whole request back." }
      },
      run: (input) => App.doRefine({ drop: input.drop, drop_all: input.drop_all })
    },
    {
      name: "list_attributes",
      title: "The vocabulary this catalog carries",
      description: "Every attribute value in the catalog, with how many products record it.",
      input: {},
      readOnly: true,
      run: () => ({ catalog_size: E.CATALOG.length, attributes: E.attributeVocabulary() })
    },
    {
      name: "show_products",
      title: "Put your own picks in the grid",
      description: "Replace the grid with the ids you picked, in your order.",
      input: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
      run: (input) => {
        S.curated = (input.ids || []).map(E.byId).filter(Boolean);
        App.render();
        App.persist();
        return { status: "showing", count: S.curated.length };
      }
    },
    {
      name: "explain_ranking",
      title: "Why this product is where it is",
      description: "Which words matched, whether the whole request matched, and the demand signal.",
      input: { id: { type: "string" } },
      required: ["id"],
      readOnly: true,
      run: (input) => {
        const p = E.byId(input.id);
        if (!p) return { error: "No such product." };
        const u = S.understood || { terms: [], attributes: [], exclusions: [] };
        return {
          id: p.id, title: p.title,
          matched_words: u.terms.filter(t => p.title.toLowerCase().includes(t)),
          matched_attributes: u.attributes.filter(a => (p.attrs[a.facet] || []).includes(a.value))
            .map(a => a.facet + " = " + a.value),
          unrecorded_attributes: u.attributes.filter(a => !p.attrs[a.facet])
            .map(a => a.facet + " (not recorded \u2014 kept, ranked after)"),
          demand: { reviews: p.reviews, rating: p.rating,
            note: "Demand is proxied by log-scaled review volume; a frozen catalog has no click log." },
          price: p.price == null ? "not listed" : "$" + p.price,
          questions_asked: S.asked, question_budget_left: Math.max(0, 3 - S.asked.length)
        };
      }
    },
    {
      name: "add_to_cart",
      title: "Add to cart",
      description: "Add a product to the cart by id.",
      input: { id: { type: "string" }, quantity: { type: "number" } },
      required: ["id"],
      run: (input) => {
        const p = E.byId(input.id);
        if (!p) return { error: "No such product." };
        const qty = Math.max(1, Math.round(input.quantity || 1));
        const line = S.cart.find(l => l.id === p.id);
        if (line) line.qty += qty; else S.cart.push({ id: p.id, qty });
        App.renderCart();
        return App.cartView();
      }
    },
    {
      name: "remove_from_cart",
      title: "Remove from cart",
      description: "Remove a product from the cart by id.",
      input: { id: { type: "string" } },
      required: ["id"],
      run: (input) => { S.cart = S.cart.filter(l => l.id !== input.id); App.renderCart(); return App.cartView(); }
    },
    {
      name: "view_cart",
      title: "See the cart",
      description: "The cart, with line totals.",
      input: {},
      readOnly: true,
      run: () => App.cartView()
    },
    {
      name: "reset_search",
      title: "Start the search over",
      description: "Clear the search, including the question budget. The cart is kept.",
      input: {},
      run: () => App.reset()
    }
  ];

  // One row in the table becomes one spec-shaped registration. The handler
  // returns a plain object; logging and MCP shaping happen here, once.
  function toDefinition(t) {
    const def = {
      name: t.name, title: t.title, description: t.description,
      inputSchema: { type: "object", properties: t.input || {} },
      execute: async (input) => {
        const out = await t.run(input || {});
        App.logCall(t.name, input || {}, out);
        return App.wrap(out);
      }
    };
    if (t.required && t.required.length) def.inputSchema.required = t.required;
    if (t.readOnly) def.annotations = { readOnlyHint: true };
    return def;
  }

  function registerAll() {
    for (const t of TOOLS) safeRegister(toDefinition(t), baseController);
  }
  window.__tools = TOOLS.map(t => ({ name: t.name, title: t.title, readOnly: !!t.readOnly }));


  Object.assign(App, { registerAll, safeRegister, safeUnregister, syncTools, toDefinition, TOOLS });
})(window.App);
