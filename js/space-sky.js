// Space's skies (Round 15): the Moon's and Mars' skies, the rocket's climb
// into the black, and the planets' looks (js/space.js's orbit scene uses
// them too).
//
// - The sky's hook (sky.js `post`, after the day's colours are worked out):
//     the Moon: a black sky full of stars, the sun fixed low in it (long,
//       hard shadows; little light in them: no air to scatter it), the
//       Earth hanging in the sky (a lit globe: its night side dark);
//     Mars: the day's sun (the Overworld's clock) over a butterscotch sky,
//       the sunset blue round the sun, the night dark and starry, a dusty
//       haze; its two little moons;
//     the climb (the Overworld, js/rocket.js altK): the sky darkening to
//       black and stars overhead, a thin blue band at the horizon, the
//       clouds left below.
// - The planets' textures (canvases, made once when first needed, small:
//   512 x 256), and their material: the sun lights the day side, the night
//   side is dark (the Earth's has its cities' lights), an atmosphere glows at
//   the rim.
import * as THREE from "three";
import { worldUniforms } from "./shaders.js";

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const MOON_SUN = new THREE.Vector3(0.62, 0.36, -0.42).normalize(); // (low over the Moon: long shadows)
const EARTH_DIR = new THREE.Vector3(-0.42, 0.62, -0.66).normalize(); // (where the Earth hangs in the Moon's sky)
const _c = new THREE.Color();

// ---------- Noise for the planets' textures ----------

function hash3(x, y, z, s) {
  let h = (s | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, s);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, oct, s) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += vnoise3(x * f, y * f, z * f, s + i * 17) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// An equirectangular texture painted per pixel by fn(x, y, z, lat) -> [r, g, b, a?]
// (0-255), a few rows at a time (pumpPlanetTextures): no hitch while it is made.
const JOBS = [];
function paintSphere(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  JOBS.push({ w, h, fn, g, img, row: 0, tex: t });
  return t;
}
function paintRows(job, n) {
  const { w, h, fn, img } = job;
  const d = img.data;
  const end = Math.min(h, job.row + n);
  for (let j = job.row; j < end; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat);
    const y = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      const col = fn(Math.cos(lon) * cl, y, Math.sin(lon) * cl, lat);
      const o = (j * w + i) * 4;
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
      d[o + 3] = col[3] ?? 255;
    }
  }
  job.row = end;
  if (end >= h) {
    job.g.putImageData(img, 0, 0);
    job.tex.needsUpdate = true;
  }
}
// Paints the planets' textures for about `ms` milliseconds (Infinity: all of them now).
export function pumpPlanetTextures(ms = 3) {
  const t0 = performance.now();
  while (JOBS.length) {
    const job = JOBS[0];
    paintRows(job, 4);
    if (job.row >= job.h) JOBS.shift();
    if (performance.now() - t0 > ms) break;
  }
  return JOBS.length;
}

const TEX = {};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The planets' surface textures (and the Earth's clouds and night lights), made once.
export function planetTexture(name) {
  if (TEX[name]) return TEX[name];
  const W = name === "earthNight" || name === "earthClouds" ? 512 : 1024;
  const H = W / 2;
  let t;
  if (name === "earth") {
    t = paintSphere(W, H, (x, y, z, lat) => {
      const n = fbm3(x * 2.2 + 3, y * 2.2, z * 2.2, 5, 11);
      const land = n > 0.52;
      const ice = Math.abs(lat) > 1.22 + (fbm3(x * 6, y * 6, z * 6, 2, 3) - 0.5) * 0.25;
      if (ice) return [236, 240, 246];
      if (!land) {
        const deep = smooth(0.52, 0.3, n);
        return mix([38, 92, 150], [12, 34, 84], deep);
      }
      const dry = fbm3(x * 4 + 9, y * 4, z * 4, 3, 5);
      const hot = 1 - Math.abs(lat) / 1.2;
      const k = smooth(0.5, 0.66, dry) * smooth(0.3, 0.8, hot);
      const base = mix([52, 104, 46], [190, 160, 104], k);
      return mix(base, [110, 98, 82], smooth(0.62, 0.75, n) * 0.6);
    });
  } else if (name === "earthClouds") {
    t = paintSphere(W, H, (x, y, z, lat) => {
      const n = fbm3(x * 3 + 20, y * 6, z * 3, 5, 77);
      const band = 0.12 * Math.cos(lat * 6);
      const a = smooth(0.52 - band, 0.7 - band, n);
      return [255, 255, 255, Math.round(a * 190)];
    });
  } else if (name === "earthNight") {
    t = paintSphere(W, H, (x, y, z) => {
      const n = fbm3(x * 2.2 + 3, y * 2.2, z * 2.2, 5, 11);
      if (n <= 0.53) return [0, 0, 0];
      const c = fbm3(x * 24, y * 24, z * 24, 2, 41);
      const k = smooth(0.62, 0.8, c);
      return [255 * k, 190 * k, 110 * k];
    });
  } else if (name === "moon") {
    t = paintSphere(W, H, (x, y, z) => {
      const m = smooth(0.48, 0.56, fbm3(x * 1.6 + 5, y * 1.6, z * 1.6, 4, 21));
      let v = 150 + (fbm3(x * 9, y * 9, z * 9, 3, 23) - 0.5) * 50 - m * 70;
      // craters: bright rims, dark floors
      const c = fbm3(x * 14, y * 14, z * 14, 2, 29);
      if (c > 0.62) v += (c - 0.62) * 260;
      else if (c < 0.36) v -= (0.36 - c) * 90;
      return [v, v, v * 1.01];
    });
  } else if (name === "mars") {
    t = paintSphere(W, H, (x, y, z, lat) => {
      if (Math.abs(lat) > 1.3 + (fbm3(x * 5, y * 5, z * 5, 2, 7) - 0.5) * 0.2) return [240, 230, 222];
      const n = fbm3(x * 2 + 1, y * 2, z * 2, 5, 31);
      const dark = smooth(0.48, 0.6, n);
      let c = mix([196, 104, 58], [104, 52, 34], dark * 0.8);
      // the great canyon: a dark scar along the equator
      const scar = Math.abs(y - 0.05 * Math.sin(x * 5)) < 0.03 && x > 0.1 ? 1 : 0;
      c = mix(c, [80, 38, 26], scar * 0.7);
      return c.map((v) => v * (0.9 + fbm3(x * 12, y * 12, z * 12, 2, 37) * 0.2));
    });
  }
  TEX[name] = t;
  return t;
}

// ---------- The planets' material ----------

const planetVertex = `
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const planetFragment = `
uniform sampler2D uMap;
uniform sampler2D uNight;
uniform float uHasNight;
uniform vec3 uSun;
uniform vec3 uAtmo;
uniform float uAtmoK;
uniform float uBright;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = dot(n, normalize(uSun));
  float day = smoothstep(-0.08, 0.25, d);
  vec3 tex = texture2D(uMap, vUv).rgb;
  vec3 col = tex * (0.015 + max(d, 0.0) * 1.35) * uBright;
  if (uHasNight > 0.5) col += texture2D(uNight, vUv).rgb * (1.0 - day) * 0.9;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col += uAtmo * rim * uAtmoK * smoothstep(-0.25, 0.45, d) * 1.6;
  col += uAtmo * uAtmoK * 0.03 * day;
  gl_FragColor = vec4(col, 1.0);
}`;
// The atmosphere's halo: a shell a little bigger than the planet, glowing at its rim, lit by the sun.
const haloFragment = `
uniform vec3 uSun;
uniform vec3 uAtmo;
uniform float uAtmoK;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float f = 1.0 - abs(dot(n, v));
  float a = pow(f, 3.0) * uAtmoK * smoothstep(-0.35, 0.4, dot(n, normalize(uSun)));
  gl_FragColor = vec4(uAtmo * a * 1.6, a);
}`;
const cloudFragment = `
uniform sampler2D uMap;
uniform vec3 uSun;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, normalize(uSun));
  float a = texture2D(uMap, vUv).a;
  vec3 col = vec3(1.0) * (0.02 + max(d, 0.0) * 1.1);
  gl_FragColor = vec4(col, a * smoothstep(-0.3, 0.1, d) * 0.95 + a * 0.05);
}`;

export const PLANETS = {
  earth: { tex: "earth", atmo: [0.35, 0.6, 1.2], atmoK: 1, clouds: true, night: true },
  moon: { tex: "moon", atmo: [0, 0, 0], atmoK: 0 },
  mars: { tex: "mars", atmo: [1.0, 0.55, 0.35], atmoK: 0.45 },
};

// A planet: a group with its globe (radius r), clouds and halo. sun: a
// direction (world) the material reads (shared: change it in place).
export function createPlanet(kind, r, sun, { segments = 64 } = {}) {
  const P = PLANETS[kind];
  const group = new THREE.Group();
  const mats = [];
  const sphere = new THREE.SphereGeometry(r, segments, Math.round(segments / 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: planetTexture(P.tex) }, uNight: { value: P.night ? planetTexture("earthNight") : null }, uHasNight: { value: P.night ? 1 : 0 }, uSun: { value: sun }, uAtmo: { value: new THREE.Color(...P.atmo) }, uAtmoK: { value: P.atmoK }, uBright: { value: 1 } },
    vertexShader: planetVertex,
    fragmentShader: planetFragment,
    fog: false,
  });
  mats.push(mat);
  const globe = new THREE.Mesh(sphere, mat);
  group.add(globe);
  let clouds = null;
  if (P.clouds) {
    const cm = new THREE.ShaderMaterial({ uniforms: { uMap: { value: planetTexture("earthClouds") }, uSun: { value: sun } }, vertexShader: planetVertex, fragmentShader: cloudFragment, transparent: true, depthWrite: false, fog: false });
    mats.push(cm);
    clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.012, segments, Math.round(segments / 2)), cm);
    group.add(clouds);
  }
  let halo = null;
  if (P.atmoK > 0) {
    const hm = new THREE.ShaderMaterial({ uniforms: { uSun: { value: sun }, uAtmo: { value: new THREE.Color(...P.atmo) }, uAtmoK: { value: P.atmoK } }, vertexShader: planetVertex, fragmentShader: haloFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false });
    mats.push(hm);
    halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.025, segments, Math.round(segments / 2)), hm);
    group.add(halo);
  }
  return {
    group,
    globe,
    clouds,
    halo,
    r,
    spin(dt) {
      globe.rotation.y += dt * 0.01;
      if (clouds) clouds.rotation.y += dt * 0.013;
    },
    dispose() {
      sphere.dispose();
      clouds?.geometry.dispose();
      halo?.geometry.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// ---------- The sky's hook ----------

// Installed on the game's sky (sky.post): reads `state` (js/space.js keeps
// it: altK, the rocket's climb) and the world's dimension.
export class SpaceSky {
  constructor(game) {
    this.game = game;
    this.sky = game.sky;
    this.world = game.world;
    this.altK = 0; // 0 on the ground .. 1 up in the black (the climb, the Overworld)
    this.sky.post = (sky, e, dt) => this._post(sky, e, dt);
    this._earth = null; // the Earth in the Moon's sky
    this._moons = null; // Mars' Phobos and Deimos
    this._sun = new THREE.Vector3().copy(MOON_SUN);
    this.time = 0;
  }

  _post(sky, e, dt) {
    this.time += dt;
    const dim = this.world.dim;
    const u = worldUniforms;
    const m = sky.material.uniforms;
    if (dim === "moon") this._moon(sky, u, m);
    else if (dim === "mars") this._mars(sky, u, m, e);
    else if (dim === "overworld" && this.altK > 0.001) this._climb(sky, u, m, this.altK);
    this._sky3d(dim);
  }

  _moon(sky, u, m) {
    u.uSunDir.value.copy(MOON_SUN);
    u.uMoonDir.value.set(0, -1, 0); // (no moon in the Moon's sky: the Earth is drawn instead)
    u.uLightDir.value.copy(MOON_SUN);
    u.uLightColor.value.setRGB(1.55, 1.5, 1.42);
    u.uSkyZenith.value.setRGB(0, 0, 0.0008);
    u.uSkyHorizon.value.setRGB(0.002, 0.002, 0.003);
    u.uSkyGlow.value.setRGB(0, 0, 0);
    u.uSunGlowColor.value.setRGB(1.6, 1.55, 1.45);
    u.uAmbientSky.value.setRGB(0.07, 0.075, 0.085);
    u.uAmbientGround.value.setRGB(0.09, 0.09, 0.09); // (the bright ground lights the shadows a little)
    u.uNight.value = 1;
    m.uStarAngle.value = 0.6;
    m.uCloudCoverage.value = 0;
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    sky.exposure = 1;
  }

  // Mars by the Overworld's clock: e is the sun's height.
  _mars(sky, u, m, e) {
    const day = smooth(-0.12, 0.18, e);
    const dusk = Math.exp(-((e / 0.14) ** 2));
    const k = 0.25 + 0.75 * day;
    u.uSkyZenith.value.setRGB(0.36 * day + 0.006, 0.22 * day + 0.004, 0.13 * day + 0.01);
    u.uSkyHorizon.value.setRGB(0.72 * k * day + 0.012 + dusk * 0.05, 0.46 * k * day + 0.008 + dusk * 0.06, 0.3 * k * day + 0.012 + dusk * 0.1);
    // (the sunset blue round the sun: Mars' dust scatters blue forward)
    u.uSkyGlow.value.setRGB(0.12 * dusk, 0.3 * dusk, 0.75 * dusk);
    u.uSunGlowColor.value.setRGB(1.2 + 0.2 * dusk, 1.15 + 0.4 * dusk, 1.05 + 0.9 * dusk).multiplyScalar(0.8);
    u.uLightColor.value.multiplyScalar(0.85).multiply(_c.setRGB(1.06, 0.9, 0.78));
    u.uAmbientSky.value.setRGB(0.3 * k * day + 0.015, 0.19 * k * day + 0.012, 0.13 * k * day + 0.016);
    u.uAmbientGround.value.setRGB(0.18 * day + 0.008, 0.09 * day + 0.006, 0.05 * day + 0.006);
    u.uNight.value = 1 - day;
    m.uCloudCoverage.value = 0;
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    sky.exposure = THREE.MathUtils.lerp(1.15, 0.95, day);
  }

  // The climb: black overhead, stars, a thin blue band low down; the clouds below.
  _climb(sky, u, m, k) {
    const z = u.uSkyZenith.value;
    z.multiplyScalar(1 - k * 0.995);
    const h = u.uSkyHorizon.value;
    h.lerp(_c.setRGB(0.05, 0.12, 0.32), smooth(0, 0.5, k)).multiplyScalar(1 - 0.7 * smooth(0.5, 1, k));
    u.uSkyGlow.value.multiplyScalar(1 - k);
    u.uNight.value = Math.max(u.uNight.value, smooth(0.25, 0.9, k));
    m.uCloudCoverage.value *= 1 - smooth(0.05, 0.3, k);
    sky.horizonColor.copy(h);
  }

  // The globes in the sky: the Earth over the Moon, Phobos and Deimos over Mars.
  _sky3d(dim) {
    const scene = this.game.scene;
    const cam = this.game.camera;
    if (dim === "moon") {
      if (!this._earth) {
        this._earth = createPlanet("earth", 46, this._sun, { segments: 48 });
        this._earth.group.renderOrder = -1;
        for (const o of [this._earth.globe, this._earth.clouds, this._earth.halo]) if (o) o.renderOrder = -1;
      }
      if (!this._earth.group.parent) scene.add(this._earth.group);
      // (far off along its direction from wherever the eye is: it never comes nearer)
      const d = Math.min(800, (cam.far || 1000) * 0.8);
      this._earth.group.position.copy(cam.position).addScaledVector(EARTH_DIR, d);
      this._earth.group.scale.setScalar(d / 800);
      this._earth.spin(1 / 60);
    } else if (this._earth?.group.parent) scene.remove(this._earth.group);
    if (dim === "mars") {
      if (!this._moons) {
        const mk = (r) => {
          const g = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: 0x8a7a6c, fog: false }));
          g.scale.set(1, 0.8, 0.9);
          return g;
        };
        this._moons = [mk(6), mk(3.2)];
      }
      const e = worldUniforms.uNight.value;
      const d = Math.min(800, (cam.far || 1000) * 0.8);
      const t = this.game.sky.time ?? 0;
      for (let i = 0; i < 2; i++) {
        const mo = this._moons[i];
        if (!mo.parent) scene.add(mo);
        const a = t * (i ? 0.0011 : 0.0042) + i * 2.1;
        mo.position.copy(cam.position).add(new THREE.Vector3(Math.cos(a) * 0.8, 0.35 + Math.sin(a) * 0.3 + i * 0.15, Math.sin(a) * 0.6).normalize().multiplyScalar(d));
        mo.scale.setScalar(d / 800);
        mo.material.color.setRGB(0.25 + 0.3 * e, 0.22 + 0.26 * e, 0.2 + 0.22 * e);
      }
    } else if (this._moons) for (const mo of this._moons) if (mo.parent) scene.remove(mo);
  }
}
