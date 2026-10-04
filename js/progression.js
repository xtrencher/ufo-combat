// Survival progression: the mission chain, the loot tables and the
// difficulty curve. Pure logic (no DOM, no three.js); main.js wires it to the
// game (rewards, toasts, the mission tracker, drops).
//
// A new Survival game starts with basic gear (a stone sword, a stone pickaxe,
// apples). Weapons come from four places, each in its own lane:
//   - skeletons: the bow;
//   - supply crates: standard weapons (pistol, grenades, machine gun,
//     sniper rifle, bazooka, airstrike designator), by tier;
//   - aliens: alien weapons, weakest to strongest (laser blaster, laser
//     minigun, railgun), only once the chain gets that far;
//   - missions: apples and golden apples only (no weapons).
// UFO wrecks and patrol fighters drop food, golden apples and tools.
import { ITEM, armorId } from "./items.js";

// ---------- Weapons by source and tier ----------

// Standard weapons in supply crates: [id, the tier it appears at].
export const CRATE_WEAPONS = [
  [ITEM.PISTOL, 0],
  [ITEM.GRENADE, 1],
  [ITEM.MACHINE_GUN, 1],
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
const KIND_RANK = { green: 0, gray: 1, blue: 1, red: 2 };

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
// A chain of twenty-eight missions with a steady difficulty curve. It starts
// on foot with a sword: a skeleton (its bow), a UFO that lands and lets its
// crew out (they give you a moment before they attack), the first supply
// crate (a pistol), a first scout to shoot down and its crew, a night; then
// alien patrols whose leaders carry the alien weapons (blaster, minigun,
// railgun), the jets, dogfights, a village raid, and only late in the chain
// the alien ships themselves (Salvage), big ships, nuking the base, stealing
// a ship and the Overlord. (Round 9) Then the aliens' counterattack: a wing
// of hijacked fighters, abductors over a village, a titan, a night of
// swarms, a fortress on the ground, and the finale: the Armada and its
// flagship, after which the war is won (a victory screen) and the sky stays
// busy for free play.
//
// Each mission sets the rules for the sky while it is the current one
// (`rules`): which UFO sizes appear and how often, multipliers for their
// health, damage and aggression, how many at most are in the sky at once
// (day; more at night) and how often a new one turns up, and which alien
// kinds crew them. So there are no UFOs at all for the first two missions,
// then a single one, and more as the chain goes on.
//
// objectives: [{ stat, goal, label, scale }] measured from the moment the
// mission starts (stat counters are the world's; see stats.js). Online the
// goals grow with the group (Round 8; anyone's deeds count for everyone):
// scale "player": goal x players (a skeleton with a bow, a crate, a squad's
// share of aliens for each player: 2 kills for 1 player, 4 for 2, 6 for 3);
// "group": goal x (1 + 0.5 per extra player), rounded up (UFO counts: more
// players shoot them down faster); none: the same for any group (a night, a
// landing, the base, the boss). reward: apples.
// event: what the mission director (missions.js) sets up for it.
// tier: the loot tier while it is the current mission (0-5).
// squad: an alien patrol for the "squad" event: { kind, n, leaderDrop }.

const R = (sizes, health, damage, aggression, max, rate, crew = { alien: 1 }) => ({ sizes, health, damage, aggression, max, rate, crew });
const EARLY = { small: 1 };
const LATE = { small: 2.5, medium: 4, large: 3, mothership: 0.7, giant: 0.18 };
const GREEN = { alien: 1 };
const GREEN_GRAY = { alien: 2, alien_gray: 1 };
const GREEN_GRAY_BLUE = { alien: 2, alien_gray: 1, alien_blue: 1 };
const ALL_CREWS = { alien: 3, alien_gray: 2, alien_red: 1, alien_blue: 1.5 };

export const MISSIONS = [
  {
    id: "skeleton",
    title: "The archer",
    text: "A skeleton is prowling nearby (follow the marker). Kill it with your sword and take its bow: hold right click to draw, let go to shoot.",
    objectives: [{ stat: "skeletonsKilled", goal: 1, label: "Skeletons killed", scale: "player" }],
    reward: [[ITEM.APPLE, 3]],
    event: "skeleton",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0, 0, 0),
  },
  {
    id: "landing",
    title: "Visitors",
    text: "A small UFO is landing nearby. Its crew will look around for a moment, then come for you: be ready with your bow (and your sword: they go down in melee too).",
    objectives: [{ stat: "aliensKilled", goal: 2, label: "Aliens killed", scale: "player" }],
    reward: [[ITEM.APPLE, 4]],
    event: "landing",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0, 0, 0, GREEN),
  },
  {
    id: "supply",
    title: "Supply drop",
    text: "Friends on the ground have dropped supplies for you: a pistol. Follow the orange smoke and open the crate. (R reloads.)",
    objectives: [{ stat: "cratesOpened", goal: 1, label: "Supply crates opened", scale: "player" }],
    reward: [[ITEM.APPLE, 3]],
    event: "crate",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.3, 1, 0.012, GREEN),
  },
  {
    id: "first_contact",
    title: "First contact",
    text: "A scout UFO is snooping around nearby. Find it (follow the marker) and shoot it down with your pistol or your bow.",
    objectives: [{ stat: "ufosDown", goal: 1, label: "Scouts shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 1]],
    event: "scout",
    tier: 0,
    rules: R(EARLY, 0.6, 0.5, 0.4, 1, 0.012, GREEN),
  },
  {
    id: "crew",
    title: "The crew",
    text: "Aliens climbed out of the wreck, and they are armed. Kill them before they get you.",
    objectives: [{ stat: "aliensKilled", goal: 2, label: "Aliens killed", scale: "player" }],
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
    objectives: [{ stat: "aliensKilled", goal: 4, label: "Aliens killed", scale: "player" }],
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
    objectives: [{ stat: "ufosDown", goal: 3, label: "UFOs shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "hunt",
    tier: 2,
    rules: R({ small: 4, medium: 3 }, 0.75, 0.7, 0.75, 2, 0.025, GREEN),
  },
  {
    id: "grays",
    title: "Gray squad",
    text: "A squad of grays (fast sharpshooters with burst rifles) has landed. Their leader (marked) carries a laser minigun: take it. Keep moving.",
    objectives: [{ stat: "aliensKilled", goal: 5, label: "Aliens killed", scale: "player" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "squad",
    squad: { kind: "alien_gray", n: 5, leaderDrop: ITEM.MINIGUN },
    tier: 3,
    rules: R({ small: 3, medium: 3, large: 0.3 }, 0.8, 0.75, 0.8, 2, 0.025, GREEN_GRAY),
  },
  {
    id: "wings",
    title: "Take to the air",
    text: "Fighter jets wait at airports (F3 shows the nearest, and the marker points the way). Walk up to one, get in (F) and take off: full throttle (W), Shift for the afterburner.",
    objectives: [{ stat: "takeoffs", goal: 1, label: "Takeoffs", scale: "player" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "takeoff",
    tier: 3,
    rules: R({ small: 3, medium: 3, large: 0.5 }, 0.85, 0.8, 0.8, 2, 0.025, GREEN_GRAY),
  },
  {
    id: "touchdown",
    title: "Touchdown",
    text: "Bring a jet back down: land it on an airport's runway (F3 shows the nearest airport; line up with the runway, throttle down to about 30%, hold Space for the air brakes and the wheel brakes) and stop. The aliens will not let you rest: a red squad drops in on the ground. Get out (F) and finish them.",
    objectives: [
      { stat: "landings", goal: 1, label: "Jet landed on a runway" },
      { stat: "landingSquad", goal: 3, label: "Red aliens killed", scale: "player" },
    ],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "landjet",
    tier: 3,
    rules: R({ small: 3, medium: 3, large: 0.5 }, 0.87, 0.82, 0.82, 2, 0.026, GREEN_GRAY),
  },
  {
    id: "dogfight",
    title: "Dogfight",
    text: "Shoot down two UFOs from your jet: the cannon (left click), a missile (a click fires one straight ahead) or a missile lock (hold right click, release when LOCKED).",
    objectives: [{ stat: "ufosDownByJet", goal: 2, label: "UFOs shot down from the jet", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "dogfight",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1 }, 0.9, 0.85, 0.85, 3, 0.03, GREEN_GRAY),
  },
  {
    id: "air_superiority",
    title: "Air superiority",
    text: "The aliens have hijacked one of our fighters, and it is hunting you. Shoot it down: flares (C) fool its missiles, hard turns make them miss.",
    objectives: [{ stat: "enemyJetsDown", goal: 1, label: "Hijacked fighters shot down", scale: "player" }],
    reward: [[ITEM.GOLDEN_APPLE, 2]],
    event: "fighter",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.2, mothership: 0.05 }, 0.9, 0.9, 0.9, 3, 0.03, GREEN_GRAY_BLUE),
  },
  {
    id: "village",
    title: "Village under attack",
    text: "Raiders are burning a village. Get there (follow the marker) and shoot down the three raiders before they finish the job.",
    objectives: [{ stat: "raidersDown", goal: 3, label: "Raiders shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "village",
    tier: 3,
    rules: R({ small: 3, medium: 4, large: 1.5, mothership: 0.1 }, 0.95, 0.95, 0.95, 3, 0.03, GREEN_GRAY_BLUE),
  },
  {
    id: "reds",
    title: "Red brutes",
    text: "Red brutes (slow, armoured, with plasma cannons that blast the ground) have landed. Their leader (marked) carries a railgun: take it. Keep your distance.",
    objectives: [{ stat: "aliensKilled", goal: 3, label: "Aliens killed", scale: "player" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "squad",
    squad: { kind: "alien_red", n: 3, leaderDrop: ITEM.RAILGUN },
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 2, mothership: 0.15 }, 1, 1, 1, 3, 0.035, ALL_CREWS),
  },
  {
    id: "meteors",
    title: "Falling stars",
    text: "A meteor storm is falling out of the night sky. Every rock is announced by a red ring on the ground: keep out of it. The craters leave glowing star fragments (marked): collect four before the alien salvagers carry them off.",
    objectives: [{ stat: "meteorFragments", goal: 4, label: "Star fragments collected", scale: "player" }],
    reward: [[ITEM.GOLDEN_APPLE, 4]],
    event: "meteors",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 2, mothership: 0.15 }, 1, 1, 1, 3, 0.035, ALL_CREWS),
  },
  {
    id: "salvage",
    title: "Salvage",
    text: "The next UFO you shoot down will come down in one piece. Board it (walk up, press F): alien ships are yours to fly from now on, the ones kept in the guarded bunkers of airports too.",
    objectives: [{ stat: "ufosBoarded", goal: 1, label: "UFOs boarded" }],
    reward: [[ITEM.GOLDEN_APPLE, 3]],
    event: "intact",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 2, mothership: 0.15 }, 1, 1, 1, 4, 0.035, ALL_CREWS),
  },
  {
    id: "big_game",
    title: "Big game",
    text: "The big ships are coming. Bring down a large UFO (missiles, the bazooka's lock-on, the railgun or an airstrike help).",
    objectives: [{ stat: "ufosDownLarge", goal: 1, label: "Large UFOs shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 4]],
    event: "large",
    tier: 4,
    rules: R({ small: 2.5, medium: 4, large: 3, mothership: 0.3, giant: 0.03 }, 1, 1, 1.05, 4, 0.04, ALL_CREWS),
  },
  {
    id: "sunburn",
    title: "Operation Sunburn",
    text: "The aliens have taken a far-off airport and turned it into a base. Take the B-2 bomber standing at your airport (marked), fly to the base and drop the nuke on it (B). Fighters and UFOs guard it: online, the others escort the bomber in the fighters.",
    objectives: [{ stat: "airportsNuked", goal: 1, label: "Enemy base nuked" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "airport",
    tier: 5,
    rules: R(LATE, 1.1, 1.1, 1.2, 5, 0.05, ALL_CREWS),
  },
  {
    id: "steal",
    title: "Steal the ship",
    text: "Soldiers keep a captured alien ship in the underground bunker of a far-off airport (marked). Fight your way down the ramp past the armed guards and board the ship (F). Once you are aboard they seal the blast doors: switch on ghost mode (G) and burn your way out through the rock, then get clear of the base.",
    objectives: [{ stat: "shipsStolen", goal: 1, label: "Alien ship stolen" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "steal",
    tier: 5,
    rules: R(LATE, 1.1, 1.1, 1.2, 5, 0.05, ALL_CREWS),
  },
  {
    id: "overlord",
    title: "The Overlord",
    text: "The invasion's flagship has come for you: the Overlord, a mothership with a shield. Its pylons (marked) hold the shield up: shoot them down, then hit the hull with everything you have (the railgun is made for this) before the shield comes back. Four shields, an escort, and a squad that drops in: you can do it on foot.",
    objectives: [{ stat: "bossesDown", goal: 1, label: "The Overlord destroyed" }],
    reward: [[ITEM.GOLDEN_APPLE, 12]],
    event: "boss",
    tier: 5,
    rules: R(LATE, 1.12, 1.12, 1.25, 5, 0.05, ALL_CREWS),
  },
  {
    id: "slayer",
    title: "UFO slayer",
    text: "The Overlord is down, but they keep coming while their fleet regroups. Shoot down twenty-five more.",
    objectives: [{ stat: "ufosDown", goal: 25, label: "UFOs shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 10]],
    event: "hunt",
    tier: 5,
    rules: R(LATE, 1.15, 1.15, 1.3, 6, 0.055, ALL_CREWS),
  },
  // ---------- (Round 9) The counterattack ----------
  {
    id: "scramble",
    title: "Scramble!",
    text: "The aliens are throwing hijacked fighters at you in force: a whole wing is inbound (marked). Shoot down three of them: take a fighter from the airport, or lock on with the bazooka from the ground.",
    objectives: [{ stat: "enemyJetsDown", goal: 3, label: "Hijacked fighters shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 6]],
    event: "airraid",
    tier: 5,
    rules: R(LATE, 1.15, 1.15, 1.3, 6, 0.05, ALL_CREWS),
  },
  {
    id: "abductors",
    title: "Abductions",
    text: "Abductor UFOs are beaming up the villagers and animals of a village (marked). Get there and shoot down three abductors before they empty the place.",
    objectives: [{ stat: "abductorsDown", goal: 3, label: "Abductors shot down", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 6]],
    event: "abduct",
    tier: 5,
    rules: R(LATE, 1.16, 1.16, 1.3, 6, 0.05, ALL_CREWS),
  },
  {
    id: "titan",
    title: "Titan",
    text: "A titan, the biggest alien ship of all (well over a hundred blocks across), is on its way (marked). Bring it down with everything you have: the railgun, missile salvos, the airstrike, the B-2's nuke. Its crew comes out fighting.",
    objectives: [{ stat: "titansDown", goal: 1, label: "Titans shot down" }],
    reward: [[ITEM.GOLDEN_APPLE, 10]],
    event: "giant",
    tier: 5,
    rules: R({ small: 2.5, medium: 3.5, large: 2, mothership: 0.25 }, 1.17, 1.17, 1.32, 6, 0.05, ALL_CREWS),
  },
  {
    id: "swarm",
    title: "Night of the swarm",
    text: "Tonight they come in swarms: small, fast UFOs fill the sky while landing parties hunt you on the ground. Survive until dawn (online: the night starts over only if the whole group falls) and shoot down eight of them.",
    objectives: [
      { stat: "nightsSurvived", goal: 1, label: "Nights survived" },
      { stat: "ufosDown", goal: 8, label: "UFOs shot down", scale: "group" },
    ],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "swarm",
    tier: 5,
    rules: R({ small: 7, medium: 2.5, large: 0.6 }, 1.18, 1.18, 1.35, 6, 0.07, ALL_CREWS),
  },
  {
    id: "fortress",
    title: "The fortress",
    text: "The aliens have dug in on the ground: a fortress of red brutes, blue and gray aliens (marked), with heavy UFOs overhead. Storm it and kill ten aliens.",
    objectives: [{ stat: "aliensKilled", goal: 10, label: "Aliens killed", scale: "group" }],
    reward: [[ITEM.GOLDEN_APPLE, 8]],
    event: "fortress",
    tier: 5,
    rules: R(LATE, 1.19, 1.19, 1.38, 6, 0.055, ALL_CREWS),
  },
  {
    id: "armada",
    title: "The Armada",
    text: "The final battle. The invasion's last fleet has arrived with its flagship, the Dreadnought: a titan behind five shields, each held up by pylons (marked), with escorts, hijacked fighters and squads dropping in. Bring it down and the war is won.",
    objectives: [{ stat: "flagshipDown", goal: 1, label: "The Dreadnought destroyed" }],
    reward: [[ITEM.GOLDEN_APPLE, 20]],
    event: "boss",
    // (The boss fight's settings: see missions.js _boss; the Overlord's are the defaults.)
    boss: { name: "THE DREADNOUGHT", short: "The Dreadnought", size: "giant", design: "saucer_domed", health: 8000, shieldAt: [0.75, 0.5, 0.3, 0.12], pylons: [4, 4, 5, 5, 5], escorts: [3, 2, 3, 2, 0], squads: { 1: "alien_red", 3: "alien_blue" }, jets: { 2: 1 }, stat: "flagshipDown", final: true },
    tier: 5,
    rules: R(LATE, 1.2, 1.2, 1.4, 6, 0.05, ALL_CREWS),
  },
];

// After the last mission (free play): a busy sky, a little calmer than the finale's.
const POSTGAME_RULES = R(LATE, 1.15, 1.15, 1.3, 6, 0.055, ALL_CREWS);

// The Round 3 chain (v3 saves, fifteen missions): which new mission a save
// whose current v3 mission was N continues with (the new opening missions
// are skipped for them: they already have their weapons).
// The Round 4/5 chain (v4 saves, nineteen missions): ids by step. Round 6 added the
// landing, the meteor storm and the boss (and moved the mothership fight to the end).
const V4_IDS = ["skeleton", "landing", "supply", "first_contact", "crew", "long_night", "patrol", "scout_hunter", "grays", "wings", "dogfight", "air_superiority", "village", "reds", "salvage", "big_game", "mothership", "sunburn", "slayer"];
// (Round 9: a save that had finished the chain carries on with the missions added since.)
const AFTER_SLAYER = () => MISSIONS.findIndex((m) => m.id === "slayer") + 1;
function v4StepToV5(step) {
  if (!(step < V4_IDS.length)) return AFTER_SLAYER();
  const idx = MISSIONS.findIndex((m) => m.id === V4_IDS[step]);
  // (The old mothership mission is the Overlord's forerunner: that player carries on with the base.)
  return idx >= 0 ? idx : MISSIONS.findIndex((m) => m.id === "sunburn");
}
// The Round 6-7 chain (v5 saves): ids by step. Round 8 added "Steal the ship" before the Overlord.
const V5_IDS = ["skeleton", "landing", "supply", "first_contact", "crew", "long_night", "patrol", "scout_hunter", "grays", "wings", "touchdown", "dogfight", "air_superiority", "village", "reds", "meteors", "salvage", "big_game", "sunburn", "overlord", "slayer"];
function v5StepToV6(step) {
  if (!(step < V5_IDS.length)) return AFTER_SLAYER();
  const idx = MISSIONS.findIndex((m) => m.id === V5_IDS[step]);
  return idx >= 0 ? idx : step;
}
const V3_STEP_TO_V4 = [0, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19];

// The old seven-mission chain (Round 2 saves): how many new missions a save
// that had finished N old ones counts as finished.
const OLD_STEP_TO_NEW = [0, 2, 5, 8, 9, 10, 12, 13];

export class Progress {
  constructor() {
    this.step = 0; // index of the current mission (MISSIONS.length: all done)
    this.base = {}; // the stat values when the current mission started
    this.done = []; // ids of finished missions
    this.place = null; // (the current mission's chosen place, if it has one: saved, so a reload keeps it; see missions.js)
    this.onComplete = null; // (mission) => void
    this.onChange = null; // () => void
    this.onStart = null; // (mission) => void: a mission became the current one
    this.enabled = true;
    // Online (host): how many players the goals are for (see goalFor).
    this.groupN = 1;
  }

  // An objective's goal for the current group (see the objectives' "scale").
  goalFor(o, n = this.groupN) {
    n = Math.max(1, Math.min(8, n | 0));
    if (o.scale === "player") return o.goal * n;
    if (o.scale === "group") return Math.ceil(o.goal * (1 + 0.5 * (n - 1)));
    return o.goal;
  }

  get mission() {
    return MISSIONS[this.step] || null;
  }

  // Missions finished, 0-MISSIONS.length.
  get completed() {
    return Math.min(this.step, MISSIONS.length);
  }

  // The rules for the sky right now (see MISSIONS); once the chain is done,
  // free play's (POSTGAME_RULES).
  get rules() {
    return this.mission ? this.mission.rules : POSTGAME_RULES;
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
    if (this.mirror && this.mirrorObjectives) return this.mirrorObjectives;
    return m.objectives.map((o) => {
      const goal = this.goalFor(o);
      return { label: o.label, goal, value: Math.max(0, Math.min(goal, Math.floor((stats[o.stat] ?? 0) - (this.base[o.stat] ?? 0)))) };
    });
  }

  // Every mission with its state, for the list in the pause menu:
  // [{ n, id, title, text, reward, state: "done" | "current" | "locked", objectives }].
  list(stats) {
    return MISSIONS.map((m, i) => ({ n: i + 1, id: m.id, title: m.title, text: m.text, reward: m.reward, state: i < this.step ? "done" : i === this.step ? "current" : "locked", objectives: i === this.step ? this.objectives(stats) : null }));
  }

  // Checks the current mission; completes it (and moves on) when every
  // objective is met. Returns the finished mission or null.
  update(stats) {
    // (Online a guest's chain is the host's: see js/net/coop.js.)
    if (!this.enabled || this.mirror) return null;
    const m = this.mission;
    if (!m) return null;
    if (!this.objectives(stats).every((o) => o.value >= o.goal)) return null;
    // (Round 8: a mission can hold on a moment, e.g. while a leader's weapon still lies there to pick up.)
    if (this.hold?.()) return null;
    this.done.push(m.id);
    this.step++;
    this.place = null;
    // The next mission starts counting from now.
    this.base = { ...this._pick(stats) };
    if (this.onComplete) this.onComplete(m);
    if (this.onChange) this.onChange();
    if (this.mission && this.onStart) this.onStart(this.mission);
    return m;
  }

  serialize() {
    return { v: 6, step: this.step, base: this.base, done: this.done, ...(this.place ? { place: this.place } : {}) };
  }

  load(data, stats) {
    if (data && Number.isInteger(data.step) && data.step >= 0) {
      if (data.v === 5) {
        // A Round 6-7 save: the same missions, one new one before the Overlord
        // (a save already past it carries on where it was).
        const step = Math.min(MISSIONS.length, v5StepToV6(data.step));
        this.base = data.base && typeof data.base === "object" ? { ...data.base } : {};
        this.step = step;
        this.done = MISSIONS.slice(0, step).map((m) => m.id);
        for (const [k, v] of Object.entries(this._pick(stats))) if (!Number.isFinite(this.base[k])) this.base[k] = v;
        // (A finished chain goes on at Scramble: its counts start now, not at Slayer.)
        if (data.step >= V5_IDS.length) this.base = { ...this._pick(stats) };
        return;
      }
      if (data.v !== 6) {
        // An older save: carry its progress over to the new chain (Round 2
        // -> Round 3 -> Round 4 -> Round 6).
        let v4step;
        if (data.v === 4) v4step = data.step;
        else {
          const v3 = data.v === 3 ? data.step : OLD_STEP_TO_NEW[Math.min(data.step, OLD_STEP_TO_NEW.length - 1)];
          v4step = V3_STEP_TO_V4[Math.min(v3, V3_STEP_TO_V4.length - 1)];
        }
        this.step = Math.min(MISSIONS.length, v4StepToV5(v4step));
        this.done = MISSIONS.slice(0, this.step).map((m) => m.id);
        this.base = { ...this._pick(stats) };
        return;
      }
      this.step = Math.min(data.step, MISSIONS.length);
      this.base = data.base && typeof data.base === "object" ? { ...data.base } : {};
      this.done = Array.isArray(data.done) ? data.done.filter((x) => typeof x === "string") : [];
      this.place = data.place && typeof data.place === "object" ? { ...data.place } : null;
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
      const wChance = { green: 0.32, gray: 0.38, blue: 0.38, red: 0.5 }[detail] ?? 0.3;
      if (w != null && rand() < wChance) {
        add(w, 1);
        break;
      }
      const chance = { green: 0.28, gray: 0.42, blue: 0.42, red: 0.65 }[detail] ?? 0.3;
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

// ---------- Armor drops ----------
// Creatures sometimes drop a piece of armor: how often, and of which
// material (leather, gold, iron, diamond: tiers 0-3), depends on the creature
// and on how far the mission chain is (`tier` 0-5), so there is leather at
// the start and diamond only late (and rarely).
const ARMOR_CHANCE = { zombie: 0.045, skeleton: 0.06, guard: 0.35, green: 0.07, gray: 0.09, blue: 0.09, red: 0.14 };
const ARMOR_BY_TIER = [
  [1, 0, 0, 0],
  [0.7, 0.3, 0, 0],
  [0.4, 0.3, 0.3, 0],
  [0.2, 0.25, 0.45, 0.1],
  [0.1, 0.2, 0.45, 0.25],
  [0, 0.15, 0.45, 0.4],
];
// Which creature's armor tends toward which material: a shift of the tier, toward the better ones.
const ARMOR_SHIFT = { zombie: -1, skeleton: -1, guard: 1, green: 0, gray: 1, blue: 1, red: 2 };

// What `who` ("zombie", "skeleton", "guard", "green", "gray", "blue", "red")
// drops on dying: [[itemId, 1]] or []. `worn`: a Set of the armor ids worn
// (a piece for a free slot is likelier).
export function rollArmorDrop(who, tier, worn = new Set(), rand = Math.random) {
  if (rand() >= (ARMOR_CHANCE[who] ?? 0)) return [];
  // (A better creature drops like a later stage of the chain: never a
  // material the table hasn't reached by then.)
  const shift = ARMOR_SHIFT[who] ?? 0;
  const w = ARMOR_BY_TIER[Math.max(0, Math.min(ARMOR_BY_TIER.length - 1, tier + shift))];
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let r = rand() * total;
  let t = 0;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) {
      t = i;
      break;
    }
  }
  // A piece for a slot not yet covered by this material, if possible.
  const slots = [0, 1, 2, 3].filter((sl) => !worn.has(armorId(t, sl)));
  const pool = slots.length ? slots : [0, 1, 2, 3];
  return [[armorId(t, pool[Math.floor(rand() * pool.length)]), 1]];
}

// The alien kind's colour: "green" | "gray" | "blue" | "red".
export function alienColour(kind) {
  return kind === "alien_red" ? "red" : kind === "alien_gray" ? "gray" : kind === "alien_blue" ? "blue" : "green";
}
