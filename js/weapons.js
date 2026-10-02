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
const ARROW_SPEED_MIN = 18;
const ARROW_SPEED_MAX = 135; // a full draw: ~2.3x the old speed, and a flatter flight
const ARROW_GRAVITY = -20;
const ARROW_GRAVITY_FULL = -7; // a fully drawn arrow drops far less (gravity scales down with the draw)
const ARROW_DAMAGE = [2, 10]; // a quick flick ... a full draw
const ARROW_LIFE = 10;

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
export const BLASTER_DAMAGE = 6;
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
            if (id === BLOCK.AIR || id === BLOCK.WATER || (id === BLOCK.BEDROCK && y <= 1)) continue;
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
    const speed = ARROW_SPEED_MIN + (ARROW_SPEED_MAX - ARROW_SPEED_MIN) * power * power;
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
    const a = { pos, vel: dir.multiplyScalar(speed), age: 0, mesh, power, gravity: ARROW_GRAVITY + (ARROW_GRAVITY_FULL - ARROW_GRAVITY) * power * power, stuck: false, light: { sky: 15, block: 0 } };
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
      a.vel.y += (a.gravity ?? ARROW_GRAVITY) * dt;
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
