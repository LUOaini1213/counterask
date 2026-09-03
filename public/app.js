/* Boot. */
(function (App) {
  "use strict";
  const { S, $, el, mc, live, E } = App;
  /* ---------- wiring ----------------------------------------------------- */

  let booted = false;
  function init() {
    if (booted) return;   // DOMContentLoaded fires once; a duplicate include must not register twice
    booted = true;
    App.registerAll();
    App.syncTools();

    $("#badge").textContent = live ? "WebMCP live in this browser" : "no WebMCP here — stand-in in use";
    $("#badge").className = live ? "badge live" : "badge stub";
    $("#catalog-size").textContent = E.CATALOG.length.toLocaleString();
    if (E.META && E.META.source) {
      $("#about-text").textContent = "real products \u2014 " +
        E.META.source + (E.META.slice ? ", " + E.META.slice : "") +
        ". Retrieval, the parser and the stopping policy all run in this tab \u2014 no server, no model call, no tokens.";
    }
    const EXAMPLES = E.META ? [
      "belt", "leather belt", "shoes", "running shoes", "sneakers, not white",
      "a cotton t-shirt under $25", "a jacket, no zipper, not over $80",
      "I'm looking for a leather belt, nothing with a snap, not over $50",
      "actually, ignore my earlier preference. what I need is a nylon belt",
      "hiking boots, any material is fine"
    ] : [
      "belt", "leather belt", "running shoes", "waterproof hiking boots, no laces",
      "a wallet that is not leather, under $30", "cheapest wool sweater",
      "I'm looking for a leather belt, nothing with a snap, not over $50",
      "hiking boots, any material is fine",
      "a jacket, not from Ridgeline, between 80 and 150 dollars",
      "actually, ignore my earlier preference. what I need is a nylon belt",
      "waterproof insulated silk gloves under $15"
    ];
    const ex = $("#examples");
    for (const q of EXAMPLES) {
      const b = el("button", null, q); b.dataset.example = q; ex.appendChild(b);
    }

    $("#search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#q").value.trim();
      if (q) { const out = App.doSearch(q); App.logCall("search_products", { query: q }, out); }
    });

    for (const b of document.querySelectorAll("[data-example]")) {
      b.addEventListener("click", () => {
        const q = b.dataset.example;
        const out = App.doSearch(q);
        App.logCall("search_products", { query: q }, out);
      });
    }

    $("#reset").addEventListener("click", () => { App.reset(); App.logCall("reset_search", {}, { status: "reset" }); });
    $("#run-agent").addEventListener("click", App.runScript);

    $("#checkout").addEventListener("submit", (e) => {
      e.preventDefault();
      $("#placed").hidden = false;
      $("#placed").textContent = "Order placed. Nothing left the page \u2014 this is a demo.";
    });

    if (mc.addEventListener) mc.addEventListener("toolchange", App.renderTools);

    const params = new URLSearchParams(location.search);
    if (params.get("fresh") === "1") App.forget();
    else if (App.restore()) {
      $("#restored").hidden = false;
      $("#restored").textContent = S.pendingFacet
        ? "Picked up where you left off — the question is still open."
        : "Picked up where you left off.";
    }
    App.render();

    if (params.get("agent") === "demo") setTimeout(App.runScript, 600);
  }

  document.addEventListener("DOMContentLoaded", init);

  document.addEventListener("DOMContentLoaded", init);
})(window.App);
