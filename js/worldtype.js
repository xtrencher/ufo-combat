// The world's type (Round 11), fixed for the life of a world:
//   "missions"  the UFO war: missions, loot, supply drops, vehicles, the
//               mod weapons (the game as it was before Round 11);
//   "survival"  vanilla Minecraft: Mods forced off for that world, no
//               missions, no airports or cities in its terrain.
// Creative is the player's mode in either type (player.js), not a type.
// The type is set once at startup (main.js: the save's, a new world's pick,
// or for a guest the host's) before the world is built; systems that differ
// between the two read isVanilla() (crafting, hunger, XP, mobs, terrain...)
// or subscribe with onWorldType(fn) (also sent as a "worldtype" window
// event). An old save without a type is a Missions world.
export const WORLD_TYPES = ["missions", "survival"];
export const WORLD_TYPE_NAMES = { missions: "Missions", survival: "Survival" };

let current = "missions";
let set = false;
const listeners = [];

// Anything that is not "survival" is a Missions world (old saves, old hosts, junk).
export function normalizeWorldType(type) {
  return type === "survival" ? "survival" : "missions";
}

export function worldType() {
  return current;
}

// A vanilla (Survival-type) world.
export function isVanilla() {
  return current === "survival";
}

export function isMissionsWorld() {
  return current === "missions";
}

// Whether setWorldType has run (systems built before it can wait for the event).
export function worldTypeSet() {
  return set;
}

export function setWorldType(type) {
  current = normalizeWorldType(type);
  set = true;
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (err) {
      console.error(err);
    }
  }
  if (typeof window !== "undefined" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("worldtype", { detail: { type: current } }));
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

// The label of a world on the main menu ("Missions world", "Creative world",
// "Survival world", "Survival world, in Creative").
export function worldLabel(type, mode) {
  const t = normalizeWorldType(type);
  if (t === "missions") return mode === "creative" ? "Creative world" : "Missions world";
  return mode === "creative" ? "Survival world, in Creative" : "Survival world";
}
