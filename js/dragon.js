// The End's fight and the things around it (Round 12): the Ender Dragon
// (its model, its flight, its attacks, its death), the end crystals (on the
// pillars, and the ones players place: four round the exit portal summon a
// new dragon), the dragon's breath (clouds that hurt, bottled with a glass
// bottle), the boss bar, the end portals' and gateways' starfield, the eyes
// of ender thrown toward a stronghold, the gateways' travel to the outer
// islands, chorus fruit's teleport, the dragon egg's escape, and the chorus
// plants' fall when they lose their hold. main.js makes one EndGame and
// calls update(dt) every frame; its state is saved in the player's save
// (serialize / load) and shared online (EndSync, below).
//
// As vanilla's (Java 1.20), simplified where noted:
// - The dragon: 200 health. It circles the pillars (HoldingPattern: from
//   node to node, two rings of them), and at each node it may land (one
//   chance in crystals + 3) or go for the nearest player (strafing: a
//   dragon fireball when it faces them from 10-64 blocks). Landed on the
//   exit portal it looks round (scanning), roars, and breathes its fire (a
//   cloud of dragon's breath, radius 5, 10 s), up to four times, then takes
//   off; 50 damage while landed puts it in the air at once. With nobody
//   near for 5 s it takes off and charges the nearest player. A blow to its
//   head counts in full, anywhere else a quarter plus one; arrows glance off
//   it while it sits. Its wings fling players aside (5 damage), its head
//   bites (10), by difficulty (it hurts on Peaceful too, as Easy).
// - The crystals: the nearest one within 32 blocks heals it 1 every half
//   second (the beam); a crystal hit by anything explodes (power 6); the one
//   that was healing it costs it 10.
// - Its fireball bursts into a cloud (radius 3 growing to 7 over 30 s); a
//   cloud hurts 6 a second (instant damage II at a cloud's half strength,
//   through armour). A glass bottle in one: dragon's breath (the cloud
//   shrinks by half a block).
// - Its death: 10 s rising in light beams, then 12,000 experience the first
//   time (500 after; online every player in the End gets theirs: each
//   player's orbs are their own), the exit portal opens, the egg on its top
//   the first time, the next of the 20 gateways.
// - Gateways: into one (on foot, or an ender pearl thrown into it) and you
//   are sent 1024 blocks out the same way, to the nearest outer island
//   along it (a small island is made when there is none), where an exit
//   gateway appears ten blocks over the ground; it brings you back.
// - Eyes of ender (vanilla's EyeOfEnder): toward the nearest stronghold's
//   start, up to 12 blocks a throw, rising 8 (or down to it when close),
//   for 4 s; then dropped (4 in 5) or shattered.
// Online (js/dimensions.js's rule: the host simulates its own dimension, a
// dimension the host is not in is the lowest player number's there): the
// peer that simulates the End flies the dragon and the crystals and tells
// everyone ("edr" its pose 10 times a second, "eds" the fight's state,
// "edf" what it does: fireballs, clouds, crystals bursting, its death);
// everyone else draws a puppet and sends hits as claims ("edh"). A dragon's
// bite, wings and clouds are judged by the player they reach. The host keeps
// the state (saved, given to joiners) whoever simulates it.
import * as THREE from "three";
import { BLOCK, BLOCK_INFO, IS_SOLID, IS_WET } from "./blocks.js";
import { LIB } from "./content/base.js";
import * as V from "./content/ids.js";
import { ITEM_USE } from "./content/index.js";
import { chorusSurvives, isChorus, teleportEgg } from "./content/end.js";
import { PORTAL_BLOCKS, OVERWORLD, END, DIMS } from "./dim-registry.js";
import { podiumCells } from "./dim-end.js";
import { gatewayOrder, gatewayCells, GATEWAY_RING, OUTER_START } from "./end-structures.js";
import { StrongholdGrower } from "./stronghold.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";
import { itemModel } from "./models.js";
import { LAYER_FX } from "./layers.js";
import { HOST_PID } from "./net/session.js";
import { Interp, r2, r1 } from "./net/interp.js";
import { isVanilla } from "./worldtype.js";
import { makeStack } from "./inventory.js";

const PX = 1 / 16;
export const DRAGON_HP = 200;
const SPAWN_AT = [0, 100, 0]; // (vanilla's 0, 128, 0, under this world's 128 ceiling)
const FIGHT_RADIUS = 192; // blocks from the middle the boss bar shows within
const HEAL_RANGE = 32;
const SIT_DAMAGE_TAKEOFF = 50;
const CRYSTAL_POWER = 6;
const BREATH_DAMAGE = 6;
const PHASES = ["hold", "strafe", "charge", "approach", "land", "scan", "roar", "flame", "takeoff", "dying", "gone"];
const SITTING = new Set(["land", "scan", "roar", "flame"]);
const SNAP_RATE = 10;
const STATE_RATE = 2; // s between the state's resends while the fight is on
const EYE_LIFE = 80; // ticks
const TICK = 0.05;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

function wrapAngle(a) {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The ray's distance to an axis-aligned box, or null (slab method).
function rayBox(o, d, min, max, reach) {
  let t0 = 0;
  let t1 = reach;
  for (const a of ["x", "y", "z"]) {
    const inv = 1 / (d[a] || 1e-9);
    let ta = (min[a] - o[a]) * inv;
    let tb = (max[a] - o[a]) * inv;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

// ---------- Geometry: boxes with colours (one draw per part) ----------

class Boxes {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }
  // A box centred at (cx, cy, cz), size (sx, sy, sz) blocks, in `hex`; the
  // faces a little lighter on top and darker below (the scales' sheen).
  box(cx, cy, cz, sx, sy, sz, hex) {
    const c = new THREE.Color(hex);
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const quad = (a, b, cc, d, n, k) => {
      for (const p of [a, b, cc, a, cc, d]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(c.r * k, c.g * k, c.b * k);
      }
    };
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0.9);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0.9);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 1.15);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 0.7);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 1);
    return this;
  }
  // A flat membrane in the x-z plane at height y, from (x0, z0) to (x1, z1).
  sheet(x0, z0, x1, z1, y, hex) {
    const c = new THREE.Color(hex);
    for (const p of [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z0], [x1, y, z1], [x0, y, z1]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(0, 1, 0);
      this.col.push(c.r, c.g, c.b);
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- The dragon's model ----------

// Vanilla's EnderDragonModel in its sizes (16 to a block): a body 24 x 24 x
// 64, five neck segments and twelve tail segments of 10 (each with its
// scale), the head 16 x 16 x 16 with its snout, jaw and glowing eyes, wings
// of two 56-long bones with their membranes (about 15 blocks across), four
// legs folded back in flight.
// (vanilla's texture: near black with grey scales; these are sRGB, so not too dark)
const BLACK = 0x2a2630;
const SCALE = 0x575160;
const BONE = 0x302c36;
const SKIN = 0x3e3946;
const FINGER = 0x24212a;
const EYE = new THREE.Color(3.2, 1.1, 4.2);
class DragonModel {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.rotation.order = "YXZ";
    this.mat = createEntityMaterial("color");
    this.skin = createEntityMaterial("color", null, { side: THREE.DoubleSide });
    // (a little light of its own: the End's dim ambient would leave a black shape)
    this.mat.uniforms.uFill.value = 0.6;
    this.skin.uniforms.uFill.value = 0.6;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: EYE, toneMapped: false });
    this.light = { sky: 15, block: 0, flash: null };
    const mesh = (b, mat = this.mat) => new THREE.Mesh(b.geometry(), mat);
    // The body, its three scales along the back.
    const body = new Boxes().box(0, 0, 0, 1.5, 1.5, 4, BLACK);
    for (const z of [-1.25, 0, 1.25]) body.box(0, 0.75 + 3 * PX, z, 2 * PX, 6 * PX, 12 * PX, SCALE);
    this.body = mesh(body);
    this.root.add(this.body);
    // The neck and the tail: chains of segments (posed every frame).
    const seg = () => new Boxes().box(0, 0, 0, 10 * PX, 10 * PX, 10 * PX, BLACK).box(0, 5 * PX + 2 * PX, 0, 2 * PX, 4 * PX, 6 * PX, SCALE);
    const segGeo = seg().geometry();
    this.neck = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(segGeo, this.mat);
      this.root.add(m);
      this.neck.push(m);
    }
    this.tail = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(segGeo, this.mat);
      this.root.add(m);
      this.tail.push(m);
    }
    // The head: skull, snout with nostrils, horns, the jaw on its hinge, the eyes.
    this.head = new THREE.Group();
    this.head.rotation.order = "YXZ";
    const skull = new Boxes().box(0, 0, 0, 1, 1, 1, BLACK).box(0, -3 * PX, 0.5 + 8 * PX, 12 * PX, 5 * PX, 16 * PX, BLACK);
    for (const s of [-1, 1]) {
      skull.box(s * 3 * PX, 0.5 + 2 * PX, -2 * PX, 2 * PX, 4 * PX, 6 * PX, SCALE); // horns
      skull.box(s * 3 * PX, -0.5 * PX + 1 * PX, 0.5 + 14 * PX, 2 * PX, 2 * PX, 4 * PX, SCALE); // nostrils
    }
    this.head.add(mesh(skull));
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -6 * PX, 0.5);
    this.jaw.add(mesh(new Boxes().box(0, -2 * PX, 8 * PX, 12 * PX, 4 * PX, 16 * PX, BLACK)));
    this.head.add(this.jaw);
    const eyes = new Boxes().box(-0.5 - 0.1 * PX, 2 * PX, 2 * PX, 0.4 * PX, 2 * PX, 6 * PX, 0xffffff).box(0.5 + 0.1 * PX, 2 * PX, 2 * PX, 0.4 * PX, 2 * PX, 6 * PX, 0xffffff);
    this.head.add(new THREE.Mesh(eyes.geometry(), this.eyeMat));
    this.root.add(this.head);
    // The wings: a bone and its membrane, then the tip's.
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(s * 0.75, 0.5, 1.0);
      const arm = new Boxes().box(s * 1.75, 0, 0, 3.5, 8 * PX, 8 * PX, BONE);
      wing.add(mesh(arm));
      const web = new Boxes().sheet(0, 0, s * 3.5, -3.5, 0, SKIN);
      // (the membrane's fingers, back from the bone)
      for (const x of [1.1, 2.3]) web.box(s * x, -1 * PX, -1.75, 1.5 * PX, 1.5 * PX, 3.5, FINGER);
      wing.add(mesh(web, this.skin));
      const tip = new THREE.Group();
      tip.position.set(s * 3.5, 0, 0);
      tip.add(mesh(new Boxes().box(s * 1.75, 0, 0, 3.5, 4 * PX, 4 * PX, BONE)));
      const tipWeb = new Boxes().sheet(0, 0, s * 3.5, -3.5, 0, SKIN);
      for (const x of [1.2, 2.5]) tipWeb.box(s * x, -1 * PX, -1.75, 1.5 * PX, 1.5 * PX, 3.5, FINGER);
      tip.add(mesh(tipWeb, this.skin));
      wing.add(tip);
      this.root.add(wing);
      this.wings.push({ wing, tip, s });
    }
    // The legs: thigh, shin and foot in one, swung from the hip.
    this.legs = [];
    for (const [x, y, z, big] of [[-0.75, -0.55, 1.1, 0], [0.75, -0.55, 1.1, 0], [-1.0, -0.4, -1.4, 1], [1.0, -0.4, -1.4, 1]]) {
      const k = big ? 1.6 : 1;
      const b = new Boxes()
        .box(0, (-12 * PX) * k, 0, 8 * PX * k, 24 * PX * k, 8 * PX * k, BLACK)
        .box(0, (-24 * PX - 12 * PX) * k, -2 * PX * k, 6 * PX * k, 24 * PX * k, 6 * PX * k, BLACK)
        .box(0, (-48 * PX - 2 * PX) * k, 4 * PX * k, 8 * PX * k, 4 * PX * k, 16 * PX * k, SCALE);
      const leg = mesh(b);
      leg.position.set(x, y, z);
      this.root.add(leg);
      this.legs.push(leg);
    }
    bindEntityLight(this.root, () => this.light);
    this.root.visible = false;
    scene.add(this.root);
    this.flap = 0;
    this.time = 0;
  }

  // Poses the model: s = { p: [x, y, z], y (yaw), pi (pitch), r (roll),
  // ph (phase), j (jaw 0-1), speed, dt (dying time) }.
  pose(s, dt, light) {
    const root = this.root;
    root.visible = true;
    this.time += dt;
    root.position.set(s.p[0], s.p[1], s.p[2]);
    const dying = s.ph === "dying";
    // (it turns slowly as it rises, from where it faced: not on its way back to the portal)
    this.spin = dying && s.dt > 0 ? (this.spin || 0) + dt * 0.6 : 0;
    root.rotation.set(s.pi, s.y + this.spin, s.r);
    const sitting = SITTING.has(s.ph);
    // (the wings beat faster climbing and slowly while gliding down; held
    // half folded when sitting)
    this.flap += dt * (sitting ? 1.4 : dying ? 2.2 : 3.4 + Math.max(0, s.vy || 0) * 0.25);
    const f = this.flap;
    for (const w of this.wings) {
      const lift = sitting ? 0.32 + Math.sin(f) * 0.08 : Math.sin(f) * 0.62 + 0.08;
      w.wing.rotation.set(0, 0, w.s * lift);
      w.tip.rotation.set(0, 0, w.s * (sitting ? -0.75 : Math.sin(f - 0.9) * 0.55 + 0.25));
    }
    // The neck: from the body's front toward the head, bending down to look at
    // what it breathes on when sitting.
    const neckPitch = sitting ? -0.55 - (s.ph === "flame" ? 0.25 : 0) : -0.05 + Math.sin(f * 0.5) * 0.04;
    let px = 0;
    let py = 0.25;
    let pz = 2.0 + 5 * PX;
    for (let i = 0; i < 5; i++) {
      const a = (neckPitch * (i + 1)) / 5;
      px += 0;
      py += Math.sin(a) * 10 * PX;
      pz += Math.cos(a) * 10 * PX;
      const m = this.neck[i];
      m.position.set(px, py, pz);
      m.rotation.set(-a, 0, 0);
    }
    const ha = neckPitch * 1.2;
    this.head.position.set(px, py + Math.sin(ha) * 0.8, pz + Math.cos(ha) * 0.8);
    this.head.rotation.set(-ha, 0, 0);
    this.jaw.rotation.set((s.j || 0) * 0.55, 0, 0);
    // The tail: swaying behind, lower when sitting.
    let tx = 0;
    let ty = 0.1;
    let tz = -2.0 - 5 * PX;
    for (let i = 0; i < 12; i++) {
      const sway = Math.sin(this.time * 1.7 - i * 0.45) * 0.06 * (i + 1);
      const droop = sitting ? -0.05 * i : 0.02 * Math.sin(f * 0.5 + i * 0.3);
      tx += Math.sin(sway) * 10 * PX;
      ty += Math.sin(droop) * 10 * PX;
      tz -= Math.cos(sway) * 10 * PX;
      const m = this.tail[i];
      m.position.set(tx, ty, tz);
      m.rotation.set(0, sway, 0);
      const k = 1 - i * 0.035;
      m.scale.setScalar(k);
    }
    for (let i = 0; i < 4; i++) this.legs[i].rotation.set(sitting ? 0.25 : 1.3, 0, 0);
    this.light.sky = light.sky;
    this.light.block = light.block;
    this.light.flash = s.flash || null;
    this.light.glow = dying ? Math.min(1, (s.dt || 0) / 8) : 0;
    root.updateMatrixWorld(true);
  }

  hide() {
    this.root.visible = false;
  }

  // The hit boxes (world, after pose()): [{ part, c: Vector3, h: half size }]
  // (head, body and neck, wings, tail), the same objects every time.
  boxes(out) {
    if (!this._boxes) {
      const at = (obj, x, y, z, part, h) => ({ obj, l: new THREE.Vector3(x, y, z), part, h, c: new THREE.Vector3() });
      this._boxes = [at(this.head, 0, 0, 0.4, "head", 1.1), at(this.body, 0, 0, 0, "body", 2.2), at(this.neck[2], 0, 0, 0, "body", 0.8)];
      for (const w of this.wings) this._boxes.push(at(w.wing, w.s * 2.2, 0, -1.4, "wing", 1.8), at(w.tip, w.s * 2.0, 0, -1.6, "wing", 1.6));
      for (const i of [1, 4, 7]) this._boxes.push(at(this.tail[i], 0, 0, 0, "tail", 0.9));
    }
    out.length = 0;
    for (const b of this._boxes) {
      b.obj.localToWorld(b.c.copy(b.l));
      out.push(b);
    }
    return out;
  }

  headPos(out = new THREE.Vector3()) {
    return this.head.localToWorld(out.set(0, -0.1, 1.2));
  }
}

// ---------- End crystals (their look) ----------

const CRYSTAL_CORE = new THREE.Color(3.4, 0.7, 2.2);
const CRYSTAL_EDGE = new THREE.Color(2.4, 1.8, 3.2);
const BEAM = new THREE.Color(2.6, 1.5, 3.4);
class CrystalLook {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cube = new THREE.BoxGeometry(1, 1, 1);
    this.edges = new THREE.EdgesGeometry(this.cube);
    this.glass = new THREE.MeshBasicMaterial({ color: 0xc8a8f0, transparent: true, opacity: 0.18, depthWrite: false });
    this.edgeMat = new THREE.LineBasicMaterial({ color: CRYSTAL_EDGE, toneMapped: false });
    this.coreMat = new THREE.MeshBasicMaterial({ color: CRYSTAL_CORE, toneMapped: false });
    this.baseMat = createEntityMaterial("color");
    this.baseGeo = new Boxes().box(0, 2 * PX, 0, 12 * PX, 4 * PX, 12 * PX, 0x3a3a3e).box(0, 2 * PX, 0, 14 * PX, 2 * PX, 14 * PX, 0x26262a).geometry();
    this.beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.views = new Map(); // key -> view
  }

  _make() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(this.baseGeo, this.baseMat);
    bindEntityLight(base, () => ({ sky: 15, block: 8 }));
    g.add(base);
    const spin = new THREE.Group();
    spin.position.y = 1.2;
    const outer = new THREE.Group();
    outer.add(new THREE.Mesh(this.cube, this.glass), new THREE.LineSegments(this.edges, this.edgeMat));
    const mid = new THREE.Group();
    mid.scale.setScalar(0.72);
    mid.add(new THREE.Mesh(this.cube, this.glass), new THREE.LineSegments(this.edges, this.edgeMat));
    const core = new THREE.Mesh(this.cube, this.coreMat);
    core.scale.setScalar(0.42);
    spin.add(outer, mid, core);
    g.add(spin);
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    beam.layers.set(LAYER_FX);
    beam.visible = false;
    beam.frustumCulled = false;
    g.add(beam);
    this.group.add(g);
    return { g, spin, outer, mid, core, beam, seen: true };
  }

  // list: [{ key, x, y, z (the crystal's foot), beamTo: Vector3 | null }].
  sync(list, t) {
    for (const v of this.views.values()) v.seen = false;
    for (const c of list) {
      let v = this.views.get(c.key);
      if (!v) this.views.set(c.key, (v = this._make()));
      v.seen = true;
      v.g.position.set(c.x, c.y, c.z);
      const ph = c.phase || 0;
      v.spin.position.y = 1.1 + Math.sin(t * 2.2 + ph) * 0.22;
      v.outer.rotation.set(t * 1.3 + ph, t * 1.7, 0.6);
      v.mid.rotation.set(-t * 1.9, t * 1.1 + ph, 0.3);
      v.core.rotation.set(t * 2.4, -t * 2.2, ph);
      if (c.beamTo) {
        const from = _v.set(c.x, c.y + v.spin.position.y, c.z);
        const d = _w.copy(c.beamTo).sub(from);
        const len = d.length();
        v.beam.visible = len > 0.5;
        v.beam.position.set(0, v.spin.position.y, 0);
        v.beam.scale.set(1 + Math.sin(t * 20) * 0.25, 1 + Math.sin(t * 17) * 0.25, len);
        v.beam.lookAt(c.beamTo);
      } else v.beam.visible = false;
    }
    for (const [k, v] of this.views) {
      if (v.seen) continue;
      this.group.remove(v.g);
      this.views.delete(k);
    }
  }

  clear() {
    for (const v of this.views.values()) this.group.remove(v.g);
    this.views.clear();
  }
}

// ---------- The end portal's and the gateway's starfield ----------
// Vanilla's look: layers of stars in the screen's space (they stay put as
// the camera turns), teal, green and violet on near black, drifting.
const STAR_VERT = /* glsl */ `
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
}`;
const STAR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 sc = gl_FragCoord.xy / uRes.y;
  vec3 col = vec3(0.014, 0.022, 0.034) + vec3(0.01, 0.03, 0.03) * sin(sc.x * 3.0 + uTime * 0.05) * sin(sc.y * 2.0 - uTime * 0.04);
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float s = 3.0 + fi * 2.2;
    float a = fi * 1.31;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 uv = r * sc * s + vec2(uTime * (0.012 + fi * 0.004), uTime * 0.01 * (fi - 4.5));
    vec2 cell = floor(uv);
    vec2 f = fract(uv) - 0.5;
    float h = hash(cell + fi * 17.0);
    vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
    float d = length(f - off * 0.6);
    float star = smoothstep(0.13, 0.0, d) * step(0.62, h) + smoothstep(0.5, 0.0, d) * step(0.97, h) * 0.25;
    vec3 tint = mix(vec3(0.15, 0.55, 0.5), vec3(0.4, 0.25, 0.75), hash(vec2(fi, 2.0)));
    tint = mix(tint, vec3(0.2, 0.7, 0.3), step(0.8, hash(vec2(fi, 9.0))));
    col += star * tint * (1.25 - fi * 0.09);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
class StarPortals {
  constructor(scene) {
    this.material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.tops = new THREE.InstancedMesh(plane, this.material, 64);
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, 32);
    for (const m of [this.tops, this.cubes]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.key = "";
    this.gatewaysShown = [];
  }
  // portals: [[x, y, z], ...] (end portal blocks), gateways: the same (gateway blocks).
  set(portals, gateways) {
    const key = portals.join(";") + "|" + gateways.join(";");
    if (key === this.key) return;
    this.key = key;
    portals.slice(0, 64).forEach(([x, y, z], i) => this.tops.setMatrixAt(i, _m.makeTranslation(x + 0.5, y + 0.75, z + 0.5)));
    gateways.slice(0, 32).forEach(([x, y, z], i) => this.cubes.setMatrixAt(i, _m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)));
    this.gatewaysShown = gateways.slice(0, 32);
    this.tops.count = Math.min(64, portals.length);
    this.cubes.count = Math.min(32, gateways.length);
    this.tops.instanceMatrix.needsUpdate = true;
    this.cubes.instanceMatrix.needsUpdate = true;
  }
  update(t, renderer) {
    this.material.uniforms.uTime.value = t;
    if (renderer) renderer.getDrawingBufferSize(this.material.uniforms.uRes.value);
  }
}

// ---------- The End's sky ----------
// Vanilla's: no stars, no sun, a dark scratchy texture tiled on every side
// of a box round the view (end_sky, tinted). Drawn at the far plane right
// after the sky's dome (sky.js), over it; the terrain stays in front.
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
varying vec3 vDir;
void main() {
  vec3 d = vDir / max(abs(vDir.x), max(abs(vDir.y), abs(vDir.z)));
  vec2 uv = abs(d.y) > 0.999 ? d.xz : abs(d.x) > 0.999 ? d.zy : d.xy;
  vec3 c = texture2D(uMap, uv * 4.0).rgb * uTint;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
class EndSky {
  constructor(scene) {
    const N = 128;
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    let tex = null;
    if (canvas) {
      canvas.width = canvas.height = N;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(N, N);
      // A mottled ground, then scratches: short pale streaks every way.
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const v = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) v[i] = 0.34 + rnd() * 0.08;
      for (let k = 0; k < 700; k++) {
        let x = rnd() * N;
        let y = rnd() * N;
        const a = rnd() * Math.PI * 2;
        const len = 3 + rnd() * 9;
        const b = 0.06 + rnd() * 0.16;
        for (let t = 0; t < len; t++) {
          const i = ((Math.floor(y) % N + N) % N) * N + ((Math.floor(x) % N + N) % N);
          v[i] = Math.min(1, v[i] + b);
          x += Math.cos(a);
          y += Math.sin(a);
        }
      }
      for (let i = 0; i < N * N; i++) {
        const g = Math.round(v[i] * 255);
        img.data.set([g, g, g, 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.ShaderMaterial({ uniforms: { uMap: { value: tex }, uTint: { value: new THREE.Color(0.042, 0.036, 0.052) } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6 + 1; // (just after the dome: sky.js)
    this.mesh.visible = false;
    if (tex) scene.add(this.mesh);
  }
  update(visible, camera) {
    this.mesh.visible = visible;
    if (visible && camera) this.mesh.position.copy(camera.position);
  }
}

// ---------- The fight ----------

export class EndGame {
  // game: main.js's game object (world, player, scene, camera, mobs,
  // entities, effects, audio, inventory, interaction, weapons, xp, toast);
  // dims: the DimensionManager; mp: the multiplayer facade (or null);
  // renderer (for the starfield's screen size).
  constructor(game, { dims, mp = null, renderer = null } = {}) {
    this.game = game;
    this.world = game.world;
    this.player = game.player;
    this.dims = dims;
    this.mp = mp;
    this.renderer = renderer;
    this.enabled = isVanilla();
    this.state = null; // the fight (see _fresh); null: the End not visited yet
    this.d = null; // the dragon simulated here (the authority), or null
    this.puppet = null; // { interp, last } a dragon drawn from another peer's states
    this.clouds = []; // { x, y, z, r, grow, life, max, kind, tick }
    this.fireballs = []; // { pos, vel, life, mesh, mine }
    this.eyes = []; // eyes of ender in flight
    this.time = 0;
    this._snapT = 0;
    this._stateT = 0;
    this._scanT = 0;
    this._gatewayCool = 0;
    this._inGateway = false;
    this._pendingExit = null;
    this._hitBoxes = [];
    this._standIns = new Map();
    this.stats = { hits: 0, heals: 0, kills: 0 };
    if (!this.enabled) return;
    const scene = game.scene;
    this.model = new DragonModel(scene);
    this.crystalLook = new CrystalLook(scene);
    this.stars = new StarPortals(scene);
    this.beams = this._makeDeathBeams(scene);
    this.eyeMat = createEntityMaterial("color");
    this.fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 3.2), toneMapped: false });
    this.fireGeo = new THREE.SphereGeometry(0.45, 10, 8);
    this._bar = null;
    this.sky = new EndSky(scene);
    PORTAL_BLOCKS.set(V.END_PORTAL, "end");
    dims?.onChange?.push((dim, from) => this._dimChanged(dim, from));
    this._hookLib();
    this._hookCombat();
    this._hookWorld();
    this._hookElytra();
    this.sync = mp ? new EndSync(mp, this) : null;
    if (this.sync) mp.addModule(this.sync);
  }

  get inEnd() {
    return this.enabled && this.world.dim === END;
  }

  // Whether this peer flies the dragon (js/dimensions.js simulatesWorld, in the End).
  get authority() {
    return this.inEnd && (this.dims ? this.dims.simulatesWorld() : true);
  }

  get gen() {
    return this.world.terrainOf(END);
  }

  // ---------- State ----------

  _fresh() {
    return { v: 1, alive: true, killed: false, hp: DRAGON_HP, pos: SPAWN_AT.slice(), dying: null, crystals: 0x3ff, placed: [], gateways: [], exits: [], respawn: null };
  }

  // (the player's save: the host's or a single player's)
  serialize() {
    if (!this.enabled || !this.state) return undefined;
    this._capture();
    return JSON.parse(JSON.stringify(this.state));
  }

  load(saved) {
    if (!this.enabled) return;
    this.state = sanitizeState(saved);
  }

  // The dragon's live health and place into the state (before it is saved or sent).
  _capture() {
    const s = this.state;
    if (!s) return;
    if (this.d && s.alive) {
      s.hp = Math.round(this.d.hp * 10) / 10;
      s.pos = [r1(this.d.pos.x), r1(this.d.pos.y), r1(this.d.pos.z)];
      // (in its death throes: how far in, so a reload or a hand-off goes on dying)
      s.dying = this.d.phase === "dying" ? r1(this.d.deathT) : null;
    }
  }

  // Another peer's word on the fight (EndSync): taken as it is.
  applyState(st) {
    const s = sanitizeState(st);
    if (!s) return;
    const wasAlive = this.state?.alive;
    this.state = s;
    if (this.d && !s.alive && wasAlive) this.d = null;
    if (this.d && s.alive) this.d.hp = s.hp;
    // (dead: the puppet goes, else its last pose, the dying one, would hang there)
    if (!s.alive) this._dropPuppet();
  }

  _dropPuppet() {
    this.puppet = null;
    this.model?.hide();
  }

  _changed() {
    this._capture();
    this.sync?.sendState();
  }

  // ---------- Entering and leaving the End ----------

  _dimChanged(dim) {
    PORTAL_BLOCKS.set(V.END_PORTAL, dim === END ? "end_exit" : "end");
    // (leaving the End flying the dragon: its health and place for whoever comes next)
    if (this.d) this._changed();
    this.clouds.length = 0;
    for (const f of this.fireballs) this.game.scene.remove(f.mesh);
    this.fireballs.length = 0;
    for (const e of this.eyes) this.game.scene.remove(e.mesh);
    this.eyes.length = 0;
    this.d = null;
    this.puppet = null;
    this.model?.hide();
    this.crystalLook?.clear();
    this._showBar(null);
    if (dim === END && !this.state && this.authority) {
      // (the first visit: the fight begins)
      this.state = this._fresh();
      this._changed();
    }
  }

  // ---------- Per frame ----------

  update(dt) {
    if (!this.enabled) return;
    this.time += dt;
    this._sweepPortal();
    this._updateEyes(dt);
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 0.5;
      this._updatePortals();
    }
    this.stars.update(this.time, this.renderer);
    this.sky.update(this.inEnd, this.game.camera);
    if (!this.inEnd) return;
    if (!this.state && this.authority) {
      this.state = this._fresh();
      this._changed();
    }
    const s = this.state;
    if (s && this.authority) {
      this._simulate(dt);
      this._snapT -= dt;
      if (this._snapT <= 0 && this.d) {
        this._snapT = 1 / SNAP_RATE;
        this.sync?.sendPose(this._pose());
      }
      this._stateT -= dt;
      if (this._stateT <= 0) {
        this._stateT = STATE_RATE;
        if (this.d || s.respawn) this._changed();
      }
    } else this.d = null;
    // (no pose for a while: the one who flew it left, or it died unheard)
    if (this.puppet && this.time - this.puppet.lastT > 3) this._dropPuppet();
    // What everyone sees: the dragon (simulated or a puppet), the crystals and their beams.
    const pose = this.d ? this._pose() : this.puppet ? this._puppetPose() : null;
    if (pose && pose.ph !== "gone") {
      this.model.pose(pose, dt, this.world.lightAt(pose.p[0], pose.p[1], pose.p[2]));
      this.model.boxes(this._hitBoxes);
      this._contact(pose, dt);
      this._sounds(pose, dt);
    } else {
      this.model.hide();
      this._hitBoxes.length = 0;
    }
    this._poseNow = pose && pose.ph !== "gone" ? pose : null;
    this._drawCrystals(pose);
    this._updateDeathBeams(pose, dt);
    this._updateFireballs(dt);
    this._updateClouds(dt);
    this._updateGateways(dt);
    this._showBar(pose && s?.alive ? pose : null);
  }

  // A fall through an end portal between two frames (a slow computer's long
  // frames, a fast drop) still goes through it (js/dimensions.js only looks
  // at where the player is now).
  _sweepPortal() {
    const p = this.player.position;
    const last = this._lastFeet;
    this._lastFeet = [p.x, p.y, p.z];
    if (!last || !this.dims || this.dims.pending || this.player.dead) return;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (x !== Math.floor(last[0]) || z !== Math.floor(last[2]) || last[1] - p.y > 6) return;
    for (let y = Math.floor(p.y + 0.1); y <= Math.floor(last[1] + 0.1); y++) {
      if (this.world.getBlock(x, y, z) !== V.END_PORTAL) continue;
      this.dims.enterPortal(PORTAL_BLOCKS.get(V.END_PORTAL), { x, y, z });
      return;
    }
  }

  // ---------- Crystals ----------

  // Every crystal standing: [{ key, x, y, z (its foot), pillar: i | -1, i (placed index) }].
  // (Made again only when they change: asked many times a frame.)
  crystals() {
    const s = this.state;
    if (!s) return [];
    const c = this._crystalList;
    if (c && c.s === s && c.mask === s.crystals && c.placed === s.placed && c.n === s.placed.length) return c.list;
    const out = [];
    const pillars = this.gen.pillars;
    for (const p of pillars) if (s.crystals & (1 << p.i)) out.push({ key: `p${p.i}`, x: p.x + 0.5, y: p.h + 1, z: p.z + 0.5, pillar: p.i, phase: p.i });
    s.placed.forEach((q, i) => out.push({ key: `c${q[0]},${q[1]},${q[2]}`, x: q[0] + 0.5, y: q[1], z: q[2] + 0.5, pillar: -1, i, phase: i * 1.7 }));
    this._crystalList = { s, mask: s.crystals, placed: s.placed, n: s.placed.length, list: out };
    return out;
  }

  // The crystal healing the dragon at `pos`: the nearest within 32 blocks.
  _healer(pos) {
    let best = null;
    let bd = HEAL_RANGE * HEAL_RANGE;
    for (const c of this.crystals()) {
      const d = (c.x - pos.x) ** 2 + (c.y + 1 - pos.y) ** 2 + (c.z - pos.z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  _drawCrystals(pose) {
    const list = this.crystals();
    const healer = pose && pose.hl ? pose.hl : null;
    const body = pose ? (this._bodyAt ||= new THREE.Vector3()).set(pose.p[0], pose.p[1], pose.p[2]) : null;
    for (const c of list) c.beamTo = healer === c.key && body ? body : null;
    // (the respawn: the four crystals' beams up into the sky over the portal)
    if (this.state?.respawn) {
      const top = new THREE.Vector3(0.5, this.gen.podiumY + 18, 0.5);
      for (const c of list) if (c.pillar < 0) c.beamTo = top;
    }
    this.crystalLook.sync(list, this.time);
  }

  // A crystal is hit: it bursts (power 6) where it is, for everyone; the
  // dragon loses 10 if it was healing from it. Authority only.
  _burstCrystal(key) {
    const s = this.state;
    const c = this.crystals().find((k) => k.key === key);
    if (!s || !c) return;
    if (c.pillar >= 0) s.crystals &= ~(1 << c.pillar);
    else s.placed.splice(c.i, 1);
    const at = new THREE.Vector3(c.x, c.y + 1, c.z);
    this.game.effects?.explode?.(at, { radius: (CRYSTAL_POWER * 4) / 3, source: "end_crystal" });
    if (this.d && this.d.healer === key && s.alive) this._damage("head", 10, false, true);
    // (a crystal's blast sets off the crystals next to it)
    for (const o of this.crystals()) if (Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z) < CRYSTAL_POWER * 1.5 && o.key !== key) this._chain(o.key);
    this._changed();
  }

  _chain(key) {
    (this._chainKeys ||= new Set()).add(key);
  }

  // A crystal put down (END_CRYSTAL's use): on obsidian or bedrock with room
  // over it, in the End. Authority: at once; else a claim.
  _placeCrystal(ctx) {
    if (!this.inEnd || !this.state || !ctx.normal || ctx.normal[1] !== 1) return false;
    if (ctx.id !== V.OBSIDIAN && ctx.id !== BLOCK.BEDROCK) return false;
    const [x, y, z] = [ctx.x, ctx.y + 1, ctx.z];
    const w = this.world;
    if (w.getBlock(x, y, z) !== BLOCK.AIR || w.getBlock(x, y + 1, z) !== BLOCK.AIR) return false;
    if (this.crystals().some((c) => Math.abs(c.x - (x + 0.5)) < 1 && Math.abs(c.z - (z + 0.5)) < 1 && Math.abs(c.y - y) < 2)) return false;
    // (the state's limit: a crystal it would not keep is not used up)
    if (this.state.placed.length >= 16) return false;
    if (!ctx.creative) ctx.inventory.consumeSelected(1);
    ctx.audio?.playPlace?.("glass");
    if (this.authority) this._addPlaced([x, y, z]);
    else this.sync?.claim({ k: "place", p: [x, y, z] });
    return true;
  }

  _addPlaced(p) {
    const s = this.state;
    if (!s || s.placed.length >= 16) return;
    if (s.placed.some((c) => c[0] === p[0] && c[1] === p[1] && c[2] === p[2])) return;
    s.placed.push(p);
    this._changed();
  }

  // ---------- The dragon ----------

  _spawnDragon(hp = DRAGON_HP, pos = SPAWN_AT) {
    const d = {
      pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 10,
      hp,
      phase: "hold",
      t: 0,
      node: Math.floor(Math.random() * 12),
      dirSign: Math.random() < 0.5 ? 1 : -1,
      target: new THREE.Vector3(),
      targetPid: null,
      fired: false,
      sitDamage: 0,
      flames: 0,
      jaw: 0,
      healer: null,
      healT: 0,
      deathT: 0,
      flashT: 0,
      breakT: 0,
    };
    this._nextNode(d);
    return d;
  }

  // (a puppet's last pose: where the dragon goes on when this peer takes over)
  _takeOver() {
    const s = this.state;
    const last = this.puppet?.interp.last;
    const d = this._spawnDragon(s.hp, last?.p || s.pos);
    if (last) {
      d.yaw = last.y || 0;
      const ph = PHASES[last.ph | 0];
      if (ph === "dying") d.phase = "dying";
      else if (SITTING.has(ph)) d.phase = "scan";
      d.deathT = last.dt || 0;
    }
    // (saved or handed over dying, or at no health: it dies on, never back to life at 0)
    if (d.phase !== "dying" && (s.dying != null || s.hp <= 0)) {
      d.phase = "dying";
      d.t = 0;
      d.deathT = s.dying || 0;
    }
    this.puppet = null;
    return d;
  }

  _simulate(dt) {
    const s = this.state;
    this._respawnStep(dt);
    if (this._chainKeys?.size) {
      const keys = [...this._chainKeys];
      this._chainKeys.clear();
      for (const k of keys) this._burstCrystal(k);
    }
    if (!s.alive) {
      this.d = null;
      return;
    }
    const d = (this.d ||= this._takeOver());
    d.t += dt;
    d.flashT = Math.max(0, d.flashT - dt);
    if (d.phase === "dying") return this._dying(d, dt);
    // The crystals' healing.
    const h = this._healer(d.pos);
    d.healer = h ? h.key : null;
    if (h && d.hp < DRAGON_HP) {
      d.healT += dt;
      while (d.healT >= 0.5) {
        d.healT -= 0.5;
        d.hp = Math.min(DRAGON_HP, d.hp + 1);
        this.stats.heals++;
      }
    } else d.healT = 0;
    this._think(d, dt);
    this._breakThrough(d, dt);
  }

  // Vanilla's: in flight it breaks every block it touches but the immune
  // ones (end stone, obsidian, bedrock, iron bars, the portals and frames).
  // Edits, so everyone has them.
  _breakThrough(d, dt) {
    d.breakT -= dt;
    // (not near the portal it sits on: its torches stay)
    if (d.breakT > 0 || SITTING.has(d.phase) || d.phase === "takeoff" || !this._hitBoxes.length) return;
    d.breakT = 0.25;
    const w = this.world;
    const list = [];
    for (const b of this._hitBoxes) {
      if (b.part === "wing" || b.part === "tail") continue;
      // (vanilla's parts: the body 5 x 3 x 5, the head and neck 1 or so)
      const r = b.part === "head" || b.h < 1 ? 1 : 2;
      const ry = 1;
      for (let x = Math.floor(b.c.x - r); x <= Math.floor(b.c.x + r); x++) {
        for (let y = Math.max(1, Math.floor(b.c.y - ry)); y <= Math.min(126, Math.floor(b.c.y + ry)); y++) {
          for (let z = Math.floor(b.c.z - r); z <= Math.floor(b.c.z + r); z++) {
            const id = w.getBlock(x, y, z);
            if (id === BLOCK.AIR || DRAGON_IMMUNE.has(id) || !BLOCK_INFO[id] || BLOCK_INFO[id].liquid) continue;
            list.push(x, y, z, BLOCK.AIR);
            if (list.length >= 400) break;
          }
        }
      }
    }
    if (list.length) w.setBlocks(list);
  }

  // The players the dragon may go for: this one and the others in the End.
  _targets() {
    const out = [];
    const p = this.player;
    if (!p.dead && !p.creative) out.push({ pid: this.mp?.active ? this.mp.net.pid : 1, pos: p.position });
    if (this.mp?.active) for (const r of this.mp.players.active()) if (!r.dead && !r.creative) out.push({ pid: r.pid, pos: r.position });
    return out;
  }

  _nearestTarget(from, range) {
    let best = null;
    let bd = range * range;
    for (const t of this._targets()) {
      const dd = t.pos.distanceToSquared(from);
      if (dd < bd) {
        bd = dd;
        best = t;
      }
    }
    return best;
  }

  _targetPos(d) {
    if (d.targetPid == null) return null;
    return this._targets().find((t) => t.pid === d.targetPid)?.pos || null;
  }

  // The holding pattern's nodes: 12 round the outside (radius 60), 8 nearer
  // in (radius 40); their heights over the pillars.
  _nextNode(d) {
    d.node = (d.node + d.dirSign + 20) % 20;
    if (Math.random() < 0.08) d.dirSign = -d.dirSign;
    const outer = d.node < 12;
    const k = outer ? d.node : d.node - 12;
    const a = outer ? (k / 12) * Math.PI * 2 : (k / 8) * Math.PI * 2 + 0.2;
    const r = outer ? 60 : 40;
    d.target.set(Math.cos(a) * r, (outer ? 82 : 76) + Math.random() * 18, Math.sin(a) * r);
    d.phase = "hold";
    d.t = 0;
  }

  _setPhase(d, phase) {
    d.phase = phase;
    d.t = 0;
  }

  // Flies toward d.target at `speed`, turning at `turn` (rad/s).
  _fly(d, dt, speed, turn = 1.5, climb = 7) {
    const to = _v.copy(d.target).sub(d.pos);
    const want = Math.atan2(to.x, to.z);
    const dy = wrapAngle(want - d.yaw);
    d.yaw = wrapAngle(d.yaw + clamp(dy, -turn * dt, turn * dt));
    d.speed += (speed - d.speed) * Math.min(1, dt * 1.5);
    const vy = clamp(to.y * 1.2, -climb, climb);
    d.vel.set(Math.sin(d.yaw) * d.speed, vy, Math.cos(d.yaw) * d.speed);
    d.pos.addScaledVector(d.vel, dt);
    d.pitch += (clamp(-Math.atan2(vy, d.speed) * 0.8, -0.6, 0.6) - d.pitch) * Math.min(1, dt * 3);
    d.roll += (clamp(-dy * 1.1, -0.7, 0.7) - d.roll) * Math.min(1, dt * 2.5);
    return to.length();
  }

  _think(d, dt) {
    const podium = this.gen.podiumY;
    const crystals = this.crystals().filter((c) => c.pillar >= 0).length;
    switch (d.phase) {
      case "hold": {
        const left = this._fly(d, dt, 14);
        if (left > 8 && d.t < 15) break;
        // (at a node: land, go for a player, or on to the next)
        if (Math.random() * (crystals + 3) < 1) {
          this._setPhase(d, "approach");
          break;
        }
        const t = this._nearestTarget(new THREE.Vector3(0, podium, 0), 150);
        if (t) {
          const k = t.pos.distanceToSquared(new THREE.Vector3(0, podium, 0)) / 512;
          if (Math.random() * (Math.floor(Math.abs(k)) + 2) < 1 || Math.random() * (crystals + 2) < 1) {
            d.targetPid = t.pid;
            d.fired = false;
            this._setPhase(d, "strafe");
            break;
          }
        }
        this._nextNode(d);
        break;
      }
      case "strafe": {
        const tp = this._targetPos(d);
        if (!tp || d.t > 12) {
          this._nextNode(d);
          break;
        }
        d.target.set(tp.x, tp.y + 6, tp.z);
        const dist = this._fly(d, dt, 15, 1.7);
        const dir = _w.set(tp.x - d.pos.x, 0, tp.z - d.pos.z);
        const off = Math.abs(wrapAngle(Math.atan2(dir.x, dir.z) - d.yaw));
        if (!d.fired && dist < 64 && dist > 10 && off < 0.2) {
          d.fired = true;
          this._fireball(d, tp);
        }
        if (d.fired && dist < 14) this._nextNode(d);
        break;
      }
      case "charge": {
        const left = this._fly(d, dt, 22, 2.2, 10);
        if (left < 6 || d.t > 8) this._nextNode(d);
        break;
      }
      case "approach": {
        d.target.set(0.5, podium + 14, 0.5);
        if (this._fly(d, dt, 12, 1.8) < 6) this._setPhase(d, "land");
        break;
      }
      case "land": {
        d.target.set(0.5, podium + 4.8, 0.5);
        const to = _v.copy(d.target).sub(d.pos);
        d.pos.addScaledVector(to, Math.min(1, dt * 1.6));
        d.vel.set(0, 0, 0);
        d.speed = 0;
        d.pitch *= 1 - Math.min(1, dt * 2);
        d.roll *= 1 - Math.min(1, dt * 2);
        if (to.length() < 0.3 || d.t > 4) {
          d.sitDamage = 0;
          d.flames = 0;
          this._setPhase(d, "scan");
        }
        break;
      }
      case "scan":
      case "roar":
      case "flame":
        this._sit(d, dt, podium);
        break;
      case "takeoff": {
        d.target.set(0.5, podium + 26, 0.5 + 6);
        this._fly(d, dt, 9, 2, 6);
        if (d.pos.y > podium + 20 || d.t > 5) {
          if (d.chargeAt) {
            d.target.copy(d.chargeAt);
            d.chargeAt = null;
            this._setPhase(d, "charge");
          } else this._nextNode(d);
        }
        break;
      }
    }
    d.jaw += ((d.phase === "roar" || d.phase === "flame" ? 1 : 0) - d.jaw) * Math.min(1, dt * 4);
  }

  // Perched on the exit portal: looking round, roaring, breathing.
  _sit(d, dt, podium) {
    d.pos.set(0.5, podium + 4.8, 0.5);
    d.vel.set(0, 0, 0);
    const near = this._nearestTarget(d.pos, 22);
    if (near) {
      const want = Math.atan2(near.pos.x - d.pos.x, near.pos.z - d.pos.z);
      d.yaw = wrapAngle(d.yaw + clamp(wrapAngle(want - d.yaw), -1.2 * dt, 1.2 * dt));
    }
    if (d.phase === "scan") {
      if (near && d.t > 1.25) this._setPhase(d, "roar");
      else if (!near && d.t >= 5) {
        const far = this._nearestTarget(d.pos, 150);
        if (far) d.chargeAt = far.pos.clone();
        this._setPhase(d, "takeoff");
      }
    } else if (d.phase === "roar") {
      if (d.t >= 2) this._setPhase(d, "flame");
    } else if (d.phase === "flame") {
      if (d.t >= 0.5 && !d.breathed) {
        d.breathed = true;
        this._breathe(d);
      }
      if (d.t >= 10) {
        d.breathed = false;
        d.flames++;
        this._setPhase(d, d.flames >= 4 ? "takeoff" : "scan");
      }
    }
  }

  // Its voice, heard by everyone (from the pose drawn here): the roar before
  // it breathes, a growl now and then, the wing beats near it, its death cry.
  _sounds(pose, dt) {
    const a = this.game.audio;
    if (!a?.ctx || !a._voice) return;
    const dist = this.player.position.distanceTo(_v.set(pose.p[0], pose.p[1], pose.p[2]));
    const k = 1 / (1 + dist / 30);
    const was = this._lastPh;
    this._lastPh = pose.ph;
    a._cat?.("creatures");
    if (pose.ph === "roar" && was !== "roar") a._voice({ f0: 140, f1: 70, d: 1.4, v: 0.5, formants: [[420, 4, 1], [900, 6, 0.5]], breath: 0.7 }, k);
    else if (pose.ph === "dying" && was !== "dying") a._voice({ f0: 180, f1: 40, d: 3.5, v: 0.6, formants: [[380, 3, 1], [760, 5, 0.6]], breath: 0.8 }, Math.max(0.3, k));
    else if (pose.ph === "flame" && was !== "flame") a._hit?.({ type: "bandpass", f: 900, fEnd: 300, q: 0.7, d: 1.6, v: 0.35 * k, attack: 0.1 });
    this._growlT = (this._growlT ?? 6) - dt;
    if (this._growlT <= 0 && pose.ph !== "dying") {
      this._growlT = 6 + Math.random() * 6;
      if (dist < 90) a._voice({ f0: 95, f1: 70, d: 1.1, v: 0.32, formants: [[300, 4, 1]], breath: 0.6 }, k);
    }
    // (a beat a flap: the model's wing phase)
    const f = Math.floor(this.model.flap / (Math.PI * 2));
    if (f !== this._lastFlap && dist < 60 && !SITTING.has(pose.ph)) a._hit?.({ type: "lowpass", f: 260, fEnd: 90, q: 0.8, d: 0.35, v: 0.3 * k, attack: 0.05 });
    this._lastFlap = f;
  }

  // The breath: a cloud on the ground in front of its head (radius 5, 10 s).
  _breathe(d) {
    const head = this.model.headPos(new THREE.Vector3());
    const fx = Math.sin(d.yaw);
    const fz = Math.cos(d.yaw);
    const x = head.x + fx * 2;
    const z = head.z + fz * 2;
    let y = Math.floor(head.y);
    for (let k = 0; k < 12 && y > 1 && !IS_SOLID[this.world.getBlock(Math.floor(x), y - 1, Math.floor(z))]; k++) y--;
    this._addCloud({ x, y, z, r: 5, grow: 0, life: 10, kind: "breath" }, true);
  }

  // A dragon fireball toward the player at tp (its burst makes a cloud).
  _fireball(d, tp) {
    const from = this.model.headPos(new THREE.Vector3());
    const dir = new THREE.Vector3(tp.x - from.x, tp.y + 0.5 - from.y, tp.z - from.z).normalize();
    this._addFireball(from, dir, true);
    this.sync?.event({ k: "fb", p: [r2(from.x), r2(from.y), r2(from.z)], d: [r2(dir.x), r2(dir.y), r2(dir.z)] });
  }

  // ---------- Damage to the dragon ----------

  // `part` hit for `amount` (byPlayer: a player did it; projectile: an
  // arrow or the like; force: the crystal's 10, whatever the dragon does).
  // Authority only: the others claim.
  _damage(part, amount, projectile = false, force = false) {
    const d = this.d;
    if (!d || d.phase === "dying" || !(amount > 0)) return false;
    if (!force && projectile && SITTING.has(d.phase)) return false; // (arrows glance off it sitting)
    const dmg = force || part === "head" ? amount : amount / 4 + Math.min(amount, 1);
    if (dmg < 0.01) return false;
    d.hp -= dmg;
    d.flashT = 0.3;
    this.stats.hits++;
    if (SITTING.has(d.phase)) {
      d.sitDamage += dmg;
      if (d.sitDamage > SIT_DAMAGE_TAKEOFF) this._setPhase(d, "takeoff");
    }
    if (d.hp <= 0) {
      d.hp = 0;
      this._setPhase(d, "dying");
      d.deathT = 0;
    }
    return true;
  }

  // ---------- Its death ----------

  _dying(d, dt) {
    // (vanilla's DragonDeathPhase: back over the exit portal first, to within
    // 10 blocks of its top; then the 10 s rising there)
    if (d.deathT <= 0) {
      d.target.set(0.5, this.gen.podiumY + 4, 0.5);
      if (this._fly(d, dt, 18, 2.5, 10) > 10 && d.t < 20) return;
    }
    d.deathT += dt;
    d.vel.set(0, 2, 0);
    d.pitch *= 1 - Math.min(1, dt * 2);
    d.roll *= 1 - Math.min(1, dt * 2);
    d.pos.y += 2 * dt; // (vanilla: 0.1 a tick)
    const fx = this.game.effects;
    if (d.deathT > 9 && fx?.glow && Math.random() < 0.5) fx.glow.spawn({ x: d.pos.x + (Math.random() - 0.5) * 8, y: d.pos.y + (Math.random() - 0.5) * 4, z: d.pos.z + (Math.random() - 0.5) * 8, vx: 0, vy: 0, vz: 0, life: 0.6, size0: 3, size1: 6, color0: new THREE.Color(3, 2.2, 3), alpha: 0.8 });
    if (d.deathT >= 10) this._killed(d);
  }

  // Dead: its experience (everyone in the End: their own), the portal open,
  // the egg the first time, a gateway.
  _killed(d) {
    const s = this.state;
    const first = !s.killed;
    const at = [r1(d.pos.x), r1(d.pos.y), r1(d.pos.z)];
    this.sync?.event({ k: "xp", p: at, n: first ? 12000 : 500 });
    this._dragonXp(at, first ? 12000 : 500);
    s.alive = false;
    s.killed = true;
    s.hp = 0;
    s.dying = null;
    this.d = null;
    this.stats.kills++;
    const y = this.gen.podiumY;
    const cells = podiumCells(y, true, V.END_PORTAL);
    for (let i = 0; i < cells.length; i += 4) if (cells[i + 3] === V.END_PORTAL) this.world.queueEdit(cells[i], cells[i + 1], cells[i + 2], cells[i + 3]);
    if (first) this.world.queueEdit(0, y + 4, 0, V.DRAGON_EGG);
    const order = gatewayOrder(this.world.seed >>> 0);
    if (s.gateways.length < order.length) {
      const i = s.gateways.length;
      s.gateways.push(i);
      const [gx, gy, gz] = order[i];
      const list = gatewayCells(gx, gy, gz);
      for (let k = 0; k < list.length; k += 4) this.world.queueEdit(list[k], list[k + 1], list[k + 2], list[k + 3]);
    }
    this.game.toast?.("The Ender Dragon is dead");
    this._changed();
  }

  _dragonXp(at, n) {
    // (in bursts round where it died, as vanilla's)
    for (let k = 0; k < 8; k++) this.game.xp?.spawn?.(at[0] + (Math.random() - 0.5) * 4, Math.max(this.gen.podiumY + 2, at[1] - 10), at[2] + (Math.random() - 0.5) * 4, n / 8);
  }

  _makeDeathBeams(scene) {
    const n = 26;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 9);
    const col = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      for (let v = 0; v < 3; v++) {
        const k = v === 0 ? 1 : 0;
        col.set([2.4 * (0.5 + k), 1.4 * (0.4 + k), 3 * (0.6 + k * 0.6)], i * 9 + v * 3);
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER_FX);
    mesh.visible = false;
    scene.add(mesh);
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const b = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.12).add(a).normalize();
      dirs.push([a, b, 0.4 + Math.random() * 0.6]);
    }
    return { mesh, dirs };
  }

  _updateDeathBeams(pose) {
    const b = this.beams;
    if (!pose || pose.ph !== "dying") {
      b.mesh.visible = false;
      return;
    }
    const t = pose.dt || 0;
    const len = Math.min(1, t / 9) * 26;
    const arr = b.mesh.geometry.attributes.position.array;
    const c = pose.p;
    b.dirs.forEach(([a, bb, k], i) => {
      const L = len * k * (0.85 + Math.sin(this.time * 3 + i) * 0.15);
      arr.set([c[0], c[1], c[2], c[0] + a.x * L, c[1] + a.y * L, c[2] + a.z * L, c[0] + bb.x * L, c[1] + bb.y * L, c[2] + bb.z * L], i * 9);
    });
    b.mesh.geometry.attributes.position.needsUpdate = true;
    b.mesh.visible = true;
  }

  // ---------- Its pose (for drawing, the wire, contacts) ----------

  _pose() {
    const d = this.d;
    return { p: [d.pos.x, d.pos.y, d.pos.z], v: [d.vel.x, d.vel.y, d.vel.z], vy: d.vel.y, y: d.yaw, pi: d.pitch, r: d.roll, ph: d.phase, hp: d.hp, j: d.jaw, hl: d.healer, dt: d.deathT, flash: d.flashT > 0 ? HURT_FLASH : null };
  }

  _puppetPose() {
    const p = this.puppet;
    const s = p.interp.sample(this.mp?.net?.time ?? performance.now() / 1000);
    if (!s) return null;
    return { p: s.p, v: s.v, vy: s.v?.[1] || 0, y: s.y, pi: s.pi, r: s.r, ph: PHASES[s.ph | 0] || "hold", hp: s.hp, j: s.j, hl: s.hl || null, dt: s.dt, flash: p.flashT > this.time ? HURT_FLASH : null };
  }

  // Another peer's pose of its dragon (EndSync).
  onPose(m) {
    if (!this.inEnd || this.authority) return;
    // (a late pose of a dragon the state says is dead: dropped)
    if (this.state && !this.state.alive) return;
    if (!this.puppet) this.puppet = { interp: new Interp({ angles: ["y", "pi", "r"], discrete: ["ph", "hl"], snap: 60 }), flashT: 0, lastT: this.time };
    this.puppet.lastT = this.time;
    this.puppet.interp.push(m, this.mp?.net?.time ?? 0);
  }

  // ---------- What the dragon does to this player ----------

  // Its head bites (10), its wings and body fling (5, not while it sits):
  // judged here for this player, by the pose drawn here.
  _contact(pose, dt) {
    const p = this.player;
    this._contactT = Math.max(0, (this._contactT || 0) - dt);
    if (p.dead || p.creative || this._contactT > 0 || pose.ph === "dying") return;
    const scale = Math.max(0.5, p.mobDamageScale ?? 1);
    const at = _v.copy(p.position);
    at.y += 0.9;
    for (const b of this._hitBoxes) {
      const reach = b.h + 0.6;
      if (Math.abs(at.x - b.c.x) > reach || Math.abs(at.y - b.c.y) > reach || Math.abs(at.z - b.c.z) > reach) continue;
      const head = b.part === "head";
      if (!head && SITTING.has(pose.ph)) continue;
      const dmg = Math.max(1, Math.round((head ? 10 : 5) * scale));
      const dx = at.x - b.c.x;
      const dz = at.z - b.c.z;
      const dd = Math.max(0.3, Math.hypot(dx, dz));
      if (p.damage(dmg, "ender_dragon", { from: b.c.clone() })) p.applyImpulse?.(new THREE.Vector3((dx / dd) * 16, 5, (dz / dd) * 16));
      this._contactT = 0.5;
      return;
    }
  }

  // ---------- Fireballs and clouds ----------

  _addFireball(from, dir, mine) {
    const mesh = new THREE.Mesh(this.fireGeo, this.fireMat);
    mesh.position.copy(from);
    mesh.layers.set(LAYER_FX);
    this.game.scene.add(mesh);
    this.fireballs.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(16), dir: dir.clone(), life: 8, mesh, mine });
  }

  _updateFireballs(dt) {
    const fx = this.game.effects;
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life -= dt;
      f.vel.addScaledVector(f.dir, 10 * dt);
      if (f.vel.length() > 30) f.vel.setLength(30);
      const step = _w.copy(f.vel).multiplyScalar(dt);
      const len = step.length();
      const hit = this.world.raycast(f.pos, step.clone().normalize(), len, { solidOnly: true });
      let burst = null;
      if (hit) burst = f.pos.clone().addScaledVector(step.clone().normalize(), Math.max(0, hit.distance - 0.2));
      else {
        f.pos.add(step);
        // (a player in its way: the burst there; the authority's judgement)
        if (f.mine) for (const t of this._targets()) if (t.pos.distanceTo(f.pos) < 1.4 || Math.abs(t.pos.x - f.pos.x) < 0.8 && Math.abs(t.pos.z - f.pos.z) < 0.8 && f.pos.y > t.pos.y - 0.2 && f.pos.y < t.pos.y + 2) burst = f.pos.clone();
      }
      if (fx?.glow && Math.random() < 0.7) fx.glow.spawn({ x: f.pos.x, y: f.pos.y, z: f.pos.z, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, life: 0.7, size0: 0.7, size1: 0.2, color0: BREATH_GLOW, alpha: 0.8 });
      f.mesh.position.copy(f.pos);
      if (burst || f.life <= 0) {
        this.game.scene.remove(f.mesh);
        this.fireballs.splice(i, 1);
        if (burst && f.mine) this._addCloud({ x: burst.x, y: burst.y, z: burst.z, r: 3, grow: 4 / 30, life: 30, kind: "fireball" }, true);
      }
    }
  }

  // A cloud of dragon's breath (mine: this peer made it: everyone hears of it).
  _addCloud(c, mine) {
    // (on the ground under where it burst)
    let y = Math.floor(c.y);
    for (let k = 0; k < 6 && y > 1 && !IS_SOLID[this.world.getBlock(Math.floor(c.x), y - 1, Math.floor(c.z))]; k++) y--;
    const cloud = { x: c.x, y, z: c.z, r: c.r, grow: c.grow || 0, life: c.life, max: c.life, kind: c.kind, tick: 0 };
    this.clouds.push(cloud);
    if (this.clouds.length > 12) this.clouds.shift();
    if (mine) this.sync?.event({ k: "cl", p: [r2(c.x), y, r2(c.z)], r: c.r, g: c.grow || 0, l: c.life, kd: c.kind });
    if (c.kind === "fireball") this.game.audio?.playExplosion?.(this.player.position.distanceTo(_v.set(c.x, y, c.z)), 0.4);
  }

  _updateClouds(dt) {
    const p = this.player;
    const fx = this.game.effects;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= dt;
      c.r += c.grow * dt;
      if (c.life <= 0 || c.r < 0.5) {
        this.clouds.splice(i, 1);
        continue;
      }
      // its mist (a few motes a frame, more for a big one)
      if (fx?.glow) {
        const n = Math.min(4, Math.ceil(c.r * c.r * 0.08 * Math.min(1, dt * 30)));
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * c.r;
          fx.glow.spawn({ x: c.x + Math.cos(a) * rr, y: c.y + 0.2 + Math.random() * 0.5, z: c.z + Math.sin(a) * rr, vx: 0, vy: 0.25 + Math.random() * 0.3, vz: 0, life: 1.4, size0: 0.5, size1: 1.1, color0: BREATH_GLOW, color1: BREATH_END, alpha: 0.6 });
        }
      }
      // this player inside it: 6 a second, through armour
      c.tick -= dt;
      if (c.tick > 0 || p.dead || p.creative) continue;
      const dx = p.position.x - c.x;
      const dz = p.position.z - c.z;
      if (dx * dx + dz * dz <= c.r * c.r && p.position.y >= c.y - 0.6 && p.position.y <= c.y + 1.6) {
        c.tick = 1;
        p.damage(BREATH_DAMAGE, "dragon_breath", { pierce: false });
      }
    }
  }

  // A glass bottle used in a cloud: dragon's breath (the cloud half a block smaller).
  _bottle(ctx) {
    if (!this.inEnd || !this.clouds.length) return false;
    const eye = this.player.getEyePosition();
    const f = ctx.forward;
    for (const c of this.clouds) {
      // (where the view meets the cloud's height, within 5 blocks, inside it)
      for (let t = 0; t <= 5; t += 0.25) {
        const x = eye.x + f[0] * t;
        const y = eye.y + f[1] * t;
        const z = eye.z + f[2] * t;
        if (y < c.y - 0.5 || y > c.y + 1.5 || (x - c.x) ** 2 + (z - c.z) ** 2 > c.r * c.r) continue;
        c.r -= 0.5;
        const inv = ctx.inventory;
        inv.consumeSelected(1);
        if (!inv.selectedStack) inv.slots[inv.selected] = makeStack(V.DRAGON_BREATH, 1);
        else if (inv.add(V.DRAGON_BREATH, 1) > 0) ctx.interaction?.throwStack?.(makeStack(V.DRAGON_BREATH, 1));
        ctx.audio?.playSplash?.();
        return true;
      }
    }
    return false;
  }

  // ---------- The boss bar ----------

  _showBar(pose) {
    if (typeof document === "undefined") return;
    const p = this.player.position;
    const show = !!pose && Math.hypot(p.x, p.z) < FIGHT_RADIUS && !document.body.classList.contains("hud-off") && (this.game.gameState === "playing" || this.game.gameState === "inventory" || this.game.gameState === "dead");
    if (!this._bar) {
      if (!show) return;
      const el = (this._bar = document.createElement("div"));
      el.id = "dragon-bar";
      el.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);width:min(364px,60vw);z-index:11;pointer-events:none;text-align:center;font:600 13px sans-serif;color:#fff;text-shadow:1px 1px 0 #3f3f3f";
      el.innerHTML = '<div class="n" style="margin-bottom:3px">Ender Dragon</div><div style="height:7px;background:#3a0f3e;border:1px solid #1a0418;box-shadow:0 0 0 1px rgba(0,0,0,.35)"><div class="f" style="height:100%;width:100%;background:linear-gradient(#f07cf5,#c32fc9);transition:width .2s"></div></div>';
      document.body.appendChild(el);
    }
    this._bar.style.display = show ? "block" : "none";
    if (show) {
      const w = `${((Math.max(0, pose.hp) / DRAGON_HP) * 100).toFixed(1)}%`;
      const fill = this._bar.querySelector(".f");
      if (fill.style.width !== w) fill.style.width = w;
    }
  }

  // ---------- The exit portal: a new dragon (four crystals round it) ----------

  _respawnStep(dt) {
    const s = this.state;
    if (s.alive) return;
    const y = this.gen.podiumY;
    if (!s.respawn) {
      // (one crystal on each side of the portal's rim, on its bedrock)
      const sides = [[3, 0], [-3, 0], [0, 3], [0, -3]];
      const ok = sides.every(([x, z]) => s.placed.some((c) => c[0] === x && c[1] === y + 1 && c[2] === z));
      if (!ok) return;
      s.respawn = { t: 0, n: 0 };
      this._changed();
    }
    const r = s.respawn;
    r.t += dt;
    // Two seconds of beams; then a pillar every 0.8 s, rebuilt with a blast;
    // then the portal goes out, the four crystals burst, the dragon is back.
    const pillars = this.gen.pillars;
    while (r.t > 2 + r.n * 0.8 && r.n < pillars.length) {
      const p = pillars[r.n++];
      this._rebuildPillar(p);
      s.crystals |= 1 << p.i;
      this.game.effects?.explode?.(new THREE.Vector3(p.x + 0.5, p.h + 1, p.z + 0.5), { radius: 4, source: "end_respawn", carve: false });
    }
    if (r.n >= pillars.length && r.t > 2 + pillars.length * 0.8 + 1) {
      const cells = podiumCells(y, false);
      for (let i = 0; i < cells.length; i += 4) if (cells[i + 3] === BLOCK.AIR && Math.hypot(cells[i], cells[i + 2]) < 3 && cells[i + 1] === y) this.world.queueEdit(cells[i], cells[i + 1], cells[i + 2], BLOCK.AIR);
      for (const c of [...s.placed]) {
        if (Math.abs(c[0]) + Math.abs(c[2]) === 3 && c[1] === y + 1) this.game.effects?.explode?.(new THREE.Vector3(c[0] + 0.5, c[1] + 1, c[2] + 0.5), { radius: 3, source: "end_crystal", carve: false });
      }
      s.placed = s.placed.filter((c) => !(Math.abs(c[0]) + Math.abs(c[2]) === 3 && c[1] === y + 1));
      s.respawn = null;
      s.alive = true;
      s.hp = DRAGON_HP;
      s.pos = SPAWN_AT.slice();
      s.dying = null;
      this.d = this._spawnDragon();
      this.game.toast?.("The Ender Dragon returns");
      this._changed();
    }
  }

  // A pillar as the End's generator made it: obsidian, its bedrock top, its cage.
  _rebuildPillar(p) {
    const w = this.world;
    const list = [];
    for (let dx = -p.r; dx <= p.r; dx++) {
      for (let dz = -p.r; dz <= p.r; dz++) {
        if (dx * dx + dz * dz > p.r * p.r + 1) continue;
        const top = this.gen.column(p.x + dx, p.z + dz);
        for (let y = top ? top[1] : 40; y < p.h; y++) list.push(p.x + dx, y, p.z + dz, V.OBSIDIAN);
      }
    }
    list.push(p.x, p.h, p.z, BLOCK.BEDROCK);
    if (p.guarded) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 3; dy++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3) list.push(p.x + dx, p.h + dy, p.z + dz, V.IRON_BARS);
    for (let i = 0; i < list.length; i += 4) if (w.getBlock(list[i], list[i + 1], list[i + 2]) !== list[i + 3]) w.queueEdit(list[i], list[i + 1], list[i + 2], list[i + 3]);
  }

  // ---------- Portals' starfield ----------

  // The end portal and gateway blocks near this player: the nearest
  // stronghold's portal room in the Overworld; the exit portal and the
  // gateways in the End.
  _updatePortals() {
    const w = this.world;
    const portals = [];
    const gateways = [];
    const p = this.player.position;
    if (w.dim === OVERWORLD && isVanilla()) {
      const g = this._strongholds();
      // (a stronghold's place is worked out only when one may be near: its
      // ring's place within 112 + 80 + 160 blocks)
      const close = g?.rings.some(([x, z]) => Math.abs(x - p.x) < 352 && Math.abs(z - p.z) < 352);
      const near = close ? g.nearest(p.x, p.z) : null;
      if (near && Math.hypot(near.x - p.x, near.z - p.z) < 160) {
        const room = g.plan(near.i).portal;
        if (room) for (const c of room.cells) if (w.getBlock(c[0], c[1], c[2]) === V.END_PORTAL) portals.push(c);
      }
    } else if (w.dim === END) {
      const y = this.gen.podiumY;
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (w.getBlock(x, y, z) === V.END_PORTAL) portals.push([x, y, z]);
      for (const g of this._gatewaysKnown()) if (w.getBlock(g[0], g[1], g[2]) === V.END_GATEWAY && Math.hypot(g[0] - p.x, g[2] - p.z) < 200) gateways.push(g);
    }
    this.stars.set(portals, gateways);
  }

  _strongholds() {
    const t = this.world.terrainOf(OVERWORLD);
    if (t.structures?.strongholds) return t.structures.strongholds;
    // (before structures.js has its grower: the same places, from the seed)
    return (this._ownStrongholds ||= t.options?.vanilla ? new StrongholdGrower(t) : null);
  }

  // Every gateway that may stand: the opened ring places and the exits made.
  _gatewaysKnown() {
    const s = this.state;
    if (!s) return [];
    const order = gatewayOrder(this.world.seed >>> 0);
    return [...s.gateways.map((i) => order[i]).filter(Boolean), ...s.exits];
  }

  // ---------- Gateways' travel ----------

  _updateGateways(dt) {
    this._gatewayCool = Math.max(0, this._gatewayCool - dt);
    const p = this.player;
    const w = this.world;
    // (the gateways near: purple motes round them, as vanilla's)
    const fx = this.game.effects;
    if (fx?.glow && Math.random() < dt * 8) {
      for (const g of this.stars.gatewaysShown) {
        if (Math.hypot(g[0] - p.position.x, g[1] - p.position.y, g[2] - p.position.z) > 48) continue;
        const a = Math.random() * Math.PI * 2;
        fx.glow.spawn({ x: g[0] + 0.5 + Math.cos(a) * 0.7, y: g[1] + 0.5 + (Math.random() - 0.5) * 1.2, z: g[2] + 0.5 + Math.sin(a) * 0.7, vx: Math.cos(a) * 0.3, vy: 0.2, vz: Math.sin(a) * 0.3, life: 1.2, size0: 0.22, size1: 0.05, color0: PORTAL_MOTE, alpha: 0.9 });
      }
    }
    // (an exit gateway to make where this player arrived: once its ground is in)
    if (this._pendingExit && !this.dims?.pending) {
      const [x, y, z] = this._pendingExit;
      if (w.getChunk(x >> 4, z >> 4)) {
        this._pendingExit = null;
        const list = gatewayCells(x, y, z);
        w.setBlocks(list);
        this._noteExit([x, y, z]);
      }
    }
    if (p.dead || this.dims?.pending) return;
    let inside = null;
    for (const dy of [0.1, 1.2]) {
      const bx = Math.floor(p.position.x);
      const by = Math.floor(p.position.y + dy);
      const bz = Math.floor(p.position.z);
      if (w.getBlock(bx, by, bz) === V.END_GATEWAY) inside = [bx, by, bz];
    }
    if (!inside) {
      this._inGateway = false;
      return;
    }
    if (this._inGateway || this._gatewayCool > 0) return;
    this._inGateway = true;
    this.throughGateway(inside);
  }

  // This player goes through the gateway at g (on foot, or their pearl did).
  throughGateway(g) {
    if (!this.dims || this._gatewayCool > 0) return false;
    this._gatewayCool = 2;
    const far = Math.hypot(g[0], g[2]) > GATEWAY_RING * 3;
    this.game.audio?.playTeleport?.();
    if (far) {
      // An exit: back to the ring's gateway nearest its way out.
      const a = Math.atan2(g[2], g[0]);
      const order = gatewayOrder(this.world.seed >>> 0);
      let best = null;
      let bd = Infinity;
      for (const i of this.state?.gateways || []) {
        const o = order[i];
        const d = Math.abs(wrapAngle(Math.atan2(o[2], o[0]) - a));
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      best ||= [Math.round(Math.cos(a) * GATEWAY_RING), 75, Math.round(Math.sin(a) * GATEWAY_RING)];
      // (onto the island's edge inside the ring)
      const k = 0.75;
      return this.dims.travel(END, best[0] * k + 0.5, 70, best[2] * k + 0.5, { place: "safe" });
    }
    const dest = this.exitFor(g);
    this._pendingExit = dest.gateway;
    return this.dims.travel(END, dest.x, dest.y, dest.z, { place: "safe" });
  }

  // Where the gateway at g leads (vanilla's findExitPortal): out the same way
  // to 1024 blocks and on in steps of 16 to the first outer island (or a
  // small one made there), the exit gateway ten over its ground.
  exitFor(g) {
    const len = Math.hypot(g[0], g[2]) || 1;
    const dx = g[0] / len;
    const dz = g[2] / len;
    const gen = this.gen;
    for (let k = 0; k < 16; k++) {
      const x = Math.round(dx * (1024 + k * 16));
      const z = Math.round(dz * (1024 + k * 16));
      // (the highest ground of the 16 x 16 round it)
      let best = null;
      for (let ox = -8; ox <= 8; ox += 2) {
        for (let oz = -8; oz <= 8; oz += 2) {
          const col = gen.column(x + ox, z + oz);
          if (col && (!best || col[1] > best[1])) best = [x + ox, col[1], z + oz];
        }
      }
      if (best) return { x: best[0] + 0.5, y: best[1] + 1, z: best[2] + 0.5, gateway: [best[0], Math.min(120, best[1] + 10), best[2]] };
    }
    // (none: a small island of end stone, as vanilla's EndIslandFeature)
    const x = Math.round(dx * 1024);
    const z = Math.round(dz * 1024);
    const list = [];
    for (let ox = -4; ox <= 4; ox++) for (let oz = -4; oz <= 4; oz++) for (let oy = 0; oy <= 3; oy++) if (ox * ox + oz * oz <= (4 - oy) * (4 - oy) + 1) list.push(x + ox, 60 - oy, z + oz, V.END_STONE);
    for (let i = 0; i < list.length; i += 4) this.world.queueEdit(list[i], list[i + 1], list[i + 2], list[i + 3]);
    return { x: x + 0.5, y: 61, z: z + 0.5, gateway: [x, 70, z] };
  }

  _noteExit(p) {
    const s = this.state;
    if (!s || s.exits.some((e) => e[0] === p[0] && e[1] === p[1] && e[2] === p[2])) return;
    if (this.authority) {
      s.exits.push(p);
      if (s.exits.length > 40) s.exits.shift();
      this._changed();
    } else this.sync?.claim({ k: "exit", p });
  }

  // ---------- Eyes of ender ----------

  // Thrown (the eye's use): toward the nearest stronghold, in the Overworld
  // of a Survival world.
  throwEye(ctx) {
    if (!this.enabled || this.world.dim !== OVERWORLD || ctx.player.vehicle) return false;
    const g = this._strongholds();
    const p = ctx.player.position;
    const target = g?.nearest(p.x, p.z);
    if (!target) return false;
    const from = new THREE.Vector3(p.x, p.y + 0.9, p.z);
    const survive = Math.random() < 0.8;
    this._addEye(from, [target.x + 0.5, target.y + 1, target.z + 0.5], survive, true);
    if (!ctx.creative) ctx.inventory.consumeSelected(1);
    this.game.audio?.playThrow?.();
    this.sync?.eye([r2(from.x), r2(from.y), r2(from.z)], [target.x + 0.5, target.y + 1, target.z + 0.5], survive);
    return true;
  }

  _addEye(from, target, survive, mine) {
    const model = itemModel(V.EYE_OF_ENDER);
    const mesh = model ? new THREE.Mesh(model.geometry, this.eyeMat) : new THREE.Mesh(this.fireGeo, this.fireMat);
    mesh.scale.setScalar(model ? 0.35 : 0.3);
    const e = { pos: from.clone(), vel: new THREE.Vector3(), life: 0, acc: 0, survive, mine, mesh, light: { sky: 15, block: 0 } };
    bindEntityLight(mesh, () => e.light);
    // (vanilla's signalTo: 12 blocks toward it, 8 up; or to it when close)
    const dx = target[0] - from.x;
    const dz = target[2] - from.z;
    const dist = Math.hypot(dx, dz);
    e.t = dist > 12 ? [from.x + (dx / dist) * 12, from.y + 8, from.z + (dz / dist) * 12] : target.slice();
    mesh.position.copy(from);
    this.game.scene.add(mesh);
    this.eyes.push(e);
    return e;
  }

  // (vanilla's EyeOfEnder.tick, at 20 ticks a second)
  _updateEyes(dt) {
    const fx = this.game.effects;
    for (let i = this.eyes.length - 1; i >= 0; i--) {
      const e = this.eyes[i];
      e.acc += dt;
      while (e.acc >= TICK && e.life <= EYE_LIFE) {
        e.acc -= TICK;
        e.pos.add(e.vel);
        const dx = e.t[0] - e.pos.x;
        const dz = e.t[2] - e.pos.z;
        const f = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        let h = Math.hypot(e.vel.x, e.vel.z);
        h += (f - h) * 0.0025;
        let vy = e.vel.y;
        if (f < 1) {
          h *= 0.8;
          vy *= 0.8;
        }
        const j = e.pos.y < e.t[1] ? 1 : -1;
        e.vel.set(Math.cos(ang) * h, vy + (j - vy) * 0.015, Math.sin(ang) * h);
        e.life++;
        if (fx?.glow && e.life % 2 === 0) fx.glow.spawn({ x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8, life: 0.6, size0: 0.18, size1: 0.05, color0: PORTAL_MOTE, alpha: 0.8 });
      }
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.y = this.player.yaw;
      e.light = this.world.lightAt(e.pos.x, e.pos.y, e.pos.z);
      if (e.life <= EYE_LIFE) continue;
      this.game.scene.remove(e.mesh);
      this.eyes.splice(i, 1);
      if (e.survive) {
        if (e.mine) this.game.entities?.spawn?.(V.EYE_OF_ENDER, 1, e.pos.clone());
      } else {
        const d = this.game.effects?.debris;
        if (d) for (let k = 0; k < 10; k++) d.spawn(e.pos.x, e.pos.y, e.pos.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.06, EYE_SHARD, 0.7);
        this.game.audio?.playBreak?.("glass");
      }
    }
  }

  // ---------- The elytra ----------

  // Gliding (player.js asks every frame through player.glide: true while it
  // flies the player itself). Vanilla's flight model (LivingEntity.travel
  // while fall flying), at its 20 ticks a second: the jump key in the air
  // with an elytra on spreads it; landing, water or the elytra worn down to
  // its last point folds it. It wears 1 a second; flying into a wall hurts
  // by the speed lost (vanilla's flyIntoWall). No fireworks in the game: no boost.
  _hookElytra() {
    const p = this.player;
    this._gv = new THREE.Vector3(); // blocks a tick
    this._gliding = false;
    this._spaceWas = false;
    this._glideT = 0;
    this._glideLast = null;
    p.glide = (dt) => this._glide(dt);
  }

  get gliding() {
    return this._gliding;
  }

  _glide(dt) {
    const p = this.player;
    const chest = this.game.inventory?.armor?.[1];
    const worn = !!chest && chest.id === V.ELYTRA && (chest.dur ?? 2) > 1;
    const space = p.keys?.has("Space");
    const pressed = space && !this._spaceWas;
    this._spaceWas = space;
    const free = !p.onGround && !p.flying && !p.inWater && !p.inLava && !p.onClimbable && !p.vehicle && !p.dead && !p.sleeping;
    if (!this._gliding) {
      if (!worn || !pressed || !free || p.velocity.y > 0.5) return false;
      this._gliding = true;
      this._gv.copy(p.velocity).multiplyScalar(TICK);
      this._glideLast = null;
    } else if (!worn || !free) {
      this._gliding = false;
      return false;
    }
    // (what the last frame's move did: a wall stops it, and hurts)
    if (this._glideLast) {
      const [x0, z0, sp, t] = this._glideLast;
      const actual = Math.hypot(p.position.x - x0, p.position.z - z0) / Math.max(1e-3, t) * TICK;
      if (actual < sp - 0.05) {
        const f = (sp - actual) * 10 - 3;
        if (f > 0) p.damage?.(f, "fly_into_wall");
        const k = sp > 1e-4 ? actual / sp : 0;
        this._gv.x *= k;
        this._gv.z *= k;
      }
    }
    this._glideT += dt;
    const look = p.getForwardVector();
    const pitch = -(p.pitch || 0); // (vanilla's: positive looking down)
    while (this._glideT >= TICK) {
      this._glideT -= TICK;
      const v = this._gv;
      const lookH = Math.hypot(look.x, look.z);
      const velH = Math.hypot(v.x, v.z);
      let c = Math.cos(pitch);
      c = c * c;
      v.y += 0.08 * (-1 + c * 0.75);
      if (v.y < 0 && lookH > 0) {
        const d5 = v.y * -0.1 * c;
        v.x += (look.x * d5) / lookH;
        v.y += d5;
        v.z += (look.z * d5) / lookH;
      }
      if (pitch < 0 && lookH > 0) {
        const d9 = velH * -Math.sin(pitch) * 0.04;
        v.x += (-look.x * d9) / lookH;
        v.y += d9 * 3.2;
        v.z += (-look.z * d9) / lookH;
      }
      if (lookH > 0) {
        v.x += ((look.x / lookH) * velH - v.x) * 0.1;
        v.z += ((look.z / lookH) * velH - v.z) * 0.1;
      }
      v.x *= 0.99;
      v.y *= 0.98;
      v.z *= 0.99;
      // (a point of wear every second, as vanilla)
      if (!p.creative && (this._wearT = (this._wearT || 0) + 1) >= 20) {
        this._wearT = 0;
        chest.dur = Math.max(1, (chest.dur ?? 432) - 1); // (worn to its last point, never broken)
        this.game.markInventoryChanged?.();
      }
    }
    p.velocity.copy(this._gv).multiplyScalar(1 / TICK);
    p.knockback?.set(0, 0, 0);
    this._glideLast = [p.position.x, p.position.z, Math.hypot(this._gv.x, this._gv.z), dt];
    return true;
  }

  // ---------- Hooks ----------

  _hookLib() {
    LIB.throwEnderEye = (ctx) => this.throwEye(ctx);
    LIB.placeEndCrystal = (ctx) => this._placeCrystal(ctx);
    LIB.onEndPortal = () => {
      this._scanT = 0;
      this.game.audio?.playTeleport?.();
      this.game.toast?.("The End portal opens");
    };
    // A glass bottle in a cloud of breath: dragon's breath (else its own use: water).
    const bottle = ITEM_USE[V.GLASS_BOTTLE];
    ITEM_USE[V.GLASS_BOTTLE] = (ctx) => this._bottle(ctx) || (bottle ? bottle(ctx) : false);
    // Chorus fruit: the eater is sent up to 8 blocks away (vanilla's 16 tries).
    const p = this.player;
    const eat = p.eat.bind(p);
    p.eat = (info, id) => {
      const back = eat(info, id);
      if (id === V.CHORUS_FRUIT && isVanilla()) this._chorusTeleport();
      return back;
    };
  }

  _chorusTeleport() {
    const p = this.player;
    const w = this.world;
    for (let i = 0; i < 16; i++) {
      const x = p.position.x + (Math.random() - 0.5) * 16;
      const z = p.position.z + (Math.random() - 0.5) * 16;
      let y = Math.floor(clamp(p.position.y + Math.floor(Math.random() * 16) - 8, 1, 126));
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      if (!w.getChunk(bx >> 4, bz >> 4)) continue;
      // (down onto the ground under it, as vanilla's randomTeleport)
      while (y > 1 && !IS_SOLID[w.getBlock(bx, y - 1, bz)]) y--;
      const at = w.getBlock(bx, y, bz);
      const head = w.getBlock(bx, y + 1, bz);
      if (y <= 1 || IS_SOLID[at] || IS_SOLID[head] || IS_WET[at] || IS_WET[w.getBlock(bx, y - 1, bz)]) continue;
      p.position.set(x, y, z);
      p.velocity?.set(0, 0, 0);
      p.resetFall?.();
      this.game.audio?.playTeleport?.();
      return true;
    }
    return false;
  }

  // Hits on the dragon and the crystals: they stand in among the creatures
  // for every weapon's ray and blow (as net/pvp.js's stand-ins).
  _hookCombat() {
    const mobs = this.game.mobs;
    if (!mobs) return;
    const raycast = mobs.raycast.bind(mobs);
    mobs.raycast = (origin, dir, reach, filter = null) => {
      let best = raycast(origin, dir, reach, filter);
      if (!this.inEnd) return best;
      for (const s of this._standInList()) {
        if (filter && !filter(s)) continue;
        _min.set(s.pos.x - s.box, s.pos.y, s.pos.z - s.box);
        _max.set(s.pos.x + s.box, s.pos.y + s.spec.h, s.pos.z + s.box);
        const t = rayBox(origin, dir, _min, _max, best ? best.distance : reach);
        if (t !== null && (!best || t < best.distance)) best = { mob: s, distance: t };
      }
      return best;
    };
    const sphereHit = mobs.sphereHit.bind(mobs);
    mobs.sphereHit = (p, r) => {
      const m = sphereHit(p, r);
      if (m || !this.inEnd) return m;
      for (const s of this._standInList()) {
        const hr = s.box + r;
        if (Math.abs(p.x - s.pos.x) < hr && Math.abs(p.z - s.pos.z) < hr && p.y > s.pos.y - r && p.y < s.pos.y + s.spec.h + r) return s;
      }
      return null;
    };
    const hurt = mobs._hurt.bind(mobs);
    mobs._hurt = (m, amount, dir, kb, byPlayer = false) => {
      if (!m?.isEndPart) return hurt(m, amount, dir, kb, byPlayer);
      if (!(amount > 0)) return false;
      return this._hitPart(m, amount, !!mobs.projectileHit);
    };
    // A blast (TNT, a bed, another crystal) reaches the crystals and the dragon's head.
    const explosion = mobs.explosion.bind(mobs);
    // (info: main.js onExplosion's; a mirrored blast, another peer's, was
    // judged for the dragon and the crystals where it went off: its claim)
    mobs.explosion = (center, radius, byPlayer = true, source = null, info = null) => {
      const r = explosion(center, radius, byPlayer, source, info);
      if (this.inEnd && !info?.mirror) this._blast(center, radius, byPlayer, source);
      return r;
    };
    // The egg: a punch sends it away (vanilla: it can't be mined in Survival).
    const ia = this.game.interaction;
    if (ia?._startMining) {
      const start = ia._startMining.bind(ia);
      ia._startMining = () => {
        const t = ia.target;
        if (t && !this.player.creative && this.world.getBlock(t.block[0], t.block[1], t.block[2]) === V.DRAGON_EGG) {
          teleportEgg(this.world, t.block[0], t.block[1], t.block[2]);
          return;
        }
        start();
      };
    }
    // An ender pearl into a gateway: its thrower goes through.
    const th = this.game.weapons?.throwables;
    if (th?.update) {
      const up = th.update.bind(th);
      th.update = (dt) => {
        if (this.inEnd) {
          for (let i = th.list.length - 1; i >= 0; i--) {
            const t = th.list[i];
            if (t.kind !== "pearl") continue;
            const g = this._gatewayAlong(t.pos, t.vel, dt);
            if (!g) continue;
            this.game.scene.remove(t.mesh);
            th.list.splice(i, 1);
            this.throughGateway(g);
          }
        }
        return up(dt);
      };
    }
  }

  // The gateway cell along this frame's move from `pos` (a slow frame's long
  // step would jump over one), before any solid block; or null.
  _gatewayAlong(pos, vel, dt) {
    const step = _w.copy(vel).multiplyScalar(dt);
    const n = Math.min(64, Math.max(1, Math.ceil(step.length() / 0.3)));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(pos.x + (step.x * k) / n);
      const y = Math.floor(pos.y + (step.y * k) / n);
      const z = Math.floor(pos.z + (step.z * k) / n);
      const id = this.world.getBlock(x, y, z);
      if (id === V.END_GATEWAY) return [x, y, z];
      if (IS_SOLID[id]) return null;
    }
    return null;
  }

  // The stand-ins: the dragon's head and body, every crystal.
  _standInList() {
    const out = [];
    const pose = this._poseNow;
    if (pose && pose.ph !== "dying") {
      this._hitBoxes.forEach((b, i) => out.push(this._standIn(`d${i}`, b.c.x, b.c.y - b.h, b.c.z, b.h, b.h * 2, { part: b.part === "head" ? "head" : "body" })));
    }
    for (const c of this.crystals()) out.push(this._standIn(c.key, c.x, c.y + 0.4, c.z, 0.9, 1.8, { crystal: c.key }));
    return out;
  }

  _standIn(key, x, y, z, box, h, extra) {
    let s = this._standIns.get(key);
    if (!s) this._standIns.set(key, (s = { isEndPart: true, kind: "ender_dragon", pos: new THREE.Vector3(), vel: new THREE.Vector3(), spec: { r: 1, h: 1, hostile: true, drops: [] }, dead: false, health: DRAGON_HP, maxHealth: DRAGON_HP, invulnerable: 0, hurtTime: 9 }));
    s.pos.set(x, y, z);
    s.box = box;
    s.spec.r = box;
    s.spec.h = h;
    s.part = extra.part || null;
    s.crystal = extra.crystal || null;
    return s;
  }

  // A blow or a shot on a stand-in (this player's): applied here, or claimed.
  _hitPart(s, amount, projectile) {
    if (s.crystal) {
      if (this.authority) this._burstCrystal(s.crystal);
      else this.sync?.claim({ k: "c", c: s.crystal });
      return true;
    }
    if (!this._poseNow || this._poseNow.ph === "dying") return false;
    if (this.authority) return this._damage(s.part, amount, projectile);
    if (projectile && SITTING.has(this._poseNow.ph)) return false;
    if (this.puppet) this.puppet.flashT = this.time + 0.3;
    this.sync?.claim({ k: "d", p: s.part, a: r1(amount), pj: projectile ? 1 : 0 });
    return true;
  }

  // A blast near the crystals and the dragon (this peer's own blasts).
  _blast(center, radius, byPlayer, source) {
    if (source === "end_respawn") return; // (the pillars' own rebuilding: a show, not a blast at their crystals)
    const power = source === "end_crystal" ? CRYSTAL_POWER : source === "bed" ? 5 : source === "tnt" ? 4 : source === "creeper" ? 3 : radius * 0.75;
    for (const c of this.crystals()) {
      if (Math.hypot(c.x - center.x, c.y + 1 - center.y, c.z - center.z) > power * 1.5) continue;
      if (this.authority) this._chain(c.key);
      else this.sync?.claim({ k: "c", c: c.key });
    }
    // (the dragon: a blast a player caused, or a bed's: vanilla's always-hurts
    // tag; TNT is taken as a player's, as vanilla's lit by one: who lit it isn't kept)
    const pose = this._poseNow;
    if (!pose || pose.ph === "dying" || !(byPlayer || source === "bed" || source === "tnt") || source === "end_crystal") return;
    const head = this.model.headPos(new THREE.Vector3());
    const q = 1 - head.distanceTo(center) / (2 * power);
    if (q <= 0) return;
    const dmg = Math.floor(((q * q + q) / 2) * 7 * 2 * power + 1);
    if (this.authority) this._damage("head", dmg, false);
    else this.sync?.claim({ k: "d", p: "head", a: dmg, pj: 0 });
  }

  // A claim from another peer (EndSync), here where the fight is simulated.
  onClaim(m) {
    if (!this.authority || !this.state) return;
    if (m.k === "d" && this.d) this._damage(m.p === "head" ? "head" : "body", clamp(Number(m.a) || 0, 0, 200), !!m.pj);
    else if (m.k === "c" && typeof m.c === "string") this._burstCrystal(m.c);
    else if (m.k === "place" && Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isInteger)) this._addPlaced(m.p);
    else if (m.k === "exit" && Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isInteger)) this._noteExit(m.p);
  }

  // An event from the peer that simulates the fight.
  onEvent(m) {
    if (!this.inEnd) return;
    if (m.k === "fb" && Array.isArray(m.p) && Array.isArray(m.d)) this._addFireball(new THREE.Vector3(m.p[0], m.p[1], m.p[2]), new THREE.Vector3(m.d[0], m.d[1], m.d[2]).normalize(), false);
    else if (m.k === "cl" && Array.isArray(m.p)) this._addCloud({ x: m.p[0], y: m.p[1], z: m.p[2], r: clamp(Number(m.r) || 3, 0.5, 8), grow: clamp(Number(m.g) || 0, 0, 1), life: clamp(Number(m.l) || 10, 0, 60), kind: m.kd === "breath" ? "breath" : "fireball" }, false);
    else if (m.k === "xp" && Array.isArray(m.p)) {
      this._dragonXp(m.p, clamp(Number(m.n) || 0, 0, 12000));
      this._dropPuppet();
      this.game.toast?.("The Ender Dragon is dead");
    }
  }

  // The world's edits: a chorus plant that lost its hold falls with
  // everything above and beside it that it held (vanilla's cascade).
  _hookWorld() {
    this.world.changeListeners?.push((changed, info) => {
      if (info?.remote || this.world.dim !== END) return;
      const w = this.world;
      const get = (x, y, z) => w.getBlock(x, y, z);
      let queue = null;
      for (let i = 0; i < changed.length; i += 3) {
        const x = changed[i];
        const y = changed[i + 1];
        const z = changed[i + 2];
        for (const [dx, dy, dz] of NEIGHBOURS) if (isChorus(get(x + dx, y + dy, z + dz))) (queue ||= []).push(x + dx, y + dy, z + dz);
      }
      if (!queue) return;
      // (later, so this edit has finished: the next frame's microtask)
      Promise.resolve().then(() => this._chorusFall(queue));
    });
  }

  _chorusFall(queue) {
    const w = this.world;
    const get = (x, y, z) => w.getBlock(x, y, z);
    let n = 0;
    while (queue.length && n < 256) {
      const z = queue.pop();
      const y = queue.pop();
      const x = queue.pop();
      const id = get(x, y, z);
      if (!isChorus(id) || chorusSurvives(get, x, y, z)) continue;
      n++;
      if (!w.setBlocks([x, y, z, BLOCK.AIR], { recordEdit: true })) continue;
      w.onBlockPopped?.(x, y, z, id);
      for (const [dx, dy, dz] of NEIGHBOURS) if (isChorus(get(x + dx, y + dy, z + dz))) queue.push(x + dx, y + dy, z + dz);
    }
  }
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// (vanilla's dragon_immune tag, of the blocks the game has)
const DRAGON_IMMUNE = new Set([BLOCK.BEDROCK, V.OBSIDIAN, V.END_STONE, V.IRON_BARS, V.END_PORTAL, V.END_GATEWAY, ...Array.from({ length: 8 }, (_, i) => V.END_PORTAL_FRAME + i), ...(V.CRYING_OBSIDIAN ? [V.CRYING_OBSIDIAN] : []), ...(V.RESPAWN_ANCHOR ? Array.from({ length: 5 }, (_, i) => V.RESPAWN_ANCHOR + i) : [])]);
const HURT_FLASH = new THREE.Color(0.9, 0.05, 0.05);
const BREATH_GLOW = new THREE.Color(1.6, 0.35, 1.7);
const BREATH_END = new THREE.Color(0.5, 0.1, 0.7);
const PORTAL_MOTE = new THREE.Color(1.4, 0.4, 2.2);
const EYE_SHARD = new THREE.Color(0.2, 0.55, 0.35);

// A fight's state from a save or a message, checked; null if it isn't one.
function sanitizeState(st) {
  if (!st || typeof st !== "object") return null;
  const ints3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isInteger);
  const nums3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const hp = Number(st.hp);
  return {
    v: 1,
    alive: !!st.alive,
    killed: !!st.killed,
    hp: Number.isFinite(hp) ? clamp(hp, 0, DRAGON_HP) : DRAGON_HP,
    pos: nums3(st.pos) ? st.pos.map((v, i) => clamp(v, i === 1 ? 10 : -400, i === 1 ? 126 : 400)) : SPAWN_AT.slice(),
    dying: st.alive && Number.isFinite(st.dying) ? clamp(st.dying, 0, 10) : null,
    crystals: (Number(st.crystals) | 0) & 0x3ff,
    placed: Array.isArray(st.placed) ? st.placed.filter(ints3).slice(0, 16) : [],
    gateways: Array.isArray(st.gateways) ? [...new Set(st.gateways.filter((i) => Number.isInteger(i) && i >= 0 && i < 20))] : [],
    exits: Array.isArray(st.exits) ? st.exits.filter(ints3).slice(0, 40) : [],
    respawn: st.respawn && typeof st.respawn === "object" && Number.isFinite(st.respawn.t) ? { t: clamp(st.respawn.t, 0, 30), n: clamp(st.respawn.n | 0, 0, 10) } : null,
  };
}

// ---------- Online ----------

// The multiplayer module (EndGame adds it):
//   "edr"  (fast) the dragon's pose, from the peer that simulates the End
//   "eds"  the fight's state (the host keeps it; a joiner gets it: "endFight")
//   "edh"  a hit or a use claimed of the peer that simulates the End:
//          { k: "d", p: part, a, pj } the dragon, { k: "c", c } a crystal,
//          { k: "place", p } a crystal put down, { k: "exit", p } a gateway made
//   "edf"  what the dragon did: { k: "fb" } a fireball, { k: "cl" } a cloud,
//          { k: "xp" } its experience, { k: "die" }
//   "eye"  an eye of ender thrown (drawn by everyone in that dimension)
// "edr", "edf" and "eye" are stamped with their dimension and dropped by the
// peers in another (session.js dimStamp / dimDrop).
class EndSync {
  constructor(mp, end) {
    this.mp = mp;
    this.net = mp.net;
    this.end = end;
    const net = this.net;
    for (const t of ["edr", "edf", "eye"]) {
      net.dimStamp?.add(t);
      net.dimDrop?.add(t);
    }
    net.on("edr", (m, from) => this._onPose(m, from));
    net.on("eds", (m) => this._onState(m));
    net.on("edh", (m, from) => this.end.onClaim(m, from));
    net.on("edf", (m) => this.end.onEvent(m));
    net.on("eye", (m) => this._onEye(m));
    net.registerSync("endFight", {
      save: () => (end._capture(), end.state ? { st: end.state } : null),
      load: (d) => d?.st && end.applyState(d.st),
    });
  }

  get active() {
    return this.mp.active && this.mp.stateLoaded;
  }

  // (the dimension stamps need the dimension engine's sets, made after this
  // module when it came first)
  start() {
    for (const t of ["edr", "edf", "eye"]) {
      this.net.dimStamp?.add(t);
      this.net.dimDrop?.add(t);
    }
  }

  // The player who simulates the End: the host if it is there, else the
  // lowest player number there (js/dimensions.js simulatesWorld).
  authorityPid() {
    const players = this.net.players;
    const code = DIMS[END].code;
    if ((players.get(HOST_PID)?.dim | 0) === code) return HOST_PID;
    let best = null;
    for (const p of players.values()) if ((p.dim | 0) === code && (best === null || p.pid < best)) best = p.pid;
    return best;
  }

  sendPose(pose) {
    if (!this.active) return;
    const m = { t: "edr", ts: this.net.time, p: [r2(pose.p[0]), r2(pose.p[1]), r2(pose.p[2])], v: [r1(pose.v[0]), r1(pose.v[1]), r1(pose.v[2])], y: r2(pose.y), pi: r2(pose.pi), r: r2(pose.r), ph: PHASES.indexOf(pose.ph), hp: r1(pose.hp), j: r2(pose.j), dt: r1(pose.dt) };
    if (pose.hl) m.hl = pose.hl;
    this.net.toAll(m, { fast: true });
  }

  sendState() {
    if (!this.active || !this.end.state) return;
    this.net.toAll({ t: "eds", st: this.end.state });
  }

  event(e) {
    if (!this.active) return;
    this.net.toAll({ t: "edf", ...e });
  }

  claim(c) {
    if (!this.active) return;
    const pid = this.authorityPid();
    if (!pid || pid === this.net.pid) return;
    this.net.toPlayer(pid, { t: "edh", ...c });
  }

  eye(p, g, s) {
    if (!this.active) return;
    this.net.toAll({ t: "eye", p, g, s: s ? 1 : 0 });
  }

  _onPose(m, from) {
    if (from === this.net.pid || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    this.end.onPose(m);
  }

  _onState(m) {
    // (the host keeps it whoever sent it; everyone mirrors the one who simulates)
    if (this.end.authority && this.end.d) return;
    this.end.applyState(m.st);
  }

  _onEye(m) {
    if (!Array.isArray(m.p) || !Array.isArray(m.g) || !m.p.every(Number.isFinite) || !m.g.every(Number.isFinite)) return;
    this.end._addEye(new THREE.Vector3(m.p[0], m.p[1], m.p[2]), m.g, !!m.s, false);
  }
}
