import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

const html = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://example.test/",
  resources: undefined,
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  }
});
const { window } = dom;

// jsdom does not fetch <script src>, so load them by hand in order
for (const f of ["catalog.js", "engine.js", "app.js"]) {
  const code = fs.readFileSync(path.join(PUB, f), "utf8");
  window.eval(code);
}
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

const $ = (s) => window.document.querySelector(s);
const toolNames = () => Array.from(window.document.querySelectorAll("#tools .tname")).map(n => n.textContent);

let failures = 0;
const check = (label, cond, extra) => {
  console.log((cond ? "  ok   " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) failures++;
};

console.log("boot");
check("badge rendered", $("#badge").textContent.length > 0, $("#badge").textContent);
check("catalog size shown", $("#catalog-size").textContent !== "\u2014", $("#catalog-size").textContent);
check("base tools registered", toolNames().length >= 8, toolNames().join(","));
check("answer_question absent at rest", !toolNames().includes("answer_question"));

console.log("\nsearch that should ask back: \u201cbelt\u201d");
$("#q").value = "belt";
$("#search").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
check("question block visible", !$("#question").hidden);
check("question text present", $("#question .ask").textContent.length > 10, $("#question .ask").textContent);
check("options rendered", $("#question .options").children.length >= 3);
check("answer_question now registered", toolNames().includes("answer_question"));
check("grid populated", $("#grid").children.length > 0, $("#grid").children.length + " cards");
check("count line written", $("#count").textContent.includes("candidates"), $("#count").textContent);
check("why lines written", $("#why").children.length > 0);

console.log("\nhover preview");
const firstOpt = $("#question .opt");
firstOpt.dispatchEvent(new window.MouseEvent("mouseenter"));
check("preview line shown", !$("#preview").hidden, $("#preview").textContent);
check("some cards culled", $("#grid").querySelectorAll(".culled").length > 0,
  $("#grid").querySelectorAll(".culled").length + " culled");
firstOpt.dispatchEvent(new window.MouseEvent("mouseleave"));
check("preview cleared", $("#preview").hidden && $("#grid").querySelectorAll(".culled").length === 0);

console.log("\nanswering the question");
const before = $("#count").textContent;
firstOpt.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("count changed", $("#count").textContent !== before, before + " -> " + $("#count").textContent);
check("chip records the answer", $("#understood").textContent.length > 0, $("#understood").textContent.trim());

console.log("\ntool list is state");
const stillOpen = !$("#question").hidden;
check("answer_question tracks the open question",
  toolNames().includes("answer_question") === stillOpen,
  "question open=" + stillOpen + " tool present=" + toolNames().includes("answer_question"));

console.log("\ncalling tools the way an agent would");
const mc = window.__modelContextStub;
check("stand-in modelContext present", !!mc);
const out = await mc.callTool("search_products", { query: "a wallet that is not leather, under $30" });
check("MCP-shaped result", !!out.content && !!out.structuredContent);
check("status is answer", out.structuredContent.status === "answer", out.structuredContent.status);
check("refusal survived the round trip",
  out.structuredContent.understood.exclusions.some(e => e.value === "leather"));
check("budget survived", out.structuredContent.understood.budget.max === 30);
const top = out.structuredContent.products || [];
check("no leather in what it returned",
  !top.some(p => (p.attributes.material || []).includes("leather")));
check("no product over budget",
  !top.some(p => p.price != null && p.price > 30));

console.log("\nstructured input from the agent overrides the parse");
const s2 = await mc.callTool("search_products", {
  query: "a belt", attributes: [{ facet: "material", value: "leather" }],
  no_preference: ["closure"]
});
check("agent's attribute applied",
  s2.structuredContent.understood.attributes.some(a => a.value === "leather"));
check("waived facet never asked",
  s2.structuredContent.facet !== "closure", "asked about " + s2.structuredContent.facet);

console.log("\ncart + checkout");
const anyId = window.Engine.CATALOG[3].id;
await mc.callTool("add_to_cart", { id: anyId, quantity: 2 });
const cart = await mc.callTool("view_cart", {});
check("cart has the line", cart.structuredContent.lines.length === 1);
check("checkout total mirrored into the form",
  $("#checkout-total").value === cart.structuredContent.total.toFixed(2),
  $("#checkout-total").value);
check("checkout form is declarative", $("#checkout").getAttribute("toolname") === "checkout");
check("checkout does not autosubmit", !$("#checkout").hasAttribute("toolautosubmit"));

console.log("\nreset keeps the cart");
await mc.callTool("reset_search", {});
check("search cleared", $("#q").value === "");
check("cart kept", (await mc.callTool("view_cart", {})).structuredContent.lines.length === 1);
check("answer_question gone", !toolNames().includes("answer_question"));

console.log("\nnothing survives -> relax options");
const dead = await mc.callTool("search_products", { query: "waterproof insulated silk gloves under $15" });
check("zero candidates", dead.structuredContent.candidates === 0);
check("relax offered", (dead.structuredContent.relax || []).length > 0,
  JSON.stringify(dead.structuredContent.relax));
check("relax buttons rendered", $("#why .lift") !== null);

console.log("\n" + (failures ? failures + " FAILURES" : "all checks passed"));
process.exit(failures ? 1 : 0);
