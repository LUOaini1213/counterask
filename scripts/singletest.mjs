import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const dom = new JSDOM(fs.readFileSync(path.resolve(PUB, "../counterask-demo.html"),"utf8"),
  { runScripts:"dangerously", url:"https://example.test/?agent=demo" });
const { window } = dom;
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
const $ = s => window.document.querySelector(s);
let bad = 0;
const ck = (l,c,x)=>{console.log((c?"  ok   ":"  FAIL ")+l+(x?"  "+x:""));if(!c)bad++;};
ck("engine loaded", !!window.Engine, window.Engine && window.Engine.CATALOG.length + " products");
ck("tools registered", window.document.querySelectorAll("#tools .tname").length >= 8);
$("#q").value = "I'm looking for a leather belt, nothing with a snap, not over $50";
$("#search").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
ck("search ran", $("#grid").children.length > 0, $("#count").textContent);
ck("understood chips", $("#understood").textContent.replace(/\s+/g," ").trim().length>0,
   $("#understood").textContent.replace(/\s+/g," ").trim());
await new Promise(r=>setTimeout(r,4200));
ck("scripted agent started", $("#agent-lines").children.length > 0,
   $("#agent-lines").children.length + " lines");
console.log(bad?bad+" FAILURES":"single file works");
process.exit(bad?1:0);
