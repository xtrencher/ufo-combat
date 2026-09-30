// Airports in use: aircraft parked on the aprons of the airports and cities
// (sites.js) near the player. A parked fighter is a real jet (boardable with
// F, like the one called in with J); they are set out when the player comes
// within range and put away when they leave. Parked jets are never saved.
import { RUNWAY_HALF } from "./sites.js";

const NEAR = 420; // blocks: parked aircraft appear inside this range
const FAR = 900; // and are put away beyond this
const GEAR = 1.35;

export class AirportManager {
  constructor({ sites, vehicles, world, player }) {
    this.sites = sites;
    this.vehicles = vehicles;
    this.world = world;
    this.player = player;
    this.parked = new Map(); // site id -> [jets]
    this.timer = 0;
    this.enabled = true;
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
    const e = ends[0];
    // The chunks under the runway must exist (the jet stands on real blocks).
    if (!this.world.getChunk(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4)) return null;
    return { site: s, ...e, halfLength: RUNWAY_HALF };
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
        for (const j of jets) if (j.alive && !j.occupied && veh.vehicles.includes(j)) veh.remove(j);
        this.parked.delete(id);
      }
    }
    const s = this.sites.nearest(p.x, p.z, NEAR + 200);
    if (!s || this.parked.has(s.id)) return;
    if (Math.hypot(s.x - p.x, s.z - p.z) > NEAR + 100) return;
    const spots = this.sites.parkingSpots(s);
    const jets = [];
    for (const spot of spots) {
      // Only when the apron's chunk is there to stand on.
      if (!this.world.getChunk(Math.floor(spot.x) >> 4, Math.floor(spot.z) >> 4)) return;
    }
    // A stable number of aircraft per airport (1-3) from the site's seed.
    const count = 1 + (s.seed % 3);
    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const spot = spots[i];
      // A mix of Raptors and Falcons (fixed per airport and spot).
      const jet = veh.create("jet", { jetType: (s.seed + i) % 2 ? "f16" : "f22", pos: [spot.x, spot.y + GEAR, spot.z], yaw: spot.yaw });
      if (!jet) continue;
      jet.transient = true; // never saved: the airport puts it out again next time
      jet.keep = true; // not evicted by the vehicle cap while the airport is near
      jet.parkedAt = s.id;
      jets.push(jet);
    }
    this.parked.set(s.id, jets);
  }

  clear() {
    for (const jets of this.parked.values()) for (const j of jets) if (j.alive && !j.occupied && this.vehicles.vehicles.includes(j)) this.vehicles.remove(j);
    this.parked.clear();
  }
}
