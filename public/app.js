/* One state machine. A person clicking an answer chip and an agent calling
   answer_question enter the same function, so the page cannot drift between
   what it shows a human and what it tells an agent. */
(function () {
  "use strict";
  const E = window.Engine;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const S = {
    understood: null, asked: [], answers: [], waived: [],
    pendingFacet: null, result: null, cart: [], curated: null, log: []
  };

  /* ---------- WebMCP: the real thing if the browser has it, a spec-shaped
       stand-in if it does not, so the same registration code runs either way */

  function makeStub() {
    const tools = new Map();
    const target = new EventTarget();
    return {
      _stub: true,
      registerTool(def, opts) {
        tools.set(def.name, def);
        if (opts && opts.signal) {
          opts.signal.addEventListener("abort", () => {
            tools.delete(def.name);
            target.dispatchEvent(new Event("toolchange"));
          });
        }
        target.dispatchEvent(new Event("toolchange"));
      },
      getTools: () => Array.from(tools.values()),
      addEventListener: (t, f) => target.addEventListener(t, f),
      callTool: (name, input) => {
        const t = tools.get(name);
        if (!t) throw new Error("no such tool: " + name);
        return t.execute(input);
      }
    };
  }

  // The spec moved the getter from Navigator to Document in May 2026;
  // Chromium keeps the old name as a deprecated alias. Read both, prefer the
  // current one, so a browser on either side of the rename is still "live".
  const native = (window.document.modelContext &&
      typeof document.modelContext.registerTool === "function" && document.modelContext) ||
    (window.navigator.modelContext &&
      typeof navigator.modelContext.registerTool === "function" && navigator.modelContext) ||
    null;
  const live = !!native;
  const mc = live ? native : makeStub();
  if (!live) window.__modelContextStub = mc;

  /* MCP-shaped result: content carries the JSON as text, structuredContent
     carries the object, so a client following either convention reads the same
     thing. */
  function wrap(obj) {
    return {
      content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
      structuredContent: obj
    };
  }

  function logCall(name, input, out) {
    S.log.unshift({ name, input, status: out && out.status, at: Date.now() });
    if (S.log.length > 24) S.log.pop();
    renderLog();
  }

  /* ---------- the shared entry points ------------------------------------ */

  function publicView(res) {
    const o = {
      status: res.status,
      candidates: res.candidates,
      understood: {
        query: res.understood.query,
        attributes: res.understood.attributes.map(a => ({ facet: a.facet, value: a.value })),
        exclusions: res.understood.exclusions.map(e => ({ facet: e.facet, value: e.value })),
        budget: res.understood.budget,
        sort: res.understood.sort,
        no_preference: res.waived,
        ignored: res.understood.ignored,
        conflicts: res.understood.conflicts,
        superseded: res.understood.superseded || [],
        retraction: res.understood.retraction || null
      },
      why: res.why
    };
    if (res.status === "need_more_evidence") {
      o.question = res.question;
      o.facet = res.facet;
      o.options = res.options;
      o.note = res.note;
      // The person can see the candidate grid behind the question, so an agent
      // that cannot is a second, worse surface — and with no ids it cannot use
      // show_products either. It gets the same pool, capped and named for what
      // it is, so the sample cannot be mistaken for the answer.
      o.candidate_sample = res.products.slice(0, 6).map(brief);
      o.candidate_sample_note = "Candidates, not a recommendation. Ordering them " +
        "now is the guess the question exists to avoid — ask first.";
    } else {
      o.products = (S.curated || res.products).slice(0, 12).map(brief);
      o.differentiators = res.differentiators;
    }
    if (res.relax) o.relax = res.relax.map(x => ({ lift: x.label, leaves: x.count }));
    return o;
  }

  const brief = (p) => ({
    id: p.id, title: p.title, price: p.price, rating: p.rating,
    reviews: p.reviews, attributes: p.attrs
  });

  function doSearch(sentence, structured) {
    S.curated = null;
    const res = E.search(sentence, null, structured);
    adopt(res);
    $("#q").value = sentence;
    render();
    return publicView(res);
  }

  function adopt(res) {
    S.understood = res.understood;
    S.asked = res.asked;
    S.answers = res.answers;
    S.waived = res.waived;
    S.result = res;
    S.pendingFacet = res.status === "need_more_evidence" ? res.facet : null;
    syncTools();
  }

  function doAnswer(values) {
    if (!S.pendingFacet) return { error: "No question is open." };
    S.curated = null;
    const res = E.answer({
      understood: S.understood, asked: S.asked, answers: S.answers,
      waived: S.waived, pendingFacet: S.pendingFacet
    }, values);
    adopt(res);
    render();
    return publicView(res);
  }

  function doRefine(change) {
    if (!S.understood) return { error: "Nothing to refine yet." };
    const dropped = [];
    if (change.drop) {
      for (const d of [].concat(change.drop)) dropped.push(...dropOne(d));
    }
    if (change.drop_all) {
      const u = S.understood;
      for (const a of u.attributes) dropped.push({ facet: a.facet, value: a.value });
      for (const e of u.exclusions) dropped.push({ facet: e.facet, value: e.value, wasRefusal: true });
      if (u.budget) dropped.push({ facet: "budget", value: E.budgetLabel(u.budget) });
      u.attributes = []; u.exclusions = []; u.bannedWords = []; u.budget = null;
      S.answers = []; S.asked = []; S.waived = [];
    }
    if (change.require) {
      const hit = findValue(change.require);
      if (!hit) return { error: "This catalog does not carry \u201c" + change.require + "\u201d." };
      S.understood.attributes.push({ facet: hit.facet, value: hit.value, said: hit.value });
    }
    if (change.refuse) {
      const hit = findValue(change.refuse);
      S.understood.exclusions.push({
        facet: hit ? hit.facet : null,
        value: hit ? hit.value : change.refuse, said: change.refuse
      });
      S.understood.bannedWords.push(String(change.refuse).toLowerCase());
    }
    S.understood.superseded = (S.understood.superseded || []).concat(dropped);
    const res = E.finish({
      understood: S.understood, asked: S.asked, answers: S.answers, waived: S.waived
    });
    S.curated = null;
    adopt(res);
    render();
    const out = publicView(res);
    if (dropped.length) out.dropped = dropped;
    return out;
  }

  // Remove one thing the shopper has taken back, wherever it is held.
  function dropOne(text) {
    const t = String(text).toLowerCase().trim();
    const u = S.understood;
    const gone = [];
    u.attributes = u.attributes.filter(a => {
      const hit = String(a.value).toLowerCase() === t || a.facet === t;
      if (hit) gone.push({ facet: a.facet, value: a.value });
      return !hit;
    });
    u.exclusions = u.exclusions.filter(e => {
      const hit = String(e.value).toLowerCase() === t;
      if (hit) {
        gone.push({ facet: e.facet, value: e.value, wasRefusal: true });
        const w = u.bannedWords.indexOf(e.said);
        if (w >= 0) u.bannedWords.splice(w, 1);
      }
      return !hit;
    });
    S.answers = (S.answers || []).filter(ans => {
      const hit = ans.facet === t || ans.values.some(v => String(v).toLowerCase() === t);
      if (hit) {
        gone.push({ facet: ans.facet, value: ans.values.join(" / ") });
        S.asked = S.asked.filter(f => f !== ans.facet);
      }
      return !hit;
    });
    if ((t === "budget" || t === "price") && u.budget) {
      gone.push({ facet: "budget", value: E.budgetLabel(u.budget) });
      u.budget = null;
    }
    const term = u.terms.indexOf(t);
    if (term >= 0) { gone.push({ facet: "word", value: t }); u.terms.splice(term, 1); }
    return gone;
  }

  function findValue(text) {
    const t = String(text).toLowerCase().trim();
    const voc = E.attributeVocabulary();
    for (const f of E.FACETS) {
      for (const o of voc[f]) if (o.value.toLowerCase() === t) return { facet: f, value: o.value };
    }
    return null;
  }

  function reset() {
    S.understood = null; S.asked = []; S.answers = []; S.waived = [];
    S.pendingFacet = null; S.result = null; S.curated = null;
    $("#q").value = "";
    syncTools();
    render();
    return { status: "reset", cart_kept: S.cart.length };
  }

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
          const out = doAnswer(input.values);
          logCall("answer_question", input, out);
          return wrap(out);
        }
      }, answerController);
    } else if (!open && answerController) {
      safeUnregister("answer_question", answerController);
      answerController = null;
    }
    renderTools();
  }

  function registerAll() {
    const t = (def) => safeRegister(def, baseController);

    t({
      name: "search_products",
      title: "Search the store",
      description: "Search this menswear catalog. Pass the shopper's request in their own " +
        "words — refusals, budget and all. Returns products, or a question when answering " +
        "would be a guess. Anything you already know can be passed structured and will " +
        "override the parse.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The shopper's request, verbatim." },
          attributes: { type: "array", items: { type: "object" },
            description: "Known requirements as {facet, value}." },
          exclusions: { type: "array", items: { type: "object" },
            description: "Known refusals as {facet, value}." },
          budget: { type: "object", description: "{min, max} in dollars." },
          no_preference: { type: "array", items: { type: "string" },
            description: "Facets the shopper has said they do not mind." }
        },
        required: ["query"]
      },
      execute: async (input) => {
        const out = doSearch(input.query, input);
        logCall("search_products", input, out);
        return wrap(out);
      }
    });

    t({
      name: "refine_search",
      title: "Add one requirement or one refusal",
      description: "Narrow the current search by one attribute value, or rule one out.",
      inputSchema: {
        type: "object",
        properties: {
          require: { type: "string", description: "An attribute value to require." },
          refuse: { type: "string", description: "An attribute value or word to rule out." }
        }
      },
      execute: async (input) => {
        const out = doRefine(input);
        logCall("refine_search", input, out);
        return wrap(out);
      }
    });

    t({
      name: "revise_search",
      title: "Take something back",
      description: "The shopper changed their mind. Drop one thing they had said — an " +
        "attribute value, a refusal, an answer, a facet name, or \"budget\" — and keep " +
        "the rest. Pass drop_all to start the request over; the cart is kept. The store " +
        "reports what it dropped so you can tell the shopper it heard them.",
      inputSchema: {
        type: "object",
        properties: {
          drop: { type: "array", items: { type: "string" },
            description: "Values, facet names, or \"budget\" to take back." },
          drop_all: { type: "boolean", description: "Take the whole request back." }
        }
      },
      execute: async (input) => {
        const out = doRefine({ drop: input.drop, drop_all: input.drop_all });
        logCall("revise_search", input, out);
        return wrap(out);
      }
    });

    t({
      name: "list_attributes",
      title: "The vocabulary this catalog carries",
      description: "Every attribute value in the catalog, with how many products record it.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const out = { catalog_size: E.CATALOG.length, attributes: E.attributeVocabulary() };
        logCall("list_attributes", {}, out);
        return wrap(out);
      }
    });

    t({
      name: "show_products",
      title: "Put your own picks in the grid",
      description: "Replace the grid with the ids you picked, in your order.",
      inputSchema: {
        type: "object",
        properties: { ids: { type: "array", items: { type: "string" } } },
        required: ["ids"]
      },
      execute: async (input) => {
        S.curated = (input.ids || []).map(E.byId).filter(Boolean);
        render();
        const out = { status: "showing", count: S.curated.length };
        logCall("show_products", input, out);
        return wrap(out);
      }
    });

    t({
      name: "explain_ranking",
      title: "Why this product is where it is",
      description: "Which words matched, whether the whole request matched, and the demand signal.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const p = E.byId(input.id);
        if (!p) return wrap({ error: "No such product." });
        const u = S.understood || { terms: [], attributes: [], exclusions: [] };
        const out = {
          id: p.id, title: p.title,
          matched_words: u.terms.filter(t => p.title.toLowerCase().includes(t)),
          matched_attributes: u.attributes.filter(a => (p.attrs[a.facet] || []).includes(a.value))
            .map(a => a.facet + " = " + a.value),
          unrecorded_attributes: u.attributes.filter(a => !p.attrs[a.facet])
            .map(a => a.facet + " (not recorded — kept, ranked after)"),
          demand: { reviews: p.reviews, rating: p.rating,
            note: "Demand is proxied by log-scaled review volume; a frozen catalog has no click log." },
          price: p.price == null ? "not listed" : "$" + p.price,
          questions_asked: S.asked, question_budget_left: Math.max(0, 3 - S.asked.length)
        };
        logCall("explain_ranking", input, out);
        return wrap(out);
      }
    });

    t({
      name: "add_to_cart",
      title: "Add to cart",
      description: "Add a product to the cart by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, quantity: { type: "number" } },
        required: ["id"]
      },
      execute: async (input) => {
        const p = E.byId(input.id);
        if (!p) return wrap({ error: "No such product." });
        const qty = Math.max(1, Math.round(input.quantity || 1));
        const line = S.cart.find(l => l.id === p.id);
        if (line) line.qty += qty; else S.cart.push({ id: p.id, qty });
        renderCart();
        const out = cartView();
        logCall("add_to_cart", input, out);
        return wrap(out);
      }
    });

    t({
      name: "remove_from_cart",
      title: "Remove from cart",
      description: "Remove a product from the cart by id.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute: async (input) => {
        S.cart = S.cart.filter(l => l.id !== input.id);
        renderCart();
        const out = cartView();
        logCall("remove_from_cart", input, out);
        return wrap(out);
      }
    });

    t({
      name: "view_cart",
      title: "See the cart",
      description: "The cart, with line totals.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const out = cartView();
        logCall("view_cart", {}, out);
        return wrap(out);
      }
    });

    t({
      name: "reset_search",
      title: "Start the search over",
      description: "Clear the search, including the question budget. The cart is kept.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const out = reset();
        logCall("reset_search", {}, out);
        return wrap(out);
      }
    });
  }

  function cartView() {
    const lines = S.cart.map(l => {
      const p = E.byId(l.id);
      return { id: p.id, title: p.title, quantity: l.qty,
        unit_price: p.price, line_total: p.price == null ? null : +(p.price * l.qty).toFixed(2) };
    });
    const total = lines.reduce((a, l) => a + (l.line_total || 0), 0);
    return { lines, total: +total.toFixed(2),
      unpriced: lines.filter(l => l.unit_price == null).length };
  }

  /* ---------- rendering -------------------------------------------------- */

  function render() {
    renderUnderstood();
    renderQuestion();
    renderWhy();
    renderGrid();
    renderCart();
    renderTools();
  }

  function chip(text, kind) {
    const c = el("span", "chip " + (kind || ""), text);
    return c;
  }

  function renderUnderstood() {
    const box = $("#understood");
    box.innerHTML = "";
    const u = S.understood;
    if (!u) { box.hidden = true; return; }
    box.hidden = false;

    const add = (t, k) => box.appendChild(chip(t, k));
    if (u.retraction) {
      add(u.retraction.kind === "reset"
        ? "starting over"
        : "following the change", "changed");
    }
    for (const s of u.superseded || []) add(s.value, "dropped");
    for (const a of u.attributes) add(a.value, "want");
    for (const ans of S.answers) add(ans.values.join(" or "), "want");
    for (const e of u.exclusions) add("not " + e.value, "refuse");
    if (u.budget) add(E.budgetLabel(u.budget), "budget");
    if (u.sort) add({ "price-asc": "cheapest first", "price-desc": "priciest first",
      rating: "best rated first", demand: "most popular first" }[u.sort], "sort");
    for (const w of S.waived) add(E.FACET_LABEL[w] + ": no preference", "waived");
    for (const c of u.conflicts) add("said both ways: " + c, "conflict");
    if (u.ignored.length) {
      const ig = Array.from(new Set(u.ignored)).slice(0, 4);
      add("ignored: " + ig.join(", "), "ignored");
    }
    if (!box.children.length) add("read as a plain keyword search", "ignored");
  }

  function renderQuestion() {
    const box = $("#question");
    box.innerHTML = "";
    const r = S.result;
    if (!r || r.status !== "need_more_evidence") { box.hidden = true; return; }
    box.hidden = false;

    box.appendChild(el("p", "ask", r.question));
    const opts = el("div", "options");
    for (const o of r.options.slice(0, 6)) {
      const b = el("button", "opt");
      b.appendChild(el("span", "opt-value", o.value));
      b.appendChild(el("span", "opt-count", o.count + " left"));
      b.addEventListener("click", () => doAnswer([o.value]));
      // hovering shows what this answer would clear — the point of the question
      b.addEventListener("mouseenter", () => previewOption(r.facet, o.value));
      b.addEventListener("focus", () => previewOption(r.facet, o.value));
      b.addEventListener("mouseleave", clearPreview);
      b.addEventListener("blur", clearPreview);
      opts.appendChild(b);
    }
    const none = el("button", "opt none", "no preference");
    none.addEventListener("click", () => doAnswer(["no_preference"]));
    opts.appendChild(none);
    box.appendChild(opts);
    box.appendChild(el("p", "note", r.note));
  }

  function previewOption(facet, value) {
    const grid = $("#grid");
    let kept = 0;
    for (const card of grid.children) {
      const p = E.byId(card.dataset.id);
      const survives = !p.attrs[facet] || (p.attrs[facet] || []).includes(value);
      card.classList.toggle("culled", !survives);
      if (survives) kept++;
    }
    $("#preview").textContent = "answering \u201c" + value + "\u201d leaves " + kept +
      " of these " + grid.children.length;
    $("#preview").hidden = false;
  }

  function clearPreview() {
    for (const card of $("#grid").children) card.classList.remove("culled");
    $("#preview").hidden = true;
  }

  function renderWhy() {
    const box = $("#why");
    box.innerHTML = "";
    const r = S.result;
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    for (const line of r.why) box.appendChild(el("li", null, line));

    if (r.differentiators && r.differentiators.length) {
      const d = r.differentiators[0];
      box.appendChild(el("li", "differ", "What still separates them: " +
        d.splits.map(s => s.count + " " + s.value).join(", ") + "."));
    }
    if (r.relax && r.relax.length) {
      const li = el("li", "relax");
      li.appendChild(document.createTextNode("Lift one requirement: "));
      for (const opt of r.relax) {
        const b = el("button", "lift", opt.label + " \u2192 " + opt.count);
        b.addEventListener("click", () => liftConstraint(opt));
        li.appendChild(b);
      }
      box.appendChild(li);
    }
  }

  function liftConstraint(opt) {
    const u = S.understood;
    if (opt.kind === "attribute") u.attributes.splice(opt.index, 1);
    if (opt.kind === "exclusion") {
      const dropped = u.exclusions.splice(opt.index, 1)[0];
      const w = u.bannedWords.indexOf(dropped.said);
      if (w >= 0) u.bannedWords.splice(w, 1);
    }
    if (opt.kind === "budget") u.budget = null;
    if (opt.kind === "term") u.terms.splice(opt.index, 1);
    if (opt.kind === "answer") S.answers.splice(opt.index, 1);
    const res = E.finish({ understood: u, asked: S.asked, answers: S.answers, waived: S.waived });
    S.curated = null;
    adopt(res);
    render();
  }

  function renderGrid() {
    const grid = $("#grid");
    grid.innerHTML = "";
    const r = S.result;
    const count = $("#count");
    if (!r) {
      count.textContent = "";
      $("#empty").hidden = false;
      return;
    }
    $("#empty").hidden = true;
    const list = S.curated || r.products;
    count.textContent = S.curated
      ? S.curated.length + " picked by the agent"
      : r.candidates + (r.candidates === 1 ? " candidate" : " candidates") +
        (r.candidates > list.length ? ", showing " + list.length : "");

    for (const p of list) {
      const card = el("article", "card");
      card.dataset.id = p.id;
      card.appendChild(el("h3", null, p.title));
      const meta = el("p", "meta");
      const bits = [];
      for (const f of E.FACETS) if (p.attrs[f]) bits.push(p.attrs[f].join(", "));
      meta.textContent = bits.join(" \u00b7 ") || "no attributes recorded";
      card.appendChild(meta);
      const foot = el("p", "foot");
      foot.appendChild(el("span", "price", p.price == null ? "price not listed" : "$" + p.price));
      foot.appendChild(el("span", "rev", p.rating + " from " + p.reviews.toLocaleString() + " reviews"));
      card.appendChild(foot);
      const add = el("button", "add", "Add to cart");
      add.addEventListener("click", async () => {
        const line = S.cart.find(l => l.id === p.id);
        if (line) line.qty++; else S.cart.push({ id: p.id, qty: 1 });
        renderCart();
        logCall("add_to_cart", { id: p.id }, cartView());
      });
      card.appendChild(add);
      grid.appendChild(card);
    }
  }

  function renderCart() {
    const v = cartView();
    $("#cart-count").textContent = v.lines.reduce((a, l) => a + l.quantity, 0);
    $("#cart-total").textContent = "$" + v.total.toFixed(2);
    const list = $("#cart-lines");
    list.innerHTML = "";
    for (const l of v.lines) {
      const li = el("li");
      li.appendChild(el("span", "cl-title", l.title));
      li.appendChild(el("span", "cl-price",
        l.line_total == null ? "not listed" : "$" + l.line_total.toFixed(2)));
      const x = el("button", "cl-x", "Remove");
      x.addEventListener("click", () => {
        S.cart = S.cart.filter(c => c.id !== l.id);
        renderCart();
      });
      li.appendChild(x);
      list.appendChild(li);
    }
    $("#checkout-total").value = v.total.toFixed(2);
  }

  function renderTools() {
    const box = $("#tools");
    box.innerHTML = "";
    for (const t of mc.getTools()) {
      const li = el("li", t.name === "answer_question" ? "tool live" : "tool");
      li.appendChild(el("span", "tname", t.name));
      if (t.annotations && t.annotations.readOnlyHint) li.appendChild(el("span", "ro", "read-only"));
      box.appendChild(li);
    }
    $("#tool-note").textContent = S.pendingFacet
      ? "answer_question is registered because a question is open."
      : "answer_question is not registered — nothing is waiting on the shopper.";
  }

  function renderLog() {
    const box = $("#log");
    box.innerHTML = "";
    for (const c of S.log) {
      const li = el("li");
      li.appendChild(el("span", "lname", c.name));
      const arg = JSON.stringify(c.input);
      li.appendChild(el("span", "largs", arg.length > 64 ? arg.slice(0, 61) + "\u2026" : arg));
      if (c.status) li.appendChild(el("span", "lstatus " + c.status, c.status));
      box.appendChild(li);
    }
  }

  /* ---------- the scripted agent ---------------------------------------- */

  const SCRIPT = [
    { who: "shopper", text: "I need a wallet that is not leather, under $30." },
    { who: "agent", text: "Let me ask the store.", act: () =>
        mc.callTool("search_products", { query: "a wallet that is not leather, under $30" }) },
    { who: "store", text: null, read: (r) => r.status === "need_more_evidence"
        ? "The store asks back: " + r.question
        : "The store answered with " + r.candidates + " candidates." },
    { who: "agent", text: "It won't guess. Passing the question on." },
    { who: "shopper", text: "Nylon is fine." },
    { who: "agent", text: "answer_question appeared in the tool list — using it.",
      act: () => mc.callTool("answer_question", { values: ["nylon"] }) },
    { who: "shopper", text: "Actually, forget the budget — I'd rather have a good one." },
    { who: "agent", text: "Taking the budget back and keeping the rest.",
      act: () => mc.callTool("revise_search", { drop: ["budget"] }) },
    { who: "store", text: null, read: (r) => r.dropped && r.dropped.length
        ? "Dropped " + r.dropped.map(d => d.value).join(", ") +
          " — " + r.candidates + " candidates now, nylon still held."
        : "Nothing to drop." },
    { who: "agent", text: "Why is the first one first?",
      act: () => {
        const first = (S.curated || S.result.products)[0];
        return first ? mc.callTool("explain_ranking", { id: first.id }) : null;
      } },
    { who: "agent", text: "Showing the three best rated of those.",
      act: () => {
        const top = (S.result.products || []).slice()
          .sort((a, b) => b.rating - a.rating).slice(0, 3).map(p => p.id);
        return mc.callTool("show_products", { ids: top });
      } },
    { who: "agent", text: "Adding the first to the cart.",
      act: () => {
        const first = (S.curated || [])[0];
        return first ? mc.callTool("add_to_cart", { id: first.id }) : null;
      } },
    { who: "agent", text: "Checkout is filled in. The last press is yours \u2014 I don't have it." }
  ];

  async function runScript() {
    const panel = $("#agent");
    panel.hidden = false;
    $("#agent-lines").innerHTML = "";
    for (const step of SCRIPT) {
      let out = null;
      if (step.act) out = await step.act();
      const text = step.read
        ? step.read(out && out.structuredContent ? out.structuredContent : S.result)
        : step.text;
      if (text) {
        const li = el("li", "line " + step.who);
        li.appendChild(el("span", "who", step.who));
        li.appendChild(el("span", "said", text));
        $("#agent-lines").appendChild(li);
        $("#agent-lines").scrollTop = $("#agent-lines").scrollHeight;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  /* ---------- wiring ----------------------------------------------------- */

  let booted = false;
  function init() {
    if (booted) return;   // DOMContentLoaded fires once; a duplicate include must not register twice
    booted = true;
    registerAll();
    syncTools();

    $("#badge").textContent = live ? "WebMCP live in this browser" : "no WebMCP here — stand-in in use";
    $("#badge").className = live ? "badge live" : "badge stub";
    $("#catalog-size").textContent = E.CATALOG.length.toLocaleString();

    $("#search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#q").value.trim();
      if (q) { const out = doSearch(q); logCall("search_products", { query: q }, out); }
    });

    for (const b of document.querySelectorAll("[data-example]")) {
      b.addEventListener("click", () => {
        const q = b.dataset.example;
        const out = doSearch(q);
        logCall("search_products", { query: q }, out);
      });
    }

    $("#reset").addEventListener("click", () => { reset(); logCall("reset_search", {}, { status: "reset" }); });
    $("#run-agent").addEventListener("click", runScript);

    $("#checkout").addEventListener("submit", (e) => {
      e.preventDefault();
      $("#placed").hidden = false;
      $("#placed").textContent = "Order placed. Nothing left the page \u2014 this is a demo.";
    });

    if (mc.addEventListener) mc.addEventListener("toolchange", renderTools);
    render();

    if (new URLSearchParams(location.search).get("agent") === "demo") setTimeout(runScript, 600);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
