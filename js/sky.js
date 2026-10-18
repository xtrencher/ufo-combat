// Day/night cycle: moves the sun and moon, derives sky, ambient and light
// colors from the sun's elevation (keyframed for noon, golden hour, sunset,
// twilight and night), drives the sky dome, and places the shadow-casting
// directional light (sun by day, moon by night) around the player.
//
// (Round 12) The Nether and the End have skies of their own (setDimension,
// js/dim-registry.js): no sun, no moon, no clouds, no day; the Nether a red
// murk with thick fog, the End a dark sky with still stars. The clock still
// runs (it is the Overworld's, and everyone's online).
import * as THREE from "three";
import { worldUniforms, createSkyMaterial } from "./shaders.js";
import { isVanilla } from "./worldtype.js";

export const DAY_LENGTH = 600; // seconds for a full day/night cycle (a Missions world)
export const SURVIVAL_DAY_LENGTH = 1200; // a Survival world's: vanilla's 20 minutes

// This world's day (the world type is set at startup, before anything reads it).
export function dayLength() {
  return isVanilla() ? SURVIVAL_DAY_LENGTH : DAY_LENGTH;
}
const DAY_SHARE = 0.62; // fraction of the cycle with the sun above the horizon
const SUN_TILT = 0.42; // radians the sun's path is tilted off the zenith
const START_ANGLE = ((17 + 50 / 60 - 6) / 12) * Math.PI; // a new world starts at 17:50, in the golden hour before sunset

// Keyframes indexed by sun elevation e = sunDir.y (-1..1). Colors are HDR linear.
const KEYS = [
  {
    e: -1.0,
    zenith: [0.0022, 0.0035, 0.011],
    horizon: [0.007, 0.012, 0.028],
    glow: [0, 0, 0],
    sunGlow: [0, 0, 0],
    ambSky: [0.0174, 0.0232, 0.0452],
    ambGround: [0.0058, 0.0064, 0.0093],
    cloudLit: [0.035, 0.045, 0.07],
    cloudShade: [0.012, 0.016, 0.028],
  },
  {
    e: -0.3,
    zenith: [0.0022, 0.0035, 0.011],
    horizon: [0.007, 0.012, 0.028],
    glow: [0, 0, 0],
    sunGlow: [0, 0, 0],
    ambSky: [0.0174, 0.0232, 0.0452],
    ambGround: [0.0058, 0.0064, 0.0093],
    cloudLit: [0.035, 0.045, 0.07],
    cloudShade: [0.012, 0.016, 0.028],
  },
  {
    e: -0.12,
    zenith: [0.012, 0.02, 0.055],
    horizon: [0.05, 0.045, 0.075],
    glow: [0.3, 0.1, 0.05],
    sunGlow: [0.3, 0.1, 0.04],
    ambSky: [0.029, 0.0319, 0.058],
    ambGround: [0.0087, 0.0081, 0.0104],
    cloudLit: [0.12, 0.08, 0.1],
    cloudShade: [0.03, 0.03, 0.05],
  },
  {
    e: -0.03,
    zenith: [0.03, 0.045, 0.14],
    horizon: [0.42, 0.18, 0.11],
    glow: [1.35, 0.34, 0.07],
    sunGlow: [1.3, 0.4, 0.1],
    ambSky: [0.07, 0.064, 0.093],
    ambGround: [0.023, 0.017, 0.017],
    cloudLit: [1.0, 0.4, 0.22],
    cloudShade: [0.14, 0.09, 0.14],
  },
  {
    e: 0.05,
    zenith: [0.08, 0.14, 0.38],
    horizon: [0.9, 0.46, 0.24],
    glow: [2.0, 0.66, 0.16],
    sunGlow: [1.7, 0.72, 0.3],
    ambSky: [0.174, 0.174, 0.22],
    ambGround: [0.07, 0.052, 0.041],
    cloudLit: [1.7, 0.9, 0.52],
    cloudShade: [0.32, 0.24, 0.3],
  },
  {
    e: 0.16,
    zenith: [0.14, 0.3, 0.8],
    horizon: [0.88, 0.8, 0.72],
    glow: [0.5, 0.3, 0.14],
    sunGlow: [1.4, 1.0, 0.7],
    ambSky: [0.29, 0.3248, 0.4176],
    ambGround: [0.1276, 0.1102, 0.087],
    cloudLit: [1.7, 1.55, 1.35],
    cloudShade: [0.6, 0.62, 0.7],
  },
  {
    e: 0.4,
    zenith: [0.12, 0.33, 1.0],
    horizon: [0.72, 0.86, 1.05],
    glow: [0.08, 0.06, 0.04],
    sunGlow: [1.3, 1.15, 0.95],
    ambSky: [0.3596, 0.4176, 0.5336],
    ambGround: [0.1624, 0.145, 0.116],
    cloudLit: [1.9, 1.9, 1.85],
    cloudShade: [0.78, 0.82, 0.9],
  },
  {
    e: 1.0,
    zenith: [0.1, 0.3, 1.0],
    horizon: [0.68, 0.84, 1.06],
    glow: [0, 0, 0],
    sunGlow: [1.3, 1.2, 1.0],
    ambSky: [0.3828, 0.4408, 0.5568],
    ambGround: [0.174, 0.1566, 0.1276],
    cloudLit: [2.0, 2.0, 1.95],
    cloudShade: [0.82, 0.86, 0.94],
  },
];

// Direct sunlight color by elevation (before the fade at the horizon).
const SUN_KEYS = [
  { e: 0.0, c: [0.8, 0.3, 0.1] },
  { e: 0.08, c: [1.3, 0.72, 0.38] },
  { e: 0.25, c: [1.65, 1.38, 1.06] },
  { e: 1.0, c: [1.78, 1.64, 1.42] },
];
const MOON_LIGHT = [0.1, 0.13, 0.24];

function lerpKeys(keys, e, field, out) {
  let i = 0;
  while (i < keys.length - 2 && e > keys[i + 1].e) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
  const ca = a[field];
  const cb = b[field];
  return out.setRGB(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

// Depth range of the shadow cameras (blocks), centered on the player.
export const SHADOW_DEPTH = 360;

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Sky {
  // cascadeLights: extra shadow-only directional lights (intensity 0) for
  // the larger shadow cascades; sunLight is the finest cascade and the one
  // that lights three's built-in materials.
  constructor(scene, sunLight, hemiLight, cascadeLights = []) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.hemiLight = hemiLight;
    this.shadowLights = [sunLight, ...cascadeLights];
    this.time = this._timeForAngle(START_ANGLE);
    this.sunAngle = START_ANGLE;
    this.cascades = [{ extent: 64, mapSize: 2048 }];

    this.material = createSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1e6; // last opaque draw, pinned to the far plane (early-Z skips the covered pixels)
    scene.add(this.dome);

    this._tmp = new THREE.Color();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._center = new THREE.Vector3();
    this.horizonColor = new THREE.Color();
    this.exposure = 1;
    this.locked = false;
    // Wind: a slowly veering direction and a strength that rises and falls
    // over minutes (drives leaves, plants and water waves via uWind).
    this.windTime = 0;
    this.windOverride = null; // { angle, strength } to pin it (tests, screenshots)
    // (Round 11) A Survival world's weather (js/weather.js levels, 0-1: rain,
    // thunder, a lightning flash), or null: clear.
    this.weather = null;
    this._cloudCover = this.material.uniforms.uCloudCoverage.value;
    this._fogBase = new THREE.Vector4();
    this._fogSet = new THREE.Vector4(NaN, 0, 0, 0);
    this.dimSky = null; // (Round 12) another dimension's sky (dim-registry.js), or null: the Overworld's
    this.dimView = Infinity; // (and how far it is drawn, in chunks: the fog ends there)
  }

  // (Round 12) The sky of the dimension the world is in (info: its entry in
  // js/dim-registry.js DIMS).
  setDimension(info) {
    this.dimSky = info?.sky || null;
    this.dimView = info?.maxView ?? Infinity;
    // (the shadow maps are drawn again at once: they held the other world)
    for (const l of this.shadowLights) if (l.shadow) l.shadow.needsUpdate = true;
  }

  // Current wind: { angle (radians, direction it blows toward), strength }.
  get wind() {
    if (this.windOverride) return this.windOverride;
    const t = this.windTime;
    const angle = 0.7 + Math.sin(t * 0.011) * 0.9 + Math.sin(t * 0.027 + 1.3) * 0.35;
    const strength = 0.62 + Math.sin(t * 0.019 + 0.4) * 0.28 + Math.sin(t * 0.053) * 0.12;
    return { angle, strength };
  }

  // Cycle time (seconds) at which the sun is at `angle` (0 = sunrise, PI = sunset).
  _timeForAngle(angle) {
    const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const phase = a < Math.PI ? (a / Math.PI) * DAY_SHARE : DAY_SHARE + ((a - Math.PI) / Math.PI) * (1 - DAY_SHARE);
    return phase * dayLength();
  }

  setSunAngle(angle) {
    this.time = this._timeForAngle(angle);
  }

  // The sun's angle along its path for the current cycle time.
  _angleForTime(time) {
    const len = dayLength();
    const phase = (((time % len) + len) % len) / len;
    return phase < DAY_SHARE ? (phase / DAY_SHARE) * Math.PI : Math.PI + ((phase - DAY_SHARE) / (1 - DAY_SHARE)) * Math.PI;
  }

  // Clock time, 0-24 (sunrise at 6:00, sunset at 18:00).
  get hours() {
    const a = this._angleForTime(this.time);
    return (6 + (a / Math.PI) * 12) % 24;
  }

  setHours(h) {
    const t = ((((Number(h) || 0) - 6) % 24) + 24) % 24;
    this.setSunAngle((t / 12) * Math.PI);
  }

  // (Round 11) Sleeping through the night (sleep.js): straight to the next
  // morning, 6:00 (vanilla wakes everyone at the day's first tick).
  skipToMorning(hours = 6) {
    this.setHours(hours);
  }

  get isNight() {
    return worldUniforms.uSunDir.value.y < -0.05;
  }

  // 0 at full night, 1 at full day.
  get daylight() {
    return smoothstep(-0.15, 0.2, worldUniforms.uSunDir.value.y);
  }

  update(dt, center, forward) {
    this.windTime += dt;
    const wind = this.wind;
    const uw = worldUniforms.uWind.value;
    uw.set(Math.cos(wind.angle), Math.sin(wind.angle), wind.strength, uw.w + dt * 0.1 * wind.strength);
    // A locked clock (settings menu) keeps the sun where it is.
    if (!this.locked) this.time = (this.time + dt * (this.timeScale ?? 1)) % dayLength();
    const angle = this._angleForTime(this.time);
    this.sunAngle = angle;

    const u = worldUniforms;
    const sunDir = u.uSunDir.value.set(Math.cos(angle), Math.sin(angle) * Math.cos(SUN_TILT), Math.sin(angle) * Math.sin(SUN_TILT)).normalize();
    u.uMoonDir.value.copy(sunDir).negate();
    const e = sunDir.y;

    lerpKeys(KEYS, e, "zenith", u.uSkyZenith.value);
    lerpKeys(KEYS, e, "horizon", u.uSkyHorizon.value);
    lerpKeys(KEYS, e, "glow", u.uSkyGlow.value);
    lerpKeys(KEYS, e, "sunGlow", u.uSunGlowColor.value);
    lerpKeys(KEYS, e, "ambSky", u.uAmbientSky.value);
    lerpKeys(KEYS, e, "ambGround", u.uAmbientGround.value);
    lerpKeys(KEYS, e, "cloudLit", this.material.uniforms.uCloudLit.value);
    lerpKeys(KEYS, e, "cloudShade", this.material.uniforms.uCloudShade.value);
    u.uNight.value = 1 - smoothstep(-0.2, -0.02, e);
    this.material.uniforms.uStarAngle.value = angle;

    // The shadow-casting light is the sun while it's up, the moon otherwise.
    // Both are faded to zero around the switch so shadows never jump.
    const lightColor = u.uLightColor.value;
    if (e > -0.04) {
      u.uLightDir.value.copy(sunDir);
      lerpKeys(SUN_KEYS, Math.max(e, 0), "c", lightColor).multiplyScalar(smoothstep(-0.04, 0.06, e));
    } else {
      u.uLightDir.value.copy(u.uMoonDir.value);
      lightColor.setRGB(MOON_LIGHT[0], MOON_LIGHT[1], MOON_LIGHT[2]).multiplyScalar(smoothstep(-0.04, -0.2, e));
    }

    // Built-in three.js materials (debris, orb, particles) use real lights:
    // Lambert divides by PI, so scale by PI to match the terrain shader.
    this.sunLight.color.copy(lightColor);
    this.sunLight.intensity = Math.PI;
    this.hemiLight.color.copy(u.uAmbientSky.value);
    this.hemiLight.groundColor.copy(u.uAmbientGround.value);
    this.hemiLight.intensity = Math.PI;

    if (this.dimSky) this._applyDimension(this.dimSky);
    else this._applyWeather();

    // Horizon color in the view direction, for three's built-in fog.
    this.horizonColor.copy(u.uSkyHorizon.value);

    // Night is dark, but the eye adapts a bit (like in classic voxel games).
    this.exposure = this.dimSky ? this.dimSky.exposure ?? 1 : THREE.MathUtils.lerp(1.1, 0.8, smoothstep(-0.15, 0.25, e));

    for (let i = 0; i < this.cascades.length; i++) this._placeShadowLight(this.shadowLights[i], this.cascades[i], center, forward);
    this._scheduleShadows();
    this.dome.position.copy(center);
  }

  // (Round 11) Rain and thunder: vanilla's sky colour formula (each greys
  // and darkens the sky toward its own brightness, by up to three quarters),
  // the clouds closing in, the sun hidden, less direct light, thicker haze
  // and the fog wall nearer; a lightning flash whitens the sky and lights
  // everything for a moment. Nothing to do on a clear day.
  _applyWeather() {
    const w = this.weather;
    const u = worldUniforms;
    const rain = w ? w.rain : 0;
    const thunder = w ? w.thunder : 0;
    const flash = w ? w.flash : 0;
    // (the view distance's fog, kept as main.js last set it)
    const fog = u.uFog.value;
    if (!fog.equals(this._fogSet)) this._fogBase.copy(fog);
    const b = this._fogBase;
    fog.set(b.x * (1 - 0.4 * rain), b.y, b.z * (1 + 2.5 * rain + thunder), b.w);
    this._fogSet.copy(fog);
    this.material.uniforms.uCloudCoverage.value = this._cloudCover + (0.97 - this._cloudCover) * rain;
    if (rain <= 0 && flash <= 0) return;
    const grey = (c) => {
      const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      if (rain > 0) {
        const k = 1 - rain * 0.75;
        const g = lum * 0.6 * (1 - k);
        c.setRGB(c.r * k + g, c.g * k + g, c.b * k + g);
      }
      if (thunder > 0) {
        const k = 1 - thunder * 0.75;
        const g = lum * 0.2 * (1 - k);
        c.setRGB(c.r * k + g, c.g * k + g, c.b * k + g);
      }
      if (flash > 0) {
        const f = Math.min(1, flash) * 0.45;
        c.setRGB(c.r * (1 - f) + 0.8 * f, c.g * (1 - f) + 0.8 * f, c.b * (1 - f) + f);
      }
    };
    const m = this.material.uniforms;
    grey(u.uSkyZenith.value);
    grey(u.uSkyHorizon.value);
    grey(m.uCloudLit.value);
    grey(m.uCloudShade.value);
    const hidden = 1 - rain;
    u.uSkyGlow.value.multiplyScalar(hidden);
    u.uSunGlowColor.value.multiplyScalar(hidden);
    u.uLightColor.value.multiplyScalar(1 - 0.7 * rain - 0.15 * thunder);
    const amb = (1 + 0.1 * rain) * (1 - 0.3 * thunder);
    u.uAmbientSky.value.multiplyScalar(amb);
    u.uAmbientGround.value.multiplyScalar(amb);
    if (flash > 0) {
      const f = Math.min(1, flash) * 0.45;
      u.uAmbientSky.value.lerp(this._tmp.setRGB(0.55, 0.58, 0.7), f);
      u.uAmbientGround.value.lerp(this._tmp.setRGB(0.25, 0.25, 0.3), f);
    }
    this.sunLight.color.copy(u.uLightColor.value);
    this.hemiLight.color.copy(u.uAmbientSky.value);
    this.hemiLight.groundColor.copy(u.uAmbientGround.value);
  }

  // (Round 12) Another dimension's fixed sky: the sun and moon gone below
  // (no direct light, no shadows to draw: daylight reads 0, as vanilla's
  // Nether and End have no day), its colours, no clouds, its stars still or
  // none, and its fog: the Nether's thick (vanilla: the fog ends at half the
  // view, 96 blocks at most; here at three quarters of the chunks drawn,
  // which hides their edge), the End's at the edge of its view.
  _applyDimension(d) {
    const u = worldUniforms;
    u.uSunDir.value.set(0, -1, 0);
    u.uMoonDir.value.set(0, -1, 0);
    u.uLightDir.value.set(0, 1, 0);
    u.uLightColor.value.setRGB(0, 0, 0);
    u.uSkyZenith.value.setRGB(d.zenith[0], d.zenith[1], d.zenith[2]);
    u.uSkyHorizon.value.setRGB(d.horizon[0], d.horizon[1], d.horizon[2]);
    u.uSkyGlow.value.setRGB(0, 0, 0);
    u.uSunGlowColor.value.setRGB(0, 0, 0);
    u.uAmbientSky.value.setRGB(d.ambSky[0], d.ambSky[1], d.ambSky[2]);
    u.uAmbientGround.value.setRGB(d.ambGround[0], d.ambGround[1], d.ambGround[2]);
    u.uNight.value = d.stars ? 1 : 0;
    const m = this.material.uniforms;
    m.uStarAngle.value = 0.9;
    m.uCloudCoverage.value = 0;
    m.uCloudLit.value.setRGB(0, 0, 0);
    m.uCloudShade.value.setRGB(0, 0, 0);
    this.sunLight.color.setRGB(0, 0, 0);
    this.hemiLight.color.copy(u.uAmbientSky.value);
    this.hemiLight.groundColor.copy(u.uAmbientGround.value);
    const fog = u.uFog.value;
    if (!fog.equals(this._fogSet)) this._fogBase.copy(fog);
    const b = this._fogBase;
    const cap = Number.isFinite(this.dimView) ? (this.dimView - 0.3) * 16 : Infinity;
    if (d.fog === "thick") {
      const end = THREE.MathUtils.clamp(Math.min(b.y, cap) * 0.75, 40, 96);
      fog.set(end * 0.08, end, b.z * 3, b.w);
    } else {
      const end = Math.min(b.y, cap);
      fog.set(Math.min(b.x, end * 0.72), end, b.z, b.w);
    }
    this._fogSet.copy(fog);
  }

  // (Perf) Which shadow maps are redrawn this frame: the finest cascade (the
  // one round the player, where creatures and vehicles move) every frame;
  // the larger ones (High, Ultra) every 2nd and 3rd frame, on different
  // frames. They hold distant, mostly still ground: drawn 20-30 times a
  // second they look the same, at half the shadow drawing or less. A map
  // that doesn't exist yet (new settings) is always drawn.
  _scheduleShadows() {
    this._shadowFrame = ((this._shadowFrame ?? 0) + 1) % 6;
    for (let i = 0; i < this.shadowLights.length; i++) {
      const shadow = this.shadowLights[i].shadow;
      shadow.autoUpdate = false;
      // (Round 12: no sun in that dimension, nothing to draw them for.)
      if (this.dimSky) {
        if (shadow.map) shadow.needsUpdate = false;
        continue;
      }
      const period = i === 0 ? 1 : i === 1 ? 2 : 3;
      shadow.needsUpdate = !shadow.map || period === 1 || this._shadowFrame % period === (i === 1 ? 0 : 1);
    }
  }

  // Centers a shadow camera a little ahead of the player and snaps it to
  // whole shadow-map texels so shadow edges don't crawl as the player moves.
  _placeShadowLight(light, cascade, center, forward) {
    const dir = worldUniforms.uLightDir.value;
    const c = this._center.copy(center);
    if (forward) {
      c.x += forward.x * cascade.extent * 0.35;
      c.z += forward.z * cascade.extent * 0.35;
    }
    const right = this._right.set(0, 1, 0).cross(dir).normalize();
    const up = this._up.copy(dir).cross(right).normalize();
    const texel = (2 * cascade.extent) / cascade.mapSize;
    const r = Math.round(c.dot(right) / texel) * texel;
    const v = Math.round(c.dot(up) / texel) * texel;
    const f = c.dot(dir);
    light.target.position.set(0, 0, 0).addScaledVector(right, r).addScaledVector(up, v).addScaledVector(dir, f);
    light.position.copy(light.target.position).addScaledVector(dir, SHADOW_DEPTH / 2);
    light.target.updateMatrixWorld();
  }

  // cascades: [{ extent, mapSize }] from the finest to the largest (at most
  // one per shadow light). Only the first cascades.length lights cast shadows.
  configureShadows(cascades) {
    this.cascades = cascades.slice(0, this.shadowLights.length);
    this.shadowLights.forEach((light, i) => {
      const cascade = this.cascades[i];
      // (free the old map first: three never frees the map of a light that stops casting)
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
      light.castShadow = !!cascade;
      if (!cascade) return;
      light.shadow.mapSize.set(cascade.mapSize, cascade.mapSize);
      const texel = (2 * cascade.extent) / cascade.mapSize;
      light.shadow.bias = -0.0003;
      light.shadow.normalBias = texel * 1.2;
      const cam = light.shadow.camera;
      cam.left = -cascade.extent;
      cam.right = cascade.extent;
      cam.top = cascade.extent;
      cam.bottom = -cascade.extent;
      cam.near = 1;
      cam.far = SHADOW_DEPTH;
      cam.updateProjectionMatrix();
    });
  }
}
