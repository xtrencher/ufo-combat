// Block registry: pure data (no three.js), shared by terrain generation,
// lighting, meshing, physics and UI. Block ids are persisted in saves, so
// existing ids must never change meaning; new blocks get new ids.
//
// (Round 11) Block ids are 16-bit. The id space (js/content/base.js):
//   0-255      the original blocks (defined here; unchanged meaning)
//   256-1023   items (items.js): no block ever uses these
//   1024-4095  new blocks, defined by the content modules (js/content/*.js,
//              merged below before the tables are built, so the tables are
//              built once at load, the same on the main thread and in workers)
// Every lookup table has BLOCK_LIMIT (4096) entries; chunks are Uint16Arrays.
import { BLOCK, RENDER, SHAPE, SHAPE_CUSTOM, FACE, BLOCK_LIMIT, ITEM_MIN, NEW_BLOCK_MIN, isBlockId, LIB } from "./content/base.js";
import { CONTENT_BLOCKS, CONTENT_TILES, CONTENT_SHAPES } from "./content/index.js";

export { BLOCK, RENDER, SHAPE, SHAPE_CUSTOM, FACE, BLOCK_LIMIT, ITEM_MIN, NEW_BLOCK_MIN, isBlockId };

// Texture layers of the block texture array, in order. Painted procedurally
// by textures.js; a block face refers to a layer by name. (The content
// modules' tiles come after these, so these layers never move.)
const CORE_TILE_NAMES = [
  "grass_top",
  "grass_side",
  "dirt",
  "stone",
  "sand",
  "wood_side",
  "wood_top",
  "leaves",
  "planks",
  "glass",
  "water",
  "cobblestone",
  "bedrock",
  "gravel",
  "coal_ore",
  "iron_ore",
  "gold_ore",
  "diamond_ore",
  "torch",
  "lumen",
  "crafting_table_top",
  "crafting_table_side",
  "crafting_table_front",
  "tall_grass",
  "flower_red",
  "flower_yellow",
  "bricks",
  "wool",
  "birch_side",
  "birch_top",
  "birch_leaves",
  "pine_side",
  "pine_top",
  "pine_leaves",
  "snow_top",
  "snow_side",
  "terracotta",
  "cactus_side",
  "cactus_top",
  "dead_bush",
  "coral",
  "seagrass",
  "kelp",
  // Round 4 Part B: sand's side face (no ripples), and the pixel-art plants
  // drawn as instanced cards near the player (grass.js).
  "sand_side",
  "grass_tuft",
  "grass_tuft_b",
  "fern",
  "reed_bottom",
  "reed_top",
  "cattail_bottom",
  "cattail_top",
  "lily_pad",
  "flower_blue",
  "flower_white",
  "flower_pink",
  // (Round 10) The chest: lid, sides and the front with its latch.
  "chest_top",
  "chest_side",
  "chest_front",
];
export const TILE_NAMES = [...CORE_TILE_NAMES, ...CONTENT_TILES];
for (const name of CONTENT_TILES) if (CORE_TILE_NAMES.includes(name)) throw new Error(`Content tile "${name}" is already a core tile`);
// (The mesher's vertices carry the layer in two bytes: room for 1024 tiles.
// A GPU only promises 256 layers in one texture array, so past that the
// array would have to be split.)
if (TILE_NAMES.length > 1024) throw new Error(`Too many texture tiles (${TILE_NAMES.length}; at most 1024)`);
export const TILE = Object.freeze(Object.fromEntries(TILE_NAMES.map((name, i) => [name, i])));

// The content modules' shapes: SHAPE_CUSTOM + their place in CONTENT_SHAPES.
// SHAPE_MESH[shape] is the shape's mesh function (mesher.js), SHAPE_NAME its name.
export const SHAPE_MESH = [];
export const SHAPE_NAME = ["cube", "cross", "torch", "wall_torch", "chest"];
const SHAPE_BY_NAME = new Map(SHAPE_NAME.map((n, i) => [n, i]));
CONTENT_SHAPES.forEach((s, i) => {
  if (SHAPE_BY_NAME.has(s.name)) throw new Error(`Content shape "${s.name}" is defined twice`);
  SHAPE_BY_NAME.set(s.name, SHAPE_CUSTOM + i);
  SHAPE_NAME[SHAPE_CUSTOM + i] = s.name;
  SHAPE_MESH[SHAPE_CUSTOM + i] = s.mesh;
});

const DEFAULTS = {
  render: RENDER.OPAQUE,
  shape: SHAPE.CUBE,
  solid: true, // collides with players/mobs/projectiles
  opaque: true, // hides neighboring faces, blocks light, casts ambient occlusion
  lightFilter: 0, // extra light lost passing through (non-opaque blocks only)
  skyPass: false, // full-strength sky light passes straight down without loss
  emission: 0, // light level emitted (0-15)
  emissive: false, // renders glowing (independent of the light it emits)
  wave: false, // sways in the wind
  selectable: true, // can be targeted by the crosshair
  replaceable: false, // placing a block into this cell just replaces it
  support: null, // "solid": needs a solid block below; "soil": needs grass/dirt below; "wall": needs a solid block behind it (see `facing`)
  facing: null, // [dx, dz]: where the block's front points (wall torches, chests)
  item: null, // the item it counts as when broken or picked (wall torches: a torch), if not itself
  liquid: false,
  gravity: false, // falls when nothing solid is underneath (sand, gravel)
  waterlogged: false, // an underwater plant: its cell is also full of water (breaking it leaves water)
  leaves: false, // tree foliage (fancy leaf cards, light shining through, no mob spawns)
  log: false, // tree trunk
  // Mining (survival): hardness (-1 = unbreakable), the tool type that mines
  // it fastest, and the minimum tool tier needed to get drops (0 = by hand).
  hardness: 1,
  tool: null, // "pickaxe" | "axe" | "shovel"
  minTier: 0,
  sound: "stone", // stone | wood | grass | dirt | sand | glass | cloth | plant
  // (Round 11, for the content modules) The selection box within the cell
  // ([minX, minY, minZ, maxX, maxY, maxZ]; null: the shape's), the collision
  // boxes of a solid block (a list of such boxes, maxY up to 1.5; null: the
  // whole cell), and whether it is offered in the creative palette.
  box: null,
  collision: null,
  creative: true,
};

// faces: a tile name for all faces, or { top, bottom, side, front? }.
const DEFS = {
  [BLOCK.AIR]: { name: "Air", render: RENDER.NONE, solid: false, opaque: false, skyPass: true, selectable: false, replaceable: true, faces: "stone" },
  [BLOCK.GRASS]: { name: "Grass Block", faces: { top: "grass_top", bottom: "dirt", side: "grass_side" }, hardness: 0.6, tool: "shovel", sound: "grass" },
  [BLOCK.DIRT]: { name: "Dirt", faces: "dirt", hardness: 0.5, tool: "shovel", sound: "dirt" },
  [BLOCK.STONE]: { name: "Stone", faces: "stone", hardness: 1.5, tool: "pickaxe", minTier: 1 },
  [BLOCK.SAND]: { name: "Sand", faces: { top: "sand", bottom: "sand", side: "sand_side" }, hardness: 0.5, tool: "shovel", sound: "sand", gravity: true },
  [BLOCK.WATER]: {
    name: "Water",
    faces: "water",
    render: RENDER.WATER,
    solid: false,
    opaque: false,
    lightFilter: 1,
    selectable: false,
    replaceable: true,
    liquid: true,
    hardness: -1,
  },
  [BLOCK.WOOD]: { name: "Log", faces: { top: "wood_top", bottom: "wood_top", side: "wood_side" }, hardness: 2, tool: "axe", sound: "wood", log: true },
  [BLOCK.LEAVES]: { name: "Leaves", faces: "leaves", render: RENDER.CUTOUT, opaque: false, lightFilter: 1, wave: true, hardness: 0.2, sound: "grass", leaves: true },
  [BLOCK.PLANKS]: { name: "Planks", faces: "planks", hardness: 2, tool: "axe", sound: "wood" },
  [BLOCK.GLASS]: { name: "Glass", faces: "glass", render: RENDER.CUTOUT, opaque: false, skyPass: true, hardness: 0.3, sound: "glass" },
  [BLOCK.COBBLESTONE]: { name: "Cobblestone", faces: "cobblestone", hardness: 2, tool: "pickaxe", minTier: 1 },
  [BLOCK.BEDROCK]: { name: "Bedrock", faces: "bedrock", hardness: -1 },
  [BLOCK.GRAVEL]: { name: "Gravel", faces: "gravel", hardness: 0.6, tool: "shovel", sound: "sand", gravity: true },
  [BLOCK.COAL_ORE]: { name: "Coal Ore", faces: "coal_ore", hardness: 3, tool: "pickaxe", minTier: 1 },
  [BLOCK.IRON_ORE]: { name: "Iron Ore", faces: "iron_ore", hardness: 3, tool: "pickaxe", minTier: 2 },
  [BLOCK.GOLD_ORE]: { name: "Gold Ore", faces: "gold_ore", hardness: 3, tool: "pickaxe", minTier: 3 },
  [BLOCK.DIAMOND_ORE]: { name: "Diamond Ore", faces: "diamond_ore", hardness: 3, tool: "pickaxe", minTier: 3 },
  [BLOCK.TORCH]: {
    name: "Torch",
    faces: "torch",
    render: RENDER.CUTOUT,
    shape: SHAPE.TORCH,
    solid: false,
    opaque: false,
    skyPass: true,
    emission: 14,
    emissive: true,
    support: "solid",
    hardness: 0,
    sound: "wood",
  },
  [BLOCK.LUMEN]: { name: "Lumen Crystal", faces: "lumen", emission: 15, emissive: true, hardness: 0.3, sound: "glass" },
  [BLOCK.CRAFTING_TABLE]: {
    name: "Crafting Table",
    faces: { top: "crafting_table_top", bottom: "planks", side: "crafting_table_side", front: "crafting_table_front" },
    hardness: 2.5,
    tool: "axe",
    sound: "wood",
  },
  [BLOCK.TALL_GRASS]: {
    name: "Tall Grass",
    faces: "tall_grass",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    skyPass: true,
    wave: true,
    replaceable: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
  [BLOCK.FLOWER_RED]: {
    name: "Red Blossom",
    faces: "flower_red",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    skyPass: true,
    wave: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
  [BLOCK.FLOWER_YELLOW]: {
    name: "Sunpetal",
    faces: "flower_yellow",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    skyPass: true,
    wave: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
  [BLOCK.BRICKS]: { name: "Bricks", faces: "bricks", hardness: 2, tool: "pickaxe", minTier: 1 },
  [BLOCK.WOOL]: { name: "Wool", faces: "wool", hardness: 0.8, sound: "cloth" },
  [BLOCK.BIRCH_LOG]: { name: "Birch Log", faces: { top: "birch_top", bottom: "birch_top", side: "birch_side" }, hardness: 2, tool: "axe", sound: "wood", log: true },
  [BLOCK.BIRCH_LEAVES]: { name: "Birch Leaves", faces: "birch_leaves", render: RENDER.CUTOUT, opaque: false, lightFilter: 1, wave: true, hardness: 0.2, sound: "grass", leaves: true },
  [BLOCK.PINE_LOG]: { name: "Pine Log", faces: { top: "pine_top", bottom: "pine_top", side: "pine_side" }, hardness: 2, tool: "axe", sound: "wood", log: true },
  [BLOCK.PINE_LEAVES]: { name: "Pine Needles", faces: "pine_leaves", render: RENDER.CUTOUT, opaque: false, lightFilter: 1, wave: true, hardness: 0.2, sound: "grass", leaves: true },
  // Bark on every face: branches and roots of oaks.
  [BLOCK.OAK_BARK]: { name: "Oak Wood", faces: "wood_side", hardness: 2, tool: "axe", sound: "wood", log: true },
  [BLOCK.SNOW]: { name: "Snow Block", faces: { top: "snow_top", bottom: "dirt", side: "snow_side" }, hardness: 0.4, tool: "shovel", sound: "sand" },
  [BLOCK.TERRACOTTA]: { name: "Terracotta", faces: "terracotta", hardness: 1.5, tool: "pickaxe", minTier: 1 },
  [BLOCK.CACTUS]: { name: "Cactus", faces: { top: "cactus_top", bottom: "cactus_top", side: "cactus_side" }, hardness: 1, sound: "grass" },
  [BLOCK.DEAD_BUSH]: {
    name: "Dead Bush",
    faces: "dead_bush",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    skyPass: true,
    replaceable: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
  [BLOCK.CORAL]: { name: "Coral", faces: "coral", hardness: 0.5, sound: "stone" },
  [BLOCK.SEAGRASS]: {
    name: "Seagrass",
    faces: "seagrass",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    lightFilter: 1, // light dims through it like the water it stands in
    waterlogged: true,
    wave: true,
    replaceable: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
  [BLOCK.KELP]: {
    name: "Kelp",
    faces: "kelp",
    render: RENDER.CUTOUT,
    shape: SHAPE.CROSS,
    solid: false,
    opaque: false,
    lightFilter: 1, // light dims through it like the water it stands in
    waterlogged: true,
    wave: true,
    replaceable: true,
    support: "soil",
    hardness: 0,
    sound: "plant",
  },
};

// (Face order used everywhere: +X, -X, +Y (top), -Y (bottom), +Z, -Z: FACE.)

// (Round 10) The four-way blocks. Facing convention, for structure
// generators too: `facing` [dx, dz] is where the front points. A wall torch
// at (x, y, z) facing [dx, dz] hangs on the block at (x - dx, y, z - dz) and
// leans out toward (x + dx, z + dz); a chest's latch looks toward (x + dx,
// z + dz). wallTorch(dx, dz) / chest(dx, dz) give the ids.
const FOUR_WAYS = [
  // [dx, dz, the face that points that way, wall torch id, chest id]
  [1, 0, FACE.PX, BLOCK.WALL_TORCH_PX, BLOCK.CHEST_PX],
  [-1, 0, FACE.NX, BLOCK.WALL_TORCH_NX, BLOCK.CHEST_NX],
  [0, 1, FACE.PZ, BLOCK.WALL_TORCH_PZ, BLOCK.CHEST],
  [0, -1, FACE.NZ, BLOCK.WALL_TORCH_NZ, BLOCK.CHEST_NZ],
];
for (const [dx, dz, face, torchId, chestId] of FOUR_WAYS) {
  DEFS[torchId] = { ...DEFS[BLOCK.TORCH], shape: SHAPE.WALL_TORCH, support: "wall", facing: [dx, dz], item: BLOCK.TORCH };
  DEFS[chestId] = {
    name: "Chest",
    faces: { top: "chest_top", bottom: "chest_top", side: "chest_side", front: "chest_front" },
    frontFace: face,
    shape: SHAPE.CHEST,
    opaque: false, // (smaller than its cell: the faces around it stay drawn, light passes)
    facing: [dx, dz],
    item: BLOCK.CHEST,
    hardness: 2.5,
    tool: "axe",
    sound: "wood",
  };
}

// (Round 11) The content modules' blocks (ids from 1024; ./content/index.js
// checks each module keeps to its own range). A shape given by name is one
// of the shapes above or a content module's.
for (const [idStr, def] of Object.entries(CONTENT_BLOCKS)) {
  if (DEFS[idStr]) throw new Error(`Block id ${idStr} is defined twice`);
  if (def.shape === undefined) {
    DEFS[idStr] = def;
    continue;
  }
  const shape = typeof def.shape === "string" ? SHAPE_BY_NAME.get(def.shape) : def.shape;
  if (shape === undefined || (shape >= SHAPE_CUSTOM && !SHAPE_MESH[shape])) throw new Error(`Block ${def.name}: unknown shape "${def.shape}"`);
  DEFS[idStr] = { ...def, shape };
}

export const BLOCK_INFO = {};
for (const [idStr, def] of Object.entries(DEFS)) {
  const id = Number(idStr);
  const info = { id, ...DEFAULTS, ...def };
  const f = typeof def.faces === "string" ? { top: def.faces, bottom: def.faces, side: def.faces } : def.faces;
  const side = TILE[f.side];
  // Per-face tile layer in FACE order. A "front" face (crafting table) is
  // shown on +Z and -Z, or only on `frontFace` (a chest); the other sides
  // use "side".
  const front = f.front ? TILE[f.front] : side;
  info.faceTiles = [side, side, TILE[f.top], TILE[f.bottom], front, front];
  if (def.frontFace !== undefined) {
    info.faceTiles[4] = info.faceTiles[5] = side;
    info.faceTiles[def.frontFace] = front;
  }
  info.faces = { top: TILE[f.top], bottom: TILE[f.bottom], side };
  for (const t of info.faceTiles) {
    if (t === undefined) throw new Error(`Block ${info.name}: unknown texture tile in ${JSON.stringify(def.faces)}`);
  }
  BLOCK_INFO[id] = info;
}

// ---------- Flat lookup tables for hot loops (indexed by block id) ----------
function table(fn, Type = Uint8Array) {
  const t = new Type(BLOCK_LIMIT);
  for (const info of Object.values(BLOCK_INFO)) t[info.id] = fn(info);
  return t;
}

// Unknown ids (e.g. from a newer save) behave like opaque, solid stone.
export const IS_OPAQUE = table((b) => (b.opaque ? 1 : 0));
export const IS_SOLID = table((b) => (b.solid ? 1 : 0));
export const LIGHT_FILTER = table((b) => b.lightFilter);
export const SKY_PASS = table((b) => (b.skyPass ? 1 : 0));
export const EMISSION = table((b) => b.emission);
export const RENDER_TYPE = table((b) => b.render);
export const SHAPE_OF = table((b) => b.shape);
export const WAVES = table((b) => (b.wave ? 1 : 0));
export const EMISSIVE = table((b) => (b.emissive ? 1 : 0));
export const IS_LIQUID = table((b) => (b.liquid ? 1 : 0));
export const IS_SELECTABLE = table((b) => (b.selectable ? 1 : 0));
export const IS_REPLACEABLE = table((b) => (b.replaceable ? 1 : 0));
export const HAS_GRAVITY = table((b) => (b.gravity ? 1 : 0));
export const IS_LEAVES = table((b) => (b.leaves ? 1 : 0));
export const IS_WATERLOGGED = table((b) => (b.waterlogged ? 1 : 0));
// Water, or a waterlogged plant standing in water: swims, drowns and renders as water.
export const IS_WET = table((b) => (b.liquid || b.waterlogged ? 1 : 0));
export const IS_LOG = table((b) => (b.log ? 1 : 0));
export const IS_CHEST = table((b) => (b.shape === SHAPE.CHEST ? 1 : 0));
export const IS_WALL_TORCH = table((b) => (b.shape === SHAPE.WALL_TORCH ? 1 : 0));
// The item a block counts as (its own id, or e.g. a torch for a wall torch;
// 0, no item, for an unknown id).
export const ITEM_OF = table((b) => b.item ?? b.id, Uint16Array);
for (let id = 0; id < BLOCK_LIMIT; id++) {
  if (!BLOCK_INFO[id]) {
    IS_OPAQUE[id] = 1;
    IS_SOLID[id] = 1;
    RENDER_TYPE[id] = RENDER.OPAQUE;
    IS_SELECTABLE[id] = 1;
  }
}
// FACE_TILES[id * 6 + face] = texture layer.
export const FACE_TILES = new Uint16Array(BLOCK_LIMIT * 6);
for (let id = 0; id < BLOCK_LIMIT; id++) {
  const info = BLOCK_INFO[id] || BLOCK_INFO[BLOCK.STONE];
  for (let f = 0; f < 6; f++) FACE_TILES[id * 6 + f] = info.faceTiles[f];
}

export function isOpaque(id) {
  return IS_OPAQUE[id] === 1;
}

export function isSolid(id) {
  return IS_SOLID[id] === 1;
}

export function isTransparent(id) {
  return id !== BLOCK.AIR && IS_OPAQUE[id] === 0;
}

export function blockName(id) {
  return BLOCK_INFO[id]?.name ?? `Block #${id}`;
}

// Whether block `id` placed at a cell is supported by `belowId` underneath.
// (A wall torch rests on its wall, not the floor: see isWallSupportedBy.)
// (A content block's `support` may be a function (belowId, id) => bool.)
export function isSupportedBy(id, belowId) {
  const support = BLOCK_INFO[id]?.support;
  if (!support || support === "wall") return true;
  if (typeof support === "function") return !!support(belowId, id);
  // "soil": grass, dirt or sand (so seagrass/kelp can root on a sandy sea
  // floor too), or the same block again (so kelp can stack on itself).
  if (support === "soil") return belowId === BLOCK.GRASS || belowId === BLOCK.DIRT || belowId === BLOCK.SAND || belowId === id;
  return IS_SOLID[belowId] === 1 && IS_OPAQUE[belowId] === 1;
}

// Whether `wallId` can hold a wall torch (or anything hung on a wall).
export function isWallSupportedBy(wallId) {
  return IS_SOLID[wallId] === 1 && IS_OPAQUE[wallId] === 1;
}

// The id of the wall torch facing [dx, dz] (hanging on the block at
// (x - dx, z - dz)), and of the chest whose front faces [dx, dz]. dx, dz:
// one of them 0, the other +-1 (the larger one wins otherwise).
function fourWay(dx, dz, k) {
  const row = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 1) : dz >= 0 ? 2 : 3;
  return FOUR_WAYS[row][k];
}
export const wallTorch = (dx, dz) => fourWay(dx, dz, 3);
export const chest = (dx, dz) => fourWay(dx, dz, 4);

// Selection boxes ([minX, minY, minZ, maxX, maxY, maxZ] within the cell) of
// blocks whose box depends on more than their shape (a wall torch's on its
// facing, a content block's `box`), by id; null for the rest (world.js
// selectionBox).
export const CHEST_BOX = [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16];
export const BLOCK_BOX = new Array(BLOCK_LIMIT).fill(null);
for (const info of Object.values(BLOCK_INFO)) if (info.box) BLOCK_BOX[info.id] = info.box;
for (const [dx, dz, , torchId, chestId] of FOUR_WAYS) {
  // (from the wall out to the leaning flame, 3/16 up to 13/16)
  const a = [dx > 0 ? 0 : dx < 0 ? 11 / 16 : 5.5 / 16, 3 / 16, dz > 0 ? 0 : dz < 0 ? 11 / 16 : 5.5 / 16];
  const b = [dx > 0 ? 5 / 16 : dx < 0 ? 1 : 10.5 / 16, 13 / 16, dz > 0 ? 5 / 16 : dz < 0 ? 1 : 10.5 / 16];
  BLOCK_BOX[torchId] = [a[0], a[1], a[2], b[0], b[1], b[2]];
  BLOCK_BOX[chestId] = CHEST_BOX;
}

// (Round 11) Collision boxes of solid blocks that don't fill their cell (a
// content block's `collision`), by id; null: the whole cell (physics.js).
// TALL_COLLISION: some block's box reaches above its cell (a fence, 1.5).
export const COLLISION_BOXES = new Array(BLOCK_LIMIT).fill(null);
for (const info of Object.values(BLOCK_INFO)) {
  if (!info.collision || !info.solid) continue;
  for (const b of info.collision) {
    if (b.length !== 6 || !(b[4] <= 1.5)) throw new Error(`Block ${info.name}: bad collision box ${JSON.stringify(b)}`);
  }
  COLLISION_BOXES[info.id] = info.collision;
}
export const TALL_COLLISION = COLLISION_BOXES.some((list) => list && list.some((b) => b[4] > 1));

// Blocks placeable from the (pre-inventory) hotbar.
export const HOTBAR = [
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.STONE,
  BLOCK.COBBLESTONE,
  BLOCK.PLANKS,
  BLOCK.WOOD,
  BLOCK.GLASS,
  BLOCK.TORCH,
  BLOCK.LUMEN,
];

// (For content code that runs later: see LIB in js/content/base.js.)
Object.assign(LIB, { BLOCK_INFO, IS_SOLID, IS_OPAQUE, IS_REPLACEABLE, ITEM_OF, FACE_TILES, isSupportedBy, isWallSupportedBy });
