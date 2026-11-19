// (Round 21) The colossi's procedural models: shared geometry and materials,
// and the helpers js/colossi.js builds each creature with. Nothing here is a
// copy of any film's creature: the shapes are made of tapered limbs (one
// unit cylinder, scaled and turned between two joints every frame), knobbly
// joints (one unit sphere), lumpy bodies (a sphere pushed about by a seeded
// noise) and glowing orbs (the weak points).
//
// Cheap to draw: every limb of every colossus shares one of a few cylinder
// geometries (by taper and by detail: far legs use the coarse ones, LOD),
// the materials are shared by kind, nothing casts shadows, and the swarm is
// one InstancedMesh (parasiteGeometry). The hides ignore the scene's fog
// (fog: false): a colossus far out in the haze is a dark silhouette against
// the sky, tinted toward the horizon's colour by js/colossi.js (hazeTo).
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

// A small seeded random (mulberry32): the same creature on every machine.
export function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Geometry (shared) ----------

const geoCache = new Map();

// A limb: a cylinder from y 0 (radius 1) to y 1 (radius `taper`), so a mesh
// scaled (r, length, r) and turned along a bone spans it. Two levels of
// detail; a little bulge at both ends hides the joins.
export function limbGeometry(taper = 0.6, lod = 0) {
  const key = `limb:${taper.toFixed(2)}:${lod}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(taper, 1, 1, lod ? 5 : 8, lod ? 1 : 3, false);
    g.translate(0, 0.5, 0);
    // Knobbly: the middle rings a touch thinner (bony shafts).
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = 1 - 0.18 * Math.sin(Math.PI * y);
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    geoCache.set(key, g);
  }
  return g;
}

export function ballGeometry(lod = 0) {
  const key = `ball:${lod}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = new THREE.SphereGeometry(1, lod ? 7 : 12, lod ? 5 : 9)));
  return g;
}

export function spikeGeometry() {
  let g = geoCache.get("spike");
  if (!g) {
    g = new THREE.ConeGeometry(1, 1, 5, 1);
    g.translate(0, 0.5, 0);
    geoCache.set("spike", g);
  }
  return g;
}

// A shell plate: a cap of a sphere (the armour over a weak point), facing +Z.
export function plateGeometry() {
  let g = geoCache.get("plate");
  if (!g) {
    g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
    g.rotateX(Math.PI / 2);
    // Ridged: a few rings pushed out.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const k = 1 + 0.06 * Math.sin(z * 18);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, z);
    }
    g.computeVertexNormals();
    geoCache.set("plate", g);
  }
  return g;
}

// A rib: an arc (a torus segment) in the XY plane, from the back (-Y, where
// the spine is) round the side (+X; side -1: -X) to part of the front.
export function ribGeometry(side = 1) {
  const key = `rib:${side}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.TorusGeometry(1, 0.07, 4, 12, Math.PI * 0.82);
    g.rotateZ(-Math.PI / 2);
    if (side < 0) g.rotateY(Math.PI);
    geoCache.set(key, g);
  }
  return g;
}

// A lumpy body: a sphere scaled (sx, sy, sz) whose surface is pushed in and
// out by a few seeded waves (bulges, folds), with dark veins left in the
// vertex colours. Each colossus has its own (by its seed).
export function lumpyGeometry(seed, sx, sy, sz, amp = 0.12, detail = 24) {
  const rnd = seeded(seed);
  const g = new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7));
  const pos = g.attributes.position;
  const waves = [];
  for (let i = 0; i < 7; i++) waves.push([rnd() * 6 + 2, rnd() * 6 + 2, rnd() * 6 + 2, rnd() * Math.PI * 2, (rnd() * 0.6 + 0.4) * amp]);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let k = 1;
    for (const [a, b, c, ph, w] of waves) k += w * Math.sin(x * a + y * b + z * c + ph);
    const vein = Math.abs(Math.sin(x * 9.1 + z * 7.3 + Math.sin(y * 5.2) * 2));
    pos.setXYZ(i, x * sx * k, y * sy * k, z * sz * k);
    const shade = 0.65 + 0.35 * Math.min(1, vein * 3) + (k - 1) * 0.8;
    col[i * 3] = shade;
    col[i * 3 + 1] = shade * 0.92;
    col[i * 3 + 2] = shade * 0.9;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// The parasite: a pointed body and two wings, the eyes glowing (vertex
// colours over 1: the bloom picks them up). One geometry for the swarm's
// InstancedMesh (its wings beat by the instance's scale).
export function parasiteGeometry() {
  let g = geoCache.get("parasite");
  if (g) return g;
  const parts = [];
  const body = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
  body.scale(0.7, 0.55, 2.0);
  parts.push([body, [0.08, 0.07, 0.09]]);
  const tail = new THREE.ConeGeometry(0.35, 2.2, 4).toNonIndexed();
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, 2.6);
  parts.push([tail, [0.12, 0.05, 0.05]]);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.Float32BufferAttribute([0.4, 0.1, -0.6, 3.4, 0.6, 0.6, 0.5, 0.1, 1.2, -0.4, 0.1, -0.6, -0.5, 0.1, 1.2, -3.4, 0.6, 0.6], 3));
  parts.push([wing, [0.25, 0.18, 0.22]]);
  const eye = new THREE.OctahedronGeometry(0.42, 0).toNonIndexed();
  eye.translate(0, 0.25, -1.6);
  parts.push([eye, [6, 1.2, 0.4]]);
  let n = 0;
  for (const [p] of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const [p, c] of parts) {
    const a = p.attributes.position.array;
    pos.set(a, o * 3);
    for (let i = 0; i < p.attributes.position.count; i++) col.set(c, (o + i) * 3);
    o += p.attributes.position.count;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  geoCache.set("parasite", g);
  return g;
}

// ---------- Materials (shared, by kind) ----------

let mats = null;
export const HIDE_COLORS = {
  strider: new THREE.Color(0.055, 0.05, 0.06),
  weeper: new THREE.Color(0.2, 0.18, 0.17),
  hive: new THREE.Color(0.11, 0.065, 0.075),
};
export function colossusMaterials() {
  if (mats) return mats;
  const hide = (c) => new THREE.MeshLambertMaterial({ color: c.clone(), vertexColors: false, fog: false });
  const body = (c) => new THREE.MeshLambertMaterial({ color: c.clone(), vertexColors: true, fog: false });
  const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false });
  mats = {
    hide: { strider: hide(HIDE_COLORS.strider), weeper: hide(HIDE_COLORS.weeper), hive: hide(HIDE_COLORS.hive) },
    body: { strider: body(HIDE_COLORS.strider), weeper: body(HIDE_COLORS.weeper), hive: body(HIDE_COLORS.hive) },
    bone: new THREE.MeshLambertMaterial({ color: new THREE.Color(0.32, 0.29, 0.26), fog: false }),
    plate: new THREE.MeshLambertMaterial({ color: new THREE.Color(0.3, 0.3, 0.33), emissive: new THREE.Color(0.02, 0.03, 0.05), fog: false }),
    cracked: new THREE.MeshLambertMaterial({ color: new THREE.Color(0.1, 0.06, 0.05), emissive: new THREE.Color(0.5, 0.08, 0.02), fog: false }),
    dead: new THREE.MeshLambertMaterial({ color: new THREE.Color(0.05, 0.04, 0.04), fog: false }),
    glow: {
      joint: glow(4, 1.4, 0.35), // the Strider's knees: hot orange
      sac: glow(3.4, 0.6, 0.15), // its sac: red-orange
      eye: glow(4.5, 0.25, 0.2), // the Watcher's eyes: red
      wrist: glow(1.2, 2.6, 4.2), // its wrists' nerves: cold blue
      heart: glow(4, 0.3, 1.2), // the hearts: magenta
      egg: glow(1.1, 4, 0.6), // the Hive Mother's egg sacs: sick green
    },
    // (One per kind of glow, made brighter while it can be hurt three times
    // over: an eye charging the beam, a sac about to burst open.)
    hot: glow(6, 5, 2.5),
    acid: glow(1.6, 4.5, 0.4),
    beam: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.4), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    beamHalo: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.15, 0.1), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    swarm: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }),
  };
  return mats;
}

// ---------- Placing parts ----------

// A limb mesh (shared geometry) in `group`.
export function makeLimb(group, mat, taper = 0.6) {
  const m = new THREE.Mesh(limbGeometry(taper, 0), mat);
  m.userData.taper = taper;
  m.matrixAutoUpdate = true;
  group.add(m);
  return m;
}

// Spans limb `m` from a to b with radius r at a.
export function placeLimb(m, a, b, r) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.position.copy(a);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
  m.scale.set(r, Math.max(0.01, len), r);
}

export function makeBall(group, mat, lod = 0) {
  const m = new THREE.Mesh(ballGeometry(lod), mat);
  group.add(m);
  return m;
}

// Swaps the limbs and balls of `group` to the coarse geometry far off (lod 1).
export function setLod(group, lod) {
  if (group.userData.lod === lod) return;
  group.userData.lod = lod;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.taper !== undefined) o.geometry = limbGeometry(o.userData.taper, lod);
    else if (o.geometry === ballGeometry(0) || o.geometry === ballGeometry(1)) o.geometry = ballGeometry(lod);
  });
}

// Two-bone IK: the knee of a limb from hip h to foot f (lengths l1, l2),
// bent toward `pole`. Writes it to `out`; returns false when the foot is out
// of reach (the limb then lies straight toward it).
const _dir = new THREE.Vector3();
const _pl = new THREE.Vector3();
export function solveKnee(h, f, l1, l2, pole, out) {
  _dir.subVectors(f, h);
  let d = _dir.length();
  if (d < 1e-6) {
    out.copy(h).addScaledVector(pole, l1);
    return true;
  }
  _dir.divideScalar(d);
  const reach = d <= l1 + l2 - 0.01;
  d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.01, d));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _pl.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pl.lengthSq() < 1e-8) _pl.set(0, 1, 0);
  _pl.normalize();
  out.copy(h).addScaledVector(_dir, a).addScaledVector(_pl, hh);
  return reach;
}
