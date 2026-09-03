/* An open question must survive a navigation. Simulated as two page loads that
   share one sessionStorage: the first opens a question and adds to the cart,
   the second boots cold and has to come back holding the same question, the
   same cart, and answer_question registered. */
import { boot as _boot, harness, toolNames as names, dumpSession as dump } from "./lib/boot.mjs";
const { ck, done } = harness();
const boot = (url, seed) => _boot({ url, session: seed || null });
console.log("first page load");
const a = boot("https://example.test/");
const mcA = a.__modelContextStub;
let r = (await mcA.callTool("search_products", { query: "belt" })).structuredContent;
ck("a question is open", r.status === "need_more_evidence", r.facet);
await mcA.callTool("add_to_cart", { id: a.Engine.CATALOG[0].id });
ck("something is in the cart", (await mcA.callTool("view_cart", {})).structuredContent.lines.length === 1);
ck("answer_question registered", names(a).includes("answer_question"));
const saved = dump(a);
ck("state was written to sessionStorage", !!saved["counterask:session"]);
ck("products are not stored, only the reading", !/"products"/.test(saved["counterask:session"]));

console.log("\nsecond page load, same session");
const b = boot("https://example.test/somewhere-else", saved);
const mcB = b.__modelContextStub;
ck("the restored line is shown", !b.document.querySelector("#restored").hidden,
  b.document.querySelector("#restored").textContent);
ck("the question is still open", !b.document.querySelector("#question").hidden);
ck("it is the same question", b.document.querySelector("#question .ask").textContent ===
  a.document.querySelector("#question .ask").textContent);
ck("answer_question came back with it", names(b).includes("answer_question"));
ck("the search box still shows the request", b.document.querySelector("#q").value === "belt");
ck("the cart came back", (await mcB.callTool("view_cart", {})).structuredContent.lines.length === 1);
ck("the grid was rebuilt", b.document.querySelector("#grid").children.length > 0);

console.log("\nanswering on the second page closes it for good");
r = (await mcB.callTool("answer_question", { values: ["no_preference"] })).structuredContent;
let guard = 0;
while (r.status === "need_more_evidence" && guard++ < 4)
  r = (await mcB.callTool("answer_question", { values: ["no_preference"] })).structuredContent;
const c = boot("https://example.test/", dump(b));
ck("a third load does not resurrect the answered question",
  c.document.querySelector("#question").hidden);
ck("but keeps the answers it was given",
  c.document.querySelector("#understood").textContent.includes("no preference"));

console.log("\n?fresh=1 starts clean");
const d = boot("https://example.test/?fresh=1", dump(b));
ck("nothing restored", d.document.querySelector("#restored").hidden);
ck("empty grid", d.document.querySelector("#grid").children.length === 0);
ck("cart cleared too", (await d.__modelContextStub.callTool("view_cart", {})).structuredContent.lines.length === 0);

console.log("\nstale state is ignored");
const old = JSON.parse(saved["counterask:session"]); old.savedAt = Date.now() - 2 * 60 * 60 * 1000;
const e = boot("https://example.test/", { "counterask:session": JSON.stringify(old) });
ck("an hour-old session is not restored", e.document.querySelector("#restored").hidden);

done("an open question survives a navigation");
