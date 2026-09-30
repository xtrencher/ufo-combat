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

const _v = new THREE.Vector3();

function rand(a, b) {
  return a + Math.random() * (b - a);
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
    this.base = null; // Operation Sunburn: the enemy-held airport { x, z, y, site }
  }

  get mission() {
    return this.progress.mission;
  }

  // Called every frame (cheap: the checks run a few times a second).
  update(dt) {
    const m = this.enabled ? this.mission : null;
    this.ufos.rules = this.enabled ? this.progress.rules : null;
    this._trackNight();
    if (!m) {
      this.target = null;
      return;
    }
    if (m.id !== this.missionId) {
      this.missionId = m.id;
      this._cleanup();
      this.state = { t: 0 };
    }
    const st = this.state;
    st.t += dt;
    this.checkT -= dt;
    if (this.checkT > 0) {
      this._refreshTarget();
      return;
    }
    this.checkT = 0.5;
    if (this.player.dead) return;
    switch (m.event) {
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
        this._nightInfo();
        break;
      case "intact":
        this.ufos.forceIntact = true;
        this._intact();
        break;
      case "hunt":
        this._keepUfos(2, 650);
        this.target = this._nearestUfo(900, "UFO");
        break;
      case "squad":
        this._squad();
        break;
      case "takeoff":
        this._takeoff();
        break;
      case "dogfight":
        if (this.vehicles.active?.type === "jet") this._keepUfos(3, 900);
        this.target = this.vehicles.active?.type === "jet" ? this._nearestUfo(1400, "UFO") : this._airportTarget("Airport: call your jet (J)");
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
      case "mothership":
        this._mothership();
        break;
      case "airport":
        this._airport();
        break;
      default:
        this.target = null;
    }
  }

  // Leftovers of the previous mission's set-up go (or stay, if harmless).
  _cleanup() {
    this.ufos.forceIntact = false;
    for (const u of this.ufos.ufos) {
      if (u.missionTarget || u.raider) {
        u.missionTarget = false;
        u.raider = false;
        u.tether = 0;
        u.home = null;
        u.noLeave = false;
      }
    }
    for (const m of this.mobs.mobs) m.missionTarget = false;
    this.target = null;
  }

  // Follows a moving target (the marker updates every frame).
  _refreshTarget() {
    const t = this.target;
    if (!t || !t.follow) return;
    const f = t.follow;
    if (f.pos && !f.dead && !f.falling && f.state !== "gone") t.pos.copy(f.pos);
  }

  _setTarget(obj, label) {
    this.target = { pos: (obj.pos || obj).clone ? (obj.pos || obj).clone() : new THREE.Vector3(obj.x, obj.y ?? 0, obj.z), label, follow: obj.pos ? obj : null };
  }

  // ---------- Helpers ----------

  _alive(u) {
    return u && !u.falling && u.state !== "gone" && this.ufos.ufos.includes(u);
  }

  // A UFO for a mission, spawned out of sight at `dist` blocks.
  _spawnUfo(opts, dist = 140, low = true) {
    const p = this.player.position;
    const a = Math.random() * Math.PI * 2;
    const x = p.x + Math.cos(a) * dist;
    const z = p.z + Math.sin(a) * dist;
    const ground = Math.max(this.terrain.heightAt(Math.floor(x), Math.floor(z)), SEA_LEVEL);
    const y = ground + (low ? rand(26, 40) : rand(90, 140));
    return this.ufos.spawn({ ...opts, pos: { x, y, z }, hidden: true });
  }

  _nearestUfo(maxDist, label, filter = null) {
    let best = null;
    let bd = maxDist;
    const p = this.player.position;
    for (const u of this.ufos.ufos) {
      if (u.falling || u.state === "gone" || (filter && !filter(u))) continue;
      const d = u.pos.distanceTo(p);
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
    const p = this.player.position;
    const near = this.ufos.ufos.filter((u) => !u.falling && u.state !== "gone" && u.state !== "leave" && u.pos.distanceTo(p) < range).length;
    if (near < n && this.ufos.config.activity > 0) {
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
  _scout() {
    const st = this.state;
    if (!this._alive(st.scout) || st.scout.pos.distanceTo(this.player.position) > 700) {
      st.waitT = (st.waitT ?? 2) - 0.5;
      if (st.waitT > 0) return;
      st.waitT = 6;
      const design = ["saucer", "saucer_disc", "tictac", "saucer_domed"][Math.floor(Math.random() * 4)];
      const u = this._spawnUfo({ design, size: "small", style: "rapid" }, rand(90, 130));
      u.missionTarget = true;
      u.noLeave = true;
      u.tether = 110;
      u.home = this.player.position.clone();
      u.dodgeMul = 0.35; // it rarely dashes away from pistol fire
      u.maxHealth = u.health = 24; // about five pistol hits
      u.crashPlan = { exploded: false, crew: 2, crewKind: "alien" };
      st.scout = u;
      this.toast?.("A scout UFO is snooping around nearby: follow the marker.", 4);
    }
    if (st.scout.home && st.scout.home.distanceTo(this.player.position) > 160) st.scout.home.copy(this.player.position);
    this._setTarget(st.scout, "Scout UFO");
  }

  // 2. The crew: the aliens from the wreck; if they are gone (or never came
  // out), two more are beamed down near the player.
  _crew() {
    const st = this.state;
    const p = this.player.position;
    const aliens = this.mobs.mobs.filter((m) => !m.dead && m.spec.alien && m.pos.distanceTo(p) < 260);
    if (aliens.length === 0) {
      st.noneT = (st.noneT ?? 0) + 0.5;
      if (st.noneT > (st.spawned ? 20 : 8)) {
        st.noneT = 0;
        st.spawned = true;
        for (let i = 0; i < 2; i++) this._spawnAlien("alien", 40);
        this.toast?.("Two aliens were beamed down nearby!", 3);
      }
      this.target = null;
      return;
    }
    st.noneT = 0;
    aliens.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    this._setTarget(aliens[0], "Alien");
  }

  _spawnAlien(kind, dist, around = null) {
    const p = around || this.player.position;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.floor(p.x + Math.cos(a) * dist * rand(0.8, 1.2));
      const z = Math.floor(p.z + Math.sin(a) * dist * rand(0.8, 1.2));
      const world = this.mobs.world;
      if (!world.getChunk(x >> 4, z >> 4)) continue;
      const top = world.surfaceY(x, z);
      if (top < SEA_LEVEL) continue;
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
  _crate() {
    const st = this.state;
    const c = this.crates.nearest(this.player.position.x, this.player.position.z);
    if (!c) {
      st.dropT = (st.dropT ?? 0) - 0.5;
      if (st.dropT <= 0) {
        this.crates.drop({ dist: 60 + Math.random() * 30 });
        st.dropT = 60;
      }
      this.target = null;
      return;
    }
    this._setTarget(c.crate, "Supply crate");
  }

  // 4. Nights: a night counts when dawn comes and the player hasn't died
  // since dusk (or since the mission started, at night).
  _trackNight() {
    const h = this.sky.hours;
    const dark = h >= 19.5 || h < 5.5;
    const n = this.night;
    const deaths = this.stats.world.deaths ?? 0;
    if (dark && !n.active) {
      n.active = true;
      n.clean = true;
      n.deathsAt = deaths;
    }
    if (n.active && deaths > n.deathsAt) n.clean = false;
    if (!dark && n.active && h >= 5.5 && h < 12) {
      n.active = false;
      if (n.clean && this.enabled && !this.player.dead) {
        this.stats.add("nightsSurvived");
        if (this.mission?.event === "night") this.toast?.("Dawn! You survived the night.", 4);
      }
    }
  }

  _nightInfo() {
    this.target = null;
    const h = this.sky.hours;
    const dayLen = this.sky.dayLength ?? 600;
    const toHours = (target) => ((target - h + 24) % 24) * (dayLen / 24);
    this.state.note = this.night.active ? `Dawn in about ${Math.ceil(toHours(5.5) / 60)} min` : `Night falls in about ${Math.ceil(toHours(19.5) / 60)} min`;
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

  // 7. A squad dropped by a UFO about 90 blocks away.
  _squad() {
    const st = this.state;
    const p = this.player.position;
    const squad = (st.squad || []).filter((m) => !m.dead && this.mobs.mobs.includes(m));
    if (squad.length === 0) {
      st.waitT = (st.waitT ?? 1) - 0.5;
      if (st.waitT > 0) {
        this.target = null;
        return;
      }
      st.waitT = 25;
      // Where they land: open ground ahead of the player.
      const a = Math.random() * Math.PI * 2;
      const at = new THREE.Vector3(p.x + Math.cos(a) * 90, 0, p.z + Math.sin(a) * 90);
      st.squad = [];
      for (const kind of ["alien", "alien", "alien", "alien_gray", "alien_gray", "alien_red"]) {
        const m = this._spawnAlien(kind, 6, at);
        if (m) st.squad.push(m);
      }
      // The dropship: hovers over them a moment, then leaves.
      const ground = Math.max(this.terrain.heightAt(Math.floor(at.x), Math.floor(at.z)), SEA_LEVEL);
      const ship = this.ufos.spawn({ size: "medium", design: "saucer_disc", pos: { x: at.x, y: ground + 30, z: at.z }, hidden: true });
      ship.state = "trick";
      ship.trick = "hover";
      ship.timer = 8;
      if (st.squad.length) this.toast?.("An alien squad has landed: follow the marker!", 4);
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
    const jet = this.vehicles.vehicles.find((v) => v.type === "jet" && v.isPlayerJet && v.alive);
    if (jet && this.vehicles.active !== jet) this._setTarget(jet, "Your jet: get in (F)");
    else this.target = this._airportTarget("Airport") || null;
  }

  // 10. An enemy fighter that hunts the player (kept around for the mission).
  _fighter() {
    const st = this.state;
    const alive = st.jet && st.jet.alive && this.vehicles.vehicles.includes(st.jet);
    if (!alive) {
      st.waitT = (st.waitT ?? 3) - 0.5;
      if (st.waitT <= 0) {
        st.waitT = 30;
        const j = this.enemyJets.spawn({ hostile: true, dist: 900 });
        if (j) {
          j.mission = true;
          st.jet = j;
        }
      }
      this.target = null;
      return;
    }
    st.jet.provoked = Math.max(st.jet.provoked, 30);
    this._setTarget(st.jet, "Enemy fighter");
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
      for (let i = 0; i < left; i++) {
        const u = this.ufos.spawn({ size: i === 0 && left === 3 ? "medium" : "small", style: i % 2 ? "heavy" : "sweep", pos: { x: place.x + rand(-40, 40), y: place.y + rand(28, 40), z: place.z + rand(-40, 40) }, hidden: true });
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

  // 13. A mothership with an escort.
  _mothership() {
    const st = this.state;
    if (!this._alive(st.ship)) {
      if (this.progress.objectives(this.stats.world)[0]?.value >= 1) return;
      st.waitT = (st.waitT ?? 3) - 0.5;
      if (st.waitT > 0) return;
      st.waitT = 40;
      const u = this._spawnUfo({ size: "mothership", style: "sweep" }, 550, false);
      u.noLeave = true;
      u.missionTarget = true;
      u.home = u.pos.clone();
      u.tether = 150;
      st.ship = u;
      for (let i = 0; i < 3; i++) {
        const e = this.ufos.spawn({ size: "small", pos: { x: u.pos.x + rand(-60, 60), y: u.pos.y - 20, z: u.pos.z + rand(-60, 60) }, hidden: true });
        e.home = u.pos.clone();
        e.tether = 120;
      }
      this.toast?.("A MOTHERSHIP has arrived, with an escort!", 5);
    }
    this._setTarget(st.ship, "Mothership");
  }

  // 14. Operation Sunburn: the nearest airport is an enemy base, guarded by
  // UFOs and fighters; a nuke on it completes the mission.
  _airport() {
    const st = this.state;
    const p = this.player.position;
    if (!this.base) {
      const a = this.airports.nearest(4000);
      if (a) this.base = { x: a.site.x, y: a.site.y, z: a.site.z, site: a.site };
      else this.base = { x: p.x + 900, y: SEA_LEVEL + 6, z: p.z, site: null };
    }
    const b = this.base;
    const center = new THREE.Vector3(b.x, b.y, b.z);
    const d = center.distanceTo(p);
    // Guards: two UFOs over the base, and a fighter that scrambles when you come near.
    st.guards = (st.guards || []).filter((u) => this._alive(u));
    st.guardT = (st.guardT ?? 0) - 0.5;
    if (st.guards.length < 2 && st.guardT <= 0 && d < 1600) {
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
    this.target = { pos: center, label: "Enemy base: nuke it (B in the jet)", follow: null };
  }

  // The nuke went off: on the enemy base?
  nukeDetonated(center) {
    if (!this.enabled || this.mission?.event !== "airport" || !this.base) return;
    const d = Math.hypot(center.x - this.base.x, center.z - this.base.z);
    if (d < 170) {
      this.stats.add("airportsNuked");
      this.toast?.("DIRECT HIT: the enemy base is gone!", 5);
    } else this.toast?.(`The nuke missed the base by ${Math.round(d)} blocks.`, 3);
  }

  // A UFO the player shot down: raiders count for the village mission.
  ufoDown(u) {
    if (u.raider) this.stats.add("raidersDown");
  }

  // Extra lines for the HUD (below the objectives).
  note() {
    return this.state.note || "";
  }
}
