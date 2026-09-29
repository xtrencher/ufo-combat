// The tractor beam: a cone of blue light from a UFO's underside to the
// ground, with bright edges, rings of light climbing up it, sparkles rising
// inside and a pool of light where it meets the ground. Used by enemy UFOs
// (abducting animals, or the player) and by the player's own UFO.
import * as THREE from "three";
import { LAYER_FX } from "./layers.js";

const beamVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const beamFragment = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uLength;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
#include <fog_pars_fragment>
void main() {
  // v = 1 at the UFO, 0 at the ground.
  float v = vUv.y;
  float edge = 1.0 - abs(dot(normalize(vNormalV), normalize(vViewV)));
  edge = pow(edge, 1.6);
  // Rings of light climbing the beam.
  float rings = 0.5 + 0.5 * sin((1.0 - v) * uLength * 1.3 - uTime * 7.0);
  rings = pow(rings, 6.0);
  // Soft vertical streaks turning around the cone.
  float streaks = 0.6 + 0.4 * sin(vUv.x * 50.0 + uTime * 1.5 + sin(vUv.x * 13.0 - uTime) * 2.0);
  float a = (0.07 + 0.45 * edge * streaks + 0.35 * rings) * uStrength;
  a *= smoothstep(0.0, 0.08, v) * (0.55 + 0.45 * v); // fades at the ground, brightest at the ship
  vec3 color = uColor * (1.0 + rings * 1.5 + edge * 0.8);
  gl_FragColor = vec4(color, a);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.a *= 1.0 - fogFactor;
  #endif
  #include <colorspace_fragment>
}
`;

function poolTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.55, "rgba(255,255,255,0.35)");
  g.addColorStop(0.85, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let sharedPool = null;
let sharedGeo = null;

export class TractorBeam {
  constructor(scene, color = new THREE.Color(0.35, 0.75, 1.6)) {
    this.scene = scene;
    // A unit cone: radius 1 at the bottom (y = 0), 0.25 at the top (y = 1).
    if (!sharedGeo) sharedGeo = new THREE.CylinderGeometry(0.25, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uStrength: { value: 1 },
        uLength: { value: 10 },
        uColor: { value: color.clone() },
      },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(sharedGeo, this.material);
    this.mesh.layers.set(LAYER_FX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
    if (!sharedPool) sharedPool = poolTexture();
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: sharedPool, color: color.clone().multiplyScalar(0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -4 })
    );
    this.pool.layers.set(LAYER_FX);
    this.pool.visible = false;
    this.pool.renderOrder = 13;
    scene.add(this.mesh, this.pool);
    this.strength = 0; // eased 0-1
    this.on = false;
    this.top = new THREE.Vector3();
    this.bottomY = 0;
    this.radius = 4;
    this._sparkT = 0;
  }

  // Aims the beam: from `top` (the ship's underside) straight down to the
  // ground at `groundY`, `radius` blocks wide at the bottom.
  set(on, top, groundY, radius) {
    this.on = on;
    if (top) this.top.copy(top);
    if (groundY !== undefined) this.bottomY = groundY;
    if (radius !== undefined) this.radius = radius;
  }

  // Is a point inside the beam's cone?
  contains(p, margin = 0) {
    if (this.strength < 0.3) return false;
    const len = this.top.y - this.bottomY;
    if (p.y > this.top.y || p.y < this.bottomY - 1) return false;
    const t = len > 0 ? (p.y - this.bottomY) / len : 0; // 0 at the ground
    const r = this.radius * (1 - 0.75 * t) + margin;
    return Math.hypot(p.x - this.top.x, p.z - this.top.z) < r;
  }

  update(dt, effects) {
    this.strength += ((this.on ? 1 : 0) - this.strength) * Math.min(1, dt * 5);
    const visible = this.strength > 0.02;
    this.mesh.visible = visible;
    this.pool.visible = visible;
    if (!visible) return;
    const len = Math.max(0.5, this.top.y - this.bottomY);
    this.mesh.position.set(this.top.x, this.bottomY, this.top.z);
    this.mesh.scale.set(this.radius, len, this.radius);
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uStrength.value = this.strength;
    this.material.uniforms.uLength.value = len;
    this.pool.position.set(this.top.x, this.bottomY + 0.06, this.top.z);
    this.pool.scale.setScalar(this.radius * 1.15);
    this.pool.material.opacity = this.strength;
    // Sparkles drifting up the beam.
    if (effects && this.on) {
      this._sparkT += dt * Math.min(60, 6 + this.radius * 4);
      const c = this.material.uniforms.uColor.value;
      while (this._sparkT > 1) {
        this._sparkT -= 1;
        const a = Math.random() * Math.PI * 2;
        const h = Math.random() * len * 0.6;
        const r = this.radius * (1 - 0.75 * (h / len)) * Math.sqrt(Math.random()) * 0.9;
        effects.glow.spawn({
          x: this.top.x + Math.cos(a) * r, y: this.bottomY + h, z: this.top.z + Math.sin(a) * r,
          vy: 3 + Math.random() * 4, life: 0.8 + Math.random() * 0.8, size0: 0.18, size1: 0.05, color0: c, alpha: 0.9,
        });
      }
    }
  }

  dispose() {
    this.scene.remove(this.mesh, this.pool);
    this.material.dispose();
    this.pool.material.dispose();
    this.pool.geometry.dispose();
  }
}
