/* The native WebMCP surface cannot be run here, so this drives the page with
   three stand-ins that behave like the implementations a judge might actually
   have: the current document.modelContext, the deprecated navigator alias, and
   an implementation that throws on duplicate names and only removes tools via
   unregisterTool. The page has to be "live" on all three and answer_question has
   to come and go on all three. */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

let failed = 0;
const ck = (label, cond, extra) => {
  console.log((cond ? "  ok   " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) failed++;
};

function fakeNative({ honourSignal, throwOnDuplicate, hasUnregister }) {
  const tools = new Map();
  const target = new EventTarget();
  const ctx = {
    registerTool(def, opts) {
      if (throwOnDuplicate && tools.has(def.name))
        throw new DOMException("already registered", "InvalidStateError");
      tools.set(def.name, def);
      if (honourSignal && opts && opts.signal)
        opts.signal.addEventListener("abort", () => {
          tools.delete(def.name); target.dispatchEvent(new Event("toolchange"));
        });
      target.dispatchEvent(new Event("toolchange"));
      return undefined;
    },
    getTools: () => Array.from(tools.values()),
    addEventListener: (t, f) => target.addEventListener(t, f),
    _call: (n, i) => tools.get(n).execute(i),
    _has: (n) => tools.has(n)
  };
  if (hasUnregister) ctx.unregisterTool = (name) => {
    if (!tools.has(name)) throw new DOMException("no such tool", "InvalidStateError");
    tools.delete(name); target.dispatchEvent(new Event("toolchange"));
  };
  return ctx;
}

async function drive(label, mount, ctx) {
  console.log("\n" + label);
  const dom = new JSDOM(fs.readFileSync(path.join(PUB, "index.html"), "utf8"),
    { runScripts: "dangerously", url: "https://example.test/" });
  const { window } = dom;
  if (mount === "document") window.document.modelContext = ctx;
  else window.navigator.modelContext = ctx;
  for (const f of ["catalog.js", "engine.js", "app.js"])
    window.eval(fs.readFileSync(path.join(PUB, f), "utf8"));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  const $ = (s) => window.document.querySelector(s);

  ck("page detects it as live", /live/.test($("#badge").textContent), $("#badge").textContent);
  ck("base tools registered natively", ctx.getTools().length >= 10, ctx.getTools().length + " tools");
  ck("answer_question absent at rest", !ctx._has("answer_question"));

  let r = (await ctx._call("search_products", { query: "belt" })).structuredContent;
  ck("a broad query asks", r.status === "need_more_evidence");
  ck("answer_question registered natively", ctx._has("answer_question"));

  // resolve the question fully so it must be removed
  let guard = 0;
  while (r.status === "need_more_evidence" && guard++ < 5)
    r = (await ctx._call("answer_question", { values: ["no_preference"] })).structuredContent;
  ck("answer_question removed once nothing is pending", !ctx._has("answer_question"));

  // and it must come back for the next question without a duplicate-name blowup
  await ctx._call("reset_search", {});
  r = (await ctx._call("search_products", { query: "belt" })).structuredContent;
  ck("re-registered cleanly for the next question",
    r.status === "need_more_evidence" && ctx._has("answer_question"));
  ck("the page's tool list mirrors the native one",
    window.document.querySelectorAll("#tools .tname").length === ctx.getTools().length);
}

await drive("document.modelContext, honours AbortSignal (current spec)",
  "document", fakeNative({ honourSignal: true, throwOnDuplicate: true, hasUnregister: false }));
await drive("navigator.modelContext, deprecated alias, honours AbortSignal",
  "navigator", fakeNative({ honourSignal: true, throwOnDuplicate: true, hasUnregister: false }));
await drive("ignores AbortSignal, throws on duplicate, only unregisterTool removes",
  "document", fakeNative({ honourSignal: false, throwOnDuplicate: true, hasUnregister: true }));

console.log("\n" + (failed ? failed + " FAILURES" : "live mode holds on all three shapes"));
process.exit(failed ? 1 : 0);
