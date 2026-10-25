// localStorage persistence for block edits and settings, scoped per world seed.
// All keys are prefixed to avoid clashing with anything else on the page's origin.
//
// In memory, edits are a Map<chunkKey, Map<localBlockIndex, blockId>> so a
// newly generated chunk can apply just its own edits in O(its edits).
//
// On disk (format v2), each chunk's edits are run-length encoded: records of
// [index lo byte, index hi byte, run length, block id] for runs of
// consecutive block indices that share the same id, base64-encoded. A Blast
// Orb crater (~2000 blocks) compresses to ~1 KB instead of ~24 KB as the
// original flat JSON array, which matters against the ~5 MB storage quota.
// The original v1 format (a flat [x,y,z,id, ...] array) is still read.
//
// (Round 11) Block ids are 16-bit. A chunk whose edits all fit in a byte is
// still written as above (so a save without the new blocks stays readable
// by older versions); one with a larger id is written "wide": the prefix
// WIDE ("!", never in base64, so an older version fails to read it instead
// of misreading it) and records of [index lo, index hi, run length, id lo,
// id hi]. A save holding any wide chunk is format v3. The same strings
// travel online (js/net/world.js).
//
// (Round 12) Each dimension's edits have a key of their own: the Overworld's
// the old one (edits_<seed>), the Nether's and the End's edits_<seed>_nether
// and edits_<seed>_end, in the same format (js/dimensions.js saves them). A
// save from before has only the first: its world is the Overworld's.
import { CHUNK_SIZE, WORLD_HEIGHT, blockIndex, floorDiv, chunkKey } from "./constants.js";
import { BLOCK_LIMIT } from "./content/base.js";

// Distinct from the original game (Voxelands, "voxelands_v1_"), which may be
// hosted on the same domain: the two must never share saves or settings.
const PREFIX = "ufocombat_v1_";
const BLOCKS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export function editsKey(seed, dim = "overworld") {
  return dim === "overworld" ? `${PREFIX}edits_${seed}` : `${PREFIX}edits_${seed}_${dim}`;
}

// The world (seed) an edits key belongs to, whatever its dimension.
function seedOfEditsKey(k) {
  return k.slice(`${PREFIX}edits_`.length).split("_")[0];
}

function bytesToBase64(bytes) {
  let binary = "";
  const STEP = 0x8000; // stay well under engine argument-count limits
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + STEP));
  }
  return btoa(binary);
}

function base64ToBytes(str) {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const WIDE = "!";

export function encodeChunkEdits(map) {
  const indices = [...map.keys()].sort((a, b) => a - b);
  let wide = false;
  for (const id of map.values()) if (id > 255) wide = true;
  const bytes = [];
  let i = 0;
  while (i < indices.length) {
    const start = indices[i];
    const id = map.get(start);
    let len = 1;
    while (i + len < indices.length && len < 255 && indices[i + len] === start + len && map.get(indices[i + len]) === id) {
      len++;
    }
    if (wide) bytes.push(start & 0xff, start >> 8, len, id & 0xff, id >> 8);
    else bytes.push(start & 0xff, start >> 8, len, id);
    i += len;
  }
  return wide ? WIDE + bytesToBase64(bytes) : bytesToBase64(bytes);
}

// Throws on a string it can't read (a newer format, or damaged): the caller
// skips that chunk and says so.
export function decodeChunkEdits(str) {
  const map = new Map();
  const wide = str.startsWith(WIDE);
  if (!wide && /^[^A-Za-z0-9+/=]/.test(str)) throw new Error(`unknown edit format "${str.slice(0, 2)}"`);
  const bytes = base64ToBytes(wide ? str.slice(1) : str);
  const R = wide ? 5 : 4;
  if (wide && bytes.length % R !== 0) throw new Error("damaged edits (wide records cut short)");
  for (let i = 0; i + R - 1 < bytes.length; i += R) {
    const start = bytes[i] | (bytes[i + 1] << 8);
    const len = bytes[i + 2];
    const id = wide ? bytes[i + 3] | (bytes[i + 4] << 8) : bytes[i + 3];
    if (id >= BLOCK_LIMIT) throw new Error(`damaged edits (block id ${id})`);
    for (let k = 0; k < len && start + k < BLOCKS_PER_CHUNK; k++) map.set(start + k, id);
  }
  return map;
}

export function setEdit(edits, cx, cz, index, id) {
  const key = chunkKey(cx, cz);
  let map = edits.get(key);
  if (!map) {
    map = new Map();
    edits.set(key, map);
  }
  map.set(index, id);
}

function editsFromLegacyArray(arr) {
  const edits = new Map();
  for (let i = 0; i + 3 < arr.length; i += 4) {
    const wx = arr[i];
    const wy = arr[i + 1];
    const wz = arr[i + 2];
    const id = arr[i + 3];
    if (![wx, wy, wz, id].every(Number.isInteger) || wy < 0 || wy >= WORLD_HEIGHT || id < 0 || id > 255) continue; // (v1 only ever held byte ids)
    const cx = floorDiv(wx, CHUNK_SIZE);
    const cz = floorDiv(wz, CHUNK_SIZE);
    setEdit(edits, cx, cz, blockIndex(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE), id);
  }
  return edits;
}

// Accepts parsed JSON in either format; returns the in-memory Map form.
export function parseEdits(data) {
  if (Array.isArray(data)) return editsFromLegacyArray(data);
  const edits = new Map();
  if (!data || (data.v !== 2 && data.v !== 3) || typeof data.chunks !== "object" || data.chunks === null) {
    if (data && data.v > 3) console.warn(`UFO COMBAT: saved edits are format v${data.v}, newer than this version reads; the world's changes are not loaded`);
    return edits;
  }
  for (const [key, encoded] of Object.entries(data.chunks)) {
    if (typeof encoded !== "string" || !/^-?\d+,-?\d+$/.test(key)) continue;
    try {
      edits.set(key, decodeChunkEdits(encoded));
    } catch (err) {
      // One corrupted chunk shouldn't discard the rest of the world's edits.
      console.warn(`UFO COMBAT: skipping unreadable saved edits for chunk ${key}`, err);
    }
  }
  return edits;
}

// Serializes edits to the v2 format (v3 once a chunk holds an id above 255:
// see the top). `cache` (Map<chunkKey, string>) keeps each chunk's encoded
// form between saves so only `dirtyKeys` get re-encoded.
export function serializeEdits(edits, cache = null, dirtyKeys = null) {
  const chunks = {};
  let wide = false;
  for (const [key, map] of edits) {
    if (map.size === 0) continue;
    let encoded = cache && (!dirtyKeys || !dirtyKeys.has(key)) ? cache.get(key) : undefined;
    if (encoded === undefined) {
      encoded = encodeChunkEdits(map);
      if (cache) cache.set(key, encoded);
    }
    if (encoded.startsWith(WIDE)) wide = true;
    chunks[key] = encoded;
  }
  return { v: wide ? 3 : 2, chunks };
}

export function loadEdits(seed, dim = "overworld") {
  try {
    const raw = localStorage.getItem(editsKey(seed, dim));
    if (!raw) return new Map();
    return parseEdits(JSON.parse(raw));
  } catch (err) {
    console.warn("UFO COMBAT: failed to load saved edits", err);
    return new Map();
  }
}

// The size of the last edits blob written (characters): a big one is slow to
// rewrite, so the game can save it less often. (Round 12: every dimension's
// last write together.)
export let lastEditsBytes = 0;
const editsBytes = new Map(); // dim -> characters last written
export function saveEdits(seed, edits, cache = null, dirtyKeys = null, dim = "overworld") {
  try {
    const json = JSON.stringify(serializeEdits(edits, cache, dirtyKeys));
    localStorage.setItem(editsKey(seed, dim), json);
    editsBytes.set(dim, json.length);
    lastEditsBytes = 0;
    for (const n of editsBytes.values()) lastEditsBytes += n;
    return true;
  } catch (err) {
    console.warn("UFO COMBAT: failed to save world edits (storage full or unavailable)", err);
    return false;
  }
}

// Settings live in one versioned object under `${PREFIX}settings`.
//
// The world saves (block edits of every world played) share the browser's
// ~5 MB localStorage quota with the settings. Once they had filled it, every
// settings write failed (only a console warning), and the settings quietly
// went back to their last saved values on the next start. So the settings
// keep a reserved slot: the JSON is padded with spaces (JSON.parse ignores
// them) to SETTINGS_RESERVE characters, and rewriting a key with a value of
// the same size never needs more room, however full the storage gets. If a
// write still fails (a storage that was already full before this slot
// existed), the unpadded JSON is tried, and as a last resort the saved block
// edits of another world (never the one being played, largest first) are
// removed to make room; `onStorageFull` is told about it.
const SETTINGS_KEY = `${PREFIX}settings`;
const SETTINGS_RESERVE = 16384;
let activeSeed = null;
export let onStorageFull = null; // (info: { evicted: [seeds], ok }) => void
export function setStorageFullHandler(fn) {
  onStorageFull = fn;
}
// The world being played (its saves are never removed to make room).
export function setActiveSeed(seed) {
  activeSeed = seed;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    // Corrupted: the defaults (and the next change overwrites the bad data).
    console.warn("UFO COMBAT: saved settings were unreadable; using the defaults", err);
    return {};
  }
}

function trySet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

// Saves the settings at once. Returns true when they are stored.
export function saveSettings(settings) {
  let json;
  try {
    json = JSON.stringify(settings);
  } catch (err) {
    console.warn("UFO COMBAT: settings couldn't be serialized", err);
    return false;
  }
  const padded = json.length < SETTINGS_RESERVE ? json + " ".repeat(SETTINGS_RESERVE - json.length) : json;
  if (trySet(SETTINGS_KEY, padded) || trySet(SETTINGS_KEY, json)) return true;
  // Full: make room by removing other worlds' block edits, largest first.
  // (Round 12: a world's every dimension together: never half a world.)
  const evicted = [];
  const worlds = new Map(); // seed -> { keys, size }
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(`${PREFIX}edits_`)) continue;
      const seed = seedOfEditsKey(k);
      if (seed === String(activeSeed)) continue;
      let w = worlds.get(seed);
      if (!w) worlds.set(seed, (w = { keys: [], size: 0 }));
      w.keys.push(k);
      w.size += localStorage.getItem(k)?.length ?? 0;
    }
  } catch (err) {
    worlds.clear();
  }
  const order = [...worlds.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [seed, w] of order) {
    let removed = false;
    for (const k of w.keys) {
      try {
        localStorage.removeItem(k);
        removed = true;
      } catch (err) {
        continue;
      }
    }
    if (!removed) continue;
    evicted.push(seed);
    if (trySet(SETTINGS_KEY, padded) || trySet(SETTINGS_KEY, json)) {
      console.warn(`UFO COMBAT: browser storage was full; removed the saved block edits of other worlds (${evicted.join(", ")}) to keep the settings`);
      onStorageFull?.({ evicted, ok: true });
      return true;
    }
  }
  console.warn("UFO COMBAT: failed to save settings (browser storage full)");
  onStorageFull?.({ evicted, ok: false });
  return false;
}

// How the last start went: { preset, ok }. ok stays false until the world
// has been drawn at that graphics preset, so a start that hung or crashed the
// graphics driver (typically while compiling shaders) is seen by the next
// one, which then steps the preset down (see main.js).
export function loadBootRecord() {
  try {
    const raw = localStorage.getItem(`${PREFIX}boot`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" && typeof data.preset === "string" ? data : null;
  } catch (err) {
    return null;
  }
}

export function saveBootRecord(record) {
  try {
    localStorage.setItem(`${PREFIX}boot`, JSON.stringify(record));
  } catch (err) {
    // Storage unavailable: nothing to remember between starts.
  }
}

// Player state per world: game mode, position, view, health, breath,
// inventory, selected slot and time of day. Small JSON; saved alongside edits.
export function playerKey(seed) {
  return `${PREFIX}player_${seed}`;
}

export function loadPlayer(seed) {
  try {
    const raw = localStorage.getItem(playerKey(seed));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" && data.v === 1 ? data : null;
  } catch (err) {
    return null;
  }
}

export function savePlayer(seed, data) {
  try {
    localStorage.setItem(playerKey(seed), JSON.stringify({ v: 1, ...data }));
    return true;
  } catch (err) {
    console.warn("UFO COMBAT: failed to save player state", err);
    return false;
  }
}

// (Round 13) A world's own small record, written once, with its first save:
// { type, gen } (its world type and terrain generator, worldtype.js). The
// player save has them too, but a world whose player save failed (storage
// full) while its edits were saved would otherwise reload as an old save.
export function worldRecordKey(seed) {
  return `${PREFIX}world_${seed}`;
}

export function loadWorldRecord(seed) {
  try {
    const raw = localStorage.getItem(worldRecordKey(seed));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" && Number.isFinite(data.gen) ? data : null;
  } catch (err) {
    return null;
  }
}

export function saveWorldRecord(seed, { type, gen }) {
  return trySet(worldRecordKey(seed), JSON.stringify({ type, gen }));
}

// Small JSON records outside any one world: the last world played (so the
// main menu can offer to continue it), and the all-time stats.
export function loadJSON(name, fallback = null) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${name}`);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch (err) {
    return fallback;
  }
}

export function saveJSON(name, data) {
  try {
    localStorage.setItem(`${PREFIX}${name}`, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function hasSavedWorld(seed) {
  try {
    return localStorage.getItem(playerKey(seed)) !== null;
  } catch (err) {
    return false;
  }
}

// (Round 13) Whether the world has saved block edits (in any dimension):
// main.js takes a Missions world with edits but no saved player (a save
// from before the player record had its terrain version, "gen") for an old
// one, so its builds keep their landscape (worldtype.js terrainGenOf).
export function hasSavedEdits(seed) {
  try {
    if (localStorage.getItem(editsKey(seed)) !== null) return true;
    const head = `${PREFIX}edits_${seed}_`;
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(head)) return true;
    return false;
  } catch (err) {
    return false;
  }
}

export const STORAGE_PREFIX = PREFIX;
