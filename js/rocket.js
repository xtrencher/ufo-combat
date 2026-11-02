// The rocket (Round 15): a tall multi-stage rocket on its launch pad, the
// way to space, the Moon and Mars. A vehicle (js/vehicles.js): Creative's
// call-in (the pause menu's "Rocket") and the Vehicles tab's item put one
// down; F boards it; online it is shared like any other (net/vehicles.js:
// its stage, phase, throttle, legs and countdown in its states, so the
// others watch the launch).
//
// The stack: four strap-on boosters round a core stage, and the ship on top
// (the upper stage with its capsule and four landing legs). Phases:
//   pad       on its pad by the gantry tower (or, the ship alone, "landed"
//             somewhere); Space starts the countdown (Backspace stops it)
//   count     T-10 to 0 (the ship alone, from 3): the voice counts, the
//             tower's arms swing away at T-6, ignition at T-3 (flames, the
//             smoke cloud rolling out over the ground, the ground shaking)
//   ascent    held down to T-0, then a slow lift-off, faster and faster, a
//             gravity turn the way the rocket faces; the boosters fall away
//             (js/space.js drops them, tumbling, trailing smoke); the sky
//             darkens to black and stars as it climbs (js/space-sky.js);
//             at engine cut-off the rocket is in orbit: js/space.js takes
//             over (the orbit's own scene, the choice of where to go)
//   descent   the ship comes down on its engine to the ground of the planet
//             (js/space.js puts it in the sky there): the autopilot flies it
//             down onto the landing zone (or the pad back on Earth) unless
//             the player takes the controls (Space / Shift throttle, W A S D
//             tilt; R gives it back to the autopilot); the legs come out
//             near the ground; dust blows out under the engine; a touchdown
//             slower than 7 blocks a second upright is a landing, else a
//             crash
//   landed    the ship standing on its legs: board it, Space flies it up to
//             orbit again (a short countdown, an ascent of its own)
// Getting out in flight is a bail-out (a parachute); a rocket flying on with
// nobody aboard ends its climb in orbit (it goes), a ship coming down
// without its pilot lands itself.
//
// Saving: on the pad or landed, as it stands; saved in flight, it is back on
// its pad (climbing) or on the ground below (coming down).
//
// Model space: up +Y, the rocket's bottom (the engines' exit, the legs' feet)
// at y 0; it faces -Z (the gravity turn's way); 1 unit is a block.
import * as THREE from "three";
import { Vehicle, VehicleManager } from "./vehicles.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { effectsQuality } from "./effects.js";
import { IS_SOLID, IS_WET, BLOCK } from "./blocks.js";
import { WORLD_HEIGHT } from "./constants.js";
import { voice } from "./voice.js";
import { LAUNCH_PAD, LAUNCH_PAD_EDGE } from "./content/space.js";

// js/space.js sets `space` (the orbit and the travel), so the rocket can hand
// itself over at engine cut-off and show its captions.
export const ROCKET_HOOKS = { space: null };

const G = 26; // the Overworld's gravity (player.js), blocks/s^2
const STACK_H = { full: 41.5, core: 41.5, ship: 15.2 }; // heights (nose tip)
const SHIP_LIFT = 2.2; // the ship alone: its body's bottom above its feet
const CORE_TOP = 27.6; // the ship's body's bottom in the full stack
const COUNT_FULL = 10;
const COUNT_SHIP = 3;
const IGNITION = 3; // seconds before T-0 the engines light
// The climb: acceleration a0 + a1 t (blocks/s^2), the pitch-over (start,
// end, the tilt reached), staging and engine cut-off (s after lift-off).
const CLIMB = {
  earth: { a0: 1.4, a1: 0.13, turn0: 7, turn1: 24, tilt: 0.62, boosters: 13, meco: 26 },
  planet: { a0: 3.2, a1: 0.42, turn0: 4, turn1: 12, tilt: 0.55, boosters: 6, meco: 13 },
};
const LAND_SPEED = 7; // blocks/s down at touchdown, at most, for a landing
const LAND_TILT = 0.35; // radians off upright, at most
const MAX_TILT = 0.42; // what the descent's tilt can reach
const LEGS_AGL = 70; // the legs come out below this height
const ENTER_R = 3.6;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- The model ----------

// A small kit of vertex-coloured shapes merged into one geometry (the game's
// model style: flat-shaded, the entity shader's paint finish).
class Kit {
  constructor() {
    this.parts = [];
  }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _v2.set(sx, sy, sz));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.set(typeof color === "function" ? color(pos.getX(i), pos.getY(i), pos.getZ(i)) : color);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    this.parts.push(g);
    return this;
  }
  build() {
    let n = 0;
    for (const g of this.parts) n += g.getAttribute("position").count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let o = 0;
    for (const g of this.parts) {
      pos.set(g.getAttribute("position").array, o * 3);
      col.set(g.getAttribute("color").array, o * 3);
      o += g.getAttribute("position").count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.computeVertexNormals();
    return out;
  }
}

const WHITE = 0xe9e8e3;
const OFFWHITE = 0xd4d3cd;
const BLACK = 0x1b1c1f;
const STEEL = 0x55585c;
const DARKSTEEL = 0x34363a;
const RED = 0xb02a1e;
const GOLD = 0xc39a3a;
const NOZZLE = 0x2a2624;
const GLASS = 0x223040;

const cyl = (r0, r1, h, seg = 20, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);

// The roll pattern on a stage: black and white quarters in bands.
function rollPaint(y0, y1, phase = 0) {
  return (x, y, z) => {
    if (y < y0 || y > y1) return WHITE;
    const q = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI / 2) + phase) % 4);
    const band = Math.floor((y - y0) / ((y1 - y0) / 2));
    return (q + band) % 2 ? BLACK : WHITE;
  };
}

// One engine bell (its exit at y 0).
function bell(kit, x, z, r, h) {
  kit.add(cyl(r, r * 0.42, h, 14, true), NOZZLE, x, h / 2, z);
  kit.add(cyl(r * 0.5, r * 0.5, h * 0.35, 10), DARKSTEEL, x, h + h * 0.17, z);
}

let GEO = null;
function geometries() {
  if (GEO) return GEO;
  // The core stage: its engines (five), the skirt, the white body with a
  // black band and the roll pattern, the interstage.
  const core = new Kit();
  bell(core, 0, 0, 0.75, 1.8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    bell(core, Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0.6, 1.6);
  }
  core.add(cyl(2.15, 2.0, 1.6, 24), DARKSTEEL, 0, 2.3, 0); // (the thrust structure's skirt)
  core.add(cyl(2.0, 2.0, 22.4, 28), rollPaint(3.2, 8.2), 0, 3.1 + 11.2, 0);
  core.add(cyl(2.02, 2.02, 1.2, 28), BLACK, 0, 14.5, 0);
  core.add(cyl(2.02, 2.02, 0.5, 28), RED, 0, 22.0, 0);
  core.add(cyl(2.0, 1.8, 2.1, 28), DARKSTEEL, 0, 25.5 + 1.05, 0); // (the interstage)
  // the hold-down ring's lugs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    core.add(new THREE.BoxGeometry(0.4, 0.8, 0.4), STEEL, Math.cos(a) * 2.15, 1.9, Math.sin(a) * 2.15);
  }
  // A booster (its own frame: its axis at x 0): bell, body, nose, the struts.
  const booster = new Kit();
  bell(booster, 0, 0, 0.55, 1.2);
  booster.add(cyl(1.05, 1.05, 18.4, 18), (x, y, z) => (y > 17.4 ? BLACK : y > 1.3 && y < 2.3 ? STEEL : OFFWHITE), 0, 1.2 + 9.2, 0);
  booster.add(new THREE.ConeGeometry(1.05, 3.6, 18), (x, y) => (y > 1.2 ? RED : WHITE), 0, 19.6 + 1.8, 0);
  booster.add(new THREE.BoxGeometry(0.3, 0.3, 1.4), STEEL, 0, 3.0, 1.1);
  booster.add(new THREE.BoxGeometry(0.3, 0.3, 1.4), STEEL, 0, 16.0, 1.1);
  // The ship (its body's bottom at y 0): the engine, body, the black roll
  // pattern, windows, the gold-foil service band, the nose, four fins.
  const ship = new Kit();
  ship.add(cyl(0.95, 0.42, 1.8, 16, true), NOZZLE, 0, -0.9, 0);
  ship.add(cyl(1.75, 1.75, 8.2, 26), rollPaint(1.2, 4.4, 0.5), 0, 4.1, 0);
  ship.add(cyl(1.77, 1.77, 0.9, 26), GOLD, 0, 0.45, 0);
  ship.add(new THREE.ConeGeometry(1.75, 4.6, 26), (x, y) => (y > 1.9 ? BLACK : WHITE), 0, 8.2 + 2.3, 0);
  ship.add(cyl(0.12, 0.12, 1.1, 6), STEEL, 0, 13.4, 0); // (the escape tower's tip)
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.35;
    ship.add(new THREE.BoxGeometry(0.42, 0.55, 0.1), GLASS, Math.cos(a) * 1.73, 6.9, Math.sin(a) * 1.73, 0, -a + Math.PI / 2, 0);
  }
  ship.add(new THREE.BoxGeometry(0.8, 1.4, 0.1), DARKSTEEL, 0, 5.6, -1.74); // (the hatch)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ship.add(new THREE.BoxGeometry(0.12, 1.8, 1.1), BLACK, Math.cos(a) * 2.1, 1.3, Math.sin(a) * 2.1, 0, -a, 0);
  }
  // A landing leg (pivot at the top, at the origin; the foot down -Y).
  const leg = new Kit();
  leg.add(new THREE.BoxGeometry(0.24, 3.3, 0.24), STEEL, 0, -1.65, 0);
  leg.add(cyl(0.35, 0.35, 0.16, 10), DARKSTEEL, 0, -3.35, 0);
  GEO = { core: core.build(), booster: booster.build(), ship: ship.build(), leg: leg.build() };
  return GEO;
}

// The flame's look: hot white at the nozzle, yellow, orange, fading along it,
// flickering; in a vacuum (`vac`) wider, fainter and bluer.
const flameVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const flameFragment = `
uniform float uTime;
uniform float uPower;
uniform float uVac;
varying vec2 vUv;
void main() {
  float t = 1.0 - vUv.y; // 0 at the nozzle, 1 at the tip
  float flick = 0.85 + 0.15 * sin(uTime * 61.0 + vUv.x * 40.0) * sin(uTime * 37.0);
  vec3 hot = mix(vec3(3.2, 3.0, 2.6), vec3(2.6, 3.0, 4.2), uVac);
  vec3 mid = mix(vec3(2.6, 1.5, 0.45), vec3(0.8, 1.1, 2.4), uVac);
  vec3 tail = mix(vec3(1.4, 0.45, 0.1), vec3(0.3, 0.35, 1.0), uVac);
  vec3 c = t < 0.25 ? mix(hot, mid, t / 0.25) : mix(mid, tail, (t - 0.25) / 0.75);
  float a = (1.0 - smoothstep(0.35, 1.0, t)) * uPower * flick * mix(1.0, 0.55, uVac);
  // (softer at the cone's rim seen side-on: the uv's x wraps round it)
  gl_FragColor = vec4(c * a, a);
}`;

function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uVac: { value: 0 } },
    vertexShader: flameVertex,
    fragmentShader: flameFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

let GLOW_TEX = null;
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,220,160,0.6)");
  gr.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

// The rocket's model. opts.standard: plain lit materials (js/space.js's own
// scene, which has its own sun) instead of the world's entity shader.
export function createRocketModel({ standard = false } = {}) {
  const g = geometries();
  const root = new THREE.Group();
  const light = { sky: 15, block: 0, flash: new THREE.Color(0, 0, 0) };
  const mat = standard
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, flatShading: false })
    : createEntityMaterial("color", null, { finish: { spec: 0.55, gloss: 40, env: 0.25, grain: 0.02, panel: 0.15, panelScale: 1.4 } });
  if (!standard) mat.uniforms.uFill.value = 0.4;
  const mats = [mat];
  const mesh = (geo, parent) => {
    const o = new THREE.Mesh(geo, mat);
    o.castShadow = !standard;
    if (!standard) bindEntityLight(o, () => light);
    parent.add(o);
    return o;
  };
  const core = new THREE.Group();
  root.add(core);
  mesh(g.core, core);
  const boosters = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const b = new THREE.Group();
    b.position.set(Math.cos(a) * 3.1, 0, Math.sin(a) * 3.1);
    b.rotation.y = -a - Math.PI / 2;
    mesh(g.booster, b);
    root.add(b);
    boosters.push(b);
  }
  const ship = new THREE.Group();
  root.add(ship);
  mesh(g.ship, ship);
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 1.6, 2.4, Math.sin(a) * 1.6);
    pivot.rotation.y = -a;
    const arm = new THREE.Group();
    pivot.add(arm);
    mesh(g.leg, arm);
    ship.add(pivot);
    legs.push(arm);
  }
  // Flames: the core's (one wide plume), each booster's, the ship's.
  const flames = [];
  const flame = (parent, r, len, y, key) => {
    const fm = flameMaterial();
    mats.push(fm);
    const geo = new THREE.CylinderGeometry(r, r * 2.4, len, 18, 1, true).translate(0, -len / 2, 0);
    const m = new THREE.Mesh(geo, fm);
    m.position.y = y;
    m.renderOrder = 12;
    m.frustumCulled = false;
    m.visible = false;
    parent.add(m);
    const sm = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(2.6, 1.9, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    mats.push(sm);
    const glow = new THREE.Sprite(sm);
    glow.position.y = y - r * 0.6;
    glow.scale.setScalar(r * 7);
    glow.visible = false;
    glow.renderOrder = 12;
    parent.add(glow);
    flames.push({ key, mesh: m, glow, mat: fm, len, r });
  };
  flame(core, 1.9, 16, 0.1, "core");
  for (const b of boosters) flame(b, 0.55, 11, 0.1, "boost");
  flame(ship, 0.8, 8, -1.7, "ship");

  const model = {
    root,
    core,
    ship,
    boosters,
    legs,
    flames,
    light,
    stack: "full",
    legsK: 0,
    setStack(stack) {
      this.stack = stack;
      core.visible = stack !== "ship";
      for (const b of boosters) b.visible = stack === "full";
      ship.position.y = stack === "ship" ? SHIP_LIFT : CORE_TOP;
    },
    // 0 folded along the body, 1 out on the ground.
    setLegs(k) {
      this.legsK = k;
      for (const arm of legs) arm.rotation.z = 0;
      for (const arm of legs) arm.rotation.x = 0;
      // (each arm swings out from the body, round its own pivot's x axis, seen from its side)
      for (const arm of legs) arm.rotation.z = -(0.05 + 0.55 * k);
    },
    // power 0-1 for each engine group; vac: in a vacuum (0-1).
    setFlames(power, time, vac = 0) {
      for (const f of flames) {
        const p = f.key === "ship" ? power.ship : f.key === "core" ? power.core : power.boost;
        const on = p > 0.01 && f.mesh.parent.visible;
        f.mesh.visible = on;
        f.glow.visible = on;
        if (!on) continue;
        f.mat.uniforms.uPower.value = p;
        f.mat.uniforms.uTime.value = time;
        f.mat.uniforms.uVac.value = vac;
        const s = 0.55 + 0.45 * p;
        f.mesh.scale.set(1 + vac * 0.8, s * (1 + vac * 0.3), 1 + vac * 0.8);
        f.glow.scale.setScalar(f.r * (5 + 4 * p) * (0.9 + Math.random() * 0.2));
      }
    },
    dispose() {
      for (const m of mats) m.dispose();
    },
  };
  model.setStack("full");
  model.setLegs(0);
  return model;
}

// A booster on its own (js/space.js: the ones that fall away), its frame as
// in the stack (its axis along +Y, its bottom at 0). Their material is shared.
let BOOSTER_MAT = null;
export function createBoosterMesh() {
  if (!BOOSTER_MAT) {
    BOOSTER_MAT = createEntityMaterial("color", null, { finish: { spec: 0.55, gloss: 40, env: 0.25, grain: 0.02, panel: 0.15, panelScale: 1.4 } });
    BOOSTER_MAT.uniforms.uFill.value = 0.4;
  }
  const light = { sky: 15, block: 0 };
  const m = new THREE.Mesh(geometries().booster, BOOSTER_MAT);
  m.castShadow = true;
  bindEntityLight(m, () => light);
  m.userData.light = light;
  return m;
}

// ---------- The gantry tower ----------

// A lattice tower of red steel beside the pad (the rocket at its -X side):
// four corner posts, rings and cross braces up 44 blocks, the hammerhead
// crane, a lightning mast, three swing arms reaching to the rocket (they
// swing away before launch), the hold-down clamps round the rocket's foot.
function createTower() {
  const k = new Kit();
  const P = 1.5; // half the tower's width
  const H = 44;
  const TOWER = 0xa8321c;
  const TOWER2 = 0x7c2414;
  for (const [x, z] of [[-P, -P], [P, -P], [P, P], [-P, P]]) k.add(new THREE.BoxGeometry(0.35, H, 0.35), TOWER, x, H / 2, z);
  for (let y = 0; y <= H; y += 4) {
    k.add(new THREE.BoxGeometry(P * 2, 0.25, 0.25), TOWER2, 0, y, -P);
    k.add(new THREE.BoxGeometry(P * 2, 0.25, 0.25), TOWER2, 0, y, P);
    k.add(new THREE.BoxGeometry(0.25, 0.25, P * 2), TOWER2, -P, y, 0);
    k.add(new THREE.BoxGeometry(0.25, 0.25, P * 2), TOWER2, P, y, 0);
    if (y + 4 > H) continue;
    const d = Math.hypot(P * 2, 4);
    const a = Math.atan2(4, P * 2);
    for (const s of [-1, 1]) {
      k.add(new THREE.BoxGeometry(d, 0.18, 0.18), TOWER2, 0, y + 2, s * P, 0, 0, s * a);
      k.add(new THREE.BoxGeometry(0.18, 0.18, d), TOWER2, s * P, y + 2, 0, s * a, 0, 0);
    }
  }
  // floors every 8 (the service levels)
  for (let y = 8; y < H; y += 8) k.add(new THREE.BoxGeometry(P * 2 + 0.6, 0.15, P * 2 + 0.6), DARKSTEEL, 0, y, 0);
  // the hammerhead crane and the lightning mast
  k.add(new THREE.BoxGeometry(9, 0.8, 0.8), TOWER, -1.5, H + 0.6, 0);
  k.add(new THREE.BoxGeometry(1, 1.4, 1), DARKSTEEL, 2.8, H + 0.5, 0);
  k.add(cyl(0.12, 0.05, 8, 6), STEEL, 0, H + 5, 0);
  // the base
  k.add(new THREE.BoxGeometry(P * 2 + 1.2, 1.2, P * 2 + 1.2), DARKSTEEL, 0, 0.6, 0);
  const geo = k.build();
  // A swing arm (pivot at the tower's -X face, reaching -X).
  const ak = new Kit();
  ak.add(new THREE.BoxGeometry(3.6, 0.5, 0.9), TOWER2, -1.8, 0, 0);
  ak.add(new THREE.BoxGeometry(3.6, 0.1, 1.1), DARKSTEEL, -1.8, -0.28, 0);
  ak.add(new THREE.BoxGeometry(0.7, 1.4, 1.3), STEEL, -3.6, -0.2, 0);
  const armGeo = ak.build();
  // The clamps (round the rocket's foot, in the pad's frame: the rocket at the origin).
  const ck = new Kit();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ck.add(new THREE.BoxGeometry(0.9, 2.2, 0.9), DARKSTEEL, Math.cos(a) * 2.9, 1.1, Math.sin(a) * 2.9);
  }
  const clampGeo = ck.build();
  const mat = createEntityMaterial("color", null, { finish: { spec: 0.3, gloss: 20, env: 0.1, grain: 0.05, panel: 0.1, panelScale: 1 } });
  mat.uniforms.uFill.value = 0.35;
  const light = { sky: 15, block: 0 };
  const root = new THREE.Group();
  const towerG = new THREE.Group();
  towerG.position.x = 7.2; // (the tower's middle from the rocket's)
  root.add(towerG);
  const tm = new THREE.Mesh(geo, mat);
  tm.castShadow = true;
  bindEntityLight(tm, () => light);
  towerG.add(tm);
  const arms = [];
  for (const y of [14, 25, 31.5]) {
    const pivot = new THREE.Group();
    pivot.position.set(-P, y, 0);
    const am = new THREE.Mesh(armGeo, mat);
    am.castShadow = true;
    bindEntityLight(am, () => light);
    pivot.add(am);
    towerG.add(pivot);
    arms.push(pivot);
  }
  const clamps = new THREE.Mesh(clampGeo, mat);
  clamps.castShadow = true;
  bindEntityLight(clamps, () => light);
  root.add(clamps);
  return {
    root,
    light,
    arms,
    // 0 the arms at the rocket, 1 swung away
    setArms(k) {
      for (let i = 0; i < arms.length; i++) arms[i].rotation.y = -smooth(i * 0.15, 0.7 + i * 0.15, k) * 1.35;
    },
    dispose() {
      geo.dispose();
      armGeo.dispose();
      clampGeo.dispose();
      mat.dispose();
    },
  };
}

// ---------- The sound ----------

// The engines' roar: deep rumble and crackle (filtered noise, looping) whose
// level follows the thrust and falls off with distance (the rider hears it
// muffled from inside; nothing in a vacuum but the rumble through the hull).
class RocketSound {
  constructor(audio) {
    this.audio = audio;
    this.on = false;
  }
  _start() {
    const a = this.audio;
    const ctx = a?.ctx;
    if (!ctx || !a._noise || !a.buses) return false;
    const t = ctx.currentTime;
    const out = a.buses.weapons || a.master;
    this.rumble = a._noise(t, 600);
    this.crack = a._noise(t, 600);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    this.lp = lp;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 1400;
    hp.Q.value = 0.6;
    this.g1 = ctx.createGain();
    this.g2 = ctx.createGain();
    this.g1.gain.value = 0;
    this.g2.gain.value = 0;
    this.rumble.connect(lp).connect(this.g1).connect(out);
    this.crack.connect(hp).connect(this.g2).connect(out);
    this.on = true;
    return true;
  }
  set(level, distance = 0, inside = false, vacuum = 0) {
    if (level <= 0.001 && !this.on) return;
    if (!this.on && !this._start()) return;
    const ctx = this.audio.ctx;
    const k = level / (1 + distance / 70);
    const t = ctx.currentTime;
    const rum = k * (inside ? 0.9 : 1.1) * (1 - vacuum * 0.4);
    const cr = k * (inside ? 0.12 : 0.45) * (1 - vacuum) * (0.6 + Math.random() * 0.8);
    this.g1.gain.setTargetAtTime(rum, t, 0.08);
    this.g2.gain.setTargetAtTime(cr, t, 0.03);
    this.lp.frequency.setTargetAtTime(inside ? 180 : 260 + 200 * level, t, 0.1);
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    try {
      this.rumble.stop();
      this.crack.stop();
    } catch {
      // (already stopped)
    }
  }
}

// ---------- The vehicle ----------

const PHASES = ["pad", "count", "ascent", "orbit", "descent", "landed"];
const STACKS = ["full", "core", "ship"];

export class Rocket extends Vehicle {
  constructor(manager, data = {}) {
    super(manager, { type: "rocket", name: "Rocket", radius: 6, maxHealth: 400 }); // (radius: getting out, a few blocks off its side)
    this.stack = STACKS.includes(data.stack) ? data.stack : "full";
    this.name = this.stack === "ship" ? "Ship" : "Rocket";
    this.phase = data.phase === "landed" || this.stack === "ship" ? "landed" : "pad";
    if (data.phase === "descent") this.phase = "descent";
    this.pad = Array.isArray(data.pad) && data.pad.length === 3 && data.pad.every(Number.isFinite) ? data.pad.slice() : null;
    this.padBuilt = !!this.pad || data.phase === "descent" || this.stack === "ship";
    this.yaw = Number.isFinite(data.yaw) ? data.yaw : 0;
    if (Array.isArray(data.pos)) this.pos.fromArray(data.pos);
    if (Array.isArray(data.vel) && data.vel.every(Number.isFinite)) this.vel.fromArray(data.vel);
    if (Number.isFinite(data.health)) this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.target = Array.isArray(data.target) ? { x: data.target[0], z: data.target[1] } : null;
    this.hitRadius = 0.8; // (the summon's room check; hits use the rocket's own shape, below)
    this.enterRadius = ENTER_R;
    this.q = new THREE.Quaternion();
    this.tilt = new THREE.Vector2(0, 0); // (the descent's: about x and z, radians)
    this.throttle = 0;
    this.power = { core: 0, boost: 0, ship: 0 };
    this.t = 0; // seconds in the phase
    this.count = 0; // the countdown's seconds left
    this.time = 0;
    this.legsK = this.phase === "landed" ? 1 : 0;
    this.autopilot = true;
    this.altK = 0; // (js/space-sky.js: how far into the black the climb is)
    this.cameraModes = ["auto", "chase", "onboard", "ground"];
    this.camYaw = 0;
    this.camPitch = -0.1;
    this.camDist = null;
    this._camManual = false;
    this.fxT = 0;
    this.smokeT = 0;
    this._said = new Set();
    this.climb = CLIMB.earth;
    this.model = createRocketModel();
    this.model.setStack(this.stack);
    this.model.setLegs(this.legsK);
    this.root.add(this.model.root);
    this.tower = null;
    if (this.phase === "pad" && this.stack === "full" && (data.tower ?? true) && this.pad) this._addTower();
    this.sound = new RocketSound(manager.audio);
    this._pose();
  }

  get dimGravity() {
    return this.manager.world.dimInfo?.gravity ?? 1;
  }

  get height() {
    return STACK_H[this.stack];
  }

  // (Its bottom is its position.)
  get bottom() {
    return 0;
  }

  get airborne() {
    if (this.phase === "pad" || this.phase === "landed" || this.phase === "count") return false;
    const g = this.manager.groundBelow(this.pos.x, this.pos.y + 1, this.pos.z);
    return this.pos.y - g > 4;
  }

  seatPosition(out = new THREE.Vector3()) {
    // (in the capsule, near the top)
    return out.copy(this._up(_v3)).multiplyScalar(this.height - 6).add(this.pos);
  }

  _up(out) {
    return out.set(0, 1, 0).applyQuaternion(this.q);
  }

  // ---------- The pad ----------

  // The summon's placing (VehicleManager.summonOnGround / the call-in): a
  // level pad of concrete under the rocket, 13 x 13, its edge striped, the
  // ground filled under it and cleared over it; the tower on the side away
  // from the player. (Once: a reload or a copy online has the pad already.)
  _place() {
    if (!this.padBuilt && this.manager.world) {
      this.padBuilt = true;
      this._buildPad();
    }
    this._pose();
  }

  // (where it stands, drawn: every frame)
  _pose() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.q);
    if (this.tower) {
      this.tower.root.position.set(this.pad[0], this.pad[1], this.pad[2]);
      this.tower.root.rotation.y = this.towerYaw ?? this.yaw;
    }
  }

  _buildPad() {
    const w = this.manager.world;
    const cx = Math.floor(this.pos.x);
    const cz = Math.floor(this.pos.z);
    const R = 6;
    const hs = [];
    for (let dz = -R; dz <= R; dz += 2) for (let dx = -R; dx <= R; dx += 2) hs.push(this._surface(cx + dx, cz + dz));
    hs.sort((a, b) => a - b);
    const top = Math.max(2, Math.min(WORLD_HEIGHT - 50, hs[Math.floor(hs.length / 2)]));
    const list = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        const edge = Math.max(Math.abs(dx), Math.abs(dz)) === R;
        list.push(x, top, z, edge ? LAUNCH_PAD_EDGE : LAUNCH_PAD);
        // (filled down to the ground under it, at most 12 deep: deeper, a pillar under each corner and the middle)
        const s = this._surface(x, z);
        const pillar = (Math.abs(dx) === R || dx === 0) && (Math.abs(dz) === R || dz === 0);
        for (let y = top - 1; y > s && y > top - (pillar ? 40 : 12); y--) list.push(x, y, z, BLOCK.STONE);
        // (cleared above it: trees, hills, snow, plants)
        for (let y = top + 1; y <= Math.min(WORLD_HEIGHT - 1, top + 48); y++) {
          const id = w.getBlock(x, y, z);
          if (id !== BLOCK.AIR) list.push(x, y, z, BLOCK.AIR);
          else if (y > s + 1 && y > top + 12) break;
        }
      }
    }
    // (the tower's own footing, beside the pad)
    w.setBlocks(list);
    this.pad = [cx + 0.5, top + 1, cz + 0.5];
    this.pos.set(this.pad[0], this.pad[1], this.pad[2]);
    // the tower: on the side away from whoever placed it (the yaw faces away from them)
    this.towerYaw = this.yaw - Math.PI / 2;
    if (this.stack === "full") this._addTower();
  }

  // The top of the ground in column (x, z) (water's surface counts), its y.
  _surface(x, z) {
    const w = this.manager.world;
    for (let y = WORLD_HEIGHT - 2; y > 0; y--) {
      const id = w.getBlock(x, y, z);
      if (IS_SOLID[id] || IS_WET[id]) return y;
    }
    return 1;
  }

  _addTower() {
    if (this.tower || !this.pad) return;
    this.tower = createTower();
    this.towerYaw ??= this.yaw - Math.PI / 2;
    this.manager.scene.add(this.tower.root);
    this.tower.setArms(0);
  }

  _removeTower() {
    if (!this.tower) return;
    this.manager.scene.remove(this.tower.root);
    this.tower.dispose();
    this.tower = null;
  }

  // ---------- Hits: the rocket's own shape (a capsule along its axis) ----------

  _axisDist(p) {
    const up = this._up(_v3);
    _v.copy(p).sub(this.pos);
    const t = Math.max(0, Math.min(this.height, _v.dot(up)));
    _v2.copy(up).multiplyScalar(t).add(this.pos);
    const r = this.stack === "full" && t < 22 ? 4 : 2;
    return Math.max(0, p.distanceTo(_v2) - r);
  }

  hullDistance(p, max = Infinity) {
    return Math.min(max, this._axisDist(p));
  }

  raycast(origin, dir, maxDist) {
    // (marched: a ray meets the capsule where its distance runs out)
    let t = 0;
    for (let i = 0; i < 48 && t <= maxDist; i++) {
      _v.copy(dir).multiplyScalar(t).add(origin);
      const d = this._axisDist(_v);
      if (d < 0.05) return t;
      t += Math.max(0.05, d);
    }
    return null;
  }

  sweptRaycast(origin, dir, step) {
    return this.raycast(origin, dir, step);
  }

  segmentHit(a, b, pad = 0) {
    const len = a.distanceTo(b);
    if (len < 1e-6) return this._axisDist(a) <= pad;
    for (let i = 0; i <= 8; i++) {
      _v.copy(a).lerp(b, i / 8);
      if (this._axisDist(_v) <= pad) return true;
    }
    return false;
  }

  get collider() {
    return null;
  }

  // ---------- Controls ----------

  onEnter() {
    this.camYaw = this.yaw + Math.PI * 0.75;
    this._camManual = false;
    this.cameraMode = 0;
    if (this.phase === "pad" || this.phase === "landed") ROCKET_HOOKS.space?.caption?.(this.phase === "landed" ? "Space: lift off to orbit" : "Space: start the countdown", "hint", 4);
  }

  onExit() {
    this.sound.set(0);
    if (this.phase === "count") this._abort("Countdown stopped: nobody aboard");
  }

  cycleCamera() {
    this._camManual = true;
    return super.cycleCamera();
  }

  // Space: the countdown (a held key starts it once).
  _input(input) {
    if (!input) return;
    const keys = input.keys;
    if (input.dx || input.dy) {
      this.camYaw -= input.dx * 0.0035;
      this.camPitch = Math.max(-1.45, Math.min(1.1, this.camPitch - input.dy * 0.0035));
      if (this.cameraModes[this.cameraMode] === "auto" && (this.phase === "pad" || this.phase === "landed")) this.cameraMode = 1;
    }
    if (input.wheel) this.camDist = Math.max(8, Math.min(140, (this.camDist ?? this._defaultDist()) * (input.wheel > 0 ? 1.12 : 0.89)));
    const pressed = input.pressed;
    if ((this.phase === "pad" || this.phase === "landed") && (pressed.has("Space") || pressed.has("Enter"))) this.startCountdown();
    else if (this.phase === "count" && pressed.has("Backspace") && this.count > 0.5) this._abort("Countdown stopped");
    if (this.phase === "descent") {
      const manual = keys.has("Space") || keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
      if (manual && this.autopilot) {
        this.autopilot = false;
        ROCKET_HOOKS.space?.caption?.("Manual control (R: autopilot)", "hint", 2.5);
      }
      if (pressed.has("KeyR")) {
        this.autopilot = !this.autopilot;
        ROCKET_HOOKS.space?.caption?.(this.autopilot ? "Autopilot: it lands itself" : "Manual control", "hint", 2);
      }
    }
  }

  startCountdown() {
    if (this.phase !== "pad" && this.phase !== "landed") return false;
    this.climb = this.manager.world.dim && this.manager.world.dim !== "overworld" ? CLIMB.planet : CLIMB.earth;
    this.count = this.stack === "ship" ? COUNT_SHIP : COUNT_FULL;
    this.phase = "count";
    this.t = 0;
    this._said.clear();
    ROCKET_HOOKS.space?.onCountdown?.(this);
    return true;
  }

  _abort(text) {
    this.phase = this.stack === "ship" ? "landed" : "pad";
    this.count = 0;
    this.throttle = 0;
    this.power.core = this.power.boost = this.power.ship = 0;
    this.tower?.setArms(0);
    ROCKET_HOOKS.space?.caption?.(text, "hint", 2.5);
  }

  _say(key, text) {
    if (this._said.has(key) || this.puppet || this !== this.manager.active) return;
    this._said.add(key);
    voice.say(`rocket_${key}`, { text });
  }

  // ---------- Update ----------

  update(dt, input) {
    super.update(dt, input);
    this.time += dt;
    this.t += dt;
    if (!this.alive) {
      this._wreck(dt);
      return;
    }
    this._input(input);
    switch (this.phase) {
      case "count":
        this._countdown(dt);
        break;
      case "ascent":
        this._ascent(dt);
        break;
      case "descent":
        this._descent(dt, input);
        break;
      case "orbit":
        // (in orbit: js/space.js has it; nothing here is drawn)
        this.root.visible = false;
        break;
      default:
        this.throttle = 0;
        this.power.core = this.power.boost = this.power.ship = 0;
        this.vel.set(0, 0, 0);
    }
    this._pose();
    this._animate(dt);
  }

  _countdown(dt) {
    const before = this.count;
    this.count = Math.max(0, this.count - dt);
    const sec = Math.ceil(this.count);
    if (Math.ceil(before) !== sec || this.t < dt * 1.5) {
      if (sec > 0) {
        const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
        this._say(`c${sec}`, sec === 3 && this.stack !== "ship" ? "Three. Ignition sequence start" : words[sec] || String(sec));
        ROCKET_HOOKS.space?.caption?.(String(sec), "count", 1);
      }
    }
    if (this.tower && this.count < 6.5) this.tower.setArms(Math.min(1, (6.5 - this.count) / 3));
    // ignition at T-3 (the ship alone lights at T-1): the engines build up, held down
    const ign = this.stack === "ship" ? 1 : IGNITION;
    if (this.count <= ign) {
      const k = 1 - this.count / ign;
      this.power.core = this.stack === "ship" ? 0 : 0.4 + 0.6 * k;
      this.power.boost = this.stack === "full" ? 0.3 + 0.7 * k : 0;
      this.power.ship = this.stack === "ship" ? 0.4 + 0.6 * k : 0;
      this.throttle = 0.4 + 0.6 * k;
      this._padSmoke(dt, 0.6 + 0.6 * k);
      this.manager.effects?.shake?.add(dt * 0.6 * this._near());
    }
    if (this.count <= 0) {
      this.phase = "ascent";
      this.t = 0;
      this.speed = 0;
      this._say("liftoff", this.stack === "ship" ? "Lift off" : "Lift off! We have lift off");
      ROCKET_HOOKS.space?.caption?.("LIFT-OFF", "big", 2.5);
      ROCKET_HOOKS.space?.onLiftoff?.(this);
    }
  }

  // How near the listener is, 0-1 (the shaking and the sound).
  _near() {
    const l = this.manager.effects?.listener;
    if (!l) return 1;
    return 1 / (1 + l.distanceTo(this.pos) / 60);
  }

  _ascent(dt) {
    const C = this.climb;
    const t = this.t;
    const g = this.dimGravity;
    // (the thrust is the acceleration's: the planets' climb is the faster one, their gravity lower)
    const a = C.a0 + C.a1 * t;
    this.speed = (this.speed || 0) + a * dt;
    const tilt = smooth(C.turn0, C.turn1, t) * C.tilt;
    // facing: -Z of the yaw (the way the rocket was set down facing)
    // (tilted over toward the way it faces: about the axis up x forward)
    this.q.setFromAxisAngle(_v.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)), tilt).multiply(_q.setFromAxisAngle(UP, this.yaw));
    const up = this._up(_v);
    this.vel.copy(up).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.power.core = this.stack === "ship" ? 0 : 1;
    this.power.boost = this.stack === "full" ? 1 : 0;
    this.power.ship = this.stack === "ship" ? 1 : 0;
    this.throttle = 1;
    const dim = this.manager.world.dim;
    const ground = this.pad ? this.pad[1] : this.manager.groundBelow(this.pos.x, this.pos.y, this.pos.z);
    this.agl = this.pos.y - ground;
    this.altK = dim === "overworld" || !dim ? smooth(90, 620, this.agl) : 1;
    if (t < 6) this._padSmoke(dt, 1.4 - t * 0.2);
    this._trail(dt);
    if (t < 8) this.manager.effects?.shake?.add(dt * 0.5 * this._near() * (1 - t / 8));
    if (this.tower) this.tower.setArms(1);
    if (this.stack === "full" && t >= C.boosters) {
      this.stack = "core";
      this.model.setStack("core");
      ROCKET_HOOKS.space?.dropBoosters?.(this);
      this._say("boosters", "Booster separation");
      ROCKET_HOOKS.space?.caption?.("Booster separation", "stage", 2.5);
    }
    if (t > C.turn0 && t < C.turn0 + 0.1) this._say("roll", "Roll program");
    if (t >= C.meco - 4 && t < C.meco - 3.9) this._say("go", g < 0.5 ? "Climbing to orbit" : "Max Q. Throttling up");
    if (t >= C.meco) {
      this.phase = "orbit";
      this.t = 0;
      this.power.core = this.power.boost = this.power.ship = 0;
      this.sound.set(0);
      ROCKET_HOOKS.space?.reachedOrbit?.(this);
    }
  }

  // Smoke rolling out over the pad (the ignition's cloud, the lift-off's).
  _padSmoke(dt, k) {
    const fx = this.manager.effects;
    if (!fx?.trail) return;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.smokeT = 0.05 / q;
    const base = this.pad ? this.pad[1] : this.pos.y;
    const dust = this._dustColor();
    const n = Math.round(2 + 3 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 9 + Math.random() * 14 * k;
      fx.trail.spawn({ x: this.pos.x + Math.cos(a) * 3, y: base + 0.6 + Math.random() * 1.2, z: this.pos.z + Math.sin(a) * 3, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 2.5, vz: Math.sin(a) * sp, life: 9 + Math.random() * 9, size0: 3.5, size1: 16 + Math.random() * 12, color0: Math.random() < 0.3 ? dust : SMOKE0, color1: SMOKE1, alpha: 0.9, drag: 0.9, hold: 0.45 });
    }
    // fire at the base, lighting the cloud
    fx.glow.spawn({ x: this.pos.x + rand(-2, 2), y: base + 1, z: this.pos.z + rand(-2, 2), vx: rand(-6, 6), vy: rand(0, 2), vz: rand(-6, 6), life: 0.5, size0: 5, size1: 9, color0: FIRE, alpha: 0.8, drag: 1.5 });
  }

  // The column of smoke the climb leaves (long-lived: it hangs in the sky).
  _trail(dt) {
    const fx = this.manager.effects;
    if (!fx?.trail) return;
    this.fxT -= dt;
    if (this.fxT > 0) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.fxT = 0.04 / q;
    const thin = this.manager.world.dimInfo?.airless ? 0.25 : this.altK > 0.8 ? 0.4 : 1;
    const up = this._up(_v);
    const back = _v2.copy(this.pos).addScaledVector(up, -3 - Math.random() * 4);
    fx.trail.spawn({ x: back.x + rand(-1, 1), y: back.y, z: back.z + rand(-1, 1), vx: this.vel.x * 0.05 + rand(-0.6, 0.6), vy: rand(-0.5, 0.5), vz: this.vel.z * 0.05 + rand(-0.6, 0.6), life: (14 + Math.random() * 10) * thin, size0: this.stack === "ship" ? 2 : 4, size1: (this.stack === "ship" ? 8 : 15) + Math.random() * 6, color0: SMOKE0, color1: SMOKE1, alpha: 0.85 * thin, drag: 0.3, hold: 0.5 });
    fx.glow.spawn({ x: back.x, y: back.y + 1.5, z: back.z, vx: -up.x * 20, vy: -up.y * 20, vz: -up.z * 20, life: 0.25, size0: this.stack === "ship" ? 2.5 : 5, size1: 1.5, color0: FIRE, alpha: 0.9, drag: 2 });
  }

  _dustColor() {
    const dim = this.manager.world.dim;
    return dim === "moon" ? DUST_MOON : dim === "mars" ? DUST_MARS : DUST_EARTH;
  }

  // ---------- Coming down ----------

  _descent(dt, input) {
    const g = G * this.dimGravity;
    const w = this.manager;
    const ground = w.groundBelow(this.pos.x, this.pos.y + 1, this.pos.z);
    const agl = Math.max(0, this.pos.y - ground);
    this.agl = agl;
    const tmax = Math.max(2.4 * g, 16);
    const keys = input?.keys;
    let thr = this.throttle;
    let tx = this.tilt.x;
    let tz = this.tilt.y;
    if (this.autopilot || !input) {
      // Down at a speed that slows with the height, then gently onto the
      // ground; across toward the target, slowing to rest over it.
      const vt = agl < 2.5 ? -1.2 : -Math.max(2.2, Math.min(45, 0.25 * agl + 1.5));
      const ay = g + (vt - this.vel.y) * 1.8;
      let hx = 0;
      let hz = 0;
      if (this.target && agl > 6) {
        const dx = this.target.x - this.pos.x;
        const dz = this.target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const vmax = Math.min(18, d * 0.25);
        hx = d > 0.5 ? (dx / d) * vmax : 0;
        hz = d > 0.5 ? (dz / d) * vmax : 0;
      }
      const ax = (hx - this.vel.x) * 0.9;
      const az = (hz - this.vel.z) * 0.9;
      thr = Math.max(0, Math.min(1, Math.hypot(ax, ay, az) / tmax));
      if (agl > 120 && this.vel.y > vt - 2) thr = Math.min(thr, 0.15); // (falling first: the burn comes lower)
      const lim = agl < 4 ? 0.06 : MAX_TILT;
      tx = Math.max(-lim, Math.min(lim, Math.atan2(az, Math.max(1, ay))));
      tz = Math.max(-lim, Math.min(lim, -Math.atan2(ax, Math.max(1, ay))));
    } else {
      if (keys.has("Space")) thr = Math.min(1, thr + dt * 0.9);
      if (keys.has("ShiftLeft") || keys.has("ShiftRight")) thr = Math.max(0, thr - dt * 0.9);
      // W/S/A/D tilt it the way the camera looks (back to upright when let go)
      const fw = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      const rt = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const cy = Math.cos(this.camYaw);
      const sy = Math.sin(this.camYaw);
      // (the camera looks along -Z rotated by camYaw: forward (-sy, -cy), right (cy, -sy))
      const wantX = (-sy * fw + cy * rt) * MAX_TILT;
      const wantZ = (-cy * fw - sy * rt) * MAX_TILT;
      tx += (wantZ - tx) * Math.min(1, dt * 2.5);
      tz += (-wantX - tz) * Math.min(1, dt * 2.5);
    }
    this.throttle += (thr - this.throttle) * Math.min(1, dt * 6);
    this.tilt.x += (tx - this.tilt.x) * Math.min(1, dt * 3);
    this.tilt.y += (tz - this.tilt.y) * Math.min(1, dt * 3);
    this.q.setFromEuler(_e.set(this.tilt.x, 0, this.tilt.y, "XYZ")).multiply(_q.setFromAxisAngle(UP, this.yaw));
    const up = this._up(_v);
    const acc = tmax * this.throttle;
    this.vel.addScaledVector(up, acc * dt);
    this.vel.y -= g * dt;
    // (a thin drag on Earth and Mars: the entry's speed bleeds off)
    if (!this.manager.world.dimInfo?.airless) this.vel.multiplyScalar(Math.exp(-dt * 0.04));
    this.pos.addScaledVector(this.vel, dt);
    this.power.ship = this.throttle;
    this.power.core = this.power.boost = 0;
    this.legsK += ((agl < LEGS_AGL ? 1 : 0) - this.legsK) * Math.min(1, dt * 1.6);
    this.altK = this.manager.world.dim === "overworld" ? smooth(90, 620, agl) : 1;
    if (this.throttle > 0.05) this._landingDust(dt, agl);
    if (this.throttle > 0.05) this._exhaust(dt);
    // Touchdown?
    const g2 = w.groundBelow(this.pos.x, this.pos.y + 1, this.pos.z);
    if (this.pos.y <= g2) {
      this.pos.y = g2;
      const tilt = Math.hypot(this.tilt.x, this.tilt.y);
      const vy = -this.vel.y;
      if (vy <= LAND_SPEED && tilt <= LAND_TILT && this.legsK > 0.5) this._touchdown();
      else this._crash(vy);
    }
  }

  _touchdown() {
    this.phase = "landed";
    this.t = 0;
    this.vel.set(0, 0, 0);
    this.tilt.set(0, 0);
    this.q.setFromAxisAngle(UP, this.yaw);
    this.throttle = 0;
    this.power.ship = 0;
    this.legsK = 1;
    this.sound.set(0);
    this.name = "Ship";
    const fx = this.manager.effects;
    if (fx?.smoke) {
      const c = this._dustColor();
      for (let i = 0; i < 40 * Math.max(0.3, effectsQuality.scale); i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 10;
        fx.smoke.spawn({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z, vx: Math.cos(a) * sp, vy: Math.random() * 1.5, vz: Math.sin(a) * sp, life: 3 + Math.random() * 2, size0: 1.5, size1: 6, color0: c, alpha: 0.7, drag: 1.4 });
      }
    }
    this._say("touchdown", this.manager.world.dim === "moon" ? "Touchdown. The Eagle has landed" : "Touchdown confirmed");
    ROCKET_HOOKS.space?.landed?.(this);
  }

  _crash(vy) {
    ROCKET_HOOKS.space?.caption?.(`Crashed at ${Math.round(vy * 3.6)} km/h`, "big", 3);
    const fx = this.manager.effects;
    const at = this.pos.clone();
    at.y += 2;
    // (a ship going down: a blast; the ground is the game's to break as any crash)
    fx?.explode?.(at, { radius: 4.5, source: "vehicle", carve: true });
    this.manager.destroy(this, "crash");
  }

  // Dust blown out over the ground under the engine (more the lower it is).
  _landingDust(dt, agl) {
    if (agl > 30) return;
    const fx = this.manager.effects;
    if (!fx?.smoke) return;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    const q = Math.max(0.3, effectsQuality.scale);
    this.smokeT = 0.04 / q;
    const k = (1 - agl / 30) * this.throttle;
    const c = this._dustColor();
    const gy = this.pos.y - agl;
    for (let i = 0; i < 1 + Math.round(4 * k); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + 12 * k + Math.random() * 6;
      fx.smoke.spawn({ x: this.pos.x + Math.cos(a) * 1.5, y: gy + 0.4, z: this.pos.z + Math.sin(a) * 1.5, vx: Math.cos(a) * sp, vy: 0.3 + Math.random(), vz: Math.sin(a) * sp, life: 1.6 + Math.random() * 1.5, size0: 1.2, size1: 5 + 4 * k, color0: c, alpha: 0.55 + 0.3 * k, drag: 1.2 });
    }
  }

  _exhaust(dt) {
    const fx = this.manager.effects;
    if (!fx?.glow) return;
    this.fxT -= dt;
    if (this.fxT > 0) return;
    this.fxT = 0.05 / Math.max(0.3, effectsQuality.scale);
    const up = this._up(_v);
    const p = _v2.copy(this.pos).addScaledVector(up, 0.4);
    fx.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: -up.x * 14 + this.vel.x, vy: -up.y * 14 + this.vel.y, vz: -up.z * 14 + this.vel.z, life: 0.25, size0: 1.6 * this.throttle + 0.4, size1: 0.6, color0: FIRE, alpha: 0.9, drag: 1.5 });
  }

  // ---------- Drawing ----------

  _animate(dt) {
    const m = this.model;
    if (m.stack !== this.stack) m.setStack(this.stack);
    if (Math.abs(m.legsK - this.legsK) > 0.001) m.setLegs(this.legsK);
    const vac = this.manager.world.dimInfo?.airless ? 1 : this.altK;
    m.setFlames(this.power, this.time, vac);
    this.root.visible = this.phase !== "orbit" && this.manager.enabled !== false;
    // light: the sky's where it stands (the flames light it from below)
    const w = this.manager.world;
    const l = w.lightAt ? w.lightAt(this.pos.x, this.pos.y + 4, this.pos.z) : null;
    m.light.sky = l ? l.sky : 15;
    m.light.block = Math.max(l ? l.block : 0, Math.round(12 * Math.max(this.power.core, this.power.ship, this.power.boost)));
    if (this.tower) {
      const tl = w.lightAt ? w.lightAt(this.pad[0], this.pad[1] + 10, this.pad[2]) : null;
      this.tower.light.sky = tl ? tl.sky : 15;
      this.tower.light.block = Math.round(10 * this.power.core);
    }
    // the sound: the rider inside hears it muffled
    const lvl = Math.max(this.power.core, this.power.boost, this.power.ship);
    const l2 = this.manager.effects?.listener;
    const inside = this === this.manager.active;
    this.sound.set(this.root.visible ? lvl : 0, inside ? 0 : l2 ? l2.distanceTo(this.pos) : 0, inside, w.dimInfo?.airless ? 1 : this.altK * 0.6);
  }

  _wreck(dt) {
    this.power.core = this.power.boost = this.power.ship = 0;
    this.sound.set(0);
    this.root.visible = false;
    if (this.removeAt === undefined) this.removeAt = 0.5;
  }

  onDestroyed() {
    this.sound.stop();
    this.root.visible = false;
    const fx = this.manager.effects;
    if (fx?.glow) {
      for (let i = 0; i < 30; i++) fx.glow.spawn({ x: this.pos.x + rand(-2, 2), y: this.pos.y + rand(0, this.height * 0.6), z: this.pos.z + rand(-2, 2), vx: rand(-8, 8), vy: rand(-2, 10), vz: rand(-8, 8), life: 1.2, size0: 5, size1: 9, color0: FIRE, alpha: 0.9, drag: 1.2 });
    }
  }

  // ---------- Camera ----------

  _defaultDist() {
    return this.stack === "ship" ? 22 : 46;
  }

  _camMode() {
    const m = this.cameraModes[this.cameraMode];
    if (m !== "auto") return m;
    if (this.phase === "count" || (this.phase === "ascent" && this.t < 7)) return this.pad && this.stack !== "ship" ? "ground" : "chase";
    if (this.phase === "ascent" && this.t > 16 && this.t < 22) return "onboard";
    return "chase";
  }

  updateCamera(camera, dt) {
    const mode = this._camMode();
    const mid = _v.copy(this._up(_v3)).multiplyScalar(this.height * 0.55).add(this.pos);
    if (mode === "ground" && this.pad) {
      // (a fixed camera out on the field, tracking the rocket: zooming in as it climbs)
      const a = this.yaw + Math.PI * 0.62;
      const d = 62;
      camera.position.set(this.pad[0] + Math.sin(a) * d, this.pad[1] + 4, this.pad[2] + Math.cos(a) * d);
      const gy = this.manager.groundBelow(camera.position.x, camera.position.y + 30, camera.position.z);
      camera.position.y = Math.max(camera.position.y, gy + 2.5);
      camera.lookAt(mid);
      const want = THREE.MathUtils.clamp(70 - (this.pos.y - this.pad[1]) * 0.25, 22, 70);
      if (Math.abs(camera.fov - want) > 0.3) {
        camera.fov += (want - camera.fov) * Math.min(1, dt * 2);
        camera.updateProjectionMatrix();
      }
      this._fovSet = true;
      return;
    }
    if (this._fovSet) {
      this._fovSet = false;
      camera.fov = this.manager.player.fov || 70;
      camera.updateProjectionMatrix();
    }
    if (mode === "onboard") {
      // (on the ship's side, looking down along the body at the ground falling away)
      const up = this._up(_v3);
      const side = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(this.stack === "ship" ? 3.4 : 4.6);
      camera.position.copy(this.pos).addScaledVector(up, this.height - (this.stack === "ship" ? 5 : 9)).add(side);
      _v.copy(camera.position).addScaledVector(up, -40).addScaledVector(side, -0.55);
      camera.up.copy(up);
      camera.lookAt(_v);
      camera.up.set(0, 1, 0);
      return;
    }
    const dist = this.camDist ?? this._defaultDist();
    const cp = Math.cos(this.camPitch);
    camera.position.set(mid.x + Math.sin(this.camYaw) * cp * dist, mid.y - Math.sin(this.camPitch) * dist, mid.z + Math.cos(this.camYaw) * cp * dist);
    const gy = this.manager.groundBelow(camera.position.x, camera.position.y + 2, camera.position.z);
    if (camera.position.y < gy + 1.5) camera.position.y = gy + 1.5;
    camera.lookAt(mid);
  }

  // ---------- The panel ----------

  hud() {
    const rows = [];
    const alt = Math.max(0, Math.round(this.agl ?? 0));
    const kmh = Math.round(this.vel.length() * 3.6);
    let help = "F get out · I info · F5 camera";
    if (this.phase === "pad" || this.phase === "landed") {
      rows.push(["Status", this.phase === "pad" ? "On the pad" : "Landed"]);
      help = `Space ${this.phase === "pad" ? "countdown" : "lift off"} · ${help}`;
    } else if (this.phase === "count") {
      rows.push(["T-minus", `${Math.ceil(this.count)} s`]);
      help = "Backspace stop · F get out";
    } else if (this.phase === "ascent") {
      rows.push(["Altitude", `${alt} m`], ["Speed", `${kmh} km/h`], ["Stage", this.stack === "full" ? "1 (boosters)" : this.stack === "core" ? "1 (core)" : "Ship"]);
      help = "F bail out · F5 camera";
    } else if (this.phase === "descent") {
      rows.push(["Height", `${alt} m`], ["Descent", `${Math.round(-this.vel.y)} m/s`], ["Drift", `${Math.round(Math.hypot(this.vel.x, this.vel.z))} m/s`], ["Pilot", this.autopilot ? "Autopilot" : "Manual"]);
      help = "Space/Shift throttle · W A S D tilt · R autopilot · F bail out";
    }
    const warn = this.phase === "descent" && this.agl < 40 && -this.vel.y > LAND_SPEED + 2 ? "SINK RATE" : null;
    return { title: this.name, rows, bars: this.phase === "descent" || this.phase === "ascent" ? [{ label: "Throttle", value: this.throttle }] : [], warning: warn, help, health: this.health / this.maxHealth };
  }

  infoPanel() {
    return {
      title: "Rocket",
      stats: [
        ["Stages", "4 boosters, the core, the ship (lands on its legs)"],
        ["To orbit", "about 30 s from the pad (13 s from the Moon or Mars)"],
        ["Where to", "the Moon (1/6 gravity), Mars (0.38), back to Earth"],
        ["Landing", `under ${LAND_SPEED} m/s, upright`],
      ],
      controls: [
        ["Space", "countdown / lift off (descent: more throttle)"],
        ["Backspace", "stop the countdown"],
        ["Shift", "less throttle (descent)"],
        ["W A S D", "tilt (descent)"],
        ["R", "autopilot on / off"],
        ["F5", "camera"],
        ["F", "get out (in flight: bail out)"],
      ],
    };
  }

  // ---------- Online ----------

  netState(s) {
    s.q = this.q.toArray().map((x) => Math.round(x * 1000) / 1000);
    s.rk = [STACKS.indexOf(this.stack), PHASES.indexOf(this.phase), Math.round(this.throttle * 100) / 100, Math.round(this.legsK * 100) / 100, Math.round(this.count * 10) / 10, this.tower ? 1 : 0, Math.round((this.agl ?? 0) * 10) / 10];
    s.y = Math.round(this.yaw * 1000) / 1000;
  }

  netPuppet(st, dt) {
    this.time += dt;
    if (st) {
      if (Array.isArray(st.q) && st.q.length === 4) this.q.fromArray(st.q).normalize();
      if (Number.isFinite(st.y)) this.yaw = st.y;
      const r = st.rk;
      if (Array.isArray(r)) {
        const stack = STACKS[r[0]] || this.stack;
        if (stack !== this.stack) {
          if (this.stack === "full" && stack !== "full") ROCKET_HOOKS.space?.dropBoosters?.(this);
          this.stack = stack;
        }
        const phase = PHASES[r[1]] || this.phase;
        if (phase !== this.phase) this.t = 0;
        this.phase = phase;
        this.throttle = r[2] || 0;
        this.legsK = r[3] || 0;
        this.count = r[4] || 0;
        if (!r[5] && this.tower && this.phase !== "pad" && this.phase !== "count" && this.phase !== "ascent") this._removeTower();
        this.agl = r[6] || 0;
      }
    }
    this.t += dt;
    const p = this.phase;
    const lvl = p === "ascent" ? 1 : p === "count" ? (this.count <= IGNITION ? this.throttle : 0) : p === "descent" ? this.throttle : 0;
    this.power.core = this.stack !== "ship" ? lvl : 0;
    this.power.boost = this.stack === "full" ? lvl : 0;
    this.power.ship = this.stack === "ship" ? lvl : 0;
    this.altK = this.manager.world.dim === "overworld" ? smooth(90, 620, this.agl ?? 0) : 1;
    if (this.tower && p === "count") this.tower.setArms(Math.min(1, (6.5 - this.count) / 3));
    if (this.tower && p === "ascent") this.tower.setArms(1);
    if (p === "count" && this.count <= IGNITION) this._padSmoke(dt, 1);
    if (p === "ascent") {
      if (this.t < 6) this._padSmoke(dt, 1);
      this._trail(dt);
    }
    if (p === "descent" && this.throttle > 0.05) this._landingDust(dt, this.agl ?? 99);
    this._pose();
    this._animate(dt);
  }

  // ---------- Saving ----------

  serialize() {
    const d = { ...super.serialize(), stack: this.stack, yaw: Math.round(this.yaw * 1000) / 1000 };
    if (this.pad) d.pad = this.pad.map((v) => Math.round(v * 100) / 100);
    // (saved in flight: back on its pad if it has one and was climbing, else on the ground below)
    const flying = this.phase === "ascent" || this.phase === "count" || this.phase === "orbit" || this.phase === "descent";
    if (flying && this.pad && this.phase !== "descent") {
      d.pos = this.pad.slice();
      d.stack = this.stack === "ship" ? "ship" : "full";
      d.phase = d.stack === "ship" ? "landed" : "pad";
      d.tower = d.stack === "full";
    } else if (flying) {
      d.stack = "ship";
      d.phase = "landed";
      const g = this.manager.groundBelow(this.pos.x, Math.min(this.pos.y, WORLD_HEIGHT), this.pos.z);
      d.pos = [Math.round(this.pos.x * 100) / 100, g, Math.round(this.pos.z * 100) / 100];
    } else {
      d.phase = this.phase;
      d.tower = !!this.tower;
    }
    return d;
  }

  dispose() {
    super.dispose();
    this._removeTower();
    this.sound.stop();
    this.model.dispose();
  }
}

const SMOKE0 = new THREE.Color(0.86, 0.85, 0.84);
const SMOKE1 = new THREE.Color(0.62, 0.61, 0.6);
const FIRE = new THREE.Color(3.2, 1.9, 0.7);
const DUST_MOON = new THREE.Color(0.52, 0.52, 0.53);
const DUST_MARS = new THREE.Color(0.62, 0.33, 0.2);
const DUST_EARTH = new THREE.Color(0.55, 0.5, 0.44);

VehicleManager.register("rocket", Rocket);

// Creative's rocket (the pause menu's call-in, `ground`: on its new pad a few
// blocks ahead, the player straight in it; the Vehicles tab's item: on the
// ground aimed at). Never summoned into the sky.
VehicleManager.registerSummon("rocket", {
  type: "rocket",
  alt: 0,
  ground: true,
  data: () => ({ stack: "full" }),
});
