import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_WET, IS_SOLID } from "./blocks.js";
import { sweepAxis } from "./physics.js";
import { isVanilla } from "./worldtype.js";
import { enchantSeed, setEnchantSeed } from "./enchant.js";
import { BYPASSES_ARMOR } from "./damage.js";
import { BODY, BODY_FLAGS, SUFFOCATES, FALL_FACTOR, MAX_FOOD, START_SATURATION, EAT_TIME, EFFECTS, foodOf, missionsHeal, effectsOf, normalizeEffect } from "./survival.js";

const EYE_HEIGHT = 1.62;
const SNEAK_EYE_DROP = 0.35; // (Round 12: vanilla's crouching eyes, 1.27)
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.3;
const GRAVITY = -26;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 6.3;
const SNEAK_SPEED = 1.5;
const SWIM_SPEED = 2.6;
const FLY_SPEED = 11;
const FLY_SPRINT_SPEED = 19;
const MAX_FALL_SPEED = -50;
const WATER_GRAVITY = -7;
const WATER_MAX_SINK = -3;
const DOUBLE_TAP_WINDOW = 0.32;

export const MAX_HEALTH = 20; // half-hearts
export const MAX_AIR = 10; // bubbles (seconds of breath)
const INVULNERABLE_TIME = 0.5;
const REGEN_DELAY = 4; // seconds without damage before health regenerates
const REGEN_INTERVAL = 2.5; // seconds per half-heart
const SAFE_FALL = 3; // blocks you can fall without damage
// (Round 11) Vanilla's movement bits (both world types: the blocks exist in both).
const STEP_HEIGHT = 0.6; // walks up slabs and stairs
const CLIMB_SPEED = 2.35; // blocks/s up a ladder (vanilla: 0.1176 a tick)
const CLIMB_SLIDE = 3; // ...and the most it slides down (0.15 a tick)
const LAVA_SPEED = 1.3; // swimming in lava: half the speed in water
// Survival worlds: 15 s of breath (vanilla's 300 ticks) for the ten bubbles.
const VANILLA_AIR_TIME = 15;
// (Timers compare with a hair's margin: 0.05 s steps summed in floating point
// fall just short of 0.5.)
const TICK_EPS = 1e-6;
// Exhaustion (vanilla): every 4 points take 1 saturation, then 1 food.
const EXHAUST = { sprint: 0.1, swim: 0.01, jump: 0.05, sprintJump: 0.2, hurt: 0.1 };

export const BASE_FOV = 75;

// Camera modes (F5): first person, third person behind, third person in front.
export const CAMERA_MODES = ["first", "behind", "front"];
const THIRD_PERSON_DISTANCE = 4;
// (Round 12) Vanilla's hurt tilt: 14 degrees at most, over the 0.5 s hurt time.
const HURT_TILT = (14 * Math.PI) / 180;
// (Round 12) A sprint-jump's push forward (vanilla adds 0.2 a tick and lets
// air friction take it, 0.91 a tick): tuned so sprint-jumping averages
// vanilla's 7.1 blocks/s against a sprint's 5.6.
const SPRINT_JUMP_BOOST = 2.6;
const AIR_DRAG = 1.886; // 1/s (0.91 a tick)
// Creature attacks scaled by difficulty (settings menu).
// (Round 9: a skeleton's blow up close has its own death message; Round 11: the vanilla mobs.)
const MOB_CAUSES = new Set(["zombie", "skeleton", "skeleton_melee", "spider", "creeper", "enderman", "slime", "witch", "cave_spider", "husk", "drowned", "stray", "zombie_villager", "iron_golem", "wolf", "ghast", "blaze", "zombified_piglin", "piglin", "hoglin", "zoglin", "magma_cube", "wither_skeleton", "endermite", "silverfish", "shulker"]); // (Round 12: the Nether's and the End's)

const CAMERA_PROBE = [[0, 0, 0], [0.12, 0.12, 0.12], [-0.12, 0.12, -0.12], [0.12, -0.12, -0.12], [-0.12, -0.12, 0.12]];

export class Player {
  constructor(camera, world, domElement) {
    this.camera = camera;
    this.world = world;
    this.domElement = domElement;

    this.position = new THREE.Vector3(0, 40, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    // External horizontal push (explosions, hits). Kept separate from the
    // input-driven velocity, which is recomputed every frame, and decays
    // quickly on the ground and slowly in the air.
    this.knockback = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    // Eating, drinking, drawing a bow, a raised shield (main.js sets it each frame):
    // a Survival world's 20% walk, no sprint (vanilla).
    this.usingItem = false;
    // (Survival worlds) The ice under the feet (its slipperiness, 0: none; kept
    // in the air off it) and the walk it carries on.
    this._slip = 0;
    this._slideX = 0;
    this._slideZ = 0;
    this.inWater = false;
    this.headInWater = false;
    this.mode = "survival"; // "survival" | "creative"

    this.health = MAX_HEALTH;
    this.absorption = 0; // golden half-hearts (golden apples): soaked up before health
    this.damageFilter = null; // (amount, cause, from) -> amount: the armor worn
    this.armorWear = null; // (amount, cause): wears the armor, only for hits that land
    this.air = MAX_AIR;
    this.dead = false;
    this.hurtTime = 99; // seconds since the last damage (drives hurt effects)
    this._invulnerable = 0;
    this._lastDamage = 0;
    this._deathTime = 0;
    this._sinceDamage = 99;
    this._regenTimer = 0;
    this._drownTimer = 0;
    this._voidTimer = 0;
    this._airborneMaxY = null;
    this._eyeOffset = 0; // smoothed sneak camera drop (and a step up, eased)
    // (Round 11) Survival worlds (vanilla): hunger, status effects, fire.
    this.food = MAX_FOOD; // 0-20 (drumsticks x 2)
    this.saturation = START_SATURATION;
    this.exhaustion = 0;
    this._foodTimer = 0;
    this._peaceTimer = 0;
    this.difficulty = "normal"; // (starving's floor, Peaceful's refill; main.js)
    this.effects = []; // [{ effect, level, time, total, acc }] (survival.js EFFECTS)
    this._speedMul = 1;
    this.fireTime = 0; // seconds still burning (after leaving fire or lava)
    this._burnTimer = 0;
    this.inLava = false;
    this.onClimbable = false;
    this._body = 0; // BODY flags of the cells the player touches (this frame)
    this._eyeInWall = false;
    this._pushing = false; // walked into something last frame (climbing up a ladder)
    // In a bed (sleep.js): { x, y, z (the head's cell), dx, dz (foot to head), t (s asleep) }.
    this.sleeping = null;
    this.wantsToLeaveBed = false;
    // Experience (xp.js): the level, the way to the next one (0-1), and all collected.
    this.xpLevel = 0;
    this.xpProgress = 0;
    this.xpTotal = 0;
    this.recoil = 0; // visual upward camera kick from firing (radians), settles quickly

    this.stepEvent = false;
    this.jumpEvent = false;
    this.splashEvent = false;
    this.stepBlock = BLOCK.AIR;
    this.walkPhase = 0; // advances while walking (view/held-item bobbing)
    this._bob = 0; // 0-1: how much the view sways with the steps (eases in and out)

    this.keys = new Set();
    this.locked = false;
    this._lastSpaceTime = -10;
    this._lastWTime = -10;
    this._footstepDistance = 0;
    this.fov = BASE_FOV;
    this.zoomFov = null; // set by a scoped weapon to override the normal FOV
    this.zoomSensMul = 1; // mouse-look multiplier while zoomed (sniper scope)
    this.binocularFov = null; // binoculars (both mouse buttons): overrides everything
    this.binocularSens = 1;
    this.mouseSensitivity = 0.6; // user setting multiplier (Round 8 default: 60% of the old one)
    this.invertY = false;
    this.baseFov = BASE_FOV; // user setting
    this.mobDamageScale = 1; // difficulty
    this.cameraMode = 0; // index into CAMERA_MODES
    this._camDist = 0; // smoothed third-person camera distance
    this._dt = 0; // (this frame's step: the camera's easing)
    this.bowDraw = 0; // 0-1: a bow drawn (held-item.js): the view narrows, as vanilla's
    this._hurtSide = 1; // (the hurt tilt's direction: the blow's side, and whether from ahead)
    this._hurtFront = 0;
    this._boost = new THREE.Vector2(); // a sprint-jump's push (x, z), fading in the air

    this.vehicle = null; // the vehicle the player is in (vehicles.js)
    this.parachute = false; // descending under a parachute (no fall damage)
    this.beamLift = 0; // a UFO's tractor beam lifting the player (blocks/s), set every frame
    this.beamPull = new THREE.Vector3(); // ...and pulling toward the beam's middle
    this.mouseCapture = null; // (event) => void: a vehicle takes the mouse

    this.enabled = false;
    this.onFlightToggle = null;
    this.onHurt = null; // (amount, cause) => void
    this.onDeath = null; // (cause) => void

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousemove", this._onMouseMove);
  }

  get creative() {
    return this.mode === "creative";
  }

  // (Round 11) Hunger and the other vanilla vitals run: a Survival world, survival mode.
  get hungerOn() {
    return isVanilla() && !this.creative;
  }

  // Sprinting needs more than 3 drumsticks (vanilla), in a Survival world.
  get canSprint() {
    return !this.hungerOn || this.food > 6;
  }

  setMode(mode) {
    this.mode = mode === "creative" ? "creative" : "survival";
    if (this.creative) this.fireTime = 0;
    if (!this.creative && this.flying) {
      this.flying = false;
      if (this.onFlightToggle) this.onFlightToggle(false);
    }
    this._airborneMaxY = null;
  }

  setLocked(locked) {
    this.locked = locked;
    if (!locked) {
      this.keys.clear();
      this.sprinting = false;
    }
  }

  _onKeyDown(e) {
    if (!this.locked) return;
    // The event's own timestamp, so a slow frame between two taps doesn't
    // break a double-tap.
    const now = (e.timeStamp || performance.now()) / 1000;
    this.keys.add(e.code);
    // Seated, W and Space are the vehicle's (it reads the held keys): no
    // sprint or flight toggle, and a tap just before boarding pairs with nothing.
    if (this.vehicle) {
      this._lastWTime = this._lastSpaceTime = -10;
      return;
    }
    if (e.code === "KeyW" && !e.repeat) {
      // Double-tap W to sprint.
      if (now - this._lastWTime < DOUBLE_TAP_WINDOW && this.canSprint) this.sprinting = true;
      this._lastWTime = now;
    }
    if (e.code === "Space" && !e.repeat) {
      if (this.creative && now - this._lastSpaceTime < DOUBLE_TAP_WINDOW) {
        this.flying = !this.flying;
        this.velocity.y = 0;
        if (this.onFlightToggle) this.onFlightToggle(this.flying);
        this._lastSpaceTime = -10; // a third tap starts a new double-tap
      } else {
        this._lastSpaceTime = now;
      }
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === "KeyW") this.sprinting = false;
  }

  _onMouseMove(e) {
    if (!this.locked || this.dead || this.sleeping) return;
    if (this.mouseCapture) {
      this.mouseCapture(e);
      return;
    }
    const sensitivity = 0.0022 * this.mouseSensitivity * (this.binocularFov != null ? this.binocularSens : this.zoomSensMul);
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity * (this.invertY ? -1 : 1);
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  // Places the player standing on top of column (wx, wz).
  spawnAt(wx, wz) {
    const top = this.world.surfaceY ? this.world.surfaceY(wx, wz) : -1;
    const h = top >= 0 ? top : this.world.heightAt(wx, wz);
    this.position.set(wx + 0.5, h + 1.05, wz + 0.5);
    this.velocity.set(0, 0, 0);
    this.knockback.set(0, 0, 0);
    this._airborneMaxY = null;
  }

  // Full health and breath, alive again (used on respawn).
  revive() {
    this.health = MAX_HEALTH;
    this.absorption = 0;
    this.air = MAX_AIR;
    this.dead = false;
    this.hurtTime = 99;
    this._deathTime = 0;
    this._invulnerable = 1.5;
    this._lastDamage = Infinity; // (spawn protection: no hit but a projectile counts until it runs out)
    this._eyeOffset = 0;
    this._sinceDamage = 99;
    this.flying = false;
    this.sprinting = false;
    this.usingItem = false;
    this._slip = 0;
    this._boost.set(0, 0);
    // (Round 11) Vanilla's respawn: full food, saturation 5, no effects, not burning.
    this.food = MAX_FOOD;
    this.saturation = START_SATURATION;
    this.exhaustion = 0;
    this._foodTimer = 0;
    this.clearEffects();
    this.fireTime = 0;
    this.sleeping = null;
    this.wantsToLeaveBed = false;
  }

  // Pushes the player: the horizontal part becomes decaying knockback, the
  // vertical part is added straight to the velocity (ignored while flying).
  applyImpulse(impulse) {
    this.knockback.x += impulse.x;
    this.knockback.z += impulse.z;
    if (!this.flying) this.velocity.y = Math.max(this.velocity.y, 0) + impulse.y;
  }

  // Kicks the view up a little (gun recoil); purely visual, it settles by itself.
  kick(amount) {
    this.recoil = Math.min(0.25, this.recoil + amount);
  }

  // Deals damage in half-hearts. Returns true if it was applied (creative
  // players, the dead and the briefly invulnerable take none).
  // from: where the hit comes from (a point), if known.
  damage(amount, cause, { pierce = false, projectile = false, from = null } = {}) {
    // In a vehicle, hits land on the vehicle instead (unless `pierce`: the
    // vehicle itself was destroyed with the pilot inside).
    if (this.vehicle && !pierce) {
      this.vehicle.damage(amount, cause);
      return false;
    }
    if (MOB_CAUSES.has(cause) && this.mobDamageScale !== 1) {
      if (this.mobDamageScale <= 0) return false;
      amount = Math.max(1, Math.round(amount * this.mobDamageScale));
    }
    if (this.dead || this.creative || amount <= 0) return false;
    const raw = amount;
    if (this.damageFilter && !pierce) {
      amount = this.damageFilter(amount, cause, from);
      if (amount <= 0) return false;
    }
    // Right after a hit only a stronger hit counts (and only its excess).
    // (Projectiles, a UFO's or an alien's shots, always count in full: each
    // one that reaches you hurts, bursts included.)
    let applied = amount;
    if (projectile) {
      // no grace time
    } else if (this._invulnerable > 0 && !pierce) {
      // (A pierce, the vehicle destroyed with you inside or the beam's end,
      // always lands: the spawn protection is no seat belt.)
      if (amount <= this._lastDamage) return false;
      applied = amount - this._lastDamage;
      this._lastDamage = amount;
    } else {
      this._invulnerable = INVULNERABLE_TIME;
      this._lastDamage = amount;
    }
    if (this.armorWear && !pierce) this.armorWear(raw, cause);
    if (this.absorption > 0) {
      const soak = Math.min(this.absorption, applied);
      this.absorption -= soak;
      applied -= soak;
    }
    this.health = Math.max(0, this.health - applied);
    this._sinceDamage = 0;
    this.hurtTime = 0;
    // (Round 12) The view tilts away from where the blow came from (vanilla's
    // hurt direction); a hurt from nowhere (a fall, a cactus) rolls it.
    this._hurtSide = 1;
    this._hurtFront = 0;
    if (from && Number.isFinite(from.x)) {
      const dx = from.x - this.position.x;
      const dz = from.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        this._hurtSide = (dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw)) / d;
        this._hurtFront = (-dx * Math.sin(this.yaw) - dz * Math.cos(this.yaw)) / d;
      }
    }
    // (Round 11) A hit costs a little food (not the ones armor can't stop),
    // and wakes a sleeper.
    if (!BYPASSES_ARMOR.has(cause)) this.addExhaustion(EXHAUST.hurt);
    if (this.sleeping) this.wantsToLeaveBed = true;
    if (this.onHurt) this.onHurt(amount, cause);
    if (this.health <= 0) {
      this.dead = true;
      this._deathTime = 0;
      this.sprinting = false;
      this.flying = false;
      this.sleeping = null;
      this.fireTime = 0;
      if (this.onDeath) this.onDeath(cause);
    }
    return true;
  }

  // ---------- Hunger, food and status effects (Round 11, Survival worlds) ----------

  addExhaustion(amount) {
    if (this.hungerOn && amount > 0) this.exhaustion = Math.min(40, this.exhaustion + amount);
  }

  // Whether the food can be eaten now: a Survival world, when not full (or
  // food that can always be eaten); a Missions world, when hurt (as before).
  canEat(info, id) {
    if (!info?.food || this.creative || this.dead) return false;
    if (!isVanilla()) return this.health < MAX_HEALTH || (!!info.absorb && this.absorption < 20) || !!info.clearEffects;
    const f = foodOf(info, id);
    return !!f && (this.food < MAX_FOOD || f.alwaysEat);
  }

  // Seconds it takes to eat (Missions worlds keep their quicker bite).
  eatTime(info, id) {
    return isVanilla() ? foodOf(info, id)?.eatTime ?? EAT_TIME : 1.1;
  }

  // Eats the food: hunger and saturation and its effects (a Survival world),
  // or health (a Missions world). Returns the item left in hand (a stew's
  // bowl), or 0.
  eat(info, id) {
    // (Milk: every effect gone, in either world.)
    if (info.clearEffects) this.clearEffects();
    if (!isVanilla()) {
      this.heal(missionsHeal(info, id));
      if (info.absorb) this.addAbsorption(info.absorb);
      return foodOf(info, id)?.returns || 0;
    }
    const f = foodOf(info, id);
    if (!f) return 0;
    this.food = Math.min(MAX_FOOD, this.food + f.hunger);
    this.saturation = Math.min(this.food, this.saturation + f.saturation);
    for (const e of effectsOf(info, id)) if (Math.random() < e.chance) this.addEffect(e.effect, e.seconds, e.level);
    return f.returns || 0;
  }

  effectLevel(name) {
    for (const e of this.effects) if (e.effect === name) return e.level;
    return 0;
  }

  // Adds a status effect (vanilla: a stronger one replaces a weaker one; the
  // same level only lasts longer). Instant ones act at once.
  addEffect(name, seconds, level = 1) {
    const n = normalizeEffect({ effect: name, seconds, level });
    if (!n || this.dead) return false;
    const L = n.level;
    if (n.effect === "instant_health") return this.heal(4 << (L - 1)) > 0;
    if (n.effect === "instant_damage") return this.damage(6 << (L - 1), "magic");
    if (n.effect === "saturation") {
      this.food = Math.min(MAX_FOOD, this.food + L);
      this.saturation = Math.min(this.food, this.saturation + 2 * L);
      return true;
    }
    if (n.seconds <= 0) return false;
    let e = null;
    for (const x of this.effects) if (x.effect === n.effect) e = x;
    if (e && (L < e.level || (L === e.level && n.seconds <= e.time))) return false;
    if (!e) this.effects.push((e = { effect: n.effect, level: L, time: 0, total: 0, acc: 0 }));
    e.level = L;
    e.time = e.total = n.seconds;
    e.acc = 0;
    // (Absorption: 4 golden half-hearts a level, not stacked with what is left.)
    if (n.effect === "absorption") this.absorption = Math.max(this.absorption, Math.min(20, 4 * L));
    this._refreshSpeed();
    return true;
  }

  removeEffect(name) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.effect !== name) continue;
      this.effects.splice(i, 1);
      if (e.effect === "absorption") this.absorption = Math.max(0, this.absorption - 4 * e.level);
    }
    this._refreshSpeed();
  }

  // Every effect gone (a milk bucket, dying).
  clearEffects() {
    for (let i = this.effects.length - 1; i >= 0; i--) this.removeEffect(this.effects[i].effect);
  }

  _refreshSpeed() {
    this._speedMul = Math.max(0, (1 + 0.2 * this.effectLevel("speed")) * (1 - 0.15 * this.effectLevel("slowness")));
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.time -= dt;
      e.acc += dt;
      const L = e.level;
      if (e.effect === "regeneration") {
        // (vanilla: a half-heart every 50 ticks at I, 25 at II...)
        const every = Math.max(0.05, 2.5 / (1 << (L - 1)));
        while (e.acc >= every - TICK_EPS) {
          e.acc -= every;
          if (this.health < MAX_HEALTH) this.heal(1);
        }
      } else if (e.effect === "poison") {
        // (every 25 ticks at I; never below one half-heart)
        const every = Math.max(0.05, 1.25 / (1 << (L - 1)));
        if (e.acc >= every - TICK_EPS) {
          e.acc -= every;
          if (this.health > 1) this.damage(1, "poison");
        }
      } else if (e.effect === "wither") {
        // (Round 12: a half-heart every 40 ticks at I, 20 at II...; unlike poison it can kill)
        const every = Math.max(0.05, 2 / (1 << (L - 1)));
        if (e.acc >= every - TICK_EPS) {
          e.acc -= every;
          this.damage(1, "wither");
        }
      } else if (e.effect === "hunger") this.addExhaustion(0.1 * L * dt);
      else e.acc = 0;
      if (e.time <= 0) this.removeEffect(e.effect);
      if (this.dead) return;
    }
  }

  // Vanilla's food rules (FoodData.tick), in a Survival world: exhaustion
  // takes saturation, then food; with a full bar (and saturation) health
  // comes back fast, from 18 food points slowly; at 0 you starve, down to the
  // difficulty's floor. Peaceful: food refills and health comes back.
  _updateFood(dt) {
    if (!this.hungerOn || this.dead) return;
    const peaceful = this.difficulty === "peaceful";
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (!peaceful) this.food = Math.max(0, this.food - 1);
    }
    if (peaceful) {
      this._peaceTimer += dt;
      while (this._peaceTimer >= 0.5 - TICK_EPS) {
        this._peaceTimer -= 0.5;
        this._peaceTick = !this._peaceTick;
        if (this._peaceTick && this.health < MAX_HEALTH) this.heal(1); // (a half-heart a second)
        if (this.food < MAX_FOOD) this.food++; // (a point every 10 ticks)
      }
    }
    const hurt = this.health < MAX_HEALTH;
    if (this.saturation > 0 && hurt && this.food >= MAX_FOOD) {
      this._foodTimer += dt;
      if (this._foodTimer >= 0.5 - TICK_EPS) {
        this._foodTimer = 0;
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.exhaustion += f;
      }
    } else if (this.food >= 18 && hurt) {
      this._foodTimer += dt;
      if (this._foodTimer >= 4 - TICK_EPS) {
        this._foodTimer = 0;
        this.heal(1);
        this.exhaustion += 6;
      }
    } else if (this.food <= 0) {
      this._foodTimer += dt;
      if (this._foodTimer >= 4 - TICK_EPS) {
        this._foodTimer = 0;
        const d = this.difficulty;
        if (this.health > 10 || d === "hard" || (this.health > 1 && d === "normal")) this.damage(1, "starve");
      }
    } else this._foodTimer = 0;
  }

  // Health comes back: the food rules in a Survival world, the old free
  // regeneration in a Missions world. Effects run in both.
  _updateHealth(dt) {
    this._updateEffects(dt);
    if (this.dead) return;
    if (isVanilla()) this._updateFood(dt);
    else this._updateRegen(dt);
  }

  // ---------- Beds (sleep.js decides; the player lies there) ----------

  // Lies down in the bed whose head is cell (x, y, z), the foot at -(dx, dz).
  startSleeping({ x, y, z, dx, dz }) {
    this.sleeping = { x, y, z, dx, dz, t: 0 };
    this.wantsToLeaveBed = false;
    this.velocity.set(0, 0, 0);
    this.knockback.set(0, 0, 0);
    this.sprinting = false;
    this.flying = false;
    this._slip = 0;
    this._airborneMaxY = null;
    // (Feet at the bed's foot end, on the mattress; facing the foot.)
    this.position.set(x + 0.5 - dx * 1.5, y + 0.5625, z + 0.5 - dz * 1.5);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = 0;
  }

  // Out of bed, standing at `at` (a Vector3-like), or where the player is.
  stopSleeping(at = null) {
    this.sleeping = null;
    this.wantsToLeaveBed = false;
    if (at) this.position.set(at.x, at.y, at.z);
    this.velocity.set(0, 0, 0);
    this._airborneMaxY = null;
  }

  // ---------- Saving ----------

  serializeSurvival() {
    const r = (v) => Math.round(v * 1000) / 1000;
    return {
      food: this.food,
      sat: r(this.saturation),
      exh: r(this.exhaustion),
      fire: this.fireTime > 0 ? r(this.fireTime) : undefined,
      fx: this.effects.length ? this.effects.map((e) => [e.effect, e.level, r(e.time), r(e.total)]) : undefined,
      xp: [this.xpLevel, r(this.xpProgress), this.xpTotal],
      es: enchantSeed(), // (the enchanting table's offers, as vanilla's per-player seed)
    };
  }

  // (An old save has none: full food, as a new player.)
  loadSurvival(d) {
    if (!d || typeof d !== "object") return;
    if (Number.isInteger(d.es)) setEnchantSeed(d.es);
    const clamp = (v, lo, hi, def) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
    this.food = Math.round(clamp(d.food, 0, MAX_FOOD, MAX_FOOD));
    this.saturation = clamp(d.sat, 0, this.food, START_SATURATION);
    this.exhaustion = clamp(d.exh, 0, 40, 0);
    this.fireTime = clamp(d.fire, 0, 60, 0);
    this.effects = [];
    if (Array.isArray(d.fx)) {
      for (const e of d.fx) {
        if (!Array.isArray(e) || typeof e[0] !== "string" || !(e[2] > 0)) continue;
        const level = Math.round(clamp(e[1], 1, 10, 1));
        this.effects.push({ effect: e[0], level, time: clamp(e[2], 0, 3600, 0), total: clamp(e[3], 0, 3600, e[2]), acc: 0 });
      }
    }
    this._refreshSpeed();
    if (Array.isArray(d.xp)) {
      this.xpLevel = Math.round(clamp(d.xp[0], 0, 1e6, 0));
      this.xpProgress = clamp(d.xp[1], 0, 0.9999, 0);
      this.xpTotal = Math.round(clamp(d.xp[2], 0, 2e9, 0));
    }
  }

  // Golden hearts on top of the health bar (capped).
  addAbsorption(amount, max = 20) {
    const before = this.absorption;
    this.absorption = Math.min(max, this.absorption + amount);
    return this.absorption - before;
  }

  heal(amount) {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    return this.health - before;
  }

  getEyePosition() {
    // (In bed the eyes are on the pillow, at the head's end.)
    const s = this.sleeping;
    if (s) return new THREE.Vector3(this.position.x + s.dx * 1.55, this.position.y + 0.2, this.position.z + s.dz * 1.55);
    return new THREE.Vector3(this.position.x, this.position.y + EYE_HEIGHT - this._eyeOffset, this.position.z);
  }

  // Computed directly from yaw/pitch rather than camera.getWorldDirection(),
  // since the camera's matrixWorld isn't refreshed until renderer.render()
  // runs — using it here would read one frame stale during fast look input.
  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // Points the camera from the player's eyes along the current yaw/pitch,
  // with a brief roll when hurt and a fall to the side when dead.
  syncCamera() {
    let roll = 0;
    let drop = 0;
    let tiltPitch = 0;
    if (this.hurtTime < 0.5 && !this.dead) {
      // (Round 12) Vanilla's: sin(k^4 pi) x 14 degrees, k running 1 -> 0 over the
      // hurt time: a quick knock, then a slow return.
      const k = 1 - this.hurtTime / 0.5;
      const tilt = Math.sin(k * k * k * k * Math.PI) * HURT_TILT;
      roll = tilt * this._hurtSide;
      tiltPitch = tilt * this._hurtFront * 0.6;
    }
    if (this.dead) {
      const k = Math.min(1, this._deathTime / 0.55);
      roll = k * k * 1.2;
      drop = k * k * 1.15;
    }
    this.camera.rotation.order = "YXZ";
    const pitch = Math.min(Math.PI / 2, this.pitch + this.recoil + tiltPitch);
    const eye = this.getEyePosition();
    eye.y -= drop;
    // A scoped weapon or binoculars always look from the eyes (first person).
    const mode = this.zoomFov != null || this.binocularFov != null || this.sleeping ? "first" : CAMERA_MODES[this.cameraMode] || "first";
    if (this.sleeping) {
      // In bed: looking down the bed, a little up (no turning, as in vanilla).
      this.camera.rotation.set(0.3, this.yaw, 0);
      this.camera.position.copy(eye);
      this._camDist = 0;
      return;
    }
    if (mode === "first") {
      // A subtle sway with the steps (not when scoped; the aim itself is unmoved).
      let swayY = 0;
      let swayX = 0;
      if (this._bob > 0.01 && this.zoomFov == null && this.binocularFov == null && !this.dead) {
        const k = this._bob * (this.sprinting ? 1.4 : 1);
        swayY = Math.sin(this.walkPhase * 2) * 0.022 * k;
        swayX = Math.sin(this.walkPhase) * 0.012 * k;
        roll += Math.sin(this.walkPhase) * 0.0035 * k;
      }
      this.camera.rotation.set(pitch, this.yaw, roll);
      this.camera.position.set(eye.x + Math.cos(this.yaw) * swayX, eye.y + swayY, eye.z - Math.sin(this.yaw) * swayX);
      this._camDist = 0;
      return;
    }
    // Third person: pull the camera back along the view (or out in front,
    // looking back at the player), stopping short of any solid block.
    const f = this.getForwardVector();
    const sign = mode === "behind" ? -1 : 1;
    const dist = this._clearDistance(eye, f.x * sign, f.y * sign, f.z * sign, THIRD_PERSON_DISTANCE);
    // Snap in at once when something is in the way, ease back out otherwise.
    this._camDist = dist < this._camDist ? dist : this._camDist + (dist - this._camDist) * Math.min(1, (this._dt || 1 / 60) * 9);
    this.camera.position.set(eye.x + f.x * sign * this._camDist, eye.y + f.y * sign * this._camDist, eye.z + f.z * sign * this._camDist);
    if (mode === "behind") this.camera.rotation.set(pitch, this.yaw, roll);
    else this.camera.rotation.set(-pitch, this.yaw + Math.PI, -roll);
  }

  // Whether the view is a third-person one now (Round 12: not while a
  // scope or the binoculars, or a bed, hold it at the eyes: the body is
  // drawn only then).
  get thirdPerson() {
    return this.cameraMode !== 0 && this.zoomFov == null && this.binocularFov == null && !this.sleeping;
  }

  // (Round 12) Seconds since dying (0 alive): the third-person body falls over.
  get deathTime() {
    return this.dead ? this._deathTime : 0;
  }

  // Cycles first person -> behind -> in front -> first person.
  cycleCamera() {
    this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES.length;
    this._camDist = 0;
    return CAMERA_MODES[this.cameraMode];
  }

  // How far the camera can move from `from` along (dx, dy, dz) (unit) before
  // it gets closer than a small margin to a solid block, up to `max`.
  _clearDistance(from, dx, dy, dz, max) {
    const margin = 0.3;
    const step = 0.1;
    for (let t = step; t <= max + margin; t += step) {
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      const z = from.z + dz * t;
      // Check a small box around the point so the near plane doesn't clip walls.
      for (const [ox, oy, oz] of CAMERA_PROBE) {
        if (this.world.isSolidAt(Math.floor(x + ox), Math.floor(y + oy), Math.floor(z + oz))) return Math.max(0, t - margin);
      }
    }
    return max;
  }

  // Maximum movement along one axis before the player's box would overlap a
  // solid voxel (see physics.js); also detects landing on the ground.
  _sweepAxis(axis, delta) {
    const allowed = sweepAxis(this.world, this.position, PLAYER_RADIUS, PLAYER_HEIGHT, axis, delta);
    if (axis === "y" && delta < 0 && allowed > delta) this.onGround = true;
    return allowed;
  }

  // Whether a solid block lies under the player's footprint if it were at (x, z).
  _hasSupportAt(x, z) {
    const r = PLAYER_RADIUS - 0.02;
    const y = Math.floor(this.position.y - 0.4);
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
      for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
        if (this.world.isSolidAt(bx, y, bz)) return true;
      }
    }
    return false;
  }

  // 0: no fluid at the player's column, height yOffset; 1: water; 2: lava.
  _fluidAt(yOffset) {
    const p = this.position;
    const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + yOffset), Math.floor(p.z));
    if (BODY_FLAGS[id] & BODY.LAVA) return 2;
    return IS_WET[id] === 1 ? 1 : 0;
  }

  _waterAt(yOffset) {
    return this._fluidAt(yOffset) === 1;
  }

  // (Round 11) What the body touches this frame (one pass over the few cells
  // around it): lava and fire (inside the box), cobwebs, a cactus (the box
  // grown a little: touching one is enough), a ladder or vine at the feet
  // (inside its cell, or a solid one against the box), and whether the eyes
  // are inside an opaque block.
  _scanBody() {
    const p = this.position;
    const w = this.world;
    const r = PLAYER_RADIUS;
    const e = 0.05;
    const feetY = Math.floor(p.y + 0.01);
    let flags = 0;
    let climb = false;
    for (let bx = Math.floor(p.x - r - e); bx <= Math.floor(p.x + r + e); bx++) {
      for (let bz = Math.floor(p.z - r - e); bz <= Math.floor(p.z + r + e); bz++) {
        const inXZ = bx + 1 > p.x - r && bx < p.x + r && bz + 1 > p.z - r && bz < p.z + r;
        for (let by = Math.floor(p.y - e); by <= Math.floor(p.y + PLAYER_HEIGHT + e); by++) {
          const id = w.getBlock(bx, by, bz);
          const f = BODY_FLAGS[id];
          if (!f) continue;
          const inside = inXZ && by + 1 > p.y && by < p.y + PLAYER_HEIGHT;
          if (inside) flags |= f & (BODY.LAVA | BODY.FIRE | BODY.WEB);
          // (A cactus: its cell touched from a side, stood on or bumped from
          // below: the box grown by `e` reaches it, across a face, not just
          // at an edge. Vanilla's cactus is 1/16 thinner than its cell, so a
          // body against it is inside its cell.)
          if (f & BODY.CACTUS && (inXZ || (by + 1 > p.y && by < p.y + PLAYER_HEIGHT))) flags |= BODY.CACTUS;
          if (f & BODY.CLIMB && by === feetY && (inXZ || IS_SOLID[id])) climb = true;
        }
      }
    }
    this._body = flags;
    this.onClimbable = climb && !this.flying;
    this._eyeInWall = SUFFOCATES[w.getBlock(Math.floor(p.x), Math.floor(p.y + EYE_HEIGHT - this._eyeOffset), Math.floor(p.z))] === 1;
  }

  update(dt) {
    if (!this.enabled) return;
    this._dt = dt;
    this.jumpEvent = false;
    this.splashEvent = false;
    this.stepEvent = false;
    this._invulnerable = Math.max(0, this._invulnerable - dt);
    if (this._invulnerable < TICK_EPS) this._invulnerable = 0;
    this.hurtTime += dt;
    this.recoil *= Math.exp(-14 * dt);

    // Seated in a vehicle: it moves us (vehicles.js); only health comes back.
    if (this.vehicle && !this.dead) {
      this.inWater = false;
      this.inLava = false;
      this.headInWater = false;
      this.fireTime = 0;
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this._airborneMaxY = null;
      this._sinceDamage += dt;
      this._updateHealth(dt);
      return;
    }

    if (this.dead) {
      this._deathTime += dt;
      this.syncCamera();
      return;
    }

    // (Round 11) In bed: still, the eyes on the pillow; Shift gets up (sleep.js
    // stands the player up next to the bed).
    if (this.sleeping) {
      // (The time asleep is counted by sleep.js: it goes on behind an online pause menu.)
      this.sprinting = false;
      this.sneaking = false;
      this.inWater = this.inLava = this.headInWater = false;
      this.velocity.set(0, 0, 0);
      if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) this.wantsToLeaveBed = true;
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this._sinceDamage += dt;
      this._updateHealth(dt);
      this._eyeOffset = 0;
      this.syncCamera();
      return;
    }

    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has("KeyW")) moveZ -= 1;
    if (this.keys.has("KeyS")) moveZ += 1;
    if (this.keys.has("KeyA")) moveX -= 1;
    if (this.keys.has("KeyD")) moveX += 1;
    if ((this.keys.has("ControlLeft") || this.keys.has("ControlRight")) && this.keys.has("KeyW") && this.canSprint) this.sprinting = true;
    const shift = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.sneaking = shift && !this.flying;
    const using = this.usingItem && !this.flying && isVanilla();
    if (this.sneaking || moveZ >= 0 || !this.canSprint || using) this.sprinting = false;

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      moveX /= len;
      moveZ /= len;
    }

    const wasInWater = this.inWater;
    const lo = this._fluidAt(0.4);
    const hi = this._fluidAt(1.0);
    this.inWater = lo === 1 || hi === 1;
    this.inLava = !this.inWater && (lo === 2 || hi === 2);
    this.headInWater = this._waterAt(EYE_HEIGHT - this._eyeOffset);
    if (this.inWater && !wasInWater && this.velocity.y < -4) this.splashEvent = true;
    this._scanBody();
    const web = (this._body & BODY.WEB) !== 0;

    // Rotate the camera-space input (x = right, z = backward, since the camera
    // looks down -Z) by the yaw around +Y into world space. At yaw 0, W gives
    // (0, -1) = forward and D gives (1, 0) = right; in general forward is
    // (-sin yaw, -cos yaw), matching getForwardVector().
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const worldX = moveX * cosY + moveZ * sinY;
    const worldZ = -moveX * sinY + moveZ * cosY;

    let speed;
    if (this.flying) speed = this.sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
    else if (this.inWater) speed = this.sprinting ? SWIM_SPEED * 1.4 : SWIM_SPEED;
    else if (this.inLava) speed = LAVA_SPEED;
    else if (this.sneaking) speed = SNEAK_SPEED;
    else speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (!this.flying) speed *= this._speedMul * (web ? 0.25 : 1);
    if (using) speed *= 0.2;
    let walkX = worldX * speed;
    let walkZ = worldZ * speed;
    if (this._slip > 0 && !this.flying && !this.inWater && !this.inLava && !web) {
      // Ice: the walk eases toward the input (vanilla keeps slipperiness x 0.91 of it a tick).
      const keep = Math.pow(this._slip * 0.91, dt * 20);
      walkX += (this._slideX - walkX) * keep;
      walkZ += (this._slideZ - walkZ) * keep;
    }
    this._slideX = walkX;
    this._slideZ = walkZ;
    // (Round 12) A sprint-jump's push fades in the air and is gone on landing.
    const boost = this._boost;
    if (this.flying || this.inWater || this.inLava || web || this.onGround || this.onClimbable) boost.set(0, 0);
    else boost.multiplyScalar(Math.exp(-AIR_DRAG * dt));
    this.velocity.x = walkX + this.knockback.x + boost.x;
    this.velocity.z = walkZ + this.knockback.z + boost.y;
    const knockbackDecay = Math.exp(-(this.onGround ? 7 : 1.2) * dt);
    this.knockback.x *= knockbackDecay;
    this.knockback.z *= knockbackDecay;

    const space = this.keys.has("Space");
    const beamed = this.beamLift > 0;
    if (beamed) {
      // Caught in a tractor beam: lifted, and pulled to the middle (you can
      // still walk out of it).
      this.velocity.y = this.beamLift;
      this.velocity.x += this.beamPull.x;
      this.velocity.z += this.beamPull.z;
      this.beamLift = 0;
      this._airborneMaxY = null;
    } else if (this.flying) {
      let vy = 0;
      if (space) vy += 1;
      if (shift) vy -= 1;
      this.velocity.y = vy * speed;
    } else if (this.effectLevel("levitation") > 0) {
      // (Round 12) Levitation: up 0.9 blocks a second a level, no gravity (vanilla's); the fall counts from where it ends.
      const up = 0.9 * this.effectLevel("levitation");
      this.velocity.y += (up - this.velocity.y) * Math.min(1, dt * 4);
      this._airborneMaxY = null;
    } else if (this.inWater) {
      this.velocity.y = Math.max(this.velocity.y + WATER_GRAVITY * dt, WATER_MAX_SINK);
      if (space) this.velocity.y = Math.min(this.velocity.y + 28 * dt, 3.6);
    } else if (this.inLava) {
      // (Thicker than water: slower to sink, slower to swim up.)
      this.velocity.y = Math.max(this.velocity.y + WATER_GRAVITY * 0.6 * dt, WATER_MAX_SINK * 0.6);
      if (space) this.velocity.y = Math.min(this.velocity.y + 18 * dt, 2);
    } else if (this.parachute) {
      // Under a canopy: a slow, steady descent.
      this.velocity.y = Math.max(this.velocity.y + GRAVITY * dt, -3.2);
      if (this.velocity.y > 0) this.velocity.y *= Math.exp(-2 * dt);
    } else {
      this.velocity.y += GRAVITY * dt;
      if (this.velocity.y < MAX_FALL_SPEED) this.velocity.y = MAX_FALL_SPEED;
      if (this.onGround && space && !this.onClimbable) {
        this.velocity.y = JUMP_SPEED;
        this.jumpEvent = true;
        // (Round 12) Sprint-jumping: a push the way you face (vanilla's).
        if (this.sprinting) {
          this._boost.set(-sinY * SPRINT_JUMP_BOOST, -cosY * SPRINT_JUMP_BOOST);
          this.velocity.x += this._boost.x;
          this.velocity.z += this._boost.y;
        }
      }
      if (this.onClimbable) {
        // (Round 11) On a ladder or vine (vanilla): walking into it or jumping
        // climbs, sneaking holds on, otherwise a slow slide down.
        if (space || this._pushing) this.velocity.y = CLIMB_SPEED;
        else if (this.sneaking) this.velocity.y = Math.max(this.velocity.y, 0);
        else this.velocity.y = Math.max(this.velocity.y, -CLIMB_SLIDE);
        this._airborneMaxY = null;
      }
    }
    if (web && !this.flying) {
      // A cobweb holds you: barely sinking, barely jumping, no fall.
      this.velocity.y = Math.max(-0.8, Math.min(this.velocity.y, 0.8));
      this._airborneMaxY = null;
    }

    const wasOnGround = this.onGround;
    this.onGround = false;
    const edgeGuard = this.sneaking && wasOnGround && this.velocity.y <= 0;
    const x0 = this.position.x;
    const y0 = this.position.y;
    const z0 = this.position.z;
    const wantX = this.velocity.x * dt;
    const wantZ = this.velocity.z * dt;

    let dx = this._sweepAxis("x", wantX);
    // Sneaking: don't walk off the edge of a block.
    if (edgeGuard && dx !== 0 && !this._hasSupportAt(this.position.x + dx, this.position.z)) dx = 0;
    this.position.x += dx;
    let blockedX = Math.abs(dx) < Math.abs(wantX) - 1e-6;

    const dy = this._sweepAxis("y", this.velocity.y * dt);
    this.position.y += dy;
    if (Math.abs(dy - this.velocity.y * dt) > 1e-6) this.velocity.y = 0;

    let dz = this._sweepAxis("z", wantZ);
    if (edgeGuard && dz !== 0 && !this._hasSupportAt(this.position.x, this.position.z + dz)) dz = 0;
    this.position.z += dz;
    let blockedZ = Math.abs(dz) < Math.abs(wantZ) - 1e-6;

    // (Round 11) Vanilla's step: blocked on the ground (or on a ladder), try
    // the same move 0.6 higher and settle down onto what is there, so slabs,
    // stairs and the top of a ladder are walked up.
    if ((blockedX || blockedZ) && (wasOnGround || this.onClimbable) && !this.flying && !this.inWater && !this.inLava && this.velocity.y <= 0) {
      const step = this._tryStep(x0, y0, z0, wantX, wantZ, dx, dz);
      if (step) {
        dx = this.position.x - x0;
        dz = this.position.z - z0;
        blockedX = Math.abs(dx) < Math.abs(wantX) - 1e-6;
        blockedZ = Math.abs(dz) < Math.abs(wantZ) - 1e-6;
        // (The eyes rise smoothly instead of jumping up.)
        this._eyeOffset = Math.min(0.9, this._eyeOffset + step);
      }
    }
    if (dx === 0) {
      this.velocity.x = 0;
      this.knockback.x = 0;
      this._boost.x = 0;
    }
    if (dz === 0) {
      this.velocity.z = 0;
      this.knockback.z = 0;
      this._boost.y = 0;
    }
    this._pushing = (blockedX || blockedZ) && len > 0;
    if (blockedX) this._slideX = 0;
    if (blockedZ) this._slideZ = 0;
    // (Survival worlds) What the feet stand on: ice slides (kept in the air, until landing elsewhere).
    if (!isVanilla() || this.flying || this.inWater || this.inLava || this.onClimbable || web) this._slip = 0;
    else if (this.onGround) this._slip = BLOCK_INFO[this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y - 0.05), Math.floor(this.position.z))]?.slipperiness || 0;

    // Climb out of water onto a ledge when swimming against it.
    if ((this.inWater || this.inLava) && space && (blockedX || blockedZ)) this.velocity.y = Math.max(this.velocity.y, 6);
    if (this.sprinting && (blockedX || blockedZ) && !this.inWater) this.sprinting = false;

    // (Round 11) Hunger: sprinting, swimming and jumping cost exhaustion (vanilla rates).
    if (this.hungerOn) {
      if (this.inWater) this.addExhaustion(EXHAUST.swim * Math.hypot(dx, this.headInWater ? dy : 0, dz));
      else if (this.sprinting && this.onGround) this.addExhaustion(EXHAUST.sprint * Math.hypot(dx, dz));
      if (this.jumpEvent) this.addExhaustion(this.sprinting ? EXHAUST.sprintJump : EXHAUST.jump);
    }

    this._updateFall();
    this._updateVitals(dt);

    // Footsteps (only when actually walking on the ground).
    const walking = this.onGround && !this.flying && (moveX !== 0 || moveZ !== 0);
    this._bob += ((walking ? Math.min(1, speed / 5) : 0) - this._bob) * Math.min(1, dt * 8);
    if (walking) {
      this.walkPhase += speed * dt * 1.6;
      this._footstepDistance += speed * dt;
      if (this._footstepDistance > (this.sprinting ? 2.6 : 2.1)) {
        this._footstepDistance = 0;
        this.stepEvent = !this.sneaking;
        this.stepBlock = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y - 0.2), Math.floor(this.position.z));
      }
    }

    // Camera: sneaking lowers the eyes; sprinting widens the field of view.
    const eyeTarget = this.sneaking ? SNEAK_EYE_DROP : 0;
    this._eyeOffset += (eyeTarget - this._eyeOffset) * Math.min(1, dt * 12);
    const fovTarget = this._fovTarget();
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * (this.binocularFov != null ? 16 : 8));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.syncCamera();
  }

  // The step up (vanilla's maxUpStep): from where the frame's move began,
  // up by at most STEP_HEIGHT, across, and back down onto whatever is
  // there. Kept (returns how much higher the player ends up) when it gets
  // further than the plain move did; else everything is put back (0).
  _tryStep(x0, y0, z0, wantX, wantZ, dx, dz) {
    const p = this.position;
    const x1 = p.x;
    const y1 = p.y;
    const z1 = p.z;
    const w = this.world;
    p.set(x0, y0, z0);
    const up = sweepAxis(w, p, PLAYER_RADIUS, PLAYER_HEIGHT, "y", STEP_HEIGHT);
    p.y += up;
    const sx = sweepAxis(w, p, PLAYER_RADIUS, PLAYER_HEIGHT, "x", wantX);
    p.x += sx;
    const sz = sweepAxis(w, p, PLAYER_RADIUS, PLAYER_HEIGHT, "z", wantZ);
    p.z += sz;
    const down = sweepAxis(w, p, PLAYER_RADIUS, PLAYER_HEIGHT, "y", -(up + 0.01));
    p.y += down;
    const gained = sx * sx + sz * sz - (dx * dx + dz * dz);
    if (gained > 1e-6 && p.y > y0 + 1e-4 && down > -(up + 0.01) && (!this.sneaking || this._hasSupportAt(p.x, p.z))) {
      this.onGround = true;
      return p.y - y0;
    }
    p.set(x1, y1, z1);
    return 0;
  }

  // (Round 12) Vanilla's field of view: flying widens it x1.1, the walking
  // speed by half its gain (sprinting x1.15, Speed wider, Slowness
  // narrower), a drawn bow narrows it up to x0.85.
  _fovTarget() {
    if (this.binocularFov != null) return this.binocularFov;
    if (this.zoomFov != null) return this.zoomFov;
    let f = this.flying ? 1.1 : 1;
    f *= ((this.sprinting ? 1.3 : 1) * (this.flying ? 1 : this._speedMul) + 1) / 2;
    const d = Math.min(1, this.bowDraw || 0);
    if (d > 0) f *= 1 - d * d * 0.15;
    return this.baseFov * Math.max(0.1, Math.min(1.5, f));
  }

  // Jumps straight to the current field of view (no easing).
  snapFov() {
    this.fov = this._fovTarget();
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  // Fall damage is based on the height fallen from the highest point of the
  // jump/fall, so jumping in place never hurts and water breaks any fall.
  // Forgets the height fallen so far (teleports, getting out of a vehicle).
  resetFall() {
    this._airborneMaxY = null;
    this._slip = 0; // (nor any slide off ice)
  }

  _updateFall() {
    const y = this.position.y;
    if (this.flying || this.inWater || this.inLava || this.creative || this.parachute) {
      this._airborneMaxY = null;
      return;
    }
    if (!this.onGround) {
      this._airborneMaxY = this._airborneMaxY === null ? y : Math.max(this._airborneMaxY, y);
      return;
    }
    if (this._airborneMaxY !== null) {
      const fell = this._airborneMaxY - y;
      this._airborneMaxY = null;
      // (Round 11) What it lands on can soften it (vanilla: hay, beds).
      const p = this.position;
      const k = FALL_FACTOR[this.world.getBlock(Math.floor(p.x), Math.floor(y - 0.05), Math.floor(p.z))];
      const dmg = Math.floor((fell - SAFE_FALL) * k);
      if (dmg > 0) this.damage(dmg, "fall");
    }
  }

  _updateVitals(dt) {
    this._sinceDamage += dt;
    // Breath: drains with the head under water, refills quickly above it.
    // (Survival worlds: the ten bubbles last vanilla's 15 s.)
    if (this.headInWater && !this.creative && !this.effectLevel("water_breathing")) {
      // (Round 11: Respiration on the helmet, main.js player.respiration: breath lasts 1 + level times longer, as vanilla on average.)
      this.air = Math.max(0, this.air - (isVanilla() ? (dt * MAX_AIR) / VANILLA_AIR_TIME : dt) / (1 + (this.respiration | 0)));
      if (this.air <= 0) {
        this._drownTimer += dt;
        if (this._drownTimer >= 1) {
          this._drownTimer = 0;
          this.damage(2, "drown");
        }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this._drownTimer = 0;
    }
    // Falling out of the world.
    if (this.position.y < -8) {
      if (this.creative) {
        this.position.y = 70;
        this.velocity.y = 0;
      } else {
        this._voidTimer += dt;
        if (this._voidTimer >= 0.5) {
          this._voidTimer = 0;
          this._invulnerable = 0;
          this.damage(4, "void");
        }
      }
    }
    this._updateHazards(dt);
    this._updateHealth(dt);
  }

  // (Round 11) Vanilla's block hazards. Lava (4 a hit) and fire (1) hurt in
  // any world (their blocks only come from the Survival content) and set the
  // player burning: 15 s after lava, 8 after fire, a half-heart a second,
  // until water puts it out. A cactus (1) hurts in any world (Round 12: a
  // Missions world's desert cacti too), the eyes inside a block
  // (suffocation, 1) in Survival worlds. Each is tried every frame: the hurt
  // grace time spaces the hits 0.5 s apart, as vanilla's.
  _updateHazards(dt) {
    if (this.creative) {
      this.fireTime = 0;
      return;
    }
    const fireproof = this.effectLevel("fire_resistance") > 0;
    const b = this._body;
    if (b & BODY.LAVA) {
      this.fireTime = Math.max(this.fireTime, 15);
      if (!fireproof) this.damage(4, "lava");
    } else if (b & BODY.FIRE) {
      this.fireTime = Math.max(this.fireTime, 8);
      if (!fireproof) this.damage(1, "fire");
    }
    if (this.inWater) this.fireTime = 0;
    if (this.fireTime > 0) {
      this.fireTime = Math.max(0, this.fireTime - dt);
      this._burnTimer += dt;
      if (this._burnTimer >= 1 - TICK_EPS) {
        this._burnTimer -= 1;
        if (!fireproof) this.damage(1, "burn");
      }
    } else this._burnTimer = 0;
    if (this.dead) return;
    if (b & BODY.CACTUS) this.damage(1, "cactus");
    if (this._eyeInWall && isVanilla()) this.damage(1, "suffocate");
  }

  // Natural regeneration after a while without damage.
  _updateRegen(dt) {
    if (this.health < MAX_HEALTH && this._sinceDamage > REGEN_DELAY) {
      this._regenTimer += dt;
      if (this._regenTimer >= REGEN_INTERVAL) {
        this._regenTimer = 0;
        this.heal(1);
      }
    } else {
      this._regenTimer = 0;
    }
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("mousemove", this._onMouseMove);
  }
}
