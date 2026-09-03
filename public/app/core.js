/* State, the shared entry points both surfaces use, the WebMCP binding, and
   persistence. Loaded first; the other parts read what it puts on App. */
(function (App) {
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
    App.renderLog();
  }


  /* ---------- persistence across a navigation ----------------------------
     WebMCP tools are registered per page. Without this, an open question — and
     the tool that answers it — vanish on refresh or navigation, and the agent
     is left holding a question the page no longer remembers asking. The state
     is small (the reading, the answers, the cart), so it is kept in
     sessionStorage and rebuilt on load; products are never stored, they are
     recomputed from the reading. */
  const STORE_KEY = "counterask:session";
  const STORE_TTL_MS = 60 * 60 * 1000;

  function persist() {
    try {
      const snap = {
        savedAt: Date.now(),
        understood: S.understood, asked: S.asked, answers: S.answers, waived: S.waived,
        pendingFacet: S.pendingFacet, cart: S.cart,
        curated: S.curated ? S.curated.map(p => p.id) : null
      };
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(snap));
    } catch (e) { /* storage unavailable: the page still works, it just forgets */ }
  }

  function restore() {
    try {
      const raw = window.sessionStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || Date.now() - (snap.savedAt || 0) > STORE_TTL_MS) return false;
      S.cart = Array.isArray(snap.cart) ? snap.cart : [];
      if (!snap.understood) return true;   // only a cart to bring back
      const res = E.finish({
        understood: snap.understood, asked: snap.asked || [],
        answers: snap.answers || [], waived: snap.waived || []
      });
      adopt(res);
      S.curated = snap.curated ? snap.curated.map(E.byId).filter(Boolean) : null;
      if (S.curated && !S.curated.length) S.curated = null;
      $("#q").value = snap.understood.query || "";
      return true;
    } catch (e) { return false; }
  }

  function forget() {
    try { window.sessionStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to forget */ }
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
    App.render();
    return publicView(res);
  }

  function adopt(res) {
    S.understood = res.understood;
    S.asked = res.asked;
    S.answers = res.answers;
    S.waived = res.waived;
    S.result = res;
    S.pendingFacet = res.status === "need_more_evidence" ? res.facet : null;
    App.syncTools();
    persist();
  }

  function doAnswer(values) {
    if (!S.pendingFacet) return { error: "No question is open." };
    S.curated = null;
    const res = E.answer({
      understood: S.understood, asked: S.asked, answers: S.answers,
      waived: S.waived, pendingFacet: S.pendingFacet
    }, values);
    adopt(res);
    App.render();
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
    App.render();
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
    App.syncTools();
    App.render();
    persist();   // the cart survives a reset, so the snapshot keeps it
    return { status: "reset", cart_kept: S.cart.length };
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


  Object.assign(App, { S, $, el, mc, live, E, adopt, cartView, doAnswer, doRefine, doSearch, dropOne, findValue, forget, logCall, makeStub, persist, publicView, reset, restore, wrap });
})(window.App = window.App || {});
