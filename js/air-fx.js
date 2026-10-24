// (Round 13) Sonic booms and the jets' missile blasts.
//
// Sonic booms: every aircraft this machine sees (our own, the enemy
// fighters, the other players' aircraft online, the UFOs) is watched for the
// sound barrier, Mach 1 = 1235 km/h = 343 blocks/s (the speedometer shows
// blocks/s x 3.6). Going through it: a vapor cone (a white conical collar of
// mist around the hull that flashes for about a second), a shock ring
// racing out from it, a puff of condensation, a camera shake, and the boom,
// heard by everyone around with the delay of the speed of sound and fading
// with distance. Slowing back through it: a softer boom and a faint ring, no
// cone. Each machine works this out for itself from the motion it already
// has (a puppet's velocity comes with its snapshots), so nothing is sent.
// A crossing counts only after some time on the other side of the barrier
// (no stutter of booms around Mach 1), and booms are rate-limited (cheap on
// weak PCs: a few pooled meshes, a handful of particles).
//
// Missile blasts: a missile's explosion (the "missile" sources, on every
// machine through the effects' blast listeners, so a mirrored one online
// too) gets a bigger fireball, a flash, a shock sphere, burning fragments
// and a smoke ball on top of the usual blast.
import * as THREE from "three";
import { effectsQuality } from "./effects.js";
import { LAYER_FX } from "./layers.js";

export const MACH1 = 1235 / 3.6; // blocks/s
const ARM = 0.8; // s on one side of the barrier before crossing it booms again
const DWELL = 0.08; // s past Mach 1 before it counts (a spike of one frame is not a crossing)
const DOWN = 0.96; // slowing below this x Mach 1 is through the barrier the other way
const COOL = 1.5; // s between two booms of one aircraft
const GLOBAL_COOL = 0.3; // ... and of any two
const HEAR = 4000; // blocks: the boom is heard this far
const SEE = 2600; // ... and seen
const CONE_LIFE = 1.1;
const RING_LIFE = 0.85;
const CONES = 4;
const RINGS = 8;
const MISSILE_SOURCES = new Set(["missile", "roguemissile", "enemymissile"]);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _back = new THREE.Vector3(0, 0, 1);

function smooth(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// The mist's alpha: dense at the shock front (the cone's leading edge),
// feathering away behind it, in streaks around the cone. u: around, v: along
// (0 front, 1 back). Made once.
let _coneTex = null;
function coneTexture() {
  if (_coneTex) return _coneTex;
  const W = 128;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const img = g.createImageData(W, H);
  // Streaks: a few low-frequency waves around the cone (wraps at u = 1).
  const waves = [3, 7, 13, 21].map((f) => ({ f, p: Math.random() * 6.28, a: 1 / Math.sqrt(f) }));
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (const w of waves) s += Math.sin((x / W) * 6.283 * w.f + w.p) * w.a;
    const streak = 0.62 + 0.38 * Math.tanh(s * 1.4);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      const front = smooth(v / 0.06); // a crisp (not hard) leading edge
      const tail = Math.exp(-v * 3.2) * (1 - smooth((v - 0.7) / 0.3));
      const a = front * tail * (0.55 + 0.45 * streak * (0.6 + 0.4 * (1 - v)));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.min(1, a));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _coneTex = new THREE.CanvasTexture(c);
  _coneTex.wrapS = THREE.RepeatWrapping;
  _coneTex.wrapT = THREE.ClampToEdgeWrapping;
  return _coneTex;
}

// A bell of a cone along +Z (front at z 0, back at z 1, radius 0.32 -> 1).
let _coneGeo = null;
function coneGeometry() {
  if (_coneGeo) return _coneGeo;
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.32 + 0.68 * Math.pow(t, 0.6), t));
  }
  _coneGeo = new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2);
  return _coneGeo;
}

// A shock ring: a soft band (bright on its outer edge, the shock front,
// feathered inside) on a square, radius 1.
let _ringGeo = null;
let _ringTex = null;
function ringGeometry() {
  return _ringGeo || (_ringGeo = new THREE.PlaneGeometry(2, 2));
}
function ringTexture() {
  if (_ringTex) return _ringTex;
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const a = r > 1 ? 0 : smooth((1 - r) / 0.04) * Math.pow(smooth((r - 0.62) / 0.36), 2.2);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * a);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _ringTex = new THREE.CanvasTexture(c);
  return _ringTex;
}

// The vapor cone's look: the mist is a thin shell, so it is densest where
// it is seen edge-on (a halo seen from behind, a bell from the side), with
// the streaked alpha above along it.
function coneMaterial() {
  const tex = coneTexture().clone();
  tex.needsUpdate = true;
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, opacity: { value: 0 }, color: { value: new THREE.Color(1, 1, 1) }, shift: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      uniform vec3 color;
      uniform float shift;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float a = texture2D(map, vec2(vUv.x + shift, vUv.y)).g;
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        a *= opacity * (0.18 + 0.82 * pow(rim, 1.8));
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// How a cone sits around each kind of hull: length and back radius (x the
// hull's radius) and how far ahead of the middle its front is.
function coneShape(o) {
  const r = o.radius || 6;
  if (o.type === "ufo" || !o.forward) return { len: r * 1.25, rad: r * 1.45, ahead: r * 0.35 };
  if (o.spec?.id === "b2") return { len: r * 0.62, rad: r * 1.08, ahead: r * 0.22 };
  return { len: r * 1.3, rad: r * 0.98, ahead: r * 0.3 };
}

export class AirFx {
  constructor(mgr) {
    this.mgr = mgr;
    this.scene = mgr.scene;
    this.fx = mgr.effects;
    this.time = 0;
    this.lastBoom = -99;
    this.booms = 0; // (a count, for the tests)
    this.cones = [];
    this.rings = [];
    this.pending = []; // a boom's shake on its way at the speed of sound: { t, k }
    this.onBoom = null; // (o, up, dist): the tests
    for (let i = 0; i < CONES; i++) {
      const mat = coneMaterial();
      const m = new THREE.Mesh(coneGeometry(), mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.layers.set(LAYER_FX);
      this.scene.add(m);
      this.cones.push({ mesh: m, o: null, age: 99, shape: null, dir: new THREE.Vector3(0, 0, -1) });
    }
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: ringTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const m = new THREE.Mesh(ringGeometry(), mat);
      m.visible = false;
      m.layers.set(LAYER_FX);
      this.scene.add(m);
      this.rings.push({ mesh: m, age: 99, life: RING_LIFE, r0: 1, r1: 2, a: 0.5, additive: false });
    }
    this._colors = { mist: new THREE.Color(0.94, 0.95, 0.97), mist2: new THREE.Color(0.86, 0.88, 0.92), hot: new THREE.Color(7, 4.6, 2), mid: new THREE.Color(3.6, 1.4, 0.45), ember: new THREE.Color(5, 2.2, 0.6), smoke0: new THREE.Color(0.07, 0.065, 0.06), smoke1: new THREE.Color(0.3, 0.29, 0.28), metal: new THREE.Color(0.3, 0.31, 0.33) };
    // The missile blasts (ours and, online, the ones mirrored here).
    this.fx.blastListeners?.push((pos, removed, radius, info) => {
      if (MISSILE_SOURCES.has(info?.source)) this.missileBlast(pos, radius, info.source);
    });
  }

  // ---------- Sonic booms ----------

  update(dt) {
    this.time += dt;
    const mgr = this.mgr;
    for (const v of mgr.vehicles) {
      if (v.type !== "jet" && v.type !== "enemyjet" && v.type !== "ufo") continue;
      if (!v.alive || v.wreck || v.onGround || v.crashed) {
        v._sb = null;
        continue;
      }
      this._track(v, dt);
    }
    for (const u of mgr.ufos?.ufos ?? []) {
      if (u.falling || u.state === "gone" || u.hidden) {
        u._sb = null;
        continue;
      }
      this._track(u, dt);
    }
    // Shakes arriving with the sound.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      this.fx.shake?.add?.(p.k);
    }
    this._updateCones(dt);
    this._updateRings(dt);
  }

  // Speed through the air: its velocity (a puppet's comes over the network),
  // or how far it really moved for a dashing ship (whose dash moves it, not
  // its velocity). A jump of hundreds of blocks in a frame (a respawn, a
  // teleport) is not flight.
  _speed(o, st, dt) {
    let sp = o.vel ? o.vel.length() : 0;
    if (st.px !== undefined && dt > 0) {
      const moved = Math.hypot(o.pos.x - st.px, o.pos.y - st.py, o.pos.z - st.pz);
      const raw = moved / dt;
      if (o.dashing && raw < 6000) sp = Math.max(sp, raw);
    }
    st.px = o.pos.x;
    st.py = o.pos.y;
    st.pz = o.pos.z;
    return sp;
  }

  _track(o, dt) {
    let st = o._sb;
    if (!st) {
      st = o._sb = { side: -1, t: 0, past: 0, cool: 0 };
      this._speed(o, st, dt);
      return;
    }
    const sp = this._speed(o, st, dt);
    st.cool -= dt;
    if (st.side < 0) {
      // (First sight: whichever side it is on now, no boom for it.)
      st.side = sp > MACH1 ? 1 : 0;
      st.t = 0;
      return;
    }
    st.t += dt;
    if (st.side === 0) {
      if (sp > MACH1) {
        st.past += dt;
        if (st.past >= DWELL) {
          if (st.t >= ARM) this.boom(o, true);
          st.side = 1;
          st.t = 0;
          st.past = 0;
        }
      } else st.past = 0;
    } else if (sp < MACH1 * DOWN) {
      if (st.t >= ARM) this.boom(o, false);
      st.side = 0;
      st.t = 0;
      st.past = 0;
    }
  }

  // Through the barrier: up (faster) or down (slowing).
  boom(o, up) {
    const st = o._sb;
    if (st && st.cool > 0) return;
    if (this.time - this.lastBoom < GLOBAL_COOL) return;
    if (st) st.cool = COOL;
    this.lastBoom = this.time;
    this.booms++;
    const mgr = this.mgr;
    const fx = this.fx;
    const own = o === mgr.active;
    const dist = own ? 0 : o.pos.distanceTo(fx.listener);
    this.onBoom?.(o, up, dist);
    const big = (o.radius || 6) > 12;
    if (dist < HEAR) mgr.audio?.playSonicBoom?.(dist, { soft: !up, inside: own, big });
    // The shake: the pilot's own at once, a bystander's when the sound gets there.
    if (own) fx.shake?.add?.(up ? 0.32 : 0.14);
    else if (dist < 600) this.pending.push({ t: dist / MACH1, k: (up ? 0.55 : 0.25) * (1 - smooth(dist / 600)) });
    if (dist > SEE) return;
    const dir = this._dir(o, _v);
    const shape = coneShape(o);
    if (up) this._spawnCone(o, shape, dir);
    this._spawnRing(o.pos, dir, shape.rad * 0.9, shape.rad * (up ? 7 : 4.5), up ? 0.62 : 0.28, up ? RING_LIFE : RING_LIFE * 0.8);
    if (up) {
      // A puff of condensation round the cone's rim.
      const q = effectsQuality.scale;
      const n = Math.max(4, Math.round(14 * q));
      const c = this._colors;
      const side = _w.set(0, 1, 0).cross(dir);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const upv = new THREE.Vector3().crossVectors(dir, side);
      const day = 1 - 0.7 * (mgr.night ?? 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = shape.rad * (0.7 + Math.random() * 0.3);
        const x = o.pos.x + dir.x * (shape.ahead - shape.len * 0.6) + (side.x * Math.cos(a) + upv.x * Math.sin(a)) * rr;
        const y = o.pos.y + dir.y * (shape.ahead - shape.len * 0.6) + (side.y * Math.cos(a) + upv.y * Math.sin(a)) * rr;
        const z = o.pos.z + dir.z * (shape.ahead - shape.len * 0.6) + (side.z * Math.cos(a) + upv.z * Math.sin(a)) * rr;
        const vv = o.vel || _w.set(0, 0, 0);
        fx.smoke.spawn({ x, y, z, vx: vv.x * 0.12, vy: vv.y * 0.12, vz: vv.z * 0.12, life: 0.7 + Math.random() * 0.5, size0: shape.rad * 0.35, size1: shape.rad * 1.1, color0: c.mist, color1: c.mist2, alpha: 0.32 * day, drag: 2.5 });
      }
    }
  }

  // Which way it is flying (its velocity, else its nose).
  _dir(o, out) {
    if (o.vel && o.vel.lengthSq() > 1) return out.copy(o.vel).normalize();
    if (o.forward) return o.forward(out);
    return out.set(0, 0, -1);
  }

  _spawnCone(o, shape, dir) {
    const c = this.cones.find((k) => k.age >= CONE_LIFE) || this.cones.reduce((a, b) => (b.age > a.age ? b : a));
    c.o = o;
    c.age = 0;
    c.shape = shape;
    c.dir.copy(dir);
    c.mesh.visible = true;
    c.mesh.material.uniforms.shift.value = Math.random();
    this._placeCone(c);
  }

  _placeCone(c) {
    const o = c.o;
    const s = c.shape;
    // (It follows the hull, along the flight path; it grows a little as it fades.)
    if (o.vel && o.vel.lengthSq() > 4) c.dir.lerp(_w.copy(o.vel).normalize(), 0.5).normalize();
    const grow = 1 + c.age * 0.25;
    const m = c.mesh;
    m.position.copy(o.pos).addScaledVector(c.dir, s.ahead);
    m.quaternion.setFromUnitVectors(_back, _w.copy(c.dir).negate());
    m.scale.set(s.rad * (0.96 + c.age * 0.08), s.rad * (0.96 + c.age * 0.08), s.len * grow);
  }

  _updateCones(dt) {
    const night = this.mgr.night ?? 0;
    for (const c of this.cones) {
      if (c.age >= CONE_LIFE) continue;
      c.age += dt;
      const o = c.o;
      if (c.age >= CONE_LIFE || !o || o.alive === false || o.falling) {
        c.age = CONE_LIFE;
        c.mesh.visible = false;
        c.o = null;
        continue;
      }
      this._placeCone(c);
      // A flash: up in a tenth of a second, held, then gone over most of a second.
      const a = c.age < 0.08 ? c.age / 0.08 : c.age < 0.3 ? 1 : 1 - smooth((c.age - 0.3) / (CONE_LIFE - 0.3));
      const u = c.mesh.material.uniforms;
      u.opacity.value = 0.95 * a;
      const k = 1 - 0.72 * night;
      u.color.value.setRGB(k, k, k * 1.02);
      u.shift.value += dt * 0.05;
    }
  }

  // A flat ring facing `normal`, racing out from r0 to r1.
  _spawnRing(pos, normal, r0, r1, alpha, life, additive = false, color = null) {
    const r = this.rings.find((k) => k.age >= k.life) || this.rings.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
    r.age = 0;
    r.life = life;
    r.r0 = r0;
    r.r1 = r1;
    r.a = alpha;
    const m = r.mesh;
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(_w.set(0, 0, 1), normal);
    m.visible = true;
    const mat = m.material;
    if (mat.blending !== (additive ? THREE.AdditiveBlending : THREE.NormalBlending)) {
      mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.needsUpdate = true;
    }
    if (color) mat.color.copy(color);
    else {
      const k = 1 - 0.72 * (this.mgr.night ?? 0);
      mat.color.setRGB(0.92 * k, 0.95 * k, k);
    }
    r.additive = additive;
    this._placeRing(r);
  }

  _placeRing(r) {
    const t = Math.min(1, r.age / r.life);
    const e = 1 - (1 - t) * (1 - t) * (1 - t); // (fast out, slowing: a shock front)
    const s = r.r0 + (r.r1 - r.r0) * e;
    r.mesh.scale.set(s, s, s);
    r.mesh.material.opacity = r.a * (1 - t) * (1 - t);
  }

  _updateRings(dt) {
    for (const r of this.rings) {
      if (r.age >= r.life) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      this._placeRing(r);
    }
  }

  // ---------- Missile blasts ----------

  // On top of the blast itself (effects.js): a white-hot flash, a bigger,
  // rolling fireball, a shock sphere (two crossed rings, one facing the
  // camera), burning fragments arcing out trailing sparks, a dark smoke ball
  // and the deeper boom. A ground hit has its own crater, debris and dust
  // already; this is what sells one in the air.
  missileBlast(pos, radius = 6, source = "missile") {
    const fx = this.fx;
    const c = this._colors;
    const q = effectsQuality.scale;
    const k = source === "missile" ? 1 : 0.8; // (an enemy's missile: a little smaller)
    const rnd = (a, b) => a + Math.random() * (b - a);
    const dist = pos.distanceTo(fx.listener);
    if (dist > 1600) return;
    fx.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.16, size0: 16 * k, size1: 6 * k, color0: c.hot, alpha: 1 });
    for (let i = 0; i < Math.round(34 * q * k); i++) {
      const d = _v.set(rnd(-1, 1), rnd(-0.8, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(3, 16) * k);
      fx.glow.spawn({ x: pos.x + d.x * 0.15, y: pos.y + d.y * 0.15, z: pos.z + d.z * 0.15, vx: d.x, vy: d.y + 2, vz: d.z, life: rnd(0.45, 1.1), size0: rnd(3, 5.5) * k, size1: rnd(8, 13) * k, color0: c.hot, color1: Math.random() < 0.6 ? c.mid : c.hot, alpha: 0.5, drag: 2.6, gravity: -0.15 });
    }
    // Burning fragments: they arc out and fall, trailing fire.
    for (let i = 0; i < Math.round(10 * q * k); i++) {
      const d = _v.set(rnd(-1, 1), rnd(-0.2, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(16, 34));
      fx.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y, vz: d.z, life: rnd(0.9, 1.6), size0: rnd(0.8, 1.4), size1: 0.2, color0: c.ember, color1: c.mid, alpha: 1, drag: 0.6, gravity: 0.9 });
    }
    for (let i = 0; i < Math.round(14 * q * k); i++) {
      const d = _v.set(rnd(-1, 1), rnd(-0.3, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(10, 26));
      fx.debris.spawn(pos.x, pos.y, pos.z, d.x, d.y + 3, d.z, rnd(0.15, 0.4), c.metal, rnd(1.6, 3.2));
    }
    for (let i = 0; i < Math.round(18 * q * k); i++) {
      const d = _v.set(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(1.5, 7) * k);
      fx.smoke.spawn({ x: pos.x + d.x * 0.4, y: pos.y + d.y * 0.4, z: pos.z + d.z * 0.4, vx: d.x, vy: d.y + rnd(1, 2.5), vz: d.z, life: rnd(3.2, 5.5), size0: rnd(3, 5) * k, size1: rnd(11, 17) * k, color0: c.smoke0, color1: c.smoke1, alpha: rnd(0.55, 0.8), drag: 1.1, gravity: -0.05 });
    }
    // The shock sphere: a ring facing the camera (seen as a sphere's rim) and a level one.
    const cam = _w.copy(fx.listener).sub(pos);
    if (cam.lengthSq() < 1e-4) cam.set(0, 1, 0);
    cam.normalize();
    const warm = this._warm || (this._warm = new THREE.Color(1, 0.86, 0.62));
    this._spawnRing(pos, cam, radius * 0.6, radius * 4.2 * k, 0.7, 0.5, true, warm);
    this._spawnRing(pos, UP, radius * 0.6, radius * 3.4 * k, 0.45, 0.6, true, warm);
    fx.shake?.add?.(0.22 * (1 - smooth(dist / (radius * 14 + 40))));
    this.mgr.audio?.playBlastBoom?.(dist, k);
  }
}
