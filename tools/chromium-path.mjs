// The test browser: CHROMIUM_PATH, else the first Chromium found in the
// Playwright browsers folder (its version changes with the environment).
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
function find() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const tries = [];
  try {
    for (const d of fs.readdirSync(ROOT).sort().reverse()) {
      if (!/^chromium-\d+/.test(d)) continue;
      tries.push(path.join(ROOT, d, "chrome-linux64", "chrome"), path.join(ROOT, d, "chrome-linux", "chrome"));
    }
  } catch {}
  tries.push(path.join(ROOT, "chromium"));
  return tries.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
}
export default find();
