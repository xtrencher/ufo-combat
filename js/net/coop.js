// Playing together (Survival and Creative):
//  - one mission chain, the host's: its director sets the missions up, every
//    player's kills and deeds count (claims, reported stats), and the
//    tracker, the marker and the boss bar show the same mission to everyone;
//    a finished mission rewards every player ("misdone");
//  - what only a guest can see happening is reported to the host: a crate
//    opened, a take-off, a ship boarded (whitelisted stats);
//  - bigger groups get a bigger fight: more UFOs, tougher UFOs and hostile
//    creatures, a tougher boss (rules below);
//  - the long night restarts only when the whole group is down at once;
//  - deaths are announced to everyone; a dead player can respawn next to a
//    friend instead of at the world spawn;
//  - the host keeps each guest's things (inventory, armour, place) in its
//    own world save, by nickname, so a guest who comes back has them again;
//    a new guest starts next to the host;
//  - a guest's Creative "summon a UFO" asks the host (the UFOs are the host's).
import { MISSIONS } from "../progression.js";
import { saveJSON, loadJSON } from "../storage.js";
import { HOST_PID } from "./session.js";
import { vec1 } from "./interp.js";

// Stats a guest's own actions add to the shared missions.
const REPORTED = new Set(["cratesOpened", "takeoffs", "ufosBoarded", "jetsCalled"]);
const STATE_INTERVAL = 0.5;
const PDATA_INTERVAL = 8;

export class CoopSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this._sig = "";
    this._t = 0;
    this._pdT = PDATA_INTERVAL;
    this.teamWipes = 0;
    this._wiped = false;
    this.guestData = null; // host: nick -> data
    this._lastStep = -1;
    this.mission = null; // guest: the host's mission state
    const net = this.net;
    net.on("mis", (m) => this._onMission(m));
    net.on("misdone", (m) => this._onMissionDone(m));
    net.on("stat", (m, from) => this._onStat(m, from));
    net.on("died", (m, from) => this._onDied(m, from));
    net.on("pdata", (m, from) => this._onPlayerData(m, from));
    net.on("summon", (m, from) => this._onSummon(m, from));
    net.on("own", (m, from) => this._onOwn(m, from));
    net.on("gown", (m) => this.net.isClient && Array.isArray(m.l) && (this.groupOwned = new Set(m.l)));
    this.owned = new Map(); // host: pid -> Set of item ids that player has
    this.groupOwned = null; // what every player has (loot rolls; see main.js ownedItems)
    this._ownSig = "";
    this._ownT = 0;
    net.registerSync("coop", {
      save: (pid) => this._joinState(pid),
      load: (s) => this._loadJoinState(s),
    });
    this._hookStats();
  }

  // ---------- Lifecycle ----------

  start() {
    const g = this.game;
    if (this.net.isHost) {
      const host = this;
      g.missions.players = () => host.mp.entities.targets();
      g.missions.pilotJets = () => {
        const out = [];
        const act = g.vehicles.active;
        if (act?.type === "jet" && !act.isEnemyJet) out.push(act);
        for (const v of g.vehicles.vehicles) if (v.puppet && v.type === "jet" && v.netOcc && v.alive) out.push(v);
        return out;
      };
      g.missions.nightDeaths = () => host.teamWipes;
      this.guestData = loadJSON(`guests_${g.SEED}`) || {};
      g.progress.onChange = ((prev) => () => {
        prev?.();
        this._sig = "";
      })(g.progress.onChange);
      const done = g.progress.onComplete;
      g.progress.onComplete = (m) => {
        done?.(m);
        if (this.mp.active) this.net.broadcast({ t: "misdone", id: m.id });
      };
    } else {
      g.progress.mirror = true;
    }
    this._groupRules();
    this._deathButton();
  }

  stop() {
    const g = this.game;
    g.missions.players = null;
    g.missions.pilotJets = null;
    g.missions.nightDeaths = null;
    g.progress.mirror = false;
    g.progress.mirrorObjectives = null;
    g.ufos.groupScale = 1;
    g.ufos.groupHealth = 1;
    g.mobs.groupHealth = 1;
    g.progress.groupN = 1;
    if (this.net.isHost || this._wasHost) this._saveGuests();
    if (!this.net.isHost && g.missions && !g.GUEST) g.missions.enabled = true;
    document.getElementById("respawn-near-btn")?.classList.add("hidden");
  }

  playerJoined() {
    this._groupRules();
    this._sig = "";
  }

  playerLeft(p) {
    this._groupRules();
    if (this.owned.delete(p.pid)) this._groupOwnedChanged();
    // (Its things were saved with its last report.)
    if (this.net.isHost) this._saveGuests();
  }

  // Bigger groups: more and tougher enemies (2 players: 1.3x as many UFOs,
  // 1.25x their health; 4 players: 1.9x and 1.75x; capped at 6 players).
  _groupRules() {
    const g = this.game;
    const n = Math.max(1, Math.min(6, this.net.playerCount || 1));
    // Airports: a fighter for everyone (the host's count, never shrinking in a session).
    if (this.net.isHost) g.airports.groupSize = Math.max(g.airports.groupSize || 1, Math.min(8, this.net.playerCount || 1));
    // The missions' goals (progression.js goalFor): for everyone in the game now.
    if (this.net.isHost) g.progress.groupN = Math.max(1, Math.min(8, this.net.playerCount || 1));
    g.ufos.groupScale = 1 + 0.3 * (n - 1);
    g.ufos.groupHealth = 1 + 0.25 * (n - 1);
    // (Round 8: the missions' squads and kill goals now grow with the group,
    // so each creature only gets a little tougher.)
    g.mobs.groupHealth = 1 + 0.1 * (n - 1);
  }

  // ---------- Host: the mission state ----------

  update(dt) {
    if (!this.mp.active) return;
    const g = this.game;
    this._reportOwned(dt);
    if (this.net.isHost) {
      this._t -= dt;
      if (this._t <= 0) {
        this._t = STATE_INTERVAL;
        const s = this._missionState();
        const sig = JSON.stringify(s);
        if (sig !== this._sig) {
          this._sig = sig;
          this.net.broadcast(s);
        }
        // A whole team down at once (the long night starts over).
        const all = this.mp.entities.targets();
        const down = all.length > 0 && all.every((p) => p.dead);
        if (down && !this._wiped) this.teamWipes++;
        this._wiped = down;
      }
    } else if (this.mp.stateLoaded) {
      // A guest: its things, now and then, for the host to keep.
      this._pdT -= dt;
      if (this._pdT <= 0 && g.gameState !== "start") {
        this._pdT = PDATA_INTERVAL;
        this.net.toHost({ t: "pdata", d: g.playerData() });
      }
      this._guestMarker();
      // The host's mission objects (meteor rings, star fragments, the boss's shield).
      if (this.mission?.mo) g.missions.drawNetObjects(this.mission.mo, dt);
      if (this.mission?.boss) for (const u of this.mp.entities.ufoById.values()) if (u.boss && u.shield && !u.falling) g.missions.drawShield(u);
    }
    this._refreshDeathButton();
  }

  _missionState() {
    const g = this.game;
    const p = g.progress;
    const t = g.missions.target;
    const b = g.missions.bossInfo;
    return {
      t: "mis",
      on: !!g.missions.enabled,
      step: p.step,
      obj: p.objectives(g.stats.world).map((o) => [o.label, o.value, o.goal]),
      tgt: t ? [Math.round(t.pos.x * 10) / 10, Math.round(t.pos.y * 10) / 10, Math.round(t.pos.z * 10) / 10, t.label] : null,
      // What the marker follows (a guest points it at the nearest one of those to them).
      tk: t?.follow ? (t.follow.canopy ? "c" : t.follow.S ? (t.follow.missionTarget ? "u" : "U") : t.follow.spec && t.follow.kind ? "m" : null) : null,
      boss: b ? { health: Math.round(b.health * 1000) / 1000, shield: !!b.shield, final: !!b.final, pylons: b.pylons | 0, downT: Math.round(b.downT || 0) } : null,
      note: g.missions.note?.() || "",
      ev: p.mission?.event || null,
      mo: g.missions.netObjects?.() || null,
      gs: g.airports.groupSize || 1,
    };
  }

  // ---------- Guest: the mission state ----------

  _onMission(m) {
    if (this.net.isHost) return;
    const g = this.game;
    const p = g.progress;
    this.mission = m;
    if (Number.isInteger(m.step) && m.step !== p.step) {
      const first = this._lastStep < 0;
      p.step = Math.max(0, Math.min(MISSIONS.length, m.step));
      p.done = MISSIONS.slice(0, p.step).map((x) => x.id);
      // A new mission (not when just joining).
      if (!first && p.mission) g.toast?.(`NEW MISSION ${p.step + 1}/${MISSIONS.length}: ${p.mission.title}. ${p.mission.text}`, 7);
    }
    this._lastStep = p.step;
    if (Number.isInteger(m.gs)) g.airports.groupSize = Math.max(1, Math.min(8, m.gs));
    p.mirrorObjectives = (m.obj || []).map(([label, value, goal]) => ({ label, value, goal }));
    const d = g.missions;
    d.target = m.tgt ? { pos: new g.THREE.Vector3(m.tgt[0], m.tgt[1], m.tgt[2]), label: m.tgt[3], follow: null } : null;
    d.bossInfo = m.boss || null;
    d.note = () => m.note || "";
  }

  _onMissionDone(m) {
    if (this.net.isHost) return;
    const mission = MISSIONS.find((x) => x.id === m.id);
    if (mission && !this.game.player.creative) this.game.giveMissionReward(mission);
  }

  // A guest's marker: the mission's target nearest to this player (a crate,
  // a creature, a UFO of the mission), else where the host's points.
  _guestMarker() {
    const g = this.game;
    const m = this.mission;
    const d = g.missions;
    if (!m?.tgt || !m.tk || !d.target) return;
    const me = g.player.position;
    let best = null;
    let bd = Infinity;
    const consider = (pos) => {
      const dist = Math.hypot(pos.x - me.x, pos.z - me.z);
      if (dist < bd) {
        bd = dist;
        best = pos;
      }
    };
    if (m.tk === "c") for (const c of g.crates.active) consider(c.pos);
    else if (m.tk === "m") for (const mob of this.mp.entities.mobById.values()) if (mob.missionTarget && !mob.dead) consider(mob.pos);
    else if (m.tk === "u" || m.tk === "U") for (const u of this.mp.entities.ufoById.values()) if ((m.tk === "U" || u.missionTarget) && !u.falling && u.state !== "gone") consider(u.pos);
    if (best) d.target.pos.copy(best);
    else d.target.pos.set(m.tgt[0], m.tgt[1], m.tgt[2]);
  }

  // ---------- What everyone has (for loot rolls) ----------

  _reportOwned(dt) {
    this._ownT -= dt;
    if (this._ownT > 0 || !this.mp.stateLoaded || this.game.gameState === "start") return;
    this._ownT = 2;
    const list = [...this.game.myItems()].sort((a, b) => a - b).slice(0, 80);
    const sig = list.join(",");
    if (sig === this._ownSig) return;
    this._ownSig = sig;
    if (this.net.isHost) this._onOwn({ l: list }, HOST_PID);
    else this.net.toHost({ t: "own", l: list });
  }

  _onOwn(m, from) {
    if (!this.net.isHost || !Array.isArray(m.l)) return;
    this.owned.set(from, new Set(m.l.filter(Number.isFinite).slice(0, 80)));
    this._groupOwnedChanged();
  }

  _groupOwnedChanged() {
    let common = null;
    for (const [pid, set] of this.owned) {
      if (!this.net.players.has(pid)) continue;
      common = common ? new Set([...common].filter((id) => set.has(id))) : new Set(set);
    }
    this.groupOwned = common;
    const l = common ? [...common] : [];
    const sig = l.join(",");
    if (sig === this._gownSig) return;
    this._gownSig = sig;
    this.net.broadcast({ t: "gown", l });
  }

  // ---------- Stats a guest reports ----------

  _hookStats() {
    const st = this.game.stats;
    const add = st.add.bind(st);
    st.add = (key, n = 1) => {
      add(key, n);
      if (this.mp.active && this.net.isClient && REPORTED.has(key)) this.net.toHost({ t: "stat", k: key, n });
    };
  }

  _onStat(m, from) {
    if (!this.net.isHost || !REPORTED.has(m.k)) return;
    const n = Math.max(0, Math.min(5, Number(m.n) || 1));
    this.game.stats.addWorld(m.k, n);
  }

  // ---------- Deaths ----------

  // This player died (main.js): everyone hears of it.
  died(cause, text) {
    if (!this.mp.active) return;
    // (Told about someone else: "their own grenade", not "your own".)
    const third = String(text).replace(/\byour own\b/g, "their own").replace(/\byour\b/g, "their");
    this.net.toAll({ t: "died", text: third.slice(0, 80), cause: String(cause).slice(0, 40) });
  }

  _onDied(m, from) {
    const name = this.mp.playerName(from);
    this.mp.feed(`${name}: ${m.text || "died"}`);
    this.mp.dogfight?.remoteDied?.(from, m.cause);
  }

  // "Respawn near <friend>" on the death screen (co-op).
  _deathButton() {
    if (document.getElementById("respawn-near-btn")) return;
    const btn = document.createElement("button");
    btn.className = "btn secondary hidden";
    btn.id = "respawn-near-btn";
    btn.style.marginLeft = "10px";
    btn.addEventListener("click", () => {
      const r = this._buddy();
      if (r) this.game.respawnNear(r.livePos.x, r.livePos.z);
    });
    document.getElementById("respawn-btn")?.after(btn);
  }

  _buddy() {
    // The nearest friend on foot and alive.
    const me = this.game.player.position;
    let best = null;
    let bd = Infinity;
    for (const r of this.mp.players.active()) {
      if (r.dead || r.vehicle || r.vehicleNid) continue;
      const d = r.livePos.distanceTo(me);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  _refreshDeathButton() {
    const btn = document.getElementById("respawn-near-btn");
    if (!btn) return;
    const show = this.mp.active && this.game.gameState === "dead" && this.mp.mode !== "dogfight";
    const r = show ? this._buddy() : null;
    btn.classList.toggle("hidden", !r);
    if (r) {
      const text = `Respawn near ${r.nick}`;
      if (btn.textContent !== text) btn.textContent = text;
    }
  }

  // ---------- A guest's things, kept by the host ----------

  _onPlayerData(m, from) {
    if (!this.net.isHost || !m.d || typeof m.d !== "object") return;
    const p = this.net.players.get(from);
    if (!p) return;
    this.guestData[p.nick.toLowerCase()] = { ...m.d, t: Date.now() };
    this._wasHost = true;
    this._dirty = true;
    this._saveT = (this._saveT ?? 0) + 1;
    if (this._saveT >= 4) this._saveGuests();
  }

  _saveGuests() {
    if (!this.guestData || !this._dirty) return;
    this._saveT = 0;
    this._dirty = false;
    // (At most 24 guests are remembered: the oldest go first.)
    const list = Object.entries(this.guestData).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 24);
    this.guestData = Object.fromEntries(list);
    saveJSON(`guests_${this.game.SEED}`, this.guestData);
  }

  // What a joining guest gets: its own things from last time (or nothing),
  // and where the host is (a new guest starts next to it).
  _joinState(pid) {
    const g = this.game;
    const p = this.net.players.get(pid);
    const you = p && this.guestData ? this.guestData[p.nick.toLowerCase()] || null : null;
    const hp = g.player.position;
    return { you, host: g.player.dead || g.vehicles.active ? null : vec1(hp), mis: this._missionState() };
  }

  _loadJoinState(s) {
    if (!s) return;
    const g = this.game;
    if (s.mis) this._onMission(s.mis);
    if (s.you) {
      g.applyPlayerData(s.you);
      this._returning = true;
    } else if (s.host) {
      // Next to the host.
      g.teleport(s.host[0] + 2.5, null, s.host[2] + 1.5);
    }
  }

  // ---------- Summons (Creative) ----------

  summon(kind, pos) {
    this.net.toHost({ t: "summon", k: kind, p: pos.map((v) => Math.round(v * 10) / 10) });
  }

  _onSummon(m, from) {
    if (!this.net.isHost || this.mp.mode !== "creative") return;
    if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    if (!["roam", "attack", "crash"].includes(m.k)) return;
    this.game.summonUfo(m.k, m.p);
  }
}

export { HOST_PID };
