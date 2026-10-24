// Weather (Round 11): a Survival world's rain, snow and thunderstorms, as
// vanilla's. A Missions world keeps its clear sky (its fights and flights
// are built for it); Creative in a Survival world has weather too.
// - The cycle (vanilla's, its game-tick times on this world's day, 10
//   minutes where vanilla's is 20): clear for 5-75 minutes, rain for 5-10;
//   thunder on its own clock (off 5-75, on 1.5-6.5 minutes), heard and seen
//   only while it rains. The change fades in and out over 5 s (vanilla's
//   rain level); "raining" is that level over 0.2, a thunderstorm the thunder
//   level over 0.9 (vanilla's isRaining / isThundering).
// - Where: rain falls in a column from the sky down to its first solid
//   block, liquid or leaves (vanilla's motion-blocking height map); snow
//   instead in the snowy biomes (the mountains among them) and on cold
//   waters; nothing in deserts, savannas and badlands.
// - Its touches (the host's, like random ticks): lightning in a thunderstorm
//   (about one strike every 15 s near each player, where it rains; it hits a
//   creature or player within 3 blocks of the column it picked, as vanilla):
//   5 damage and 8 s of burning within 3 blocks, fire where it lands and
//   four more around (Normal and Hard); snowfall lays snow, still water
//   freezes in the cold (also when clear), rain fills cauldrons; fire goes
//   out in the rain (nature-sim.js asks nearRain), burning players and
//   creatures are put out, farmland drinks it (LIB.isRainingAt).
// - Sleeping (sleep.js): allowed in a thunderstorm; a night slept through
//   ends the rain (vanilla's resetWeatherCycle).
// Online the host owns the weather and sends it (js/net/weather.js): every
// guest sees the same rain and the same bolts, and is hurt by a bolt near
// it on its own screen. Pure logic (no three.js): js/weather-fx.js draws it.
// - (Round 12) The weather is the Overworld's: in the Nether and the End
//   nothing falls and nothing it touches happens there, but its cycle goes
//   on (the host's, wherever the host is), and back in the Overworld it is
//   raining at once if it rains there.
import { BLOCK, IS_SOLID, IS_WET, IS_LEAVES, IS_OPAQUE, BLOCK_INFO } from "./blocks.js";
import { WORLD_HEIGHT, CHUNK_SIZE } from "./constants.js";
import { BIOME } from "./biomes.js";
import { vanillaRules } from "./worldtype.js";
import { LIB } from "./content/base.js";
import * as V from "./content/ids.js";
import { SNOWY_GRASS, flammability } from "./content/nature.js";

export const PRECIP = Object.freeze({ NONE: 0, RAIN: 1, SNOW: 2 });
const VANILLA_DAY_TICKS = 24000;
const FADE = 0.2; // level change a second (vanilla 0.01 a tick)
const STRIKE_EVERY = 15; // seconds, around each player, in a thunderstorm
const STRIKE_RANGE = 8; // chunks (the random-tick range)
const PRECIP_TICKS = 1.25; // a chunk's weather ticks a second (vanilla: 1 in 16 game ticks)
const GRID = 64; // the column cache (wraps around: 64 x 64 columns)
const NO_KEY = 0x7fffffff;
const DRY = new Set([BIOME.DESERT, BIOME.SAVANNA, BIOME.BADLANDS]);
// (the mountains too: this world's are snow-covered, terrain.js isSnowy)
const SNOWY = new Set([BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.MOUNTAINS]);
const COLD_WATER = new Set([BIOME.OCEAN, BIOME.DEEP_OCEAN, BIOME.RIVER, BIOME.BEACH]);

const between = (a, b, rand) => a + rand() * (b - a);

export class Weather {
  // deps: { world, player, mobs, dayLength (seconds: sky.js dayLength(), a Survival world's vanilla 1200),
  // difficulty () => "peaceful" | "easy" | "normal" | "hard" }
  constructor({ world, player = null, mobs = null, dayLength = 600, difficulty = () => "normal" }) {
    this.world = world;
    this.player = player;
    this.mobs = mobs;
    this.difficulty = difficulty;
    this.tick = dayLength / VANILLA_DAY_TICKS; // seconds of this world's time per vanilla game tick
    this.authority = true; // false on a guest: the host's weather (net/weather.js)
    this.enabled = () => vanillaRules(); // (Round 13: in both world types)
    this.rand = Math.random;
    // The cycle (the authority's): vanilla's level.dat fields, in seconds.
    this.raining = false;
    this.thundering = false;
    this.rainTime = 0; // until the rain turns (0: a new spell is picked)
    this.thunderTime = 0;
    this.clearTime = 0; // a clear spell asked for (the command): no rain until it ends
    // What everyone sees: 0-1, fading. thunder is vanilla's thunder level
    // times the rain's; flash: a lightning bolt's (weather-fx.js).
    this.levels = { rain: 0, thunder: 0, flash: 0 };
    this._thunderLevel = 0;
    this.onStrike = null; // (x, y, z): a bolt struck (drawn and heard; the host: sent on)
    this.onChange = null; // (): the cycle turned (the host: sent on)
    this._strikeBudget = 0;
    this._precipBudget = 0;
    this._putOutT = 0;
    // The column cache: the first block rain can't pass (or -1), and the
    // precipitation of 4 x 4 cells (vanilla's biome cells).
    this._keyX = new Int32Array(GRID * GRID).fill(NO_KEY);
    this._keyZ = new Int32Array(GRID * GRID);
    this._top = new Int16Array(GRID * GRID);
    this._chunk = new Array(GRID * GRID).fill(null);
    this._precip = new Map();
    world.changeListeners?.push((changed) => {
      for (let i = 0; i < changed.length; i += 3) {
        const k = ((changed[i + 2] & (GRID - 1)) * GRID) | (changed[i] & (GRID - 1));
        if (this._keyX[k] === changed[i] && this._keyZ[k] === changed[i + 2]) this._keyX[k] = NO_KEY;
      }
    });
    // (Content code and the creatures ask here: farmland drinking the rain,
    // zombies not burning in it, monsters about on a stormy day.)
    LIB.isRainingAt = (x, y, z) => this.rainingAt(x, y, z);
    LIB.isThundering = () => this.enabled() && this.isThundering;
  }

  // (Round 12) The world went to another dimension: the column cache held its chunks.
  dimChanged() {
    this._keyX.fill(NO_KEY);
    this._chunk.fill(null);
    this._precip.clear();
  }

  // Vanilla's isRaining and isThundering: the levels, not the cycle's flags.
  get isRaining() {
    return this.levels.rain > 0.2;
  }

  get isThundering() {
    return this.levels.thunder > 0.9;
  }

  // "clear" | "rain" | "thunder" (what is falling, for the F3 screen and the sky).
  get kind() {
    return this.isThundering ? "thunder" : this.isRaining ? "rain" : "clear";
  }

  // ---------- The cycle ----------

  _ticks(a, b) {
    return between(a, b, this.rand) * this.tick;
  }

  // centers: the players' positions (lightning and the weather's touches
  // happen around them; the first is this player).
  update(dt, centers = null) {
    if (!this.enabled()) {
      this.levels.rain = this.levels.thunder = 0;
      this._thunderLevel = 0;
      return;
    }
    if (this.authority) this._advance(dt);
    // (Round 12) Another dimension: none of it here.
    if (this.world.dimInfo?.weather === false) {
      this.levels.rain = this.levels.thunder = 0;
      this._thunderLevel = 0;
      this._away = true;
      return;
    }
    if (this._away) {
      this._away = false;
      this.levels.rain = this.raining ? 1 : 0;
      this._thunderLevel = this.thundering ? 1 : 0;
      this.levels.thunder = this._thunderLevel * this.levels.rain;
    }
    const step = FADE * dt;
    const r = this.levels.rain;
    this.levels.rain = this.raining ? Math.min(1, r + step) : Math.max(0, r - step);
    this._thunderLevel = this.thundering ? Math.min(1, this._thunderLevel + step) : Math.max(0, this._thunderLevel - step);
    this.levels.thunder = this._thunderLevel * this.levels.rain;
    // (Rain puts out a burning player: this one, on every peer.)
    const p = this.player;
    if (p && p.fireTime > 0 && this.isRaining && this.rainingAt(p.position.x, p.position.y + 1.6, p.position.z)) p.fireTime = 0;
    if (!this.authority || !centers?.length) return;
    if (this.isRaining) this._putOutMobs(dt);
    if (this.isThundering) this._lightning(dt, centers);
    this._precipitationTicks(dt, centers);
  }

  // Vanilla's advanceWeatherCycle (the clear spell simplified: the cycle
  // starts over when it ends).
  _advance(dt) {
    const before = this.raining * 2 + this.thundering;
    if (this.clearTime > 0) {
      this.clearTime = Math.max(0, this.clearTime - dt);
      this.raining = this.thundering = false;
      this.rainTime = this.thunderTime = 0;
    } else {
      if (this.thunderTime > 0) {
        this.thunderTime -= dt;
        if (this.thunderTime <= 0) {
          this.thunderTime = 0;
          this.thundering = !this.thundering;
        }
      } else this.thunderTime = this.thundering ? this._ticks(3600, 15600) : this._ticks(12000, 180000);
      if (this.rainTime > 0) {
        this.rainTime -= dt;
        if (this.rainTime <= 0) {
          this.rainTime = 0;
          this.raining = !this.raining;
        }
      } else this.rainTime = this.raining ? this._ticks(12000, 24000) : this._ticks(12000, 180000);
    }
    if (this.raining * 2 + this.thundering !== before) this.onChange?.();
  }

  // The /weather command (tests, debugging): "clear", "rain" or "thunder"
  // for `seconds` (default: vanilla's 5 minutes of game time, 6000 ticks);
  // instant: no fade.
  set(kind, seconds = 6000 * this.tick, { instant = false } = {}) {
    if (!this.authority || !this.enabled()) return;
    if (kind === "clear") {
      this.clearTime = seconds;
      this.raining = this.thundering = false;
      this.rainTime = this.thunderTime = 0;
    } else {
      this.clearTime = 0;
      this.raining = true;
      this.thundering = kind === "thunder";
      this.rainTime = this.thunderTime = seconds;
    }
    if (instant) {
      this.levels.rain = this.raining ? 1 : 0;
      this._thunderLevel = this.thundering ? 1 : 0;
      this.levels.thunder = this._thunderLevel * this.levels.rain;
    }
    this.onChange?.();
  }

  // Everyone slept through the night (sleep.js): the rain ends, the cycle
  // starts over (vanilla's resetWeatherCycle).
  clearAfterSleep() {
    if (!this.authority || !this.enabled() || !this.raining) return;
    this.raining = this.thundering = false;
    this.rainTime = this.thunderTime = 0;
    this.onChange?.();
  }

  // ---------- Where it rains ----------

  // The first block that stops rain in column (x, z) (a solid block, a
  // liquid, leaves), or -1; WORLD_HEIGHT if the column isn't loaded.
  topAt(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    const k = ((z & (GRID - 1)) * GRID) | (x & (GRID - 1));
    const c = this.world.getChunk?.(x >> 4, z >> 4);
    if (!c) return WORLD_HEIGHT;
    // (a chunk loaded again may hold edits made while it was away)
    if (this._keyX[k] === x && this._keyZ[k] === z && this._chunk[k] === c) return this._top[k];
    const b = c.blocks;
    const col = ((z & 15) << 4) | (x & 15);
    let y = Math.min(WORLD_HEIGHT, b.length >> 8) - 1;
    for (; y >= 0; y--) {
      const id = b[(y << 8) | col];
      if (IS_SOLID[id] || IS_WET[id] || IS_LEAVES[id]) break;
    }
    this._keyX[k] = x;
    this._keyZ[k] = z;
    this._chunk[k] = c;
    this._top[k] = y;
    return y;
  }

  // What falls on column (x, z) when it rains (PRECIP), by biome: 4 x 4 cells.
  precipAt(x, z) {
    const qx = Math.floor(x) >> 2;
    const qz = Math.floor(z) >> 2;
    const key = qx * 0x100000 + qz;
    let p = this._precip.get(key);
    if (p !== undefined) return p;
    const t = this.world.terrain;
    const wx = qx * 4 + 2;
    const wz = qz * 4 + 2;
    const b = t?.biomeAt ? t.biomeAt(wx, wz) : BIOME.PLAINS;
    if (DRY.has(b)) p = PRECIP.NONE;
    else if (SNOWY.has(b) || (COLD_WATER.has(b) && t?.biomes?.coldAt?.(wx, wz))) p = PRECIP.SNOW;
    else p = PRECIP.RAIN;
    this._precip.set(key, p);
    if (this._precip.size > 16384) this._precip.delete(this._precip.keys().next().value);
    return p;
  }

  // RAIN, SNOW or NONE at height y of column (x, z), when it rains (by the
  // biome alone: this world's climate doesn't cool with height).
  kindAt(x, y, z) {
    return this.precipAt(x, z);
  }

  // Vanilla's isRainingAt: raining, open to the sky down to here, and rain
  // (not snow, not a desert's nothing).
  rainingAt(x, y, z) {
    if (!this.isRaining || !this.enabled()) return false;
    if (Math.floor(y) <= this.topAt(x, z)) return false;
    return this.kindAt(x, y, z) === PRECIP.RAIN;
  }

  // Snow falling at (x, y, z).
  snowingAt(x, y, z) {
    if (!this.isRaining || !this.enabled()) return false;
    if (Math.floor(y) <= this.topAt(x, z)) return false;
    return this.kindAt(x, y, z) === PRECIP.SNOW;
  }

  // Vanilla's isNearRain for fire: rain on the cell or on one beside it.
  nearRain(x, y, z) {
    if (!this.isRaining) return false;
    return this.rainingAt(x, y, z) || this.rainingAt(x - 1, y, z) || this.rainingAt(x + 1, y, z) || this.rainingAt(x, y, z - 1) || this.rainingAt(x, y, z + 1);
  }

  // ---------- Lightning (the authority's) ----------

  _lightning(dt, centers) {
    this._strikeBudget += (dt / STRIKE_EVERY) * centers.length;
    let tries = 0;
    while (this._strikeBudget >= 1 && tries++ < 4) {
      this._strikeBudget -= 1;
      const c = centers[Math.floor(this.rand() * centers.length)];
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * STRIKE_RANGE * CHUNK_SIZE;
      this.tryStrike(Math.floor(c.x + Math.cos(a) * r), Math.floor(c.z + Math.sin(a) * r), centers);
    }
    if (this._strikeBudget >= 1) this._strikeBudget = 0;
  }

  // A bolt for column (x, z), if it rains there: onto a living thing within
  // 3 blocks under the open sky (a player first: centers), else the ground.
  tryStrike(x, z, centers = []) {
    if (!this.world.getChunk?.(x >> 4, z >> 4)) return false;
    let y = this.topAt(x, z) + 1;
    if (!this.rainingAt(x, y, z)) return false;
    const near = (p) => Math.abs(p.x - x - 0.5) <= 3 && Math.abs(p.z - z - 0.5) <= 3 && p.y >= y - 3 && this.rainingAt(p.x, p.y + 1, p.z);
    const hit = centers.find(near) || this.mobs?.mobs?.find((m) => !m.dead && near(m.pos))?.pos;
    if (hit) {
      x = Math.floor(hit.x);
      y = Math.floor(hit.y);
      z = Math.floor(hit.z);
    }
    this.strike(x, y, z);
    return true;
  }

  // A bolt at (x, y, z) (the cell it lands in): seen and heard, and on the
  // authority it burns and hurts.
  strike(x, y, z) {
    this.onStrike?.(x, y, z);
    this.hitPlayer(x, y, z);
    if (!this.authority) return;
    const d = this.difficulty?.();
    if (d === "normal" || d === "hard") this._lightFires(x, y, z);
    for (const m of this.mobs?.mobs || []) {
      if (m.dead || !inBlast(m.pos, x, y, z)) continue;
      this.mobs.shoot?.(m, 5, { x: 0, z: 0 }, 0, false);
      m.fireT = Math.max(m.fireT || 0, 8);
    }
  }

  // This player, if the bolt is near: 5 damage and 8 s of burning (vanilla's
  // thunderHit). Every peer judges its own player.
  hitPlayer(x, y, z) {
    const p = this.player;
    if (!p || p.dead || !inBlast(p.position, x, y, z)) return false;
    const hurt = p.damage(5, "lightning");
    if (!p.creative) p.fireTime = Math.max(p.fireTime || 0, 8);
    return hurt;
  }

  // Vanilla's spawnFire(4): where it lands, and four tries around it.
  _lightFires(x, y, z) {
    const out = [];
    const tryFire = (fx, fy, fz) => {
      if (fy < 1 || fy >= WORLD_HEIGHT || !BLOCK_INFO[V.FIRE] || this.world.getBlock(fx, fy, fz) !== BLOCK.AIR) return;
      const below = this.world.getBlock(fx, fy - 1, fz);
      let ok = IS_SOLID[below] && IS_OPAQUE[below];
      if (!ok) {
        const { ignite } = flammability();
        for (const [dx, dy, dz] of SIX) if (ignite[this.world.getBlock(fx + dx, fy + dy, fz + dz)]) ok = true;
      }
      if (ok) out.push(fx, fy, fz, V.FIRE);
    };
    tryFire(x, y, z);
    for (let k = 0; k < 4; k++) tryFire(x + Math.floor(this.rand() * 3) - 1, y + Math.floor(this.rand() * 3) - 1, z + Math.floor(this.rand() * 3) - 1);
    if (out.length) this.world.setBlocks(out);
  }

  // Creatures burning in the rain go out (the authority's: its creatures).
  _putOutMobs(dt) {
    this._putOutT -= dt;
    if (this._putOutT > 0) return;
    this._putOutT = 0.5;
    for (const m of this.mobs?.mobs || []) {
      if (m.fireT > 0 && this.rainingAt(m.pos.x, m.pos.y + (m.spec?.h || 1), m.pos.z)) m.fireT = 0;
    }
  }

  // ---------- The weather's touches on the blocks (the authority's) ----------

  // Vanilla's per-chunk weather tick: in every chunk near a player, 1 game
  // tick in 16, one column's top: still water freezes in the cold; while it
  // snows a snow layer settles; while it rains a cauldron fills.
  _precipitationTicks(dt, centers) {
    const chunks = Math.PI * STRIKE_RANGE * STRIKE_RANGE;
    this._precipBudget = Math.min(this._precipBudget + dt * PRECIP_TICKS * chunks * centers.length, 400);
    while (this._precipBudget >= 1) {
      this._precipBudget -= 1;
      const c = centers[Math.floor(this.rand() * centers.length)];
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * STRIKE_RANGE * CHUNK_SIZE;
      this.precipitationTick(Math.floor(c.x + Math.cos(a) * r), Math.floor(c.z + Math.sin(a) * r));
    }
  }

  // One column's weather tick; returns what it did ("ice", "snow",
  // "cauldron") or null.
  precipitationTick(x, z) {
    const w = this.world;
    if (!w.getChunk?.(x >> 4, z >> 4)) return null;
    const top = this.topAt(x, z);
    if (top < 1 || top >= WORLD_HEIGHT - 1) return null;
    const ground = w.getBlock(x, top, z);
    const y = top + 1;
    const cold = this.kindAt(x, y, z) === PRECIP.SNOW;
    // (vanilla: below block light 10; at the edge of the water; a source only)
    if (cold && ground === BLOCK.WATER && blockLight(w, x, top, z) < 10 && !w.waterSim?.meta?.has(`${x},${top},${z}`)) {
      let edge = false;
      for (const [dx, dz] of FOUR) if (w.getBlock(x + dx, top, z + dz) !== BLOCK.WATER) edge = true;
      if (edge && BLOCK_INFO[V.ICE]) {
        w.setBlock(x, top, z, V.ICE);
        return "ice";
      }
    }
    if (!this.isRaining) return null;
    if (cold) {
      if (w.getBlock(x, y, z) !== BLOCK.AIR || blockLight(w, x, y, z) >= 10 || !BLOCK_INFO[V.SNOW_LAYER]) return null;
      const holds = IS_SOLID[ground] && (IS_OPAQUE[ground] || IS_LEAVES[ground]) && ground !== V.ICE && ground !== V.PACKED_ICE && !BLOCK_INFO[ground]?.collision;
      if (!holds) return null;
      w.setBlocks(ground === BLOCK.GRASS && BLOCK_INFO[SNOWY_GRASS] ? [x, y, z, V.SNOW_LAYER, x, top, z, SNOWY_GRASS] : [x, y, z, V.SNOW_LAYER]);
      return "snow";
    }
    if (this.kindAt(x, y, z) === PRECIP.RAIN && ground >= V.CAULDRON && ground < V.CAULDRON + 3 && /cauldron/i.test(BLOCK_INFO[ground]?.name || "") && BLOCK_INFO[ground + 1]) {
      if (this.rand() < 0.05) {
        w.setBlock(x, top, z, ground + 1);
        return "cauldron";
      }
    }
    return null;
  }

  // ---------- Saving and the network ----------

  serialize() {
    const r = (v) => Math.round(v * 10) / 10;
    return { r: this.raining ? 1 : 0, t: this.thundering ? 1 : 0, rt: r(this.rainTime), tt: r(this.thunderTime), ct: this.clearTime > 0 ? r(this.clearTime) : undefined };
  }

  // A saved world's weather (an older save: none, a new cycle from clear).
  load(d) {
    const num = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
    this.raining = !!d?.r;
    this.thundering = !!d?.t;
    this.rainTime = num(d?.rt, 200000 * this.tick);
    this.thunderTime = num(d?.tt, 200000 * this.tick);
    this.clearTime = num(d?.ct, 1e7);
    this.levels.rain = this.raining ? 1 : 0;
    this._thunderLevel = this.thundering ? 1 : 0;
    this.levels.thunder = this._thunderLevel * this.levels.rain;
  }

  // What a guest needs: the flags (it fades to them) and the levels now.
  netState() {
    return { r: this.raining ? 1 : 0, th: this.thundering ? 1 : 0, rl: Math.round(this.levels.rain * 100) / 100, tl: Math.round(this._thunderLevel * 100) / 100 };
  }

  // The host's weather on a guest (levels: at once, as on joining).
  applyNet(m, levels = false) {
    if (!m) return;
    this.raining = !!m.r;
    this.thundering = !!m.th;
    if (levels && Number.isFinite(m.rl) && Number.isFinite(m.tl)) {
      this.levels.rain = Math.max(0, Math.min(1, m.rl));
      this._thunderLevel = Math.max(0, Math.min(1, m.tl));
      this.levels.thunder = this._thunderLevel * this.levels.rain;
    }
  }
}

const FOUR = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const SIX = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Within a bolt's reach: 3 blocks across, 3 under to 9 over (vanilla's box).
function inBlast(p, x, y, z) {
  return Math.abs(p.x - x - 0.5) <= 3.5 && Math.abs(p.z - z - 0.5) <= 3.5 && p.y >= y - 3 && p.y <= y + 9;
}

function blockLight(world, x, y, z) {
  const l = world.lightAt?.(x, y, z);
  return l ? l.block : 0;
}
