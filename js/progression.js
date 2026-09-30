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
//
// A chain of fifteen missions with a steady difficulty curve: it starts with
// one small, weak scout that a pistol can bring down, and builds up through
// alien crews, a supply drop, a first night, salvage, squads and the first
// flight, to dogfights, a village raid, big ships, a mothership and, at the
// end, nuking an airport the aliens have taken over. Each mission unlocks
// better gear (its reward), and sets the rules for the sky while it is the
// current one (`rules`: which UFO sizes appear and how often, and
// multipliers for their health, damage, aggression and numbers), so early
// UFOs are few, small and weak, and late ones many, big and dangerous.
//
// objectives: [{ stat, goal, label }] measured from the moment the mission
// starts (stat counters are the world's; see stats.js). reward: items.
// event: what the mission director (missions.js) sets up for it.
// tier: the loot tier while it is the current mission (0-5).

const R = (sizes, health, damage, aggression, count) => ({ sizes, health, damage, aggression, count });
const EARLY = { small: 1 };
const LATE = { small: 2.5, medium: 4, large: 3, mothership: 0.7, giant: 0.18 };

export const MISSIONS = [
  {
    id: "first_contact",
    title: "First contact",
    text: "A small scout UFO is snooping around nearby. Find it (follow the marker) and shoot it down with your pistol: aim, right click, keep firing.",
    objectives: [{ stat: "ufosDown", goal: 1, label: "Scout shot down" }],
    reward: [[ITEM.GRENADE, 1], [ITEM.STONE_SWORD, 1], [ITEM.COOKED_MEAT, 4]],
    event: "scout",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.45, 0.5),
  },
  {
    id: "crew",
    title: "The crew",
    text: "Aliens climbed out of the wreck, and they are armed. Kill them before they get you.",
    objectives: [{ stat: "aliensKilled", goal: 2, label: "Aliens killed" }],
    reward: [[ITEM.MACHINE_GUN, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "crew",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.45, 0.5),
  },
  {
    id: "supply",
    title: "Supply drop",
    text: "Friends on the ground have dropped supplies for you. Follow the orange smoke and open the crate.",
    objectives: [{ stat: "cratesOpened", goal: 1, label: "Supply crates opened" }],
    reward: [[ITEM.IRON_SWORD, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "crate",
    tier: 0,
    rules: R(EARLY, 0.65, 0.55, 0.5, 0.6),
  },
  {
    id: "long_night",
    title: "The long night",
    text: "UFOs (and zombies) come out in the dark. Survive one night, from dusk to dawn, without dying. Hide under a roof if they try to beam you up.",
    objectives: [{ stat: "nightsSurvived", goal: 1, label: "Nights survived" }],
    reward: [[ITEM.LASER_BLASTER, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "night",
    tier: 1,
    rules: R({ small: 5, medium: 1 }, 0.7, 0.65, 0.7, 0.9),
  },
  {
    id: "salvage",
    title: "Salvage",
    text: "The next UFO you shoot down will come down in one piece. Board the wreck (walk up, press F): it still flies.",
    objectives: [{ stat: "ufosBoarded", goal: 1, label: "UFOs boarded" }],
    reward: [[ITEM.SHIELD, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "intact",
    tier: 1,
    rules: R({ small: 4, medium: 2 }, 0.75, 0.7, 0.75, 0.9),
  },
  {
    id: "scout_hunter",
    title: "Scout hunter",
    text: "Take the fight to them: shoot down three UFOs. Bigger ones are about now.",
    objectives: [{ stat: "ufosDown", goal: 3, label: "UFOs shot down" }],
    reward: [[ITEM.SNIPER_RIFLE, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "hunt",
    tier: 1,
    rules: R({ small: 4, medium: 3 }, 0.8, 0.75, 0.8, 1),
  },
  {
    id: "squad",
    title: "Alien squad",
    text: "A UFO has dropped an alien squad nearby: greens, grays and a tough red. Wipe it out. Keep your distance from the red one's plasma.",
    objectives: [{ stat: "aliensKilled", goal: 6, label: "Aliens killed" }],
    reward: [[ITEM.BAZOOKA, 1], [ITEM.GOLDEN_APPLE, 2]],
    event: "squad",
    tier: 2,
    rules: R({ small: 3, medium: 3, large: 0.3 }, 0.85, 0.8, 0.85, 1),
  },
  {
    id: "wings",
    title: "Take to the air",
    text: "Call in your fighter jet (J) near an airport (F3 shows the nearest), get in (F) and take off: full throttle (W), Shift for the afterburner.",
    objectives: [{ stat: "takeoffs", goal: 1, label: "Takeoffs" }],
    reward: [[ITEM.JET_RADIO, 1], [ITEM.GOLDEN_APPLE, 1]],
    event: "takeoff",
    tier: 2,
    rules: R({ small: 3, medium: 3, large: 0.5 }, 0.9, 0.85, 0.85, 1),
  },
  {
    id: "dogfight",
    title: "Dogfight",
    text: "Shoot down two UFOs from your jet: the cannon (left click) or a missile lock (hold right click, release when LOCKED).",
    objectives: [{ stat: "ufosDownByJet", goal: 2, label: "UFOs shot down from the jet" }],
    reward: [[ITEM.AIRSTRIKE, 1], [ITEM.GOLDEN_APPLE, 2]],
    event: "dogfight",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1 }, 0.9, 0.9, 0.9, 1.1),
  },
  {
    id: "air_superiority",
    title: "Air superiority",
    text: "An enemy fighter is hunting you. Shoot it down: flares (C) fool its missiles, hard turns make them miss.",
    objectives: [{ stat: "enemyJetsDown", goal: 1, label: "Enemy fighters shot down" }],
    reward: [[ITEM.MINIGUN, 1], [ITEM.GOLDEN_APPLE, 2]],
    event: "fighter",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.2, mothership: 0.05 }, 0.95, 0.95, 1, 1.1),
  },
  {
    id: "village",
    title: "Village under attack",
    text: "Raiders are burning a village. Get there (follow the marker) and shoot down the three raiders before they finish the job.",
    objectives: [{ stat: "raidersDown", goal: 3, label: "Raiders shot down" }],
    reward: [[ITEM.DIAMOND_SWORD, 1], [ITEM.DIAMOND_PICKAXE, 1], [ITEM.GOLDEN_APPLE, 3]],
    event: "village",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.5, mothership: 0.1 }, 1, 1, 1, 1.1),
  },
  {
    id: "big_game",
    title: "Big game",
    text: "The big ships are coming. Bring down a large UFO (the bazooka's lock-on, missiles or an airstrike help).",
    objectives: [{ stat: "ufosDownLarge", goal: 1, label: "Large UFOs shot down" }],
    reward: [[ITEM.RAILGUN, 1], [ITEM.GOLDEN_APPLE, 3]],
    event: "large",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 3, mothership: 0.3, giant: 0.03 }, 1, 1, 1.05, 1.2),
  },
  {
    id: "mothership",
    title: "Mothership",
    text: "A mothership has arrived, with an escort. Destroy it: railgun beams, missile salvos (hold the lock 3 s) and the nuke hit hardest.",
    objectives: [{ stat: "ufosDownBig", goal: 1, label: "Mothership destroyed" }],
    reward: [[ITEM.GOLDEN_APPLE, 6]],
    event: "mothership",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 3, mothership: 0.5, giant: 0.08 }, 1.05, 1.05, 1.1, 1.2),
  },
  {
    id: "sunburn",
    title: "Operation Sunburn",
    text: "The aliens have taken an airport and turned it into a base (marked). Fly there and drop your nuke on it (B in the jet). Fighters and UFOs guard it.",
    objectives: [{ stat: "airportsNuked", goal: 1, label: "Enemy base nuked" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "airport",
    tier: 5,
    rules: R(LATE, 1.1, 1.1, 1.2, 1.3),
  },
  {
    id: "slayer",
    title: "UFO slayer",
    text: "The invasion is broken, but they keep coming. Shoot down twenty-five more.",
    objectives: [{ stat: "ufosDown", goal: 25, label: "UFOs shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 10]],
    event: "hunt",
    tier: 5,
    rules: R(LATE, 1.15, 1.15, 1.3, 1.4),
  },
];

// The old seven-mission chain (Round 2 saves): how many new missions a save
// that had finished N old ones counts as finished.
const OLD_STEP_TO_NEW = [0, 2, 5, 8, 9, 10, 12, 13];

export class Progress {
  constructor() {
    this.step = 0; // index of the current mission (MISSIONS.length: all done)
    this.base = {}; // the stat values when the current mission started
    this.done = []; // ids of finished missions
    this.onComplete = null; // (mission) => void
    this.onChange = null; // () => void
    this.onStart = null; // (mission) => void: a mission became the current one
    this.enabled = true;
  }

  get mission() {
    return MISSIONS[this.step] || null;
  }

  // Missions finished, 0-MISSIONS.length.
  get completed() {
    return Math.min(this.step, MISSIONS.length);
  }

  // The rules for the sky right now (see MISSIONS), the last mission's once
  // the chain is done.
  get rules() {
    return (this.mission || MISSIONS[MISSIONS.length - 1]).rules;
  }

  // How far along the player is (weapon and loot quality): the current
  // mission's tier, plus one for a player who shoots down lots of UFOs.
  tier(stats) {
    const m = this.mission || MISSIONS[MISSIONS.length - 1];
    const extra = Math.floor((stats?.ufosDown ?? 0) / 12) > 0 ? 1 : 0;
    return Math.min(MAX_TIER, m.tier + (this.mission ? extra : 1));
  }

  // 0-1: the difficulty curve (a gentle sky at the start).
  difficulty(stats) {
    return Math.min(1, this.completed / (MISSIONS.length - 1));
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

  // Every mission with its state, for the list in the pause menu:
  // [{ n, id, title, text, reward, state: "done" | "current" | "locked", objectives }].
  list(stats) {
    return MISSIONS.map((m, i) => ({ n: i + 1, id: m.id, title: m.title, text: m.text, reward: m.reward, state: i < this.step ? "done" : i === this.step ? "current" : "locked", objectives: i === this.step ? this.objectives(stats) : null }));
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
    if (this.mission && this.onStart) this.onStart(this.mission);
    return m;
  }

  serialize() {
    return { v: 3, step: this.step, base: this.base, done: this.done };
  }

  load(data, stats) {
    if (data && Number.isInteger(data.step) && data.step >= 0) {
      if (data.v !== 3) {
        // A Round 2 save: carry its progress over to the new chain.
        this.step = OLD_STEP_TO_NEW[Math.min(data.step, OLD_STEP_TO_NEW.length - 1)];
        this.done = MISSIONS.slice(0, this.step).map((m) => m.id);
        this.base = { ...this._pick(stats) };
        return;
      }
      this.step = Math.min(data.step, MISSIONS.length);
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
