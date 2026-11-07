// Space's skies (Round 15; Round 16: the planets below, the solar system's
// looks): the Moon's and Mars' skies, the climb into the black, and the
// planets themselves (js/solar-render.js draws them in space).
//
// - The sky's hook (sky.js `post`, after the day's colours are worked out):
//     the Moon: a black sky full of stars, the sun fixed low in it (long,
//       hard shadows; little light in them: no air to scatter it), the
//       Earth hanging in the sky (a lit globe: its night side dark);
//     Mars: the day's sun (the Overworld's clock) over a butterscotch sky,
//       the sunset blue round the sun, the night dark and starry, a dusty
//       haze; its two little moons; (Round 16) darkening to black high up;
//     the climb (the Overworld): (Round 16) the sky only darkens well above
//       where the planes fly (js/solar-data.js SKY_DARK: from 2,200 blocks
//       up, black by 5,400), black and stars overhead, a thin blue band at
//       the horizon, the clouds left below.
// - (Round 16) The planet below: high over the Overworld, the Moon or Mars
//   the ground's own chunks are out of sight long before the space line, so
//   the planet itself is drawn under the view (the same globe the solar
//   system shows, turned so the spot under the eye is the one in the world:
//   js/solar-data.js worldToLatLon). It sits at the far plane, behind
//   everything the world draws, and fades in with the height. At the space
//   line it is the very picture the solar system's scene opens on.
// - The planets' textures (canvases, made once when first needed, painted a
//   few rows a frame), and their material: the sun lights the day side, the
//   night side is dark (the Earth's has its cities' lights), an atmosphere
//   glows at the rim; (Round 16) fine detail close up (noise on the globe),
//   the gas giants' bands, Saturn's rings, the Sun's own glowing surface.
import * as THREE from "three";
import { worldUniforms } from "./shaders.js";
import { BODIES, BODY_OF_DIM, BASE_Y, skyDark, worldToLatLon, surfaceFrame } from "./solar-data.js";

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const MOON_SUN = new THREE.Vector3(0.62, 0.36, -0.42).normalize(); // (low over the Moon: long shadows)
const MERCURY_SUN = new THREE.Vector3(-0.55, 0.6, -0.5).normalize(); // (Round 17: high in Mercury's black sky)
const VENUS_SUN = new THREE.Vector3(0.25, 0.92, 0.3).normalize(); // (overhead, behind the clouds)
const EARTH_DIR = new THREE.Vector3(-0.62, 0.52, 0.42).normalize(); // (across the sky from the sun: its day side toward the Moon, gibbous) // (where the Earth hangs in the Moon's sky)
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

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

// A gas giant's bands: colours by latitude, stirred by noise; storms.
function bands(x, y, z, lat, cols, seed, spot = null) {
  const turb = (fbm3(x * 3 + seed, y * 3, z * 3, 4, seed) - 0.5) * 0.5;
  const b = Math.sin(lat * 11 + turb * 3 + Math.sin(lat * 3.7) * 0.8);
  const k = (b + 1) / 2;
  let c = mix(cols[0], cols[1], smooth(0.2, 0.8, k));
  c = mix(c, cols[2], smooth(0.75, 1, Math.abs(Math.sin(lat * 23 + turb * 6))) * 0.35);
  if (spot) {
    const dl = (lat - spot[0]) / 0.09;
    const dlon = Math.atan2(z, x) - spot[1];
    const dd = dl * dl + ((Math.atan2(Math.sin(dlon), Math.cos(dlon)) / 0.2) ** 2);
    if (dd < 1) c = mix(c, spot[2], (1 - dd) * 0.85);
  }
  const f = 0.92 + fbm3(x * 20, y * 40, z * 20, 2, seed + 5) * 0.16;
  return c.map((v) => v * f);
}

// The planets' surface textures (and the Earth's clouds and night lights), made once.
export function planetTexture(name) {
  if (TEX[name]) return TEX[name];
  const W = name === "earth" || name === "moon" || name === "mars" ? 1024 : name === "saturnRing" ? 512 : 512;
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
  } else if (name === "moon" || name === "mercury") {
    const tint = name === "mercury" ? [1.08, 0.98, 0.88] : [1, 1, 1.01];
    const s = name === "mercury" ? 300 : 0;
    t = paintSphere(W, H, (x, y, z) => {
      const m = smooth(0.48, 0.56, fbm3(x * 1.6 + 5, y * 1.6, z * 1.6, 4, 21 + s));
      let v = 150 + (fbm3(x * 9, y * 9, z * 9, 3, 23 + s) - 0.5) * 50 - m * 70;
      // craters: bright rims, dark floors
      const c = fbm3(x * 14, y * 14, z * 14, 2, 29 + s);
      if (c > 0.62) v += (c - 0.62) * 260;
      else if (c < 0.36) v -= (0.36 - c) * 90;
      return [v * tint[0], v * tint[1], v * tint[2]];
    });
  } else if (name === "mars") {
    t = paintSphere(W, H, (x, y, z, lat) => {
      if (Math.abs(lat) > 1.36 + (fbm3(x * 9, y * 9, z * 9, 3, 7) - 0.5) * 0.16) return [236, 222, 210];
      const n = fbm3(x * 2 + 1, y * 2, z * 2, 5, 31);
      const dark = smooth(0.48, 0.6, n);
      let c = mix([196, 104, 58], [104, 52, 34], dark * 0.8);
      // the great canyon: a dark scar along the equator
      const scar = Math.abs(y - 0.05 * Math.sin(x * 5)) < 0.03 && x > 0.1 ? 1 : 0;
      c = mix(c, [80, 38, 26], scar * 0.7);
      return c.map((v) => v * (0.9 + fbm3(x * 12, y * 12, z * 12, 2, 37) * 0.2));
    });
  } else if (name === "venus") {
    t = paintSphere(W, H, (x, y, z, lat) => {
      const sw = fbm3(x * 2 + Math.sin(lat * 4) * 0.6, y * 5, z * 2, 5, 61);
      return mix([214, 178, 112], [246, 226, 178], smooth(0.3, 0.75, sw));
    });
  } else if (name === "jupiter") {
    t = paintSphere(W, H, (x, y, z, lat) => bands(x, y, z, lat, [[196, 160, 122], [238, 222, 196], [150, 96, 70]], 81, [-0.38, 1.2, [196, 90, 60]]));
  } else if (name === "saturn") {
    t = paintSphere(W, H, (x, y, z, lat) => bands(x, y, z, lat * 0.8, [[214, 190, 140], [240, 226, 186], [180, 150, 100]], 93));
  } else if (name === "saturnRing") {
    // (a strip: the rings from the inner edge (left) out, their gaps)
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 4;
    const g = c.getContext("2d");
    for (let i = 0; i < 512; i++) {
      const u = i / 511;
      let a = 0.25 + 0.6 * smooth(0.0, 0.1, u) * (0.6 + 0.4 * Math.sin(u * 140) * Math.sin(u * 37));
      if (u > 0.58 && u < 0.64) a *= 0.12; // (the Cassini division)
      if (u > 0.9) a *= 1 - smooth(0.9, 1, u);
      const v = 200 + 40 * Math.sin(u * 60);
      g.fillStyle = `rgba(${v},${v * 0.92},${v * 0.78},${Math.max(0, Math.min(1, a))})`;
      g.fillRect(i, 0, 1, 4);
    }
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
  }
  TEX[name] = t;
  return t;
}

// ---------- The planets' material ----------

const NOISE_GLSL = `
float sh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sn3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), f.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), f.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

const planetVertex = `
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec2 vUv;
void main() {
  vUv = uv;
  vO = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #ifdef PIN_FAR
  // (Round 16: behind everything the world draws; the sky's dome after it is hidden)
  gl_Position.z = gl_Position.w * 0.99999;
  #endif
}`;
const planetFragment = `
uniform sampler2D uMap;
uniform sampler2D uNight;
uniform float uHasNight;
uniform vec3 uSun;
uniform vec3 uAtmo;
uniform float uAtmoK;
uniform float uBright;
uniform float uDetail;
uniform float uRadius;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = dot(n, normalize(uSun));
  float day = smoothstep(-0.08, 0.25, d);
  vec3 tex = texture2D(uMap, vUv).rgb;
  if (uDetail > 0.001) {
    // (close up: mottling at a few scales, a kilometre down to a hundred metres)
    vec3 p = vO * uRadius;
    float k = sn3(p / 2400.0) * 0.5 + sn3(p / 700.0) * 0.3 + sn3(p / 190.0) * 0.2;
    tex *= mix(1.0, 0.72 + 0.56 * k, uDetail);
  }
  vec3 col = tex * (0.015 + max(d, 0.0) * 1.35) * uBright;
  if (uHasNight > 0.5) col += texture2D(uNight, vUv).rgb * (1.0 - day) * 0.9;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 7.0);
  col = mix(col, uAtmo * 0.55 * max(d, 0.0), rim * uAtmoK * 0.55);
  col += uAtmo * rim * uAtmoK * smoothstep(-0.25, 0.45, d) * 0.5;
  col += uAtmo * uAtmoK * 0.03 * day;
  gl_FragColor = vec4(col, uOpacity);
}`;
// The atmosphere's halo: a shell a little bigger than the planet, glowing at its rim, lit by the sun.
const haloFragment = `
uniform vec3 uSun;
uniform vec3 uAtmo;
uniform float uAtmoK;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float f = 1.0 - abs(dot(n, v));
  float a = pow(f, 3.0) * uAtmoK * smoothstep(-0.35, 0.4, dot(n, normalize(uSun))) * uOpacity;
  gl_FragColor = vec4(uAtmo * a * 1.6, a);
}`;
const cloudFragment = `
uniform sampler2D uMap;
uniform vec3 uSun;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, normalize(uSun));
  float a = texture2D(uMap, vUv).a;
  vec3 col = vec3(1.0) * (0.02 + max(d, 0.0) * 1.1);
  gl_FragColor = vec4(col, (a * smoothstep(-0.3, 0.1, d) * 0.95 + a * 0.05) * uOpacity);
}`;
// (Round 16) The Sun: a glowing globe, its surface boiling, darker to the limb.
const sunFragment = `
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float mu = max(dot(n, v), 0.0);
  float g = sn3(vO * 60.0 + vec3(uTime * 0.05)) * 0.6 + sn3(vO * 180.0 - vec3(uTime * 0.08)) * 0.4;
  vec3 hot = vec3(5.2, 4.4, 3.2);
  vec3 col = hot * (0.55 + 0.45 * pow(mu, 0.45)) * (0.85 + 0.3 * g);
  col = mix(vec3(4.0, 2.2, 0.9), col, smoothstep(0.0, 0.35, mu));
  gl_FragColor = vec4(col, 1.0);
}`;
// (Round 16) Saturn's rings: a flat annulus, its texture by the distance from the middle.
const ringVertex = `
varying vec3 vL;
varying vec3 vW;
void main() {
  vL = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ringFragment = `
uniform sampler2D uMap;
uniform vec2 uRange;
uniform vec3 uSun;
uniform vec3 uCenter;
uniform float uR;
varying vec3 vL;
varying vec3 vW;
void main() {
  float r = length(vL.xz);
  float u = (r - uRange.x) / (uRange.y - uRange.x);
  if (u < 0.0 || u > 1.0) discard;
  vec4 t = texture2D(uMap, vec2(u, 0.5));
  // (the planet's shadow across the rings: the far side from the sun)
  vec3 rel = vW - uCenter;
  vec3 s = normalize(uSun);
  float along = dot(rel, s);
  float off = length(rel - s * along);
  float shade = (along < 0.0 && off < uR) ? 0.12 : 1.0;
  gl_FragColor = vec4(t.rgb * (0.25 + 0.85 * shade), t.a * 0.9);
}`;

// Each body's look: its texture, an atmosphere (colour, strength), clouds and night lights (the Earth).
export const PLANETS = {
  earth: { tex: "earth", atmo: [0.35, 0.6, 1.2], atmoK: 1, clouds: true, night: true },
  moon: { tex: "moon", atmo: [0, 0, 0], atmoK: 0 },
  mars: { tex: "mars", atmo: [1.0, 0.55, 0.35], atmoK: 0.45 },
  mercury: { tex: "mercury", atmo: [0, 0, 0], atmoK: 0 },
  venus: { tex: "venus", atmo: [1.0, 0.85, 0.55], atmoK: 0.7 },
  jupiter: { tex: "jupiter", atmo: [0.9, 0.8, 0.65], atmoK: 0.35 },
  saturn: { tex: "saturn", atmo: [0.9, 0.85, 0.6], atmoK: 0.3, rings: true },
};
// The textures a trip into space wants ready.
export const SPACE_TEXTURES = ["earth", "earthClouds", "earthNight", "moon", "mars", "mercury", "venus", "jupiter", "saturn", "saturnRing"];

// A planet: a group with its globe (radius r), clouds and halo. sun: a
// direction (world) the material reads (shared: change it in place).
// opts: segments; pinFar (Round 16: drawn at the far plane, see above);
// detail (the close-up mottling's strength, a uniform to change later).
export function createPlanet(kind, r, sun, { segments = 64, pinFar = false, detail = 0 } = {}) {
  const P = PLANETS[kind];
  const group = new THREE.Group();
  const mats = [];
  const defines = pinFar ? { PIN_FAR: "" } : {};
  const extra = pinFar ? { transparent: true, depthWrite: false } : {};
  const sphere = new THREE.SphereGeometry(r, segments, Math.round(segments / 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: planetTexture(P.tex) }, uNight: { value: P.night ? planetTexture("earthNight") : null }, uHasNight: { value: P.night ? 1 : 0 }, uSun: { value: sun }, uAtmo: { value: new THREE.Color(...P.atmo) }, uAtmoK: { value: P.atmoK }, uBright: { value: 1 }, uDetail: { value: detail }, uRadius: { value: r }, uOpacity: { value: 1 } },
    vertexShader: planetVertex,
    fragmentShader: planetFragment,
    defines,
    fog: false,
    ...extra,
  });
  mats.push(mat);
  const globe = new THREE.Mesh(sphere, mat);
  group.add(globe);
  let clouds = null;
  if (P.clouds) {
    const cm = new THREE.ShaderMaterial({ uniforms: { uMap: { value: planetTexture("earthClouds") }, uSun: { value: sun }, uOpacity: { value: 1 } }, vertexShader: planetVertex, fragmentShader: cloudFragment, defines, transparent: true, depthWrite: false, fog: false });
    mats.push(cm);
    clouds = new THREE.Mesh(new THREE.SphereGeometry(r * 1.012, segments, Math.round(segments / 2)), cm);
    group.add(clouds);
  }
  let halo = null;
  if (P.atmoK > 0) {
    const hm = new THREE.ShaderMaterial({ uniforms: { uSun: { value: sun }, uAtmo: { value: new THREE.Color(...P.atmo) }, uAtmoK: { value: P.atmoK }, uOpacity: { value: 1 } }, vertexShader: planetVertex, fragmentShader: haloFragment, defines, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false });
    mats.push(hm);
    halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.025, segments, Math.round(segments / 2)), hm);
    group.add(halo);
  }
  let rings = null;
  if (P.rings) {
    const [r0, r1] = BODIES.saturn.rings;
    const rm = new THREE.ShaderMaterial({ uniforms: { uMap: { value: planetTexture("saturnRing") }, uRange: { value: new THREE.Vector2(r * r0, r * r1) }, uSun: { value: sun }, uCenter: { value: new THREE.Vector3() }, uR: { value: r } }, vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    mats.push(rm);
    rings = new THREE.Mesh(new THREE.RingGeometry(r * r0, r * r1, 96, 1).rotateX(-Math.PI / 2), rm);
    rings.rotation.x = 0.47; // (its tilt)
    group.add(rings);
  }
  return {
    group,
    globe,
    clouds,
    halo,
    rings,
    r,
    mats,
    spin(dt) {
      if (clouds) clouds.rotation.y += dt * 0.003;
    },
    // How far it has faded in (the planet below), 0-1.
    setOpacity(k) {
      for (const m of mats) if (m.uniforms.uOpacity) m.uniforms.uOpacity.value = k;
    },
    setDetail(k) {
      mat.uniforms.uDetail.value = k;
    },
    // (the rings' shadow: where the planet's middle is, in the scene)
    setCenter(v, scale = 1) {
      if (rings) {
        rings.material.uniforms.uCenter.value.copy(v);
        rings.material.uniforms.uR.value = r * scale;
      }
    },
    dispose() {
      sphere.dispose();
      clouds?.geometry.dispose();
      halo?.geometry.dispose();
      rings?.geometry.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// (Round 16) The Sun's globe (radius r).
export function createSunGlobe(r, segments = 64) {
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: planetVertex, fragmentShader: sunFragment, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, segments, Math.round(segments / 2)), mat);
  return mesh;
}

// ---------- The sky's hook ----------

// Installed on the game's sky (sky.post): reads `altK` (js/space.js keeps
// it: how far into the black the eye is) and the world's dimension.
export class SpaceSky {
  constructor(game) {
    this.game = game;
    this.sky = game.sky;
    this.world = game.world;
    this.altK = 0; // 0 on the ground .. 1 up in the black (the climb)
    this.sky.post = (sky, e, dt) => this._post(sky, e, dt);
    this._earth = null; // the Earth in the Moon's sky
    this._moons = null; // Mars' Phobos and Deimos
    this._below = {}; // (Round 16) kind -> the planet under the view, high up
    this._sun = new THREE.Vector3().copy(MOON_SUN);
    this._belowSun = new THREE.Vector3(0, 1, 0);
    this.belowK = 0; // (how far the planet below has faded in: tests)
    this.time = 0;
  }

  _post(sky, e, dt) {
    this.time += dt;
    const dim = this.world.dim;
    const u = worldUniforms;
    const m = sky.material.uniforms;
    if (dim === "moon") this._moon(sky, u, m);
    else if (dim === "mars") this._mars(sky, u, m, e);
    else if (dim === "mercury") this._mercury(sky, u, m); // (Round 17)
    else if (dim === "venus") this._venus(sky, u, m);
    if ((dim === "overworld" || dim === "mars" || dim === "venus") && this.altK > 0.001) this._climb(sky, u, m, this.altK);
    this._sky3d(dim);
    this._bigSun(dim);
    this._planetBelow(dim);
  }

  // (Round 17) Mercury: the black sky, a huge white-hot sun fixed in it
  // (the sprite below, over the sky's own disc and glare), hard light,
  // shadows lit only by the bright ground; no air, no haze.
  _mercury(sky, u, m) {
    u.uSunDir.value.copy(MERCURY_SUN);
    u.uMoonDir.value.set(0, -1, 0);
    u.uLightDir.value.copy(MERCURY_SUN);
    u.uLightColor.value.setRGB(1.85, 1.78, 1.66);
    u.uSkyZenith.value.setRGB(0, 0, 0.0006);
    u.uSkyHorizon.value.setRGB(0.002, 0.0018, 0.0016);
    u.uSkyGlow.value.setRGB(0, 0, 0);
    u.uSunGlowColor.value.setRGB(2.4, 2.25, 2.0);
    u.uAmbientSky.value.setRGB(0.13, 0.125, 0.12);
    u.uAmbientGround.value.setRGB(0.2, 0.18, 0.16);
    u.uNight.value = 1;
    m.uStarAngle.value = 1.7;
    m.uCloudCoverage.value = 0;
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    sky.exposure = 0.88;
    this._fog(sky, 0.96, 0); // (Round 17: crisp to the edge, the globe below beyond it: _planetBelow)
  }

  // (Round 17) Venus: a dim orange sky under the clouds, the sun only a
  // brighter smudge high up, a soft orange light from everywhere, and a
  // thick haze that tints the far land (not a wall: the view stays long).
  _venus(sky, u, m) {
    u.uSunDir.value.copy(VENUS_SUN);
    u.uMoonDir.value.set(0, -1, 0);
    u.uLightDir.value.copy(VENUS_SUN);
    u.uLightColor.value.setRGB(0.62, 0.42, 0.2);
    u.uSkyZenith.value.setRGB(0.2, 0.11, 0.04);
    u.uSkyHorizon.value.setRGB(0.6, 0.39, 0.16);
    u.uSkyGlow.value.setRGB(0.1, 0.05, 0.015);
    u.uSunGlowColor.value.setRGB(0.05, 0.035, 0.015);
    u.uAmbientSky.value.setRGB(0.36, 0.23, 0.1);
    u.uAmbientGround.value.setRGB(0.2, 0.11, 0.05);
    u.uNight.value = 0;
    m.uCloudCoverage.value = 0;
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    sky.exposure = 1.1;
    this._fog(sky, 0.5, this._haze(this.world.dimInfo?.haze ?? 0.0026, 5));
  }

  // (Round 17) The haze's density for the eye's height: the world's haze
  // (shaders.js) thins above the ground, so high up it is thickened to keep
  // a planet's air as thick from a UFO as from the ground (at most `most` times).
  _haze(base, most) {
    const y = this.game.camera?.position.y ?? 75;
    return base * Math.max(1, Math.min(most, (y - 24) / 51));
  }

  // (Round 17) Mercury's sun: two and a half times the Earth's across, and
  // its glare (a sprite far off along the sun's direction, as the Earth
  // over the Moon); bloom makes it blaze.
  _bigSun(dim) {
    const scene = this.game.scene;
    const cam = this.game.camera;
    if (dim !== "mercury") {
      if (this._sunSprite?.parent) this._sunSprite.parent.remove(this._sunSprite);
      return;
    }
    if (!this._sunSprite) {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, "rgba(255,255,250,1)");
      grad.addColorStop(0.16, "rgba(255,252,240,1)");
      grad.addColorStop(0.19, "rgba(255,236,200,0.55)");
      grad.addColorStop(0.32, "rgba(255,214,160,0.2)");
      grad.addColorStop(0.6, "rgba(255,200,140,0.05)");
      grad.addColorStop(1, "rgba(255,190,130,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(3.2, 3.0, 2.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      this._sunSprite.renderOrder = -1;
    }
    const s = this._sunSprite;
    if (!s.parent) scene.add(s);
    const d = Math.min(900, (cam.far || 1000) * 0.8);
    s.position.copy(cam.position).addScaledVector(MERCURY_SUN, d);
    s.scale.setScalar(d * 0.5);
  }

  _moon(sky, u, m) {
    u.uSunDir.value.copy(MOON_SUN);
    u.uMoonDir.value.set(0, -1, 0); // (no moon in the Moon's sky: the Earth is drawn instead)
    u.uLightDir.value.copy(MOON_SUN);
    u.uLightColor.value.setRGB(1.45, 1.41, 1.34);
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
    // (no air: no haze, the ground sharp out to the edge of the view)
    this._fog(sky, 0.96, 0);
  }

  // The fog's start (a share of its end) and haze, from the view's (sky.js keeps the base).
  _fog(sky, start, haze) {
    const fog = worldUniforms.uFog.value;
    const b = sky._fogBase;
    if (!b) return;
    const cap = Number.isFinite(sky.dimView) ? (sky.dimView - 0.3) * 16 : Infinity;
    const end = Math.min(b.y, cap);
    fog.set(end * start, end, haze, b.w);
    sky._fogSet?.copy(fog);
  }

  // Mars by the Overworld's clock: e is the sun's height.
  _mars(sky, u, m, e) {
    const day = smooth(-0.12, 0.18, e);
    const dusk = Math.exp(-((e / 0.14) ** 2));
    const k = 0.25 + 0.75 * day;
    u.uSkyZenith.value.setRGB(0.36 * day + 0.006, 0.22 * day + 0.004, 0.13 * day + 0.01);
    u.uSkyHorizon.value.setRGB(0.72 * k * day + 0.012 + dusk * 0.05, 0.46 * k * day + 0.008 + dusk * 0.06, 0.3 * k * day + 0.012 + dusk * 0.1);
    // (the sunset blue round the sun: Mars' dust scatters blue forward)
    u.uSkyGlow.value.setRGB(0.08 * dusk, 0.2 * dusk, 0.5 * dusk);
    u.uSunGlowColor.value.setRGB(1.2 - 0.5 * dusk, 1.15 - 0.3 * dusk, 1.05 + 0.2 * dusk).multiplyScalar(0.8);
    u.uLightColor.value.multiply(_c.setRGB(1.04, 0.92, 0.8));
    u.uAmbientSky.value.setRGB(0.2 * k * day + 0.015, 0.13 * k * day + 0.012, 0.1 * k * day + 0.016);
    u.uAmbientGround.value.setRGB(0.12 * day + 0.008, 0.06 * day + 0.006, 0.035 * day + 0.006);
    u.uNight.value = 1 - day;
    m.uCloudCoverage.value = 0;
    sky.sunLight.color.copy(u.uLightColor.value);
    sky.hemiLight.color.copy(u.uAmbientSky.value);
    sky.hemiLight.groundColor.copy(u.uAmbientGround.value);
    sky.horizonColor.copy(u.uSkyHorizon.value);
    sky.exposure = THREE.MathUtils.lerp(1.15, 0.95, day);
    // (a dusty haze; Round 17: as thick seen from high up, the far view long but hazy)
    this._fog(sky, 0.65, this._haze(this.world.dimInfo?.haze ?? 0.0011, 2));
  }

  // The climb: black overhead, stars, a thin blue band low down; the clouds below.
  _climb(sky, u, m, k) {
    const z = u.uSkyZenith.value;
    z.multiplyScalar(1 - k * 0.995);
    const h = u.uSkyHorizon.value;
    h.lerp(this.world.dim === "mars" ? _c.setRGB(0.22, 0.12, 0.08) : this.world.dim === "venus" ? _c.setRGB(0.3, 0.18, 0.06) : _c.setRGB(0.05, 0.12, 0.32), smooth(0, 0.5, k)).multiplyScalar(1 - 0.7 * smooth(0.5, 1, k));
    u.uSkyGlow.value.multiplyScalar(1 - k);
    u.uNight.value = Math.max(u.uNight.value, smooth(0.25, 0.9, k));
    m.uCloudCoverage.value *= 1 - smooth(0.05, 0.3, k);
    sky.horizonColor.copy(h);
  }

  // (Round 16) The planet under the view, high up: fading in as the world's
  // own ground falls out of sight (the far plane, the fog), turned so the
  // spot below the eye is this spot of the world.
  _planetBelow(dim) {
    const body = BODY_OF_DIM[dim];
    const cam = this.game.camera;
    const alt = cam ? cam.position.y - BASE_Y : 0;
    const B = body && BODIES[body];
    // (Round 17: over an airless world from a little way up: the far land ends crisp, and the globe goes on beyond it to the curved horizon)
    const airless = !!this.world.dimInfo?.airless && dim !== "overworld";
    const k = B ? (airless ? smooth(90, 600, alt) : smooth(Math.max(500, B.line * 0.25), B.line * 0.6, alt)) : 0;
    this.belowK = k;
    for (const [kind, p] of Object.entries(this._below)) {
      if (kind !== body || k <= 0.002) {
        if (p.group.parent) p.group.parent.remove(p.group);
      }
    }
    if (!B || k <= 0.002) return;
    let p = this._below[body];
    if (!p) {
      p = this._below[body] = createPlanet(body, 1, this._belowSun, { segments: 96, pinFar: true, detail: 0.6 });
      p.mats[0].uniforms.uRadius.value = B.r;
      // (first of the see-through things, the globe, its clouds, its glow in turn)
      [p.globe, p.clouds, p.halo].forEach((o, i) => o && (o.renderOrder = -1e6 + i));
      p.group.frustumCulled = false;
      for (const o of [p.globe, p.clouds, p.halo]) if (o) o.frustumCulled = false;
    }
    if (!p.group.parent) this.game.scene.add(p.group);
    // (any size: it is drawn at the far plane; this one keeps it well inside the view's depth)
    const d = B.r + Math.max(0, alt);
    const s = Math.min(cam.far * 0.4, 900) / d;
    p.group.scale.setScalar(B.r * s);
    p.group.position.set(cam.position.x, cam.position.y - d * s, cam.position.z);
    // (the globe's own frame turned so the spot under the eye is at its top, its east along +x)
    const { lat, lon } = worldToLatLon(body, cam.position.x, cam.position.z);
    const f = surfaceFrame(lat, lon);
    _a.set(f.east[0], f.up[0], f.south[0]);
    _b.set(f.east[1], f.up[1], f.south[1]);
    _d.set(f.east[2], f.up[2], f.south[2]);
    _m.makeBasis(_a, _b, _d);
    p.group.quaternion.setFromRotationMatrix(_m);
    this._belowSun.copy(worldUniforms.uSunDir.value);
    p.setOpacity(k);
    p.setDetail(0.6);
  }

  // The globes in the sky: the Earth over the Moon, Phobos and Deimos over Mars.
  _sky3d(dim) {
    const scene = this.game.scene;
    const cam = this.game.camera;
    if (dim === "moon") {
      if (!this._earth) {
        this._earth = createPlanet("earth", 64, this._sun, { segments: 48 });
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

// How dark the sky is for an eye at world height y in `dim` (js/space.js).
export { skyDark };
