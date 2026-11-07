// Space (Round 15): the Moon's and Mars' blocks and items. Ids: blocks
// 3072-3199, items 920-959 (the End's unused share of 864-959: the End keeps
// 864-919). What a content module may export, and its rules: ./index.js.
//
// - The Moon (js/dim-moon.js): lunar regolith (the grey dust over
//   everything), moon rock (the bright highlands' anorthosite), mare basalt
//   (the dark plains, the "seas"), lunar crystal ore (rare, glowing a little:
//   1-2 lunar crystals, more with Fortune), lunar ice (the floors of the
//   deepest craters, where the sun never shines).
// - Mars (js/dim-mars.js): martian sand (falls, as sand; the dunes),
//   martian regolith (the rusty ground), martian rock, layered martian rock
//   (the canyons' banded walls), polar ice, hematite ore ("blueberries":
//   raw iron, as iron ore).
// - Things to find: alien bricks, glyph stones (they glow) and the alien
//   relic in the ruins (both planets); the crashed probes' plating, solar
//   panels and their glowing data core.
// - The launch pad (js/rocket.js builds one under a Creative rocket on the
//   Overworld's ground): concrete and its hazard-striped edge.
// - Items: the Rocket (the Creative palette's Vehicles tab: it places a
//   rocket on its launch pad, js/rocket.js through LIB.summonVehicle, as the
//   other vehicle items), the lunar crystal (a gem: nine make a block of it);
//   (Round 16) the Warp Saucer (the Vehicles tab too: a UFO with a warp
//   drive, js/warp-saucer.js; vehicles are Creative's, so it is not crafted).
// - (Round 17) Mercury (js/dim-mercury.js): mercurian regolith and rock
//   (grey-brown), smooth plains basalt (the dark volcanic plains), hollows
//   crust (bright, bluish, in the big craters' floors). Venus (js/dim-venus.js):
//   venusian soil and basalt, lava crust (the flows: glowing cracks), dome
//   rock (the pancake domes), sulfur crust (round the vents).
// Low gravity, the skies, the travel: js/space.js and js/dim-registry.js.
import { BLOCK, ITEM, LIB } from "./base.js";
import * as I from "./ids.js";

// ---- Blocks (3072-3199) ----
export const MOON_REGOLITH = 3072;
export const MOON_ROCK = 3073;
export const MARE_BASALT = 3074;
export const LUNAR_CRYSTAL_ORE = 3075;
export const LUNAR_ICE = 3076;
export const MARS_SAND = 3077;
export const MARS_REGOLITH = 3078;
export const MARS_ROCK = 3079;
export const MARS_STRATA = 3080;
export const MARS_ICE = 3081;
export const HEMATITE_ORE = 3082;
export const ALIEN_BRICKS = 3083;
export const ALIEN_GLYPH = 3084;
export const ALIEN_RELIC = 3085;
export const PROBE_PLATING = 3086;
export const SOLAR_PANEL = 3087;
export const PROBE_CORE = 3088;
export const LAUNCH_PAD = 3089;
export const LAUNCH_PAD_EDGE = 3090;
export const LUNAR_CRYSTAL_BLOCK = 3091;
export const MOONSTONE_BRICKS = 3092;
// (Round 17) Mercury (js/dim-mercury.js) and Venus (js/dim-venus.js)
export const MERCURY_REGOLITH = 3093;
export const MERCURY_ROCK = 3094;
export const MERCURY_PLAINS = 3095;
export const MERCURY_HOLLOWS = 3096;
export const VENUS_SOIL = 3097;
export const VENUS_BASALT = 3098;
export const VENUS_CRUST = 3099;
export const VENUS_FELSIC = 3100;
export const SULFUR_CRUST = 3101;
// (space.js blocks: next free 3102)

// ---- Items (920-959) ----
export const ROCKET_ITEM = 920;
export const LUNAR_CRYSTAL = 921;
export const WARP_ITEM = 922; // (Round 16)
// (space.js items: next free 923)

// ---------- Blocks ----------

export const blocks = {};
const def = (id, d) => (blocks[id] = d);
const PICK = { tool: "pickaxe", minTier: 1, sound: "stone" };
const between = (a, b, rand) => a + Math.floor(rand() * (b - a + 1));

def(MOON_REGOLITH, { name: "Lunar Regolith", faces: "moon_regolith", hardness: 0.5, tool: "shovel", sound: "sand" });
def(MOON_ROCK, { name: "Moon Rock", faces: "moon_rock", hardness: 1.5, ...PICK });
def(MARE_BASALT, { name: "Mare Basalt", faces: "mare_basalt", hardness: 1.5, ...PICK });
def(LUNAR_CRYSTAL_ORE, { name: "Lunar Crystal Ore", faces: "lunar_crystal_ore", hardness: 3, tool: "pickaxe", minTier: 2, sound: "stone", emission: 6, emissive: true, xp: [3, 7], fortune: "ore" });
def(LUNAR_ICE, { name: "Lunar Ice", faces: "lunar_ice", hardness: 0.5, tool: "pickaxe", sound: "glass", slipperiness: 0.98 });
def(MARS_SAND, { name: "Martian Sand", faces: "mars_sand", hardness: 0.5, tool: "shovel", sound: "sand", gravity: true });
def(MARS_REGOLITH, { name: "Martian Regolith", faces: "mars_regolith", hardness: 0.6, tool: "shovel", sound: "sand" });
def(MARS_ROCK, { name: "Martian Rock", faces: "mars_rock", hardness: 1.5, ...PICK });
def(MARS_STRATA, { name: "Layered Martian Rock", faces: { top: "mars_rock", bottom: "mars_rock", side: "mars_strata" }, hardness: 1.5, ...PICK });
def(MARS_ICE, { name: "Polar Ice", faces: "mars_ice", hardness: 0.5, tool: "pickaxe", sound: "glass", slipperiness: 0.98 });
def(HEMATITE_ORE, { name: "Hematite Ore", faces: "hematite_ore", hardness: 3, tool: "pickaxe", minTier: 2, sound: "stone", xp: [0, 1], fortune: "ore" });
def(ALIEN_BRICKS, { name: "Alien Bricks", faces: "alien_bricks", hardness: 4, ...PICK, blastResistance: 30 });
def(ALIEN_GLYPH, { name: "Alien Glyph Stone", faces: "alien_glyph", hardness: 4, ...PICK, blastResistance: 30, emission: 10, emissive: true });
def(ALIEN_RELIC, { name: "Alien Relic", faces: { top: "alien_relic_top", bottom: "alien_relic_top", side: "alien_relic" }, hardness: 5, ...PICK, blastResistance: 600, emission: 13, emissive: true });
def(PROBE_PLATING, { name: "Probe Plating", faces: "probe_plating", hardness: 3, tool: "pickaxe", sound: "stone" });
def(SOLAR_PANEL, { name: "Solar Panel", faces: { top: "solar_panel", bottom: "probe_plating", side: "probe_plating" }, hardness: 1, sound: "glass" });
def(PROBE_CORE, { name: "Probe Data Core", faces: "probe_core", hardness: 2, sound: "stone", emission: 9, emissive: true });
def(LAUNCH_PAD, { name: "Launch Pad Concrete", faces: "launch_pad", hardness: 2, ...PICK });
def(LAUNCH_PAD_EDGE, { name: "Launch Pad Edge", faces: { top: "launch_pad_edge", bottom: "launch_pad", side: "launch_pad" }, hardness: 2, ...PICK });
def(LUNAR_CRYSTAL_BLOCK, { name: "Block of Lunar Crystal", faces: "lunar_crystal_block", hardness: 5, ...PICK, emission: 12, emissive: true });
def(MOONSTONE_BRICKS, { name: "Moonstone Bricks", faces: "moonstone_bricks", hardness: 1.5, ...PICK });
// (Round 17) Mercury: grey-brown dust and rock, the dark smooth plains, the
// bright bluish "hollows" crumbling out of the big craters' floors.
def(MERCURY_REGOLITH, { name: "Mercurian Regolith", faces: "mercury_regolith", hardness: 0.5, tool: "shovel", sound: "sand" });
def(MERCURY_ROCK, { name: "Mercurian Rock", faces: "mercury_rock", hardness: 1.5, ...PICK });
def(MERCURY_PLAINS, { name: "Smooth Plains Basalt", faces: "mercury_plains", hardness: 1.5, ...PICK });
def(MERCURY_HOLLOWS, { name: "Hollows Crust", faces: "mercury_hollows", hardness: 0.6, tool: "shovel", sound: "sand" });
// (Round 17) Venus: orange-brown soil over volcanic basalt, the lava flows'
// crust (still glowing in its cracks), the pancake domes' pale rock, sulfur
// round the vents.
def(VENUS_SOIL, { name: "Venusian Soil", faces: "venus_soil", hardness: 0.6, tool: "shovel", sound: "sand" });
def(VENUS_BASALT, { name: "Venusian Basalt", faces: "venus_basalt", hardness: 1.5, ...PICK });
def(VENUS_CRUST, { name: "Lava Crust", faces: "venus_crust", hardness: 1.2, ...PICK, emission: 7, emissive: true });
def(VENUS_FELSIC, { name: "Dome Rock", faces: "venus_felsic", hardness: 1.5, ...PICK });
def(SULFUR_CRUST, { name: "Sulfur Crust", faces: "sulfur_crust", hardness: 0.8, tool: "pickaxe", sound: "sand" });

// ---------- Items ----------

export const items = {
  // (Round 15) The rocket: placed on its pad as the other vehicle items (Creative's Vehicles tab).
  [ROCKET_ITEM]: { name: "Rocket (to the Moon and Mars)", icon: "vehicle_rocket", stack: 1, vehicle: "rocket" },
  [LUNAR_CRYSTAL]: { name: "Lunar Crystal", icon: "lunar_crystal" },
  // (Round 16) The Warp Saucer: in the air, aimed at the sky; on the ground aimed at.
  [WARP_ITEM]: { name: "UFO (warp drive in space)", icon: "vehicle_warp", stack: 1, vehicle: "warp" },
};

export const itemUse = {
  [ROCKET_ITEM]: (ctx) => !!LIB.summonVehicle?.(ctx, "rocket"),
  [WARP_ITEM]: (ctx) => !!LIB.summonVehicle?.(ctx, "warp"),
};

// ---------- Drops ----------

export const drops = {
  [LUNAR_CRYSTAL_ORE]: (tool, rand) => [[LUNAR_CRYSTAL, between(1, 2, rand)]],
  // (vanilla's iron ore: its raw iron)
  [HEMATITE_ORE]: () => [[I.RAW_IRON, 1]],
  // (regolith with a shovel or without: itself; ice melts in no air: itself too)
};

// ---------- Recipes ----------

export const recipes = () => [
  { type: "shaped", pattern: ["###", "###", "###"], key: { "#": LUNAR_CRYSTAL }, result: [LUNAR_CRYSTAL_BLOCK, 1] },
  { type: "shapeless", ingredients: [LUNAR_CRYSTAL_BLOCK], result: [LUNAR_CRYSTAL, 9] },
  { type: "shaped", pattern: ["##", "##"], key: { "#": MOON_ROCK }, result: [MOONSTONE_BRICKS, 4] },
  { type: "smelting", input: MARS_SAND, result: [BLOCK.GLASS, 1], xp: 0.1, time: 10 },
  { type: "smelting", input: HEMATITE_ORE, result: [I.IRON_INGOT, 1], xp: 0.7, time: 10 },
];

// ---------- Textures ----------

const R = (kit, list) => list.map(kit.hex);
const clamp = (v) => Math.max(0, Math.min(1, v));

// Fine dust with pebbles and a few tiny craters (the regolith's).
function dust(t, kit, colors, pebbles = 14, craters = 2) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    const f = 0.5 + (t.fbm(x, y, 4, 3) - 0.5) * 0.45 + (t.rand() - 0.5) * 0.28;
    t.set(x, y, kit.ramp(ramp, f));
  });
  const r = kit.makeRand(t.seed + 11);
  for (let k = 0; k < craters; k++) {
    const cx = r() * 32;
    const cy = r() * 32;
    const rr = 2.5 + r() * 3;
    for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) {
      for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rr;
        if (d > 1.15) continue;
        // (lit from the top left: the bowl's far wall bright, the near one in shade, a bright rim)
        const side = ((x + 0.5 - cx) + (y + 0.5 - cy)) / rr;
        const f = d > 0.9 ? 1.08 : 0.86 + side * 0.18;
        t.shade(x, y, f);
      }
    }
  }
  for (let k = 0; k < pebbles; k++) {
    const x = Math.floor(r() * 32);
    const y = Math.floor(r() * 32);
    const c = ramp[Math.min(ramp.length - 1, 3 + Math.floor(r() * 3))];
    t.set(x, y, c);
    t.set(x + 1, y + 1, kit.scaleRgb(ramp[0], 0.85));
  }
}
// Lumpy rock: cells with dark seams (moon rock's, mars rock's).
function rock(t, kit, colors, cells = 18, seam = 0.25) {
  const ramp = R(kit, colors);
  const v = t.voronoi(cells, 3);
  t.forEach((x, y) => {
    const c = v(x, y);
    let f = 0.5 + (c.value - 0.5) * 0.3 + (t.fbm(x, y, 8, 2) - 0.5) * 0.35 + (t.rand() - 0.5) * 0.16;
    if (c.d2 - c.d1 < 1.1) f -= seam;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Bands across the tile (the canyon walls' strata).
function strata(t, kit, colors) {
  const ramp = R(kit, colors);
  t.forEach((x, y) => {
    const w = y + (t.noise(x, y, 4, 2) - 0.5) * 3;
    const band = ((Math.floor(w / 4) % 4) + 4) % 4;
    let f = [0.25, 0.55, 0.4, 0.75][band] + (t.fbm(x, y, 8, 2) - 0.5) * 0.3 + (t.rand() - 0.5) * 0.12;
    if (((w % 4) + 4) % 4 < 0.6) f -= 0.18;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Crystals in rock: faceted shards (lit from the top left).
function crystals(t, kit, base, colors, n = 6) {
  base(t, kit);
  const [dark, mid, light] = R(kit, colors);
  const r = kit.makeRand(t.seed + 21);
  for (let i = 0; i < n; i++) {
    const cx = 3 + Math.floor(r() * 26);
    const cy = 3 + Math.floor(r() * 26);
    const h = 3 + Math.floor(r() * 4);
    for (let k = 0; k < h; k++) {
      const w = k < h - 1 ? 1 : 0;
      for (let dx = -w; dx <= w; dx++) t.set(cx + dx, cy - k, dx < 0 ? light : dx > 0 ? dark : mid);
    }
    t.set(cx, cy - h, light);
  }
}
function bricks(t, kit, colors, mortar, bw = 16, bh = 8) {
  const ramp = R(kit, colors);
  const m = kit.hex(mortar);
  t.forEach((x, y) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const bx = (x + off) % bw;
    if (y % bh === 0 || bx === 0) {
      t.set(x, y, m);
      return;
    }
    const f = 0.5 + (t.noise(x, y, 8, 5) - 0.5) * 0.4 + (t.rand() - 0.5) * 0.15 + (y % bh === 1 ? 0.12 : 0);
    t.set(x, y, kit.ramp(ramp, f));
  });
}
// Lines of light in a dark stone (the alien glyphs: drawn glowing).
function glyphs(t, kit, stone, glow) {
  bricks(t, kit, stone, 0x07060c, 32, 32);
  const g = R(kit, glow);
  const r = kit.makeRand(t.seed + 3);
  // (a ring and marks around it, as no human script)
  t.forEach((x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5);
    if (Math.abs(d - 9) < 0.8) t.set(x, y, g[1]);
  });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + r() * 0.3;
    const x0 = 15.5 + Math.cos(a) * 4;
    const y0 = 15.5 + Math.sin(a) * 4;
    for (let s = 0; s < 4; s++) t.set(Math.round(x0 + Math.cos(a) * s), Math.round(y0 + Math.sin(a) * s), g[s < 2 ? 2 : 1]);
  }
  for (let k = 0; k < 4; k++) {
    const x = 3 + Math.floor(r() * 26);
    const y = r() < 0.5 ? 2 + Math.floor(r() * 3) : 27 + Math.floor(r() * 3);
    for (let s = 0; s < 3; s++) t.set(x + s, y, g[0]);
  }
  t.set(15, 15, g[2]);
  t.set(16, 16, g[2]);
}

export const tiles = {
  moon_regolith: (t, kit) => dust(t, kit, [0x48484a, 0x555557, 0x616163, 0x6d6d6f, 0x7a7a7b, 0x8a8a8a], 16, 2),
  moon_rock: (t, kit) => rock(t, kit, [0x5e5e60, 0x6e6e70, 0x7e7e80, 0x8e8e90, 0x9e9e9e, 0xb0b0ae], 16, 0.22),
  mare_basalt: (t, kit) => rock(t, kit, [0x2c2c2e, 0x36363a, 0x404044, 0x4a4a4e, 0x56565a, 0x626266], 22, 0.18),
  lunar_crystal_ore: (t, kit) => crystals(t, kit, (tt, k) => rock(tt, k, [0x6e6e70, 0x808082, 0x929294, 0xa2a2a4, 0xb2b2b2], 16, 0.22), [0x1a8aa8, 0x48d8f0, 0xc8ffff], 6),
  lunar_ice: (t, kit) => {
    const ramp = R(kit, [0x6e8494, 0x7e96a8, 0x90a8ba, 0xa4bccc, 0xb8d0de, 0xd0e4ee]);
    t.forEach((x, y) => {
      let f = 0.55 + (t.fbm(x, y, 4, 3) - 0.5) * 0.5 + (t.rand() - 0.5) * 0.1;
      // (frost cracks)
      if (Math.abs(((x * 0.7 + y * 1.3 + t.noise(x, y, 4) * 9) % 13) - 6.5) < 0.45) f -= 0.3;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  mars_sand: (t, kit) => {
    const ramp = R(kit, [0x8a4a2a, 0x9a5430, 0xaa6038, 0xb86c40, 0xc47a4a, 0xd08a56]);
    t.forEach((x, y) => {
      // (ripples)
      const s = Math.sin((y + t.noise(x, y, 3, 4) * 6) * 0.9);
      const f = 0.5 + s * 0.12 + (t.fbm(x, y, 4, 2) - 0.5) * 0.3 + (t.rand() - 0.5) * 0.24;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  mars_regolith: (t, kit) => dust(t, kit, [0x5c3020, 0x6c3a26, 0x7c442c, 0x8c5034, 0x9a5c3e, 0xa86a48], 18, 1),
  mars_rock: (t, kit) => rock(t, kit, [0x3e1c12, 0x4c2216, 0x5a2a1a, 0x68321e, 0x763c24, 0x86482c], 18, 0.2),
  mars_strata: (t, kit) => strata(t, kit, [0x4e2416, 0x62301c, 0x7a4026, 0x925230, 0xa8643c, 0xbc7a4c]),
  mars_ice: (t, kit) => dust(t, kit, [0xb8a49a, 0xc8b6ac, 0xd6c6be, 0xe2d6d0, 0xece4e0, 0xf6f2f0], 6, 1),
  hematite_ore: (t, kit) => {
    rock(t, kit, [0x3e1c12, 0x4c2216, 0x5a2a1a, 0x68321e, 0x763c24, 0x86482c], 18, 0.2);
    // (the "blueberries": little grey-blue spheres, lit at the top left)
    const r = kit.makeRand(t.seed + 13);
    const [d, m, l] = R(kit, [0x2a2c34, 0x52586a, 0x9aa4ba]);
    for (let k = 0; k < 9; k++) {
      const x = 2 + Math.floor(r() * 28);
      const y = 2 + Math.floor(r() * 28);
      t.set(x, y, m);
      t.set(x + 1, y, m);
      t.set(x, y + 1, m);
      t.set(x + 1, y + 1, d);
      t.set(x, y, l);
    }
  },
  alien_bricks: (t, kit) => bricks(t, kit, [0x14121e, 0x1c1828, 0x241f34, 0x2c2640, 0x362e4e], 0x07060c, 16, 8),
  alien_glyph: (t, kit) => glyphs(t, kit, [0x14121e, 0x1c1828, 0x241f34, 0x2c2640, 0x362e4e], [0x2aa894, 0x56f0d0, 0xc8fff0]),
  alien_relic: (t, kit) => {
    const ramp = R(kit, [0x1c0e30, 0x34184e, 0x50246e, 0x7a3a9a, 0xa860c8, 0xe0a8f4]);
    t.forEach((x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5) / 16;
      const swirl = Math.sin(Math.atan2(y - 15.5, x - 15.5) * 3 + d * 12);
      t.set(x, y, kit.ramp(ramp, clamp(0.85 - d * 0.7 + swirl * 0.12 + (t.rand() - 0.5) * 0.08)));
    });
    const g = R(kit, [0x56f0d0, 0xc8fff0]);
    for (let k = 4; k < 28; k++) {
      t.set(k, 3, g[0]);
      t.set(k, 28, g[0]);
    }
    t.set(15, 15, g[1]);
    t.set(16, 15, g[1]);
    t.set(15, 16, g[1]);
    t.set(16, 16, g[1]);
  },
  alien_relic_top: (t, kit) => glyphs(t, kit, [0x1c0e30, 0x2a1442, 0x381a56, 0x46206a, 0x56287e], [0x8a40c0, 0xd080ff, 0xf8e0ff]),
  probe_plating: (t, kit) => {
    // (gold foil: crinkled, bright)
    const ramp = R(kit, [0x6a4a10, 0x8c6418, 0xb08422, 0xcca232, 0xe4c050, 0xf6de86]);
    const v = t.voronoi(30, 7);
    t.forEach((x, y) => {
      const c = v(x, y);
      let f = 0.35 + c.value * 0.5 + (t.rand() - 0.5) * 0.1;
      if (c.d2 - c.d1 < 0.8) f += 0.25;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  solar_panel: (t, kit) => {
    const ramp = R(kit, [0x0c1838, 0x12224c, 0x1a3064, 0x24407e, 0x34589c]);
    const frame = kit.hex(0x9aa0a8);
    t.forEach((x, y) => {
      if (x === 0 || y === 0 || x === 31 || y === 31) return t.set(x, y, frame);
      if (x % 8 === 0 || y % 8 === 0) return t.set(x, y, kit.hex(0x50586a));
      const f = 0.45 + ((x % 8) + (y % 8)) * 0.02 + (t.rand() - 0.5) * 0.1 + (x % 8 === 1 && y % 8 === 1 ? 0.4 : 0);
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  probe_core: (t, kit) => {
    const ramp = R(kit, [0x203038, 0x2c4a58, 0x3c6c80, 0x58a0b8, 0x8ee0f4, 0xd8ffff]);
    t.forEach((x, y) => {
      const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
      let f = d > 13 ? 0.15 : d > 11 ? 0.3 : 0.5 + Math.sin(d * 1.3) * 0.2 + (t.rand() - 0.5) * 0.08;
      if (d < 4) f = 0.95;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  launch_pad: (t, kit) => {
    const ramp = R(kit, [0x7a7a76, 0x868682, 0x92928e, 0x9e9e9a, 0xaaaaa6]);
    t.forEach((x, y) => {
      let f = 0.5 + (t.fbm(x, y, 8, 2) - 0.5) * 0.3 + (t.rand() - 0.5) * 0.2;
      if (x === 0 || y === 0) f -= 0.25; // (the slabs' joints)
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  launch_pad_edge: (t, kit) => {
    const y0 = kit.hex(0xe0b020);
    const k0 = kit.hex(0x1c1c1c);
    t.forEach((x, y) => {
      const stripe = Math.floor((x + y) / 6) % 2 === 0;
      const c = stripe ? y0 : k0;
      t.set(x, y, kit.scaleRgb(c, 0.9 + t.rand() * 0.15));
    });
  },
  lunar_crystal_block: (t, kit) => {
    const ramp = R(kit, [0x0e5a70, 0x1a8aa8, 0x30b4d0, 0x58d8f0, 0x98f0ff, 0xd8ffff]);
    const v = t.voronoi(10, 9);
    t.forEach((x, y) => {
      const c = v(x, y);
      let f = 0.4 + c.value * 0.45 - c.d1 / 30 + (t.rand() - 0.5) * 0.08;
      if (c.d2 - c.d1 < 1) f = 0.95;
      t.set(x, y, kit.ramp(ramp, f));
    });
  },
  moonstone_bricks: (t, kit) => bricks(t, kit, [0x7a7a7c, 0x8a8a8c, 0x9a9a9c, 0xaaaaac, 0xbababa], 0x4a4a4c, 16, 8),
  // (Round 17) Mercury
  mercury_regolith: (t, kit) => dust(t, kit, [0x4a4440, 0x56504a, 0x625b54, 0x6e665e, 0x7c736a, 0x8c8278], 16, 3),
  mercury_rock: (t, kit) => rock(t, kit, [0x4e4842, 0x5c554e, 0x6a625a, 0x786f66, 0x867c72, 0x968b80], 15, 0.24),
  mercury_plains: (t, kit) => rock(t, kit, [0x302c2a, 0x3a3532, 0x443e3a, 0x4e4743, 0x58514c, 0x645c56], 24, 0.16),
  mercury_hollows: (t, kit) => dust(t, kit, [0x6e7c88, 0x7e8e9a, 0x90a0ac, 0xa2b2be, 0xb6c4ce, 0xccd8e0], 8, 1),
  // (Round 17) Venus
  venus_soil: (t, kit) => dust(t, kit, [0x4e3620, 0x5c4026, 0x6a4a2c, 0x7a5634, 0x88623c, 0x987046], 14, 0),
  venus_basalt: (t, kit) => rock(t, kit, [0x26201c, 0x302822, 0x3a3028, 0x463a30, 0x524438, 0x604e40], 20, 0.18),
  venus_crust: (t, kit) => {
    // (black glassy crust, plates split by glowing cracks)
    rock(t, kit, [0x0e0c0c, 0x161212, 0x1e1816, 0x261e1a, 0x30261e, 0x3a2e24], 9, 0.0);
    const glow = R(kit, [0x8a1e04, 0xd04a08, 0xff8a1e, 0xffd070]);
    const v = t.voronoi(9, 5);
    t.forEach((x, y) => {
      const c = v(x, y);
      const e = c.d2 - c.d1;
      if (e < 0.7) t.set(x, y, glow[2 + (t.rand() < 0.3 ? 1 : 0)]);
      else if (e < 1.4) t.set(x, y, glow[t.rand() < 0.5 ? 0 : 1]);
    });
  },
  venus_felsic: (t, kit) => rock(t, kit, [0x5a4c3e, 0x685848, 0x766454, 0x847060, 0x927e6c, 0xa28c7a], 12, 0.2),
  sulfur_crust: (t, kit) => dust(t, kit, [0x8a7a10, 0xa89418, 0xc4ae22, 0xd8c234, 0xe8d450, 0xf6e47a], 10, 1),
};

export const tileRelief = {
  moon_regolith: [0.9, 0.9, 0.5],
  moon_rock: [1.1, 0.8, 0.6],
  mare_basalt: [1.0, 0.8, 0.6],
  mars_sand: [0.7, 0.9, 0.5],
  mars_regolith: [0.9, 0.9, 0.5],
  mars_rock: [1.1, 0.8, 0.6],
  mars_strata: [1.0, 0.8, 0.6],
  mercury_regolith: [0.9, 0.9, 0.5],
  mercury_rock: [1.1, 0.8, 0.6],
  mercury_plains: [1.0, 0.8, 0.6],
  venus_soil: [0.9, 0.9, 0.5],
  venus_basalt: [1.1, 0.8, 0.6],
  venus_felsic: [1.0, 0.8, 0.6],
};

// ---------- Icons ----------

export const icons = {
  // A rocket standing up: the white body with its black roll pattern, the
  // nose, the fins and a flame.
  vehicle_rocket: (kit) => {
    const c = new kit.Canvas();
    const BODY = 0;
    const DARK = 1;
    const FLAME = 2;
    c.poly(FLAME, [[13.5, 26], [18.5, 26], [16, 31.5]], () => 0.4);
    c.poly(DARK, [[11, 19], [13, 17], [13, 25], [10, 27]], () => 0);
    c.poly(DARK, [[21, 19], [19, 17], [19, 25], [22, 27]], () => -0.1);
    c.poly(BODY, [[16, 1.5], [18.6, 6], [19, 10], [19, 26], [13, 26], [13, 10], [13.4, 6]], (x) => (x < 16 ? 0.25 : -0.1));
    c.poly(DARK, [[13, 12], [16, 12], [16, 15], [13, 15]], () => 0);
    c.poly(DARK, [[16, 19], [19, 19], [19, 22], [16, 22]], () => -0.2);
    c.poly(DARK, [[14.5, 6], [17.5, 6], [17.5, 8], [14.5, 8]], () => 0.3);
    const body = kit.ramp(0x9a9c9e, 0xc2c4c4, 0xdcdcda, 0xeeeeea, 0xffffff);
    const dark = kit.ramp(0x101012, 0x1c1c20, 0x2a2a30, 0x3a3a42, 0x4c4c56);
    const flame = kit.ramp(0xa03008, 0xe06010, 0xf8a020, 0xffd060, 0xfff0b0);
    return c.render([body, dark, flame], [18, 18, 20]);
  },
  // (Round 16) The Warp Saucer from the side: the domed hull, its glowing
  // drive ring, a nacelle under each side, streaks behind.
  vehicle_warp: (kit) => {
    const c = new kit.Canvas();
    const HULL = 0;
    const GLOW = 1;
    const DARK = 2;
    c.line(GLOW, 2, 14, 9, 14, 0.8, () => 0.2);
    c.line(GLOW, 1, 22, 8, 22, 0.8, () => 0.2);
    c.disc(DARK, 9.5, 23.5, 4.5, 1.6, () => -0.1);
    c.disc(DARK, 22.5, 23.5, 4.5, 1.6, () => -0.1);
    c.disc(GLOW, 5.5, 23.5, 1.4, 1.4, () => 0.6);
    c.disc(GLOW, 18.5, 23.5, 1.4, 1.4, () => 0.6);
    c.disc(HULL, 16, 12.5, 6, 5.5, (x, y) => (x < 14 && y < 10 ? 0.6 : 0.1));
    c.disc(HULL, 16, 18, 14, 4.2, (x, y) => (y < 16.5 ? 0.45 : y > 20 ? -0.45 : 0));
    c.disc(GLOW, 16, 18.6, 15, 1.1, () => 0.4);
    const hull = kit.ramp(0x3c4452, 0x5f6a7a, 0x8a96a8, 0xb4bfce, 0xe2e8f0);
    const glow = kit.ramp(0x1a4ca0, 0x2a74d8, 0x4aa0ff, 0x8cc8ff, 0xdff0ff);
    const dark = kit.ramp(0x14181f, 0x20262f, 0x2e3540, 0x3e4652, 0x525b68);
    return c.render([hull, glow, dark], [16, 26, 14]);
  },
  lunar_crystal: (kit) => {
    const c = new kit.Canvas();
    c.poly(0, [[16, 3], [23, 11], [21, 25], [16, 29], [11, 25], [9, 11]], (x, y) => (x < 16 ? 0.35 : -0.1) + (y < 12 ? 0.2 : 0));
    c.poly(1, [[16, 3], [19, 11], [16, 27], [13, 11]], () => 0.5);
    const a = kit.ramp(0x0e5a70, 0x1a8aa8, 0x30b4d0, 0x58d8f0, 0x98f0ff);
    const b = kit.ramp(0x58d8f0, 0x98f0ff, 0xc8ffff, 0xe8ffff, 0xffffff);
    return c.render([a, b], [8, 30, 40]);
  },
};

// (Kept for the generators: what is "ground" on each planet.)
export const MOON_GROUND = new Set([MOON_REGOLITH, MOON_ROCK, MARE_BASALT]);
export const MARS_GROUND = new Set([MARS_SAND, MARS_REGOLITH, MARS_ROCK, MARS_STRATA]);
export const MERCURY_GROUND = new Set([MERCURY_REGOLITH, MERCURY_ROCK, MERCURY_PLAINS, MERCURY_HOLLOWS]); // (Round 17)
export const VENUS_GROUND = new Set([VENUS_SOIL, VENUS_BASALT, VENUS_CRUST, VENUS_FELSIC, SULFUR_CRUST]);
export { ITEM };
