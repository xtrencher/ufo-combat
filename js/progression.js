// Survival progression: the mission chain, the loot tables and the
// difficulty curve. Pure logic (no DOM, no three.js); main.js wires it to the
// game (rewards, toasts, the mission tracker, drops).
//
// A new Survival game starts with a pistol only. Better weapons come from
// UFOs and their crews, supply crates and mission rewards; the further you
// get, the better the loot and the tougher the sky becomes.
import { ITEM } from "./items.js";

// ---------- Weapons by tier ----------

// The tier a weapon starts to drop at (0 = from the start).
export const WEAPON_TIERS = [
  [ITEM.GRENADE, 0],
  [ITEM.MACHINE_GUN, 1],
  [ITEM.LASER_BLASTER, 1],
  [ITEM.SNIPER_RIFLE, 2],
  [ITEM.SHIELD, 2],
  [ITEM.JET_RADIO, 2],
  [ITEM.BAZOOKA, 3],
  [ITEM.AIRSTRIKE, 3],
  [ITEM.MINIGUN, 4],
  [ITEM.RAILGUN, 5],
];

// Tools drop too (there is no crafting): [id, tier].
export const TOOL_TIERS = [
  [ITEM.STONE_SWORD, 0],
  [ITEM.STONE_PICKAXE, 0],
  [ITEM.IRON_SWORD, 1],
  [ITEM.IRON_PICKAXE, 1],
  [ITEM.IRON_AXE, 1],
  [ITEM.DIAMOND_SWORD, 3],
  [ITEM.DIAMOND_PICKAXE, 3],
];

export const MAX_TIER = 5;

// ---------- Missions ----------

// objectives: [{ stat, goal, label }] measured from the moment the mission
// starts (stat counters are the world's; see stats.js). reward: items.
export const MISSIONS = [
  {
    id: "first_contact",
    title: "First contact",
    text: "Shoot down a UFO, then deal with the aliens that climb out of the wreck.",
    objectives: [
      { stat: "ufosDown", goal: 1, label: "UFOs shot down" },
      { stat: "aliensKilled", goal: 2, label: "Aliens killed" },
    ],
    reward: [[ITEM.MACHINE_GUN, 1], [ITEM.GOLDEN_APPLE, 1]],
  },
  {
    id: "salvage",
    title: "Salvage",
    text: "A UFO that comes down in one piece still flies. Board a crashed one (F).",
    objectives: [{ stat: "ufosBoarded", goal: 1, label: "UFOs boarded" }],
    reward: [[ITEM.LASER_BLASTER, 1], [ITEM.SHIELD, 1], [ITEM.GOLDEN_APPLE, 1]],
  },
  {
    id: "wings",
    title: "Take to the air",
    text: "Call in your fighter jet (J or the Jet Radio) and take off, ideally from an airport.",
    objectives: [{ stat: "jetsCalled", goal: 1, label: "Jets called in" }],
    reward: [[ITEM.SNIPER_RIFLE, 1], [ITEM.JET_RADIO, 1], [ITEM.GOLDEN_APPLE, 2]],
  },
  {
    id: "clean_skies",
    title: "Clean the skies",
    text: "Shoot down five UFOs.",
    objectives: [{ stat: "ufosDown", goal: 5, label: "UFOs shot down" }],
    reward: [[ITEM.BAZOOKA, 1], [ITEM.GOLDEN_APPLE, 2]],
  },
  {
    id: "air_superiority",
    title: "Air superiority",
    text: "The aliens have fighters. Shoot one down (they hunt you once you attack their UFOs).",
    objectives: [{ stat: "enemyJetsDown", goal: 1, label: "Enemy jets shot down" }],
    reward: [[ITEM.MINIGUN, 1], [ITEM.AIRSTRIKE, 1], [ITEM.GOLDEN_APPLE, 3]],
  },
  {
    id: "giant_killer",
    title: "Giant killer",
    text: "Bring down a mothership or a giant (a railgun beam or a salvo of missiles will do).",
    objectives: [{ stat: "ufosDownBig", goal: 1, label: "Motherships and giants shot down" }],
    reward: [[ITEM.RAILGUN, 1], [ITEM.GOLDEN_APPLE, 5]],
  },
  {
    id: "slayer",
    title: "UFO slayer",
    text: "The invasion is broken. Keep going: shoot down twenty more.",
    objectives: [{ stat: "ufosDown", goal: 20, label: "UFOs shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
  },
];

export class Progress {
  constructor() {
    this.step = 0; // index of the current mission (MISSIONS.length: all done)
    this.base = {}; // the stat values when the current mission started
    this.done = []; // ids of finished missions
    this.onComplete = null; // (mission) => void
    this.onChange = null; // () => void
    this.enabled = true;
  }

  get mission() {
    return MISSIONS[this.step] || null;
  }

  // Missions finished, 0-MISSIONS.length.
  get completed() {
    return Math.min(this.step, MISSIONS.length);
  }

  // How far along the player is (weapon and loot quality, tougher UFOs): the
  // missions done plus one for every eight UFOs shot down beyond that.
  tier(stats) {
    const extra = Math.floor((stats?.ufosDown ?? 0) / 8);
    return Math.min(MAX_TIER, this.completed + Math.min(2, extra));
  }

  // 0-1: the difficulty curve (a gentle sky at the start).
  difficulty(stats) {
    return Math.min(1, this.tier(stats) / MAX_TIER);
  }

  start(stats) {
    this.base = { ...this._pick(stats) };
  }

  _pick(stats) {
    const out = {};
    for (const m of MISSIONS) for (const o of m.objectives) out[o.stat] = stats[o.stat] ?? 0;
    return out;
  }

  // Progress of the current mission: [{ label, value, goal }].
  objectives(stats) {
    const m = this.mission;
    if (!m) return [];
    return m.objectives.map((o) => ({ label: o.label, goal: o.goal, value: Math.max(0, Math.min(o.goal, Math.floor((stats[o.stat] ?? 0) - (this.base[o.stat] ?? 0)))) }));
  }

  // Checks the current mission; completes it (and moves on) when every
  // objective is met. Returns the finished mission or null.
  update(stats) {
    if (!this.enabled) return null;
    const m = this.mission;
    if (!m) return null;
    if (!this.objectives(stats).every((o) => o.value >= o.goal)) return null;
    this.done.push(m.id);
    this.step++;
    // The next mission starts counting from now.
    this.base = { ...this._pick(stats) };
    if (this.onComplete) this.onComplete(m);
    if (this.onChange) this.onChange();
    return m;
  }

  serialize() {
    return { step: this.step, base: this.base, done: this.done };
  }

  load(data, stats) {
    if (data && Number.isInteger(data.step) && data.step >= 0 && data.step <= MISSIONS.length) {
      this.step = data.step;
      this.base = data.base && typeof data.base === "object" ? { ...data.base } : {};
      this.done = Array.isArray(data.done) ? data.done.filter((x) => typeof x === "string") : [];
      // Stat counters this save didn't have yet start from where they are.
      for (const [k, v] of Object.entries(this._pick(stats))) if (!Number.isFinite(this.base[k])) this.base[k] = v;
    } else {
      this.start(stats);
    }
  }
}

// ---------- Loot ----------

function pickWeighted(list, rand) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rand() * total;
  for (const [item, w] of list) {
    r -= w;
    if (r <= 0) return item;
  }
  return list[list.length - 1][0];
}

// A weapon not owned yet whose tier is within reach; null when there is none.
export function pickWeapon(tier, owned, rand = Math.random, bonus = 0) {
  const options = WEAPON_TIERS.filter(([id, t]) => t <= tier + bonus && !owned.has(id));
  if (options.length === 0) return null;
  // The newest tiers are the likeliest: what you are working toward.
  return pickWeighted(
    options.map(([id, t]) => [id, 1 + t * 0.6]),
    rand
  );
}

export function pickTool(tier, owned, rand = Math.random) {
  const options = TOOL_TIERS.filter(([id, t]) => t <= tier && !owned.has(id));
  if (options.length === 0) return null;
  return pickWeighted(options.map(([id]) => [id, 1]), rand);
}

// What a kill or a wreck drops: [[itemId, count], ...]. kind:
// "alien" (crew, by colour: "green" | "gray" | "red"), "ufo" (by size name),
// "enemyjet", "crate". `owned`: a Set of item ids the player already has.
export function rollLoot(kind, detail, tier, owned, rand = Math.random) {
  const out = [];
  const have = new Set(owned);
  const add = (id, n = 1) => {
    if (id == null) return;
    const e = out.find((x) => x[0] === id);
    if (e) e[1] += n;
    else out.push([id, n]);
    have.add(id);
  };
  const food = () => (rand() < 0.5 ? ITEM.COOKED_MEAT : ITEM.APPLE);
  switch (kind) {
    case "alien": {
      const chance = { green: 0.28, gray: 0.42, red: 0.65 }[detail] ?? 0.3;
      if (rand() > chance + tier * 0.03) break;
      const bonus = detail === "red" ? 1 : 0;
      const r = rand();
      if (r < 0.4) add(food(), 1 + Math.floor(rand() * 2));
      else if (r < 0.5 + (detail === "red" ? 0.2 : 0.05) && (tier >= 2 || detail === "red")) add(ITEM.GOLDEN_APPLE, 1);
      else if (r < 0.62) add(pickTool(tier + bonus, have, rand), 1);
      else {
        const w = pickWeapon(tier, have, rand, bonus);
        if (w != null) add(w, 1);
        else add(food(), 1);
      }
      break;
    }
    case "ufo": {
      const n = { small: 1, medium: 1, large: 2, mothership: 4, giant: 6 }[detail] ?? 1;
      const bonus = detail === "mothership" || detail === "giant" ? 2 : detail === "large" ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const r = rand();
        if (r < 0.55) {
          const w = pickWeapon(tier, have, rand, bonus);
          if (w != null) add(w, 1);
          else add(ITEM.GOLDEN_APPLE, 1);
        } else if (r < 0.75) add(ITEM.GOLDEN_APPLE, 1);
        else if (r < 0.9) add(pickTool(tier + bonus, have, rand) ?? food(), 1);
        else add(food(), 2);
      }
      break;
    }
    case "enemyjet": {
      const w = pickWeapon(tier, have, rand, 2);
      if (w != null) add(w, 1);
      add(ITEM.GOLDEN_APPLE, 1 + Math.floor(rand() * 2));
      break;
    }
    case "crate": {
      // A weapon (always, if one is left), golden apples, sometimes a shield/tool.
      const w = pickWeapon(tier, have, rand, 1);
      if (w != null) add(w, 1);
      add(ITEM.GOLDEN_APPLE, 1 + Math.floor(rand() * (2 + Math.min(2, tier))));
      if (rand() < 0.5) add(pickTool(tier + 1, have, rand), 1);
      if (!have.has(ITEM.SHIELD) && rand() < 0.4) add(ITEM.SHIELD, 1);
      add(food(), 2 + Math.floor(rand() * 3));
      break;
    }
    default:
      break;
  }
  return out;
}

// The alien kind's colour: "green" | "gray" | "red".
export function alienColour(kind) {
  return kind === "alien_red" ? "red" : kind === "alien_gray" ? "gray" : "green";
}
