// Beds and sleeping (Round 11; Round 13: in both world types), as vanilla:
// - Right click on a bed (the building part's blockUse calls LIB.onBedUse,
//   which main.js points here) sets the respawn point to it ("Respawn point
//   set"), then lies down if it is night (18:32 to 5:27, vanilla's sleep
//   window) and no monster is within 8 blocks (5 up or down) of it.
// - Asleep the screen darkens; after 5 s asleep (vanilla's 100 ticks) the
//   night is skipped to the morning (6:00), at once, and everyone wakes.
//   Shift, a hit, the bed broken or the morning get you up, standing next
//   to the bed.
// - Online every player in the game must be asleep (dead players don't
//   count): each shows "x/y players sleeping". The host owns the clock: it
//   skips the night and sends the new time at once; a guest wakes when its
//   clock (the host's) reaches the morning. A player's sleeping is a flag in
//   their state (net/players.js), so the others see them lying in the bed.
// - Respawning: at the bed if it is still there and there is room to stand
//   next to it, else at the world spawn ("Your home bed was missing or
//   obstructed"). The spawn point is saved with the player (a guest's: by
//   the host, with the guest's things).
// (Round 13) A Missions world too: a mission's own respawn spot comes first
// (main.js), and while a mission needs the night (d.noRest: its reason) no
// one can lie down to skip it.
import * as THREE from "three";
import { BLOCK_INFO, IS_SOLID, IS_WET } from "./blocks.js";
import { vanillaRules } from "./worldtype.js";
import { BED_PART, SUFFOCATES, BODY, BODY_FLAGS } from "./survival.js";

export const SLEEP_TIME = 5; // seconds asleep before the night is skipped (vanilla: 100 ticks)
const NIGHT_FROM = 18 + 32.5 / 60; // (vanilla: tick 12542)
const NIGHT_TO = 5 + 27.5 / 60; // (tick 23459)
const MORNING = 6; // (tick 0)
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function isBed(id) {
  return BED_PART[id] > 0;
}

// Lays a player model down in its bed (after avatar.update): on its back,
// the head toward the bed's head (player.yaw faces the foot).
export function layDown(avatar, sleeper) {
  const root = avatar.root;
  if (!root.visible) return;
  root.rotation.order = "YXZ";
  avatar._bodyYaw = sleeper.yaw;
  root.rotation.set(-Math.PI / 2, sleeper.yaw + Math.PI, 0);
  root.position.y += 0.12;
}

// Puts a model back upright (it is reused when the player gets up).
export function standUp(avatar) {
  avatar.root.rotation.x = 0;
}

export class Sleep {
  // deps: { player, sky, world, mobs, toast, players () => remote players
  // here, online () => bool, isHost () => bool, inGame () => bool, sendTime
  // () => void, and the optional onSpawnSet, onSleep, onWake, onSkip,
  // thundering () => bool, everyone () => every remote player, whatever their
  // dimension (Round 12: net/players.js all()), noRest () => why no one may
  // sleep now, or null (Round 13: a Missions world's night mission) }
  constructor(deps) {
    this.d = deps;
    this.spawn = null; // [x, y, z]: the bed's head cell, or null (the world spawn)
    this.spawnDim = "overworld"; // (Round 12) "nether": the spawn is a respawn anchor there (js/portal.js)
    this._fade = 0; // the dark overlay's opacity
    this._shownFade = -1;
    this._statusText = "";
    this._skipped = false;
    this.overlayEl = document.getElementById("sleep-overlay");
    this.statusEl = document.getElementById("sleep-status");
  }

  get player() {
    return this.d.player;
  }

  // Night by the clock (vanilla's window: a bed works from 18:32 to 5:27),
  // or a thunderstorm (deps.thundering: js/weather.js).
  canSleepNow() {
    const h = this.d.sky.hours;
    return h >= NIGHT_FROM || h < NIGHT_TO || !!this.d.thundering?.();
  }

  // The bed whose cell (x, y, z) was clicked: its head cell and the
  // direction foot -> head, or null (not a bed, or half of one).
  bedAt(x, y, z, id = this.d.world.getBlock(x, y, z)) {
    const part = BED_PART[id];
    if (!part) return null;
    const w = this.d.world;
    // (The building part's beds name their other half: `partner`, [dx, dy, dz].)
    const pt = BLOCK_INFO[id]?.partner;
    for (const [dx, dz] of pt ? [[pt[0], pt[2]]] : SIDES) {
      const other = w.getBlock(x + dx, y, z + dz);
      const op = BED_PART[other];
      if (!op || op === part) continue;
      // (The foot clicked: the head is next door; the head clicked: the foot is.)
      if (part === 1) return { x: x + dx, y, z: z + dz, dx, dz };
      return { x, y, z, dx: -dx, dz: -dz };
    }
    return null;
  }

  _monstersNear(bed) {
    const mobs = this.d.mobs?.mobs;
    if (!mobs) return false;
    for (const m of mobs) {
      if (m.dead || !m.spec?.hostile || m.isRemotePlayer) continue;
      if (Math.abs(m.pos.x - (bed.x + 0.5)) <= 8 && Math.abs(m.pos.z - (bed.z + 0.5)) <= 8 && Math.abs(m.pos.y - bed.y) <= 5) return true;
    }
    return false;
  }

  _occupied(bed) {
    for (const r of this.d.players()) {
      if (!r.sleeping || r.dead) continue;
      const hx = r.position.x + Math.sin(r.yaw) * 1.5;
      const hz = r.position.z + Math.cos(r.yaw) * 1.5;
      if (Math.abs(hx - (bed.x + 0.5)) < 0.8 && Math.abs(hz - (bed.z + 0.5)) < 0.8 && Math.abs(r.position.y - bed.y) < 1.5) return true;
    }
    return false;
  }

  // A right click on a bed (LIB.onBedUse). True: handled (nothing placed against it).
  useBed(ctx) {
    const d = this.d;
    const p = this.player;
    if (!vanillaRules()) return false;
    if (p.sleeping || p.dead || p.vehicle) return true;
    // (ctx.bed: the building part's own reading of the bed, { foot, head }.)
    const b = ctx.bed;
    const bed = b?.head && b?.foot ? { x: b.head[0], y: b.head[1], z: b.head[2], dx: b.head[0] - b.foot[0], dz: b.head[2] - b.foot[2] } : this.bedAt(ctx.x, ctx.y, ctx.z, ctx.id);
    if (!bed) return true;
    // (vanilla: within 3 blocks of the bed, 2 up or down)
    const near = (cx, cz) => Math.max(Math.abs(p.position.x - (cx + 0.5)), Math.abs(p.position.z - (cz + 0.5))) <= 3.5 && Math.abs(p.position.y - bed.y) <= 2.5;
    if (!near(bed.x, bed.z) && !near(bed.x - bed.dx, bed.z - bed.dz)) {
      d.toast("You may not rest now; the bed is too far away", 2.5);
      return true;
    }
    if (SUFFOCATES[d.world.getBlock(bed.x, bed.y + 1, bed.z)]) {
      d.toast("This bed is obstructed", 2.5);
      return true;
    }
    if (this._occupied(bed)) {
      d.toast("This bed is occupied", 2.5);
      return true;
    }
    // (Vanilla sets the spawn before checking the time or the monsters.)
    const same = this.spawn && this.spawnDim !== "nether" && this.spawn[0] === bed.x && this.spawn[1] === bed.y && this.spawn[2] === bed.z;
    if (!same) {
      this.spawn = [bed.x, bed.y, bed.z];
      this.spawnDim = "overworld";
      d.onSpawnSet?.();
    }
    if (!this.canSleepNow()) {
      d.toast(same ? "You can sleep only at night or during thunderstorms" : "Respawn point set. You can sleep only at night or during thunderstorms", 2.5);
      return true;
    }
    const noRest = d.noRest?.();
    if (noRest) {
      d.toast(same ? noRest : `Respawn point set. ${noRest}`, 2.5);
      return true;
    }
    if (!p.creative && this._monstersNear(bed)) {
      d.toast(same ? "You may not rest now; there are monsters nearby" : "Respawn point set. You may not rest now; there are monsters nearby", 2.5);
      return true;
    }
    if (!same) d.toast("Respawn point set", 2);
    this._skipped = false;
    p.startSleeping(bed);
    d.onSleep?.();
    return true;
  }

  // Where to stand up next to a bed (head cell bx, by, bz; foot at -dx, -dz):
  // a free two-high spot on solid ground around either half, else on top of
  // the bed itself if there is room; null if nowhere.
  standSpot(bx, by, bz, dx, dz) {
    const w = this.d.world;
    const free = (x, y, z) => !IS_SOLID[w.getBlock(x, y, z)] && !IS_WET[w.getBlock(x, y, z)] && !(BODY_FLAGS[w.getBlock(x, y, z)] & (BODY.LAVA | BODY.FIRE));
    const cells = [
      [bx, bz],
      [bx - dx, bz - dz],
    ];
    for (const [cx, cz] of cells) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const x = cx + ox;
          const z = cz + oz;
          if (isBed(w.getBlock(x, by, z))) continue;
          for (const y of [by, by - 1, by + 1]) {
            if (IS_SOLID[w.getBlock(x, y - 1, z)] && free(x, y, z) && free(x, y + 1, z)) return new THREE.Vector3(x + 0.5, y, z + 0.5);
          }
        }
      }
    }
    if (free(bx, by + 1, bz) && free(bx, by + 2, bz)) return new THREE.Vector3(bx + 0.5, by + 0.5625, bz + 0.5);
    return null;
  }

  // The respawn spot (a Vector3), null (no bed: the world spawn), or false
  // (the bed is gone or obstructed: the spawn point is forgotten). The bed's
  // chunks must be loaded (main.js prepares the area first).
  respawnSpot() {
    if (!this.spawn || !vanillaRules()) return null;
    const [x, y, z] = this.spawn;
    const bed = this.bedAt(x, y, z);
    const spot = bed ? this.standSpot(bed.x, bed.y, bed.z, bed.dx, bed.dz) : null;
    if (!spot) {
      this.spawn = null;
      return false;
    }
    return spot;
  }

  // Up and out of bed, standing next to it.
  wake() {
    const p = this.player;
    const s = p.sleeping;
    if (!s) return;
    const at = this.standSpot(s.x, s.y, s.z, s.dx, s.dz);
    p.stopSleeping(at);
    p.syncCamera();
    this.d.onWake?.();
  }

  // Everyone in the game (dead players don't count): [asleep, total, all
  // asleep long enough]. (Round 12) Only the Overworld's, as vanilla's
  // sleepers are counted in their own world: a player in the Nether or the
  // End doesn't keep the night going (their dimension: world.dim, r.dim).
  _count() {
    const p = this.player;
    let asleep = 0;
    let total = 0;
    let ready = true;
    if (!p.dead && this.d.inGame?.() !== false && (this.d.world.dim ?? "overworld") === "overworld") {
      total++;
      if (p.sleeping) asleep++;
      if (!p.sleeping || p.sleeping.t < SLEEP_TIME) ready = false;
    }
    for (const r of this.d.everyone?.() ?? this.d.players()) {
      if (r.dead || (r.dim | 0) !== 0) continue;
      total++;
      if (r.sleeping) asleep++;
      if (!r.sleeping || (r.sleepTime ?? 0) < SLEEP_TIME) ready = false;
    }
    return [asleep, total, ready && total > 0];
  }

  update(dt) {
    const d = this.d;
    const p = this.player;
    const s = p.sleeping;
    if (s) {
      s.t += dt;
      // (Shift or a hit, the bed gone, the morning, a vehicle: up.)
      const gone = !this.bedAt(s.x, s.y, s.z);
      if (p.wantsToLeaveBed || gone || p.dead || p.vehicle || !vanillaRules() || (s.t > 0.5 && !this.canSleepNow())) this.wake();
    }
    const online = d.online();
    const [asleep, total, ready] = online ? this._count() : [p.sleeping ? 1 : 0, 1, !!p.sleeping && p.sleeping.t >= SLEEP_TIME];
    // The night is skipped where the clock lives (single player; the host).
    if (ready && !this._skipped && (!online || d.isHost()) && this.canSleepNow()) {
      this._skipped = true;
      d.sky.skipToMorning(MORNING);
      if (online) d.sendTime();
      d.onSkip?.();
    }
    if (!asleep) this._skipped = false;
    // The screen darkens while asleep (vanilla: to 86% over the 100 ticks)
    // and clears quickly on waking.
    const target = p.sleeping ? 0.86 * Math.min(1, p.sleeping.t / SLEEP_TIME) : 0;
    this._fade = target >= this._fade ? target : Math.max(target, this._fade - dt * 1.7);
    const shown = Math.round(this._fade * 50) / 50;
    if (shown !== this._shownFade && this.overlayEl) {
      this._shownFade = shown;
      this.overlayEl.style.opacity = String(shown);
      this.overlayEl.classList.toggle("hidden", shown <= 0);
    }
    // "1/2 players sleeping" (online, while anyone sleeps); alone in bed: how to get up.
    const text = online && asleep > 0 ? `${asleep}/${total} players sleeping` : p.sleeping ? "Sneak (Shift) to leave the bed" : "";
    if (text !== this._statusText && this.statusEl) {
      this._statusText = text;
      this.statusEl.textContent = text;
      this.statusEl.classList.toggle("hidden", !text);
    }
  }

  // [x, y, z], or (Round 12) [x, y, z, "nether"] for a respawn anchor.
  serialize() {
    if (!this.spawn) return undefined;
    return this.spawnDim === "nether" ? [...this.spawn, "nether"] : this.spawn.slice();
  }

  load(spawn) {
    const nether = Array.isArray(spawn) && spawn.length === 4 && spawn[3] === "nether";
    const xyz = Array.isArray(spawn) && (spawn.length === 3 || nether) ? spawn.slice(0, 3) : null;
    this.spawn = xyz && xyz.every(Number.isInteger) ? xyz : null;
    this.spawnDim = this.spawn && nether ? "nether" : "overworld";
  }
}
