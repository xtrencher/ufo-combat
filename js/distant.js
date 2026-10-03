// Distant structures (Round 8): airports, cities and villages seen from far
// away. The distant terrain (lod.js) is a heightfield: buildings only
// appeared once their full-detail chunks loaded, so a city was flat ground
// until you were almost in it. Here every site and village within the view
// distance gets simplified shapes (boxes in the buildings' own colours:
// hangars, the tower, the terminal, fuel tanks, the radar, the city's
// houses, mid-rises and skyscrapers with their setbacks, the village
// houses with their roofs), merged per chunk; a chunk's shapes hide as soon
// as its real blocks are on screen, so the two never show together.
//
// Airport lights: the runway edge lights, the green thresholds, the
// approach light rows and a red beacon on the tower are drawn as glowing
// points, visible from far away at night (fading in at dusk), so an airport
// and its runway can be found in the dark from kilometres off.
import * as THREE from "three";
import { BLOCK } from "./blocks.js";
import { LAYER_FX } from "./layers.js";
import { createLodMaterial } from "./shaders.js";
import { NUKE_CLEAR } from "./nuke.js";

const REFRESH = 1; // seconds between checks of what is near
const LIGHTS_RANGE = 4500; // blocks: airport lights are drawn this far

function lightTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.8)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class DistantStructures {
  constructor({ scene, world, material = null }) {
    this.scene = scene;
    this.world = world;
    this.sites = world.terrain.sites;
    this.villages = world.terrain.villages;
    this.group = new THREE.Group();
    this.group.name = "distant-structures";
    scene.add(this.group);
    // (the distant terrain's own material: the same light, haze and fog as the land around)
    this.material = material || createLodMaterial();
    this.entries = new Map(); // id -> { meshes: [{ mesh, cx, cz }], lights }
    this.enabled = true;
    this.viewRange = 400;
    this.night = 0;
    // The nukes' blast zones ({ x, z, R }): nothing is left standing in them,
    // so no shapes or lights are drawn there (main.js: nuke.zones).
    this.zones = () => [];
    this._zoneSig = "";
    this._t = 0;
    this._lightTex = lightTexture();
  }

  // ---------- Geometry ----------

  // A block's colour (sRGB, like the distant terrain's palette).
  _color(id, k = 1) {
    const rgb = this.world.blockColors[id] || [0.6, 0.6, 0.6];
    return { r: rgb[0] * k, g: rgb[1] * k, b: rgb[2] * k };
  }

  // A box from world (x0, y0, z0) to (x1, y1, z1): walls `wall`, top `roof`
  // (in the distant terrain's vertex format: sRGB colour + occlusion, face index).
  _box(out, x0, y0, z0, x1, y1, z1, wall, roof) {
    const p = out.pos;
    const c = out.col;
    const n = out.info;
    const quad = (a, b, cc, d, face, col, aoLow, aoTop) => {
      for (const [v, ao] of [[a, aoLow], [b, aoLow], [cc, aoTop], [a, aoLow], [cc, aoTop], [d, aoTop]]) {
        p.push(v[0], v[1], v[2]);
        n.push(face, 0, 0, 0);
        c.push(col.r, col.g, col.b, ao);
      }
    };
    // Sides (a little darker at the foot), then the top.
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 4, wall, 0.7, 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 5, wall, 0.7, 1);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0, wall, 0.7, 1);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 1, wall, 0.7, 1);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 2, roof, 1, 1);
  }

  // A box in a site's local (u, v) frame, u0..u1 and v0..v1 inclusive, y above the pad.
  _siteBox(acc, s, u0, u1, v0, v1, y0, y1, wall, roof) {
    const [ax, az] = this.sites.toWorld(s, u0, v0);
    const [bx, bz] = this.sites.toWorld(s, u1, v1);
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx) + 1;
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz) + 1;
    const base = s.y + 1;
    this._add(acc, x0, base + y0, z0, x1, base + y1, z1, wall, roof);
  }

  // Whether (x, z) lies where a nuke swept everything away.
  _blasted(x, z) {
    for (const zn of this._zoneList || []) if (Math.hypot(x - zn.x, z - zn.z) < zn.R * NUKE_CLEAR) return true;
    return false;
  }

  // Into the accumulator of the chunk the box's middle stands in.
  _add(acc, x0, y0, z0, x1, y1, z1, wall, roof) {
    if (this._blasted((x0 + x1) / 2, (z0 + z1) / 2)) return;
    const cx = Math.floor((x0 + x1) / 2) >> 4;
    const cz = Math.floor((z0 + z1) / 2) >> 4;
    const key = `${cx},${cz}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { cx, cz, pos: [], info: [], col: [] }));
    this._box(a, x0, y0, z0, x1, y1, z1, wall, roof);
  }

  _buildSite(s) {
    const acc = new Map();
    const stone = this._color(BLOCK.STONE);
    const darkStone = this._color(BLOCK.STONE, 0.75);
    const brick = this._color(BLOCK.BRICKS);
    const glass = { r: 0.42, g: 0.55, b: 0.66 };
    const cobble = this._color(BLOCK.COBBLESTONE);
    const white = this._color(BLOCK.WOOL);
    for (const h of s.hangars || []) this._siteBox(acc, s, h.u0, h.u1, h.v0, h.v1, 0, h.h, stone, darkStone);
    const t = s.tower;
    if (t) {
      this._siteBox(acc, s, t.u0, t.u1, t.v0, t.v1, 0, t.h - 3, t.wall === BLOCK.BRICKS || t.wall === undefined ? brick : this._color(t.wall), brick);
      this._siteBox(acc, s, t.u0 - 1, t.u1 + 1, t.v0 - 1, t.v1 + 1, t.h - 3, t.h + 1, glass, this._color(BLOCK.PLANKS));
    }
    const tm = s.terminal;
    if (tm) this._siteBox(acc, s, tm.u0, tm.u1, tm.v0, tm.v1, 0, tm.h, glass, stone);
    for (const k of s.tanks || []) this._siteBox(acc, s, Math.round(k.u - k.r), Math.round(k.u + k.r), Math.round(k.v - k.r), Math.round(k.v + k.r), 0, k.h, cobble, cobble);
    if (s.radar) this._siteBox(acc, s, s.radar.u - s.radar.r, s.radar.u + s.radar.r, s.radar.v - s.radar.r, s.radar.v + s.radar.r, 0, s.radar.r + 3, white, white);
    for (const lot of s.lots || []) {
      if (!lot.boxes?.length) continue;
      const wall = this._color(lot.wall);
      const roof = this._color(lot.roof || BLOCK.STONE);
      const curtain = lot.curtain ? glass : wall;
      for (const b of lot.boxes) this._siteBox(acc, s, b.u0, b.u1, b.v0, b.v1, b.y0, b.y1 + 1, lot.kind === "skyscraper" ? curtain : wall, roof);
    }
    return acc;
  }

  _buildVillage(v) {
    const acc = new Map();
    const planks = this._color(BLOCK.PLANKS);
    const roof = this._color(BLOCK.OAK_BARK);
    for (const h of this.villages.houses?.(v) || []) {
      const x0 = v.x + h.x;
      const z0 = v.z + h.z;
      const y0 = v.groundY + 1;
      this._add(acc, x0, y0, z0, x0 + h.w, y0 + h.h, z0 + h.d, planks, planks);
      this._add(acc, x0 - 1, y0 + h.h, z0 - 1, x0 + h.w + 1, y0 + h.h + 1, z0 + h.d + 1, roof, roof);
      this._add(acc, x0 + 1, y0 + h.h + 1, z0 + 1, x0 + h.w - 1, y0 + h.h + 3, z0 + h.d - 1, roof, roof);
    }
    return acc;
  }

  _meshes(acc) {
    const out = [];
    for (const a of acc.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
      geo.setAttribute("aColor", new THREE.Float32BufferAttribute(a.col, 4));
      geo.setAttribute("aInfo", new THREE.Float32BufferAttribute(a.info, 4));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.group.add(mesh);
      out.push({ mesh, cx: a.cx, cz: a.cz });
    }
    return out;
  }

  // ---------- Airport lights ----------

  _buildLights(s) {
    const pos = [];
    const col = [];
    const add = (u, v, y, r, g, b) => {
      const [x, z] = this.sites.toWorld(s, u, v);
      if (this._blasted(x, z)) return;
      pos.push(x + 0.5, s.y + y, z + 0.5);
      col.push(r, g, b);
    };
    const half = s.half;
    const rw = s.rw;
    // The runway's edge lights (the same spots as the glowing blocks), white.
    for (let u = -half; u <= half; u += 12) for (const v of [-(rw + 2), rw + 2]) add(u, v, 1.6, 1.0, 0.95, 0.8);
    // Green thresholds across both ends, red end lights beyond them.
    for (let v = -rw; v <= rw; v += 3) {
      add(-half - 2, v, 1.5, 0.3, 1.0, 0.4);
      add(half + 2, v, 1.5, 0.3, 1.0, 0.4);
      add(-half - 6, v, 1.5, 1.0, 0.25, 0.2);
      add(half + 6, v, 1.5, 1.0, 0.25, 0.2);
    }
    // Approach lights: rows reaching out from both ends.
    for (let k = 1; k <= 8; k++) {
      for (const sgn of [-1, 1]) {
        const u = sgn * (half + 6 + k * 12);
        for (let v = -4; v <= 4; v += 2) add(u, v, 2.2, 1.0, 0.92, 0.75);
      }
    }
    // The taxiway's blue edge lights, sparse.
    for (let u = -half + 6; u <= half - 6; u += 24) add(u, rw + 6, 1.2, 0.35, 0.55, 1.0);
    // A red beacon on the control tower.
    if (s.tower) add((s.tower.u0 + s.tower.u1) / 2, (s.tower.v0 + s.tower.v1) / 2, s.tower.h + 3, 1.0, 0.15, 0.1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, map: this._lightTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.matrixAutoUpdate = false;
    pts.layers.set(LAYER_FX);
    pts.renderOrder = 14;
    pts.visible = false;
    this.group.add(pts);
    return pts;
  }

  // ---------- Per frame ----------

  update(dt, camera) {
    const px = camera.position.x;
    const pz = camera.position.z;
    if (!this.enabled) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = REFRESH;
      this._refresh(px, pz);
    }
    // A chunk's shapes hide once its real blocks are on screen.
    for (const e of this.entries.values()) {
      for (const m of e.meshes) {
        const chunk = this.world.getChunk(m.cx, m.cz);
        m.mesh.visible = !(chunk && chunk.meshed && chunk.group.visible);
      }
      if (e.lights) {
        // Fading in at dusk, a little brighter with the dark; a gentle shimmer far off.
        const k = Math.max(0, Math.min(1, (this.night - 0.15) / 0.45));
        e.lights.visible = k > 0.01;
        e.lights.material.opacity = k;
        const d = Math.hypot(e.x - px, e.z - pz);
        e.lights.material.size = d > 1500 ? 4 : d > 600 ? 5 : 6;
        // Beyond the far plane the lights are drawn pulled in toward the eye
        // (the same direction, the same size on screen: the points don't
        // shrink with distance), so they show from kilometres off.
        const near = camera.far * 0.8;
        const far = d + Math.max(e.reach, 1);
        const pull = far > near ? near / far : 1;
        e.lights.scale.setScalar(pull);
        e.lights.position.copy(camera.position).multiplyScalar(1 - pull);
        e.lights.updateMatrix();
      }
    }
  }

  _refresh(px, pz) {
    const range = Math.max(300, this.viewRange);
    // A new nuke: everything is built again (without what it swept away).
    this._zoneList = this.zones() || [];
    const sig = this._zoneList.map((zn) => `${Math.round(zn.x)},${Math.round(zn.z)},${zn.R}`).join(";");
    if (sig !== this._zoneSig) {
      this._zoneSig = sig;
      for (const e of this.entries.values()) {
        for (const m of e.meshes) {
          this.group.remove(m.mesh);
          m.mesh.geometry.dispose();
        }
        if (e.lights) {
          this.group.remove(e.lights);
          e.lights.geometry.dispose();
          e.lights.material.dispose();
        }
      }
      this.entries.clear();
    }
    const want = new Map();
    for (const s of this.sites.within(px, pz, Math.max(range, LIGHTS_RANGE) + 600)) {
      const d = Math.hypot(s.x - px, s.z - pz);
      want.set(s.id, { kind: "site", o: s, shapes: d < range + 600, lights: s.kind === "airport" && d < LIGHTS_RANGE + 600 });
    }
    if (this.villages) {
      for (const v of this.villages._villagesNear(px - range, pz - range, px + range, pz + range)) {
        if (Math.hypot(v.x - px, v.z - pz) > range + 100) continue;
        want.set(`village:${v.x},${v.z}`, { kind: "village", o: v, shapes: true, lights: false });
      }
    }
    for (const [id, e] of this.entries) {
      const w = want.get(id);
      if (w && (w.shapes || !e.meshes.length)) continue;
      // Gone out of range (or only the lights are still wanted): its shapes go.
      for (const m of e.meshes) {
        this.group.remove(m.mesh);
        m.mesh.geometry.dispose();
      }
      e.meshes = [];
      if (!w) {
        if (e.lights) {
          this.group.remove(e.lights);
          e.lights.geometry.dispose();
          e.lights.material.dispose();
        }
        this.entries.delete(id);
      }
    }
    for (const [id, w] of want) {
      let e = this.entries.get(id);
      if (!e) this.entries.set(id, (e = { meshes: [], lights: null, x: w.o.x, z: w.o.z, reach: (w.o.half || 0) + 120 }));
      if (w.shapes && !e.meshes.length) e.meshes = this._meshes(w.kind === "site" ? this._buildSite(w.o) : this._buildVillage(w.o));
      if (w.lights && !e.lights) e.lights = this._buildLights(w.o);
    }
  }
}
