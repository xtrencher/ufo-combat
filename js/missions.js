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
import { BLOCK, IS_LEAVES, IS_LOG, IS_WET } from "./blocks.js";
import { DAY_LENGTH } from "./sky.js";


const _v = new THREE.Vector3();
const STYLE_COLOR = { sweep: "red", heavy: "orange", charged: "white", seeker: "lime" }; // (the bolt colours of the boss's styles: see STYLES in ufos.js)
const NEAR = [[2, 0], [-2, 0], [0, 2], [0, -2]];
const CALM_TIME = 35; // seconds a landed crew looks around before it attacks
// The long night's landing parties (seconds into the night; dusk 19:30 to
// dawn 5:30 is about 190 s: the sky's night hours run faster than its day's).
const NIGHT_WAVES = [
  { at: 30, kinds: ["alien_gray", "alien_gray", "alien"], text: "Something landed to the east... they are coming for you!" },
  { at: 90, kinds: ["alien", "alien", "alien_gray", "alien_gray"], text: "A second ship: more aliens are closing in!" },
  { at: 145, kinds: ["alien", "alien_gray", "alien", "alien_gray", "alien"], text: "The last landing party! Hold out until dawn." },
];
// The boss fights (the mission's `boss`, progression.js): the Overlord's are
// the defaults. shieldAt: the health fractions where the shield comes back;
// pylons, escorts: per shield round; squads, jets: what drops in at a round.
const OVERLORD = { name: "THE OVERLORD", short: "The Overlord", size: "mothership", design: "saucer", health: 5200, shieldAt: [0.7, 0.4, 0.15], pylons: [3, 4, 4, 4], escorts: [2, 1, 2, 0], squads: { 1: "alien_red" }, jets: {}, stat: "bossesDown" };
// (Round 9) The swarm's night: red brutes and blue aliens join in.
const SWARM_WAVES = [
  { at: 35, kinds: ["alien_gray", "alien_blue", "alien", "alien_gray"], text: "A landing party is down nearby, blue aliens among them!" },
  { at: 95, kinds: ["alien_red", "alien_gray", "alien_blue", "alien"], text: "Red brutes have landed: keep your distance from the plasma!" },
  { at: 150, kinds: ["alien_red", "alien_blue", "alien_gray", "alien_blue", "alien"], text: "The last landing party! Hold out until dawn." },
];

// (Round 10) The squad missions' variants (progress.variant, 0-3): where the
// squad lands and one alien more or less.
const SQUAD_VARIANTS = [
  { dist: 90, n: 0 },
  { dist: 75, n: 1 },
  { dist: 110, n: 0 },
  { dist: 95, n: -1 },
];

// (Round 10) The fortress's garrison by variant: mixed, brutes, sharpshooters, mixed.
const FORTRESS_KINDS = [
  ["alien_red", "alien_blue", "alien_gray", "alien_red", "alien", "alien_blue", "alien_gray", "alien"],
  ["alien_red", "alien_red", "alien_gray", "alien_red", "alien", "alien_red", "alien_blue", "alien"],
  ["alien_gray", "alien_blue", "alien_gray", "alien_blue", "alien_red", "alien_gray", "alien_blue", "alien"],
  ["alien_red", "alien_blue", "alien_gray", "alien_red", "alien", "alien_blue", "alien_gray", "alien"],
];
// (Round 10) The missions with a place drawn on the ground every frame (a
// zone to hold, a shelter, the bombardment's rings, the signal beacons).
const ZONE_EVENTS = new Set(["hold", "crashsite", "evac", "beacons"]);
const ZONE_KINDS = ["beacon", "site", "shelter"]; // (by index, online: netObjects)
const TAKEN_SETBACK = 60; // seconds a player taken by the hunters costs the clock ("Don't look up")

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// "2:05": seconds as minutes and seconds.
function clock(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

// (Round 10) The dusk's time-lapse: the sky's time `tau` seconds into a warp
// of `dist` game seconds over D real ones, from t0. It speeds up from normal
// speed to a peak half way and slows back down to normal speed, landing on
// t0 + dist at tau = D (and goes on at normal speed after):
// t0 + tau + (dist - D) * smootherstep(tau / D). (Also run by a guest's sky,
// from the host's plan: js/net/coop.js.)
export function warpTime(t0, dist, D, tau) {
  const u = Math.max(0, Math.min(1, tau / D));
  return t0 + Math.max(0, tau) + (dist - D) * u * u * u * (u * (u * 6 - 15) + 10);
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
    this.pilotName = null; // (vehicle) => the name of who flies it
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

  // Seconds of game time until the clock shows hour h (the sky's hours are
  // not even: the night's run faster than the day's).
  _secondsUntil(h) {
    const sky = this.sky;
    if (!sky._timeForAngle) return ((h - sky.hours + 24) % 24) * (DAY_LENGTH / 24);
    const t = sky._timeForAngle((((((h - 6) % 24) + 24) % 24) / 12) * Math.PI);
    return (((t - sky.time) % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
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
      // (The chain is over: the finale's leftovers go back to free play, once.
      // Not when the director is merely off: its state stays.)
      if (this.enabled && !this.mission && this.missionId) {
        this._cleanup();
        this.missionId = null;
      }
      // (Creative, mods off, a Dogfight: the mission's global settings go off.
      // Its state stays, so on resume the night's clock and Salvage set them again.)
      if (this._wasOn) {
        this._wasOn = false;
        if (this.sky) this.sky.timeScale = 1;
        this._warping = false;
        this.ufos.forceIntact = false;
      }
      return;
    }
    this._wasOn = true;
    if (m.event !== "boss") this.bossInfo = null;
    if (m.id !== this.missionId) {
      this.missionId = m.id;
      this._cleanup();
      this.state = { t: 0 };
    }
    const st = this.state;
    st.t += dt;
    this._warpStep(dt);
    if (m.event === "night" || m.event === "swarm") this._nightClock(dt);
    // (Effects that must run every frame.)
    if (m.event === "meteors") this._fxMeteors(dt);
    if (m.event === "boss") this._fxBoss(dt);
    if (ZONE_EVENTS.has(m.event)) this._fxZones(dt);
    this.checkT -= dt;
    if (this.checkT > 0) {
      this._refreshTarget();
      return;
    }
    if (this.target) this._lastPlace = { x: this.target.pos.x, z: this.target.pos.z, id: m.id };
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
        this._nightHunters();
        break;
      case "intact":
        this.ufos.forceIntact = true;
        this._intact();
        break;
      case "hunt":
        this._keepHit();
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
        this._keepHit();
        if (this.vehicles.active?.type === "jet" || (this.pilotJets && this.pilotJets().length)) this._keepUfos(2 + this.groupN, 900);
        this.target = this.vehicles.active?.type === "jet" ? this._nearestUfo(1400, "UFO") : this._parkedJetTarget() || this._airportTarget("Airport: take a parked jet");
        break;
      case "fighter":
        this._fighter();
        break;
      case "airraid":
        this._fighter(1 + this.groupN, 5, true);
        break;
      case "abduct":
        this._abduct();
        break;
      case "giant":
        this._large("giant");
        break;
      case "swarm":
        this._swarm();
        break;
      case "fortress":
        this._fortress();
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
      case "hunters":
        this._hunted();
        break;
      case "hold":
        this._hold();
        break;
      case "crashsite":
        this._crashSite();
        break;
      case "evac":
        this._evac();
        break;
      case "rescue":
        this._rescue();
        break;
      case "beacons":
        this._beacons();
        break;
      default:
        this.target = null;
    }
  }

  // Leftovers of the previous mission's set-up go (or stay, if harmless).
  _cleanup() {
    if (this.sky) this.sky.timeScale = 1;
    this._warping = false;
    this.ufos.forceIntact = false;
    for (const u of this.ufos.ufos) {
      if (u.immune || u.peaceful) this._releaseShip(u); // (only the Visitors' landing ship has these)
      if (u.boss || u.pylon) {
        u.boss = false;
        u.pylon = false;
        u.shield = false;
        u.bossHook = null;
      }
      if (u.missionTarget || u.raider || u.abductor || u.swarm || u.hunter) {
        // (Round 10: the hunters give up and go.)
        if (u.hunter && this._alive(u) && u.state !== "leave") this.ufos._leave(u);
        u.missionTarget = false;
        u.raider = false;
        u.abductor = false;
        u.swarm = false;
        u.hunter = false;
        u.tether = 0;
        u.home = null;
        u.noLeave = false;
      }
    }
    for (const m of this.mobs.mobs) {
      m.missionTarget = false;
      m.fireproof = false;
    }
    // (The steal mission's posted guards: they despawn like other creatures again.)
    for (const g of this.state.guards || []) if (g.sentry && !g.dead) g.persist = false;
    // (A mission's fighters left over: the usual distance and number limits apply again.)
    for (const j of this.enemyJets?.jets || []) {
      if (j.mission) {
        j.mission = false;
        j.provoked = 0;
      }
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

  // The leaders' weapons still on the ground, for the save ([[id, x, y, z], ...]):
  // a reload sets them out again, and the mission still waits for them.
  serializeDrops() {
    this._drop();
    return (this._drops || []).map((d) => [d.it.id, Math.round(d.it.pos.x * 10) / 10, Math.round(d.it.pos.y * 10) / 10, Math.round(d.it.pos.z * 10) / 10]);
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

  // (Round 9) A mission's own ship: it never leaves, never despawns (see
  // ufos.js), never goes off hiding, and keeps its damage: the director
  // keeps the same ship from start to finish, never a fresh replacement.
  _keepTarget(u) {
    if (!u) return u;
    u.missionTarget = true;
    u.noLeave = true;
    if (u.state === "leave") {
      u.state = "roam";
      u.waypoint = null;
      u.timer = 0;
    }
    return u;
  }

  // (Round 9) ...and it stays near the players: its home follows its player
  // (the nearest one when that one is dead or gone), so a ship that strayed
  // (a dash, a chase, a player flying off) comes back to the fight.
  _leash(u, range = 160, tether = 240) {
    const people = this._people();
    let q = u.homeOf && people.includes(u.homeOf) ? u.homeOf : null;
    if (!q) {
      let bd = Infinity;
      for (const o of people) {
        const d = o.position.distanceTo(u.pos);
        if (d < bd) {
          bd = d;
          q = o;
        }
      }
    }
    if (!q) return;
    if (!u.home) u.home = q.position.clone();
    else if (u.home.distanceTo(q.position) > range) u.home.copy(q.position);
    if (!u.tether) u.tether = tether;
  }

  // (Round 9) The hunts: a UFO a player has hit is kept for the fight (it
  // never leaves or despawns, and stays near the players), so the damage
  // done to it is never lost to a fresh ship taking its place.
  _keepHit() {
    for (const u of this.ufos.ufos) {
      if (!u.byPlayer || u.falling || u.state === "gone" || u.boss || u.pylon) continue;
      if (!u.missionTarget) this._keepTarget(u);
      this._leash(u, 400, 300);
    }
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
    // (Round 9: a scout that strays is called back, never dropped and replaced.)
    st.scouts = (st.scouts || []).filter((u) => this._alive(u));
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
        u.maxHealth = u.health = 40; // eight pistol hits (under a magazine), or four full bow draws
        u.crashPlan = { exploded: false, crew: 2, crewKind: "alien" };
        st.scouts.push(u);
        this.toast?.("A scout UFO is snooping around nearby: follow the marker.", 4);
      }
    }
    // (Each keeps near its player, or the nearest one when that one is gone.)
    for (const u of st.scouts) this._leash(u, 160, 110);
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
        const at = this._groundSpot([32, 40, 26, 32][this.mission?.variant ?? 0] ?? 32, 0.25, who.position); // (Round 10: nearer or farther by the variant)
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
      if (st.ship) this._releaseShip(st.ship); // (the last one, still parked if its crew went fast)
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
      // (Never below the sea surface: the UFOs' floor, ufos._groundAt, on a dry spot down a pit too.)
      const ground = Math.max(spot.y, this.ufos._groundAt?.(spot.x, spot.z) ?? spot.y);
      u.waypoint = new THREE.Vector3(spot.x, ground + u.info.bottom * u.radius + 0.3, spot.z);
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
      // (Or near enough after a long while: something below kept it up.)
      if (st.ship.landed || (st.t > 40 && Math.hypot(st.ship.pos.x - st.landAt.x, st.ship.pos.z - st.landAt.z) < 4)) {
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
        const calm = this.mission?.variant === 2 ? 22 : CALM_TIME; // (Round 10: a jumpy crew)
        for (let i = 0; i < n; i++) {
          const m = this._spawnAlien("alien", 4, st.spot);
          if (!m) continue;
          m.aggro = false;
          m.ai.target = false;
          m.calmT = calm;
          m.group = group;
          st.crew.push(m);
        }
        st.phase = "crew";
        st.leaveT = 8;
        if (st.crew.length) this.toast?.(`The aliens are out, looking around. You have about ${calm} seconds: get your bow ready!`, 5);
        else st.phase = null;
      }
      return;
    }
    // The crew is out: the ship leaves after a moment.
    st.leaveT -= 0.5;
    if (st.leaveT <= 0 && shipOk && st.ship.state !== "leave") this._releaseShip(st.ship);
    crew.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const calm = crew[0]?.calmT > 0;
    this._setTarget(crew[0], calm ? `Alien (attacks in ${Math.ceil(crew[0].calmT)} s)` : "Alien");
  }

  // The landing ship is done: it can be hurt and angered again, and leaves.
  _releaseShip(u) {
    u.immune = false;
    u.peaceful = false;
    u.errand = false; // (Round 10: a beacon or a carrier)
    u.tripSpeed = 0;
    u.carrier = false;
    u.beacon = false;
    u.noLeave = false;
    u.missionTarget = false;
    if (this._alive(u) && u.state !== "leave") this.ufos._leave(u);
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
    // (None left and the goal met: progress completes it on its next tick.)
    const a = this._nearestOf(aliens);
    if (a) this._setTarget(a, "Alien");
    else this.target = null;
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
        // (Round 10: nearer or farther by the variant.)
        const [d0, d1] = [[60, 90], [45, 65], [90, 120], [60, 90]][this.mission?.variant ?? 0] || [60, 90];
        for (let i = 0; i < need - active.length; i++) this.crates.drop({ center: list[i % list.length].position, dist: rand(d0, d1) });
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

  // ---------- (Round 10) The dusk: a smooth time-lapse ----------
  // A mission that needs the night eases the clock forward to dusk instead
  // of jumping: over 8-12 s the sky speeds up from normal speed to a peak and
  // slows back down, landing on the hour (warpTime). The plan is the
  // state's, so a new mission (or the chain going off) ends it; online the
  // guests' skies run the same curve from the host's plan (warpInfo).

  // Starts easing the clock to hour h, the next time the clock shows it (just
  // past it: a whole day on). False: it is about there already.
  // (dt: from the frame's own update, the clock already speeds up this frame.)
  _warpTo(h, dt = 0) {
    const sky = this.sky;
    const dist = this._secondsUntil(h);
    if (dist < 4) return false;
    this.state.warp = { t0: sky.time, dist, D: Math.max(8, Math.min(12, dist / 40)), tau: 0, h, still: 0, seen: sky.time, scale: 0 };
    if (dt > 0) this._warpStep(dt);
    return true;
  }

  // Every frame: sets the sky's speed so that its next step (sky.update runs
  // after the director, with the same dt) lands on the curve.
  _warpStep(dt) {
    const sky = this.sky;
    const w = this.state.warp;
    if (!w) {
      // (The plan went with the state: the clock back to normal.)
      if (this._warping) {
        this._warping = false;
        sky.timeScale = 1;
      }
      return;
    }
    this._warping = true;
    if (w.tau >= w.D) {
      // Landed (last frame): normal speed from here.
      this.state.warp = null;
      this._warping = false;
      sky.timeScale = 1;
      this._warpDone(w);
      return;
    }
    // (A clock that doesn't move when it should, e.g. locked or not running: straight there.)
    w.still = sky.time === w.seen && w.scale > 0 ? w.still + dt : 0;
    if (w.still > 1) {
      sky.setHours(w.h);
      w.tau = w.D;
      sky.timeScale = w.scale = 0;
      w.seen = sky.time;
      return;
    }
    // (Real time, not the simulation's clamped step: a slow frame rate takes
    // no longer over it, and the guests' skies, on the room's clock, agree.)
    const now = performance.now();
    const real = w.last != null ? (now - w.last) / 1000 : 0;
    w.last = now;
    w.tau = Math.min(w.D, w.tau + Math.min(0.5, Math.max(dt, real)));
    const len = DAY_LENGTH;
    let d = warpTime(w.t0, w.dist, w.D, w.tau) - sky.time;
    d = (((d % len) + len * 1.5) % len) - len / 2;
    if (Math.abs(d) > 90) {
      // (The clock was moved under it, e.g. the settings' time: the plan is off.)
      this.state.warp = null;
      this._warping = false;
      sky.timeScale = 1;
      return;
    }
    sky.timeScale = w.scale = dt > 0 ? Math.max(0, d / dt) : 0;
    w.seen = sky.time;
  }

  // The plan for the guests (js/net/coop.js): [t0, dist, D, tau] or null.
  warpInfo() {
    const w = this.enabled ? this.state.warp : null;
    return w ? [w.t0, w.dist, w.D, w.tau] : null;
  }

  // The director isn't running this frame (main.js: the main menu): a dusk
  // in progress waits at normal speed (it picks up again, or starts over).
  idle() {
    if (this._warping && this.sky) this.sky.timeScale = 1;
    if (this.state.warp) this.state.warp.last = null; // (the time behind the menu doesn't count)
  }

  // A time-lapse has landed: the night (or the storm) begins.
  _warpDone(w) {
    const m = this.mission;
    if (m?.event === "night" || m?.event === "swarm") {
      const st = this.state;
      st.fastDone = true;
      st.retry = false;
      // (The night's clock starts at dusk.)
      st.nt = 0;
      st.wave = 0;
      this.toast?.("Night falls. Stay near light and shelter; things are coming.", 4);
    }
  }

  // The long night really is at night. By day the clock eases forward to
  // dusk (_warpTo: no jump), then the night runs at normal speed from dusk
  // to dawn, and dawn completes it. A mission started late at night (too
  // little of it left for the landings) eases on to the next dusk the same
  // way, and so does a night the player (online: the whole group) fell in:
  // the night starts over at the next dusk, with no jump back.
  _nightClock(dt) {
    const st = this.state;
    const sky = this.sky;
    if (sky.locked) sky.locked = false; // a frozen clock would never bring dawn
    if (st.warp) return; // (easing to dusk: _warpStep)
    const h = sky.hours;
    const dark = h >= 19.5 || h < 5.5;
    const n = this.night;
    if (!dark) {
      // Day: off to dusk (unless the counted night is already over: dawn completed it).
      if (!st.fastDone || st.retry) {
        if (this._warpTo(19.6, dt)) this.toast?.("Night is falling...", 3);
      }
      return;
    }
    if (!st.fastDone && !st.lateChecked && !st.retry) {
      // (Round 9) Started at night: the night counts from now if most of it is
      // still ahead (the landings need about three minutes); late at night it
      // waits for the next one.
      st.lateChecked = true;
      if (this._secondsUntil(5.5) >= 170) {
        st.fastDone = true;
        st.nt = 0;
        st.wave = 0;
        // (A death earlier tonight, before the mission, doesn't spoil it.)
        n.clean = true;
        n.deathsAt = this.nightDeaths ? this.nightDeaths() : this.stats.world.deaths ?? 0;
        this.toast?.("It's night already. Stay near light and shelter; things are coming.", 4);
      } else {
        n.clean = false; // (this dawn doesn't count: only the next whole night)
        if (this._warpTo(19.6, dt)) this.toast?.("Too little of the night is left: on to the next one...", 4);
      }
    }
    if (st.fastDone && !st.retry && n.active && !n.clean && this.anyAlive) {
      // The player died in the night (online: the whole group): it starts
      // over at the next dusk, the clock easing on to it.
      st.retry = true;
      if (this._warpTo(19.6, dt)) this.toast?.("The night is lost. It starts over at the next dusk...", 4);
    }
    st.nt = (st.nt ?? 0) + (this.anyAlive && !st.retry ? dt : 0);
  }

  // The night's events: three alien landing parties at 30, 90 and 145 s into
  // the night (the night is about 190 s), small enough for the first tier.
  // (Round 9: the swarm's night has its own, tougher parties: SWARM_WAVES.)
  _night(waves = NIGHT_WAVES) {
    const st = this.state;
    const p = this.player.position;
    this.target = null;
    if (!st.fastDone || st.retry || st.warp) {
      this.state.note = st.warp ? "Night is falling..." : st.retry ? "The night starts over at dusk." : "Waiting for the night...";
      return;
    }
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
    this.state.note = n_note(this.night.active, this._secondsUntil(5.5), this._secondsUntil(19.5), st.wave ?? 0, waves.length);
  }

  // 5. Salvage: points at an intact wreck once there is one.
  _intact() {
    const people = this._people();
    let best = null;
    let bd = 1200;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "ufo" || !v.crashed || v.unusable || !v.alive) continue;
      let d = Infinity;
      for (const q of people) d = Math.min(d, v.pos.distanceTo(q.position));
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best) this._setTarget(best, "Intact wreck: board it (F)");
    else {
      this._keepHit();
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
      // Where they land: open ground about 90 blocks from a player. (Round
      // 10: the run's variant of the mission moves it nearer or farther, and
      // adds or takes away one alien.)
      const v = SQUAD_VARIANTS[this.mission?.variant ?? 0] || SQUAD_VARIANTS[0];
      const near = this._anyone().position;
      const at = this._groundSpot(v.dist, 0.15, near) || new THREE.Vector3(near.x + v.dist, 0, near.z);
      st.squad = [];
      // (Online: the squad grows with the group, and there is a leader with
      // the new weapon for every player, while that weapon is still missing.)
      const N = Math.min(12, Math.max(2, spec.n + v.n) * this.groupN);
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
  // (Round 9) The air raid: a wing of them at once (atOnce), arriving
  // together, the next wave a little after the last one is down.
  _fighter(atOnce = this.groupN, cap = 4, wing = false) {
    const st = this.state;
    st.jets = (st.jets || []).filter((j) => j.alive && this.vehicles.vehicles.includes(j));
    const want = Math.min(this._remaining(), atOnce, cap);
    if (st.jets.length < want) {
      st.waitT = (st.waitT ?? 3) - 0.5;
      if (st.waitT <= 0) {
        const j = this.enemyJets.spawn({ hostile: true, dist: 900, center: this._anyone().position });
        if (j) {
          j.mission = true;
          st.jets.push(j);
        }
        // (Round 9 fix: the rest of the wave close behind, the next wave a
        // while after this one is down. It used to be the other way round: a
        // second fighter came 20-30 s after the first.)
        st.waitT = st.jets.length < want ? (wing ? 1 : 8) : wing ? 20 : 30;
      }
    }
    for (const j of st.jets) j.provoked = Math.max(j.provoked, 30);
    const j = this._nearestOf(st.jets);
    if (j) this._setTarget(j, st.jets.length > 1 ? `Enemy fighter (${st.jets.length})` : "Enemy fighter");
    else this.target = null;
  }

  // 11. A raid on the nearest village: three raiders burn it until they are
  // shot down. (Round 9: they stay until then, damage and all: no leaving
  // and coming back with fresh ships. More come only if the goal grows, a
  // player joining.)
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
        this.target = { pos: center, label: `${place.name}: more raiders are coming`, follow: null };
        return;
      }
      st.waitT = 10;
      st.raiders = [];
      // (Round 10) The variant: fast raiders firing bursts, or two gunships leading them.
      const v = this.mission?.variant ?? 0;
      for (let i = 0; i < Math.min(left, 6); i++) {
        const big = left >= 3 && (i === 0 || (v === 2 && i === 1));
        const style = v === 1 ? (i % 2 ? "rapid" : "volley") : i % 2 ? "heavy" : "sweep";
        const u = this.ufos.spawn({ size: big ? "medium" : "small", style, pos: { x: place.x + rand(-40, 40), y: place.y + rand(28, 40), z: place.z + rand(-40, 40) }, hidden: true });
        u.raider = true;
        this._keepTarget(u);
        u.home = center.clone();
        u.tether = 60;
        u.dodgeMul = v === 1 ? 0.8 : 0.6;
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
    const d = center.distanceTo(p);
    if (d > 180 || !raiders.length) this.target = { pos: center, label: `${place.name} under attack`, follow: null };
    else {
      raiders.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      this._setTarget(raiders[0], `Raider (${raiders.length} left)`);
    }
  }

  // 12. A large UFO nearby. (Round 9) The same ship from start to finish:
  // it is the mission's (it never leaves, despawns or hides: see
  // _keepTarget), it is called back toward the players when it strays, and
  // it keeps its damage. Only once it is down does another come (when the
  // group's goal asks for more).
  // (Round 9) 25. Titan: the same, with a giant (a fixed, tough hull that
  // grows with the group; it comes for the players, its crew fights).
  _large(size = "large") {
    const st = this.state;
    const giant = size === "giant";
    const label = giant ? "Titan" : "Large UFO";
    if (st.big && !this._alive(st.big)) st.big = null;
    if (!st.big && this._remaining() > 0) {
      // A ship that size already about (the nearest to anyone), else a new one.
      const t = this._nearestUfo(900, label, (u) => u.S.idx >= (giant ? 4 : 2));
      if (t) st.big = t.follow;
      else {
        st.waitT = (st.waitT ?? 3) - 0.5;
        if (st.waitT <= 0) {
          st.waitT = 30;
          st.big = this._spawnUfo({ size }, giant ? 650 : 450, false);
          if (giant) {
            st.big.maxHealth = st.big.health = Math.round(9000 * (this.ufos.groupHealth ?? 1));
            this.toast?.("A TITAN is coming! Follow the marker, and bring everything you have.", 5);
          }
        }
      }
      if (st.big) this._keepTarget(st.big);
    }
    if (!st.big) {
      this.target = null;
      return;
    }
    this._leash(st.big, giant ? 400 : 300, giant ? 300 : 260);
    if (giant && !st.big.hostile && st.big.age > 20) this.ufos.anger(st.big, 120);
    this._setTarget(st.big, label);
  }

  // ---------- (Round 9) 24. Abductions ----------
  // Abductor UFOs over the nearest village beam up its people and animals:
  // the director hands each calm one a creature near the place to take
  // (fighting back comes first). They are the mission's: kept until shot
  // down, more only if the group's goal grows.
  _abduct() {
    const st = this.state;
    const p = this.player.position;
    if (!st.place) st.place = this._raidPlace(p);
    const place = st.place;
    const center = new THREE.Vector3(place.x, place.y, place.z);
    const ships = (st.ships || []).filter((u) => this._alive(u));
    st.ships = ships;
    const left = this._remaining();
    if (ships.length === 0 && left > 0) {
      st.waitT = (st.waitT ?? 0) - 0.5;
      if (st.waitT > 0) {
        this.target = { pos: center, label: `${place.name}: more abductors are coming`, follow: null };
        return;
      }
      st.waitT = 10;
      const k = Math.min(left, 5);
      for (let i = 0; i < k; i++) {
        const u = this.ufos.spawn({ size: i === 0 && left >= 3 ? "medium" : "small", style: "abductor", pos: { x: place.x + rand(-45, 45), y: place.y + rand(30, 42), z: place.z + rand(-45, 45) }, hidden: true });
        u.abductor = true;
        this._keepTarget(u);
        u.home = center.clone();
        u.tether = 70;
        u.dodgeMul = 0.5;
        // (Round 10: the variant where one of them, the last, hunts the players instead.)
        if (this.mission?.variant === 1 && i === k - 1 && k > 1) {
          u.hunter = true;
          this.ufos.anger(u, 90);
        }
        ships.push(u);
      }
      this.toast?.(`ABDUCTIONS! UFOs are beaming up the people of the ${place.name.toLowerCase()}: follow the marker.`, 5);
      return;
    }
    // Each calm abductor is handed a creature near the place to take.
    for (const u of ships) {
      if (u.hunter) {
        this._leash(u, 200, 180);
        this.ufos.anger(u, 60);
        continue;
      }
      if (u.dash || u.state === "attack" || u.state === "react" || u.state === "beam") continue;
      if (u.state === "trick" && u.trick === "abduct" && u.target && !u.target.dead) continue;
      const prey = this._prey(center, 80);
      if (!prey) continue;
      u.state = "trick";
      u.trick = "abduct";
      u.target = prey;
      u.timer = 30;
    }
    const d = center.distanceTo(p);
    if (d > 180 || !ships.length) this.target = { pos: center, label: `${place.name}: abductions`, follow: null };
    else this._setTarget(this._nearestOf(ships), `Abductor (${ships.length} left)`);
  }

  // A villager or a farm animal near c that no ship has in its beam yet.
  _prey(c, r) {
    let best = null;
    let bd = r;
    for (const m of this.mobs.mobs) {
      if (m.dead || m.spec.hostile || m.spec.flies || m.beamedBy || m.abductedBy || m.isRemotePlayer) continue;
      const d = Math.hypot(m.pos.x - c.x, m.pos.z - c.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  // The raid missions' place: the nearest village, else the airport, else a spot out there.
  _raidPlace(p) {
    const v = this.terrain.villages.nearestVillage(p.x, p.z, 2500);
    if (v) return { x: v.x, y: v.groundY, z: v.z, name: "Village" };
    const a = this.airports.nearest(2500);
    if (a) return { x: a.site.x, y: a.site.y, z: a.site.z, name: "Airport" };
    return { x: p.x + 400, y: this.terrain.heightAt(Math.floor(p.x + 400), Math.floor(p.z)), z: p.z, name: "Outpost" };
  }

  // ---------- (Round 9) 26. Night of the swarm ----------
  // The long night's clock (fast to dusk; the whole group down starts the
  // night over), with a swarm of small, fast ships kept over the players all
  // night and three landing parties, red and blue aliens among them.
  _swarm() {
    const st = this.state;
    if (st.fastDone && !st.retry && !st.warp && this.night.active) this._keepSwarm(2 + this.groupN, 420);
    this._night(SWARM_WAVES);
    this._nightHunters();
    // The marker: a landing party if there is one, else the nearest of the swarm.
    if (!this.target && this.night.active) this.target = this._nearestUfo(600, "Swarm UFO", (u) => u.swarm);
  }

  // Keeps n swarm ships (small, fast, angry) within range of the players.
  _keepSwarm(n, range) {
    const st = this.state;
    st.swarmT = (st.swarmT ?? 1) - 0.5;
    if (st.swarmT > 0) return;
    const people = this._people();
    const near = this.ufos.ufos.filter((u) => u.swarm && this._alive(u) && people.some((q) => u.pos.distanceTo(q.position) < range)).length;
    if (near >= n) {
      st.swarmT = 3;
      return;
    }
    st.swarmT = 4;
    const who = this._anyone();
    const u = this._spawnUfo({ size: "small", style: Math.random() < 0.5 ? "rapid" : "volley", personality: "fighter" }, rand(170, 240), true, who.position);
    u.swarm = true;
    u.noLeave = true;
    this.ufos.anger(u, 120);
  }

  // ---------- (Round 9) 27. The fortress ----------
  // A garrison of mixed aliens (red brutes, blue and gray, two tougher
  // leaders) dug in on open ground some way off, heavy UFOs over it. It is
  // set out when someone comes near, and comes back (after a while) only if
  // the group's goal still asks for more.
  _fortress() {
    const st = this.state;
    if (!st.at) {
      const at = this._groundSpot(this.mission?.variant === 3 ? 200 : 260, 0.2, this._anyone().position);
      if (!at) return;
      st.at = { x: at.x, y: at.y, z: at.z };
    }
    const at = new THREE.Vector3(st.at.x, st.at.y, st.at.z);
    let d = Infinity;
    for (const q of this._people()) d = Math.min(d, at.distanceTo(q.position));
    st.garrison = (st.garrison || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    st.guards = (st.guards || []).filter((u) => this._alive(u));
    const left = this._remaining();
    const ready = !!this.mobs.world.getChunk(Math.floor(at.x) >> 4, Math.floor(at.z) >> 4);
    if (st.garrison.length === 0 && left > 0 && ready && d < 420) {
      st.waitT = (st.waitT ?? 0) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = 25;
        // (Round 10) The variant: a garrison of brutes, or of sharpshooters.
        const kinds = FORTRESS_KINDS[this.mission?.variant ?? 0] || FORTRESS_KINDS[0];
        const n = Math.min(16, Math.max(left, 6 + 2 * this.groupN));
        for (let i = 0; i < n; i++) {
          const m = this._spawnAlien(kinds[i % kinds.length], 7 + (i % 3) * 3, at);
          if (!m) continue;
          if (i < 2) {
            m.leader = true;
            m.maxHealth = m.health = Math.round(m.health * 1.5);
          }
          st.garrison.push(m);
        }
        const dug = st.garrison.length;
        if (dug) this.toast?.(`The fortress: ${dug} alien${dug === 1 ? "" : "s"} dug in. Storm it!`, 4);
      }
    }
    // Its guard ships: heavy hitters, kept over it.
    st.guardT = (st.guardT ?? 0) - 0.5;
    if (st.guards.length < 1 + Math.ceil(this.groupN / 2) + (this.mission?.variant === 3 ? 1 : 0) && st.guardT <= 0 && d < 700) {
      st.guardT = 35;
      const ground = Math.max(this.terrain.heightAt(Math.floor(at.x), Math.floor(at.z)), SEA_LEVEL);
      const u = this.ufos.spawn({ size: "medium", style: "heavy", pos: { x: at.x + rand(-40, 40), y: ground + 40, z: at.z + rand(-40, 40) }, hidden: true });
      this._keepTarget(u);
      u.home = at.clone();
      u.tether = 80;
      st.guards.push(u);
    }
    for (const u of st.guards) if (d < 320 && !u.hostile) this.ufos.anger(u, 200);
    const gn = st.garrison.length;
    if (d > 150 || !gn) this.target = { pos: at, label: gn ? `The fortress (${gn} alien${gn === 1 ? "" : "s"})` : "The fortress", follow: null };
    else this._setTarget(this._nearestOf(st.garrison), `Fortress alien (${st.garrison.length} left)`);
  }

  // ---------- (Round 10) The hunters: abductor ships after the players ----------
  // Abductor ships that hunt the players on foot: each flies in over a player
  // and beams them up (ufos.js: its tractor beam; a guest is lifted on their
  // own machine), and a hit breaks the beam. They are the mission's (kept,
  // leashed to the players, angry); one shot down is replaced a while later.

  // Keeps n hunters about (opts.big: one of them a medium ship, wide beam).
  _keepHunters(n, opts = {}) {
    const st = this.state;
    const was = st.hunters?.length ?? 0;
    st.hunters = (st.hunters || []).filter((u) => this._alive(u));
    // (One went down: the next comes after a while, not at once.)
    if (st.hunters.length < was) st.huntT = Math.max(st.huntT ?? 0, 15);
    for (const u of st.hunters) {
      this._leash(u, 200, 180);
      this.ufos.anger(u, 60); // (and it never loses interest)
    }
    if (st.hunters.length >= n) return;
    st.huntT = (st.huntT ?? 2) - 0.5;
    if (st.huntT > 0) return;
    st.huntT = 5;
    const who = this._anyone();
    const big = opts.big && !st.hunters.some((u) => u.size !== "small");
    const design = ["saucer", "saucer_disc", "saucer_domed"][Math.floor(Math.random() * 3)];
    const u = this._spawnUfo({ size: big ? "medium" : "small", design, style: "abductor" }, rand(130, 180), true, who.position);
    u.hunter = true;
    this._keepTarget(u);
    u.homeOf = who;
    u.dodgeMul = 0.5;
    this.ufos.anger(u, 90);
    st.hunters.push(u);
  }

  // The hunters give up and go (a lost night, a time-lapse to dusk).
  _releaseHunters() {
    const st = this.state;
    for (const u of st.hunters || []) {
      u.hunter = false;
      u.missionTarget = false;
      u.noLeave = false;
      if (this._alive(u) && u.state !== "leave") this.ufos._leave(u);
    }
    st.hunters = [];
  }

  // How many players were taken (lifted into a ship) since the last look: the
  // world's "abducted" count (a guest's is reported to the host: coop.js).
  _taken() {
    const st = this.state;
    const n = this.stats.world.abducted ?? 0;
    const k = st.abd == null ? 0 : Math.max(0, n - st.abd);
    st.abd = n;
    return k;
  }

  // The long night's variants with hunters (and the swarm's): from a little
  // into the night, one hunter (one more for every two extra players).
  _nightHunters() {
    const m = this.mission;
    const v = m?.variant ?? 0;
    if (!((m?.id === "long_night" && (v === 1 || v === 3)) || (m?.id === "swarm" && v === 2))) return;
    const st = this.state;
    if (st.fastDone && !st.retry && !st.warp && this.night.active && (st.nt ?? 0) > 40) {
      if (!st.huntTold) {
        st.huntTold = true;
        this.toast?.("Abductor ships are hunting you! Keep out from under their beams, or get under a roof.", 5);
      }
      this._keepHunters(1 + Math.floor((this.groupN - 1) / 2));
    } else if (st.hunters?.length) {
      this._releaseHunters();
      st.huntTold = false;
    }
  }

  // "Don't look up": hold out while the hunters are after you. The clock (the
  // world's holdTime) runs while anyone is alive; every player taken sets it
  // back a minute (progress.setBack). Halfway (twice on the long hunt) a
  // landing party comes to flush the players out of cover.
  _hunted() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    const o = this.progress.objectives(this.stats.world)[0];
    const goal = o?.goal ?? 150;
    const held = o?.value ?? 0;
    if (!st.told) {
      st.told = true;
      this._taken(); // (from now on)
      this.toast?.("Abductor ships are coming for you: keep out from under their beams!", 5);
    }
    this._keepHunters(Math.min(5, 1 + this.groupN + (v === 1 ? 1 : 0)), { big: v === 3 });
    const taken = this._taken();
    if (taken) {
      this.progress.setBack("holdTime", TAKEN_SETBACK * taken, this.stats.world);
      this.toast?.(this.players ? "Someone was taken! The clock goes back a minute." : "You were taken! The clock goes back a minute.", 4);
    }
    if (this.anyAlive && st.hunters.length && held < goal) this._addHold(0.5, this._people());
    const marks = v === 2 ? [0.3, 0.7] : [0.5];
    st.party = st.party ?? 0;
    if (st.party < marks.length && held >= goal * marks[st.party]) {
      st.party++;
      st.alive = this._wave(this._anyone().position, 55, "A landing party is down nearby: they're here to flush you out!");
    }
    st.alive = (st.alive || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    const t = this._nearestUfo(500, "Abductor (hunting you)", (u) => u.hunter);
    if (t) this.target = t;
    else if (st.alive.length) this._setTarget(this._nearestOf(st.alive), `Landing party (${st.alive.length})`);
    else this.target = null;
    st.note = held >= goal ? "" : `Hold out: ${clock(goal - held)} to go. Keep out from under the beams.`;
  }

  // (Round 10) A count of holding ground (the world's holdTime, seconds):
  // the host's own if it is among the ones holding, else the world's.
  _addHold(sec, holders) {
    if (holders.includes(this.player)) this.stats.add("holdTime", sec);
    else this.stats.addWorld("holdTime", sec);
  }

  // A landing party of the place's kinds (more for a bigger group, 60% per
  // extra player) dropped `dist` blocks from `near`: the aliens, at once.
  _wave(near, dist, text) {
    const kinds = this._waveKinds();
    const at = this._groundSpot(dist, 0.2, near) || new THREE.Vector3(near.x + dist, 0, near.z);
    const n = Math.round(kinds.length * (1 + 0.6 * (this.groupN - 1)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = this._spawnAlien(kinds[i % kinds.length], 5, at);
      if (m) out.push(m);
    }
    if (out.length) {
      this._dropship(at, kinds[0]);
      if (text) this.toast?.(text, 4);
    }
    return out;
  }

  // The landing parties' kinds, by the place's tier: greens first, then grays, then brutes and blues.
  _waveKinds() {
    const t = this.mission?.tier ?? 1;
    if (t <= 1) return ["alien", "alien"];
    if (t === 2) return ["alien", "alien", "alien_gray"];
    if (t === 3) return ["alien_gray", "alien", "alien_gray"];
    if (t === 4) return ["alien_red", "alien_gray", "alien"];
    return ["alien_red", "alien_blue", "alien_gray"];
  }

  // ---------- (Round 10) Holding ground: the beacon, the crash site ----------

  // Who is holding the zone ({ x, y, z, r }): the players alive on foot in
  // it, and how many aliens are in it (any: the clock stops, contested).
  _zoneState(z) {
    const inside = (p) => Math.hypot(p.x - z.x, p.z - z.z) < z.r && Math.abs(p.y - z.y) < 12;
    const people = this._people().filter((q) => !q.dead && !q.vehicle && inside(q.position));
    let foes = 0;
    for (const m of this.mobs.mobs) if (!m.dead && m.spec.alien && inside(m.pos)) foes++;
    return { people, foes };
  }

  // The zone's place saved with the chain (a reload keeps it), or null.
  _savedPlace() {
    const pl = this.progress.place;
    return pl?.mission === this.missionId && Number.isFinite(pl.x) && Number.isFinite(pl.y) && Number.isFinite(pl.z) ? pl : null;
  }

  // The fight over a zone once someone has reached it: landing parties every
  // `every` seconds (while not too many of theirs are still about), the clock
  // while it is held, and an air-cover gunship over it (gun). Sets the marker
  // and the note; `what` names the place.
  _holdFight(z, every, firstIn, gun, what) {
    const st = this.state;
    const c = new THREE.Vector3(z.x, z.y, z.z);
    const { people, foes } = this._zoneState(z);
    const o = this.progress.objectives(this.stats.world)[0];
    const left = o ? o.goal - o.value : 0;
    st.alive = (st.alive || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    if (!st.started && people.length) {
      st.started = true;
      st.waveT = Math.min(st.waveT ?? firstIn, firstIn);
    }
    if (st.started && left > 0) {
      st.waveT = (st.waveT ?? firstIn) - 0.5;
      if (st.waveT <= 0 && st.alive.length < 4 + 3 * this.groupN) {
        st.waveT = every;
        st.alive.push(...this._wave(c, rand(55, 75), `A squad is dropping in on the ${what}!`));
      }
      if (people.length && !foes) this._addHold(0.5, people);
      if (gun) {
        st.guns = (st.guns || []).filter((u) => this._alive(u));
        st.gunT = (st.gunT ?? 4) - 0.5;
        if (!st.guns.length && st.gunT <= 0) {
          st.gunT = 40;
          const ground = Math.max(this.terrain.heightAt(Math.floor(z.x), Math.floor(z.z)), SEA_LEVEL);
          const u = this.ufos.spawn({ size: "medium", style: "heavy", pos: { x: z.x + rand(-60, 60), y: ground + 40, z: z.z + rand(-60, 60) }, hidden: true });
          this._keepTarget(u);
          u.home = c.clone();
          u.tether = 70;
          st.guns.push(u);
        }
        for (const u of st.guns) this.ufos.anger(u, 60);
      }
    }
    // The marker: the place while nobody holds it, an alien in it, else the nearest of the squads.
    const inZone = foes ? this.mobs.mobs.filter((m) => !m.dead && m.spec.alien && Math.hypot(m.pos.x - z.x, m.pos.z - z.z) < z.r) : [];
    if (left <= 0) this.target = null;
    else if (!people.length) this.target = { pos: c, label: `${what[0].toUpperCase()}${what.slice(1)}: hold it`, follow: null };
    else if (inZone.length) this._setTarget(this._nearestOf(inZone), `Alien at the ${what}: clear it`);
    else if (st.alive.length) this._setTarget(this._nearestOf(st.alive), `Alien squad (${st.alive.length})`);
    else this.target = { pos: c, label: `${what[0].toUpperCase()}${what.slice(1)}: hold it`, follow: null };
    st.note = left <= 0 ? "" : !st.started ? `Get to the ${what}.` : foes ? `Contested! ${foes} alien${foes === 1 ? "" : "s"} at the ${what}: clear it.` : people.length ? `Holding: ${clock(left)} to go.` : `Nobody at the ${what}: the clock has stopped (${clock(left)} to go).`;
    return { people, left };
  }

  // "Hold the line": our radio beacon, on open ground near the group, to be
  // held for a while against squads dropping in (the variant: how long, how
  // often, a gunship strafing it).
  _hold() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    if (!st.zone) {
      const pl = this._savedPlace();
      let at = pl;
      if (!at) {
        at = this._groundSpot(80, 0.25, this._anyone().position);
        if (!at) return;
        this.progress.place = { mission: this.missionId, x: at.x, y: at.y, z: at.z };
        this.toast?.("Our radio beacon is marked: get there and hold it!", 4);
      }
      st.zone = { x: at.x, y: at.y, z: at.z, r: 12, kind: "beacon" };
    }
    this._holdFight(st.zone, [28, 22, 32, 28][v], 6, v === 3, "beacon");
  }

  // "Crash site": a UFO comes down on fire nearby (a real crash, in one
  // piece, no crew); the players race the recovery team to it and hold it,
  // then loot the wreck (walking up to it).
  _crashSite() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    if (!st.zone) {
      const pl = this._savedPlace();
      if (pl) st.zone = { x: pl.x, y: pl.y, z: pl.z, r: 16, kind: "site" };
      else if (!st.ship) {
        st.waitT = (st.waitT ?? 1) - 0.5;
        if (st.waitT > 0) return;
        st.waitT = 10;
        const at = this._groundSpot(110, 0.25, this._anyone().position);
        if (!at) return;
        // It streaks in from the side, already burning, and comes down about there.
        const a = Math.random() * Math.PI * 2;
        const u = this.ufos.spawn({ size: "small", design: ["saucer", "saucer_disc", "saucer_domed"][Math.floor(Math.random() * 3)], pos: { x: at.x - Math.cos(a) * 55, y: at.y + 75, z: at.z - Math.sin(a) * 55 } });
        u.crashPlan = { exploded: false, crew: 0 };
        this.ufos.damage(u, u.health + 1, false);
        u.vel.set(Math.cos(a) * 20, -6, Math.sin(a) * 20);
        st.ship = u;
        st.at = { x: at.x, y: at.y, z: at.z };
        this.toast?.("A UFO is going down nearby, on fire! Get to the crash site before their recovery team does.", 5);
      }
      if (!st.zone) {
        const u = st.ship;
        if (u && this.ufos.ufos.includes(u) && u.state !== "gone") {
          this._setTarget(u, "Crashing UFO");
          return;
        }
        // Down: the site is where it hit (a lost ship: where it was headed).
        let p = u ? u.pos : st.at;
        // (Into a lake: the site is the dry spot it was headed for.)
        if (this.world.getChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4) && IS_WET[this.world.getBlock(Math.floor(p.x), this.world.surfaceY(Math.floor(p.x), Math.floor(p.z)) + 1, Math.floor(p.z))]) p = st.at;
        const x = Math.floor(p.x);
        const z = Math.floor(p.z);
        const y = this.world.getChunk(x >> 4, z >> 4) ? this.world.surfaceY(x, z) + 1 : Math.max(this.terrain.heightAt(x, z), SEA_LEVEL) + 1;
        st.zone = { x: p.x, y, z: p.z, r: 16, kind: "site" };
        st.ship = null;
        this.progress.place = { mission: this.missionId, x: p.x, y, z: p.z };
        st.waveT = 18; // (the recovery team's first landing: a head start for whoever runs)
        st.started = true;
        this.toast?.("It's down! Hold the crash site: their recovery team is on its way.", 4);
      }
    }
    const z = st.zone;
    const { left } = this._holdFight(z, [30, 24, 34, 30][v], 18, v === 3, "crash site");
    if (left > 0 || this._remaining(1) <= 0) return;
    // Held: the wreck is open. Whoever walks up to it loots it.
    const c = new THREE.Vector3(z.x, z.y, z.z);
    const looter = this._people().find((q) => !q.dead && !q.vehicle && Math.hypot(q.position.x - z.x, q.position.z - z.z) < 7 && Math.abs(q.position.y - z.y) < 10);
    if (looter && !st.looted) {
      st.looted = true;
      if (looter === this.player) this.stats.add("wrecksLooted");
      else this.stats.addWorld("wrecksLooted");
      this.dropLoot?.("ufo", "large", c.clone().setY(z.y + 1));
      this.toast?.("The wreck is yours: grab what fell out of it!", 4);
    }
    this.target = { pos: c, label: "The wreck: loot it (walk up to it)", follow: null };
    st.note = "The site is held: loot the wreck.";
  }

  // ---------- (Round 10) Run for cover ----------
  // A shelter a few hundred blocks off (a village, else open ground) and a
  // bombardment from orbit (the airstrike's rocks, as the meteor storm's,
  // each announced by a red ring) aimed near whoever is still out in the
  // open: wide at first, closer as the time runs out, and once it has run
  // out, close. Everyone counts once, on reaching the shelter (online the
  // goal is one per player). A player who dies starts again from where the
  // run began. (The variant: nearer with less time, farther with more, or a
  // spotter UFO whose loss makes the rocks fall wide.)
  _evac() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    if (!st.zone) {
      const pl = this._savedPlace();
      let at = pl;
      let from = pl && Number.isFinite(pl.fx) && Number.isFinite(pl.fz) ? { x: pl.fx, z: pl.fz } : null;
      if (!at || !from) {
        const people = this._people();
        from = { x: 0, z: 0 };
        for (const q of people) {
          from.x += q.position.x / people.length;
          from.z += q.position.z / people.length;
        }
        const dist = [260, 200, 330, 260][v];
        const vil = this.terrain.villages.nearestVillage(from.x, from.z, dist * 1.4);
        const vd = vil ? Math.hypot(vil.x - from.x, vil.z - from.z) : 0;
        at = vil && vd > dist * 0.6 ? { x: vil.x, y: vil.groundY + 1, z: vil.z } : this._farSpot(from, dist) || this._groundSpot(dist * 0.5, 0.3, this._anyone().position);
        if (!at) return;
        this.progress.place = { mission: this.missionId, x: at.x, y: at.y, z: at.z, fx: from.x, fz: from.z };
        this.toast?.("Bombardment incoming! Run for the shelter (marked), and keep out of the red rings!", 5);
      }
      st.zone = { x: at.x, y: at.y, z: at.z, r: 12, kind: "shelter" };
      st.from = from;
      // (A walk takes about a second for every four blocks: time enough, less of it on the variant that says so.)
      st.total = st.timeLeft = Math.round(Math.hypot(at.x - from.x, at.z - from.z) / [2.2, 2.8, 2, 2.2][v] + [25, 15, 30, 25][v]);
      st.rings = [];
      st.arrived = new Set();
      st.strikeT = 7;
    }
    const z = st.zone;
    const c = new THREE.Vector3(z.x, z.y, z.z);
    const people = this._people().filter((q) => !q.dead);
    if (this.anyAlive) st.timeLeft -= 0.5;
    // Arrivals (each player once).
    for (const q of people) {
      if (st.arrived.has(q) || Math.hypot(q.position.x - z.x, q.position.z - z.z) >= z.r || Math.abs(q.position.y - z.y) >= 10) continue;
      st.arrived.add(q);
      if (q === this.player) this.stats.add("evacuated");
      else this.stats.addWorld("evacuated");
      const who = this.nameOf?.(q);
      this.toast?.(who ? `${who} made it to the shelter!` : "You made it to the shelter!", 3);
    }
    // The spotter (the variant): it makes the rocks fall closer while it flies.
    if (v === 3 && !st.spotterDown) {
      if (!this._alive(st.spotter)) {
        st.spotT = (st.spotT ?? 2) - 0.5;
        if (st.spotT <= 0) {
          st.spotT = 20;
          const who = this._anyone();
          const u = this._spawnUfo({ size: "small", style: "volley" }, rand(80, 110), true, who.position);
          this._keepTarget(u);
          u.spotter = true;
          u.homeOf = who;
          u.tether = 90;
          u.dodgeMul = 0.4;
          st.spotter = u;
        }
      } else this._leash(st.spotter, 120, 90);
    }
    // The bombardment, near whoever is still out in the open (not too near the shelter).
    const out = people.filter((q) => !st.arrived.has(q));
    st.rings = st.rings.filter((r) => r.t > -1);
    st.strikeT -= 0.5;
    if (out.length && st.strikeT <= 0 && this.weapons?.airstrike) {
      const late = st.timeLeft <= 0;
      const frac = Math.max(0, st.timeLeft / Math.max(1, st.total));
      st.strikeT = (late ? 2.6 : 3.4 + 3.6 * frac) / Math.sqrt(out.length);
      const spot = v === 3 ? (this._alive(st.spotter) ? -4 : 6) : 0;
      const q = out[Math.floor(Math.random() * out.length)];
      const vel = q.velocity;
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.max(2, (late ? rand(3, 10) : rand(7, 16)) + spot);
        const x = Math.floor(q.position.x + (vel ? vel.x * 2.5 : 0) + Math.cos(a) * d);
        const zz = Math.floor(q.position.z + (vel ? vel.z * 2.5 : 0) + Math.sin(a) * d);
        if (Math.hypot(x - z.x, zz - z.z) < z.r + 8) continue; // (the shelter holds)
        const y = Math.max(this.world.heightAt(x, zz), SEA_LEVEL) + 1;
        const target = new THREE.Vector3(x + 0.5, y, zz + 0.5);
        const count = late ? 2 : 1;
        this.weapons.airstrike.call(target, { count, spread: 6, delay: 4.5, angle: 25, source: "meteor" });
        st.rings.push({ pos: target, t: 4.7, fx: 0, r: count > 1 ? 8 : 5 });
        break;
      }
    }
    if (st.timeLeft <= 0 && !st.lateTold && out.length) {
      st.lateTold = true;
      this.toast?.("Time's up: the bombardment is on in earnest! Get to the shelter!", 4);
    }
    const goal = this.progress.objectives(this.stats.world)[0]?.goal ?? 1;
    this.target = { pos: c, label: goal > 1 ? `Shelter (${st.arrived.size}/${goal} in)` : "Shelter", follow: null };
    st.note = !out.length ? "Everyone is in the shelter." : st.timeLeft > 0 ? `The rocks fall closer in ${clock(st.timeLeft)}. Keep out of the red rings.` : "The bombardment is on! Get to the shelter!";
  }

  // Open, dry, flattish ground about `dist` blocks from c, by the terrain's
  // heights (it needn't be loaded yet; the live ground where it is), or null.
  _farSpot(c, dist) {
    const T = this.terrain;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = dist * (k < 24 ? rand(0.9, 1.1) : rand(0.55, 0.8));
      const x = Math.floor(c.x + Math.cos(a) * d);
      const z = Math.floor(c.z + Math.sin(a) * d);
      const h = T.heightAt(x, z);
      if (h <= SEA_LEVEL + 1) continue;
      let flat = true;
      for (const [dx, dz] of NEAR) if (Math.abs(T.heightAt(x + dx * 2, z + dz * 2) - h) > 2) flat = false;
      if (!flat && k < 32) continue;
      const loaded = this.world.getChunk(x >> 4, z >> 4);
      if (loaded && IS_WET[this.world.getBlock(x, this.world.surfaceY(x, z), z)]) continue;
      return { x: x + 0.5, y: (loaded ? this.world.surfaceY(x, z) : h) + 1, z: z + 0.5 };
    }
    return null;
  }

  // ---------- (Round 10) Rescue: carriers running off with captives ----------
  // Abductor ships rise from a village (or a farm out in the fields) with
  // people and animals aboard: they hover a few seconds, then make off low
  // and slow (their own pace: ufos.js tripSpeed), climbing, and never stop to
  // fight (errand). Shot down, their captives fall free (set down below);
  // one that gets far enough away is gone, and another wave comes.
  _rescue() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    if (!st.place) {
      const p = this._anyone().position;
      const vil = this.terrain.villages.nearestVillage(p.x, p.z, 700);
      if (vil) st.place = { x: vil.x, y: vil.groundY, z: vil.z, name: "village", kinds: ["villager", "villager", "cow", "sheep"] };
      else {
        const at = this._groundSpot(120, 0.3, p) || p;
        st.place = { x: at.x, y: at.y, z: at.z, name: "farm", kinds: ["cow", "sheep", "pig", "chicken"] };
      }
    }
    const place = st.place;
    const center = new THREE.Vector3(place.x, place.y, place.z);
    const escape = 360;
    st.carriers = (st.carriers || []).filter((u) => this._alive(u));
    for (const u of [...st.carriers]) {
      if (Math.hypot(u.pos.x - center.x, u.pos.z - center.z) < escape) continue;
      // Got away.
      st.carriers.splice(st.carriers.indexOf(u), 1);
      u.carrier = false;
      this._releaseShip(u);
      this.toast?.("A carrier got away with its captives!", 3);
    }
    const left = this._remaining();
    if (st.carriers.length === 0 && left > 0) {
      st.waitT = (st.waitT ?? 1) - 0.5;
      if (st.waitT > 0) {
        this.target = { pos: center, label: `The ${place.name}: more carriers are coming`, follow: null };
        st.note = "";
        return;
      }
      st.waitT = 12;
      const n = Math.min(left, 2 + (this.groupN > 1 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const x = place.x + rand(-30, 30);
        const z = place.z + rand(-30, 30);
        const ground = Math.max(this.terrain.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL);
        const u = this.ufos.spawn({ size: "small", design: "saucer_domed", style: "abductor", pos: { x, y: ground + 60, z }, hidden: true });
        u.carrier = true;
        u.peaceful = true;
        u.errand = true;
        this._keepTarget(u);
        u.dodgeMul = 0;
        u.blinkT = 1e9;
        u.tripSpeed = v === 3 ? 9.5 : 7;
        u.captives = 1 + Math.floor(Math.random() * 3);
        u.crashPlan = { crew: 0 }; // (its crew is busy: no aliens climb out)
        u.loadT = rand(5, 9);
        u.state = "trick";
        u.trick = "land";
        u.timer = 1e9;
        u.waypoint = new THREE.Vector3(x, ground + rand(16, 22) + u.info.bottom * u.radius, z);
        st.carriers.push(u);
      }
      // The escort (the variant): a gunship with them, the mission's while they fly.
      if (v === 1) {
        const ground = Math.max(this.terrain.heightAt(Math.floor(place.x), Math.floor(place.z)), SEA_LEVEL);
        const e = this.ufos.spawn({ size: "medium", style: "sweep", pos: { x: place.x + rand(-40, 40), y: ground + 45, z: place.z + rand(-40, 40) }, hidden: true });
        this._keepTarget(e);
        e.home = center.clone();
        e.tether = 120;
        this.ufos.anger(e, 120);
        (st.escorts = (st.escorts || []).filter((u) => this._alive(u))).push(e);
      }
      this.toast?.(`Carriers are rising from the ${place.name} with captives aboard: shoot them down before they get away!`, 5);
      return;
    }
    // Each carrier: loads up over the place, then makes off, away from the players, climbing.
    const people = this._people();
    for (const u of st.carriers) {
      if (u.state !== "trick" || u.trick !== "land") {
        if (u.beam) u.beam.set(false);
        u.state = "trick";
        u.trick = "land";
        u.timer = 1e9;
      }
      if (!u.runDir) {
        u.loadT -= 0.5;
        if (u.loadT > 0) continue;
        let near = null;
        let bd = Infinity;
        for (const q of people) {
          const d = q.position.distanceTo(u.pos);
          if (d < bd) {
            bd = d;
            near = q;
          }
        }
        const a = near ? Math.atan2(u.pos.z - near.position.z, u.pos.x - near.position.x) + rand(-1, 1) : Math.random() * Math.PI * 2;
        u.runDir = new THREE.Vector2(Math.cos(a), Math.sin(a));
        u.runT = 0;
      }
      u.runT += 0.5;
      const x = u.pos.x + u.runDir.x * 40;
      const z = u.pos.z + u.runDir.y * 40;
      const ground = Math.max(this.terrain.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL);
      u.waypoint = new THREE.Vector3(x, ground + u.info.bottom * u.radius + Math.min(70, 18 + u.runT * 1.2), z);
    }
    const s = this._nearestOf(st.carriers);
    if (s) this._setTarget(s, `Carrier (${st.carriers.length} in the air)`);
    else this.target = null;
    const far = s ? Math.round(Math.hypot(s.pos.x - center.x, s.pos.z - center.z)) : 0;
    st.note = s ? `The nearest carrier is ${Math.max(0, escape - far)} m from getting away.` : "";
  }

  // A carrier shot down: its captives fall free, set down on the ground by
  // the wreck (out of the loaded world, or in water: back at their village).
  _freeCaptives(u) {
    const place = this.state.place;
    const kinds = place?.kinds || ["cow", "sheep"];
    let n = 0;
    for (let i = 0; i < (u.captives || 1); i++) {
      for (const c of [u.pos, place]) {
        if (!c) continue;
        const x = Math.floor(c.x + rand(-4, 4));
        const z = Math.floor(c.z + rand(-4, 4));
        if (!this.world.getChunk(x >> 4, z >> 4)) continue;
        if (this.mobs.spawn(kinds[Math.floor(Math.random() * kinds.length)], x + 0.5, this.world.surfaceY(x, z) + 1, z + 0.5)) {
          n++;
          break;
        }
      }
    }
    if (n) this.toast?.(`${n} captive${n === 1 ? "" : "s"} freed!`, 3);
  }

  // ---------- (Round 10) Sabotage: the signal beacons ----------
  // Pods (small ships, landed and grounded for good: errand, peaceful) spread
  // around the group, each with a few aliens guarding it (set out when
  // someone comes near) and calling in a UFO now and then while it stands.
  // As many are set out as are still to destroy (at most six at once); a
  // reload sets out what is left.
  _beacons() {
    const st = this.state;
    const v = this.mission.variant ?? 0;
    if (!st.center) {
      const people = this._people();
      st.center = { x: 0, z: 0 };
      for (const q of people) {
        st.center.x += q.position.x / people.length;
        st.center.z += q.position.z / people.length;
      }
    }
    st.pods = (st.pods || []).filter((u) => this._alive(u));
    const left = this._remaining();
    if (st.pods.length < Math.min(left, 6)) {
      st.podT = (st.podT ?? 0) - 0.5;
      if (st.podT <= 0) {
        st.podT = 1;
        const s = this._farSpot(st.center, v === 1 ? rand(230, 330) : rand(110, 210)) || this._groundSpot(90, 0.4, this._anyone().position);
        if (s) {
          const u = this.ufos.spawn({ size: "small", design: "saucer_domed", style: "volley", pos: { x: s.x, y: s.y + 60, z: s.z }, hidden: true });
          u.beacon = true;
          u.peaceful = true;
          u.errand = true;
          this._keepTarget(u);
          u.dodgeMul = 0;
          u.blinkT = 1e9;
          u.crashPlan = { exploded: true, crew: 0 };
          u.maxHealth = u.health = Math.round(90 * (this.ufos.groupHealth ?? 1));
          u.podAt = new THREE.Vector3(s.x, s.y, s.z);
          u.waypoint = new THREE.Vector3(s.x, s.y + u.info.bottom * u.radius + 0.3, s.z);
          u.callT = rand(15, 30);
          st.pods.push(u);
          if (!st.told) {
            st.told = true;
            this.toast?.("Signal beacons are coming down around you (marked): destroy them before they call in the fleet!", 5);
          }
        }
      }
    }
    // Each pod: down and staying down; its guards when someone comes near; a call now and then.
    const people = this._people();
    st.called = (st.called || []).filter((u) => this._alive(u));
    for (const u of st.pods) {
      if (u.state !== "trick" || u.trick !== "land") {
        u.state = "trick";
        u.trick = "land";
        u.timer = 1e9;
      }
      // (Onto the live ground once it is loaded: the terrain's height was a guess.)
      const g = this.ufos._groundAt?.(u.podAt.x, u.podAt.z) ?? u.podAt.y;
      u.podAt.y = g;
      u.waypoint.y = g + u.info.bottom * u.radius + 0.3;
      if (u.landed || u.pos.distanceTo(u.waypoint) < 2.5) u.podDown = true;
      let d = Infinity;
      for (const q of people) d = Math.min(d, q.position.distanceTo(u.podAt));
      if (!u.guarded && d < 170 && this.world.getChunk(Math.floor(u.podAt.x) >> 4, Math.floor(u.podAt.z) >> 4)) {
        u.guarded = true;
        const kinds = this._waveKinds();
        for (let i = 0; i < 1 + this.groupN; i++) {
          this._spawnAlien(kinds[i % kinds.length], 6, u.podAt);
        }
      }
      u.callT -= 0.5;
      if (u.callT <= 0 && u.podDown) {
        u.callT = (v === 3 ? 32 : 50) * rand(0.9, 1.1);
        if (st.called.length < 1 + this.groupN) {
          const ground = Math.max(this.terrain.heightAt(Math.floor(u.pos.x), Math.floor(u.pos.z)), SEA_LEVEL);
          const c = this.ufos.spawn({ pos: { x: u.pos.x + rand(-70, 70), y: ground + rand(40, 60), z: u.pos.z + rand(-70, 70) }, hidden: true });
          this.ufos.anger(c, 90);
          st.called.push(c);
          this.toast?.("A signal beacon has called in a UFO!", 3);
        }
      }
    }
    const b = this._nearestOf(st.pods);
    if (b) this._setTarget(b, `Signal beacon (${st.pods.length} standing)`);
    else this.target = null;
    st.note = st.pods.length ? `${st.pods.length} beacon${st.pods.length === 1 ? "" : "s"} standing: each calls in UFOs.` : "";
  }

  // ---------- (Round 10) What these missions draw on the ground ----------

  // Every frame: the bombardment's rings, the zone's ring (and its beacon's
  // light), the signal beacons' columns.
  _fxZones(dt) {
    const st = this.state;
    for (let i = (st.rings || []).length - 1; i >= 0; i--) {
      const r = st.rings[i];
      r.t -= dt;
      this._drawRing(r, dt);
      if (r.t <= -1) st.rings.splice(i, 1);
    }
    if (st.zone) this._drawZone(st.zone, dt);
    for (const u of st.pods || []) if (u.podDown && this._alive(u)) this._drawPod(u.pos, u.radius);
  }

  // A zone's ring on the ground, in its kind's colour, and a blinking light
  // over the radio beacon.
  _drawZone(z, dt) {
    const fx = this.effects;
    if (!fx) return;
    const cols = this._zoneC || (this._zoneC = { beacon: new THREE.Color(0.4, 1.6, 3), site: new THREE.Color(3, 1.4, 0.3), shelter: new THREE.Color(0.5, 3, 0.8) });
    z.fx = (z.fx ?? 0) - dt;
    z.t = (z.t ?? 0) + dt;
    if (z.fx > 0) return;
    z.fx = 0.12;
    const n = 30;
    const c = cols[z.kind] || cols.beacon;
    const life = Math.max(0.26, dt * 2.2); // (a slow frame rate: each ring lasts until the next one)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + z.t * 0.3;
      const x = z.x + Math.cos(a) * z.r;
      const zz = z.z + Math.sin(a) * z.r;
      const gy = this.world.getChunk(Math.floor(x) >> 4, Math.floor(zz) >> 4) ? this.world.surfaceY(Math.floor(x), Math.floor(zz)) + 1.15 : z.y + 0.15;
      fx.glow.spawn({ x, y: gy, z: zz, life, size0: 0.6, size1: 0.4, color0: c, alpha: 0.85 });
    }
    // The middle: a light on the beacon's mast (blinking), smoke over the wreck, a column of light over the shelter.
    if (z.kind === "beacon" && Math.floor(z.t * 2) % 2 === 0) fx.glow.spawn({ x: z.x, y: z.y + 7, z: z.z, life: Math.max(0.2, dt * 1.5), size0: 2.2, size1: 1.6, color0: this._redC || (this._redC = new THREE.Color(3.5, 0.5, 0.25)), alpha: 0.95 });
    if (z.kind === "beacon") for (let y = 0.5; y < 7; y += 1.5) fx.glow.spawn({ x: z.x, y: z.y + y, z: z.z, life, size0: 0.35, size1: 0.3, color0: c, alpha: 0.7 });
    if (z.kind === "site") fx.smoke?.spawn({ x: z.x + rand(-1.5, 1.5), y: z.y + 1, z: z.z + rand(-1.5, 1.5), vx: rand(-0.4, 0.4), vy: 2.2, vz: rand(-0.4, 0.4), life: rand(3, 5), size0: 1.2, size1: 4, color0: this._smokeC || (this._smokeC = new THREE.Color(0.16, 0.15, 0.14)), color1: this._smokeC2 || (this._smokeC2 = new THREE.Color(0.45, 0.43, 0.4)), alpha: 0.5, drag: 0.6 });
    if (z.kind === "shelter") fx.glow.spawn({ x: z.x + rand(-1, 1), y: z.y + 0.5, z: z.z + rand(-1, 1), vy: rand(6, 12), life: rand(0.8, 1.4), size0: 0.5, size1: 0.1, color0: c, alpha: 0.9 });
  }

  // A signal beacon's column: sparks rising from it, a pulse now and then.
  _drawPod(pos, radius = 3.5) {
    const fx = this.effects;
    if (!fx) return;
    const c = this._podC || (this._podC = new THREE.Color(3.2, 0.6, 1.6));
    if (Math.random() < 0.7) fx.glow.spawn({ x: pos.x + rand(-0.4, 0.4), y: pos.y + radius * 0.4, z: pos.z + rand(-0.4, 0.4), vy: rand(14, 24), life: rand(1, 1.8), size0: 0.7, size1: 0.2, color0: c, alpha: 0.9 });
    if (Math.random() < 0.04) fx.glow.spawn({ x: pos.x, y: pos.y + radius, z: pos.z, life: 0.35, size0: radius * 1.6, size1: radius * 3, color0: c, alpha: 0.5 });
  }

  // 11. Touchdown: fly a jet back onto a runway and stop; then a red squad
  // drops in on the ground, and the mission is over when it is dead.
  _landjet() {
    const st = this.state;
    const p = this.player.position;
    const act = this.vehicles.active;
    const inJet = act?.type === "jet" && !act.isEnemyJet;
    const sites = this.terrain.sites;
    if (!st.landed && this._remaining(0) <= 0) {
      // (Landed before a reload: the saved stat says so; the squad is next.)
      st.landed = true;
      st.landPos = p.clone();
    }
    if (!st.landed) {
      // (Online, any player's jet: the host's own and the others'.)
      const jets = this.pilotJets ? this.pilotJets() : inJet ? [act] : [];
      st.flown = st.flown || new Set();
      st.upT = st.upT || new Map();
      for (const j of jets) {
        // (Up for over a second: rolling off a step and dropping back isn't a flight.)
        const up = j.onGround ? 0 : (st.upT.get(j) || 0) + 0.5;
        st.upT.set(j, up);
        if (up > 1) {
          st.air = true;
          st.airJet = j;
          st.flown.add(j);
        }
      }
      if (st.airJet && !st.airJet.alive) {
        // It crashed: another take-off is needed.
        st.air = false;
        st.airJet = null;
      }
      // (The jet that flew: not one parked on a runway that never took off.)
      const landed = st.air && jets.find((j) => st.flown.has(j) && j.onGround && j.alive && j.vel.length() < 8 && sites.onRunway(j.pos.x, j.pos.z, 2));
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
    const need = this._remaining(1); // (the saved count: what is left after a reload too)
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
      // (Round 10) It falls out of the night sky: by day the clock eases on
      // to the night first (a time-lapse, see _warpTo; a locked clock jumps).
      const h = this.sky.hours;
      if (st.warp) {
        this.target = null;
        this.state.note = "Night is falling...";
        return;
      }
      if (!(h >= 19.5 || h < 5.5) && !st.dusk) {
        st.dusk = true;
        if (this.sky.locked) this.sky.setHours(21);
        else if (this._warpTo(21)) {
          this.toast?.("Night is falling... and something is falling with it.", 4);
          this.target = null;
          return;
        }
      }
      st.init = true;
      st.strikeT = 5;
      st.frags = [];
      st.rings = [];
      st.seed = 0;
      st.since = 2; // the first strike seeds a fragment
      this.toast?.("A meteor storm! Rocks fall where the red rings are: keep out of them, and grab the glowing star fragments.", 6);
    }
    st.frags = st.frags.filter((f) => f.life > 0);
    // New strikes (not while the player is dead).
    st.strikeT -= 0.5;
    const collected = this.progress.objectives(this.stats.world)[0]?.value ?? 0;
    const goal = this.progress.objectives(this.stats.world)[0]?.goal ?? 4;
    if (st.strikeT <= 0 && this.anyAlive && this.weapons?.airstrike) {
      // (Online: around everyone, a little more often for a bigger group.)
      st.strikeT = (Math.max(3.2, rand(5.5, 8) - (collected / goal) * 2.8) / Math.sqrt(this.groupN)) * (this.mission?.variant === 1 ? 0.75 : 1); // (Round 10: a heavy storm)
      const q = this._anyone().position;
      const a = Math.random() * Math.PI * 2;
      const d = rand(20, 65);
      const x = Math.floor(q.x + Math.cos(a) * d);
      const z = Math.floor(q.z + Math.sin(a) * d);
      const wantFrag = st.since >= 2 && st.frags.length + (st.seed || 0) < 1 + this.groupN;
      const y = Math.max(this.world.heightAt(x, z), SEA_LEVEL) + 1;
      const target = new THREE.Vector3(x + 0.5, y, z + 0.5);
      const delay = 4.5;
      this.weapons.airstrike.call(target, { count: wantFrag ? 1 : 3, spread: 12, delay, angle: 28, source: "meteor" });
      st.rings.push({ pos: target, t: delay + 0.2, fx: 0, r: wantFrag ? 5 : 11 });
      if (wantFrag) {
        st.seed = (st.seed || 0) + 1;
        st.pending = (st.pending || []).concat([{ pos: target.clone(), at: delay + 1.2 }]);
        st.since = 0;
      } else st.since++;
    }
    // Salvagers: a small UFO comes for a fragment that has been lying around.
    const old = st.frags.find((f) => f.life < (this.mission?.variant === 2 ? 40 : 45));
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
      st.frags.push({ pos: new THREE.Vector3(q.pos.x, y, q.pos.z), life: this.mission?.variant === 2 ? 60 : 80 }); // (Round 10: hungry salvagers)
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
        this.audio?.playCrateLand?.();
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

  // What a guest must see of the mission's own objects (online): rings and
  // fragments; (Round 10) the zone, the signal beacons.
  netObjects() {
    const st = this.state;
    const ev = this.mission?.event;
    const r1 = (v) => Math.round(v * 10) / 10;
    if (ev === "meteors" && st.init) {
      return {
        r: (st.rings || []).map((r) => [r1(r.pos.x), r1(r.pos.y), r1(r.pos.z), r.r, Math.round(r.t * 2) / 2]),
        f: (st.frags || []).map((f) => [r1(f.pos.x), r1(f.pos.y), r1(f.pos.z)]),
      };
    }
    if (!ZONE_EVENTS.has(ev)) return null;
    const out = {};
    if (st.rings?.length) out.r = st.rings.map((r) => [r1(r.pos.x), r1(r.pos.y), r1(r.pos.z), r.r, Math.round(r.t * 2) / 2]);
    if (st.zone) out.z = [[r1(st.zone.x), r1(st.zone.y), r1(st.zone.z), st.zone.r, Math.max(0, ZONE_KINDS.indexOf(st.zone.kind))]];
    const pods = (st.pods || []).filter((u) => u.podDown && this._alive(u));
    if (pods.length) out.b = pods.map((u) => [r1(u.pos.x), r1(u.pos.y), r1(u.pos.z), r1(u.radius)]);
    return Object.keys(out).length ? out : null;
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
    // (Round 10) The zone (kept between states: its ring turns on), the beacons.
    const zs = (this._netZones ||= new Map());
    const zseen = new Set();
    for (const e of Array.isArray(objs.z) ? objs.z : []) {
      if (!Array.isArray(e) || !e.slice(0, 4).every(Number.isFinite)) continue;
      const key = `${e[0]},${e[2]}`;
      zseen.add(key);
      let z = zs.get(key);
      if (!z) zs.set(key, (z = { x: e[0], y: e[1], z: e[2], r: Math.max(1, Math.min(40, e[3])), kind: ZONE_KINDS[e[4]] || "beacon" }));
      this._drawZone(z, dt);
    }
    for (const k of zs.keys()) if (!zseen.has(k)) zs.delete(k);
    for (const e of Array.isArray(objs.b) ? objs.b.slice(0, 8) : []) if (Array.isArray(e) && e.slice(0, 3).every(Number.isFinite)) this._drawPod(_v.set(e[0], e[1], e[2]), Number(e[3]) || 3.5);
  }

  // ---------- 20. The Overlord: a shielded mothership ----------
  // Three shield rounds: the shield holds until its pylons (small UFOs,
  // marked) are shot down; then the hull can be hurt, for a minute at most
  // before the shield returns; at 70% and 40% health it re-forms with fresh
  // pylons and reinforcements (a red squad on the ground, more escorts), and
  // at 15% for the last time: the final stretch has no shield, and it fights
  // harder. Killing it ends the mission.
  // (Round 9: the same fight, with the mission's own settings, is the
  // finale: the Dreadnought, a titan behind five shields.)
  get _bossCfg() {
    return { ...OVERLORD, ...(this.mission?.boss || {}) };
  }

  _boss() {
    const st = this.state;
    const p = this.player.position;
    const boss = st.boss;
    const B = this._bossCfg;
    if (!this._alive(boss)) {
      this.bossInfo = null;
      if ((this.progress.objectives(this.stats.world)[0]?.value ?? 0) >= 1) return;
      st.waitT = (st.waitT ?? 2) - 0.5;
      this.target = null;
      if (st.waitT > 0) return;
      st.waitT = 25;
      const u = this._spawnUfo({ size: B.size, style: "sweep", design: B.design }, B.size === "giant" ? 640 : 520, false);
      u.boss = true;
      u.bossName = B.name;
      u.bossShort = B.short || B.name;
      u.bossStat = B.stat;
      this._keepTarget(u);
      u.dodgeMul = 0;
      u.home = p.clone();
      u.tether = 240;
      u.maxHealth = u.health = Math.round(B.health * (this.ufos.groupHealth ?? 1)); // (online: tougher for a bigger group)
      u.shield = true;
      u.shieldRound = 0;
      u.shieldAt = [...B.shieldAt];
      u.bossHook = (b) => this._bossHook(b);
      st.boss = u;
      st.pylons = [];
      st.escorts = [];
      st.phase = 0;
      st.raise = true;
      st.shieldDownT = 0;
      st.reinforced = -1;
      this.toast?.(`${B.name} is here! Its shield is up: shoot down the pylons (marked).`, 6);
      return;
    }
    // The shield, the pylons, the escort. (Round 9: the boss stays with the
    // players, its pylons and escorts with it.)
    st.pylons = (st.pylons || []).filter((u) => this._alive(u));
    st.escorts = (st.escorts || []).filter((u) => this._alive(u));
    this._leash(boss, 400, 240);
    for (const u of [...st.pylons, ...st.escorts]) u.home?.copy(boss.pos);
    if (boss.shield && st.raise && st.pylons.length === 0) {
      st.raise = false;
      this._bossPylons(boss, B.pylons[Math.min(B.pylons.length - 1, boss.shieldRound)]);
      // (The squad and the jets once a round: a shield back early, in the
      // same round, only tops up the escort, or they piled up each time.)
      const again = st.reinforced === boss.shieldRound;
      st.reinforced = boss.shieldRound;
      this._bossReinforce(boss, boss.shieldRound, B, again);
    } else if (boss.shield && !st.raise && st.pylons.length === 0) {
      boss.shield = false;
      st.shieldDownT = 60;
      // (The last shield: the "no more shields" toast below says it.)
      if (boss.shieldRound < boss.shieldAt.length) this.toast?.("SHIELD DOWN! Hit the hull with everything: you have about a minute!", 5);
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
    const phase = boss.shieldRound >= boss.shieldAt.length && !boss.shield ? 3 : Math.min(2, boss.shieldRound);
    if (phase !== st.phase) {
      st.phase = phase;
      boss.style = ["sweep", "heavy", "charged", "seeker"][phase] || "sweep";
      boss.laserKey = STYLE_COLOR[boss.style] || boss.laserKey;
      if (phase === 3) this.toast?.(`${B.short || B.name} is wounded and furious: no more shields! Finish it!`, 5);
    }
    this.bossInfo = { name: B.name, health: Math.max(0, Math.min(1, frac)), shield: !!boss.shield, pylons: st.pylons.length, downT: boss.shield ? 0 : st.shieldDownT, final: phase === 3 };
    // The marker: a pylon while the shield is up, else the hull.
    if (boss.shield && st.pylons.length) {
      st.pylons.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
      this._setTarget(st.pylons[0], `Shield pylon (${st.pylons.length} left)`);
    } else this._setTarget(boss, B.short || B.name);
    const np = st.pylons.length;
    this.state.note = boss.shield ? `Shield up: ${np} pylon${np === 1 ? "" : "s"}` : phase === 3 ? "Last stand: no shield" : `Shield down for ${Math.ceil(st.shieldDownT)} s`;
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
      this._keepTarget(u);
      u.dodgeMul = 0.3;
      u.home = boss.pos.clone();
      u.tether = 150;
      u.maxHealth = u.health = 110;
      st.pylons.push(u);
    }
  }

  // What comes with each shield (the boss's settings): the Overlord's round 0
  // two medium escorts, round 1 a red squad drops in as well, round 2 two
  // more escorts (and the last stretch is the boss alone). (Round 9: the
  // Dreadnought's bring hijacked fighters and a blue squad too.)
  _bossReinforce(boss, round, B = OVERLORD, escortsOnly = false) {
    const st = this.state;
    const p = this.player.position;
    const escorts = B.escorts?.[round] ?? 0;
    const cap = B.size === "giant" ? 5 : 4;
    for (let i = 0; i < escorts && st.escorts.length < cap; i++) {
      const e = this.ufos.spawn({ size: "medium", pos: { x: boss.pos.x + rand(-80, 80), y: boss.pos.y - 25, z: boss.pos.z + rand(-80, 80) }, hidden: true });
      e.home = boss.pos.clone();
      e.tether = 160;
      this._keepTarget(e);
      st.escorts.push(e);
    }
    if (escortsOnly) return;
    const kind = B.squads?.[round];
    if (kind) {
      const near = this._anyone().position;
      const at = this._groundSpot(70, 0.2, near) || new THREE.Vector3(near.x + 70, 0, near.z);
      let n = 0;
      for (let i = 0; i < 2 + this.groupN; i++) if (this._spawnAlien(kind, 6, at)) n++;
      if (n) {
        this._dropship(at, kind);
        this.toast?.(`${B.short || B.name} has dropped a ${kind === "alien_blue" ? "blue" : kind === "alien_gray" ? "gray" : "red"} squad on you!`, 4);
      }
    }
    const jets = B.jets?.[round];
    if (jets) {
      st.jets = (st.jets || []).filter((j) => j.alive && this.vehicles.vehicles.includes(j));
      for (let i = 0; i < Math.min(4, jets + this.groupN - 1); i++) {
        const j = this.enemyJets.spawn({ hostile: true, dist: 900, center: this._anyone().position });
        if (!j) continue;
        j.mission = true;
        j.provoked = 60;
        st.jets.push(j);
      }
    }
    void p;
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
    const start = home ? { x: home.x, z: home.z } : null; // (where the B-2 waits: respawns, see respawnPlace)
    if (best) return { x: best.x, y: best.y, z: best.z, site: best, home: start };
    // (No other airport out there: a base in the open, 1500 blocks off.)
    const x = from.x + 1500;
    const z = from.z;
    return { x, y: Math.max(SEA_LEVEL + 6, this.terrain.heightAt(Math.floor(x), Math.floor(z))), z, site: null, home: start };
  }

  // A B-2 with someone in it (online: any player's), or null.
  _b2Flying() {
    for (const v of this.vehicles.vehicles) if (v.type === "jet" && v.jetType === "b2" && v.alive && (v.occupied || (v.puppet && v.netOcc))) return v;
    return null;
  }

  // The nearest parked, empty B-2 (as a marker target), or null.
  _parkedB2Target() {
    // (The bomber nearest to any player: a random player per check would make
    // the marker flip between bombers at different airports.)
    const people = this._people();
    let jet = null;
    let bd = Infinity;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "jet" || v.jetType !== "b2" || !v.alive || v.occupied || v.netOcc || v.isEnemyJet) continue;
      let d = Infinity;
      for (const q of people) d = Math.min(d, v.pos.distanceTo(q.position));
      if (d < bd) {
        bd = d;
        jet = v;
      }
    }
    return jet ? { pos: jet.pos.clone(), label: "B-2 bomber: get in (F)", follow: jet } : null;
  }

  // 18. Operation Sunburn: take the B-2 from your airport, fly to the enemy
  // base (another airport, far off) and drop the nuke on it. Online one
  // player flies the bomber, the others escort it in the fighters.
  _airport() {
    const st = this.state;
    if (!this.base) {
      // (The base chosen before a reload, saved with the chain: picked afresh
      // from where the players are now it could be another airport.)
      const pl = this.progress.place;
      if (pl?.mission === this.missionId && Number.isFinite(pl.x) && Number.isFinite(pl.z)) {
        this.base = { x: pl.x, y: Number.isFinite(pl.y) ? pl.y : SEA_LEVEL + 6, z: pl.z, site: this.terrain.sites.siteAt(pl.x, pl.z), home: pl.home || null };
      } else {
        this.base = this._pickBase();
        const nb = this.base;
        this.progress.place = { mission: this.missionId, x: nb.x, y: nb.y, z: nb.z, home: nb.home };
      }
    }
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
      this._keepTarget(u);
      if (d < 700) this.ufos.anger(u, 200);
      st.guards.push(u);
    }
    if (d < 900 && !(st.jet && st.jet.alive && this.vehicles.vehicles.includes(st.jet))) {
      st.jetT = (st.jetT ?? 0) - 0.5;
      if (st.jetT <= 0) {
        st.jetT = 60;
        const j = this.enemyJets.spawn({ hostile: true, dist: 700, center: this._anyone().position });
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
      // (Round 9) The bunker nearest to the group as a whole (the least
      // distance to everyone; alone, the nearest), not a random player's.
      const people = this._people();
      const seen = new Set();
      let best = null;
      let bestD = Infinity;
      for (const q of people) {
        for (const s of sites.within(q.position.x, q.position.z, 8000)) {
          if (s.kind !== "airport" || !s.bunkers?.length || seen.has(s)) continue;
          seen.add(s);
          let d = 0;
          for (const o of people) d += Math.hypot(s.x - o.position.x, s.z - o.position.z);
          if (d < bestD) {
            best = s;
            bestD = d;
          }
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
    // The ship: the bunker's own, set out by airports.js on every peer when
    // someone comes near (online, the copy a guest boarded comes back here as
    // its puppet). (Round 9) Never a second one: the director brings in no
    // ship of its own. A ship lost after boarding (or gone before the
    // mission) has the bunker set out a new one, on every peer (untake).
    if (!st.ship || !this.vehicles.vehicles.includes(st.ship) || !st.ship.alive) {
      const was = st.ship;
      st.ship = this._bunkerShip(key, hall);
      if (!st.ship) {
        if (was && st.locked) {
          // Lost after boarding: the doors open again, another ship comes.
          this._stealDoors(site, spot, false);
          st.locked = false;
        }
        st.noShipT = (st.noShipT ?? 0) + 0.5;
        if (ready && d < 220 && (was || st.noShipT >= 5)) {
          st.noShipT = 0;
          this.airports.untake(key);
          this.onUntake?.(key);
        }
      } else st.noShipT = 0;
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
          if (g) {
            this.mobs.alarm(g, 10);
            (st.guards = st.guards || []).push(g);
          }
        }
      }
      this.toast?.("LOCKDOWN! The blast doors are sealed. Ghost mode (G): burn your way out through the rock!", 6);
    }
    if (ship && aboard) {
      const away = ship.pos.distanceTo(hall);
      if (away >= 150) {
        if (!st.escaped) {
          st.escaped = true;
          if (ship.puppet) this.stats.addWorld("shipsStolen"); // (a guest flew it out)
          else this.stats.add("shipsStolen");
          const who = this.pilotName?.(ship);
          this.toast?.(who ? `${who} got the ship out: it's theirs now!` : "You got the ship out: it's yours!", 5);
        }
        this.target = null;
        return;
      }
      this.target = { pos: new THREE.Vector3(hall.x, site.y + 30, hall.z), label: `Escape: ghost mode (G), up through the rock (${Math.round(150 - away)} m to go)`, follow: null };
      st.note = "Get 150 blocks away from the bunker.";
      return;
    }
    st.note = "";
    // (A ship left outside after a failed escape: the marker is on it.)
    if (ship && (d < 90 || ship.pos.distanceTo(hall) > 40)) this._setTarget(ship, "The alien ship: board it (F)");
    else this.target = { pos: new THREE.Vector3(spot.zone.x, site.y + 1, spot.zone.z), label: "Bunker: the captured ship (armed guards)", follow: null };
  }

  // (Round 9) The bunker's ship: this peer's own copy (parkKey) or the
  // puppet of the copy another player boarded (tookKey), the one standing
  // in the hall (or someone flying it out). A ship taken from there long
  // ago (someone's own now, parked far off) is not it.
  _bunkerShip(key, hall) {
    let best = null;
    let bd = Infinity;
    for (const v of this.vehicles.vehicles) {
      if (v.type !== "ufo" || !v.alive || (v.parkKey !== key && v.tookKey !== key)) continue;
      const d = v.pos.distanceTo(hall);
      const busy = v.occupied || (v.puppet && v.netOcc);
      if (d > 60 && !busy) continue; // (someone flying it out: after a reload too, wherever it is)
      const score = busy ? -1 : d;
      if (score < bd) {
        bd = score;
        best = v;
      }
    }
    return best;
  }

  // The blast doors at the foot of the bunker's ramp: sealed (only where there
  // is air: nothing built is lost) or opened again.
  _stealDoors(site, spot, close) {
    const sites = this.terrain.sites;
    const b = site.bunkers[spot.id];
    const list = [];
    const cells = [];
    for (let u = b.ru0 - 1; u <= b.ru1 + 1; u++) {
      for (const v of [b.hv0, b.hv0 + 1]) {
        const [x, z] = sites.toWorld(site, u, v);
        for (let y = spot.y; y < spot.y + 10; y++) cells.push(x, y, z, (y - spot.y) % 3 === 1 ? BLOCK.STONE : BLOCK.COBBLESTONE);
      }
    }
    if (close) {
      let match = 0;
      for (let i = 0; i < cells.length; i += 4) {
        const id = this.world.getBlock(cells[i], cells[i + 1], cells[i + 2]);
        if (id === cells[i + 3]) match++;
        if (id === BLOCK.AIR) list.push(cells[i], cells[i + 1], cells[i + 2], cells[i + 3]);
      }
      this.state.doors = list.slice();
      // (Doors already shut: sealed before a reload, whose list is gone; most of
      // the doorway is door blocks, not one a player happened to build. Opening
      // then clears every door block in the doorway.)
      this.state.doorsAll = match * 2 > cells.length / 4;
    } else {
      const old = this.state.doorsAll ? cells : this.state.doors || [];
      for (let i = 0; i < old.length; i += 4) if (this.world.getBlock(old[i], old[i + 1], old[i + 2]) === old[i + 3]) list.push(old[i], old[i + 1], old[i + 2], BLOCK.AIR);
      this.state.doors = null;
      this.state.doorsAll = false;
    }
    if (list.length) this.world.setBlocks(list);
  }

  // The fallback: a captured ship standing in the open 700 blocks off, ringed by soldiers.
  _stealOpen() {
    const st = this.state;
    if (!st.open) {
      // (The spot chosen before a reload, saved with the chain: the ship may
      // have been flown off since. A save from before that has no spot: the
      // ship from before the reload is still the mission's ship, and the spot
      // is where it is.)
      const had = this.vehicles.vehicles.find((v) => v.missionShip === "open" && v.alive);
      const pl = this.progress.place;
      if (pl?.mission === this.missionId && Number.isFinite(pl.x) && Number.isFinite(pl.z)) {
        st.open = { x: pl.x, y: Number.isFinite(pl.y) ? pl.y : had?.pos.y ?? SEA_LEVEL, z: pl.z };
      } else {
        const at = had ? had.pos.clone() : this._groundSpot(700, 0.2, this._anyone().position);
        st.open = at ? { x: at.x, y: at.y, z: at.z } : null;
        if (!st.open) return;
        // (Already flown out before the reload: no guards ring the pilot.)
        if (had && (had.occupied || (had.puppet && had.netOcc))) st.guardsSet = true;
        else this.progress.place = { mission: this.missionId, ...st.open };
      }
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
          // (On dry ground: the first spot around the ring that isn't water.)
          for (let k = 0; k < 6; k++) {
            const a = ((i + k * 0.37) / (4 + 2 * this.groupN)) * Math.PI * 2;
            const x = Math.floor(o.x + Math.cos(a) * (14 + k * 2));
            const z = Math.floor(o.z + Math.sin(a) * (14 + k * 2));
            const top = this.world.surfaceY(x, z);
            if (top < 1 || IS_WET[this.world.getBlock(x, top + 1, z)]) continue;
            const g = this.mobs.spawnGuard(x + 0.5, top + 1, z + 0.5, zone);
            if (g) {
              (st.guards = st.guards || []).push(g);
              break;
            }
          }
        }
      }
    }
    const ship = st.ship;
    if (ship && (ship.occupied || (ship.puppet && ship.netOcc))) {
      const away = ship.pos.distanceTo(c);
      if (away >= 150 && !st.escaped) {
        st.escaped = true;
        if (ship.puppet) this.stats.addWorld("shipsStolen"); // (a guest flew it out)
        else this.stats.add("shipsStolen");
        const who = this.pilotName?.(ship);
        this.toast?.(who ? `${who} got the ship out: it's theirs now!` : "You got the ship out: it's yours!", 5);
      }
      this.target = away >= 150 ? null : { pos: c.clone(), label: `Escape: get clear (${Math.round(150 - away)} m to go)`, follow: null };
      return;
    }
    if (ship && d < 90) this._setTarget(ship, "The alien ship: board it (F)");
    else this.target = { pos: c, label: "The captured ship (armed guards)", follow: null };
  }

  // ---------- (Round 9) Respawning during a mission ----------

  // The mission's location, for a player who died during it: its place (the
  // raided village, the bunker, the boss, the airport the jets wait at),
  // else where its marker is (or was); and how far out from it the ring of
  // respawn spots starts (out of the fight). null: no mission on.
  respawnPlace() {
    const m = this.enabled ? this.mission : null;
    if (!m || m.id !== this.missionId) return null;
    const st = this.state;
    const t = this.target;
    const sites = this.terrain.sites;
    // (The airport, or city with one, nearest to pos: where the jets are parked.)
    const airport = (pos) => {
      const s = pos && sites.nearest(pos.x, pos.z, 3000);
      return s ? { x: s.x, z: s.z, r: 45 } : null;
    };
    // (Where the group is: its middle, so online every respawn is around the
    // same airport, not a random player's.)
    const people = this._people();
    const mid = { x: 0, z: 0 };
    for (const q of people) {
      mid.x += q.position.x / people.length;
      mid.z += q.position.z / people.length;
    }
    switch (m.event) {
      case "village":
      case "abduct":
        if (st.place) return { x: st.place.x, z: st.place.z, r: 75 };
        break;
      case "fortress":
        if (st.at) return { x: st.at.x, z: st.at.z, r: 95 };
        break;
      case "steal":
        if (st.site) {
          const z = sites.bunkerSpots(st.site)[0]?.zone;
          if (z) return { x: z.x, z: z.z, r: z.r + 30 };
        }
        break;
      case "boss":
        if (this._alive(st.boss)) return { x: st.boss.pos.x, z: st.boss.pos.z, r: 70 + st.boss.radius };
        break;
      case "airport":
        if (this.base?.home) return { x: this.base.home.x, z: this.base.home.z, r: 45 };
        return airport(mid);
      case "takeoff":
      case "dogfight":
      case "fighter":
      case "airraid":
        return airport(mid) || (t && airport(t.pos));
      case "landjet":
        if (!st.landed) return airport(mid) || (t && airport(t.pos));
        break;
      // (Round 10) Back out of the zone (to walk back in), back to where the
      // run for cover began, around the village of the rescue, the group.
      case "hold":
      case "crashsite":
        if (st.zone) return { x: st.zone.x, z: st.zone.z, r: 50 };
        break;
      case "evac":
        if (st.from) return { x: st.from.x, z: st.from.z, r: 20 };
        break;
      case "rescue":
        if (st.place) return { x: st.place.x, z: st.place.z, r: 60 };
        break;
      case "beacons":
        if (st.center) return { x: st.center.x, z: st.center.z, r: 50 };
        break;
      case "hunters":
        return { x: mid.x, z: mid.z, r: 35 };
    }
    if (t) return { x: t.pos.x, z: t.pos.z, r: t.follow?.S ? 55 + (t.follow.radius || 10) : 45 };
    if (this._lastPlace?.id === m.id) return { x: this._lastPlace.x, z: this._lastPlace.z, r: 45 };
    return null;
  }

  // A random safe spot in the ring from r to r + 40 blocks around c (wider
  // when nothing fits): dry, flat, open ground with room to stand, no hostile
  // creature near, outside an airport bunker's restricted zone (its guards
  // shoot). [x, z] (the middle of a column), or null. Runs on the player's
  // own machine (online, with the host's place: net/coop.js).
  safeSpotAround(c, r = 45) {
    const T = this.terrain;
    const world = this.mobs.world;
    const zones = [];
    for (const s of T.sites.within(c.x, c.z, r + 600)) if (s.bunkers?.length) for (const b of T.sites.bunkerSpots(s)) zones.push(b.zone);
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = (r + Math.random() * 40) * (1 + 0.5 * Math.floor(k / 20));
      const x = Math.floor(c.x + Math.cos(a) * d);
      const z = Math.floor(c.z + Math.sin(a) * d);
      const h = T.heightAt(x, z);
      if (h <= SEA_LEVEL + 1) continue; // (the sea, a lake, a beach)
      let flat = true;
      for (const [dx, dz] of NEAR) if (Math.abs(T.heightAt(x + dx, z + dz) - h) > 1) flat = false;
      if (!flat) continue;
      if (zones.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 10)) continue;
      // (Where the world is loaded: the real ground, built on or blown up.)
      if (world.getChunk(x >> 4, z >> 4)) {
        const top = world.surfaceY(x, z);
        if (top < 1 || IS_WET[world.getBlock(x, top, z)] || IS_WET[world.getBlock(x, top + 1, z)]) continue;
        if (world.getBlock(x, top + 1, z) !== BLOCK.AIR || world.getBlock(x, top + 2, z) !== BLOCK.AIR) continue;
      }
      if (this.mobs.mobs.some((o) => !o.dead && o.spec?.hostile && Math.abs(o.pos.x - x) < 24 && Math.abs(o.pos.z - z) < 24)) continue;
      return [x + 0.5, z + 0.5];
    }
    return null;
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

  // A UFO the player shot down: raiders count for the village mission
  // (Round 9: abductors for theirs, the finale's flagship for the finale).
  // (mine: false for another player's kill, online: it counts for this world only.)
  ufoDown(u, mine = true) {
    const add = (k) => (mine ? this.stats.add(k) : this.stats.addWorld(k));
    if (u.size === "giant") add("titansDown"); // (the Titan mission's: a mothership doesn't count)
    if (u.raider) add("raidersDown");
    if (u.abductor) add("abductorsDown");
    // (Round 10) A carrier (its captives fall free), a signal beacon, the bombardment's spotter.
    if (u.carrier) {
      add("carriersDown");
      this._freeCaptives(u);
    }
    if (u.beacon) add("beaconsDown");
    if (u.spotter && this.mission?.event === "evac") {
      this.state.spotterDown = true;
      this.toast?.("The spotter is down: the rocks fall wide now!", 4);
    }
    if (u.boss) {
      add("bossesDown");
      if (u.bossStat && u.bossStat !== "bossesDown") add(u.bossStat);
      this.toast?.(`${u.bossName || "THE OVERLORD"} HAS FALLEN!`, 6);
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
