import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let html = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
for (const f of ["catalog.js", "engine/vocabulary.js", "engine/parser.js", "engine/retrieval.js", "engine/policy.js", "engine.js", "app/core.js", "app/tools.js", "app/render.js", "app/agent.js", "app.js"]) {
  const code = fs.readFileSync(path.join(PUB, f), "utf8");
  // replacement must be a function: the sources contain "$&", which a string
  // replacement would expand into the matched tag
  html = html.replace(`<script src="${f}"></script>`, () => "<script>\n" + code + "\n</script>");
}
fs.writeFileSync(path.resolve(PUB, "../counterask-demo.html"), html);
console.log("single file:", (Buffer.byteLength(html) / 1024).toFixed(0) + " KB");
