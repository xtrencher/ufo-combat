// The streak a dashing UFO leaves: no light at all, just fading, translucent
// copies of the hull along the path it covered in a split second (like a
// long exposure). Used by enemy UFOs and the player's own UFO. The copies
// are pooled: a dash costs a few draw calls for a quarter of a second.
import * as THREE from "three";

const POOL = 48;

export class DashTrail {
  constructor(scene) {
    this.scene = scene;
    this.ghosts = [];
    this.free = [];
  }

  // A copy of `mesh` (its geometry, world transform) that fades out.
  // color: the hull's rough shade (a THREE.Color, not HDR), opacity 0-1.
  spawn(mesh, color, opacity = 0.35, life = 0.28) {
    if (this.ghosts.length >= POOL) this._release(0);
    let g = this.free.pop();
    if (!g) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: true });
      g = { mesh: new THREE.Mesh(mesh.geometry, mat) };
      g.mesh.matrixAutoUpdate = false;
      g.mesh.frustumCulled = false;
    }
    g.mesh.geometry = mesh.geometry;
    mesh.updateWorldMatrix(true, false);
    g.mesh.matrix.copy(mesh.matrixWorld);
    g.mesh.matrixWorldNeedsUpdate = true;
    g.mesh.material.color.copy(color);
    g.age = 0;
    g.life = life;
    g.opacity = opacity;
    g.mesh.material.opacity = opacity;
    this.scene.add(g.mesh);
    this.ghosts.push(g);
  }

  // Copies along a straight path from a to b (in `n` steps) of a mesh whose
  // current world transform is at b.
  spawnPath(mesh, a, b, n, color, opacity = 0.35) {
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld.clone();
    for (let i = 0; i < n; i++) {
      const t = i / n;
      this.spawn(mesh, color, opacity * (0.4 + 0.6 * t), 0.18 + 0.12 * t);
      const g = this.ghosts[this.ghosts.length - 1];
      g.mesh.matrix.copy(m);
      g.mesh.matrix.elements[12] += (a.x - b.x) * (1 - t);
      g.mesh.matrix.elements[13] += (a.y - b.y) * (1 - t);
      g.mesh.matrix.elements[14] += (a.z - b.z) * (1 - t);
    }
  }

  _release(i) {
    const g = this.ghosts[i];
    this.scene.remove(g.mesh);
    this.ghosts.splice(i, 1);
    this.free.push(g);
  }

  update(dt) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      if (g.age >= g.life) {
        this._release(i);
        continue;
      }
      const k = 1 - g.age / g.life;
      g.mesh.material.opacity = g.opacity * k * k;
    }
  }

  clear() {
    while (this.ghosts.length) this._release(this.ghosts.length - 1);
  }
}
