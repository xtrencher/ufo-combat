// (Round 12) The MINECLAUDE logo: blocky letters drawn from a little pixel
// font as an inline SVG (no image file, crisp at any size): "MINE" in
// speckled stone, "CLAUDE" in terracotta clay, each block with a dark edge
// and a darker face below it (the 3D look of Minecraft's own logo), and a
// yellow splash line leaning off its corner. Every element with the class
// "mc-logo" gets one (the loading screen's, the main menu's); its text stays
// the accessible name (and shows, styled by index.html, if this never runs).
// Loaded on its own by index.html (it needs nothing else), so the loading
// screen has the logo while the game itself is still downloading.

// Letters, 7 rows of "#" (block) and "." (gap); widths vary as they should.
const GLYPHS = {
  M: ["##...##", "###.###", "#######", "##.#.##", "##...##", "##...##", "##...##"],
  I: ["####", ".##.", ".##.", ".##.", ".##.", ".##.", "####"],
  N: ["##..##", "###.##", "######", "##.###", "##..##", "##..##", "##..##"],
  E: ["#####", "##...", "##...", "####.", "##...", "##...", "#####"],
  C: [".####", "##...", "##...", "##...", "##...", "##...", ".####"],
  L: ["##...", "##...", "##...", "##...", "##...", "##...", "#####"],
  A: [".####.", "##..##", "##..##", "######", "##..##", "##..##", "##..##"],
  U: ["##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  D: ["#####.", "##..##", "##..##", "##..##", "##..##", "##..##", "#####."],
};
// [face shades, the face below, the edge]
const STONE = [["#a3a3a3", "#959595", "#8a8a8a", "#9c9c9c", "#b0b0b0", "#868686"], "#4b4b4b", "#141414"];
const CLAY = [["#dd7b5a", "#d06e4e", "#e58a68", "#c86449", "#d87555", "#ea9370"], "#7c3b27", "#1c0d08"];
const S = 4; // sub-units per block: the edge is one sub-unit wide, on whole units (crisp)

// Splash lines (Minecraft's yellow ones), per world type shown on the menu.
// (Short: the splash may not run past the menu's column.)
const SPLASHES = {
  survival: ["Punch a tree!", "Also try Missions!", "Made of blocks!", "Press F11!", "No build step!", "Mind the cactus!", "Play together!", "100% voxels!", "Now in a browser!"],
  missions: ["UFOs incoming!", "With mods!", "Shoot the saucer!", "Watch the sky!", "Jets at airports!", "Now with lasers!", "Missions together!"],
};

function hash(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// The SVG markup of `text` (letters from GLYPHS; the first `split` in stone, the rest in clay).
export function logoSvg(text = "MINECLAUDE", split = 4) {
  const cells = []; // [x, y, palette]
  let x = 0;
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    const pal = i < split ? STONE : CLAY;
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === "#") cells.push([x + c, r, pal]);
    x += g[0].length + 1;
  });
  const w = (x - 1) * S + 2;
  const h = 8 * S + 2; // seven rows and the face below, the edge around
  const edge = [];
  const below = [];
  const face = [];
  for (const [cx, cy, pal] of cells) {
    const px = cx * S + 1;
    const py = cy * S + 1;
    // The edge around the block and its face below (drawn first, under both).
    edge.push(`<rect x="${px - 1}" y="${py - 1}" width="${S + 2}" height="${2 * S + 2}" fill="${pal[2]}"/>`);
    below.push(`<rect x="${px}" y="${py + S}" width="${S}" height="${S}" fill="${pal[1]}"/>`);
    // Speckled, lighter along the top of each letter, darker at its foot.
    const shades = pal[0];
    let k = Math.floor(hash(cx, cy) * shades.length);
    if (cy === 0) k = shades.length - 2;
    face.push(`<rect x="${px}" y="${py}" width="${S}" height="${S}" fill="${shades[k]}"/>`);
    // (a light pixel at the block's top left: the block reads as a block)
    if (hash(cy, cx) < 0.35) face.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="#ffffff" fill-opacity="0.22"/>`);
  }
  return `<svg class="mc-logo-art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${edge.join("")}${below.join("")}${face.join("")}</svg>`;
}

// Fills every .mc-logo (once): the drawn logo over its text, and a splash slot.
export function drawLogos(root = document) {
  for (const el of root.querySelectorAll(".mc-logo:not(.drawn)")) {
    const text = (el.textContent || "MINECLAUDE").trim().toUpperCase();
    el.setAttribute("aria-label", text);
    el.innerHTML = `<span class="mc-logo-text">${text}</span>${logoSvg(text)}${el.dataset.splash !== undefined ? '<span class="mc-splash"></span>' : ""}`;
    el.classList.add("drawn");
  }
}

let splashType = null;
// The splash line for the world type the main menu shows (a new one each time it changes).
export function setSplash(type) {
  const t = type === "missions" ? "missions" : "survival";
  if (t === splashType) return;
  splashType = t;
  const list = SPLASHES[t];
  const line = list[Math.floor(Math.random() * list.length)];
  for (const el of document.querySelectorAll(".mc-splash")) {
    el.textContent = line;
    // (restart its pop)
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => drawLogos());
  else drawLogos();
}
