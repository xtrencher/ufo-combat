// Airports in use: aircraft parked on the aprons of the airports and cities
// (sites.js) near the player, and now and then a UFO hovering in a hangar.
// A parked fighter is a real jet (boardable with F, like the one called in
// with J); they are set out when the player comes within range and put away
// when they leave. Parked aircraft are never saved.

const NEAR = 420; // blocks: parked aircraft appear inside this range
const FAR = 900; // and are put away beyond this
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
    this.timer = 0;
    this.enabled = true;
    // Multiplayer: parking spots ("site#index") whose aircraft another player
    // took (it flies elsewhere now), and whether guards are set out here.
    this.taken = new Set();
    this.guardsEnabled = true;
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
    const p = this.player.position;
    if (!this.enabled || !veh.enabled) {
      this.clear();
      return;
    }
    // Put away the ones that are far (unless someone is in them or they flew off).
    for (const [id, jets] of this.parked) {
      const [, xs, zs] = /^(?:\w+):(-?\d+),(-?\d+)$/.exec(id) || [];
      const d = Math.hypot(Number(xs) - p.x, Number(zs) - p.z);
      if (d > FAR) {
        for (const j of jets) if (j.alive && !j.occupied && j.parkedAt && veh.vehicles.includes(j)) veh.remove(j);
        this.parked.delete(id);
        this._dropGuards(id);
      }
    }
    const s = this.sites.nearest(p.x, p.z, NEAR + 200);
    if (!s || Math.hypot(s.x - p.x, s.z - p.z) > NEAR + 100) return;
    if (this.parked.has(s.id)) {
      // The bunkers wait for their own chunks (they can lie far from the apron).
      if (this.bunkersDone.get(s.id) !== true) this._setOutBunkers(s, this.parked.get(s.id));
      return;
    }
    // Only the spots whose chunk is there to stand on.
    const spots = this.sites.parkingSpots(s).filter((spot) => this.world.getChunk(Math.floor(spot.x) >> 4, Math.floor(spot.z) >> 4));
    const jets = [];
    if (!spots.length && (s.parking || []).length) return;
    // A stable number of aircraft per airport (1-3) from the site's seed.
    const count = 1 + (s.seed % 3);
    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const spot = spots[i];
      // (Multiplayer: a jet another player took is not put out again.)
      const key = `${s.id}#${i}`;
      if (this.taken.has(key)) continue;
      // A mix of Raptors and Falcons (fixed per airport and spot).
      const jet = veh.create("jet", { jetType: (s.seed + i) % 2 ? "f16" : "f22", pos: [spot.x, spot.y + GEAR, spot.z], yaw: spot.yaw });
      if (!jet) continue;
      jet.transient = true; // never saved: the airport puts it out again next time
      jet.keep = true; // not evicted by the vehicle cap while the airport is near
      jet.parkedAt = s.id;
      jet.parkKey = key;
      jets.push(jet);
    }
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
      const ufo = this.taken.has(key) ? null : veh.create("ufo", { design, seed: (s.seed + h.id * 977) | 0, radius, pos: [h.x, h.y, h.z], yaw: h.yaw });
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
      if (this.mobs && this.mobs.hostileSpawning !== false && this.guardsEnabled) for (const g of h.guards) {
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
    this.guards.delete(id);
    this.bunkerSet.delete(id);
    this.bunkersDone.delete(id);
    if (!list || !this.mobs) return;
    for (const g of list) {
      const i = this.mobs.mobs.indexOf(g);
      if (i >= 0 && !g.dead) this.mobs._remove(i);
    }
  }

  clear() {
    for (const id of [...this.guards.keys()]) this._dropGuards(id);
    for (const jets of this.parked.values()) for (const j of jets) if (j.alive && !j.occupied && j.parkedAt && this.vehicles.vehicles.includes(j)) this.vehicles.remove(j);
    this.parked.clear();
  }
}
