// (Round 16) The mission board's catalog: which missions are on the board,
// in which category and difficulty tier, what vehicle each one gives you,
// how long it may take, and what it pays. Pure data and small helpers (no
// DOM, no three.js): js/mission-board.js plays it, js/missions.js (the
// director) sets each mission up in the world.
//
// The board replaces Round 10's classified campaign (a fixed run of 27-31
// missions, one after another, that you could not choose from). Now:
//   - every mission sits in a category (Infantry, Ground, Air, Helicopter,
//     UFO war, Defense) and a tier (Recruit, Veteran, Elite);
//   - Recruit missions are open from the start; a category's Veteran ones
//     open when you win one of its Recruit missions, its Elite ones when you
//     win one of its Veteran missions (the finale wants the Overlord down);
//   - the tier sets the sky (how many and how tough the UFOs are), the loot
//     and the reward, so a mission plays the same whenever you pick it;
//   - a mission gives you the vehicle it needs (a tank, a jet, a
//     helicopter, an AA vehicle) near you, and winning it unlocks that kind
//     of vehicle for free play;
//   - every mission has a time limit (and some their own ways to fail: a
//     convoy lost, a base overrun); a failed one can be retried at once.
//
// Missions left off the board (from the Round 10 pool): "The crew" (it only
// worked straight after First contact), "UFO slayer" (twenty-five UFOs: a
// grind, no new play), "Take to the air" (with the jet handed to you it was
// over in five seconds; Touchdown teaches flying and landing instead) and
// "Falling stars" (a time-lapse to the night, then a fetch round: the
// board keeps one night mission per tier instead; see PROGRESS.md, Round 16
// audit). They are still in the pool (old runs, the tests), just not on the
// board.
import { ITEM } from "./items.js";
import * as ID from "./content/ids.js";
import { registerMission, curveAt } from "./progression.js";
import { STAT_LABELS } from "./stats.js";

// ---------- The new missions (Round 16) ----------

// Their stats (stats.js keeps every stat listed in STAT_LABELS).
for (const e of [
  ["trucksDelivered", "Trucks escorted home (mission)"],
  ["raidDown", "Air raiders shot down (mission)"],
  ["attackersDown", "Airport attackers destroyed (mission)"],
]) if (!STAT_LABELS.some(([k]) => k === e[0])) STAT_LABELS.push(e);

const R = (sizes, health, damage, aggression, max, rate, crew = { alien: 1 }) => ({ sizes, health, damage, aggression, max, rate, crew });
const MID_SKY = R({ small: 3, medium: 3, large: 0.5 }, 0.85, 0.8, 0.8, 2, 0.02, { alien: 2, alien_gray: 1 });

registerMission({
  id: "escort",
  title: "Convoy escort",
  text: "Three of our supply trucks have to get through to the base (marked). Escort them in the tank waiting for you: hijacked tanks lie in ambush along the road and go for the trucks first. The trucks wait for you if you fall behind. Lose too many and the mission fails.",
  objectives: [{ stat: "trucksDelivered", goal: 2, label: "Trucks delivered" }],
  event: "escort",
  act: [3, 4], optional: true,
  twists: { 1: "An enemy gunship joins the ambush.", 2: "A longer road, three ambushes.", 3: "Heavy Tigers lie in wait." },
  tier: 3,
  rules: MID_SKY,
  sky: { max: 1, rate: 0.01 },
});

registerMission({
  id: "air_raid",
  title: "Air raid",
  text: "An alien air raid is coming in on this position. Man the AA vehicle (marked: F to get in, the mouse aims, left click fires the guns) and shoot the raiders down before they wreck the place. Every raider over the position wears it down: if it falls, the mission fails.",
  objectives: [{ stat: "raidDown", goal: 6, goals: [6, 6, 8, 5], label: "Raiders shot down", scale: "group" }],
  event: "aaraid",
  act: [3, 4], optional: true,
  twists: { 1: "The second wave brings a hijacked fighter.", 2: "More of them, in bigger waves.", 3: "Fewer raiders, but tougher ships." },
  tier: 3,
  rules: MID_SKY,
  sky: { max: 1, rate: 0.008 },
});

registerMission({
  id: "airport_defense",
  title: "Airport defense",
  text: "The aliens are throwing everything at our airport (marked): tank columns on the ground, gunships and UFOs in the air. Hold it: an attack helicopter and an AA vehicle wait for you there. Every attacker that reaches the airport wears it down: if it falls, the mission fails.",
  objectives: [{ stat: "attackersDown", goal: 8, goals: [8, 8, 10, 7], label: "Attackers destroyed", scale: "group" }],
  event: "apdefense",
  act: [3, 4], optional: true,
  twists: { 1: "Their gunships come in pairs.", 2: "The columns are led by Tigers.", 3: "A large UFO leads the last wave." },
  tier: 4,
  rules: MID_SKY,
  sky: { max: 1, rate: 0.008 },
});

// ---------- Categories and tiers ----------

export const CATEGORIES = [
  { id: "foot", name: "Infantry", blurb: "On foot: your weapons come from these (the bow, the pistol, the alien guns)." },
  { id: "ground", name: "Ground war", blurb: "Tanks: you get one. Tank battles, convoys, a base to take back." },
  { id: "air", name: "Air", blurb: "Fighter jets: one is called in for you. Dogfights, strikes, the B-2." },
  { id: "heli", name: "Helicopter", blurb: "Attack and transport helicopters: one waits for you." },
  { id: "ufo", name: "UFO war", blurb: "Bring their ships down, stop the abductions, face the Overlord." },
  { id: "defense", name: "Defense", blurb: "Hold out: air raids, an airport under attack, nights under siege." },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const TIERS = [null, { name: "Recruit", stars: 1 }, { name: "Veteran", stars: 2 }, { name: "Elite", stars: 3 }];
// What each tier plays like (the place in the classic 28-mission curve: its
// sky, its loot tier), and its time limit by default (seconds).
const TIER_PLACE = [0, 6, 14, 22];
const TIER_LIMIT = [0, 600, 720, 900];

const A = ITEM.APPLE;
const G = ITEM.GOLDEN_APPLE;
// Rewards by tier (the first win; a repeat pays the first line only). Food
// and golden apples keep you fighting; iron, diamonds and emeralds are what
// the vanilla world's crafting, enchanting and trading need.
const TIER_REWARD = [
  null,
  [[G, 1], [ID.BREAD, 4], [ID.IRON_INGOT, 4]],
  [[G, 3], [ID.COOKED_BEEF, 6], [ID.DIAMOND, 2]],
  [[G, 6], [ID.COOKED_BEEF, 8], [ID.DIAMOND, 5], [ID.EMERALD, 4]],
];

// The vehicles a win unlocks for free play (Missions world, outside Creative).
export const VEHICLE_NAMES = { tank: "tanks", jet: "fighter jets", heli: "helicopters", ufo: "alien ships", b2: "the B-2 bomber" };

// The board. id: the mission (progression.js MISSIONS, or registered above);
// cat, tier; vehicle: what it gives you (and unlocks); limit: seconds (a
// tier's default otherwise); loot: its loot tier when the leader's weapon
// needs it (see progression.js ALIEN_WEAPONS); needs: ids to win first;
// bonus: golden apples on top.
export const BOARD = [
  // Infantry
  { id: "skeleton", cat: "foot", tier: 1, limit: 420, brief: "Kill a skeleton and take its bow." },
  { id: "supply", cat: "foot", tier: 1, limit: 420, brief: "Reach the supply crate: a pistol inside." },
  { id: "landing", cat: "foot", tier: 1, brief: "A UFO lands its crew: kill them." },
  { id: "first_contact", cat: "foot", tier: 1, needs: ["supply"], brief: "Shoot down a scout UFO from the ground." },
  { id: "patrol", cat: "foot", tier: 2, loot: 2, brief: "Wipe out a green patrol; its leader drops a laser blaster." },
  { id: "grays", cat: "foot", tier: 2, loot: 3, brief: "Wipe out a gray squad; its leader drops a laser minigun." },
  { id: "hold_line", cat: "foot", tier: 2, brief: "Hold the radio beacon while squads drop in." },
  { id: "crash_site", cat: "foot", tier: 2, brief: "Hold a UFO crash site, then loot the wreck." },
  { id: "reds", cat: "foot", tier: 3, loot: 4, brief: "Wipe out red brutes; their leader drops a railgun." },
  { id: "fortress", cat: "foot", tier: 3, brief: "Storm an alien fortress: kill ten." },
  // Ground war
  { id: "tank_battle", cat: "ground", tier: 1, vehicle: "tank", brief: "Tank against tanks: knock out a hijacked platoon." },
  { id: "escort", cat: "ground", tier: 2, vehicle: "tank", limit: 900, brief: "Escort three supply trucks through ambushes." },
  { id: "stop_launch", cat: "ground", tier: 2, vehicle: "jet", brief: "Destroy missile launchers before they fire." },
  { id: "base_assault", cat: "ground", tier: 3, vehicle: "tank", bonus: 2, brief: "Take back a base held by tanks, AA and launchers." },
  // Air
  { id: "touchdown", cat: "air", tier: 1, vehicle: "jet", brief: "Fly your jet to an airport and land it; then clear the squad." },
  { id: "dogfight", cat: "air", tier: 1, vehicle: "jet", brief: "Shoot down two UFOs from your jet." },
  { id: "air_superiority", cat: "air", tier: 2, vehicle: "jet", brief: "Shoot down a hijacked fighter hunting you." },
  { id: "convoy", cat: "air", tier: 2, vehicle: "jet", brief: "Destroy an enemy convoy from the air." },
  { id: "air_defense", cat: "air", tier: 2, vehicle: "jet", brief: "Take out AA vehicles guarding the area." },
  { id: "scramble", cat: "air", tier: 3, vehicle: "jet", brief: "A wing of hijacked fighters: shoot down three." },
  { id: "sunburn", cat: "air", tier: 3, vehicle: "b2", limit: 1200, bonus: 3, brief: "Fly the B-2 to the alien base and nuke it." },
  // Helicopter
  { id: "air_cav", cat: "heli", tier: 1, vehicle: "heli", brief: "Knock out a tank column from an attack helicopter." },
  { id: "medevac", cat: "heli", tier: 2, vehicle: "heli", limit: 900, brief: "Fly out to a downed crew and bring them home." },
  { id: "gunship_hunt", cat: "heli", tier: 2, vehicle: "heli", brief: "Shoot down enemy gunships." },
  // UFO war
  { id: "scout_hunter", cat: "ufo", tier: 1, needs: ["supply"], brief: "Shoot down three UFOs, any way you like." },
  { id: "village", cat: "ufo", tier: 1, needs: ["supply"], brief: "Shoot down the raiders burning a village." },
  { id: "salvage", cat: "ufo", tier: 2, vehicle: "ufo", brief: "Down a UFO in one piece and board it." },
  { id: "abductors", cat: "ufo", tier: 2, brief: "Stop the abductor UFOs emptying a village." },
  { id: "rescue", cat: "ufo", tier: 2, vehicle: "jet", brief: "Shoot down the carriers before they get away." },
  { id: "big_game", cat: "ufo", tier: 2, vehicle: "jet", bonus: 1, brief: "Bring down a large UFO." },
  { id: "sabotage", cat: "ufo", tier: 3, brief: "Destroy the signal beacons calling in UFOs." },
  { id: "steal", cat: "ufo", tier: 3, vehicle: "ufo", limit: 1200, bonus: 2, brief: "Steal an alien ship from a guarded bunker." },
  { id: "titan", cat: "ufo", tier: 3, vehicle: "jet", bonus: 3, limit: 1200, brief: "Bring down a titan." },
  { id: "overlord", cat: "ufo", tier: 3, bonus: 6, limit: 1200, brief: "Boss: the shielded Overlord mothership." },
  { id: "armada", cat: "ufo", tier: 3, bonus: 10, limit: 1500, needs: ["overlord"], brief: "The finale: the Dreadnought and its fleet." },
  // Defense
  { id: "air_raid", cat: "defense", tier: 1, vehicle: "aa", brief: "Man the AA vehicle against an air raid." },
  { id: "evac", cat: "defense", tier: 1, limit: 480, brief: "Reach the shelter before the bombardment." },
  { id: "long_night", cat: "defense", tier: 2, limit: 900, brief: "Survive a night of landing parties." },
  { id: "hunted", cat: "defense", tier: 2, brief: "Abductor ships hunt you: hold out." },
  { id: "airport_defense", cat: "defense", tier: 3, vehicle: "heli", limit: 900, bonus: 2, brief: "Hold the airport against a combined attack." },
  { id: "swarm", cat: "defense", tier: 3, limit: 1080, bonus: 1, brief: "A night of swarms: survive and shoot down eight." },
];
export const BOARD_BY_ID = new Map(BOARD.map((e) => [e.id, e]));

// The classic curve's place for a tier (its sky rules and loot tier).
export function tierCurve(tier) {
  return curveAt(TIER_PLACE[Math.max(1, Math.min(3, tier))], 28);
}

export function limitFor(e) {
  return e?.limit ?? TIER_LIMIT[e?.tier ?? 1];
}

// A board mission's reward: the tier's (a repeat: only its first line), its bonus on top.
export function rewardFor(e, repeat = false) {
  const base = TIER_REWARD[e?.tier ?? 1] || TIER_REWARD[1];
  const out = (repeat ? base.slice(0, 1) : base).map(([id, n]) => [id, n]);
  if (e?.bonus && !repeat) out[0][1] += e.bonus;
  return out;
}

// Career ranks by wins.
const RANKS = [[0, "Private"], [3, "Corporal"], [6, "Sergeant"], [10, "Lieutenant"], [15, "Captain"], [21, "Major"], [28, "Colonel"], [36, "General"]];
export function rankFor(wins) {
  let r = RANKS[0][1];
  for (const [n, name] of RANKS) if (wins >= n) r = name;
  return r;
}

// Is board mission `e` open, given the ids won? Returns null when it is, or why not.
export function lockReason(e, won) {
  if (!e) return "Unknown mission.";
  for (const n of e.needs || []) if (!won.has(n)) return `Win "${titleOf(n)}" first.`;
  if (e.tier <= 1) return null;
  const below = BOARD.filter((x) => x.cat === e.cat && x.tier === e.tier - 1);
  if (below.some((x) => won.has(x.id))) return null;
  return `Win a ${TIERS[e.tier - 1].name} ${CATEGORY_BY_ID[e.cat].name} mission first.`;
}

let titles = null;
export function setTitles(fn) {
  titles = fn;
}
function titleOf(id) {
  return titles?.(id) || id;
}
