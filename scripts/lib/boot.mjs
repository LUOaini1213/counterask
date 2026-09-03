/* Boot the page headlessly. One place for the JSDOM incantation instead of
   five, with hooks for a native modelContext stand-in and a seeded session. */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
export const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

export function boot({ url = "https://example.test/", html = null, modelContext = null,
                       mount = "document", session = null, scripts = ["catalog.js", "engine/vocabulary.js", "engine/parser.js", "engine/retrieval.js", "engine/policy.js", "engine.js", "app/core.js", "app/tools.js", "app/render.js", "app/agent.js", "app.js"] } = {}) {
  const dom = new JSDOM(html || fs.readFileSync(path.join(PUB, "index.html"), "utf8"),
    { runScripts: "dangerously", url });
  const { window } = dom;
  if (modelContext) {
    if (mount === "document") window.document.modelContext = modelContext;
    else window.navigator.modelContext = modelContext;
  }
  if (session) for (const [k, v] of Object.entries(session)) window.sessionStorage.setItem(k, v);
  if (scripts) for (const f of scripts) window.eval(fs.readFileSync(path.join(PUB, f), "utf8"));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return window;
}

export function bootSingleFile(file, url = "https://example.test/") {
  const dom = new JSDOM(fs.readFileSync(file, "utf8"), { runScripts: "dangerously", url });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom.window;
}

export const $ = (w) => (s) => w.document.querySelector(s);
export const toolNames = (w) => Array.from(w.document.querySelectorAll("#tools .tname")).map(n => n.textContent);
export const dumpSession = (w) => {
  const o = {};
  for (let i = 0; i < w.sessionStorage.length; i++) { const k = w.sessionStorage.key(i); o[k] = w.sessionStorage.getItem(k); }
  return o;
};

/* A tiny check harness shared by every test: prints ok/FAIL, counts, exits. */
export function harness() {
  let failed = 0;
  const ck = (label, cond, extra) => {
    console.log((cond ? "  ok   " : "  FAIL ") + label + (extra ? "  " + extra : ""));
    if (!cond) failed++;
  };
  const done = (okMsg) => { console.log("\n" + (failed ? failed + " FAILURES" : okMsg)); process.exit(failed ? 1 : 0); };
  return { ck, done, failed: () => failed };
}
