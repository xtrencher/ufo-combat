// The solar system's picture (Round 16): js/solar.js flies the ship, this
// draws it. Two scenes, each with its own camera, drawn one after the other
// into the same frame:
//   far    everything out there: the stars, the Sun and its glare, the
//          planets and moons (textured globes with their atmospheres' glow,
//          Saturn's rings), and far planets as bright dots. The camera sits
//          at the origin (a floating origin: every position is worked out in
//          doubles relative to the eye, then handed to the GPU), and a body
//          further than D0 is drawn nearer and smaller in proportion (the
//          same size in the view: log-squeezed distance), so the depth
//          buffer holds the whole solar system; the near plane follows the
//          nearest ground.
//   near   the ship (the very vehicle the player flies: its model is moved
//          here from the world's scene), the stage that falls away, the warp
//          drive's star streaks and tunnel, the glow of an entry. Drawn with
//          a fresh depth buffer over the far scene (postfx.js's overlay
//          pass), with a camera of its own: near 0.1, far 200 km.
// On High and up the frame goes through postfx.js (the bloom picks up the
// Sun, the light shafts round a planet's edge); its water pass is turned
// off while space is drawn (it keeps only the world's layer: Round 15's
// black screen).
import * as THREE from "three";
import { worldUniforms } from "./shaders.js";
import { BODIES, BODY_IDS } from "./solar-data.js";
import { createPlanet, createSunGlobe, planetTexture, pumpPlanetTextures, SPACE_TEXTURES } from "./space-sky.js";

const D0 = 1e6; // beyond this a body is drawn nearer, in proportion
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// A soft round glow (the Sun's glare, the dots, the entry's plasma).
let GLOW = null;
function glowTexture() {
  if (GLOW) return GLOW;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.06, "rgba(255,250,235,0.95)");
  gr.addColorStop(0.2, "rgba(255,225,180,0.35)");
  gr.addColorStop(0.5, "rgba(255,200,140,0.08)");
  gr.addColorStop(1, "rgba(255,190,120,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}

// A thin horizontal streak (the Sun's anamorphic flare).
function streakTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, "rgba(255,240,220,0)");
  gr.addColorStop(0.5, "rgba(255,245,230,0.9)");
  gr.addColorStop(1, "rgba(255,240,220,0)");
  g.fillStyle = gr;
  g.fillRect(0, 6, 256, 4);
  return new THREE.CanvasTexture(c);
}

// The stars: points on the far plane, steady, a few colours, a faint band of
// the galaxy across the sky.
function makeStars(n) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const band = new THREE.Vector3(0.3, 0.9, 0.2).normalize(); // (the galaxy's pole)
  for (let i = 0; i < n; i++) {
    _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    if (_v.lengthSq() < 0.01 || _v.lengthSq() > 1) {
      i--;
      continue;
    }
    _v.normalize();
    // (more of them along the band)
    if (Math.random() < 0.45) {
      _v.addScaledVector(band, -_v.dot(band) * rand(0.7, 1)).normalize();
    }
    pos.set([_v.x * 1000, _v.y * 1000, _v.z * 1000], i * 3);
    const k = Math.pow(Math.random(), 3) * 2.6 + 0.45;
    const warm = Math.random();
    col.set([k * (0.85 + warm * 0.25), k * (0.9 + warm * 0.05), k * (1.15 - warm * 0.3)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 1.6 }, uFade: { value: 1 } },
    vertexShader: `
      attribute vec3 color;
      varying vec3 vC;
      uniform float uSize;
      void main() {
        vC = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w * 0.999999;
        gl_PointSize = uSize * (0.8 + min(1.6, length(color)));
      }`,
    fragmentShader: `
      varying vec3 vC;
      uniform float uFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(vC * uFade, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = -10;
  return p;
}

// The warp drive's look: streaks of starlight flowing past, a tunnel of light.
function makeWarpFx() {
  const N = 700;
  const seg = new Float32Array(N * 6);
  const col = new Float32Array(N * 6);
  const data = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.pow(Math.random(), 0.6) * 900;
    data.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: rand(-2500, 2500), k: rand(0.4, 1) });
    const c = Math.random();
    for (let j = 0; j < 2; j++) col.set([0.7 + 0.3 * c, 0.8 + 0.2 * c, 1.2], i * 6 + j * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(seg, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const lm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(g, lm);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  // the tunnel: a long open tube round the path, bands of light rushing along it
  const tg = new THREE.CylinderGeometry(160, 160, 9000, 40, 1, true).rotateX(Math.PI / 2);
  const tm = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uTint: { value: new THREE.Color(0.35, 0.6, 1.4) } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main() { vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uK; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vP;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float along = vP.z / 9000.0 + 0.5;
        float ang = vUv.x;
        float rings = sin((along * 90.0 + uTime * 9.0) + sin(ang * 6.2832 * 3.0) * 0.6) * 0.5 + 0.5;
        float streak = h(vec2(floor(ang * 120.0), floor(along * 24.0 + uTime * 4.0)));
        float a = (pow(rings, 6.0) * 0.6 + pow(streak, 18.0) * 1.6) * uK;
        a *= smoothstep(0.0, 0.25, along) * smoothstep(1.0, 0.6, along);
        gl_FragColor = vec4(uTint * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const tube = new THREE.Mesh(tg, tm);
  tube.frustumCulled = false;
  tube.renderOrder = 19;
  const group = new THREE.Group();
  group.add(lines, tube);
  return { group, lines, tube, data, N };
}

export class SolarView {
  constructor() {
    this.far = new THREE.Scene();
    this.far.background = new THREE.Color(0, 0, 0);
    this.near = new THREE.Scene();
    this.farCam = new THREE.PerspectiveCamera(70, 16 / 9, 1, 3e7);
    this.nearCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 2e5);
    this.time = 0;
    // (the sun's direction for each body's shading: one vector each, updated in place)
    this.bodies = {};
    this.stars = makeStars(5200);
    this.far.add(this.stars);
    // The near scene's light (plain lit materials: the falling stage) and
    // the craft's own place (its model is moved in here: js/solar.js).
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    this.near.add(this.sunLight, this.sunLight.target, new THREE.AmbientLight(0x8090a8, 0.35));
    this.craft = new THREE.Group();
    this.near.add(this.craft);
    this.warp = makeWarpFx();
    this.warp.group.visible = false;
    this.near.add(this.warp.group);
    const gt = glowTexture();
    this.entry = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(3.2, 1.3, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
    this.entry.renderOrder = 21;
    this.near.add(this.entry);
    // The Sun's glare: a wide soft glow, a core, a flat streak.
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(3.0, 2.7, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.glare.renderOrder = 30;
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTexture(), color: new THREE.Color(1.6, 1.5, 1.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.flare.renderOrder = 31;
    this.far.add(this.glare, this.flare);
    // Far bodies as dots (one point each, on the far plane).
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BODY_IDS.length * 3), 3));
    dg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(BODY_IDS.length * 3), 3));
    dg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(BODY_IDS.length), 1));
    this.dots = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; gl_PointSize = size; }`,
        fragmentShader: `varying vec3 vC; void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d)); gl_FragColor = vec4(vC, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 5;
    this.far.add(this.dots);
    this.debris = []; // { obj, pos (double, abs), vel, spin, t }
    this.readyTextures = false;
  }

  // The planets' looks, a little each frame (all of them now: `now`).
  prepare(now = false) {
    for (const n of SPACE_TEXTURES) planetTexture(n);
    const left = pumpPlanetTextures(now ? Infinity : 3);
    if (!left) this.readyTextures = true;
    return left;
  }

  _body(id) {
    let b = this.bodies[id];
    if (b) return b;
    const B = BODIES[id];
    const sun = new THREE.Vector3(1, 0, 0);
    let p;
    if (B.star) {
      const g = new THREE.Group();
      const hi = createSunGlobe(B.r, 64);
      g.add(hi);
      p = { group: g, globe: hi, mats: [hi.material], spin() {}, setCenter() {}, setDetail() {} };
    } else p = createPlanet(id, B.r, sun, { segments: id === "jupiter" || id === "saturn" ? 96 : 128, detail: 0 });
    // (a coarse copy of each sphere for when the body is small in the view)
    const lods = [];
    for (const m of [p.globe, p.clouds, p.halo]) {
      if (!m) continue;
      const hi = m.geometry;
      const pr = hi.parameters;
      const lo = new THREE.SphereGeometry(pr.radius, 24, 12);
      lods.push({ m, hi, lo });
    }
    b = this.bodies[id] = { p, sun, lods, B };
    this.far.add(p.group);
    return b;
  }

  // Places everything for this frame. s: { camAbs (doubles), camQuat
  // (THREE.Quaternion), fov, aspect, abs(id) -> [x, y, z] (doubles: every
  // body's position now), craftOffset (THREE.Vector3: the camera from the
  // ship, in the scene's axes), time, warpK (0-1), warpDir (Vector3), speed,
  // entryK, height (pixels) }.
  update(s, dt) {
    this.time += dt;
    const camAbs = s.camAbs;
    const fc = this.farCam;
    const nc = this.nearCam;
    for (const c of [fc, nc]) {
      c.fov = s.fov;
      c.aspect = s.aspect;
      c.quaternion.copy(s.camQuat);
    }
    fc.position.set(0, 0, 0);
    nc.position.copy(s.craftOffset);
    const tanH = Math.tan(THREE.MathUtils.degToRad(s.fov) / 2);
    const H = s.height || 540;
    let nearest = Infinity;
    const sunAbs = s.abs("sun");
    const dpos = this.dots.geometry.getAttribute("position");
    const dcol = this.dots.geometry.getAttribute("color");
    const dsize = this.dots.geometry.getAttribute("size");
    this.apparent = {};
    BODY_IDS.forEach((id, i) => {
      const B = BODIES[id];
      const a = s.abs(id);
      const rx = a[0] - camAbs[0];
      const ry = a[1] - camAbs[1];
      const rz = a[2] - camAbs[2];
      const d = Math.hypot(rx, ry, rz);
      const k = d < D0 ? 1 : (D0 * (1 + Math.log(d / D0))) / d;
      const px = (B.r / Math.max(d, B.r * 1.0001) / tanH) * (H / 2); // (its radius on screen, pixels)
      this.apparent[id] = px;
      const b = this._body(id);
      const g = b.p.group;
      g.position.set(rx * k, ry * k, rz * k);
      g.scale.setScalar(k);
      g.visible = px > 0.35;
      nearest = Math.min(nearest, (d - B.r * (B.atmo ? 1.03 : 1.001) * (B.rings ? B.rings[1] / 1.0 : 1)) * k);
      // (the sun's direction from this body)
      b.sun.set(sunAbs[0] - a[0], sunAbs[1] - a[1], sunAbs[2] - a[2]);
      if (b.sun.lengthSq() < 1) b.sun.set(1, 0, 0);
      b.sun.normalize();
      for (const m of b.p.mats) if (m.uniforms?.uSun) m.uniforms.uSun.value = b.sun;
      if (b.p.globe.material.uniforms?.uTime) b.p.globe.material.uniforms.uTime.value = this.time;
      b.p.setCenter?.(g.position, k);
      // (fine detail close up only)
      b.p.setDetail?.(smooth(B.r * 1.6, B.r * 1.08, d) * 0.8);
      b.p.spin?.(dt);
      const lod = px > 80 ? "hi" : "lo";
      for (const L of b.lods) if (L.m.geometry !== L[lod]) L.m.geometry = L[lod];
      // the dot: a far planet still seen, as a bright star
      _v.set(rx, ry, rz).normalize().multiplyScalar(1000);
      dpos.setXYZ(i, _v.x, _v.y, _v.z);
      const c = new THREE.Color(B.color);
      const lit = B.star ? 3 : 0.5 + 0.5 * Math.max(0, -_v2.set(rx, ry, rz).normalize().dot(b.sun));
      const show = px < 3 ? 1 : smooth(6, 3, px);
      const bright = (B.star ? 1 : Math.min(1, 0.35 + 12 * Math.sqrt(B.r / Math.max(d, 1)))) * lit * show;
      dcol.setXYZ(i, c.r * bright, c.g * bright, c.b * bright);
      dsize.setX(i, B.star ? 9 : 3.4);
      if (B.star) {
        // the glare: the size it would be on the far plane, and the streak
        const gd = Math.min(d * k, 1.5e7);
        _v.set(rx, ry, rz).normalize().multiplyScalar(gd);
        this.glare.position.copy(_v);
        this.flare.position.copy(_v);
        const ang = Math.max(B.r / d, 0.002);
        this.glare.scale.setScalar(gd * (ang * 14 + 0.18));
        this.flare.scale.set(gd * (ang * 30 + 0.9), gd * (ang * 2 + 0.03), 1);
        this.sunDir = _v2.set(rx, ry, rz).normalize().clone();
        this.sunView = _v.clone();
      }
    });
    dpos.needsUpdate = dcol.needsUpdate = dsize.needsUpdate = true;
    fc.near = THREE.MathUtils.clamp(nearest * 0.4, 0.5, 2e5);
    fc.far = 3e7;
    fc.updateProjectionMatrix();
    nc.updateProjectionMatrix();
    fc.updateMatrixWorld();
    nc.updateMatrixWorld();
    this.stars.material.uniforms.uSize.value = Math.max(2, H / 300);
    // the near scene's sun
    if (this.sunDir) {
      this.sunLight.position.copy(this.sunDir).multiplyScalar(100);
      this.sunLight.target.position.set(0, 0, 0);
    }
    this._warpFx(s, dt);
    this._entryFx(s);
    this._debris(s, dt);
  }

  _warpFx(s, dt) {
    const W = this.warp;
    const k = s.warpK || 0;
    W.group.visible = k > 0.01;
    if (!W.group.visible) return;
    // (along the way the ship goes, round the camera)
    _q.setFromUnitVectors(_v.set(0, 0, -1), s.warpDir);
    W.group.quaternion.copy(_q);
    W.group.position.copy(this.nearCam.position);
    const flow = (900 + 9000 * k) * dt;
    const len = 20 + 900 * k * k;
    const pos = W.lines.geometry.getAttribute("position");
    for (let i = 0; i < W.N; i++) {
      const d = W.data[i];
      d.z += flow * d.k;
      if (d.z > 2500) d.z -= 5000;
      pos.setXYZ(i * 2, d.x, d.y, d.z);
      pos.setXYZ(i * 2 + 1, d.x, d.y, d.z - len * d.k);
    }
    pos.needsUpdate = true;
    W.lines.material.opacity = Math.min(1, k * 1.4);
    W.tube.material.uniforms.uK.value = smooth(0.35, 1, k) * 0.9;
    W.tube.material.uniforms.uTime.value = this.time;
  }

  _entryFx(s) {
    const k = s.entryK || 0;
    this.entry.material.opacity = k;
    this.entry.visible = k > 0.01;
    if (!this.entry.visible) return;
    // (on the ship's leading side, flickering)
    this.entry.position.copy(s.entryDir).multiplyScalar(s.entrySize * 0.8);
    this.entry.scale.setScalar(s.entrySize * (2.6 + Math.random() * 0.4));
  }

  // A thing tumbling away (the spent stage): obj in the near scene, its
  // position relative to the ship kept as it drifts.
  addDebris(obj, rel, vel, spin) {
    this.near.add(obj);
    this.debris.push({ obj, rel: rel.clone(), vel: vel.clone(), spin: spin.clone(), t: 0 });
  }

  // (the ship's own motion: shipVel, the scene's axes, so the debris falls behind)
  _debris(s, dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.rel.addScaledVector(d.vel, dt);
      if (s.shipAccel) d.rel.addScaledVector(s.shipAccel, -0.5 * dt * dt);
      if (s.shipAccel) d.vel.addScaledVector(s.shipAccel, -dt);
      d.obj.position.copy(d.rel);
      _q.setFromAxisAngle(_v.copy(d.spin).normalize(), d.spin.length() * dt);
      d.obj.quaternion.premultiply(_q);
      if (d.t > 25 || d.rel.length() > 5e4) {
        this.near.remove(d.obj);
        d.dispose?.();
        this.debris.splice(i, 1);
      }
    }
  }

  clearDebris() {
    for (const d of this.debris) this.near.remove(d.obj);
    this.debris.length = 0;
  }

  // Draws the frame (main.js renderFrame, through js/space.js).
  render(renderer, postfx = null) {
    // (the world's lighting uniforms, for the ship's own materials: the Sun's
    // light, no fog, no sky; put back as they were after)
    const u = worldUniforms;
    const keep = {
      sun: u.uSunDir.value.clone(),
      light: u.uLightDir.value.clone(),
      lc: u.uLightColor.value.clone(),
      as: u.uAmbientSky.value.clone(),
      ag: u.uAmbientGround.value.clone(),
      fog: u.uFog.value.clone(),
      night: u.uNight.value,
      eye: u.uEyeSky.value,
      uw: u.uUnderwater.value,
    };
    if (this.sunDir) {
      u.uSunDir.value.copy(this.sunDir);
      u.uLightDir.value.copy(this.sunDir);
    }
    u.uLightColor.value.setRGB(1.6, 1.55, 1.48);
    u.uAmbientSky.value.setRGB(0.05, 0.055, 0.07);
    u.uAmbientGround.value.setRGB(0.04, 0.045, 0.06);
    u.uFog.value.set(1e7, 2e7, 0, u.uFog.value.w);
    u.uNight.value = 0;
    u.uEyeSky.value = 1;
    u.uUnderwater.value = 0;
    try {
      if (postfx) {
        // (High and up draw the world's water in a pass that keeps only the
        // world's layer: off here, or the scene would be black)
        const water = postfx.screenWater;
        postfx.screenWater = false;
        try {
          const sv = this.sunView;
          const inView = sv && _v.copy(sv).applyMatrix4(this.farCam.matrixWorldInverse).z < 0;
          postfx.render(this.far, this.farCam, { exposure: 1, raysStrength: inView ? 0.28 : 0, raysSpread: 5, sunWorldPos: sv || null, sunColor: _sunCol, bloomStrength: 0.3, night: 0, time: this.time }, { scene: this.near, camera: this.nearCam });
        } finally {
          postfx.screenWater = water;
        }
      } else {
        const auto = renderer.autoClear;
        renderer.toneMappingExposure = 1;
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.render(this.far, this.farCam);
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(this.near, this.nearCam);
        renderer.autoClear = auto;
      }
    } finally {
      u.uSunDir.value.copy(keep.sun);
      u.uLightDir.value.copy(keep.light);
      u.uLightColor.value.copy(keep.lc);
      u.uAmbientSky.value.copy(keep.as);
      u.uAmbientGround.value.copy(keep.ag);
      u.uFog.value.copy(keep.fog);
      u.uNight.value = keep.night;
      u.uEyeSky.value = keep.eye;
      u.uUnderwater.value = keep.uw;
    }
    return true;
  }

  // The screen position (pixels) of an absolute point, or null behind the eye:
  // { x, y, behind } (for the guides). dir: a direction from the eye.
  project(dir, w, h, out = {}) {
    _v.copy(dir).applyMatrix4(this.farCam.matrixWorldInverse);
    const behind = _v.z > 0;
    _v.applyMatrix4(this.farCam.projectionMatrix);
    out.x = (_v.x * 0.5 + 0.5) * w;
    out.y = (-_v.y * 0.5 + 0.5) * h;
    out.behind = behind;
    out.vx = _v.x;
    out.vy = _v.y;
    return out;
  }
}

const _sunCol = new THREE.Color(1.0, 0.92, 0.8);
