// Damage causes (Round 9): one table for every way to get hurt, in single
// player and online alike. A cause is a short string carried with every hit
// (`player.damage(amount, cause)`, a vehicle's `damage(amount, cause)`, an
// explosion's `source`); online a player's own weapons add who it was
// ("grenade@3"), and a fall right after a blast adds "_fall".
//
// Who a cause counts for: a player's weapon (kills, loot and mission credit
// go to that player; another player's blasts follow the host's PvP rule) or
// the world and its AI (aliens, soldiers, UFOs, enemy fighters, crashes,
// meteors, the fall), which never credits anyone.
//
// The damage pipeline itself (who applies what, online): the shooter's game
// finds the hit (bullets, bolts, arrows, the rail, swords, beams, missiles,
// blasts) and hands it to the target's own damage function: mobs._hurt,
// ufos.damage, a vehicle's damage, player.damage. On the host those apply
// it, with the shooter as the attacker (kill credit). On a guest, a target
// that is the host's (its creatures, UFOs, enemy fighters) turns the hit into
// a claim to the host ("hit"), which applies it through the very same
// function with that guest as the attacker; the result (health, death,
// falling, kills) comes back in the host's snapshots and kill messages. A
// player is the judge of their own health: another player's hit goes to them
// ("pvp", the PvP rule applies), the host's AI's hits too ("dmg").

// Explosions and shots that are a player's doing.
const PLAYER_CAUSES = new Set(["grenade", "bazooka", "airstrike", "missile", "nuke", "ufocannon", "cannon", "explosion", "beam", "player", "pvp", "pk"]);

// "grenade@3_fall" -> "grenade".
export function baseCause(cause) {
  if (typeof cause !== "string") return "";
  const at = cause.indexOf("@");
  let c = at >= 0 ? cause.slice(0, at) : cause;
  if (c.endsWith("_fall")) c = c.slice(0, -5);
  return c;
}

// Whether a cause (an explosion's source, a hit's cause) is a player's weapon.
export function isPlayerCause(cause) {
  return PLAYER_CAUSES.has(baseCause(cause));
}

// The cause of a bolt that hits someone: the shooter's own (a soldier, a
// kind of alien), else by who fired it.
export function boltCause(bolt) {
  if (bolt.cause) return bolt.cause;
  const o = bolt.owner;
  if (o === "alien") return "alien";
  if (o === "enemyjet" || o === "rogue") return "enemyjet_gun";
  if (o === "ufo" || o === "decoyed") return "ufo_laser"; // (a bolt a flare turned back is still the UFO's)
  return o || "ufo_laser";
}

// What an AI creature's shot is called (mobs.js passes the shooter's kind).
export function shooterCause(kind) {
  if (kind === "guard") return "soldier";
  if (kind === "alien_gray" || kind === "alien_red" || kind === "alien_blue") return `${kind}_shot`;
  if (kind === "alien") return "alien";
  return kind || "alien";
}

// What an AI creature's blow (melee) is called: a green alien or a
// skeleton that hits you up close didn't shoot you.
export function meleeCause(kind) {
  if (kind === "alien") return "alien_melee";
  if (kind === "skeleton") return "skeleton_melee";
  return kind || "mob";
}

// What a death says. Online, another player's explosive gets their name
// ("Blown up by Bob's grenade"): see main.js deathMessage.
export const DEATH_MESSAGES = {
  // The world.
  fall: "Fell from a high place",
  drown: "Drowned",
  void: "Fell out of the world",
  // Your own weapons.
  grenade: "Blown up by your own grenade",
  bazooka: "Blown up by your own bazooka",
  airstrike: "Blown up by your own airstrike",
  grenade_fall: "Sent flying by your own grenade",
  bazooka_fall: "Sent flying by your own bazooka",
  airstrike_fall: "Sent flying by your own airstrike",
  ufocannon: "Blasted by your own UFO cannon",
  ufocannon_fall: "Blasted off a cliff by your own UFO cannon",
  nuke: "Too close to your own nuke",
  nuke_fall: "Blown away by your own nuke",
  missile: "Hit by your own missile",
  missile_fall: "Sent flying by your own missile",
  cannon: "Hit by your own jet's cannon",
  // Creatures.
  zombie: "Killed by a zombie",
  skeleton: "Shot by a skeleton",
  skeleton_melee: "Killed by a skeleton",
  spider: "Killed by a spider",
  mob: "Killed by a creature",
  guard: "Struck down by a soldier",
  soldier: "Shot by a soldier",
  alien: "Shot by an alien",
  alien_melee: "Killed by an alien",
  alien_gray: "Killed by a gray alien",
  alien_gray_shot: "Shot by a gray alien",
  alien_red: "Crushed by a red alien",
  alien_red_shot: "Blasted by a red alien",
  alien_plasma: "Blasted by a red alien's plasma",
  alien_plasma_fall: "Blown off your feet by a red alien's plasma",
  alien_blue: "Killed by a blue alien",
  alien_blue_shot: "Shot by a blue alien",
  // UFOs.
  abducted: "Abducted by a UFO",
  ufo_laser: "Shot by a UFO",
  ufo_blast: "Blown up by a UFO",
  ufo_blast_fall: "Blown off your feet by a UFO",
  ufo_crash: "Crushed by a crashing UFO",
  ufo_crash_fall: "Thrown by a crashing UFO",
  ufo_boom: "Caught in an exploding UFO",
  ufo_boom_fall: "Thrown by an exploding UFO",
  ufo_down: "Went down with your UFO",
  ufo_down_ufo: "Shot down by an enemy UFO",
  // Aircraft.
  jet_crash: "Crashed your jet",
  jet_down: "Shot down in your jet",
  jet_down_ufo: "Shot down by a UFO",
  jet_down_ground: "Shot down by fire from the ground",
  jet_boom: "Caught in an exploding jet",
  jet_boom_fall: "Thrown by an exploding jet",
  enemyjet: "Shot down by an enemy fighter",
  enemyjet_gun: "Gunned down by an enemy fighter",
  enemymissile: "Hit by an enemy missile",
  enemymissile_fall: "Blown out of the sky by an enemy missile",
  roguemissile: "Caught in a dogfight between a fighter and a UFO",
  roguemissile_fall: "Thrown by a missile in a dogfight between a fighter and a UFO",
  // The missions' world.
  meteor: "Hit by a falling meteor",
  meteor_fall: "Thrown by a falling meteor",
};

// A pilot whose aircraft was destroyed: the cause that names what did it.
export function pilotCause(vehicleType, cause) {
  const c = baseCause(cause);
  if (c === "enemyjet" || c === "enemyjet_gun" || c === "enemymissile") return c === "enemyjet_gun" ? "enemyjet" : c;
  if (vehicleType === "jet") {
    if (c === "crash") return "jet_crash";
    if (c === "ufo_laser" || c === "ufo_blast" || c === "ufo_crash") return "jet_down_ufo";
    if (c === "alien" || c === "soldier" || /^alien_/.test(c)) return "jet_down_ground";
    return "jet_down";
  }
  if (c === "ufo_laser" || c === "ufo_blast") return "ufo_down_ufo";
  return "ufo_down";
}
