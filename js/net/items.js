// Items handed over between players. Whatever a player throws (Q, or out
// of the inventory window) and what a dead player leaves behind lands in
// everyone's world; picking it up is asked of the host, which gives each
// item to the first player who reaches it (no copies when two grab it at
// once). Loot from kills is not shared: everyone gets their own (see
// entities.js), and those drops stay where they fell for that player only.
import * as THREE from "three";
import { r2, r1 } from "./interp.js";
import { HOST_PID } from "./session.js";

export class ItemSync {
  constructor(mp) {
    this.mp = mp;
    this.game = mp.game;
    this.net = mp.net;
    this.byKey = new Map(); // key -> item entity
    this._n = 1;
    this._sharing = 0;
    const net = this.net;
    net.on("idrop", (m, from) => this._onDrop(m, from));
    net.on("ipick", (m, from) => this._onPickRequest(m, from));
    net.on("itaken", (m) => this._onTaken(m));
    net.registerSync("items", {
      save: () => [...this.byKey.values()].map((it) => this._info(it)),
      load: (list) => {
        for (const m of list || []) this._onDrop(m, 0);
      },
    });
    this._hook();
  }

  // Runs fn; the items it drops are shared (main.js: a dead player's things).
  share(fn) {
    this._sharing++;
    try {
      return fn();
    } finally {
      this._sharing--;
    }
  }

  _hook() {
    const g = this.game;
    const ents = g.entities;
    const spawn = ents.spawn.bind(ents);
    ents.spawn = (id, count, pos, vel = null, opts = {}) => {
      const it = spawn(id, count, pos, vel, opts);
      if (it && this._sharing && this.mp.active && this.mp.stateLoaded) {
        it.shared = `${this.net.pid}:${this._n++}`;
        this.byKey.set(it.shared, it);
        this.net.toAll({ t: "idrop", ...this._info(it) });
      }
      return it;
    };
    const throwStack = g.interaction.throwStack.bind(g.interaction);
    g.interaction.throwStack = (stack) => this.share(() => throwStack(stack));
    const onPickup = ents.onPickup;
    ents.onPickup = (item) => {
      if (!item.shared || !this.mp.active) return onPickup ? onPickup(item) : item.count;
      // Asked of the host; until it answers the item waits where it is.
      if (item.asked && performance.now() - item.asked < 1500) return item.count;
      item.asked = performance.now();
      if (this.net.isHost) this._grant(item.shared, HOST_PID);
      else this.net.toHost({ t: "ipick", k: item.shared });
      item.pickupDelay = 0.3;
      return item.count;
    };
  }

  _info(it) {
    return { k: it.shared, id: it.id, n: it.count, dur: it.dur, p: [r2(it.pos.x), r2(it.pos.y), r2(it.pos.z)], v: [r1(it.vel.x), r1(it.vel.y), r1(it.vel.z)], d: r1(Math.max(0, it.pickupDelay)) };
  }

  _onDrop(m, from) {
    if (!m || typeof m.k !== "string" || this.byKey.has(m.k)) return;
    const g = this.game;
    const it = g.entities.spawn(m.id, m.n, new THREE.Vector3(m.p[0], m.p[1], m.p[2]), new THREE.Vector3(m.v[0], m.v[1], m.v[2]), { dur: m.dur, pickupDelay: m.d ?? 1 });
    if (!it) return;
    it.shared = m.k;
    this.byKey.set(m.k, it);
  }

  _onPickRequest(m, from) {
    if (this.net.isHost) this._grant(m.k, from);
  }

  // Host: the first to ask gets it.
  _grant(key, pid) {
    const it = this.byKey.get(key);
    if (!it || it.taken) return;
    it.taken = pid;
    const msg = { t: "itaken", k: key, by: pid, n: it.count };
    this.net.broadcast(msg);
    this._onTaken(msg);
  }

  _onTaken(m) {
    const it = this.byKey.get(m.k);
    this.byKey.delete(m.k);
    const g = this.game;
    if (it) g.entities.removeWhere((x) => x === it);
    if (m.by !== this.net.pid || !it) return;
    // Ours: into the inventory (what doesn't fit is thrown back out, for anyone).
    const left = g.inventory.add(it.id, m.n ?? it.count, it.dur);
    g.audio.playPickup?.();
    g.markInventoryChanged();
    if (left > 0) this.share(() => g.entities.spawn(it.id, left, g.player.position.clone().add(new THREE.Vector3(0, 1, 0)), null, { dur: it.dur, pickupDelay: 1.5 }));
  }

  update() {
    // Items that despawned here are forgotten.
    if (this.byKey.size && (this._gc = ((this._gc ?? 0) + 1) % 120) === 0) {
      const live = new Set(this.game.entities.items);
      for (const [k, it] of this.byKey) if (!live.has(it)) this.byKey.delete(k);
    }
  }

  stop() {
    // (They stay where they are, as ordinary items.)
    for (const it of this.byKey.values()) it.shared = null;
    this.byKey.clear();
  }
}
