// Mobs: passive animals (fluffalo/hoplet/mossback plus cows, pigs, chickens,
// villagers, and ambient flying/swimming critters) and hostile mobs (zombies,
// skeleton archers with real dropping arrows, wall-climbing spiders). Handles
// spawning (animals on sunny grass, zombies/skeletons/spiders in darkness: at
// night or in caves), despawning, simple AI with obstacle-aware steering
// (walk toward a goal, hop up 1-block steps, detour around walls, avoid
// water and cliffs, or climb straight up a wall), physics against the voxel
// world, melee and ranged combat both ways, damage from explosions and
// daylight, death animations, drops and sounds. Mobs spawn farther out than
// a player can reach quickly (real targets at sniper range), with a total
// mob cap and simplified, cheaper AI for anything far from the player.
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_LEAVES, IS_WET } from "./blocks.js";
import { ITEM, meleeDamage } from "./items.js";
import { sweepAxis, rayAabb } from "./physics.js";
import { createMobModel } from "./mob-models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { BIOME } from "./biomes.js";
import { Crowd } from "./crowd.js";
import { Pathfinder } from "./pathfinding.js";

const GRAVITY = -26;
const MAX_PASSIVE = 16;
const MAX_HOSTILE = 8; // skeletons and spiders (zombies have their own cap, a setting)
// Zombie spawn attempts per second at spawn rate 1x (the old shared hostile
// rate's share of zombies); the setting multiplies it.
const ZOMBIE_ATTEMPTS_PER_SECOND = 0.9;
// Beyond this (blocks) zombies are drawn as an instanced crowd instead of
// full animated models; closer in when there are very many of them.
const CROWD_DISTANCE = 44;
const CROWD_DISTANCE_MANY = 26;
// Beyond this, mobs think and move every few frames (a big dt) to save CPU.
const LAZY_AI_DISTANCE = 64;
const SPAWN_INTERVAL = 0.4;
const DESPAWN_FAR = 160; // blocks: removed at once beyond this
const HOSTILE_LINGER = 64; // blocks: hostile mobs this far away despawn over time
const MOB_INVULNERABLE = 0.4;
const DEATH_TIME = 0.9;
const FAR_AI_DISTANCE = 40; // blocks: beyond this, mobs use cheap straight-line movement (no steering)
const ARROW_SPEED = 24;
const ARROW_GRAVITY = -16;
const ARROW_DAMAGE = 3;
const ARROW_LIFE = 5;
const PATH_BUDGET = 2800; // path search nodes per frame, over all creatures
const STUCK_RECALL = 16; // seconds an alien can be stuck before it is called back (a hole it cannot leave)

const ALIEN_LASER_COLORS = { burst: new THREE.Color(0.5, 3.6, 5), plasma: new THREE.Color(5, 1.6, 0.25), scatter: new THREE.Color(0.9, 1.9, 6), rifle: new THREE.Color(5, 3.4, 0.9) };

function colorGeometry(geo, colorHex) {
  const c = new THREE.Color().setHex(colorHex, THREE.SRGBColorSpace);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

// drops: [itemId, min, max, chance]
export const SPECIES = {
  fluffalo: {
    name: "Fluffalo", hostile: false, health: 10, r: 0.45, h: 1.45, eye: 1.05,
    speed: 1.3, fleeSpeed: 3.6, maxDrop: 2, weight: 4,
    drops: [[ITEM.FLUFF, 1, 2, 1], [ITEM.RAW_MEAT, 1, 2, 1]],
  },
  hoplet: {
    name: "Hoplet", hostile: false, health: 4, r: 0.25, h: 0.7, eye: 0.55,
    speed: 2.3, fleeSpeed: 5, maxDrop: 3, weight: 3, hop: true,
    drops: [[ITEM.RAW_MEAT, 1, 1, 1], [ITEM.FLUFF, 1, 1, 0.3]],
  },
  mossback: {
    name: "Mossback", hostile: false, health: 14, r: 0.45, h: 0.8, eye: 0.35,
    speed: 0.7, fleeSpeed: 0.7, maxDrop: 1, weight: 2, hides: true,
    drops: [[ITEM.RAW_MEAT, 1, 3, 1], [ITEM.APPLE, 1, 1, 0.15]],
  },
  zombie: {
    name: "Zombie", hostile: true, glows: true, health: 20, r: 0.3, h: 1.95, eye: 1.7,
    speed: 1.1, chaseSpeed: 2.9, maxDrop: 3, damage: 3, sight: 20,
    drops: [[ITEM.COAL, 0, 2, 1], [ITEM.IRON_INGOT, 1, 1, 0.08], [ITEM.APPLE, 1, 1, 0.05]],
  },
  skeleton: {
    name: "Skeleton", hostile: true, health: 14, r: 0.3, h: 1.95, eye: 1.7,
    speed: 1.0, chaseSpeed: 1.6, maxDrop: 2, damage: 0, sight: 26, ranged: true, pathfind: true,
    shootMin: 7, shootMax: 22, shootCooldown: 1.6,
    drops: [[ITEM.COAL, 0, 1, 0.5], [ITEM.STICK, 0, 2, 0.6]],
  },
  spider: {
    name: "Spider", hostile: true, glows: true, health: 16, r: 0.55, h: 0.9, eye: 0.6,
    speed: 1.3, chaseSpeed: 2.6, maxDrop: 5, damage: 2, sight: 18, climbs: true, noBurn: true,
    drops: [[ITEM.STICK, 0, 2, 0.3]],
  },
  cow: {
    name: "Cow", hostile: false, health: 10, r: 0.5, h: 1.4, eye: 1.1,
    speed: 1.0, fleeSpeed: 2.4, maxDrop: 2, weight: 3,
    drops: [[ITEM.RAW_MEAT, 1, 3, 1]],
  },
  pig: {
    name: "Pig", hostile: false, health: 8, r: 0.4, h: 0.9, eye: 0.7,
    speed: 1.2, fleeSpeed: 3.2, maxDrop: 2, weight: 3,
    drops: [[ITEM.RAW_MEAT, 1, 2, 1]],
  },
  chicken: {
    name: "Chicken", hostile: false, health: 3, r: 0.27, h: 0.95, eye: 0.8,
    speed: 1.4, fleeSpeed: 3.8, maxDrop: 1, weight: 3,
    drops: [[ITEM.RAW_MEAT, 1, 1, 1], [ITEM.FLUFF, 0, 1, 0.2]],
  },
  // Villagers only spawn near a generated village (see _trySpawnVillagers),
  // never as ordinary wildlife (excluded from PASSIVE_KINDS below). They
  // just idle and wander like any other passive mob; no target/chase/flee
  // logic runs since they have no `sight`.
  villager: {
    name: "Villager", hostile: false, health: 10, r: 0.3, h: 1.85, eye: 1.6,
    speed: 0.9, fleeSpeed: 2, maxDrop: 0, weight: 0,
    drops: [],
  },
  // Flying/swimming ambient critters: no combat AI (see _thinkFly), spawned
  // by their own dedicated rules (near flowers, in jungles, in water), never
  // as ordinary grass wildlife.
  butterfly: {
    name: "Butterfly", hostile: false, health: 1, r: 0.12, h: 0.3, eye: 0.15,
    speed: 1.1, maxDrop: 0, weight: 0, flies: true, homeRadius: 8,
    drops: [],
  },
  parrot: {
    name: "Parrot", hostile: false, health: 6, r: 0.25, h: 0.6, eye: 0.4,
    speed: 1.6, maxDrop: 0, weight: 0, flies: true, homeRadius: 14,
    drops: [],
  },
  // Green aliens climb out of crashed UFOs and fight with laser guns (see
  // ufos.js). Never spawned as ordinary night creatures ("special").
  // Three kinds of alien crew. Green: the common foot soldier with a laser
  // pistol. Gray: a tall, fast sharpshooter with a long-range burst rifle.
  // Red: a slow armoured brute lobbing plasma that blasts the ground.
  alien: {
    name: "Green alien", alien: true, hostile: true, special: true, health: 18, r: 0.3, h: 1.62, eye: 1.3, glows: true,
    speed: 1.4, chaseSpeed: 3.1, maxDrop: 3, damage: 0, sight: 40, ranged: true, laser: true, laserDamage: 3, strafes: true,
    weapon: "pistol", shootMin: 5, shootMax: 26, shootCooldown: 1.25, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.IRON_INGOT, 1, 2, 0.6], [ITEM.DIAMOND, 1, 1, 0.12]],
  },
  alien_gray: {
    name: "Gray alien", alien: true, hostile: true, special: true, health: 14, r: 0.28, h: 1.78, eye: 1.45, glows: true,
    speed: 1.6, chaseSpeed: 3.6, maxDrop: 3, damage: 0, sight: 48, ranged: true, laser: true, laserDamage: 2, strafes: true,
    weapon: "burst", shootMin: 10, shootMax: 46, shootCooldown: 2.1, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.IRON_INGOT, 1, 2, 0.5], [ITEM.DIAMOND, 1, 1, 0.18]],
  },
  alien_red: {
    name: "Red alien", alien: true, hostile: true, special: true, health: 46, r: 0.42, h: 2.1, eye: 1.7, glows: true,
    speed: 1.0, chaseSpeed: 2.3, maxDrop: 4, damage: 0, sight: 36, ranged: true, laser: true, laserDamage: 6,
    weapon: "plasma", shootMin: 4, shootMax: 24, shootCooldown: 2.3, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.IRON_INGOT, 2, 3, 0.8], [ITEM.DIAMOND, 1, 2, 0.3], [ITEM.GOLD_INGOT, 1, 2, 0.4]],
  },
  // Blue aliens: quick flankers. They close in and blink to a new spot
  // around the player now and then (flinching when hurt), firing a short
  // scatter of fast bolts: dangerous up close, weak at range.
  alien_blue: {
    name: "Blue alien", alien: true, hostile: true, special: true, health: 16, r: 0.28, h: 1.7, eye: 1.4, glows: true,
    speed: 1.9, chaseSpeed: 4.2, maxDrop: 4, damage: 0, sight: 44, ranged: true, laser: true, laserDamage: 1.4, strafes: true,
    weapon: "scatter", shootMin: 6, shootMax: 16, shootCooldown: 2.3, noBurn: true, pathfind: true, bigJump: true, blinks: true,
    drops: [[ITEM.IRON_INGOT, 1, 2, 0.5], [ITEM.DIAMOND, 1, 1, 0.2]],
  },
  // The airport's security guards: human soldiers posted at the hangars and
  // bunkers. They stand watch and open fire once the player enters the
  // restricted area around them (a Creative player is left alone).
  guard: {
    name: "Guard", hostile: true, special: true, sentry: true, health: 22, r: 0.3, h: 1.85, eye: 1.6,
    speed: 1.0, chaseSpeed: 3.0, maxDrop: 3, damage: 0, sight: 60, ranged: true, laser: true, laserDamage: 2, strafes: true,
    weapon: "rifle", shootMin: 6, shootMax: 38, shootCooldown: 1.9, pathfind: true,
    drops: [[ITEM.COAL, 0, 0, 0]],
  },
  fish: {
    name: "Fish", hostile: false, health: 3, r: 0.2, h: 0.3, eye: 0.15,
    speed: 1.0, maxDrop: 1, weight: 0, flies: true, swims: true, homeRadius: 10,
    drops: [[ITEM.RAW_MEAT, 1, 1, 0.4]],
  },
};

// Ranged weapons: the shoulder pivot of the arm holding it and the reach
// from there to the muzzle (the bow's grip), in model pixels (mob-models.js).
const MUZZLES = {
  skeleton: { pivot: [-4.5, 21.5, 0], reach: 12 },
  alien: { pivot: [4, 16, 0], reach: 14.5 },
  alien_gray: { pivot: [3.5, 19, 0], reach: 22.5 },
  alien_red: { pivot: [6.5, 19, 0], reach: 17.5 },
  alien_blue: { pivot: [3.5, 17, 0], reach: 20 },
  guard: { pivot: [6, 22, 0], reach: 20 },
};
const _mz = new THREE.Vector3();

const PASSIVE_KINDS = Object.keys(SPECIES).filter((k) => !SPECIES[k].hostile && !SPECIES[k].flies && k !== "villager");
const HOSTILE_KINDS = Object.keys(SPECIES).filter((k) => SPECIES[k].hostile);
const OTHER_HOSTILE_KINDS = HOSTILE_KINDS.filter((k) => k !== "zombie" && !SPECIES[k].special);
const FLYER_KINDS = Object.keys(SPECIES).filter((k) => SPECIES[k].flies);
const VILLAGERS_PER_VILLAGE = 2;
const MAX_FLYERS = 10;
const MAX_TOTAL_MOBS = 34;
const VILLAGE_SEARCH_RADIUS = 40;

// Seconds for a full-strength swing with the given tool.
function attackCooldown(tool) {
  if (!tool) return 0.35;
  if (tool.type === "sword") return 0.6;
  if (tool.type === "axe") return 0.9;
  return 0.8;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class MobManager {
  constructor({ scene, world, player, entities, audio, effects, sky }) {
    this.world = world;
    this.player = player;
    this.entities = entities;
    this.audio = audio;
    this.effects = effects;
    this.sky = sky;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mobs = [];
    this.arrows = [];
    this._arrowMat = createEntityMaterial("color");
    this._arrowGeo = colorGeometry(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), 0x8a6a3c);
    this._arrowGeo.rotateX(Math.PI / 2);
    this._arrowTipGeo = colorGeometry(new THREE.ConeGeometry(0.04, 0.14, 5), 0x555555);
    this._arrowTipGeo.rotateX(Math.PI / 2);
    this._arrowTipGeo.translate(0, 0, 0.42);
    this._nextId = 1;
    this.paths = new Pathfinder(world);
    this.pathBudget = 0;
    this._pv = new THREE.Vector3();
    this._po = new THREE.Vector3();
    this._spawnTimer = 0;
    this._seeded = false;
    this.enabled = true;
    this.lastAttackTime = -10; // game time of the player's last swing
    this.time = 0;
    this.kills = 0;
    this.killsByKind = {}; // stats
    // Zombie settings (Mobs tab): spawn rate multiplier, cap, toughness,
    // and daylight zombies (spawn by day, don't burn).
    this.zombies = { spawnRate: 1, max: 8, health: 1, damage: 1, daylight: false };
    this._zombieBudget = 0;
    this._frame = 0;
    this.crowd = new Crowd(this.group, "zombie", 512);
    this.onKill = null; // (mob, byPlayer) => void
    this.lasers = null; // the laser bolt system (aliens' guns)
    this.alienLaserColor = new THREE.Color(0.5, 5, 0.7);
    this.onPlayerHurt = null; // (mob) => void
    this._tmp = new THREE.Vector3();
    this._flashColor = new THREE.Color();
    this._c0 = new THREE.Color();
    this._c1 = new THREE.Color();
  }

  get count() {
    return this.mobs.length;
  }

  countOf(hostile) {
    let n = 0;
    for (const m of this.mobs) if (!m.dead && m.spec.hostile === hostile && m.kind !== "zombie") n++;
    return n;
  }

  // kind "alien" counts every kind of alien.
  countKind(kind) {
    let n = 0;
    for (const m of this.mobs) if (!m.dead && (m.kind === kind || (kind === "alien" && m.spec.alien))) n++;
    return n;
  }

  // ---------- Spawning ----------

  spawn(kind, x, y, z) {
    const spec = SPECIES[kind];
    if (!spec) return null;
    const model = createMobModel(kind);
    const m = {
      id: this._nextId++,
      kind,
      spec,
      model,
      pos: new THREE.Vector3(x, y, z),
      home: { x, y, z }, // flying/swimming critters wander within homeRadius of this
      flyTarget: null,
      flyTimer: 0,
      vel: new THREE.Vector3(),
      knock: new THREE.Vector3(),
      move: new THREE.Vector2(),
      yaw: Math.random() * Math.PI * 2,
      headYaw: 0,
      headPitch: 0,
      health: spec.health * (kind === "zombie" ? this.zombies.health : 1),
      maxHealth: spec.health * (kind === "zombie" ? this.zombies.health : 1),
      hurtTime: 99,
      invulnerable: 0,
      dead: false,
      deathTime: 0,
      onGround: false,
      inWater: false,
      peakY: null,
      walkPhase: Math.random() * 6,
      walk: 0,
      graze: 0,
      hide: 0,
      attackCooldown: 0,
      attack: 1,
      stagger: 0, // seconds of being knocked off balance (no own movement)
      burnTimer: 0,
      burning: false,
      soundTimer: 3 + Math.random() * 8,
      ai: { state: "idle", timer: Math.random() * 3, dirX: 0, dirZ: 1, detour: 0, detourX: 0, detourZ: 0, side: Math.random() < 0.5 ? 1 : -1, target: false },
      // Only mobs with glowing parts (eyes, emitters) get the glow: it makes
      // every bright texel glow, which made skeletons shine like lamps.
      light: { sky: 15, block: 0, flash: new THREE.Color(), glow: spec.glows ? 1 : 0 },
      lazy: 0, // accumulated time while thinking lazily (far away)
      crowd: false, // drawn in the crowd instead of by its own model
    };
    bindEntityLight(model.root, () => m.light);
    this.group.add(model.root);
    this.mobs.push(m);
    this._place(m);
    return m;
  }

  _remove(i) {
    const m = this.mobs[i];
    this.group.remove(m.model.root);
    this.mobs.splice(i, 1);
  }

  clear() {
    while (this.mobs.length) this._remove(this.mobs.length - 1);
  }

  _chunkReady(x, z) {
    const c = this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
    return !!c && c.meshed;
  }

  _freeAt(x, y, z, h) {
    for (let k = 0; k < Math.ceil(h); k++) {
      const id = this.world.getBlock(x, y + k, z);
      if (IS_SOLID[id] || IS_WET[id]) return false;
    }
    return true;
  }

  // Effective light for spawning: block light, or sky light dimmed at night.
  _effectiveLight(x, y, z) {
    const l = this.world.lightAt(x + 0.5, y + 0.5, z + 0.5);
    return Math.max(l.block, l.sky * (0.2 + 0.8 * this.sky.daylight));
  }

  _trySpawnPassive(minDist, maxDist, room = MAX_PASSIVE - this.countOf(false)) {
    if (room <= 0) return 0;
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (maxDist - minDist);
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return 0;
    const top = this.world.surfaceY(x, z);
    if (top < 0 || this.world.getBlock(x, top, z) !== BLOCK.GRASS) return 0;
    if (this.world.lightAt(x + 0.5, top + 1.5, z + 0.5).sky < 10) return 0;
    const kind = this._pickPassive();
    const herd = kind === "mossback" ? 1 + (Math.random() < 0.3 ? 1 : 0) : 2 + Math.floor(Math.random() * 2);
    const n = Math.min(herd, room);
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const sx = x + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
      const sz = z + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
      const st = this.world.surfaceY(sx, sz);
      if (st < 0 || this.world.getBlock(sx, st, sz) !== BLOCK.GRASS || !this._chunkReady(sx, sz)) continue;
      if (!this._freeAt(sx, st + 1, sz, SPECIES[kind].h)) continue;
      this.spawn(kind, sx + 0.5, st + 1, sz + 0.5);
      spawned++;
    }
    return spawned;
  }

  _pickPassive() {
    const total = PASSIVE_KINDS.reduce((s, k) => s + SPECIES[k].weight, 0);
    let r = Math.random() * total;
    for (const k of PASSIVE_KINDS) {
      r -= SPECIES[k].weight;
      if (r <= 0) return k;
    }
    return PASSIVE_KINDS[0];
  }

  // Hostile mobs appear in darkness: on the surface at night, or in unlit
  // caves. Spawn well out (up to sniper range) so there are real targets at
  // a distance, not just underfoot.
  _trySpawnHostile(kind = OTHER_HOSTILE_KINDS[Math.floor(Math.random() * OTHER_HOSTILE_KINDS.length)]) {
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = 28 + Math.random() * 90;
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return false;
    const top = this.world.surfaceY(x, z);
    if (top < 0) return false;
    const anyLight = kind === "zombie" && this.zombies.daylight;
    // Start from the surface or from a random depth, then look for a floor.
    let y = Math.random() < 0.5 ? top + 1 : 2 + Math.floor(Math.random() * Math.max(1, top - 3));
    for (let k = 0; k < 12 && y > 1; k++, y--) {
      const below = this.world.getBlock(x, y - 1, z);
      if (!IS_SOLID[below] || IS_LEAVES[below]) continue;
      if (!this._freeAt(x, y, z, SPECIES[kind].h)) continue;
      if (!anyLight && this._effectiveLight(x, y, z) > 4) return false;
      this.spawn(kind, x + 0.5, y, z + 0.5);
      return true;
    }
    return false;
  }

  // If the player is near a generated village, keep it populated with a
  // couple of villagers (walking around, original design, no combat AI).
  _trySpawnVillagers() {
    const terrain = this.world.terrain;
    const villages = terrain?.villages;
    if (!villages) return;
    const p = this.player.position;
    let village = villages.nearestVillage(p.x, p.z, VILLAGE_SEARCH_RADIUS);
    let radius = 20;
    let cap = VILLAGERS_PER_VILLAGE;
    let spread = 8;
    // Airports and cities (sites.js) have their people too: a few around an
    // airport's apron, a crowd in a city.
    const site = terrain.sites?.nearest(p.x, p.z, 320);
    if (site) {
      const st = terrain.sites.settlement(site);
      if (Math.hypot(st.x - p.x, st.z - p.z) < st.radius + 50 && (!village || Math.hypot(st.x - p.x, st.z - p.z) < Math.hypot(village.x - p.x, village.z - p.z))) {
        village = st;
        radius = st.radius + 10;
        cap = site.kind === "city" ? 9 : 3;
        spread = st.radius * 0.8;
      }
    }
    if (!village) return;
    const nearby = this.mobs.filter((m) => !m.dead && m.kind === "villager" && Math.hypot(m.pos.x - village.x, m.pos.z - village.z) < radius).length;
    if (nearby >= cap) return;
    const ang = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * spread;
    const sx = Math.floor(village.x + Math.cos(ang) * d);
    const sz = Math.floor(village.z + Math.sin(ang) * d);
    if (!this._chunkReady(sx, sz)) return;
    const top = this.world.surfaceY(sx, sz);
    if (top < 0 || !this._freeAt(sx, top + 1, sz, SPECIES.villager.h)) return;
    this.spawn("villager", sx + 0.5, top + 1, sz + 0.5);
  }

  // Butterflies near flowers, parrots in the jungle canopy, fish in open water.
  _trySpawnFlyers() {
    if (this.mobs.filter((m) => !m.dead && m.spec.flies).length >= MAX_FLYERS) return;
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = 10 + Math.random() * 36;
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return;
    const top = this.world.surfaceY(x, z);
    if (top < 0) return;
    const above = this.world.getBlock(x, top + 1, z);
    if (above === BLOCK.FLOWER_RED || above === BLOCK.FLOWER_YELLOW) {
      if (this.world.lightAt(x + 0.5, top + 2.5, z + 0.5).sky > 8) this.spawn("butterfly", x + 0.5, top + 2, z + 0.5);
      return;
    }
    if (above === BLOCK.WATER) {
      // Only in open water at least a couple of blocks deep. Fish move in
      // small schools rather than appearing one at a time.
      if (this.world.getBlock(x, top + 2, z) !== BLOCK.WATER) return;
      const room = MAX_FLYERS - this.mobs.filter((m) => !m.dead && m.spec.flies).length;
      const schoolSize = Math.min(room, 3 + Math.floor(Math.random() * 3));
      for (let i = 0; i < schoolSize; i++) {
        const fx = x + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
        const fz = z + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
        if (this.world.getBlock(fx, top + 1, fz) !== BLOCK.WATER || this.world.getBlock(fx, top + 2, fz) !== BLOCK.WATER) continue;
        this.spawn("fish", fx + 0.5, top + 1.5, fz + 0.5);
      }
      return;
    }
    if (this.world.terrain?.biomeAt(x, z) === BIOME.JUNGLE && this.world.lightAt(x + 0.5, top + 3.5, z + 0.5).sky > 8) {
      this.spawn("parrot", x + 0.5, top + 3, z + 0.5);
    }
  }

  // A tractor beam (tractor-beam.js) lifts every creature inside it at
  // `lift` blocks/s, pulling it to the middle; the ones that reach `topY`
  // (the ship) are taken aboard: removed, and returned.
  // `by` (the UFO): a creature caught in the beam is its prisoner from then on:
  // it keeps rising to the ship (whatever the beam does next) and vanishes
  // inside it. It never falls back down.
  beamLift(beam, lift, topY, by = null) {
    const took = [];
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.dead) continue;
      const c = this._tmp.set(m.pos.x, m.pos.y + m.spec.h * 0.5, m.pos.z);
      if (!beam.contains(c, m.spec.r)) continue;
      if (by) m.abductedBy = by;
      m.beamLift = lift;
      m.stagger = Math.max(m.stagger, 0.3);
      m.knock.x += (beam.top.x - m.pos.x) * 0.05;
      m.knock.z += (beam.top.z - m.pos.z) * 0.05;
      if (m.pos.y + m.spec.h >= topY) {
        took.push(m);
        this._abductFx(m);
        this._remove(i);
      }
    }
    return took;
  }

  // One step of a creature held by a UFO: it rises to the ship (drifting to
  // the middle of its beam) and disappears inside. If the ship is shot down,
  // or leaves, it disappears at once (never a fall). True while it is held.
  _abductStep(m, i, dt) {
    const u = m.abductedBy;
    const gone = !u || u.falling || u.state === "gone" || u.state === "leave";
    const under = u ? u.pos.y - (u.info?.bottom ?? 0) * (u.radius ?? 1) : 0;
    if (!gone) {
      const k = Math.min(1, dt * 2.5);
      m.pos.x += (u.pos.x - m.pos.x) * k;
      m.pos.z += (u.pos.z - m.pos.z) * k;
      m.pos.y += 4.6 * dt;
      m.vel.set(0, 0, 0);
      m.knock.set(0, 0, 0);
      m.move.set(0, 0);
      m.onGround = false;
      m.peakY = null;
      m.stagger = 1;
      m.walk = 0.8;
      m.walkPhase += dt * 9;
      this._place(m);
    }
    if (gone || m.pos.y + m.spec.h >= under - 0.3) {
      this._abductFx(m);
      if (u && !gone) u.abductDone = true;
      this._remove(i);
    }
    return true;
  }

  _abductFx(m) {
    const c = this._c0.setRGB(0.6, 1.8, 2.4);
    for (let k = 0; k < 14; k++) {
      this.effects.glow.spawn({ x: m.pos.x, y: m.pos.y + m.spec.h * 0.5, z: m.pos.z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.5, size0: 0.3, size1: 0.05, color0: c.clone(), drag: 2 });
    }
  }

  // Lowering the zombie cap removes the farthest zombies over it.
  trimZombies() {
    const p = this.player.position;
    const zombies = this.mobs.filter((m) => m.kind === "zombie" && !m.dead).sort((a, b) => b.pos.distanceToSquared(p) - a.pos.distanceToSquared(p));
    for (let k = 0; k < zombies.length - this.zombies.max; k++) this._remove(this.mobs.indexOf(zombies[k]));
  }

  // Removes every creature of a kind (aliens, when mods are switched off).
  removeKind(kind) {
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].kind === kind || (kind === "alien" && this.mobs[i].spec.alien)) this._remove(i);
  }

  // Removes every hostile creature at once (switching to Peaceful).
  removeHostiles() {
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].spec.hostile) this._remove(i);
  }

  _updateSpawning(dt) {
    // `spawning` and `hostileSpawning` are settings (creature spawning,
    // Peaceful difficulty); `enabled` is used by tests.
    if (!this.enabled || this.spawning === false) return;
    if (!this._seeded && this._chunkReady(this.player.position.x, this.player.position.z)) {
      // Start the world with some animals around.
      this._seeded = true;
      for (let i = 0; i < 40 && this.countOf(false) < MAX_PASSIVE - 2; i++) this._trySpawnPassive(14, 50, MAX_PASSIVE - 2 - this.countOf(false));
    }
    // Zombies: their own rate (a setting, up to an apocalypse) and cap.
    if (this.hostileSpawning !== false && this.zombies.spawnRate > 0) {
      this._zombieBudget = Math.min(8, this._zombieBudget + dt * ZOMBIE_ATTEMPTS_PER_SECOND * this.zombies.spawnRate);
      let zombies = -1;
      for (let tries = 0; this._zombieBudget >= 1 && tries < 6; tries++) {
        this._zombieBudget -= 1;
        if (zombies < 0) zombies = this.countKind("zombie");
        if (zombies >= this.zombies.max) {
          this._zombieBudget = 0;
          break;
        }
        if (this._trySpawnHostile("zombie")) zombies++;
      }
    }
    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return;
    this._spawnTimer = SPAWN_INTERVAL;
    const zombieCount = this.countKind("zombie");
    if (this.mobs.length - zombieCount >= MAX_TOTAL_MOBS) return; // an overall cap on top of the per-category ones
    if (this.countOf(false) < MAX_PASSIVE && Math.random() < 0.3) this._trySpawnPassive(30, 80);
    if (this.countOf(true) < MAX_HOSTILE && this.hostileSpawning !== false && Math.random() < 0.67) this._trySpawnHostile();
    this._trySpawnVillagers();
    if (Math.random() < 0.4) this._trySpawnFlyers();
  }

  // ---------- Steering ----------

  // What lies one step ahead in direction (dx, dz): "open", "step" (a
  // 1-block rise to jump), "wall", "water" or "cliff".
  _probe(m, dx, dz) {
    const w = this.world;
    const reach = m.spec.r + 0.45;
    const bx = Math.floor(m.pos.x + dx * reach);
    const bz = Math.floor(m.pos.z + dz * reach);
    const by = Math.floor(m.pos.y + 0.05);
    const cells = Math.ceil(m.spec.h);
    const solid = (y) => IS_SOLID[w.getBlock(bx, y, bz)] === 1;
    if (solid(by)) {
      for (let k = 1; k <= cells; k++) if (solid(by + k)) return "wall";
      if (IS_SOLID[w.getBlock(Math.floor(m.pos.x), by + cells, Math.floor(m.pos.z))]) return "wall"; // no room to jump
      return "step";
    }
    for (let k = 1; k < cells; k++) if (solid(by + k)) return "wall";
    if (IS_WET[w.getBlock(bx, by, bz)]) return "water";
    let drop = 0;
    while (drop < 6 && !solid(by - 1 - drop)) {
      if (IS_WET[w.getBlock(bx, by - 1 - drop, bz)]) return "water";
      drop++;
    }
    return drop > m.spec.maxDrop ? "cliff" : "open";
  }

  // Adjusts a desired direction around obstacles. Returns { x, z, jump } or
  // null if every direction nearby is blocked.
  _steer(m, dx, dz) {
    const ok = (x, z) => {
      const p = this._probe(m, x, z);
      if (p === "open" || (p === "water" && m.inWater)) return { x, z, jump: false };
      if (p === "step") return { x, z, jump: true };
      // Spiders climb straight up whatever wall is in front of them instead
      // of detouring (see the climb branch in _physics).
      if (p === "wall" && m.spec.climbs) return { x, z, jump: false };
      return null;
    };
    if (m.ai.detour > 0) {
      const r = ok(m.ai.detourX, m.ai.detourZ);
      if (r) return r;
    }
    let r = ok(dx, dz);
    if (r) return r;
    for (const a of [0.7, 1.4, 2.1]) {
      for (const s of [m.ai.side, -m.ai.side]) {
        const c = Math.cos(a * s);
        const sn = Math.sin(a * s);
        const x = dx * c - dz * sn;
        const z = dx * sn + dz * c;
        r = ok(x, z);
        if (r) {
          m.ai.detour = 0.8;
          m.ai.detourX = x;
          m.ai.detourZ = z;
          return r;
        }
      }
    }
    m.ai.side = -m.ai.side;
    return null;
  }

  // ---------- AI ----------

  // Ends the calm of a landed crew member (the timer ran out, or it was
  // attacked): it and the rest of its group turn on the player.
  wake(m) {
    for (const o of this.mobs) {
      if (o.dead || !(o.calmT > 0)) continue;
      if (o !== m && (!m.group || o.group !== m.group)) continue;
      o.calmT = 0;
      o.aggro = true;
    }
    m.calmT = 0;
    m.aggro = true;
    this.onWake?.(m);
  }

  // Aliens fight anyone (a Creative player too, who just can't be hurt);
  // everything else leaves Creative players alone.
  _canTarget(m) {
    const p = this.player;
    return !p.dead && (!p.creative || !!m?.spec.alien);
  }

  _think(m, dt, dist = 0) {
    const ai = m.ai;
    const p = this.player.position;
    const dx = p.x - m.pos.x;
    const dz = p.z - m.pos.z;
    const distH = Math.hypot(dx, dz);
    ai.timer -= dt;
    ai.detour = Math.max(0, ai.detour - dt);
    let goalX = 0;
    let goalZ = 0;
    let speed = 0;
    let lookAtPlayer = distH < 6;
    // Shooters keep their body turned toward the player, even while backing
    // away or standing still, and only fire when they actually face them.
    let faceTarget = false;
    let usedPath = false; // following a computed path: it is trusted (no local detours)
    let pathJump = false;

    if (m.spec.hostile) {
      const dy = p.y - m.pos.y;
      // A crew that has just climbed out of a wreck (m.aggro) hunts the
      // player from wherever they are, at any height.
      const sight = m.aggro ? Math.max(m.spec.sight, 160) : m.spec.sight;
      const vertical = m.aggro ? 60 : 10;
      // (A calm crew member looks around and leaves the player be for now.)
      let willing = this._canTarget(m) && !(m.calmT > 0);
      // A posted guard only fights when alerted (the player in his zone, or
      // someone shot at him or his mates); a spider is neutral in daylight
      // unless provoked (a hit, or being in the dark: night, caves).
      if (m.spec.sentry) {
        const z = m.zone;
        if (z && !this.player.dead && !this.player.creative && Math.hypot(p.x - z.x, p.z - z.z) < z.r && Math.abs(p.y - m.pos.y) < 40) {
          if (!m.alerted) this.alarm(m, 60);
          m.alertT = 25;
        } else m.alertT = (m.alertT ?? 0) - dt;
        if (m.alertT <= 0) m.alerted = false;
        willing = willing && !!m.alerted;
      } else if (m.kind === "spider") {
        m.provokedT = Math.max(0, (m.provokedT ?? 0) - dt);
        const bright = this.sky.daylight > 0.55 && m.light.sky >= 12;
        willing = willing && (!bright || m.provokedT > 0);
      }
      if (willing && distH < (ai.target ? sight * 1.4 : sight) && Math.abs(dy) < vertical) ai.target = true;
      else ai.target = false;
      if (!ai.target && ai.path) ai.path = null;
      if (ai.target) {
        lookAtPlayer = true;
        faceTarget = !!m.spec.ranged;
        // Blue aliens blink to flank: now and then when far, or flinching away when hit.
        if (m.spec.blinks) {
          ai.blinkT = (ai.blinkT ?? 3 + Math.random() * 3) - dt;
          const hurtNow = m.hurtTime < 0.4 && m.health < m.maxHealth;
          if (ai.blinkT <= 0 && (distH > 14 || hurtNow || m.hasLOS === false)) {
            ai.blinkT = 6 + Math.random() * 3;
            this._blink(m);
          } else if (ai.blinkT <= 0) ai.blinkT = 1.5;
        }
        if (m.spec.ranged) {
          // Smarter shooters (aliens, skeletons, guards) shoot only with a
          // clear line of fire: without one (a wall, a hill, a hole between
          // them and the player) they walk a real path to a spot that has
          // one, within range; they never keep shooting into blocks.
          const smart = !!m.spec.pathfind && dist < 110;
          const los = smart ? this._clearShot(m) : true;
          m.hasLOS = los;
          if (smart && (!los || distH > m.spec.shootMax)) {
            const s = this._followPath(m, dt);
            if (s) {
              goalX = s.x;
              goalZ = s.z;
              speed = m.spec.chaseSpeed;
              pathJump = s.jump;
              usedPath = true;
            } else if (distH > 0.6) {
              goalX = dx / distH;
              goalZ = dz / distH;
              speed = m.spec.chaseSpeed;
            }
          } else {
            if (smart) {
              ai.path = null;
              ai.stuck = 0;
            }
            if (distH < m.spec.shootMin) {
              goalX = -dx / distH;
              goalZ = -dz / distH;
              speed = m.spec.speed;
            } else if (distH > m.spec.shootMax) {
              goalX = dx / distH;
              goalZ = dz / distH;
              speed = m.spec.chaseSpeed;
            } else if (m.spec.strafes) {
              // Circles the player while shooting (aliens don't stand still).
              const s = (Math.floor(this.time / 2.2 + m.id) % 2 ? 1 : -1) * 0.6;
              goalX = (-dz / distH) * s;
              goalZ = (dx / distH) * s;
              speed = m.spec.speed * 0.8;
            }
          }
          const facing = Math.abs(angleDiff(Math.atan2(dx, dz), m.yaw)) < 0.28;
          if (los && m.stagger <= 0 && m.attackCooldown <= 0 && facing && distH >= m.spec.shootMin * 0.6 && distH <= m.spec.shootMax * 1.3 && Math.abs(dy) < vertical) {
            if (m.spec.laser) this._shootLaser(m);
            else this._shootArrow(m, dx, dy, dz);
            m.attackCooldown = m.spec.shootCooldown;
            m.attack = 0;
          }
        } else if (distH > 0.6) {
          goalX = dx / distH;
          goalZ = dz / distH;
          speed = m.spec.chaseSpeed;
          // Swing at the player when in reach (not while reeling from a hit).
          if (m.stagger <= 0 && distH < m.spec.r + 1.05 && Math.abs(dy) < 1.6 && m.attackCooldown <= 0) this._attackPlayer(m, dx / (distH || 1), dz / (distH || 1));
        }
      }
    }

    if (!ai.target && m.spec.sentry && m.post) {
      // At his post: back to it if he strayed, otherwise standing watch,
      // turning now and then.
      const bx = m.post.x - m.pos.x;
      const bz = m.post.z - m.pos.z;
      const bd = Math.hypot(bx, bz);
      if (bd > 1.5) {
        goalX = bx / bd;
        goalZ = bz / bd;
        speed = m.spec.speed;
      } else if (ai.timer <= 0) {
        ai.timer = 3 + Math.random() * 4;
        ai.dirX = Math.sin(Math.random() * Math.PI * 2);
        ai.dirZ = Math.cos(Math.random() * Math.PI * 2);
      }
      lookAtPlayer = distH < 12;
    } else if (!ai.target) {
      if (ai.state === "flee" && ai.timer > 0) {
        // Run away from the player, with a little zig-zag.
        const away = Math.atan2(-dx, -dz) + Math.sin(this.time * 3 + m.id) * 0.5;
        goalX = Math.sin(away);
        goalZ = Math.cos(away);
        speed = m.spec.fleeSpeed;
        lookAtPlayer = false;
      } else if (ai.state === "hide" && ai.timer > 0) {
        speed = 0;
        lookAtPlayer = false;
      } else if (ai.state === "wander" && ai.timer > 0) {
        goalX = ai.dirX;
        goalZ = ai.dirZ;
        speed = m.spec.speed;
        lookAtPlayer = false;
      } else if (ai.state === "idle" && ai.timer > 0) {
        speed = 0;
      } else {
        // Pick the next thing to do.
        if (Math.random() < 0.55) {
          const a = Math.random() * Math.PI * 2;
          ai.state = "wander";
          ai.dirX = Math.sin(a);
          ai.dirZ = Math.cos(a);
          ai.timer = 2 + Math.random() * 4;
        } else {
          ai.state = "idle";
          ai.timer = 2 + Math.random() * 5;
          m.grazeUntil = !m.spec.hostile && Math.random() < 0.5 ? this.time + 1.5 + Math.random() * 2 : 0;
        }
      }
    }

    let jump = false;
    if (speed > 0 && usedPath) {
      jump = pathJump;
    } else if (speed > 0) {
      if (dist > FAR_AI_DISTANCE && !m.aggro) {
        // Simplified AI far from the player: skip the per-step obstacle
        // probing (cheap straight-line movement; physics still stops it at
        // walls, it just won't detour or step up on its own out there).
        jump = m.spec.hop;
      } else {
        const s = this._steer(m, goalX, goalZ);
        if (s) {
          goalX = s.x;
          goalZ = s.z;
          jump = s.jump;
        } else {
          speed = 0;
          if (ai.state === "wander") ai.timer = 0; // try something else
        }
      }
    }
    // In water: keep paddling, and climb out onto the bank.
    if (m.inWater && speed > 0) jump = jump || m.blocked;
    // Hoplets travel by hopping.
    if (m.spec.hop && speed > 0 && m.onGround) jump = true;

    // Head and body orientation.
    let moveYaw = speed > 0 ? Math.atan2(goalX, goalZ) : m.yaw;
    if (faceTarget && !this.player.dead) moveYaw = Math.atan2(dx, dz);
    const turnRate = faceTarget ? 9 : 6;
    m.yaw += THREE.MathUtils.clamp(angleDiff(moveYaw, m.yaw), -turnRate * dt, turnRate * dt);
    let headYaw = 0;
    let headPitch = 0;
    if (lookAtPlayer && !this.player.dead) {
      headYaw = THREE.MathUtils.clamp(angleDiff(Math.atan2(dx, dz), m.yaw), -1.1, 1.1);
      const eyeDy = this.player.getEyePosition().y - (m.pos.y + m.spec.eye);
      headPitch = THREE.MathUtils.clamp(Math.atan2(eyeDy, Math.max(0.5, distH)), -0.6, 0.6);
    }
    m.headYaw += (headYaw - m.headYaw) * Math.min(1, dt * 6);
    m.headPitch += (headPitch - m.headPitch) * Math.min(1, dt * 6);
    return { x: goalX, z: goalZ, speed, jump };
  }

  // ---------- Line of fire and pathfinding (smarter creatures) ----------

  // Is there nothing solid between the points?
  _rayClear(x0, y0, z0, x1, y1, z1) {
    const v = this._pv.set(x1 - x0, y1 - y0, z1 - z0);
    const d = v.length();
    if (d < 0.5) return true;
    v.divideScalar(d);
    return !this.world.raycast(this._po.set(x0, y0, z0), v, d, { solidOnly: true });
  }

  // A clear line of fire from a creature's eyes to the player's chest (kept
  // for a fraction of a second: it is a ray per creature).
  _clearShot(m) {
    const ai = m.ai;
    if (this.time < (ai.losT ?? -1)) return !!ai.los;
    ai.losT = this.time + 0.2 + Math.random() * 0.1;
    const P = this.player.position;
    ai.los = this._rayClear(m.pos.x, m.pos.y + m.spec.eye - 0.1, m.pos.z, P.x, P.y + 1.1, P.z);
    return ai.los;
  }

  // One step along the path to a firing position (a spot within range of the
  // player with a clear line of fire to them), planning (or re-planning) it
  // when needed. Returns { x, z, jump } (a direction and whether to jump) or
  // null if there is no path to follow (the caller walks straight then).
  _followPath(m, dt) {
    const ai = m.ai;
    const P = this.player.position;
    const spec = m.spec;
    const swim = true;
    // Stuck? Not moving although it wants to (a hole it cannot get out of,
    // a ledge, a crowd).
    ai.stuckT = (ai.stuckT ?? 0) + dt;
    if (ai.stuckT >= 0.6) {
      const moved = ai.stuckPos ? Math.hypot(m.pos.x - ai.stuckPos.x, m.pos.y - ai.stuckPos.y, m.pos.z - ai.stuckPos.z) : 9;
      ai.stuckPos = ai.stuckPos || { x: 0, y: 0, z: 0 };
      ai.stuckPos.x = m.pos.x;
      ai.stuckPos.y = m.pos.y;
      ai.stuckPos.z = m.pos.z;
      if (moved < 0.2) {
        ai.stuck = (ai.stuck ?? 0) + ai.stuckT;
        ai.pathT = 0; // plan again, with a bigger search
      } else ai.stuck = Math.max(0, (ai.stuck ?? 0) - ai.stuckT * 2);
      ai.stuckT = 0;
      // A hole it cannot leave: after a long time it is called back to its
      // ship (and comes down again on the surface, near the player).
      if ((ai.stuck ?? 0) > STUCK_RECALL && spec.alien) {
        this._recall(m);
        return null;
      }
    }
    let p = ai.path;
    ai.pathT = (ai.pathT ?? 0) - dt;
    const drift = p ? Math.hypot(P.x - p.tx, P.z - p.tz) : 99;
    if ((!p || ai.pathT <= 0 || drift > 8 || p.i >= p.cells.length) && this.pathBudget > 0) {
      const h = Math.ceil(spec.h);
      const from = this.paths.groundCell(m.pos.x, m.pos.y, m.pos.z, h, swim);
      if (from) {
        const minD = (spec.shootMin ?? 3) + 1;
        const maxD = (spec.shootMax ?? 20) - 2;
        const eye = spec.eye - 0.1;
        let checks = 0;
        const goalFn = (x, y, z) => {
          const d = Math.hypot(x + 0.5 - P.x, z + 0.5 - P.z);
          if (d < minD || d > maxD || Math.abs(y - P.y) > 14) return false;
          if (++checks > 260) return false;
          return this._rayClear(x + 0.5, y + eye, z + 0.5, P.x, P.y + 1.1, P.z);
        };
        const big = (ai.stuck ?? 0) > 1.5 ? 2.2 : 1;
        const opts = { h, step: spec.bigJump ? 2 : 1, drop: Math.max(2, spec.maxDrop ?? 3), swim, maxNodes: Math.min(this.pathBudget, Math.round(1300 * big)), goalFn };
        let res = this.paths.find(from, { x: P.x, y: P.y, z: P.z }, opts);
        this.pathBudget -= res.nodes;
        // No way found, and not getting anywhere: first get out of the hole
        // (to the surface), and plan from there.
        if (!res.reached && res.path.length < 2 && (ai.stuck ?? 0) > 1.2 && this.pathBudget > 300) {
          const out = this.paths.find(from, null, { ...opts, goalFn: (x, y, z) => y >= this.world.heightAt(x, z) + 1 - 1, heuristic: false, maxNodes: Math.min(this.pathBudget, 3500) });
          this.pathBudget -= out.nodes;
          if (out.reached && out.path.length) res = out;
        }
        p = ai.path = { cells: res.path, i: 0, tx: P.x, tz: P.z, reached: res.reached };
        ai.pathT = res.reached ? 2.5 + Math.random() : 1 + Math.random() * 0.5;
      }
    }
    if (!p || !p.cells.length) return null;
    // Waypoints: the next cell; cells already close are passed.
    for (let k = 0; k < 3 && p.i < p.cells.length; k++) {
      const c = p.cells[p.i];
      const dh = Math.hypot(c[0] + 0.5 - m.pos.x, c[2] + 0.5 - m.pos.z);
      if (dh < 0.5 && Math.abs(c[1] - m.pos.y) < 1.4) p.i++;
      else break;
    }
    if (p.i >= p.cells.length) return null;
    const c = p.cells[p.i];
    const wx = c[0] + 0.5 - m.pos.x;
    const wz = c[2] + 0.5 - m.pos.z;
    const dh = Math.hypot(wx, wz) || 1;
    const rise = c[1] - Math.floor(m.pos.y + 0.05);
    const jump = rise >= 2 ? 2 : rise >= 1 ? 1 : 0;
    return { x: wx / dh, z: wz / dh, jump: jump && dh < 1.7 ? jump : 0 };
  }

  // Raises the alarm among the posted guards around `m`: they fight for a while.
  alarm(m, radius = 45) {
    for (const o of this.mobs) {
      if (o.dead || !o.spec.sentry) continue;
      if (o !== m && o.pos.distanceTo(m.pos) > radius) continue;
      if (!o.alerted) this.onAlarm?.(o);
      o.alerted = true;
      o.alertT = 25;
    }
  }

  // A guard at his post: stands watch, alerted when the player enters the
  // restricted zone (x, z, r) around it.
  spawnGuard(x, y, z, zone) {
    const m = this.spawn("guard", x, y, z);
    if (!m) return null;
    m.sentry = true;
    m.persist = true;
    m.post = { x, y, z };
    m.zone = zone;
    m.alerted = false;
    m.alertT = 0;
    m.yaw = Math.random() * Math.PI * 2;
    return m;
  }

  // The blue alien's blink: to a spot 7-12 blocks from the player with a clear
  // line of fire, in a puff of light.
  _blink(m) {
    const P = this.player.position;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 7 + Math.random() * 5;
      const x = Math.floor(P.x + Math.cos(a) * d);
      const z = Math.floor(P.z + Math.sin(a) * d);
      if (!this._chunkReady(x, z)) continue;
      const cell = this.paths.groundCell(x, P.y, z, Math.ceil(m.spec.h), false);
      if (!cell) continue;
      if (!this._rayClear(cell[0] + 0.5, cell[1] + m.spec.eye - 0.1, cell[2] + 0.5, P.x, P.y + 1.1, P.z)) continue;
      this._abductFx(m);
      m.pos.set(cell[0] + 0.5, cell[1], cell[2] + 0.5);
      m.vel.set(0, 0, 0);
      m.knock.set(0, 0, 0);
      m.ai.path = null;
      m.ai.los = true;
      m.ai.losT = this.time + 0.3;
      this._abductFx(m);
      this.audio?.playTeleport?.();
      return true;
    }
    return false;
  }

  // A creature stuck for good is called back to its ship and comes down
  // again somewhere open near the player (not too close).
  _recall(m) {
    const P = this.player.position;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 22 + Math.random() * 16;
      const x = Math.floor(P.x + Math.cos(a) * d);
      const z = Math.floor(P.z + Math.sin(a) * d);
      if (!this._chunkReady(x, z)) continue;
      const top = this.world.surfaceY(x, z);
      if (top < 0 || IS_WET[this.world.getBlock(x, top + 1, z)]) continue;
      if (!this._freeAt(x, top + 1, z, Math.ceil(m.spec.h))) continue;
      this._abductFx(m);
      m.pos.set(x + 0.5, top + 1, z + 0.5);
      m.vel.set(0, 0, 0);
      m.knock.set(0, 0, 0);
      m.ai.path = null;
      m.ai.stuck = 0;
      this._abductFx(m);
      return true;
    }
    m.ai.stuck = STUCK_RECALL * 0.5;
    return false;
  }

  _attackPlayer(m, nx, nz) {
    m.attackCooldown = 1.0;
    m.attack = 0;
    const dmg = m.kind === "zombie" ? Math.max(1, Math.round(m.spec.damage * this.zombies.damage)) : m.spec.damage;
    const applied = this.player.damage(dmg, m.kind, { from: m.pos });
    // (Blocked by a raised shield: the attacker is pushed back a little.)
    if (!applied && this.player.shielded) {
      m.knock.x -= nx * 5;
      m.knock.z -= nz * 5;
      m.stagger = Math.max(m.stagger, 0.3);
    }
    if (applied) {
      this.player.applyImpulse(this._tmp.set(nx * 6, 4, nz * 6));
      if (this.onPlayerHurt) this.onPlayerHurt(m);
    }
    this.audio.playMob(m.kind, "attack", this._distTo(m));
  }

  _distTo(m) {
    return m.pos.distanceTo(this.player.position);
  }

  // ---------- Ranged combat (skeleton arrows) ----------

  // Where a ranged mob's shot leaves its weapon: the shoulder of the arm
  // holding it (model pivot, turned with the mob) plus the arm-and-weapon
  // length along the aim (the arm is raised along the aim while it targets
  // the player, see mob-models.js). Falls back to the eyes for other kinds.
  _muzzle(m, aim, out = new THREE.Vector3()) {
    const w = MUZZLES[m.kind];
    if (!w) return out.set(m.pos.x, m.pos.y + m.spec.eye, m.pos.z).addScaledVector(aim, m.spec.r + 0.3);
    const [px, py, pz] = w.pivot;
    const c = Math.cos(m.yaw);
    const sn = Math.sin(m.yaw);
    out.set(m.pos.x + (px * c + pz * sn) / 16, m.pos.y + py / 16, m.pos.z + (-px * sn + pz * c) / 16);
    return out.addScaledVector(aim, w.reach / 16);
  }

  _shootArrow(m, dx, dy, dz) {
    // dx/dy/dz are feet-to-feet; aim from the archer's actual eye height at
    // the player's torso center (matches the hitbox center in
    // _arrowHitsPlayer), not at the player's feet, or a level shot from an
    // elevated eye already clears a same-height target's hitbox before any
    // gravity compensation is even added.
    // The arrow leaves the bow (held out in the left hand), aimed from there.
    const guess = new THREE.Vector3(dx, dy + 0.9 - m.spec.eye, dz).normalize();
    const start = this._muzzle(m, guess);
    const vdx = m.pos.x + dx - start.x;
    const vdz = m.pos.z + dz - start.z;
    const vdy = m.pos.y + dy + 0.9 - start.y;
    const dist = Math.hypot(vdx, vdy, vdz) || 1;
    const t = Math.max(0.35, dist / ARROW_SPEED);
    // Aims a little high to help compensate for the drop over the flight.
    const riseComp = -0.5 * ARROW_GRAVITY * t * 0.55;
    const dir = new THREE.Vector3(vdx, vdy + riseComp, vdz).normalize();
    // (Inside a wall at point blank: from the archer's eyes instead.)
    if (IS_SOLID[this.world.getBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z))]) start.set(m.pos.x, m.pos.y + m.spec.eye, m.pos.z).addScaledVector(dir, m.spec.r + 0.3);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this._arrowGeo, this._arrowMat), new THREE.Mesh(this._arrowTipGeo, this._arrowMat));
    this.group.add(mesh);
    const a = { pos: start, vel: dir.multiplyScalar(ARROW_SPEED), mesh, age: 0, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => a.light);
    mesh.position.copy(start);
    this.arrows.push(a);
    this.audio.playSwing?.();
  }

  // Aliens: a laser bolt at the player's chest (or the vehicle the player
  // is in), a little off at long range. Each kind has its own weapon: a
  // green pistol bolt, a gray burst of three fast cyan bolts, or a slow red
  // plasma ball that blasts a small hole where it lands.
  _shootLaser(m, follow = false) {
    if (!this.lasers) return;
    const weapon = m.spec.weapon || "pistol";
    if ((weapon === "burst" || weapon === "rifle") && !follow) {
      m.burst = 2; // two more follow the first
      m.burstT = 0.12;
    }
    const target = this.player.getEyePosition();
    target.y -= 0.6;
    // The bolt leaves the gun's muzzle (the gun arm is raised along the aim).
    const from = this._muzzle(m, _mz.copy(target).sub(m.pos).setY(target.y - m.pos.y - m.spec.eye + 0.4).normalize());
    if (IS_SOLID[this.world.getBlock(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z))]) from.set(m.pos.x, m.pos.y + m.spec.eye - 0.4, m.pos.z);
    const aimVel = this.player.vehicle ? this.player.vehicle.vel : this.player.velocity;
    const speed = weapon === "plasma" ? 38 : weapon === "burst" ? 110 : weapon === "rifle" ? 125 : weapon === "scatter" ? 90 : 62;
    const dist0 = target.distanceTo(from);
    // Leads a moving player a little.
    target.addScaledVector(aimVel, Math.min(1.2, (dist0 / speed) * 0.7));
    const dir = target.sub(from);
    const dist = dir.length() || 1;
    dir.divideScalar(dist);
    const spread = (weapon === "burst" ? 0.012 : weapon === "rifle" ? 0.02 : 0.03) + dist * (weapon === "burst" ? 0.0006 : weapon === "rifle" ? 0.0009 : 0.0012);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    m.aimTime = this.time;
    const range = dist * 1.4 + 40;
    // (Survival: alien guns follow the mission curve, like the UFOs' do.)
    const damage = Math.max(1, Math.round(m.spec.laserDamage * (this.alienDamageScale ?? 1)));
    if (weapon === "plasma") {
      this.lasers.fire({ from, dir, color: ALIEN_LASER_COLORS.plasma, speed, damage, owner: "alien", source: m, range, radius: 0.2, length: 0.9, blast: 1.6 });
    } else if (weapon === "scatter") {
      // A short scatter of four fast bolts: some of them up close, hardly any at range.
      for (let i = 0; i < 4; i++) {
        const d = dir.clone();
        d.x += (Math.random() - 0.5) * 0.3;
        d.y += (Math.random() - 0.5) * 0.2;
        d.z += (Math.random() - 0.5) * 0.3;
        d.normalize();
        this.lasers.fire({ from, dir: d, color: ALIEN_LASER_COLORS.scatter, speed, damage, owner: "alien", source: m, range: Math.min(range, 34), radius: 0.035, length: 1.1 });
      }
    } else if (weapon === "rifle") {
      this.lasers.fire({ from, dir, color: ALIEN_LASER_COLORS.rifle, speed, damage, owner: "alien", source: m, range, radius: 0.04, length: 1.6 });
    } else {
      this.lasers.fire({ from, dir, color: weapon === "burst" ? ALIEN_LASER_COLORS.burst : this.alienLaserColor, speed, damage, owner: "alien", source: m, range, radius: weapon === "burst" ? 0.04 : 0.05, length: weapon === "burst" ? 1.8 : 1.3 });
    }
  }

  // Whether the player's body is hit somewhere along the arrow's step this
  // frame; returns the distance along the step, or null.
  _arrowHitsPlayer(pos, dir, maxDist) {
    if (this.player.dead || this.player.creative) return null;
    const p = this.player.position;
    const samples = 4;
    for (let s = 1; s <= samples; s++) {
      const t = (maxDist * s) / samples;
      const x = pos.x + dir.x * t;
      const y = pos.y + dir.y * t;
      const z = pos.z + dir.z * t;
      if (Math.abs(x - p.x) < 0.35 && Math.abs(z - p.z) < 0.35 && y > p.y - 0.1 && y < p.y + 1.9) return t;
    }
    return null;
  }

  _updateArrows(dt) {
    const w = this.world;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      a.vel.y += ARROW_GRAVITY * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const len = step.length() || 0.0001;
      const dir = step.clone().divideScalar(len);
      const blockHit = w.raycast(a.pos, dir, len, { solidOnly: true });
      const playerT = this._arrowHitsPlayer(a.pos, dir, blockHit ? blockHit.distance : len);
      if (playerT !== null) {
        if (this.player.damage(ARROW_DAMAGE, "skeleton", { from: a.pos.clone().addScaledVector(dir, -3) })) this.player.applyImpulse(this._tmp.set(dir.x * 4, 2, dir.z * 4));
        this.group.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      if (blockHit) {
        this.group.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      a.pos.add(step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.x + dir.x, a.pos.y + dir.y, a.pos.z + dir.z);
      a.mesh.rotateY(Math.PI);
      a.light = w.lightAt(a.pos.x, a.pos.y, a.pos.z);
      if (a.age > ARROW_LIFE || a.pos.y < -20) {
        this.group.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
  }

  // ---------- Flying/swimming critters ----------

  // Butterflies, parrots and fish: no combat, just a gentle drift between
  // random points within homeRadius of where they spawned. Cheap by design
  // (no steering/probing): if a chosen target turns out to be inside solid
  // ground, the physics sweep just stops it and a new target is picked.
  _thinkFly(m, dt) {
    const spec = m.spec;
    m.flyTimer -= dt;
    // Parrots sit on branches between flights (see _perchSpot).
    if (m.kind === "parrot") {
      m.perch = (m.perch ?? 0) + ((m.perched ? 1 : 0) - (m.perch ?? 0)) * Math.min(1, dt * 4);
      if (m.perched) {
        m.perchT -= dt;
        const below = this.world.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y - 0.1), Math.floor(m.pos.z));
        if (m.perchT > 0 && IS_SOLID[below] && m.hurtTime > 1) {
          m.headYaw = Math.sin(this.time * 0.7 + m.id) * 0.6;
          return { x: 0, y: 0, z: 0, speed: 0 };
        }
        m.perched = false;
        m.flyTarget = null;
      } else if (m.flyTarget?.perch) {
        const d = Math.hypot(m.flyTarget.x - m.pos.x, m.flyTarget.y - m.pos.y, m.flyTarget.z - m.pos.z);
        if (d < 0.35) {
          m.perched = true;
          m.perchT = 4 + Math.random() * 8;
          m.vel.set(0, 0, 0);
          return { x: 0, y: 0, z: 0, speed: 0 };
        }
      }
    }
    if (!m.flyTarget || m.flyTimer <= 0 || m.blocked) {
      const r = spec.homeRadius;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      m.flyTarget = {
        x: m.home.x + Math.cos(a) * d,
        y: spec.swims ? m.home.y + (Math.random() - 0.5) * Math.min(3, r * 0.4) : m.home.y + 1 + Math.random() * 3,
        z: m.home.z + Math.sin(a) * d,
      };
      m.flyTimer = 2 + Math.random() * 3;
      if (m.kind === "parrot" && Math.random() < 0.55) {
        const spot = this._perchSpot(m);
        if (spot) {
          m.flyTarget = spot;
          m.flyTimer = 8;
        }
      }
    }
    const dx = m.flyTarget.x - m.pos.x;
    const dy = m.flyTarget.y - m.pos.y;
    const dz = m.flyTarget.z - m.pos.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const speed = dist > 0.4 ? spec.speed : 0;
    m.yaw += angleDiff(Math.atan2(dx, dz), m.yaw) * Math.min(1, dt * 2);
    m.headYaw = 0;
    m.headPitch = 0;
    return { x: dx / dist, y: dy / dist, z: dz / dist, speed };
  }

  // A place for a parrot to sit near its home: the top of a leaf or log
  // block with air above it (a branch in the canopy), or null.
  _perchSpot(m) {
    const w = this.world;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1 + Math.random() * m.spec.homeRadius * 0.7;
      const x = Math.floor(m.home.x + Math.cos(a) * d);
      const z = Math.floor(m.home.z + Math.sin(a) * d);
      if (!w.getChunk(x >> 4, z >> 4)) continue;
      const top = w.surfaceY(x, z);
      if (top < 0) continue;
      const id = w.getBlock(x, top, z);
      if (!(IS_LEAVES[id] || BLOCK_INFO[id]?.log)) continue;
      if (w.getBlock(x, top + 1, z) !== BLOCK.AIR || w.getBlock(x, top + 2, z) !== BLOCK.AIR) continue;
      return { x: x + 0.5, y: top + 1.02, z: z + 0.5, perch: true };
    }
    return null;
  }

  _physicsFly(m, dt, want) {
    const w = this.world;
    const spec = m.spec;
    const k = Math.min(1, dt * 2.5);
    m.vel.x += (want.x * want.speed - m.vel.x) * k;
    m.vel.y += (want.y * want.speed - m.vel.y) * k;
    if (m.beamLift) {
      m.vel.y = m.beamLift;
      m.beamLift = 0;
    }
    m.vel.z += (want.z * want.speed - m.vel.z) * k;
    const ax = m.vel.x * dt;
    const dx = sweepAxis(w, m.pos, spec.r, spec.h, "x", ax);
    m.pos.x += dx;
    const ay = m.vel.y * dt;
    const dy = sweepAxis(w, m.pos, spec.r, spec.h, "y", ay);
    m.pos.y += dy;
    const az = m.vel.z * dt;
    const dz = sweepAxis(w, m.pos, spec.r, spec.h, "z", az);
    m.pos.z += dz;
    m.blocked = Math.abs(dx - ax) > 1e-6 || Math.abs(dy - ay) > 1e-6 || Math.abs(dz - az) > 1e-6;
    m.onGround = false;
    m.inWater = IS_WET[w.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y), Math.floor(m.pos.z))] === 1;
    // A fish stranded out of water heads home (its spawn point, in water) fast.
    if (spec.swims && !m.inWater) {
      m.flyTarget = { x: m.home.x, y: m.home.y, z: m.home.z };
      m.flyTimer = Math.max(m.flyTimer, 0.5);
    }
    const speed = Math.hypot(m.vel.x, m.vel.z);
    m.walk = Math.min(1, speed / 2);
    m.walkPhase += dt * 3;
  }

  // ---------- Physics ----------

  _physics(m, dt, want) {
    const w = this.world;
    const spec = m.spec;
    const waterFeet = IS_WET[w.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.2), Math.floor(m.pos.z))] === 1;
    const waterBody = IS_WET[w.getBlock(Math.floor(m.pos.x), Math.floor(m.pos.y + spec.h * 0.55), Math.floor(m.pos.z))] === 1;
    m.inWater = waterFeet || waterBody;

    // A mob reeling from a hit doesn't steer, so the knockback carries it.
    const speed = m.stagger > 0 ? 0 : want.speed * (m.inWater ? 0.6 : 1) * (m.burning && spec.hostile ? 1.15 : 1);
    const accel = m.onGround || m.inWater ? 10 : 2;
    const k = Math.min(1, accel * dt);
    m.move.x += (want.x * speed - m.move.x) * k;
    m.move.y += (want.z * speed - m.move.y) * k;
    const kd = Math.exp(-(m.onGround ? 8 : 1) * dt);
    m.knock.x *= kd;
    m.knock.z *= kd;
    m.vel.x = m.move.x + m.knock.x;
    m.vel.z = m.move.y + m.knock.z;

    if (m.beamLift) {
      // Held in a tractor beam: rising, legs kicking.
      m.vel.y = m.beamLift;
      m.beamLift = 0;
      m.peakY = null;
    } else if (m.inWater) {
      m.vel.y += (waterBody ? 16 : -12) * dt;
      m.vel.y = THREE.MathUtils.clamp(m.vel.y, -3, 2.4);
    } else if (spec.climbs && m.blocked && speed > 0 && !m.onGround) {
      // Pressed against a wall while trying to move: climb it instead of
      // falling (m.blocked is last frame's result, so this lags one frame
      // behind actually touching the wall, close enough for a spider).
      m.vel.y = 3.4;
    } else {
      m.vel.y = Math.max(m.vel.y + GRAVITY * dt, -40);
    }
    // (A big jump, for 2-block rises, only for creatures built for it: aliens.)
    if (want.jump && (m.onGround || (m.inWater && !waterBody))) m.vel.y = spec.hop ? 6.4 : want.jump === 2 && spec.bigJump ? 11.2 : 8.2;
    else if (want.jump && m.inWater) m.vel.y = Math.max(m.vel.y, 5);

    const wasOnGround = m.onGround;
    m.onGround = false;
    const ax = m.vel.x * dt;
    const dx = sweepAxis(w, m.pos, spec.r, spec.h, "x", ax);
    m.pos.x += dx;
    const dy0 = m.vel.y * dt;
    const dy = sweepAxis(w, m.pos, spec.r, spec.h, "y", dy0);
    if (dy0 < 0 && dy > dy0) m.onGround = true;
    m.pos.y += dy;
    if (Math.abs(dy - dy0) > 1e-6) m.vel.y = 0;
    const az = m.vel.z * dt;
    const dz = sweepAxis(w, m.pos, spec.r, spec.h, "z", az);
    m.pos.z += dz;
    m.blocked = Math.abs(dx - ax) > 1e-6 || Math.abs(dz - az) > 1e-6;
    if (Math.abs(dx - ax) > 1e-6) m.knock.x = 0;
    if (Math.abs(dz - az) > 1e-6) m.knock.z = 0;

    // Fall damage (not for hoppers, who land softly).
    if (m.onGround || m.inWater) {
      if (m.peakY !== null && !m.inWater && !spec.hop && !wasOnGround) {
        const dmg = Math.floor(m.peakY - m.pos.y - 3);
        if (dmg > 0) this._hurt(m, dmg, null, 0);
      }
      m.peakY = null;
    } else {
      m.peakY = m.peakY === null ? m.pos.y : Math.max(m.peakY, m.pos.y);
    }

    const horiz = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    m.walk += ((horiz > 0.3 ? Math.min(1, horiz / 2) : 0) - m.walk) * Math.min(1, dt * 8);
    m.walkPhase += horiz * dt * (spec.hop ? 3 : 4.2);
  }

  // Mobs push each other (and away from the player) instead of overlapping.
  // Neighbours are found through a coarse grid, so hundreds of zombies
  // don't cost a pair check each.
  _separate(dt) {
    const list = this.mobs;
    const grid = this._grid || (this._grid = new Map());
    grid.clear();
    const CELL = 2;
    const key = (x, z) => ((Math.floor(x / CELL) & 0xffff) << 16) | (Math.floor(z / CELL) & 0xffff);
    for (const m of list) {
      if (m.dead) continue;
      const k = key(m.pos.x, m.pos.z);
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(m);
    }
    const p = this.player.position;
    for (const a of list) {
      if (a.dead) continue;
      const cx = Math.floor(a.pos.x / CELL);
      const cz = Math.floor(a.pos.z / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const cell = grid.get(((gx & 0xffff) << 16) | (gz & 0xffff));
          if (!cell) continue;
          for (const b of cell) {
            if (b.id <= a.id) continue; // each pair once
            const dx = b.pos.x - a.pos.x;
            const dz = b.pos.z - a.pos.z;
            const min = a.spec.r + b.spec.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
            const d = Math.sqrt(d2) || 0.01;
            const push = ((min - d) / min) * 6 * dt;
            a.knock.x -= (dx / d) * push;
            a.knock.z -= (dz / d) * push;
            b.knock.x += (dx / d) * push;
            b.knock.z += (dz / d) * push;
          }
        }
      }
      const dx = a.pos.x - p.x;
      const dz = a.pos.z - p.z;
      const min = a.spec.r + 0.3;
      const d2 = dx * dx + dz * dz;
      if (!this.player.dead && d2 < min * min && a.pos.y < p.y + 1.8 && a.pos.y + a.spec.h > p.y) {
        const d = Math.sqrt(d2) || 0.01;
        a.knock.x += (dx / d) * 10 * dt;
        a.knock.z += (dz / d) * 10 * dt;
      }
    }
  }

  // ---------- Damage ----------

  // Damages a mob; (nx, nz) is the knockback direction and `kb` its strength.
  _hurt(m, amount, dir, kb, byPlayer = false) {
    if (m.dead || m.invulnerable > 0 || amount <= 0) return false;
    if (byPlayer) {
      m.lastPlayerHit = this.time;
      // Hit by the player: a spider is provoked (they are neutral in daylight
      // otherwise); a guard (and the guards near him) raise the alarm.
      if (m.kind === "spider") m.provokedT = 30;
      if (m.spec.sentry) this.alarm(m, 40);
    }
    // A calm crew member (just landed, looking around) that gets hit
    // stops looking around: it (and its mates) fight back at once.
    if (byPlayer && m.calmT > 0) this.wake(m);
    if (m.spec.hides && m.hide > 0.5) amount *= 0.5; // the shell takes most of it
    m.health -= amount;
    m.hurtTime = 0;
    m.invulnerable = MOB_INVULNERABLE;
    if (dir && kb > 0) {
      m.stagger = 0.45;
      m.move.set(0, 0);
      m.knock.x += dir.x * kb;
      m.knock.z += dir.z * kb;
      m.vel.y = Math.max(m.vel.y, Math.min(4.2, kb * 0.8));
    }
    const dist = this._distTo(m);
    if (m.health <= 0) {
      m.dead = true;
      m.deathTime = 0;
      this.kills++;
      this.killsByKind[m.kind] = (this.killsByKind[m.kind] || 0) + 1;
      if (this.onKill) this.onKill(m, this.time - (m.lastPlayerHit ?? -99) < 6);
      this.audio.playMob(m.kind, "death", dist);
      return true;
    }
    this.audio.playMob(m.kind, "hurt", dist);
    if (!m.spec.hostile) {
      if (m.spec.hides) {
        m.ai.state = "hide";
        m.ai.timer = 4 + Math.random() * 2;
      } else {
        m.ai.state = "flee";
        m.ai.timer = 3 + Math.random() * 2;
      }
    }
    return true;
  }

  _die(i) {
    const m = this.mobs[i];
    const c = m.pos;
    // A puff of smoke, then the drops.
    const grey = this._c0.setRGB(0.85, 0.85, 0.85);
    const grey2 = this._c1.setRGB(0.5, 0.5, 0.5);
    for (let k = 0; k < 10; k++) {
      this.effects.smoke.spawn({
        x: c.x + (Math.random() - 0.5) * m.spec.r * 2,
        y: c.y + Math.random() * m.spec.h * 0.7,
        z: c.z + (Math.random() - 0.5) * m.spec.r * 2,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 0.6 + Math.random() * 0.9,
        vz: (Math.random() - 0.5) * 1.2,
        life: 0.7 + Math.random() * 0.5,
        size0: 0.25,
        size1: 0.6,
        color0: grey,
        color1: grey2,
        alpha: 0.8,
        drag: 2,
      });
    }
    for (const [id, min, max, chance] of m.spec.drops) {
      if (Math.random() > chance) continue;
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) this.entities.spawn(id, n, new THREE.Vector3(c.x, c.y + 0.4, c.z));
    }
    this._remove(i);
  }

  // Explosions hurt and fling mobs like they do the player, scaled by size.
  explosion(center, radius, byPlayer = true) {
    const reach = radius * 1.8;
    const size = Math.sqrt(radius / 7);
    for (const m of this.mobs) {
      if (m.dead) continue;
      const d = this._tmp.set(m.pos.x - center.x, m.pos.y + m.spec.h / 2 - center.y, m.pos.z - center.z);
      const dist = d.length();
      if (dist >= reach) continue;
      const f = 1 - dist / reach;
      const dmg = Math.floor(30 * size * Math.pow(f, 1.3));
      const dir = { x: d.x / (dist || 1), z: d.z / (dist || 1) };
      m.invulnerable = 0;
      this._hurt(m, dmg, dir, Math.min(30, f * 16 * size), byPlayer);
      m.vel.y = Math.max(m.vel.y, Math.min(20, f * 12 * size));
    }
  }

  // A bullet (or other projectile) hits `mob` travelling along `dir`.
  shoot(mob, damage, dir, knockback = 4, byPlayer = true) {
    const len = Math.hypot(dir.x, dir.z) || 1;
    mob.invulnerable = 0; // every shot counts
    return this._hurt(mob, damage, { x: dir.x / len, z: dir.z / len }, knockback, byPlayer);
  }

  // The first living mob whose body is within `r` of point `p`, or null.
  sphereHit(p, r) {
    for (const m of this.mobs) {
      if (m.dead) continue;
      const hr = m.spec.r + r;
      if (Math.abs(p.x - m.pos.x) < hr && Math.abs(p.z - m.pos.z) < hr && p.y > m.pos.y - r && p.y < m.pos.y + m.spec.h + r) return m;
    }
    return null;
  }

  // ---------- Player combat ----------

  // 0-1: how recharged the player's next swing is.
  charge(tool) {
    return Math.min(1, (this.time - this.lastAttackTime) / attackCooldown(tool));
  }

  // A swing that hit nothing still resets the charge.
  swing() {
    this.lastAttackTime = this.time;
  }

  // The nearest living mob under the crosshair within `reach`, or null.
  // filter(mob) -> false skips a mob (e.g. the one that fired a bolt).
  raycast(origin, dir, reach, filter = null) {
    let best = null;
    const min = this._rmin || (this._rmin = new THREE.Vector3());
    const max = this._rmax || (this._rmax = new THREE.Vector3());
    for (const m of this.mobs) {
      if (m.dead || (filter && !filter(m))) continue;
      const r = m.spec.r + 0.08;
      min.set(m.pos.x - r, m.pos.y, m.pos.z - r);
      max.set(m.pos.x + r, m.pos.y + m.spec.h + 0.05, m.pos.z + r);
      const t = rayAabb(origin, dir, min, max, reach);
      if (t !== null && (!best || t < best.distance)) best = { mob: m, distance: t };
    }
    return best;
  }

  // The player hits `mob` with `tool` (item tool info or null). Returns true
  // if the hit landed.
  attack(mob, tool) {
    const player = this.player;
    const charge = this.charge(tool);
    this.lastAttackTime = this.time;
    if (mob.dead) return false;
    let dmg = meleeDamage(tool) * (0.2 + 0.8 * charge * charge);
    // Critical hit: striking while falling.
    const crit = charge > 0.9 && !player.onGround && !player.inWater && player.velocity.y < -1;
    if (crit) dmg *= 1.5;
    const dx = mob.pos.x - player.position.x;
    const dz = mob.pos.z - player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const kb = (5 + (player.sprinting ? 3 : 0)) * (0.4 + 0.6 * charge);
    const hit = this._hurt(mob, dmg, { x: dx / d, z: dz / d }, kb, true);
    if (hit) {
      this.audio.playHit(crit);
      if (crit) this._critSparks(mob);
    }
    return hit;
  }

  _critSparks(m) {
    const c = this._c0.setRGB(3, 2.4, 0.9);
    for (let i = 0; i < 12; i++) {
      this.effects.glow.spawn({
        x: m.pos.x, y: m.pos.y + m.spec.h * 0.7, z: m.pos.z,
        vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5,
        life: 0.4 + Math.random() * 0.3, size0: 0.12, size1: 0.02, color0: c, gravity: 0.3, drag: 3,
      });
    }
  }

  // Whether any mob's body overlaps block (x, y, z) (to block placement).
  overlapsBlock(x, y, z) {
    for (const m of this.mobs) {
      if (m.dead) continue;
      const r = m.spec.r;
      if (x + 1 > m.pos.x - r && x < m.pos.x + r && z + 1 > m.pos.z - r && z < m.pos.z + r && y + 1 > m.pos.y && y < m.pos.y + m.spec.h) return true;
    }
    return false;
  }

  // ---------- Per frame ----------

  update(dt) {
    this.time += dt;
    this._frame++;
    this.pathBudget = PATH_BUDGET;
    this._updateSpawning(dt);
    this._updateArrows(dt);
    const p = this.player.position;
    const daylight = this.sky.daylight;
    // Many zombies: hand them over to the crowd closer in.
    const zombieCount = this.zombies.max > 60 ? this.countKind("zombie") : 0;
    const crowdDist = zombieCount > 60 ? CROWD_DISTANCE_MANY : CROWD_DISTANCE;
    this.crowd.begin();

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.hurtTime += dt;
      m.invulnerable = Math.max(0, m.invulnerable - dt);
      m.attackCooldown -= dt;
      m.attack = Math.min(1, m.attack + dt / 0.35);
      m.stagger = Math.max(0, m.stagger - dt);
      if (m.calmT > 0 && !m.dead) {
        m.calmT -= dt;
        if (m.calmT <= 0) this.wake(m);
      }
      if (m.burst > 0) {
        m.burstT -= dt;
        if (m.burstT <= 0 && !m.dead) {
          m.burst--;
          m.burstT = 0.12;
          this._shootLaser(m, true);
        }
      }
      const dist = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);

      if (m.dead) {
        m.deathTime += dt;
        if (m.deathTime >= DEATH_TIME) {
          this._die(i);
          continue;
        }
      } else {
        if (m.abductedBy && this._abductStep(m, i, dt)) continue;
        // Despawning: far away, in unloaded terrain, or (zombies) lingering far off.
        if ((dist > DESPAWN_FAR && !m.persist) || !this.world.getChunk(Math.floor(m.pos.x) >> 4, Math.floor(m.pos.z) >> 4) || m.pos.y < -10) {
          this._remove(i);
          continue;
        }
        if (m.spec.hostile && !m.missionTarget && !m.persist && dist > HOSTILE_LINGER && Math.random() < dt / 20) {
          this._remove(i);
          continue;
        }
        // Far away, think and move only every third frame (with the time
        // saved up), staggered so the work spreads evenly over frames.
        let step = dt;
        if (dist > LAZY_AI_DISTANCE) {
          m.lazy += dt;
          if ((this._frame + m.id) % 3 !== 0) {
            this._afterMove(m, dist, crowdDist);
            continue;
          }
          step = Math.min(0.15, m.lazy);
          m.lazy = 0;
        }
        if (m.spec.flies) {
          const want = this._thinkFly(m, step);
          this._physicsFly(m, step, want);
        } else {
          const want = this._think(m, step, dist);
          this._physics(m, step, want);
          this._sounds(m, step);
          this._daylight(m, step, daylight);
        }
      }
      this._afterMove(m, dist, crowdDist);
    }
    this.crowd.end();
    this._separate(dt);
  }

  // Light and drawing after a mob moved: its own model up close, or a
  // place in the crowd far away (zombies).
  _afterMove(m, dist, crowdDist) {
    const l = this.world.lightAt(m.pos.x, m.pos.y + m.spec.h * 0.6, m.pos.z);
    m.light.sky = l.sky;
    m.light.block = l.block;
    const crowd = m.kind === "zombie" && !m.dead && dist > crowdDist;
    if (crowd !== m.crowd) {
      m.crowd = crowd;
      m.model.root.visible = !crowd;
    }
    if (crowd) {
      const bright = Math.max(l.block / 15, (l.sky / 15) * (0.25 + 0.75 * this.sky.daylight));
      const hurt = Math.max(0, 1 - m.hurtTime / 0.3);
      if (!this.crowd.add(m.pos, m.yaw, m.walk > 0.2 ? m.walkPhase : Math.PI / 2, 0.35 + bright * 0.65, hurt)) {
        m.crowd = false; // crowd full: draw it normally
        m.model.root.visible = true;
        this._place(m);
      }
      return;
    }
    this._place(m);
  }

  _sounds(m, dt) {
    m.soundTimer -= dt;
    if (m.soundTimer > 0) return;
    m.soundTimer = (m.spec.hostile ? 4 : 7) + Math.random() * 9;
    const d = this._distTo(m);
    if (d < 24) this.audio.playMob(m.kind, "idle", d);
  }

  // Zombies burn in direct daylight.
  _daylight(m, dt, daylight) {
    m.burning = m.spec.hostile && !m.spec.noBurn && !m.fireproof && !(m.kind === "zombie" && this.zombies.daylight) && daylight > 0.6 && m.light.sky >= 13 && !m.inWater;
    if (!m.burning) return;
    m.burnTimer += dt;
    if (m.burnTimer >= 1) {
      m.burnTimer = 0;
      m.invulnerable = 0;
      this._hurt(m, 2, null, 0);
    }
    if (Math.random() < dt * 14) {
      const c = this._c0.setRGB(3.2, 1.2, 0.25);
      const c2 = this._c1.setRGB(0.6, 0.12, 0.02);
      this.effects.glow.spawn({
        x: m.pos.x + (Math.random() - 0.5) * 0.5, y: m.pos.y + Math.random() * m.spec.h, z: m.pos.z + (Math.random() - 0.5) * 0.5,
        vy: 1 + Math.random(), life: 0.5, size0: 0.35, size1: 0.1, color0: c, color1: c2,
      });
    }
  }

  // Positions and animates the model.
  _place(m) {
    const model = m.model;
    model.root.position.copy(m.pos);
    model.root.rotation.y = m.yaw;
    // Hit flash (red), burning (orange), and a red, tipping-over death.
    const hurt = Math.max(0, 1 - m.hurtTime / 0.3);
    const f = m.light.flash;
    if (m.dead) f.setRGB(0.55, 0, 0);
    else if (hurt > 0) f.setRGB(0.6 * hurt, 0, 0);
    else if (m.burning) f.setRGB(0.25, 0.08, 0);
    else f.setRGB(0, 0, 0);
    if (m.dead) {
      const t = Math.min(1, m.deathTime / 0.35);
      model.tilt.rotation.z = t * t * Math.PI * 0.5;
      model.tilt.position.y = t * m.spec.r * 0.5;
    }
    if (!m.spec.hostile) {
      const grazing = m.grazeUntil && this.time < m.grazeUntil && m.walk < 0.1;
      m.graze += ((grazing ? 1 : 0) - m.graze) * 0.1;
    }
    if (m.spec.hides) m.hide += ((m.ai.state === "hide" && m.ai.timer > 0 ? 1 : 0) - m.hide) * 0.15;
    model.animate({
      walkPhase: m.walkPhase,
      walk: m.walk,
      headYaw: m.headYaw,
      headPitch: m.headPitch,
      time: this.time + m.id * 1.7,
      vy: m.onGround ? 0 : m.vel.y,
      graze: m.graze,
      hide: m.hide,
      attack: m.attack,
      aim: m.ai.target ? 1 : 0,
      perch: m.perch ?? 0,
    });
  }
}
