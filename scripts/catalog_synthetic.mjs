/* Build public/catalog.js from the deterministic synthetic generator — the
   controlled catalog every experiment in the README was first run on. The
   generator itself lives in scripts/lib/synthetic.js.
   usage: node scripts/catalog_synthetic.mjs */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "lib/synthetic.js"), "utf8");
fs.writeFileSync(path.join(HERE, "../public/catalog.js"),
  "/* Catalog — synthetic, deterministic. Rebuilt by scripts/catalog_synthetic.mjs. */\n" + src);
console.log("wrote public/catalog.js (synthetic)");
