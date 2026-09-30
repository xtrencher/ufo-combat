// Survival progression: the mission chain, the loot tables and the
// difficulty curve. Pure logic (no DOM, no three.js); main.js wires it to the
// game (rewards, toasts, the mission tracker, drops).
//
// A new Survival game starts with basic gear (a stone sword, a stone pickaxe,
// apples). Weapons come from four places, each in its own lane:
//   - skeletons: the bow;
//   - supply crates: standard weapons (pistol, grenades, machine gun,
//     shield, sniper rifle, bazooka, airstrike designator), by tier;
//   - aliens: alien weapons, weakest to strongest (laser blaster, laser
//     minigun, railgun), only once the chain gets that far;
//   - missions: apples and golden apples only (no weapons).
// UFO wrecks and patrol fighters drop food, golden apples and tools.
import { ITEM } from "./items.js";

// ---------- Weapons by source and tier ----------

// Standard weapons in supply crates: [id, the tier it appears at].
export const CRATE_WEAPONS = [
  [ITEM.PISTOL, 0],
  [ITEM.GRENADE, 1],
  [ITEM.MACHINE_GUN, 1],
  [ITEM.SHIELD, 1],
  [ITEM.SNIPER_RIFLE, 2],
  [ITEM.BAZOOKA, 3],
  [ITEM.AIRSTRIKE, 4],
];

// Alien weapons, weakest first: [id, tier, the alien kind that carries it].
// An alien drops the weakest one you don't have yet, if its kind is at least
// as strong as that weapon's carrier and the chain has reached its tier.
export const ALIEN_WEAPONS = [
  [ITEM.LASER_BLASTER, 2, "green"],
  [ITEM.MINIGUN, 3, "gray"],
  [ITEM.RAILGUN, 4, "red"],
];
const KIND_RANK = { green: 0, gray: 1, red: 2 };

// (Round 3 name, kept for callers: every weapon that can drop, by tier.)
export const WEAPON_TIERS = [...CRATE_WEAPONS, ...ALIEN_WEAPONS.map(([id, t]) => [id, t])];

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
// A chain of nineteen missions with a steady difficulty curve. It starts on
// foot with a sword: a skeleton (its bow), a UFO that lands and lets its crew
// out (they give you a moment before they attack), the first supply crate (a
// pistol), a first scout to shoot down and its crew, a night; then alien
// patrols whose leaders carry the alien weapons (blaster, minigun, railgun),
// the jets, dogfights, a village raid, and only late in the chain the alien
// ships themselves (Salvage), big ships, a mothership and nuking the base.
//
// Each mission sets the rules for the sky while it is the current one
// (`rules`): which UFO sizes appear and how often, multipliers for their
// health, damage and aggression, how many at most are in the sky at once
// (day; more at night) and how often a new one turns up, and which alien
// kinds crew them. So there are no UFOs at all for the first two missions,
// then a single one, and more as the chain goes on.
//
// objectives: [{ stat, goal, label }] measured from the moment the mission
// starts (stat counters are the world's; see stats.js). reward: apples.
// event: what the mission director (missions.js) sets up for it.
// tier: the loot tier while it is the current mission (0-5).
// squad: an alien patrol for the "squad" event: { kind, n, leaderDrop }.

const R = (sizes, health, damage, aggression, max, rate, crew = { alien: 1 }) => ({ sizes, health, damage, aggression, max, rate, crew });
const EARLY = { small: 1 };
const LATE = { small: 2.5, medium: 4, large: 3, mothership: 0.7, giant: 0.18 };
const GREEN = { alien: 1 };
const GREEN_GRAY = { alien: 2, alien_gray: 1 };
const ALL_CREWS = { alien: 3, alien_gray: 2, alien_red: 1 };

export const MISSIONS = [
  {
    id: "skeleton",
    title: "The archer",
    text: "A skeleton is prowling nearby (follow the marker). Kill it with your sword and take its bow: hold right click to draw, let go to shoot.",
    objectives: [{ stat: "skeletonsKilled", goal: 1, label: "Skeleton killed" }],
    reward: [[ITEM.APPLE, 3]],
    event: "skeleton",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0, 0, 0),
  },
  {
    id: "landing",
    title: "Visitors",
    text: "A small UFO is landing nearby. Its crew will look around for a moment, then come for you: be ready with your bow (and your sword: they go down in melee too).",
    objectives: [{ stat: "aliensKilled", goal: 2, label: "Aliens killed" }],
    reward: [[ITEM.APPLE, 4]],
    event: "landing",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0, 0, 0, GREEN),
  },
  {
    id: "supply",
    title: "Supply drop",
    text: "Friends on the ground have dropped supplies for you: a pistol. Follow the orange smoke and open the crate. (R reloads.)",
    objectives: [{ stat: "cratesOpened", goal: 1, label: "Supply crates opened" }],
    reward: [[ITEM.APPLE, 3]],
    event: "crate",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.3, 1, 0.012, GREEN),
  },
  {
    id: "first_contact",
    title: "First contact",
    text: "A scout UFO is snooping around nearby. Find it (follow the marker) and shoot it down with your pistol or your bow.",
    objectives: [{ stat: "ufosDown", goal: 1, label: "Scout shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 1]],
    event: "scout",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.4, 1, 0.012, GREEN),
  },
  {
    id: "crew",
    title: "The crew",
    text: "Aliens climbed out of the wreck, and they are armed. Kill them before they get you.",
    objectives: [{ stat: "aliensKilled", goal: 2, label: "Aliens killed" }],
    reward: [[ITEM.GOLDEN_APPLE, 1], [ITEM.APPLE, 2]],
    event: "crew",
    tier: 1,
    rules: R(EARLY, 0.6, 0.5, 0.4, 1, 0.012, GREEN),
  },
  {
    id: "long_night",
    title: "The long night",
    text: "UFOs (and zombies) come out in the dark. Survive one night, from dusk to dawn, without dying. Hide under a roof if they try to beam you up.",
    objectives: [{ stat: "nightsSurvived", goal: 1, label: "Nights survived" }],
    reward: [[ITEM.GOLDEN_APPLE, 1], [ITEM.APPLE, 4]],
    event: "night",
    tier: 1,
    rules: R({ small: 5, medium: 1 }, 0.65, 0.6, 0.6, 2, 0.018, GREEN),
  },
  {
    id: "patrol",
    title: "Laser patrol",
    text: "A UFO has landed a patrol of green aliens nearby. Their leader (marked) carries a laser blaster: wipe them out and take it.",
    objectives: [{ stat: "aliensKilled", goal: 4, label: "Aliens killed" }],
    reward: [[ITEM.GOLDEN_APPLE, 1]],
    event: "squad",
    squad: { kind: "alien", n: 4, leaderDrop: ITEM.LASER_BLASTER },
    tier: 2,
    rules: R({ small: 4, medium: 2 }, 0.7, 0.65, 0.65, 2, 0.02, GREEN),
  },
  {
    id: "scout_hunter",
    title: "Scout hunter",
    text: "Take the fight to them: shoot down three UFOs. Bigger ones are about now.",
    objectives: [{ stat: "ufosDown", goal: 3, label: "UFOs shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "hunt",
    tier: 2,
    rules: R({ small: 4, medium: 3 }, 0.75, 0.7, 0.75, 3, 0.025, GREEN),
  },
  {
    id: "grays",
    title: "Gray squad",
    text: "A squad of grays (fast sharpshooters with burst rifles) has landed. Their leader (marked) carries a laser minigun: take it. Keep moving.",
    objectives: [{ stat: "aliensKilled", goal: 5, label: "Aliens killed" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "squad",
    squad: { kind: "alien_gray", n: 5, leaderDrop: ITEM.MINIGUN },
    tier: 3,
    rules: R({ small: 3, medium: 3, large: 0.3 }, 0.8, 0.75, 0.8, 3, 0.025, GREEN_GRAY),
  },
  {
    id: "wings",
    title: "Take to the air",
    text: "Call in a fighter jet (J, then 1 or 2) near an airport (F3 shows the nearest), get in (F) and take off: full throttle (W), Shift for the afterburner.",
    objectives: [{ stat: "takeoffs", goal: 1, label: "Takeoffs" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "takeoff",
    tier: 3,
    rules: R({ small: 3, medium: 3, large: 0.5 }, 0.85, 0.8, 0.8, 3, 0.025, GREEN_GRAY),
  },
  {
    id: "dogfight",
    title: "Dogfight",
    text: "Shoot down two UFOs from your jet: the cannon (left click), a missile (a click fires one straight ahead) or a missile lock (hold right click, release when LOCKED).",
    objectives: [{ stat: "ufosDownByJet", goal: 2, label: "UFOs shot down from the jet" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "dogfight",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1 }, 0.9, 0.85, 0.85, 4, 0.03, GREEN_GRAY),
  },
  {
    id: "air_superiority",
    title: "Air superiority",
    text: "The aliens have hijacked one of our fighters, and it is hunting you. Shoot it down: flares (C) fool its missiles, hard turns make them miss.",
    objectives: [{ stat: "enemyJetsDown", goal: 1, label: "Hijacked fighter shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "fighter",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.2, mothership: 0.05 }, 0.9, 0.9, 0.9, 4, 0.03, GREEN_GRAY),
  },
  {
    id: "village",
    title: "Village under attack",
    text: "Raiders are burning a village. Get there (follow the marker) and shoot down the three raiders before they finish the job.",
    objectives: [{ stat: "raidersDown", goal: 3, label: "Raiders shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "village",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.5, mothership: 0.1 }, 0.95, 0.95, 0.95, 4, 0.03, GREEN_GRAY),
  },
  {
    id: "reds",
    title: "Red brutes",
    text: "Red brutes (slow, armoured, with plasma cannons that blast the ground) have landed. Their leader (marked) carries a railgun: take it. Keep your distance.",
    objectives: [{ stat: "aliensKilled", goal: 3, label: "Aliens killed" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "squad",
    squad: { kind: "alien_red", n: 3, leaderDrop: ITEM.RAILGUN },
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 2, mothership: 0.15 }, 1, 1, 1, 5, 0.035, ALL_CREWS),
  },
  {
    id: "salvage",
    title: "Salvage",
    text: "The next UFO you shoot down will come down in one piece. Board it (walk up, press F): alien ships are yours to fly from now on, the ones hidden in airport hangars too.",
    objectives: [{ stat: "ufosBoarded", goal: 1, label: "UFOs boarded" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "intact",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 2, mothership: 0.15 }, 1, 1, 1, 5, 0.035, ALL_CREWS),
  },
  {
    id: "big_game",
    title: "Big game",
    text: "The big ships are coming. Bring down a large UFO (missiles, the bazooka's lock-on, the railgun or an airstrike help).",
    objectives: [{ stat: "ufosDownLarge", goal: 1, label: "Large UFOs shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 4]],
    event: "large",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 3, mothership: 0.3, giant: 0.03 }, 1, 1, 1.05, 5, 0.04, ALL_CREWS),
  },
  {
    id: "mothership",
    title: "Mothership",
    text: "A mothership has arrived, with an escort. Destroy it: railgun beams, missile salvos (hold the lock), your own UFO's weapons and the nuke hit hardest.",
    objectives: [{ stat: "ufosDownBig", goal: 1, label: "Mothership destroyed" }],
    reward: [[ITEM.GOLDEN_APPLE, 6]],
    event: "mothership",
    tier: 5,
    rules: R({ small: 2.5, medium: 4, large: 3, mothership: 0.5, giant: 0.08 }, 1.05, 1.05, 1.1, 6, 0.045, ALL_CREWS),
  },
  {
    id: "sunburn",
    title: "Operation Sunburn",
    text: "The aliens have taken an airport and turned it into a base (marked). Fly there and drop your nuke on it (B in the jet). Fighters and UFOs guard it.",
    objectives: [{ stat: "airportsNuked", goal: 1, label: "Enemy base nuked" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "airport",
    tier: 5,
    rules: R(LATE, 1.1, 1.1, 1.2, 7, 0.05, ALL_CREWS),
  },
  {
    id: "slayer",
    title: "UFO slayer",
    text: "The invasion is broken, but they keep coming. Shoot down twenty-five more.",
    objectives: [{ stat: "ufosDown", goal: 25, label: "UFOs shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 10]],
    event: "hunt",
    tier: 5,
    rules: R(LATE, 1.15, 1.15, 1.3, 8, 0.055, ALL_CREWS),
  },
];

// The Round 3 chain (v3 saves, fifteen missions): which new mission a save
// whose current v3 mission was N continues with (the new opening missions
// are skipped for them: they already have their weapons).
const V3_STEP_TO_V4 = [0, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19];

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
    return { v: 4, step: this.step, base: this.base, done: this.done };
  }

  load(data, stats) {
    if (data && Number.isInteger(data.step) && data.step >= 0) {
      if (data.v !== 4) {
        // An older save: carry its progress over to the new chain (Round 2
        // -> Round 3 -> Round 4).
        const v3 = data.v === 3 ? data.step : OLD_STEP_TO_NEW[Math.min(data.step, OLD_STEP_TO_NEW.length - 1)];
        this.step = Math.min(MISSIONS.length, V3_STEP_TO_V4[Math.min(v3, V3_STEP_TO_V4.length - 1)]);
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

// A standard (crate) weapon not owned yet within reach of the tier: the
// earliest ones first (a pistol before a bazooka); null when there is none.
export function pickCrateWeapon(tier, owned, rand = Math.random) {
  const options = CRATE_WEAPONS.filter(([id, t]) => t <= tier && !owned.has(id));
  if (options.length === 0) return null;
  const lowest = Math.min(...options.map(([, t]) => t));
  // Mostly the lowest tier still missing, now and then one tier up.
  return pickWeighted(options.map(([id, t]) => [id, t === lowest ? 3 : 1]), rand);
}

// The alien weapon an alien of `colour` can give: the weakest one not owned
// yet, if the chain has reached its tier and this kind is strong enough.
export function pickAlienWeapon(colour, tier, owned) {
  const rank = KIND_RANK[colour] ?? 0;
  for (const [id, t, carrier] of ALIEN_WEAPONS) {
    if (owned.has(id)) continue;
    if (t > tier || KIND_RANK[carrier] > rank) return null;
    return id;
  }
  return null;
}

// (Round 3 name: any weapon of the old table; kept for callers and tests.)
export function pickWeapon(tier, owned, rand = Math.random, bonus = 0) {
  return pickCrateWeapon(tier + bonus, owned, rand);
}

export function pickTool(tier, owned, rand = Math.random) {
  const options = TOOL_TIERS.filter(([id, t]) => t <= tier && !owned.has(id));
  if (options.length === 0) return null;
  return pickWeighted(options.map(([id]) => [id, 1]), rand);
}

// What a kill or a wreck drops: [[itemId, count], ...]. kind:
// "alien" (crew, by colour: "green" | "gray" | "red"), "ufo" (by size name),
// "enemyjet", "crate", "skeleton". `owned`: a Set of item ids the player
// already has.
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
    case "skeleton": {
      // Its bow, if you don't have one yet.
      if (!have.has(ITEM.BOW)) add(ITEM.BOW, 1);
      break;
    }
    case "alien": {
      // Alien weapons, weakest first, once the chain gets there (a mission's
      // patrol leader always drops the new one: see missions.js).
      const w = pickAlienWeapon(detail, tier, have);
      const wChance = { green: 0.2, gray: 0.25, red: 0.35 }[detail] ?? 0.2;
      if (w != null && rand() < wChance) {
        add(w, 1);
        break;
      }
      const chance = { green: 0.28, gray: 0.42, red: 0.65 }[detail] ?? 0.3;
      if (rand() > chance + tier * 0.03) break;
      const r = rand();
      if (r < 0.55) add(food(), 1 + Math.floor(rand() * 2));
      else if (r < 0.65 + (detail === "red" ? 0.2 : 0.05) && (tier >= 2 || detail === "red")) add(ITEM.GOLDEN_APPLE, 1);
      else add(pickTool(tier + (detail === "red" ? 1 : 0), have, rand) ?? food(), 1);
      break;
    }
    case "ufo": {
      // Wrecks: golden apples, tools, food (no weapons).
      const n = { small: 1, medium: 1, large: 2, mothership: 4, giant: 6 }[detail] ?? 1;
      const bonus = detail === "mothership" || detail === "giant" ? 2 : detail === "large" ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const r = rand();
        if (r < 0.4) add(ITEM.GOLDEN_APPLE, 1);
        else if (r < 0.65) add(pickTool(tier + bonus, have, rand) ?? food(), 1);
        else add(food(), 2);
      }
      break;
    }
    case "enemyjet": {
      add(ITEM.GOLDEN_APPLE, 1 + Math.floor(rand() * 2));
      add(food(), 2);
      break;
    }
    case "crate": {
      // A standard weapon (always, if one is left), golden apples, sometimes a tool.
      const w = pickCrateWeapon(tier, have, rand);
      if (w != null) add(w, 1);
      add(ITEM.GOLDEN_APPLE, 1 + Math.floor(rand() * (1 + Math.min(2, tier))));
      if (rand() < 0.5) add(pickTool(tier + 1, have, rand), 1);
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
