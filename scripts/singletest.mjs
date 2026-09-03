/* The bundled single file, headless: engine present, tools registered, a
   search renders, the scripted agent starts on ?agent=demo. */
import path from "path";
import { bootSingleFile, harness, PUB } from "./lib/boot.mjs";
const { ck, done } = harness();
const window = bootSingleFile(path.resolve(PUB, "../counterask-demo.html"), "https://example.test/?agent=demo");
const $ = s => window.document.querySelector(s);
ck("engine loaded", !!window.Engine, window.Engine && window.Engine.CATALOG.length + " products");
ck("tools registered", window.document.querySelectorAll("#tools .tname").length >= 8);
$("#q").value = "I'm looking for a leather belt, nothing with a snap, not over $50";
$("#search").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
ck("search ran", $("#grid").children.length > 0, $("#count").textContent);
ck("understood chips", $("#understood").textContent.replace(/\s+/g, " ").trim().length > 0);
await new Promise(r => setTimeout(r, 4200));
ck("scripted agent started", $("#agent-lines").children.length > 0, $("#agent-lines").children.length + " lines");
done("single file works");
