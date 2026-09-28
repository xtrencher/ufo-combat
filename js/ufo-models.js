// Procedural UFO models: ten distinct designs, each built from a few meshes
// so a sky full of them stays cheap. A model is modelled at a radius of 1
// and scaled to its size (a small scout is a few blocks across, a
// mothership dozens). Every model has:
//   - a lit hull (shared per design; lit like every other entity),
//   - its lights as ONE instanced mesh (blinking / chasing / color-cycling
//     patterns are written into the instance colors each frame),
//   - optional glowing parts (a dome, an underside glow, a glowing orb),
//   - a soft halo sprite that makes it read as a light in the sky at
//     night and far away,
//   - a cheap "far" version (the hull and halo only).
// The same model is used for enemy UFOs, crashed wrecks and the player's
// own UFO, so a crashed UFO keeps its shape when boarded and flown.
import * as THREE from "three";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";

export const UFO_DESIGNS = ["saucer", "saucer_dark", "tictac", "sphere", "pyramid", "triangle", "cigar", "ring", "diamond", "cubesphere"];

export const UFO_DESIGN_NAMES = {
  saucer: "Glowing saucer",
  saucer_dark: "Dark saucer",
  tictac: "Tic-tac",
  sphere: "Orb",
  pyramid: "Pyramid",
  triangle: "Black triangle",
  cigar: "Cigar",
  ring: "Ring",
  diamond: "Diamond",
  cubesphere: "Cube in a sphere",
};

// How each design sits in space: `h` is its height and `bottom` how far its
// underside hangs below its center (radius-1 units); halo color (linear).
const DESIGN_INFO = {
  saucer: { h: 0.55, bottom: 0.28, halo: [0.4, 1.4, 1.2] },
  saucer_dark: { h: 0.55, bottom: 0.28, halo: [0.9, 0.2, 0.15] },
  tictac: { h: 0.56, bottom: 0.28, halo: [1.2, 1.2, 1.25] },
  sphere: { h: 1.2, bottom: 0.6, halo: [1.6, 0.9, 0.25] },
  pyramid: { h: 1.1, bottom: 0.1, halo: [0.3, 1.4, 0.4] },
  triangle: { h: 0.2, bottom: 0.12, halo: [1.2, 0.25, 0.2] },
  cigar: { h: 0.46, bottom: 0.23, halo: [1.4, 1.1, 0.4] },
  ring: { h: 0.3, bottom: 0.15, halo: [0.9, 0.3, 1.4] },
  diamond: { h: 1.6, bottom: 0.8, halo: [0.8, 0.4, 1.6] },
  cubesphere: { h: 1.6, bottom: 0.8, halo: [0.5, 0.8, 1.6] },
};

export function designInfo(design) {
  return DESIGN_INFO[design] || DESIGN_INFO.saucer;
}

// ---------- Geometry helpers ----------

function colorize(geo, color, shadeFn = null) {
  const c = new THREE.Color(color);
  c.convertSRGBToLinear();
  const pos = geo.getAttribute("position");
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = shadeFn ? shadeFn(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
    arr[i * 3] = c.r * s;
    arr[i * 3 + 1] = c.g * s;
    arr[i * 3 + 2] = c.b * s;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Merges non-indexed copies of geometries with position/normal/color.
function merge(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const c = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3);
    nor.set(g.getAttribute("normal").array, o * 3);
    col.set(g.getAttribute("color").array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  out.computeBoundingSphere();
  return out;
}

function lathe(points, segments = 36) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

// Panel lines: slightly darker bands on a hull, by angle around Y.
function panels(count, dark = 0.82) {
  return (x, y, z) => {
    const a = Math.atan2(z, x);
    const band = Math.abs(Math.sin(a * count * 0.5));
    return band < 0.06 ? dark : 1;
  };
}

// ---------- Hull designs (radius 1) ----------
// Each returns { hull: BufferGeometry, glow: [{ geometry, color, pulse }],
// lights: [{ pos: [x,y,z], size, color: [r,g,b] (linear, HDR), group }],
// pattern } where pattern names how the lights animate.

function saucer(glowing) {
  const metal = glowing ? 0xb9c6d4 : 0x4a525c;
  const under = glowing ? 0x6f7f92 : 0x2a3038;
  const lower = colorize(lathe([[0, -0.28], [0.3, -0.27], [0.62, -0.19], [0.9, -0.07], [1.0, -0.01], [1.0, 0.01]]), under, panels(12, 0.86));
  const upper = colorize(lathe([[1.0, 0.01], [0.92, 0.06], [0.7, 0.13], [0.45, 0.19], [0.3, 0.2], [0, 0.2]]), metal, panels(16, 0.8));
  const rimBand = colorize(new THREE.CylinderGeometry(1.005, 1.005, 0.035, 36, 1, true), glowing ? 0x8aa0b4 : 0x3a4048);
  const parts = [lower, upper, rimBand];
  const glow = [];
  if (glowing) {
    glow.push({ geometry: new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.19, 0), color: [0.35, 1.5, 1.2], pulse: 0.15 });
    glow.push({ geometry: new THREE.CircleGeometry(0.42, 28).rotateX(Math.PI / 2).translate(0, -0.285, 0), color: [0.5, 2.6, 2.4], pulse: 0.35 });
  } else {
    parts.push(colorize(new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.19, 0), 0x1a2430));
  }
  const lights = [];
  const n = glowing ? 14 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lights.push({ pos: [Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0], size: glowing ? 0.055 : 0.05, color: glowing ? null : [3, 0.3, 0.2] });
  }
  return { hull: merge(parts), glow, lights, pattern: glowing ? "chase-cycle" : "blink-red" };
}

function tictac() {
  const body = colorize(new THREE.CapsuleGeometry(0.28, 1.44, 8, 20).rotateZ(Math.PI / 2), 0xf2f4f6, (x, y) => 0.92 + y * 0.25);
  return {
    hull: merge([body]),
    glow: [],
    lights: [{ pos: [0, -0.2, 0], size: 0.12, color: [1.2, 1.2, 1.3] }],
    pattern: "breathe",
  };
}

function orb() {
  return {
    hull: merge([colorize(new THREE.SphereGeometry(0.2, 12, 8), 0x333333)]),
    glow: [
      { geometry: new THREE.SphereGeometry(0.6, 28, 18), color: [1.8, 0.95, 0.3], pulse: 0.3, cycle: true },
      { geometry: new THREE.TorusGeometry(0.75, 0.018, 6, 48).rotateX(Math.PI / 2), color: [2.2, 1.6, 0.6], pulse: 0.5, cycle: true },
    ],
    lights: [],
    pattern: "none",
  };
}

function pyramid() {
  const body = colorize(new THREE.ConeGeometry(0.95, 1.1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.45, 0), 0x2a2a31, (x, y) => 0.8 + y * 0.35);
  const base = colorize(new THREE.BoxGeometry(1.34, 0.1, 1.34).translate(0, -0.05, 0), 0x1c1c22);
  const lights = [];
  for (const [x, z] of [[0.67, 0.67], [-0.67, 0.67], [0.67, -0.67], [-0.67, -0.67]]) lights.push({ pos: [x, -0.08, z], size: 0.09, color: [3, 3, 2.6] });
  lights.push({ pos: [0, 1.0, 0], size: 0.08, color: [0.4, 3, 0.6] });
  return {
    hull: merge([body, base]),
    glow: [{ geometry: new THREE.PlaneGeometry(0.9, 0.9).rotateX(Math.PI / 2).translate(0, -0.105, 0), color: [0.3, 1.8, 0.5], pulse: 0.4 }],
    lights,
    pattern: "corners",
  };
}

function triangle() {
  const shape = new THREE.Shape();
  const r = 1.0;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const body = colorize(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, -0.06, 0), 0x16171b);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    lights.push({ pos: [Math.cos(a) * 0.86, -0.1, -Math.sin(a) * 0.86], size: 0.1, color: [3, 2.9, 2.6] });
  }
  lights.push({ pos: [0, -0.12, 0], size: 0.14, color: [3.2, 0.25, 0.15] });
  return { hull: merge([body]), glow: [], lights, pattern: "triangle" };
}

function cigar() {
  const body = colorize(new THREE.CapsuleGeometry(0.23, 1.5, 8, 20).rotateZ(Math.PI / 2), 0x8d9299, (x, y) => (Math.abs(y) < 0.02 ? 0.7 : 0.9 + y * 0.3));
  const fin = colorize(new THREE.BoxGeometry(0.28, 0.02, 0.16).translate(-0.9, 0.1, 0), 0x5a5f66);
  const lights = [];
  for (let i = 0; i < 9; i++) {
    const x = -0.72 + (i / 8) * 1.44;
    lights.push({ pos: [x, 0.02, 0.228], size: 0.035, color: [3, 2.2, 0.8] });
    lights.push({ pos: [x, 0.02, -0.228], size: 0.035, color: [3, 2.2, 0.8] });
  }
  return { hull: merge([body, fin]), glow: [], lights, pattern: "windows" };
}

function ring() {
  const torus = colorize(new THREE.TorusGeometry(0.82, 0.13, 12, 48).rotateX(Math.PI / 2), 0x6e6a78, (x, y) => 0.85 + y * 0.8);
  const spokes = [];
  for (let i = 0; i < 3; i++) spokes.push(colorize(new THREE.BoxGeometry(1.6, 0.04, 0.06).rotateY((i / 3) * Math.PI), 0x4a4652));
  const lights = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    lights.push({ pos: [Math.cos(a) * 0.82, -0.12, Math.sin(a) * 0.82], size: 0.045, color: null });
  }
  return {
    hull: merge([torus, ...spokes]),
    glow: [{ geometry: new THREE.SphereGeometry(0.24, 20, 12), color: [1.6, 0.5, 2.2], pulse: 0.5, cycle: true }],
    lights,
    pattern: "chase-cycle",
  };
}

function diamond() {
  const body = colorize(new THREE.OctahedronGeometry(0.8, 0).scale(1, 1.0, 1), 0x6a4f8c, (x, y) => 0.7 + Math.abs(y) * 0.5);
  return {
    hull: merge([body]),
    glow: [{ geometry: new THREE.OctahedronGeometry(0.34, 0).scale(1, 1.6, 1), color: [1.4, 0.6, 2.6], pulse: 0.4, cycle: true }],
    lights: [
      { pos: [0, 0.82, 0], size: 0.06, color: [2.8, 2.6, 3] },
      { pos: [0, -0.82, 0], size: 0.06, color: [2.8, 2.6, 3] },
      { pos: [0.8, 0, 0], size: 0.05, color: null },
      { pos: [-0.8, 0, 0], size: 0.05, color: null },
      { pos: [0, 0, 0.8], size: 0.05, color: null },
      { pos: [0, 0, -0.8], size: 0.05, color: null },
    ],
    pattern: "cycle",
  };
}

function cubesphere() {
  const cube = colorize(new THREE.BoxGeometry(0.62, 0.62, 0.62).rotateX(0.6).rotateZ(0.6), 0x101014);
  return {
    hull: merge([cube]),
    glow: [{ geometry: new THREE.SphereGeometry(0.8, 28, 18), color: [0.12, 0.25, 0.5], pulse: 0.3, shell: true }],
    lights: [{ pos: [0, 0, 0], size: 0.02, color: [0.2, 0.3, 0.6] }],
    pattern: "breathe",
  };
}

const BUILDERS = {
  saucer: () => saucer(true),
  saucer_dark: () => saucer(false),
  tictac,
  sphere: orb,
  pyramid,
  triangle,
  cigar,
  ring,
  diamond,
  cubesphere,
};

// Shared per design: geometries and the hull material.
const cache = new Map();
let hullMaterial = null;
let lightGeometry = null;
let haloTexture = null;

function haloTex() {
  if (haloTexture) return haloTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

function designData(design) {
  if (!cache.has(design)) cache.set(design, (BUILDERS[design] || BUILDERS.saucer)());
  return cache.get(design);
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4();

// Creates a UFO model. radius: size in blocks. Returns an object with
// root (THREE.Group), near/far groups, animate(t, state), setVisibleLevel().
export function createUfoModel(design, radius = 5, { castShadow = true } = {}) {
  if (!BUILDERS[design]) design = "saucer";
  const data = designData(design);
  const info = designInfo(design);
  if (!hullMaterial) hullMaterial = createEntityMaterial("color");
  if (!lightGeometry) lightGeometry = new THREE.SphereGeometry(1, 8, 6);

  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts / spins (crashes, the orb's spin)
  body.scale.setScalar(radius);
  root.add(body);
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0), glow: 0 };

  const hull = new THREE.Mesh(data.hull, hullMaterial);
  hull.castShadow = castShadow;
  hull.receiveShadow = false;
  body.add(hull);
  bindEntityLight(hull, () => light);

  const glows = [];
  for (const g of data.glow) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(g.color[0], g.color[1], g.color[2]),
      transparent: !!g.shell,
      opacity: g.shell ? 0.35 : 1,
      blending: g.shell ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !g.shell,
      side: g.shell ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(g.geometry, mat);
    body.add(mesh);
    glows.push({ mesh, base: g.color, pulse: g.pulse || 0, cycle: !!g.cycle, shell: !!g.shell });
  }

  let lights = null;
  if (data.lights.length) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lights = new THREE.InstancedMesh(lightGeometry, mat, data.lights.length);
    lights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(data.lights.length * 3), 3);
    data.lights.forEach((l, i) => {
      _m.makeScale(l.size, l.size, l.size).setPosition(l.pos[0], l.pos[1], l.pos[2]);
      lights.setMatrixAt(i, _m);
      lights.setColorAt(i, _c.setRGB(1, 1, 1));
    });
    lights.frustumCulled = false;
    body.add(lights);
  }

  // A soft halo, so it reads as a light in the sky from far away.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(info.halo[0], info.halo[1], info.halo[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  halo.scale.setScalar(radius * 3.2);
  halo.renderOrder = 12;
  root.add(halo);

  const model = {
    design,
    radius,
    root,
    body,
    hull,
    halo,
    light,
    lights,
    glows,
    info,
    bottom: info.bottom * radius, // underside, below the center
    height: info.h * radius,
    phase: Math.random() * 100,
    hue: Math.random(),
    lightsOn: 1, // 0 = dark (crashed), flickers in between
    far: false,
    // t: time (s). night: 0-1 (brighter halo at night). damage: 0-1.
    animate(t, { night = 1, damage = 0, beam = 0, speed = 0 } = {}) {
      t += model.phase;
      const on = model.lightsOn;
      // Lights.
      if (lights) {
        const n = data.lights.length;
        for (let i = 0; i < n; i++) {
          const l = data.lights[i];
          let k = 1;
          let r = l.color ? l.color[0] : 1;
          let g = l.color ? l.color[1] : 1;
          let b = l.color ? l.color[2] : 1;
          switch (data.pattern) {
            case "chase-cycle": {
              k = 0.25 + 0.75 * Math.max(0, Math.cos(((i / n) * Math.PI * 2 - t * (3 + speed * 0.05)) * 1)) ** 3;
              _c.setHSL((model.hue + i / n + t * 0.05) % 1, 1, 0.5);
              r = _c.r * 3.2;
              g = _c.g * 3.2;
              b = _c.b * 3.2;
              break;
            }
            case "blink-red":
              k = (t * 1.2 + i * 0.17) % 1 < 0.12 ? 1 : 0.08;
              break;
            case "corners":
              k = i === 4 ? 0.6 + 0.4 * Math.sin(t * 3) : (t * 0.9 + i * 0.25) % 1 < 0.18 ? 1 : 0.15;
              break;
            case "triangle":
              k = i === 3 ? 0.5 + 0.5 * Math.sin(t * 5) : 0.85 + 0.15 * Math.sin(t * 1.3 + i);
              break;
            case "windows":
              k = 0.35 + 0.65 * (Math.sin(t * 4 - (i >> 1) * 0.7) > 0.3 ? 1 : 0.2);
              break;
            case "cycle": {
              if (!l.color) {
                _c.setHSL((model.hue + t * 0.12 + i * 0.25) % 1, 1, 0.5);
                r = _c.r * 3;
                g = _c.g * 3;
                b = _c.b * 3;
              }
              k = 0.6 + 0.4 * Math.sin(t * 2 + i);
              break;
            }
            case "breathe":
              k = 0.6 + 0.4 * Math.sin(t * 1.5);
              break;
            default:
              break;
          }
          // Damage: lights stutter.
          if (damage > 0.5 && Math.sin(t * 37 + i * 11) > 1.6 - damage) k *= 0.1;
          k *= on;
          lights.setColorAt(i, _c.setRGB(r * k, g * k, b * k));
        }
        lights.instanceColor.needsUpdate = true;
      }
      for (const gl of glows) {
        let k = 1 - gl.pulse + gl.pulse * (0.5 + 0.5 * Math.sin(t * 2.2));
        k *= 0.15 + 0.85 * on;
        if (gl.cycle) {
          _c.setHSL((model.hue + t * 0.07) % 1, 0.85, 0.55);
          const bright = Math.max(gl.base[0], gl.base[1], gl.base[2]);
          gl.mesh.material.color.setRGB(_c.r * bright * k, _c.g * bright * k, _c.b * bright * k);
        } else {
          gl.mesh.material.color.setRGB(gl.base[0] * k, gl.base[1] * k, gl.base[2] * k);
        }
      }
      // The halo: strong at night, faint by day, brighter under the beam.
      const hk = (0.12 + 0.7 * night) * (0.2 + 0.8 * on) * (1 + beam * 0.8);
      halo.material.opacity = Math.min(1, hk);
      if (design === "diamond") model.body.rotation.y = t * 0.6;
      if (design === "ring" && glows[0]) glows[0].mesh.position.y = Math.sin(t * 1.3) * 0.05;
      if (design === "cubesphere") hull.rotation.y = t * 0.25;
    },
    // Far away only the hull and the halo are drawn (2 draw calls).
    setFar(far) {
      if (far === model.far) return;
      model.far = far;
      if (lights) lights.visible = !far;
      for (const gl of glows) gl.mesh.visible = !far || gl.shell;
      hull.castShadow = !far && castShadow;
    },
    dispose() {
      for (const gl of glows) gl.mesh.material.dispose();
      if (lights) {
        lights.material.dispose();
        lights.dispose();
      }
      halo.material.dispose();
    },
  };
  return model;
}
