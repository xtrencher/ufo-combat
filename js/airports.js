// Airports in use: aircraft parked on the aprons of the airports and cities
// (sites.js) near the player (Round 10: now and then a fighter inside a
// hangar, nose to the doorway), and the alien ships in the bunkers.
// A parked fighter is a real jet (boardable with F, like the one called in
// with J); they are set out when the player comes within range and put away
// when they leave. Parked aircraft are never saved.

import { IS_SOLID } from "./blocks.js";
import { JET_TYPES } from "./vehicle-jet.js";
import { PAINT_SCHEMES } from "./jet-model.js";

const NEAR = 420; // blocks: parked aircraft appear inside this range
const FAR = 900; // and are put away beyond this
const GUARDS_BACK = 20 * 60; // seconds: a cleared airport's guards come back after this
const GEAR = 1.35;
const HANGAR_DESIGNS = ["saucer", "saucer_disc", "saucer_domed", "tictac", "triangle"]; // small enough for the bunker hall

export class AirportManager {
  constructor({ sites, vehicles, world, player, mobs }) {
    this.mobs = mobs;
    this.sites = sites;
    this.vehicles = vehicles;
    this.world = world;
    this.player = player;
    this.parked = new Map(); // site id -> [jets]
    this.guards = new Map(); // site id -> [guards]
    this.bunkerSet = new Map(); // site id -> Set of bunkers set out
    this.bunkersDone = new Map();
    // Site id -> when its guards were all killed (seconds): no fresh set on
    // every revisit, or flying out and back would farm their armor drops.
    this.guardsCleared = new Map();
    this.timer = 0;
    this.enabled = true;
    // Multiplayer: parking spots ("site#index") whose aircraft another player
    // took (it flies elsewhere now), and whether guards are set out here.
    this.taken = new Set();
    this.guardsEnabled = true;
    // (Round 9) Bunkers whose ship is set out again for the steal mission
    // (see untake): the ship only, not a second set of guards.
    this.reship = new Set();
    // Online (host): every player's position (airports near any of them are
    // set out here, with their guards: the guards are the host's creatures).
    this.positions = null; // () => [Vector3]
    // How many players the airports are stocked for (online: the host's
    // count, the most players in the game so far; every peer sets out the
    // same aircraft from it): at least one fighter each, plus a spare.
    this.groupSize = 1;
  }

  // The number of fighters parked at an airport.
  fighterCount(s) {
    return Math.max(1 + (s.seed % 3), this.groupSize + 1);
  }

  // Whether an aircraft's footprint on its slot is clear and flat: solid pad
  // under its middle, nothing in the way up to its height (a player's
  // building, a crater, a wreck). null: the chunks aren't there yet.
  // (along: the aircraft faces along the runway, its span across it.)
  _clear(s, slot, span, len, along = false) {
    const w = this.world;
    let [ux, uz] = this.sites.dirU(s);
    let [vx, vz] = this.sites.dirV(s);
    if (along) [ux, uz, vx, vz] = [vx, vz, ux, uz];
    const y0 = s.y;
    for (let du = -span / 2; du <= span / 2; du += 2) {
      for (let dv = -len / 2; dv <= len / 2; dv += 2) {
        const x = Math.floor(slot.x + ux * du + vx * dv);
        const z = Math.floor(slot.z + uz * du + vz * dv);
        if (!w.getChunk(x >> 4, z >> 4)) return null;
        // Solid ground where the gear stands (the middle of the span); under
        // the wings a gap (a cave mouth in the grass) doesn't matter. (Round 9:
        // the whole wing had to be over solid ground, which kept B-2s away.)
        if (Math.abs(du) <= span / 4 && !IS_SOLID[w.getBlock(x, y0, z)]) return false;
        for (let y = y0 + 1; y <= y0 + 4; y++) if (IS_SOLID[w.getBlock(x, y, z)]) return false;
      }
    }
    return true;
  }

  // Sets out the aircraft of airport s that aren't there yet (more when the group grows).
  _fill(s, jets) {
    const veh = this.vehicles;
    // (Round 8) An aircraft taken from here that is gone (shot down, crashed)
    // frees its slot: the airport sets out a new one (a new B-2 for another
    // try at the enemy base). Bunker ships are set out once (see below).
    for (let i = jets.length - 1; i >= 0; i--) if (jets[i].type === "jet" && !veh.vehicles.includes(jets[i])) jets.splice(i, 1);
    const slots = this.sites.parkingSlots(s);
    // (Round 10) Some of the fighters stand in the hangars that have room for
    // one (sites.js _ensureJetHangars), at least one out on the apron; the hangars
    // take the ones the apron has no room for. The same total as before.
    const total = this.fighterCount(s);
    const inHangars = slots.hangars || [];
    const n = Math.min(slots.fighters.length, total - Math.min(inHangars.length, total - 1));
    const nh = Math.min(inHangars.length, total - n);
    const have = new Set(jets.map((j) => j.parkKey));
    const put = (slot, jetType, span, len, checked = false) => {
      if (have.has(slot.key) || this.taken.has(slot.key)) return;
      const ok = checked || this._clear(s, slot, span, len);
      if (!ok) return;
      const jet = veh.create("jet", { jetType, pos: [slot.x, slot.y + (JET_TYPES[jetType]?.gear ?? GEAR), slot.z], yaw: slot.yaw, paint: this.paintFor(s, slot.key, jetType) });
      if (!jet) return;
      jet.transient = true; // never saved: the airport puts it out again next time
      jet.keep = true; // not evicted by the vehicle cap while the airport is near
      jet.parkedAt = s.id;
      jet.parkKey = slot.key;
      jets.push(jet);
      have.add(slot.key);
    };
    // A mix of Raptors and Falcons (fixed per airport and slot), and a B-2.
    for (let i = 0; i < n; i++) put(slots.fighters[i], (s.seed + i) % 2 ? "f16" : "f22", 15, 16);
    for (let i = 0; i < nh; i++) put(inHangars[i], ((s.seed >>> 3) + inHangars[i].hangar) % 2 ? "f16" : "f22", 15, 16);
    if (JET_TYPES.b2 && !have.has(`${s.id}#b`) && !this.taken.has(`${s.id}#b`)) {
      const spot = this._bomberSpot(s, slots);
      if (spot) put(spot, "b2", 48, 22, true);
    }
  }

  // (Round 9) Where an airport's B-2 stands: its own slot in the parking row,
  // or, where the row has no room for it (about one airport in four) or the
  // slot is blocked, on the runway just past either end of the apron (near
  // the other aircraft, facing the long way: room for its takeoff roll),
  // else at either end of the runway, lined up for takeoff. It used to be
  // left out: no B-2 for Operation Sunburn. One B-2 per airport (one key);
  // null while the chunks of the spot to try next aren't there (every peer
  // then waits and picks the same spot).
  _bomberSpot(s, slots) {
    const key = `${s.id}#b`;
    const list = [];
    if (slots.bomber) list.push({ slot: slots.bomber, along: false });
    const [ux, uz] = this.sites.dirU(s);
    const lim = (s.half ?? 300) - 12;
    for (const u0 of [s.apron.u1 + 36, s.apron.u0 - 36]) {
      const u = Math.max(-lim, Math.min(lim, u0));
      const [x, z] = this.sites.toWorld(s, u, 0);
      const dir = u > 0 ? -1 : 1; // toward the far end of the runway
      list.push({ slot: { x: x + 0.5, y: s.y + 1, z: z + 0.5, yaw: Math.atan2(-dir * ux, -dir * uz), key }, along: true });
    }
    for (const e of this.sites.runwayEnds(s)) list.push({ slot: { x: e.x, y: s.y + 1, z: e.z, yaw: e.yaw, key }, along: true });
    for (const c of list) {
      const ok = this._clear(s, c.slot, 48, 22, c.along);
      if (ok === null) return null;
      if (ok) return c.slot;
    }
    return null;
  }

  // An aircraft's colour scheme: fixed per airport and slot (the same for
  // every player). About half of them in their type's own grey.
  paintFor(s, key, jetType) {
    let h = s.seed >>> 0;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    h ^= h >>> 13;
    return h % 10 < 5 ? "gray" : PAINT_SCHEMES[1 + (h % (PAINT_SCHEMES.length - 1))];
  }

  // Multiplayer: someone else boarded the aircraft parked at `key`: our copy goes.
  takeParked(key) {
    this.taken.add(key);
    for (const [, jets] of this.parked) {
      for (let i = jets.length - 1; i >= 0; i--) {
        const j = jets[i];
        if (j.parkKey === key && j.parkedAt && !j.occupied) {
          jets.splice(i, 1);
          if (this.vehicles.vehicles.includes(j)) this.vehicles.remove(j);
        }
      }
    }
  }

  // (Round 9) The steal mission lost the bunker's ship (blown up, or flown
  // off and lost): the bunker sets out a new one, here and (net/coop.js
  // "untake") on every other peer, so there is always exactly one. Its
  // guards are not set out a second time.
  untake(key) {
    this.taken.delete(key);
    const m = /^(.*)#h(\d+)$/.exec(key);
    if (!m) return;
    const done = this.bunkerSet.get(m[1]);
    if (!done || !done.delete(Number(m[2]))) return;
    this.bunkersDone.set(m[1], false);
    this.reship.add(key);
  }

  // The nearest airport (or city with one) within maxDist of the player: { site, dist }.
  nearest(maxDist = 4000) {
    const p = this.player.position;
    const s = this.sites.nearest(p.x, p.z, maxDist);
    return s ? { site: s, dist: Math.hypot(s.x - p.x, s.z - p.z) } : null;
  }

  // The best runway to take off from near (x, z): the closest end of the
  // nearest airport within maxDist, or null.
  runwayNear(x, z, maxDist = 600) {
    const s = this.sites.nearest(x, z, maxDist);
    if (!s) return null;
    const ends = this.sites.runwayEnds(s);
    ends.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    // The chunks under the runway must exist (the jet stands on real blocks):
    // on a long runway the far end can lie beyond the render distance, so the
    // start moves inward until the ground is there (keeping at least 200
    // blocks of runway to roll on).
    for (const e of ends) {
      for (let d = 0; e.length - d >= 200; d += 16) {
        const sx = e.x + e.dx * d;
        const sz = e.z + e.dz * d;
        if (!this.world.getChunk(Math.floor(sx) >> 4, Math.floor(sz) >> 4)) continue;
        return { site: s, ...e, x: sx, z: sz, length: e.length - d, halfLength: s.half };
      }
    }
    return null;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const veh = this.vehicles;
    if (!this.enabled || !veh.enabled) {
      this.clear();
      return;
    }
    const people = this.positions ? this.positions() : [this.player.position];
    if (!people.length) people.push(this.player.position);
    // Put away the ones that are far from everyone (unless someone is in them or they flew off).
    for (const [id, jets] of this.parked) {
      const [, xs, zs] = /^(?:\w+):(-?\d+),(-?\d+)$/.exec(id) || [];
      let d = Infinity;
      for (const q of people) d = Math.min(d, Math.hypot(Number(xs) - q.x, Number(zs) - q.z));
      if (d > FAR) {
        for (const j of jets) if (j.alive && !j.occupied && j.parkedAt && veh.vehicles.includes(j)) veh.remove(j);
        this.parked.delete(id);
        this._dropGuards(id);
      }
    }
    for (const p of people) this._near(p);
  }

  // The airport near p: its aircraft (and guards) set out.
  _near(p) {
    const veh = this.vehicles;
    const s = this.sites.nearest(p.x, p.z, NEAR + 200);
    if (!s || Math.hypot(s.x - p.x, s.z - p.z) > NEAR + 100) return;
    if (this.parked.has(s.id)) {
      const jets = this.parked.get(s.id);
      // Slots whose chunks weren't there yet, or more aircraft for a bigger group.
      this._fill(s, jets);
      // The bunkers wait for their own chunks (they can lie far from the apron).
      if (this.bunkersDone.get(s.id) !== true) this._setOutBunkers(s, jets);
      return;
    }
    // (Each aircraft waits for the chunks under its own slot, and each bunker
    // for its own: see _fill and _setOutBunkers. Round 8: no longer waiting
    // for the runway's middle, which can lie beyond a short render distance
    // when you walk up to a bunker compound behind the apron.)
    const jets = [];
    this._fill(s, jets);
    this.parked.set(s.id, jets);
    this._setOutBunkers(s, jets);
  }

  // The secured bunkers: an alien ship hovers in the hall (seized, or left
  // behind) under armed guards who shoot at anyone entering the restricted
  // zone. The ship can be boarded once the mission chain gets that far (see
  // vehicles.canBoard in main.js). A bunker whose chunks are not loaded yet
  // is tried again next time.
  _setOutBunkers(s, jets) {
    const veh = this.vehicles;
    const done = this.bunkerSet.get(s.id) || new Set();
    this.bunkerSet.set(s.id, done);
    const guards = this.guards.get(s.id) || [];
    const spots = this.sites.bunkerSpots(s);
    for (const h of spots) {
      if (done.has(h.id)) continue;
      // The hall and the ramp's top must be there.
      const ready = [[h.x, h.z], ...h.guards.map((g) => [g.x, g.z]), [h.zone.x, h.zone.z]].every(([x, z]) => this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4));
      if (!ready) continue;
      done.add(h.id);
      const design = HANGAR_DESIGNS[(s.seed >>> (h.id * 3)) % HANGAR_DESIGNS.length];
      const radius = 3.4 + ((s.seed >>> (h.id * 5 + 1)) % 10) / 14; // fits the hall and the ramp
      const key = `${s.id}#h${h.id}`;
      const reship = this.reship.delete(key); // (a new ship only: its guards are still about)
      const cleared = performance.now() / 1000 - (this.guardsCleared.get(s.id) ?? -Infinity) < GUARDS_BACK; // (the ship only)
      // (Nor while this bunker's ship is still here or being flown out, within
      // the mission's 150-block escape: one reloaded mid-escape keeps its key,
      // see PilotUfo.serialize. The hall's 60 blocks match _bunkerShip's.)
      const here = veh.vehicles.some((v) => {
        if (v.type !== "ufo" || !v.alive || (v.parkKey !== key && v.tookKey !== key)) return false;
        const d = Math.hypot(v.pos.x - h.x, v.pos.y - h.y, v.pos.z - h.z);
        return d <= 60 || ((v.occupied || (v.puppet && v.netOcc)) && d < 150);
      });
      const ufo = this.taken.has(key) || here ? null : veh.create("ufo", { design, seed: (s.seed + h.id * 977) | 0, radius, pos: [h.x, h.y, h.z], yaw: h.yaw });
      if (ufo) {
        ufo.parkKey = key;
        ufo.pos.y = h.y + ufo.bottom + 0.9; // hovering a little above the floor
        ufo.hangar = true;
        ufo.transient = true;
        ufo.keep = true;
        ufo.parkedAt = s.id;
        jets.push(ufo);
      }
      // (No guards on Peaceful: no hostile creatures at all. Online, only the host sets them out.)
      if (this.mobs && this.mobs.hostileSpawning !== false && this.guardsEnabled && !reship && !cleared) for (const g of h.guards) {
        const m = this.mobs.spawnGuard(g.x, g.y, g.z, h.zone);
        if (m) guards.push(m);
      }
    }
    if (guards.length) this.guards.set(s.id, guards);
    this.bunkersDone.set(s.id, done.size >= spots.length);
  }

  // A parked aircraft the player boarded is theirs from now on: a normal
  // vehicle (saved with the world), no longer put away with the airport.
  boarded(v) {
    if (!v.parkedAt) return;
    v.parkedAt = null;
    v.transient = false;
    v.hangar = false;
    if (v.type === "jet") v.keep = false;
  }

  // The guards of an airport that is put away go with it.
  _dropGuards(id) {
    const list = this.guards.get(id);
    // (Every bunker set out and every guard dead: cleared. Live ones come back as before.)
    if (list?.length && this.bunkersDone.get(id) === true && list.every((g) => g.dead)) this.guardsCleared.set(id, performance.now() / 1000);
    this.guards.delete(id);
    this.bunkerSet.delete(id);
    this.bunkersDone.delete(id);
    for (const k of this.reship) if (k.startsWith(`${id}#`)) this.reship.delete(k);
    if (!list || !this.mobs) return;
    for (const g of list) {
      const i = this.mobs.mobs.indexOf(g);
      if (i >= 0 && !g.dead) this.mobs._remove(i);
    }
  }

  clear() {
    // (Every site, guarded or not: on Peaceful and on guests there are no
    // guards, and a stale bunkerSet would never set the bunker ship out again.)
    for (const id of new Set([...this.guards.keys(), ...this.bunkerSet.keys(), ...this.parked.keys()])) this._dropGuards(id);
    for (const jets of this.parked.values()) for (const j of jets) if (j.alive && !j.occupied && j.parkedAt && this.vehicles.vehicles.includes(j)) this.vehicles.remove(j);
    this.parked.clear();
  }
}
