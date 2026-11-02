// Writes js/build.json: the build's id (a hash of every game script) and the
// list of scripts, so index.html's loader can fetch them afresh once when a
// new build is published (a browser may keep old copies for a while, and a
// new page over old scripts shows buttons that do nothing). Run it before a
// release: `node tools/stamp-build.mjs`.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
})(path.join(ROOT, "js"));
files.sort();
const hash = crypto.createHash("sha256");
for (const f of files) hash.update(path.relative(ROOT, f)).update(fs.readFileSync(f));
const out = { build: hash.digest("hex").slice(0, 16), files: files.map((f) => "./" + path.relative(ROOT, f).split(path.sep).join("/")) };
fs.writeFileSync(path.join(ROOT, "js", "build.json"), JSON.stringify(out) + "\n");
console.log(`js/build.json: build ${out.build}, ${out.files.length} scripts`);
