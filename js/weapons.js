// Weapons: grenades (charge-thrown, bouncing, 5 s fuse, instant on a direct
// hit on a mob), the pistol (hitscan: sparks and bullet holes on blocks,
// damage and knockback on mobs), the bazooka (a fast rocket with a smoke
// trail that explodes on terrain or mobs with a huge blast), the machine
// gun, the sniper rifle, the airstrike designator (see airstrike.js), the
// laser blaster (see lasers.js) and the bow (skeletons drop it; hold right
// click to draw it, let go to shoot: a fuller draw is faster, farther and
// harder). Ammo never runs out, but every weapon reloads, recharges or cools
// down (WEAPON_STATS), balanced by its damage: the sniper has one round and
// then a long bolt-and-reload, the pistol a 12-round magazine, the minigun
// overheats... Each weapon keeps its own magazine and timer, and reloads go
// on while you hold something else (R reloads the one in hand early), so
// none of them ever blocks another.
import * as THREE from "three";
import { BLOCK, IS_SOLID, IS_WET } from "./blocks.js";
import { itemInfo } from "./items.js";
import { grenadeGeometry, rocketGeometry } from "./models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { GRENADE_RADIUS, BAZOOKA_RADIUS } from "./effects.js";
import { Airstrikes } from "./airstrike.js";
import { LASER_COLORS } from "./lasers.js";
import { LAYER_FX } from "./layers.js";
import { WEAPON_STATS } from "./weapon-stats.js";
export { WEAPON_STATS };

export const THROW_CHARGE_TIME = 1.5; // seconds to a full-strength throw
const THROW_SPEED_MIN = 6;
const THROW_SPEED_MAX = 27;
export const GRENADE_FUSE = 5;
const GRENADE_R = 0.13;
const GRENADE_GRAVITY = -20;
const RESTITUTION = 0.38;
export const PISTOL_DAMAGE = 5;
const PISTOL_RANGE = 160;
const PISTOL_SPEED = 240; // blocks/s: a real bullet, it takes time to arrive
const BULLET_COLOR = new THREE.Color(5, 3.6, 1.2);
export const ROCKET_SPEED = 75;
const ROCKET_DIRECT = 90; // extra damage of a rocket that hits a UFO or vehicle square on
const ROCKET_GRAVITY = -2.5;
const ROCKET_LIFE = 12;
const MIN_INTERVAL = { grenade: 0.12, pistol: 0.2, bazooka: 0.2, airstrike: 0.8, blaster: 0.22, railgun: 0.5 };

// The bow: hold right click to draw (a full draw in a second), let go to shoot.
export const BOW_DRAW = 1.0;
const ARROW_SPEED_MIN = 16;
const ARROW_SPEED_MAX = 58;
const ARROW_GRAVITY = -20;
const ARROW_DAMAGE = [2, 9]; // a quick flick ... a full draw
const ARROW_LIFE = 8;

// Railgun: about a second of charging (glowing coils, a rising whine), then
// an extremely bright beam that cuts through everything in a straight line:
// every block along it is destroyed, and every creature, UFO and vehicle in
// the line is hit, very hard.
export const RAIL_CHARGE = 1.0;
export const RAIL_DAMAGE = 140;
export const RAIL_DAMAGE_UFO = 420;
const RAIL_RADIUS = 1.5; // blocks destroyed around the line
const RAIL_RANGE = 900;

// Laser minigun: the barrels spin up for a moment, then a huge stream of
// laser bolts (a few dozen per second, with a little spread).
export const MINIGUN_DAMAGE = 3;
const MINIGUN_SPINUP = 1.0; // seconds to full spin
const MINIGUN_RATE = 32; // bolts per second at full spin
const MINIGUN_SPEED = 170;
const MINIGUN_RANGE = 300;

// Bazooka lock-on: hold the button with a target near the crosshair; the
// lock builds up (an indicator closes in), and the rocket you release homes in.
export const LOCK_TIME = 1.1;
const LOCK_CONE = 0.11; // radians around the crosshair
const ROCKET_TURN = 2.4; // homing turn rate (rad/s)

// Machine gun: automatic while held, tracers, spread and recoil that climb
// the longer the trigger is held, and settle again once it's released.
export const MACHINEGUN_DAMAGE = 3;
const MACHINEGUN_RANGE = 140;
const MACHINEGUN_RATE = 12; // shots per second

// Sniper rifle: a toggled scope (zoomed FOV + overlay), a single very
// long-range, high-damage hitscan shot per left click.
export const SNIPER_DAMAGE = 34;
const SNIPER_RANGE = 400;
const SNIPER_ZOOM_FOV = 15;

// Airstrike designator: aim a laser at a spot and fire; after a delay a rain
// of meteors falls on the target and on random spots around it.
const AIRSTRIKE_AIM_RANGE = 500;

// Laser blaster (the "laser pistol"): short glowing bolts, one per click (held:
// about 4.5 per second, for as long as you like: no magazine, no reload). It is
// weaker than the pistol: 3 a bolt against the pistol's 5.
export const BLASTER_DAMAGE = 3;
const BLASTER_SPEED = 130;
const BLASTER_RANGE = 240;

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,230,1)");
  g.addColorStop(0.25, "rgba(255,200,120,0.8)");
  g.addColorStop(0.6, "rgba(255,120,40,0.2)");
  g.addColorStop(1, "rgba(255,100,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WeaponSystem {
  constructor({ scene, world, player, effects, audio, mobs, held, decals, inventory, lasers }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.mobs = mobs;
    this.held = held;
    this.decals = decals;
    this.inventory = inventory;
    this.lasers = lasers;
    this.grenades = [];
    this.rockets = [];
    this.airstrike = new Airstrikes({ scene, world, effects, audio, mobs });
    this.charging = false;
    this.chargeTime = 0;
    // One cooldown per weapon: they never block each other.
    this._cooldowns = { grenade: 0, pistol: 0, bazooka: 0, airstrike: 0, blaster: 0, railgun: 0 };
    this._queued = null; // a pistol/bazooka click that came in during the cooldown
    this._blasterFiring = false;
    this.blasterColor = "red";
    this.enabled = true; // false with mods off: every weapon is inert
    // How far you can see (blocks; set by the game). Every long-range weapon
    // reaches at least as far as what is visible, so a UFO you can see is one
    // you can hit.
    this.viewRange = 160;
    // Extra things bullets, rockets and grenades can hit (UFOs, vehicles):
    // { raycast(origin, dir, maxDist) -> { distance, hit(damage, dir, point) }, sphereHit(p, r) }.
    this.targets = [];
    this._mgFiring = false;
    this._mgTimer = 0;
    this._mgHeat = 0; // 0-1: climbs while firing, drives spread and recoil
    // Railgun.
    this.rail = { charging: false, t: 0, beams: [] };
    // Laser minigun.
    this.minigun = { held: false, spin: 0, angle: 0, timer: 0, firing: false };
    // Magazines and reloads per weapon kind (see WEAPON_STATS).
    this.ammo = {};
    this.reloadT = {};
    for (const [k, st] of Object.entries(WEAPON_STATS)) {
      if (st.mag) this.ammo[k] = st.mag;
      this.reloadT[k] = 0;
    }
    this.minigun.heat = 0;
    this.minigun.overheated = false;
    // The bow: drawing (seconds held), and arrows in flight.
    this.bow = { drawing: false, t: 0 };
    this.arrows = [];
    this.onMessage = null; // (text) => void: a short HUD notice
    // Bazooka lock-on: { target, progress, locked }.
    this.lock = { held: false, target: null, progress: 0, locked: false, scanT: 0, beepT: 0 };
    this.getLockables = null; // () => [{ pos, vel, radius, ref, alive() }] (UFOs, creatures, vehicles)
    // Things a piercing shot (railgun) hits along its whole length:
    // { all(origin, dir, range) -> [{ distance, hit(damage, dir, point) }] }.
    this.pierce = [];
    this.scoped = false;
    this.shots = 0; // pistol/machine-gun/sniper shots fired (stats / tests)
    this.material = createEntityMaterial("color");
    this._grenadeGeo = grenadeGeometry();
    this._rocketGeo = rocketGeometry();
    this._exhaustMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
      color: new THREE.Color(3, 1.8, 0.8),
    });
    this._c = {
      spark: new THREE.Color(1.6, 1.1, 0.5),
      blink: new THREE.Color(3, 0.25, 0.1),
      smoke: new THREE.Color(0.5, 0.48, 0.45),
      smokeEnd: new THREE.Color(0.7, 0.68, 0.66),
      exhaust: new THREE.Color(2.2, 1.2, 0.4),
      blood: new THREE.Color(0.45, 0.04, 0.04),
      rail: new THREE.Color(1, 2.6, 7),
      tmp: new THREE.Color(),
    };
    this._v = new THREE.Vector3();

    // A small pool of fading tracer lines, reused round-robin (machine gun, sniper).
    this._tracers = [];
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      line.layers.set(LAYER_FX);
      scene.add(line);
      this._tracers.push({ line, age: 999 });
    }
    this._tracerNext = 0;

    // The airstrike designator's laser sight, shown while it's the selected item.
    const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this._laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this._laser.frustumCulled = false;
    this._laser.visible = false;
    this._laser.layers.set(LAYER_FX);
    scene.add(this._laser);
    this._laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, fog: false }));
    this._laserDot.visible = false;
    this._laserDot.layers.set(LAYER_FX);
    scene.add(this._laserDot);
  }

  // A weapon's range: at least `base`, and a share of the visible distance.
  _range(base, share) {
    return Math.min(2400, Math.max(base, this.viewRange * share));
  }

  // 0-1 while a throw is being drawn back.
  get charge() {
    return this.charging ? Math.min(1, this.chargeTime / THROW_CHARGE_TIME) : 0;
  }

  // ---------- Magazines and reloads ----------

  // Can `kind` fire now? (Not while reloading; an empty magazine starts a
  // reload.) Shows a short notice when it can't (`quiet`: no notice).
  _ready(kind, quiet = false) {
    const st = WEAPON_STATS[kind];
    if (!st) return true;
    if (st.heat) {
      if (this.minigun.overheated) {
        if (!quiet) this._notice(`${st.label}: let it cool`);
        return false;
      }
      return true;
    }
    if (this.reloadT[kind] > 0) {
      if (!quiet) this._notice(`${st.label}...`);
      return false;
    }
    if ((this.ammo[kind] ?? st.mag) <= 0) {
      this.startReload(kind);
      return false;
    }
    return true;
  }

  // One shot of `kind` spent; an empty magazine reloads by itself.
  _spend(kind) {
    const st = WEAPON_STATS[kind];
    if (!st?.mag) return;
    this.ammo[kind] = Math.max(0, (this.ammo[kind] ?? st.mag) - 1);
    if (this.ammo[kind] <= 0) this.startReload(kind);
  }

  // Every magazine full, no reload or cooldown running (used by the tests).
  refill() {
    for (const [k, st] of Object.entries(WEAPON_STATS)) {
      if (st.mag) this.ammo[k] = st.mag;
      this.reloadT[k] = 0;
    }
    for (const k in this._cooldowns) this._cooldowns[k] = 0;
    this.minigun.heat = 0;
    this.minigun.overheated = false;
  }

  // Starts reloading `kind` (R, or an empty magazine). Returns true if it did.
  startReload(kind) {
    const st = WEAPON_STATS[kind];
    if (!st?.mag || this.reloadT[kind] > 0 || (this.ammo[kind] ?? st.mag) >= st.mag) return false;
    this.reloadT[kind] = st.reload;
    if (kind !== "bow" && kind !== "grenade") this.audio.playReload?.(kind);
    return true;
  }

  // The weapon in hand's state for the HUD: { kind, ammo, mag, reload (0-1
  // progress, 1 = ready), heat (0-1), label } or null for no weapon.
  status(kind) {
    const st = WEAPON_STATS[kind];
    if (!st) return null;
    if (st.heat) return { kind, heat: this.minigun.heat, overheated: this.minigun.overheated, label: st.label, reload: this.minigun.overheated ? 1 - this.minigun.heat : 1 };
    const t = this.reloadT[kind] || 0;
    return { kind, ammo: this.ammo[kind] ?? st.mag, mag: st.mag, reload: t > 0 ? 1 - t / st.reload : 1, reloading: t > 0, label: st.label };
  }

  _notice(text) {
    this._noticeT = this._noticeT ?? 0;
    if (this._noticeT > 0) return;
    this._noticeT = 0.6;
    this.onMessage?.(text);
  }

  // ---------- Input ----------

  // Right button pressed with a weapon selected.
  press(kind) {
    // (The bow is a plain block-game weapon: it works with mods off too.)
    if (!this.enabled && kind !== "bow") return;
    const cd = this._cooldowns;
    switch (kind) {
      case "bow":
        if (!this._ready("bow")) return;
        this.bow.drawing = true;
        this.bow.t = 0;
        this.audio.playBowDraw?.();
        return;
      case "grenade":
        if (cd.grenade > 0 || !this._ready("grenade")) return;
        this.charging = true;
        this.chargeTime = 0;
        return;
      case "machinegun":
        if (!this._ready("machinegun")) return;
        this._mgFiring = true;
        return;
      case "sniper":
        this.scoped = !this.scoped;
        this._applyScope();
        return;
      case "blaster":
        if (!this._ready("blaster")) return;
        this._blasterFiring = true;
        if (cd.blaster <= 0) {
          cd.blaster = MIN_INTERVAL.blaster;
          this._spend("blaster");
          this.fireBlaster();
        }
        return;
      case "jetradio":
        this.onJetRadio?.();
        return;
      case "railgun":
        if (cd.railgun > 0 || this.rail.charging || !this._ready("railgun")) return;
        this.rail.charging = true;
        this.rail.t = 0;
        this.audio.playRailCharge?.(RAIL_CHARGE);
        return;
      case "minigun":
        if (!this._ready("minigun")) return;
        this.minigun.held = true;
        return;
      case "bazooka":
        // Hold to lock on; the rocket flies when the button is released
        // (a quick tap fires an unguided one at once).
        if (!this._ready("bazooka")) return;
        this.lock.held = true;
        this.lock.progress = 0;
        this.lock.locked = false;
        this.lock.target = null;
        return;
      case "airstrike":
        if (cd.airstrike > 0 || !this._ready("airstrike")) return;
        cd.airstrike = MIN_INTERVAL.airstrike;
        this._spend("airstrike");
        this.fireAirstrike();
        return;
      default:
        if (!(kind in cd)) return;
        if (!this._ready(kind)) return;
        if (cd[kind] > 0) {
          // Clicked a moment too early: fires as soon as it's ready, so
          // every click counts (even when frames are slow).
          this._queued = kind;
          return;
        }
        cd[kind] = MIN_INTERVAL[kind] || 0.1;
        this._spend(kind);
        if (kind === "pistol") this.firePistol();
        else if (kind === "bazooka") this.fireBazooka();
    }
  }

  // Right button released: a drawn grenade is thrown, a drawn bow shoots;
  // automatic fire stops.
  release() {
    this._mgFiring = false;
    this._blasterFiring = false;
    this.minigun.held = false;
    if (this.bow.drawing) {
      this.bow.drawing = false;
      const power = Math.min(1, this.bow.t / BOW_DRAW);
      this.bow.t = 0;
      // (A click too short to even nock the arrow shoots nothing.)
      if (power >= 0.1) {
        this._spend("bow");
        this.shootArrow(power);
      }
      return;
    }
    if (this.lock.held) {
      this.lock.held = false;
      const cd = this._cooldowns;
      if (cd.bazooka <= 0 && this._ready("bazooka", true)) {
        cd.bazooka = MIN_INTERVAL.bazooka;
        this._spend("bazooka");
        this.fireBazooka(this.lock.locked ? this.lock.target : null);
      }
      this.lock.target = null;
      this.lock.progress = 0;
      this.lock.locked = false;
      return;
    }
    if (!this.charging) return;
    const power = this.charge;
    this.charging = false;
    this.chargeTime = 0;
    this._cooldowns.grenade = MIN_INTERVAL.grenade;
    this._spend("grenade");
    this.throwGrenade(power);
  }

  // The sniper fires on left click (right click is its scope): one round,
  // then a reload.
  sniperShot() {
    if (!this.enabled || !this._ready("sniper")) return null;
    this._spend("sniper");
    return this.fireSniper();
  }

  // Un-scopes the sniper (or clears its FOV/sensitivity override, if it was
  // already off, harmlessly).
  _applyScope() {
    this.player.zoomFov = this.scoped ? SNIPER_ZOOM_FOV : null;
    this.player.zoomSensMul = this.scoped ? 0.28 : 1;
  }

  // Switching items, opening a screen or dying drops a drawn throw, stops
  // the machine gun and un-scopes the sniper.
  cancel() {
    this._queued = null;
    this.bow.drawing = false;
    this.bow.t = 0;
    this.charging = false;
    this.chargeTime = 0;
    this._mgFiring = false;
    this._blasterFiring = false;
    this.rail.charging = false;
    this.minigun.held = false;
    this.lock.held = false;
    this.lock.target = null;
    this.lock.progress = 0;
    this.lock.locked = false;
    if (this.scoped) {
      this.scoped = false;
      this._applyScope();
    }
  }

  // The sniper fires on left click (right click toggles its scope instead).
  fireSniper() {
    const p = this.player;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    this.shots++;
    const range = this._range(SNIPER_RANGE, 1.2);
    const blockHit = this.world.raycast(eye, dir, range, { solidOnly: true });
    const mobHit = this.mobs.raycast(eye, dir, blockHit ? blockHit.distance : range);
    const muzzle = this._handPoint(0.9, 0.26, 0.14);
    this.effects.muzzleFlash(muzzle, 1.8);
    this.held.fire(1.6);
    p.kick(0.07);
    this.audio.playSniperShot ? this.audio.playSniperShot() : this.audio.playGunshot();
    if (this._shootTargets(eye, dir, mobHit ? mobHit.distance : blockHit ? blockHit.distance : range, SNIPER_DAMAGE, muzzle)) return { type: "target" };
    const isMob = !!mobHit && (!blockHit || mobHit.distance < blockHit.distance);
    const dist = isMob ? mobHit.distance : blockHit ? blockHit.distance : range;
    const endPoint = eye.clone().addScaledVector(dir, dist);
    this._spawnTracer(muzzle, endPoint);
    if (isMob) {
      this.mobs.shoot(mobHit.mob, SNIPER_DAMAGE, dir, 6);
      this._burst(endPoint, dir.clone().negate(), this._c.blood, 12, 4.5);
      return { type: "mob", mob: mobHit.mob, point: endPoint };
    }
    if (blockHit) {
      if (this._isRealBlock(endPoint)) {
        const n = blockHit.normal;
        const normal = new THREE.Vector3(n[0], n[1], n[2]);
        this.decals.add(endPoint, blockHit.block, n);
        this._burst(endPoint, normal, this._c.spark, 6, 2.2);
      }
      this.audio.playRicochet(Math.min(blockHit.distance, 300));
      return { type: "block", block: blockHit.block, point: endPoint, distance: blockHit.distance };
    }
    return { type: "miss" };
  }

  // A single machine-gun shot (called repeatedly from update() while held).
  fireMachineGun() {
    const p = this.player;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    // Spread and camera recoil both grow the longer the trigger is held.
    const spread = 0.006 + this._mgHeat * 0.03;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.shots++;
    const range = this._range(MACHINEGUN_RANGE, 0.55);
    const blockHit = this.world.raycast(eye, dir, range, { solidOnly: true });
    const mobHit = this.mobs.raycast(eye, dir, blockHit ? blockHit.distance : range);
    const muzzle = this._handPoint(0.7, 0.3, 0.16);
    this.effects.muzzleFlash(muzzle, 0.85);
    this.held.fire(0.55);
    p.kick(0.016 + this._mgHeat * 0.022);
    this.audio.playMachineGun ? this.audio.playMachineGun() : this.audio.playGunshot();
    if (this._shootTargets(eye, dir, mobHit ? mobHit.distance : blockHit ? blockHit.distance : range, MACHINEGUN_DAMAGE, muzzle)) return;
    const isMob = !!mobHit && (!blockHit || mobHit.distance < blockHit.distance);
    const dist = isMob ? mobHit.distance : blockHit ? blockHit.distance : range;
    const endPoint = eye.clone().addScaledVector(dir, dist);
    this._spawnTracer(muzzle, endPoint);
    if (isMob) {
      this.mobs.shoot(mobHit.mob, MACHINEGUN_DAMAGE, dir, 2);
      this._burst(endPoint, dir.clone().negate(), this._c.blood, 5, 2.5);
      return;
    }
    if (blockHit && this._isRealBlock(endPoint)) {
      const n = blockHit.normal;
      const normal = new THREE.Vector3(n[0], n[1], n[2]);
      this.decals.add(endPoint, blockHit.block, n);
      for (let i = 0; i < 4; i++) {
        const v = normal.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4));
        this.effects.glow.spawn({ x: endPoint.x, y: endPoint.y, z: endPoint.z, vx: v.x, vy: v.y, vz: v.z, life: 0.12 + Math.random() * 0.2, size0: 0.05, size1: 0.02, color0: this._c.spark, gravity: 0.6, drag: 2 });
      }
    }
    if (blockHit) this.audio.playRicochet(blockHit.distance);
  }

  // Locks the airstrike target where the laser currently points; the meteor
  // shower lands there (and around it) after the delay set in the settings.
  fireAirstrike() {
    const target = this._aimPoint(this._range(AIRSTRIKE_AIM_RANGE, 1.1));
    this.airstrike.call(target);
    this.held.fire(0.3);
    this.audio.playLockOn ? this.audio.playLockOn() : this.audio.playThrow();
    // A red marker flash where the strike will land.
    this.effects.glow.spawn({ x: target.x, y: target.y + 0.5, z: target.z, life: 0.5, size0: 2.5, size1: 0.6, color0: this._c.blink, alpha: 0.9 });
  }

  // ---------- Laser blaster ----------

  fireBlaster() {
    if (!this.lasers) return null;
    const p = this.player;
    const muzzle = this._handPoint(0.75, 0.26, 0.15);
    // Aim from the muzzle at whatever is under the crosshair.
    const target = this._aimPoint(this._range(BLASTER_RANGE, 0.9));
    const dir = target.sub(muzzle);
    if (dir.lengthSq() < 0.5) dir.copy(p.getForwardVector());
    dir.normalize();
    const eye = p.getEyePosition();
    if (IS_SOLID[this.world.getBlock(Math.floor(muzzle.x), Math.floor(muzzle.y), Math.floor(muzzle.z))]) muzzle.copy(eye);
    this.shots++;
    this.held.fire(0.6);
    p.kick(0.02);
    this.effects.muzzleFlash(muzzle, 0.8);
    return this.lasers.fire({ from: muzzle, dir, color: LASER_COLORS[this.blasterColor] || LASER_COLORS.red, speed: BLASTER_SPEED * (this.viewRange > 300 ? 1.6 : 1), damage: BLASTER_DAMAGE, owner: "player", source: p, range: this._range(BLASTER_RANGE, 0.9) });
  }

  // The nearest extra target (UFO, vehicle) along a ray, or null.
  _targetHit(origin, dir, maxDist) {
    let best = null;
    for (const t of this.targets) {
      const h = t.raycast(origin, dir, maxDist);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  }

  _targetSphere(p, r) {
    for (const t of this.targets) if (t.sphereHit(p, r)) return true;
    return false;
  }

  // Metal sparks off a UFO's hull.
  _hullSparks(point, dir, n = 8) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(-3 - Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
      this.effects.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: v.x, vy: v.y, vz: v.z, life: 0.2 + Math.random() * 0.3, size0: 0.1, size1: 0.02, color0: this._c.spark, gravity: 0.6, drag: 2 });
    }
  }

  // A hitscan shot against the extra targets, if one is nearer than
  // `nearest` (the block or mob hit). Returns true if it hit one.
  _shootTargets(eye, dir, nearest, damage, muzzle) {
    const t = this._targetHit(eye, dir, nearest);
    if (!t) return false;
    const point = eye.clone().addScaledVector(dir, t.distance);
    t.hit(damage, dir, point);
    this._hullSparks(point, dir);
    if (muzzle) this._spawnTracer(muzzle, point);
    return true;
  }

  // A block hit is "real" (a loaded chunk) vs. an approximate heightfield
  // guess for unloaded/distant terrain, which shouldn't get decals or sparks.
  _isRealBlock(point) {
    return !!this.world.getChunk(Math.floor(point.x) >> 4, Math.floor(point.z) >> 4);
  }

  _spawnTracer(a, b) {
    const t = this._tracers[this._tracerNext];
    this._tracerNext = (this._tracerNext + 1) % this._tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.age = 0;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
  }

  _updateLaser(active) {
    this._laser.visible = active;
    this._laserDot.visible = active;
    if (!active) return;
    const origin = this._handPoint(0.5, 0.24, 0.15);
    const target = this._aimPoint(this._range(AIRSTRIKE_AIM_RANGE, 1.1));
    const pos = this._laser.geometry.attributes.position;
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, target.x, target.y, target.z);
    pos.needsUpdate = true;
    this._laser.geometry.computeBoundingSphere();
    this._laserDot.position.copy(target);
  }

  // Where a shot or throw leaves the hand, in world space (just right of
  // and below the eyes, a little ahead).
  _handPoint(forwardDist, right = 0.28, down = 0.2) {
    const p = this.player;
    const eye = p.getEyePosition();
    const f = p.getForwardVector();
    const r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    return eye.addScaledVector(f, forwardDist).addScaledVector(r, right).add(new THREE.Vector3(0, -down, 0));
  }

  // The world point under the crosshair (for aiming projectiles from the hand).
  _aimPoint(range = 200) {
    const eye = this.player.getEyePosition();
    const dir = this.player.getForwardVector();
    const hit = this.world.raycast(eye, dir, range, { solidOnly: true });
    return eye.addScaledVector(dir, hit ? hit.distance : range);
  }

  // ---------- Grenade ----------

  // power 0-1: a quick click lobs it a short way, a full charge throws far.
  throwGrenade(power) {
    const p = this.player;
    const dir = p.getForwardVector();
    dir.y += 0.12; // a little lob so level throws arc
    dir.normalize();
    const speed = THROW_SPEED_MIN + (THROW_SPEED_MAX - THROW_SPEED_MIN) * power;
    const vel = dir.multiplyScalar(speed);
    vel.x += p.velocity.x * 0.5;
    vel.z += p.velocity.z * 0.5;
    const pos = this._handPoint(0.45, 0.18, 0.12);
    // Never start inside a wall.
    if (IS_SOLID[this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))]) pos.copy(p.getEyePosition());
    const mesh = new THREE.Mesh(this._grenadeGeo, this.material);
    mesh.castShadow = true;
    const g = { pos, vel, age: 0, mesh, light: { sky: 15, block: 0 }, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), angle: 0, blink: 0, power };
    bindEntityLight(mesh, () => g.light);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.grenades.push(g);
    this.held.swing();
    this.audio.playThrow();
    return g;
  }

  _solidAt(x, y, z) {
    return IS_SOLID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1;
  }

  _updateGrenade(g, dt) {
    g.age += dt;
    const w = this.world;
    const pos = g.pos;
    const vel = g.vel;
    const inWater = IS_WET[w.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))] === 1;
    vel.y += GRENADE_GRAVITY * (inWater ? 0.3 : 1) * dt;
    if (inWater) vel.multiplyScalar(Math.exp(-2.5 * dt));
    // Sub-stepped, axis-separated movement with bounces.
    const steps = Math.max(1, Math.ceil((vel.length() * dt) / 0.08));
    const sdt = dt / steps;
    let resting = false;
    for (let s = 0; s < steps; s++) {
      for (const axis of ["x", "y", "z"]) {
        const d = vel[axis] * sdt;
        if (d === 0) continue;
        const probe = pos.clone();
        probe[axis] += d + Math.sign(d) * GRENADE_R;
        if (this._solidAt(probe.x, probe.y, probe.z)) {
          const impact = Math.abs(vel[axis]);
          vel[axis] = -vel[axis] * RESTITUTION;
          // Friction along the surface it hit.
          for (const other of ["x", "y", "z"]) if (other !== axis) vel[other] *= axis === "y" ? 0.72 : 0.88;
          if (axis === "y" && d < 0) {
            if (Math.abs(vel.y) < 1.2) vel.y = 0;
            resting = true;
          }
          if (impact > 2) this.audio.playGrenadeBounce(Math.min(1, impact / 15), pos.distanceTo(this.player.getEyePosition()));
        } else {
          pos[axis] += d;
        }
      }
    }
    // Rolling to a stop on the ground.
    if (resting || this._solidAt(pos.x, pos.y - GRENADE_R - 0.02, pos.z)) {
      const f = Math.exp(-3 * dt);
      vel.x *= f;
      vel.z *= f;
    }
    const speed = vel.length();
    g.angle += speed * dt * 4;
    g.mesh.position.copy(pos);
    g.mesh.quaternion.setFromAxisAngle(g.spin, g.angle);
    g.light = w.lightAt(pos.x, pos.y, pos.z);

    // A red light blinks on the fuse, faster as it runs out.
    const left = GRENADE_FUSE - g.age;
    g.blink -= dt;
    if (g.blink <= 0) {
      g.blink = left > 2 ? 0.5 : left > 1 ? 0.25 : 0.1;
      this.effects.glow.spawn({ x: pos.x, y: pos.y + 0.16, z: pos.z, life: 0.08, size0: 0.25, size1: 0.2, color0: this._c.blink, alpha: 1 });
    }

    // A direct hit on a mob sets it off at once.
    if (g.age > 0.05 && (this.mobs.sphereHit(pos, GRENADE_R) || this._targetSphere(pos, GRENADE_R))) return true;
    return g.age >= GRENADE_FUSE || pos.y < -20;
  }

  // ---------- Pistol ----------

  // The pistol fires a real bullet (a fast projectile with a visible tracer):
  // it leaves the muzzle aimed at whatever is under the crosshair and takes
  // time to get there (240 blocks/s), so a moving target must be led, and
  // far targets are hit a moment after the click. It hits mobs, UFOs and
  // vehicles on the way (see main.js and lasers.js) and chips blocks.
  firePistol() {
    const p = this.player;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    // A tiny spread, so rapid fire isn't a laser.
    dir.x += (Math.random() - 0.5) * 0.004;
    dir.y += (Math.random() - 0.5) * 0.004;
    dir.z += (Math.random() - 0.5) * 0.004;
    dir.normalize();
    this.shots++;
    const range = this._range(PISTOL_RANGE, 0.6);
    // What is under the crosshair: the nearest block, creature, UFO or vehicle.
    const blockHit = this.world.raycast(eye, dir, range, { solidOnly: true });
    let near = blockHit ? blockHit.distance : range;
    const mobHit = this.mobs.raycast(eye, dir, near);
    if (mobHit) near = mobHit.distance;
    const th = this._targetHit(eye, dir, near);
    if (th) near = th.distance;
    const muzzle = this._handPoint(0.7, 0.26, 0.17);
    if (IS_SOLID[this.world.getBlock(Math.floor(muzzle.x), Math.floor(muzzle.y), Math.floor(muzzle.z))]) muzzle.copy(eye);
    this.effects.muzzleFlash(muzzle, 1);
    this.held.fire(1);
    p.kick(0.035);
    this.audio.playGunshot();
    const aim = eye.clone().addScaledVector(dir, near).sub(muzzle);
    if (aim.lengthSq() < 0.25) aim.copy(dir);
    aim.normalize();
    this.lasers.fire({ from: muzzle, dir: aim, color: BULLET_COLOR, speed: PISTOL_SPEED * (this.viewRange > 300 ? 1.5 : 1), damage: PISTOL_DAMAGE, owner: "player", source: p, range: range + 8, radius: 0.03, length: 2.6, sound: false, scorch: true, hole: true });
    return { type: "bullet" };
  }

  _burst(point, normal, color, count, speed) {
    for (let i = 0; i < count; i++) {
      this.effects.debris.spawn(
        point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05,
        normal.x * speed + (Math.random() - 0.5) * speed, normal.y * speed + Math.random() * speed, normal.z * speed + (Math.random() - 0.5) * speed,
        0.04 + Math.random() * 0.05, color, 0.4 + Math.random() * 0.4
      );
    }
  }

  // ---------- Bazooka ----------

  fireBazooka(lockTarget = null) {
    const p = this.player;
    const start = this._handPoint(0.9, 0.3, 0.19);
    // Fly toward whatever is under the crosshair.
    const target = this._aimPoint();
    const dir = target.clone().sub(start);
    if (dir.lengthSq() < 1) dir.copy(p.getForwardVector());
    dir.normalize();
    const eye = p.getEyePosition();
    // Point blank against a wall: start from the eyes so it hits the wall.
    if (IS_SOLID[this.world.getBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z))]) start.copy(eye);
    const mesh = new THREE.Mesh(this._rocketGeo, this.material);
    mesh.castShadow = true;
    const exhaust = new THREE.Sprite(this._exhaustMat);
    exhaust.layers.set(LAYER_FX);
    exhaust.position.set(0, 0, 0.36);
    exhaust.scale.setScalar(0.7);
    mesh.add(exhaust);
    const r = { pos: start.clone(), vel: dir.clone().multiplyScalar(ROCKET_SPEED * (lockTarget ? 1.25 : 1)), age: 0, mesh, exhaust, light: { sky: 15, block: 0 }, target: lockTarget };
    bindEntityLight(mesh, () => r.light);
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(dir));
    mesh.rotateY(Math.PI); // the model points along -Z
    this.scene.add(mesh);
    this.rockets.push(r);
    this.effects.muzzleFlash(start, 2.5);
    this.held.fire(2.2);
    p.kick(0.09);
    p.applyImpulse(dir.clone().multiplyScalar(-2.5).setY(0));
    this.audio.playRocketLaunch();
    // Backblast smoke behind the shoulder.
    const back = start.clone().addScaledVector(dir, -1.4);
    for (let i = 0; i < 10; i++) {
      this.effects.smoke.spawn({
        x: back.x, y: back.y, z: back.z,
        vx: -dir.x * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: -dir.z * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
        life: 1 + Math.random(), size0: 0.5, size1: 2.2, color0: this._c.smoke, color1: this._c.smokeEnd, alpha: 0.5, drag: 2.5,
      });
    }
    return r;
  }

  // Returns the explosion point, or null (keep flying), or false (gone).
  _updateRocket(r, dt) {
    r.age += dt;
    if (r.target) {
      const t = r.target;
      if (t.alive && !t.alive()) r.target = null;
      else {
        const c = t.center(this._v);
        const to = c.sub(r.pos);
        const dist = to.length();
        // Proximity fuse: a homing rocket that gets close enough goes off
        // (squarely on a UFO or vehicle: the direct hit counts too).
        if (dist < (t.radius || 1) * 0.6 + 1.4 && r.age > 0.25) {
          const d2 = to.clone().divideScalar(dist || 1);
          const th = this._targetHit(r.pos, d2, dist + 1);
          if (th) th.hit(ROCKET_DIRECT, d2, r.pos.clone());
          return r.pos.clone();
        }
        const speed = r.vel.length();
        const want = to.divideScalar(dist || 1);
        const cur = r.vel.clone().divideScalar(speed || 1);
        const ang = Math.acos(Math.max(-1, Math.min(1, cur.dot(want))));
        const k = ang > 1e-4 ? Math.min(1, (ROCKET_TURN * dt) / ang) : 1;
        cur.lerp(want, k).normalize();
        r.vel.copy(cur).multiplyScalar(speed);
      }
    }
    if (!r.target) r.vel.y += ROCKET_GRAVITY * dt;
    const step = r.vel.clone().multiplyScalar(dt);
    const len = step.length();
    const dir = step.clone().divideScalar(len || 1);
    const blockHit = this.world.raycast(r.pos, dir, len, { solidOnly: true });
    const mobHit = this.mobs.raycast(r.pos, dir, blockHit ? blockHit.distance : len);
    const tHit = this._targetHit(r.pos, dir, mobHit ? mobHit.distance : blockHit ? blockHit.distance : len);
    if (tHit) {
      // A direct hit on a UFO or a vehicle: the warhead's punch on top of the blast.
      const at = r.pos.clone().addScaledVector(dir, tHit.distance);
      tHit.hit(ROCKET_DIRECT, dir, at);
      return at;
    }
    if (mobHit) return r.pos.clone().addScaledVector(dir, mobHit.distance);
    if (blockHit) return r.pos.clone().addScaledVector(dir, Math.max(0, blockHit.distance - 0.3));
    // Smoke trail and glowing exhaust along the path.
    for (let i = 0; i < 3; i++) {
      const t = Math.random();
      this.effects.smoke.spawn({
        x: r.pos.x + step.x * t, y: r.pos.y + step.y * t, z: r.pos.z + step.z * t,
        vx: (Math.random() - 0.5) * 0.6, vy: 0.3 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.6,
        life: 1.2 + Math.random() * 1.2, size0: 0.35, size1: 1.6, color0: this._c.smoke, color1: this._c.smokeEnd, alpha: 0.45, drag: 1,
      });
    }
    this.effects.glow.spawn({ x: r.pos.x, y: r.pos.y, z: r.pos.z, life: 0.12, size0: 0.5, size1: 0.1, color0: this._c.exhaust, alpha: 0.9 });
    r.pos.add(step);
    r.mesh.position.copy(r.pos);
    r.mesh.lookAt(r.pos.clone().add(dir));
    r.mesh.rotateY(Math.PI);
    r.exhaust.scale.setScalar(0.6 + Math.random() * 0.3);
    r.light = this.world.lightAt(r.pos.x, r.pos.y, r.pos.z);
    // Keeps flying over distant/unloaded terrain (its raycast above already
    // hit-tests the height map out there) rather than vanishing unexploded.
    if (r.age > ROCKET_LIFE || r.pos.y < -20 || r.pos.y > 300) return false;
    return null;
  }

  // ---------- Railgun ----------

  _updateRail(dt, activeKind) {
    const rail = this.rail;
    if (rail.charging && activeKind !== "railgun") rail.charging = false;
    if (rail.charging) {
      rail.t += dt;
      if (rail.t >= RAIL_CHARGE) {
        rail.charging = false;
        rail.t = 0;
        this._cooldowns.railgun = MIN_INTERVAL.railgun;
        this._spend("railgun");
        this.fireRailgun();
      }
    }
    this.held.charge = rail.charging ? Math.min(1, rail.t / RAIL_CHARGE) : 0;
    for (const b of rail.beams) {
      if (!b.mesh.visible) continue;
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) {
        b.mesh.visible = false;
        continue;
      }
      const fade = (1 - k) * (1 - k);
      b.core.material.opacity = fade;
      b.halo.material.opacity = 0.7 * fade;
      const w = 1 + k * 1.8;
      b.core.scale.x = b.core.scale.y = b.w0 * (1 - k * 0.7);
      b.halo.scale.x = b.halo.scale.y = b.w0 * 3.2 * w;
    }
  }

  _beam(from, to, w0 = 0.22, life = 0.75) {
    let b = this.rail.beams.find((x) => !x.mesh.visible);
    if (!b) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2);
      const mk = (color, opacity) => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
        m.frustumCulled = false;
        m.layers.set(LAYER_FX);
        return m;
      };
      const mesh = new THREE.Group();
      const core = mk(new THREE.Color(9, 11, 14), 1);
      const halo = mk(new THREE.Color(0.8, 2.2, 6), 0.7);
      mesh.add(halo, core);
      mesh.visible = false;
      mesh.layers.set(LAYER_FX);
      this.scene.add(mesh);
      b = { mesh, core, halo, age: 0, life, w0 };
      this.rail.beams.push(b);
    }
    const len = from.distanceTo(to);
    b.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    b.mesh.lookAt(to);
    b.mesh.scale.set(1, 1, len);
    b.core.scale.set(w0, w0, 1);
    // The wide glow starts a few blocks ahead of the muzzle: the camera must not sit inside it.
    const skip = Math.min(len * 0.5, 3.6);
    b.halo.scale.set(w0 * 3.2, w0 * 3.2, (len - skip) / len);
    b.halo.position.set(0, 0, skip / (2 * len));
    b.w0 = w0;
    b.age = 0;
    b.life = life;
    b.mesh.visible = true;
    return b;
  }

  // The shot: destroys every block within RAIL_RADIUS of the line, hits every
  // creature, UFO and vehicle on it.
  fireRailgun() {
    const p = this.player;
    const eye = p.getEyePosition();
    const dir = p.getForwardVector();
    const muzzle = this._handPoint(0.9, 0.24, 0.16);
    const range = Math.min(RAIL_RANGE, Math.max(400, this.viewRange * 2));
    const end = eye.clone().addScaledVector(dir, range);

    // Blocks: a tube of air along the ray (loaded chunks only).
    const world = this.world;
    const removedSet = new Set();
    const removed = [];
    const edits = [];
    const R = RAIL_RADIUS;
    const R2 = R * R;
    const ri = Math.ceil(R);
    const step = 0.9;
    for (let d = 0; d < range; d += step) {
      const cx = eye.x + dir.x * d;
      const cy = eye.y + dir.y * d;
      const cz = eye.z + dir.z * d;
      if (cy < -4 || cy > 200) break;
      const bx = Math.floor(cx);
      const by = Math.floor(cy);
      const bz = Math.floor(cz);
      if (!world.getChunk(bx >> 4, bz >> 4)) continue;
      for (let x = bx - ri; x <= bx + ri; x++) {
        for (let y = by - ri; y <= by + ri; y++) {
          for (let z = bz - ri; z <= bz + ri; z++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            const dz = z + 0.5 - cz;
            if (dx * dx + dy * dy + dz * dz > R2) continue;
            if (y < 1 || y >= 64) continue;
            const key = (x + 1048576) * 4294967296 + (y * 2097152 + (z + 1048576));
            if (removedSet.has(key)) continue;
            removedSet.add(key);
            const id = world.getBlock(x, y, z);
            if (id === BLOCK.AIR || id === BLOCK.WATER || id === BLOCK.BEDROCK) continue;
            removed.push(x, y, z, id);
            edits.push(x, y, z, BLOCK.AIR);
          }
        }
      }
    }
    if (edits.length) {
      world.setBlocks(edits);
      this.effects.floodInto(removed);
      // Glowing debris flung along the tube.
      const n = removed.length / 4;
      const every = Math.max(1, Math.floor(n / 220));
      for (let i = 0; i < n; i += every) {
        const rgb = this.world.blockColors[removed[i * 4 + 3]] || [0.6, 0.6, 0.6];
        this._c.tmp.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
        const sp = 4 + Math.random() * 8;
        this.effects.debris.spawn(removed[i * 4] + 0.5, removed[i * 4 + 1] + 0.5, removed[i * 4 + 2] + 0.5, dir.x * sp + (Math.random() - 0.5) * 6, dir.y * sp + Math.random() * 4, dir.z * sp + (Math.random() - 0.5) * 6, 0.08 + Math.random() * 0.1, this._c.tmp, 0.8 + Math.random() * 0.8);
        if (i % (every * 4) === 0) this.effects.glow.spawn({ x: removed[i * 4] + 0.5, y: removed[i * 4 + 1] + 0.5, z: removed[i * 4 + 2] + 0.5, life: 0.5, size0: 1.2, size1: 0.2, color0: this._c.spark, alpha: 0.9 });
      }
    }

    // Creatures on the line.
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const h = this.mobs.raycast(eye, dir, range, (m) => !seen.has(m));
      if (!h) break;
      seen.add(h.mob);
      const at = eye.clone().addScaledVector(dir, h.distance);
      this.mobs.shoot(h.mob, RAIL_DAMAGE, dir, 14);
      this._burst(at, dir.clone().negate(), this._c.blood, 10, 4);
    }
    // UFOs, vehicles and other piercable things.
    let hits = 0;
    for (const prov of this.pierce) {
      for (const h of prov.all(eye, dir, range)) {
        const at = eye.clone().addScaledVector(dir, h.distance);
        h.hit(RAIL_DAMAGE, dir, at);
        this._hullSparks(at, dir, 16);
        hits++;
      }
    }

    this._beam(muzzle, end, 0.22, 0.85);
    // A hot flash at the muzzle and along the near end of the beam.
    this.effects.muzzleFlash(muzzle, 3.5);
    for (let i = 0; i < 6; i++) {
      const at = muzzle.clone().addScaledVector(dir, 2 + i * 6);
      this.effects.glow.spawn({ x: at.x, y: at.y, z: at.z, life: 0.35, size0: 3, size1: 0.5, color0: this._c.rail, alpha: 0.8 });
    }
    this.held.fire(3);
    p.kick(0.16);
    p.applyImpulse(dir.clone().multiplyScalar(-6).setY(0));
    this.effects.shake.add(0.45);
    this.onRailFire?.(hits);
    this.audio.playRailFire(0);
    this.railShots = (this.railShots || 0) + 1;
    return { removed: removed.length / 4, mobs: seen.size, hits };
  }

  // ---------- Laser minigun ----------

  _updateMinigun(dt, activeKind) {
    const m = this.minigun;
    const st = WEAPON_STATS.minigun;
    if (m.held && activeKind !== "minigun") m.held = false;
    if (m.held && m.overheated) m.held = false;
    if (m.held) m.spin = Math.min(1, m.spin + dt / MINIGUN_SPINUP);
    else m.spin = Math.max(0, m.spin - dt / 1.6);
    m.angle += m.spin * dt * 34;
    this.held.spin = m.angle;
    m.firing = m.held && m.spin >= 0.92;
    // Heat: it overheats after a few seconds of fire and must cool down.
    if (m.firing) {
      m.heat = Math.min(1, m.heat + dt / st.heat);
      if (m.heat >= 1) {
        m.overheated = true;
        m.held = false;
        m.firing = false;
        this.audio.playOverheat?.();
        this._notice("Minigun overheated: let it cool");
      }
    } else {
      m.heat = Math.max(0, m.heat - dt / st.cool);
      if (m.overheated && m.heat <= 0) m.overheated = false;
    }
    this.audio.setMinigun?.(m.spin, m.firing);
    if (!m.firing) {
      m.timer = 0;
      return;
    }
    m.timer -= dt;
    let guard = 0;
    while (m.timer <= 0 && guard++ < 6) {
      m.timer += 1 / MINIGUN_RATE;
      this.fireMinigunBolt();
    }
  }

  fireMinigunBolt() {
    if (!this.lasers) return;
    const p = this.player;
    const range = this._range(MINIGUN_RANGE, 0.9);
    const muzzle = this._handPoint(0.95, 0.26, 0.17);
    const eye = p.getEyePosition();
    const fwd = p.getForwardVector();
    const aim = eye.clone().addScaledVector(fwd, 60);
    const dir = aim.sub(muzzle).normalize();
    const spread = 0.022;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    if (IS_SOLID[this.world.getBlock(Math.floor(muzzle.x), Math.floor(muzzle.y), Math.floor(muzzle.z))]) muzzle.copy(eye);
    this.shots++;
    this.held.fire(0.45);
    p.kick(0.012);
    if (this.shots % 3 === 0) this.effects.muzzleFlash(muzzle, 0.9);
    this.audio.playMinigunShot?.();
    this.lasers.fire({ from: muzzle, dir, color: LASER_COLORS[this.blasterColor] || LASER_COLORS.red, speed: MINIGUN_SPEED * (this.viewRange > 300 ? 1.5 : 1), damage: MINIGUN_DAMAGE, owner: "player", source: p, range, radius: 0.09, length: 3.2, sound: false });
  }

  // ---------- Bow ----------

  // Shoots an arrow drawn to `power` (0-1): faster, flatter and harder the
  // further it was drawn. It flies with gravity and hurts whatever it hits:
  // creatures, UFOs, vehicles.
  shootArrow(power) {
    const p = this.player;
    const dir = p.getForwardVector();
    const speed = ARROW_SPEED_MIN + (ARROW_SPEED_MAX - ARROW_SPEED_MIN) * power;
    const pos = this._handPoint(0.5, 0.12, 0.08);
    if (IS_SOLID[this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))]) pos.copy(p.getEyePosition());
    if (!this._arrowGeo) {
      const shaft = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 5).rotateX(Math.PI / 2);
      const tip = new THREE.ConeGeometry(0.045, 0.14, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.42);
      const fl = new THREE.BoxGeometry(0.12, 0.012, 0.16).translate(0, 0, 0.3);
      const fl2 = new THREE.BoxGeometry(0.012, 0.12, 0.16).translate(0, 0, 0.3);
      this._arrowGeo = mergeColored([[shaft, 0x8a6a3c], [tip, 0x5a5a5e], [fl, 0xe8e2d4], [fl2, 0xe8e2d4]]);
    }
    const mesh = new THREE.Mesh(this._arrowGeo, this.material);
    const a = { pos, vel: dir.multiplyScalar(speed), age: 0, mesh, power, stuck: false, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => a.light);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.arrows.push(a);
    this.held.fire(0.4);
    this.audio.playBowShot?.(power);
    return a;
  }

  _updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      if (a.stuck) {
        if (a.age > ARROW_LIFE) {
          this.scene.remove(a.mesh);
          this.arrows.splice(i, 1);
        }
        continue;
      }
      a.vel.y += ARROW_GRAVITY * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len || 1);
      const blockHit = this.world.raycast(a.pos, dir, len, { solidOnly: true });
      const mobHit = this.mobs.raycast(a.pos, dir, blockHit ? blockHit.distance : len);
      const tHit = this._targetHit(a.pos, dir, mobHit ? mobHit.distance : blockHit ? blockHit.distance : len);
      const dmg = Math.round(ARROW_DAMAGE[0] + (ARROW_DAMAGE[1] - ARROW_DAMAGE[0]) * a.power * a.power);
      if (tHit) {
        const point = a.pos.clone().addScaledVector(dir, tHit.distance);
        tHit.hit(dmg, dir, point);
        this._hullSparks(point, dir, 4);
        this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      if (mobHit) {
        this.mobs.shoot(mobHit.mob, dmg, dir, 2 + a.power * 2);
        this._burst(a.pos.clone().addScaledVector(dir, mobHit.distance), dir.clone().negate(), this._c.blood, 5, 2.5);
        this.audio.playArrowHit?.(0);
        this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      if (blockHit) {
        // It sticks in the block for a while.
        a.pos.addScaledVector(dir, Math.max(0, blockHit.distance - 0.05));
        a.stuck = true;
        a.age = 0;
        a.mesh.position.copy(a.pos);
        this.audio.playArrowHit?.(a.pos.distanceTo(this.player.getEyePosition()));
        continue;
      }
      a.pos.add(step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().add(dir));
      a.mesh.rotateY(Math.PI);
      a.light = this.world.lightAt(a.pos.x, a.pos.y, a.pos.z);
      if (a.age > ARROW_LIFE || a.pos.y < -20) {
        this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
  }

  // ---------- Bazooka lock-on ----------

  _updateLock(dt, activeKind) {
    const l = this.lock;
    if (l.held && activeKind !== "bazooka") {
      l.held = false;
      l.target = null;
      l.progress = 0;
      l.locked = false;
    }
    if (!l.held || !this.getLockables) return;
    l.scanT -= dt;
    if (l.scanT <= 0) {
      l.scanT = 0.06;
      const eye = this.player.getEyePosition();
      const fwd = this.player.getForwardVector();
      const range = Math.min(1600, Math.max(250, this.viewRange * 1.3));
      const c = this._v;
      let best = null;
      let bestScore = Infinity;
      for (const t of this.getLockables()) {
        const pt = t.center(c);
        const dx = pt.x - eye.x;
        const dy = pt.y - eye.y;
        const dz = pt.z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 6 || dist > range) continue;
        const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist;
        if (dot < 0.9) continue;
        const ang = Math.acos(Math.min(1, dot)) - Math.atan((t.radius || 1) / dist);
        const score = Math.max(0, ang) + (t === l.target ? -0.02 : 0);
        if (ang > LOCK_CONE) continue;
        if (score < bestScore) {
          // The target must be in the open, not behind a hill.
          const d = c.clone().sub(eye).normalize();
          const wall = this.world.raycast(eye, d, dist - (t.radius || 1), { solidOnly: true });
          if (wall) continue;
          best = t;
          bestScore = score;
        }
      }
      // Keep the same target object if it is the same referent.
      if (best && l.target && best.ref === l.target.ref) best = l.target;
      if (best !== l.target) {
        l.target = best;
        l.progress = best ? l.progress * 0.15 : 0;
        l.locked = false;
      }
    }
    if (l.target) {
      if (l.target.alive && !l.target.alive()) {
        l.target = null;
        l.progress = 0;
        l.locked = false;
      } else {
        l.progress = Math.min(1, l.progress + dt / LOCK_TIME);
        l.beepT -= dt;
        if (!l.locked && l.progress >= 1) {
          l.locked = true;
          this.audio.playLockOn?.();
        } else if (!l.locked && l.beepT <= 0) {
          l.beepT = 0.28 - l.progress * 0.16;
          this.audio.playLockTick?.();
        }
      }
    } else {
      l.progress = Math.max(0, l.progress - dt * 2);
      l.locked = false;
    }
  }

  // ---------- Per frame ----------

  update(dt) {
    for (const k in this._cooldowns) this._cooldowns[k] = Math.max(0, this._cooldowns[k] - dt);
    this._cooldowns.railgun ??= 0;
    this._noticeT = Math.max(0, (this._noticeT ?? 0) - dt);
    // Reloads (they carry on while another item is in hand).
    for (const k in this.reloadT) {
      if (this.reloadT[k] <= 0) continue;
      this.reloadT[k] -= dt;
      if (this.reloadT[k] <= 0) {
        this.reloadT[k] = 0;
        this.ammo[k] = WEAPON_STATS[k].mag;
      }
    }
    if (this._queued && this._cooldowns[this._queued] <= 0) {
      const kind = this._queued;
      this._queued = null;
      if (kind === "bazooka") {
        if (this._ready("bazooka", true)) {
          this._cooldowns.bazooka = MIN_INTERVAL.bazooka;
          this._spend("bazooka");
          this.fireBazooka(null);
        }
      } else this.press(kind);
    }
    if (this.charging) this.chargeTime += dt;
    // The bow being drawn.
    if (this.bow.drawing) this.bow.t += dt;
    this.held.bowDraw = this.bow.drawing ? Math.min(1, this.bow.t / BOW_DRAW) : 0;
    this.held.windUp = this.charge;
    this._updateArrows(dt);

    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (this._updateGrenade(g, dt)) {
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        if (g.pos.y > -20) this.effects.explode(g.pos.clone(), { radius: GRENADE_RADIUS, source: "grenade" });
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      const result = this._updateRocket(r, dt);
      if (result === null) continue;
      this.scene.remove(r.mesh);
      this.rockets.splice(i, 1);
      if (result) this.effects.explode(result, { radius: BAZOOKA_RADIUS, source: "bazooka" });
    }
    // The exhaust light follows the newest rocket in flight.
    const newest = this.rockets[this.rockets.length - 1];
    const light = this.effects.projectileLight;
    if (newest) {
      light.position.copy(newest.pos);
      light.intensity = 30;
    } else {
      light.intensity = 0;
    }

    // Stop mid-effect automatically if the active item changed under us
    // (e.g. picked in the inventory screen rather than the hotbar keys).
    const activeKind = itemInfo(this.inventory?.selectedStack?.id)?.weapon?.kind;
    if (this.bow.drawing && activeKind !== "bow") {
      this.bow.drawing = false;
      this.bow.t = 0;
    }
    if (this._mgFiring && activeKind !== "machinegun") this._mgFiring = false;
    if (this.scoped && activeKind !== "sniper") {
      this.scoped = false;
      this._applyScope();
    }

    // Machine gun: automatic fire while held, with climbing spread/recoil
    // that settle again once the trigger is released.
    if (this._mgFiring) {
      this._mgTimer -= dt;
      this._mgHeat = Math.min(1, this._mgHeat + dt * 1.5);
      let guard = 0;
      while (this._mgTimer <= 0 && guard++ < 4) {
        this._mgTimer += 1 / MACHINEGUN_RATE;
        if (!this._ready("machinegun", true)) {
          this._mgFiring = false; // the magazine is empty: it reloads
          break;
        }
        this._spend("machinegun");
        this.fireMachineGun();
      }
    } else {
      this._mgTimer = 0;
      this._mgHeat = Math.max(0, this._mgHeat - dt * 2.5);
    }

    // Laser blaster: held for repeat fire.
    if (this._blasterFiring && activeKind !== "blaster") this._blasterFiring = false;
    if (this._blasterFiring && this._cooldowns.blaster <= 0) {
      if (!this._ready("blaster", true)) this._blasterFiring = false;
      else {
        this._cooldowns.blaster = MIN_INTERVAL.blaster;
        this._spend("blaster");
        this.fireBlaster();
      }
    }

    this._updateRail(dt, activeKind);
    this._updateMinigun(dt, activeKind);
    this._updateLock(dt, activeKind);

    // Airstrikes on their way, and meteors in the air.
    this.airstrike.update(dt, this.effects.listener);

    // The laser sight tracks the aim point while the designator is held.
    this._updateLaser(activeKind === "airstrike" && this.enabled);

    // Tracer lines fade quickly.
    for (const t of this._tracers) {
      if (t.age > 0.14) continue;
      t.age += dt;
      t.line.material.opacity = Math.max(0, 0.9 * (1 - t.age / 0.12));
      if (t.age > 0.12) t.line.visible = false;
    }
  }

  // Removes every grenade, rocket and meteor in flight and every pending
  // airstrike (mods switched off).
  clearProjectiles() {
    for (const g of this.grenades) this.scene.remove(g.mesh);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    for (const a of this.arrows) this.scene.remove(a.mesh);
    this.grenades.length = 0;
    this.rockets.length = 0;
    this.arrows.length = 0;
    this.airstrike.clear();
    this._updateLaser(false);
    for (const b of this.rail.beams) b.mesh.visible = false;
    this.rail.charging = false;
  }

  // Direction and speed of a throw of the given power (for tests).
  static throwSpeed(power) {
    return THROW_SPEED_MIN + (THROW_SPEED_MAX - THROW_SPEED_MIN) * power;
  }
}

// A small model from colored parts: [[geometry, hex color], ...].
function mergeColored(parts) {
  const geos = parts.map(([g, hex]) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex);
    const col = new Float32Array(n.getAttribute("position").count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return n;
  });
  let count = 0;
  for (const g of geos) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    const k = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3);
    nor.set(g.getAttribute("normal").array, o * 3);
    col.set(g.getAttribute("color").array, o * 3);
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}
