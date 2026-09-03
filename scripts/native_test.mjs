/* The native WebMCP surface cannot be run here, so this drives the page with
   three stand-ins that behave like the implementations a judge might actually
   have: the current document.modelContext, the deprecated navigator alias, and
   an implementation that throws on duplicate names and only removes tools via
   unregisterTool. The page has to be "live" on all three and answer_question has
   to come and go on all three. */
import { boot, harness, toolNames } from "./lib/boot.mjs";
const { ck, done } = harness();
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
  const window = boot({ modelContext: ctx, mount });
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
    toolNames(window).length === ctx.getTools().length);
}

await drive("document.modelContext, honours AbortSignal (current spec)",
  "document", fakeNative({ honourSignal: true, throwOnDuplicate: true, hasUnregister: false }));
await drive("navigator.modelContext, deprecated alias, honours AbortSignal",
  "navigator", fakeNative({ honourSignal: true, throwOnDuplicate: true, hasUnregister: false }));
await drive("ignores AbortSignal, throws on duplicate, only unregisterTool removes",
  "document", fakeNative({ honourSignal: false, throwOnDuplicate: true, hasUnregister: true }));

done("live mode holds on all three shapes");
