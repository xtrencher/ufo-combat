// Laser bolts: short, glowing sci-fi blaster bolts that fly fast in a
// straight line. One shared system for every laser in the game: the
// player's blaster, enemy UFOs, aliens' laser guns and the player's own UFO
// cannon. Bolts are drawn as two instanced meshes (a white-hot core and a
// colored additive halo, both HDR so they bloom), so hundreds cost two draw
// calls. On impact they spark, flash, leave a scorch mark on blocks, and
// hurt whatever they hit.
//
// Targets are pluggable: anything can register a hit provider with
// raycast(origin, dir, maxDist, bolt) -> { distance, hit(bolt, point, dir) }
// (mobs, UFOs, the player, vehicles); the bolt hits the nearest one, unless
// provider.ignores(bolt) says the bolt passes it (a bolt never hits its own
// shooter).
import * as THREE from "three";
import { LAYER_FX } from "./layers.js";
import { effectsQuality } from "./effects.js";

export const LASER_COLORS = {
  red: new THREE.Color(5, 0.35, 0.25),
  green: new THREE.Color(0.45, 5, 0.6),
  blue: new THREE.Color(0.5, 1.4, 6),
  cyan: new THREE.Color(0.6, 4, 5),
  magenta: new THREE.Color(4.5, 0.5, 4.5),
  orange: new THREE.Color(5, 2, 0.3),
  white: new THREE.Color(3.2, 3.8, 6),
  lime: new THREE.Color(2.6, 5, 0.3),
};

const MAX_BOLTS = 320;

// Where (distance along the bolt's step) a bolt moving from `origin` along
// `dir` for `maxDist` meets a sphere that moved with `vel` during the same
// `dt` (it is already at `center`, the end of its move). Solved in the
// target's frame, so a fast jet can't slip between two steps of a bolt.
// Returns the distance, or null.
const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3();
export function sweptSphere(origin, dir, maxDist, center, radius, vel = null, dt = 0) {
  _ro.copy(origin).sub(center);
  _rd.copy(dir).multiplyScalar(maxDist);
  if (vel && dt > 0) {
    _ro.addScaledVector(vel, dt); // the target at the start of the step
    _rd.addScaledVector(vel, -dt);
  }
  const a = _rd.lengthSq();
  const c = _ro.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-9) return null;
  const b = _ro.dot(_rd);
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const s = (-b - Math.sqrt(disc)) / a;
  if (s < 0 || s > 1) return null;
  return s * maxDist;
}

// The same for an axis-aligned box (min, max at the end of the move).
export function sweptBox(origin, dir, maxDist, min, max, vel = null, dt = 0) {
  _ro.copy(origin);
  _rd.copy(dir).multiplyScalar(maxDist);
  if (vel && dt > 0) {
    _ro.addScaledVector(vel, dt);
    _rd.addScaledVector(vel, -dt);
  }
  const len = _rd.length();
  if (len < 1e-9) return null;
  let t0 = 0;
  let t1 = len;
  for (const ax of ["x", "y", "z"]) {
    const d = _rd[ax] / len;
    if (Math.abs(d) < 1e-9) {
      if (_ro[ax] < min[ax] || _ro[ax] > max[ax]) return null;
      continue;
    }
    let ta = (min[ax] - _ro[ax]) / d;
    let tb = (max[ax] - _ro[ax]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return (t0 / len) * maxDist;
}
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();
const SMOKE0 = new THREE.Color(0.25, 0.24, 0.23);
const SMOKE1 = new THREE.Color(0.5, 0.5, 0.5);

export class LaserBolts {
  constructor({ scene, world, effects, decals, audio }) {
    this.world = world;
    this.effects = effects;
    this.decals = decals;
    this.holes = null; // bullet-hole decals (the pistol's bullets leave these instead of scorch marks)
    this.audio = audio;
    this.bolts = [];
    this.providers = [];
    this.listener = null; // () => Vector3: where the player's ears are (sound)
    this.fired = 0; // stats / tests
    // Flares: hot decoys that pull homing bolts (a UFO's seeking plasma) away
    // from a vehicle. { pos, vel, life } (moved and aged here, drawn by the owner).
    this.decoys = [];

    // A capsule-ish bolt along +Z, unit length and radius.
    const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1).rotateX(Math.PI / 2);
    const haloGeo = new THREE.CylinderGeometry(1, 0.55, 1, 8, 1).rotateX(Math.PI / 2);
    this.core = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), MAX_BOLTS);
    this.halo = new THREE.InstancedMesh(
      haloGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
      MAX_BOLTS
    );
    for (const mesh of [this.core, this.halo]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOLTS * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER_FX);
      scene.add(mesh);
    }
    this.halo.renderOrder = 13;
  }

  addProvider(provider) {
    this.providers.push(provider);
  }

  // A flare (or anything hot enough to fool a seeker) that lasts `life` seconds.
  addDecoy(pos, vel, life = 6) {
    const d = { pos: pos.clone(), vel: vel.clone(), life, maxLife: life };
    this.decoys.push(d);
    if (this.decoys.length > 40) this.decoys.shift().life = 0; // (burnt out: its jet drops it too)
    return d;
  }

  // Steers a homing bolt toward its target, or toward a flare that is closer
  // to it than the target's own heat; a bolt that reaches a flare is spent,
  // sometimes turning back on whatever fired it.
  _home(b, dt) {
    const h = b.homing;
    h.life -= dt;
    if (h.life <= 0) {
      b.homing = null;
      return;
    }
    if (!h.returned) {
      for (const d of this.decoys) {
        if (d.life <= 0) continue;
        const dd = d.pos.distanceTo(b.pos);
        if (dd < 3.5 + b.radius * 3) {
          // Decoyed.
          this.effects.glow.spawn({ x: b.pos.x, y: b.pos.y, z: b.pos.z, life: 0.3, size0: 2.5, size1: 0.6, color0: b.color, alpha: 0.9 });
          if (b.source && b.source.pos && Math.random() < 0.4) {
            // Back at the shooter.
            b.homing = { target: b.source, turn: 3.5, life: 5, returned: true };
            b.friendlyFire = true;
            b.owner = "decoyed";
            b.source = null;
            b.speed = Math.max(b.speed, 90);
          } else {
            b.dead = true;
          }
          return;
        }
        // Flares out-shine the target when they're near the bolt.
        if (dd < 140 && (!h.decoy || dd < h.decoy.pos.distanceTo(b.pos))) h.decoy = d;
      }
    }
    const t = h.decoy && h.decoy.life > 0 ? h.decoy : h.target;
    const tp = t?.pos;
    if (!tp) return;
    _p.copy(tp);
    const tv = t.vel;
    const dist = b.pos.distanceTo(tp);
    if (tv) _p.addScaledVector(tv, Math.min(1.5, dist / Math.max(20, b.speed)) * 0.8);
    _s.copy(_p).sub(b.pos).normalize();
    const ang = b.dir.angleTo(_s);
    if (ang > 1e-4) b.dir.lerp(_s, Math.min(1, (h.turn * dt) / ang)).normalize();
  }

  // Fires a bolt. opts: from (Vector3), dir (unit Vector3), color (Color,
  // HDR), speed (blocks/s), damage, owner (string: "player", "ufo", "alien",
  // "playerufo", ...), source (the object that fired it, which it never
  // hits), range (blocks), radius, length, scorch (leave a mark), sound.
  // mirror (multiplayer): a bolt another player (or the host's AI) fired, seen
  // here: it only hits this player and this player's own vehicle (see main.js).
  // tracer: a bullet (the pistol), drawn like the machine gun's tracers: a
  // thin pale streak with a faint halo, no muzzle glow, small sparks.
  // cause: what a hit by it is called (damage.js; an AI shooter's own, e.g. "soldier").
  fire({ from, dir, color = LASER_COLORS.red, speed = 120, damage = 6, owner = "player", source = null, range = 220, radius = 0.06, length = 1.8, scorch = true, sound = true, blast = 0, hole = false, mirror = false, tracer = false, cause = null }) {
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    const bolt = {
      pos: from.clone(),
      dir: dir.clone().normalize(),
      color: color.clone ? color.clone() : new THREE.Color(color[0], color[1], color[2]),
      speed,
      damage,
      owner,
      source,
      range,
      traveled: 0,
      radius,
      length,
      scorch,
      hole,
      blast,
      mirror,
      sound,
      tracer,
      cause,
      dead: false,
    };
    this.bolts.push(bolt);
    this.fired++;
    // A little muzzle glow (a gun's own flash does that for a bullet).
    if (!tracer) this.effects.glow.spawn({ x: from.x, y: from.y, z: from.z, life: 0.08, size0: radius * 9, size1: radius * 3, color0: bolt.color, alpha: 0.9 });
    if (sound && this.audio?.playBlaster) {
      const ears = this.listener ? this.listener() : null;
      this.audio.playBlaster(ears ? from.distanceTo(ears) : 0, owner);
    }
    return bolt;
  }

  // The nearest thing (block or target) along a bolt's step, or null.
  _cast(b, step, dt = 0) {
    b.step = step; // the whole step (a provider may be asked about less of it)
    let best = null;
    const blockHit = this.world.raycast(b.pos, b.dir, step, { solidOnly: true });
    if (blockHit) best = { distance: blockHit.distance, block: blockHit };
    for (const p of this.providers) {
      if (p.ignores && p.ignores(b)) continue;
      const hit = p.raycast(b.pos, b.dir, best ? best.distance : step, b, dt);
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, target: hit };
    }
    return best;
  }

  _impact(b, hit) {
    const point = b.pos.clone().addScaledVector(b.dir, hit.distance);
    const fx = this.effects;
    const q = effectsQuality.scale;
    const sparks = b.tracer ? Math.max(2, Math.round(4 * q)) : Math.max(3, Math.round(12 * q));
    const n = hit.block ? new THREE.Vector3(hit.block.normal[0], hit.block.normal[1], hit.block.normal[2]) : b.dir.clone().negate();
    for (let i = 0; i < sparks; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
      fx.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: v.x, vy: v.y, vz: v.z, life: 0.2 + Math.random() * 0.3, size0: 0.09, size1: 0.02, color0: b.color, gravity: 0.5, drag: 2.5 });
    }
    if (!b.tracer) fx.glow.spawn({ x: point.x, y: point.y, z: point.z, life: 0.14, size0: 0.9 + b.radius * 6, size1: 0.2, color0: b.color, alpha: 0.9 });
    fx.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: n.x * 0.6, vy: 0.6, vz: n.z * 0.6, life: 0.9, size0: 0.2, size1: 0.8, color0: SMOKE0, color1: SMOKE1, alpha: 0.4, drag: 1.5 });
    if (hit.block) {
      const loaded = this.world.getChunk(hit.block.block[0] >> 4, hit.block.block[2] >> 4);
      if (b.hole && this.holes && loaded) this.holes.add(point, hit.block.block, hit.block.normal); // a bullet: a hole
      else if (b.scorch && this.decals && loaded) this.decals.add(point, hit.block.block, hit.block.normal);
      const ears = this.listener ? this.listener() : null;
      if (this.audio?.playLaserHit) this.audio.playLaserHit(ears ? point.distanceTo(ears) : 0);
    } else if (hit.target) {
      hit.target.hit(b, point, b.dir);
    }
    if (b.blast > 0 && this.onBlast) this.onBlast(point, b);
  }

  update(dt) {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.life -= dt;
      d.vel.y -= 6 * dt;
      d.vel.multiplyScalar(Math.exp(-0.4 * dt));
      d.pos.addScaledVector(d.vel, dt);
      if (d.life <= 0) this.decoys.splice(i, 1);
    }
    const list = this.bolts;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.homing) this._home(b, dt);
      if (b.dead) continue;
      const step = b.speed * dt;
      const hit = this._cast(b, step, dt);
      if (hit) {
        this._impact(b, hit);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.traveled += step;
      if (b.traveled > b.range || b.pos.y < -20) continue; // (no ceiling: the range bounds a bolt)
      list[n++] = b;
    }
    list.length = n;
    // Draw: each bolt as a stretched core and halo trailing behind its head.
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const len = Math.min(b.length, b.traveled + 0.3);
      _q.setFromUnitVectors(_z, b.dir);
      _p.copy(b.pos).addScaledVector(b.dir, -len / 2);
      _m.compose(_p, _q, _s.set(b.radius, b.radius, len));
      this.core.setMatrixAt(i, _m);
      this.core.setColorAt(i, b.tracer ? _c.copy(b.color) : _c.copy(b.color).multiplyScalar(0.35).addScalar(1.1));
      const halo = b.tracer ? 1.7 : 3.2;
      _m.compose(_p, _q, _s.set(b.radius * halo, b.radius * halo, len * 1.15));
      this.halo.setMatrixAt(i, _m);
      this.halo.setColorAt(i, b.color);
    }
    this.core.count = n;
    this.halo.count = n;
    if (n > 0) {
      this.core.instanceMatrix.needsUpdate = true;
      this.core.instanceColor.needsUpdate = true;
      this.halo.instanceMatrix.needsUpdate = true;
      this.halo.instanceColor.needsUpdate = true;
    }
  }

  // Removes every bolt (e.g. mods switched off).
  clear() {
    this.bolts.length = 0;
    for (const d of this.decoys) d.life = 0; // (the jets' own flare lists drop them)
    this.decoys.length = 0;
    this.core.count = 0;
    this.halo.count = 0;
  }
}
