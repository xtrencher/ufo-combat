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
//
// (Round 11) A Survival world (worldtype.js isVanilla()) has vanilla's mobs
// instead: zombies, skeletons, spiders, creepers, endermen, slimes and
// witches by night; cows, pigs, chickens and sheep that breed, babies that
// grow up, villagers who trade (trading.js) and iron golems guarding them;
// cod and salmon in the water; vanilla drops, health and AI. A Missions world
// keeps its mobs exactly as before (the new kinds never spawn there, except
// from a Creative spawn egg).
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_LEAVES, IS_WET, IS_OPAQUE, COLLISION_BOXES } from "./blocks.js";
import { ITEM, meleeDamage, isValidItem, maxStack, blockDrops } from "./items.js";
import { sweepAxis, rayAabb } from "./physics.js";
import { createMobModel } from "./mob-models.js";
import { itemModel } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { BIOME } from "./biomes.js";
import { Crowd } from "./crowd.js";
import { Pathfinder } from "./pathfinding.js";
import { meleeCause, shooterCause } from "./damage.js";
import { isVanilla } from "./worldtype.js";
import { LIB } from "./content/base.js";
import * as V from "./content/ids.js";
import { makeOffers, PROFESSION_NAMES, NITWIT } from "./trading.js";
import { SEA_LEVEL } from "./constants.js";

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
// (Round 9) Online, how far out the host spawns around another player: where
// it keeps their ground generated (net/entities.js KEEP_RADIUS, 4 chunks).
const REMOTE_REACH = 60;
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
    drops: [[ITEM.COAL, 0, 2, 1], [ITEM.APPLE, 1, 1, 0.05]],
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
    speed: 0.9, fleeSpeed: 2, maxDrop: 1, weight: 0,
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
    // (Round 8: aliens fight back from about as far as the player's guns
    // reach: they spot you from far off and shoot from long range, with an
    // aim that is decent but not deadly at that distance.)
    speed: 1.4, chaseSpeed: 3.1, maxDrop: 3, damage: 0, sight: 95, ranged: true, laser: true, laserDamage: 3, strafes: true,
    weapon: "pistol", shootMin: 5, shootMax: 70, shootCooldown: 1.25, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.APPLE, 1, 1, 0.25]],
  },
  alien_gray: {
    name: "Gray alien", alien: true, hostile: true, special: true, health: 14, r: 0.28, h: 1.78, eye: 1.45, glows: true,
    speed: 1.6, chaseSpeed: 3.6, maxDrop: 3, damage: 0, sight: 130, ranged: true, laser: true, laserDamage: 2, strafes: true,
    weapon: "burst", shootMin: 10, shootMax: 110, shootCooldown: 2.1, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.APPLE, 1, 2, 0.3], [ITEM.GOLDEN_APPLE, 1, 1, 0.04]],
  },
  alien_red: {
    name: "Red alien", alien: true, hostile: true, special: true, health: 46, r: 0.42, h: 2.1, eye: 1.7, glows: true,
    speed: 1.0, chaseSpeed: 2.3, maxDrop: 4, damage: 0, sight: 85, ranged: true, laser: true, laserDamage: 6,
    weapon: "plasma", shootMin: 4, shootMax: 60, shootCooldown: 2.3, noBurn: true, pathfind: true, bigJump: true,
    drops: [[ITEM.APPLE, 1, 2, 0.4], [ITEM.GOLDEN_APPLE, 1, 1, 0.08], [ITEM.GOLD_INGOT, 1, 2, 0.4]],
  },
  // Blue aliens: quick flankers. They close in and blink to a new spot
  // around the player now and then (flinching when hurt), firing a short
  // scatter of fast bolts: dangerous up close, weak at range.
  alien_blue: {
    name: "Blue alien", alien: true, hostile: true, special: true, health: 16, r: 0.28, h: 1.7, eye: 1.4, glows: true,
    speed: 1.9, chaseSpeed: 4.2, maxDrop: 4, damage: 0, sight: 75, ranged: true, laser: true, laserDamage: 1.4, strafes: true,
    weapon: "scatter", shootMin: 6, shootMax: 16, shootCooldown: 2.3, noBurn: true, pathfind: true, bigJump: true, blinks: true,
    drops: [[ITEM.APPLE, 1, 1, 0.3], [ITEM.GOLDEN_APPLE, 1, 1, 0.04]],
  },
  // The airport's security guards: human soldiers posted at the hangars and
  // bunkers. They stand watch and open fire once the player enters the
  // restricted area around them (a Creative player is left alone).
  guard: {
    name: "Guard", hostile: true, special: true, sentry: true, health: 22, r: 0.3, h: 1.85, eye: 1.6,
    speed: 1.0, chaseSpeed: 3.0, maxDrop: 3, damage: 0, sight: 80, ranged: true, laser: true, laserDamage: 1.5, strafes: true,
    weapon: "rifle", shootMin: 6, shootMax: 75, shootCooldown: 2.3, pathfind: true,
    drops: [[ITEM.COAL, 0, 0, 0]],
  },
  fish: {
    name: "Fish", hostile: false, health: 3, r: 0.2, h: 0.3, eye: 0.15,
    speed: 1.0, maxDrop: 1, weight: 0, flies: true, swims: true, homeRadius: 10,
    drops: [[ITEM.RAW_MEAT, 1, 1, 0.4]],
  },
  // ---- (Round 11) A Survival world's own mobs (`vanilla`: never spawned in
  // a Missions world). Vanilla health (half-hearts), damage (Normal), drops
  // ([id, min, max, chance, cooked id if it died burning, only if a player
  // killed it]) and experience (xp: [min, max]). `brain`: its own AI. ----
  creeper: {
    name: "Creeper", vanilla: true, hostile: true, health: 20, r: 0.3, h: 1.7, eye: 1.45,
    speed: 1.0, chaseSpeed: 2.6, maxDrop: 3, damage: 0, sight: 16, noBurn: true, brain: "creeper", xp: [5, 5],
    drops: [[V.GUNPOWDER, 0, 2, 1]],
  },
  enderman: {
    name: "Enderman", vanilla: true, hostile: true, glows: true, health: 40, r: 0.3, h: 2.9, eye: 2.55,
    speed: 1.3, chaseSpeed: 4.4, maxDrop: 3, damage: 7, sight: 64, noBurn: true, brain: "enderman", xp: [5, 5],
    drops: [[V.ENDER_PEARL, 0, 1, 1]],
  },
  slime: {
    name: "Slime", vanilla: true, hostile: true, health: 16, r: 1.02, h: 2.04, eye: 1.4,
    speed: 2.6, chaseSpeed: 2.6, maxDrop: 9, damage: 4, sight: 16, noBurn: true, noFall: true, brain: "slime", size: 4, split: "slime_medium", xp: [4, 4],
    drops: [],
  },
  slime_medium: {
    name: "Slime", vanilla: true, hostile: true, health: 4, r: 0.51, h: 1.02, eye: 0.7,
    speed: 2.2, chaseSpeed: 2.2, maxDrop: 9, damage: 2, sight: 16, noBurn: true, noFall: true, brain: "slime", size: 2, split: "slime_small", xp: [2, 2],
    drops: [],
  },
  slime_small: {
    name: "Slime", vanilla: true, hostile: true, health: 1, r: 0.26, h: 0.52, eye: 0.35,
    speed: 1.8, chaseSpeed: 1.8, maxDrop: 9, damage: 0, sight: 16, noBurn: true, noFall: true, brain: "slime", size: 1, xp: [1, 1],
    drops: [[V.SLIME_BALL, 0, 2, 1]],
  },
  witch: {
    name: "Witch", vanilla: true, hostile: true, health: 26, r: 0.3, h: 1.95, eye: 1.62,
    speed: 1.0, chaseSpeed: 1.7, maxDrop: 3, damage: 0, sight: 16, ranged: true, noBurn: true, brain: "witch", xp: [5, 5],
    shootMin: 3, shootMax: 10, shootCooldown: 3,
    drops: [], // (rolled in _vanillaDrops: bottles, redstone, gunpowder, spider eyes, sugar, sticks)
  },
  sheep: {
    name: "Sheep", vanilla: true, hostile: false, health: 8, r: 0.45, h: 1.3, eye: 0.95,
    speed: 1.0, fleeSpeed: 2.6, maxDrop: 3, weight: 12, xp: [1, 3], breed: [V.WHEAT], grazes: true,
    drops: [[V.MUTTON, 1, 2, 1, V.COOKED_MUTTON]], // (and its wool, unless shorn)
  },
  iron_golem: {
    name: "Iron Golem", vanilla: true, hostile: false, village: true, health: 100, r: 0.7, h: 2.7, eye: 2.2,
    speed: 0.8, chaseSpeed: 1.9, fleeSpeed: 0.8, maxDrop: 3, weight: 0, damage: 7.5, sight: 16, noFall: true, brain: "golem",
    drops: [[V.IRON_INGOT, 3, 5, 1], [BLOCK.FLOWER_RED, 0, 2, 1]],
  },
  // A wolf: neutral (a pack turns on whoever hits one of them), hunts sheep
  // and skeletons; tamed with bones, it sits, follows, and fights for its owner.
  wolf: {
    name: "Wolf", vanilla: true, hostile: false, health: 8, r: 0.3, h: 0.85, eye: 0.68,
    speed: 1.4, chaseSpeed: 3.8, fleeSpeed: 3, maxDrop: 3, weight: 0, damage: 4, sight: 16, brain: "wolf", xp: [1, 3],
    breed: [V.BEEF, V.COOKED_BEEF, V.PORKCHOP, V.COOKED_PORKCHOP, V.CHICKEN, V.COOKED_CHICKEN, V.MUTTON, V.COOKED_MUTTON, V.ROTTEN_FLESH, ITEM.RAW_MEAT, ITEM.COOKED_MEAT],
    drops: [],
  },
  cod: {
    name: "Cod", vanilla: true, hostile: false, health: 3, r: 0.25, h: 0.3, eye: 0.15,
    speed: 1.0, maxDrop: 1, weight: 0, flies: true, swims: true, homeRadius: 10, xp: [1, 3],
    drops: [[V.COD, 1, 1, 1, V.COOKED_COD], [V.BONE_MEAL, 1, 1, 0.05]],
  },
  salmon: {
    name: "Salmon", vanilla: true, hostile: false, health: 3, r: 0.3, h: 0.4, eye: 0.2,
    speed: 1.2, maxDrop: 1, weight: 0, flies: true, swims: true, homeRadius: 10, xp: [1, 3],
    drops: [[V.SALMON, 1, 1, 1, V.COOKED_SALMON], [V.BONE_MEAL, 1, 1, 0.05]],
  },
};

// (Round 11) The game's own kinds as they are in a Survival world: vanilla
// health, drops and experience, breeding food. (Missions worlds: SPECIES as is.)
const VANILLA_CHANGES = {
  zombie: { health: 20, xp: [5, 5], huntsVillagers: true, drops: [[V.ROTTEN_FLESH, 0, 2, 1]] }, // (and, rarely, iron, a carrot or a potato: _vanillaDrops)
  skeleton: { health: 20, xp: [5, 5], drops: [[V.BONE, 0, 2, 1], [V.ARROW, 0, 2, 1], [ITEM.BOW, 1, 1, 0.085, 0, true]] }, // (its bow: vanilla's 8.5%)
  spider: { health: 16, xp: [5, 5], drops: [[V.STRING, 0, 2, 1], [V.SPIDER_EYE, 1, 1, 1 / 3, 0, true]] },
  cow: { health: 10, xp: [1, 3], weight: 8, breed: [V.WHEAT], milk: true, drops: [[V.BEEF, 1, 3, 1, V.COOKED_BEEF], [V.LEATHER, 0, 2, 1]] },
  pig: { health: 10, xp: [1, 3], weight: 10, breed: [V.CARROT, V.POTATO, V.BEETROOT], drops: [[V.PORKCHOP, 1, 3, 1, V.COOKED_PORKCHOP]] },
  chicken: { health: 4, xp: [1, 3], weight: 10, breed: [V.WHEAT_SEEDS, V.MELON_SEEDS, V.PUMPKIN_SEEDS, V.BEETROOT_SEEDS], noFall: true, lays: true, drops: [[V.CHICKEN, 1, 1, 1, V.COOKED_CHICKEN], [V.FEATHER, 0, 2, 1]] },
  villager: { health: 20, village: true, trades: true, fleeSpeed: 2.4 },
  parrot: { drops: [[V.FEATHER, 1, 2, 1]], xp: [1, 3] },
};
const VANILLA_SPECIES = {};
for (const [k, c] of Object.entries(VANILLA_CHANGES)) VANILLA_SPECIES[k] = { ...SPECIES[k], ...c };

// A kind's spec in this world.
export function specOf(kind) {
  return (isVanilla() && VANILLA_SPECIES[kind]) || SPECIES[kind];
}

// A baby's spec: half the size, quicker (its parents' spec otherwise).
const babySpecs = new Map();
function babySpec(spec) {
  let b = babySpecs.get(spec);
  if (!b) {
    b = { ...spec, r: spec.r * 0.5, h: spec.h * 0.5, eye: spec.eye * 0.55, xp: null, baby: true, adult: spec };
    if (spec.hostile) {
      b.speed = spec.speed * 1.5;
      b.chaseSpeed = spec.chaseSpeed * 1.5;
      b.xp = [12, 12]; // (a baby zombie: vanilla's 12)
    } else b.drops = [];
    babySpecs.set(spec, b);
  }
  return b;
}

// Vanilla spawn weights: the night's monsters (zombies have their own rate
// and cap, the Mobs settings, in both worlds), the grass's animals.
const VANILLA_HOSTILES = [["skeleton", 100], ["spider", 100], ["creeper", 100], ["enderman", 10], ["witch", 5]];
const VANILLA_ANIMALS = [["sheep", 12], ["pig", 10], ["chicken", 10], ["cow", 8]];
const VANILLA_ANIMALS_FOREST = [...VANILLA_ANIMALS, ["wolf", 5]];
const VANILLA_ANIMALS_TAIGA = [["sheep", 12], ["pig", 10], ["chicken", 10], ["cow", 8], ["wolf", 8]];
const VANILLA_MAX_HOSTILE = 20; // per player (vanilla's 70 covers a far bigger area than the game keeps loaded)
const VANILLA_MAX_PASSIVE = 16;
const VANILLA_MAX_TOTAL = 56;
// Sheep colours (vanilla's odds: mostly white, a few grey, black or brown,
// very rarely pink); wool block ids by colour (mob-models.js WOOL_COLORS order).
const SHEEP_ODDS = [[0, 81.836], [7, 5], [8, 5], [15, 5], [12, 3], [6, 0.164]];
const WOOL_IDS = [BLOCK.WOOL, V.ORANGE_WOOL, V.MAGENTA_WOOL, V.LIGHT_BLUE_WOOL, V.YELLOW_WOOL, V.LIME_WOOL, V.PINK_WOOL, V.GRAY_WOOL, V.LIGHT_GRAY_WOOL, V.CYAN_WOOL, V.PURPLE_WOOL, V.BLUE_WOOL, V.BROWN_WOOL, V.GREEN_WOOL, V.RED_WOOL, V.BLACK_WOOL];
const woolOf = (c) => (isValidItem(WOOL_IDS[c]) ? WOOL_IDS[c] : BLOCK.WOOL);
// What each meat heals a tame wolf (vanilla: its food points).
const MEAT_HEAL = { [V.BEEF]: 3, [V.COOKED_BEEF]: 8, [V.PORKCHOP]: 3, [V.COOKED_PORKCHOP]: 8, [V.CHICKEN]: 2, [V.COOKED_CHICKEN]: 6, [V.MUTTON]: 2, [V.COOKED_MUTTON]: 6, [V.ROTTEN_FLESH]: 4, [ITEM.RAW_MEAT]: 3, [ITEM.COOKED_MEAT]: 8 };
const WOLF_TAME_HEALTH = 20;
const LOVE_TIME = 30; // seconds in love (vanilla 600 ticks)
const BREED_COOLDOWN = 300; // seconds before a parent breeds again (vanilla 6000 ticks)
const GROW_TIME = 1200; // a baby grows up in 20 minutes (vanilla 24000 ticks)
const CREEPER_FUSE = 1.5;
const CREEPER_RADIUS = 4; // (the blast's size in effects.js units: about vanilla's power 3 crater and reach)
const ENDERMAN_HOLDABLE = new Set([BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, BLOCK.GRAVEL, BLOCK.FLOWER_RED, BLOCK.FLOWER_YELLOW, BLOCK.CACTUS, V.PUMPKIN, V.MELON, V.CLAY, V.RED_SAND, V.PODZOL, V.MYCELIUM, V.COARSE_DIRT, V.BROWN_MUSHROOM, V.RED_MUSHROOM, V.TNT]);
// Splash potions' colours (vanilla's).
const POTION_COLORS = { harming: 0x6a1a18, poison: 0x4e9331, slowness: 0x5a6c81 };
// The vanilla mobs' voices (the format of audio.js's own: a voice is a
// sawtooth through formants, `noise` a filtered burst), played by _voice.
const VANILLA_VOICES = {
  creeper: {
    hiss: [{ noise: { type: "bandpass", f: 3600, q: 0.7, d: 1.4, v: 0.32, attack: 0.25 } }],
    hurt: [{ noise: { type: "bandpass", f: 2400, q: 1.2, d: 0.25, v: 0.3 } }],
    death: [{ noise: { type: "bandpass", f: 1800, q: 1, d: 0.5, v: 0.3 } }],
  },
  enderman: {
    idle: [{ f0: 220, f1: 140, d: 0.6, v: 0.16, formants: [[500, 4, 1], [1300, 6, 0.4]], vib: 0.3, breath: 0.3 }],
    scream: [{ f0: 900, f1: 1400, d: 0.9, v: 0.26, formants: [[1600, 3, 1], [3200, 4, 0.5]], vib: 0.25, breath: 0.4 }],
    hurt: [{ f0: 500, f1: 300, d: 0.3, v: 0.24, formants: [[900, 4, 1]], vib: 0.3, breath: 0.3 }],
    attack: [{ f0: 520, f1: 340, d: 0.25, v: 0.22, formants: [[900, 4, 1]], vib: 0.3, breath: 0.3 }],
    death: [{ f0: 400, f1: 90, d: 1.4, v: 0.26, formants: [[800, 4, 1], [1700, 5, 0.4]], vib: 0.35, breath: 0.4 }],
  },
  slime: {
    hop: [{ noise: { type: "lowpass", f: 520, q: 2, d: 0.12, v: 0.3, fEnd: 200 } }],
    attack: [{ noise: { type: "lowpass", f: 600, q: 2, d: 0.14, v: 0.32, fEnd: 220 } }],
    hurt: [{ noise: { type: "bandpass", f: 700, q: 2, d: 0.15, v: 0.3 } }],
    death: [{ noise: { type: "lowpass", f: 600, q: 2, d: 0.3, v: 0.3, fEnd: 150 } }],
  },
  witch: {
    idle: [0, 0.15, 0.3].map((delay) => ({ f0: 520, f1: 420, d: 0.12, v: 0.17, formants: [[1100, 6, 1], [2500, 7, 0.4]], breath: 0.3, delay })),
    hurt: [{ f0: 600, f1: 420, d: 0.25, v: 0.22, formants: [[1200, 5, 1]], breath: 0.3 }],
    death: [{ f0: 560, f1: 160, d: 0.9, v: 0.24, formants: [[1100, 5, 1], [2400, 6, 0.4]], breath: 0.3 }],
    throw: [{ noise: { type: "bandpass", f: 1500, q: 1, d: 0.12, v: 0.12 } }],
    drink: [{ noise: { type: "lowpass", f: 700, q: 3, d: 0.08, v: 0.2, n: 4, spread: 0.12 } }],
  },
  sheep: {
    idle: [{ f0: 380, f1: 330, d: 0.55, v: 0.24, formants: [[700, 5, 1], [1500, 6, 0.5]], vib: 0.18, breath: 0.2 }],
    hurt: [{ f0: 480, f1: 360, d: 0.3, v: 0.26, formants: [[750, 5, 1]], vib: 0.2, breath: 0.25 }],
    death: [{ f0: 420, f1: 200, d: 0.6, v: 0.26, formants: [[700, 5, 1]], vib: 0.2, breath: 0.3 }],
  },
  iron_golem: {
    hurt: [{ noise: { type: "bandpass", f: 900, q: 6, d: 0.3, v: 0.3 } }, { noise: { type: "bandpass", f: 2300, q: 8, d: 0.4, v: 0.14 } }],
    attack: [{ noise: { type: "lowpass", f: 300, q: 1, d: 0.25, v: 0.4, fEnd: 80 } }],
    death: [{ noise: { type: "lowpass", f: 400, q: 2, d: 0.8, v: 0.35, fEnd: 100 } }],
  },
  villager: {
    idle: [{ f0: 160, f1: 130, d: 0.35, v: 0.2, formants: [[450, 5, 1], [1100, 6, 0.4]], breath: 0.15 }],
    hurt: [{ f0: 220, f1: 160, d: 0.25, v: 0.22, formants: [[500, 5, 1]], breath: 0.2 }],
    death: [{ f0: 200, f1: 90, d: 0.7, v: 0.22, formants: [[450, 5, 1]], breath: 0.25 }],
  },
  cod: { hurt: [{ noise: { type: "bandpass", f: 900, q: 2, d: 0.08, v: 0.2, n: 2, spread: 0.1 } }] },
  salmon: { hurt: [{ noise: { type: "bandpass", f: 800, q: 2, d: 0.08, v: 0.2, n: 2, spread: 0.1 } }] },
};
const r2 = (v) => Math.round(v * 100) / 100;
// (Fences and walls: a 1.5-tall collision box no mob can jump.)
const TALL = new Uint8Array(COLLISION_BOXES.length);
for (let id = 0; id < COLLISION_BOXES.length; id++) if (COLLISION_BOXES[id]?.some((b) => b[4] > 1)) TALL[id] = 1;

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

const PASSIVE_KINDS = Object.keys(SPECIES).filter((k) => !SPECIES[k].hostile && !SPECIES[k].flies && k !== "villager" && !SPECIES[k].vanilla);
const HOSTILE_KINDS = Object.keys(SPECIES).filter((k) => SPECIES[k].hostile && !SPECIES[k].vanilla);
const OTHER_HOSTILE_KINDS = HOSTILE_KINDS.filter((k) => k !== "zombie" && !SPECIES[k].special);
const FLYER_KINDS = Object.keys(SPECIES).filter((k) => SPECIES[k].flies);
const VILLAGERS_PER_VILLAGE = 5;
const MAX_FLYERS = 10;
const MAX_TOTAL_MOBS = 34;
const VILLAGE_SEARCH_RADIUS = 60;

// Seconds for a full-strength swing with the given tool.
function attackCooldown(tool) {
  if (!tool) return 0.35;
  if (tool.type === "sword") return 0.6;
  if (tool.type === "axe") return 0.9;
  return 0.8;
}

// A kind picked by weight from [[kind, weight], ...].
function pickWeighted(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [k, w] of list) if ((r -= w) <= 0) return k;
  return list[0][0];
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
    // Multiplayer (js/net/entities.js). Host: `targets()` lists every player
    // (this one and Player-like stand-ins for the others): hostile creatures
    // hunt the nearest one and spawn around all of them. Guest: hostile
    // creatures are the host's (puppets: `m.net`), drawn from its states and
    // never thought for here; hits on them go to the host as claims.
    this.localPlayer = player;
    this.targets = null; // () => [player-like]
    this.puppets = false;
    this.onPuppetHit = null; // (mob, amount, dir, knockback, byPlayer) => void
    this.onPuppetBeam = null; // (mob, lift, topY, beamTop) => void: a guest's beam on a host creature
    this.onRemoteAbduct = null; // (mob, pid) => void: host: a creature pulled aboard another player's ship
    this.onPuppetUpdate = null; // (mob, dt) => void
    this.keepDrops = null; // (mob) => bool: drops for this player (host: not for another player's kill)
    this._tmp = new THREE.Vector3();
    this._flashColor = new THREE.Color();
    this._c0 = new THREE.Color();
    this._c1 = new THREE.Color();
    // (particles keep their colours by reference, so each effect has its own)
    this._smokeGrey = new THREE.Color(0.85, 0.85, 0.85);
    this._smokeGrey2 = new THREE.Color(0.5, 0.5, 0.5);
    this._critC = new THREE.Color(3, 2.4, 0.9);
    this._burnC = new THREE.Color(3.2, 1.2, 0.25);
    this._burnC2 = new THREE.Color(0.6, 0.12, 0.02);
    // (Round 11) A Survival world's mobs: witches' potions in flight, the
    // players the AI looks at this frame, the creatures kept in the save.
    this.potions = [];
    this._look = new THREE.Vector3();
    this._targetList = [player];
    this._kept = [];
    this.inventory = null; // this player's (main.js): what they hold tempts animals; using creatures
    this.localPid = 1; // this player's id online (net/entities.js; 1: the host, or single player): a tame wolf's owner
    this.onTrade = null; // (session) => false if it can't open: a villager's trade screen (main.js, trading.js)
    this.tradeSession = null;
    this.onRemoteXp = null; // (pid, amount, pos) => void: online (host), another player's breeding experience
    this.onPuppetUse = null; // (mob, action) => void: a guest's shears, food, iron on the host's creature
    this.onPuppetTrade = null; // (mob, index) => void: a guest's trade, asked of the host
    this.onPuppetTradeQuery = null; // (mob) => void: a guest asks the host for a villager's offers
    this.onPuppetSpawn = null; // (kind, x, y, z, baby, variant) => void: a guest's egg or spawn egg
    // Content code (a thrown egg, a spawn egg: js/content/) asks for creatures here.
    LIB.spawnMob = (kind, x, y, z, opts) => this.requestSpawn(kind, x, y, z, opts);
  }

  get count() {
    return this.mobs.length;
  }

  countOf(hostile) {
    let n = 0;
    // (Guards and aliens are special: they do not take up the skeleton/spider cap.)
    for (const m of this.mobs) if (!m.dead && m.spec.hostile === hostile && m.kind !== "zombie" && !m.spec.special) n++;
    return n;
  }

  // Land animals only, for the passive cap (flyers, villagers and golems have caps of their own).
  countAnimals() {
    let n = 0;
    for (const m of this.mobs) if (!m.dead && !m.spec.hostile && !m.spec.flies && m.kind !== "villager" && !m.spec.village) n++;
    return n;
  }

  // kind "alien" counts every kind of alien.
  countKind(kind) {
    let n = 0;
    for (const m of this.mobs) if (!m.dead && (m.kind === kind || (kind === "alien" && m.spec.alien))) n++;
    return n;
  }

  // ---------- Spawning ----------

  // (Round 11) variant: a sheep's wool colour, a villager's profession + 1
  // (picked here when not given, in a Survival world); baby: a young animal
  // (or a baby zombie).
  spawn(kind, x, y, z, { wet = false, variant, baby = false } = {}) {
    let spec = specOf(kind);
    if (!spec) return null;
    // (Round 9) A land creature never comes into being in water, whoever asks
    // (the spawners, the missions, single player or the host online; a
    // guest's copies follow the host's). Fish swim; a crew climbing out of a
    // wreck in the sea is the one exception (wet).
    if (!wet && !spec.flies && !this.puppets && IS_WET[this.world.getBlock(Math.floor(x), Math.floor(y + 0.05), Math.floor(z))]) return null;
    if (variant === undefined) variant = this._pickVariant(kind);
    variant = Math.max(0, Math.min(15, variant | 0));
    if (kind === "villager" && !isVanilla()) variant = 0;
    if (baby) spec = babySpec(spec);
    const model = createMobModel(kind, variant);
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
      // (Online the host's hostile creatures are a little tougher for a bigger group.)
      health: spec.health * (kind === "zombie" ? this.zombies.health : 1) * (spec.hostile ? this.groupHealth ?? 1 : 1),
      maxHealth: spec.health * (kind === "zombie" ? this.zombies.health : 1) * (spec.hostile ? this.groupHealth ?? 1 : 1),
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
      // (Round 11) Vanilla state: its colour or trade, a baby's time to grow
      // up, love (breeding), a creeper's fuse, a shorn sheep, a block held.
      variant,
      baby: !!baby,
      growT: baby ? GROW_TIME : 0,
      loveT: 0,
      breedCd: 0,
      fuse: 0,
      sheared: false,
      carry: 0,
      fireT: 0,
    };
    if (spec.lays) m.eggT = 300 + Math.random() * 300;
    if (m.baby) this._babyLook(m);
    bindEntityLight(model.root, () => m.light);
    this.group.add(model.root);
    this.mobs.push(m);
    this._place(m);
    return m;
  }

  // A new mob's look when nobody chose: a sheep's colour by vanilla's odds,
  // a Survival villager's trade (a nitwit now and then).
  _pickVariant(kind) {
    if (kind === "sheep") {
      let r = Math.random() * 100;
      for (const [c, w] of SHEEP_ODDS) if ((r -= w) <= 0) return c;
      return 0;
    }
    if (kind === "villager" && isVanilla()) return 1 + (Math.random() < 0.05 ? NITWIT : Math.floor(Math.random() * NITWIT));
    return 0;
  }

  // A baby's shape (half the size, a big head), or the grown-up's again.
  _babyLook(m) {
    const model = m.model;
    model.tilt.scale.setScalar(model.scale * (m.baby ? 0.5 : 1));
    if (model.parts.head && !m.spec.hostile) model.parts.head.scale.setScalar(m.baby ? 1.45 : 1);
  }

  // A baby grows up (or, online, a guest's copy turns into one).
  setBaby(m, baby) {
    if (m.baby === !!baby) return;
    m.baby = !!baby;
    const adult = m.spec.adult || m.spec;
    m.spec = m.baby ? babySpec(adult) : adult;
    m.growT = m.baby ? GROW_TIME : 0;
    this._babyLook(m);
  }

  // (Round 8) A mission leader visibly carries the weapon it will drop: the
  // item's own model slung across its back (gone when it dies: it drops).
  setCarry(m, id) {
    if (m.carryMesh) {
      m.carryMesh.parent?.remove(m.carryMesh);
      m.carryMesh = null;
    }
    m.carryId = id || 0;
    const model = id ? itemModel(id) : null;
    const body = m.model.parts.body;
    if (!model || !body) return;
    if (!this._carryMat) this._carryMat = createEntityMaterial("color");
    const mesh = new THREE.Mesh(model.geometry, this._carryMat);
    mesh.castShadow = true;
    // Barrel up over the shoulder, diagonally across the back.
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    const sling = new THREE.Group();
    sling.add(mesh);
    sling.rotation.set(0, Math.PI, 0.7);
    sling.scale.setScalar(model.gun === "railgun" ? 1.15 : 0.95);
    const geo = body.children[0]?.geometry;
    geo?.computeBoundingBox?.();
    const bb = geo?.boundingBox;
    sling.position.set(0, bb ? (bb.min.y + bb.max.y) / 2 : 0.35, bb ? bb.min.z - 0.07 : -0.25);
    body.add(sling);
    bindEntityLight(mesh, () => m.light);
    m.carryMesh = sling;
  }

  _remove(i) {
    const m = this.mobs[i];
    this.group.remove(m.model.root);
    this.mobs.splice(i, 1);
    m.removed = true; // (for anything still holding on to it: a prey, a mate, a trade)
  }

  clear() {
    while (this.mobs.length) this._remove(this.mobs.length - 1);
  }

  _chunkReady(x, z) {
    const c = this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
    // (Online the host keeps ground around the other players generated but
    // not drawn: creatures can live there too.)
    return !!c && (c.meshed || (!!this.targets && this.player !== this.localPlayer));
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

  // How far out to spawn, at most: around another player (online, the host),
  // within the ground kept for them.
  _reach(max) {
    return this.targets && this.player !== this.localPlayer ? Math.min(max, REMOTE_REACH) : max;
  }

  _trySpawnPassive(minDist, maxDist, room = MAX_PASSIVE - this.countAnimals()) {
    if (room <= 0) return 0;
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * (this._reach(maxDist) - minDist);
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return 0;
    const top = this.world.surfaceY(x, z);
    if (top < 0 || this.world.getBlock(x, top, z) !== BLOCK.GRASS) return 0;
    if (this.world.lightAt(x + 0.5, top + 1.5, z + 0.5).sky < 10) return 0;
    const kind = this._pickPassive(x, z);
    // (A Survival world's herds: vanilla's up to four.)
    const herd = kind === "mossback" ? 1 + (Math.random() < 0.3 ? 1 : 0) : 2 + Math.floor(Math.random() * (isVanilla() ? 3 : 2));
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

  _pickPassive(x, z) {
    if (isVanilla()) {
      // (Wolves in forests and the taiga, vanilla's packs.)
      const b = x === undefined ? -1 : this.world.terrain?.biomeAt?.(x, z);
      if (b === BIOME.FOREST || b === BIOME.TAIGA || b === BIOME.SNOWY_TAIGA || b === BIOME.DARK_FOREST) return pickWeighted(b === BIOME.FOREST ? VANILLA_ANIMALS_FOREST : VANILLA_ANIMALS_TAIGA);
      return pickWeighted(VANILLA_ANIMALS);
    }
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
    const d = 28 + Math.random() * (this._reach(118) - 28);
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return false;
    const top = this.world.surfaceY(x, z);
    if (top < 0) return false;
    const anyLight = kind === "zombie" && this.zombies.daylight;
    const vanilla = isVanilla();
    // Start from the surface or from a random depth, then look for a floor.
    let y = Math.random() < 0.5 ? top + 1 : 2 + Math.floor(Math.random() * Math.max(1, top - 3));
    for (let k = 0; k < 12 && y > 1; k++, y--) {
      const below = this.world.getBlock(x, y - 1, z);
      if (!IS_SOLID[below] || IS_LEAVES[below]) continue;
      // (A Survival world: only on a full, opaque block, as in vanilla: not
      // glass, a slab, a fence, leaves.)
      if (vanilla && (!IS_OPAQUE[below] || COLLISION_BOXES[below])) continue;
      if (!this._freeAt(x, y, z, SPECIES[kind].h)) continue;
      if (!anyLight && !this._darkEnough(x, y, z)) return false;
      // (Vanilla: one zombie in twenty is a baby.)
      this.spawn(kind, x + 0.5, y, z + 0.5, { baby: vanilla && kind === "zombie" && Math.random() < 0.05 });
      return true;
    }
    return false;
  }

  // Dark enough for a monster: in a Missions world the old rule (light 4 or
  // less); in a Survival world vanilla's (no block light at all, and the
  // sky's light, dimmed by night, no more than a random 0-7).
  _darkEnough(x, y, z) {
    if (!isVanilla()) return this._effectiveLight(x, y, z) <= 4;
    const l = this.world.lightAt(x + 0.5, y + 0.5, z + 0.5);
    if (l.block > 0) return false;
    return l.sky * (0.2 + 0.8 * this.sky.daylight) <= Math.floor(Math.random() * 8);
  }

  // (Round 11) Slimes: in swamps on the surface at night, and in the dark
  // deep down in a "slime chunk" (one chunk in ten, fixed by the world's
  // seed), any time. Big, medium or small, as likely each.
  _trySpawnSlime() {
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * (this._reach(90) - 24);
    const x = Math.floor(p.x + Math.cos(a) * d);
    const z = Math.floor(p.z + Math.sin(a) * d);
    if (!this._chunkReady(x, z)) return false;
    const top = this.world.surfaceY(x, z);
    if (top < 0) return false;
    const kind = ["slime", "slime_medium", "slime_small"][Math.floor(Math.random() * 3)];
    const h = SPECIES[kind].h;
    const swamp = this.world.terrain?.biomeAt?.(x, z) === BIOME.SWAMP;
    if (swamp && top >= SEA_LEVEL - 2 && top <= SEA_LEVEL + 20) {
      if (!IS_OPAQUE[this.world.getBlock(x, top, z)] || !this._freeAt(x, top + 1, z, h) || !this._darkEnough(x, top + 1, z)) return false;
      return !!this.spawn(kind, x + 0.5, top + 1, z + 0.5);
    }
    if (!this._slimeChunk(x >> 4, z >> 4)) return false;
    for (let y = Math.min(top - 4, SEA_LEVEL - 4), k = 0; y > 1 && k < 24; y--, k++) {
      if (!IS_OPAQUE[this.world.getBlock(x, y - 1, z)] || !this._freeAt(x, y, z, h)) continue;
      return !!this.spawn(kind, x + 0.5, y, z + 0.5);
    }
    return false;
  }

  _slimeChunk(cx, cz) {
    let h = Math.imul(cx, 0x4c1906) ^ Math.imul(cz, 0x5ac0db) ^ Math.imul((this.world.seed ?? 0) | 0, 0x3ad8025f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) % 10 === 0;
  }

  // If the player is near a generated village, keep it populated with a
  // couple of villagers (walking around, original design, no combat AI).
  _trySpawnVillagers() {
    const terrain = this.world.terrain;
    const villages = terrain?.villages;
    if (!villages) return;
    const p = this.player.position;
    let village = villages.nearestVillage(p.x, p.z, VILLAGE_SEARCH_RADIUS);
    let radius = 34;
    let cap = VILLAGERS_PER_VILLAGE;
    let spread = 20;
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
    if (nearby >= cap && !(isVanilla() && !this.mobs.some((m) => !m.dead && m.kind === "iron_golem" && Math.hypot(m.pos.x - village.x, m.pos.z - village.z) < radius + 16))) return;
    const ang = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * spread;
    const sx = Math.floor(village.x + Math.cos(ang) * d);
    const sz = Math.floor(village.z + Math.sin(ang) * d);
    if (!this._chunkReady(sx, sz)) return;
    const top = this.world.surfaceY(sx, sz);
    // (Round 11) A Survival world's village has its iron golem too.
    const golem = isVanilla() && !this.mobs.some((m) => !m.dead && m.kind === "iron_golem" && Math.hypot(m.pos.x - village.x, m.pos.z - village.z) < radius + 16);
    const kind = golem ? "iron_golem" : "villager";
    if (top < 0 || !this._freeAt(sx, top + 1, sz, SPECIES[kind].h)) return;
    this.spawn(kind, sx + 0.5, top + 1, sz + 0.5);
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
    const vanilla = isVanilla();
    // (A Survival world: no butterflies; cod in the sea, salmon in rivers and cold water.)
    if ((above === BLOCK.FLOWER_RED || above === BLOCK.FLOWER_YELLOW) && !vanilla) {
      if (this.world.lightAt(x + 0.5, top + 2.5, z + 0.5).sky > 8) this.spawn("butterfly", x + 0.5, top + 2, z + 0.5);
      return;
    }
    if (above === BLOCK.WATER) {
      // Only in open water at least a couple of blocks deep. Fish move in
      // small schools rather than appearing one at a time.
      if (this.world.getBlock(x, top + 2, z) !== BLOCK.WATER) return;
      const room = MAX_FLYERS - this.mobs.filter((m) => !m.dead && m.spec.flies).length;
      const schoolSize = Math.min(room, 3 + Math.floor(Math.random() * 3));
      let kind = "fish";
      if (vanilla) {
        const b = this.world.terrain?.biomeAt?.(x, z);
        kind = b === BIOME.RIVER || b === BIOME.SNOWY_PLAINS || b === BIOME.SNOWY_TAIGA || b === BIOME.TAIGA ? "salmon" : "cod";
      }
      for (let i = 0; i < schoolSize; i++) {
        const fx = x + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
        const fz = z + (i === 0 ? 0 : Math.floor(Math.random() * 5) - 2);
        if (this.world.getBlock(fx, top + 1, fz) !== BLOCK.WATER || this.world.getBlock(fx, top + 2, fz) !== BLOCK.WATER) continue;
        this.spawn(kind, fx + 0.5, top + 1.5, fz + 0.5);
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
      // (Online, a guest's beam on one of the host's creatures: the host lifts
      // it, and tells this player when it is aboard. Round 9.)
      if (m.net) {
        if (!by) this.onPuppetBeam?.(m, lift, topY, beam.top);
        continue;
      }
      if (by) m.abductedBy = by;
      m.beamLift = lift;
      m.stagger = Math.max(m.stagger, 0.3);
      m.knock.x += (beam.top.x - m.pos.x) * 0.05;
      m.knock.z += (beam.top.z - m.pos.z) * 0.05;
      if (m.pos.y + m.spec.h >= topY) {
        took.push(m);
        this._abductFx(m);
        if (m.leaderDrop) this.onLeaderDown?.(m); // (its weapon is not lost with it)
        this._remove(i);
      }
    }
    return took;
  }

  // One step of a creature held by a UFO: it rises to the ship (drifting to
  // the middle of its beam) and disappears inside. If the ship is shot down,
  // or leaves, it disappears at once (never a fall). True while it is held.
  _abductStep(m, i, dt, drawDist, crowdDist) {
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
      // (Light and the crowd too: a far zombie, drawn in the crowd, was not drawn at all.)
      this._afterMove(m, drawDist, crowdDist);
    }
    if (gone || m.pos.y + m.spec.h >= under - 0.3) {
      this._abductFx(m);
      if (u && !gone) u.abductDone = true;
      if (m.leaderDrop && !m.net) this.onLeaderDown?.(m);
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
    if (this.puppets) return; // (a guest: the host trims its zombies and its erem removes them here)
    const p = this.player.position;
    const zombies = this.mobs.filter((m) => m.kind === "zombie" && !m.dead && !m.net).sort((a, b) => b.pos.distanceToSquared(p) - a.pos.distanceToSquared(p));
    for (let k = 0; k < zombies.length - this.zombies.max; k++) this._remove(this.mobs.indexOf(zombies[k]));
  }

  // Removes every creature of a kind (aliens, when mods are switched off).
  removeKind(kind) {
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].kind === kind || (kind === "alien" && this.mobs[i].spec.alien)) this._remove(i);
  }

  // (Round 11) A creature a player's item asks for (a thrown egg's chick, a
  // spawn egg): made here, or on a guest asked of the host (onPuppetSpawn).
  // Not the Missions world's special ones; no monster on Peaceful.
  requestSpawn(kind, x, y, z, { baby = false, variant } = {}) {
    const spec = Object.hasOwn(SPECIES, kind) ? SPECIES[kind] : null;
    if (!spec || spec.special || (spec.hostile && this.hostileSpawning === false)) return null;
    if (this.puppets) {
      this.onPuppetSpawn?.(kind, x, y, z, baby, variant);
      return null;
    }
    const m = this.spawn(kind, x, y, z, { baby, variant, wet: !!spec.flies });
    if (m && !spec.hostile) m.persist = true;
    return m;
  }

  // Removes every hostile creature at once (switching to Peaceful).
  removeHostiles() {
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].spec.hostile) this._remove(i);
  }

  _updateSpawning(dt) {
    // `spawning` and `hostileSpawning` are settings (creature spawning,
    // Peaceful difficulty); `enabled` is used by tests.
    if (!this.enabled || this.spawning === false) return;
    // Online, a guest's creatures are the host's (Round 8: animals and
    // villagers too); only the little ambient flyers (butterflies, parrots,
    // fish) are each player's own.
    if (this.puppets) {
      this._spawnTimer -= dt;
      if (this._spawnTimer > 0) return;
      this._spawnTimer = SPAWN_INTERVAL;
      if (Math.random() < 0.4) this._trySpawnFlyers();
      return;
    }
    if (!this._seeded && this._chunkReady(this.player.position.x, this.player.position.z)) {
      // Start the world with some animals around.
      this._seeded = true;
      for (let i = 0; i < 40 && this.countAnimals() < MAX_PASSIVE - 2; i++) this._trySpawnPassive(14, 50, MAX_PASSIVE - 2 - this.countAnimals());
    }
    if (isVanilla()) {
      this._updateSpawningVanilla(dt);
      return;
    }
    // Zombies: their own rate (a setting, up to an apocalypse) and cap.
    // (Online they spawn around every player, on the host only.)
    if (this.hostileSpawning !== false && this.zombies.spawnRate > 0 && !this.puppets) {
      this._zombieBudget = Math.min(8, this._zombieBudget + dt * ZOMBIE_ATTEMPTS_PER_SECOND * this.zombies.spawnRate);
      let zombies = -1;
      for (let tries = 0; this._zombieBudget >= 1 && tries < 6; tries++) {
        this._zombieBudget -= 1;
        if (zombies < 0) zombies = this.countKind("zombie");
        if (zombies >= this.zombies.max) {
          this._zombieBudget = 0;
          break;
        }
        if (this._aroundAnyone(() => this._trySpawnHostile("zombie"))) zombies++;
      }
    }
    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return;
    this._spawnTimer = SPAWN_INTERVAL;
    const zombieCount = this.countKind("zombie");
    if (this.mobs.length - zombieCount >= MAX_TOTAL_MOBS) return; // an overall cap on top of the per-category ones
    const passiveCap = MAX_PASSIVE * (this.targets ? Math.min(3, this.targets().length) : 1);
    if (this.countAnimals() < passiveCap && Math.random() < 0.3) this._aroundAnyone(() => this._trySpawnPassive(30, 80, passiveCap - this.countAnimals()));
    if (this.countOf(true) < MAX_HOSTILE * (this.targets ? Math.min(3, this.targets().length) : 1) && this.hostileSpawning !== false && !this.puppets && Math.random() < 0.67) this._aroundAnyone(() => this._trySpawnHostile());
    this._aroundAnyone(() => this._trySpawnVillagers());
    if (Math.random() < 0.4) this._trySpawnFlyers();
  }

  // (Round 11) A Survival world: zombies at their own rate and cap (the Mobs
  // settings, as in a Missions world), the other monsters by vanilla's
  // weights, slimes, herds of animals, villagers and their golems, fish.
  // Farm animals (kept: bred, fed, shorn) don't count against the caps.
  _updateSpawningVanilla(dt) {
    const hostiles = this.hostileSpawning !== false;
    if (hostiles && this.zombies.spawnRate > 0) {
      this._zombieBudget = Math.min(8, this._zombieBudget + dt * ZOMBIE_ATTEMPTS_PER_SECOND * this.zombies.spawnRate);
      let zombies = -1;
      for (let tries = 0; this._zombieBudget >= 1 && tries < 6; tries++) {
        this._zombieBudget -= 1;
        if (zombies < 0) zombies = this.countKind("zombie");
        if (zombies >= this.zombies.max) {
          this._zombieBudget = 0;
          break;
        }
        if (this._aroundAnyone(() => this._trySpawnHostile("zombie"))) zombies++;
      }
    }
    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return;
    this._spawnTimer = SPAWN_INTERVAL;
    const players = this.targets ? Math.min(3, this.targets().length) : 1;
    let total = 0;
    for (const m of this.mobs) if (!m.persist && !m.spec.flies && m.kind !== "zombie") total++;
    if (total >= VANILLA_MAX_TOTAL * Math.min(2, players)) return;
    const passiveCap = VANILLA_MAX_PASSIVE * players;
    if (this.countAnimals() - this._keptAnimals() < passiveCap && Math.random() < 0.3) this._aroundAnyone(() => this._trySpawnPassive(30, 80, passiveCap - this.countAnimals() + this._keptAnimals()));
    if (hostiles) {
      const cap = VANILLA_MAX_HOSTILE * players;
      for (let k = 0; k < 2; k++) if (this.countOf(true) < cap) this._aroundAnyone(() => this._trySpawnHostile(pickWeighted(VANILLA_HOSTILES)));
      if (Math.random() < 0.2 && this.countOf(true) < cap) this._aroundAnyone(() => this._trySpawnSlime());
    }
    this._aroundAnyone(() => this._trySpawnVillagers());
    if (Math.random() < 0.4) this._trySpawnFlyers();
  }

  _keptAnimals() {
    let n = 0;
    for (const m of this.mobs) if (m.persist && !m.dead && !m.spec.hostile && !m.spec.flies) n++;
    return n;
  }

  // Runs fn with `this.player` set to a random player who is in the game
  // (online: hostile creatures spawn around every player, not just this one).
  _aroundAnyone(fn) {
    const list = this.targets ? this.targets().filter((t) => !t.dead && !t.vehicle) : null;
    if (!list || !list.length) return fn();
    this.player = list[Math.floor(Math.random() * list.length)];
    try {
      return fn();
    } finally {
      this.player = this.localPlayer;
    }
  }

  // The player a hostile creature goes for: the nearest one in the game.
  _nearestTarget(m, list) {
    let best = this.localPlayer;
    let bestD = Infinity;
    for (const t of list) {
      const d = Math.hypot(t.position.x - m.pos.x, t.position.z - m.pos.z) + (t.dead ? 1e6 : 0) + (t.vehicle ? 1e5 : 0);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
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
    // (Round 11) A fence or a wall can't be jumped.
    if (TALL[w.getBlock(bx, by, bz)] || TALL[w.getBlock(bx, by - 1, bz)]) return "wall";
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
    // (Round 11) The vanilla mobs with a mind of their own (creepers,
    // endermen, slimes, witches, iron golems).
    if (m.spec.brain) return this._brain(m, dt, dist);
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
    let preyChase = false; // (Round 11) going for another creature

    if (m.spec.hostile) {
      const dy = p.y - m.pos.y;
      // A crew that has just climbed out of a wreck (m.aggro) hunts the
      // player from wherever they are, at any height.
      const sight = m.aggro ? Math.max(m.spec.sight, 160) : m.spec.sight;
      const vertical = m.aggro ? 60 : m.spec.alien || m.spec.sentry ? 30 : 10;
      // (A calm crew member looks around and leaves the player be for now.)
      let willing = this._canTarget(m) && !(m.calmT > 0);
      // A posted guard only fights when alerted (the player in his zone, or
      // someone shot at him or his mates); a spider is neutral in daylight
      // unless provoked (a hit, or being in the dark: night, caves).
      if (m.spec.sentry) {
        const z = m.zone;
        if (z && !this.player.dead && !this.player.creative && Math.hypot(p.x - z.x, p.z - z.z) < z.r && Math.abs(p.y - m.pos.y) < 40) {
          if (!m.alerted) this.alarm(m, 60, this.player);
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
      // (Round 11) No player to go for: another creature (a zombie's villager,
      // or whatever hurt it: an iron golem).
      if (!ai.target && !m.spec.ranged) {
        const prey = this._prey(m, dt);
        if (prey) {
          const px = prey.pos.x - m.pos.x;
          const pz = prey.pos.z - m.pos.z;
          const pd = Math.hypot(px, pz) || 1;
          goalX = px / pd;
          goalZ = pz / pd;
          speed = m.spec.chaseSpeed;
          preyChase = true;
          if (m.stagger <= 0 && pd < m.spec.r + prey.spec.r + 0.8 && Math.abs(prey.pos.y - m.pos.y) < 1.6 && m.attackCooldown <= 0) this._meleeMob(m, prey, m.spec.damage);
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
        const a = Math.random() * Math.PI * 2;
        ai.dirX = Math.sin(a);
        ai.dirZ = Math.cos(a);
      }
      lookAtPlayer = distH < 12;
    } else if (!ai.target && !preyChase) {
      // (Round 11) A Survival world's animals and villagers: tempted by food,
      // courting, following a parent, fleeing a zombie, trading.
      const want = m.spec.breed || m.spec.village ? this._animalGoal(m, dt) : null;
      if (want) {
        goalX = want.x;
        goalZ = want.z;
        speed = want.speed;
        lookAtPlayer = want.look;
      } else if (ai.state === "flee" && ai.timer > 0) {
        // Run away from the player (or what scared it), with a little zig-zag.
        const fx = ai.fleeFrom ? ai.fleeFrom.x - m.pos.x : dx;
        const fz = ai.fleeFrom ? ai.fleeFrom.z - m.pos.z : dz;
        const away = Math.atan2(-fx, -fz) + Math.sin(this.time * 3 + m.id) * 0.5;
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
    // (A guard standing watch turns to look the way he picked.)
    if (speed === 0 && !ai.target && m.spec.sentry && m.post) moveYaw = Math.atan2(ai.dirX, ai.dirZ);
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

  // ---------- (Round 11) The vanilla mobs' own minds ----------

  _brain(m, dt, dist) {
    const ai = m.ai;
    ai.timer -= dt;
    ai.detour = Math.max(0, ai.detour - dt);
    m.angerT = Math.max(0, (m.angerT ?? 0) - dt);
    switch (m.spec.brain) {
      case "creeper":
        return this._brainCreeper(m, dt, dist);
      case "enderman":
        return this._brainEnderman(m, dt, dist);
      case "slime":
        return this._brainSlime(m, dt, dist);
      case "witch":
        return this._brainWitch(m, dt, dist);
      case "golem":
        return this._brainGolem(m, dt, dist);
      case "wolf":
        return this._brainWolf(m, dt, dist);
    }
    return this._wander(m, dt, dist);
  }

  // Walks toward direction (gx, gz) at `speed` (steering round walls, up
  // steps, out of water, as _think does), turning the body that way, or
  // toward `look` (a point; `face`: the body too). Returns what _physics takes.
  _go(m, dt, dist, gx, gz, speed, look = null, face = false) {
    let jump = false;
    if (speed > 0 && dist <= FAR_AI_DISTANCE) {
      const s = this._steer(m, gx, gz);
      if (s) {
        gx = s.x;
        gz = s.z;
        jump = s.jump;
      } else {
        speed = 0;
        if (m.ai.state === "wander") m.ai.timer = 0;
      }
    }
    if (m.inWater && speed > 0) jump = jump || m.blocked;
    let yaw = speed > 0 ? Math.atan2(gx, gz) : m.yaw;
    let headYaw = 0;
    let headPitch = 0;
    if (look) {
      const lx = look.x - m.pos.x;
      const lz = look.z - m.pos.z;
      const toward = Math.atan2(lx, lz);
      if (face) yaw = toward;
      headYaw = THREE.MathUtils.clamp(angleDiff(toward, m.yaw), -1.1, 1.1);
      headPitch = THREE.MathUtils.clamp(Math.atan2(look.y - (m.pos.y + m.spec.eye), Math.max(0.5, Math.hypot(lx, lz))), -0.6, 0.6);
    }
    const turn = (face ? 9 : 6) * dt;
    m.yaw += THREE.MathUtils.clamp(angleDiff(yaw, m.yaw), -turn, turn);
    m.headYaw += (headYaw - m.headYaw) * Math.min(1, dt * 6);
    m.headPitch += (headPitch - m.headPitch) * Math.min(1, dt * 6);
    const w = m._want || (m._want = { x: 0, z: 0, speed: 0, jump: false });
    w.x = gx;
    w.z = gz;
    w.speed = speed;
    w.jump = jump;
    return w;
  }

  // Idling and wandering about, like any creature with nothing to do.
  _wander(m, dt, dist, speedScale = 1) {
    const ai = m.ai;
    if (ai.state === "wander" && ai.timer > 0) return this._go(m, dt, dist, ai.dirX, ai.dirZ, m.spec.speed * speedScale);
    if (!(ai.state === "idle" && ai.timer > 0)) {
      if (Math.random() < 0.55) {
        const a = Math.random() * Math.PI * 2;
        ai.state = "wander";
        ai.dirX = Math.sin(a);
        ai.dirZ = Math.cos(a);
        ai.timer = 2 + Math.random() * 4;
      } else {
        ai.state = "idle";
        ai.timer = 2 + Math.random() * 5;
      }
    }
    return this._go(m, dt, dist, 0, 0, 0);
  }

  // Where a player's eyes are (no new vector: the AI asks every frame).
  _eyeOf(t) {
    return this._look.set(t.position.x, t.position.y + 1.6, t.position.z);
  }

  // A player this creature will go for: alive, not in Creative, within
  // `range` and 10 blocks up or down; or null.
  _foeInRange(m, t, range) {
    if (!t || t.dead || t.gone || (t.creative && !m.spec.alien)) return null;
    const p = t.position;
    if (Math.abs(p.y - m.pos.y) > 10 || Math.hypot(p.x - m.pos.x, p.z - m.pos.z) > range) return null;
    return t;
  }

  // A blow at player `t` (the creeper's cousins: an enderman, a golem).
  _hitPlayer(m, t, dmg, lift = 4, push = 6) {
    m.attackCooldown = 1.0;
    m.attack = 0;
    const dx = t.position.x - m.pos.x;
    const dz = t.position.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (t.damage(dmg, m.spec.brain === "slime" ? "slime" : meleeCause(m.kind), { from: m.pos })) {
      t.applyImpulse(this._tmp.set((dx / d) * push, lift, (dz / d) * push));
      if (t === this.localPlayer) this.onPlayerHurt?.(m);
      this._rallyWolves(this._pidOf(t), m);
    }
    this._voice(m, "attack");
  }

  // A creeper: walks up to the player and, within 3 blocks with a clear
  // view, hisses and swells for 1.5 s (stock-still) and bursts: a power-3
  // blast that breaks blocks and hurts by distance (effects.js explode). It
  // calms down again if the player gets more than 7 blocks away or out of sight.
  _brainCreeper(m, dt, dist) {
    const ai = m.ai;
    const t = this._canTarget(m) ? this._foeInRange(m, this.player, ai.target ? 24 : m.spec.sight) : null;
    ai.target = !!t;
    let swelling = false;
    if (t) {
      const p = t.position;
      const d3 = Math.hypot(p.x - m.pos.x, p.y + 0.9 - (m.pos.y + 0.9), p.z - m.pos.z);
      swelling = (m.fuse > 0 ? d3 < 7 : d3 < 3) && this._clearShot(m);
    }
    if (swelling) {
      if (m.fuse === 0) this._voice(m, "hiss");
      m.fuse += dt;
      if (m.fuse >= CREEPER_FUSE) {
        this._creeperBlast(m);
        return this._go(m, dt, dist, 0, 0, 0);
      }
      return this._go(m, dt, dist, 0, 0, 0, this._eyeOf(t), true);
    }
    m.fuse = Math.max(0, m.fuse - dt);
    if (t) {
      const dx = t.position.x - m.pos.x;
      const dz = t.position.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      return this._go(m, dt, dist, dx / d, dz / d, d > 1.2 ? m.spec.chaseSpeed : 0, this._eyeOf(t));
    }
    return this._wander(m, dt, dist);
  }

  _creeperBlast(m) {
    const at = new THREE.Vector3(m.pos.x, m.pos.y + 0.3, m.pos.z);
    // (Gone before the blast: it neither drops anything nor hurts itself.)
    m.dead = true;
    m.exploded = true;
    const i = this.mobs.indexOf(m);
    if (i >= 0) this._remove(i);
    const removed = this.effects.explode(at, { radius: CREEPER_RADIUS, source: "creeper" });
    if (Array.isArray(removed) && isVanilla()) this.blastDrops(removed, at, 1 / 3);
  }

  // What blown-up blocks leave (vanilla: each drops as if mined, one in
  // `chance`; a creeper's 1 in 3), gathered into a few stacks at `at`.
  blastDrops(removed, at, chance) {
    const counts = new Map();
    for (let i = 0; i < removed.length; i += 4) {
      if (Math.random() >= chance) continue;
      const id = removed[i + 3];
      const b = BLOCK_INFO[id];
      if (!b) continue;
      for (const [item, n] of blockDrops(id, { type: b.tool, tier: 99, speed: 1, damage: 1 })) counts.set(item, (counts.get(item) || 0) + n);
    }
    let stacks = 0;
    for (const [id, total] of counts) {
      for (let n = total; n > 0 && stacks < 24; stacks++) {
        const k = Math.min(n, maxStack(id));
        n -= k;
        this._drop(id, k, at);
      }
    }
  }

  // An enderman: neutral until a player looks it in the face (the crosshair
  // on its head, up to 64 blocks) or hits it; then it chases them fast,
  // teleporting closer when far. It dodges anything shot at it (teleports),
  // hates water, wanders off by teleport in daylight now and then, and
  // picks up and puts down blocks (grass, dirt, sand, flowers...).
  _brainEnderman(m, dt, dist) {
    const ai = m.ai;
    if ((ai.stareT = (ai.stareT ?? 0) - dt) <= 0) {
      ai.stareT = 0.25;
      for (const t of this._targetList) {
        if (t === m.foe && m.angerT > 0) continue;
        if (this._staresAt(t, m)) {
          if (!(m.angerT > 0)) this._voice(m, "scream");
          m.foe = t;
          m.angerT = 30;
          break;
        }
      }
    }
    if (m.inWater) {
      ai.wetT = (ai.wetT ?? 0) - dt;
      if (ai.wetT <= 0) {
        ai.wetT = 0.5;
        m.invulnerable = 0;
        this._hurt(m, 1, null, 0);
        if (!m.dead && Math.random() < 0.9) this._teleport(m);
      }
    }
    const foe = m.angerT > 0 ? this._foeInRange(m, m.foe, 64) : null;
    if (!foe) m.foe = null;
    ai.target = !!foe;
    if (foe) {
      const p = foe.position;
      const dx = p.x - m.pos.x;
      const dz = p.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      m.angerT = Math.max(m.angerT, d < 24 ? 30 : 0);
      // Far off: teleports toward them (vanilla: 16 blocks nearer, now and then).
      if (d > 16 && Math.random() < dt * 0.5) this._teleport(m, m.pos.x + (dx / d) * 16, m.pos.y + (p.y - m.pos.y) * 0.5, m.pos.z + (dz / d) * 16, 4);
      if (m.stagger <= 0 && d < m.spec.r + 1.1 && Math.abs(p.y - m.pos.y) < 2 && m.attackCooldown <= 0) this._hitPlayer(m, foe, m.spec.damage);
      return this._go(m, dt, dist, dx / d, dz / d, d > 0.9 ? m.spec.chaseSpeed : 0, this._eyeOf(foe));
    }
    // Daylight under the open sky: it wanders off by teleport now and then.
    if (this.sky.daylight > 0.6 && m.light.sky >= 13 && Math.random() < dt * 0.05) this._teleport(m);
    if (isVanilla()) this._endermanBlocks(m, dt);
    return this._wander(m, dt, dist);
  }

  // Whether player `t` is looking an enderman in the eyes (vanilla's test:
  // the view within 0.025 / distance of its head, and a clear line).
  _staresAt(t, m) {
    if (!t || t.dead || t.creative || t.vehicle || t.gone || typeof t.getForwardVector !== "function") return false;
    const p = t.position;
    const ex = p.x;
    const ey = p.y + 1.6;
    const ez = p.z;
    const vx = m.pos.x - ex;
    const vy = m.pos.y + m.spec.eye - ey;
    const vz = m.pos.z - ez;
    const len = Math.hypot(vx, vy, vz);
    if (len > 64 || len < 0.5) return false;
    const f = t.getForwardVector();
    if ((f.x * vx + f.y * vy + f.z * vz) / len <= 1 - 0.025 / len) return false;
    return this._rayClear(ex, ey, ez, m.pos.x, m.pos.y + m.spec.eye, m.pos.z);
  }

  // Takes a block from beside it (about once a second it tries; only the
  // kinds vanilla lets it hold) or, now and then, puts the one it holds down.
  _endermanBlocks(m, dt) {
    const w = this.world;
    if (!m.carry) {
      if (Math.random() >= dt) return;
      const x = Math.floor(m.pos.x + (Math.random() * 4 - 2));
      const y = Math.floor(m.pos.y + Math.random() * 3);
      const z = Math.floor(m.pos.z + (Math.random() * 4 - 2));
      const id = w.getBlock(x, y, z);
      if (!ENDERMAN_HOLDABLE.has(id) || !BLOCK_INFO[id]) return;
      // (Only a block it can see: one with open air on some side, not one deep in the ground.)
      if (IS_SOLID[w.getBlock(x + 1, y, z)] && IS_SOLID[w.getBlock(x - 1, y, z)] && IS_SOLID[w.getBlock(x, y + 1, z)] && IS_SOLID[w.getBlock(x, y, z + 1)] && IS_SOLID[w.getBlock(x, y, z - 1)]) return;
      if (w.setBlock(x, y, z, BLOCK.AIR)) m.carry = id;
      return;
    }
    if (Math.random() >= dt / 100) return;
    const x = Math.floor(m.pos.x + (Math.random() * 2 - 1));
    const y = Math.floor(m.pos.y + Math.random() * 2);
    const z = Math.floor(m.pos.z + (Math.random() * 2 - 1));
    const below = w.getBlock(x, y - 1, z);
    if (w.getBlock(x, y, z) !== BLOCK.AIR || !IS_OPAQUE[below] || below === BLOCK.BEDROCK || this.overlapsBlock(x, y, z)) return;
    // (Never into a player.)
    for (const t of this._targetList) {
      const p = t.position;
      if (p.x + 0.3 > x && p.x - 0.3 < x + 1 && p.z + 0.3 > z && p.z - 0.3 < z + 1 && p.y < y + 1 && p.y + 1.8 > y) return;
    }
    if (w.setBlock(x, y, z, m.carry)) m.carry = 0;
  }

  // Teleports to a random spot (around cx, cy, cz, `range` blocks each way)
  // where it can stand, out of water, in a flash of violet. True if it went.
  _teleport(m, cx = m.pos.x, cy = m.pos.y, cz = m.pos.z, range = 32, fx = true) {
    const w = this.world;
    for (let k = 0; k < 16; k++) {
      const x = Math.floor(cx + (Math.random() * 2 - 1) * range);
      const z = Math.floor(cz + (Math.random() * 2 - 1) * range);
      if (!this._chunkReady(x, z)) continue;
      let y = Math.max(2, Math.min(120, Math.floor(cy + (Math.random() * 2 - 1) * Math.min(range, 16))));
      for (let d = 0; d < 32 && y > 1 && !IS_SOLID[w.getBlock(x, y - 1, z)]; d++) y--;
      if (!IS_SOLID[w.getBlock(x, y - 1, z)] || !this._freeAt(x, y, z, m.spec.h)) continue;
      const heard = this._audioDist(m) < 30;
      if (fx) this._teleportFx(m);
      m.pos.set(x + 0.5, y, z + 0.5);
      m.vel.set(0, 0, 0);
      m.knock.set(0, 0, 0);
      m.peakY = null;
      m.ai.path = null;
      if (!fx) return true;
      this._teleportFx(m);
      if (heard || this._audioDist(m) < 30) this.audio?.playTeleport?.();
      return true;
    }
    return false;
  }

  _teleportFx(m) {
    const c = this._c1.setRGB(1.6, 0.4, 2.4);
    for (let k = 0; k < 16; k++) {
      this.effects.glow.spawn({ x: m.pos.x + (Math.random() - 0.5) * 0.6, y: m.pos.y + Math.random() * m.spec.h, z: m.pos.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 0.6, size0: 0.18, size1: 0.04, color0: c, drag: 2 });
    }
  }

  // A slime hops: it sits, gathers itself (0.5-1.5 s; a third of that when
  // it has a player in sight) and jumps toward them, or anywhere, moving
  // only in the air. Touching a player hurts (not the small ones).
  _brainSlime(m, dt, dist) {
    const ai = m.ai;
    const spec = m.spec;
    const t = this._canTarget(m) ? this._foeInRange(m, this.player, spec.sight) : null;
    ai.target = !!t;
    let dx = ai.dirX;
    let dz = ai.dirZ;
    if (t) {
      dx = t.position.x - m.pos.x;
      dz = t.position.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      const reach = spec.r + 0.5;
      if (spec.damage > 0 && m.stagger <= 0 && m.attackCooldown <= 0 && d < reach && Math.abs(t.position.y - m.pos.y) < spec.h) this._hitPlayer(m, t, spec.damage, 2, 4);
    } else if (ai.timer <= 0) {
      const a = Math.random() * Math.PI * 2;
      ai.dirX = dx = Math.sin(a);
      ai.dirZ = dz = Math.cos(a);
      ai.timer = 3 + Math.random() * 4;
    }
    ai.hopT = (ai.hopT ?? Math.random()) - dt;
    if (m.onGround && ai.hopT <= 0 && m.stagger <= 0) {
      ai.hopT = (0.5 + Math.random()) / (t ? 3 : 1);
      m.vel.y = 5.6 + spec.size * 0.45;
      m.move.x = dx * spec.speed;
      m.move.y = dz * spec.speed;
      this._voice(m, "hop");
    }
    const w = this._go(m, dt, 99, dx, dz, m.onGround ? 0 : spec.speed, t ? this._eyeOf(t) : null);
    m.yaw += THREE.MathUtils.clamp(angleDiff(Math.atan2(dx, dz), m.yaw), -4 * dt, 4 * dt);
    w.x = dx;
    w.z = dz;
    w.jump = false;
    return w;
  }

  // A witch keeps 3-10 blocks off and throws a splash potion every 3 s
  // (poison first, then harming; slowness at range), and drinks a healing
  // potion when hurt.
  _brainWitch(m, dt, dist) {
    const ai = m.ai;
    const t = this._canTarget(m) ? this._foeInRange(m, this.player, ai.target ? 24 : m.spec.sight) : null;
    ai.target = !!t;
    if (m.drinkT > 0) {
      m.drinkT -= dt;
      if (m.drinkT <= 0 && !m.dead) {
        m.health = Math.min(m.maxHealth, m.health + 4);
        this._voice(m, "drink");
      }
      return this._go(m, dt, dist, 0, 0, 0, t ? this._eyeOf(t) : null, !!t);
    }
    if (m.health < m.maxHealth && this.time > (m.drinkCd ?? 0) && Math.random() < dt * 0.6) {
      m.drinkT = 1.6;
      m.drinkCd = this.time + 4;
      return this._go(m, dt, dist, 0, 0, 0);
    }
    if (!t) return this._wander(m, dt, dist);
    const p = t.position;
    const dx = p.x - m.pos.x;
    const dz = p.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const los = this._clearShot(m);
    const facing = Math.abs(angleDiff(Math.atan2(dx, dz), m.yaw)) < 0.35;
    if (los && facing && m.attackCooldown <= 0 && d <= m.spec.shootMax && m.stagger <= 0) {
      m.attackCooldown = m.spec.shootCooldown;
      m.attack = 0;
      const kind = d >= 8 && this.time - (ai.slowT ?? -99) > 60 ? "slowness" : this.time - (ai.poisonT ?? -99) > 30 && d >= 3 ? "poison" : "harming";
      if (kind === "slowness") ai.slowT = this.time;
      if (kind === "poison") ai.poisonT = this.time;
      this._throwPotion(m, t, kind);
    }
    const speed = !los || d > m.spec.shootMax - 1 ? m.spec.chaseSpeed : d < m.spec.shootMin ? -m.spec.speed : 0;
    return this._go(m, dt, dist, speed < 0 ? -dx / d : dx / d, speed < 0 ? -dz / d : dz / d, Math.abs(speed), this._eyeOf(t), speed >= 0);
  }

  // A thrown splash potion (vanilla's arc: 0.75 blocks a tick, gravity 0.05),
  // aimed a little ahead and above the target.
  _throwPotion(m, t, kind) {
    const p = t.position;
    const v = t.velocity;
    const from = new THREE.Vector3(m.pos.x, m.pos.y + m.spec.eye - 0.1, m.pos.z);
    const tx = p.x + (v?.x ?? 0) * 0.5 - from.x;
    const tz = p.z + (v?.z ?? 0) * 0.5 - from.z;
    const hd = Math.hypot(tx, tz) || 1;
    const ty = p.y + 1.1 - from.y + hd * 0.2;
    const dir = new THREE.Vector3(tx, ty, tz).normalize();
    // (One small bottle shape per colour, made once.)
    const geos = this._potionGeos || (this._potionGeos = {});
    if (!geos[kind]) geos[kind] = colorGeometry(new THREE.SphereGeometry(0.13, 6, 4), POTION_COLORS[kind]);
    const mesh = new THREE.Mesh(geos[kind], this._arrowMat);
    const pot = { pos: from, vel: dir.multiplyScalar(15), mesh, age: 0, kind, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => pot.light);
    mesh.position.copy(from);
    this.group.add(mesh);
    this.potions.push(pot);
    this._voice(m, "throw");
  }

  _updatePotions(dt) {
    const w = this.world;
    for (let i = this.potions.length - 1; i >= 0; i--) {
      const a = this.potions[i];
      a.age += dt;
      a.vel.y -= 20 * dt;
      const len = a.vel.length() * dt || 1e-4;
      const dir = this._pv.copy(a.vel).normalize();
      const hit = w.raycast(a.pos, dir, len, { solidOnly: true });
      let at = hit ? a.pos.clone().addScaledVector(dir, hit.distance) : null;
      if (!at) {
        for (const t of this._targetList) {
          if (t.dead) continue;
          const p = t.position;
          if (Math.abs(a.pos.x - p.x) < 0.5 && Math.abs(a.pos.z - p.z) < 0.5 && a.pos.y > p.y - 0.2 && a.pos.y < p.y + 2) {
            at = a.pos.clone();
            break;
          }
        }
      }
      if (at || a.age > 6 || a.pos.y < -20) {
        if (at) this._splash(a, at);
        this.group.remove(a.mesh);
        this.potions.splice(i, 1);
        continue;
      }
      a.pos.addScaledVector(dir, len);
      a.mesh.position.copy(a.pos);
      const l = w.lightAt(a.pos.x, a.pos.y, a.pos.z);
      a.light.sky = l.sky;
      a.light.block = l.block;
    }
  }

  // A potion bursts: a puff of its colour, and its effect on every player
  // within 4 blocks, weaker farther out (vanilla's splash).
  _splash(a, at) {
    const c = new THREE.Color().setHex(POTION_COLORS[a.kind], THREE.SRGBColorSpace).multiplyScalar(3);
    for (let k = 0; k < 18; k++) {
      this.effects.glow.spawn({ x: at.x, y: at.y + 0.2, z: at.z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 5, life: 0.7, size0: 0.22, size1: 0.05, color0: c, drag: 2.5, gravity: 0.4 });
    }
    if (at.distanceTo(this.localPlayer.position) < 30) this.audio?.playBreak?.("glass");
    for (const t of this._targetList) {
      if (t.dead || t.creative) continue;
      const d = Math.hypot(t.position.x - at.x, t.position.y + 0.9 - at.y, t.position.z - at.z);
      if (d > 4) continue;
      const f = 1 - d / 4;
      if (a.kind === "harming") {
        const dmg = Math.round(6 * f);
        if (dmg > 0) t.damage(dmg, "witch", { from: at });
      } else this._effectOn(t, a.kind, a.kind === "poison" ? 33 * f : 67 * f, 1);
    }
  }

  // A status effect on a player (the survival systems' addEffect, or, online,
  // the player's own game through their stand-in). Without an effects system,
  // poison is a few points of damage that never kill.
  _effectOn(t, kind, seconds, level) {
    if (seconds < 1) return;
    if (typeof t.addEffect === "function") {
      t.addEffect(kind, seconds, level);
      return;
    }
    if (kind === "poison") {
      const dmg = Math.min(4, Math.floor((t.health ?? 20) - 1));
      if (dmg > 0) t.damage(dmg, "witch", { pierce: false });
    }
  }

  // An iron golem: guards its village. It goes for any monster within 16
  // blocks (never a creeper), and for a player who hit it or a villager;
  // its blow throws the victim into the air. Slow, and nearly unstoppable.
  _brainGolem(m, dt, dist) {
    const ai = m.ai;
    let foe = m.angerT > 0 ? this._foeInRange(m, m.foe, 24) : null;
    if (!foe) m.foe = null;
    let prey = null;
    if (!foe) {
      if (m.revenge && (m.revenge.removed || m.revenge.dead || this.time > m.revengeUntil)) m.revenge = null;
      prey = m.revenge;
      if (!prey) {
        if ((ai.preyT = (ai.preyT ?? 0) - dt) <= 0) {
          ai.preyT = 0.5 + Math.random() * 0.3;
          ai.prey = this._nearestMob(m, 16, (o) => o.spec.hostile && !o.spec.special && o.kind !== "creeper");
        }
        prey = ai.prey && !ai.prey.removed && !ai.prey.dead ? ai.prey : null;
      }
    }
    ai.target = !!foe;
    const goal = foe ? foe.position : prey ? prey.pos : null;
    if (!goal) return this._wander(m, dt, dist, 0.7);
    const dx = goal.x - m.pos.x;
    const dz = goal.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const reach = m.spec.r + (prey ? prey.spec.r : 0.3) + 0.9;
    if (m.stagger <= 0 && m.attackCooldown <= 0 && d < reach && Math.abs(goal.y - m.pos.y) < 2) {
      const dmg = 7.5 + Math.random() * 14; // (vanilla on Normal: 7.5 to 21.5)
      if (foe) this._hitPlayer(m, foe, Math.round(dmg), 9, 3);
      else {
        this._meleeMob(m, prey, dmg);
        prey.vel.y = Math.max(prey.vel.y, 8);
      }
      m.attackCooldown = 1.25;
    }
    const look = foe ? this._eyeOf(foe) : this._look.set(prey.pos.x, prey.pos.y + prey.spec.eye, prey.pos.z);
    return this._go(m, dt, dist, dx / d, dz / d, d > reach * 0.8 ? m.spec.chaseSpeed : 0, look);
  }

  // A wolf. Wild: wanders in its pack, now and then hunts a sheep (and any
  // skeleton), and the whole pack turns on a player who hits one of them.
  // Tame (bones, one in three): sits or stands at its owner's click, follows
  // them (from 10 blocks off, teleporting to them past 12), and goes for what
  // hurts them and what they hit (never a creeper or their other wolves).
  _brainWolf(m, dt, dist) {
    const ai = m.ai;
    if (m.loveT > 0) {
      const g = this._animalGoal(m, dt);
      if (g) return this._go(m, dt, dist, g.x, g.z, g.speed);
    }
    const owner = m.tamed ? this._playerByPid(m.owner) : null;
    if (m.sitting) {
      ai.target = false;
      return this._go(m, dt, dist, 0, 0, 0, owner ? this._eyeOf(owner) : null);
    }
    let foe = m.angerT > 0 ? this._foeInRange(m, m.foe, 24) : null;
    if (foe && m.tamed && (foe === owner || !this.targets)) foe = null; // (a tame wolf never bites a player: only PvP could want that)
    if (!foe) m.foe = null;
    if (m.revenge && (m.revenge.removed || m.revenge.dead || this.time > m.revengeUntil)) m.revenge = null;
    let prey = foe ? null : m.revenge;
    if (!prey && !foe) {
      if ((ai.preyT = (ai.preyT ?? Math.random() * 2) - dt) <= 0) {
        ai.preyT = 2 + Math.random();
        ai.prey = this._nearestMob(m, 16, (o) => o.kind === "skeleton" || (!m.tamed && o.kind === "sheep" && Math.random() < 0.15));
      }
      prey = ai.prey && !ai.prey.removed && !ai.prey.dead ? ai.prey : null;
    }
    ai.target = !!(foe || prey);
    if (foe || prey) {
      const goal = foe ? foe.position : prey.pos;
      const dx = goal.x - m.pos.x;
      const dz = goal.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = m.spec.r + (prey ? prey.spec.r : 0.3) + 0.8;
      if (m.stagger <= 0 && m.attackCooldown <= 0 && d < reach && Math.abs(goal.y - m.pos.y) < 1.6) {
        if (foe) this._hitPlayer(m, foe, m.spec.damage, 3, 4);
        else this._meleeMob(m, prey, m.spec.damage);
      }
      const look = foe ? this._eyeOf(foe) : this._look.set(prey.pos.x, prey.pos.y + prey.spec.eye, prey.pos.z);
      return this._go(m, dt, dist, dx / d, dz / d, d > reach * 0.7 ? m.spec.chaseSpeed : 0, look);
    }
    if (owner && !owner.dead) {
      const p = owner.position;
      const dx = p.x - m.pos.x;
      const dz = p.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((d > 12 || Math.abs(p.y - m.pos.y) > 8) && !owner.vehicle && Math.random() < dt * 4) this._teleport(m, p.x, p.y, p.z, 2, false);
      ai.following = d > 10 || (ai.following && d > 2.5);
      if (ai.following) return this._go(m, dt, dist, dx / d, dz / d, Math.min(m.spec.chaseSpeed, m.spec.speed * (d > 6 ? 2.4 : 1.4)), this._eyeOf(owner));
      return this._go(m, dt, dist, 0, 0, 0, d < 6 ? this._eyeOf(owner) : null);
    }
    // (Tame with its owner away: it stays where it is.)
    if (m.tamed) return this._go(m, dt, dist, 0, 0, 0);
    return this._wander(m, dt, dist);
  }

  // The wolves of player `pid` go for creature `target` (it hurt them, or they hit it).
  _rallyWolves(pid, target) {
    if (!target || target.isRemotePlayer || !target.spec || target.kind === "creeper" || target.dead) return;
    for (const o of this.mobs) {
      if (o.kind !== "wolf" || !o.tamed || o.owner !== pid || o.sitting || o.dead || o === target || o.net) continue;
      if (target.kind === "wolf" && target.tamed && target.owner === pid) continue;
      if (o.pos.distanceTo(target.pos) > 20) continue;
      o.revenge = target;
      o.revengeUntil = this.time + 20;
    }
  }

  // This machine's player's id online (1: the host's, or single player's).
  _pidOf(t) {
    return t === this.localPlayer ? this.localPid : t?.pid ?? 0;
  }

  _playerByPid(pid) {
    if (!pid) return null;
    if (pid === this.localPid) return this.localPlayer;
    for (const t of this._targetList) if (t.pid === pid && !t.gone) return t;
    return null;
  }

  // The nearest living creature within `range` (and 4 blocks up or down) that passes `test`.
  _nearestMob(m, range, test) {
    let best = null;
    let bd = range * range;
    for (const o of this.mobs) {
      if (o === m || o.dead || Math.abs(o.pos.y - m.pos.y) > 4) continue;
      const dx = o.pos.x - m.pos.x;
      const dz = o.pos.z - m.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd && test(o)) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  // Another creature a monster goes for when no player is about: whatever
  // hurt it lately, or (a zombie) the nearest villager within 20 blocks.
  _prey(m, dt) {
    const ai = m.ai;
    if (m.revenge && (m.revenge.removed || m.revenge.dead || this.time > m.revengeUntil)) m.revenge = null;
    if (m.revenge) return m.revenge;
    if (!m.spec.huntsVillagers) return null;
    if ((ai.preyT = (ai.preyT ?? 0) - dt) <= 0) {
      ai.preyT = 1 + Math.random() * 0.5;
      ai.prey = this._nearestMob(m, 20, (o) => o.kind === "villager" && !o.net);
    }
    return ai.prey && !ai.prey.removed && !ai.prey.dead ? ai.prey : null;
  }

  // Creature `a` strikes creature `b` (a zombie a villager, a golem a zombie).
  _meleeMob(a, b, dmg) {
    a.attackCooldown = 1.0;
    a.attack = 0;
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (this._hurt(b, dmg, { x: dx / d, z: dz / d }, 5, false)) {
      b.revenge = a;
      b.revengeUntil = this.time + 12;
      if (!b.spec.hostile && !b.spec.brain) {
        b.ai.state = "flee";
        b.ai.timer = 3 + Math.random() * 2;
        b.ai.fleeFrom = a.pos;
      }
    }
    this._voice(a, "attack");
  }

  // ---------- (Round 11) Animals: food, love, babies, eggs, wool ----------

  // What a Survival world's animal or villager wants right now, or null
  // (wander as usual): stand for its trader; run from a zombie; court a
  // mate; follow a player holding its food; stay near a parent.
  _animalGoal(m, dt) {
    const ai = m.ai;
    const g = m._goal || (m._goal = { x: 0, z: 0, speed: 0, look: false });
    g.x = 0;
    g.z = 0;
    g.speed = 0;
    g.look = true;
    if (m.tradingT > this.time) return g;
    if (m.spec.village) {
      if ((ai.panicT = (ai.panicT ?? 0) - dt) <= 0) {
        ai.panicT = 0.5;
        const z = this._nearestMob(m, 8, (o) => !!o.spec.huntsVillagers);
        if (z) {
          ai.state = "flee";
          ai.timer = 2;
          ai.fleeFrom = z.pos;
        }
      }
      return null;
    }
    if (m.loveT > 0) {
      if ((ai.mateT = (ai.mateT ?? 0) - dt) <= 0) {
        ai.mateT = 0.5;
        ai.mate = this._nearestMob(m, 8, (o) => o.kind === m.kind && o.loveT > 0 && !o.baby && !o.net);
      }
      const mate = ai.mate;
      if (mate && !mate.removed && mate.loveT > 0) {
        const dx = mate.pos.x - m.pos.x;
        const dz = mate.pos.z - m.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        g.look = false;
        if (d < m.spec.r + mate.spec.r + 0.5) {
          m.mateTime = (m.mateTime ?? 0) + dt;
          if (m.mateTime >= 3 && m.id < mate.id) this._breed(m, mate);
          m.yaw += THREE.MathUtils.clamp(angleDiff(Math.atan2(dx, dz), m.yaw), -3 * dt, 3 * dt);
          return g;
        }
        g.x = dx / d;
        g.z = dz / d;
        g.speed = m.spec.speed;
        return g;
      }
    }
    if ((ai.temptT = (ai.temptT ?? 0) - dt) <= 0) {
      ai.temptT = 0.5;
      ai.tempter = this._tempter(m);
    }
    const t = ai.tempter;
    if (t && !t.dead && !t.gone) {
      const dx = t.position.x - m.pos.x;
      const dz = t.position.z - m.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 2.2) {
        g.x = dx / d;
        g.z = dz / d;
        g.speed = m.spec.speed * 1.25;
      }
      return g;
    }
    if (m.baby) {
      if ((ai.parentT = (ai.parentT ?? 0) - dt) <= 0) {
        ai.parentT = 1;
        ai.parent = this._nearestMob(m, 8, (o) => o.kind === m.kind && !o.baby);
      }
      const p = ai.parent;
      if (p && !p.removed && !p.dead) {
        const dx = p.pos.x - m.pos.x;
        const dz = p.pos.z - m.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 3) {
          g.x = dx / d;
          g.z = dz / d;
          g.speed = m.spec.speed;
          g.look = false;
          return g;
        }
      }
    }
    return null;
  }

  // A player within 10 blocks holding this animal's food, or null.
  _tempter(m) {
    const food = m.spec.breed;
    for (const t of this._targetList) {
      if (t.dead || t.gone || t.vehicle) continue;
      const id = t === this.localPlayer ? this.inventory?.selectedStack?.id : t.heldId;
      if (!id || !food.includes(id)) continue;
      if (Math.hypot(t.position.x - m.pos.x, t.position.z - m.pos.z) < 10 && Math.abs(t.position.y - m.pos.y) < 4) return t;
    }
    return null;
  }

  // Fed its food: in love for 30 s (hearts), unless it bred lately. `pid`:
  // who fed it (the breeding's experience is theirs).
  love(m, pid = 1) {
    if (m.dead || m.baby || m.loveT > 0 || m.breedCd > 0) return false;
    m.loveT = LOVE_TIME;
    m.lovePid = pid;
    m.persist = true;
    this._hearts(m, 5);
    return true;
  }

  // A baby fed its food grows up a tenth of the way sooner (vanilla).
  feedBaby(m) {
    if (!m.baby || m.spec.hostile) return false;
    m.growT *= 0.9;
    m.persist = true;
    this._hearts(m, 2, true);
    return true;
  }

  // A wolf becomes `pid`'s: tame, its health raised to a tame wolf's, kept.
  _tame(m, pid) {
    m.tamed = true;
    m.owner = pid;
    m.persist = true;
    m.angerT = 0;
    m.foe = null;
    m.revenge = null;
    const k = m.health / (m.maxHealth || 1);
    m.maxHealth = WOLF_TAME_HEALTH;
    m.health = Math.max(1, k * WOLF_TAME_HEALTH);
  }

  _smoke(m) {
    for (let k = 0; k < 6; k++) this.effects.smoke.spawn({ x: m.pos.x + (Math.random() - 0.5) * 0.5, y: m.pos.y + m.spec.h, z: m.pos.z + (Math.random() - 0.5) * 0.5, vx: 0, vy: 0.8, vz: 0, life: 0.8, size0: 0.15, size1: 0.35, color0: this._smokeGrey, color1: this._smokeGrey2, alpha: 0.7, drag: 2 });
  }

  _breed(a, b) {
    a.loveT = b.loveT = 0;
    a.breedCd = b.breedCd = BREED_COOLDOWN;
    a.mateTime = b.mateTime = 0;
    a.persist = b.persist = true;
    const variant = a.kind === "sheep" ? (Math.random() < 0.5 ? a.variant : b.variant) : undefined;
    const baby = this.spawn(a.kind, (a.pos.x + b.pos.x) / 2, Math.max(a.pos.y, b.pos.y), (a.pos.z + b.pos.z) / 2, { baby: true, variant });
    if (baby) baby.persist = true;
    if (baby && a.tamed) this._tame(baby, a.owner); // (a tame pair's pup is their owner's)
    this._hearts(a, 7);
    this._giveXp(a.lovePid ?? b.lovePid ?? 1, 1 + Math.floor(Math.random() * 7), a.pos);
    return baby;
  }

  _hearts(m, n, green = false) {
    const c = green ? this._c1.setRGB(0.6, 2.6, 0.6) : this._c1.setRGB(3, 0.35, 0.5);
    for (let k = 0; k < n; k++) {
      this.effects.glow.spawn({ x: m.pos.x + (Math.random() - 0.5) * m.spec.r * 2, y: m.pos.y + m.spec.h + Math.random() * 0.3, z: m.pos.z + (Math.random() - 0.5) * m.spec.r * 2, vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.4, life: 0.9, size0: 0.16, size1: 0.12, color0: c.clone(), drag: 1.5 });
    }
  }

  // Shears a sheep: 1-3 wool of its colour falls off; it grows back when
  // the sheep eats grass.
  shear(m) {
    if (m.kind !== "sheep" || m.sheared || m.baby || m.dead) return false;
    m.sheared = true;
    m.persist = true;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) this._drop(woolOf(m.variant), 1, m.pos, 0.8);
    this.audio?.playBreak?.("wool");
    return true;
  }

  // A Survival world's animal's own clock (the host's or single player's
  // real creatures): growing up, love, the breeding pause, eggs, grazing.
  _animalTick(m, dt) {
    if (m.baby && !m.spec.hostile && (m.growT -= dt) <= 0) this.setBaby(m, false);
    if (m.breedCd > 0) m.breedCd -= dt;
    if (m.loveT > 0) {
      m.loveT -= dt;
      if ((m.heartT = (m.heartT ?? 0) - dt) <= 0) {
        m.heartT = 0.8;
        this._hearts(m, 1);
      }
    }
    if (m.eggT !== undefined && !m.baby && (m.eggT -= dt) <= 0) {
      m.eggT = 300 + Math.random() * 300;
      this._drop(V.EGG, 1, m.pos, 0.3);
      this._voice(m, "idle");
    }
    // A sheep eats the grass it stands on (to dirt) or the tall grass at its
    // feet now and then (vanilla: 1 in 1000 a tick; a lamb 1 in 50); its wool grows back.
    if (m.spec.grazes && m.onGround && m.walk < 0.2 && Math.random() < dt * (m.baby ? 0.4 : 0.02)) {
      const x = Math.floor(m.pos.x);
      const y = Math.floor(m.pos.y + 0.05);
      const z = Math.floor(m.pos.z);
      const w = this.world;
      let ate = false;
      if (w.getBlock(x, y, z) === BLOCK.TALL_GRASS) ate = w.setBlock(x, y, z, BLOCK.AIR);
      else if (w.getBlock(x, y - 1, z) === BLOCK.GRASS) ate = w.setBlock(x, y - 1, z, BLOCK.DIRT);
      if (ate) {
        m.grazeUntil = this.time + 2;
        m.sheared = false;
        if (m.baby) m.growT = Math.max(0, m.growT - 60);
      }
    }
    // A villager's goods come back now and then (vanilla: restocks twice a day).
    if (m.trades && (m.restockT = (m.restockT ?? 600) - dt) <= 0) {
      m.restockT = 600;
      for (const o of m.trades) o.uses = 0;
    }
  }

  // Burning in fire or lava (a Survival world's blocks), put out by water;
  // a creature that dies burning drops its meat cooked.
  _fireTick(m, dt) {
    const w = this.world;
    const x = Math.floor(m.pos.x);
    const z = Math.floor(m.pos.z);
    const feet = w.getBlock(x, Math.floor(m.pos.y + 0.1), z);
    const body = w.getBlock(x, Math.floor(m.pos.y + m.spec.h * 0.6), z);
    const lava = feet === V.LAVA || body === V.LAVA;
    if (lava) m.fireT = 15;
    else if (feet === V.FIRE || body === V.FIRE) m.fireT = Math.max(m.fireT, 8);
    if (m.inWater) m.fireT = 0;
    if (m.fireT <= 0) return;
    m.fireT -= dt;
    m.fireDmgT = (m.fireDmgT ?? 0) - dt;
    if (m.fireDmgT <= 0) {
      m.fireDmgT = lava ? 0.5 : 1;
      m.invulnerable = 0;
      this._hurt(m, lava ? 4 : 1, null, 0);
    }
    if (!m.burning && Math.random() < dt * 14) {
      this.effects.glow.spawn({ x: m.pos.x + (Math.random() - 0.5) * 0.5, y: m.pos.y + Math.random() * m.spec.h, z: m.pos.z + (Math.random() - 0.5) * 0.5, vy: 1 + Math.random(), life: 0.5, size0: 0.35, size1: 0.1, color0: this._burnC, color1: this._burnC2 });
    }
    m.burning = true;
  }

  // An item dropped at a creature (any id another part may not have made yet is skipped).
  _drop(id, n, pos, up = 0.4) {
    if (!(n > 0) || !isValidItem(id)) return null;
    return this.entities.spawn(id, n, new THREE.Vector3(pos.x, pos.y + up, pos.z));
  }

  // Experience (breeding's) for player `pid` (1: the host's or single
  // player's own, as orbs here: xp.js through LIB.giveXp; another player's
  // goes to them online: onRemoteXp). Survival worlds only. (A kill's
  // experience is xp.js's killXp, from the spec's `xp`.)
  _giveXp(pid, amount, pos) {
    if (!(amount > 0) || !isVanilla()) return;
    if (!pid || pid === 1 || !this.targets) LIB.giveXp?.(amount, pos.x, pos.y + 0.5, pos.z);
    else this.onRemoteXp?.(pid, amount, pos);
  }

  // The vanilla drops a plain table can't say: a sheep's wool, a witch's
  // odds and ends, a zombie's rare iron, carrot or potato, an enderman's block.
  _vanillaDrops(m, byPlayer) {
    const c = m.pos;
    if (m.kind === "sheep" && !m.sheared && !m.baby) this._drop(woolOf(m.variant), 1, c);
    if (m.kind === "witch") {
      const loot = [V.GLASS_BOTTLE, V.REDSTONE, V.GUNPOWDER, V.SPIDER_EYE, V.SUGAR, ITEM.STICK, ITEM.STICK];
      for (let k = 1 + Math.floor(Math.random() * 3); k > 0; k--) this._drop(loot[Math.floor(Math.random() * loot.length)], Math.floor(Math.random() * 3), c);
    }
    if (m.kind === "zombie" && byPlayer && Math.random() < 0.025) this._drop([V.IRON_INGOT, V.CARROT, V.POTATO][Math.floor(Math.random() * 3)], 1, c);
    if (m.carry) this._drop(m.carry, 1, c);
  }

  // A big slime breaks into two to four of the next size down.
  _split(m) {
    const kind = m.spec.split;
    const n = 2 + Math.floor(Math.random() * 3);
    const r = m.spec.r * 0.5;
    for (let k = 0; k < n; k++) {
      const o = this.spawn(kind, m.pos.x + (Math.random() - 0.5) * r * 2, m.pos.y + 0.2, m.pos.z + (Math.random() - 0.5) * r * 2, { wet: true });
      if (o) {
        o.ai.target = m.ai.target;
        o.vel.y = 3;
      }
    }
  }

  // ---------- (Round 11) Using a creature (right click) ----------

  // A right click on creature `m` with `stack` in hand: milk from a cow (a
  // bucket), wool from a sheep (shears), love or growth from food, an iron
  // golem mended (iron), a villager's trades. True if something happened.
  // interaction.js onUseMob (main.js). Online, a guest's use on one of the
  // host's creatures is a claim (onPuppetUse); its own inventory changes here.
  useMob(m, stack, inventory = this.inventory) {
    if (!m || m.dead || m.isRemotePlayer || !m.spec || !SPECIES[m.kind] || !inventory) return false;
    const id = stack?.id ?? 0;
    const creative = !!this.localPlayer.creative;
    const spec = m.spec;
    if (m.kind === "wolf") return this._useWolf(m, id, inventory, creative);
    if (spec.milk && id === V.BUCKET && !m.baby && isValidItem(V.MILK_BUCKET)) {
      if (!creative || !inventory.countItem(V.MILK_BUCKET)) {
        if (!creative) inventory.consumeSelected(1);
        const left = inventory.add(V.MILK_BUCKET, 1);
        if (left) this._drop(V.MILK_BUCKET, left, this.localPlayer.position, 1);
      }
      this.audio?.playPickup?.();
      return true;
    }
    if (m.kind === "sheep" && id === V.SHEARS) {
      if (m.sheared || m.baby) return false;
      if (m.net) {
        m.sheared = true;
        this.onPuppetUse?.(m, "shear");
        this.audio?.playBreak?.("wool");
      } else this.shear(m);
      if (!creative && inventory.damageSelected(1)) this.audio?.playToolBreak?.();
      return true;
    }
    if (spec.breed?.includes(id)) {
      if (m.baby) {
        if (spec.hostile) return false;
        if (m.net) {
          this.onPuppetUse?.(m, "grow");
          this._hearts(m, 2, true);
        } else this.feedBaby(m);
      } else {
        if (m.loveT > 0 || m.breedCd > 0) return false;
        if (m.net) {
          m.loveT = 1; // (the host's answer follows in its states)
          this.onPuppetUse?.(m, "love");
          this._hearts(m, 5);
        } else if (!this.love(m, this.currentAttacker ?? 1)) return false;
      }
      if (!creative) inventory.consumeSelected(1);
      this._voice(m, "idle");
      return true;
    }
    if (m.kind === "iron_golem" && id === V.IRON_INGOT && m.health < m.maxHealth) {
      if (m.net) this.onPuppetUse?.(m, "mend");
      else m.health = Math.min(m.maxHealth, m.health + 25);
      if (!creative) inventory.consumeSelected(1);
      this.audio?.playPlace?.("metal");
      return true;
    }
    if (spec.trades && !m.baby && m.variant > 0 && m.variant - 1 !== NITWIT) return this.openTrade(m);
    return false;
  }

  // A wolf: a bone tames a wild one (one in three); its owner's meat heals
  // it or (healthy) puts it in love; anything else sits it down or stands it
  // up. A tame wolf whose owner isn't here (after a reload, a guest gone)
  // takes whoever clicks it next as its owner.
  _useWolf(m, id, inventory, creative) {
    const me = this.localPid;
    if (!m.tamed) {
      if (id !== V.BONE || m.angerT > 0 || m.baby) return false;
      if (!creative) inventory.consumeSelected(1);
      if (m.net) this.onPuppetUse?.(m, "tame");
      else this.useFrom(m, "tame", me);
      return true;
    }
    if (m.owner && m.owner !== me) return false;
    if (MEAT_HEAL[id] && m.owner && (m.health < m.maxHealth - 0.5 || (!m.baby && !(m.loveT > 0) && !(m.breedCd > 0)))) {
      if (!creative) inventory.consumeSelected(1);
      if (m.net) this.onPuppetUse?.(m, "wolffeed:" + id);
      else this.useFrom(m, "wolffeed:" + id, me);
      return true;
    }
    if (m.net) {
      this.onPuppetUse?.(m, "sit");
      m.sitting = !m.sitting; // (the host's answer follows in its states)
    } else this.useFrom(m, "sit", me);
    return true;
  }

  // A use on one of this machine's real creatures from player `pid` (the
  // host, for a guest's claim): what useMob does there, minus the inventory.
  useFrom(m, action, pid) {
    if (!m || m.dead) return false;
    if (m.kind === "wolf") {
      if (action === "tame") {
        if (m.tamed || m.angerT > 0 || m.baby) return false;
        if (Math.random() >= 1 / 3) {
          this._smoke(m);
          return true;
        }
        this._tame(m, pid);
        m.sitting = true;
        this._hearts(m, 7);
        return true;
      }
      if (!m.tamed || (m.owner && m.owner !== pid)) return false;
      if (action === "sit") {
        if (!m.owner) {
          m.owner = pid; // (an owner gone: whoever clicks it now)
          m.sitting = false;
        } else m.sitting = !m.sitting;
        m.revenge = null;
        m.foe = null;
        return true;
      }
      if (action.startsWith("wolffeed:")) {
        const food = Number(action.slice(9));
        if (!MEAT_HEAL[food]) return false;
        if (m.health < m.maxHealth - 0.5) m.health = Math.min(m.maxHealth, m.health + MEAT_HEAL[food]);
        else this.love(m, pid);
        this._hearts(m, 2, true);
        return true;
      }
      return false;
    }
    if (action === "shear") return this.shear(m);
    if (action === "love") return !!m.spec.breed && this.love(m, pid);
    if (action === "grow") return !!m.spec.breed && this.feedBaby(m);
    if (action === "mend" && m.kind === "iron_golem") {
      m.health = Math.min(m.maxHealth, m.health + 25);
      return true;
    }
    return false;
  }

  // ---------- (Round 11) Trading (js/trading.js) ----------

  _ensureTrades(m) {
    if (!m.trades) m.trades = m.variant > 0 ? makeOffers(m.variant - 1) : [];
    return m.trades;
  }

  // Opens villager `m`'s trades (main.js onTrade shows the screen). Online, a
  // guest asks the host for the offers first (onPuppetTradeQuery).
  openTrade(m) {
    if (!this.onTrade) return false;
    const remote = !!m.net;
    const s = { mob: m, title: PROFESSION_NAMES[m.variant - 1] || "Villager", offers: remote ? null : this._ensureTrades(m), remote, pending: null, onUpdate: null };
    if (this.onTrade(s) === false) return false;
    this.tradeSession = s;
    if (remote) this.onPuppetTradeQuery?.(m);
    else m.tradingT = Infinity;
    return true;
  }

  closeTrade(s) {
    if (this.tradeSession !== s) return;
    this.tradeSession = null;
    if (!s.remote) s.mob.tradingT = 0;
  }

  // The screen asks for trade `i`; cb(ok) once it's decided (the host's call online).
  tradeRequest(s, i, cb) {
    if (!s.remote) {
      cb(this.takeTrade(s.mob, i));
      return;
    }
    if (s.pending) {
      cb(false);
      return;
    }
    s.pending = cb;
    this.onPuppetTrade?.(s.mob, i);
  }

  // One use of villager m's offer i, if it has stock (the host's or single
  // player's own villagers). True if the trade may go ahead.
  takeTrade(m, i) {
    const o = this._ensureTrades(m)[i];
    if (!o || o.uses >= o.max || m.dead) return false;
    o.uses++;
    return true;
  }

  // The host's answer about the villager with host id `id`: its offers now,
  // and (`ok` not undefined) whether the trade asked for may go ahead.
  tradeAnswer(id, offers, ok) {
    const s = this.tradeSession;
    if (!s || !s.remote || s.mob.net?.id !== id) return;
    if (offers) s.offers = offers;
    if (ok !== undefined && s.pending) {
      const cb = s.pending;
      s.pending = null;
      cb(!!ok);
    }
    s.onUpdate?.();
  }

  // ---------- (Round 11) Kept creatures (saved with the world) ----------

  // The creatures players made their own in a Survival world (bred, fed,
  // shorn: m.persist), for the save: [kind, x, y, z, variant, seconds to
  // grow up (0: grown), shorn, tame (2: this player's wolf, 1: someone's), sitting].
  serializeKept() {
    if (this.puppets || !isVanilla()) return undefined;
    const out = [];
    for (const m of this.mobs) {
      if (!m.persist || m.dead || m.net || m.spec.hostile || m.spec.flies || m.spec.special || m.missionTarget || m.abductedBy) continue;
      // (A tame wolf: 2 if this player's, 1 if another's, who may not come back: then whoever clicks it next.)
      const tame = m.tamed ? (m.owner === this.localPid ? 2 : 1) : 0;
      out.push([m.kind, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), m.variant || 0, m.baby ? Math.max(1, Math.round(m.growT)) : 0, m.sheared ? 1 : 0, tame, m.sitting ? 1 : 0]);
      if (out.length >= 400) break;
    }
    return out.length ? out : undefined;
  }

  // The saved ones: they come back as their ground loads (_spawnKept).
  loadKept(list) {
    if (!Array.isArray(list) || !isVanilla()) return;
    this._kept = list.filter((e) => Array.isArray(e) && Object.hasOwn(SPECIES, e[0]) && !SPECIES[e[0]].hostile && [1, 2, 3].every((k) => Number.isFinite(e[k]))).slice(0, 400);
  }

  _spawnKept() {
    const list = this._kept;
    for (let i = list.length - 1; i >= 0; i--) {
      const [kind, x, y, z, variant, grow, sheared, tame, sitting] = list[i];
      if (!this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
      list.splice(i, 1);
      const m = this.spawn(kind, x, y, z, { variant: variant | 0, baby: grow > 0, wet: true });
      if (!m) continue;
      m.persist = true;
      if (grow > 0) m.growT = grow;
      m.sheared = !!sheared;
      if (kind === "wolf" && tame) {
        this._tame(m, tame === 2 ? this.localPid : 0);
        m.health = m.maxHealth;
        m.sitting = !!sitting || tame !== 2;
      }
    }
  }

  // ---------- (Round 11) Voices ----------

  // A creature's sound: the audio's own voices (audio.js), or for the vanilla
  // mobs the ones here, played on the same synth.
  _voice(m, event) {
    const d = this._audioDist(m);
    if (d > 40) return;
    // (A Missions world's own creatures keep the voices they had.)
    const own = m.spec.vanilla || isVanilla();
    const parts = own ? VANILLA_VOICES[m.kind]?.[event] || (m.kind.startsWith("slime") ? VANILLA_VOICES.slime[event] : null) : null;
    const a = this.audio;
    if (!parts || typeof a?._voice !== "function" || typeof a._hit !== "function") {
      a?.playMob?.(m.kind, event, d);
      return;
    }
    if (!a.ctx) return;
    a._cat?.("creatures");
    const gain = 1 / (1 + d / 7);
    for (const part of parts) {
      if (part.noise) a._hit({ ...part.noise, v: part.noise.v * gain }, part.delay || 0);
      else a._voice(part, gain);
    }
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
  alarm(m, radius = 45, who = null) {
    for (const o of this.mobs) {
      if (o.dead || !o.spec.sentry) continue;
      if (o !== m && o.pos.distanceTo(m.pos) > radius) continue;
      if (!o.alerted) this.onAlarm?.(o, who);
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
    m.ai.dirX = Math.sin(m.yaw);
    m.ai.dirZ = Math.cos(m.yaw);
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
      const heard = this._audioDist(m) < 30;
      this._abductFx(m);
      m.pos.set(cell[0] + 0.5, cell[1], cell[2] + 0.5);
      m.vel.set(0, 0, 0);
      m.knock.set(0, 0, 0);
      m.ai.path = null;
      m.ai.los = true;
      m.ai.losT = this.time + 0.3;
      this._abductFx(m);
      if (heard || this._audioDist(m) < 30) this.audio?.playTeleport?.();
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
    const applied = this.player.damage(dmg, meleeCause(m.kind), { from: m.pos });
    if (applied) {
      this.player.applyImpulse(this._tmp.set(nx * 6, 4, nz * 6));
      if (this.onPlayerHurt) this.onPlayerHurt(m);
      if (isVanilla()) this._rallyWolves(this._pidOf(this.player), m); // (Round 11: their wolves defend them)
    }
    this._voice(m, "attack");
  }

  _distTo(m) {
    return m.pos.distanceTo(this.player.position);
  }

  // For sounds: from this machine's player (online, this.player may be a guest's proxy).
  _audioDist(m) {
    return m.pos.distanceTo(this.localPlayer.position);
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
    let vdx = m.pos.x + dx - start.x;
    let vdz = m.pos.z + dz - start.z;
    let vdy = m.pos.y + dy + 0.9 - start.y;
    const dist = Math.hypot(vdx, vdy, vdz) || 1;
    const t = dist / ARROW_SPEED;
    // A little scatter, wider the farther the shot (about a body width at 15
    // blocks): close shots land, long ones sometimes miss.
    const spread = 0.04 * dist;
    const sa = Math.random() * Math.PI * 2;
    const sr = Math.sqrt(Math.random()) * spread;
    const hd = Math.hypot(vdx, vdz) || 1;
    const side = Math.cos(sa) * sr; // (sideways, across the line of fire)
    const px = -vdz / hd;
    const pz = vdx / hd;
    vdx += px * side;
    vdz += pz * side;
    vdy += Math.sin(sa) * sr * 0.7;
    // Aimed high by the drop over the flight (it grows with t squared, so at
    // point blank, t ~ 0.1 s, there is next to no lift). (Fix: only 55% of
    // the drop was made up, so from about 10 blocks on every arrow landed at
    // the player's feet, though skeletons shoot from up to 22.)
    const riseComp = -0.5 * ARROW_GRAVITY * t * t;
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
    if (this._audioDist(m) < 30) this.audio.playSwing?.();
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
    // (Round 10: at the middle of the vehicle the player sits in: shots meet
    // its real shape now, and the pilot's head sits above most of a jet.)
    const veh = this.player.vehicle;
    const target = veh ? veh.pos.clone() : this.player.getEyePosition();
    if (!veh) target.y -= 0.6;
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
    // (Round 8: the aim spreads far less with distance, so a long shot can hit:
    // about +-4 blocks at 90 blocks for a pistol, a little tighter for a rifle or a burst.)
    // (Half that at an aircraft: its real shape is hit now, not a sphere, so
    // about as many shots land as before.)
    const spread = ((weapon === "burst" ? 0.009 : weapon === "rifle" ? 0.014 : 0.021) + dist * (weapon === "burst" ? 0.00018 : weapon === "rifle" ? 0.0002 : 0.00025)) * (veh?.hull ? 0.5 : 1);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    m.aimTime = this.time;
    const range = dist * 1.4 + 40;
    // (Survival: alien guns follow the mission curve, like the UFOs' do.)
    const damage = Math.max(1, Math.round(m.spec.laserDamage * (this.alienDamageScale ?? 1)));
    if (weapon === "plasma") {
      this.lasers.fire({ from, dir, color: ALIEN_LASER_COLORS.plasma, speed, damage, owner: "alien", cause: shooterCause(m.kind), source: m, range, radius: 0.2, length: 0.9, blast: 1.6 });
    } else if (weapon === "scatter") {
      // A short scatter of four fast bolts: some of them up close, hardly any at range.
      for (let i = 0; i < 4; i++) {
        const d = dir.clone();
        d.x += (Math.random() - 0.5) * 0.3;
        d.y += (Math.random() - 0.5) * 0.2;
        d.z += (Math.random() - 0.5) * 0.3;
        d.normalize();
        this.lasers.fire({ from, dir: d, color: ALIEN_LASER_COLORS.scatter, speed, damage, owner: "alien", cause: shooterCause(m.kind), source: m, range: Math.min(range, 34), radius: 0.035, length: 1.1 });
      }
    } else if (weapon === "rifle") {
      this.lasers.fire({ from, dir, color: ALIEN_LASER_COLORS.rifle, speed, damage, owner: "alien", cause: shooterCause(m.kind), source: m, range, radius: 0.04, length: 1.6 });
    } else {
      this.lasers.fire({ from, dir, color: weapon === "burst" ? ALIEN_LASER_COLORS.burst : this.alienLaserColor, speed, damage, owner: "alien", cause: shooterCause(m.kind), source: m, range, radius: weapon === "burst" ? 0.04 : 0.05, length: weapon === "burst" ? 1.8 : 1.3 });
    }
  }

  // Whether the player's body is hit somewhere along the arrow's step this
  // frame; returns the distance along the step, or null.
  // Where along this frame's flight (0..maxDist) the arrow enters the
  // player's body box, or null. (Exact: a slow frame's long step used to be
  // sampled at four points, which skipped right past a 0.7-wide body.)
  _arrowHitsPlayer(pos, dir, maxDist) {
    if (this.player.dead || this.player.creative) return null;
    const p = this.player.position;
    let t0 = 0;
    let t1 = maxDist;
    const o = [pos.x, pos.y, pos.z];
    const d = [dir.x, dir.y, dir.z];
    const lo = [p.x - 0.35, p.y - 0.1, p.z - 0.35];
    const hi = [p.x + 0.35, p.y + 1.9, p.z + 0.35];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < lo[k] || o[k] > hi[k]) return null;
        continue;
      }
      let a = (lo[k] - o[k]) / d[k];
      let b = (hi[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
    return t0;
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
      // (Online, the host's arrows hit any player.)
      let hitPlayer = null;
      for (const t of this.targets ? this.targets() : [this.player]) {
        this.player = t;
        const playerT = this._arrowHitsPlayer(a.pos, dir, blockHit ? blockHit.distance : len);
        this.player = this.localPlayer;
        if (playerT !== null) {
          hitPlayer = t;
          break;
        }
      }
      if (hitPlayer) {
        if (hitPlayer.damage(ARROW_DAMAGE, "skeleton", { from: a.pos.clone().addScaledVector(dir, -3) })) hitPlayer.applyImpulse(this._tmp.set(dir.x * 4, 2, dir.z * 4));
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
    } else if (spec.climbs && m.blocked && speed > 0) {
      // Pressed against a wall while trying to move: climb it, from the
      // ground too, instead of falling (m.blocked is last frame's result, so this lags one frame
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
        if (dmg > 0 && !spec.noFall) this._hurt(m, dmg, null, 0);
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
      if (m.dead || m.net) continue;
      const k = key(m.pos.x, m.pos.z);
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(m);
    }
    const p = this.player.position;
    for (const a of list) {
      if (a.dead || a.net) continue;
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
    // A guest's hit on one of the host's creatures: a claim to the host (it
    // judges health and death); here only the red flash.
    if (m.net) {
      m.hurtTime = 0;
      m.invulnerable = MOB_INVULNERABLE;
      this.onPuppetHit?.(m, amount, dir, kb, byPlayer);
      this._voice(m, "hurt");
      return true;
    }
    if (byPlayer) {
      m.lastPlayerHit = this.time;
      m.lastHitPid = this.currentAttacker ?? 1; // (online: which player; 1 is the host)
      // Hit by the player: a spider is provoked (they are neutral in daylight
      // otherwise); a guard (and the guards near him) raise the alarm.
      if (m.kind === "spider") m.provokedT = 30;
      if (m.spec.sentry) this.alarm(m, 40, this.player);
      // (Round 11) An enderman or an iron golem turns on whoever hit it; hit
      // a villager, and the golems around come for you.
      if (m.spec.brain === "enderman" || m.spec.brain === "golem") {
        m.foe = this.player;
        m.angerT = 30;
      }
      if (m.spec.village && m.kind === "villager") {
        for (const o of this.mobs) {
          if (o.kind !== "iron_golem" || o.dead || o.pos.distanceTo(m.pos) > 16) continue;
          o.foe = this.player;
          o.angerT = 30;
        }
      }
      // A wild wolf's pack turns on whoever hit it; a player's own wolves go
      // for whatever they hit.
      const pid = this.currentAttacker ?? this.localPid;
      if (m.kind === "wolf" && !m.tamed) {
        for (const o of this.mobs) {
          if (o.kind !== "wolf" || o.tamed || o.dead || o.pos.distanceTo(m.pos) > 16) continue;
          o.foe = this.player;
          o.angerT = 30;
        }
      }
      if (isVanilla() && !(m.kind === "wolf" && m.tamed && m.owner === pid)) this._rallyWolves(pid, m);
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
    if (m.health <= 0) {
      m.dead = true;
      m.deathTime = 0;
      this.kills++;
      this.killsByKind[m.kind] = (this.killsByKind[m.kind] || 0) + 1;
      // (Round 8) A mission leader drops the weapon it carries however it dies (main.js).
      if (m.leaderDrop && !m.net) this.onLeaderDown?.(m);
      if (this.onKill) this.onKill(m, this.time - (m.lastPlayerHit ?? -99) < 6);
      this._voice(m, "death");
      return true;
    }
    this._voice(m, "hurt");
    if (!m.spec.hostile && !m.spec.brain) {
      if (m.spec.hides) {
        m.ai.state = "hide";
        m.ai.timer = 4 + Math.random() * 2;
      } else {
        m.ai.state = "flee";
        m.ai.timer = 3 + Math.random() * 2;
        m.ai.fleeFrom = null; // (from the player: _meleeMob sets another creature)
      }
    }
    return true;
  }

  _die(i) {
    const m = this.mobs[i];
    const c = m.pos;
    // A puff of smoke, then the drops.
    const grey = this._smokeGrey;
    const grey2 = this._smokeGrey2;
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
    // (Round 11: a meat drop is cooked if it died burning; some drops only
    // when a player killed it. Any item another part hasn't made yet is skipped.)
    const keep = !(this.keepDrops && !this.keepDrops(m));
    const byPlayer = this.time - (m.lastPlayerHit ?? -99) < 6;
    const cooked = m.burning || m.fireT > 0;
    for (const [id, min, max, chance, cookedId, playerOnly] of keep ? m.spec.drops : []) {
      if (Math.random() > chance || (playerOnly && !byPlayer)) continue;
      const n = min + Math.floor(Math.random() * (max - min + 1));
      const item = cooked && cookedId && isValidItem(cookedId) ? cookedId : id;
      if (n > 0 && isValidItem(item)) this.entities.spawn(item, n, new THREE.Vector3(c.x, c.y + 0.4, c.z));
    }
    if (keep && !m.net) {
      if (isVanilla() || m.spec.vanilla) this._vanillaDrops(m, byPlayer);
      if (m.spec.split) this._split(m);
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
    // (Round 11) An enderman dodges whatever is shot at it: it teleports
    // away unhurt, angry (a guest's shot: the host decides, see onPuppetHit).
    if (mob.spec.brain === "enderman" && !mob.net && !mob.dead) {
      if (byPlayer) {
        mob.foe = this.player;
        mob.angerT = 30;
      }
      this._teleport(mob);
      return false;
    }
    mob.invulnerable = 0; // every shot counts
    this.projectileHit = true;
    try {
      return this._hurt(mob, damage, { x: dir.x / len, z: dir.z / len }, knockback, byPlayer);
    } finally {
      this.projectileHit = false;
    }
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
    // (a cheap reject first: the segment's midpoint and half-length; laser
    // bolts ask about every creature every frame)
    const R = (reach * Math.hypot(dir.x, dir.y, dir.z)) / 2;
    const cx = origin.x + dir.x * reach / 2, cy = origin.y + dir.y * reach / 2, cz = origin.z + dir.z * reach / 2;
    for (const m of this.mobs) {
      if (m.dead || (filter && !filter(m))) continue;
      const dx = m.pos.x - cx, dz = m.pos.z - cz, lim = R + m.spec.r * 1.5 + 1;
      if (dx * dx + dz * dz > lim * lim || m.pos.y + m.spec.h + 1 < cy - R || m.pos.y - 1 > cy + R) continue;
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
    const c = this._critC;
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
    const list = this.targets ? this.targets() : null;
    this._targetList = list || this._soloList || (this._soloList = [this.localPlayer]);
    if (this._kept.length && !this.puppets) this._spawnKept();
    this._updateSpawning(dt);
    this._updateArrows(dt);
    if (this.potions.length) this._updatePotions(dt);
    const p = this.player.position;
    const daylight = this.sky.daylight;
    // Many zombies: hand them over to the crowd closer in.
    const zombieCount = this.zombies.max > 60 ? this.countKind("zombie") : 0;
    const crowdDist = zombieCount > 60 ? CROWD_DISTANCE_MANY : CROWD_DISTANCE;
    this.crowd.begin();

    const targets = list;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      // A guest's copy of the host's creature: placed from the host's states.
      if (m.net) {
        m.hurtTime += dt;
        // (Round 9 fix: the guard against one swing landing twice wears off
        // here too. It never did on a guest's copy, so after a guest's first
        // melee hit on a creature every later swing was ignored.)
        m.invulnerable = Math.max(0, m.invulnerable - dt);
        if (m.dead) m.deathTime += dt;
        this.onPuppetUpdate?.(m, dt);
        this._afterMove(m, Math.hypot(m.pos.x - p.x, m.pos.z - p.z), crowdDist);
        continue;
      }
      // Online (host): a creature thinks about the nearest player (and stays
      // while anyone is near: animals and villagers are everyone's too).
      if (targets && !m.spec.flies) this.player = this._nearestTarget(m, targets);
      try {
        this._updateMob(m, i, dt, crowdDist, daylight, targets ? Math.hypot(m.pos.x - p.x, m.pos.z - p.z) : null);
      } finally {
        this.player = this.localPlayer;
      }
    }
    this.crowd.end();
    this._separate(dt);
  }

  // One creature's step. `localDist`: its distance from this player (for
  // drawing) when it thinks about someone else.
  _updateMob(m, i, dt, crowdDist, daylight, localDist = null) {
    const p = this.player.position;
    {
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
      const drawDist = localDist ?? dist;

      if (m.dead) {
        m.deathTime += dt;
        if (m.deathTime >= DEATH_TIME) {
          this._die(i);
          return;
        }
      } else {
        if (m.abductedBy && this._abductStep(m, i, dt, drawDist, crowdDist)) return;
        // Held in another player's tractor beam (online, Round 9): it rises to
        // their ship like under this player's own beam; aboard, it is theirs.
        if (m.remoteBeam) {
          const rb = m.remoteBeam;
          if (this.time > rb.until) m.remoteBeam = null;
          else {
            m.beamLift = rb.lift;
            m.stagger = Math.max(m.stagger, 0.3);
            m.knock.x += (rb.tx - m.pos.x) * 0.05;
            m.knock.z += (rb.tz - m.pos.z) * 0.05;
            if (m.pos.y + m.spec.h >= rb.topY) {
              this._abductFx(m);
              this.onRemoteAbduct?.(m, rb.by);
              if (m.leaderDrop && !m.net) this.onLeaderDown?.(m);
              this._remove(i);
              return;
            }
          }
        }
        // Despawning: far away, in unloaded terrain, or (zombies) lingering far off.
        // (Round 9: a mission's creature never goes: in unloaded terrain it
        // just waits, frozen, until someone comes back.)
        const keep = m.persist || m.missionTarget;
        const loaded = !!this.world.getChunk(Math.floor(m.pos.x) >> 4, Math.floor(m.pos.z) >> 4);
        if (keep && !loaded && m.pos.y >= -10) {
          m.knock.set(0, 0, 0); // (_separate still pushes frozen mobs; never let it build up)
          this._place(m);
          return;
        }
        if ((dist > DESPAWN_FAR && !keep) || !loaded || m.pos.y < -10) {
          this._remove(i);
          return;
        }
        if (m.spec.hostile && !m.missionTarget && !m.persist && dist > HOSTILE_LINGER && Math.random() < dt / 20) {
          this._remove(i);
          return;
        }
        // Far away, think and move only every third frame (with the time
        // saved up), staggered so the work spreads evenly over frames.
        let step = dt;
        if (dist > LAZY_AI_DISTANCE) {
          m.lazy += dt;
          if ((this._frame + m.id) % 3 !== 0) {
            this._afterMove(m, drawDist, crowdDist);
            return;
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
          // (Round 11) A Survival world's animals' clocks, and fire and lava.
          if (isVanilla() && !m.dead) {
            this._animalTick(m, step);
            this._fireTick(m, step);
          }
        }
      }
      this._afterMove(m, drawDist, crowdDist);
    }
  }

  // Light and drawing after a mob moved: its own model up close, or a
  // place in the crowd far away (zombies).
  _afterMove(m, dist, crowdDist) {
    const l = this.world.lightAt(m.pos.x, m.pos.y + m.spec.h * 0.6, m.pos.z);
    m.light.sky = l.sky;
    m.light.block = l.block;
    const crowd = m.kind === "zombie" && !m.dead && !m.baby && dist > crowdDist;
    if (crowd !== m.crowd) {
      m.crowd = crowd;
      m.model.root.visible = !crowd;
    }
    if (crowd) {
      // (Sky light as is: the crowd's shader already dims it at night, as for
      // the full models; dimmed here too, they went dark at the hand-over.)
      const bright = Math.max(l.block / 15, l.sky / 15);
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
    if (this._audioDist(m) < 24) this._voice(m, "idle");
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
      const c = this._burnC;
      const c2 = this._burnC2;
      this.effects.glow.spawn({
        x: m.pos.x + (Math.random() - 0.5) * 0.5, y: m.pos.y + Math.random() * m.spec.h, z: m.pos.z + (Math.random() - 0.5) * 0.5,
        vy: 1 + Math.random(), life: 0.5, size0: 0.35, size1: 0.1, color0: c, color1: c2,
      });
    }
  }

  // Positions and animates the model.
  _place(m) {
    const model = m.model;
    if (m.dead && m.carryMesh) this.setCarry(m, 0);
    model.root.position.copy(m.pos);
    model.root.rotation.y = m.yaw;
    // Hit flash (red), burning (orange), and a red, tipping-over death.
    const hurt = Math.max(0, 1 - m.hurtTime / 0.3);
    const f = m.light.flash;
    if (m.dead) f.setRGB(0.55, 0, 0);
    else if (hurt > 0) f.setRGB(0.6 * hurt, 0, 0);
    else if (m.fuse > 0) {
      // (Round 11) A creeper about to burst flashes white, faster and faster.
      const k = Math.min(1, m.fuse / CREEPER_FUSE);
      const on = Math.sin(m.fuse * (8 + k * 22)) > 0 ? 0.25 + k * 0.6 : 0;
      f.setRGB(on, on, on);
    } else if (m.burning) f.setRGB(0.25, 0.08, 0);
    else f.setRGB(0, 0, 0);
    if (m.kind === "creeper") {
      const k = Math.min(1, m.fuse / CREEPER_FUSE);
      model.root.scale.set(1 + k * 0.28, 1 + k * 0.1, 1 + k * 0.28);
    } else if (m.kind === "sheep" && model.parts.wool) {
      model.parts.wool.visible = !m.sheared;
      model.parts.woolHead.visible = !m.sheared;
    } else if (m.kind === "wolf" && model.parts.collar) model.parts.collar.visible = !!m.tamed;
    if ((m.carry || 0) !== (m.carryShown || 0)) this._showCarried(m);
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
      aim: m.ai.target || m.angerT > 0 ? 1 : 0,
      perch: m.perch ?? 0,
      carry: m.carry || m.drinkT > 0 ? 1 : 0,
      sit: m.sitting ? 1 : 0,
      tamed: m.tamed ? 1 : 0,
    });
  }

  // (Round 11) An enderman's block, held out in its hands.
  _showCarried(m) {
    if (m.carryMeshB) {
      m.carryMeshB.parent?.remove(m.carryMeshB);
      m.carryMeshB = null;
    }
    m.carryShown = m.carry || 0;
    const body = m.model.parts.body;
    const model = m.carry ? itemModel(m.carry) : null;
    if (!model || !body) return;
    const mat = this.entities.materials?.[model.kind];
    if (!mat) return;
    const mesh = new THREE.Mesh(model.geometry, mat);
    mesh.scale.setScalar(model.cube ? 0.62 : 0.8);
    mesh.position.set(0, -0.5, 0.8);
    mesh.castShadow = true;
    body.add(mesh);
    bindEntityLight(mesh, () => m.light);
    m.carryMeshB = mesh;
  }
}
