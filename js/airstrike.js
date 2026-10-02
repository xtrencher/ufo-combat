// Airstrike: the designator marks a spot with its laser; after a delay a
// shower of meteors comes screaming in at an angle from high up and far
// away, onto the target and random spots around it. Each meteor has a
// glowing, white-hot leading face over a dark crust, a heat glow, a fiery
// tail and a long smoke trail; on impact a white flash, a shockwave and the
// usual crater blast.
//
// Settings (Weapons tab): meteors per strike, spread radius, delay until
// impact, fall angle (from vertical), fall speed and explosion size. The
// strikes are fully independent of the other weapons (and of each other).
import * as THREE from "three";
import { AIRSTRIKE_METEOR_RADIUS, effectsQuality } from "./effects.js";
import { LAYER_FX } from "./layers.js";

export const AIRSTRIKE_DEFAULTS = { count: 7, spread: 22, delay: 5, angle: 35, speed: 95 };
const START_ALTITUDE = 190; // blocks above the target where a meteor appears
const METEOR_R = 0.9;

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,235,1)");
  g.addColorStop(0.2, "rgba(255,210,130,0.85)");
  g.addColorStop(0.5, "rgba(255,110,30,0.28)");
  g.addColorStop(1, "rgba(255,80,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A lumpy rock whose leading side (-Z, the direction of flight) glows white
// hot through cracks, fading to a dark crust behind.
function meteorGeometry() {
  const g = new THREE.IcosahedronGeometry(METEOR_R, 2);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump = 1 + (Math.sin(n.x * 7.1 + n.y * 3.3) * Math.cos(n.z * 5.7 - n.x * 2.1)) * 0.16;
    v.multiplyScalar(bump);
    pos.setXYZ(i, v.x, v.y, v.z);
    const front = Math.max(0, -n.z); // 1 at the leading point
    const crack = Math.abs(Math.sin(n.x * 11 + n.y * 13) * Math.sin(n.y * 9 - n.z * 12)) < 0.12 ? 1 : 0;
    const heat = Math.min(1, front * 1.4 + crack * 0.8);
    colors[i * 3] = 0.18 + heat * 6;
    colors[i * 3 + 1] = 0.07 + heat * heat * 3.2;
    colors[i * 3 + 2] = 0.04 + heat * heat * heat * 1.4;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export class Airstrikes {
  constructor({ scene, world, effects, audio, mobs }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.mobs = mobs;
    this.config = { ...AIRSTRIKE_DEFAULTS };
    this.pending = []; // { at, meteors: [{ start, target, time }], timer }
    this.meteors = [];
    this.targets = []; // extra hit tests: { sphereHit(pos, r) } (UFOs)
    this.listener = new THREE.Vector3();
    this.impacts = 0; // stats / tests
    this._geo = meteorGeometry();
    this._mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this._glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(4, 1.6, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    // The fiery tail: an additive cone trailing behind the rock.
    this._tailGeo = new THREE.ConeGeometry(METEOR_R * 1.05, 14, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 7);
    this._tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.8, 0.2), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this._c = {
      fire: new THREE.Color(3.2, 1.3, 0.35),
      fireEnd: new THREE.Color(0.9, 0.18, 0.04),
      smoke: new THREE.Color(0.22, 0.2, 0.19),
      smokeEnd: new THREE.Color(0.55, 0.53, 0.5),
      flash: new THREE.Color(6, 5.5, 4.5),
      ring: new THREE.Color(3, 1.8, 0.8),
    };
  }

  // Marks `target` (Vector3): the meteors hit after config.delay seconds.
  call(target, overrides = null) {
    // (`overrides`: a mission's own count / spread / delay for this strike, not the settings'.)
    const cfg = overrides ? { ...this.config, ...overrides } : this.config;
    const count = Math.max(1, Math.round(cfg.count));
    // The whole shower comes from one direction (± a little).
    const azimuth = Math.random() * Math.PI * 2;
    const angle = THREE.MathUtils.degToRad(Math.max(0, Math.min(80, cfg.angle)));
    const speed = Math.max(10, cfg.speed);
    const meteors = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = i === 0 ? 0 : cfg.spread * Math.sqrt(0.15 + 0.85 * Math.random());
      const tx = target.x + Math.cos(a) * d;
      const tz = target.z + Math.sin(a) * d;
      const ty = i === 0 ? target.y : this.world.heightAt(Math.floor(tx), Math.floor(tz)) + 1;
      const az = azimuth + (Math.random() - 0.5) * 0.25;
      const el = angle + (Math.random() - 0.5) * 0.08;
      // Direction of travel: down, tilted toward the azimuth.
      const dir = new THREE.Vector3(Math.sin(el) * Math.cos(az), -Math.cos(el), Math.sin(el) * Math.sin(az)).normalize();
      const alt = START_ALTITUDE + Math.random() * 40;
      const len = alt / Math.max(0.2, Math.cos(el));
      const end = new THREE.Vector3(tx, ty, tz);
      const start = end.clone().addScaledVector(dir, -len);
      // Staggered so they land as a rain over about a second or two.
      const land = cfg.delay + (i === 0 ? 0 : Math.random() * Math.min(2.5, 0.25 * count));
      meteors.push({ start, dir, speed, launch: land - len / speed, len });
    }
    const strike = { at: target.clone(), t: 0, meteors };
    this.pending.push(strike);
    return strike;
  }

  _launch(m) {
    const root = new THREE.Group();
    const rock = new THREE.Mesh(this._geo, this._mat);
    rock.scale.setScalar(0.9 + Math.random() * 0.5);
    root.add(rock);
    const glow = new THREE.Sprite(this._glowMat);
    glow.scale.setScalar(7);
    glow.layers.set(LAYER_FX);
    root.add(glow);
    const tail = new THREE.Mesh(this._tailGeo, this._tailMat);
    tail.layers.set(LAYER_FX);
    root.add(tail);
    root.position.copy(m.start);
    root.lookAt(m.start.clone().add(m.dir));
    root.rotateY(Math.PI); // the rock's hot face (-Z) leads
    this.scene.add(root);
    const meteor = { pos: m.start.clone(), dir: m.dir, speed: m.speed, root, rock, glow, age: 0, trail: 0, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3) };
    this.meteors.push(meteor);
    if (this.audio?.playMeteorIncoming) this.audio.playMeteorIncoming(m.len / m.speed, m.start.distanceTo(this.listener));
    return meteor;
  }

  _hitSomething(pos) {
    if (this.mobs.sphereHit(pos, METEOR_R)) return true;
    for (const t of this.targets) if (t.sphereHit(pos, METEOR_R * 1.5)) return true;
    return false;
  }

  _update(m, dt) {
    m.age += dt;
    const step = m.speed * dt;
    const blockHit = this.world.raycast(m.pos, m.dir, step, { solidOnly: true });
    if (blockHit) {
      m.pos.addScaledVector(m.dir, Math.max(0, blockHit.distance - 0.2));
      return true;
    }
    m.pos.addScaledVector(m.dir, step);
    if (this._hitSomething(m.pos)) return true;
    m.root.position.copy(m.pos);
    m.rock.rotation.x += m.spin.x * dt;
    m.rock.rotation.y += m.spin.y * dt;
    m.glow.scale.setScalar(6.5 + Math.sin(m.age * 40) * 0.6);
    // Trail: fire near the rock, smoke left hanging in the sky behind it.
    const fx = this.effects;
    const q = effectsQuality.scale;
    m.trail += step;
    const back = m.dir;
    const fires = Math.max(1, Math.round(3 * q));
    for (let i = 0; i < fires; i++) {
      const t = Math.random() * step;
      fx.glow.spawn({
        x: m.pos.x - back.x * t + (Math.random() - 0.5) * 0.8, y: m.pos.y - back.y * t + (Math.random() - 0.5) * 0.8, z: m.pos.z - back.z * t + (Math.random() - 0.5) * 0.8,
        vx: -back.x * 4, vy: -back.y * 4, vz: -back.z * 4,
        life: 0.35 + Math.random() * 0.3, size0: 2.2, size1: 0.6, color0: this._c.fire, color1: this._c.fireEnd, alpha: 0.7, drag: 2,
      });
    }
    const spacing = 2.2 / Math.max(0.35, q);
    while (m.trail > spacing) {
      m.trail -= spacing;
      const t = m.trail;
      fx.smoke.spawn({
        x: m.pos.x - back.x * (t + 3), y: m.pos.y - back.y * (t + 3), z: m.pos.z - back.z * (t + 3),
        vx: (Math.random() - 0.5) * 0.8, vy: 0.4 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8,
        life: 3.2 + Math.random() * 1.8, size0: 1.3, size1: 5 + Math.random() * 2, color0: this._c.smoke, color1: this._c.smokeEnd, alpha: 0.5, drag: 0.6,
      });
    }
    return m.age > 15 || m.pos.y < -20;
  }

  _impact(pos) {
    const fx = this.effects;
    this.impacts++;
    // A blinding flash and a hot ring racing out along the ground.
    fx.glow.spawn({ x: pos.x, y: pos.y + 1.5, z: pos.z, life: 0.22, size0: 26, size1: 12, color0: this._c.flash, alpha: 1 });
    fx.glow.spawn({ x: pos.x, y: pos.y + 1, z: pos.z, life: 0.5, size0: 10, size1: 30, color0: this._c.ring, alpha: 0.5 });
    fx.explode(pos.clone(), { radius: AIRSTRIKE_METEOR_RADIUS, source: "airstrike" });
  }

  update(dt, listener) {
    if (listener) this.listener.copy(listener);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t += dt;
      for (let k = s.meteors.length - 1; k >= 0; k--) {
        if (s.t >= s.meteors[k].launch) {
          this._launch(s.meteors[k]);
          s.meteors.splice(k, 1);
        }
      }
      if (s.meteors.length === 0) this.pending.splice(i, 1);
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      if (this._update(m, dt)) {
        this.scene.remove(m.root);
        this.meteors.splice(i, 1);
        if (m.pos.y > -20 && m.age <= 15) this._impact(m.pos);
      }
    }
  }

  // Seconds until the next strike's first impact (HUD), or null.
  get nextImpact() {
    let best = null;
    for (const s of this.pending) {
      const t = this.config.delay - s.t;
      if (best === null || t < best) best = t;
    }
    return best;
  }

  clear() {
    for (const m of this.meteors) this.scene.remove(m.root);
    this.meteors.length = 0;
    this.pending.length = 0;
  }
}
