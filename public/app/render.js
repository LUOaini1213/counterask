/* Rendering. Everything here reads state and draws; the one thing it writes
   back is through the same entry points an agent uses. */
(function (App) {
  "use strict";
  const { S, $, el, mc, live, E } = App;
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
      b.addEventListener("click", () => App.doAnswer([o.value]));
      // hovering shows what this answer would clear — the point of the question
      b.addEventListener("mouseenter", () => previewOption(r.facet, o.value));
      b.addEventListener("focus", () => previewOption(r.facet, o.value));
      b.addEventListener("mouseleave", clearPreview);
      b.addEventListener("blur", clearPreview);
      opts.appendChild(b);
    }
    const none = el("button", "opt none", "no preference");
    none.addEventListener("click", () => App.doAnswer(["no_preference"]));
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
    App.adopt(res);
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
        App.logCall("add_to_cart", { id: p.id }, App.cartView());
      });
      card.appendChild(add);
      grid.appendChild(card);
    }
  }

  function renderCart() {
    App.persist();
    const v = App.cartView();
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


  Object.assign(App, { chip, clearPreview, liftConstraint, previewOption, render, renderCart, renderGrid, renderLog, renderQuestion, renderTools, renderUnderstood, renderWhy });
})(window.App);
