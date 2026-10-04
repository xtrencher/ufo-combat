// Stats: UFOs shot down, play time, aliens and zombies killed, deaths,
// abductions survived (and a few more), counted for the current world and
// in total across all worlds. Saved in localStorage: the world's counts
// with the player save, the totals in their own record.
import { loadJSON, saveJSON } from "./storage.js";

export const STAT_LABELS = [
  ["ufosDown", "UFOs shot down"],
  ["ufosDownSurvival", "UFOs shot down in Survival"],
  ["playTime", "Play time"],
  ["aliensKilled", "Aliens killed"],
  ["zombiesKilled", "Zombies killed"],
  ["guardsKilled", "Guards killed"],
  ["skeletonsKilled", "Skeletons killed"],
  ["mobsKilled", "Other creatures killed"],
  ["deaths", "Deaths"],
  ["abductionsSurvived", "Abductions survived"],
  ["abducted", "Times abducted"],
  ["animalsAbducted", "Creatures you abducted"],
  ["ufosBoarded", "UFOs boarded"],
  ["jetsCalled", "Jets flown"],
  ["missilesHit", "Missile hits"],
  ["nukes", "Nukes dropped"],
  ["enemyJetsDown", "Fighters shot down (hijacked or patrol)"],
  ["hijackedDown", "Hijacked fighters shot down"],
  ["ufosDownBig", "Motherships and giants shot down"],
  ["titansDown", "Titans shot down"],
  ["cratesOpened", "Supply crates opened"],
  ["missionsDone", "Missions completed"],
  ["nightsSurvived", "Nights survived"],
  ["takeoffs", "Jet takeoffs"],
  ["ufosDownByJet", "UFOs shot down from the jet"],
  ["ufosDownLarge", "Large UFOs (or bigger) shot down"],
  ["raidersDown", "Village raiders shot down"],
  ["airportsNuked", "Enemy bases nuked"],
  ["landings", "Jet landings on a runway (mission)"],
  ["landingSquad", "Landing squad aliens killed (mission)"],
  ["meteorFragments", "Star fragments collected"],
  ["bossesDown", "Bosses destroyed"],
  ["shipsStolen", "Alien ships stolen from a bunker"],
  ["abductorsDown", "Abductor UFOs shot down (mission)"],
  ["flagshipDown", "The Armada's flagship destroyed"],
  ["playerKills", "Players taken down (multiplayer)"],
];

function blank() {
  const o = {};
  for (const [k] of STAT_LABELS) o[k] = 0;
  return o;
}

export function formatPlayTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export class Stats {
  constructor() {
    this.world = blank();
    const saved = loadJSON("stats_total");
    this.total = blank();
    if (saved) for (const k in this.total) if (Number.isFinite(saved[k])) this.total[k] = saved[k];
    this._delta = blank(); // (added since the last save: another tab of the game may have saved its own meanwhile)
    this._dirty = false;
    this._saveT = 0;
  }

  loadWorld(data) {
    this.world = blank();
    if (data && typeof data === "object") for (const k in this.world) if (Number.isFinite(data[k])) this.world[k] = data[k];
    // (A world saved before the Survival count starts it at all its kills: it keeps its loot tier.)
    if (data && typeof data === "object" && !Number.isFinite(data.ufosDownSurvival)) this.world.ufosDownSurvival = this.world.ufosDown;
  }

  add(key, n = 1) {
    if (!(key in this.world)) return;
    this.world[key] += n;
    this.total[key] += n;
    this._delta[key] += n;
    this._dirty = true;
  }

  // Online (host): something another player did counts for the world (the
  // shared missions), not for this player's own totals.
  addWorld(key, n = 1) {
    if (!(key in this.world)) return;
    this.world[key] += n;
    this._dirty = true;
  }

  // Counts play time (only while actually playing) and saves the totals now
  // and then.
  tick(dt, playing) {
    if (playing) this.add("playTime", dt);
    this._saveT += dt;
    if (this._dirty && this._saveT > 5) this.save();
  }

  save() {
    this._saveT = 0;
    this._dirty = false;
    // Adds this tab's counts to the saved record rather than overwriting it.
    const saved = loadJSON("stats_total");
    const cur = blank();
    for (const k in cur) cur[k] = (saved && Number.isFinite(saved[k]) ? saved[k] : 0) + this._delta[k];
    this.total = cur;
    if (saveJSON("stats_total", cur)) this._delta = blank(); // (a failed write keeps them for the next try)
  }

  format(key, value) {
    return key === "playTime" ? formatPlayTime(value) : String(Math.floor(value));
  }

  // The Stats screen: a table of this world vs all worlds.
  renderTable(el) {
    const rows = STAT_LABELS.map(([k, label]) => `<tr><td>${label}</td><td class="num">${this.format(k, this.world[k])}</td><td class="num">${this.format(k, this.total[k])}</td></tr>`).join("");
    el.innerHTML = `<table><tr><th></th><th class="num">This world</th><th class="num">All worlds</th></tr>${rows}</table>`;
  }
}
