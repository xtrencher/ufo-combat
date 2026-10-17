// Content registries (Round 11): the blocks, items, textures, shapes,
// recipes and behaviours of the content modules in this folder, merged here
// so each area can be built in its own file without editing shared ones.
// blocks.js and items.js read these at load (their tables are built once,
// the same on the main thread and in the workers); textures.js,
// itemtextures.js, mesher.js, interaction.js and world.js look things up.
//
// Rules for a content module:
// - It imports nothing but ./base.js (the id space, BLOCK, ITEM, RENDER,
//   SHAPE, FACE and LIB) and other content modules' id constants. Never
//   blocks.js, items.js or anything that imports them (an import cycle), and
//   never three.js or the DOM: blocks.js loads it in the workers too.
// - It keeps to its own id ranges (MODULES below); an id never changes
//   meaning once released (ids are saved in worlds and inventories).
// - Anything the engine needs at run time comes in the arguments or from
//   LIB (base.js), read inside functions only.
//
// What a module may export (all optional):
//   blocks      { [id]: def }  Block defs as in blocks.js DEFS (name, faces,
//               render, shape, solid, opaque, hardness, tool, minTier,
//               sound, support, facing, item, ...), plus: shape as a name
//               ("cube", "cross", "torch", or a module's own shape), box
//               (the selection box in the cell), collision (a solid block's
//               collision boxes, maxY up to 1.5), creative (false: not in the
//               creative palette; variants with `item` set never are),
//               support (also a function (belowId, id) => bool), placeAs
//               ((ctx) => the id actually placed, or null: can't; a stair's
//               facing, a slab's half; ctx as for blockUse, `place` the cell).
//               Ids 1024-4095 only. A block is its own item (stack 64)
//               unless `item` names another (a door's upper half: the door).
//   items       { [id]: def }  Item defs as in items.js ITEM_DEFS: name,
//               icon (a painter name), stack, food, tool, weapon, armor...
//               Ids 256-1023 only.
//   tiles       { name: (t, kit) => void }  Block texture painters (32x32):
//               `t` is textures.js's Tile (t.set(x, y, [r, g, b], a), t.get,
//               t.noise, t.fbm, t.voronoi, t.forEach, t.rand); `kit` has
//               TEX, hex, ramp, mixRgb, scaleRgb, clamp01, makeRand, and
//               base(name, t) / ore(t, colors) / flower(t, colors) to start
//               from a core painting. New tiles become texture layers after
//               the core ones (at most 1024 layers in all).
//   tileRelief  { name: [bump strength, roughness, brightness weight] }
//   icons       { name: (kit) => Uint8ClampedArray(32 * 32 * 4) }  Item icon
//               painters: kit has N (32), Canvas (itemtextures.js: fill,
//               line, poly, render(ramps)), RAMPS, hex, tool(type, material).
//   shapes      { name: { mesh(m) } }  Mesher shapes, used identically on the
//               main thread and in the mesh workers (pure functions of `m`):
//                 m.id, m.x, m.y, m.z (cell in the chunk), m.wx, m.wz (world)
//                 m.box(x0, y0, z0, x1, y1, z1, tiles?)  a box in the cell
//                   (0-1 units), lit and shaded like a cube; a face on the
//                   cell's side is skipped against an opaque neighbour; the
//                   texture is cut to the face's place in the block (a slab
//                   shows half its tile); tiles: 6 layers in FACE order
//                   (default: the block's own)
//                 m.quad(corners, uvs, face, tile)  one quad: 4 [x, y, z]
//                   corners (counter-clockwise seen from the front), 4 [u, v],
//                   the FACE whose light/normal it takes, a tile layer; the
//                   cell's own light, no ambient occlusion
//                 m.neighbor(dx, dy, dz)  the id next door (-1..1 each)
//                 m.tile(face)  the block's tile layer for a face
//               A shaped block is usually opaque: false (light reaches it and
//               the faces around it stay drawn); its render bucket is its
//               `render` (OPAQUE or CUTOUT).
//   recipes     [entry] or () => [entry]  Collected by recipes() below
//               (the crafting part reads them). Entries:
//                 { type: "shaped", pattern: ["##", "##"], key: { "#": ing },
//                   result: [id, count] }
//                 { type: "shapeless", ingredients: [ing, ...], result: [id, count] }
//                 { type: "smelting", input: ing, result: [id, count], xp, time }
//                 { type: "fuel", input: ing, time }  (seconds of burning)
//               ing: an id, or an array of ids (any of them: "any planks").
//   blockUse    { [blockId]: (ctx) => bool }  Right click on the block (a
//               door, a bed, a furnace), tried before the game's own use
//               (chests, placing, eating); true: handled. ctx (interaction.js):
//               { world, player, inventory, entities, audio, effects,
//                 interaction, x, y, z, id, normal, place, hit (the point
//                 aimed at), forward (the view direction), stack, info,
//                 creative, sneaking }. Not called while sneaking with an
//               item in hand (as in vanilla: that places against it).
//   itemUse     { [itemId]: (ctx) => bool }  Right click with the item in
//               hand (a bucket, flint and steel, a hoe, bone meal), tried
//               after blockUse and before placing/eating; the same ctx, with
//               x, y, z, id, normal, place null when no block is aimed at.
//               Also repeated while the button is held (every 0.22 s).
//   randomTick  { [blockId]: (world, x, y, z, id, rand) => void }  Random
//               ticks, as vanilla's randomTickSpeed 3: three random cells per
//               16-high section of every loaded chunk near a player, 20 times
//               a second (world.js randomTick; the host only, online: its
//               edits reach everyone as ordinary block edits).
//   drops       { [blockId]: (tool, rand) => [[itemId, count], ...] | null }
//               What the block drops when broken (null: the default), core
//               blocks included (tool: the item info's .tool, or null).
// Handlers that change blocks use world.setBlock / setBlocks: online, edits
// travel like a player's (js/net/world.js), so only the peer that acts runs
// a handler (the clicking player; the host for random ticks).
import { BLOCK_LIMIT, ITEM_MIN, NEW_BLOCK_MIN, ITEM } from "./base.js";
import * as building from "./building.js";
import * as nature from "./nature.js";
import * as containers from "./containers.js";
import * as redstone from "./redstone.js";
import * as itemsVanilla from "./items-vanilla.js";
import * as mobsVanilla from "./mobs-vanilla.js";
import * as debug from "./debug.js";

// Each module and its id ranges ([lo, hi] inclusive).
const MODULES = [
  { name: "building", mod: building, blocks: [[1024, 1535]], items: [] },
  { name: "nature", mod: nature, blocks: [[1536, 1791]], items: [[400, 479]] },
  { name: "containers", mod: containers, blocks: [[1792, 1855]], items: [] },
  { name: "redstone", mod: redstone, blocks: [[1856, 2047]], items: [] },
  { name: "items-vanilla", mod: itemsVanilla, blocks: [], items: [[320, 399], [480, 639]] },
  { name: "mobs-vanilla", mod: mobsVanilla, blocks: [], items: [[640, 703]] },
  // (Test-only blocks: never in the palette or the terrain; tools/r11-engine16-tests.mjs.)
  { name: "debug", mod: debug, blocks: [[4064, 4095]], items: [] },
];

const inRanges = (id, ranges) => ranges.some(([lo, hi]) => id >= lo && id <= hi);
const CORE_ITEM_IDS = new Set(Object.values(ITEM));

export const CONTENT_BLOCKS = {}; // id -> def
export const CONTENT_ITEMS = {}; // id -> def
export const CONTENT_TILES = []; // tile names, in order (after the core tiles)
export const TILE_PAINTERS = {}; // tile name -> painter
export const TILE_RELIEF = {}; // tile name -> relief parameters
export const ICON_PAINTERS = {}; // icon name -> painter
export const CONTENT_SHAPES = []; // [{ name, mesh }] (shape number: SHAPE_CUSTOM + index)
// Dispatch tables by id (null: nothing registered).
export const BLOCK_USE = new Array(BLOCK_LIMIT).fill(null);
export const ITEM_USE = new Array(BLOCK_LIMIT).fill(null);
export const RANDOM_TICK = new Array(BLOCK_LIMIT).fill(null);
export const BLOCK_DROPS = new Array(BLOCK_LIMIT).fill(null);
// Blocks with a random tick (a flat table for the world's random-tick loop).
export const TICKS_RANDOMLY = new Uint8Array(BLOCK_LIMIT);
export const CONTENT_ORDER = []; // { module, blocks: [ids], items: [ids] } (creative palette order)

function idKeys(obj, what, name) {
  return Object.keys(obj).map((k) => {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 0 || id >= BLOCK_LIMIT) throw new Error(`Content "${name}": bad ${what} id ${k}`);
    return id;
  });
}

function register(table, obj, what, name) {
  for (const id of idKeys(obj, what, name)) {
    if (typeof obj[id] !== "function") throw new Error(`Content "${name}": ${what}[${id}] is not a function`);
    if (table[id]) throw new Error(`Content "${name}": ${what} for id ${id} is registered twice`);
    table[id] = obj[id];
  }
}

for (const { name, mod, blocks, items } of MODULES) {
  const order = { module: name, blocks: [], items: [] };
  for (const id of idKeys(mod.blocks || {}, "block", name).sort((a, b) => a - b)) {
    if (id < NEW_BLOCK_MIN || !inRanges(id, blocks)) throw new Error(`Content "${name}": block id ${id} is outside its range`);
    const def = mod.blocks[id];
    if (!def || typeof def.name !== "string" || !def.faces) throw new Error(`Content "${name}": block ${id} needs a name and faces`);
    CONTENT_BLOCKS[id] = def;
    order.blocks.push(id);
  }
  for (const id of idKeys(mod.items || {}, "item", name).sort((a, b) => a - b)) {
    if (id < ITEM_MIN || id >= NEW_BLOCK_MIN || !inRanges(id, items)) throw new Error(`Content "${name}": item id ${id} is outside its range`);
    if (CORE_ITEM_IDS.has(id) || CONTENT_ITEMS[id]) throw new Error(`Content "${name}": item id ${id} is taken`);
    const def = mod.items[id];
    if (!def || typeof def.name !== "string") throw new Error(`Content "${name}": item ${id} needs a name`);
    CONTENT_ITEMS[id] = def;
    order.items.push(id);
  }
  for (const [tile, painter] of Object.entries(mod.tiles || {})) {
    if (TILE_PAINTERS[tile]) throw new Error(`Content "${name}": tile "${tile}" is defined twice`);
    if (typeof painter !== "function") throw new Error(`Content "${name}": tile "${tile}" has no painter`);
    TILE_PAINTERS[tile] = painter;
    CONTENT_TILES.push(tile);
  }
  Object.assign(TILE_RELIEF, mod.tileRelief || {});
  for (const [icon, painter] of Object.entries(mod.icons || {})) {
    if (ICON_PAINTERS[icon]) throw new Error(`Content "${name}": icon "${icon}" is defined twice`);
    ICON_PAINTERS[icon] = painter;
  }
  for (const [shape, def] of Object.entries(mod.shapes || {})) {
    if (!def || typeof def.mesh !== "function") throw new Error(`Content "${name}": shape "${shape}" has no mesh function`);
    if (CONTENT_SHAPES.some((s) => s.name === shape)) throw new Error(`Content "${name}": shape "${shape}" is defined twice`);
    CONTENT_SHAPES.push({ name: shape, mesh: def.mesh });
  }
  register(BLOCK_USE, mod.blockUse || {}, "blockUse", name);
  register(ITEM_USE, mod.itemUse || {}, "itemUse", name);
  register(RANDOM_TICK, mod.randomTick || {}, "randomTick", name);
  register(BLOCK_DROPS, mod.drops || {}, "drops", name);
  CONTENT_ORDER.push(order);
}
// (any: some block has a random tick: the world's loop costs nothing until then)
export const TICKING = { any: false };
for (let id = 0; id < BLOCK_LIMIT; id++) {
  if (!RANDOM_TICK[id]) continue;
  TICKS_RANDOMLY[id] = 1;
  TICKING.any = true;
}

// Adds (or with null removes) a block's random tick at run time (tests, or
// game code outside the content modules).
export function registerRandomTick(id, fn) {
  RANDOM_TICK[id] = fn || null;
  TICKS_RANDOMLY[id] = fn ? 1 : 0;
  TICKING.any = TICKS_RANDOMLY.some((v) => v === 1);
}

// Every module's recipes (each entry with its module's name), built on the
// first call (a module may export a function, so it can use other modules'
// ids without caring about import order).
let recipeCache = null;
export function recipes() {
  if (recipeCache) return recipeCache;
  recipeCache = [];
  for (const { name, mod } of MODULES) {
    const list = typeof mod.recipes === "function" ? mod.recipes() : mod.recipes || [];
    for (const r of list) recipeCache.push({ ...r, module: name });
  }
  return recipeCache;
}
