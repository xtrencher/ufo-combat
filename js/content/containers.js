// Containers and work blocks (Round 11): the furnace (lit and unlit), and the
// crafting table's use. Ids: blocks 1792-1855. What a content module may
// export, and its rules (imports only ./base.js and other content modules' id
// constants): see ./index.js.
//
// The furnace faces the player who places it (8 ids: FURNACE + facing (0 +Z,
// 1 -Z, 2 +X, 3 -X) + 4 when lit); its smelting is js/furnace.js, its screen
// js/inventory-ui.js. A right click opens the screen through the interaction's
// onOpenScreen hook (main.js): "furnace" here; "table" for the crafting table,
// in a Survival world only (in a Missions world it stays as it was).
// The recipes are js/crafting.js's (the core ones) and the other modules'.
//
// (Round 11, wave C) Magic: the enchanting table ("enchanting" screen,
// js/enchant.js), the anvil (12 ids: three wear states, normal, chipped and
// damaged, of 4 facings each; it falls like sand and wears with use: the
// "anvil" screen), the brewing stand ("brewing", js/brewing.js) and the
// cauldron (4 ids: water level 0-3; buckets and bottles fill and empty it).
// These work in either world type (outside a Survival world only Creative
// has them).
// (Round 12) The barrel (27 slots, the chest's screen; js/chests.js). The
// other work blocks are ./workstations.js's.
import { BLOCK, FACE, LIB } from "./base.js";
import { FURNACE, ENCHANTING_TABLE, ANVIL, BREWING_STAND, CAULDRON, BARREL, BUCKET, WATER_BUCKET, GLASS_BOTTLE, POTION, BLAZE_ROD, BLACKSTONE } from "./ids.js";
import { isVanilla } from "../worldtype.js";

// (Round 11) The anvil's worn states (4 facings each, after the barrel).
export const CHIPPED_ANVIL = 1811;
export const DAMAGED_ANVIL = 1815;
const ANVILS = [ANVIL, CHIPPED_ANVIL, DAMAGED_ANVIL];
export const isAnvil = (id) => ANVILS.some((b) => id >= b && id < b + 4);
export const isCauldron = (id) => id >= CAULDRON && id < CAULDRON + 4;
export const cauldronLevel = (id) => (isCauldron(id) ? id - CAULDRON : -1);

// Facing k: [dx, dz] of the front, and the face it is on.
const FACINGS = [
  [0, 1, FACE.PZ],
  [0, -1, FACE.NZ],
  [1, 0, FACE.PX],
  [-1, 0, FACE.NX],
];

// The facing toward a viewer looking along `forward` (the front looks back at them).
function facingToward(forward) {
  const dx = -(forward?.[0] ?? 0);
  const dz = -(forward?.[2] ?? 1);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 2 : 3;
  return dz >= 0 ? 0 : 1;
}

export const blocks = {};
for (let lit = 0; lit < 2; lit++) {
  FACINGS.forEach(([dx, dz, face], k) => {
    const id = FURNACE + k + 4 * lit;
    blocks[id] = {
      name: "Furnace",
      faces: { top: "furnace_top", bottom: "furnace_top", side: "furnace_side", front: lit ? "furnace_front_lit" : "furnace_front" },
      frontFace: face,
      facing: [dx, dz],
      emission: lit ? 13 : 0, // (vanilla: a lit furnace gives light 13)
      hardness: 3.5,
      tool: "pickaxe",
      minTier: 1,
      sound: "stone",
      // (Every variant counts as the furnace item; placed, it faces the player.)
      item: id === FURNACE ? null : FURNACE,
      placeAs: (ctx) => FURNACE + facingToward(ctx.forward),
    };
  });
}

// ---------- Magic (Round 11) ----------
const S16 = 1 / 16;
// The enchanting table: a 12-high block of obsidian with a red cloth top (vanilla: light 7).
blocks[ENCHANTING_TABLE] = {
  name: "Enchanting Table",
  faces: { top: "enchanting_table_top", bottom: "obsidian", side: "enchanting_table_side" },
  shape: "enchanting_table",
  opaque: false,
  box: [0, 0, 0, 1, 0.75, 1],
  collision: [[0, 0, 0, 1, 0.75, 1]],
  itemBoxes: [[0, 0, 0, 1, 0.75, 1]],
  emission: 7,
  hardness: 5,
  blastResistance: 1200,
  tool: "pickaxe",
  minTier: 1,
  sound: "stone",
};
// The anvil: its long side across the facing (toward whoever placed it).
const ANVIL_X = [[2, 0, 2, 14, 4, 14], [3, 4, 4, 13, 5, 12], [4, 5, 6, 12, 10, 10], [0, 10, 3, 16, 16, 13]].map((b) => b.map((v) => v * S16));
const ANVIL_Z = ANVIL_X.map(([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1]);
const ANVIL_NAMES = ["Anvil", "Chipped Anvil", "Damaged Anvil"];
const ANVIL_TOPS = ["anvil_top", "anvil_top_chipped", "anvil_top_damaged"];
ANVILS.forEach((base, w) => {
  for (let k = 0; k < 4; k++) {
    const alongX = k < 2;
    const sel = alongX ? [0, 0, 3 * S16, 1, 1, 13 * S16] : [3 * S16, 0, 0, 13 * S16, 1, 1];
    blocks[base + k] = {
      name: ANVIL_NAMES[w],
      faces: { top: ANVIL_TOPS[w], bottom: "anvil_base", side: "anvil_base" },
      shape: "anvil",
      opaque: false,
      box: sel,
      collision: [sel],
      facing: FACINGS[k].slice(0, 2),
      gravity: true,
      hardness: 5,
      blastResistance: 1200,
      tool: "pickaxe",
      minTier: 1,
      sound: "stone",
      wear: w,
      ...(k ? { item: base } : { placeAs: (ctx) => base + facingToward(ctx.forward), itemBoxes: ANVIL_X }),
    };
  }
});
// The brewing stand: a rod over three small plates (vanilla's shape).
const BREW_PARTS = [[7, 0, 7, 9, 14, 9, 1], [9, 0, 5, 15, 2, 11, 0], [2, 0, 1, 8, 2, 7, 0], [2, 0, 9, 8, 2, 15, 0]].map((b) => [...b.slice(0, 6).map((v) => v * S16), b[6]]);
blocks[BREWING_STAND] = {
  name: "Brewing Stand",
  faces: "brewing_stand",
  shape: "brewing_stand",
  opaque: false,
  box: [S16, 0, S16, 15 * S16, 14 * S16, 15 * S16],
  collision: [[S16, 0, S16, 15 * S16, 2 * S16, 15 * S16], [7 * S16, 0, 7 * S16, 9 * S16, 14 * S16, 9 * S16]],
  itemBoxes: BREW_PARTS.map((b) => [...b.slice(0, 6), b[6] ? [0.5, 0, 1, 1] : [0, 0, 0.5, 1]]),
  emission: 1,
  hardness: 0.5,
  tool: "pickaxe",
  minTier: 1,
  sound: "stone",
};
// The cauldron: walls round a floor on four short legs; water at 9, 12 or 15 sixteenths.
const CAULDRON_WALLS = [[0, 3, 0, 16, 16, 2], [0, 3, 14, 16, 16, 16], [0, 3, 2, 2, 16, 14], [14, 3, 2, 16, 16, 14], [2, 3, 2, 14, 4, 14]].map((b) => b.map((v) => v * S16));
const CAULDRON_LEGS = [[0, 0, 0, 4, 3, 4], [12, 0, 0, 16, 3, 4], [0, 0, 12, 4, 3, 16], [12, 0, 12, 16, 3, 16]].map((b) => b.map((v) => v * S16));
for (let lvl = 0; lvl < 4; lvl++) {
  blocks[CAULDRON + lvl] = {
    name: "Cauldron",
    // (the water's tile rides on the bottom face, which the mesh never draws as such)
    faces: { top: "cauldron_top", bottom: "cauldron_side", side: "cauldron_side", front: "water" },
    frontFace: FACE.NY,
    shape: "cauldron",
    opaque: false,
    box: [0, 0, 0, 1, 1, 1],
    collision: [[0, 0, 0, 1, 4 * S16, 1], ...CAULDRON_WALLS.slice(0, 4)],
    hardness: 2,
    tool: "pickaxe",
    minTier: 1,
    sound: "stone",
    ...(lvl ? { item: CAULDRON } : { itemBoxes: [...CAULDRON_WALLS, ...CAULDRON_LEGS] }),
  };
}

// (Round 12) The barrel: a chest of 27 slots in a block (js/chests.js keeps
// them; its screen is the chest's), standing upright whichever way it is
// placed. A village's (the fisher's) starts empty.
blocks[BARREL] = {
  name: "Barrel",
  faces: { top: "barrel_top", bottom: "barrel_bottom", side: "barrel_side" },
  chest: true, // (js/blocks.js IS_CHEST)
  hardness: 2.5,
  tool: "axe",
  sound: "wood",
};

// The anvil worn one step (vanilla: 12% a use): the next state's id, or AIR
// (it breaks). Keeps the facing.
export function wornAnvil(id) {
  for (let w = 0; w < 3; w++) {
    const base = ANVILS[w];
    if (id >= base && id < base + 4) return w < 2 ? ANVILS[w + 1] + (id - base) : BLOCK.AIR;
  }
  return id;
}

// ---------- Textures (4 + 9 tiles) ----------

// The furnace's stone: smooth, a little darker than stone, with a bevelled rim.
function body(t, kit) {
  kit.base("stone", t);
  t.forEach((x, y) => {
    const c = t.get(x, y);
    let f = 0.9;
    if (x === 0 || y === 0) f = 1.12;
    else if (x === 31 || y === 31) f = 0.66;
    else if (x === 1 || y === 1) f = 1.02;
    else if (x === 30 || y === 30) f = 0.76;
    t.set(x, y, kit.scaleRgb(c, f));
  });
}

function front(t, kit, lit) {
  body(t, kit);
  // The vent slot on top and the fire opening below, with an iron grate over it.
  for (let y = 6; y <= 9; y++) for (let x = 9; x <= 22; x++) t.set(x, y, y === 6 ? [40, 40, 42] : [22, 21, 22]);
  for (let x = 9; x <= 22; x++) t.set(x, 10, [150, 150, 154]);
  for (let y = 15; y <= 27; y++) {
    for (let x = 7; x <= 24; x++) {
      const edge = y === 15 || x === 7 || x === 24;
      if (edge) {
        t.set(x, y, [44, 43, 45]);
        continue;
      }
      if (!lit) {
        t.set(x, y, y > 24 ? [34, 30, 28] : [16, 15, 16]);
        continue;
      }
      // Flames: white-yellow at the bed of coals, through orange to dark red.
      const n = t.noise(x, y, 8, 3) * 0.6 + t.noise(x, y, 16, 4) * 0.4;
      const h = (27 - y) / 12 + (n - 0.5) * 0.7;
      const col = h < 0.2 ? [255, 236, 150] : h < 0.45 ? [255, 190, 60] : h < 0.7 ? [232, 110, 24] : h < 0.9 ? [150, 46, 14] : [40, 18, 12];
      t.set(x, y, col);
    }
  }
  // (The grate: bars down across the opening.)
  for (let y = 16; y <= 26; y++) for (const x of [11, 15, 19, 23]) if (y % 5 !== 0) t.set(x, y, kit.scaleRgb(t.get(x, y), lit ? 0.55 : 0.8));
  for (let x = 8; x <= 23; x++) t.set(x, 16, lit ? [120, 70, 40] : [70, 68, 70]);
}

export const tiles = {
  furnace_side: (t, kit) => body(t, kit),
  furnace_top: (t, kit) => {
    body(t, kit);
    // (A smooth slab on top: an inner border.)
    for (let i = 3; i <= 28; i++) {
      t.set(i, 3, kit.scaleRgb(t.get(i, 3), 0.8));
      t.set(3, i, kit.scaleRgb(t.get(3, i), 0.8));
      t.set(i, 28, kit.scaleRgb(t.get(i, 28), 1.15));
      t.set(28, i, kit.scaleRgb(t.get(28, i), 1.15));
    }
  },
  furnace_front: (t, kit) => front(t, kit, false),
  furnace_front_lit: (t, kit) => front(t, kit, true),
};
// (Round 11) The magic blocks' 9 tiles.
function obsidianish(t, x, y) {
  const n = t.fbm(x, y, 4, 3, 7) * 0.7 + t.rand() * 0.3;
  const glint = t.noise(x, y, 16, 3) > 0.82 ? 40 : 0;
  return [Math.round(16 + n * 26 + glint * 0.6), Math.round(10 + n * 16), Math.round(28 + n * 36 + glint)];
}
function iron(t, x, y, k = 1) {
  const n = t.fbm(x, y, 8, 2, 5) * 0.6 + t.rand() * 0.4;
  const v = Math.min(255, Math.round((74 + n * 36) * k));
  return [v, v, Math.min(255, v + 5)];
}
function anvilTop(t, kit, wear) {
  t.forEach((x, y) => {
    const rim = x <= 1 || x >= 30 || y <= 1 || y >= 30;
    t.set(x, y, iron(t, x, y, rim ? 0.75 : 1.08));
  });
  // (A worn anvil's cracks: a few dark zigzags.)
  const cracks = wear === 0 ? 0 : wear === 1 ? 3 : 7;
  for (let k = 0; k < cracks; k++) {
    let x = 3 + Math.floor(t.rand() * 26);
    let y = 3 + Math.floor(t.rand() * 26);
    for (let s = 0; s < 9; s++) {
      t.set(x, y, [24, 24, 26]);
      x += Math.floor(t.rand() * 3) - 1;
      y += t.rand() < 0.6 ? 1 : 0;
      if (x < 2 || x > 29 || y > 29) break;
    }
  }
}
Object.assign(tiles, {
  enchanting_table_top: (t) => {
    t.forEach((x, y) => {
      // Red cloth with a dark border, diamond corners and a book in the middle.
      const n = t.noise(x, y, 8, 2) * 0.3 + t.rand() * 0.15;
      let c = [Math.round(150 + n * 60), Math.round(24 + n * 20), Math.round(30 + n * 22)];
      if (x < 2 || y < 2 || x > 29 || y > 29) c = obsidianish(t, x, y);
      const corner = (x < 6 || x > 25) && (y < 6 || y > 25) && x >= 2 && y >= 2 && x <= 29 && y <= 29;
      if (corner) c = (x + y) % 3 ? [92, 220, 214] : [180, 252, 246];
      if (x >= 11 && x <= 20 && y >= 12 && y <= 19) c = x === 15 || x === 16 ? [70, 40, 20] : y === 12 || y === 19 ? [110, 66, 34] : [232, 224, 200];
      t.set(x, y, c);
    });
  },
  enchanting_table_side: (t) => {
    // (The block is 12 high: rows 8-11 are the cloth's hem, below it obsidian.)
    t.forEach((x, y) => {
      if (y < 12) {
        const n = t.noise(x, y, 8, 2) * 0.3 + t.rand() * 0.15;
        t.set(x, y, y === 11 ? [90, 14, 20] : [Math.round(150 + n * 60), Math.round(24 + n * 20), Math.round(30 + n * 22)]);
        return;
      }
      t.set(x, y, obsidianish(t, x, y));
    });
    // (a tassel of gold thread on the hem)
    for (let x = 3; x < 32; x += 7) t.set(x, 10, [230, 190, 60]);
  },
  anvil_base: (t) => t.forEach((x, y) => t.set(x, y, iron(t, x, y, y % 8 === 0 ? 0.8 : 0.95))),
  anvil_top: (t, kit) => anvilTop(t, kit, 0),
  anvil_top_chipped: (t, kit) => anvilTop(t, kit, 1),
  anvil_top_damaged: (t, kit) => anvilTop(t, kit, 2),
  brewing_stand: (t) => {
    // Left half: the stone plates; right half: the iron rod (x 22-26).
    t.forEach((x, y) => {
      if (x < 16) {
        const n = t.fbm(x, y, 4, 2, 2) * 0.6 + t.rand() * 0.4;
        const v = Math.round(108 + n * 40);
        t.set(x, y, [v, v, v - 2]);
      } else if (x >= 22 && x <= 26) {
        const v = [96, 140, 170, 128, 84][x - 22];
        t.set(x, y, [v, Math.round(v * 0.92), Math.round(v * 0.8)]);
      } else t.set(x, y, [40, 38, 36], 0);
    });
  },
  cauldron_side: (t) => {
    t.forEach((x, y) => t.set(x, y, iron(t, x, y, y < 2 ? 1.15 : y > 28 ? 0.7 : 0.9)));
    for (let x = 0; x < 32; x++) t.set(x, 6, iron(t, x, 6, 0.6)); // (a band below the rim)
  },
  cauldron_top: (t) => {
    t.forEach((x, y) => {
      const inner = x >= 4 && x < 28 && y >= 4 && y < 28;
      t.set(x, y, iron(t, x, y, inner ? 0.55 : 1.1));
    });
  },
});

// (Round 12) The barrel's: spruce staves with iron hoops, its lid and bottom.
function staves(t, kit) {
  const ramp = [0x3a2817, 0x4a3320, 0x573d26, 0x65472c, 0x725233, 0x7f5c3a].map(kit.hex);
  t.forEach((x, y) => {
    const k = x >> 2;
    const f = 0.5 + (t.noise(x, y * 3, 8, k) - 0.5) * 0.6 + ((k * 29) % 5) * 0.03 - (x % 4 === 0 ? 0.35 : 0) + (t.rand() - 0.5) * 0.12;
    t.set(x, y, kit.ramp(ramp, f));
  });
}
function lid(t, kit, hatch) {
  const ramp = [0x3a2817, 0x4a3320, 0x573d26, 0x65472c, 0x725233, 0x7f5c3a].map(kit.hex);
  t.forEach((x, y) => {
    const k = y >> 3;
    const f = 0.5 + (t.noise(x * 3, y, 8, k + 4) - 0.5) * 0.6 - (y % 8 === 0 ? 0.35 : 0) + (t.rand() - 0.5) * 0.12;
    t.set(x, y, kit.ramp(ramp, f));
  });
  const iron = [[44, 46, 50], [72, 76, 82], [110, 115, 122]];
  t.forEach((x, y) => {
    const d = Math.min(x, y, 31 - x, 31 - y);
    if (d < 3) t.set(x, y, iron[d === 0 ? 0 : d === 1 ? 2 : 1]);
  });
  if (!hatch) return;
  for (let y = 11; y <= 20; y++) for (let x = 11; x <= 20; x++) t.set(x, y, x === 11 || y === 11 || x === 20 || y === 20 ? [36, 24, 14] : [62, 44, 26]);
}
Object.assign(tiles, {
  barrel_side: (t, kit) => {
    staves(t, kit);
    const iron = [[44, 46, 50], [72, 76, 82], [110, 115, 122]];
    for (const y0 of [3, 26]) for (let x = 0; x < 32; x++) for (let d = 0; d < 3; d++) t.set(x, y0 + d, iron[d === 0 ? 2 : d === 1 ? 1 : 0]);
  },
  barrel_top: (t, kit) => lid(t, kit, true),
  barrel_bottom: (t, kit) => lid(t, kit, false),
});

export const tileRelief = {
  barrel_side: [2, 0.7, 0.5],
  barrel_top: [2, 0.7, 0.5],
  furnace_side: [2.4, 0.72, 0.5],
  furnace_top: [2.2, 0.7, 0.5],
  furnace_front: [2.6, 0.72, 0.7],
  furnace_front_lit: [2.6, 0.6, 0.7],
  enchanting_table_top: [1.6, 0.8, 0.5],
  enchanting_table_side: [2.2, 0.6, 0.6],
  anvil_base: [2, 0.45, 0.5],
  anvil_top: [1.8, 0.4, 0.5],
  anvil_top_chipped: [2.2, 0.45, 0.6],
  anvil_top_damaged: [2.6, 0.5, 0.7],
  brewing_stand: [1.8, 0.6, 0.5],
  cauldron_side: [2, 0.45, 0.5],
  cauldron_top: [2, 0.45, 0.5],
};

export const items = {};
export const icons = {};
// (Round 11) The magic blocks' shapes: boxes, meshed once per chunk rebuild.
// Per-id tile lists (the same in the mesh workers), made on first use.
const SIDE6 = {};
const WALL6 = {};
const WATER6 = {};
const sideTiles = (m) => (SIDE6[m.id] ||= new Array(6).fill(m.tile(FACE.PX)));
const UV_PLATE = [0, 0, 0.5, 1];
const UV_ROD = [0.5, 0, 1, 1];
export const shapes = {
  enchanting_table: { mesh: (m) => m.box(0, 0, 0, 1, 0.75, 1) },
  anvil: {
    mesh: (m) => {
      const k = (m.id >= DAMAGED_ANVIL ? m.id - DAMAGED_ANVIL : m.id >= CHIPPED_ANVIL ? m.id - CHIPPED_ANVIL : m.id - ANVIL) & 3;
      const list = k < 2 ? ANVIL_X : ANVIL_Z;
      const side = sideTiles(m);
      for (let i = 0; i < 4; i++) {
        const b = list[i];
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], i === 3 ? null : side);
      }
    },
  },
  brewing_stand: {
    mesh: (m) => {
      for (let i = 0; i < BREW_PARTS.length; i++) {
        const b = BREW_PARTS[i];
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], null, 0, b[6] ? UV_ROD : UV_PLATE);
      }
    },
  },
  cauldron: {
    mesh: (m) => {
      const s = m.tile(FACE.PX);
      const walls = (WALL6[m.id] ||= [s, s, m.tile(FACE.PY), s, s, s]);
      for (let i = 0; i < CAULDRON_WALLS.length; i++) {
        const b = CAULDRON_WALLS[i];
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], walls);
      }
      const side = sideTiles(m);
      for (let i = 0; i < CAULDRON_LEGS.length; i++) {
        const b = CAULDRON_LEGS[i];
        m.box(b[0], b[1], b[2], b[3], b[4], b[5], side);
      }
      const lvl = m.id - CAULDRON;
      if (lvl > 0) {
        const water = (WATER6[m.id] ||= new Array(6).fill(m.tile(FACE.NY)));
        m.box(2 * S16, 4 * S16, 2 * S16, 14 * S16, (6 + 3 * lvl) * S16, 14 * S16, water);
      }
    },
  },
};
// (The core recipes, the smelting recipes and the fuels are js/crafting.js's;
// the brewing stand's is here: vanilla's, a blaze rod over cobblestone or
// blackstone (Round 12: the Nether's; Round 11 stood an iron ingot in for the rod).)
export const recipes = () => [{ type: "shaped", pattern: [" B ", "###"], key: { B: BLAZE_ROD, "#": [BLOCK.COBBLESTONE, BLACKSTONE] }, result: [BREWING_STAND, 1] }];

// Opens a screen of the game (main.js sets interaction.onOpenScreen).
function openScreen(ctx, kind) {
  const open = ctx.interaction?.onOpenScreen;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open(kind, ctx.x, ctx.y, ctx.z);
  return true;
}

// (Round 11) The cauldron: a water bucket fills it, an empty one takes the
// water back (full only); a glass bottle takes a level as a water bottle, a
// water bottle gives one. (Creative: the hand keeps what it holds.)
function exchange(ctx, id) {
  const inv = ctx.inventory;
  const s = inv.selectedStack;
  if (!s || ctx.creative) return;
  if (s.count <= 1) {
    inv.slots[inv.selected] = { id, count: 1 };
    return;
  }
  s.count -= 1;
  const left = inv.add(id, 1);
  if (left > 0) ctx.interaction?.throwStack?.({ id, count: left });
}
function useCauldron(ctx) {
  const lvl = cauldronLevel(ctx.id);
  const held = ctx.stack?.id;
  let next = -1;
  let give = 0;
  if (held === WATER_BUCKET && lvl < 3) [next, give] = [3, BUCKET];
  else if (held === BUCKET && lvl === 3) [next, give] = [0, WATER_BUCKET];
  else if (held === GLASS_BOTTLE && lvl > 0) [next, give] = [lvl - 1, POTION];
  else if (held === POTION && lvl < 3) [next, give] = [lvl + 1, GLASS_BOTTLE];
  if (next < 0 || !LIB.itemInfo?.(give)) return false;
  if (!ctx.world.setBlock(ctx.x, ctx.y, ctx.z, CAULDRON + next)) return false;
  ctx.audio?.playSplash?.();
  exchange(ctx, give);
  return true;
}

export const blockUse = {
  // (Missions worlds keep their loot economy: the table does nothing new there.)
  [BLOCK.CRAFTING_TABLE]: (ctx) => isVanilla() && openScreen(ctx, "table"),
  [ENCHANTING_TABLE]: (ctx) => openScreen(ctx, "enchanting"),
  [BREWING_STAND]: (ctx) => openScreen(ctx, "brewing"),
};
for (let k = 0; k < 8; k++) blockUse[FURNACE + k] = (ctx) => openScreen(ctx, "furnace");
for (const base of ANVILS) for (let k = 0; k < 4; k++) blockUse[base + k] = (ctx) => openScreen(ctx, "anvil");
for (let k = 0; k < 4; k++) blockUse[CAULDRON + k] = useCauldron;
// (Round 12) The barrel opens the chest screen (main.js: interaction.onOpenChest).
blockUse[BARREL] = (ctx) => {
  const open = ctx.interaction?.onOpenChest;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open(ctx.x, ctx.y, ctx.z);
  return true;
};

export const itemUse = {};
export const randomTick = {};
export const drops = {};
