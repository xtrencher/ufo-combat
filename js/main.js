import { WORLD_HEIGHT } from "./constants.js";
import * as THREE from "three";
import { World, SEA_LEVEL } from "./world.js";
import { Player, MAX_HEALTH, MAX_AIR } from "./player.js";
import { UI, isMobileDevice } from "./ui.js";
import { BLOCK, BLOCK_INFO, IS_WET } from "./blocks.js";
import { Audio } from "./audio.js";
import { Sky } from "./sky.js";
import { loadEdits, saveEdits, loadSettings, saveSettings, setActiveSeed, setStorageFullHandler, loadPlayer, savePlayer, loadBootRecord, saveBootRecord, loadJSON, saveJSON, hasSavedWorld } from "./storage.js";
import { EffectsSystem } from "./effects.js";
import { PostFX } from "./postfx.js";
import { PRESETS, PRESET_ORDER, DEFAULT_PRESET, applyPreset, normalizePreset, lowerPreset, resolvePreset, GFX_OPTIONS } from "./graphics.js";
import { normalizeSettings, DEFAULT_SETTINGS, SCHEMA, SettingsPanel, AUDIO_CATEGORIES, DIFFICULTY_DAMAGE, formatHours } from "./settings.js";
import { PlayerAvatar } from "./player-avatar.js";
import { BIOME_NAMES } from "./biomes.js";
import { worldUniforms } from "./shaders.js";
import { Inventory, HOTBAR_SIZE, makeStack } from "./inventory.js";
import { itemInfo, SURVIVAL_LOADOUT, CREATIVE_LOADOUT, ITEM } from "./items.js";
const ITEM_GOLDEN_APPLE = ITEM.GOLDEN_APPLE;
import { IconCache } from "./slot-view.js";
import { Hud } from "./hud.js";
import { InventoryScreen } from "./inventory-ui.js";
import { ItemEntities } from "./entities.js";
import { HeldItem } from "./held-item.js";
import { Interaction } from "./interaction.js";
import { MobManager } from "./mobs.js";
import { isUnderwater, surfaceHeight } from "./water.js";
import { FallingBlocks } from "./falling.js";
import { WaterSim } from "./watersim.js";
import { WeaponSystem, RAIL_DAMAGE_UFO } from "./weapons.js";
import { LaserBolts, sweptSphere, sweptBox } from "./lasers.js";
import { BulletHoles } from "./decals.js";
import { GRENADE_RADIUS, explosionScale, effectsQuality } from "./effects.js";
import { LodSystem } from "./lod.js";
import { DistantStructures } from "./distant.js";
import { GrassField } from "./grass.js";
import { UnderwaterMotes } from "./motes.js";
import { MenuScreens, MenuFlyover, MenuPerf, renderControls } from "./menu.js";
import { MouseChord, Binoculars } from "./binoculars.js";
import { Mods } from "./mods.js";
import { VehicleManager } from "./vehicles.js";
import "./vehicle-ufo.js";
import { JET_TYPES } from "./vehicle-jet.js";
import { Radar } from "./radar.js";
import { EnemyJetManager } from "./enemy-jets.js";
import { AirportManager } from "./airports.js";
import { Progress, MISSIONS, rollLoot, rollArmorDrop, alienColour } from "./progression.js";
import { MissionDirector } from "./missions.js";
import { SupplyCrates } from "./crates.js";
import { NukeSystem } from "./nuke.js";
import { UfoManager } from "./ufos.js";
import { UFO_DESIGNS, UFO_DESIGN_NAMES, createUfoModel } from "./ufo-models.js";
import { createJetModel } from "./jet-model.js";
import { TractorBeam } from "./tractor-beam.js";
import { Stats, formatPlayTime } from "./stats.js";
import { DEATH_MESSAGES, isPlayerCause, boltCause, pilotCause } from "./damage.js";
import { FullscreenControl } from "./fullscreen.js";
import { NetSession, normalizeRoomCode } from "./net/session.js";
import { bootJoin, inviteUrl, hideBootJoin } from "./net/boot-join.js";
import { Multiplayer } from "./net/multiplayer.js";

// ---------- Seed ----------
// ?seed=N opens that world. Without it, the last world played is loaded
// (the main menu offers to continue it); on a first visit, a random one.
function parseSeedFromURL() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("seed");
  if (raw !== null && raw !== "" && !Number.isNaN(Number(raw))) {
    return Math.abs(Math.floor(Number(raw))) >>> 0;
  }
  const last = loadJSON("last");
  if (last && Number.isInteger(last.seed) && last.seed >= 0) return last.seed >>> 0;
  return randomSeed();
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647) >>> 0;
}

// ---------- Startup ----------
// index.html shows a loading message until the game has started, and any
// error before that (see __ufoBoot there).
function bootDone() {
  window.__ufoBoot?.done();
}
function bootFail(title, help, detail) {
  window.__ufoBoot?.fail(title, help, detail);
}

// ---------- Mobile guard ----------
if (isMobileDevice()) {
  bootDone();
  document.getElementById("mobile-block").classList.remove("hidden");
  throw new Error("UFO COMBAT: mobile device detected, game not started.");
}

// ---------- Multiplayer: joining ----------
// ?join=CODE (an invite link, or the Join screen): connect to the host before
// anything is built, since its welcome carries the world's seed. A guest's
// session never reads or writes the guest's own saved worlds.
const net = new NetSession();
const JOIN_PARAM = new URLSearchParams(window.location.search).get("join");
const joinWelcome = JOIN_PARAM !== null ? await bootJoin(net, normalizeRoomCode(JOIN_PARAM)) : null;
const GUEST = !!joinWelcome;
const SEED = GUEST ? Number(joinWelcome.seed) >>> 0 : parseSeedFromURL();

// ---------- Renderer / scene / camera ----------
const canvas = document.getElementById("game-canvas");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch (err) {
  bootFail(
    "WebGL couldn't start",
    "The browser couldn't set up WebGL for the 3D view. Check that hardware acceleration is turned on in the browser's settings, update the browser and the graphics driver, then restart the browser completely: after a graphics driver crash, browsers keep WebGL turned off for a while.",
    String(err?.message || err)
  );
  throw err;
}
if (!renderer.capabilities.isWebGL2) {
  bootDone();
  document.getElementById("webgl-block").classList.remove("hidden");
  throw new Error("UFO COMBAT: WebGL 2 is required.");
}
// The graphics driver can drop the WebGL context (a frame that took far too
// long, a driver crash); nothing can be drawn after that (see onGraphicsLost).
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  onGraphicsLost();
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Used only when post-processing is off (Low preset); otherwise the
// composite pass tone-maps with the same ACES curve.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false; // reset once per frame, so the F3 stats cover every pass

const scene = new THREE.Scene();

// ---------- Settings ----------
// Chunks. Beyond each preset's detail distance, terrain is drawn as
// simplified level-of-detail tiles (see lod.js).
const DEFAULT_RENDER_DISTANCE = 15;
const MIN_RENDER_DISTANCE = 2;
const MAX_RENDER_DISTANCE = 256; // (Round 3: was 100) beyond the detail area it is all cheap LOD tiles
// The saved settings are read first, before any default, graphics preset
// or menu value is applied: everything below starts from them, and they
// always win. (normalizeSettings validates every value, falls back to the
// default for anything missing or broken, and upgrades older versions.)
setActiveSeed(SEED);
const SETTINGS_OPTIONS = {
  presets: PRESET_ORDER,
  defaultPreset: DEFAULT_PRESET,
  minRenderDistance: MIN_RENDER_DISTANCE,
  maxRenderDistance: MAX_RENDER_DISTANCE,
  isOverride: (key, value) => !!GFX_OPTIONS[key]?.choices.some(([c]) => c === value),
};
const settings = normalizeSettings(loadSettings(), SETTINGS_OPTIONS);
// Written back at once in the current format (and in its reserved slot, see storage.js).
let settingsSaveWarned = false;
function persistSettings() {
  if (!saveSettings(settings) && !settingsSaveWarned) {
    settingsSaveWarned = true;
    setTimeout(() => toast?.("Browser storage is full: your settings can't be saved. Free some space (site data) to keep them.", 8), 0);
  }
}
setStorageFullHandler(({ evicted, ok }) => {
  if (ok && evicted.length) setTimeout(() => toast?.(`Browser storage was full: the saved block changes of ${evicted.length} other world${evicted.length > 1 ? "s" : ""} were removed to keep your settings.`, 8), 0);
});
persistSettings();

function clampRenderDistance(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_RENDER_DISTANCE;
  return Math.max(MIN_RENDER_DISTANCE, Math.min(MAX_RENDER_DISTANCE, n));
}

let renderDistance = clampRenderDistance(settings.renderDistance ?? DEFAULT_RENDER_DISTANCE);
// The distance actually drawn (chunks): the setting, boosted while flying a
// jet or UFO high above the ground (see updateAltitudeView).
let viewRD = renderDistance;
// ?graphics=low|medium|high|ultra picks the graphics preset (and keeps it),
// e.g. to get going again on a computer that struggles with the default.
// Like picking a preset in the menu, it clears individual graphics options.
const urlGraphics = new URLSearchParams(window.location.search).get("graphics");
const urlPreset = PRESET_ORDER.includes(urlGraphics) ? urlGraphics : null;
if (urlPreset) settings.gfxOverrides = {};
let graphicsPreset = normalizePreset(urlPreset ?? settings.graphics);
// Safe start: if the last start never got as far as drawing the world at
// this preset (the tab hung, or the graphics driver gave up, typically while
// compiling the shaders of a heavy preset), this one steps down a level for
// this session only. The step-down is NEVER written into the saved settings
// (`graphicsLowered` keeps setGraphics from persisting it, and the saved
// individual options stay untouched): the player's chosen graphics survive a
// bad start, a sleeping laptop, or a reload during shader compilation. Only
// picking a preset (or options) again in a menu changes what's saved.
let startNotice = "";
let graphicsLowered = false;
const lastBoot = loadBootRecord();
if (!urlPreset && lastBoot && lastBoot.ok === false && lastBoot.preset === graphicsPreset && lowerPreset(graphicsPreset) !== graphicsPreset) {
  graphicsPreset = lowerPreset(graphicsPreset);
  graphicsLowered = true;
  startNotice = `The last start didn't get as far as showing the world, so graphics are lowered to ${PRESETS[graphicsPreset].label} for this session. Your saved graphics setting is unchanged; pick a preset in Settings to keep a different one.`;
}
// The preset with the user's individual graphics options applied (a lowered
// start ignores them, since they could keep the heavy features on).
let activePreset = resolvePreset(graphicsPreset, graphicsLowered ? {} : settings.gfxOverrides);


// Built-in three.js materials (debris, particles) use this fog; the world's
// own shaders use the shared uniforms in shaders.js (same distances).
scene.fog = new THREE.Fog(0x9fc3e8, 60, 150);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.layers.enableAll(); // world, water and effects (postfx.js splits them into passes when needed)

// Fog ends at the render distance; the far plane reaches past it (and past
// the sky dome) so distant terrain isn't clipped before it has faded out.
function updateViewDistance() {
  const end = (viewRD - 0.3) * 16;
  const start = end * 0.72;
  worldUniforms.uFog.value.set(start, end, 0.0024, 0.0);
  scene.fog.near = start;
  scene.fog.far = end;
  camera.far = Math.max(1000, viewRD * 16 * 1.3 + 100);
  camera.updateProjectionMatrix();
}
updateViewDistance();

// The light rig never changes shape at runtime (adding/removing lights would
// force every lit material to recompile): one shadow-casting directional
// light (sun or moon), one hemisphere light for built-in materials.
const hemiLight = new THREE.HemisphereLight(0xbfd6ff, 0x3a3228, 1);
scene.add(hemiLight);
hemiLight.layers.enableAll(); // lights shine in every render pass (see layers.js)
const sunLight = new THREE.DirectionalLight(0xffffff, 1);
sunLight.layers.enableAll();
scene.add(sunLight);
scene.add(sunLight.target);
// Two more sun shadow cascades (larger, coarser maps). They give no light
// of their own; only their shadow maps are used (see SUN_SHADOW in shaders.js).
const cascadeLights = [1, 2].map(() => {
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.layers.enableAll();
  scene.add(light);
  scene.add(light.target);
  return light;
});

const postfx = new PostFX(renderer);
const drawingSize = new THREE.Vector2();
let held = null;
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.getDrawingBufferSize(drawingSize);
  postfx.setSize(drawingSize.x, drawingSize.y);
  if (held) held.resize(camera.aspect);
}
window.addEventListener("resize", onResize);

// ---------- World ----------
const world = new World(scene, SEED);
if (!GUEST) world.loadEdits(loadEdits(SEED));
postfx.setWaterMaterial(world.materials.water);
world.meshOptions.fancyLeaves = activePreset.fancyLeaves; // before the first chunks are meshed
// Decides which chunks are meshed and shown, and draws the land beyond them.
const lod = new LodSystem(scene, world, SEED);
lod.configure({ renderDistance, detailDistance: activePreset.detailDistance });
// 3D grass blades near the player (High/Ultra).
const grass = new GrassField(scene, world);
// Airports, cities and villages seen from far away, and airport lights at night (Round 8).
const distant = new DistantStructures({ scene, world, material: lod.material });
distant.zones = () => nuke.zones;

// Plans chunk streaming and LOD tiles around a position (cheap when nothing changed).
function streamAround(x, z) {
  lod.plan(x, z);
  world.ensureChunksAround(x, z, lod.worldPlan);
}

let pendingSave = false;
let lastSaveTime = 0;
world.onEdit = () => {
  pendingSave = true;
};

// Encoded form of each edited chunk, reused between saves so only chunks
// changed since the last save get re-encoded.
const encodedEditCache = new Map();

const [spawnX, spawnZ] = world.terrain.spawnColumn();

// A saved player (position, inventory, ...) for this world, if any.
const savedPlayer = GUEST ? null : loadPlayer(SEED);
const savedPos = Array.isArray(savedPlayer?.pos) && savedPlayer.pos.length === 3 && savedPlayer.pos.every(Number.isFinite) ? savedPlayer.pos : null;
const startX = savedPos ? savedPos[0] : spawnX + 0.5;
const startZ = savedPos ? savedPos[2] : spawnZ + 0.5;

// Synchronously generate just the chunks right around the start so the
// player never falls through unloaded terrain; everything else out to the
// full render distance streams in over the next frames (while the start
// menu is showing), instead of freezing the page for seconds at startup.
const INITIAL_SYNC_RADIUS = 2;
world.prepareArea(startX, startZ, INITIAL_SYNC_RADIUS);
streamAround(startX, startZ);

// Main-thread milliseconds per frame spent generating/meshing chunks. Larger
// while a menu is open (nothing to keep smooth), smaller while playing.
const STREAM_BUDGET_PLAYING_MS = 5;
const STREAM_BUDGET_MENU_MS = 14;

// ---------- Player, inventory, HUD ----------
const ui = new UI();
ui.renderDistanceInput.min = String(MIN_RENDER_DISTANCE);
ui.renderDistanceInput.max = String(MAX_RENDER_DISTANCE);
ui.renderDistanceInput.value = String(renderDistance);
ui.renderDistanceValueEl.textContent = String(renderDistance);
ui.graphicsSelect.value = graphicsPreset;

// Sub-screens of the main and pause menus (settings, mods, controls, stats).
const screens = new MenuScreens();
// The settings screen (tabs, rows built from the schema in settings.js).
const settingsPanel = new SettingsPanel(settings, persistSettings);
// Per-weapon explosion-size multipliers.
for (const kind of ["grenade", "bazooka", "airstrike"]) settingsPanel.on(`explosionScale.${kind}`, (v) => (explosionScale[kind] = v));

const player = new Player(camera, world, canvas);
const inventory = new Inventory();
const audio = new Audio();
const sky = new Sky(scene, sunLight, hemiLight, cascadeLights);
const effects = new EffectsSystem(scene, world, audio);
const icons = new IconCache(world.tileCanvases);
const hud = new Hud({ icons, inventory });
const entities = new ItemEntities(scene, world);
held = new HeldItem(world.atlas);
held.resize(camera.aspect);
const interaction = new Interaction({ scene, world, player, inventory, entities, audio, effects, held });
const invScreen = new InventoryScreen({ icons, inventory, audio });
interaction.onCut = (x, y, z, n) => {
  if (n[1] > 0 && grass.density > 0) grass.clear(x, z, 1.2);
};
const mobs = new MobManager({ scene, world, player, entities, audio, effects, sky });
// The player's own body, drawn in the third-person camera modes (F5).
const avatar = new PlayerAvatar(scene, world.atlas);
const falling = new FallingBlocks(scene, world);
const waterSim = new WaterSim(world);
const decals = new BulletHoles(scene, world);
// Laser bolts (the blaster; later UFOs and aliens), with scorch marks.
const scorches = new BulletHoles(scene, world, { kind: "scorch" });
const lasers = new LaserBolts({ scene, world, effects, decals: scorches, audio });
lasers.listener = () => effects.listener;
lasers.holes = decals; // (the pistol's bullets leave bullet holes)
const bloodColor = new THREE.Color(0.45, 0.04, 0.04);
lasers.addProvider({
  // (Online, a bolt fired on another machine never hits creatures here: its shooter or the host judged that.)
  ignores: (b) => b.mirror,
  raycast(origin, dir, maxDist, bolt) {
    const hit = mobs.raycast(origin, dir, maxDist, (m) => !m.isRemotePlayer && m !== bolt.source && !(bolt.owner === "alien" && (m.spec.alien || m.spec.sentry)));
    if (!hit) return null;
    return {
      distance: hit.distance,
      hit(b, point, d) {
        // (Round 9: an alien's, a UFO's or a fighter's bolt is no player's kill.)
        const mine = fromPlayer(b.owner);
        if (mobs.shoot(hit.mob, b.damage, d, 2.5, mine) && mine) hud.hitMarker?.();
        for (let i = 0; i < 6; i++) effects.debris.spawn(point.x, point.y, point.z, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.05, bloodColor, 0.5);
      },
    };
  },
});
const weapons = new WeaponSystem({ scene, world, player, effects, audio, mobs, held, decals, inventory, lasers });
settingsPanel.on("weapons.blasterColor", (v) => (weapons.blasterColor = v));
for (const k of ["count", "spread", "delay", "angle", "speed"]) settingsPanel.on(`weapons.airstrike.${k}`, (v) => (weapons.airstrike.config[k] = v));
// The Mods switch (see mods.js); applied once the saved inventory is loaded.
const mods = new Mods({ inventory, weapons, lasers, entities });

// ---------- Vehicles, UFOs, stats ----------
const stats = new Stats();
const vehicles = new VehicleManager({ scene, world, player, effects, audio, lasers, mobs, inventory, entities });
vehicles.cameraRef = camera;
const ufos = new UfoManager({ scene, world, player, effects, audio, lasers, mobs, vehicles, sky, camera });
mobs.lasers = lasers;

// UFOs: activity and the advanced options.
for (const k of ["activity", "spawnChance", "maxCount", "aggression", "detection", "beamLift", "sizes", "nightMultiplier", "toughness"]) {
  settingsPanel.on(`ufos.${k}`, (v) => (ufos.config[k] = v));
}
// Your UFO: speed range, ghost mode, beam lifting blocks.
vehicles.config.ufo = { minSpeed: 2, maxSpeed: 300, ghost: false, beamBlocks: true, dash: 1, dashTime: 0.25 };
settingsPanel.on("vehicles.ufoTopSpeed", (v) => (vehicles.config.ufo.maxSpeed = v));
settingsPanel.on("vehicles.ufoMinSpeed", (v) => (vehicles.config.ufo.minSpeed = v));
settingsPanel.on("vehicles.ufoGhost", (v) => (vehicles.config.ufo.ghost = v));
// G while piloting switches it (the Settings row follows).
// G in a UFO switches ghost mode in every mode. (Round 8 fix: the setting is a
// Creative rule, fixed at "off" in Survival, so the key did nothing there,
// and "Steal the ship" needs it: the key now switches the ship itself too.)
vehicles.onGhostToggle = (v) => {
  settingsPanel.set("vehicles.ufoGhost", v);
  vehicles.config.ufo.ghost = v;
};
settingsPanel.on("vehicles.ufoDash", (v) => (vehicles.config.ufo.dash = v));
settingsPanel.on("vehicles.ufoDashTime", (v) => (vehicles.config.ufo.dashTime = v));
settingsPanel.on("vehicles.beamBlocks", (v) => (vehicles.config.ufo.beamBlocks = v));
// The jet: speed, thrust, turn rate, stall speed, flight assist, arrival.
vehicles.config.jet = { maxSpeed: 300, accel: 1, turnRate: 1, stallSpeed: 42, assist: true, airborne: false, aimAssist: true };
settingsPanel.on("vehicles.jetMaxSpeed", (v) => {
  vehicles.config.jet.maxSpeed = v;
  ufos.jetMaxSpeed = v;
});
settingsPanel.on("vehicles.jetAccel", (v) => (vehicles.config.jet.accel = v));
settingsPanel.on("vehicles.jetTurn", (v) => (vehicles.config.jet.turnRate = v));
settingsPanel.on("vehicles.jetStall", (v) => (vehicles.config.jet.stallSpeed = v));
settingsPanel.on("vehicles.jetAssist", (v) => (vehicles.config.jet.assist = v));
settingsPanel.on("vehicles.jetAimAssist", (v) => (vehicles.config.jet.aimAssist = v));
// Airports and cities (sites.js): aircraft parked on the aprons, runways to call the jet to.
const airports = new AirportManager({ sites: world.terrain.sites, vehicles, world, player, mobs });
// Enemy jets (patrolling neutral, hostile once provoked).
const enemyJets = new EnemyJetManager({ vehicles, ufos, player, world });
enemyJets.onDown = (jet, cause) => {
  // (Only the player's kills count: a jet shot down by a UFO it attacked isn't.)
  if (!jet.downedByOther) {
    stats.add("enemyJetsDown");
    if (hooks.onEnemyJetDown) hooks.onEnemyJetDown(jet, cause);
  }
};
const hooks = {}; // late-bound game hooks (progression), see below
settingsPanel.on("vehicles.enemyJets", (v) => (enemyJets.config.count = v));
// The nuke dropped from the jet.
const nuke = new NukeSystem({ scene, world, effects, audio });
vehicles.nuke = nuke;
vehicles.ufos = ufos;
settingsPanel.on("weapons.nukeSize", (v) => (nuke.config.size = v));
settingsPanel.on("weapons.nukeIntensity", (v) => (nuke.config.intensity = v));
nuke.onDetonate = (center, R, info = {}) => {
  hooks.onNuke?.(center, R);
  if (!info.mirror) stats.add("nukes");
  // (Round 9) Another player's nuke, with the host's PvP rule off: it doesn't
  // hurt you or your aircraft (like their other blasts; its crater and the
  // mission's credit still count).
  if (info.mirror && info.by && info.by !== net.pid && !mp.pvpAllowed()) return;
  // Damage reach: the crater grows with the nuke's size, the reach of the blast on creatures,
  // ships and you only slowly (a size-96 nuke does not kill across 250 blocks).
  // (Online, another player's nuke only hurts this player and their vehicle here.)
  const Rd = 44 * Math.pow(R / 44, 0.45);
  if (!info.mirror) {
    mobs.explosion(center, Math.max(R * 1.2, Rd * 1.4), true);
    ufos.explosion(center, Rd * 2.2, true);
    vehicles.explosion(center, Rd * 1.6);
  } else if (vehicles.active) {
    if (info.by && info.by !== net.pid) {
      vehicles.active.lastHitByPid = info.by;
      vehicles.active.lastHitByT = performance.now();
    }
    vehicles.explosionOn(vehicles.active, center, Rd * 1.6, "explosion_other");
  }
  // The player: deadly within about twice the crater radius, thrown far.
  if (!player.dead && !player.vehicle) {
    const off = player.position.clone().sub(center);
    const d = off.length();
    if (d < Rd * 2.6) {
      const f = 1 - d / (Rd * 2.6);
      // (Another player's nuke: theirs, in the death message. Round 9.)
      const src = info.mirror && info.by && info.by !== net.pid ? `nuke@${info.by}` : "nuke";
      if (player.damage(Math.ceil(70 * f * f + 2), src, { pierce: true })) {
        lastBlastHitTime = performance.now();
        lastBlastSource = src;
      }
      off.y = Math.max(off.y, 0) + d * 0.3;
      player.applyImpulse(off.normalize().multiplyScalar(40 * f));
    }
  }
};
vehicles.onMissileHit = () => stats.add("missilesHit");
vehicles.onNukeDropped = () => {};
settingsPanel.on("sensitivity", (v) => (vehicles.mouseSensitivity = v));
settingsPanel.on("invertY", (v) => (vehicles.invertY = v));

// What bullets, rockets, grenades, lasers and meteors can hit besides
// blocks and creatures: UFOs, and vehicles.
const fromPlayer = (owner) => owner === "player" || owner === "playerufo" || owner === "jet";
const hullSparkColor = new THREE.Color(2.2, 1.6, 0.8);
function ufoHitFx(point) {
  for (let i = 0; i < 6; i++) effects.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 8, life: 0.3, size0: 0.14, size1: 0.03, color0: hullSparkColor, gravity: 0.5, drag: 2 });
}
const ufoTarget = {
  raycast(origin, dir, maxDist) {
    const h = ufos.raycast(origin, dir, maxDist);
    if (!h) return null;
    return {
      distance: h.distance,
      hit(damage, d, point) {
        ufos.damage(h.ufo, damage, true, point);
        audio.playUfoHit(point.distanceTo(effects.listener));
        hud.hitMarker?.();
      },
    };
  },
  sphereHit: (p, r) => !!ufos.sphereHit(p, r),
};
const vehicleTarget = {
  raycast(origin, dir, maxDist) {
    const h = vehicles.raycast(origin, dir, maxDist, vehicles.active);
    return h && { distance: h.distance, hit: (damage) => h.vehicle.damage(damage, "player") };
  },
  sphereHit: (p, r) => {
    const v = vehicles.sphereHit(p, r);
    return !!v && v !== vehicles.active;
  },
};
weapons.targets.push(ufoTarget, vehicleTarget);
// The railgun's beam goes through everything: every UFO and vehicle on the line.
weapons.pierce.push({
  all(origin, dir, range) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < 24; i++) {
      const h = ufos.raycast(origin, dir, range, (u) => !seen.has(u));
      if (!h) break;
      seen.add(h.ufo);
      out.push({
        distance: h.distance,
        hit(damage, d, point) {
          ufos.damage(h.ufo, RAIL_DAMAGE_UFO, true, point);
          audio.playUfoHit(point.distanceTo(effects.listener));
          hud.hitMarker?.();
        },
      });
    }
    // Every vehicle on the line (Round 8: it used to stop at the first).
    if (vehicles.enabled) {
      for (const v of vehicles.vehicles) {
        if (!v.alive || v === vehicles.active) continue;
        const t = v.raycast(origin, dir, range);
        if (t !== null) out.push({ distance: t, hit: (damage) => v.damage(damage, "player") });
      }
    }
    return out;
  },
});
// What the bazooka can lock onto: UFOs, vehicles and creatures.
weapons.getLockables = () => {
  const list = [];
  for (const u of ufos.ufos) {
    if (u.state === "gone" || u.falling) continue;
    list.push({ ref: u, radius: u.radius, center: (o) => o.copy(u.pos), alive: () => u.state !== "gone" && !u.falling });
  }
  for (const v of vehicles.vehicles) {
    if (!v.alive || v === vehicles.active || !vehicles.enabled) continue;
    list.push({ ref: v, radius: v.hitRadius ?? v.radius, center: (o) => o.copy(v.pos), alive: () => v.alive });
  }
  for (const m of mobs.mobs) {
    if (m.dead) continue;
    list.push({ ref: m, radius: Math.max(m.spec.r, m.spec.h * 0.4), center: (o) => o.set(m.pos.x, m.pos.y + m.spec.h * 0.5, m.pos.z), alive: () => !m.dead });
  }
  return list;
};
// Armor worn: it turns away 4% of the damage per defense point (up to 80%
// with a full diamond set) and wears out as it takes hits. It does nothing
// against the environment (falls, drowning, the void, starving) or crashes
// and the nuke.
const ARMOR_PASS = new Set(["fall", "drown", "void", "starve", "jet_crash", "jet_down", "ufo_down", "abducted", "nuke"]);
player.damageFilter = (amount, cause) => {
  if (player.creative || ARMOR_PASS.has(cause)) return amount;
  const red = inventory.armorReduction();
  if (red <= 0) return amount;
  const out = Math.max(1, Math.round(amount * (1 - red)));
  const broken = inventory.damageArmor(Math.max(1, Math.floor(amount / 4)));
  if (broken.length) {
    for (const n of broken) toast(`Your ${n} broke!`, 2.5);
    audio.playClick?.();
  }
  markInventoryChanged();
  return out;
};
weapons.airstrike.targets.push(ufoTarget);
lasers.addProvider({
  ignores: (b) => ((b.owner === "ufo" || b.owner === "enemyjet") && !b.friendlyFire) || b.mirror,
  raycast(origin, dir, maxDist, bolt) {
    const h = ufos.raycast(origin, dir, maxDist, (u) => u !== bolt.source);
    if (!h) return null;
    return {
      distance: h.distance,
      hit(b, point) {
        ufos.damage(h.ufo, b.damage, fromPlayer(b.owner), point, b.owner === "rogue" ? b.source : null);
        ufoHitFx(point);
        audio.playUfoHit(point.distanceTo(effects.listener));
        if (fromPlayer(b.owner)) hud.hitMarker?.();
      },
    };
  },
});
// Vehicles: tested in each vehicle's own frame of motion (a jet moves
// several blocks a frame), with the bolt's glow counting as part of it, so
// a bolt that visibly reaches a vehicle always hits it.
lasers.addProvider({
  // Online: another machine's bolt only hits our own vehicle here (an AI's
  // shot is judged by the player it is aimed at); another player's shots
  // were judged by them. Our own shots hit the other players' vehicles (and
  // the claim goes to them); the host's AI never hits them here.
  ignores: (b) => b.mirror && fromPlayer(b.owner),
  raycast(origin, dir, maxDist, bolt, dt) {
    if (!vehicles.enabled) return null;
    const step = Math.max(maxDist, bolt.step ?? maxDist);
    let best = null;
    for (const v of vehicles.vehicles) {
      if (!v.alive || v === bolt.source) continue;
      if (bolt.mirror ? v !== vehicles.active : v.puppet && !fromPlayer(bolt.owner)) continue;
      const r = (v.hitRadius ?? v.radius) + bolt.radius * 2;
      const t = sweptSphere(origin, dir, step, v.pos, r, v.vel, dt);
      if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { vehicle: v, distance: t };
    }
    if (!best) return null;
    const h = best;
    return { distance: h.distance, hit: (b) => h.vehicle.damage(b.damage, fromPlayer(b.owner) ? "player" : boltCause(b)) };
  },
});
// Enemy bolts hit the player on foot.
const playerBoxMin = new THREE.Vector3();
const playerBoxMax = new THREE.Vector3();
lasers.addProvider({
  ignores: (b) => fromPlayer(b.owner),
  raycast(origin, dir, maxDist, bolt, dt) {
    if (player.dead || player.vehicle) return null;
    // The body, grown by the bolt's glowing halo: a bolt that visibly
    // touches you hits you. Tested while you move (sprinting sideways
    // doesn't let a bolt slip through between two frames; dodging early
    // still works because the shot flies where you were going to be).
    const p = player.position;
    const pad = 0.12 + (bolt.radius ?? 0.1) * 2.2;
    playerBoxMin.set(p.x - 0.35 - pad, p.y - pad * 0.5, p.z - 0.35 - pad);
    playerBoxMax.set(p.x + 0.35 + pad, p.y + 1.85 + pad, p.z + 0.35 + pad);
    const step = Math.max(maxDist, bolt.step ?? maxDist);
    const t = sweptBox(origin, dir, step, playerBoxMin, playerBoxMax, player.velocity, dt);
    if (t === null || t > maxDist) return null;
    return {
      distance: t,
      hit(b, point, d) {
        // Every shot that reaches you hurts (no grace time between shots).
        if (player.damage(b.damage, boltCause(b), { projectile: true, from: point.clone().addScaledVector(d, -4) })) player.applyImpulse(new THREE.Vector3(d.x * 3, 1.5, d.z * 3));
      },
    };
  },
});
// The UFO cannon's bolts (and big enemy ones) blow small holes. (A bolt from
// another machine online: its blast arrives from there.)
lasers.onBlast = (point, bolt) => {
  if (!bolt.mirror) effects.explode(point, { radius: bolt.blast, source: bolt.owner === "playerufo" ? "ufocannon" : /^alien_red/.test(bolt.cause || "") ? "alien_plasma" : "ufo_blast" });
};

// Messages across the middle of the screen.
const toastEl = document.getElementById("hud-toast");
let toastTimer = null;
function toast(text, seconds = 3) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), seconds * 1000);
}
vehicles.onMessage = (t) => toast(t);
let lastAlarmToast = -99;
mobs.onAlarm = () => {
  const now = performance.now() / 1000;
  if (now - lastAlarmToast > 20) toast("Restricted area! Guards are firing!", 3);
  lastAlarmToast = now;
};
ufos.onMessage = (t) => toast(t, 2.5);
vehicles.onAbduct = () => stats.add("animalsAbducted");
// A UFO shot down by a player. (Online the host also counts the other
// players' kills for the shared missions: `mine` false, `inJet` theirs; the
// loot is everyone's own, see lootFor.)
function ufoKilled(u, { mine = true, inJet = vehicles.active?.type === "jet" } = {}) {
  const add = mine ? (k) => stats.add(k) : (k) => stats.addWorld(k);
  add("ufosDown");
  if (u.size === "mothership" || u.size === "giant") add("ufosDownBig");
  if (u.S.idx >= 2) add("ufosDownLarge");
  if (inJet) add("ufosDownByJet");
  hooks.onUfoDown?.(u);
  if (mine) audio.playNotice();
}
// The loot of a kill, for this player (Survival): what falls out gets better
// as the missions go on. kind: "ufo" (detail: its size), "alien", "zombie",
// "guard", "skeleton", "enemyjet". into: straight into the hold (a ship
// swallowed by this player's tractor beam).
function lootFor(kind, detail, at, { into = false, leaderDrop = null } = {}) {
  if (player.creative || player.dead) return;
  const pos = at.isVector3 ? at : new THREE.Vector3(at[0], at[1], at[2]);
  if (kind === "ufo") {
    if (!mods.enabled) return;
    const loot = rollLoot("ufo", detail, progressTier(), ownedItems());
    if (into) giveLoot(loot);
    else dropLoot(loot, pos);
  } else if (kind === "enemyjet") {
    if (!mods.enabled) return;
    const loot = rollLoot("enemyjet", null, progressTier(), ownedItems());
    if (into) giveLoot(loot);
    else dropLoot(loot, pos.clone().setY(Math.max(pos.y - 2, 3)));
  } else if (kind === "alien") {
    if (!mods.enabled) return;
    // (A mission patrol's leader drops its weapon however it dies: mobs.onLeaderDown below.)
    void leaderDrop;
    dropLoot(rollLoot("alien", detail, progressTier(), ownedItems()), pos);
    dropArmor(detail, pos);
  } else if (kind === "guard" || kind === "zombie") dropArmor(kind, pos);
  else if (kind === "skeleton") dropLoot(rollLoot("skeleton", null, progressTier(), ownedItems()), pos);
}
ufos.onShotDown = (u, byPlayer) => {
  if (byPlayer) {
    ufoKilled(u);
    lootFor("ufo", u.size, u.pos, { into: u.absorbed });
  }
};
ufos.onAbductPlayer = () => {
  stats.add("abducted");
  player.damage(9999, "abducted", { pierce: true });
};
ufos.onEscape = () => {
  stats.add("abductionsSurvived");
  toast("You broke free of the beam!", 2.5);
};
// A creature sometimes drops a piece of armor (never in Creative).
function dropArmor(who, at) {
  const worn = new Set();
  for (const a of inventory.armor) if (a) worn.add(a.id);
  const drop = rollArmorDrop(who, progressTier(), worn);
  if (drop.length) dropLoot(drop, at);
}
// A creature killed by a player (online, `mine` false: another player's
// kill, counted for the shared missions by the host).
function mobKilled(m, { mine = true } = {}) {
  const add = mine ? (k) => stats.add(k) : (k) => stats.addWorld(k);
  if (m.spec.alien) add("aliensKilled");
  else if (m.kind === "guard") add("guardsKilled");
  else if (m.kind === "zombie") add("zombiesKilled");
  else if (m.kind === "skeleton") add("skeletonsKilled");
  else add("mobsKilled");
}
// What a killed creature leaves for a player: the loot kind and detail.
function mobLootKind(m) {
  if (m.spec.alien) return ["alien", alienColour(m.kind)];
  if (m.kind === "guard" || m.kind === "zombie") return [m.kind, null];
  // Skeletons drop their bow (if you don't have one yet): a plain
  // block-game item, so with mods off too.
  if (m.kind === "skeleton") return ["skeleton", null];
  return null;
}
// (Round 8) A mission patrol's leader always drops the weapon it carries,
// however it dies (shot, blown up, drowned, killed by another player or by
// its own kind) and whoever is near, while some player still lacks it. The
// drop never despawns and the mission marks it until someone picks it up.
// Runs where the creature is real (single player, the host online), so
// exactly one drops, shared with everyone.
mobs.onLeaderDown = (m) => {
  if (player.creative || !mods.enabled || ownedItems().has(m.leaderDrop)) return;
  const it = entities.spawn(m.leaderDrop, 1, new THREE.Vector3(m.pos.x, m.pos.y + 1, m.pos.z), new THREE.Vector3(0, 4, 0), { keep: true, pickupDelay: 0.8 });
  if (it) missionDirector.leaderDropped(it);
};
mobs.onKill = (m, byPlayer) => {
  if (!byPlayer) return;
  mobKilled(m);
  const lk = mobLootKind(m);
  if (lk) lootFor(lk[0], lk[1], new THREE.Vector3(m.pos.x, m.pos.y + 0.6, m.pos.z), { leaderDrop: m.leaderDrop });
};

// ---------- Test hook: putting a jet on a strip ----------
// (Only for the test suites: a jet on a flat strip nearby, or in the air.)
let playerJet = null;
let lastJetCall = -99;
// Runway search for the jet call-in: a straight, flat, dry, tree-free strip.
// Column tops are cached per search (scanning down from a little above the
// terrain height instead of from the sky keeps it cheap).
let runwayTops = null;
function columnTop(x, z) {
  const key = x * 65536 + z;
  let h = runwayTops.get(key);
  if (h !== undefined) return h;
  h = -1;
  for (let y = Math.min(WORLD_HEIGHT - 1, world.heightAt(x, z) + 24); y >= 0; y--) {
    if (world.isSolidAt(x, y, z)) {
      h = y;
      break;
    }
  }
  runwayTops.set(key, h);
  return h;
}
function stripOk(x0, z0, dx, dz, len) {
  const h0 = columnTop(Math.floor(x0), Math.floor(z0));
  if (h0 < 0) return -1;
  const sideX = -dz;
  const sideZ = dx;
  // (Level to within a block under the wheels and under the wingtips, which
  // reach 6.4 blocks out: a two-block rise there would clip a wing.)
  for (let t = -8; t <= len; t += 4) {
    for (const s of [-7, 0, 7]) {
      const x = Math.floor(x0 + dx * t + sideX * s);
      const z = Math.floor(z0 + dz * t + sideZ * s);
      if (!world.getChunk(x >> 4, z >> 4)) return -1;
      const h = columnTop(x, z);
      if (h < 0 || h - h0 > 1 || h0 - h > (s === 0 ? 1 : 3)) return -1;
      const top = world.getBlock(x, h, z);
      if (BLOCK_INFO[top]?.leaves || BLOCK_INFO[top]?.log || IS_WET[world.getBlock(x, h + 1, z)]) return -1;
    }
  }
  return h0;
}
function findRunway() {
  const p = player.position;
  runwayTops = new Map();
  try {
    for (let r = 8; r <= 72; r += 4) {
      const n = Math.max(12, Math.round(r * 0.8));
      for (let a = 0; a < n; a++) {
        const ang = (a / n) * Math.PI * 2 + r;
        const sx = p.x + Math.cos(ang) * r;
        const sz = p.z + Math.sin(ang) * r;
        for (let h = 0; h < 8; h++) {
          const yaw = (h / 8) * Math.PI * 2;
          const y = stripOk(sx, sz, -Math.sin(yaw), -Math.cos(yaw), 140); // the ground roll is ~120 blocks
          if (y >= 0) return { x: Math.floor(sx) + 0.5, y: y + 1, z: Math.floor(sz) + 0.5, yaw };
        }
      }
    }
    return null;
  } finally {
    runwayTops = null;
  }
}
// Survival: fighter jets (calling one, and the ones parked at airports) are
// part of the mission chain: they become available with mission 10, "Take to
// the air" (a jet on day one would skip the whole curve). Creative: always.
const JET_MISSION = MISSIONS.findIndex((m) => m.id === "wings");
function jetLocked() {
  return !player.creative && progress.enabled && progress.step < JET_MISSION;
}
const JET_LOCKED_TEXT = `Fighter jets join the fight with mission ${JET_MISSION + 1} ("${MISSIONS[JET_MISSION].title}"). Esc > Missions shows the way there.`;
// UFOs (wrecks and the ones in airport hangars) can be boarded from the
// "Salvage" mission on; before that the player fights on foot.
const UFO_MISSION = MISSIONS.findIndex((m) => m.id === "salvage");
function ufoLocked() {
  return !player.creative && progress.enabled && progress.step < UFO_MISSION;
}
const UFO_LOCKED_TEXT = `You can't fly alien ships yet: that comes with mission ${UFO_MISSION + 1} ("${MISSIONS[UFO_MISSION].title}").`;
vehicles.canBoard = (v) => (v.type === "jet" && jetLocked() ? JET_LOCKED_TEXT : v.type === "ufo" && ufoLocked() ? UFO_LOCKED_TEXT : null);
// Patrol fighters (they hunt UFOs) join the sky with the player's own jets.
enemyJets.allowed = () => !jetLocked();
// (Round 6: there is no calling in a jet any more. Jets are taken from the
// airports, where they are parked. `callJet` below is only a test hook,
// exposed on window.__voxelands; no key, item or menu reaches it.)
let lastJetType = "f22";
function callJet(force = false, type = lastJetType) {
  if (!mods.enabled || player.dead || gameState !== "playing") return;
  if (!force && jetLocked()) {
    toast(JET_LOCKED_TEXT, 4);
    return;
  }
  if (vehicles.active) {
    toast("Get out of your vehicle first (F).", 2);
    return;
  }
  // Only a double press is ignored. Calling again always replaces the old
  // jet, whatever state it is in (parked, flying on unmanned after an
  // eject, wrecked): the player has just told us they want a new one, and
  // the old "on its way" cooldown made a second call look like it did
  // nothing.
  if (!force && ufos.time - lastJetCall < 1.5) return;
  lastJetCall = ufos.time;
  removePlayerJets();
  const cfg = vehicles.config.jet;
  // An airport's runway if one is near (a long, flat, marked strip), else any flat strip.
  const rw = cfg.airborne ? null : airports.runwayNear(player.position.x, player.position.z, 700);
  const strip = rw ? { x: rw.x, y: rw.y, z: rw.z, yaw: rw.yaw, airport: rw.site } : cfg.airborne ? null : findRunway();
  const spawnAirborne = () => {
    const p = player.position;
    const ground = Math.max(world.heightAt(Math.floor(p.x), Math.floor(p.z)), 24);
    const jet = vehicles.create("jet", { jetType: type, pos: [p.x, Math.min(200, Math.max(ground + 70, p.y + 45)), p.z], yaw: player.yaw, airborne: true, speed: cfg.maxSpeed * 0.62, throttle: 0.75 });
    jet.keep = true;
    jet.isPlayerJet = true;
    vehicles.enter(jet);
    return jet;
  };
  if (strip) {
    playerJet = vehicles.create("jet", { jetType: type, pos: [strip.x, strip.y + 1.35, strip.z], yaw: strip.yaw });
    playerJet.keep = true; // never evicted by the vehicle cap
    playerJet.isPlayerJet = true;
    jetWatchT = 2.5;
    const dir = Math.round(((Math.atan2(strip.x - player.position.x, -(strip.z - player.position.z)) * 180) / Math.PI + 360) % 360);
    const away = Math.round(Math.hypot(strip.x - player.position.x, strip.z - player.position.z));
    const jn = JET_TYPES[type]?.name ?? "jet";
    toast(strip.airport ? `Your ${jn} is waiting on the runway of the ${strip.airport.kind === "city" ? "city's airport" : "airport"}, ${away} blocks away (heading ${dir}\u00b0): walk up and press F` : `Your ${jn} has landed ${away} blocks away (heading ${dir}\u00b0): walk up and press F`, 4);
  } else {
    playerJet = spawnAirborne();
    stats.add("takeoffs"); // (already in the air: that counts as a takeoff)
    toast(cfg.airborne ? "Your jet: you're in the air!" : "No flat ground nearby: your jet arrives in the air, with you in it!", 3.5);
  }
  jetSpawnAirborne = spawnAirborne;
  audio.playNotice();
}
// Every jet the player called in that nobody is sitting in goes away
// (Round 9: and a Creative call-in's UFO).
function removePlayerJets() {
  for (const v of [...vehicles.vehicles]) if (!v.occupied && !v.puppet && ((v.type === "jet" && (v === playerJet || v.isPlayerJet)) || v.calledIn)) vehicles.remove(v);
  playerJet = null;
}

// (Round 9) Creative call-ins (the pause menu): straight into the air, at the
// controls of an F-22, an F-16, the B-2 or a random UFO. The last one called
// in that nobody sits in goes. Online the aircraft is shared like any other
// player's (net/vehicles.js), for the host and guests alike.
function callIn(kind) {
  if (!player.creative || player.dead || gameState === "start" || gameState === "dead" || mp.mode === "dogfight") return false;
  if (!mods.enabled) {
    toast("Switch mods on first (Settings > Mods).", 3);
    return false;
  }
  if (vehicles.active) vehicles.exit({ force: true });
  removePlayerJets();
  const p = player.position;
  const ground = Math.max(world.heightAt(Math.floor(p.x), Math.floor(p.z)), SEA_LEVEL);
  let v;
  if (kind === "ufo") {
    const design = UFO_DESIGNS[Math.floor(Math.random() * UFO_DESIGNS.length)];
    const radius = [4, 5.5, 7, 9, 12][Math.floor(Math.random() * 5)];
    v = vehicles.create("ufo", { design, seed: Math.floor(Math.random() * 1e6), radius, pos: [p.x, Math.min(200, Math.max(ground + 40 + radius, p.y + 30)), p.z], yaw: player.yaw });
  } else {
    if (!JET_TYPES[kind]) return false;
    const cfg = vehicles.config.jet;
    const alt = kind === "b2" ? 100 : 75;
    v = vehicles.create("jet", { jetType: kind, pos: [p.x, Math.min(215, Math.max(ground + alt, p.y + 45)), p.z], yaw: player.yaw, airborne: true, speed: cfg.maxSpeed * 0.62 * (JET_TYPES[kind].speed ?? 1), throttle: 0.75 });
    if (v) v.isPlayerJet = true;
  }
  if (!v) return false;
  v.keep = true; // (never evicted by the vehicle cap)
  v.calledIn = true;
  if (v.type === "jet") playerJet = v;
  vehicles.enter(v);
  audio.playNotice();
  toast(kind === "ufo" ? `${UFO_DESIGN_NAMES[v.design] || "UFO"}: you're in the air!` : `${JET_TYPES[kind].name}: you're in the air!`, 3);
  return true;
}
// The call-ins show in the pause menu in Creative only.
function refreshCallIns() {
  document.getElementById("pause-callins")?.classList.toggle("hidden", !player.creative || mp.mode === "dogfight");
}
for (const b of document.querySelectorAll("#pause-callins [data-callin]")) {
  b.addEventListener("click", () => {
    if (callIn(b.dataset.callin)) requestLock();
  });
}
// A jet that is destroyed right after landing on its strip (something in the
// way we didn't see) is replaced by one in the air, so a call never ends
// with no jet at all.
let jetWatchT = 0;
let jetSpawnAirborne = null;
function updateJetWatch(dt) {
  if (jetWatchT <= 0) return;
  jetWatchT -= dt;
  if (playerJet && !playerJet.alive && !vehicles.active && !player.dead && jetSpawnAirborne) {
    jetWatchT = 0;
    removePlayerJets();
    playerJet = jetSpawnAirborne();
    toast("Your jet had to be replaced: it arrives in the air.", 3);
  }
}

// Entering and leaving vehicles.
vehicles.onEnter = (v) => {
  if (v.type === "jet" && !v.isEnemyJet) stats.add("jetsCalled"); // ("Jets flown")
  airports.boarded(v);
  chord.reset();
  interaction.release();
  weapons.cancel();
  player.mouseCapture = (e) => vehicles.mouseMove(e.movementX, e.movementY);
  document.body.classList.add("in-vehicle");
  if (v.boardedWreck) {
    stats.add("ufosBoarded");
    v.boardedWreck = false;
  }
  playerDirty = true;
};
vehicles.onExit = () => {
  player.mouseCapture = null;
  document.body.classList.remove("in-vehicle");
  vehicles.releaseAll();
  player.syncCamera();
  playerDirty = true;
};
vehicles.onPilotKilled = (cause, v) => {
  // (Online: shot down by another player lately, or crashed while they were on your tail.)
  if (v.lastHitByPid && v.lastHitByPid !== net.pid && performance.now() - (v.lastHitByT ?? 0) < 12000) {
    player.damage(9999, `pvp@${v.lastHitByPid}`, { pierce: true });
    return;
  }
  // (Round 9: the message names what brought it down: a fighter, a UFO, fire from the ground, a crash.)
  player.damage(9999, pilotCause(v.type, cause), { pierce: true });
};
vehicles.onPilotHurt = () => {
  hud.hurt();
  audio.playHurt();
};
interaction.weapons = weapons;
interaction.combat = mobs;

// A brand new game (mods on) starts with its loadout: Survival basic gear
// (everything else is loot), Creative every weapon, filling the hotbar
// first. It always wins those slots in a new world; a world that started with
// mods off gets it (in free slots) the first time it's played with mods on.
// (Round 9: that is the only time anything is given. Switching between
// Creative and Survival never touches the inventory: see setMode.)
let loadoutGiven = false;
function fillStartingWeapons(fresh) {
  if (loadoutGiven || !mods.enabled) return;
  loadoutGiven = true;
  (player.creative ? CREATIVE_LOADOUT : SURVIVAL_LOADOUT).forEach((entry, i) => {
    const [id, n] = Array.isArray(entry) ? entry : [entry, 1];
    if (fresh && i < HOTBAR_SIZE) inventory.slots[i] = makeStack(id, n);
    else if (!inventory.slots.some((s) => s && s.id === id)) inventory.add(id, n);
  });
}

if (savedPlayer) {
  player.setMode(savedPlayer.mode);
  if (savedPos) {
    player.position.set(savedPos[0], savedPos[1], savedPos[2]);
    // Stuck in terrain (e.g. edits lost)? Stand on top instead.
    if (world.isSolidAt(Math.floor(savedPos[0]), Math.floor(savedPos[1] + 0.1), Math.floor(savedPos[2]))) {
      player.spawnAt(Math.floor(savedPos[0]), Math.floor(savedPos[2]));
    }
  } else {
    player.spawnAt(spawnX, spawnZ);
  }
  if (Number.isFinite(savedPlayer.yaw)) player.yaw = savedPlayer.yaw;
  if (Number.isFinite(savedPlayer.pitch)) player.pitch = Math.max(-1.55, Math.min(1.55, savedPlayer.pitch));
  if (Number.isFinite(savedPlayer.health)) player.health = Math.max(1, Math.min(MAX_HEALTH, savedPlayer.health));
  if (Number.isFinite(savedPlayer.air)) player.air = Math.max(0, Math.min(MAX_AIR, savedPlayer.air));
  inventory.load(savedPlayer.inv);
  inventory.loadArmor(savedPlayer.armor);
  if (Number.isInteger(savedPlayer.sel)) inventory.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, savedPlayer.sel));
  if (Number.isFinite(savedPlayer.time)) sky.time = savedPlayer.time;
  // Worlds from before the loadout flag existed already had their weapons.
  // (An older save's "survivalStash", the inventory set aside in Creative,
  // is no longer used: the inventory a save has is the one it keeps.)
  loadoutGiven = savedPlayer.loadout !== false;
  nuke.loadZones(savedPlayer.blastZones);
} else {
  player.spawnAt(spawnX, spawnZ);
}
let newWorld = !savedPlayer;
mods.load(savedPlayer?.modStash);
mods.onChange((on) => {
  ufos.setEnabled(on);
  vehicles.setEnabled(on);
  if (!on) mobs.removeKind("alien");
});
mods.set(settings.mods, { initial: true });
stats.loadWorld(savedPlayer?.stats);

// ---------- Missions, loot, supply crates ----------
const progress = new Progress();
progress.load(savedPlayer?.missions, stats.world);
const progressTier = () => progress.tier(stats.world);
const myItems = () => {
  const set = new Set();
  for (const s of inventory.slots) if (s) set.add(s.id);
  for (const a of inventory.armor) if (a) set.add(a.id);
  return set;
};
// What loot rolls count as "already owned". Online it is what *every* player
// has (js/net/coop.js): loot is shared, so a weapon a friend still lacks can
// drop from your kill for them to pick up, and the group ends up equipped alike.
let mpLate = null; // (the multiplayer facade, made further down)
const ownedItems = () => (mpLate?.active && mpLate.coop?.groupOwned ? new Set(mpLate.coop.groupOwned) : myItems());
// Items fall out of a wreck, a fallen alien, an enemy jet: pick them up.
function dropLoot(list, at) {
  for (const [id, n] of list) {
    entities.spawn(id, n, new THREE.Vector3(at.x + (Math.random() - 0.5) * 1.5, at.y + 0.6, at.z + (Math.random() - 0.5) * 1.5), new THREE.Vector3((Math.random() - 0.5) * 4, 4 + Math.random() * 3, (Math.random() - 0.5) * 4));
  }
  if (list.length) stats.add("lootDropped", list.length);
}
// Loot that goes straight into the hold (a ship swallowed by the player's tractor beam).
function giveLoot(list) {
  for (const [id, n] of list) {
    const left = inventory.add(id, n);
    if (left > 0) entities.spawn(id, left, player.position.clone().add(new THREE.Vector3(0, 1, 0)));
  }
  if (list.length) {
    stats.add("lootDropped", list.length);
    toast(`Into the hold: ${list.map(([id, n]) => `${n > 1 ? `${n} x ` : ""}${itemInfo(id)?.name ?? "item"}`).join(", ")}`, 3);
  }
}
hooks.onEnemyJetDown = (jet) => {
  lootFor("enemyjet", null, jet.pos, { into: !!jet.absorbedBy });
};
const crates = new SupplyCrates({ scene, world, player, effects, audio, inventory, entities, progress, stats });
crates.getTier = progressTier;
// (The first crate is the "Supply drop" mission's; after that they come by themselves.)
const SUPPLY_MISSION = MISSIONS.findIndex((m) => m.id === "supply");
crates.randomAllowed = () => !progress.enabled || progress.step > SUPPLY_MISSION;
crates.onMessage = (t) => toast(t, 5);
// The mission director: sets up each mission in the world and points the marker at its target.
const missionDirector = new MissionDirector({ progress, stats, ufos, mobs, crates, vehicles, enemyJets, airports, terrain: world.terrain, player, sky, toast, weapons, effects, audio, world });
missionDirector.entities = entities;
progress.hold = () => !!progress.mission?.squad && missionDirector.holding();
hooks.onUfoDown = (u) => missionDirector.ufoDown(u);
mobs.onWake = () => missionDirector.crewAwake();
hooks.onNuke = (center, R) => missionDirector.nukeDetonated(center, R);
vehicles.onTakeoff = () => stats.add("takeoffs");
progress.onStart = (m) => {
  setTimeout(() => toast(`NEW MISSION ${progress.completed + 1}/${MISSIONS.length}: ${m.title}. ${m.text}`, 7), 6500);
};
// (testFlags.noMissions: the older test suites check UFO features without the mission chain.)
const testFlags = { noMissions: false };
// (Online Dogfight: no missions or supply drops while it lasts.)
let survivalPaused = false;
function refreshSurvivalSystems() {
  const on = mods.enabled && !player.creative && !survivalPaused;
  settingsPanel.setSurvival(!player.creative);
  crates.enabled = on;
  progress.enabled = on && !testFlags.noMissions;
  // (A guest follows the host's mission chain: js/net/coop.js.)
  missionDirector.enabled = on && !testFlags.noMissions && !GUEST;
  if (!on) crates.clear();
}
mods.onChange(refreshSurvivalSystems);
refreshSurvivalSystems();
progress.onComplete = (m) => {
  giveMissionReward(m);
  if (m.id === MISSIONS[MISSIONS.length - 1].id) setTimeout(showVictory, 2500);
};
// (Round 9) The last mission won: the victory screen (online, for everyone:
// js/net/coop.js), with this world's numbers. The game goes on behind it.
function showVictory() {
  const el = document.getElementById("victory-screen");
  if (!el || !el.classList.contains("hidden")) return;
  const w = stats.world;
  const rows = [
    ["Missions completed", w.missionsDone],
    ["UFOs shot down", w.ufosDown],
    ["Motherships and titans", w.ufosDownBig],
    ["Aliens killed", w.aliensKilled],
    ["Fighters shot down", w.enemyJetsDown],
    ["Deaths", w.deaths],
    ["Play time", formatPlayTime(w.playTime || 0)],
  ];
  document.getElementById("victory-stats").innerHTML = rows.map(([k, n]) => `<div>${k}</div><div class="num">${n}</div>`).join("");
  el.classList.remove("hidden");
  audio.playNotice?.();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}
document.getElementById("victory-btn").addEventListener("click", () => {
  document.getElementById("victory-screen").classList.add("hidden");
  if (gameState === "paused") requestLock();
});
// A finished mission's reward, into the inventory. (Online every player gets it.)
function giveMissionReward(m) {
  stats.add("missionsDone");
  const owned = ownedItems();
  const names = [];
  for (const [id, n] of m.reward) {
    // A weapon you already have becomes golden apples instead.
    const isWeapon = !!itemInfo(id)?.weapon;
    const give = isWeapon && owned.has(id) ? [ITEM_GOLDEN_APPLE, 2] : [id, n];
    const left = inventory.add(give[0], give[1]);
    if (left > 0) entities.spawn(give[0], left, player.position.clone().add(new THREE.Vector3(0, 1, 0)));
    names.push(`${give[1] > 1 ? `${give[1]} x ` : ""}${itemInfo(give[0])?.name ?? "item"}`);
  }
  toast(`MISSION COMPLETE: ${m.title}. Reward: ${names.join(", ")}`, 6);
  audio.playMission?.();
  markInventoryChanged();
  playerDirty = true;
}

// ---------- Mods screen ----------
const modsCheckbox = document.getElementById("mods-enabled");
modsCheckbox.checked = settings.mods;
function refreshModsPills() {
  for (const id of ["settings-mods-state"]) {
    const el = document.getElementById(id);
    el.textContent = mods.enabled ? "ON" : "OFF";
    el.classList.toggle("on", mods.enabled);
  }
}
refreshModsPills();
function setModsEnabled(on) {
  settings.mods = on;
  persistSettings();
  modsCheckbox.checked = on;
  mods.set(on);
  if (on && gameState !== "start") fillStartingWeapons(false);
  markInventoryChanged();
  refreshModsPills();
}
modsCheckbox.addEventListener("change", () => setModsEnabled(modsCheckbox.checked));

// Creative tools on the Mods screen: spawn your own UFO (any shape and
// size) to fly, or summon an enemy UFO nearby.
const modsTools = document.getElementById("mods-tools");
modsTools.innerHTML = `
  <div class="subhead">Spawn a UFO to fly (Creative, in game)</div>
  <div class="row"><label for="spawn-ufo-size">Size</label><select id="spawn-ufo-size">
    <option value="4">Small</option><option value="7" selected>Medium</option><option value="14">Large</option><option value="36">Mothership</option></select></div>
  <div class="spawn-grid" id="spawn-ufo-grid"></div>
  <div class="subhead">Summon an enemy UFO (Creative, in game)</div>
  <div class="spawn-grid"><button class="btn" id="summon-ufo">Random UFO</button><button class="btn" id="summon-ufo-attack">One that attacks</button><button class="btn" id="summon-ufo-crash">A crashed one</button></div>
  <div id="mods-tools-note" class="hint"></div>`;
const spawnGrid = document.getElementById("spawn-ufo-grid");
for (const design of UFO_DESIGNS) {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = UFO_DESIGN_NAMES[design];
  b.addEventListener("click", () => creativeSpawnUfo(design));
  spawnGrid.appendChild(b);
}
function creativeToolCheck() {
  const note = document.getElementById("mods-tools-note");
  if (!mods.enabled) note.textContent = "Switch mods on first.";
  else if (gameState === "start") note.textContent = "Start playing first: these place things in front of you.";
  else if (!player.creative) note.textContent = "Only in Creative mode (switch it in the pause menu).";
  else return true;
  return false;
}
function inFront(dist, up) {
  const f = player.getForwardVector();
  f.y = 0;
  f.normalize();
  return player.position.clone().addScaledVector(f, dist).add(new THREE.Vector3(0, up, 0));
}
function creativeSpawnUfo(design) {
  if (!creativeToolCheck()) return;
  const radius = Number(document.getElementById("spawn-ufo-size").value) || 7;
  const pos = inFront(radius + 5, radius * 0.5 + 2);
  const v = vehicles.create("ufo", { design, seed: Math.floor(Math.random() * 1e6), radius, pos: [pos.x, pos.y, pos.z], yaw: player.yaw });
  if (v) toast(`${UFO_DESIGN_NAMES[design]} ready: walk up to it and press F`, 3);
  screens.closeAll();
  requestLock();
}
// (Online the UFOs are the host's: a guest's summons are asked of the host.)
for (const [id, kind, dist, up] of [["summon-ufo", "roam", 60, 30], ["summon-ufo-attack", "attack", 70, 30], ["summon-ufo-crash", "crash", 30, 25]]) {
  document.getElementById(id).addEventListener("click", () => {
    if (!creativeToolCheck()) return;
    const at = inFront(dist, up).toArray();
    if (mp.isClient) mp.coop.summon(kind, at);
    else game.summonUfo(kind, at);
    screens.closeAll();
    requestLock();
  });
}
ui.setModeShown(player.mode);
ui.showStartMenu(SEED);
ui.setPlayLabel(savedPlayer ? "Continue" : "Play");
document.getElementById("world-state").textContent = savedPlayer ? `(saved ${savedPlayer.mode === "creative" ? "creative" : "survival"} world)` : "(new world)";
if (GUEST) {
  // A guest's main menu: into the host's game (the host picks the mode; no new worlds from here).
  ui.setPlayLabel("Join the game");
  document.body.classList.add("mp-guest");
  for (const id of ["new-world-btn", "menu-mp-btn"]) document.getElementById(id).classList.add("hidden");
  document.querySelector("#start-menu .mode-cards")?.classList.add("hidden");
  document.querySelector("#start-menu .mode-select-row")?.classList.add("hidden");
  document.getElementById("world-state").textContent = `(${joinWelcome.hostNick || "the host"}'s world, room ${net.code})`;
  document.getElementById("main-menu-btn").textContent = "Leave game";
  document.getElementById("copy-link-btn").textContent = "Copy invite link";
  // (Until the host's world has arrived.)
  ui.playBtn.disabled = true;
  ui.setPlayLabel("Receiving the world...");
}
// The main menu's background: a slow flyover with a UFO drifting by.
const flyover = new MenuFlyover(scene, world, { effects, audio });
flyover.setCenter(player.position);
// Shoot it: click the saucer that flies by (a few hits and it blows up).
const menuScoreEl = document.getElementById("menu-score");
const menuScoreN = document.getElementById("menu-score-n");
const menuUfoHint = document.getElementById("menu-ufo-hint");
flyover.onScore = (n) => {
  menuScoreN.textContent = String(n);
  menuScoreEl.classList.remove("hidden");
};
const menuNdc = (e) => {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
};
ui.startMenuEl.addEventListener("mousedown", (e) => {
  if (gameState !== "start" || e.target !== ui.startMenuEl || e.button !== 0) return;
  audio.ensureStarted();
  const [nx, ny] = menuNdc(e);
  const r = flyover.shoot(nx, ny);
  if (!r) audio.playRicochet?.(30); // a miss: a whiz past
});
ui.startMenuEl.addEventListener("mousemove", (e) => {
  if (gameState !== "start") return;
  const [nx, ny] = menuNdc(e);
  ui.startMenuEl.classList.toggle("aim-ufo", e.target === ui.startMenuEl && flyover.hovering(nx, ny));
});
// The frame rate readout, the advice for slow computers, and rotating tips.
const menuPerf = new MenuPerf({
  fpsEl: document.getElementById("menu-fps"),
  recEl: document.getElementById("fps-recommend"),
  recTextEl: document.getElementById("fps-recommend-text"),
  recBtn: document.getElementById("fps-recommend-apply"),
  tipEl: document.getElementById("menu-tip"),
  onApply: (preset) => {
    if (!PRESET_ORDER.includes(preset)) {
      document.getElementById("fps-recommend").classList.add("hidden");
      return;
    }
    ui.startGraphicsSelect.value = preset;
    ui.startGraphicsSelect.dispatchEvent(new Event("change", { bubbles: true }));
  },
});
held.setItem(inventory.selectedStack?.id ?? 0, true);

function playerState() {
  // A dead player is saved as respawned: their items were dropped in the world.
  const p = player.dead ? null : player.position;
  return {
    mode: player.mode,
    pos: p ? [round3(p.x), round3(p.y), round3(p.z)] : null,
    yaw: round3(player.yaw),
    pitch: round3(player.pitch),
    health: player.dead ? MAX_HEALTH : player.health,
    air: player.dead ? MAX_AIR : round3(player.air),
    inv: inventory.serialize(),
    armor: inventory.serializeArmor(),
    sel: inventory.selected,
    time: round3(sky.time),
    modStash: mods.serialize(),
    loadout: loadoutGiven,
    missions: progress.serialize(),
    vehicles: vehicles.serialize(),
    stats: stats.world,
    blastZones: nuke.serializeZones(),
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

let playerDirty = false;
let lastPlayerSave = 0;

function flushSave() {
  // A guest in someone else's game saves nothing (the host keeps the world).
  if (GUEST) {
    pendingSave = false;
    world.dirtyEditChunks.clear();
    lastSaveTime = lastPlayerSave = performance.now();
    stats.save(); // (a guest's own all-worlds totals)
    return;
  }
  if (pendingSave) {
    saveEdits(SEED, world.edits, encodedEditCache, world.dirtyEditChunks);
    world.dirtyEditChunks.clear();
    pendingSave = false;
  }
  lastSaveTime = performance.now();
  stats.save();
  if (!newWorld || playerDirty) {
    savePlayer(SEED, playerState());
    playerDirty = false;
    newWorld = false;
    lastPlayerSave = performance.now();
  }
}

// Leaving the page mid-game (e.g. Ctrl+W while sprinting with Ctrl) asks
// for confirmation first; the world is saved either way.
// A page closed or reloaded while it was still responsive (e.g. during shader
// compilation, or from a background tab that never drew a frame) is not a
// failed start: only a hang or a driver crash, which never gets here, is.
window.addEventListener("pagehide", () => {
  if (!graphicsLost && (!graphicsReady || framesSinceReady < 3)) saveBootRecord({ preset: graphicsPreset, ok: true });
});
window.addEventListener("beforeunload", (e) => {
  flushSave();
  if ((gameState === "playing" || gameState === "inventory") && !leavingToMenu) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
});

function markInventoryChanged() {
  playerDirty = true;
  hud.refreshHotbar();
  held.setItem(inventory.selectedStack?.id ?? 0);
}

interaction.onChange = markInventoryChanged;
interaction.onMessage = (t) => toast(t, 2.5);
weapons.onChange = markInventoryChanged;
weapons.onMessage = (t) => toast(t, 1.6);
invScreen.onChange = markInventoryChanged;
invScreen.onDrop = (stack) => interaction.throwStack(stack);
world.onBlockPopped = (x, y, z, id) => interaction.blockPopped(x, y, z, id);
falling.onBreak = (x, y, z, id) => interaction.blockPopped(x, y, z, id);

entities.onPickup = (item) => {
  if (player.dead) return item.count;
  const left = inventory.add(item.id, item.count, item.dur);
  if (left < item.count) {
    audio.playPickup();
    markInventoryChanged();
  }
  return left;
};

player.onFlightToggle = (enabled) => audio.playFlightToggle(enabled);

// ---------- Damage, death and respawn ----------
// Online, another player's explosive carries their id ("grenade@3"): the
// message names them ("Blown up by Bob's grenade"). The host's AI (a UFO
// crash, an enemy missile) keeps its own message.
const PLAYER_WEAPONS = { grenade: "grenade", bazooka: "bazooka rocket", airstrike: "airstrike", ufocannon: "UFO cannon", nuke: "nuke", missile: "missile", cannon: "cannon" };
function deathMessage(cause) {
  if (typeof cause === "string" && /^pk@\d+$/.test(cause)) return `Killed by ${mp.playerName(Number(cause.slice(3)))}`;
  // (Round 9 fix: checked before the general "@" rule below, which read it as plain "pvp".)
  if (typeof cause === "string" && /^pvp@\d+$/.test(cause)) return `Shot down by ${mp.playerName(Number(cause.slice(4)))}`;
  if (typeof cause === "string" && cause.includes("@")) {
    const m = /^([a-z_]+?)@(\d+)(_fall)?$/.exec(cause);
    if (m) {
      const [, src, pid, fall] = m;
      const name = mp.playerName(Number(pid));
      if (Number(pid) === net.pid) return DEATH_MESSAGES[src + (fall || "")] || src;
      if (PLAYER_WEAPONS[src]) return `${fall ? "Sent flying" : src === "nuke" ? "Caught in" : "Blown up"} by ${name}'s ${PLAYER_WEAPONS[src]}`;
      return DEATH_MESSAGES[src + (fall || "")] || DEATH_MESSAGES[src] || src;
    }
  }
  return DEATH_MESSAGES[cause] || cause || "You died";
}
let lastBlastHitTime = -Infinity;
let lastBlastSource = "grenade";
let deathCause = null;

player.onHurt = (amount, cause) => {
  hud.hurt();
  audio.playHurt();
  playerDirty = true;
};

player.onDeath = (cause) => {
  stats.add("deaths");
  if (vehicles.active) vehicles.exit({ force: true });
  vehicles.parachute.close(player);
  // A fall right after being launched by an explosion was the explosive's doing.
  if (cause === "fall" && performance.now() - lastBlastHitTime < 6000) cause = `${lastBlastSource}_fall`;
  deathCause = cause;
  audio.playDeath();
  if (invScreen.isOpen) invScreen.close();
  chord.reset();
  interaction.release();
  // (Dogfight: nothing to drop, and back in a jet in a moment, mouse and all.)
  if (!mp.dogfight?.live) dropEverything();
  gameState = "dead";
  hud.showDeath(deathMessage(cause));
  mp.playerDied?.(cause, deathMessage(cause));
  if (document.pointerLockElement === canvas && !mp.dogfight?.live) document.exitPointerLock();
  playerDirty = true;
};

// Everything in the inventory spills out where the player died.
function dropEverything() {
  const at = player.position.clone();
  at.y += 0.8;
  // (Online they land in everyone's world: a friend can bring them back.)
  mp.items.share(() => {
    for (const s of [...inventory.slots, ...inventory.armor]) {
      if (!s) continue;
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
      entities.spawn(s.id, s.count, at, vel, { dur: s.dur, pickupDelay: 2 });
    }
  });
  inventory.clear();
  markInventoryChanged();
}

// The column nearest the world spawn with open air (not water) above solid
// ground: a crater may have flooded the original spot.
function safeSpawnColumn() {
  for (let r = 0; r <= 24; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = spawnX + dx;
        const z = spawnZ + dz;
        const top = world.surfaceY(x, z);
        if (top >= 0 && world.getBlock(x, top + 1, z) === BLOCK.AIR && world.getBlock(x, top + 2, z) === BLOCK.AIR) return [x, z];
      }
    }
  }
  return [spawnX, spawnZ];
}

// (Round 9) During a mission (Survival): a random safe spot around the
// mission's location (online, the host's mission: net/coop.js), or null
// (the world spawn).
function missionRespawnSpot() {
  if (player.creative || mp.mode === "dogfight") return null;
  const place = mp.active && net.isClient ? mp.coop?.respawnPlace?.() : missionDirector.respawnPlace();
  return place ? missionDirector.safeSpotAround(place, place.r) : null;
}

// Back in the game after a death: at `at` ([x, z], e.g. next to a friend),
// else around the current mission, else at the world spawn.
function respawn(at = null) {
  if (gameState !== "dead") return;
  hud.hideDeath();
  const spot = Array.isArray(at) ? at : missionRespawnSpot();
  world.prepareArea(spot ? spot[0] : spawnX + 0.5, spot ? spot[1] : spawnZ + 0.5, INITIAL_SYNC_RADIUS);
  player.revive();
  if (spot) player.spawnAt(Math.floor(spot[0]), Math.floor(spot[1]));
  else player.spawnAt(...safeSpawnColumn());
  player.yaw = 0;
  player.pitch = 0;
  player.syncCamera();
  streamAround(player.position.x, player.position.z);
  deathCause = null;
  // (Online the UFOs only give this player a moment: the others are still
  // fighting. Round 9: a guest's moment too, which the host's UFOs grant.)
  if (mp.active) {
    if (net.isHost) player.graceUntil = ufos.time + 8;
    else mp.coop?.respawned?.();
  } else ufos.playerRespawned();
  playerDirty = true;
  gameState = "paused";
  audio.ensureStarted();
  // (Still holding the mouse, e.g. a Dogfight respawn: straight back in.)
  if (document.pointerLockElement === canvas) {
    gameState = "playing";
    player.enabled = true;
    ui.showHud(true);
  } else requestLock();
}
hud.respawnBtn.addEventListener("click", () => respawn());

// Explosions hurt (lethally up close) and shove the player away from the
// blast center with an upward kick, falling off with distance and scaled
// by the size of the blast (a bazooka rocket is 5 grenades wide).
effects.onExplosion = (center, radius, source, info = {}) => {
  // (Round 9) Who caused it: a player's weapon (credit, the PvP rule, their
  // name in a death message) or the world and its AI (a UFO's blast, a
  // crash, an enemy missile, a meteor: nobody's kill, always hurts).
  const byPlayer = isPlayerCause(source);
  // Online, another machine's explosion (info.mirror) only hurts this player and
  // their own vehicle here: what it did to creatures, UFOs and other vehicles
  // was judged where it went off.
  // (Round 9: a guest's world blast, its own aircraft blowing up, reaches the
  // host's creatures and UFOs too, as nobody's kill: the guest's copies of
  // them make no claim for it.)
  const worldBlastHere = !info.mirror || (!byPlayer && net.isHost && mp.active);
  if (worldBlastHere) mobs.explosion(center, radius, byPlayer);
  // The blast takes the plants with it (the burnt ring too), so none are left floating over the crater.
  if (grass.density > 0 && center.distanceTo(player.position) < 90) grass.clear(center.x, center.z, Math.min(radius + 2.5, 30));
  if (worldBlastHere) ufos.explosion(center, radius, byPlayer);
  if (!info.mirror) {
    vehicles.explosion(center, radius, byPlayer ? "explosion" : "explosion_other");
    return hurtByBlast(center, radius, source);
  }
  // Another player's blast: their name in the message, and with the host's
  // PvP rule off it doesn't hurt you or your vehicle. (The AI's blasts, which
  // the host sends, always do; Round 9 fix: they used to be stopped by the
  // rule too, and named the host as their cause.)
  const other = info.by && info.by !== net.pid;
  if (other && byPlayer) {
    if (!mp.pvpAllowed()) return;
    source = `${source}@${info.by}`;
    if (vehicles.active && center.distanceTo(vehicles.active.pos) < radius * 2.5) {
      vehicles.active.lastHitByPid = info.by;
      vehicles.active.lastHitByT = performance.now();
    }
  }
  if (vehicles.active) vehicles.explosionOn(vehicles.active, center, radius, byPlayer && !other ? "explosion" : "explosion_other");
  hurtByBlast(center, radius, source);
};
// What a blast does to this player on foot: damage close in, and a shove.
function hurtByBlast(center, radius, source) {
  const size = Math.sqrt(radius / GRENADE_RADIUS);
  const offset = player.position.clone();
  offset.y += 0.9; // body center
  offset.sub(center);
  const dist = offset.length();
  const hurtReach = radius * 1.8;
  if (dist < hurtReach && !player.dead) {
    const dmg = Math.floor(30 * size * Math.pow(1 - dist / hurtReach, 1.3));
    if (dmg > 0 && player.damage(dmg, source, { from: center })) {
      lastBlastHitTime = performance.now();
      lastBlastSource = source;
    }
  }
  const reach = radius * 2.2;
  if (dist >= reach || player.dead) return;
  const strength = Math.min(40, (1 - dist / reach) * 22 * size);
  if (dist < 1e-3) offset.set(0, 1, 0);
  offset.normalize();
  offset.y = Math.max(offset.y, 0) + 0.45;
  offset.normalize().multiplyScalar(strength);
  offset.y = Math.min(offset.y, 13 * Math.min(size, 1.6));
  player.applyImpulse(offset);
  if (!player.creative) {
    lastBlastHitTime = performance.now();
    lastBlastSource = source;
  }
}

// ---------- Game mode ----------
function setMode(mode) {
  const before = player.mode;
  player.setMode(mode);
  refreshSurvivalSystems();
  ui.setModeShown(player.mode);
  // (Round 9) The inventory is never touched by a switch, either way: what
  // you have stays (things taken in Creative included), nothing is added or
  // taken away, online too (the host's switch is everyone's: net/rules.js).
  void before;
  playerDirty = true;
  refreshCallIns();
}


ui.modeSelect.addEventListener("change", () => setMode(ui.modeSelect.value));
ui.pauseModeSelect.addEventListener("change", () => {
  // Online only the host picks the mode (for everyone).
  if (mp.active) {
    if (mp.isHost) mp.rules.setMode(ui.pauseModeSelect.value);
    else {
      ui.pauseModeSelect.value = player.mode;
      toast("The host picks the game mode.", 2.5);
    }
    return;
  }
  setMode(ui.pauseModeSelect.value);
});

// ---------- Graphics ----------
const allWorldMaterials = [world.materials.opaque, world.materials.cutout, world.materials.water, world.materials.cutoutDepth, lod.material, grass.material];

// userPick: the player chose this in a menu (so it is remembered, ending any
// session-only step-down). Internal re-applies (resolution changes, the
// start-up call) don't overwrite a saved preset while the session is lowered.
function setGraphics(name, { adoptRenderDistance = false, keepOverrides = true, userPick = false } = {}) {
  graphicsPreset = normalizePreset(name);
  if (userPick) graphicsLowered = false;
  if (!keepOverrides) settings.gfxOverrides = {};
  const preset = applyPreset(graphicsPreset, {
    overrides: graphicsLowered ? {} : settings.gfxOverrides,
    renderer,
    postfx,
    sunLight,
    sky,
    atlas: world.atlas,
    materials: allWorldMaterials,
    chunkMaterials: world.materials,
    onResize,
    resolutionScale: settings.perf.resolution,
  });
  activePreset = preset;
  lod.configure({ detailDistance: settings.perf.detailDistance > 0 ? settings.perf.detailDistance : preset.detailDistance });
  grass.configure({ level: preset.grass });
  world.setMeshOptions({ fancyLeaves: preset.fancyLeaves });
  // A preset suggests a render distance; it is adopted only while the player
  // hasn't set one of their own (see PROGRESS.md, "Settings persistence").
  if (adoptRenderDistance === "force" || (adoptRenderDistance && !settings.renderDistanceCustom)) {
    settings.renderDistanceCustom = false;
    setRenderDistance(preset.renderDistance);
  }
  ui.graphicsSelect.value = graphicsPreset;
  ui.startGraphicsSelect.value = graphicsPreset;
  ui.graphicsHintEl.textContent = describePreset(preset);
  refreshGfxOptions();
  if (!graphicsLowered) {
    settings.graphics = graphicsPreset;
    persistSettings();
  }
  prepareGraphics();
}

// ---------- Shader preparation ----------
// Compiling the shaders can take a long time on some systems (High and Ultra
// especially, and e.g. on Windows, where browsers translate them for
// Direct3D). Drawn straight away, the first frame would compile them all at
// once, and the page would show nothing, not even the start menu, until that
// was done (or the graphics driver gave up). So the menu goes up first, the
// shaders compile in the background (KHR_parallel_shader_compile, where the
// browser has it) while the world streams in, and the world is drawn once
// they're ready. The same happens after switching presets.
let graphicsReady = false;
let framesSinceReady = 0;
let prepareToken = 0;
const PREPARE_SLOW_MS = 12000; // then suggest a lower preset
const PREPARE_TIMEOUT_MS = 120000; // then draw anyway (shaders compile on first use)
// Stand-ins for the world materials that may have nothing in the scene yet
// (distant tiles arrive from a worker, water and leaves may not be near).
const shaderStandIns = new THREE.Group();
{
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  for (const m of [world.materials.opaque, world.materials.cutout, world.materials.water, lod.material, grass.material]) {
    shaderStandIns.add(new THREE.Mesh(g, m));
  }
}

// Warm up the new materials' shaders with the others (see prepareGraphics),
// so the first UFO, beam or jet doesn't stall a frame compiling them.
{
  const warm = new THREE.Group();
  warm.add(createUfoModel("saucer", 1, { castShadow: false }).root, createJetModel().root, createJetModel(1, { type: "f16" }).root);
  const beam = new TractorBeam(warm);
  beam.mesh.visible = true;
  beam.pool.visible = true;
  shaderStandIns.add(warm);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts compiling the shaders of everything in `root`, for the render
// target currently set (it decides their output format). With parallel
// compilation the promise resolves once they're ready without ever blocking
// the page; without it, they compile in order and the first draw waits for
// whatever isn't done yet.
function compileScene(root, cam) {
  if (renderer.extensions.has("KHR_parallel_shader_compile")) return renderer.compileAsync(root, cam);
  renderer.compile(root, cam);
  return Promise.resolve();
}

// Compiles the shaders this preset draws with, for the targets they draw
// into. Resolves when they're ready.
function compileShaders() {
  const post = activePreset.post;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(post ? postfx.sceneRT : null);
  scene.add(shaderStandIns);
  const jobs = [compileScene(scene, camera), compileScene(held.scene, held.camera)];
  scene.remove(shaderStandIns);
  renderer.setRenderTarget(prev);
  if (post) jobs.push(postfx.compileAsync(compileScene));
  return Promise.all(jobs);
}

async function prepareGraphics() {
  const token = ++prepareToken;
  graphicsReady = false;
  ui.setPreparing(true);
  saveBootRecord({ preset: graphicsPreset, ok: false }); // until the world has been drawn
  // Let the menu reach the screen before any heavy GPU work.
  await nextFrame();
  await nextFrame();
  if (token !== prepareToken || graphicsLost) return;
  const slow = setTimeout(() => {
    ui.setStartNotice(`${startNotice ? `${startNotice} ` : ""}Preparing the graphics is taking a while; on a slower computer, pick a lower setting.`);
  }, PREPARE_SLOW_MS);
  try {
    await Promise.race([compileShaders(), delay(PREPARE_TIMEOUT_MS)]);
  } catch (err) {
    console.warn("UFO COMBAT: shader warm-up failed, compiling on first use instead", err);
  }
  clearTimeout(slow);
  if (token !== prepareToken || graphicsLost) return;
  ui.setStartNotice(startNotice);
  ui.setPreparing(false);
  graphicsReady = true;
  framesSinceReady = 0;
}

function describePreset(p) {
  const parts = [];
  if (p.cascades.length === 0) parts.push("no shadows");
  else parts.push(`${p.cascades.length > 1 ? `${p.cascades.length}-cascade` : "basic"} ${p.shadowQuality === 3 ? "soft " : ""}sun shadows`);
  if (p.normalMap) parts.push(p.pom ? "3D parallax textures" : "normal-mapped textures");
  if (p.water !== "simple") parts.push(p.water === "ssr" ? "reflective, refractive water" : "refractive water");
  if (p.grass) parts.push("3D grass");
  parts.push(p.post ? "HDR bloom & color grading" : "no post-processing");
  if (p.godRays) parts.push("light shafts");
  if (p.caustics) parts.push("water caustics");
  return `${parts.join(", ")}. Full detail to about ${p.detailDistance + 2} chunks, then simplified terrain. Suggested render distance: ${p.renderDistance}.`;
}

function setRenderDistance(value) {
  renderDistance = clampRenderDistance(value);
  viewRD = renderDistance;
  ui.renderDistanceInput.value = String(renderDistance);
  ui.renderDistanceValueEl.textContent = String(renderDistance);
  updateViewDistance();
  lod.configure({ renderDistance: viewRD });
  settings.renderDistance = renderDistance;
  persistSettings();
}

// ---------- Settings menu ----------

// Individual graphics options: one select per option. The value shown is
// what's in effect (the preset's, unless overridden).
const gfxSelects = {};
const gfxOptionsEl = document.getElementById("gfx-options");
for (const [key, opt] of Object.entries(GFX_OPTIONS)) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = opt.label;
  label.htmlFor = `gfx-${key}`;
  const select = document.createElement("select");
  select.id = `gfx-${key}`;
  for (const [value, text] of opt.choices) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    const presetValue = opt.get(resolvePreset(graphicsPreset, {}));
    if (select.value === presetValue) delete settings.gfxOverrides[key];
    else settings.gfxOverrides[key] = select.value;
    setGraphics(graphicsPreset, { userPick: true });
  });
  row.append(label, select);
  gfxOptionsEl.appendChild(row);
  gfxSelects[key] = select;
}

function refreshGfxOptions() {
  for (const [key, opt] of Object.entries(GFX_OPTIONS)) gfxSelects[key].value = opt.get(activePreset);
  document.getElementById("gfx-custom-badge").classList.toggle("hidden", Object.keys(settings.gfxOverrides).length === 0);
}

document.getElementById("gfx-reset-btn").addEventListener("click", () => setGraphics(graphicsPreset, { keepOverrides: false, userPick: true }));

setGraphics(graphicsPreset);

// Picking a preset (in the pause or the start menu) also applies its
// suggested render distance (the slider can still be changed afterwards) and
// clears individual overrides.
for (const select of [ui.graphicsSelect, ui.startGraphicsSelect]) {
  select.addEventListener("change", () => setGraphics(select.value, { adoptRenderDistance: true, keepOverrides: false, userPick: true }));
}

const fpsEl = document.getElementById("fps-counter");
settingsPanel.on("showFps", (v) => (fpsEl.style.display = v ? "" : "none"));

// Controls.
settingsPanel.on("fov", (v) => (player.baseFov = v));
settingsPanel.on("sensitivity", (v) => (player.mouseSensitivity = v));
settingsPanel.on("invertY", (v) => (player.invertY = v));

// Audio: a volume slider per category.
const audioOptionsEl = document.getElementById("audio-options");
const volumeSliders = {};
for (const [key, label] of AUDIO_CATEGORIES) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<label>${label}</label><input type="range" id="vol-${key}" min="0" max="1" step="0.01" /><span id="vol-${key}-value" class="val"></span>`;
  audioOptionsEl.appendChild(row);
  audio.setVolume(key, settings.volume[key]);
  volumeSliders[key] = SettingsPanel.range(`vol-${key}`, settings.volume[key], (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.volume[key] = v;
    audio.setVolume(key, v);
    persistSettings();
  });
}
settingsPanel.onReset("audio", () => {
  for (const [key] of AUDIO_CATEGORIES) {
    const dv = DEFAULT_SETTINGS.volume[key] ?? 1;
    settings.volume[key] = dv;
    audio.setVolume(key, dv);
    volumeSliders[key].set(dv);
  }
});

// Gameplay: difficulty, creature spawning, time of day.
// (Online as a guest the host's difficulty applies: see js/net/rules.js.)
let hostDifficulty = null;
const difficulty = () => hostDifficulty ?? settings.difficulty;
function applyDifficulty() {
  player.mobDamageScale = DIFFICULTY_DAMAGE[difficulty()] ?? 1;
  mobs.spawning = settingsPanel.effective("mobSpawning");
  mobs.hostileSpawning = difficulty() !== "peaceful";
  if (difficulty() === "peaceful") mobs.removeHostiles();
}
settingsPanel.on("difficulty", applyDifficulty);
settingsPanel.on("mobSpawning", applyDifficulty);
settingsPanel.on("timeLocked", (v) => (sky.locked = v));
// Zombies: spawn rate (up to an apocalypse), cap and toughness.
for (const k of ["spawnRate", "max", "health", "damage", "daylight"]) {
  settingsPanel.on(`zombies.${k}`, (v) => {
    mobs.zombies[k] = v;
    if (k === "max") mobs.trimZombies();
  });
}
const timeSlider = SettingsPanel.range("time-of-day", sky.hours, formatHours, (v) => {
  sky.setHours(v);
  playerDirty = true;
});

// Graphics: "Reset to defaults" goes back to the default preset, its render
// distance, and no individual overrides.
settingsPanel.onReset("video", () => setGraphics(DEFAULT_PRESET, { adoptRenderDistance: "force", keepOverrides: false, userPick: true }));

// Performance: full-detail distance, far-terrain quality, resolution scale
// and effects detail, plus one-click presets for different computers.
const LOD_QUALITY = { low: 0.55, medium: 1, high: 1.5, ultra: 2, extreme: 3 };
function applyDetailDistance() {
  const d = settings.perf.detailDistance;
  lod.configure({ detailDistance: d > 0 ? d : activePreset.detailDistance });
}
settingsPanel.on("perf.detailDistance", applyDetailDistance);
settingsPanel.on("perf.lodQuality", (v) => lod.configure({ quality: LOD_QUALITY[v] ?? 1 }));
settingsPanel.on("perf.resolution", () => setGraphics(graphicsPreset), { now: false });
settingsPanel.on("perf.effects", (v) => (effectsQuality.scale = { low: 0.35, medium: 0.65, high: 1 }[v] ?? 1));

const PERF_PRESETS = {
  potato: { label: "Potato", hint: "Old laptops", graphics: "low", renderDistance: 7, detail: 3, lod: "low", resolution: 0.7, effects: "low" },
  balanced: { label: "Balanced", hint: "Most PCs", graphics: "medium", renderDistance: 12, detail: 0, lod: "medium", resolution: 1, effects: "medium" },
  beautiful: { label: "Beautiful", hint: "Gaming PCs", graphics: "high", renderDistance: 20, detail: 0, lod: "high", resolution: 1, effects: "high" },
  max: { label: "Max", hint: "High-end GPUs", graphics: "ultra", renderDistance: 32, detail: 10, lod: "ultra", resolution: 1, effects: "high" },
  extreme: { label: "Extreme", hint: "Powerful PCs", graphics: "ultra", renderDistance: 72, detail: 14, lod: "extreme", resolution: 1, effects: "high" },
};
const perfPresetsEl = document.getElementById("perf-presets");
for (const [key, p] of Object.entries(PERF_PRESETS)) {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.dataset.preset = key;
  btn.innerHTML = `${p.label}<small>${p.hint}</small>`;
  btn.addEventListener("click", () => applyPerfPreset(key));
  perfPresetsEl.appendChild(btn);
}
function applyPerfPreset(key) {
  const p = PERF_PRESETS[key];
  if (!p) return;
  settings.perf.resolution = p.resolution; // applied by setGraphics below
  settingsPanel.set("perf.detailDistance", p.detail);
  settingsPanel.set("perf.lodQuality", p.lod);
  settingsPanel.set("perf.effects", p.effects);
  settingsPanel.set("perf.resolution", p.resolution);
  setGraphics(p.graphics, { keepOverrides: false, userPick: true });
  // (A performance preset is a whole set, render distance included.)
  settings.renderDistanceCustom = false;
  setRenderDistance(p.renderDistance);
  refreshPerfPresets();
}
function refreshPerfPresets() {
  for (const btn of perfPresetsEl.children) {
    const p = PERF_PRESETS[btn.dataset.preset];
    const match = p.graphics === graphicsPreset && p.renderDistance === renderDistance && p.detail === settings.perf.detailDistance && p.lod === settings.perf.lodQuality && p.resolution === settings.perf.resolution && p.effects === settings.perf.effects && Object.keys(settings.gfxOverrides).length === 0;
    btn.classList.toggle("active", match);
  }
}
// Another tab of the game changed the settings: take them over here too, so
// this tab never writes its older copy back over them.
window.addEventListener("storage", (e) => {
  if (e.key !== "ufocombat_v1_settings" || !e.newValue) return;
  let fresh;
  try {
    fresh = normalizeSettings(JSON.parse(e.newValue), SETTINGS_OPTIONS);
  } catch (err) {
    return;
  }
  for (const entry of SCHEMA) settingsPanel.adopt(entry.key, getSettingPath(fresh, entry.key));
  for (const [k] of AUDIO_CATEGORIES) {
    if (settings.volume[k] === fresh.volume[k]) continue;
    settings.volume[k] = fresh.volume[k];
    audio.setVolume(k, fresh.volume[k]);
    volumeSliders[k].set(fresh.volume[k]);
  }
  settings.renderDistanceCustom = fresh.renderDistanceCustom;
  if (fresh.renderDistance !== renderDistance) {
    renderDistance = clampRenderDistance(fresh.renderDistance);
    viewRD = renderDistance;
    settings.renderDistance = renderDistance;
    ui.renderDistanceInput.value = String(renderDistance);
    ui.renderDistanceValueEl.textContent = String(renderDistance);
    updateViewDistance();
    lod.configure({ renderDistance: viewRD });
  }
  if (fresh.mods !== settings.mods) setModsEnabled(fresh.mods);
  const gfxChanged = fresh.graphics !== settings.graphics || JSON.stringify(fresh.gfxOverrides) !== JSON.stringify(settings.gfxOverrides);
  if (gfxChanged && !graphicsLowered) {
    settings.gfxOverrides = { ...fresh.gfxOverrides };
    setGraphics(fresh.graphics);
  }
});
function getSettingPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

settingsPanel.onReset("performance", () => {
  setGraphics(graphicsPreset);
  refreshPerfPresets();
});
screens.onOpen["settings-screen"] = () => {
  refreshPerfPresets();
  timeSlider.set(Math.round(sky.hours * 20) / 20);
};

// ---------- Lost graphics device ----------
// After the WebGL context is lost nothing can be drawn: save, step the
// graphics preset down for the next start, and ask for a reload.
let graphicsLost = false;
function onGraphicsLost() {
  if (graphicsLost) return;
  graphicsLost = true;
  graphicsReady = false;
  const lower = lowerPreset(graphicsPreset);
  const hadOverrides = Object.keys(settings.gfxOverrides).length > 0;
  // The saved settings are left alone, and so is the next start: a sleeping
  // laptop, a GPU switch or a driver reset also loses the context, and the
  // next start used to come up one preset lower with the player's own
  // graphics options ignored, which looked exactly like "my settings were
  // reset". (A start that really hangs is still caught by the safe start:
  // its boot record stays not-ok until the world has been drawn.)
  playerDirty = true;
  flushSave();
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById("gpu-lost-preset").textContent = PRESETS[lower].label;
  document.getElementById("gpu-lost-reset").classList.toggle("hidden", !hadOverrides);
  document.getElementById("gpu-lost").classList.remove("hidden");
}
document.getElementById("gpu-lost-reload").addEventListener("click", () => location.reload());
// The player's choice: the next start runs one step lower, for that session
// only (the safe start); the saved settings are not touched.
document.getElementById("gpu-lost-lower").addEventListener("click", () => {
  saveBootRecord({ preset: graphicsPreset, ok: false });
  location.reload();
});

// ---------- Game state / pointer lock ----------
// "start": title menu. "playing": pointer locked, in control. "paused":
// pause menu (or waiting for the pointer to lock again). "inventory": an
// inventory/crafting screen is open (the world keeps running). "dead": the
// death screen.
let gameState = "start";

function requestLock() {
  const result = canvas.requestPointerLock();
  // Newer browsers return a promise that rejects if the lock is refused
  // (e.g. right after Esc); the pause menu then offers to resume.
  if (result && typeof result.catch === "function") result.catch(() => showPause());
}

function showPause() {
  if (gameState === "start" || gameState === "dead" || gameState === "inventory") return;
  if (document.pointerLockElement === canvas) return;
  // (The online session just ended, or a Dogfight's results are up: their own
  // screen says what now, and its buttons take the mouse.)
  if (mp.ended || !document.getElementById("mp-results").classList.contains("hidden")) {
    if (!mp.ended) {
      gameState = "paused";
      player.enabled = mp.active;
      chord.reset();
      interaction.release();
      vehicles.releaseAll();
      player.keys?.clear?.();
      ui.hidePauseMenu();
      return;
    }
    gameState = "paused";
    player.enabled = false;
    ui.showHud(false);
    return;
  }
  gameState = "paused";
  // (Online the world goes on: the player still falls, swims and can be hurt, just without controls.)
  player.enabled = mp.active;
  chord.reset();
  audio.setJetEngine(0, false, 0, false);
  interaction.release();
  ui.showHud(false);
  refreshCallIns();
  ui.showPauseMenu(SEED, renderDistance);
}

// Into the game from the main menu (or, for a guest, straight from joining).
function enterGame() {
  // Online the room decides the mode (Dogfight plays by Survival's rules, in a jet).
  setMode(mp.active ? (mp.mode === "creative" ? "creative" : "survival") : ui.modeSelect.value);
  fillStartingWeapons(newWorld);
  markInventoryChanged();
  if (!GUEST) saveJSON("last", { seed: SEED });
}

ui.playBtn.addEventListener("click", () => {
  audio.ensureStarted();
  enterGame();
  requestLock();
});

// A guest lands in the host's world as soon as it has arrived: no main menu.
// (The browser only captures the mouse after a click: "Click to play".)
const clickToPlay = document.getElementById("click-to-play");
function enterAsGuest() {
  if (gameState !== "start") return;
  enterGame();
  ui.hideStartMenu();
  screens.closeAll();
  flyover.hide();
  gameState = "paused";
  player.enabled = true;
  ui.showHud(true);
  clickToPlay.classList.remove("hidden");
}
clickToPlay.addEventListener("click", () => {
  clickToPlay.classList.add("hidden");
  audio.ensureStarted();
  requestLock();
});

// ---------- Menu buttons ----------
const openScreen = (id) => screens.show(id, gameState === "start" ? "start-menu" : "pause-menu");
for (const [btn, id] of [
  ["menu-settings-btn", "settings-screen"],
  ["pause-settings-btn", "settings-screen"],
  // (Round 8: Mods and the key list are reached from Settings.)
  ["settings-mods-btn", "mods-screen"],
  ["settings-keys-btn", "controls-screen"],
  ["pause-stats-btn", "stats-screen"],
  ["pause-missions-btn", "missions-screen"],
  ["new-world-btn", "new-world-screen"],
]) {
  document.getElementById(btn).addEventListener("click", () => {
    audio.ensureStarted();
    audio.playClick();
    openScreen(id);
  });
}
renderControls(document.getElementById("controls-list"));

// New world: an optional seed, then reload into it (the page is built
// around one world's seed).
const newSeedInput = document.getElementById("new-seed");
const newSeedNote = document.getElementById("new-seed-note");
function parseSeedInput() {
  const raw = newSeedInput.value.trim();
  if (raw === "") return null;
  if (/^-?\d+$/.test(raw)) return Math.abs(Number(raw)) % 2147483647;
  // Any text works as a seed too (hashed to a number).
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647;
}
newSeedInput.addEventListener("input", () => {
  const seed = parseSeedInput();
  newSeedNote.textContent = seed !== null && hasSavedWorld(seed) ? `You already have a world with seed ${seed}: it will be continued where you left it.` : "";
});
document.getElementById("new-world-create").addEventListener("click", () => {
  const seed = parseSeedInput() ?? randomSeed();
  flushSave();
  saveJSON("last", { seed });
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("seed", String(seed));
  window.location.href = url.toString();
});

// Back to the main menu: save and reload this world's page (the menu
// then offers to continue it).
document.getElementById("main-menu-btn").addEventListener("click", () => {
  if (GUEST) {
    mp.leave();
    return;
  }
  if (mp.isHost && net.playerCount > 1 && !window.confirm("Going to the main menu closes the room: everyone else is sent back to their own worlds. Go?")) return;
  playerDirty = true;
  flushSave();
  leavingToMenu = true;
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(SEED));
  window.location.href = url.toString();
});
let leavingToMenu = false;

// Fullscreen button, F11 / Alt+Enter and the Keyboard Lock API (js/fullscreen.js).
const fullscreen = new FullscreenControl({ isInGame: () => gameState === "playing" || gameState === "inventory" });
// With the keyboard locked (fullscreen in Chromium) Esc reaches the page as a
// key press and the browser no longer drops the pointer lock itself: do it here.
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !e.repeat && fullscreen.keyboardLocked && gameState === "playing" && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
});

// Esc steps back out of a sub-screen.
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && screens.open) {
    e.preventDefault();
    screens.back();
  }
});

ui.resumeBtn.addEventListener("click", () => {
  audio.ensureStarted();
  requestLock();
});

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle("pointer-locked", locked);
  player.setLocked(locked);
  if (locked) {
    gameState = "playing";
    player.enabled = true;
    clickToPlay.classList.add("hidden");
    ui.hideStartMenu();
    ui.hidePauseMenu();
    screens.closeAll();
    flyover.hide();
    ui.showHud(true);
  } else if (gameState === "playing" || gameState === "paused") {
    showPause();
  }
});
document.addEventListener("pointerlockerror", () => showPause());

function openInventory(kind) {
  if (gameState !== "playing") return;
  chord.reset();
  interaction.release();
  gameState = "inventory";
  invScreen.open(kind, player.creative);
  document.exitPointerLock();
}

function closeInventory() {
  if (gameState !== "inventory") return;
  invScreen.close();
  gameState = "paused";
  requestLock();
}

ui.renderDistanceInput.addEventListener("input", () => {
  settings.renderDistanceCustom = true; // the player's own choice: presets keep it from now on
  setRenderDistance(ui.renderDistanceInput.value);
});

ui.copyLinkBtn.addEventListener("click", () => {
  if (mp.active) {
    navigator.clipboard?.writeText(inviteUrl(net.code)).catch(() => {});
    toast("Invite link copied", 2);
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(SEED));
  navigator.clipboard?.writeText(url.toString()).catch(() => {});
});

// ---------- Keyboard ----------
const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

function selectSlot(i) {
  inventory.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  interaction.eating = 0;
  weapons.cancel();
  markInventoryChanged();
}

window.addEventListener("keydown", (e) => {
  if (gameState === "inventory") {
    if (e.code === "KeyE" || e.code === "Escape") {
      e.preventDefault();
      closeInventory();
    } else if (invScreen.handleKey(e.code, e.ctrlKey)) {
      e.preventDefault();
    }
    return;
  }
  // F1 / F3 / F5 would otherwise open help, find, or reload the page.
  if (e.code === "F1" || e.code === "F3" || e.code === "F5") {
    e.preventDefault();
    if (gameState !== "playing" || e.repeat) return;
    if (e.code === "F1") toggleHud();
    else if (e.code === "F3") toggleDebug();
    else if (vehicles.active) toast(`Camera: ${vehicles.active.cycleCamera()}`, 1.2);
    else player.cycleCamera();
    return;
  }
  if (gameState !== "playing") return;
  // In a vehicle the keys fly it (it reads the held keys itself); only F
  // (get out) and its own key presses are handled here.
  if (vehicles.active) {
    if (!e.repeat) vehicles.keyDown(e.code);
    if (e.code === "KeyF" && !e.repeat) vehicles.toggle();
    if (e.code === "KeyI" && !e.repeat) vehicles.toggleInfo();
    return;
  }
  const idx = DIGIT_CODES.indexOf(e.code);
  if (idx !== -1) selectSlot(idx);
  if (e.repeat) return;
  if (e.code === "KeyE") openInventory("inventory");
  else if (e.code === "KeyQ") interaction.dropSelected(e.ctrlKey);
  else if (e.code === "KeyF" && mods.enabled) vehicles.toggle();
  else if (e.code === "KeyR") {
    // Reload the weapon in hand early.
    const kind = itemInfo(inventory.selectedStack?.id)?.weapon?.kind;
    if (kind) weapons.startReload(kind);
  }
});

// F1: hide the whole HUD (and the item in hand) for clean screenshots.
let hudHidden = false;
function toggleHud() {
  hudHidden = !hudHidden;
  document.body.classList.toggle("hud-off", hudHidden);
}

// F3: a debug overlay (position, chunk, biome, light, time, rendering stats).
const debugEl = document.getElementById("debug-overlay");
let debugShown = false;
let debugTimer = 0;
function toggleDebug() {
  debugShown = !debugShown;
  debugEl.classList.toggle("hidden", !debugShown);
  debugTimer = 0;
}

// F3: the nearest airport or city (a jet needs a runway: J calls one to it).
function airportLine(p) {
  const a = airports.nearest(3500);
  if (!a) return "Airports: none within 3500 blocks";
  const dx = a.site.x - p.x;
  const dz = a.site.z - p.z;
  const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) / 45) % 8];
  return `Nearest ${a.site.kind === "city" ? "city (with airport)" : "airport"}: ${Math.round(a.dist)} blocks ${dir}  (${a.site.x}, ${a.site.z})`;
}

const FACING = ["north (-Z)", "west (-X)", "south (+Z)", "east (+X)"];
function updateDebug(dt, frameTime) {
  if (!debugShown) return;
  debugTimer -= dt;
  if (debugTimer > 0) return;
  debugTimer = 0.25;
  const p = player.position;
  const bx = Math.floor(p.x);
  const by = Math.floor(p.y);
  const bz = Math.floor(p.z);
  const light = world.lightAt(p.x, p.y + 0.5, p.z);
  const yawDeg = ((((-player.yaw * 180) / Math.PI) % 360) + 360) % 360;
  const facing = FACING[Math.round((((player.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4];
  const biomeId = world.terrain?.biomeAt ? world.terrain.biomeAt(bx, bz) : null;
  const biome = BIOME_NAMES[biomeId] ?? biomeId ?? "?";
  const info = renderer.info;
  const target = interaction.target;
  const lines = [
    `UFO COMBAT  ${Math.round(1 / Math.max(1e-3, frameTime))} fps  (sim ${perf.simMs.toFixed(1)} ms, draw ${perf.renderMs.toFixed(1)} ms)  (${graphicsPreset}${Object.keys(settings.gfxOverrides).length ? ", custom" : ""})`,
    `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
    `Block: ${bx} ${by} ${bz}   Chunk: ${bx >> 4} ${bz >> 4}  (in chunk ${bx & 15} ${bz & 15})`,
    `Facing: ${facing}  yaw ${yawDeg.toFixed(1)}  pitch ${((player.pitch * 180) / Math.PI).toFixed(1)}`,
    `Biome: ${biome}   Light: sky ${light.sky}, block ${light.block}`,
    `Time: ${formatHours(sky.hours)}${sky.locked ? " (locked)" : ""}   Camera: ${["first person", "behind", "in front"][player.cameraMode]}`,
    `Mode: ${player.mode}${player.flying ? ", flying" : ""}   Difficulty: ${settings.difficulty}${settings.mobSpawning ? "" : ", no spawning"}`,
    `Chunks: ${world.chunks.size} loaded   LOD tiles: ${lod.tiles.size}   Render distance: ${renderDistance}${viewRD !== renderDistance ? ` (${viewRD} at altitude)` : ""}`,
    `Mobs: ${mobs.mobs.length} (zombies ${mobs.countKind("zombie")})   Items: ${entities.items.length}   Plants: ${activePreset.grass ? grass.count ?? 0 : 0}`,
    `UFOs: ${ufos.count} (max ${ufos.maxCount})   Vehicles: ${vehicles.vehicles.length}${vehicles.active ? ` (in ${vehicles.active.name})` : ""}   Mods: ${mods.enabled ? "on" : "off"}`,
    airportLine(p),
    `Draw calls: ${info.render.calls}   Triangles: ${info.render.triangles}   Geometries: ${info.memory.geometries}   Textures: ${info.memory.textures}`,
  ];
  if (target && target.block) lines.push(`Looking at: ${target.block.join(" ")}  (${BLOCK_INFO[target.id]?.name ?? target.id})`);
  debugEl.textContent = lines.join("\n");
}

canvas.addEventListener("wheel", (e) => {
  if (gameState !== "playing") return;
  if (vehicles.active) {
    vehicles.wheel(e.deltaY);
    return;
  }
  selectSlot(inventory.selected + (e.deltaY > 0 ? 1 : -1));
});

// ---------- Mouse ----------
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// Presses go through the chord detector: both buttons together are the
// binoculars (see binoculars.js), and never mine, place or fire.
const binoculars = new Binoculars(player, world);
settingsPanel.on("binocularZoom", (v) => {
  binoculars.strength = v;
  if (binoculars.active) binoculars.set(true);
});
const chord = new MouseChord({
  press: (button) => interaction.mouseDown(button),
  release: (button) => interaction.mouseUp(button),
  zoom: (on) => binoculars.set(on),
});

document.addEventListener("mousedown", (e) => {
  if (gameState !== "playing") return;
  if (e.button === 1) e.preventDefault();
  if (vehicles.active) {
    vehicles.mouseDown(e.button);
    return;
  }
  chord.down(e.button);
});

document.addEventListener("mouseup", (e) => {
  vehicles.mouseUp(e.button);
  chord.up(e.button);
});

canvas.addEventListener("click", () => {
  if (gameState === "paused") requestLock();
});

// ---------- Rendering state ----------
const sunWorldPos = new THREE.Vector3();
const lookDir = new THREE.Vector3();
let eyeAdaptation = 1;
let underwater = false;
let waterSurfaceY = 0; // the water surface above the eye, while under water
let dawnDusk = 0; // 1 around sunrise and sunset
let eyeSkyLight = 1; // sky light at the eye (0-1): no light shafts in dark flooded caves
const refractedSun = new THREE.Vector3(0, 1, 0);
const underwaterRayColor = new THREE.Color();
// Drifting particles in the water around the camera.
const motes = new UnderwaterMotes(scene);
let heldLight = { sky: 15, block: 0 };

function updateEnvironment(dt) {
  // The view's position: the eyes, or the third-person camera.
  const eye = player.thirdPerson || gameState === "start" || vehicles.active ? camera.position.clone() : player.getEyePosition();
  lookDir.copy(player.getForwardVector());
  sky.update(dt, eye, lookDir);
  worldUniforms.uTime.value += dt;

  // Under water (below the drawn, waving surface): murky blue fog and a
  // tinted, wobbly screen.
  underwater = isUnderwater(world, eye.x, eye.y, eye.z, worldUniforms.uTime.value, worldUniforms.uWaveStrength.value);
  worldUniforms.uUnderwater.value = underwater ? 1 : 0;
  const eyeLight = world.lightAt(eye.x, eye.y, eye.z);
  heldLight = eyeLight;
  const wl = Math.max(0.15, (eyeLight.sky / 15) * sky.daylight + 0.1);
  worldUniforms.uWaterFogColor.value.setRGB(0.03 * wl, 0.135 * wl, 0.15 * wl); // teal murk
  eyeSkyLight = eyeLight.sky / 15;
  if (underwater) {
    // The surface above (for the light shafts), and sunlight bent into the water.
    let y = Math.floor(eye.y);
    while (y < WORLD_HEIGHT - 1 && IS_WET[world.getBlock(eye.x, y + 1, eye.z)]) y++;
    waterSurfaceY = surfaceHeight(y, eye.x, eye.z, worldUniforms.uTime.value, worldUniforms.uWaveStrength.value);
    const L = worldUniforms.uLightDir.value;
    const h = Math.hypot(L.x, L.z);
    const hr = h / 1.33;
    refractedSun.set(h > 1e-4 ? (L.x / h) * hr : 0, Math.sqrt(Math.max(0, 1 - hr * hr)), h > 1e-4 ? (L.z / h) * hr : 0);
  }
  motes.update(eye, worldUniforms.uTime.value, underwater, wl, drawingSize.y || window.innerHeight);

  // Low mist over the water, thickest around sunrise and sunset.
  const e = worldUniforms.uSunDir.value.y;
  dawnDusk = Math.exp(-((e / 0.2) ** 2));
  const mist = activePreset.mist;
  worldUniforms.uMist.value.set(mist * (0.003 + 0.022 * dawnDusk + 0.006 * worldUniforms.uNight.value), 2.5 + 3 * dawnDusk, 1, SEA_LEVEL + 0.9);

  // Eye adaptation: brighten gradually in dark places (caves, at night), less
  // so when a torch is nearby.
  const ambient = Math.max((eyeLight.sky / 15) * (0.25 + 0.75 * sky.daylight), (eyeLight.block / 15) * 0.9);
  const target = 1 + (1 - ambient) * 0.45;
  eyeAdaptation += (target - eyeAdaptation) * Math.min(1, dt * 1.5);

  scene.fog.color.copy(sky.horizonColor);
}

function renderFrame() {
  const exposure = sky.exposure * eyeAdaptation;
  const preset = activePreset;
  sky.material.uniforms.uWriteSkyMask.value = preset.post ? 1 : 0;
  // The item in hand is drawn on top of the world (fresh depth buffer).
  const showHeld = (gameState === "playing" || gameState === "inventory") && !player.thirdPerson && !hudHidden && !binoculars.active && !vehicles.active;
  const overlay = showHeld ? { scene: held.scene, camera: held.camera } : null;
  if (preset.post) {
    sunWorldPos.copy(camera.position).addScaledVector(worldUniforms.uSunDir.value, 400);
    const sunUp = THREE.MathUtils.smoothstep(worldUniforms.uSunDir.value.y, -0.02, 0.12);
    postfx.render(
      scene,
      camera,
      {
        exposure,
        sunWorldPos,
        sunColor: worldUniforms.uSunGlowColor.value,
        // Sunbeams: stronger and wider in the low, hazy light of dawn and dusk.
        raysStrength: underwater ? 0 : (0.85 + 0.7 * dawnDusk) * sunUp,
        raysSpread: 8 - 4.5 * dawnDusk,
        underwaterRays: underwater ? 1.6 * sky.daylight * eyeSkyLight : 0,
        underwaterLight: refractedSun,
        underwaterColor: underwaterRayColor.setRGB(0.55, 0.9, 0.95).multiply(worldUniforms.uLightColor.value),
        surfaceY: waterSurfaceY,
        underwater,
        night: worldUniforms.uNight.value,
        bloomStrength: 0.11,
        time: worldUniforms.uTime.value,
      },
      overlay
    );
  } else {
    renderer.toneMappingExposure = exposure;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    if (overlay) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(overlay.scene, overlay.camera);
      renderer.autoClear = true;
    }
  }
}

// ---------- Debug / test hook ----------
// Exposes live game objects so the headless smoke test (tools/smoke-test.mjs)
// can verify behavior like movement direction, and for poking at the game
// from the browser dev console. Not used by any game code. (Also available
// under its old name, __voxelands, which the older tests use.)
// Frame timing (F3 and the performance tests): exponential averages of the
// main-thread simulation time and the time spent issuing draw calls.
const perf = { simMs: 0, renderMs: 0, maxSimMs: 0 };

// ---------- Multiplayer ----------
// (See js/net/: the session, and one module per part of the game that is
// shared online. Everything goes through this facade.)
const game = {
  THREE,
  SEED,
  GUEST,
  joinWelcome,
  world,
  scene,
  camera,
  player,
  inventory,
  entities,
  interaction,
  effects,
  audio,
  sky,
  mobs,
  weapons,
  lasers,
  nuke,
  enemyJets,
  airports,
  vehicles,
  ufos,
  stats,
  progress,
  missions: missionDirector,
  crates,
  mods,
  settings,
  settingsPanel,
  screens,
  ui,
  hud,
  avatar,
  held,
  falling,
  waterSim,
  toast,
  setMode,
  respawn,
  requestLock,
  flushSave,
  dropLoot,
  giveLoot,
  rollLoot,
  lootFor,
  giveMissionReward,
  showVictory,
  callIn,
  deathMessage,
  // Online: a player's things (the host keeps a guest's between visits).
  playerData() {
    const p = player.position;
    return { inv: inventory.serialize(), armor: inventory.serializeArmor(), sel: inventory.selected, health: player.dead ? MAX_HEALTH : player.health, pos: player.dead ? null : [round3(p.x), round3(p.y), round3(p.z)], loadout: loadoutGiven };
  },
  applyPlayerData(d) {
    if (!d || typeof d !== "object") return;
    inventory.load(d.inv);
    inventory.loadArmor(d.armor);
    if (Number.isInteger(d.sel)) inventory.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, d.sel));
    if (Number.isFinite(d.health)) player.health = Math.max(1, Math.min(MAX_HEALTH, d.health));
    loadoutGiven = d.loadout !== false;
    markInventoryChanged();
    if (Array.isArray(d.pos) && d.pos.length === 3 && d.pos.every(Number.isFinite)) game.teleport(d.pos[0], d.pos[1], d.pos[2]);
  },
  // Puts this player at (x, z) (on the ground there, or at height y if given and free).
  teleport(x, y, z) {
    world.prepareArea(x, z, INITIAL_SYNC_RADIUS);
    if (y === null || world.isSolidAt(Math.floor(x), Math.floor(y + 0.1), Math.floor(z)) || world.isSolidAt(Math.floor(x), Math.floor(y + 1.1), Math.floor(z))) player.spawnAt(Math.floor(x), Math.floor(z));
    else {
      player.position.set(x, y, z);
      player.velocity.set(0, 0, 0);
    }
    player.resetFall?.();
    streamAround(player.position.x, player.position.z);
    player.syncCamera();
  },
  // Respawn next to (x, z) instead of the world spawn (online: near a friend).
  respawnNear(x, z) {
    if (gameState !== "dead") return;
    let best = null;
    for (let r = 2; r <= 6 && !best; r++) {
      for (let k = 0; k < 8 && !best; k++) {
        const a = (k / 8) * Math.PI * 2;
        const cx = Math.floor(x + Math.cos(a) * r);
        const cz = Math.floor(z + Math.sin(a) * r);
        world.prepareArea(cx, cz, 1);
        const top = world.surfaceY(cx, cz);
        if (top > 0 && !IS_WET[world.getBlock(cx, top, cz)] && world.getBlock(cx, top + 1, cz) === BLOCK.AIR && world.getBlock(cx, top + 2, cz) === BLOCK.AIR) best = [cx, cz];
      }
    }
    respawn(best ? [best[0] + 0.5, best[1] + 0.5] : [x, z]);
  },
  // Dogfight online: missions and supply drops stop (and come back after).
  setSurvivalPaused(on) {
    survivalPaused = !!on;
    refreshSurvivalSystems();
  },
  // The creative tools' "summon a UFO" (a guest asks the host: js/net/coop.js).
  summonUfo(kind, pos) {
    const at = new THREE.Vector3(pos[0], pos[1], pos[2]);
    if (kind === "attack") {
      const u = ufos.spawn({ pos: at, size: "small" });
      u.state = "react";
      u.reaction = "counter";
      u.timer = 6;
      u.lastSeen = ufos.time;
    } else if (kind === "crash") {
      const u = ufos.spawn({ pos: at, size: "medium" });
      ufos.damage(u, 99999, true);
    } else ufos.spawn({ pos: at });
  },
  ufoKilled,
  mobKilled,
  mobLootKind,
  hooks,
  progressTier,
  ownedItems,
  myItems,
  markInventoryChanged,
  spawn: { x: spawnX, z: spawnZ },
  get gameState() {
    return gameState;
  },
  get difficulty() {
    return difficulty();
  },
  // A guest: the host's difficulty (null: our own again).
  setHostDifficulty(d) {
    hostDifficulty = d;
    const sel = document.getElementById("difficulty");
    if (sel) sel.disabled = d !== null;
    applyDifficulty();
  },
  // The host's Mods switch (a guest's own setting is not touched).
  setModsFromHost(on) {
    modsCheckbox.disabled = true;
    if (mods.enabled === on) return;
    mods.set(on);
    if (on && gameState !== "start") fillStartingWeapons(false);
    markInventoryChanged();
    refreshModsPills();
  },
  setModsEnabled,
  get timeSlider() {
    return timeSlider;
  },
  grass,
  // A guest: the host's world and game state are in.
  onStateLoaded() {
    ui.playBtn.disabled = false;
    ui.setPlayLabel("Join the game");
    refreshPlayLabels();
    hideBootJoin();
    if (GUEST) enterAsGuest();
  },
  // A step of the game while the tab is hidden (the background clock).
  backgroundStep() {
    const ft = clock.getDelta();
    simulate(Math.min(ft, MAX_DT), ft);
  },
  // Back to the controls after a screen that took the mouse (a click on its button).
  resumePlay() {
    clickToPlay.classList.add("hidden");
    audio.ensureStarted();
    if (gameState === "paused" || gameState === "playing") requestLock();
  },
  // The mouse is free (a screen closed without a click): "Click to play".
  showClickToPlay() {
    if (gameState === "paused" && document.pointerLockElement !== canvas) {
      ui.hidePauseMenu();
      clickToPlay.classList.remove("hidden");
    }
  },
  // Leaving the page on purpose (no "are you sure" prompt).
  allowUnload() {
    leavingToMenu = true;
  },
  // A room was opened from a menu: the game mode follows the room's.
  hostStarted(mode) {
    if (mode === "creative" || mode === "survival") {
      ui.modeSelect.value = mode;
      if (gameState !== "start") setMode(mode);
    }
    refreshPlayLabels();
  },
  // The session ended under a guest (the host left, the connection dropped).
  leftOnline() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    if (gameState === "playing" || gameState === "inventory") gameState = "paused";
    ui.hidePauseMenu();
    ui.showHud(false);
  },
};
const mp = new Multiplayer(net, game);
mpLate = mp;
// The lobby's Play button: into the game (or back into it).
function refreshPlayLabels() {
  const lobbyPlay = document.getElementById("mp-lobby-play");
  lobbyPlay.textContent = gameState === "start" ? (GUEST ? "Join the game" : "Play") : "Resume";
}
document.getElementById("mp-lobby-play").addEventListener("click", () => {
  screens.closeAll();
  if (gameState === "start") ui.playBtn.click();
  else {
    audio.ensureStarted();
    requestLock();
  }
});
screens.onOpen["mp-lobby"] = ((prev) => () => {
  prev?.();
  refreshPlayLabels();
})(screens.onOpen["mp-lobby"]);

window.__ufo = window.__voxelands = {
  THREE,
  mp,
  net,
  world,
  player,
  camera,
  scene,
  renderer,
  effects,
  sky,
  postfx,
  inventory,
  entities,
  interaction,
  invScreen,
  mobs,
  falling,
  waterSim,
  weapons,
  lasers,
  nuke,
  enemyJets,
  airports,
  sites: world.terrain.sites,
  progress,
  crates,
  missions: missionDirector,
  testFlags,
  MISSIONS,
  dropLoot,
  rollLoot,
  perf,
  callJet,
  findRunway,
  vehicles,
  ufos,
  stats,
  toast,
  mods,
  setModsEnabled,
  chord,
  binoculars,
  decals,
  scorches,
  audio,
  lod,
  grass,
  distant,
  motes,
  streamAround,
  water: { isUnderwater, surfaceHeight },
  hud,
  held,
  avatar,
  settings,
  settingsPanel,
  screens,
  flyover,
  toggleHud,
  toggleDebug,
  uniforms: worldUniforms,
  spawn: { x: spawnX, z: spawnZ },
  setGraphics,
  setRenderDistance,
  setMode,
  respawn,
  flushSave,
  // Renders one frame and returns simple statistics of the image (mean and
  // standard deviation of luminance, share of near-black pixels). Read back
  // synchronously right after rendering, while the drawing buffer is valid.
  // Renders a frame and returns the average [r, g, b] (0-255) of a 5x5
  // pixel box at each [x, y] (0-1, from the top left).
  samplePixels(points) {
    renderFrame();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    return points.map(([sx, sy]) => {
      const sum = [0, 0, 0];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.min(w - 1, Math.max(0, Math.round(sx * w) + dx));
          const y = Math.min(h - 1, Math.max(0, Math.round((1 - sy) * h) + dy));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          for (let k = 0; k < 3; k++) sum[k] += px[k] / 25;
        }
      }
      return sum.map(Math.round);
    });
  },
  captureStats() {
    renderFrame();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    let sum2 = 0;
    let black = 0;
    const n = w * h;
    for (let i = 0; i < px.length; i += 4) {
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      sum += l;
      sum2 += l * l;
      if (l < 0.02) black++;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), blackFraction: black / n, width: w, height: h };
  },
  get graphics() {
    return graphicsPreset;
  },
  get gameState() {
    return gameState;
  },
  get renderDistance() {
    return renderDistance;
  },
  debugViewRD: () => viewRD,
  get deathCause() {
    return deathCause;
  },
  get graphicsReady() {
    return graphicsReady;
  },
};

// ---------- Stats overlay, hit marker, stats screen ----------
const statsOverlayEl = document.getElementById("stats-overlay");
let statsOverlayT = 0;
settingsPanel.on("statsOverlay", (v) => statsOverlayEl.classList.toggle("hidden", !v));
const beamOverlayEl = document.getElementById("beam-overlay");
let beamWarned = false;
function updateBeamFeedback() {
  const held = !!ufos.beamingPlayer && gameState === "playing";
  beamOverlayEl.classList.toggle("show", held);
  if (held && !beamWarned) toast("TRACTOR BEAM! Run out of the light, or shoot the UFO!", 3);
  beamWarned = held;
}
// The jet's lock box (on the target) and nose marker (where it points).
const lockBoxEl = document.getElementById("lock-box");
// The salvo spiral: an Archimedean spiral, 2.75 turns from the middle out.
const spiralEl = lockBoxEl.querySelector(".lb-spiral");
{
  let d = "";
  for (let i = 0; i <= 160; i++) {
    const t = i / 160;
    const a = t * Math.PI * 2 * 2.75;
    const r = 8 + t * 40;
    d += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  }
  spiralEl.querySelector("path").setAttribute("d", d);
}
const salvoGlowEl = document.getElementById("salvo-glow");
const jetNoseEl = document.getElementById("jet-nose");
const jetAimEl = document.getElementById("jet-aim");
const missileWarnEl = document.getElementById("missile-warn");
const missileWarnTextEl = missileWarnEl.querySelector(".mw-text");
const _lockV = new THREE.Vector3();
function updateJetOverlay() {
  const v = vehicles.active;
  const o = (v?.type === "jet" || v?.type === "ufo") && v.overlay && gameState === "playing" && !hudHidden ? v.overlay(camera) : null;
  const place = (el, p) => {
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
  };
  let lock = o?.lock;
  // The bazooka's lock-on box, on foot.
  if (!lock && !v && gameState === "playing" && !hudHidden && weapons.lock.held && weapons.lock.target) {
    const l = weapons.lock;
    const p = l.target.center(_lockV).project(camera);
    if (p.z < 1) lock = { x: p.x, y: p.y, locked: l.locked, progress: l.progress };
  }
  lockBoxEl.classList.toggle("hidden", !lock);
  if (!lock) salvoGlowEl.style.opacity = "0";
  if (lock) {
    place(lockBoxEl, lock);
    lockBoxEl.classList.toggle("locked", lock.locked);
    lockBoxEl.classList.toggle("salvo", !!lock.salvo);
    // The salvo charging (jet): a ring around the box, one pip per missile, a glow at the screen's edge.
    const charge = lock.charge || 0;
    lockBoxEl.classList.toggle("charging", !!lock.spiral && !lock.salvo);
    lockBoxEl.style.setProperty("--c", charge.toFixed(3));
    // The spiral: wide and loose at first, it turns and closes in to the target as the salvo charges.
    spiralEl.style.setProperty("--s", lock.salvo ? "0.82" : (2.3 - 1.48 * charge).toFixed(3));
    spiralEl.style.setProperty("--r", `${Math.round(charge * 600)}deg`);
    salvoGlowEl.style.opacity = charge > 0 ? (lock.salvo ? 1 : 0.15 + charge * 0.6).toFixed(2) : "0";
    salvoGlowEl.classList.toggle("salvo", !!lock.salvo);
    const size = lock.locked ? 40 : 80 - lock.progress * 40;
    lockBoxEl.style.width = lockBoxEl.style.height = `${size}px`;
    lockBoxEl.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  }
  jetNoseEl.classList.toggle("hidden", !o?.nose || v.cameraModes[v.cameraMode] === "cockpit");
  if (o?.nose) place(jetNoseEl, o.nose);
  jetAimEl.classList.toggle("hidden", !o?.aim);
  if (o?.aim) place(jetAimEl, o.aim);
  // Incoming missile: an arrow pointing where it comes from, blinking faster as it closes.
  const w = o?.warn;
  missileWarnEl.classList.toggle("hidden", !w);
  if (w) {
    missileWarnEl.firstElementChild.style.transform = `rotate(${w.angle}rad)`;
    missileWarnEl.classList.toggle("fast", w.dist < 350);
    missileWarnEl.classList.toggle("slow", w.dist >= 350);
    missileWarnTextEl.textContent = w.kind === "missile" ? `MISSILE ${Math.round(w.dist)}` : "INCOMING";
  }
}
// The aircraft radar (Round 8, js/radar.js): bottom right while flying.
const radar = new Radar(document.getElementById("radar"));
let radarT = 0;
let radarDt = 0;
function updateRadar(dt) {
  const v = vehicles.active;
  const on = !!v && (v.type === "jet" || v.type === "ufo") && gameState === "playing" && !hudHidden;
  radar.show(on);
  if (!on) return;
  radarT -= dt;
  radarDt += dt;
  if (radarT > 0) return;
  radarT = 1 / 30;
  const pos = v.pos;
  const fwd = v.forward ? v.forward(_lockV) : _lockV.set(-Math.sin(v.yaw ?? 0), 0, -Math.cos(v.yaw ?? 0));
  const heading = Math.atan2(-fwd.x, -fwd.z);
  const R = radar.range * 1.05;
  const contacts = [];
  const headingOf = (o) => {
    if (o.forward) {
      const f = o.forward(_radarV);
      return Math.atan2(-f.x, -f.z);
    }
    return o.vel && o.vel.lengthSq() > 1 ? Math.atan2(-o.vel.x, -o.vel.z) : 0;
  };
  for (const u of ufos.ufos) {
    if (u.state === "gone" || u.falling || Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z) > R) continue;
    contacts.push({ kind: "ufo", x: u.pos.x, z: u.pos.z, size: u.S?.idx ?? 1, boss: !!u.boss });
  }
  for (const o of vehicles.vehicles) {
    if (o === v || !o.alive) continue;
    if (Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) > R) continue;
    if (o.isEnemyJet) contacts.push({ kind: "jet", x: o.pos.x, z: o.pos.z, heading: headingOf(o) });
    // Enemy missiles coming at us.
    for (const m of o.missiles || []) if ((m.target?.ref === v || m.target?.ref === player) && m.pos) contacts.push({ kind: "missile", x: m.pos.x, z: m.pos.z });
  }
  for (const p of vehicles.remoteMissiles?.(v) || []) contacts.push({ kind: "missile", x: p.x, z: p.z });
  if (mp.active) {
    for (const r of mp.players.active()) {
      if (r.dead) continue;
      const rv = r.vehicle;
      const at = rv ? rv.pos : r.position;
      if (Math.hypot(at.x - pos.x, at.z - pos.z) > R) continue;
      contacts.push({ kind: "player", x: at.x, z: at.z, air: !!rv, heading: rv ? headingOf(rv) : 0, color: r.color });
    }
  }
  for (const s of world.terrain.sites.within(pos.x, pos.z, radar.range * 2.5)) {
    if (s.kind !== "airport" && s.kind !== "city") continue;
    const [ux, uz] = world.terrain.sites.dirU(s);
    contacts.push({ kind: "airport", x: s.x, z: s.z, heading: Math.atan2(-ux, -uz), size: (s.half ?? 300) * 2 });
  }
  const t = missionDirector.target;
  if (t && progress.mission && !player.creative) contacts.push({ kind: "mission", x: t.pos.x, z: t.pos.z });
  radar.draw(radarDt, { pos, heading, contacts });
  radarDt = 0;
}
const _radarV = new THREE.Vector3();

// The mission marker: a diamond over the current mission's target (with its
// name and distance), or an arrow at the edge of the screen pointing to it.
const missionMarkerEl = document.getElementById("mission-marker");
const missionMarkerLabel = missionMarkerEl.querySelector(".mm-label");
const _mm = new THREE.Vector3();
function updateMissionMarker(show) {
  const t = show ? missionDirector.target : null;
  missionMarkerEl.classList.toggle("hidden", !t);
  if (!t) return;
  _mm.copy(t.pos);
  _mm.y += 2;
  const d = Math.round(_mm.distanceTo(camera.position));
  _mm.project(camera);
  const W = window.innerWidth;
  const H = window.innerHeight;
  let x = ((_mm.x + 1) / 2) * W;
  let y = ((1 - _mm.y) / 2) * H;
  const behind = _mm.z > 1;
  const off = behind || x < 30 || x > W - 30 || y < 30 || y > H - 30;
  if (off) {
    // Clamp to the screen edge, pointing the way to turn.
    let ax = x - W / 2;
    let ay = y - H / 2;
    if (behind) {
      ax = -ax;
      ay = -ay;
      if (Math.abs(ay) < 1 && Math.abs(ax) < 1) ay = H;
    }
    const k = Math.min((W / 2 - 40) / Math.max(1e-3, Math.abs(ax)), (H / 2 - 50) / Math.max(1e-3, Math.abs(ay)));
    x = W / 2 + ax * k;
    y = H / 2 + ay * k;
    missionMarkerEl.style.setProperty("--a", `${Math.atan2(ay, ax) + Math.PI / 2}rad`);
  }
  missionMarkerEl.classList.toggle("edge", off);
  missionMarkerEl.style.left = `${x}px`;
  missionMarkerEl.style.top = `${y}px`;
  const text = `${t.label} ${d}m`;
  if (missionMarkerLabel.textContent !== text) missionMarkerLabel.textContent = text;
}
// The boss bar (the Overlord fight): name, health, the shield state.
const bossBarEl = document.getElementById("boss-bar");
const bossFillEl = bossBarEl.querySelector(".bb-fill");
const bossNoteEl = bossBarEl.querySelector(".bb-note");
function updateBossBar(show) {
  const b = show ? missionDirector.bossInfo : null;
  bossBarEl.classList.toggle("hidden", !b);
  if (!b) return;
  bossBarEl.classList.toggle("shielded", b.shield);
  bossBarEl.classList.toggle("final", b.final);
  bossFillEl.style.width = `${(b.health * 100).toFixed(1)}%`;
  const note = b.shield ? `SHIELD UP: ${b.pylons} pylon${b.pylons === 1 ? "" : "s"} left` : b.final ? "NO SHIELD: FINISH IT" : `SHIELD DOWN: ${Math.ceil(b.downT)} s`;
  if (bossNoteEl.textContent !== note) bossNoteEl.textContent = note;
}
// The mission tracker (Survival): the current mission, its objectives, and
// the way to a supply crate that is on the ground.
const missionEl = document.getElementById("mission-tracker");
let missionT = 0;
let missionSig = "";
function updateMissions(dt) {
  const show = gameState === "playing" && crates.enabled && !hudHidden;
  ufos.difficulty = player.creative ? 0.5 : progress.difficulty(stats.world);
  // (Online the host's missions go on while its pause menu is open.)
  // (A guest's tracker shows the host's director: js/net/coop.js.)
  if (!GUEST && (gameState === "playing" || (mp.active && mp.isHost && gameState !== "start"))) missionDirector.update(dt);
  updateMissionMarker(show);
  updateBossBar(show);
  // (Missions complete even with the HUD hidden.)
  missionT -= dt;
  const tick = missionT <= 0;
  if (tick) {
    missionT = 0.4;
    progress.update(stats.world);
  }
  if (!show) {
    if (!missionEl.classList.contains("hidden")) missionEl.classList.add("hidden");
    return;
  }
  if (!tick && !missionEl.classList.contains("hidden")) return;
  const m = progress.mission;
  const parts = [];
  if (m) {
    parts.push(`<div class="mt-head"><span class="mt-title">${m.title}</span><span class="mt-step">MISSION ${progress.completed + 1}/${MISSIONS.length}</span></div><div class="mt-text">${m.text}</div>`);
    for (const o of progress.objectives(stats.world)) {
      parts.push(`<div class="mt-obj${o.value >= o.goal ? " done" : ""}">${o.value >= o.goal ? "\u2714" : "\u25CB"} ${o.label}: ${o.value}/${o.goal}</div>`);
      parts.push(`<div class="mt-bar"><div style="width:${Math.round((o.value / o.goal) * 100)}%"></div></div>`);
    }
    const t = missionDirector.target;
    if (t) {
      const dx = t.pos.x - player.position.x;
      const dz = t.pos.z - player.position.z;
      const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) / 45) % 8];
      parts.push(`<div class="mt-target">\u25C6 ${t.label}: ${Math.round(Math.hypot(dx, dz))} blocks ${dir}</div>`);
    }
    const note = missionDirector.note();
    if (note) parts.push(`<div class="mt-note">${note}</div>`);
    const next = MISSIONS[progress.completed + 1];
    if (next) parts.push(`<div class="mt-next">Next: ${next.title} (Esc > Missions for the list)</div>`);
  } else {
    parts.push(`<div class="mt-title">ALL MISSIONS COMPLETE</div><div class="mt-text">The invasion is over: the sky stays as tough as it gets. Esc > Missions shows what you did.</div>`);
  }
  const c = crates.nearest(player.position.x, player.position.z);
  if (c) {
    const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((Math.atan2(c.dx, -c.dz) * 180) / Math.PI + 360) / 45) % 8];
    parts.push(`<div class="mt-crate">Supply crate: ${Math.round(c.dist)} blocks ${dir}</div>`);
  }
  const html = parts.join("");
  if (html !== missionSig) {
    missionSig = html;
    missionEl.innerHTML = html;
  }
  missionEl.classList.remove("hidden");
}
// First-time hints: short tips at the moments they're useful (once per
// session each).
const hintsShown = new Set();
let hintT = 0;
function hint(key, text, seconds = 5) {
  if (hintsShown.has(key)) return;
  hintsShown.add(key);
  toast(text, seconds);
}
function updateHints(dt) {
  if (gameState !== "playing" || !mods.enabled) return;
  hintT -= dt;
  if (hintT > 0) return;
  hintT = 0.5;
  if (stats.world.playTime < 20) hint("welcome", player.creative ? "Weapons are in slots 1-8. Press J for your jet. Hold both mouse buttons for binoculars." : "You have a sword, a pickaxe and apples. Follow your mission (top right, and the yellow marker). Hold both mouse buttons for binoculars.", 6);
  const v = vehicles.active;
  if (v?.type === "jet") hint("jet", "Mouse steers, W/S throttle, Shift afterburner. Right click fires missiles once LOCKED.", 6);
  else if (v?.type === "ufo") hint("ufo", "WASD + Space/Shift fly, wheel: speed. LMB: the ship's weapon, hold RMB: beam, hold R: streak.", 6);
  if (!v && ufos.lastHum < 260) hint("ufo-sighted", "A UFO! If its blue beam catches you, run out of the light (or shoot it down).", 5);
  if (!v && mobs.countKind("alien") > 0) hint("aliens", "Aliens! Their lasers hurt: keep moving, and hit back (bow, sword, or better).", 5);
  if (!v && itemInfo(inventory.selectedStack?.id)?.weapon?.kind === "bow") hint("bow", "The bow: hold right click to draw (a full draw in a second), let go to shoot. Arrows drop with distance.", 5);
  if (!v && itemInfo(inventory.selectedStack?.id)?.armor) hint("armor", "Armor: right click to put it on (or drag it into an armor slot in the inventory). It turns away a share of the damage.", 6);
  const wk = itemInfo(inventory.selectedStack?.id)?.weapon?.kind;
  if (!v && wk && weapons.status(wk)?.mag > 1) hint("reload", "Guns have magazines: they reload by themselves when empty, or press R.", 4);
}
function updateStatsOverlay(dt) {
  statsOverlayT -= dt;
  if (statsOverlayT > 0 || !settings.statsOverlay) return;
  statsOverlayT = 0.5;
  statsOverlayEl.textContent = `UFOs shot down: ${stats.world.ufosDown}  \u00b7  ${stats.format("playTime", stats.world.playTime)}`;
}
const hitMarkerEl = document.getElementById("hit-marker");
let hitMarkerTimer = null;
hud.hitMarker = () => {
  hitMarkerEl.classList.remove("fade");
  hitMarkerEl.classList.add("show");
  clearTimeout(hitMarkerTimer);
  hitMarkerTimer = setTimeout(() => {
    hitMarkerEl.classList.remove("show");
    hitMarkerEl.classList.add("fade");
  }, 90);
};
screens.onOpen["stats-screen"] = () => stats.renderTable(document.getElementById("stats-table"));
// The mission list (pause menu): every mission, done, current (with its
// progress) or still to come, and what each one gives.
screens.onOpen["missions-screen"] = () => {
  const el = document.getElementById("missions-list");
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const reward = (r) => r.map(([id, n]) => `${n > 1 ? `${n} x ` : ""}${itemInfo(id)?.name ?? "item"}`).join(", ");
  const intro = player.creative ? `<p class="hint">Missions run in Survival (switch the game mode in the pause menu). Creative is free play.</p>` : "";
  el.innerHTML =
    intro +
    progress
      .list(stats.world)
      .map((m) => {
        const mark = m.state === "done" ? "\u2714" : m.n;
        const obj = m.objectives ? m.objectives.map((o) => `<div class="ml-obj">${o.value >= o.goal ? "\u2714" : "\u25CB"} ${esc(o.label)}: ${o.value}/${o.goal}</div>`).join("") : "";
        const state = m.state === "current" ? " (current)" : m.state === "done" ? " (done)" : "";
        return `<div class="ml-item ${m.state}"><div class="ml-n">${mark}</div><div class="ml-title">${esc(m.title)}${state}</div><div class="ml-text">${esc(m.text)}</div><div class="ml-reward">Reward: ${esc(reward(m.reward))}</div>${obj}</div>`;
      })
      .join("");
};

// Altitude-aware view distance: flying a jet or UFO high above the ground you
// can (and want to) see much farther, so the far terrain (cheap, simplified
// tiles beyond the detail area) reaches out to 2-3x the setting, growing with
// height above the ground and capped per graphics preset. It changes in steps
// of two chunks, at most twice a second, so it never re-plans every frame.
const ALT_VIEW_MAX = { low: 1.6, medium: 2.2, high: 2.9, ultra: 3.4 };
let altViewT = 0;
function updateAltitudeView(dt) {
  altViewT -= dt;
  if (altViewT > 0) return;
  altViewT = 0.5;
  let target = renderDistance;
  const v = vehicles.active;
  if (v && (v.type === "jet" || v.type === "ufo")) {
    const ground = Math.max(world.heightAt(Math.floor(v.pos.x), Math.floor(v.pos.z)), SEA_LEVEL);
    const t = THREE.MathUtils.clamp((v.pos.y - ground - 20) / 140, 0, 1);
    const boost = 1 + ((ALT_VIEW_MAX[graphicsPreset] ?? 2.2) - 1) * t;
    target = Math.min(MAX_RENDER_DISTANCE, Math.round(renderDistance * boost));
  }
  if (target === viewRD) return;
  const next = viewRD + THREE.MathUtils.clamp(target - viewRD, -2, 2);
  if (Math.abs(next - viewRD) < 1) return;
  viewRD = next;
  updateViewDistance();
  lod.configure({ renderDistance: viewRD });
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
const MAX_DT = 0.05;

// One step of the game: everything but drawing. (In a hidden tab during a
// multiplayer game the background clock calls it without animate().)
function simulate(dt, frameTime) {
  // The world keeps running behind the inventory and death screens; only
  // the pause and start menus freeze it. Online nothing pauses: the pause
  // menu just takes your hands off the controls (a guest who hasn't clicked
  // into the game yet, or a host still on the main menu, sees the world go on
  // behind the menu).
  const online = mp.active;
  const running = gameState === "playing" || gameState === "inventory" || gameState === "dead" || (online && (gameState === "paused" || gameState === "start"));
  if (running) {
    if (gameState !== "start") player.update(dt);
    if (player.stepEvent) audio.playFootstep(BLOCK_INFO[player.stepBlock]?.sound);
    if (player.splashEvent) audio.playSplash();
    // Vehicles (the seated player rides along) and UFOs.
    vehicles.night = worldUniforms.uNight.value;
    vehicles.update(dt);
    enemyJets.update(dt);
    airports.update(dt);
    crates.update(dt);
    updateJetWatch(dt);
    if (vehicles.active) vehicles.updateCamera(camera, dt);
    updateAltitudeView(dt);
    ufos.viewDistance = viewRD * 16;
    vehicles.viewRange = viewRD * 16;
    weapons.viewRange = viewRD * 16;
    ufos.update(dt);
    nuke.update(dt, vehicles.active ? camera.position : player.getEyePosition(), sky.daylight);
    effects.listener.copy(vehicles.active ? camera.position : player.getEyePosition());
    effects.update(dt);
    effects.shake.apply(camera);
    entities.update(dt, player);
    mobs.update(dt);
    falling.update(dt);
    waterSim.update();
    // A drawn throw is dropped if the grenade leaves the hand (thrown away, swapped).
    if (weapons.charging && itemInfo(inventory.selectedStack?.id)?.weapon?.kind !== "grenade") weapons.cancel();
    weapons.update(dt);
    lasers.update(dt);
  }
  if (gameState === "start") {
    flyover.update(dt, camera, worldUniforms.uNight.value);
    effects.listener.copy(camera.position);
    if (!running) effects.update(dt);
    menuPerf.update(frameTime, graphicsPreset);
    menuUfoHint.classList.toggle("hidden", !(flyover.ufoVisible && flyover.score === 0));
  } else if (running) {
    // (the view follows the player: see above)
  } else if (vehicles.active) {
    vehicles.updateCamera(camera, 0); // keep the view behind the menus sensible
  } else {
    player.syncCamera(); // keep the view behind the menus sensible
  }
  streamAround(player.position.x, player.position.z);
  world.processQueues(gameState === "playing" ? STREAM_BUDGET_PLAYING_MS : STREAM_BUDGET_MENU_MS);
  lod.update();
  grass.update(player.position);
  distant.viewRange = viewRD * 16;
  distant.night = worldUniforms.uNight.value;
  distant.update(dt, camera);

  chord.update();
  binoculars.update(dt, gameState === "playing");
  interaction.updateTarget(gameState === "playing" && !vehicles.active);
  vehicles.updateHud(dt, gameState === "playing");
  stats.tick(dt, gameState === "playing");
  updateBeamFeedback();
  updateJetOverlay();
  updateRadar(dt);
  updateHints(dt);
  updateMissions(dt);
  updateStatsOverlay(dt);
  if (gameState === "playing") interaction.update(dt);
  if (gameState === "inventory") invScreen.refresh();

  const now = performance.now();
  if (pendingSave && now - lastSaveTime > 2000) flushSave();
  if (running && now - lastPlayerSave > 5000) {
    playerDirty = true;
    flushSave();
  }
  updateEnvironment(dt);
  hud.update(dt, player);
  hud.setWeaponStatus(gameState === "playing" && !vehicles.active ? weapons.status(itemInfo(inventory.selectedStack?.id)?.weapon?.kind) : null);
  hud.setAttackCharge(gameState === "playing" ? mobs.charge(interaction.tool) : 1);
  hud.setThrowCharge(gameState === "playing" ? weapons.charge : 0);
  ui.setScoped(gameState === "playing" && weapons.scoped);
  held.setItem(inventory.selectedStack?.id ?? 0); // follows the selected slot (no-op when unchanged)
  held.update(dt, player, heldLight, camera, interaction.eating);
  avatar.update(dt, player, heldLight, { visible: player.thirdPerson && gameState !== "start" && !vehicles.active, swing: held.swingProgress, heldId: inventory.selectedStack?.id ?? 0, bowDraw: held.bowDraw, shots: held.shots ?? 0 });
  updateDebug(dt, frameTime);
  mp.update(dt);
}

function animate() {
  requestAnimationFrame(animate);
  const frameStart = performance.now();
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, MAX_DT); // simulation step (clamped after hitches)
  simulate(dt, frameTime);

  ui.updateFps(frameTime); // real frame time, so slow frames aren't hidden by the clamp
  const simEnd = performance.now();
  const simMs = simEnd - frameStart;
  perf.simMs += (simMs - perf.simMs) * 0.1;
  perf.maxSimMs = Math.max(perf.maxSimMs, simMs);
  if (graphicsReady) {
    renderer.info.reset(); // counted over all of a frame's passes (debug overlay)
    renderFrame();
    perf.renderMs += (performance.now() - simEnd - perf.renderMs) * 0.1;
    // A few frames in, the GPU has finished drawing the first ones: this
    // preset works here (see the safe start above).
    if (++framesSinceReady === 3) saveBootRecord({ preset: graphicsPreset, ok: true });
  }
}

// Vehicles last: the player may have saved while seated in one.
if (savedPlayer?.vehicles) vehicles.load(savedPlayer.vehicles);
animate();
ui.setStartNotice(startNotice);
bootDone();
// A guest: the world is built, now the game state comes from the host.
if (GUEST) mp.startGuest();
