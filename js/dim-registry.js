// The dimensions (Round 12): the Overworld, the Nether and the End, as
// vanilla's, and what each one's rules are. Pure data and the terrain
// generators (no three.js, no DOM): the chunk workers import it too
// (chunk-worker.js), so a dimension's chunk is made the same everywhere.
// The travel between them, the saves and the online part: js/dimensions.js.
//
// Each dimension:
//   id, code     its name ("overworld" | "nether" | "end") and the number
//                saves and messages carry (0: the Overworld, so everything
//                from before Round 12 is the Overworld's)
//   prefix       the letter before a position key of its own ("n:1,2,3");
//                the Overworld's keys keep their old form ("1,2,3")
//   scale        blocks of the Overworld per block of it (the Nether 8)
//   ceiling      a bedrock roof (the Nether's at the top of the world, 128)
//   voidBelow    nothing under y 0: a fall goes into the void (the End)
//   dayCycle, weather   the sun, moon, stars' turn, rain: the Overworld's only
//   waterEvaporates     water put there boils away (the Nether)
//   bedsExplode  a bed used there blows up (power 5, fire), as vanilla's
//   lod          distant terrain tiles (the Overworld's height map: none elsewhere)
//   heightfield  long shots hit an unloaded column's height (the Overworld's)
//   maxView      chunks drawn at most (no distant tiles there: every chunk
//                in sight is a full one, so the view is capped)
//   lightFloor   the darkest light (vanilla's ambient light, the Nether's 0.1, seen here as a dim floor;
//                the shader's floor is 0.42 x this, see main.js uNightVision)
//   lavaStep     seconds a lava flow takes per block (the Nether's 3x faster)
//   sky          null (the Overworld's day and night), else a fixed sky:
//                colours (linear HDR) and fog, see sky.js setDimension
//   spawnMobs    (mobs, dt) => void: its creatures' spawning (set by the parts
//                that add them; the Overworld's are mobs.js's own)
import { BLOCK } from "./content/base.js";
import { TerrainGenerator } from "./terrain.js";
import { NetherGenerator } from "./dim-nether.js";
import { EndGenerator } from "./dim-end.js";

export const OVERWORLD = "overworld";
export const NETHER = "nether";
export const END = "end";
export const DIM_IDS = [OVERWORLD, NETHER, END];

export const DIMS = {
  [OVERWORLD]: {
    id: OVERWORLD,
    code: 0,
    prefix: "",
    name: "the Overworld",
    label: "Overworld",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: true,
    weather: true,
    waterEvaporates: false,
    bedsExplode: false,
    lod: true,
    heightfield: true,
    maxView: Infinity,
    lightFloor: 0,
    lavaStep: 1.5,
    sky: null,
    spawnMobs: null,
  },
  [NETHER]: {
    id: NETHER,
    code: 1,
    prefix: "n",
    name: "the Nether",
    label: "Nether",
    scale: 8,
    ceiling: true,
    voidBelow: false,
    dayCycle: false,
    weather: false,
    waterEvaporates: true,
    bedsExplode: true,
    lod: false,
    heightfield: false,
    maxView: 8,
    lightFloor: 0.3,
    lavaStep: 0.5, // (vanilla: 10 game ticks a step, the Overworld's 30)
    // (vanilla's Nether Wastes fog, #330808; no sun, moon, stars or clouds)
    sky: { zenith: [0.03, 0.0025, 0.0025], horizon: [0.04, 0.004, 0.003], ambSky: [0.07, 0.035, 0.03], ambGround: [0.05, 0.025, 0.02], stars: false, fog: "thick", exposure: 1.1 },
    spawnMobs: null,
  },
  [END]: {
    id: END,
    code: 2,
    prefix: "e",
    name: "the End",
    label: "End",
    scale: 1,
    ceiling: false,
    voidBelow: true,
    dayCycle: false,
    weather: false,
    waterEvaporates: false,
    bedsExplode: true,
    lod: false,
    heightfield: false,
    maxView: 12,
    lightFloor: 0.05,
    lavaStep: 1.5,
    // (vanilla's dark End sky; its static stars: they never turn)
    sky: { zenith: [0.004, 0.003, 0.006], horizon: [0.011, 0.008, 0.013], ambSky: [0.2, 0.19, 0.24], ambGround: [0.1, 0.09, 0.12], stars: true, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
};

const BY_CODE = [DIMS[OVERWORLD], DIMS[NETHER], DIMS[END]];

// A dimension's id from a saved or received value (anything else: the Overworld).
export function dimId(v) {
  return typeof v === "string" && Object.hasOwn(DIMS, v) ? v : OVERWORLD;
}
export function dimOfCode(code) {
  return (BY_CODE[code | 0] || DIMS[OVERWORLD]).id;
}
export function codeOf(dim) {
  return (DIMS[dim] || DIMS[OVERWORLD]).code;
}
export function dimLabel(dimOrCode) {
  const d = typeof dimOrCode === "number" ? BY_CODE[dimOrCode] : DIMS[dimOrCode];
  return (d || DIMS[OVERWORLD]).label;
}
// What a message carries for `dim`: { dm: code }, or nothing for the Overworld.
export function dmOf(dim) {
  const c = codeOf(dim);
  return c ? { dm: c } : null;
}

// ---------- Position keys ----------
// "x,y,z" in the Overworld (as every save from before Round 12), "n:x,y,z"
// in the Nether, "e:x,y,z" in the End: chests, furnaces, brewing stands and
// signs of every dimension in one store, and a chest at the same place in
// two dimensions stays two chests.
export function dimKey(dim, x, y, z) {
  const p = (DIMS[dim] || DIMS[OVERWORLD]).prefix;
  return p ? `${p}:${x},${y},${z}` : `${x},${y},${z}`;
}
// A saved key of this form (load() checks).
export const DIM_KEY_RE = /^(?:[ne]:)?-?\d+,-?\d+,-?\d+$/;
const PREFIX_DIM = { n: NETHER, e: END };
// [x, y, z, dim] of a key, or null.
export function parseDimKey(key) {
  if (typeof key !== "string" || !DIM_KEY_RE.test(key)) return null;
  let dim = OVERWORLD;
  let s = key;
  if (key[1] === ":") {
    dim = PREFIX_DIM[key[0]];
    s = key.slice(2);
  }
  const [x, y, z] = s.split(",").map(Number);
  return [x, y, z, dim];
}

// ---------- Terrain ----------
// The generator of a dimension's chunks (the same on the main thread and in
// the workers). Each has generate(chunk) (chunk.blocks: 16-bit ids, index
// y * 256 + z * 16 + x), heightAt(x, z) and biomeAt(x, z); the Overworld's
// is today's terrain. The Nether's and the End's are js/dim-nether.js and
// js/dim-end.js (stand-ins until their parts replace them).
const GENERATORS = {
  [OVERWORLD]: (seed, opts) => new TerrainGenerator(seed, opts),
  [NETHER]: (seed, opts) => new NetherGenerator(seed, opts),
  [END]: (seed, opts) => new EndGenerator(seed, opts),
};
export function createGenerator(dim, seed, opts) {
  return (GENERATORS[dim] || GENERATORS[OVERWORLD])(seed, opts);
}

// The block under the world (y < 0): bedrock, or the End's void.
export function belowWorld(dim) {
  return DIMS[dim]?.voidBelow ? BLOCK.AIR : BLOCK.BEDROCK;
}

// A position carried from one dimension to another (the Nether's 1:8).
export function scaleBetween(from, to, v) {
  const a = DIMS[from]?.scale || 1;
  const b = DIMS[to]?.scale || 1;
  return (v * a) / b;
}
