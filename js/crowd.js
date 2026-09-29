// Crowds: far-away mobs of one species drawn as instanced meshes (two
// frozen walk poses that alternate as they walk), so a zombie apocalypse of
// hundreds costs a couple of draw calls instead of ~6 per zombie. Near
// mobs keep their full animated models (see mobs.js for the hand-over).
import * as THREE from "three";
import { createPoseGeometry } from "./mob-models.js";
import { createEntityMaterial, bindEntityLight } from "./shaders.js";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export class Crowd {
  constructor(scene, kind, capacity = 512) {
    this.capacity = capacity;
    this.meshes = [];
    const light = { sky: 15, block: 0, glow: 1 };
    for (const phase of [Math.PI / 2, -Math.PI / 2]) {
      const { geometry, texture } = createPoseGeometry(kind, { walkPhase: phase, walk: 1 });
      const material = createEntityMaterial("map", texture);
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      bindEntityLight(mesh, () => light);
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this._n = [0, 0];
  }

  begin() {
    this._n[0] = 0;
    this._n[1] = 0;
  }

  // One mob: position (feet), yaw, walk phase (radians), brightness (0-1:
  // its light level) and a red hurt flash (0-1).
  add(pos, yaw, walkPhase, brightness, flash = 0) {
    const k = Math.sin(walkPhase) >= 0 ? 0 : 1;
    const i = this._n[k];
    if (i >= this.capacity) return false;
    this._n[k]++;
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.copy(pos), _q, _s);
    const mesh = this.meshes[k];
    mesh.setMatrixAt(i, _m);
    const b = Math.max(0.08, brightness);
    mesh.setColorAt(i, _c.setRGB(b + flash, b * (1 - flash * 0.8), b * (1 - flash * 0.8)));
    return true;
  }

  end() {
    for (let k = 0; k < 2; k++) {
      const mesh = this.meshes[k];
      mesh.count = this._n[k];
      if (mesh.count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  get count() {
    return this._n[0] + this._n[1];
  }
}
