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
import { BLOCK, FACE } from "./base.js";
import { FURNACE } from "./ids.js";
import { isVanilla } from "../worldtype.js";

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

// ---------- Textures (4 tiles) ----------

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
export const tileRelief = {
  furnace_side: [2.4, 0.72, 0.5],
  furnace_top: [2.2, 0.7, 0.5],
  furnace_front: [2.6, 0.72, 0.7],
  furnace_front_lit: [2.6, 0.6, 0.7],
};

export const items = {};
export const icons = {};
export const shapes = {};
// (The core recipes, the smelting recipes and the fuels are js/crafting.js's.)
export const recipes = [];

// Opens a screen of the game (main.js sets interaction.onOpenScreen).
function openScreen(ctx, kind) {
  const open = ctx.interaction?.onOpenScreen;
  if (typeof open !== "function") return false;
  ctx.audio?.playClick?.();
  open(kind, ctx.x, ctx.y, ctx.z);
  return true;
}

export const blockUse = {
  // (Missions worlds keep their loot economy: the table does nothing new there.)
  [BLOCK.CRAFTING_TABLE]: (ctx) => isVanilla() && openScreen(ctx, "table"),
};
for (let k = 0; k < 8; k++) blockUse[FURNACE + k] = (ctx) => openScreen(ctx, "furnace");

export const itemUse = {};
export const randomTick = {};
export const drops = {};
