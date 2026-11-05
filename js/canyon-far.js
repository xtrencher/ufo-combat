// (Round 17) The canyon run's far terrain: the canyon beyond the chunks the
// run streams in full (js/canyon.js), drawn as a light ribbon of its own,
// the way the main game draws its distant land as simplified tiles
// (js/lod.js) past the chunks. Built from the course's own shape (js/dim-canyon.js
// rows: the walls at a few heights, the plateau's top, the floor and the
// river) in the scenery's colours, one small mesh per row of chunks (16
// blocks of course), a few hundred vertices each, cached while ahead of the
// jet. It also fills a row of the streamed corridor whose chunks aren't
// drawn yet (nothing but the sky showed there). Arches, tunnels' roofs,
// pillars and asteroids are left out: from that far they are a detail.
import * as THREE from "three";
import { CANYON_BIOMES } from "./canyon-biomes.js";
import { LAYER_WORLD } from "./layers.js";

const STEP = 4; // blocks between two cross-sections
const LEVELS = 6; // heights sampled up each wall (floor to rim)
const SINK = 1.4; // blocks the ribbon sits back into the rock (the real blocks cover it where both are drawn)
const TONE = 0.5; // the colours' brightness against the blocks' own
const OUTER = 140; // blocks of plateau beyond each rim

export class CanyonFar {
  // world: World (its block colours); course: CanyonCourse; scene.
  constructor(scene, world, course) {
    this.scene = scene;
    this.world = world;
    this.course = course;
    this.group = new THREE.Group();
    this.group.name = "canyon-far";
    this.group.layers.set(LAYER_WORLD);
    scene.add(this.group);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
    this.segs = new Map(); // cz -> Mesh
    this._col = new THREE.Color();
    this._colors = new Map(); // block id -> [r, g, b] linear
    this.stats = { built: 0, shown: 0 };
  }

  // Each frame: the rows from..to (chunk rows) shown, except those `drawn`
  // says the chunks cover; the rest hidden, the ones well behind dropped.
  update(pcz, from, to, drawn, budget = 3) {
    let built = 0;
    let shown = 0;
    for (const [cz, m] of this.segs) {
      if (cz < pcz - 2) {
        this._dispose(cz, m);
        continue;
      }
      if (m) m.visible = false;
    }
    for (let cz = from; cz <= to; cz++) {
      if (cz * 16 > this.course.length + 600) break;
      if (drawn(cz)) continue;
      let m = this.segs.get(cz);
      if (!m) {
        if (built >= budget) continue;
        m = this._build(cz);
        built++;
        this.segs.set(cz, m);
        if (!m) continue;
        this.group.add(m);
      }
      if (m) {
        m.visible = true;
        shown++;
      }
    }
    this.stats.built += built;
    this.stats.shown = shown;
  }

  dispose() {
    for (const [cz, m] of this.segs) this._dispose(cz, m);
    this.scene.remove(this.group);
    this.material.dispose();
  }

  _dispose(cz, m) {
    if (m) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.segs.delete(cz);
  }

  _color(id) {
    let c = this._colors.get(id);
    if (!c) {
      const s = this.world.blockColors?.[id] || [0.5, 0.45, 0.4];
      this._col.setRGB(s[0], s[1], s[2], THREE.SRGBColorSpace);
      // (toned down to the chunks' own shading under the same lights: the
      // world's shader is darker than a plain lit material, and hazier)
      const l = (this._col.r + this._col.g + this._col.b) / 3;
      c = [this._col.r, this._col.g, this._col.b].map((x) => (x + (l - x) * 0.25) * TONE);
      this._colors.set(id, c);
    }
    return c;
  }

  // One row of chunks' ribbon (null where there is nothing to draw: space).
  _build(cz) {
    const c = this.course;
    const z0 = cz * 16;
    const sections = [];
    for (let z = z0; z <= z0 + 16; z += STEP) {
      const r = c.row(z);
      if (r.space) return null;
      sections.push(this._section(r));
    }
    const n = sections[0].length;
    const pos = new Float32Array(sections.length * n * 3);
    const col = new Float32Array(sections.length * n * 3);
    let k = 0;
    for (let s = 0; s < sections.length; s++) {
      const z = z0 + s * STEP;
      for (const p of sections[s]) {
        pos[k] = p[0];
        pos[k + 1] = p[1];
        pos[k + 2] = z;
        col[k] = p[2][0];
        col[k + 1] = p[2][1];
        col[k + 2] = p[2][2];
        k += 3;
      }
    }
    const index = [];
    for (let s = 0; s + 1 < sections.length; s++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = s * n + i;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.layers.set(LAYER_WORLD);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  // A cross-section, left to right: [x, y, colour]: the plateau, down the
  // left wall, across the floor (the river in it), up the right wall, the plateau.
  _section(r) {
    const c = this.course;
    const id = r.bt > 0.5 ? r.bb : r.ba;
    const B = CANYON_BIOMES[id] || CANYON_BIOMES.mesa;
    const strata = c.strata[id] || c.strata.mesa;
    const H = r.L.length;
    const rim = Math.max(r.floor + 4, Math.min(H - 2, Math.floor(r.rim)));
    const top = rim + 1.5 - SINK;
    const band = (y) => strata.id[Math.max(0, Math.min(strata.id.length - 1, Math.floor(y + r.tilt + 32)))];
    const topC = this._color(B.top);
    const floorC = this._color(Array.isArray(B.floor) ? B.floor[0] : B.floor);
    const riverC = this._color(B.river);
    const pts = [];
    const ys = [];
    for (let i = LEVELS - 1; i >= 0; i--) ys.push(Math.round(r.floor + 1 + ((rim - r.floor - 1) * i) / (LEVELS - 1)));
    const lRim = r.L[rim] - SINK;
    const rRim = r.R[rim] + SINK;
    pts.push([Math.min(lRim, r.xc - (r.W * r.sec + OUTER)), top, topC]);
    pts.push([lRim, top, topC]);
    for (const y of ys) pts.push([r.L[y] - SINK, y, this._color(band(y))]);
    const fy = r.floor + 0.6 - SINK * 0.5;
    const rw = c.kind.river;
    const rl = Math.max(r.L[r.floor + 1] + 1, r.riverX - rw);
    const rr = Math.min(r.R[r.floor + 1] - 1, r.riverX + rw);
    pts.push([r.L[r.floor + 1] + 0.5, fy, floorC]);
    pts.push([Math.min(rl, rr), fy - 0.4, riverC]);
    pts.push([Math.max(rl, rr), fy - 0.4, riverC]);
    pts.push([r.R[r.floor + 1] - 0.5, fy, floorC]);
    for (let i = ys.length - 1; i >= 0; i--) pts.push([r.R[ys[i]] + SINK, ys[i], this._color(band(ys[i]))]);
    pts.push([rRim, top, topC]);
    pts.push([Math.max(rRim, r.xc + (r.W * r.sec + OUTER)), top, topC]);
    return pts;
  }
}
