// (Round 21) The colossus missions' set-up in the world (the director's part;
// the missions themselves are registered in js/mission-catalog.js, the
// creatures are js/colossi.js). missions.js calls colossusMission(director)
// twice a second while one runs ("colossus" event), and colossusCleanup when
// it ends (win, failure, a stop): the living colossi sink away into the haze,
// the dead ones lie a while.
//
//   long_legs  "Long Legs": a Strider walks on a town (the nearest village,
//              airport or outpost, its ring marked); bring it down before it
//              gets there (or the mission fails).
//   watcher    "The Watcher": blind it (seven eyes) or kill it.
//   nest       "Nest": kill the Hive Mother and shoot down its parasites (a
//              last brood bursts from the corpse if the count is short).
//   colossi    "Colossi": two at once (the variant picks the pair).
import * as THREE from "three";
import { SEA_LEVEL } from "./constants.js";

// The finale's pairs, by variant.
const PAIRS = [["strider", "weeper"], ["strider", "hive"], ["weeper", "hive"], ["strider", "weeper"]];
const LABEL = { strider: "Strider", weeper: "Watcher", hive: "Hive Mother" };

function kindsOf(m) {
  if (m.id === "colossi") return PAIRS[m.variant ?? 0] || PAIRS[0];
  return m.colossi || ["strider"];
}

// A spot `dist` blocks from `c` (on land if it can find some: they wade too).
function spotFrom(d, c, dist, avoid = null) {
  let best = null;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = c.x + Math.cos(a) * dist;
    const z = c.z + Math.sin(a) * dist;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < dist * 0.7) continue;
    const land = d.terrain.heightAt(Math.floor(x), Math.floor(z)) > SEA_LEVEL;
    best = { x, z };
    if (land) break;
  }
  return best || { x: c.x + dist, z: c.z };
}

export function colossusMission(d) {
  const C = d.colossi;
  const m = d.mission;
  if (!C || !m) return;
  const st = d.state;
  const p = d._anyone().position;
  const variant = m.variant ?? 0;
  // (Gone from the world while the mission still runs: a trip to the Nether
  // cleared them. The ones not yet brought down come back.)
  if (st.colInit && st.col.length && !st.col.some((c) => C.list.includes(c))) {
    const left = st.col.filter((c) => !c.downed);
    st.col = [];
    for (const old of left) {
      const at = spotFrom(d, p, 800);
      st.col.push(C.spawn(old.kind, { x: at.x, z: at.z, yaw: old.yaw, goal: old.goal, hpScale: old.maxHp / old.spec.hp }));
    }
  }
  if (!st.colInit) {
    st.colInit = true;
    st.col = [];
    st.downs = 0;
    const kinds = kindsOf(m);
    const hpScale = (d.ufos.groupHealth ?? 1) * (variant === 3 ? 1.2 : 1);
    if (m.id === "long_legs") {
      // The town it walks on, and where it comes from (1,150 blocks out, away from the player).
      const town = d._raidPlace(p);
      st.town = town;
      st.zone = { x: town.x, y: town.y, z: town.z, r: 40, kind: "shelter" };
      const from = spotFrom(d, town, variant === 2 ? 900 : 1150, p);
      const c = C.spawn("strider", { x: from.x, z: from.z, yaw: Math.atan2(-(town.x - from.x), -(town.z - from.z)), goal: town, hpScale });
      if (variant === 1) c.speedMul = 1.25;
      st.col.push(c);
      d.toast?.(`Something enormous is walking on the ${town.name.toLowerCase()} (ringed). Your jet is called in: bring the Strider down before it gets there!`, 6);
    } else {
      let prev = null;
      for (const kind of kinds) {
        const at = spotFrom(d, p, kind === "hive" ? 700 : 820, prev);
        prev = at;
        const c = C.spawn(kind, { x: at.x, z: at.z, yaw: Math.atan2(-(p.x - at.x), -(p.z - at.z)), hpScale });
        st.col.push(c);
      }
      d.toast?.(kinds.length > 1 ? `Two colossi: the ${LABEL[kinds[0]]} and the ${LABEL[kinds[1]]}. Your jet is called in.` : `${C.list[C.list.length - 1].spec.name} is out there (marked). Your jet is called in.`, 6);
    }
    // (The director hears what happens to them.)
    C.onEvent = (what, c) => colossusEvent(d, what, c);
  }
  const live = st.col.filter((c) => c.alive && C.list.includes(c));
  // The marker: the nearest one standing; the boss bar: the same.
  const focus = live.slice().sort((a, b) => a.root.distanceTo(p) - b.root.distanceTo(p))[0] || null;
  if (focus) {
    focus.marker ||= { pos: focus.bodyPos };
    d._setTarget(focus.marker, LABEL[focus.kind]);
    d.bossInfo = bossInfo(focus, live);
  } else {
    d.target = st.town ? { pos: new THREE.Vector3(st.town.x, st.town.y, st.town.z), label: st.town.name, follow: null } : null;
    d.bossInfo = null;
  }
  // Long Legs: the town reached is a failure.
  if (m.id === "long_legs" && st.town) {
    const c = st.col[0];
    if (c && c.alive) {
      const dist = Math.hypot(c.root.x - st.town.x, c.root.z - st.town.z);
      st.note = `It is ${Math.round(dist)} blocks from the ${st.town.name.toLowerCase()}.`;
      if (dist < 70) {
        d._fail(`The Strider reached the ${st.town.name.toLowerCase()}.`);
        return;
      }
    }
  } else if (m.id === "nest") {
    // A short count after the Hive Mother's death: a last brood from the corpse.
    const left = d._remaining(1);
    const hive = st.col[0];
    if (hive && !hive.alive && left > 0 && C.swarmCount() < Math.min(12, left + 4)) {
      st.broodT = (st.broodT ?? 2) - 0.5;
      if (st.broodT <= 0) {
        st.broodT = 9;
        C.launchSwarm(hive, hive.bodyPos, Math.min(10, left + 3));
        d.toast?.("Its corpse splits open: the last brood! Shoot them down.", 3);
      }
    }
    st.note = focus ? "" : `Parasites left to shoot down: ${left}.`;
  } else st.note = live.length > 1 ? `${live.length} colossi standing.` : "";
}

function bossInfo(c, live) {
  const gone = (list) => list.filter((p) => p.state === "gone").length;
  const plates = (p) => (p.plates || []).filter((q) => q.state !== "gone").length;
  let note = "";
  if (c.kind === "strider") {
    const knees = c.weak.filter((p) => p.kind === "knee");
    const sac = c.weak.find((p) => p.kind === "sac");
    note = c.phase === "fallen" ? "DOWN: HIT THE SAC!" : `KNEES ${gone(knees)}/3 TO FELL IT · SAC ${plates(sac) ? `ARMORED (${plates(sac)})` : "OPEN"}`;
  } else if (c.kind === "weeper") {
    const eyes = c.weak.filter((p) => p.kind === "eye");
    const heart = c.weak.find((p) => p.kind === "heart");
    note = c.phase === "blind" ? "BLIND!" : `EYES ${eyes.length - gone(eyes)}/7 · HEART ${plates(heart) ? `ARMORED (${plates(heart)})` : "OPEN"}${c.atk.code === 2 ? " · CHARGING: HIT THE EYES" : ""}`;
  } else {
    const eggs = c.weak.filter((p) => p.kind === "egg");
    const heart = c.weak.find((p) => p.kind === "heart");
    note = `EGG SACS ${eggs.length - gone(eggs)}/6 · HEART ${plates(heart) ? `ARMORED (${plates(heart)})` : "OPEN"}`;
  }
  if (c.enraged) note += " · ENRAGED";
  if (live.length > 1) note += ` · +${live.length - 1} MORE`;
  return { name: c.spec.name, health: Math.max(0, Math.min(1, c.hp / c.maxHp)), shield: false, pylons: 0, downT: 0, final: c.enraged, note };
}

function colossusEvent(d, what, c) {
  const st = d.state;
  if (!st.col?.includes(c)) return;
  // (The Watcher's mission: blinded or killed, once.)
  if (c.kind === "weeper" && (what === "blind" || what === "down") && !c.beaten) {
    c.beaten = true;
    d.stats.add("weeperBeaten");
  }
}

// The mission is over (any way): the ones still standing go.
export function colossusCleanup(d) {
  const C = d.colossi;
  if (!C) return;
  for (const c of d.state.col || []) if (C.list.includes(c)) C.dismiss(c);
  if (C.onEvent) C.onEvent = null;
}
