// Bullet holes: small dark marks left on block faces by gunshots. A fixed
// pool (the oldest mark is reused); a mark disappears when its block
// changes. Painted in code like everything else.
import * as THREE from "three";

const MAX_DECALS = 96;
const SIZE = 0.16;

function makeHoleTexture() {
  const N = 32;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(N, N);
  let seed = 7;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  // Ragged crater: a dark core, a chipped rim, a few short cracks.
  const cracks = [];
  for (let i = 0; i < 5; i++) cracks.push({ a: rand() * Math.PI * 2, len: 0.55 + rand() * 0.45 });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const a = Math.atan2(dy, dx);
      const rim = 0.42 + Math.sin(a * 7 + 1.3) * 0.05 + (rand() - 0.5) * 0.06;
      let v = -1;
      let alpha = 0;
      if (r < rim * 0.55) {
        v = 10;
        alpha = 250;
      } else if (r < rim) {
        v = 38 + rand() * 20;
        alpha = 220;
      } else if (r < rim + 0.12) {
        v = 70;
        alpha = 90;
      }
      for (const c of cracks) {
        let da = Math.abs(a - c.a);
        da = Math.min(da, Math.PI * 2 - da);
        if (r > rim * 0.8 && r < c.len * 1.8 && da * r * N < 0.9) {
          v = 30;
          alpha = Math.max(alpha, 170);
        }
      }
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, v);
      img.data[i + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// A laser scorch: a soft black burn with a glowing-hot rim that fades
// (the glow is baked in; the mark itself stays).
function makeScorchTexture() {
  const N = 32;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(N, N);
  let seed = 11;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const a = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy) * 2 * (1 + Math.sin(a * 5 + 0.7) * 0.08 + (rand() - 0.5) * 0.08);
      const i = (y * N + x) * 4;
      const burn = Math.max(0, 1 - r) ** 0.8;
      const v = r < 0.25 ? 8 : 18 + r * 30;
      img.data[i] = v;
      img.data[i + 1] = v * 0.85;
      img.data[i + 2] = v * 0.8;
      img.data[i + 3] = Math.round(235 * burn);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BulletHoles {
  // kind: "hole" (bullets) or "scorch" (lasers, larger and softer).
  constructor(scene, world, { kind = "hole" } = {}) {
    this.world = world;
    this.kind = kind;
    const material = new THREE.MeshBasicMaterial({
      map: kind === "scorch" ? makeScorchTexture() : makeHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    const geometry = new THREE.PlaneGeometry(kind === "scorch" ? SIZE * 2.6 : SIZE, kind === "scorch" ? SIZE * 2.6 : SIZE);
    // One instanced mesh for the whole pool (one draw call, not 96). Its
    // marks are spread over the world, so it is never frustum-culled as a
    // whole; a hidden mark is a zero-scale matrix.
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DECALS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._obj = new THREE.Object3D();
    this.decals = [];
    for (let i = 0; i < MAX_DECALS; i++) {
      this.mesh.setMatrixAt(i, this._zero);
      this.decals.push({ visible: false, cell: null });
    }
    scene.add(this.mesh);
    this.next = 0;
    world.changeListeners.push((changed) => this._onChanged(changed));
  }

  get count() {
    return this.decals.filter((d) => d.visible).length;
  }

  // Leaves a mark at `point` on the face of block `cell` ([x, y, z]) whose
  // outward normal is `normal` ([nx, ny, nz]).
  add(point, cell, normal) {
    const i = this.next;
    const d = this.decals[i];
    this.next = (this.next + 1) % MAX_DECALS;
    const o = this._obj;
    o.position.set(normal[0], normal[1], normal[2]).multiplyScalar(0.004).add(point);
    o.lookAt(o.position.x + normal[0], o.position.y + normal[1], o.position.z + normal[2]);
    o.rotateZ(Math.random() * Math.PI * 2);
    o.scale.setScalar(0.8 + Math.random() * 0.4);
    o.updateMatrix();
    this.mesh.setMatrixAt(i, o.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
    d.visible = true;
    d.cell = cell.slice();
    d.id = this.world.getBlock(cell[0], cell[1], cell[2]);
  }

  // After any edit, marks whose block is gone (or replaced) disappear. This
  // checks the (few) marks rather than the (possibly huge) list of changes.
  _onChanged() {
    let changed = false;
    let any = false;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d.visible) continue;
      if (this.world.getBlock(d.cell[0], d.cell[1], d.cell[2]) !== d.id) {
        d.visible = false;
        d.cell = null;
        this.mesh.setMatrixAt(i, this._zero);
        changed = true;
      } else any = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = any;
  }
}
