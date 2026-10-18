// Weather on screen and in the ears (Round 11; the weather itself is
// js/weather.js): rain and snow round the camera, lightning bolts and their
// flash, the sound of the rain and of thunder.
// - Rain and snow: a fixed pool of streaks and flakes (Medium 1000/700, High
//   2000/1400, Ultra 3000/2000; none at all on Low) that the vertex shader
//   wraps in a box round the camera (nothing moves them on the CPU, as the
//   water's motes). A small height map of the columns round the camera
//   (48 x 48: the first block rain can't pass, and what falls there) hides
//   the drops under roofs, trees and the ground, and picks rain or snow.
// - A bolt: a jagged, branching ribbon from the clouds to where it struck,
//   flickering for half a second, and the sky's flash (sky.js).
// - Sounds (the Blocks volume): the rain, a looped noise, louder in the open
//   and muffled under a roof; a bolt's crack near it and its long rumble.
import * as THREE from "three";
import { LAYER_FX } from "./layers.js";
import { worldUniforms } from "./shaders.js";
import { PRECIP } from "./weather.js";

const GRID = 48;
const COUNTS = { low: [0, 0], medium: [1000, 700], high: [2000, 1400], ultra: [3000, 2000] };
const RAIN_BOX = [18, 15, 13]; // across, high, fall speed (blocks a second)
const SNOW_BOX = [16, 12, 1.6];
const REFRESH = 0.3; // seconds between height map refreshes
const BOLT_SEGMENTS = 18;
const BRANCHES = 3;
const BRANCH_SEGMENTS = 6;
const BOLT_QUADS = BOLT_SEGMENTS + BRANCHES * BRANCH_SEGMENTS;
const BOLT_LIFE = 0.55;

const dropVertex = /* glsl */ `
attribute vec4 aSeed; // xyz: place in the box (0-1); w: speed and phase
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uBox;     // across, high, fall speed
uniform vec2 uDrift;   // the wind's push (blocks a second, x and z)
uniform vec2 uSize;    // width, length
uniform sampler2D uTop;
uniform vec2 uTopOrigin;
uniform float uSnow;   // 1: this is the snow
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 box = vec3(uBox.x, uBox.y, uBox.x);
  float t = uTime * (0.8 + 0.4 * aSeed.w);
  vec3 drift = vec3(uDrift.x * t, -uBox.z * t, uDrift.y * t);
  if (uSnow > 0.5) drift.xz += vec2(sin(uTime * 1.3 + aSeed.w * 40.0), cos(uTime * 1.1 + aSeed.w * 23.0)) * 0.4;
  vec3 p = fract(aSeed.xyz + (drift - uCam) / box) - 0.5;
  vec3 world = uCam + p * box;
  vec2 cell = floor(world.xz) - uTopOrigin;
  float shown = 0.0;
  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < ${GRID}.0 && cell.y < ${GRID}.0) {
    vec4 c = texture2D(uTop, (cell + 0.5) / ${GRID}.0);
    float bottom = c.r * 255.0;
    float kind = floor(c.g * 255.0 + 0.5);
    float snow = kind > 1.5 ? 1.0 : 0.0;
    float wet = kind > 0.5 ? 1.0 : 0.0;
    shown = wet * step(bottom, world.y) * (uSnow > 0.5 ? snow : 1.0 - snow);
  }
  // (thinning out toward the box's edges, and right at the eye)
  float d = length(p.xz) * 2.0;
  vAlpha = shown * (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.015, 0.06, length(p)) * (1.0 - smoothstep(0.38, 0.5, abs(p.y)));
  vec3 fall = normalize(vec3(uDrift.x, -uBox.z, uDrift.y));
  vec3 toCam = normalize(cameraPosition - world);
  vec3 side = normalize(cross(fall, toCam));
  vec3 up = uSnow > 0.5 ? normalize(cross(toCam, side)) : fall;
  vec3 corner = world + side * position.x * uSize.x + up * position.y * uSize.y;
  vUv = uv;
  gl_Position = vAlpha > 0.001 ? projectionMatrix * viewMatrix * vec4(corner, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const dropFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSnow;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a;
  if (uSnow > 0.5) {
    a = 1.0 - smoothstep(0.35, 1.0, length(vUv * 2.0 - 1.0));
  } else {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    a = across * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  }
  a *= vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const boltVertex = /* glsl */ `
attribute vec3 aOther; // the segment's other end
attribute float aSide; // -1 or 1
attribute float aWidth;
varying float vEdge;
void main() {
  vec3 dir = normalize(aOther - position);
  vec3 toCam = normalize(cameraPosition - position);
  vec3 side = normalize(cross(dir, toCam));
  vEdge = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position + side * aSide * aWidth, 1.0);
}
`;

const boltFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vEdge;
void main() {
  float core = 1.0 - abs(vEdge);
  gl_FragColor = vec4(uColor * (0.35 + core * core), uAlpha * (0.25 + 0.75 * core));
  #include <colorspace_fragment>
}
`;

export class WeatherFx {
  // deps: { scene, weather, audio, sky }
  constructor({ scene, weather, audio = null, sky = null }) {
    this.weather = weather;
    this.audio = audio;
    if (sky) sky.weather = weather.levels;
    this.quality = "medium";
    this.time = 0;
    this._refreshT = 0;
    this._origin = new THREE.Vector2(NaN, NaN);
    this._eye = new THREE.Vector3();
    this._color = new THREE.Color();
    this._color2 = new THREE.Color();
    this._topData = new Uint8Array(GRID * GRID * 4);
    this.topTexture = new THREE.DataTexture(this._topData, GRID, GRID, THREE.RGBAFormat);
    this.topTexture.magFilter = this.topTexture.minFilter = THREE.NearestFilter;
    this.topTexture.needsUpdate = true;
    const max = COUNTS.ultra;
    this.rain = this._drops(scene, max[0], RAIN_BOX, [0.03, 0.8], 0, 11);
    this.snow = this._drops(scene, max[1], SNOW_BOX, [0.07, 0.07], 1, 11);
    this._bolt(scene);
    this.exposure = 0; // 0-1: how much of the rain around is in the open (the sound)
    this._sound = null;
    this._soundT = 0;
    this._noise = null;
  }

  _drops(scene, capacity, box, size, snow, order) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    const seeds = new Float32Array(capacity * 4);
    let s = 0x2468ace + snow;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(...box) },
        uDrift: { value: new THREE.Vector2() },
        uSize: { value: new THREE.Vector2(...size) },
        uTop: { value: this.topTexture },
        uTopOrigin: { value: new THREE.Vector2() },
        uSnow: { value: snow },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: snow ? 0.85 : 0.42 },
      },
      vertexShader: dropVertex,
      fragmentShader: dropFragment,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = order;
    mesh.layers.set(LAYER_FX);
    scene.add(mesh);
    return { mesh, geometry: g, material, capacity };
  }

  _bolt(scene) {
    const n = BOLT_QUADS * 4;
    const g = new THREE.BufferGeometry();
    this._boltPos = new Float32Array(n * 3);
    this._boltOther = new Float32Array(n * 3);
    const side = new Float32Array(n);
    this._boltWidth = new Float32Array(n);
    const index = new Uint16Array(BOLT_QUADS * 6);
    for (let q = 0; q < BOLT_QUADS; q++) {
      side.set([-1, 1, -1, 1], q * 4);
      index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(this._boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aOther", new THREE.BufferAttribute(this._boltOther, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setAttribute("aWidth", new THREE.BufferAttribute(this._boltWidth, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.boltMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(5, 5.6, 8) }, uAlpha: { value: 0 } },
      vertexShader: boltVertex,
      fragmentShader: boltFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.boltMesh = new THREE.Mesh(g, this.boltMaterial);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.visible = false;
    this.boltMesh.renderOrder = 13;
    this.boltMesh.layers.set(LAYER_FX);
    scene.add(this.boltMesh);
    this._boltAge = Infinity;
    this._boltGeometry = g;
  }

  // The graphics preset ("low" ... "ultra"): how many drops (none on Low).
  setQuality(name) {
    this.quality = COUNTS[name] ? name : "medium";
  }

  // Every frame: eye, the camera's position.
  update(dt, eye) {
    this.time += dt;
    this._eye.copy(eye);
    const lv = this.weather.levels;
    const [nRain, nSnow] = COUNTS[this.quality];
    const falling = lv.rain > 0.01 && nRain + nSnow > 0;
    this.rain.mesh.visible = this.snow.mesh.visible = falling;
    if (falling) this._updateDrops(dt, eye, lv.rain, nRain, nSnow);
    else this._refreshT = 0;
    this._updateBolt(dt);
    this._updateSound(dt, eye, lv.rain);
  }

  _updateDrops(dt, eye, level, nRain, nSnow) {
    this._refreshT -= dt;
    const ox = Math.floor(eye.x) - GRID / 2;
    const oz = Math.floor(eye.z) - GRID / 2;
    if (this._refreshT <= 0 || Math.abs(ox - this._origin.x) > 4 || Math.abs(oz - this._origin.y) > 4) {
      this._refreshT = REFRESH;
      this._fillTop(ox, oz);
    }
    // Lit by the sky (and the flash), a little bluish.
    const u = worldUniforms;
    const c = this._color.copy(u.uAmbientSky.value).multiplyScalar(1.6).add(this._color2.copy(u.uLightColor.value).multiplyScalar(0.12));
    const wind = u.uWind.value;
    for (const [d, n, k] of [[this.rain, nRain, 1.6], [this.snow, nSnow, 3]]) {
      d.geometry.instanceCount = Math.round(Math.min(d.capacity, n) * Math.min(1, level * 1.2));
      const m = d.material.uniforms;
      m.uCam.value.copy(eye);
      m.uTime.value = this.time;
      m.uTopOrigin.value.copy(this._origin);
      m.uDrift.value.set(wind.x, wind.y).multiplyScalar(wind.z * k);
      m.uColor.value.copy(c).multiplyScalar(d === this.snow ? 1.8 : 1);
    }
  }

  // The height map round the camera: R the lowest cell rain reaches, G what falls.
  _fillTop(ox, oz) {
    const w = this.weather;
    const data = this._topData;
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const i = (z * GRID + x) * 4;
        data[i] = Math.max(0, Math.min(255, w.topAt(ox + x, oz + z) + 1));
        data[i + 1] = w.precipAt(ox + x, oz + z);
      }
    }
    this._origin.set(ox, oz);
    this.topTexture.needsUpdate = true;
  }

  // How much of the ground within 7 blocks gets rain falling past the eye
  // (every other column), and whether the eye is under cover: the sound.
  _measureExposure(eye) {
    const w = this.weather;
    let open = 0;
    let n = 0;
    const ex = Math.floor(eye.x);
    const ez = Math.floor(eye.z);
    for (let dz = -7; dz <= 7; dz++) {
      for (let dx = -7 + ((dz + 7) & 1); dx <= 7; dx += 2) {
        n++;
        const x = ex + dx;
        const z = ez + dz;
        const kind = w.precipAt(x, z);
        if (kind === PRECIP.RAIN && w.topAt(x, z) < eye.y + 3) open++;
      }
    }
    this.exposure = open / n;
    this._eyeCovered = w.topAt(ex, ez) >= eye.y;
  }

  // ---------- Lightning ----------

  // A bolt struck at (x, y, z): its ribbon, the flash and the thunder.
  strike(x, y, z) {
    const r = Math.random;
    const top = Math.max(y + 60, 150);
    const pos = this._boltPos;
    const other = this._boltOther;
    const width = this._boltWidth;
    let q = 0;
    const seg = (ax, ay, az, bx, by, bz, wdt) => {
      for (let k = 0; k < 4; k++) {
        const i = (q * 4 + k) * 3;
        const a = k < 2;
        pos[i] = a ? ax : bx;
        pos[i + 1] = a ? ay : by;
        pos[i + 2] = a ? az : bz;
        other[i] = a ? bx : ax;
        other[i + 1] = a ? by : ay;
        other[i + 2] = a ? bz : az;
        width[q * 4 + k] = wdt;
      }
      q++;
    };
    // The main channel: from high above down to the cell, wandering.
    const pts = [];
    let px = x + 0.5 + (r() - 0.5) * 6;
    let pz = z + 0.5 + (r() - 0.5) * 6;
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const t = i / BOLT_SEGMENTS;
      const py = top + (y - top) * t;
      if (i === BOLT_SEGMENTS) {
        px = x + 0.5;
        pz = z + 0.5;
      } else if (i > 0) {
        px += (r() - 0.5) * 3.2;
        pz += (r() - 0.5) * 3.2;
      }
      pts.push(px, py, pz);
    }
    for (let i = 0; i < BOLT_SEGMENTS; i++) seg(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5], 0.32);
    // Forks off it, thinner, ending in the air.
    for (let b = 0; b < BRANCHES; b++) {
      const at = 2 + Math.floor(r() * (BOLT_SEGMENTS - 6));
      let bx = pts[at * 3];
      let by = pts[at * 3 + 1];
      let bz = pts[at * 3 + 2];
      const dx = (r() - 0.5) * 2;
      const dz = (r() - 0.5) * 2;
      for (let i = 0; i < BRANCH_SEGMENTS; i++) {
        const nx = bx + dx * 2 + (r() - 0.5) * 2;
        const ny = by - 2.5 - r() * 2;
        const nz = bz + dz * 2 + (r() - 0.5) * 2;
        seg(bx, by, bz, nx, ny, nz, 0.16);
        bx = nx;
        by = ny;
        bz = nz;
      }
    }
    for (const name of ["position", "aOther", "aWidth"]) this._boltGeometry.getAttribute(name).needsUpdate = true;
    this._boltAge = 0;
    this.boltMesh.visible = true;
    this.weather.levels.flash = 1;
    this._thunder(x, y, z);
  }

  _updateBolt(dt) {
    const lv = this.weather.levels;
    if (lv.flash > 0) lv.flash = Math.max(0, lv.flash - dt * 5);
    if (this._boltAge === Infinity) return;
    this._boltAge += dt;
    const t = this._boltAge;
    if (t >= BOLT_LIFE) {
      this._boltAge = Infinity;
      this.boltMesh.visible = false;
      this.boltMaterial.uniforms.uAlpha.value = 0;
      return;
    }
    // (vanilla's flicker: bright, a dip, a second stroke, then fading)
    const a = t < 0.08 ? 1 : t < 0.14 ? 0.15 : t < 0.24 ? 0.9 : (1 - (t - 0.24) / (BOLT_LIFE - 0.24)) * 0.7;
    this.boltMaterial.uniforms.uAlpha.value = a;
    if (t >= 0.14 && t < 0.16) lv.flash = Math.max(lv.flash, 0.8);
  }

  // ---------- Sounds ----------

  _noiseBuffer(ctx) {
    if (this._noise) return this._noise;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (this._noise = buf);
  }

  _bus() {
    const a = this.audio;
    return a?.buses?.blocks || a?.master || null;
  }

  // The rain's loop: started when it rains, stopped (freed) a while after.
  _updateSound(dt, eye, level) {
    this._soundT -= dt;
    if (this._soundT > 0) return;
    this._soundT = 0.5;
    const ctx = this.audio?.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    if (level > 0) this._measureExposure(eye);
    const target = level * 0.25 * this.exposure;
    let s = this._sound;
    if (!s) {
      if (target < 0.003) return;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(ctx);
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 500;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 4500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(lp).connect(gain).connect(bus);
      src.start();
      s = this._sound = { src, lp, gain, quiet: 0 };
    }
    const t = ctx.currentTime;
    s.gain.gain.setTargetAtTime(target, t, 0.4);
    s.lp.frequency.setTargetAtTime(this._eyeCovered ? 900 : 4500, t, 0.3);
    s.quiet = target < 0.003 ? s.quiet + 0.5 : 0;
    if (s.quiet > 3) {
      s.src.stop();
      s.gain.disconnect();
      this._sound = null;
    }
  }

  // A bolt's crack (near it) and its long, low rumble (heard everywhere).
  _thunder(x, y, z) {
    const ctx = this.audio?.ctx;
    const bus = this._bus();
    if (!ctx || !bus) return;
    const d = Math.hypot(x + 0.5 - this._eye.x, y - this._eye.y, z + 0.5 - this._eye.z);
    const t0 = ctx.currentTime;
    const buf = this._noiseBuffer(ctx);
    const burst = (dur, type, f, peak, attack, offset = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = dur > 1.9;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + offset);
      g.gain.exponentialRampToValueAtTime(peak, t0 + offset + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + dur);
      src.connect(filter).connect(g).connect(bus);
      src.start(t0 + offset, Math.random());
      src.stop(t0 + offset + dur + 0.05);
    };
    const near = 1 / (1 + d / 24);
    if (near > 0.08) burst(0.35, "highpass", 1400, 0.7 * near, 0.004);
    burst(4.5, "lowpass", 160 + 300 * near, 0.55, 0.12, Math.min(0.6, d / 340));
    burst(2.2, "lowpass", 500, 0.22 * (0.3 + near), 0.05, 0.25 + Math.random() * 0.4);
  }

}
