// What everyone sees and hears of the fighting. Whoever causes something
// sends it once; the others draw it:
//   explosions  the fireball, smoke, flash, sound, shake, and what it does
//               to this player and this player's vehicle (the blocks it blew
//               away arrive as block edits);
//   bolts       laser bolts (blasters, the minigun, UFO cannons, aliens,
//               UFOs, enemy fighters, the jets' cannon): flown here too. A
//               bolt fired somewhere else only ever hurts this player and
//               this player's own vehicle (the AI's shots are judged by the
//               player they are aimed at, a player's shots by the shooter);
//   tracers     the pistol, machine gun and sniper rifle, with their sounds;
//   rail beams, the nuke (flash, fireball, cloud), airstrike meteors, flares;
//   projectiles rockets, grenades, arrows, missiles and nuke bombs in flight,
//               15 times a second from their owner, drawn here in between.
// Everything is batched into one message per frame.
import * as THREE from "three";
import { LASER_COLORS } from "../lasers.js";
import { itemInfo } from "../items.js";
import { bindEntityLight } from "../shaders.js";
import { LAYER_FX } from "../layers.js";
import { Jet, missileGeometry, nukeGeometry } from "../vehicle-jet.js";
import { r2, r1 } from "./interp.js";

const PJ_RATE = 15;
const PJ_TIMEOUT = 0.4; // s: a projectile not heard of for this long is gone
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const colorKeys = new Map(Object.entries(LASER_COLORS).map(([k, c]) => [c, k]));
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class FxSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.out = []; // events waiting for the end of the frame
    this.bolts = []; // our bolts fired this frame (sent at the end, with their homing)
    this.mirroring = 0;
    this.remotePj = new Map(); // "pid:id" -> { kind, mesh, pos, vel, t, light }
    this._pjId = 1;
    this._pjT = 0;
    this._hook();
    // Missiles from other machines coming at this player's jet (its warning).
    mp.game.vehicles.remoteMissiles = (jet) => this._incoming(jet);
    this.net.on("fx", (m, from) => this._onFx(m, from));
    this.net.on("pj", (m, from) => this._onPj(m, from));
  }

  // ---------- Hooks: what this peer does ----------

  _hook() {
    const g = this.game;
    const fx = g.effects;
    const explode = fx.explode.bind(fx);
    fx.explode = (pos, opts = {}) => {
      const r = explode(pos, opts);
      // (Round 9: also while another machine's effect is being played here:
      // this vehicle blown up by their blast explodes for everyone. Their own
      // explosion carries opts.mirror and is never sent back.)
      if (this.mp.active && !opts.mirror) this.out.push(["x", r2(pos.x), r2(pos.y), r2(pos.z), r2(opts.radius ?? 7), opts.source || "grenade", opts.visual ? r2(opts.visual) : 0]);
      return r;
    };
    const lasers = g.lasers;
    const fire = lasers.fire.bind(lasers);
    lasers.fire = (opts) => {
      const b = fire(opts);
      if (this.mp.active && !opts.mirror && !this.mirroring) this.bolts.push(b);
      return b;
    };
    const w = g.weapons;
    const tracer = w._spawnTracer.bind(w);
    w._spawnTracer = (a, b) => {
      tracer(a, b);
      if (this.mp.active && !this.mirroring) {
        const kind = itemInfo(g.inventory.selectedStack?.id)?.weapon?.kind || "pistol";
        this.out.push(["t", ...v3(a), ...v3(b), kind]);
      }
    };
    const beam = w._beam.bind(w);
    w._beam = (from, to, w0, life) => {
      const r = beam(from, to, w0, life);
      if (this.mp.active && !this.mirroring) this.out.push(["r", ...v3(from), ...v3(to), w0 ?? 0.22, life ?? 0.75]);
      return r;
    };
    const nuke = g.nuke;
    const detonate = nuke.detonate.bind(nuke);
    nuke.detonate = (center, opts = {}) => {
      const d = detonate(center, opts);
      if (this.mp.active && !opts.mirror) this.out.push(["n", ...v3(center), d.R]);
      return d;
    };
    const air = w.airstrike;
    const launch = air._launch.bind(air);
    air._launch = (m) => {
      const meteor = launch(m);
      if (this.mp.active && !m.mirror) this.out.push(["m", ...v3(m.start), r2(m.dir.x), r2(m.dir.y), r2(m.dir.z), r1(m.speed), r1(m.len)]);
      if (m.mirror) meteor.mirror = true;
      return meteor;
    };
    // A jet of ours lets its flares go: the other players' missiles must see them.
    const self = this;
    const launchFlares = Jet.prototype._launchFlares;
    Jet.prototype._launchFlares = function () {
      launchFlares.call(this);
      // (Round 9: the host's enemy fighters too: a guest's missile used to
      // ignore their flares, and the guest never saw them go.)
      if (!this.puppet && (this.net || (this.isEnemyJet && self.net.isHost))) self.flares(this);
    };
    // Sounds of firing that have no tracer or bolt of their own.
    const audio = g.audio;
    for (const [name, key] of [["playRocketLaunch", "rocket"], ["playThrow", "throw"], ["playBowShot", "bow"], ["playRailFire", "rail"], ["playCannon", "cannon"]]) {
      const orig = audio[name]?.bind(audio);
      if (!orig) continue;
      audio[name] = (...args) => {
        orig(...args);
        if (this.mp.active && !this.mirroring && !this._soundSkip) {
          const p = g.vehicles.active ? g.vehicles.active.pos : g.player.position;
          this.out.push(["s", key, r1(p.x), r1(p.y), r1(p.z)]);
        }
      };
    }
  }

  // A jet of ours let its flares go (the other players' missiles must see them too).
  flares(v) {
    if (!this.mp.active || !v) return;
    if (v.net) this.out.push(["f", v.net.nid]);
    else if (v.isEnemyJet) this.out.push(["f", `ej:${v.id}`]);
  }

  // ---------- Sending ----------

  update(dt) {
    if (!this.mp.active) {
      this.out.length = 0;
      this.bolts.length = 0;
      return;
    }
    for (const b of this.bolts) {
      const c = colorKeys.get(b.color) ?? this._colorKey(b.color);
      const h = b.homing?.target ? this.mp.refOf?.(b.homing.target) || 0 : 0;
      this.out.push(["b", r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), Math.round(b.dir.x * 1e4) / 1e4, Math.round(b.dir.y * 1e4) / 1e4, Math.round(b.dir.z * 1e4) / 1e4, c, r1(b.speed), r1(b.damage), b.owner, r1(b.range), Math.round(b.radius * 1000) / 1000, r2(b.length), r2(b.blast || 0), (b.hole ? 1 : 0) | (b.scorch ? 2 : 0) | (b.sound ? 4 : 0) | (b.tracer ? 8 : 0), h, b.homing ? r2(b.homing.turn) : 0, b.homing ? r1(b.homing.life) : 0, b.cause || 0]);
    }
    this.bolts.length = 0;
    if (this.out.length && this.mp.stateLoaded) this.net.toAll({ t: "fx", l: this.out });
    this.out = [];
    // Projectiles in flight.
    this._pjT -= dt;
    if (this._pjT <= 0) {
      this._pjT = 1 / PJ_RATE;
      this._sendProjectiles();
    }
    this._updateRemotePj(dt);
  }

  _colorKey(c) {
    // (A colour of its own: sent as numbers.)
    for (const [k, v] of Object.entries(LASER_COLORS)) if (v.equals?.(c)) return k;
    return [r2(c.r), r2(c.g), r2(c.b)];
  }

  _sendProjectiles() {
    const g = this.game;
    const list = [];
    const add = (o, kind, extra = 0) => {
      if (!o._pjid) o._pjid = this._pjId++;
      const vel = o.vel || (o.dir ? _v.copy(o.dir).multiplyScalar(o.speed || 0) : null);
      list.push([o._pjid, kind, r2(o.pos.x), r2(o.pos.y), r2(o.pos.z), vel ? r1(vel.x) : 0, vel ? r1(vel.y) : 0, vel ? r1(vel.z) : 0, extra]);
    };
    const w = g.weapons;
    for (const r of w.rockets || []) add(r, "rk");
    for (const gr of w.grenades || []) add(gr, "gr");
    for (const a of w.arrows || []) if (!a.stuck || a.age < 0.3) add(a, "ar");
    if (this.net.isHost) for (const a of g.mobs.arrows || []) add(a, "ar");
    for (const v of g.vehicles.vehicles) {
      if (v.puppet || v.type === "ufo") continue;
      if (v.net || (this.net.isHost && v.isEnemyJet)) {
        for (const m of v.missiles || []) if (!m.dead) add(m, "ms", m.target?.ref ? this.mp.refOf?.(m.target.ref) || 0 : 0);
        for (const b of v.bombs || []) add(b, "nb", b.chute?.visible ? 1 : 0);
      }
    }
    if (list.length && this.mp.stateLoaded) this.net.toAll({ t: "pj", ts: this.net.time, l: list }, { fast: true });
  }

  // ---------- Receiving ----------

  _onFx(m, from) {
    if (!Array.isArray(m.l) || !this.mp.stateLoaded) return;
    this._frame = (this._frame || 0) + 1;
    const g = this.game;
    this.mirroring++;
    try {
      for (const e of m.l) {
        try {
          this._event(e, from, g);
        } catch (err) {
          console.warn("UFO COMBAT net: bad effect", e, err);
        }
      }
    } finally {
      this.mirroring--;
    }
  }

  _event(e, from, g) {
    const ears = g.effects.listener;
    switch (e[0]) {
      case "x": {
        const pos = new THREE.Vector3(e[1], e[2], e[3]);
        g.effects.explode(pos, { radius: e[4], source: e[5], visual: e[6] || null, mirror: true, by: from });
        if (g.grass?.density > 0 && pos.distanceTo(g.player.position) < 90) g.grass.clear(pos.x, pos.z, Math.min(e[4] + 2.5, 30));
        break;
      }
      case "b": {
        const color = Array.isArray(e[7]) ? new THREE.Color(e[7][0], e[7][1], e[7][2]) : LASER_COLORS[e[7]] || LASER_COLORS.red;
        const from3 = new THREE.Vector3(e[1], e[2], e[3]);
        const b = g.lasers.fire({ from: from3, dir: new THREE.Vector3(e[4], e[5], e[6]), color, speed: e[8], damage: e[9], owner: e[10], source: null, range: e[11], radius: e[12], length: e[13], blast: e[14], hole: !!(e[15] & 1), scorch: !!(e[15] & 2), sound: false, mirror: true, tracer: !!(e[15] & 8), cause: typeof e[19] === "string" ? e[19] : null });
        b.by = from;
        if (e[16]) {
          const t = this.mp.resolveRef?.(e[16]);
          if (t) b.homing = { target: t, turn: e[17] || 2, life: e[18] || 5 };
        }
        // The shot's sound, from where it was fired (a UFO's volley once per batch).
        const d = from3.distanceTo(ears);
        if (e[15] & 4) {
          if (d < 160) g.audio.playDistant(d, () => g.audio.playBlaster?.(0, e[10]));
        } else if (e[10] === "ufo" && this._ufoShotFrame !== this._frame) {
          this._ufoShotFrame = this._frame;
          g.audio.playUfoShot?.("volley", d);
        }
        break;
      }
      case "t": {
        const a = new THREE.Vector3(e[1], e[2], e[3]);
        g.weapons._spawnTracer(a, new THREE.Vector3(e[4], e[5], e[6]));
        g.effects.glow.spawn({ x: a.x, y: a.y, z: a.z, life: 0.06, size0: 0.6, size1: 0.2, color0: this._muzzleC || (this._muzzleC = new THREE.Color(3, 2, 0.8)), alpha: 0.9 });
        const d = a.distanceTo(ears);
        const au = g.audio;
        const kind = e[7];
        au.playDistant(d, () => (kind === "sniper" ? au.playSniperShot() : kind === "machinegun" ? au.playMachineGun() : au.playGunshot()));
        break;
      }
      case "r":
        g.weapons._beam(new THREE.Vector3(e[1], e[2], e[3]), new THREE.Vector3(e[4], e[5], e[6]), e[7], e[8]);
        break;
      case "n":
        g.nuke.detonate(new THREE.Vector3(e[1], e[2], e[3]), { mirror: true, R: e[4], by: from });
        break;
      case "m":
        g.weapons.airstrike._launch({ start: new THREE.Vector3(e[1], e[2], e[3]), dir: new THREE.Vector3(e[4], e[5], e[6]).normalize(), speed: e[7], len: e[8], mirror: true });
        break;
      case "f": {
        // (A player's aircraft by its shared id; the host's enemy fighter, "ej:<id>", by its puppet.)
        const ej = typeof e[1] === "string" && e[1].startsWith("ej:") ? Number(e[1].slice(3)) : null;
        const v = ej !== null ? this.mp.entities.jetById.get(ej) : this.mp.vehicles.byNid(e[1]);
        if (v?.puppet && v._launchFlares) {
          this._soundSkip = true;
          const msg = v.manager.onMessage;
          v.manager.onMessage = null;
          try {
            v._launchFlares();
          } finally {
            v.manager.onMessage = msg;
            this._soundSkip = false;
          }
        }
        break;
      }
      case "s": {
        const d = Math.hypot(e[2] - ears.x, e[3] - ears.y, e[4] - ears.z);
        const au = g.audio;
        const fn = { rocket: () => au.playRocketLaunch(), throw: () => au.playThrow(), bow: () => au.playBowShot?.(1), rail: () => au.playRailFire?.(0), cannon: () => au.playCannon?.() }[e[1]];
        if (fn) au.playDistant(d, fn);
        break;
      }
    }
  }

  // ---------- Remote projectiles ----------

  _onPj(m, from) {
    if (!Array.isArray(m.l) || !this.mp.stateLoaded) return;
    const now = performance.now() / 1000;
    for (const e of m.l) {
      const key = `${from}:${e[0]}`;
      let p = this.remotePj.get(key);
      if (!p) {
        p = this._makePj(e[1]);
        if (!p) continue;
        this.remotePj.set(key, p);
        p.pos.set(e[2], e[3], e[4]);
      }
      p.target.set(e[2], e[3], e[4]);
      p.vel.set(e[5], e[6], e[7]);
      p.extra = e[8];
      p.t = now;
    }
  }

  _makePj(kind) {
    const g = this.game;
    const w = g.weapons;
    let mesh;
    const light = { sky: 15, block: 0 };
    if (kind === "rk") {
      mesh = new THREE.Mesh(w._rocketGeo, w.material);
      const ex = new THREE.Sprite(w._exhaustMat);
      ex.layers.set(LAYER_FX);
      ex.position.set(0, 0, 0.36);
      ex.scale.setScalar(0.7);
      mesh.add(ex);
    } else if (kind === "gr") mesh = new THREE.Mesh(w._grenadeGeo, w.material);
    else if (kind === "ar") mesh = new THREE.Mesh(w.arrowGeometry(), w.material);
    else if (kind === "ms") mesh = new THREE.Mesh(this._missileGeo || (this._missileGeo = missileGeometry()), this._missileMat || (this._missileMat = new THREE.MeshLambertMaterial({ vertexColors: true })));
    else if (kind === "nb") {
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this._nukeGeo || (this._nukeGeo = nukeGeometry()), this._missileMat || (this._missileMat = new THREE.MeshLambertMaterial({ vertexColors: true }))));
      const chute = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshLambertMaterial({ color: 0xd8d2c0, side: THREE.DoubleSide }));
      chute.position.y = 3.2;
      chute.visible = false;
      mesh.add(chute);
      mesh.userData.chute = chute;
    } else return null;
    if (kind === "rk" || kind === "gr" || kind === "ar") bindEntityLight(mesh, () => light);
    g.scene.add(mesh);
    return { kind, mesh, light, pos: new THREE.Vector3(), target: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, extra: 0, trail: 0 };
  }

  _incoming(jet) {
    const out = [];
    if (!this.remotePj.size || !jet?.net) return out;
    const me = `v:${jet.net.nid}`;
    const mePlayer = `p:${this.net.pid}`;
    for (const p of this.remotePj.values()) if (p.kind === "ms" && (p.extra === me || p.extra === mePlayer)) out.push(p.pos);
    return out;
  }

  _updateRemotePj(dt) {
    if (!this.remotePj.size) return;
    const g = this.game;
    const now = performance.now() / 1000;
    const fx = g.effects;
    for (const [key, p] of this.remotePj) {
      if (now - p.t > PJ_TIMEOUT || !this.mp.active) {
        g.scene.remove(p.mesh);
        this.remotePj.delete(key);
        continue;
      }
      // Toward the last report, carried on by its velocity (no jitter, no lag pile-up).
      p.target.addScaledVector(p.vel, dt);
      p.pos.lerp(p.target, Math.min(1, dt * 12));
      if (p.pos.distanceTo(p.target) > 30) p.pos.copy(p.target);
      p.mesh.position.copy(p.pos);
      if (p.vel.lengthSq() > 0.01 && p.kind !== "gr" && p.kind !== "nb") {
        p.mesh.lookAt(_w.copy(p.pos).add(p.vel));
        p.mesh.rotateY(Math.PI);
      }
      if (p.kind === "nb") p.mesh.userData.chute.visible = !!p.extra;
      if (p.kind === "rk" || p.kind === "gr" || p.kind === "ar") {
        const l = g.world.lightAt(p.pos.x, p.pos.y, p.pos.z);
        p.light.sky = l.sky;
        p.light.block = l.block;
      }
      // Smoke trails behind rockets and missiles.
      if (p.kind === "rk" || p.kind === "ms") {
        p.trail -= dt;
        if (p.trail <= 0) {
          p.trail = 0.03;
          const c = this._smokeC || (this._smokeC = [new THREE.Color(0.85, 0.85, 0.85), new THREE.Color(0.6, 0.6, 0.6), new THREE.Color(4, 2.2, 0.8)]);
          fx.smoke.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.3, vz: (Math.random() - 0.5) * 0.5, life: p.kind === "ms" ? 2.2 : 1.4, size0: 0.4, size1: p.kind === "ms" ? 2.4 : 1.6, color0: c[0], color1: c[1], alpha: 0.5, drag: 1 });
          fx.glow.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.06, size0: 0.9, size1: 0.3, color0: c[2], alpha: 0.9 });
        }
      }
    }
  }

  stop() {
    for (const p of this.remotePj.values()) this.game.scene.remove(p.mesh);
    this.remotePj.clear();
    this.out.length = 0;
    this.bolts.length = 0;
  }
}
