// The mission director (Survival): sets up what the current mission needs
// in the world, keeps it available (a scout to shoot, a crate to open, a
// squad, a raid, a mothership, an enemy base...), tracks the objectives the
// stat counters can't see by themselves (surviving a night, raiders, the
// nuked base), and points the HUD's marker at the current target.
//
// Mission data (titles, objectives, rewards, the sky's rules) is in
// progression.js; this module is the game side of it.
import * as THREE from "three";
import { SEA_LEVEL } from "./constants.js";
import { itemInfo } from "./items.js";
import { BLOCK, IS_LEAVES, IS_LOG } from "./blocks.js";


const _v = new THREE.Vector3();
const STYLE_COLOR = { sweep: "red", heavy: "orange", charged: "white", seeker: "lime" }; // (the bolt colours of the boss's styles: see STYLES in ufos.js)
const NEAR = [[2, 0], [-2, 0], [0, 2], [0, -2]];
const CALM_TIME = 35; // seconds a landed crew looks around before it attacks

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function n_note(active, toDawn, toDusk, wave, waves) {
  return active ? `Dawn in about ${Math.max(1, Math.ceil(toDawn / 60))} min (landing ${Math.min(wave, waves)}/${waves})` : `Night falls in about ${Math.ceil(toDusk / 60)} min`;
}

export class MissionDirector {
  constructor(game) {
    // game: { progress, stats, ufos, mobs, crates, vehicles, enemyJets, airports, terrain, player, sky, toast }
    Object.assign(this, game);
    this.enabled = false;
    this.target = null; // { pos: Vector3, label } for the HUD marker, or null
    this.state = {}; // per-mission working state (reset when a mission starts)
    this.missionId = null;
    this.night = { active: false, clean: false, deathsAt: 0 };
    this.checkT = 0;
    this.bossInfo = null; // the boss bar: { name, health, shield, pylons, downT, final } while the Overlord fight is on
    this.base = null; // Operation Sunburn: the enemy-held airport { x, z, y, site }
    // Online (host; see js/net/coop.js): every player in the game (the
    // missions' targets, star fragments, landings count for anyone), the
    // jets the players fly, and the night's "deaths" (a whole team down).
    this.players = null; // () => [player-like]
    this.pilotJets = null; // () => [jet]
    this.nightDeaths = null; // () => number
  }

  // Is anyone (online: any player) alive and in the game?
  get anyAlive() {
    return this.players ? this.players().some((p) => !p.dead) : !this.player.dead;
  }

  // ---------- The group (Round 8) ----------
  // Online the missions are the whole group's: their goals grow with it
  // (progress.goalFor), and the director sets out enough for everyone (a
  // skeleton, a crate, a share of the squad for each player), near each of
  // them. Goals are worked out afresh all the time, so a player joining or
  // leaving mid-mission never leaves it impossible: more is set out when the
  // goal grows, and a mission whose goal drops to what is done completes.

  get groupN() {
    return Math.max(1, this.progress.groupN || 1);
  }

  // Everyone in the game who is alive (this player alone offline).
  _people() {
    const list = this.players ? this.players().filter((p) => !p.dead) : [];
    return list.length ? list : [this.player];
  }

  // Someone to set the next thing out near: a random player.
  _anyone() {
    const list = this._people();
    return list[Math.floor(Math.random() * list.length)];
  }

  // How much of objective i is still to do.
  _remaining(i = 0) {
    const o = this.progress.objectives(this.stats.world)[i];
    return o ? Math.max(0, o.goal - o.value) : 0;
  }

  // The nearest of `list` (things with .pos) to this player.
  _nearestOf(list) {
    const p = this.player.position;
    let best = null;
    let bd = Infinity;
    for (const o of list) {
      const d = o.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  get mission() {
    return this.progress.mission;
  }

  // Called every frame (cheap: the checks run a few times a second).
  update(dt) {
    const m = this.enabled ? this.mission : null;
    this.ufos.rules = this.enabled ? this.progress.rules : null;
    this.mobs.alienDamageScale = this.enabled ? this.progress.rules.damage : 1;
    this._trackNight();
    if (!m) {
      this.target = null;
      this.bossInfo = null;
      return;
    }
    if (m.event !== "boss") this.bossInfo = null;
    if (m.id !== this.missionId) {
      this.missionId = m.id;
      this._cleanup();
      this.state = { t: 0 };
    }
    const st = this.state;
    st.t += dt;
    if (m.event === "night") this._nightClock(dt);
    // (Effects that must run every frame.)
    if (m.event === "meteors") this._fxMeteors(dt);
    if (m.event === "boss") this._fxBoss(dt);
    this.checkT -= dt;
    if (this.checkT > 0) {
      this._refreshTarget();
      return;
    }
    this.checkT = 0.5;
    if (!this.anyAlive) return;
    // (In Survival the mission chain decides how many UFOs there are: the UFO
    // activity setting is Creative's, so there is no "Off" to check here.)
    switch (m.event) {
      case "skeleton":
        this._skeleton();
        break;
      case "landing":
        this._landing();
        break;
      case "scout":
        this._scout();
        break;
      case "crew":
        this._crew();
        break;
      case "crate":
        this._crate();
        break;
      case "night":
        this._night();
        break;
      case "intact":
        this.ufos.forceIntact = true;
        this._intact();
        break;
      case "hunt":
        this._keepUfos(1 + this.groupN, 650);
        this.target = this._nearestUfo(900, "UFO");
        break;
      case "squad":
        this._squad();
        break;
      case "takeoff":
        this._takeoff();
        break;
      case "landjet":
        this._landjet();
        break;
      case "dogfight":
        if (this.vehicles.active?.type === "jet" || (this.pilotJets && this.pilotJets().length)) this._keepUfos(2 + this.groupN, 900);
        this.target = this.vehicles.active?.type === "jet" ? this._nearestUfo(1400, "UFO") : this._parkedJetTarget() || this._airportTarget("Airport: take a parked jet");
        break;
      case "fighter":
        this._fighter();
        break;
      case "village":
        this._village(0.5);
        break;
      case "large":
        this._large();
        break;
      case "meteors":
        this._meteors();
        break;
      case "boss":
        this._boss();
        break;
      case "airport":
        this._airport();
        break;
      case "steal":
        this._steal();
        break;
      default:
        this.target = null;
    }
  }

  // Leftovers of the previous mission's set-up go (or stay, if harmless).
  _cleanup() {
    if (this.sky) this.sky.timeScale = 1;
    this.ufos.forceIntact = false;
    for (const u of this.ufos.ufos) {
      if (u.boss || u.pylon) {
        u.boss = false;
        u.pylon = false;
        u.shield = false;
        u.bossHook = null;
      }
      if (u.missionTarget || u.raider) {
        u.missionTarget = false;
        u.raider = false;
        u.tether = 0;
        u.home = null;
        u.noLeave = false;
      }
    }
    for (const m of this.mobs.mobs) {
      m.missionTarget = false;
      m.fireproof = false;
    }
    this.target = null;
  }

  // Follows a moving target (the marker updates every frame).
  _refreshTarget() {
    const t = this.target;
    if (!t || !t.follow) return;
    const f = t.follow;
    if (f.pos && !f.dead && !f.falling && f.state !== "gone") t.pos.copy(f.pos);
  }

  // (Round 8) A squad leader's weapon on the ground (mobs.onLeaderDown in
  // main.js): marked until someone picks it up; the mission waits for it
  // (at most three minutes, in case it fell somewhere out of reach).
  leaderDropped(it) {
    this._drops = (this._drops || []).filter((d) => this._dropThere(d.it));
    this._drops.push({ it, t: performance.now() });
  }

  _dropThere(it) {
    return !!this.entities?.items.includes(it);
  }

  // The leader's weapon still waiting to be picked up, or null.
  _drop() {
    if (!this._drops?.length) return null;
    this._drops = this._drops.filter((d) => this._dropThere(d.it) && performance.now() - d.t < 180000);
    return this._drops[0]?.it || null;
  }

  holding() {
    return !!this._drop();
  }

  _setTarget(obj, label) {
    this.target = { pos: (obj.pos || obj).clone ? (obj.pos || obj).clone() : new THREE.Vector3(obj.x, obj.y ?? 0, obj.z), label, follow: obj.pos ? obj : null };
  }

  // ---------- Helpers ----------

  _alive(u) {
    return u && !u.falling && u.state !== "gone" && this.ufos.ufos.includes(u);
  }

  // A UFO for a mission, spawned out of sight at `dist` blocks (from a random player, online).
  _spawnUfo(opts, dist = 140, low = true, around = null) {
    const p = around || this._anyone().position;
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * dist;
    const z = p.z + Math.sin(a) * dist;
    const ground = Math.max(this.terrain.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL);
    const y = ground + (low ? rand(26, 40) : rand(90, 140));
    return this.ufos.spawn({ ...opts, pos: { x, y, z }, hidden: true });
  }

  // (Online: the nearest to anyone in the game.)
  _nearestUfo(maxDist, label, filter = null) {
    let best = null;
    let bd = maxDist;
    const people = this._people();
    for (const u of this.ufos.ufos) {
      if (u.falling || u.state === "gone" || (filter && !filter(u))) continue;
      let d = Infinity;
      for (const q of people) d = Math.min(d, u.pos.distanceTo(q.position));
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (!best) return null;
    return { pos: best.pos.clone(), label, follow: best };
  }

  // Keeps at least n UFOs (not falling) within `range` of the player.
  _keepUfos(n, range) {
    const st = this.state;
    st.spawnT = (st.spawnT ?? 5) - 0.5;
    if (st.spawnT > 0) return;
    const people = this._people();
    const near = this.ufos.ufos.filter((u) => !u.falling && u.state !== "gone" && u.state !== "leave" && people.some((q) => u.pos.distanceTo(q.position) < range)).length;
    if (near < n) {
      this.ufos.spawn({});
      st.spawnT = 12;
    } else st.spawnT = 4;
  }

  _airportTarget(label) {
    const a = this.airports.nearest(3000);
    if (!a) return null;
    return { pos: new THREE.Vector3(a.site.x, a.site.y ?? SEA_LEVEL, a.site.z), label, follow: null };
  }

  // ---------- Missions ----------

  // 1. A small, weak scout close by, low, that doesn't wander off: pistol
  // range. It comes down in one piece with two green aliens aboard.
  // (Online: as many scouts as are still to be shot down, up to one per player, each near its player.)
  _scout() {
    const st = this.state;
    const people = this._people();
    const far = (u) => !people.some((q) => u.pos.distanceTo(q.position) < 700);
    st.scouts = (st.scouts || []).filter((u) => this._alive(u) && !far(u));
    const want = Math.min(this._remaining(), people.length);
    if (st.scouts.length < want) {
      st.waitT = (st.waitT ?? 2) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = 6;
        // Near the player who has no scout close by.
        const who = people.find((q) => !st.scouts.some((u) => u.home && u.home.distanceTo(q.position) < 200)) || this._anyone();
        const design = ["saucer", "saucer_disc", "tictac", "saucer_domed"][Math.floor(Math.random() * 4)];
        const u = this._spawnUfo({ design, size: "small", style: "volley" }, rand(90, 130), true, who.position);
        u.missionTarget = true;
        u.noLeave = true;
        u.tether = 110;
        u.home = who.position.clone();
        u.homeOf = who;
        u.dodgeMul = 0.35; // it rarely dashes away from pistol fire
        u.maxHealth = u.health = 40; // eight pistol hits (under a magazine), or five full bow draws
        u.crashPlan = { exploded: false, crew: 2, crewKind: "alien" };
        st.scouts.push(u);
        this.toast?.("A scout UFO is snooping around nearby: follow the marker.", 4);
      }
    }
    // (Each keeps near its player.)
    for (const u of st.scouts) if (u.homeOf && !u.homeOf.dead && u.home.distanceTo(u.homeOf.position) > 160) u.home.copy(u.homeOf.position);
    const s = this._nearestOf(st.scouts);
    if (s) this._setTarget(s, "Scout UFO");
    else this.target = null;
  }

  // A spot on dry, open ground about `dist` blocks from the player (loaded
  // chunks only), or null. With a short render distance (nothing loaded that
  // far out) it comes closer rather than never: a mission must always start.
  _groundSpot(dist, spread = 0.3, around = null) {
    const p = around || this.player.position;
    const world = this.mobs.world;
    for (let k = 0; k < 48; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.max(10, dist * (k < 16 ? 1 : k < 32 ? 0.55 : 0.3)) * rand(1 - spread, 1 + spread);
      const x = Math.floor(p.x + Math.cos(a) * d);
      const z = Math.floor(p.z + Math.sin(a) * d);
      if (!world.getChunk(x >> 4, z >> 4)) continue;
      const top = world.surfaceY(x, z);
      // (Not a lake or sea bed; a dry spot below the sea's level, like a nuke's crater floor, is fine.)
      if (top < 2 || world.getBlock(x, top + 1, z) === BLOCK.WATER) continue;
      const b = world.getBlock(x, top, z);
      if (b === BLOCK.WATER || IS_LEAVES[b] || IS_LOG[b]) continue; // water, or a tree
      // (Airports and cities are paved above the natural ground: fine; a roof
      // or a steep spot only when there is nothing else.)
      if (k < 40) {
        if (top > this.terrain.heightAt(x, z) + 6) continue;
        let steep = false;
        for (const [dx, dz] of NEAR) if (Math.abs(world.surfaceY(x + dx, z + dz) - top) > 2) steep = true;
        if (steep) continue;
      }
      return new THREE.Vector3(x + 0.5, top + 1, z + 0.5);
    }
    return null;
  }

  // 1. The archer: a skeleton close by (it doesn't burn in the daylight and
  // doesn't wander off); it drops its bow. Another comes if it is lost.
  // (Online: one skeleton for each bow still to be won, each near a player.)
  _skeleton() {
    const st = this.state;
    st.sks = (st.sks || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    const want = Math.min(this._remaining(), 4);
    if (st.sks.length < want) {
      st.waitT = (st.waitT ?? 1) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = st.sks.length ? 3 : 8;
        const people = this._people();
        const who = people.find((q) => !st.sks.some((m) => m.pos.distanceTo(q.position) < 70)) || this._anyone();
        const at = this._groundSpot(32, 0.25, who.position);
        const m = at && this.mobs.spawn("skeleton", at.x, at.y, at.z);
        if (m) {
          m.fireproof = true;
          m.missionTarget = true;
          st.sks.push(m);
          if (!st.told) {
            st.told = true;
            this.toast?.(want > 1 ? "Skeletons are prowling nearby: one bow each. Follow the marker." : "A skeleton is prowling nearby: follow the marker.", 4);
          }
        }
      }
    }
    const sk = this._nearestOf(st.sks);
    if (sk) this._setTarget(sk, "Skeleton (it has a bow)");
    else this.target = null;
  }

  // 2. Visitors: a small UFO lands nearby and lets its crew out. They look
  // around for a while (time to get ready), then come for the player (at
  // once if attacked). The ship doesn't fight: it takes off and leaves once
  // its crew is out, and its hull shrugs off hand weapons.
  _landing() {
    const st = this.state;
    const p = this.player.position;
    const crew = (st.crew || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    const shipOk = st.ship && this._alive(st.ship);
    if (!st.phase || (st.phase !== "incoming" && st.phase !== "landed" && crew.length === 0)) {
      // (Re)start: a ship on its way to a landing spot.
      st.waitT = (st.waitT ?? 1) - 0.5;
      this.target = null;
      if (st.waitT > 0) return;
      st.waitT = 20;
      if (this._remaining() <= 0) return;
      const spot = this._groundSpot(75, 0.2, this._anyone().position);
      if (!spot) return;
      const a = Math.random() * Math.PI * 2;
      const u = this.ufos.spawn({ size: "small", design: ["saucer", "saucer_disc", "saucer_domed"][Math.floor(Math.random() * 3)], style: "volley", crewKind: "alien", pos: { x: spot.x + Math.cos(a) * 140, y: spot.y + 70, z: spot.z + Math.sin(a) * 140 }, hidden: true });
      u.immune = true;
      u.peaceful = true; // watching it come down (the marker is on it) must not anger it
      u.noLeave = true;
      u.missionTarget = true;
      u.dodgeMul = 0;
      u.blinkT = 1e9;
      u.state = "trick";
      u.trick = "land";
      u.timer = 1e9;
      u.waypoint = new THREE.Vector3(spot.x, spot.y + u.info.bottom * u.radius + 0.3, spot.z);
      st.ship = u;
      st.spot = spot;
      st.landAt = u.waypoint.clone();
      st.phase = "incoming";
      st.crew = [];
      st.t = 0;
      this.toast?.("A UFO is coming down nearby! Get ready.", 4);
      return;
    }
    if (st.phase === "incoming") {
      if (!shipOk) {
        st.phase = null;
        return;
      }
      this._setTarget(st.ship, "Landing UFO");
      // (Nothing may send it anywhere else before it is down.)
      if (st.ship.state !== "trick" || st.ship.trick !== "land") {
        if (st.ship.beam) st.ship.beam.set(false);
        st.ship.state = "trick";
        st.ship.trick = "land";
        st.ship.timer = 1e9;
        st.ship.waypoint = st.landAt.clone();
      }
      if (st.ship.landed) {
        st.phase = "landed";
        st.landedT = 0;
      }
      return;
    }
    if (st.phase === "landed") {
      st.landedT += 0.5;
      if (shipOk) this._setTarget(st.ship, "Landed UFO");
      if (st.landedT >= 3) {
        // The crew climbs out: calm for a while.
        const group = `visit${Math.floor(Math.random() * 1e9)}`;
        // (Online: two for each player, or what is still to do.)
        const n = Math.max(2, Math.min(2 * this.groupN, this._remaining()));
        for (let i = 0; i < n; i++) {
          const m = this._spawnAlien("alien", 4, st.spot);
          if (!m) continue;
          m.aggro = false;
          m.ai.target = false;
          m.calmT = CALM_TIME;
          m.group = group;
          st.crew.push(m);
        }
        st.phase = "crew";
        st.leaveT = 8;
        if (st.crew.length) this.toast?.(`The aliens are out, looking around. You have about ${CALM_TIME} seconds: get your bow ready!`, 5);
        else st.phase = null;
      }
      return;
    }
    // The crew is out: the ship leaves after a moment.
    st.leaveT -= 0.5;
    if (st.leaveT <= 0 && shipOk && st.ship.state !== "leave") {
      st.ship.immune = false;
      st.ship.peaceful = false;
      st.ship.noLeave = false;
      st.ship.missionTarget = false;
      this.ufos._leave(st.ship);
    }
    crew.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const calm = crew[0]?.calmT > 0;
    this._setTarget(crew[0], calm ? `Alien (attacks in ${Math.ceil(crew[0].calmT)} s)` : "Alien");
  }

  // Called by the game when a calm crew member wakes up.
  crewAwake() {
    if (this.mission?.event !== "landing") return;
    const st = this.state;
    if (st.awakeTold) return;
    st.awakeTold = true;
    this.toast?.("The aliens are coming for you!", 3);
  }

  // 2. The crew: the aliens from the wreck; if they are gone (or never came
  // out), two more are beamed down near the player.
  _crew() {
    const st = this.state;
    const people = this._people();
    const aliens = this.mobs.mobs.filter((m) => !m.dead && m.spec.alien && people.some((q) => m.pos.distanceTo(q.position) < 260));
    // (Online: more are beamed down, for everyone, when none are left.)
    if (aliens.length === 0 && this._remaining() > 0) {
      st.noneT = (st.noneT ?? 0) + 0.5;
      if (st.noneT > (st.spawned ? 20 : 8)) {
        st.noneT = 0;
        st.spawned = true;
        const n = Math.max(2, Math.min(2 * this.groupN, this._remaining()));
        for (let i = 0; i < n; i++) this._spawnAlien("alien", 40, people[i % people.length].position);
        this.toast?.(`${n} aliens were beamed down nearby!`, 3);
      }
      if (!aliens.length) {
        this.target = null;
        return;
      }
    } else st.noneT = 0;
    this._setTarget(this._nearestOf(aliens), "Alien");
  }

  _spawnAlien(kind, dist, around = null) {
    const p = around || this.player.position;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      // (Wider the more tries fail: the spot can be a lake, or a nuke's crater.)
      const r = dist * rand(0.8, 1.2) * (1 + Math.floor(k / 8));
      const x = Math.floor(p.x + Math.cos(a) * r);
      const z = Math.floor(p.z + Math.sin(a) * r);
      const world = this.mobs.world;
      if (!world.getChunk(x >> 4, z >> 4)) continue;
      const top = world.surfaceY(x, z);
      // Dry ground (Round 8: below the sea's level too, e.g. a dry crater floor; not under water).
      if (top < 2 || world.getBlock(x, top + 1, z) === BLOCK.WATER || world.getBlock(x, top, z) === BLOCK.WATER) continue;
      const m = this.mobs.spawn(kind, x + 0.5, top + 1, z + 0.5);
      if (m) {
        m.ai.target = true;
        m.aggro = true;
        m.missionTarget = true;
        return m;
      }
    }
    return null;
  }

  // 3. A supply crate dropped for the player (another if it gets lost).
  // Online one for each player (each near its player); the mission is done
  // when as many have been opened (by anyone) as there are players.
  _crate() {
    const st = this.state;
    const active = this.crates.active;
    const need = this._remaining();
    if (active.length < need) {
      st.dropT = (st.dropT ?? 0) - 0.5;
      if (st.dropT <= 0) {
        st.dropT = 60;
        const people = this._people();
        const lacking = people.filter((q) => !active.some((c) => Math.hypot(c.pos.x - q.position.x, c.pos.z - q.position.z) < 150));
        const list = lacking.length ? lacking : people;
        for (let i = 0; i < need - active.length; i++) this.crates.drop({ center: list[i % list.length].position, dist: 60 + Math.random() * 30 });
      }
    }
    const c = this.crates.nearest(this.player.position.x, this.player.position.z);
    if (c) this._setTarget(c.crate, active.length > 1 ? `Supply crate (${active.length})` : "Supply crate");
    else this.target = null;
  }

  // 4. Nights: a night counts when dawn comes and the player hasn't died
  // since dusk (or since the mission started, at night).
  _trackNight() {
    const h = this.sky.hours;
    const dark = h >= 19.5 || h < 5.5;
    const n = this.night;
    const deaths = this.nightDeaths ? this.nightDeaths() : this.stats.world.deaths ?? 0;
    if (dark && !n.active) {
      n.active = true;
      n.clean = true;
      n.deathsAt = deaths;
    }
    if (n.active && deaths > n.deathsAt) n.clean = false;
    if (!dark && n.active && h >= 5.5 && h < 12) {
      n.active = false;
      if (n.clean && this.enabled && this.anyAlive) {
        this.stats.add("nightsSurvived");
        if (this.mission?.event === "night") this.toast?.("Dawn! You survived the night.", 4);
      }
    }
  }

  // The long night really is at night: the clock runs fast to dusk when the
  // mission starts (and goes back to dusk if the player dies, so a retry
  // needn't wait a whole day), then ticks normally from dusk to dawn.
  _nightClock(dt) {
    const st = this.state;
    const sky = this.sky;
    if (sky.locked) sky.locked = false; // a frozen clock would never bring dawn
    const h = sky.hours;
    const dark = h >= 19.5 || h < 5.5;
    const n = this.night;
    if (!dark) {
      sky.timeScale = h > 5.5 && h < 19.5 && !st.fastDone ? 30 : 1;
      st.fast = true;
      return;
    }
    if (st.fast) {
      st.fast = false;
      st.fastDone = true;
      sky.timeScale = 1;
      this.toast?.("Night falls. Stay near light and shelter; things are coming.", 4);
    }
    if (n.active && !n.clean && st.fastDone && this.anyAlive) {
      // The player died in the night: start it over from dusk.
      sky.setHours(19.6);
      n.clean = true;
      n.deathsAt = this.nightDeaths ? this.nightDeaths() : this.stats.world.deaths ?? 0;
      st.nt = 0;
      st.wave = 0;
      this.toast?.("The night starts over.", 3);
    }
    st.nt = (st.nt ?? 0) + (this.anyAlive ? dt : 0);
  }

  // The night's events: three alien landing parties at 35, 105 and 170 s into
  // the night (the night is about 250 s), small enough for the first tier.
  _night() {
    const st = this.state;
    const sky = this.sky;
    const p = this.player.position;
    const h = sky.hours;
    const dayLen = sky.dayLength ?? 600;
    const toHours = (target) => ((target - h + 24) % 24) * (dayLen / 24);
    this.target = null;
    if (!st.fastDone) {
      this.state.note = "Night is falling...";
      return;
    }
    const waves = [
      { at: 35, kinds: ["alien_gray", "alien_gray", "alien"], text: "Something landed to the east... they are coming for you!" },
      { at: 105, kinds: ["alien", "alien", "alien_gray", "alien_gray"], text: "A second ship: more aliens are closing in!" },
      { at: 170, kinds: ["alien", "alien_gray", "alien", "alien_gray", "alien"], text: "The last landing party! Hold out until dawn." },
    ];
    const w = st.wave ?? 0;
    if (w < waves.length && (st.nt ?? 0) >= waves[w].at) {
      st.wave = w + 1;
      st.alive = st.alive || [];
      const near = this._anyone().position;
      const at = this._groundSpot(70, 0.15, near) || new THREE.Vector3(near.x + 70, 0, near.z);
      // (Online: bigger landing parties for a bigger group, 60% more per extra player.)
      const base = waves[w].kinds;
      const n = Math.round(base.length * (1 + 0.6 * (this.groupN - 1)));
      for (let i = 0; i < n; i++) {
        const kind = base[i % base.length];
        const m = this._spawnAlien(kind, 5, at);
        if (m) st.alive.push(m);
      }
      this.toast?.(waves[w].text, 4);
    }
    st.alive = (st.alive || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    if (st.alive.length) {
      st.alive.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      this._setTarget(st.alive[0], `Landing party (${st.alive.length})`);
    }
    this.state.note = n_note(this.night.active, toHours(5.5), toHours(19.5), st.wave ?? 0, waves.length);
  }

  // 5. Salvage: points at an intact wreck once there is one.
  _intact() {
    const p = this.player.position;
    let best = null;
    let bd = 1200;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "ufo" || !v.crashed || v.unusable || !v.alive) continue;
      const d = v.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best) this._setTarget(best, "Intact wreck: board it (F)");
    else {
      this._keepUfos(2, 600);
      this.target = this._nearestUfo(900, "UFO: shoot it down");
    }
  }

  // Alien patrols (the "squad" missions): a dropship lands a group of one
  // kind of alien about 90 blocks away; the first one out is the leader
  // (tougher, marked), carrying the new alien weapon (mission.squad).
  _squad() {
    const st = this.state;
    const p = this.player.position;
    const spec = this.mission?.squad || { kind: "alien_gray", n: 6, leaderDrop: null };
    const squad = (st.squad || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    const drop = this._drop();
    if (drop) {
      this._setTarget(drop, `${itemInfo(drop.id)?.name ?? "Weapon"}: pick it up`);
      return;
    }
    if (squad.length === 0) {
      st.waitT = (st.waitT ?? 1) - 0.5;
      if (st.waitT > 0) {
        this.target = null;
        return;
      }
      st.waitT = 25;
      // Where they land: open ground about 90 blocks from a player.
      const near = this._anyone().position;
      const at = this._groundSpot(90, 0.15, near) || new THREE.Vector3(near.x + 90, 0, near.z);
      st.squad = [];
      // (Online: the squad grows with the group, and there is a leader with
      // the new weapon for every player, while that weapon is still missing.)
      const N = Math.min(12, spec.n * this.groupN);
      const left = Math.max(1, this._remaining());
      const n = Math.max(Math.min(N, left + this.groupN), Math.min(2, N));
      const leaders = Math.min(this.groupN, n);
      for (let i = 0; i < n; i++) {
        const m = this._spawnAlien(spec.kind, 6, at);
        if (!m) continue;
        if (i < leaders && spec.leaderDrop) {
          // The leader: a little tougher, and it carries the new weapon.
          m.leader = true;
          m.leaderDrop = spec.leaderDrop;
          m.maxHealth = m.health = Math.round(m.health * 1.5);
          this.mobs.setCarry?.(m, spec.leaderDrop);
        }
        st.squad.push(m);
      }
      // The dropship: hovers over them a moment, then leaves.
      const ground = Math.max(this.terrain.heightAt(Math.floor(at.x), Math.floor(at.z)), SEA_LEVEL);
      const ship = this.ufos.spawn({ size: "medium", design: "saucer_disc", crewKind: spec.kind, pos: { x: at.x, y: ground + 30, z: at.z }, hidden: true });
      ship.state = "trick";
      ship.trick = "hover";
      ship.timer = 8;
      ship.immuneUntil = this.ufos.time + 9; // (a dropship: it isn't the fight)
      if (st.squad.length) this.toast?.(`An alien squad has landed: follow the marker!${spec.leaderDrop ? " Its leader is marked." : ""}`, 4);
      return;
    }
    const leader = this._nearestOf(squad.filter((m) => m.leader));
    if (leader) {
      this._setTarget(leader, `Squad leader (${squad.length} left)`);
      return;
    }
    // The marker: the middle of what is left of the squad.
    const c = new THREE.Vector3();
    for (const m of squad) c.add(m.pos);
    c.divideScalar(squad.length);
    this.target = { pos: c, label: `Alien squad (${squad.length} left)`, follow: null };
  }

  // 8. Take off: points at the nearest airport (or the jet).
  _takeoff() {
    // A fighter parked at an airport (the nearest one that is loaded), else the airport itself.
    this.target = this._parkedJetTarget() || this._airportTarget("Airport") || null;
  }

  // The nearest jet standing at an airport (loaded), as a marker target, or null (also when you are in a jet).
  _parkedJetTarget() {
    if (this.vehicles.active?.type === "jet") return null;
    const p = this.player.position;
    let jet = null;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "jet" || !v.alive || v.occupied || v.isEnemyJet || v.jetType === "b2") continue;
      if (!jet || v.pos.distanceTo(p) < jet.pos.distanceTo(p)) jet = v;
    }
    return jet ? { pos: jet.pos.clone(), label: "Parked fighter: get in (F)", follow: jet } : null;
  }

  // 10. An enemy fighter that hunts the player (kept around for the mission).
  // (Online: one hijacked fighter for each player, while they are still to be shot down.)
  _fighter() {
    const st = this.state;
    st.jets = (st.jets || []).filter((j) => j.alive && this.vehicles.vehicles.includes(j));
    const want = Math.min(this._remaining(), this.groupN, 4);
    if (st.jets.length < want) {
      st.waitT = (st.waitT ?? 3) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = st.jets.length ? 8 : 30;
        const j = this.enemyJets.spawn({ hostile: true, dist: 900 });
        if (j) {
          j.mission = true;
          st.jets.push(j);
        }
      }
    }
    for (const j of st.jets) j.provoked = Math.max(j.provoked, 30);
    const j = this._nearestOf(st.jets);
    if (j) this._setTarget(j, st.jets.length > 1 ? `Enemy fighter (${st.jets.length})` : "Enemy fighter");
    else this.target = null;
  }

  // 11. A raid on the nearest village: three raiders burn it until they are
  // shot down; if the player takes too long, they leave and come back later.
  _village() {
    const st = this.state;
    const p = this.player.position;
    if (!st.place) {
      const v = this.terrain.villages.nearestVillage(p.x, p.z, 2500);
      if (v) st.place = { x: v.x, y: v.groundY, z: v.z, name: "Village" };
      else {
        // No village near: an outpost (the airport, or a spot out there).
        const a = this.airports.nearest(2500);
        if (a) st.place = { x: a.site.x, y: a.site.y, z: a.site.z, name: "Airport" };
        else st.place = { x: p.x + 400, y: this.terrain.heightAt(Math.floor(p.x + 400), Math.floor(p.z)), z: p.z, name: "Outpost" };
      }
    }
    const place = st.place;
    const center = new THREE.Vector3(place.x, place.y, place.z);
    const raiders = (st.raiders || []).filter((u) => this._alive(u));
    const done = this.progress.objectives(this.stats.world)[0];
    const left = done ? done.goal - done.value : 3;
    if (raiders.length === 0 && left > 0) {
      st.waitT = (st.waitT ?? 0) - 0.5;
      if (st.waitT > 0) {
        this.target = { pos: center, label: `${place.name}: the raiders are coming back`, follow: null };
        return;
      }
      st.raiders = [];
      st.raidT = 300; // five minutes to save it
      for (let i = 0; i < Math.min(left, 6); i++) {
        const u = this.ufos.spawn({ size: i === 0 && left >= 3 ? "medium" : "small", style: i % 2 ? "heavy" : "sweep", pos: { x: place.x + rand(-40, 40), y: place.y + rand(28, 40), z: place.z + rand(-40, 40) }, hidden: true });
        u.raider = true;
        u.missionTarget = true;
        u.noLeave = true;
        u.home = center.clone();
        u.tether = 60;
        u.dodgeMul = 0.6;
        this.ufos.anger(u, 400);
        st.raiders.push(u);
      }
      this.toast?.(`RAID! UFOs are attacking the ${place.name.toLowerCase()}: follow the marker.`, 5);
      return;
    }
    // They burn the place: now and then a heavy shot at a spot in it.
    st.burnT = (st.burnT ?? 3) - 0.5;
    if (st.burnT <= 0 && raiders.length) {
      st.burnT = 5 + Math.random() * 3;
      const u = raiders[Math.floor(Math.random() * raiders.length)];
      if (u.pos.distanceTo(p) > 60) {
        const spot = new THREE.Vector3(place.x + rand(-30, 30), 0, place.z + rand(-30, 30));
        spot.y = this.terrain.heightAt(Math.floor(spot.x), Math.floor(spot.z)) + 1;
        this.ufos._fireAt(u, spot, _v.set(0, 0, 0), 1);
      }
    }
    st.raidT -= 0.5;
    if (st.raidT <= 0 && raiders.length) {
      for (const u of raiders) {
        u.raider = false;
        u.noLeave = false;
        this.ufos._leave(u);
      }
      st.raiders = [];
      st.waitT = 45;
      this.toast?.("The raiders got away. They'll be back: be there sooner!", 4);
      return;
    }
    const d = center.distanceTo(p);
    if (d > 180 || !raiders.length) this.target = { pos: center, label: `${place.name} under attack (${Math.ceil(st.raidT / 60)} min)`, follow: null };
    else {
      raiders.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      this._setTarget(raiders[0], `Raider (${raiders.length} left)`);
    }
  }

  // 12. A large UFO nearby.
  _large() {
    const st = this.state;
    const big = (u) => u.S.idx >= 2;
    const t = this._nearestUfo(900, "Large UFO", big);
    if (!t) {
      st.waitT = (st.waitT ?? 3) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = 30;
        const u = this._spawnUfo({ size: "large" }, 450, false);
        u.noLeave = true;
      }
    }
    this.target = t;
  }

  // 11. Touchdown: fly a jet back onto a runway and stop; then a red squad
  // drops in on the ground, and the mission is over when it is dead.
  _landjet() {
    const st = this.state;
    const p = this.player.position;
    const act = this.vehicles.active;
    const inJet = act?.type === "jet" && !act.isEnemyJet;
    const sites = this.terrain.sites;
    if (!st.landed) {
      // (Online, any player's jet: the host's own and the others'.)
      const jets = this.pilotJets ? this.pilotJets() : inJet ? [act] : [];
      for (const j of jets) {
        if (!j.onGround) {
          st.air = true;
          st.airJet = j;
        }
      }
      if (st.airJet && !st.airJet.alive) {
        // It crashed: another take-off is needed.
        st.air = false;
        st.airJet = null;
      }
      const landed = st.air && jets.find((j) => j.onGround && j.alive && j.vel.length() < 8 && sites.onRunway(j.pos.x, j.pos.z, 2));
      if (landed) {
        st.landed = true;
        st.landPos = landed.pos.clone();
        if (landed.puppet) this.stats.addWorld("landings");
        else this.stats.add("landings");
        this.toast?.("SAFE LANDING! ...but the aliens have noticed: a red squad is dropping in. Get out (F) and fight!", 6);
      } else {
        // The marker: a jet to take, or the nearest runway.
        const parked = this._parkedJetTarget();
        const a = this.airports.nearest(3500);
        if (parked && !inJet) this.target = parked;
        else if (a) this.target = { pos: new THREE.Vector3(a.site.x, (a.site.y ?? SEA_LEVEL) + 1, a.site.z), label: inJet ? (st.air ? "Land on the runway" : "Take off, then land on the runway") : "Airport", follow: null };
        else this.target = null;
        return;
      }
    }
    // The red squad: three red aliens landed close by (more if some were lost far away).
    const squad = (st.squad || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    st.counted = st.counted || new Set();
    for (const m of st.squad || []) {
      if (m.dead && !st.counted.has(m)) {
        st.counted.add(m);
        this.stats.add("landingSquad");
      }
    }
    const need = (this.progress.objectives(this.stats.world)[1]?.goal ?? 3) - st.counted.size;
    if (need <= 0) {
      this.target = null;
      return;
    }
    if (squad.length < need) {
      st.waitT = (st.waitT ?? 3) - 0.5;
      this.target = null;
      if (st.waitT > 0) return;
      st.waitT = 20;
      const near = st.landPos || p;
      const at = this._groundSpot(75, 0.2, near) || new THREE.Vector3(near.x + 75, 0, near.z);
      st.squad = [...squad];
      for (let i = squad.length; i < need; i++) {
        const m = this._spawnAlien("alien_red", 6, at);
        if (m) st.squad.push(m);
      }
      this._dropship(at, "alien_red");
      if (st.squad.length) this.toast?.("Red aliens have landed: follow the marker!", 4);
      return;
    }
    squad.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    this._setTarget(squad[0], `Red squad (${squad.length} left)`);
  }

  // A dropship that hovers over a landing spot for a moment and leaves.
  _dropship(at, kind) {
    const ground = Math.max(this.terrain.heightAt(Math.floor(at.x), Math.floor(at.z)), SEA_LEVEL);
    const ship = this.ufos.spawn({ size: "medium", design: "saucer_disc", crewKind: kind, pos: { x: at.x, y: ground + 30, z: at.z }, hidden: true });
    ship.state = "trick";
    ship.trick = "hover";
    ship.timer = 8;
    ship.immuneUntil = this.ufos.time + 9; // (a dropship: it isn't the fight)
    return ship;
  }

  // ---------- 16. Falling stars: a meteor storm ----------
  // Meteors (the airstrike's) fall around the player, each announced by a red
  // ring on the ground 4.5 s before it lands. Every third strike leaves a
  // glowing star fragment in its crater; fragments are picked up by walking
  // into them; an unclaimed one is carried off by a salvager UFO after 80 s.
  _meteors() {
    const st = this.state;
    const p = this.player.position;
    if (!st.init) {
      st.init = true;
      st.strikeT = 5;
      st.frags = [];
      st.rings = [];
      st.seed = 0;
      st.since = 2; // the first strike seeds a fragment
      const h = this.sky.hours;
      if (!(h >= 19.5 || h < 5.5)) this.sky.setHours(21);
      this.sky.timeScale = 1;
      this.toast?.("A meteor storm! Rocks fall where the red rings are: keep out of them, and grab the glowing star fragments.", 6);
    }
    st.frags = st.frags.filter((f) => f.life > 0);
    // New strikes (not while the player is dead).
    st.strikeT -= 0.5;
    const collected = this.progress.objectives(this.stats.world)[0]?.value ?? 0;
    const goal = this.progress.objectives(this.stats.world)[0]?.goal ?? 4;
    if (st.strikeT <= 0 && this.anyAlive && this.weapons?.airstrike) {
      // (Online: around everyone, a little more often for a bigger group.)
      st.strikeT = Math.max(3.2, rand(5.5, 8) - (collected / goal) * 2.8) / Math.sqrt(this.groupN);
      const q = this._anyone().position;
      const a = Math.random() * Math.PI * 2;
      const d = rand(20, 65);
      const x = Math.floor(q.x + Math.cos(a) * d);
      const z = Math.floor(q.z + Math.sin(a) * d);
      const wantFrag = st.since >= 2 && st.frags.length + (st.seed || 0) < 1 + this.groupN;
      const y = Math.max(this.world.heightAt(x, z), SEA_LEVEL) + 1;
      const target = new THREE.Vector3(x + 0.5, y, z + 0.5);
      const delay = 4.5;
      this.weapons.airstrike.call(target, { count: wantFrag ? 1 : 3, spread: 12, delay, angle: 28 });
      st.rings.push({ pos: target, t: delay + 0.2, fx: 0, r: wantFrag ? 5 : 11 });
      if (wantFrag) {
        st.seed = (st.seed || 0) + 1;
        st.pending = (st.pending || []).concat([{ pos: target.clone(), at: delay + 1.2 }]);
        st.since = 0;
      } else st.since++;
    }
    // Salvagers: a small UFO comes for a fragment that has been lying around.
    const old = st.frags.find((f) => f.life < 45);
    if (old && !this._alive(st.salvager)) {
      st.salvT = (st.salvT ?? 0) - 0.5;
      if (st.salvT <= 0) {
        st.salvT = 40;
        const u = this.ufos.spawn({ size: "small", style: "rapid", pos: { x: old.pos.x + rand(-50, 50), y: old.pos.y + rand(30, 45), z: old.pos.z + rand(-50, 50) }, hidden: true });
        u.noLeave = true;
        u.missionTarget = true;
        u.home = old.pos.clone();
        u.tether = 50;
        this.ufos.anger(u, 120);
        st.salvager = u;
        this.toast?.("An alien salvager is after the fragments!", 3);
      }
    }
    // The marker: the nearest fragment (or nothing: look up).
    let best = null;
    for (const f of st.frags) if (!best || f.pos.distanceTo(p) < best.pos.distanceTo(p)) best = f;
    this.target = best ? { pos: best.pos.clone(), label: `Star fragment (${Math.ceil(best.life)} s)`, follow: null } : null;
    this.state.note = collected >= goal ? "" : `Fragments: ${collected}/${goal}. Rocks fall by the red rings.`;
  }

  // Every frame: the warning rings, the rocks' craters becoming fragments, the fragments' glow and pickup.
  _fxMeteors(dt) {
    const st = this.state;
    const fx = this.effects;
    if (!st.init || !fx) return;
    const p = this.player.position;
    const red = this._redC || (this._redC = new THREE.Color(3.5, 0.5, 0.25));
    const star = this._starC || (this._starC = new THREE.Color(1.4, 2.2, 4));
    for (let i = st.rings.length - 1; i >= 0; i--) {
      const r = st.rings[i];
      r.t -= dt;
      this._drawRing(r, dt);
      if (r.t <= -1) st.rings.splice(i, 1);
    }
    for (let i = (st.pending || []).length - 1; i >= 0; i--) {
      const q = st.pending[i];
      q.at -= dt;
      if (q.at > 0) continue;
      st.pending.splice(i, 1);
      st.seed = Math.max(0, (st.seed || 1) - 1);
      const y = this.world.surfaceY(Math.floor(q.pos.x), Math.floor(q.pos.z)) + 1.4;
      st.frags.push({ pos: new THREE.Vector3(q.pos.x, y, q.pos.z), life: 80 });
      this.toast?.("A star fragment!", 2.5);
    }
    for (let i = st.frags.length - 1; i >= 0; i--) {
      const f = st.frags[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.toast?.("A fragment was lost to the aliens.", 2.5);
        continue;
      }
      this._drawFrag(f);
      // (Online, any player picks it up.)
      const finder = (this.players ? this.players() : [this.player]).find((q) => !q.dead && Math.hypot(q.position.x - f.pos.x, q.position.z - f.pos.z) < 3 && Math.abs(q.position.y - f.pos.y) < 4);
      if (finder) {
        f.life = -1;
        if (finder === this.player) this.stats.add("meteorFragments");
        else this.stats.addWorld("meteorFragments");
        this.audio?.playCrate?.();
        for (let k = 0; k < 16; k++) fx.glow.spawn({ x: f.pos.x, y: f.pos.y, z: f.pos.z, vx: rand(-5, 5), vy: rand(1, 8), vz: rand(-5, 5), life: 0.7, size0: 0.4, size1: 0.05, color0: star, gravity: 0.5, drag: 1.5 });
        const o = this.progress.objectives(this.stats.world)[0];
        this.toast?.(`Star fragment collected (${o?.value ?? 0}/${o?.goal ?? 4})`, 2.5);
      }
    }
    st.frags = st.frags.filter((f) => f.life > 0);
  }

  // A meteor's warning ring on the ground (also drawn for guests online: see coop.js).
  _drawRing(r, dt) {
    const fx = this.effects;
    if (!fx) return;
    const red = this._redC || (this._redC = new THREE.Color(3.5, 0.5, 0.25));
    r.fx = (r.fx ?? 0) - dt;
    if (r.fx > 0) return;
    r.fx = 0.1;
    const n = 26;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r.t * 0.8;
      const gy = this.world.surfaceY(Math.floor(r.pos.x + Math.cos(a) * r.r), Math.floor(r.pos.z + Math.sin(a) * r.r));
      fx.glow.spawn({ x: r.pos.x + Math.cos(a) * r.r, y: gy + 1.2, z: r.pos.z + Math.sin(a) * r.r, life: 0.22, size0: 0.55, size1: 0.35, color0: red, alpha: 0.9 });
    }
  }

  // A star fragment's glow: a bright core and a column of sparks rising from it.
  _drawFrag(f) {
    const fx = this.effects;
    if (!fx) return;
    const star = this._starC || (this._starC = new THREE.Color(1.4, 2.2, 4));
    fx.glow.spawn({ x: f.pos.x, y: f.pos.y, z: f.pos.z, life: 0.08, size0: 2.6, size1: 2.0, color0: star, alpha: 0.9 });
    if (Math.random() < 0.6) fx.glow.spawn({ x: f.pos.x + rand(-0.5, 0.5), y: f.pos.y, z: f.pos.z + rand(-0.5, 0.5), vy: rand(3, 8), life: rand(0.8, 1.6), size0: 0.4, size1: 0.05, color0: star, alpha: 0.9 });
  }

  // What a guest must see of the mission's own objects (online): rings and fragments.
  netObjects() {
    const st = this.state;
    if (this.mission?.event !== "meteors" || !st.init) return null;
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      r: (st.rings || []).map((r) => [r1(r.pos.x), r1(r.pos.y), r1(r.pos.z), r.r, Math.round(r.t * 2) / 2]),
      f: (st.frags || []).map((f) => [r1(f.pos.x), r1(f.pos.y), r1(f.pos.z)]),
    };
  }

  // A guest draws the host's mission objects (see netObjects).
  drawNetObjects(objs, dt) {
    if (!objs) return;
    const keep = (this._netRings ||= new Map());
    const seen = new Set();
    for (const [x, y, z, rr, t] of objs.r || []) {
      const key = `${x},${z}`;
      seen.add(key);
      let r = keep.get(key);
      if (!r) keep.set(key, (r = { pos: new THREE.Vector3(x, y, z), r: rr, t, fx: 0 }));
      r.t -= dt;
      this._drawRing(r, dt);
    }
    for (const k of keep.keys()) if (!seen.has(k)) keep.delete(k);
    for (const [x, y, z] of objs.f || []) this._drawFrag({ pos: _v.set(x, y, z) });
  }

  // ---------- 20. The Overlord: a shielded mothership ----------
  // Three shield rounds: the shield holds until its pylons (small UFOs,
  // marked) are shot down; then the hull can be hurt, for a minute at most
  // before the shield returns; at 70% and 40% health it re-forms with fresh
  // pylons and reinforcements (a red squad on the ground, more escorts), and
  // at 15% for the last time: the final stretch has no shield, and it fights
  // harder. Killing it ends the mission.
  _boss() {
    const st = this.state;
    const p = this.player.position;
    const boss = st.boss;
    if (!this._alive(boss)) {
      this.bossInfo = null;
      if ((this.progress.objectives(this.stats.world)[0]?.value ?? 0) >= 1) return;
      st.waitT = (st.waitT ?? 2) - 0.5;
      this.target = null;
      if (st.waitT > 0) return;
      st.waitT = 25;
      const u = this._spawnUfo({ size: "mothership", style: "sweep", design: "saucer" }, 520, false);
      u.boss = true;
      u.noLeave = true;
      u.missionTarget = true;
      u.dodgeMul = 0;
      u.home = p.clone();
      u.tether = 240;
      u.maxHealth = u.health = Math.round(5200 * (this.ufos.groupHealth ?? 1)); // (online: tougher for a bigger group)
      u.shield = true;
      u.shieldRound = 0;
      u.shieldAt = [0.7, 0.4, 0.15];
      u.bossHook = (b) => this._bossHook(b);
      st.boss = u;
      st.pylons = [];
      st.escorts = [];
      st.phase = 0;
      st.raise = true;
      st.shieldDownT = 0;
      this.toast?.("THE OVERLORD is here! Its shield is up: shoot down the pylons (marked).", 6);
      return;
    }
    // The shield, the pylons, the escort.
    st.pylons = (st.pylons || []).filter((u) => this._alive(u));
    st.escorts = (st.escorts || []).filter((u) => this._alive(u));
    if (boss.shield && st.raise && st.pylons.length === 0) {
      st.raise = false;
      this._bossPylons(boss, [3, 4, 4, 4][Math.min(3, boss.shieldRound)]);
      this._bossReinforce(boss, boss.shieldRound);
    } else if (boss.shield && !st.raise && st.pylons.length === 0) {
      boss.shield = false;
      st.shieldDownT = 60;
      this.toast?.("SHIELD DOWN! Hit the hull with everything: you have about a minute!", 5);
      this.audio?.playNotice?.();
    } else if (!boss.shield) {
      st.shieldDownT -= 0.5;
      if (st.shieldDownT <= 0 && boss.shieldRound < boss.shieldAt.length) {
        // The shield comes back early (same round: the hull keeps its damage).
        boss.shield = true;
        st.raise = true;
        this.toast?.("The shield is back! More pylons...", 4);
      }
    }
    // Berserk at the end: it fires faster and heavier.
    const frac = boss.health / boss.maxHealth;
    const phase = boss.shieldRound >= 3 ? 3 : boss.shieldRound;
    if (phase !== st.phase) {
      st.phase = phase;
      boss.style = ["sweep", "heavy", "charged", "seeker"][phase] || "sweep";
      boss.laserKey = STYLE_COLOR[boss.style] || boss.laserKey;
      if (phase === 3) this.toast?.("The Overlord is wounded and furious: no more shields! Finish it!", 5);
    }
    this.bossInfo = { name: "THE OVERLORD", health: Math.max(0, Math.min(1, frac)), shield: !!boss.shield, pylons: st.pylons.length, downT: boss.shield ? 0 : st.shieldDownT, final: phase === 3 };
    // The marker: a pylon while the shield is up, else the hull.
    if (boss.shield && st.pylons.length) {
      st.pylons.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      this._setTarget(st.pylons[0], `Shield pylon (${st.pylons.length} left)`);
    } else this._setTarget(boss, "The Overlord");
    this.state.note = boss.shield ? `Shield up: ${st.pylons.length} pylons` : phase === 3 ? "Last stand: no shield" : `Shield down for ${Math.ceil(st.shieldDownT)} s`;
  }

  // Called when the boss takes damage: at each threshold the health stops
  // there, the shield re-forms, and the fight moves to the next round.
  _bossHook(b) {
    const next = b.shieldAt[b.shieldRound];
    if (next === undefined || b.shield) return;
    if (b.health <= next * b.maxHealth) {
      b.health = Math.max(1, Math.round(next * b.maxHealth));
      b.shield = true;
      b.shieldRound++;
      this.state.raise = true;
      this.state.shieldDownT = 0;
      if (b.shieldRound < b.shieldAt.length) this.toast?.(`SHIELD RESTORED (${b.shieldRound}/${b.shieldAt.length}): shoot down the pylons again!`, 5);
      else this.toast?.("Its shield flickers back for the last time: pylons!", 5);
    }
  }

  _bossPylons(boss, n) {
    const st = this.state;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const d = rand(80, 130);
      const x = boss.pos.x + Math.cos(a) * d;
      const z = boss.pos.z + Math.sin(a) * d;
      const ground = Math.max(this.terrain.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL);
      const u = this.ufos.spawn({ size: "small", style: i % 2 ? "rapid" : "volley", pos: { x, y: ground + rand(35, 60), z }, hidden: true });
      u.pylon = true;
      u.noLeave = true;
      u.missionTarget = true;
      u.dodgeMul = 0.3;
      u.home = boss.pos.clone();
      u.tether = 150;
      u.maxHealth = u.health = 110;
      st.pylons.push(u);
    }
  }

  // What comes with each shield: round 0 two medium escorts, round 1 a red
  // squad drops in as well, rounds 2-3 two more escorts (and the last stretch is the boss alone).
  _bossReinforce(boss, round) {
    const st = this.state;
    const p = this.player.position;
    const escorts = round === 0 ? 2 : round === 2 ? 2 : round === 1 ? 1 : 0;
    for (let i = 0; i < escorts && st.escorts.length < 4; i++) {
      const e = this.ufos.spawn({ size: "medium", pos: { x: boss.pos.x + rand(-80, 80), y: boss.pos.y - 25, z: boss.pos.z + rand(-80, 80) }, hidden: true });
      e.home = boss.pos.clone();
      e.tether = 160;
      e.noLeave = true;
      st.escorts.push(e);
    }
    if (round === 1) {
      const at = this._groundSpot(70, 0.2) || new THREE.Vector3(p.x + 70, 0, p.z);
      let n = 0;
      for (let i = 0; i < 2 + this.groupN; i++) if (this._spawnAlien("alien_red", 6, at)) n++;
      if (n) {
        this._dropship(at, "alien_red");
        this.toast?.("The Overlord has dropped a red squad on you!", 4);
      }
    }
  }

  // Every frame: a shimmering shell around the boss while its shield is up.
  _fxBoss(dt) {
    const st = this.state;
    const b = st.boss;
    if (!b || !this._alive(b) || !b.shield) return;
    this.drawShield(b);
  }

  // The boss's shield shimmer (also drawn for guests online).
  drawShield(b) {
    const fx = this.effects;
    if (!fx) return;
    const c = this._shieldC || (this._shieldC = new THREE.Color(0.3, 1.1, 2.4));
    const n = 5;
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-0.3, 1));
      const R = b.radius * 1.18;
      fx.glow.spawn({ x: b.pos.x + R * Math.sin(ph) * Math.cos(th), y: b.pos.y + R * 0.5 * Math.cos(ph), z: b.pos.z + R * Math.sin(ph) * Math.sin(th), life: 0.3, size0: b.radius * 0.1, size1: b.radius * 0.04, color0: c, alpha: 0.5 });
    }
  }

  // (Round 8) The enemy base: another airport, at least 1200 blocks from
  // the one the players start from (where the B-2 stands), the nearest such.
  _pickBase() {
    const p = this._anyone().position;
    const sites = this.terrain.sites;
    const home = sites.nearest(p.x, p.z, 4000, "airport");
    const from = home || { x: p.x, z: p.z };
    let best = null;
    let bestD = Infinity;
    for (const s of sites.within(from.x, from.z, 6000)) {
      if (s.kind !== "airport" || s === home) continue;
      const d = Math.hypot(s.x - from.x, s.z - from.z);
      if (d < 1200 || d >= bestD) continue;
      best = s;
      bestD = d;
    }
    if (best) return { x: best.x, y: best.y, z: best.z, site: best };
    // (No other airport out there: a base in the open, 1500 blocks off.)
    const x = from.x + 1500;
    const z = from.z;
    return { x, y: Math.max(SEA_LEVEL + 6, this.terrain.heightAt(Math.floor(x), Math.floor(z))), z, site: null };
  }

  // A B-2 with someone in it (online: any player's), or null.
  _b2Flying() {
    for (const v of this.vehicles.vehicles) if (v.type === "jet" && v.jetType === "b2" && v.alive && (v.occupied || (v.puppet && v.netOcc))) return v;
    return null;
  }

  // The nearest parked, empty B-2 (as a marker target), or null.
  _parkedB2Target() {
    const p = this._anyone().position;
    let jet = null;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "jet" || v.jetType !== "b2" || !v.alive || v.occupied || v.netOcc || v.isEnemyJet) continue;
      if (!jet || v.pos.distanceTo(p) < jet.pos.distanceTo(p)) jet = v;
    }
    return jet ? { pos: jet.pos.clone(), label: "B-2 bomber: get in (F)", follow: jet } : null;
  }

  // 18. Operation Sunburn: take the B-2 from your airport, fly to the enemy
  // base (another airport, far off) and drop the nuke on it. Online one
  // player flies the bomber, the others escort it in the fighters.
  _airport() {
    const st = this.state;
    if (!this.base) this.base = this._pickBase();
    const b = this.base;
    const center = new THREE.Vector3(b.x, b.y, b.z);
    // (Online: how close the nearest player is.)
    let d = Infinity;
    for (const q of this._people()) d = Math.min(d, center.distanceTo(q.position));
    // Guards: two UFOs over the base, and a fighter that scrambles when you come near.
    st.guards = (st.guards || []).filter((u) => this._alive(u));
    st.guardT = (st.guardT ?? 0) - 0.5;
    if (st.guards.length < 1 + this.groupN && st.guardT <= 0 && d < 1600) {
      st.guardT = 40;
      const u = this.ufos.spawn({ size: "medium", style: "heavy", pos: { x: b.x + rand(-60, 60), y: b.y + 45, z: b.z + rand(-60, 60) }, hidden: true });
      u.home = center.clone();
      u.tether = 90;
      u.noLeave = true;
      if (d < 700) this.ufos.anger(u, 200);
      st.guards.push(u);
    }
    if (d < 900 && !(st.jet && st.jet.alive && this.vehicles.vehicles.includes(st.jet))) {
      st.jetT = (st.jetT ?? 0) - 0.5;
      if (st.jetT <= 0) {
        st.jetT = 60;
        const j = this.enemyJets.spawn({ hostile: true, dist: 700 });
        if (j) j.mission = true;
        st.jet = j;
      }
    }
    for (const u of st.guards) if (d < 700 && !u.hostile) this.ufos.anger(u, 200);
    // The marker: the bomber first, then the base.
    const b2 = this._b2Flying();
    if (!b2) {
      const t = this._parkedB2Target() || this._airportTarget("Airport: take the B-2 bomber");
      if (t) {
        this.target = t;
        return;
      }
    }
    const mine = this.vehicles.active === b2 && b2;
    this.target = { pos: center, label: mine ? `Enemy base: drop the nuke (B) ${Math.round(d)} m` : "Enemy base: escort the B-2", follow: null };
  }

  // (Round 8) Steal the ship: an alien ship kept in the underground bunker
  // of an airport (sites.js / airports.js: a walled compound, a ramp down
  // into a hall, armed guards who shoot anyone in the restricted zone). The
  // mission adds soldiers (more for a bigger group), and makes sure a ship is
  // there (the bunker's own, or one brought in if it was taken before). Once
  // someone boards it the base locks down: the blast doors at the foot of the
  // ramp are sealed, every guard is on alert and reinforcements come up the
  // compound. The way out is ghost mode (G), burning up through the rock;
  // the mission is done when the ship is 150 blocks from the hall.
  // (Online: the host runs it; any player can be the pilot, the others fight
  // the guards. A ship lost after boarding: the doors open again and a new
  // ship is brought in.)
  _steal() {
    const st = this.state;
    const sites = this.terrain.sites;
    if (st.site === undefined) {
      const p = this._anyone().position;
      let best = null;
      let bestD = Infinity;
      for (const s of sites.within(p.x, p.z, 8000)) {
        if (s.kind !== "airport" || !s.bunkers?.length) continue;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      st.site = best;
    }
    const site = st.site;
    if (!site) {
      // (No airport with a bunker within 8 km, very rare: a captured ship in
      // the open, a little way off, under guard.)
      this._stealOpen();
      return;
    }
    const spot = sites.bunkerSpots(site)[0];
    const key = `${site.id}#h${spot.id}`;
    const hall = new THREE.Vector3(spot.x, spot.y, spot.z);
    let d = Infinity;
    for (const q of this._people()) d = Math.min(d, hall.distanceTo(q.position));
    const ready = this.world.getChunk(Math.floor(spot.x) >> 4, Math.floor(spot.z) >> 4) && this.world.getChunk(Math.floor(spot.zone.x) >> 4, Math.floor(spot.zone.z) >> 4);
    // The ship: the bunker's own (set out by airports.js when someone comes
    // near; online the copy a guest boarded comes back as its puppet), else one brought in.
    if (!st.ship || !this.vehicles.vehicles.includes(st.ship) || !st.ship.alive) {
      const was = st.ship;
      st.ship = this.vehicles.vehicles.find((v) => v.type === "ufo" && v.alive && (v.parkKey === key || v.tookKey === key || v.missionShip === key)) || null;
      if (!st.ship && was && st.locked) {
        // Lost after boarding: the doors open again, another ship comes.
        this._stealDoors(site, spot, false);
        st.locked = false;
        st.newShipT = 6;
      }
      if (!st.ship && ready && d < 220) {
        st.newShipT = (st.newShipT ?? 3) - 0.5;
        if (st.newShipT <= 0) {
          const v = this.vehicles.create("ufo", { design: "saucer_domed", seed: (site.seed + 4242) | 0, radius: 3.8, pos: [spot.x, spot.y, spot.z], yaw: spot.yaw });
          if (v) {
            v.pos.y = spot.y + v.bottom + 0.9;
            v.hangar = true;
            v.missionShip = key;
            st.ship = v;
          }
        }
      }
    }
    // More soldiers in the bunker (once, when its chunks are there): two, plus two for each player.
    if (!st.guardsSet && ready && d < 260 && this.mobs.hostileSpawning !== false) {
      st.guardsSet = true;
      st.guards = [];
      const n = 2 + 2 * this.groupN;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const g = this.mobs.spawnGuard(spot.x + Math.cos(a) * 8, spot.y, spot.z + Math.sin(a) * 7, spot.zone);
        if (g) {
          g.missionTarget = false;
          st.guards.push(g);
        }
      }
    }
    const ship = st.ship;
    const aboard = ship && (ship.occupied || (ship.puppet && ship.netOcc));
    if (aboard && !st.locked) {
      st.locked = true;
      st.everAboard = true;
      this._stealDoors(site, spot, true);
      // Every guard on alert, and reinforcements up in the compound.
      for (const g of this.mobs.mobs) if (!g.dead && g.spec.sentry && g.pos.distanceTo(hall) < 90) this.mobs.alarm(g, 90);
      if (this.mobs.hostileSpawning !== false) {
        for (let i = 0; i < 1 + this.groupN; i++) {
          const g = this.mobs.spawnGuard(spot.zone.x + (Math.random() - 0.5) * 30, site.y + 1, spot.zone.z + (Math.random() - 0.5) * 30, spot.zone);
          if (g) this.mobs.alarm(g, 10);
        }
      }
      this.toast?.("LOCKDOWN! The blast doors are sealed. Ghost mode (G): burn your way out through the rock!", 6);
    }
    if (ship && aboard) {
      const away = ship.pos.distanceTo(hall);
      if (away >= 150) {
        if (!st.escaped) {
          st.escaped = true;
          this.stats.add("shipsStolen");
          this.toast?.("You got the ship out: it's yours!", 5);
        }
        this.target = null;
        return;
      }
      this.target = { pos: new THREE.Vector3(hall.x, site.y + 30, hall.z), label: `Escape: ghost mode (G), up through the rock (${Math.round(150 - away)} m to go)`, follow: null };
      st.note = "Get 150 blocks away from the bunker.";
      return;
    }
    st.note = "";
    if (ship && d < 90) this._setTarget(ship, "The alien ship: board it (F)");
    else this.target = { pos: new THREE.Vector3(spot.zone.x, site.y + 1, spot.zone.z), label: "Bunker: the captured ship (armed guards)", follow: null };
  }

  // The blast doors at the foot of the bunker's ramp: sealed (only where there
  // is air: nothing built is lost) or opened again.
  _stealDoors(site, spot, close) {
    const sites = this.terrain.sites;
    const b = site.bunkers[spot.id];
    const list = [];
    if (close) {
      for (let u = b.ru0 - 1; u <= b.ru1 + 1; u++) {
        for (const v of [b.hv0, b.hv0 + 1]) {
          const [x, z] = sites.toWorld(site, u, v);
          for (let y = spot.y; y < spot.y + 10; y++) {
            if (this.world.getBlock(x, y, z) !== BLOCK.AIR) continue;
            list.push(x, y, z, (y - spot.y) % 3 === 1 ? BLOCK.STONE : BLOCK.COBBLESTONE);
          }
        }
      }
      this.state.doors = list.slice();
    } else {
      const old = this.state.doors || [];
      for (let i = 0; i < old.length; i += 4) if (this.world.getBlock(old[i], old[i + 1], old[i + 2]) === old[i + 3]) list.push(old[i], old[i + 1], old[i + 2], BLOCK.AIR);
      this.state.doors = null;
    }
    if (list.length) this.world.setBlocks(list);
  }

  // The fallback: a captured ship standing in the open 700 blocks off, ringed by soldiers.
  _stealOpen() {
    const st = this.state;
    if (!st.open) {
      const at = this._groundSpot(700, 0.2, this._anyone().position);
      st.open = at ? { x: at.x, y: at.y, z: at.z } : null;
      if (!st.open) return;
    }
    const o = st.open;
    const c = new THREE.Vector3(o.x, o.y, o.z);
    let d = Infinity;
    for (const q of this._people()) d = Math.min(d, c.distanceTo(q.position));
    if ((!st.ship || !this.vehicles.vehicles.includes(st.ship) || !st.ship.alive) && d < 260 && this.world.getChunk(Math.floor(o.x) >> 4, Math.floor(o.z) >> 4)) {
      st.ship = this.vehicles.vehicles.find((v) => v.missionShip === "open" && v.alive) || this.vehicles.create("ufo", { design: "saucer_domed", seed: 4242, radius: 3.8, pos: [o.x, o.y + 4, o.z], yaw: 0 });
      if (st.ship) st.ship.missionShip = "open";
      if (!st.guardsSet && this.mobs.hostileSpawning !== false) {
        st.guardsSet = true;
        const zone = { x: o.x, z: o.z, r: 40 };
        for (let i = 0; i < 4 + 2 * this.groupN; i++) {
          const a = (i / (4 + 2 * this.groupN)) * Math.PI * 2;
          const x = Math.floor(o.x + Math.cos(a) * 14);
          const z = Math.floor(o.z + Math.sin(a) * 14);
          this.mobs.spawnGuard(x + 0.5, this.terrain.heightAt(x, z) + 1, z + 0.5, zone);
        }
      }
    }
    const ship = st.ship;
    if (ship && (ship.occupied || (ship.puppet && ship.netOcc))) {
      const away = ship.pos.distanceTo(c);
      if (away >= 150 && !st.escaped) {
        st.escaped = true;
        this.stats.add("shipsStolen");
        this.toast?.("You got the ship out: it's yours!", 5);
      }
      this.target = away >= 150 ? null : { pos: c.clone(), label: `Escape: get clear (${Math.round(150 - away)} m to go)`, follow: null };
      return;
    }
    if (ship && d < 90) this._setTarget(ship, "The alien ship: board it (F)");
    else this.target = { pos: c, label: "The captured ship (armed guards)", follow: null };
  }

  // The nuke went off: on the enemy base?
  nukeDetonated(center, R = 0) {
    if (!this.enabled || this.mission?.event !== "airport" || !this.base) return;
    const d = Math.hypot(center.x - this.base.x, center.z - this.base.z);
    if (d < Math.max(170, R * 1.3)) {
      this.stats.add("airportsNuked");
      this.toast?.("DIRECT HIT: the enemy base is gone!", 5);
    } else this.toast?.(`The nuke missed the base by ${Math.round(d)} blocks.`, 3);
  }

  // A UFO the player shot down: raiders count for the village mission.
  ufoDown(u) {
    if (u.raider) this.stats.add("raidersDown");
    if (u.boss) {
      this.stats.add("bossesDown");
      this.toast?.("THE OVERLORD HAS FALLEN!", 6);
      this.bossInfo = null;
      // Its pylons and escorts go down with it.
      for (const o of [...(this.state.pylons || []), ...(this.state.escorts || [])]) if (this._alive(o)) this.ufos.damage(o, 99999, true);
    }
  }

  // Extra lines for the HUD (below the objectives).
  note() {
    return this.state.note || "";
  }
}
