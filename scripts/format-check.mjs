import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "packages", "scripts", "docs"];
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "third_party") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|mjs|js|json|md)$/.test(name)) {
      const t = readFileSync(p, "utf8");
      if (t.includes("\t")) bad.push(p);
    }
  }
}
for (const r of roots) {
  try { walk(r); } catch { /* optional */ }
}
if (bad.length) {
  console.error("tabs found", bad);
  process.exit(1);
}
console.log("format-check ok");
