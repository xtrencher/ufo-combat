// (Round 19) The UFOs' whims: shot dodging and mischief. Installed on
// UfoManager (js/ufos.js) as extra methods: `this` is the manager, and
// everything here runs where the UFOs think (offline, or the host online;
// a guest's puppets only draw what the synced flags say, see _puppetFx).
//
// Dodging ("they expect the shot"): every shot a player fires (bullets,
// bolts, lasers, rockets, tank shells, a charging railgun under the
// crosshair) is looked at once, when it leaves the gun. The UFO it would hit
// first may see it coming and slide aside, smoothly and just far enough
// that the shot flies past right next to its hull, finishing the slide
// before the shot gets there. Whether a shot hits is still decided by the
// shot itself against the ship's real position (lasers.js, ufos.raycast),
// so what you see is what happens. Each ship has its own skill (clumsy to
// uncanny) and reaction time; it needs a moment to react (a shot from close
// up, or a very fast one, always lands), it can't move far quickly (big
// ships rarely manage), every dodge tires it and it needs a moment before
// the next one, so sustained, re-aimed fire, leading it, blasts and homing
// rockets get it in the end. A ship kept in the crosshair expects the shot
// (more likely to dodge, quicker) and sometimes sways from side to side,
// slowly, taunting. A cheeky one now and then blinks out of the way instead.
//
// Moods and mischief ("pranks"): each ship has a mood that changes now and
// then (calm, curious, playful, cheeky, grumpy) and, with its personality
// (evader, fast, fighter), decides how often it comes to bother a player
// and how: see PRANKS. A prank is a state of its own ("prank"); shot during
// one, a ship flees laughing (a dash, a laugh, often off into the sky) or
// turns on the player, by its mood. None of it comes near a player in their
// calm after arriving or respawning (_inGrace): a UFO keeps GRACE_KEEP blocks
// away from them then, whatever it is doing.
import * as THREE from "three";

function rand(a, b) {
  return a + Math.random() * (b - a);
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(4, 4.2, 4.6);
const BEACON = new THREE.Color(0.8, 2.6, 4);
const SPARKLE = new THREE.Color(1.6, 2.4, 3.4);

export const MOODS = ["calm", "curious", "playful", "cheeky", "grumpy"];
const MOOD_RATE = { calm: 0.3, curious: 0.8, playful: 1.4, cheeky: 1.8, grumpy: 0.9 }; // how often it goes and bothers someone
const MOOD_DODGE = { calm: 0.85, curious: 1, playful: 1.1, cheeky: 1.25, grumpy: 0.9 };
const MOOD_LAUGH = { calm: 0.3, curious: 0.45, playful: 0.7, cheeky: 0.8, grumpy: 0.12 }; // shot mid-prank: flee laughing (else it fights)
const MOOD_SWAY = { calm: 0.15, curious: 0.5, playful: 1, cheeky: 1.6, grumpy: 0.4 }; // the taunting sway under the crosshair
export const GRACE_KEEP = 85; // blocks kept from a player in their calm (plus the ship's radius)
const SIZE_DODGE = [1, 0.85, 0.55, 0.2, 0]; // a giant never sidesteps
const PLAYER_OWNERS = new Set(["player", "playerufo", "jet"]);

// The pranks: weights per personality, the sizes that play them, whether
// they suit a player on foot and/or in a (slow) vehicle, and the moods that
// like them most.
//   photobomb  hovers right in front of your view; aim at it and it slips aside, and comes back
//   mimic      copies your every move (walk, jump, turn) from a little way off
//   halo       circles round your head, beeping; aim and it turns about
//   glare      parks up in your view and blinds you with pulsing light
//   peekaboo   hides behind a hill, peeks over, ducks when you aim
//   shadow     follows you just out of a pistol's reach, sliding out of the crosshair
//   buzz       roars past you (or your vehicle) at close range, again and again
//   squat      parks on top of a vehicle or a roof near you (or your own vehicle, standing still)
//   cowdrop    beams up an animal nearby and drops it next to you
//   twins      splits into look-alike holograms that scatter (shoot one: it pops)
//   moo        sits behind you, out of sight, and moos
//   lure       leads you somewhere (a wreck, a vehicle, or just away), beeping if you dawdle
//   signal     flashes a beacon and others come and gawk at you from a distance
//   snatch     beams up an item lying near you and drops it a little way off (single player only:
//              items lying about aren't moved online)
export const PRANKS = {
  photobomb: { evader: 1, fast: 3, fighter: 1.5, sizes: [0, 1], foot: true, moods: { cheeky: 2.5, playful: 1.5 } },
  mimic: { evader: 2.5, fast: 1.5, fighter: 0.8, sizes: [0, 1, 2], foot: true, moods: { playful: 2.5, curious: 1.5 } },
  halo: { evader: 1, fast: 3, fighter: 1, sizes: [0, 1], foot: true, moods: { playful: 2, cheeky: 1.5 } },
  glare: { evader: 0.8, fast: 1, fighter: 2.5, sizes: [0, 1, 2, 3], foot: true, vehicle: true, moods: { grumpy: 3, cheeky: 1.5 } },
  peekaboo: { evader: 3, fast: 1, fighter: 0.6, sizes: [0, 1, 2], foot: true, moods: { playful: 2.5, curious: 1.5 } },
  shadow: { evader: 1.5, fast: 1, fighter: 2.5, sizes: [1, 2, 3], foot: true, vehicle: true, moods: { grumpy: 2, curious: 2 } },
  buzz: { evader: 0.6, fast: 3, fighter: 2, sizes: [0, 1], foot: true, vehicle: true, moods: { cheeky: 2.5, grumpy: 1.5 } },
  squat: { evader: 1.5, fast: 0.8, fighter: 1.5, sizes: [0, 1], foot: true, vehicle: true, moods: { cheeky: 2.5, calm: 1.5 } },
  cowdrop: { evader: 1.5, fast: 1.5, fighter: 1, sizes: [0, 1, 2], foot: true, moods: { playful: 2, cheeky: 2 } },
  twins: { evader: 2.5, fast: 1.5, fighter: 0.7, sizes: [0, 1, 2], foot: true, vehicle: true, moods: { cheeky: 2, playful: 1.5 } },
  moo: { evader: 2, fast: 1, fighter: 1, sizes: [0, 1, 2], foot: true, moods: { playful: 2.5, cheeky: 1.5 } },
  lure: { evader: 1.5, fast: 1.2, fighter: 0.6, sizes: [0, 1], foot: true, vehicle: true, moods: { curious: 3 } },
  signal: { evader: 1, fast: 1, fighter: 1.5, sizes: [1, 2, 3, 4], foot: true, vehicle: true, moods: { curious: 2.5, grumpy: 1.2 } },
  snatch: { evader: 1.5, fast: 2.5, fighter: 0.6, sizes: [0, 1], foot: true, vehicle: true, moods: { cheeky: 3, playful: 1.5 } },
};
export const PRANK_NAMES = Object.keys(PRANKS);
// Sound and light events (synced to guests as flag bits: _fx, fxFlags).
const FX = { laugh: 1, moo: 2, beep: 3, beacon: 4, sparkle: 5 };
const FX_NAME = ["", "laugh", "moo", "beep", "beacon", "sparkle"];

export const Mischief = {
  // ---------- Per ship ----------

  _initWhims(u) {
    const r = Math.random();
    u.dodgeSkill = (r < 0.35 ? rand(0.03, 0.2) : r < 0.85 ? rand(0.2, 0.5) : rand(0.6, 0.9)) * SIZE_DODGE[u.S.idx]; // (clumsy, average, uncanny)
    u.dodgeReact = rand(0.1, 0.3) * (u.dodgeSkill > 0.55 ? 0.6 : 1);
    u.fatigue = 0;
    u.dodgeCoolT = 0;
    u.aimT = 0;
    u.mood = MOODS[Math.floor(Math.random() * MOODS.length)];
    u.moodT = rand(15, 60);
    u.whimT = rand(6, 30);
    u.evade = null;
    u.drift = null;
    u.driftCool = 0;
    u.prank = null;
    u.glare = 0;
    u.fxCode = 0;
    u.fxSeq = 0;
  },

  // Once a frame, before the ships think (not a guest's puppets).
  _whimFrame(targets) {
    this._pframe = (this._pframe | 0) + 1; // (the players' cached views go stale)
    if (this._pcache.size > 16) this._pcache.clear();
    let n = 0;
    for (const u of this.ufos) if (u.state === "prank" && u.prank && u.prank.kind !== "gawk" && u.prank.kind !== "decoy") n++;
    this._prankers = n;
    this._prankCap = 2 * Math.max(1, targets ? targets.length : 1);
    this._scanThreats();
  },

  // One ship's whims, every time it thinks (after its temper).
  _updateWhims(u, dt, tgt, dist) {
    u.fatigue = Math.max(0, u.fatigue - dt * 0.07);
    u.dodgeCoolT -= dt;
    u.driftCool -= dt;
    if ((u.moodT -= dt) <= 0) {
      u.moodT = rand(20, 70);
      u.mood = MOODS[Math.floor(Math.random() * MOODS.length)];
    }
    if (u.prank && u.state !== "prank") this._endPrank(u); // (it was called away: to fight, shot, ...)
    if (u.leaveSoonT !== undefined && (u.leaveSoonT -= dt) <= 0 && !u.dash) {
      u.leaveSoonT = undefined;
      if (!u.falling && u.state !== "leave" && !u.hostile) this._leave(u);
    }
    this._trackAim(u, dt, dist);
    // Kept in the crosshair: now and then a slow, taunting sway.
    if (u.aimT > 0.6 && !u.drift && !u.evade && u.driftCool <= 0 && !u.decoy && u.S.idx <= 3 && (u.state === "roam" || u.state === "trick" || u.state === "circle" || (u.state === "prank" && /^(shadow|gawk|glare|moo|lure)$/.test(u.prank?.kind)))) {
      if (Math.random() < 0.45 * MOOD_SWAY[u.mood] * this.prankRate * dt) this._startSway(u);
    }
    // Off to bother someone?
    u.whimT -= dt * MOOD_RATE[u.mood] * this.prankRate;
    if (u.whimT <= 0) {
      u.whimT = rand(10, 40);
      if (this._canPrank(u, dist)) this._randomPrank(u);
    }
  },

  // ---------- The player as a prankster sees them ----------

  // Where the player it thinks about looks from and to (cached a frame).
  _pinfo() {
    const pl = this.player;
    let c = this._pcache.get(pl);
    if (c && c.frame === this._pframe) return c;
    if (!c) this._pcache.set(pl, (c = { eye: new THREE.Vector3(), fwd: new THREE.Vector3(), flat: new THREE.Vector3(), side: new THREE.Vector3(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), veh: null, yaw: 0, frame: 0 }));
    c.frame = this._pframe;
    c.vel.set(0, 0, 0);
    const veh = this._playerVehicle();
    c.veh = veh;
    c.pos.copy(veh ? veh.pos : pl.position);
    if (veh?.vel) c.vel.copy(veh.vel);
    else if (pl.velocity) c.vel.copy(pl.velocity);
    if (veh) c.eye.copy(veh.pos).y += 2;
    else c.eye.copy(pl.getEyePosition ? pl.getEyePosition() : c.pos);
    if (veh && veh.vel && veh.vel.lengthSq() > 25) c.fwd.copy(veh.vel).normalize();
    else if (pl.getForwardVector) c.fwd.copy(pl.getForwardVector());
    else c.fwd.set(0, 0, -1);
    c.flat.set(c.fwd.x, 0, c.fwd.z);
    if (c.flat.lengthSq() < 1e-4) c.flat.set(0, 0, -1);
    c.flat.normalize();
    c.side.set(-c.flat.z, 0, c.flat.x);
    c.yaw = Math.atan2(-c.flat.x, -c.flat.z);
    return c;
  },

  // Is the player's crosshair on (or just beside) this ship?
  _trackAim(u, dt, dist) {
    if (dist > 360 || this.player.dead) {
      u.aimed = false;
      u.aimT = Math.max(0, u.aimT - dt * 2);
      return;
    }
    const P = this._pinfo();
    const r = _a.copy(u.pos).sub(P.eye);
    const along = r.dot(P.fwd);
    let aimed = false;
    if (along > 0) {
      const perp = r.addScaledVector(P.fwd, -along).length();
      aimed = perp < u.radius * 1.25 + 1.5;
    }
    u.aimed = aimed;
    u.aimT = aimed ? u.aimT + dt : Math.max(0, u.aimT - dt * 1.5);
  },

  // ---------- Dodging ----------

  // Every new shot of a player's, looked at once (see the header).
  _scanThreats() {
    const bolts = this.lasers?.bolts;
    let top = this._boltSeen;
    if (bolts) {
      for (const b of bolts) {
        if (!(b.serial > this._boltSeen)) continue;
        if (b.serial > top) top = b.serial;
        if (b.dead || !PLAYER_OWNERS.has(b.owner) || !(b.speed > 0)) continue;
        this._threat(b.pos, b.dir, b.speed, Math.max(0, b.range - b.traveled), b, b.serial, false);
      }
    }
    this._boltSeen = top;
    // Rockets (main.js threatSources) and the tanks' shells: new objects each.
    const seen = this._threatSeen;
    const see = (pos, vel, ref, homing = false) => {
      if (seen.has(ref)) return;
      seen.add(ref);
      const sp = vel.length();
      if (sp < 1) return;
      this._threat(pos, _d.copy(vel).divideScalar(sp), sp, 600, ref, 0, homing);
    };
    for (const src of this.threatSources) src(see);
    const shells = this.vehicles?.shells?.shells;
    if (shells) for (const s of shells) if (s.player && !s.remote) see(s.pos, s.vel, s);
    // A railgun charging with a ship under the crosshair: it sees the shot
    // coming, once per charge (the beam itself is instant).
    const rem = this.aimCharge ? this.aimCharge() : 0;
    if (rem > 0) {
      if (!this._railOn) {
        this._railOn = true;
        this._railId = (this._railId | 0) + 1;
      }
      const pl = this.localPlayer;
      if (!pl.dead && pl.getEyePosition) {
        const eye = pl.getEyePosition();
        const dir = pl.getForwardVector();
        const h = this.raycast(eye, dir, 1500, (u) => u.railSeen !== this._railId && !u.net);
        if (h) {
          h.ufo.railSeen = this._railId;
          this._threat(eye, dir, Infinity, 1500, null, 0, false, rem + 0.03, h.ufo);
        }
      }
    } else this._railOn = false;
  },

  // A shot from `origin` along `dir` at `speed`: the ship it would hit
  // first (moving as it does now) may dodge it. tti/only: an instant shot
  // (the railgun) at a known moment, at a known ship.
  _threat(origin, dir, speed, reach, ref, serial, homing, tti = null, only = null) {
    let best = null;
    let bestT = Infinity;
    for (const u of only ? [only] : this.ufos) {
      if (u.state === "gone" || u.falling || u.net || u.captured || u.decoy) continue;
      const dx = u.pos.x - origin.x;
      const dy = u.pos.y - origin.y;
      const dz = u.pos.z - origin.z;
      const lim = reach + u.radius + 40;
      if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
      let t;
      if (tti !== null) t = tti;
      else {
        t = this._impactTime(u, origin, dir, speed);
        if (t === null || t * speed > reach + u.radius) continue;
      }
      if (t < bestT) {
        bestT = t;
        best = u;
      }
    }
    if (!best) return;
    this.mischief.threats++;
    this._tryDodge(best, origin, dir, speed, bestT, ref, serial, homing);
  },

  // When a shot moving from `origin` along `dir` at `speed` enters the
  // ship's hit shape (an ellipsoid: ufos.raycast), the ship moving as it
  // does now; null if it never does.
  _impactTime(u, origin, dir, speed) {
    const sy = u.radius / u.hitHalfHeight;
    const rx = u.pos.x - origin.x;
    const ry = (u.pos.y - origin.y) * sy;
    const rz = u.pos.z - origin.z;
    const wx = u.vel.x - dir.x * speed;
    const wy = (u.vel.y - dir.y * speed) * sy;
    const wz = u.vel.z - dir.z * speed;
    const a = wx * wx + wy * wy + wz * wz;
    if (a < 1e-9) return null;
    const b = rx * wx + ry * wy + rz * wz;
    const c = rx * rx + ry * ry + rz * rz - u.radius * u.radius;
    if (c <= 0) return null; // (already inside: point blank)
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / a;
    return t > 0 ? t : null;
  },

  // The miss vector at the closest approach (in the ellipsoid's scaled
  // space, perpendicular to the shot's relative motion) with the ship moved
  // by `extra` (real blocks): { m, w } (w: the unit relative direction), or
  // null when the shot is already past.
  _missVector(u, origin, dir, speed, extra, out) {
    const sy = u.radius / u.hitHalfHeight;
    const rx = u.pos.x + extra.x - origin.x;
    const ry = (u.pos.y + extra.y - origin.y) * sy;
    const rz = u.pos.z + extra.z - origin.z;
    let wx;
    let wy;
    let wz;
    if (speed === Infinity) {
      wx = -dir.x;
      wy = -dir.y * sy;
      wz = -dir.z;
    } else {
      wx = u.vel.x - dir.x * speed;
      wy = (u.vel.y - dir.y * speed) * sy;
      wz = u.vel.z - dir.z * speed;
    }
    const wl = Math.hypot(wx, wy, wz);
    if (wl < 1e-6) return null;
    wx /= wl;
    wy /= wl;
    wz /= wl;
    const along = rx * wx + ry * wy + rz * wz;
    if (along > 0 && speed !== Infinity) return null; // (moving apart: past it)
    out.m.set(rx - wx * along, ry - wy * along, rz - wz * along);
    out.w.set(wx, wy, wz);
    return out;
  },

  _tryDodge(u, origin, dir, speed, tti, ref, serial, homing) {
    if (u.dash || u.evade || u.decoy || u.captured || u.S.idx >= 4) return false;
    // (A mission's fixed pieces stay put: the shield's pylons, the shielded or landing ships, the boss.)
    if (u.pylon || u.shield || u.immune || u.boss || u.landed || u.noDodge) return false;
    if (u.dodgeCoolT > 0) return false;
    const st = this.mischief;
    st.tries++;
    const avail = tti - u.dodgeReact * (u.aimT > 0.35 ? 0.5 : 1);
    if (avail < 0.08) return false; // (too close, too fast: it lands)
    const expect = u.aimT > 0.35 ? 1.3 : 1;
    let p = u.dodgeSkill * (1 - u.fatigue) * (1 - u.fatigue) * MOOD_DODGE[u.mood] * expect * this.dodgeScale * (u.dodgeMul ?? 1);
    if (homing) p *= 0.5;
    if (!(Math.random() < Math.min(this.dodgeScale > 1 ? 1 : 0.97, p))) return false; // (dodgeScale over 1: certain, for tests)
    // Which way: perpendicular to the shot, the least real movement that
    // takes the hull just clear of it (a thin disc ducks rather than
    // sidesteps), sometimes another feasible way for variety.
    const sy = u.radius / u.hitHalfHeight;
    const mv = this._missVector(u, origin, dir, speed, _c.set(0, 0, 0), this._mvOut);
    if (!mv) return false;
    const m = mv.m;
    const w = mv.w;
    const T = u.radius + rand(0.35, 1.2);
    const e1 = _a.crossVectors(w, _up);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = _b.crossVectors(w, e1).normalize();
    const cands = [];
    const tryDir = (cx, cy, cz) => {
      const mc = m.x * cx + m.y * cy + m.z * cz;
      const k = -mc + Math.sqrt(Math.max(0, mc * mc - m.lengthSq() + T * T));
      const off = new THREE.Vector3(cx * k, (cy * k) / sy, cz * k);
      const cost = off.length();
      // (Not into the ground.)
      const g = this._groundAt(u.pos.x + off.x, u.pos.z + off.z) + u.info.bottom * u.radius + 0.5;
      if (u.pos.y + off.y < g) return;
      cands.push({ off, cost, c: new THREE.Vector3(cx, cy, cz) });
    };
    if (m.length() > u.radius * 0.05) {
      const n = _d.copy(m).normalize();
      tryDir(n.x, n.y, n.z);
    }
    tryDir(e1.x, e1.y, e1.z);
    tryDir(-e1.x, -e1.y, -e1.z);
    tryDir(e2.x, e2.y, e2.z);
    tryDir(-e2.x, -e2.y, -e2.z);
    if (!cands.length) return false;
    cands.sort((x, y) => x.cost - y.cost);
    const pick = Math.random() < 0.3 && cands.length > 1 ? cands[Math.floor(Math.random() * Math.min(3, cands.length))] : cands[0];
    const maxSlide = u.S.top * 0.8 + 8;
    const room = avail - 0.03;
    if (pick.cost / room > maxSlide) return false; // (it can't get clear in time)
    // As slow as it can be and still be clear in time: a lazy little slide.
    const dur = Math.max(0.12, Math.min(room, 0.25 + pick.cost * 0.12 + rand(0, 0.45)));
    const react = tti - avail;
    u.evade = { off: pick.off, c: pick.c, sy, T, t: -react, dur, k: 0, ref, serial, speed, origin: origin.clone(), dir: dir.clone(), tti, blink: false };
    // A cheeky (or fast) ship now and then blinks out of the way instead.
    if ((u.mood === "cheeky" || u.personality === "fast") && u.S.idx <= 2 && Math.random() < 0.18) u.evade.blink = true;
    u.dodgeCoolT = rand(0.25, 0.8) * (1.6 - Math.min(1, u.dodgeSkill));
    u.fatigue = Math.min(1, u.fatigue + rand(0.15, 0.28));
    st.dodges++;
    st.last = { id: u.id, cost: pick.cost, dur, tti, blink: u.evade.blink };
    return true;
  },

  // The sidestep and the sway, applied to the ship's position (on top of
  // its own flying), every time it thinks.
  _applyOffsets(u, dt) {
    let vx = 0;
    let vy = 0;
    let vz = 0;
    const ev = u.evade;
    if (ev) {
      ev.t += dt;
      if (ev.blink) {
        // Waits until the last moment, then a short dash aside.
        if (ev.t >= ev.dur - 0.02) {
          u.evade = null;
          const len = Math.max(ev.off.length() * 2.5, u.radius * 2 + 6);
          const to = _a.copy(ev.off).normalize().multiplyScalar(len).add(u.pos);
          to.y = Math.max(to.y, this._groundAt(to.x, to.z) + u.info.bottom * u.radius + 2);
          u.dash = { from: u.pos.clone(), to: to.clone(), t: 0, dur: 0.07, last: u.pos.clone() };
          if (this.audio?.playUfoDash) this.audio.playUfoDash(u.pos.distanceTo(this._ears()));
          if (Math.random() < 0.6) this._fx(u, "laugh");
        }
      } else {
        // (Still coming? Then check it would still pass clear, the ship
        // moving as it does now: more slide if not.)
        const r = ev.ref;
        if (r && ev.serial && r.serial === ev.serial && !r.dead && ev.k < 0.95) {
          const rest = _b.copy(ev.off).multiplyScalar(1 - ev.k);
          const mv = this._missVector(u, r.pos, r.dir, r.speed, rest, this._mvOut);
          if (mv && mv.m.length() < ev.T) {
            const m = mv.m;
            const c = ev.c;
            const mc = m.dot(c);
            const k = -mc + Math.sqrt(Math.max(0, mc * mc - m.lengthSq() + ev.T * ev.T));
            const add = _c.set(c.x * k, (c.y * k) / ev.sy, c.z * k).multiplyScalar(1 / Math.max(0.2, 1 - ev.k));
            if (add.length() < u.radius * 2 + 6) ev.off.add(add);
          }
        }
        if (ev.t > 0) {
          const x = Math.min(1, ev.t / ev.dur);
          const k = x * x * (3 - 2 * x);
          const dk = k - ev.k;
          ev.k = k;
          u.pos.addScaledVector(ev.off, dk);
          if (dt > 0) {
            vx += (ev.off.x * dk) / dt;
            vy += (ev.off.y * dk) / dt;
            vz += (ev.off.z * dk) / dt;
          }
          if (x >= 1) {
            u.evade = null;
            this.mischief.slides++;
            // Smug about it, sometimes.
            const r2 = Math.random();
            if (r2 < 0.22 * MOOD_SWAY[u.mood]) this._fx(u, "laugh");
            else if (r2 < 0.3 && !u.drift) this._startSway(u, 0.5);
            // Shot at often enough, a ship with a temper gets cross.
            if (!u.hostile && !u.decoy && !u.peaceful && !this._inGrace() && Math.random() < 0.08 * this._agg() * (0.5 + u.temper)) this.anger(u, rand(20, 45));
          }
        }
      }
    }
    const dr = u.drift;
    if (dr) {
      dr.t += dt;
      const x = Math.min(1, dr.t / dr.dur);
      const env = Math.sin(Math.PI * x);
      const s = Math.sin(Math.PI * 2 * dr.f * dr.t) * env * dr.amp;
      const yb = Math.sin(Math.PI * 4 * dr.f * dr.t) * env * dr.amp * 0.2;
      const ds = s - dr.s;
      const dyb = yb - dr.yb;
      dr.s = s;
      dr.yb = yb;
      u.pos.addScaledVector(dr.side, ds);
      u.pos.y += dyb;
      if (dt > 0) {
        vx += (dr.side.x * ds) / dt;
        vy += dyb / dt;
        vz += (dr.side.z * ds) / dt;
      }
      if (x >= 1) u.drift = null;
    }
    if (vx || vy || vz) (u.evVel || (u.evVel = new THREE.Vector3())).set(vx, vy, vz);
    else if (u.evVel) u.evVel.set(0, 0, 0);
  },

  // A slow sway from side to side across the player's line of sight.
  _startSway(u, scale = 1) {
    const P = this._pinfo();
    const to = _a.copy(u.pos).sub(P.eye);
    const side = new THREE.Vector3(-to.z, 0, to.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    if (Math.random() < 0.5) side.negate();
    u.drift = { t: 0, dur: rand(2, 4.5), f: rand(0.35, 0.8), amp: (rand(1.5, 3.5) + u.radius * 0.35) * scale, side, s: 0, yb: 0 };
    u.driftCool = rand(4, 10);
    this.mischief.sways++;
    if (Math.random() < 0.3) this._fx(u, Math.random() < 0.5 ? "laugh" : "beep");
  },

  // ---------- The calm after arriving ----------

  // A player in their calm (just landed, teleported or respawned): no ship
  // comes within GRACE_KEEP of them, whatever it is doing (unless that
  // player is fighting it, or it is a mission's).
  _graceKeep(u, dt) {
    if (!this._inGrace() || u.falling || u.missionTarget || u.errand || u.boss || u.captured || u.state === "leave" || (u.hostile && u.byPlayer)) return;
    const P = this._playerVehicle()?.pos ?? this.player.position;
    const out = _a.copy(u.pos).sub(P);
    const d = out.length();
    const keep = GRACE_KEEP + u.radius;
    if (d >= keep + 25) return;
    if (d < 1e-3) out.set(0, 1, 0);
    else out.divideScalar(d);
    const vin = u.vel.dot(out);
    // Near the edge: no closer. Inside: out again.
    const want = d < keep ? Math.min(u.S.top, 6 + (keep - d) * 0.8) : 0;
    if (vin < want) u.vel.addScaledVector(out, want - vin);
    if (u.prank) this._endPrank(u);
    void dt;
  },

  // ---------- Pranks ----------

  _canPrank(u, dist) {
    if (u.falling || u.decoy || u.hostile || u.missionTarget || u.errand || u.peaceful || u.boss || u.shield || u.immune || u.home || u.tether || u.captured || u.dash || u.foe) return false;
    if (u.state !== "roam" && u.state !== "trick") return false;
    if (u.state === "trick" && (u.trick === "abduct" || u.trick === "dive" || u.trick === "burrow" || u.trick === "land")) return false;
    if (this.player.dead || this._inGrace() || dist > 320 || u.age < 4) return false;
    const pv = this._playerVehicle();
    if (pv && (pv.type === "ufo" || pv.type === "jet" || (pv.vel?.length() ?? 0) > 45)) return false;
    return this._prankers < this._prankCap;
  },

  _randomPrank(u) {
    const pv = this._playerVehicle();
    const w = {};
    for (const k of PRANK_NAMES) {
      const P = PRANKS[k];
      if (!P.sizes.includes(u.S.idx)) continue;
      if (pv ? !P.vehicle : !P.foot) continue;
      w[k] = (P[u.personality] ?? 1) * (P.moods[u.mood] ?? 1);
    }
    let total = 0;
    for (const k in w) total += w[k];
    if (total <= 0) return false;
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return this._startPrank(u, k);
    }
    return false;
  },

  // The pranks there are (tests, the debug console): { name: weights }.
  prankKinds() {
    return PRANKS;
  },

  // Tests and the debug console: start a prank on a ship now (not in a
  // player's calm unless `force`). Returns whether it started.
  forcePrank(u, kind, force = false) {
    if (!u || u.falling || u.state === "gone" || u.net || !PRANKS[kind]) return false;
    if (!force && this._inGrace()) return false;
    this._pframe = (this._pframe | 0) + 1; // (where the player is now)
    if (u.prank) this._endPrank(u);
    if (u.state !== "roam" && u.state !== "trick" && u.state !== "prank") {
      if (u.state === "attack" || u.state === "react" || u.state === "beam") this.attackers = Math.max(0, this.attackers - 1);
      u.state = "roam";
    }
    u.hostile = false;
    u.hostileT = 0;
    return this._startPrank(u, kind);
  },

  _startPrank(u, kind) {
    const prev = u.state;
    this._dropTarget(u);
    if (u.beam) u.beam.set(false);
    u.trick = null;
    const pk = { kind, t: 0, dur: 15, phase: 0 };
    u.prank = pk;
    u.state = "prank";
    u.waypoint = null;
    const ok = this._prankInit(u, pk);
    if (!ok) {
      u.prank = null;
      u.state = prev === "prank" ? "roam" : prev;
      // (No animal about: a moo will do; nothing to snatch: a photobomb.)
      if (kind === "cowdrop") return this._startPrank(u, "moo");
      if (kind === "snatch") return this._startPrank(u, "photobomb");
      return false;
    }
    this.mischief.pranks[kind] = (this.mischief.pranks[kind] || 0) + 1;
    this._prankers++;
    this.onPrank?.(u, kind);
    return true;
  },

  _endPrank(u) {
    const pk = u.prank;
    if (!pk) return;
    u.prank = null;
    u.glare = 0;
    if (pk.cargo) this._dropCargo(u, pk);
    if (pk.item) this._dropItem(pk);
    if (pk.mob && pk.mob.beamedBy === u) pk.mob.beamedBy = null;
    if (u.beam) u.beam.set(false);
    if (u.state === "prank") {
      u.state = "roam";
      u.waypoint = null;
    }
    u.spinBoost = 1;
    if (pk.kind === "decoy" && u.state !== "gone" && !u.falling) this._popDecoy(u);
  },

  // Shot while up to something: flees laughing, or (by its mood) fights.
  // True if it fled (no hostility).
  _prankShot(u) {
    const pk = u.prank;
    if (!pk) return false;
    const gawkers = pk.kind === "gawk" || pk.kind === "signal";
    if (gawkers) {
      for (const o of this.ufos) if (o !== u && o.prank && (o.prank.kind === "gawk" || o.prank.kind === "signal") && o.prank.crowd === pk.crowd) this._flee(o, false);
    }
    const laugh = Math.random() < MOOD_LAUGH[u.mood] * (gawkers ? 1.2 : 1);
    this._endPrank(u);
    if (!laugh) return false;
    this._flee(u, true);
    return true;
  },

  // Off it goes, laughing: a dash away, and often off into the sky.
  _flee(u, leave) {
    if (u.prank) this._endPrank(u);
    this._fx(u, "laugh");
    this._blink(u, 160, 60);
    u.whimT = rand(40, 80);
    if (leave && Math.random() < 0.4 && !u.noLeave && !u.missionTarget) u.leaveSoonT = rand(0.8, 2.5);
    this.mischief.fled++;
  },

  _prankInit(u, pk) {
    const P = this._pinfo();
    const R = u.radius;
    switch (pk.kind) {
      case "photobomb":
        pk.dur = rand(10, 18);
        pk.d = 16 + R * 2.2;
        pk.h = rand(-1, 3);
        pk.slips = 0;
        pk.maxSlips = 2 + Math.floor(Math.random() * 4);
        pk.slipT = 0;
        pk.side = 1;
        return true;
      case "mimic":
        pk.dur = rand(10, 18);
        pk.p0 = P.pos.clone();
        pk.yaw0 = u.yaw;
        pk.pyaw0 = P.yaw;
        pk.anchor = P.pos.clone().addScaledVector(P.flat, 26 + R * 1.6);
        pk.anchor.y = Math.max(P.pos.y + rand(4, 10) + R * 0.4, this._groundAt(pk.anchor.x, pk.anchor.z) + u.info.bottom * R + 3);
        return true;
      case "halo":
        pk.dur = rand(8, 14);
        pk.a = Math.atan2(u.pos.z - P.pos.z, u.pos.x - P.pos.x);
        pk.w = rand(1.3, 2.4) * (Math.random() < 0.5 ? -1 : 1);
        pk.R = 7 + R * 1.3;
        pk.H = 6 + R * 0.9;
        pk.rev = 0;
        pk.beepT = rand(1, 3);
        return true;
      case "glare":
        pk.dur = rand(5, 9) + 4;
        pk.d = rand(30, 55) + R * 1.5;
        pk.side = rand(-0.25, 0.25);
        pk.fxT = 0;
        return true;
      case "peekaboo":
        pk.dur = rand(14, 24);
        pk.low = 1;
        this._peekSpot(u, pk, P);
        pk.hiding = true;
        pk.phaseT = rand(1.5, 3);
        pk.cycles = 0;
        return true;
      case "shadow":
        pk.dur = rand(20, 35);
        pk.D = rand(150, 175); // (a pistol reaches 160)
        pk.rel = rand(0.6, 2.6) * (Math.random() < 0.5 ? -1 : 1);
        pk.h = rand(18, 40) + R * 0.5;
        pk.face = P.yaw;
        pk.shiftT = 0;
        return true;
      case "buzz":
        pk.dur = 40;
        pk.passes = 2 + Math.floor(Math.random() * 3);
        pk.n = 0;
        this._planBuzz(u, pk, P);
        return true;
      case "squat":
        pk.dur = 60;
        pk.low = 0.3;
        return this._findPerch(u, pk, P);
      case "cowdrop": {
        pk.dur = 50;
        let best = null;
        let bd = 160;
        for (const m of this.mobs?.mobs ?? []) {
          if (m.dead || m.net || m.spec.hostile || m.spec.flies || m.kind === "villager" || m.beamedBy || m.abductedBy || m.isRemotePlayer) continue;
          if (m.pos.distanceTo(P.pos) > 140) continue;
          const d = m.pos.distanceTo(u.pos);
          if (d < bd) {
            best = m;
            bd = d;
          }
        }
        if (!best) return false;
        pk.mob = best;
        best.beamedBy = u;
        return true;
      }
      case "twins": {
        pk.dur = rand(9, 16);
        pk.dir = new THREE.Vector3(rand(-1, 1), rand(-0.1, 0.3), rand(-1, 1)).normalize();
        const n = 2 + (Math.random() < 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) this._spawnDecoy(u);
        this._fx(u, "sparkle");
        return true;
      }
      case "moo":
        pk.n = 3 + Math.floor(Math.random() * 4);
        pk.gap = rand(1.2, 2.4);
        pk.next = 2;
        pk.rel = Math.PI + rand(-0.7, 0.7);
        pk.d = rand(18, 30) + R;
        pk.h = rand(8, 16) + R * 0.5;
        pk.dur = pk.n * pk.gap * 1.4 + 8;
        return true;
      case "lure":
        pk.dur = 90;
        pk.lead = rand(24, 34) + R;
        this._lureDest(u, pk, P);
        pk.best = P.pos.distanceTo(pk.dest);
        pk.idleT = 0;
        pk.beepT = 3;
        return true;
      case "signal": {
        pk.dur = 30;
        pk.crowd = (this._crowdId = (this._crowdId | 0) + 1);
        pk.beaconT = 2.2;
        pk.fxT = 0;
        const a = P.yaw + Math.PI + rand(-1, 1);
        pk.spot = new THREE.Vector3(P.pos.x - Math.sin(a) * rand(85, 110), 0, P.pos.z - Math.cos(a) * rand(85, 110));
        pk.spot.y = Math.max(P.pos.y, this._groundAt(pk.spot.x, pk.spot.z)) + rand(40, 60) + R;
        // Who comes to look: up to three idle ships within 600.
        const list = this.ufos.filter((o) => o !== u && !o.falling && !o.decoy && !o.hostile && !o.net && !o.missionTarget && !o.errand && !o.home && !o.boss && (o.state === "roam" || o.state === "trick") && o.pos.distanceTo(u.pos) < 600);
        list.sort(() => Math.random() - 0.5);
        pk.callees = list.slice(0, 1 + Math.floor(Math.random() * 3));
        return true;
      }
      case "snatch": {
        // (Single player only: online every peer runs its own items' physics.)
        if (this.targets || !this.items) return false;
        let best = null;
        let bd = 30;
        const dim = this.world.dimCode ?? 0;
        for (const it of this.items.items) {
          if (it.keep || it.age < 1.5 || it.dim !== dim || it.snatchedBy) continue;
          const d = Math.hypot(it.pos.x - P.pos.x, it.pos.z - P.pos.z);
          if (d < bd) {
            bd = d;
            best = it;
          }
        }
        if (!best) return false;
        pk.item = best;
        best.snatchedBy = u.id;
        pk.dur = 40;
        return true;
      }
      case "gawk":
        pk.dur = rand(10, 18);
        pk.a = pk.a ?? P.yaw + Math.PI + rand(-1.2, 1.2);
        pk.R = rand(70, 100) + R;
        pk.h = rand(25, 50) + R * 0.5;
        return true;
      case "decoy":
        return true;
      default:
        return false;
    }
  },

  _prank(u, dt, tgt, dist) {
    const pk = u.prank;
    if (!pk) {
      u.state = "roam";
      u.waypoint = null;
      return;
    }
    pk.t += dt;
    if (pk.kind === "decoy") return this._prankDecoy(u, pk, dt);
    if (this.player.dead || this._inGrace()) return this._endPrank(u);
    const P = this._pinfo();
    const R = u.radius;
    const g = _c;
    switch (pk.kind) {
      case "photobomb": {
        g.copy(P.eye).addScaledVector(P.flat, pk.d);
        g.y += pk.h + R * 0.3;
        if (pk.slipT > 0) {
          pk.slipT -= dt;
          g.addScaledVector(P.side, pk.side * (R * 2.5 + 14));
          g.y += R * 0.5 + 4;
        } else if (u.aimT > 0.25 && u.pos.distanceTo(g) < pk.d * 0.8) {
          pk.slipT = rand(1.2, 2.6);
          pk.side = Math.random() < 0.5 ? -1 : 1;
          pk.slips++;
          this._fx(u, Math.random() < 0.6 ? "laugh" : "beep");
          if (pk.slips >= pk.maxSlips) pk.dur = Math.min(pk.dur, pk.t + pk.slipT);
        }
        g.y = Math.max(g.y, this._minAltitude(u, 2));
        this._steer(u, g, u.S.top * (pk.slipT > 0 ? 0.9 : 0.55), dt, pk.slipT > 0 ? 6 : 3);
        break;
      }
      case "mimic": {
        g.copy(pk.anchor);
        g.x += P.pos.x - pk.p0.x;
        g.z += P.pos.z - pk.p0.z;
        g.y += (P.pos.y - pk.p0.y) * 1.6;
        g.y = Math.max(g.y, this._minAltitude(u, 2));
        this._steer(u, g, u.S.top * 0.9, dt, 7);
        u.spinBoost = 0;
        // (Turns as the player turns.)
        const want = pk.yaw0 + (P.yaw - pk.pyaw0);
        u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * Math.min(1, dt * 6);
        if (pk.t > pk.dur - 0.05 && !pk.laughed) {
          pk.laughed = true;
          this._fx(u, "laugh");
        }
        break;
      }
      case "halo": {
        pk.rev -= dt;
        if (u.aimT > 0.3 && pk.rev <= 0) {
          pk.w *= -1.3;
          pk.w = THREE.MathUtils.clamp(pk.w, -3.6, 3.6);
          pk.rev = 1.2;
          this._fx(u, "beep");
        }
        pk.a += pk.w * dt;
        g.set(P.pos.x + Math.cos(pk.a) * pk.R, P.pos.y + pk.H + Math.sin(pk.t * 3) + u.info.bottom * R, P.pos.z + Math.sin(pk.a) * pk.R);
        g.y = Math.max(g.y, this._minAltitude(u, 2));
        this._steer(u, g, u.S.top, dt, 6);
        if ((pk.beepT -= dt) <= 0) {
          pk.beepT = rand(1.5, 3.5);
          this._fx(u, "beep");
        }
        break;
      }
      case "glare": {
        const fwd = _d.copy(P.flat);
        fwd.applyAxisAngle(_up, pk.side);
        g.copy(P.eye).addScaledVector(fwd, pk.d);
        g.y += pk.d * 0.3;
        g.y = Math.max(g.y, this._minAltitude(u, 4));
        this._steer(u, g, u.S.top * 0.7, dt, 2.5);
        // Glaring once in place (and for a few seconds).
        u.glare = u.pos.distanceTo(g) < pk.d * 0.5 && pk.t < pk.dur - 0.5 ? 1 : 0;
        if (u.glare) this._glareFx(u, dt);
        break;
      }
      case "peekaboo": {
        pk.phaseT -= dt;
        if (!pk.hiding && u.aimT > 0.15) {
          pk.hiding = true;
          pk.phaseT = rand(2, 4);
          if (Math.random() < 0.4) this._fx(u, "laugh");
        } else if (pk.phaseT <= 0) {
          pk.hiding = !pk.hiding;
          pk.phaseT = pk.hiding ? rand(2, 4) : rand(1, 2.2);
          if (pk.hiding && ++pk.cycles % 2 === 0) this._peekSpot(u, pk, P);
          if (!pk.hiding && Math.random() < 0.35) this._fx(u, "beep");
        }
        g.set(pk.spot.x, pk.hiding ? pk.hideY : pk.peekY, pk.spot.z);
        this._steer(u, g, u.S.top * 0.6, dt, 4);
        u.spinBoost = pk.hiding ? 0.5 : 2.5;
        break;
      }
      case "shadow": {
        pk.face += Math.atan2(Math.sin(P.yaw - pk.face), Math.cos(P.yaw - pk.face)) * Math.min(1, dt * 0.4);
        pk.shiftT -= dt;
        if (u.aimT > 0.5 && pk.shiftT <= 0) {
          pk.rel += (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.7);
          pk.shiftT = 2;
          if (Math.random() < 0.3) this._fx(u, "beep");
        }
        const a = pk.face + pk.rel;
        g.set(P.pos.x - Math.sin(a) * pk.D, P.pos.y + pk.h, P.pos.z - Math.cos(a) * pk.D);
        g.y = Math.max(g.y, this._minAltitude(u, 8));
        this._steer(u, g, u.S.top * 0.7, dt, 2);
        break;
      }
      case "buzz": {
        const d = this._steer(u, pk.goal, u.S.top * 1.15, dt, 4);
        if (!pk.passed && u.pos.distanceTo(pk.C) < 12 + R) {
          pk.passed = true;
          if (this.audio?.playUfoDash) this.audio.playUfoDash(u.pos.distanceTo(this._ears()) * 0.5);
          this.mischief.buzzes++;
        }
        if (d < 15 || pk.legT > 9) {
          if (++pk.n >= pk.passes) {
            pk.dur = 0;
            if (Math.random() < 0.5) this._fx(u, "laugh");
          } else this._planBuzz(u, pk, P);
        }
        pk.legT += dt;
        break;
      }
      case "squat":
        this._prankSquat(u, pk, P, dt);
        break;
      case "cowdrop":
        this._prankCowdrop(u, pk, P, dt);
        break;
      case "twins": {
        u.vel.lerp(_d.copy(pk.dir).multiplyScalar(u.S.cruise * 1.2), Math.min(1, dt * 2));
        break;
      }
      case "moo": {
        if (u.aimT > 0.4 && !pk.spotted) {
          pk.spotted = true;
          pk.rel += Math.PI;
          if (Math.random() < 0.3) this._fx(u, "laugh");
        }
        if (u.aimT <= 0) pk.spotted = false;
        const a = P.yaw + pk.rel;
        g.set(P.pos.x - Math.sin(a) * pk.d, P.pos.y + pk.h, P.pos.z - Math.cos(a) * pk.d);
        g.y = Math.max(g.y, this._minAltitude(u, 4));
        this._steer(u, g, u.S.top * 0.6, dt, 2.5);
        if ((pk.next -= dt) <= 0 && pk.n > 0) {
          pk.n--;
          pk.next = pk.gap * rand(0.7, 1.3);
          this._fx(u, "moo");
          this.mischief.moos++;
          if (pk.n === 0) {
            pk.dur = Math.min(pk.dur, pk.t + 2);
            if (Math.random() < 0.6) this._fx(u, "laugh");
          }
        }
        break;
      }
      case "lure":
        this._prankLure(u, pk, P, dt);
        break;
      case "snatch":
        this._prankSnatch(u, pk, P, dt);
        break;
      case "signal": {
        this._ringSteer(u, pk.spot, P.pos, 75 + R, u.S.top * 0.6, dt, 2);
        if (u.pos.distanceTo(pk.spot) < 30 + R) {
          pk.beaconT -= dt;
          this._beaconFx(u, dt);
          if (pk.beaconT <= 0) {
            // The others come to look; it joins them.
            const a0 = P.yaw + Math.PI;
            let k = 0;
            for (const o of pk.callees) {
              if (o.falling || o.state === "gone" || o.hostile || o.prank) continue;
              if (o.state !== "roam" && o.state !== "trick") continue;
              this._dropTarget(o);
              const opk = { kind: "gawk", t: 0, dur: 15, phase: 0, crowd: pk.crowd, a: a0 + (k++ - 1) * 0.7 + rand(-0.2, 0.2) };
              o.prank = opk;
              o.state = "prank";
              o.trick = null;
              this._prankInit(o, opk);
              this.mischief.pranks.gawk = (this.mischief.pranks.gawk || 0) + 1;
            }
            this.mischief.signals++;
            pk.kind = "gawk";
            pk.t = 0;
            pk.a = Math.atan2(-(u.pos.x - P.pos.x), -(u.pos.z - P.pos.z));
            this._prankInit(u, pk);
            u.glare = 0;
          }
        } else if (pk.t > 20) pk.dur = 0;
        break;
      }
      case "gawk": {
        const a = pk.a;
        g.set(P.pos.x - Math.sin(a) * pk.R, P.pos.y + pk.h, P.pos.z - Math.cos(a) * pk.R);
        g.y = Math.max(g.y, this._minAltitude(u, 8));
        this._ringSteer(u, g, P.pos, pk.R * 0.9, u.S.top * 0.6, dt, 1.6);
        u.spinBoost = 0.2;
        break;
      }
      default:
        break;
    }
    if (u.prank === pk && pk.t > pk.dur) {
      const kind = pk.kind;
      this._endPrank(u);
      // (Done: off to roam far from here, now and then with a dash.)
      if ((kind === "photobomb" || kind === "halo" || kind === "cowdrop" || kind === "squat") && Math.random() < 0.6) this._blink(u, 160, 70);
      u.whimT = rand(20, 60);
    }
    void tgt;
    void dist;
  },

  // ---------- Prank helpers ----------

  // Steers to `goal` the long way round `center` (never closer than about
  // `R` to it): a ship coming to look from the far side goes round, not over.
  _ringSteer(u, goal, center, R, speed, dt, accel) {
    const ux = u.pos.x - center.x;
    const uz = u.pos.z - center.z;
    const du = Math.hypot(ux, uz);
    const ga = Math.atan2(goal.z - center.z, goal.x - center.x);
    const w = _d.copy(goal);
    if (du < R * 0.85) {
      // Inside: out first.
      const k = R / Math.max(du, 1e-3);
      w.set(center.x + (du < 1e-3 ? R : ux * k), goal.y, center.z + (du < 1e-3 ? 0 : uz * k));
    } else {
      const ua = Math.atan2(uz, ux);
      const diff = Math.atan2(Math.sin(ga - ua), Math.cos(ga - ua));
      if (Math.abs(diff) > 0.7) {
        const a = ua + Math.sign(diff) * 0.6;
        const rr = Math.max(du, R);
        w.set(center.x + Math.cos(a) * rr, goal.y, center.z + Math.sin(a) * rr);
      }
    }
    return this._steer(u, w, speed, dt, accel);
  },

  // Peekaboo: a spot behind a rise in the ground if there is one (it hides
  // under the line of sight and peeks over the top), else low over the ground.
  _peekSpot(u, pk, P) {
    const R = u.radius;
    const bottom = u.info.bottom * R;
    let best = null;
    for (let k = 0; k < 10; k++) {
      const a = P.yaw + rand(-1.1, 1.1);
      const d = rand(45, 90);
      const x = P.pos.x - Math.sin(a) * d;
      const z = P.pos.z - Math.cos(a) * d;
      const ground = this._groundAt(x, z);
      let ridge = -Infinity;
      for (let i = 3; i <= 9; i++) {
        const t = i / 10;
        ridge = Math.max(ridge, this._groundAt(P.pos.x + (x - P.pos.x) * t, P.pos.z + (z - P.pos.z) * t));
      }
      const score = ridge - ground;
      if (!best || score > best.score) best = { x, z, ground, ridge, score };
    }
    pk.spot = new THREE.Vector3(best.x, 0, best.z);
    pk.hideY = best.ground + bottom + 1.2;
    pk.peekY = best.score > 3 ? Math.max(best.ridge + bottom + R * 0.3 + 1.5, pk.hideY + 3) : pk.hideY + R * 1.2 + 5;
  },

  // Buzz: the next pass, past the target's side, low and fast, and on.
  _planBuzz(u, pk, P) {
    const T = P.veh ? P.veh.pos : P.eye;
    const a = _a.set(T.x - u.pos.x, 0, T.z - u.pos.z);
    if (a.lengthSq() < 1) a.set(1, 0, 0);
    a.normalize();
    const lat = _b.set(-a.z, 0, a.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    const vr = P.veh ? (P.veh.hitRadius ?? P.veh.radius ?? 3) : 0.5;
    const miss = vr + u.radius + rand(3.5, 7);
    pk.C = T.clone().addScaledVector(lat, miss);
    pk.C.y = Math.max(T.y + rand(1, 5) + u.radius * 0.3, this._groundAt(pk.C.x, pk.C.z) + u.info.bottom * u.radius + 3);
    pk.goal = pk.C.clone().addScaledVector(a, rand(70, 100));
    pk.goal.y = Math.max(pk.goal.y + rand(0, 15), this._groundAt(pk.goal.x, pk.goal.z) + u.info.bottom * u.radius + 6);
    pk.passed = false;
    pk.legT = 0;
  },

  // Squat: a vehicle near the player (or the player's own, standing still),
  // else a roof (or a treetop) near them, else the ground a little way off.
  _findPerch(u, pk, P) {
    if (u.radius > 9) return false;
    const R = u.radius;
    let best = null;
    let bd = 140;
    for (const v of this.vehicles?.vehicles ?? []) {
      if (!v.alive || v.puppet) continue;
      const own = v === P.veh;
      if (own && (u.radius > 4.6 || v.vel?.length() > 2)) continue;
      if (!own && v.netOcc) continue;
      if (v.pos.y - this._groundAt(v.pos.x, v.pos.z) > 8) continue; // (flying)
      const d = v.pos.distanceTo(P.pos);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best && best.raycast) {
      const top = _a.set(best.pos.x, best.pos.y + 60, best.pos.z);
      const t = best.raycast(top, _b.set(0, -1, 0), 80);
      const y = t !== null && t !== undefined ? top.y - t : best.pos.y + (best.hitRadius ?? best.radius ?? 2);
      pk.perch = best;
      pk.perchDy = y - best.pos.y;
      pk.spot = new THREE.Vector3(best.pos.x, y + u.info.bottom * R + 0.15, best.pos.z);
      pk.sitT = rand(10, 20);
      return true;
    }
    // A roof (anything built or grown well above the ground's natural height).
    let roof = null;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(R + 4, 26);
      const x = Math.floor(P.pos.x + Math.cos(a) * d);
      const z = Math.floor(P.pos.z + Math.sin(a) * d);
      if (!this.world.getChunk(x >> 4, z >> 4)) continue;
      const s = this.world.surfaceY(x, z);
      const nat = this.world.heightAt(x, z);
      if (s >= 0 && s - nat >= 3 && (!roof || s > roof.y)) roof = { x: x + 0.5, y: s + 1, z: z + 0.5 };
    }
    if (!roof) {
      const a = P.yaw + rand(-0.8, 0.8);
      const d = rand(16, 26) + R;
      const x = P.pos.x - Math.sin(a) * d;
      const z = P.pos.z - Math.cos(a) * d;
      roof = { x, y: this._groundAt(x, z), z };
    }
    pk.spot = new THREE.Vector3(roof.x, roof.y + u.info.bottom * R + 0.15, roof.z);
    pk.sitT = rand(10, 20);
    return true;
  },

  _prankSquat(u, pk, P, dt) {
    const v = pk.perch;
    if (v) {
      if (!v.alive || (v.vel && v.vel.length() > 8)) {
        pk.dur = 0;
        this._fx(u, "laugh");
        return;
      }
      pk.spot.set(v.pos.x, v.pos.y + pk.perchDy + u.info.bottom * u.radius + 0.15, v.pos.z);
    }
    const above = _d.copy(pk.spot);
    if (pk.phase === 0) {
      above.y += u.radius + 6;
      if (this._steer(u, above, u.S.cruise * 1.8, dt, 2.5) < 3) pk.phase = 1;
    } else if (pk.phase === 1) {
      if (this._steer(u, pk.spot, 3, dt, 3) < 0.35) {
        pk.phase = 2;
        this.mischief.squats++;
      }
    } else {
      // Sitting: still (riding along on a slow vehicle), turning lazily.
      u.vel.set(0, 0, 0);
      u.pos.lerp(pk.spot, Math.min(1, dt * 6));
      u.spinBoost = 0.3;
      pk.sitT -= dt;
      const near = Math.hypot(P.pos.x - u.pos.x, P.pos.z - u.pos.z) < u.radius + 4 && !P.veh;
      if (pk.sitT <= 0 || u.aimT > 0.7 || near) {
        pk.dur = 0;
        if (u.aimT > 0.7 || near) this._fx(u, "laugh");
        u.vel.set(0, u.S.cruise * 2, 0);
      }
    }
  },

  _prankCowdrop(u, pk, P, dt) {
    const R = u.radius;
    if (pk.phase === 0) {
      const m = pk.mob;
      const aboard = m && !this.mobs.mobs.includes(m);
      if (aboard && pk.beamed) {
        // Taken aboard: it is the cargo now.
        pk.cargo = { kind: m.kind, variant: m.variant | 0, baby: !!m.spec?.baby };
        pk.mob = null;
        pk.phase = 1;
        pk.beam = false;
        if (u.beam) u.beam.set(false);
        return;
      }
      if (!m || m.dead || aboard || pk.t > 22) {
        pk.dur = 0;
        return;
      }
      m.beamedBy = u;
      pk.beam = true;
      const hover = u.info.bottom * R + 9 + R * 0.4;
      // (Once it has the animal in the beam it holds its height: the animal comes up to it.)
      const goal = _d.set(m.pos.x, pk.holdY ?? m.pos.y + hover, m.pos.z);
      const d = this._steer(u, goal, u.S.cruise * 1.8, dt, 3);
      const beam = this._getBeam(u);
      const top = _a.set(u.pos.x, u.pos.y - u.info.bottom * R, u.pos.z);
      beam.set(d < 4, top, this._groundAt(u.pos.x, u.pos.z), 2.5 + R * 0.25);
      if (beam.on && beam.strength > 0.5) {
        pk.beamed = true;
        pk.holdY ??= u.pos.y;
        this.mobs.beamLift(beam, 4, top.y - 0.3, u);
      }
    } else if (pk.phase === 1) {
      // Over to the player, low, and let it go beside them.
      const goal = _d.copy(P.pos).addScaledVector(P.flat, 2.5);
      goal.y = Math.max(P.pos.y + 9 + u.info.bottom * R, this._groundAt(goal.x, goal.z) + u.info.bottom * R + 6);
      const d = this._steer(u, goal, u.S.top * 0.7, dt, 3);
      if (d < 3 || pk.t > 40) {
        this._dropCargo(u, pk);
        pk.phase = 2;
        pk.dur = Math.min(pk.dur, pk.t + 1.2);
        this._fx(u, pk.dropped === "cow" || pk.dropped === "mooshroom" ? "moo" : "laugh");
        if (this.player === this.localPlayer && pk.dropped) this.onMessage?.(`A UFO dropped a ${pk.dropped.replace(/_/g, " ")} on you!`);
      }
    } else {
      u.vel.y += 20 * dt;
    }
  },

  // The animal it carries, let go under it (a prank cut short drops it where it is).
  _dropCargo(u, pk) {
    const c = pk.cargo;
    if (!c) return;
    pk.cargo = null;
    const x = u.pos.x + rand(-1, 1);
    const z = u.pos.z + rand(-1, 1);
    const y = u.pos.y - u.info.bottom * u.radius - 2.5;
    let m = this.mobs?.spawn(c.kind, x, y, z, { variant: c.variant, baby: c.baby });
    if (!m) m = this.mobs?.spawn(c.kind, x, y + 3, z, { variant: c.variant, baby: c.baby });
    this.mischief.lastDrop = { kind: c.kind, at: [Math.round(x), Math.round(y), Math.round(z)], ok: !!m };
    if (m) {
      m.vel?.set(0, -2, 0);
      pk.dropped = c.kind;
      this.mischief.drops++;
    }
    const top = _a.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
    for (let i = 0; i < 10; i++) this.effects.glow.spawn({ x: top.x, y: top.y - 1, z: top.z, vx: rand(-2, 2), vy: rand(-4, -1), vz: rand(-2, 2), life: 0.5, size0: 0.4, size1: 0.05, color0: SPARKLE, drag: 2 });
  },

  // Snatch: over the item, up it comes in the beam, carried off a little way
  // and dropped (it can be picked up again; shot, the ship lets go of it).
  _prankSnatch(u, pk, P, dt) {
    const it = pk.item;
    const R = u.radius;
    if (pk.phase < 3 && (!it || !this.items.items.includes(it))) {
      pk.item = null; // (picked up: the player was quicker)
      pk.dur = 0;
      return;
    }
    const under = _a.set(u.pos.x, u.pos.y - u.info.bottom * R - 0.6, u.pos.z);
    if (pk.phase === 0) {
      const goal = _d.set(it.pos.x, Math.max(it.pos.y + 8 + u.info.bottom * R, this._minAltitude(u, 3)), it.pos.z);
      const d = this._steer(u, goal, u.S.cruise * 1.8, dt, 3);
      pk.beam = true;
      const beam = this._getBeam(u);
      beam.set(d < 3, _b.set(u.pos.x, u.pos.y - u.info.bottom * R, u.pos.z), this._groundAt(u.pos.x, u.pos.z), 1.4 + R * 0.12);
      if (beam.on && beam.strength > 0.5) pk.phase = 1;
      if (pk.t > 20) pk.dur = 0;
    } else if (pk.phase === 1) {
      // Up it floats.
      u.vel.multiplyScalar(Math.exp(-4 * dt));
      it.pickupDelay = 99;
      it.vel.set(0, 0, 0);
      it.pos.lerp(under, Math.min(1, dt * 1.6));
      if (it.pos.distanceTo(under) < 1) {
        pk.phase = 2;
        pk.beam = false;
        if (u.beam) u.beam.set(false);
        const away = _b.set(u.pos.x - P.pos.x, 0, u.pos.z - P.pos.z);
        if (away.lengthSq() < 1) away.set(1, 0, 0);
        away.normalize().applyAxisAngle(_up, rand(-0.8, 0.8));
        const d = rand(25, 45);
        pk.dest = new THREE.Vector3(P.pos.x + away.x * d, 0, P.pos.z + away.z * d);
        this._fx(u, "laugh");
      }
    } else if (pk.phase === 2) {
      // Carried off, hanging under the ship.
      const goal = _d.set(pk.dest.x, this._groundAt(pk.dest.x, pk.dest.z) + 8 + u.info.bottom * R, pk.dest.z);
      const d = this._steer(u, goal, u.S.cruise * 1.4, dt, 2.5);
      it.pickupDelay = 99;
      it.vel.set(0, 0, 0);
      it.pos.copy(under);
      if (d < 4 || pk.t > 35) {
        this._dropItem(pk);
        pk.phase = 3;
        pk.dur = Math.min(pk.dur, pk.t + 1.5);
        this.mischief.snatched++;
        if (Math.random() < 0.5) this._fx(u, "beep");
      }
    }
  },

  // Lets go of a snatched item (it falls, and can be picked up again).
  _dropItem(pk) {
    const it = pk.item;
    pk.item = null;
    if (!it) return;
    it.snatchedBy = 0;
    it.vel.set(0, -1, 0);
    it.pickupDelay = Math.min(it.pickupDelay, 0.5);
  },

  // Lure: somewhere to lead the player: an intact wreck, a vehicle nobody
  // sits in, or just a spot far off.
  _lureDest(u, pk, P) {
    let best = null;
    let bd = 450;
    for (const v of this.vehicles?.vehicles ?? []) {
      if (!v.alive || v === P.veh || v.netOcc || v.puppet || v.pos.y - this._groundAt(v.pos.x, v.pos.z) > 8) continue;
      const d = v.pos.distanceTo(P.pos);
      const score = d - (v.type === "ufo" && v.crashed && !v.wreck ? 150 : 0);
      if (d > 40 && score < bd) {
        bd = score;
        best = v;
      }
    }
    if (best) pk.dest = best.pos.clone();
    else {
      const a = Math.random() * Math.PI * 2;
      const d = rand(180, 300);
      pk.dest = new THREE.Vector3(P.pos.x + Math.cos(a) * d, 0, P.pos.z + Math.sin(a) * d);
      pk.dest.y = this._groundAt(pk.dest.x, pk.dest.z);
    }
  },

  _prankLure(u, pk, P, dt) {
    const toDest = _a.copy(pk.dest).sub(P.pos);
    toDest.y = 0;
    const left = toDest.length();
    const g = _d;
    if (left < 30 || pk.phase === 1) {
      // There: over it, a light show, and off.
      if (pk.phase === 0) {
        pk.phase = 1;
        pk.showT = 3;
        this.mischief.lured++;
      }
      g.copy(pk.dest);
      g.y = Math.max(pk.dest.y, this._groundAt(g.x, g.z)) + 10 + u.radius;
      this._steer(u, g, u.S.cruise * 1.5, dt, 2);
      this._beaconFx(u, dt);
      if ((pk.showT -= dt) <= 0) {
        pk.dur = 0;
        this._fx(u, "beep");
      }
      return;
    }
    toDest.divideScalar(left || 1);
    g.copy(P.pos).addScaledVector(toDest, Math.min(pk.lead, left));
    g.y = Math.max(P.pos.y + 6 + u.radius * 0.5 + Math.sin(pk.t * 2.5) * (pk.idleT > 2 ? 2 : 0.4), this._minAltitude(u, 4));
    this._steer(u, g, u.S.top * 0.6, dt, 2.5);
    // Following? (Getting nearer the place.) Dawdling: it beeps; given up on: off.
    if (left < pk.best - 2) {
      pk.best = left;
      pk.idleT = 0;
    } else pk.idleT += dt;
    if (pk.idleT > 2 && (pk.beepT -= dt) <= 0) {
      pk.beepT = rand(2.5, 4);
      this._fx(u, "beep");
    }
    if (pk.idleT > 25) pk.dur = 0;
  },

  // ---------- Decoys (the twins) ----------

  _spawnDecoy(u) {
    const d = this.spawn({ spec: u.spec, size: u.size, radius: u.radius, pos: u.pos.clone(), style: u.style, personality: u.personality, crewKind: u.crewKind });
    d.decoy = true;
    d.decoyOf = u.id;
    d.maxHealth = d.health = 1;
    d.temper = 0;
    d.dodgeSkill = 0;
    d.blinkT = 1e9;
    d.noLeave = true;
    d.spawnFade = 0;
    d.age = 9;
    d.yaw = u.yaw;
    d.mood = u.mood;
    const pk = { kind: "decoy", t: 0, dur: rand(9, 16), phase: 0, dir: new THREE.Vector3(rand(-1, 1), rand(-0.1, 0.35), rand(-1, 1)).normalize() };
    d.prank = pk;
    d.state = "prank";
    d.vel.copy(pk.dir).multiplyScalar(u.S.cruise);
    this.mischief.decoys++;
    return d;
  },

  _prankDecoy(u, pk, dt) {
    const w = Math.sin(pk.t * 1.7 + u.id) * 0.4;
    _d.copy(pk.dir).applyAxisAngle(_up, w).multiplyScalar(u.S.cruise * 1.2);
    u.vel.lerp(_d, Math.min(1, dt * 2));
    if (pk.t > pk.dur) this._popDecoy(u);
  },

  // A hologram popped (shot, or its time up): a sparkle, and gone.
  _popDecoy(u) {
    if (u.state === "gone") return;
    u.prank = null;
    u.state = "gone";
    this.mischief.pops++;
  },

  // ---------- Light and sound ----------

  // A laugh, a moo, a beep, a beacon, a sparkle: played (and shown) here,
  // and flagged for the guests (fxFlags, _puppetFx).
  _fx(u, name) {
    const code = FX[name] || 0;
    if (!code) return;
    u.fxCode = code;
    u.fxSeq ^= 1;
    this.mischief.fx[name] = (this.mischief.fx[name] || 0) + 1;
    this._playFx(u, code);
  },

  _playFx(u, code) {
    const d = u.pos.distanceTo(this._ears());
    const name = FX_NAME[code];
    if (name === "sparkle") this._sparkle(u);
    else if (name === "beacon") this._beaconFx(u, 0.1);
    else if (this.audio?.playUfoTaunt) this.audio.playUfoTaunt(name, d);
  },

  _sparkle(u) {
    const fx = this.effects;
    const n = Math.max(6, Math.round(18 * (fx.quality ?? 1)));
    for (let i = 0; i < n; i++) fx.glow.spawn({ x: u.pos.x + rand(-1, 1) * u.radius, y: u.pos.y + rand(-0.4, 0.4) * u.radius, z: u.pos.z + rand(-1, 1) * u.radius, vx: rand(-3, 3), vy: rand(-1, 4), vz: rand(-3, 3), life: rand(0.3, 0.7), size0: 0.5 + u.radius * 0.05, size1: 0.05, color0: SPARKLE, drag: 2 });
    fx.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, life: 0.25, size0: u.radius * 2, size1: u.radius * 0.4, color0: SPARKLE, alpha: 0.7 });
  },

  // Pulsing, blinding light from the ship (smooth pulses, not a strobe).
  _glareFx(u, dt) {
    u.glareT = (u.glareT || 0) - dt;
    if (u.glareT > 0) return;
    u.glareT = 0.06;
    if (u.pos.distanceTo(this._ears()) > 600) return;
    const k = 0.55 + 0.45 * Math.sin(this.time * Math.PI * 2 * 1.6);
    this.effects.glow.spawn({ x: u.pos.x, y: u.pos.y - u.info.bottom * u.radius * 0.5, z: u.pos.z, life: 0.1, size0: u.radius * (2 + 2.5 * k), size1: u.radius * 2, color0: WHITE, alpha: 0.6 + 0.4 * k });
  },

  // A beacon: light rising from the ship.
  _beaconFx(u, dt) {
    u.beaconFxT = (u.beaconFxT || 0) - dt;
    if (u.beaconFxT > 0) return;
    u.beaconFxT = 0.08;
    if (u.pos.distanceTo(this._ears()) > 900) return;
    this.effects.glow.spawn({ x: u.pos.x, y: u.pos.y + u.radius * 0.3, z: u.pos.z, vx: 0, vy: 40, vz: 0, life: 1.2, size0: 1.2 + u.radius * 0.1, size1: 0.4, color0: BEACON, alpha: 0.9, drag: 0.2 });
  },

  // ---------- Online ----------

  // The flag bits a guest needs to draw a ship's whims (net/entities.js
  // _ufoState): glaring (256), the last sound/light event (512 * code, 3
  // bits) with a toggle (4096) so a repeat is seen, a hologram (8192).
  fxFlags(u) {
    return (u.glare ? 256 : 0) | ((u.fxCode & 7) << 9) | (u.fxSeq ? 4096 : 0) | (u.decoy ? 8192 : 0) | (u.prank?.kind === "lure" && u.prank.phase === 1 ? 16384 : 0) | (u.prank?.kind === "signal" && u.prank.beaconT < 2.2 ? 16384 : 0);
  },

  // A guest's puppet: plays the host's ship's events, glare and beacon.
  _puppetFx(u, dt) {
    const f = u.netF | 0;
    u.decoy = !!(f & 8192);
    const code = (f >> 9) & 7;
    const seq = (f >> 12) & 1;
    if (u._fxSeen === undefined) u._fxSeen = code * 2 + seq; // (an old event, from before this guest saw the ship)
    else if (code * 2 + seq !== u._fxSeen) {
      u._fxSeen = code * 2 + seq;
      if (code) this._playFx(u, code);
    }
    if (f & 256) this._glareFx(u, dt);
    if (f & 16384) this._beaconFx(u, dt);
  },
};
