// The host's world on the clients: UFOs, hostile creatures (zombies,
// skeletons, spiders, aliens, guards) and enemy fighters are simulated by
// the host only. Each client gets:
//   "eadd"  (reliable) what it needs to build one: a UFO's design and size, a
//           creature's kind, a fighter's paint; once, when it comes near;
//   "es"    (fast, 15 times a second) where everything near it is now and
//           how it looks (attitude, walk, beam, falling, health, flags);
//   "erem"  (reliable) what went away (out of range, gone, removed).
// The client draws them as puppets (interpolated ~0.1 s in the past).
//
// The other way round, a client's hits on those puppets (bullets, bolts,
// arrows, rockets, grenades, swords, the rail, missiles, the tractor beam)
// become "hit" claims; the host applies them (and decides deaths, kills,
// missions). The host's AI chooses between all players: each player is
// represented on the host by a stand-in with the Player's shape (position,
// velocity, vehicle, damage(), applyImpulse()), whose damage goes to that
// player as a message ("dmg"; the player's own armour and difficulty
// apply there). Kills are announced to their player ("kill"), who rolls the
// loot; it drops into the shared world (items.js) for anyone to pick up.
//
// (Round 11) A Survival world's mobs: their looks and states travel too (a
// sheep's colour and wool, a villager's trade, babies, love, a creeper's
// fuse, an enderman's anger and the block it holds, a witch drinking). A
// guest's use of the host's creatures is a claim like a hit ("us": shears,
// food, iron; "sp": a creature its egg or spawn egg asks for); trading is
// the host's ("tq"/"to": a villager's offers, "tr"/"tk": one trade, yes or
// no); what the host's creatures do to a guest beyond damage comes as
// messages ("eff": a witch's potion, "mxp": breeding experience).
//
// (Round 12) The Nether's and the End's creatures: their states too (a
// ghast's shooting face, a charged blaze, a piglin admiring its gold or
// shaking, a cold strider, a shulker's lid and the side it holds on to),
// and their fireballs and bullets, which are creatures here (the host's
// mobs.js flies them; a guest's blow or arrow on one is a hit claim: it
// sends a ghast's fireball back). A guest tells the host whether it wears
// gold ("gold": the host's piglins leave it be); a guest's bartering is a
// use claim ("barter"); a blaze's fire on a guest is an effect ("eff"
// "onfire"); an advancement for a guest comes as "adv".
import * as THREE from "three";
import { Interp, r2, r3, vec2, vec1 } from "./interp.js";
import { HOST_PID } from "./session.js";
import { EnemyJet } from "../enemy-jets.js";
import { SPECIES, specOf } from "../mobs.js";
import { isPlayerCause } from "../damage.js";
import { encodeOffers, decodeOffers } from "../trading.js";
import { LIB, ITEM } from "../content/base.js";

const SNAP_RATE = 15;
const UFO_RANGE = 1100; // blocks: UFOs within this of a client are sent
const MOB_RANGE = 120; // creatures within this of a client: every snapshot
// (Round 9) Farther out, the fighting ones (hostile creatures, aliens,
// soldiers, mission targets) are sent too, at a third of the rate and the
// nearest few only, so a guest's sniper, rail or jet guns reach as far as
// the host's: out to FAR_MOB_RANGE on foot, FAR_MOB_RANGE_AIR in a vehicle.
const FAR_MOB_RANGE = 320;
const FAR_MOB_RANGE_AIR = 420;
const FAR_MOB_MAX = 48;
const SNAP_MOBS_PER_MSG = 250; // (about 16k characters: under a fast message's limit, see session.js)
const JET_RANGE = 2600;
const KEEP = 1.2; // hysteresis: already sent ones are kept a little farther
const EYE = 1.62;
const KEEP_RADIUS = 5; // chunks of ground the host keeps generated around a player on foot (Round 9: was 3, too small for creatures to spawn around them; see mobs.js REMOTE_REACH)
const _v = new THREE.Vector3();
const GOLD_ARMOR = new Set([ITEM.GOLD_HELMET, ITEM.GOLD_CHESTPLATE, ITEM.GOLD_LEGGINGS, ITEM.GOLD_BOOTS]);

// A remote player as the host's AI sees them.
class AiProxy {
  constructor(sync, remote) {
    this.sync = sync;
    this.r = remote;
    this.pid = remote.pid;
    this.isRemote = true;
  }
  get position() {
    return this.r.livePos;
  }
  get velocity() {
    return this.r.liveVel;
  }
  get dead() {
    return this.r.dead || !this.r.seen;
  }
  get creative() {
    return this.r.creative;
  }
  get vehicle() {
    return this.r.vehicle;
  }
  get gone() {
    return !this.sync.mp.players.remotes.has(this.pid);
  }
  get onGround() {
    return true;
  }
  get sneaking() {
    return false;
  }
  getEyePosition() {
    const p = this.r.livePos;
    return new THREE.Vector3(p.x, p.y + EYE, p.z);
  }
  // Damage to this player: sent to them (their armour, difficulty and
  // vehicle apply there). Returns whether it will (most likely) be applied.
  damage(amount, cause, { pierce = false, projectile = false, from = null } = {}) {
    if (this.dead || amount <= 0) return false;
    const v = this.vehicle;
    if (v && !pierce) {
      v.damage(amount, cause);
      return false;
    }
    if (this.creative) return false;
    this.sync.net.send(this.pid, { t: "dmg", a: amount, c: cause, pi: pierce ? 1 : 0, pr: projectile ? 1 : 0, f: from ? vec1(from) : 0 });
    return true;
  }
  applyImpulse(v) {
    this.sync.net.send(this.pid, { t: "imp", v: [r2(v.x), r2(v.y), r2(v.z)] });
  }
  // (Round 11) What they hold (animals follow their food), and a status
  // effect from the host's creatures (a witch's potion): theirs to apply.
  get heldId() {
    return this.r.heldId | 0;
  }
  addEffect(name, seconds, level = 1) {
    if (this.dead || this.creative) return;
    this.sync.net.send(this.pid, { t: "eff", n: String(name), d: r1(seconds), a: level | 0 });
  }
  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.r.yaw) * Math.cos(this.r.pitch), Math.sin(this.r.pitch), -Math.cos(this.r.yaw) * Math.cos(this.r.pitch));
  }
  // (Round 12) Set alight by the host's creature (a blaze's fireball): theirs to burn.
  setFire(seconds) {
    if (this.dead || this.creative) return;
    this.sync.net.send(this.pid, { t: "eff", n: "onfire", d: r1(seconds), a: 1 });
  }
}

export class EntitySync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.proxies = new Map(); // pid -> AiProxy (host)
    this.known = new Map(); // pid -> { u: Map(id -> obj), m: Map, j: Map } (host)
    this.ufoById = new Map(); // client: host id -> puppet UFO
    this.mobById = new Map();
    this.jetById = new Map();
    this.claims = [];
    this._snapT = 0;
    this._keepT = 0;
    this._capT = 0;
    this._hooked = false;
    const net = this.net;
    net.on("eadd", (m) => this._onAdd(m));
    net.on("es", (m) => this._onSnap(m));
    net.on("erem", (m) => this._onRem(m));
    net.on("hit", (m, from) => this._onHits(m, from));
    net.on("dmg", (m) => this._onDamage(m));
    net.on("imp", (m) => this._onImpulse(m));
    net.on("kill", (m) => this._onKill(m));
    net.on("loot", (m) => this._onLoot(m));
    net.on("mobdie", (m) => this._onMobDie(m));
    net.on("abd", (m) => this._onAbducted(m));
    // Warnings the host's AI meant for this player (see _hook and start).
    net.on("alarm", () => {
      const now = performance.now() / 1000;
      if (now - (this._alarmT ?? -99) > 20) this.game.toast?.("Restricted area! Guards are firing!", 3);
      this._alarmT = now;
    });
    net.on("dashw", () => this.game.ufos.onMessage?.("A UFO is right above you! Shoot it to break the beam!"));
    // (Round 11) Trading with the host's villagers, effects and experience from its creatures.
    net.on("tq", (m, from) => this._onTradeQuery(m, from));
    net.on("tr", (m, from) => this._onTradeRequest(m, from));
    net.on("to", (m) => this.game.mobs.tradeAnswer(m.id, decodeOffers(m.o)));
    net.on("tk", (m) => this.game.mobs.tradeAnswer(m.id, decodeOffers(m.o), !!m.ok));
    net.on("eff", (m) => this._onEffect(m));
    // (Round 12) A guest's gold armor (the host's piglins), an advancement for this player.
    net.on("gold", (m, from) => {
      const px = this.net.isHost ? this.proxy(from) : null;
      if (px && px !== this.game.player) px.goldArmor = !!m.g;
    });
    net.on("adv", (m) => typeof m.n === "string" && this.game.toast?.(m.n.slice(0, 80), 5));
    this.game.mobs.onToast = (text, seconds) => this.game.toast?.(text, seconds);
    this._goldT = 0;
    this._goldSent = null;
    net.on("mxp", (m) => {
      const at = Array.isArray(m.at) && m.at.every(Number.isFinite) ? m.at : null;
      const p = this.game.player.position;
      if (Number.isFinite(m.a) && m.a > 0) LIB.giveXp?.(Math.min(100, m.a), at ? at[0] : p.x, at ? at[1] + 0.5 : p.y, at ? at[2] : p.z);
    });
  }

  // ---------- Lifecycle ----------

  start() {
    const g = this.game;
    if (!this._hooked) this._hook();
    g.mobs.localPid = this.net.pid || HOST_PID; // (Round 11: a tame wolf's owner is this player, online)
    if (this.net.isHost) {
      g.mobs.targets = () => this.targets();
      g.ufos.targets = () => this.targets();
      g.enemyJets.targets = () => this.targets();
      g.airports.positions = () => this.targets().filter((t) => !t.dead).map((t) => (t.vehicle ? t.vehicle.pos : t.position));
      // A guest a UFO dashes in on is warned on their own screen (ufos.js toasts the host's own).
      g.ufos.onDashWarn = (t) => t?.isRemote && this.net.send(t.pid, { t: "dashw" });
      // (Round 11) A guest's breeding experience: theirs, as orbs on their screen.
      g.mobs.onRemoteXp = (pid, amount, pos) => this.net.send(pid, { t: "mxp", a: amount | 0, at: vec1(pos) });
      // (A tame wolf's owner is also kept by nickname: a guest who rejoins has a new pid.)
      g.mobs.nickOf = (pid) => (this.net.players.get(pid)?.nick || "").toLowerCase();
      // (Round 12) A guest's advancement (a ghast killed by its own fireball, sent back).
      g.mobs.onRemoteToast = (pid, text) => this.net.send(pid, { t: "adv", n: text });
    } else {
      // A guest: the host's world, drawn from its states.
      g.mobs.puppets = true;
      g.ufos.puppets = true;
      g.airports.guardsEnabled = false;
      g.enemyJets.puppets = true;
      // Whatever this page had of its own goes (the host's comes next).
      g.ufos.clear();
      // (Every creature but the ambient flyers: the host's come next.)
      for (let i = g.mobs.mobs.length - 1; i >= 0; i--) if (!g.mobs.mobs[i].spec.flies) g.mobs._remove(i);
      g.missions.enabled = false;
    }
  }

  stop() {
    const g = this.game;
    g.mobs.targets = null;
    g.ufos.targets = null;
    g.enemyJets.targets = null;
    g.airports.positions = null;
    g.ufos.onDashWarn = null;
    g.mobs.onRemoteXp = null;
    g.mobs.nickOf = null;
    g.mobs.onRemoteToast = null;
    this._goldSent = null;
    // (Host: the guests' wolves wait for whoever clicks them next, or for their owner's return.)
    if (!g.mobs.puppets) g.mobs.ownerGone((pid) => pid !== HOST_PID);
    g.mobs.localPid = HOST_PID;
    g.mobs.puppets = false;
    g.ufos.puppets = false;
    g.airports.guardsEnabled = true;
    g.enemyJets.puppets = false;
    // A guest's puppets go with the session.
    for (const u of this.ufoById.values()) u.state = "gone";
    for (const m of this.mobById.values()) this._removeMob(m);
    for (const j of this.jetById.values()) if (g.vehicles.vehicles.includes(j)) g.vehicles.remove(j);
    this.ufoById.clear();
    this.mobById.clear();
    this.jetById.clear();
    this.known.clear();
    this.proxies.clear();
    this.claims.length = 0;
    // (The ground kept around the guests goes too.)
    if (this._keepSet) {
      this._keepSet = null;
      g.world.releaseChunks();
    }
  }

  // Host: a guest who rejoins gets their tame wolves back (by nickname).
  playerJoined(p) {
    if (this.net.isHost && p.pid !== this.net.pid) this.game.mobs.ownerBack(p.pid, (p.nick || "").toLowerCase());
  }

  playerLeft(p) {
    if (this.net.isHost) this.game.mobs.ownerGone((pid) => pid === p.pid);
    this.known.delete(p.pid);
    const px = this.proxies.get(p.pid);
    this.proxies.delete(p.pid);
    // Whatever was after them looks for someone else.
    if (px) for (const u of this.game.ufos.ufos) if (u.tgtPlayer === px) u.tgtPlayer = null;
  }

  // Host: every player in the game, as the AI sees them.
  targets() {
    const out = [];
    for (const r of this.mp.players.active()) {
      let px = this.proxies.get(r.pid);
      if (!px) this.proxies.set(r.pid, (px = new AiProxy(this, r)));
      out.push(px);
    }
    // (A host still on the main menu is nobody's target, unless nobody else is in.)
    if (this.game.gameState !== "start" || !out.length) out.unshift(this.game.player);
    return out;
  }

  proxy(pid) {
    if (pid === this.net.pid) return this.game.player;
    const r = this.mp.players.get(pid);
    if (!r) return null;
    let px = this.proxies.get(pid);
    if (!px) this.proxies.set(pid, (px = new AiProxy(this, r)));
    return px;
  }

  // ---------- Hooks ----------

  _hook() {
    this._hooked = true;
    const g = this.game;
    // A guest's hits on the host's things: claims.
    g.mobs.onPuppetHit = (m, amount, dir, kb, byPlayer) => {
      if (!byPlayer) return;
      // (Round 11: a shot, not a blow, marked: an enderman dodges it, on the host.)
      // (Round 11: and the blow's Fire Aspect / Flame seconds and Looting level.)
      const ex = g.mobs.attackExtras;
      this.claims.push(["m", m.net.id, r1(amount), dir ? r2(dir.x) : 0, dir ? r2(dir.z) : 0, r1(kb || 0), g.mobs.projectileHit ? 1 : 0, ex?.fire || 0, ex?.looting || 0]);
      g.hud?.hitMarker?.();
    };
    // (Round 11) A guest's shears, food or iron on the host's creature; a
    // creature its egg asks for; a villager's trades.
    g.mobs.onPuppetUse = (m, action) => this.claims.push(["us", m.net.id, action]);
    g.mobs.onPuppetSpawn = (kind, x, y, z, baby, variant) => this.claims.push(["sp", kind, r2(x), r2(y), r2(z), baby ? 1 : 0, variant | 0]);
    g.mobs.onPuppetTradeQuery = (m) => this.net.toHost({ t: "tq", id: m.net.id });
    g.mobs.onPuppetTrade = (m, i) => this.net.toHost({ t: "tr", id: m.net.id, i });
    g.mobs.onPuppetUpdate = (m, dt) => this._driveMob(m, dt);
    // (Round 9) A guest's tractor beam on the host's creature: a claim; the
    // host lifts its real one and says so when it is aboard ("abd").
    g.mobs.onPuppetBeam = (m, lift, topY, top) => {
      const now = g.mobs.time;
      if (now - (m._beamClaimT ?? -9) < 0.1) return;
      m._beamClaimT = now;
      this.claims.push(["bl", m.net.id, r1(lift), r1(topY), r1(top.x), r1(top.z)]);
    };
    g.mobs.onRemoteAbduct = (m, pid) => {
      if (this.net.isHost && pid && pid !== this.net.pid) this.net.send(pid, { t: "abd", id: m.id, kind: m.kind });
    };
    g.ufos.onPuppetHit = (u, amount, from) => {
      this.claims.push(["u", u.net.id, r1(amount), from?.isVector3 ? r1(from.x) : 0, from?.isVector3 ? r1(from.y) : 0, from?.isVector3 ? r1(from.z) : 0]);
    };
    g.ufos.onPuppetUpdate = (u, dt) => this._driveUfo(u, dt);
    // (Round 9) A guest's beam pulling the host's fighter: the host pulls it.
    g.vehicles.onPuppetJetPull = (j, v) => {
      if (j.netEJ) this.claims.push(["cj", j.netEJ, r1(v.x), r1(v.y), r1(v.z)]);
    };
    g.ufos.onPuppetAbsorb = (u, ship) => {
      if (ship?.net) this.claims.push(["ab", u.net.id, ship.net.nid]);
    };
    // Host: who killed what (the last player to hit it), kills and loot for everyone.
    // (A creature's own drops fall where it died, on the host, for everyone:
    // items are shared online, see items.js. A guest's copies drop nothing.)
    g.mobs.keepDrops = (m) => !m.net;
    // The guards' alarm a guest set off: the warning is theirs, not the host's.
    const onAlarm = g.mobs.onAlarm;
    g.mobs.onAlarm = (o, who) => {
      if (!this.mp.active || !this.net.isHost || !who?.isRemote) {
        onAlarm?.(o, who);
        return;
      }
      const now = performance.now() / 1000;
      if (now - (who._alarmT ?? -99) > 20) this.net.send(who.pid, { t: "alarm" });
      who._alarmT = now;
    };
    // Kills: the killer rolls the loot, which drops for everyone to pick up
    // (Round 8: one shared world, no personal loot).
    const onKill = g.mobs.onKill;
    g.mobs.onKill = (m, byPlayer) => {
      if (!this.mp.active || !this.net.isHost || !byPlayer || !m.lastHitPid || m.lastHitPid === HOST_PID) {
        onKill?.(m, byPlayer);
        if (byPlayer) this._hostKill("mob", m);
        return;
      }
      g.mobKilled(m, { mine: false });
      this._killFor(m.lastHitPid, "mob", m);
    };
    const onShotDown = g.ufos.onShotDown;
    g.ufos.onShotDown = (u, byPlayer) => {
      const pid = u.lastHitPid;
      if (!this.mp.active || !this.net.isHost || !byPlayer || !pid || pid === HOST_PID) {
        onShotDown?.(u, byPlayer);
        if (byPlayer) this._hostKill("ufo", u);
        return;
      }
      const killer = this.mp.players.get(pid);
      g.ufoKilled(u, { mine: false, inJet: killer?.vehicle?.type === "jet" });
      this._killFor(pid, "ufo", u);
    };
    const onJetDown = g.enemyJets.onDown;
    g.enemyJets.onDown = (jet, cause) => {
      const pid = jet.lastHitByPid;
      if (!this.mp.active || !this.net.isHost || !pid || pid === HOST_PID || jet.downedByOther) {
        onJetDown?.(jet, cause);
        if (!jet.downedByOther) this._hostKill("jet", jet);
        return;
      }
      g.stats.addWorld("enemyJetsDown");
      if (jet.hijacked) g.stats.addWorld("hijackedDown");
      this._killFor(pid, "jet", jet);
    };
  }

  _near(a, b, d = 250) {
    return a.distanceTo(b) < d;
  }

  // ---------- Host: snapshots ----------

  update(dt) {
    if (!this.mp.active) return;
    this.game.mobs.localPid = this.net.pid || HOST_PID;
    if (this.net.isHost) {
      this._snapT -= dt;
      if (this._snapT <= 0) {
        this._snapT = 1 / SNAP_RATE;
        this._round = ((this._round || 0) + 1) % 3000;
        for (const [pid, link] of this.net.links) if (link.ready) this._snapshotFor(pid);
      }
      this._keepT -= dt;
      if (this._keepT <= 0) {
        this._keepT = 0.25;
        this._keepGround();
      }
      // Hijacked fighters go for the nearest player.
      for (const j of this.game.enemyJets.jets) {
        if (!j.hijacked || (j._foeT = (j._foeT ?? 0) - dt) > 0) continue;
        j._foeT = 3;
        const list = this.targets().filter((t) => !t.dead);
        let best = null;
        let bd = Infinity;
        for (const t of list) {
          const d = (t.vehicle ? t.vehicle.pos : t.position).distanceTo(j.pos);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (best) j.foe = best === this.game.player ? null : best;
      }
    } else {
      // (Round 12) Whether this guest wears a piece of gold armor, when it changes (and now and then).
      this._goldT -= dt;
      if (this._goldT <= 0 && this.mp.stateLoaded) {
        this._goldT = 0.5;
        const gold = !!this.game.inventory?.armor?.some((s) => s && GOLD_ARMOR.has(s.id));
        if (gold !== this._goldSent || (this._goldN = (this._goldN || 0) + 1) % 20 === 0) {
          this._goldSent = gold;
          this.net.toHost({ t: "gold", g: gold ? 1 : 0 });
        }
      }
      // A guest: claims, and the tractor beam's hold on the host's UFOs.
      this._capT -= dt;
      if (this._capT <= 0) {
        this._capT = 0.2;
        for (const u of this.ufoById.values()) {
          if (!u.captured) continue;
          const by = u.captured.by;
          if (by?.net) this.claims.push(["cap", u.net.id, by.net.nid, r1(u.pullVel?.x ?? 0), r1(u.pullVel?.y ?? 0), r1(u.pullVel?.z ?? 0)]);
          u.captured = null;
        }
      }
    }
    if (this.claims.length) {
      this.net.toHost({ t: "hit", l: this.claims });
      this.claims = [];
    }
  }

  _center(pid) {
    const r = this.mp.players.get(pid);
    if (!r || !r.seen) return null;
    const v = r.vehicle;
    return v ? v.pos : r.livePos;
  }

  _snapshotFor(pid) {
    const g = this.game;
    const c = this._center(pid);
    if (!c) return;
    let k = this.known.get(pid);
    if (!k) this.known.set(pid, (k = { u: new Map(), m: new Map(), j: new Map() }));
    const add = { u: [], m: [], j: [] };
    const rem = { u: [], m: [], j: [] };
    const snap = { t: "es", ts: r3(this.net.time), u: [], m: [], j: [] };
    // UFOs.
    const seenU = new Set();
    for (const u of g.ufos.ufos) {
      if (u.state === "gone") continue;
      const d = u.pos.distanceTo(c);
      const was = k.u.has(u.id);
      if (d > UFO_RANGE * (was ? KEEP : 1)) continue;
      seenU.add(u.id);
      if (!was) {
        k.u.set(u.id, u);
        add.u.push(this._ufoInfo(u));
      }
      snap.u.push(this._ufoState(u));
    }
    for (const [id, u] of k.u) {
      if (!seenU.has(id)) {
        k.u.delete(id);
        rem.u.push([id, u.state === "gone" ? 1 : 0]);
      }
    }
    // Creatures (hostile ones, animals, villagers: everything but the little
    // ambient flyers, which are each player's own). Near ones in every
    // snapshot; the fighting ones farther out too, a third as often (Round 9).
    const seenM = new Set();
    const r = this.mp.players.get(pid);
    const farRange = r?.vehicle ? FAR_MOB_RANGE_AIR : FAR_MOB_RANGE;
    const far = [];
    const tick = this._round || 0;
    for (const m of g.mobs.mobs) {
      if (m.spec.flies || m.net) continue;
      const d = Math.hypot(m.pos.x - c.x, m.pos.z - c.z);
      const was = k.m.has(m.id);
      if (d > MOB_RANGE * (was ? KEEP : 1)) {
        // (Ranked with the same hysteresis: one already sent isn't swapped out and back for a nearer one.)
        if ((m.spec.hostile || m.missionTarget) && d <= farRange * (was ? KEEP : 1)) far.push([d / (was ? KEEP : 1), m]);
        continue;
      }
      this._mobOut(m, k, add, snap, seenM, true);
    }
    if (far.length) {
      far.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(far.length, FAR_MOB_MAX); i++) this._mobOut(far[i][1], k, add, snap, seenM, tick % 3 === 0);
    }
    for (const [id] of k.m) {
      if (!seenM.has(id)) {
        k.m.delete(id);
        rem.m.push(id);
      }
    }
    // Enemy fighters.
    const seenJ = new Set();
    for (const j of g.vehicles.vehicles) {
      if (!j.isEnemyJet) continue;
      const d = j.pos.distanceTo(c);
      const was = k.j.has(j.id);
      if (d > JET_RANGE * (was ? KEEP : 1)) continue;
      seenJ.add(j.id);
      if (!was) {
        k.j.set(j.id, j);
        add.j.push({ id: j.id, data: { jetType: j.jetType, pos: vec2(j.pos), q: j.q.toArray().map(r3), hijacked: !!j.hijacked, speed: r1(j.speed) } });
      }
      const s = this.mp.vehicles._state(j);
      s.n = j.id;
      s.al = j.alive ? 1 : 0;
      snap.j.push(s);
    }
    for (const [id] of k.j) {
      if (!seenJ.has(id)) {
        k.j.delete(id);
        rem.j.push(id);
      }
    }
    if (add.u.length || add.m.length || add.j.length) this.net.send(pid, { t: "eadd", ...add });
    if (rem.u.length || rem.m.length || rem.j.length) this.net.send(pid, { t: "erem", ...rem });
    if (snap.u.length || snap.m.length || snap.j.length) {
      // (A fast message too big for one part would be dropped: a big crowd of
      // creatures goes in several, all with the same time stamp.)
      if (snap.m.length <= SNAP_MOBS_PER_MSG) this.net.send(pid, snap, { fast: true });
      else for (let i = 0; i < snap.m.length; i += SNAP_MOBS_PER_MSG) this.net.send(pid, { t: "es", ts: snap.ts, u: i ? [] : snap.u, m: snap.m.slice(i, i + SNAP_MOBS_PER_MSG), j: i ? [] : snap.j }, { fast: true });
    }
  }

  // One creature for one client: added the first time, its state in this
  // snapshot when `state` (far ones skip some), kept on the "seen" list.
  _mobOut(m, k, add, snap, seenM, state) {
    seenM.add(m.id);
    if (!k.m.has(m.id)) {
      k.m.set(m.id, m);
      add.m.push({ id: m.id, kind: m.kind, p: vec2(m.pos), y: r2(m.yaw), hp: m.maxHealth, leader: m.leader ? 1 : 0, ld: m.carryId || 0, dead: m.dead ? 1 : 0, v: m.variant || 0, b: m.baby ? 1 : 0 });
      state = true;
    }
    if (!state) return;
    // (Round 11: the vanilla states, flags 128 and up; a creeper's fuse and an
    // enderman's block after the health, only when there are any.)
    const vf = (m.baby ? 128 : 0) | (m.sheared ? 256 : 0) | (m.loveT > 0 ? 512 : 0) | (m.angerT > 0 ? 1024 : 0) | (m.drinkT > 0 ? 2048 : 0) | (m.breedCd > 0 || m.loveT > 0 ? 4096 : 0) | (m.tamed ? 8192 : 0) | (m.sitting ? 16384 : 0) | (m.kind === "sheep" ? 32768 | ((m.variant & 15) << 16) : 0);
    const s = [m.id, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), r2(m.headYaw || 0), r2(m.headPitch || 0), r2(m.walk || 0), (m.dead ? 1 : 0) | (m.burning ? 2 : 0) | (m.onGround ? 4 : 0) | (m.ai?.target ? 8 : 0) | (m.ai?.state === "hide" && m.ai.timer > 0 ? 16 : 0) | (m.calmT > 0 ? 32 : 0) | (m.missionTarget ? 64 : 0) | vf, r2(m.attack ?? 1), r1(m.vel?.y ?? 0), Math.round((Math.max(0, m.health) / (m.maxHealth || 1)) * 1000) / 1000];
    // (Round 12: the Nether's and the End's states, after those, when there are any.)
    const nf = (m.admireT > 0 ? 1 : 0) | (m.shootFace ? 2 : 0) | (m.charged ? 4 : 0) | (m.cold ? 8 : 0) | (m.shakeT > 0 ? 16 : 0) | (m.spec.still ? ((m.variant & 7) << 8) | 32 : 0);
    const peek = m.peek > 0 ? r2(m.peek) : 0;
    if (m.fuse > 0 || m.carry || m.owner || nf || peek) s.push(r2(m.fuse || 0), m.carry || 0, m.owner || 0, nf, peek);
    snap.m.push(s);
  }

  _ufoInfo(u) {
    return { id: u.id, spec: u.spec, size: u.size, radius: r2(u.radius), style: u.style, crew: u.crewKind, maxHp: u.maxHealth, p: vec2(u.pos), y: r2(u.yaw), boss: u.boss ? 1 : 0, pylon: u.pylon ? 1 : 0, mission: u.missionTarget ? 1 : 0, fade: u.age < u.spawnFade ? r2(u.spawnFade - u.age) : 0 };
  }

  _ufoState(u) {
    const f = (u.falling ? 1 : 0) | (u.beam?.on ? 2 : 0) | (u.hostile ? 4 : 0) | (u.shield ? 8 : 0) | (u.immune ? 16 : 0) | (u.beam?.floating ? 32 : 0) | (u.byPlayer ? 64 : 0) | (u.splashed ? 128 : 0);
    const s = [u.id, r2(u.pos.x), r2(u.pos.y), r2(u.pos.z), r3(u.yaw), r3(u.tilt.x), r3(u.tilt.y), r1(u.vel.x), r1(u.vel.y), r1(u.vel.z), Math.round((u.health / u.maxHealth) * 1000) / 1000, f];
    if (u.beam?.on) s.push(r2(u.beam.bottomY), r2(u.beam.radius ?? u.radius));
    else s.push(0, 0);
    if (u.sweep?.end) s.push(r2(u.sweep.end.x), r2(u.sweep.end.y), r2(u.sweep.end.z));
    return s;
  }

  // Ground around the other players on foot stays generated here (not
  // drawn): their creatures need it to walk on.
  _keepGround() {
    const w = this.game.world;
    const before = this._keepSet;
    const keep = (this._keepSet = new Set());
    // (Perf) With generation workers the chunks are made there (taken in
    // within the streaming budget); without, a couple per call here.
    const inWorkers = w.genInWorkers;
    let budget = 2; // new chunks per call
    for (const r of this.mp.players.active()) {
      if (r.vehicle || r.dead) continue;
      const cx = Math.floor(r.livePos.x) >> 4;
      const cz = Math.floor(r.livePos.z) >> 4;
      for (let dz = -KEEP_RADIUS; dz <= KEEP_RADIUS; dz++) {
        for (let dx = -KEEP_RADIUS; dx <= KEEP_RADIUS; dx++) {
          keep.add(w.key(cx + dx, cz + dz));
          if (Math.abs(dx) >= KEEP_RADIUS || Math.abs(dz) >= KEEP_RADIUS) continue;
          if (inWorkers) w.requestGen(cx + dx, cz + dz);
          else if (budget > 0 && !w.getChunk(cx + dx, cz + dz)) {
            w._generate(cx + dx, cz + dz);
            budget--;
          }
        }
      }
    }
    if (!this._keepHooked) {
      this._keepHooked = true;
      const prev = w.keepChunk;
      w.keepChunk = (chunk) => (prev ? prev(chunk) : false) || (!!this._keepSet && this._keepSet.has(w.key(chunk.cx, chunk.cz)));
      // (chunks asked for by requestGen stay wanted while they are kept)
      w.extraWanted = (cx, cz) => !!this._keepSet?.has(w.key(cx, cz));
    }
    // Ground a player has walked away from goes again (only the host's own
    // moves used to free it: an idle host piled up chunks without end).
    if (before) {
      for (const k of before) {
        if (keep.has(k)) continue;
        w.releaseChunks();
        break;
      }
    }
  }

  // ---------- Host: claims ----------

  _onHits(m, from) {
    if (!this.net.isHost || !Array.isArray(m.l)) return;
    const g = this.game;
    for (const c of m.l) {
      try {
        if (c[0] === "u") {
          const u = g.ufos.ufos.find((x) => x.id === c[1]);
          if (!u || u.state === "gone" || u.falling) continue;
          g.ufos.currentAttacker = from;
          try {
            g.ufos.damage(u, c[2], true, c[3] || c[4] || c[5] ? new THREE.Vector3(c[3], c[4], c[5]) : null);
          } finally {
            g.ufos.currentAttacker = null;
          }
        } else if (c[0] === "m") {
          const mob = g.mobs.mobs.find((x) => x.id === c[1]);
          if (!mob || mob.dead) continue;
          mob.invulnerable = 0;
          // (Who hit it is who it turns on.)
          const px = this.proxy(from);
          const prev = g.mobs.player;
          if (px) g.mobs.player = px;
          g.mobs.currentAttacker = from;
          const fire = Math.min(8, Math.max(0, Number(c[7]) || 0));
          const looting = Math.min(3, Math.max(0, c[8] | 0));
          g.mobs.attackExtras = fire || looting ? { fire, looting } : null;
          try {
            if (c[6]) g.mobs.shoot(mob, c[2], { x: c[3], z: c[4] }, c[5], true);
            else g.mobs._hurt(mob, c[2], { x: c[3], z: c[4] }, c[5], true);
          } finally {
            g.mobs.player = prev;
            g.mobs.currentAttacker = null;
            g.mobs.attackExtras = null;
          }
        } else if (c[0] === "us") {
          // (Round 11) A guest's use: within reach of the creature (their own inventory paid).
          const mob = g.mobs.mobs.find((x) => x.id === c[1]);
          const px = this.proxy(from);
          if (!mob || mob.dead || !px || px.position.distanceTo(mob.pos) > 8) continue;
          g.mobs.useFrom(mob, String(c[2]), from);
        } else if (c[0] === "sp") {
          // (Round 11) A creature a guest's egg asks for: near them, a few a second at most.
          const px = this.proxy(from);
          const at = new THREE.Vector3(Number(c[2]), Number(c[3]), Number(c[4]));
          const spec = typeof c[1] === "string" && Object.hasOwn(SPECIES, c[1]) ? SPECIES[c[1]] : null;
          if (!px || !spec || spec.special || !Number.isFinite(at.x + at.y + at.z) || px.position.distanceTo(at) > 24) continue;
          const now = g.mobs.time;
          px._spawnT = Math.max(now - 2, px._spawnT ?? 0) + 0.25;
          if (px._spawnT > now) continue;
          g.mobs.requestSpawn(c[1], at.x, at.y, at.z, { baby: !!c[5], variant: Number.isInteger(c[6]) && c[6] > 0 ? c[6] : undefined });
        } else if (c[0] === "bl") {
          const mob = g.mobs.mobs.find((x) => x.id === c[1]);
          if (!mob || mob.dead) continue;
          mob.remoteBeam = { lift: Math.min(12, Math.max(0, Number(c[2]) || 0)), topY: c[3], tx: c[4], tz: c[5], by: from, until: g.mobs.time + 0.35 };
          mob.lastPlayerHit = g.mobs.time;
          mob.lastHitPid = from;
        } else if (c[0] === "j") {
          const j = g.vehicles.vehicles.find((x) => x.isEnemyJet && x.id === c[1]);
          if (!j || !j.alive) continue;
          if (c[3] !== "beam") j.foe = this.proxy(from);
          if (c[3] === "beam") j.absorbedBy = {};
          g.vehicles.currentAttacker = from;
          try {
            j.damage(c[2], c[3] || "player", true);
          } finally {
            g.vehicles.currentAttacker = null;
          }
        } else if (c[0] === "cj") {
          const j = g.vehicles.vehicles.find((x) => x.isEnemyJet && x.id === c[1]);
          if (!j || !j.alive) continue;
          j.beamHeld = 0.35;
          j.vel.set(c[2], c[3], c[4]);
        } else if (c[0] === "ab") {
          const u = g.ufos.ufos.find((x) => x.id === c[1]);
          const ship = this.mp.vehicles.byNid(c[2]);
          if (!u || u.state === "gone" || u.falling) continue;
          u.lastHitPid = from;
          g.ufos.currentAttacker = from;
          try {
            g.ufos.absorb(u, ship);
          } finally {
            g.ufos.currentAttacker = null;
          }
          // (Its loot goes into that player's hold: see the kill message.)
        } else if (c[0] === "cap") {
          const u = g.ufos.ufos.find((x) => x.id === c[1]);
          const ship = this.mp.vehicles.byNid(c[2]);
          if (!u || !ship || u.state === "gone" || u.falling) continue;
          u.captured = { by: ship, last: g.ufos.time };
          u.pullVel = new THREE.Vector3(c[3], c[4], c[5]);
          u.lastHitPid = from;
        }
      } catch (err) {
        console.warn("UFO COMBAT net: bad hit claim", c, err);
      }
    }
  }

  _killFor(pid, kind, obj) {
    if (kind === "ufo") this.net.send(pid, { t: "kill", k: "ufo", size: obj.size, idx: obj.S?.idx ?? 0, at: vec1(obj.pos), into: obj.absorbed ? 1 : 0 });
    else if (kind === "mob") this.net.send(pid, { t: "kill", k: "mob", kind: obj.kind, at: vec1(obj.pos), lead: obj.leaderDrop || 0, b: obj.baby ? 1 : 0 });
    else if (kind === "jet") this.net.send(pid, { t: "kill", k: "jet", at: vec1(obj.pos), into: obj.absorbedBy ? 1 : 0, hj: obj.hijacked ? 1 : 0 });
    // (UFOs, fighters and aliens only: not every zombie or cow, on any screen.)
    if (kind === "mob" && !obj.spec?.alien) return;
    const text = `${this.mp.playerName(pid)} downed ${killWhat(kind, obj)}`;
    this.mp.feed(text);
    this.net.broadcast({ t: "feed", text }, { except: pid });
  }

  // The host's own kills: in the guests' feeds too (the same ones as theirs).
  _hostKill(kind, obj) {
    if (!this.mp.active || !this.net.isHost || (kind === "mob" && !obj.spec?.alien)) return;
    this.net.broadcast({ t: "feed", text: `${this.mp.playerName(HOST_PID)} downed ${killWhat(kind, obj)}` });
  }

  // ---------- Client: messages ----------

  _onDamage(m) {
    const g = this.game;
    const from = Array.isArray(m.f) ? new THREE.Vector3(m.f[0], m.f[1], m.f[2]) : null;
    g.player.damage(m.a, m.c, { pierce: !!m.pi, projectile: !!m.pr, from });
  }

  _onImpulse(m) {
    if (Array.isArray(m.v)) this.game.player.applyImpulse(new THREE.Vector3(m.v[0], m.v[1], m.v[2]));
  }

  // One of our hits killed it.
  _onKill(m) {
    const g = this.game;
    const at = new THREE.Vector3(m.at[0], m.at[1], m.at[2]);
    if (m.k === "ufo") {
      const st = g.stats;
      st.add("ufosDown");
      if (!g.player.creative && g.progress.enabled) st.add("ufosDownSurvival");
      if (m.size === "mothership" || m.size === "giant") st.add("ufosDownBig");
      if (m.size === "giant") st.add("titansDown"); // (a mothership doesn't count, see missions.js)
      if ((m.idx ?? 0) >= 2) st.add("ufosDownLarge");
      if (g.vehicles.active?.type === "jet") st.add("ufosDownByJet");
      g.audio.playNotice?.();
      g.lootFor("ufo", m.size, at, { into: !!m.into });
    } else if (m.k === "mob") {
      // (Round 11: its kind's spec and whether it was a baby, for its experience: xp.js killXp.)
      const fake = { kind: m.kind, spec: specOf(m.kind) || { alien: /^alien/.test(m.kind) }, pos: at, leaderDrop: m.lead || null, baby: !!m.b };
      g.mobKilled(fake);
      const lk = g.mobLootKind(fake);
      if (lk) g.lootFor(lk[0], lk[1], at.clone().setY(at.y + 0.6), { leaderDrop: fake.leaderDrop });
    } else if (m.k === "jet") {
      g.stats.add("enemyJetsDown");
      if (m.hj) g.stats.add("hijackedDown");
      g.lootFor("enemyjet", null, at, { into: !!m.into });
    }
  }

  // (Round 9) A creature our beam was lifting is aboard (the host's call):
  // its drops go into our hold, like the host's own beam.
  _onAbducted(m) {
    const g = this.game;
    const mob = this.mobById.get(m.id);
    if (mob) g.mobs._abductFx(mob);
    const spec = SPECIES[m.kind];
    const ship = g.vehicles.active;
    if (spec && ship?._abducted) ship._abducted({ kind: m.kind, spec });
  }

  _onLoot(m) {
    const g = this.game;
    g.lootFor(m.k, m.d ?? null, m.at);
  }

  // ---------- Client: puppets ----------

  _onAdd(m) {
    if (!this.mp.stateLoaded && this.net.isClient) {
      // (Before the world is in: the next snapshot round sends it again.)
    }
    const g = this.game;
    for (const e of m.u || []) {
      if (this.ufoById.has(e.id)) continue;
      const u = g.ufos.spawn({ spec: e.spec, size: e.size, radius: e.radius, style: e.style, crewKind: e.crew, pos: new THREE.Vector3(e.p[0], e.p[1], e.p[2]), state: "roam" });
      u.net = { id: e.id };
      u.maxHealth = e.maxHp;
      u.health = e.maxHp;
      u.yaw = e.y;
      u.boss = !!e.boss;
      u.pylon = !!e.pylon;
      u.missionTarget = !!e.mission;
      if (e.fade > 0) {
        u.spawnFade = e.fade;
        u.age = 0;
      } else {
        u.spawnFade = 0;
        u.age = 9;
      }
      u.interp = new Interp({ angles: ["y"], snap: 200 });
      this.ufoById.set(e.id, u);
    }
    for (const e of m.m || []) {
      if (this.mobById.has(e.id)) continue;
      // (Round 11: its looks, the host's: a sheep's colour, a villager's trade, a baby.)
      const mob = g.mobs.spawn(e.kind, e.p[0], e.p[1], e.p[2], { variant: Number.isInteger(e.v) ? e.v : 0, baby: !!e.b });
      if (!mob) continue;
      mob.net = { id: e.id };
      mob.yaw = e.y;
      mob.maxHealth = mob.health = e.hp;
      mob.leader = !!e.leader;
      mob.dead = !!e.dead;
      if (e.ld && !mob.dead) g.mobs.setCarry(mob, e.ld);
      mob.interp = new Interp({ angles: ["y", "hy"], snap: 12 });
      this.mobById.set(e.id, mob);
      // (Round 12) A fireball or a bullet: the shot's sound, where it leaves.
      if (mob.spec.projectile) g.mobs._voice(mob, "launch");
    }
    for (const e of m.j || []) {
      if (this.jetById.has(e.id)) continue;
      const j = g.vehicles.create("enemyjet", { ...e.data, airborne: true });
      if (!j) continue;
      j.netEJ = e.id;
      j.puppet = true;
      j.keep = true; // (the host's: never evicted by this page's vehicle cap; "erem" removes it)
      j.interp = new Interp({ angles: [], quats: ["q"], snap: 300 });
      j.update = (dt) => this.mp.vehicles._drivePuppet(j, dt);
      j._realDamage = j.damage;
      j.damage = (amount, cause, byPlayer) => {
        if (!j.alive || amount <= 0) return false;
        // Our shots, missiles, beam and (Round 9) our own blasts: a claim. What
        // the host's AI does to it is the host's to judge.
        if (!isPlayerCause(cause)) return false;
        j.hurtTime = 0;
        this.claims.push(["j", e.id, r1(amount), cause === "beam" ? "beam" : cause === "explosion" ? "explosion" : cause || "player"]);
        if (cause !== "beam") g.hud?.hitMarker?.();
        return true;
      };
      this.jetById.set(e.id, j);
    }
  }

  _onRem(m) {
    const g = this.game;
    for (const [id] of m.u || []) {
      const u = this.ufoById.get(id);
      if (!u) continue;
      this.ufoById.delete(id);
      u.state = "gone";
    }
    for (const id of m.m || []) {
      const mob = this.mobById.get(id);
      if (!mob) continue;
      this.mobById.delete(id);
      this._removeMob(mob);
    }
    for (const id of m.j || []) {
      const j = this.jetById.get(id);
      if (!j) continue;
      this.jetById.delete(id);
      if (g.vehicles.vehicles.includes(j)) g.vehicles.remove(j);
    }
  }

  _removeMob(mob) {
    const list = this.game.mobs.mobs;
    const i = list.indexOf(mob);
    if (i < 0) return;
    // A dead one goes in its puff of smoke (no drops: those were the host's call).
    if (mob.dead) {
      const keep = mob.spec.drops;
      mob.spec = { ...mob.spec, drops: [] };
      this.game.mobs._die(i);
      mob.spec = keep ? { ...mob.spec, drops: keep } : mob.spec;
    } else this.game.mobs._remove(i);
  }

  _onMobDie() {}

  _onSnap(m) {
    if (!this.mp.stateLoaded) return;
    const now = this.net.time;
    for (const s of m.u || []) {
      const u = this.ufoById.get(s[0]);
      if (!u) continue;
      u.interp.push({ ts: m.ts, p: [s[1], s[2], s[3]], y: s[4], tx: s[5], tz: s[6], v: [s[7], s[8], s[9]], hp: s[10], f: s[11], bb: s[12], br: s[13], sw: s.length > 14 ? [s[14], s[15], s[16]] : null }, now);
    }
    for (const s of m.m || []) {
      const mob = this.mobById.get(s[0]);
      if (!mob) continue;
      mob.interp.push({ ts: m.ts, p: [s[1], s[2], s[3]], y: s[4], hy: s[5], hpi: s[6], w: s[7], f: s[8], a: s[9], vy: s[10], hp: s[11] ?? 1, x: s[12] ?? 0, h: s[13] ?? 0, o: s[14] ?? 0, n: s[15] ?? 0, pk: s[16] ?? 0 }, now);
    }
    for (const s of m.j || []) {
      const j = this.jetById.get(s.n);
      if (!j) continue;
      s.ts = m.ts;
      j.interp.push(s, now);
      if (!s.al && j.alive) {
        j.alive = false;
        j.model.setBurnt?.(true, j.time || 0);
      }
    }
  }

  _driveUfo(u, dt) {
    const st = u.interp?.sample(this.net.time);
    if (!st) return;
    u.pos.fromArray(st.p);
    u.vel.fromArray(st.v);
    u.yaw = st.y;
    u.tilt.x = st.tx;
    u.tilt.y = st.tz;
    u.health = st.hp * u.maxHealth;
    const f = st.f | 0;
    u.hostile = !!(f & 4);
    u.shield = !!(f & 8);
    u.immune = !!(f & 16);
    u.byPlayer = !!(f & 64);
    const falling = !!(f & 1);
    if (falling && !u.falling) {
      // Shot down: lights out, a burst of flame, down it goes.
      u.falling = true;
      u.state = "falling";
      u.fallSpin = 2;
      u.fireT = 0;
      u.model.setDead?.(true);
      const c = this._fireC || (this._fireC = [new THREE.Color(3, 1.3, 0.3), new THREE.Color(0.8, 0.15, 0.03), new THREE.Color(0.15, 0.13, 0.12), new THREE.Color(0.45, 0.43, 0.4)]);
      for (let i = 0; i < 16; i++) this.game.effects.glow.spawn({ x: u.pos.x, y: u.pos.y, z: u.pos.z, vx: (Math.random() - 0.5) * 16, vy: Math.random() * 10 - 2, vz: (Math.random() - 0.5) * 16, life: 0.4 + Math.random() * 0.5, size0: u.radius * 0.5, size1: u.radius * 0.9, color0: c[0], color1: c[1], alpha: 0.5, drag: 2.5 });
      this.game.audio.playUfoHit?.(u.pos.distanceTo(this.game.player.position), true);
    }
    if (u.falling) {
      // Fire and smoke on the way down (the crash itself comes from the host).
      u.fireT = (u.fireT || 0) - dt;
      if (u.fireT <= 0) {
        u.fireT = 0.04;
        const c = this._fireC;
        const r = u.radius * 0.6;
        const fx = this.game.effects;
        fx.glow.spawn({ x: u.pos.x + (Math.random() - 0.5) * r, y: u.pos.y, z: u.pos.z + (Math.random() - 0.5) * r, vx: 0, vy: 2, vz: 0, life: 0.45, size0: Math.min(6, u.radius * 0.45), size1: Math.min(8, u.radius * 0.7), color0: c[0], color1: c[1], alpha: 0.5, drag: 2 });
        fx.smoke.spawn({ x: u.pos.x, y: u.pos.y + 0.5, z: u.pos.z, vx: 0, vy: 1.2, vz: 0, life: 4.5, size0: Math.min(4, u.radius * 0.4), size1: Math.min(12, u.radius * 1.2), color0: c[2], color1: c[3], alpha: 0.55, drag: 0.6 });
      }
    }
    // Its tractor beam.
    const beam = !!(f & 2);
    if (beam || u.beam) {
      const b = beam ? this.game.ufos._getBeam(u) : u.beam;
      const top = _v.set(u.pos.x, u.pos.y - u.info.bottom * u.radius, u.pos.z);
      b.set(beam, top, st.bb || top.y - 20, st.br || u.radius, !!(f & 32));
      if (!beam && b.strength < 0.02) this.game.ufos._freeBeam(u);
    }
    // A sweeping laser: drawn from the ship to where it burns.
    if (st.sw) {
      if (!u.sweep) u.sweep = { end: new THREE.Vector3(), mesh: null };
      u.sweep.end.fromArray(st.sw);
      const from = this.game.ufos._muzzle(u, new THREE.Vector3());
      if (!u.sweep.mesh) {
        u.sweep.mesh = this.game.ufos._sweepMesh();
        this.game.scene.add(u.sweep.mesh);
      }
      const len = from.distanceTo(u.sweep.end);
      u.sweep.mesh.position.copy(from);
      u.sweep.mesh.lookAt(u.sweep.end);
      const width = 0.16 + u.radius * 0.01;
      u.sweep.mesh.scale.set(width, width, len);
    } else if (u.sweep) this.game.ufos._endSweep(u);
  }

  _driveMob(m, dt) {
    const st = m.interp?.sample(this.net.time);
    if (!st) return;
    const ox = m.pos.x;
    const oz = m.pos.z;
    m.pos.fromArray(st.p);
    m.yaw = st.y;
    m.headYaw = st.hy;
    m.headPitch = st.hpi;
    m.walk = st.w;
    const f = st.f | 0;
    if (f & 1 && !m.dead) {
      m.dead = true;
      m.deathTime = 0;
      this.game.mobs._voice(m, "death");
    }
    m.burning = !!(f & 2);
    m.onGround = !!(f & 4);
    m.ai.target = !!(f & 8);
    m.ai.state = f & 16 ? "hide" : "idle";
    m.ai.timer = f & 16 ? 1 : 0;
    m.calmT = f & 32 ? 1 : 0;
    m.missionTarget = !!(f & 64);
    m.attack = st.a ?? 1;
    m.vel.y = st.vy ?? 0;
    // (Round 9) Its health, the host's: the same on every screen.
    if (Number.isFinite(st.hp)) m.health = st.hp * m.maxHealth;
    // (Round 11) The vanilla states (see _mobOut).
    const g = this.game;
    if (!!(f & 128) !== m.baby) g.mobs.setBaby(m, !!(f & 128));
    m.sheared = !!(f & 256);
    m.angerT = f & 1024 ? 1 : 0;
    m.drinkT = f & 2048 ? 1 : 0;
    m.breedCd = f & 4096 ? 1 : 0;
    if (f & 512) {
      m.loveT = 1;
      if ((m._heartT = (m._heartT ?? 0) - dt) <= 0) {
        m._heartT = 0.8;
        g.mobs._hearts(m, 1);
      }
    } else m.loveT = 0;
    const fuse = (st.x || 0) > 0 ? st.x : 0;
    if (fuse > 0 && !(m.fuse > 0)) g.mobs._voice(m, "hiss");
    m.fuse = fuse;
    m.carry = st.h | 0;
    m.tamed = !!(f & 8192);
    m.sitting = !!(f & 16384);
    // (A sheep's colour: a dye may change it.)
    if (f & 32768 && m.kind === "sheep") g.mobs.setSheepColor(m, (f >> 16) & 15);
    m.owner = st.o | 0;
    if (m.tamed && m.kind === "wolf" && m.maxHealth < 20) m.maxHealth = 20;
    // (Round 12) The Nether's and the End's states (see _mobOut).
    // (Their sounds here too: a ghast about to shoot, a blaze catching fire,
    // a piglin taking gold, a shulker's lid.)
    const n = st.n | 0;
    if (n & 1 && !(m.admireT > 0)) g.mobs._voice(m, "admire");
    if (n & 2 && !m.shootFace) g.mobs._voice(m, "charge");
    if (n & 4 && !m.charged) g.mobs._voice(m, "charge");
    m.admireT = n & 1 ? 1 : 0;
    m.shootFace = !!(n & 2);
    m.charged = !!(n & 4);
    m.cold = !!(n & 8);
    m.shakeT = n & 16 ? 1 : 0;
    if (n & 32) m.variant = (n >> 8) & 7;
    const peek = st.pk || 0;
    if (m.spec.still && !(m.peek > 0) !== !(peek > 0)) g.mobs._voice(m, peek > 0 ? "open" : "close");
    m.peek = peek;
    g.mobs.puppetTick?.(m, dt);
    // (An enderman's teleport: the flash where it was and where it is.)
    if (m.kind === "enderman" && Math.hypot(m.pos.x - ox, m.pos.z - oz) > 4 && m.interp.last) {
      const to = m.pos.clone();
      m.pos.set(ox, m.pos.y, oz);
      g.mobs._teleportFx(m);
      m.pos.copy(to);
      g.mobs._teleportFx(m);
    }
    const speed = Math.hypot(m.pos.x - ox, m.pos.z - oz) / Math.max(dt, 1e-3);
    if (m.walk > 0.05) m.walkPhase += Math.min(speed, 8) * dt * 1.8 + dt * 0.5;
  }

  // ---------- (Round 11) Trading, effects ----------

  // Host: a guest opens a villager's trades: its offers (it stands for them a while).
  _onTradeQuery(m, from) {
    const mob = this._villagerFor(m, from);
    if (!mob) return;
    this.net.send(from, { t: "to", id: mob.id, o: encodeOffers(this.game.mobs._ensureTrades(mob)) });
  }

  // Host: a guest's trade: yes if the villager has the stock (the guest pays
  // and takes the goods on their own screen), and the offers as they are now.
  _onTradeRequest(m, from) {
    const mob = this._villagerFor(m, from);
    const ok = !!mob && Number.isInteger(m.i) && this.game.mobs.takeTrade(mob, m.i);
    this.net.send(from, { t: "tk", id: m.id, ok: ok ? 1 : 0, o: mob ? encodeOffers(mob.trades) : [] });
  }

  _villagerFor(m, from) {
    if (!this.net.isHost) return null;
    const g = this.game;
    const mob = g.mobs.mobs.find((x) => x.id === m.id);
    const px = this.proxy(from);
    if (!mob || mob.dead || !mob.spec.trades || !(mob.variant > 0) || !px || px.position.distanceTo(mob.pos) > 10) return null;
    mob.tradingT = Math.max(mob.tradingT ?? 0, g.mobs.time + 8);
    return mob;
  }

  // A status effect from the host's creature (a witch's potion) on this
  // player: the survival systems' own, or, without them, a little damage.
  _onEffect(m) {
    const p = this.game.player;
    const secs = Math.min(600, Math.max(0, Number(m.d) || 0));
    // (Round 12) A blaze's fire: this player burns for a while.
    if (m.n === "onfire") {
      if (!p.creative && typeof p.fireTime === "number") p.fireTime = Math.max(p.fireTime, Math.min(15, secs));
      return;
    }
    if (typeof p.addEffect === "function") p.addEffect(String(m.n), secs, Math.max(1, m.a | 0));
    else if (m.n === "poison" && secs >= 1) {
      const dmg = Math.min(4, Math.floor(p.health - 1));
      if (dmg > 0) p.damage(dmg, "witch");
    }
  }
}

function r1(v) {
  return Math.round(v * 10) / 10;
}

function killWhat(kind, obj) {
  return kind === "ufo" ? `a ${obj.size} UFO` : kind === "jet" ? "an enemy fighter" : obj.spec?.alien ? "an alien" : `a ${obj.kind}`;
}
