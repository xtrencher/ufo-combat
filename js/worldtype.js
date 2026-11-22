// The world's type (Round 11), fixed for the life of a world:
//   "missions"  the UFO war: missions, loot, supply drops, vehicles, the
//               mod weapons (the game as it was before Round 11);
//   "survival"  vanilla Minecraft: Mods forced off for that world, no
//               missions, no airports or cities in its terrain.
// Creative is the player's mode in either type (player.js), not a type.
// The type is set once at startup (main.js: the save's, a new world's pick,
// or for a guest the host's) before the world is built; systems subscribe
// with onWorldType(fn) (also sent as a "worldtype" window event). An old
// save without a type is a Missions world; a new world nothing picked a type
// for is a Survival world (Round 12: newWorldType).
//
// (Round 13) One world: a Missions world is the Survival world (vanilla's
// terrain, structures, villages, crafting, hunger, XP, beds, weather, mobs,
// drops, the Nether and the End) with the Missions layer on top (airports,
// cities and bases, UFOs, missions, mod weapons, vehicles, call-ins). So
// what differed between the two types is now one of:
//   vanillaRules()   the vanilla game: true in both types;
//   missionsLayer()  the Missions layer: a Missions world only (Mods can
//                    be on; the Survival world forces them off);
//   isSurvivalWorld() (isVanilla(), its older name) for what really means
//                    "the Survival type" (its menu label, its links).
// The terrain has a generator version of its own (terrainGen()): a Missions
// world saved before Round 13 keeps the old Missions generator (GEN_LEGACY:
// no vanilla terrain features) so its builds stay in their landscape; new
// worlds, and every Survival world, have the vanilla terrain (GEN_ONE_WORLD).
// (Round 21) GEN_BIG_AIRPORTS: a new Missions world's airports are bigger
// and fewer (sites.js); a world saved with GEN_ONE_WORLD keeps its sites.
// (Round 22) GEN_TERRAIN_V2: new mountains (terrain.js _baseInfoV2: sharp,
// varied peaks instead of the tables the older field made at the top of the
// world), in a new world of either type; a world saved with an older
// generator keeps its land. Until Round 22 a Survival world always had the
// newest generator (its terrain had never changed): now it keeps the one it
// was saved with too (one saved without a number, or with 1 or 2: 3, the
// terrain they all had).
// The version is saved with the player (main.js "gen") and sent to guests in
// the welcome (net/multiplayer.js), and terrainOptions() is what World, the
// chunk workers and the distant terrain generate with.
export const WORLD_TYPES = ["missions", "survival"];
export const WORLD_TYPE_NAMES = { missions: "Missions", survival: "Survival" };

export const GEN_LEGACY = 1; // (the Missions generator before Round 13: sites on the old terrain)
export const GEN_ONE_WORLD = 2; // (Round 13: the vanilla terrain, with the sites in a Missions world)
export const GEN_BIG_AIRPORTS = 3; // (Round 21: bigger airports, fewer of them: sites.js AIRPORT_SIZES_BIG)
export const GEN_TERRAIN_V2 = 4; // (Round 22: the new mountains, terrain.js _baseInfoV2; both world types)
export const TERRAIN_GEN = GEN_TERRAIN_V2; // a new world's

let current = "missions";
let set = false;
let gen = TERRAIN_GEN;
const listeners = [];

// Anything that is not "survival" is a Missions world (old saves, old hosts, junk).
export function normalizeWorldType(type) {
  return type === "survival" ? "survival" : "missions";
}

// (Round 12) A new world's type when nothing picked one: Survival (the
// default game) on a fresh start, Missions for a world link (?seed= without
// a type: links from before Round 11 and a Missions world's own link carry
// none, and they keep opening the world they always did).
export function newWorldType(type, { link = false } = {}) {
  if (type !== null && type !== undefined) return normalizeWorldType(type);
  return link ? "missions" : "survival";
}

export function worldType() {
  return current;
}

// (Round 13) The vanilla game's rules (crafting, hunger, XP, beds, weather,
// vanilla mobs and drops, the dimensions...): in both world types. A function,
// so the call sites say what they mean.
export function vanillaRules() {
  return true;
}

// (Round 13) The Missions layer (UFOs, missions, airports and cities, mod
// weapons, loot, vehicles): a Missions world's.
export function missionsLayer() {
  return current === "missions";
}

// A Survival-type world (no Missions layer, Mods forced off).
export function isSurvivalWorld() {
  return current === "survival";
}

// (The older name of isSurvivalWorld: until Round 13 it also meant the
// vanilla rules, now vanillaRules().)
export function isVanilla() {
  return current === "survival";
}

export function isMissionsWorld() {
  return current === "missions";
}

// (Round 13) A world's terrain generator version from what is known of it:
// `saved` its saved number (a save's "gen", a host's welcome's), `old` true
// when the world is not new (a save or a host from before Round 13 has none:
// then a Missions world's terrain is the old one). A Survival world's terrain
// was always the vanilla one.
export function terrainGenOf(type, saved, { old = false } = {}) {
  const n = Math.floor(Number(saved));
  if (normalizeWorldType(type) === "survival") {
    // (Round 22) A Survival world's land changed for the first time with
    // generator 4: an older one (any number below 4, or none) keeps 3's.
    if (Number.isFinite(n) && n >= GEN_TERRAIN_V2) return Math.min(n, TERRAIN_GEN);
    return old || Number.isFinite(n) ? GEN_BIG_AIRPORTS : TERRAIN_GEN;
  }
  if (Number.isFinite(n) && n >= GEN_LEGACY) return Math.min(n, TERRAIN_GEN);
  return old ? GEN_LEGACY : TERRAIN_GEN;
}

// This world's terrain generator version (set with the type).
export function terrainGen() {
  return gen;
}

// (Round 13) An old Missions save on its old terrain (GEN_LEGACY): what
// would change its builds (leaves decaying, cacti popping off beside a
// block) stays as it was there.
export function legacyTerrain() {
  return current === "missions" && gen < GEN_ONE_WORLD;
}

// What the terrain generates with (World, the chunk workers, the LOD):
// sites (airports and cities) in a Missions world; the vanilla terrain in
// every world but an old Missions save; (Round 21) the big airports, fewer
// of them, in a Missions world made with generator 3 or later (a world
// saved with 2 keeps its sites where and as they were; a guest gets the
// host's generator in the welcome).
export function terrainOptions() {
  const o = { sites: current === "missions", vanilla: current === "survival" || gen >= GEN_ONE_WORLD };
  if (current === "missions" && gen >= GEN_BIG_AIRPORTS) o.bigAirports = true;
  if (gen >= GEN_TERRAIN_V2) o.terrainV2 = true; // (Round 22: the new mountains, either type)
  return o;
}

// Whether setWorldType has run (systems built before it can wait for the event).
export function worldTypeSet() {
  return set;
}

// opts.gen: the terrain generator version (terrainGenOf; a new world's by default).
export function setWorldType(type, { gen: g } = {}) {
  current = normalizeWorldType(type);
  gen = terrainGenOf(current, g ?? TERRAIN_GEN); // (Round 22: a Survival world's too)
  set = true;
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (err) {
      console.error(err);
    }
  }
  if (typeof window !== "undefined" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("worldtype", { detail: { type: current, gen } }));
  return current;
}

// fn(type) whenever the type is set (at once too when it already is).
export function onWorldType(fn) {
  listeners.push(fn);
  if (set) fn(current);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// The label of a world on the main menu ("Survival world", "Survival world,
// in Creative", "Missions world", "Missions world, in Creative").
export function worldLabel(type, mode) {
  const t = WORLD_TYPE_NAMES[normalizeWorldType(type)];
  return mode === "creative" ? `${t} world, in Creative` : `${t} world`;
}
