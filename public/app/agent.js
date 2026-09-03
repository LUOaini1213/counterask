/* The scripted agent: a fixed conversation that drives the page through the
   same tools a real agent would call. A demo, not an agent. */
(function (App) {
  "use strict";
  const { S, $, el, mc, live, E } = App;
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


  Object.assign(App, { runScript, SCRIPT });
})(window.App);
