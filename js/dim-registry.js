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
//   minView, maxView   chunks drawn there (no distant tiles: every chunk in
//                sight is a full one, as far as the graphics' detail distance,
//                within these; the fog ends with it)
//   lightFloor   the darkest light (vanilla's ambient light, the Nether's 0.1, seen here as a dim floor;
//                the shader's floor is 0.42 x this, see main.js uNightVision)
//   lavaStep     seconds a lava flow takes per block (the Nether's 3x faster)
//   sky          null (the Overworld's day and night), else a fixed sky:
//                colours (linear HDR) and fog, see sky.js setDimension
//   spawnMobs    (mobs, dt) => void: its creatures' spawning (set by the parts
//                that add them; the Overworld's are mobs.js's own)
//   gravity      (Round 15) the Overworld's gravity times this (the Moon's
//                1/6, Mars' 0.38): players, items and creatures (player.js,
//                entities.js, mobs.js); a fall hurts as from that much less
//   airless      (Round 15) no air: sounds are muffled (js/space.js)
//   rocketOnly   (Round 15) reached by rocket only (js/space.js), never by
//                a portal, F7 or a respawn
//   (Round 17) The planets (the Moon, Mars, Mercury, Venus) have distant
//   tiles of their own (lod: true; js/lod-mesher.js builds them from the
//   generator's lodColumn), so they are seen as far as the Overworld, and
//   further: viewScale  the render distance times this there (the Moon's
//                airless view the longest), minView its floor (chunks);
//   curve        the far terrain bends down with the distance as on a
//                globe of this radius (blocks; js/lod.js), so the horizon
//                drops away from high up as the planet does
//   haze         the far haze's density there (js/space-sky.js: Mars'
//                dust, Venus' thick air; 0: none, the Moon's and Mercury's)
import { BLOCK } from "./content/base.js";
import { TerrainGenerator } from "./terrain.js";
import { NetherGenerator } from "./dim-nether.js";
import { EndGenerator } from "./dim-end.js";
import { CanyonGenerator, CANYON } from "./dim-canyon.js"; // (Round 15: the canyon run's courses)
import { MoonGenerator } from "./dim-moon.js"; // (Round 15: space, js/space.js)
import { MarsGenerator } from "./dim-mars.js";
import { MercuryGenerator } from "./dim-mercury.js"; // (Round 17: landable from the solar system, js/solar.js)
import { VenusGenerator } from "./dim-venus.js";

export const OVERWORLD = "overworld";
export const NETHER = "nether";
export const END = "end";
export const MOON = "moon"; // (Round 15: reached by rocket, js/space.js)
export const MARS = "mars";
export const MERCURY = "mercury"; // (Round 17)
export const VENUS = "venus";
export const DIM_IDS = [OVERWORLD, NETHER, END, MOON, MARS, MERCURY, VENUS];
export { CANYON };

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
    minView: 4,
    maxView: 8,
    lightFloor: 0.62, // (Round 12: vanilla's Nether is lit dimly everywhere, its dark rock still read)
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
    minView: 7,
    maxView: 12,
    lightFloor: 0.05,
    lavaStep: 1.5,
    // (vanilla's dark End sky; its static stars: they never turn)
    sky: { zenith: [0.004, 0.003, 0.006], horizon: [0.011, 0.008, 0.013], ambSky: [0.2, 0.19, 0.24], ambGround: [0.1, 0.09, 0.12], stars: true, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
  // (Round 15) The canyon run's courses (js/dim-canyon.js): only its own
  // page goes there (js/canyon.js), nothing of it is saved; the Overworld's
  // sun and clouds at the course's fixed hour, no weather, no creatures;
  // its chunks are streamed by the run along the canyon (no distant tiles).
  [CANYON]: {
    id: CANYON,
    code: 5,
    prefix: "c",
    name: "the canyon",
    label: "Canyon",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: false,
    weather: false,
    waterEvaporates: false,
    bedsExplode: false,
    lod: false,
    heightfield: false,
    minView: 8,
    maxView: 24,
    lightFloor: 0.12,
    lavaStep: 1.5,
    sky: null,
    spawnMobs: null,
    course: true,
  },
  // (Round 15) The Moon and Mars (js/dim-moon.js, js/dim-mars.js): reached by
  // rocket (js/space.js, js/rocket.js). Their skies have a sun (sky.js `sun`:
  // js/space-sky.js draws them: the Moon's black with the Earth in it, Mars'
  // butterscotch by day with blue sunsets); low gravity; no weather; no
  // creatures of their own; water boils away; beds blow up (no air).
  [MOON]: {
    id: MOON,
    code: 3,
    prefix: "m",
    name: "the Moon",
    label: "Moon",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: false,
    weather: false,
    waterEvaporates: true,
    bedsExplode: true,
    lod: true, // (Round 17: was false, 6-12 chunks of full ones: far tiles now, js/lod-mesher.js)
    heightfield: false,
    minView: 24,
    viewScale: 1.6, // (no air: crisp to the far edge)
    curve: 16400 * 4,
    haze: 0,
    lightFloor: 0.08,
    lavaStep: 1.5,
    gravity: 1 / 6,
    airless: true,
    rocketOnly: true,
    sky: { sun: true, zenith: [0.0, 0.0, 0.0], horizon: [0.003, 0.003, 0.004], ambSky: [0.1, 0.1, 0.11], ambGround: [0.05, 0.05, 0.05], stars: true, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
  [MARS]: {
    id: MARS,
    code: 4,
    prefix: "r",
    name: "Mars",
    label: "Mars",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: true,
    weather: false,
    waterEvaporates: true,
    bedsExplode: true,
    lod: true, // (Round 17: far tiles, a long dusty view)
    heightfield: false,
    minView: 20,
    viewScale: 1.3,
    curve: 31900 * 4,
    haze: 0.0011,
    lightFloor: 0.05,
    lavaStep: 1.5,
    gravity: 0.38,
    rocketOnly: true,
    sky: { sun: true, zenith: [0.3, 0.17, 0.1], horizon: [0.62, 0.38, 0.24], ambSky: [0.3, 0.2, 0.15], ambGround: [0.15, 0.08, 0.05], stars: false, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
  // (Round 17) Mercury and Venus (js/dim-mercury.js, js/dim-venus.js):
  // reached from the solar system (js/solar.js: down past the entry
  // altitude), like the Moon and Mars. Mercury: airless, a black sky, a
  // huge white sun fixed in it, 0.38 gravity. Venus: a thick orange haze (a
  // tint over the far land, not a wall), a dim diffuse light, 0.9 gravity;
  // both too hot for water.
  [MERCURY]: {
    id: MERCURY,
    code: 6,
    prefix: "h",
    name: "Mercury",
    label: "Mercury",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: false,
    weather: false,
    waterEvaporates: true,
    bedsExplode: true,
    lod: true,
    heightfield: false,
    minView: 24,
    viewScale: 1.6,
    curve: 22800 * 4,
    haze: 0,
    lightFloor: 0.08,
    lavaStep: 1.5,
    gravity: 0.38,
    airless: true,
    rocketOnly: true,
    sky: { sun: true, zenith: [0.0, 0.0, 0.0], horizon: [0.003, 0.003, 0.004], ambSky: [0.1, 0.1, 0.11], ambGround: [0.05, 0.05, 0.05], stars: true, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
  [VENUS]: {
    id: VENUS,
    code: 7,
    prefix: "v",
    name: "Venus",
    label: "Venus",
    scale: 1,
    ceiling: false,
    voidBelow: false,
    dayCycle: false,
    weather: false,
    waterEvaporates: true,
    bedsExplode: true,
    lod: true,
    heightfield: false,
    minView: 18,
    viewScale: 1.1,
    curve: 57000 * 4,
    haze: 0.0026,
    lightFloor: 0.12,
    lavaStep: 1.5,
    gravity: 0.9,
    rocketOnly: true,
    sky: { sun: true, zenith: [0.3, 0.16, 0.06], horizon: [0.6, 0.38, 0.16], ambSky: [0.32, 0.2, 0.1], ambGround: [0.16, 0.09, 0.04], stars: false, fog: "clear", exposure: 1.0 },
    spawnMobs: null,
  },
};

const BY_CODE = [];
for (const d of Object.values(DIMS)) BY_CODE[d.code] = d; // (Round 15: by code, however many there are)

// The portal blocks (the Nether's and the End's parts fill it): block id ->
// "nether" | "end" | "end_exit". A player whose body is in one is in that
// portal (js/dimensions.js: its wait, then the travel).
export const PORTAL_BLOCKS = new Map();

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
export const DIM_KEY_RE = /^(?:[nemrhv]:)?-?\d+,-?\d+,-?\d+$/; // (Round 17: h Mercury, v Venus)
const PREFIX_DIM = { n: NETHER, e: END, m: MOON, r: MARS, h: MERCURY, v: VENUS };
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
// is today's terrain. The Nether's is js/dim-nether.js (its biomes,
// features and structures: js/nether-structures.js), the End's js/dim-end.js.
const GENERATORS = {
  [OVERWORLD]: (seed, opts) => new TerrainGenerator(seed, opts),
  [NETHER]: (seed, opts) => new NetherGenerator(seed, opts),
  [END]: (seed, opts) => new EndGenerator(seed, opts),
  [CANYON]: (seed) => new CanyonGenerator(seed),
  [MOON]: (seed) => new MoonGenerator(seed),
  [MARS]: (seed) => new MarsGenerator(seed),
  [MERCURY]: (seed) => new MercuryGenerator(seed), // (Round 17)
  [VENUS]: (seed) => new VenusGenerator(seed),
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
