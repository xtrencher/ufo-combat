# UFO COMBAT

A procedurally generated voxel sandbox under alien attack, running entirely
in the browser: no install, no build step, no accounts. Build and survive in
a block world, then take on UFOs with a bow, guns, a railgun, a laser
minigun, homing rockets, meteor airstrikes, two fighter jets (an F-22 and an
F-16, with missiles, flares, radar and a real runway takeoff), a B-2 stealth
bomber that carries the nuke and, late in the game, a flying saucer of your
own (stolen from a guarded bunker if need be). Play alone or with friends
(peer-to-peer, up to 8 players, one shared world). Built from scratch with plain JavaScript and
[Three.js](https://threejs.org/).

Everything is generated in code at runtime: the terrain, every block
texture, item icon and mob skin, the models, and all the sound effects.
There are no image, model or audio files.

## Play

Open the game (see **Running locally** below). The main menu flies slowly
over your world at sunset while UFOs drift by. **Click one to shoot it**: a
few hits and it blows up (the next one comes by sooner). The menu shows a
live **FPS** counter; if it runs poorly it suggests a lower graphics preset.
The default preset is **Medium** (render distance 25 chunks, master volume 30%); anything you choose is saved and always wins.

Every screen (main menu, pause menu, settings, inventory, mods, missions, stats) shares one clean, dark glass style. **Fullscreen:** a small button
appears in the top-right corner when the mouse is near it (it never sits over the game, and it is inert while you are playing with the mouse captured), and
**F11** or **Alt+Enter** toggle it. In fullscreen, Chromium browsers (Chrome, Edge, Opera and friends) **lock the keyboard** (the Keyboard Lock API), so
browser shortcuts like **Ctrl+W** (sprint), **Ctrl+R**, **Ctrl+S**, **Tab** and the **Esc** key reach the game and do not close, reload or interfere with
the page (hold **Esc** to leave fullscreen then; a short **Esc** still opens the pause menu). Browsers without the Keyboard Lock API (Firefox, Safari) get
plain fullscreen: the game still cancels the shortcuts a page is allowed to cancel (Ctrl+R, Ctrl+S, Ctrl+D, Ctrl+F, Ctrl+P, Alt+key, Tab), but a few
(Ctrl+W, Ctrl+T, Ctrl+N) cannot be cancelled outside fullscreen: sprint (and boost a UFO) with a double-tap of `W` instead of `Ctrl+W` there; the browser also asks
before closing the page while you play.

The main menu (Round 8: square corners, a blue accent, no logo over the
flyover) has three things:

- **Play** enters the world (the last world you played is continued) in the
  mode picked right under it (**Survival** / **Creative**). The same card
  shows the world's seed and a small **+ New world** link (a fresh world,
  with an optional seed: a number, or any text).
- **Multiplayer** hosts a game for your friends or joins theirs (see
  **How to play with friends** below).
- **Settings** has every option, in tabs (Graphics, Performance, Controls,
  Audio, Gameplay, Weapons, Mobs, UFOs, Vehicles), each with **Reset to
  defaults**; the **Mods** switch (see below) and the **key list** are
  buttons at its top, and the graphics preset lives in its Graphics tab.

Click Play to lock your mouse; **Esc** opens the pause menu (Resume,
Settings, Missions, Stats, Multiplayer, Copy world link, Save & main menu;
in Creative also the **call-ins**: F-22, F-16, B-2 or a random UFO, and you
are straight in the air at the controls of it).

- **Survival:** you start with basic gear only (a stone sword, a stone
  pickaxe and five apples) at 17:50 (the golden hour before sunset), and a
  **campaign** of 26 to 30 **missions** drawn afresh for every new Survival
  game from a pool of 34 (see below): it starts with a skeleton and its bow,
  goes through jets, a meteor storm and a mothership boss, abductor ships
  hunting you, crash sites and radio beacons to hold, then the aliens'
  counterattack (fighter wings, abductors, a titan, a night of swarms, a
  fortress), and ends with the Armada and its flagship: win that and the
  war is won (a victory screen; the game goes on). There is no crafting, and
  missions pay in apples and golden apples only: weapons come from the
  places that make sense (the skeleton's bow, standard weapons in **supply
  crates** that drop by parachute with orange smoke, alien weapons from
  alien leaders). The fighter jets (parked at airports) join with "Take to
  the air", alien ships with "Salvage". Watch your hearts: falls, drowning,
  zombies, aliens and your own grenades and rockets can all kill you.
- **Creative:** every weapon in your hotbar and inventory, every block and
  item in the tabbed **E** palette, instant mining, flight, and no damage.

You can switch modes at any time in the pause menu: the switch never
changes your inventory (what you took from the Creative palette stays, and
nothing is added or taken away). Each world remembers its mode, your
position, inventory and health. A new world starts on flat, open, dry
ground.

### Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look around | Mouse |
| Jump / swim up | `Space` |
| Sprint | `Ctrl` + `W`, or double-tap `W` |
| Sneak (slow, won't walk off edges) | `Shift` |
| Mine a block / attack (hold to keep mining) | Left click |
| Place a block / use / eat (hold to eat) / fire the weapon in hand | Right click |
| Wear a piece of armor (when it is in your hand) | Right click |
| Open a chest (whatever is in your hand) | Right click |
| Reload the weapon in hand | `R` |
| **Binoculars** (a strong zoom, with a rangefinder) | Hold **both** mouse buttons |
| Select hotbar slot | `1`-`9` or scroll wheel |
| Inventory (in Creative: every block, tool and weapon, in tabs) | `E` |
| Drop the held item (whole stack with `Ctrl`) | `Q` |
| Fly up / down (Creative) | Double-tap `Space` to toggle, then `Space` / `Shift` |
| Pick the targeted block (Creative) | Middle click |
| Pause menu | `Esc` (also steps back out of any menu screen) |
| Board / leave a vehicle (Mods on) | `F` |
| Stats and controls of the vehicle you are in | `I` |
| Fullscreen (and the keyboard lock in Chromium) | `F11` or `Alt+Enter` |
| Hide the HUD / debug info / camera view | `F1` / `F3` / `F5` |

Pressing both mouse buttons together never mines, places or fires: a single
press waits a few hundredths of a second to see whether the other button
follows. The zoom strength is in **Settings > Controls**.

**In the inventory screen:** left click picks up, puts down or swaps a stack;
right click takes half or places one; `Shift` + click moves a stack between
the hotbar and the inventory; number keys swap the hovered slot with a hotbar
slot; `Q` drops from the hovered slot; clicking outside the window drops what
you're carrying. In Creative the palette has tabs (Weapons, Blocks, Tools,
Items): click to take a stack, `Shift` + click to add it to the inventory.
**A chest** (right click on it) opens the same screen with the chest's 27
slots above your inventory and the same clicks: `Shift` + click moves a stack
between the chest and your inventory. `E` or `Esc` closes it.

### Survival basics

- **Health:** 10 hearts. They come back slowly on their own; food heals
  faster (apples, cooked meat). A **golden apple** heals fully and adds four
  golden hearts on top that soak damage first.
- **Mining:** harder blocks take longer; the right tool is much faster.
  Stone and coal need a pickaxe; gold needs an iron pickaxe or better. Tools wear
  out. There is **no crafting**: tools drop from UFOs, aliens and supply crates.
- **Caves and ores:** caves wind underground with coal and gold (iron and
  diamonds are gone: nothing uses them any more; old iron and diamond ore
  blocks in older worlds still break, into cobblestone). Glowing lumen
  crystals grow on deep cave ceilings.
- **Torches and chests** (Round 10): a torch placed on the side of a block
  hangs on the wall, leaning out like in classic block games (on top of a
  block it stands; under a block it doesn't go), and drops off as a torch
  when its wall is mined or blown away. **Chests** hold 27 stacks. The chests
  in village houses and city lobbies (see **The world**) hold loot, rolled
  the first time anyone opens one: food, torches, now and then a golden
  apple or a tool, sometimes a standard weapon the campaign already allows,
  rarely a piece of armor (less than a supply crate). A chest you place
  (Creative palette, or one you broke and picked up) starts empty. Breaking
  a chest spills what it holds. Opened chests are saved with the world.
- **Armor** (Round 5; the shield is gone): four slots (head, chest, legs,
  feet) in four tiers (leather, gold, iron, diamond). Every defense point
  turns away 4% of the damage (up to 80%), the HUD shows an armor bar, and
  every hit wears each piece. Pick a piece up with its slot free and it is
  worn at once; right click one in your hand, or use the armor row in the
  inventory. Aliens, zombies, skeletons and bunker guards drop armor, better
  the further the mission chain has got. Falls, drowning and fire go through.
- **Dying** shows a big red **NOOB!** with the cause. You drop everything
  where you died and respawn with full health around the current mission's
  location (at the world spawn when no mission is running).

### Missions, loot and supply crates (Survival)

- **Missions:** a campaign of 26 to 30, one after another, shown top right
  with a progress bar per objective, the target's distance and direction,
  and a yellow **marker** over the target (an arrow at the screen's edge
  when it is behind you).
- **A different campaign every game** (Round 10): each new Survival world
  draws its own. It always runs in four acts, from small to big, and the
  missions are shuffled within them, with a few optional ones sitting a game
  out, so you never know what comes next. The pool has 34 missions (the 28
  of the classic order and six more: Run for cover, Don't look up, Crash
  site, Hold the line, Rescue and Sabotage), so every campaign leaves a few
  out. It is always fair: the bow comes first or second, nothing needs a jet
  before "Take to the air" (and "Touchdown" always comes right after it),
  nothing needs an alien ship before "Salvage" or the B-2 before "Operation
  Sunburn", the alien leaders come weakest first (blaster, minigun,
  railgun), "Steal the ship" comes before "The Overlord", which comes before
  "UFO slayer", and "The Armada" is always last. **The difficulty follows
  your place in the campaign, not the mission:** the sky, the loot and the
  reward of the 12th mission are those of the 12th place, whichever mission
  it is (the big ones, like the bosses, give a bonus on top), so the curve
  rises smoothly in any order.

  **Missions vary from game to game too**: each has a variant drawn with the
  campaign (the same on every screen online, and kept by a save). Some
  numbers change within a range (where a squad lands and one alien more or
  less, how far the crate or the skeleton is, how long a hold lasts, how
  many carriers or beacons), and some variants add a **twist**, written at
  the end of the mission's text: in half the long nights **abductor ships
  hunt you** as well; Visitors' crew may be jumpy (about 22 s of calm, not
  35); a village raid may be by fast raiders firing bursts, or led by two
  gunships; the meteor storm may be a heavy one, or have hungry salvagers
  (fragments last 60 s, not 80); one abductor may hunt you during
  Abductions; abductors may fly with the night of the swarm; the fortress
  may be held by brutes, by sharpshooters, or be closer with an extra
  gunship.

  **Esc > Missions** shows the campaign so far (done and current missions,
  with their rewards, under their act's name) and how many are still to
  come: those are **classified** (the tracker only says when a new act
  begins). Online, the campaign is the host's (see Modes). Worlds from
  before Round 10 keep playing the classic order (Round 9's 28 missions,
  without the six new ones), where they were.

  | Act | Mission | What to do | Optional |
  | --- | --- | --- | --- |
  | I: On foot | The archer | Kill a skeleton with your sword and take its **bow** | |
  | I | Visitors | A small UFO lands; its two aliens look around (about 35 s) before they attack: kill them (bow, or sword in melee) | yes |
  | I | Supply drop | Open the supply crate dropped for you: the **pistol** | |
  | I | First contact | Shoot down a small scout UFO | |
  | I | The crew | Kill the aliens that climb out of the wreck (right after First contact) | yes |
  | I or II | Run for cover | An orbital bombardment is coming: get to the **shelter** (a green ring, a few hundred blocks off: a village if one is about) before the time runs out. The rocks are aimed near whoever is still out in the open (a red ring marks each landing 4.5 s ahead), closer as the time runs out, and close once it has. Online everyone has to make it (each counts on arriving); a player who dies starts again from where the run began. Variants: nearer with less time, farther with more, or a **spotter UFO**: shoot it down and the rocks fall wide | yes |
  | II: The ground war | The long night | Survive a night (about 4 minutes) without dying; three alien landing parties come. By day the clock speeds up smoothly to dusk first (a time-lapse of about ten seconds, no jump). A death loses the night: the clock eases on to the next dusk and it starts over | yes |
  | II | Laser patrol | Wipe out a landed green patrol; its leader carries the **laser blaster** | |
  | II | Scout hunter | Shoot down three UFOs | yes |
  | II | Gray squad | Wipe out a gray squad; its leader carries the **laser minigun** | |
  | II | Don't look up | **Abductor ships hunt you:** each flies in over a player and beams them up; whoever reaches the ship is lost (it counts as a death). Hold out until the clock runs down (2:30; 2:00 with more ships, or 3:00 with two landing parties sent to flush you out): keep moving out from under the beam (it follows slowly), shoot the ship (a hit breaks the beam and drives it off) or get under a roof. **Every player taken sets the clock back a minute.** Halfway, a landing party comes to flush you out of cover. Online the hunters go for every player | yes |
  | II | Crash site | A UFO comes down on fire nearby (you see it fall). Get there first and hold the site (an orange ring: the clock runs while one of you is in it and no alien is; an alien in it stops the clock, "contested") while the alien recovery team drops in, squad after squad (1:30; shorter and more often attacked, longer, or with a gunship circling over it, by variant). Then walk up to the wreck to **loot it** (what a large UFO's wreck gives) | yes |
  | II or III | Village under attack | Shoot down three raiders burning a village (they stay until shot down) | yes |
  | II or III | Hold the line | Our **radio beacon** (a blue ring and a blinking mast light on open ground nearby) must be held for two minutes: the clock runs while one of you stands by it and no alien does. Squads keep dropping in on it (every 22 to 32 s by variant; a gunship strafes it in one variant). Comes after Laser patrol | yes |
  | II or III | Rescue | **Abductor carriers** rise from a village (or a farm) with people and animals aboard, hover a few seconds and make off low and slow, climbing, and never stop to fight. Shoot three down before they get 360 blocks away: their captives fall free and walk off. One that gets away is gone, and more come. Variants: a gunship escort, quicker carriers, or four of them. Comes after Laser patrol | yes |
  | III: The air war | Take to the air | Take a jet (F-22 or F-16) parked at an airport and take off | |
  | III | Touchdown | Land a jet on an airport's runway and stop; a red squad then drops in on the ground: finish it (get out with `F`) | |
  | III | Dogfight | Shoot down two UFOs from the jet | yes |
  | III | Air superiority | Shoot down the hijacked fighter hunting you | yes |
  | III | Red brutes | Wipe out a red squad; its leader carries the **railgun** (on its back, plain to see) and always drops it, however it dies: the marker then points at it until someone picks it up | |
  | III | Falling stars | A meteor storm at night (by day the clock eases on to the night first): dodge the rocks (a red ring marks each landing 4.5 s ahead) and collect four glowing star fragments from the craters before alien salvagers take them | yes |
  | III or IV | Sabotage | **Signal beacons** (pods that land around you, each sending up a pink column of sparks) call in a UFO every 50 s or so while they stand: destroy three (four in one variant). Each has a few aliens guarding it, set out when you come near. Variants: spread farther apart, or calling more often. Comes after Gray squad | yes |
  | III | Salvage | The next UFO you down lands intact: board it (alien ships, hangar ones too, are yours from now on) | |
  | III or IV | Big game | Bring down a large UFO | yes |
  | III or IV | Scramble! | A wing of hijacked fighters comes at you all at once: shoot down three (take a fighter from the airport, or lock on with the bazooka) | yes |
  | IV: The counter-offensive | Operation Sunburn | Take the **B-2 bomber** from your airport, fly to the far-off airport the aliens turned into a base and drop the nuke on it (`B`); guard UFOs and a fighter defend it. A lost B-2 is replaced at its airport | |
  | IV | Steal the ship | Soldiers keep a captured alien ship in the underground bunker of an airport: fight your way past the armed guards, board it (`F`), and when they seal the blast doors switch on **ghost mode** (`G`) and burn your way out through the rock; get 150 blocks clear | |
  | IV | The Overlord | **Boss:** a shielded mothership. Shoot down its pylons to drop the shield, then hit the hull (the railgun is made for it) before the shield returns: four shield rounds, an escort, and a red squad dropped on you. Doable on foot | |
  | IV | UFO slayer | Shoot down twenty-five more | yes |
  | IV | Abductions | Abductor UFOs beam up a village's people and animals: shoot down three of them | yes |
  | IV | Titan | Bring down a **titan**, the biggest alien ship (well over a hundred blocks across); its crew comes out fighting | yes |
  | IV | Night of the swarm | A night of swarms: small, fast UFOs fill the sky while red and blue landing parties hunt you. Survive until dawn and shoot down eight (the clock eases to dusk like the long night's) | yes |
  | IV | The fortress | A garrison of red brutes, blue and gray aliens (two leaders) dug in on open ground, heavy UFOs over it: kill ten | yes |
  | Finale | The Armada | **The finale:** the Dreadnought, a titan behind five shields held up by pylons, with escorts, hijacked fighters and squads dropping in. Bring it down and the war is won: a victory screen, and the sky stays busy for free play | |

  **Rewards** (apples and golden apples only) grow with the place: 3-4
  apples for the first missions, one golden apple from the fourth place, two
  or three around the middle of the campaign, up to ten at the end; the
  Armada gives 20 golden apples, the Overlord six extra, UFO slayer four,
  Operation Sunburn and the Titan three, Steal the ship two, Big game and the
  swarm one.

  Each place in the campaign also sets the sky, and in Survival **only the
  missions do** (the UFO activity, spawn chance, max count and size
  settings are Creative's and hidden in Survival): no UFOs at all for the
  first two missions of any campaign, then a single small one, then more and bigger ones (medium,
  large, motherships and, at the very end, giants), with health, damage,
  aggression and numbers growing along the chain. Every UFO carries one kind
  of alien (green early, grays and reds later).

  **A mission's own targets are kept** (Round 9): the scout, the raiders,
  the large UFO of Big game, the titan, the boss and its pylons, the
  abductors, the base's guards, and any UFO you have hit during a hunt, the
  hunters of Don't look up, the carriers of Rescue and the signal beacons
  of Sabotage never fly off, despawn or get swapped for a fresh one: one that strays far is
  called back toward the nearest player, and its damage stays. Steal the
  ship always has exactly one ship: the bunker's own (if it is lost after
  boarding, the bunker sets out a new one, for everyone online).
- **Dying during a mission:** you come back at a random safe spot around the
  mission's location (dry, flat ground, out of the fight, outside any
  airport bunker's restricted zone; around the airport where the jets wait
  for the flying missions), not at the world spawn. Online too, for every
  player. **Death messages** name what did it: "Shot by a soldier",
  "Struck down by a soldier", "Killed by an alien" (a blow) or "Shot by an
  alien", "Killed by a spider", "Blown up by a UFO", "Hit by a falling
  meteor", "Shot down by Bob", and so on.
- **Where weapons come from** (each lane has its own weapons, so nothing
  arrives twice or out of order):
  - **The skeleton** ("The archer", always first or second): the bow.
  - **Supply crates** (the first one with "Supply drop", then every 1.5 to 3 minutes
    after it): a standard weapon you don't have yet while any are left, the
    lower ones first as the chain unlocks them (pistol; grenades, machine
    gun; sniper rifle; bazooka; airstrike designator), plus golden
    apples, food and sometimes a tool.
  - **Aliens:** their leaders ("Laser patrol", "Gray squad" and "Red
    brutes", always in that order) carry the alien
    weapons (slung on their backs): laser blaster, laser minigun, railgun.
    A leader always drops its weapon, whoever or whatever kills it, while
    someone in the group still lacks it, and the drop never despawns. Later on ordinary aliens
    of that kind or stronger can drop one you missed. Otherwise aliens drop
    food, tools and golden apples, better the further you are.
  - **Chests** in villages and cities: now and then a standard weapon the
    campaign already allows (see **Survival basics**).
  - **Missions:** apples and golden apples only.
  - Downed UFOs and enemy fighters drop food, tools and golden apples.
- **Supply crates:** a crate drifts down on a parachute near you, trailing
  orange smoke (the tracker shows how far it is). Walk up to it.
- **Difficulty curve:** follows your place in the campaign (see above).

### Creatures

- **Fluffalo:** a shaggy, humped grazer with a cream mane. Drops fluff and raw
  meat.
- **Hoplet:** a striped little hopper with tall ears. Quick to flee.
- **Mossback:** a slow, moss-covered tortoise that hides in its shell when
  hit.
- **Cows, pigs and chickens** graze in the meadows; **villagers** wander
  their villages; **butterflies**, **parrots** (scarlet macaws that fly
  between trees and perch on the branches) and **fish** add life.
- **Zombie:** comes out in the dark (at night, or in unlit caves), chases
  you, and hits hard. Zombies burn in daylight. Swords recharge between
  swings (watch the bar under the crosshair); hit while falling for a
  critical hit.
- **Skeletons** shoot real arrows from their bows (and drop them);
  **spiders** climb walls.
- (Round 9) Land creatures never appear in water or on it, wherever they
  come from (the spawners, the missions, online around every player): fish
  swim, and the crew of a UFO that crashed in the sea comes up in the water
  around the wreck. The **blue alien**'s head is plain, matte skin (it used
  to glow like a lamp at night); its suit's cyan seams and its gun still glow.

**Zombie settings** (Settings > Mobs): spawn rate (off to 50x, the
"APOCALYPSE"), maximum count (up to 400), health and damage multipliers,
and daylight zombies (they spawn by day and don't burn). Far zombies are
drawn as simplified crowds and think less often, so hundreds stay playable;
a note warns next to the heavy values.

### Weapons (Mods on)

Survival starts with a sword (weapons come from the lanes above); Creative
has them all (the hotbar first, the rest in the inventory). With one selected, right click uses it instead of placing a
block. Ammo is unlimited, but every gun has a **magazine and a reload
time**, shown next to the hotbar (with a bar while it reloads). An empty
magazine reloads by itself; `R` reloads early. Reloads carry on while you
hold something else.

| Weapon | Magazine | Reload |
| --- | --- | --- |
| Bow | 1 arrow | 0.35 s (plus about 1 s to draw) |
| Pistol | 12 | 1.5 s |
| Machine gun | 30 | 2.2 s |
| Sniper rifle | 1 | 1.8 s |
| Grenade | 1 | 1.4 s |
| Bazooka | 1 | 3 s |
| Laser blaster | none: fires continuously | - |
| Railgun | 1 | 3.5 s |
| Airstrike designator | 1 | 25 s |
| Laser minigun | overheats after about 4 s of fire | cools in 3 s |

- **Bow:** hold right click to draw (the bow visibly bends and the arrow
  is pulled back in stages; about a second for full power, a quick
  release is a weak shot), let go to shoot. A **fully drawn arrow flies much
  farther and faster** (135 blocks/s, almost flat, 10 damage); a quick flick
  still drops in an arc. Arrows stick where they land.

- **Pistol:** real bullets (175 blocks/s) with a muzzle flash and recoil.
  Bullets spark, ricochet and leave holes in blocks, and hurt and push back
  creatures. Like every gun's bullet they take time to arrive: lead a moving
  target.
- **Grenade:** hold right click to charge the throw (the bar under the
  crosshair fills in about 1.5 s), release to throw. A quick click lobs it a
  few blocks, a full charge about 25. It bounces and rolls, blinks, and
  explodes after 5 seconds, or at once if it hits a creature. The blast
  carves a crater (below sea level the water floods in), throws debris, fire
  and smoke, and knocks everything back.
- **Bazooka:** a fast rocket with a smoke trail. **Hold** right click with a
  target near the crosshair to **lock on** (a box closes in on it, the tone
  speeds up, then LOCK); **release** to launch a homing rocket. A quick click
  fires an unguided one. It can hit you too: keep your distance.
- **Machine gun:** hold right click for automatic fire (12 rounds a second):
  real bullets (190 blocks/s) with a tracer on every round, and spread and
  recoil that climb the longer you hold the trigger. Far, moving targets need
  a lead.
- **Sniper rifle:** right click scopes in (a zoomed view through a scope),
  left click fires a long-range, high-damage bullet: the fastest of the guns
  (480 blocks/s), so only a long shot at a moving target needs a small lead.
- **Laser pistol (blaster):** glowing sci-fi bolts in red, green or blue
  (**Settings > Weapons**) that streak out far faster than any bullet (650
  blocks/s), spark on impact and leave scorch marks. Hold right click for
  continuous fire: each bolt hits a little harder (6) than a pistol round
  (5), and it never reloads.
- **Railgun:** hold right click for about a second (glowing coils, a rising
  whine), then one extremely bright beam that **destroys every block along
  its line** and hits every creature, UFO and vehicle in it, very hard.
- **Laser minigun:** hold right click: the barrels spin up for a second, then
  a huge stream of laser bolts (680 blocks/s, like the blaster's: lasers are
  about three and a half times as fast as the pistol's and machine gun's
  bullets).
- **Airstrike designator:** aim its laser and right click. After the delay a
  shower of meteors screams in at an angle from high up and far away: each
  one has a glowing, white-hot core, a heat glow, a fiery tail and a long
  smoke trail, and lands with a flash, a shockwave and a crater. Settings:
  meteors per strike, spread radius, delay, fall angle, fall speed and
  explosion size.

With a long view range (over 300 blocks) the pistol's and machine gun's
bullets fly half as fast again, so far targets aren't seconds away; they
stay well behind the lasers. Online, the other players see every bullet fly and hear
the gun that fired it.

Explosions shake the camera and sound quieter, more muffled and later the
farther away they are. Sand and gravel fall when the ground under them is
blown away.

## How to play with friends (multiplayer)

Up to **8 players**, free, with no account and no server of your own: the
browsers connect **directly to each other** (peer-to-peer WebRTC). A free
public matchmaking server (PeerJS) only introduces them; after that the
game's data goes straight between the players' browsers. The game stays a
plain static site (GitHub Pages).

### Host a game

1. Open the game and press **Multiplayer** (on the main menu, or in the
   pause menu during a game: Esc > Multiplayer).
2. Type your **nickname**, pick **Survival**, **Creative** or **Dogfight**,
   and press **Open room**.
3. You get a 5-character **room code** (like `K7MPQ`). Send it to your
   friends, or press **Copy invite link** and send them the link.
4. Press **Play**. Your current world becomes the shared world. It stays
   yours: it is saved on your computer as usual, with everything your
   friends build in it.

The host is in charge: only the host picks the **game mode** (Esc >
Multiplayer, any time) and the **game settings** for everyone (Settings:
difficulty, weapons, creatures, UFOs, vehicles, the clock; a guest's own
settings for those are locked while they play and kept for their own
worlds). The Multiplayer screen shows every player with their ping, and
the host can **Remove** a player. **Close room** (or going back to the main
menu, or closing the tab) ends the game for everyone.

The host's computer runs the world for everyone (the UFOs, the creatures,
the missions), so the player with the faster computer and the better
connection should host. The host's tab may be in the background: the game
keeps running there (it just isn't drawn).

### Join a game

- **Open the invite link** you were sent (pick a nickname and press
  **Join**), or press **Multiplayer > Join a game**, type your nickname and the room
  code (letters and digits; capitals don't matter) and press **Play**: that
  joins straight away (no second form). When the host's world has arrived you
  are in it; click once to take the mouse and play.
- You play in the host's world. Your own worlds are not touched, and
  nothing of the host's world is saved on your computer.
- The host keeps your things (inventory, armor, where you were) in their
  world: join again with the **same nickname** and you have them back. A
  new player starts next to the host.
- **Leave game** in the pause menu (or Esc > Multiplayer > Leave game) takes
  you back to your own world.

### Modes

- **Survival together:** one mission chain for the whole group, the host's.
  Everyone's kills and deeds count toward the objectives (the tracker, the
  yellow marker and the boss bar show the same mission to everyone), and a
  finished mission **rewards every player**. The campaign is the host's:
  every guest sees the host's missions, in the host's order, with the same
  rewards and the same classified list, and a dusk the host's clock eases
  toward runs the same way on every screen. The new missions count everyone
  too: the hunters of Don't look up go for every player (a guest in a beam
  is lifted on their own screen, and a guest taken sets the clock back for
  the group), a zone is held by whoever is in it, every player has to reach
  the shelter in Run for cover, and the zones, the shelter, the
  bombardment's rings and the signal beacons' columns show on every screen.
  **One shared world** (Round 8):
  every item lying anywhere (loot, a mined block, a dead player's things)
  and every supply crate is the same for everyone, and only one player can
  pick each up; every walking creature is the host's and the same for all,
  and creatures come around every player, however far from the host
  (Round 9: a guest far away used to see hardly any).
  The missions **scale with the group**: kill goals grow per player (2
  aliens each in "Visitors", a squad leader with the new weapon for every
  player, a crate for each player), UFO goals by half a mission per extra
  player, and the goals follow players joining or leaving mid-mission.
  Bigger groups also get more and tougher UFOs (x1.3 as many and x1.25
  health per extra player), a little tougher creatures, more guards, and a
  fighter for everyone at each airport. In Operation Sunburn one player
  flies the B-2 and the others escort it. The long night only starts over when the
  whole group is down at the same time. A dead player respawns around the
  current mission's location (see Missions above; outside a mission, at the
  world spawn) or **next to a friend**.
- **Damage online (Round 9):** every weapon works the same for the host and
  the guests, on foot or in a vehicle, against every kind of target:
  creatures, aliens, soldiers, UFOs, enemy fighters, other players (with
  the PvP rule) and blocks. A guest's hit on the host's things is sent to
  the host, which applies it through the very same code with that guest as
  the attacker: the damage, the kill, the loot and the mission credit are
  the guest's, and every screen shows the same result. Checked by a test
  that fires all 17 weapons at all 14 kinds of target, as a guest and as the
  host (`tools/mp-damage-tests.mjs`).
- **Creative together:** everyone flies, builds and blasts; the host's
  Creative settings (UFO activity and the rest) apply. A guest's "summon a
  UFO" (Mods screen) asks the host's game for it. Everyone can use the
  pause menu's **call-ins** (an F-22, F-16, B-2 or UFO, straight into the
  air): the others see the aircraft and who flies it. Switching between
  Creative and Survival never changes anyone's inventory.
- **Dogfight:** everyone flies an F-22, all against all. After a countdown
  everyone is put in a jet high over the arena; shoot the others down with
  the cannon and missiles (flares and rolling away still work). A
  shot-down pilot is back in a jet 3 seconds later; nobody can climb out.
  The kill goes to whoever hit the jet last (a crash while someone was on
  your tail counts for them). The host sets the **death limit**
  (Multiplayer screen): at that many deaths a player is out and watches.
  The last one in wins; everyone sees **VICTORY** or **DEFEAT** and the
  final scores, and the host can start a new match at once. No UFOs or
  enemy fighters get in the way during a Dogfight.

### While playing

- Every player's **nickname** floats over them (and over their aircraft),
  with their health in Survival and the distance when they are far.
- Hold **Tab** for the scoreboard: the players and their pings (in a
  Dogfight, kills and deaths).
- The top-left corner shows the mode, the room code, the players and (for
  a guest) the ping, and warns when the connection to the host lags.
- **Nothing pauses online:** Esc only takes your hands off the controls.
- **PvP** is the host's choice (a checkbox in the lobby, **on** by
  default): on, players' shots, swords and explosions hurt each other
  ("Killed by NAME", counted in Stats); off, nothing another player does
  hurts you, not even their nuke (Round 9: it used to). The aliens, UFOs,
  enemy fighters, crashes and meteors always hurt. In a Dogfight it is
  always on.
- **Chests** are the host's: everyone sees the same contents, two players
  can have the same chest open at once and see each other's clicks, and
  what a broken chest held drops for everyone.
- At the end of a **Dogfight** the results screen frees the mouse and its
  buttons work (new match, close).
- To try it alone, open the game in **two browser tabs or windows** on one
  computer: host in one, join with the code in the other.

### If connecting fails

- **"Room not found":** check the code (there is no 0/O or 1/I in codes),
  and that the host is still in the game with the room open (a room closes
  when the host leaves or reloads the page; a new room has a new code).
- **"Can't reach the matchmaking server":** check the internet connection;
  an ad blocker, firewall or school/office network may block `0.peerjs.com`
  or `cdn.jsdelivr.net`. The free server can also be busy for a moment: try
  again a minute later.
- **"Couldn't connect to the host":** both players reached the matchmaking
  server, but their networks don't let a direct connection through. This
  happens on some mobile, school, office and hotel networks, behind some
  VPNs, and between two strict ("symmetric") home routers. Try another
  network (a phone hotspot often works), turn off the VPN, or let the other
  player host. Without a TURN relay server (see below) some pairs of
  networks simply can't connect.
- **"Different game versions":** both players reload the page with
  `Ctrl+Shift+R` (`Cmd+Shift+R` on a Mac).
- **"Lost the connection to the host"** or a lag warning: the host's game
  stopped answering (closed, crashed, a network drop). Use **Try to rejoin**,
  or go back to your own world.
- It still doesn't work: make sure both play the same deployment (the same
  address), in an up-to-date Chrome, Edge, Firefox or Safari.

### Adding a TURN server (for networks that block direct connections)

All the network settings are in one file, `js/net/config.js`. To relay the
connections that can't go direct, add a TURN server to `ICE_SERVERS` there
(an entry is prepared, commented out: fill in its address, user name and
password). TURN servers relay traffic, so they cost bandwidth (a TURN
provider or your own coturn server). A self-hosted PeerJS server can be
used instead of the public one by adding `?peerServer=host:port/path` to
the address (the invite links carry it along).

### For mod makers

The networking lives in `js/net/` and the rest of the game only has small
hooks into it. A mod can share its own state: `mp.net.on(type, fn)` handles
a message type, `mp.net.toAll(msg)` sends to everyone (through the host),
`mp.net.toHost(msg)` / `mp.net.broadcast(msg)` send one way,
`mp.net.registerSync(name, { save, load })` adds a piece of state to what
a joining player gets, and `mp.addModule({ start, update, stop,
playerJoined, playerLeft })` runs alongside the game's own modules (`mp` is
`window.__ufo.mp`).

## UFOs (Mods on)

UFOs roam the skies anywhere from treetop height to high overhead. They are
**plain, clean shapes** (they look real because they are simple: no
lights, panels or portholes): **smooth saucers** are the most common (lens,
flat disc and gently domed, each with its own proportions), then the **BALL UFO** (a
gray-black sphere with a grainy surface), **white tic-tacs**, **tori** (rings), rounded
a large flat black **triangle** with dim lights at the corners, plus the
odd **boomerang** and **cylinder** (real-sighting shapes: they fly along their
long axis). Finishes vary: brushed metal, satin,
glossy, matte. A few glow faintly (a soft light at night); a UFO that has
been shot down never glows again. Sizes run from small scouts through large
ships and motherships to **giants as big as a football field**. They
arrive from far away (never popping up in plain sight: the spawn distance
follows how far you can see), and there are far more of them at night.

- **Mostly peaceful:** UFOs drift around, hover over lakes, zig-zag, follow
  animals, beam up a cow, **dash** to a spot nearby (a streak across the sky
  in a split second, no light: sometimes on their own, often when you shoot
  at them or a missile closes in), **dive into mountains and under the sea**
  and come out elsewhere, or shoot off into the sky.
  They turn **hostile** when you shoot them, when you **stare** at one for
  too long, and now and then on their own mood. At most **four** attack you
  at once; the rest circle and wait.
- **Different ships fight differently**, each style with its own colour and
  sound: **rapid bursts** of five cyan bolts (tic-tacs, saucers), **slow
  heavy** orange balls that explode (spheres, cubes), **spread** fans of
  magenta bolts (saucers, rings), **charged shots** (the ship glows up for a
  second with a rising whine, then one very fast white bolt: move!),
  **sweeping beams** (a red laser whose end runs across the ground through
  you: step off its line), **seeking** lime plasma against vehicles (fool it
  with flares), and beam-and-abduct runs. A shot that reaches you always
  hurts; standing still gets you hit, moving out of the way doesn't.
- **The tractor beam** hangs under the ship and goes wherever it goes: a UFO
  that dashes away takes its beam along or switches it off.
- **On foot:** a hostile UFO races over, stops above you and lifts you in a
  cone of blue light. Reach the ship and you're **abducted**. Get out of the
  light (you can still move), hide under a roof, or shoot it down. After you
  respawn, UFOs leave you alone for half a minute.
- **Shot down:** its lights go out and it falls. Over land it crashes, and
  then either **explodes into a burnt-out wreck** (unusable) or **lands in
  one piece**, embedded in the ground, and can be boarded with **F** and
  flown (damaged, but it works). The crash explosion scales with the ship's
  size. Over the sea it **sinks and explodes on the seabed**; its crew
  spawns in the water and swims for you.
  Between **1 and 10 aliens** climb out (more from bigger ships), all of one
  kind per ship: **green** ones with pistols, **gray** ones with fast
  three-shot bursts, or tough **red** ones with plasma. Their shots leave
  from the tip of their gun (skeletons' arrows from the bow). They face you
  when they shoot and chase you the moment they are out; swords and other
  melee hits work on them too.
- **In your jet** each UFO has a personality: most flee (a bit slower than
  the jet at full throttle, so you can catch them), some are faster and get
  away, and fighters attack you with lasers and head-on passes.
- **Patrol fighters** (below) hunt UFOs and leave you alone.

**Settings > UFOs:** one **UFO activity** slider from Off and Very rare up to
**UFO APOCALYPSE**, and **Advanced** options: spawn chance, max count,
aggression, detection range, beam lift strength, sizes, night multiplier and
toughness.

## Vehicles (Mods on)

| Action | Key |
| --- | --- |
| Board a vehicle / get out | `F` (near it) |
| Camera view | `F5` |
| Stats and controls of the vehicle | `I` |

Getting out puts you on the ground beside the vehicle (or in the water, or
out of a tunnel). From high up you drop out under a **parachute** (a jet
ejects you upward first). Hits on you while seated damage the vehicle; if it
is destroyed with you inside, you go down with it. Vehicles are saved with
the world, including the one you're sitting in.

### Your UFO

Board a UFO that came down in one piece, or one of the small ships that
sometimes hover in the hall of a **secured underground bunker** at an
airport (armed human guards stand watch and open fire when you enter the
restricted zone; in Survival boarding works from the "Salvage" mission;
before that they are locked), or in Creative spawn one from the
**Mods** screen (any shape and size). It has no physics limits (and no ceiling: fly as high as you like): it hovers
perfectly still and moves instantly in any direction. The camera keeps the
ship low in the view so the crosshair is always clear.

| Action | Key |
| --- | --- |
| Look / steer | Mouse |
| Move along the view / back | `W` / `S` |
| Sideways | `A` / `D` |
| Up / down | `Space` / `Shift` |
| Cruising speed | Mouse wheel (from a slow hover to extremely fast) |
| Boost (3x) | `Ctrl`, or `W` tapped twice and held (no Ctrl+W outside fullscreen) |
| The ship's own weapon (what its kind fires: rapid bursts, heavy plasma, spread fans, charged shots, a sweeping beam, seeker plasma or pulse bolts; bigger ships hit harder) | Left click |
| Tractor beam: works at **any altitude**; lifts creatures and loose blocks, and a bigger ship also **pulls in and swallows smaller UFOs** (at least 1.3x smaller) **and enemy jets** (ship radius 6.5+) | Hold right click |
| **Lock-on salvo**: lock the UFO, jet or hostile creature nearest the crosshair; after 3 s a salvo of homing laser bolts (more for bigger ships) leaves by itself; let go earlier to cancel; 7 s to recharge | Hold `T` |
| **Teleport dash**: the ship streaks along the view at extreme speed (a split second; distance, travel time or off in Settings > Vehicles; shown in the I panel) and always ends somewhere in view. **Hold** `R` to keep streaking, with no distance limit: it gathers speed over a second or so, and never runs ahead of the land drawn around you (on a slower computer it waits a moment for the world to catch up). Every ship has its own random dash speed (about 900-3500 b/s) | `R` |
| **Ghost ram**: with ghost mode on (`G`), a dash rams everything it flies through: creatures, UFOs, parked or flying aircraft (and other players, when the room allows PvP), each once per dash, for heavy damage that grows with your ship's size (half against a boss, nothing through a shield). Each ship or aircraft you plough through costs your hull 3%, and a dash that rammed anything has the full 2.5 s cooldown | `R` with `G` on |
| **Superweapon**: after a short charge, a huge laser straight down; hold the ship moving and it carves a continuous trench along its path | `B` |
| **Ghost mode** (fly through terrain; shown in the HUD) | `G` |
| Chase camera / far / belly view | `F5` |
| Stats and controls | `I` |

**Settings > Vehicles:** top and slowest speed, **ghost mode** (fly through
the terrain, burning a tunnel), whether the beam lifts blocks, and the
**teleport dash** distance (Off, 0.5x-3x) and travel time (0.08-0.6 s). The
dash goes at most about four fifths of the view distance on a tap, levels
off at height 2500 when held (fly higher on your own), and a tap held a
moment too long no longer sends you on. Creatures
you beam up are "stored": their drops go to your inventory, as do the blocks.

### Fighter jet

**There is no calling in a jet:** fighters stand **parked at airports**, in front
of the hangars (F-22 Raptors and F-16 Fighting Falcons), and (Round 10) now and
then **inside a hangar**, nose to the open doorway, with a clear way out to the
taxiway (nothing is parked in front of it): get in and taxi straight out. And a
**B-2 Spirit** bomber at every airport (always outside: it is too big for a
hangar): in its own spot on the apron, or (Round 9) where
the apron has no room for its wing, on the runway just past the end of the
apron, lined up for takeoff. Walk up to one and press **F** (the B-2 near
the middle of its wing). In Survival that works from "Take to the air" (the
marker points at the nearest parked fighter; **F3** shows the nearest airport);
the B-2, and with it the nuke, from Operation Sunburn (a locked aircraft's
message names that mission's number in your campaign).
The **F-22 Raptor** is a heavy stealth fighter (160 health, faster,
four-missile salvos); the **F-16 Fighting Falcon** is light and agile (130
health, turns and rolls harder, a faster-firing cannon, a shorter takeoff
roll, two-missile salvos). The F-22 is a
detailed model (canopy frame, pilot, probes, folding landing gear, a layered
afterburner) in a satin grey paint with panel lines and a subtle two-tone
livery that catches the sun and the moon, so it is clearly visible at night;
both jets have a skin shader with panel tones, soot behind the engines and
faint streaks. **Lights:** navigation lights and strobes are off while an
aircraft stands parked and come on with its takeoff roll (day and night,
dimmer by day); the formation strips and the cockpit glow are night-only.
**Colours:** each type's own grey, green, light blue, desert, navy or arctic,
fixed per airport and slot (about half are grey; the same for every player).

**The B-2 Spirit** (Round 8) is the only aircraft that carries the **nuke**
(`B`; in a fighter `B` just says so). A big flying wing modelled closely on the real one (Round 10): the real
twelve-edge planform (two leading edges swept 33 degrees, the double-W
sawtooth trailing edge with every edge parallel to one of them), a blended
body humped over the cockpit and bays and thinning to sharp wingtips, the
four-pane windscreen, intake scoops with jagged lips, recessed exhaust
troughs with their light heat-shield decks, sawtooth-edged doors and panels,
elevons, split drag rudders and the beaver tail that move, and landing gear
with four-wheel main bogies and doors that stand open while it is down: half a
fighter's top speed, slow to turn and roll, 420 health, no afterburner and
no cannon, missiles one at a time, and a long takeoff roll (about 270
blocks). Lost, it is replaced at its airport.

**Radar** (Round 8): bottom right in any aircraft (jets, the B-2, your own
UFO), heading up, 2.4 km to the rim: UFOs (red diamonds, bigger for bigger
ships), enemy aircraft (orange arrowheads), other players (their colour),
airports (white runway bars, pinned to the rim when far), missiles coming at
you (blinking red, with a line) and the mission target (yellow star).

**Airports** are rarer now but bigger: one regular airport (never a small
field) always lies close to where a new world starts (a few hundred blocks
to about a kilometre, with the start itself clear of its levelled pad), and
every other airport or city is far from it (well over a kilometre, usually
two or more). Runways are **much longer** (600 to 920 blocks, 18 to 26 wide),
so even a beginner can touch down and brake with room to spare; the biggest
airports have terminals and a radar, some have a secured bunker.

It flies like a jet: the **throttle runs 0-100%** and your speed follows it
(about 1000 km/h at 100%, a bit more with the afterburner), lift needs
airspeed, drag, gravity, and a stall below the stall speed (the nose drops).
It can't hover. **Takeoff is a real ground roll** and forgiving (about 175
blocks in the F-22, 130 in the F-16, 270 in the B-2, hands off; less with
the afterburner or a pull on the stick): full throttle, a few
seconds on the wheels, the nose rises at flying speed (flight
assist does it for you), the wheels leave the ground and fold away; small
angles and imperfect runways are fine. **Landing is reliable**: come in
level, wheels first, at a reasonable sink rate, and the jet rolls out; hold
`Space` for the wheel brakes until it stops. On the ground, `S` at 0% throttle
**reverses slowly**. A hard slam or a nose/wing-first hit still destroys it,
and you with it, unless you **eject** (F in the air: the seat fires you out
and a parachute opens). Both jets are agile: **full 360 degree rolls** (hold
`A`/`D`; it stops cleanly when you let go) and **loops** work, with the aim
and the jet handled as quaternions so nothing flips at the top. **Free look:
hold both mouse buttons** to freeze the controls and look around freely,
starting from where the camera looks at that moment (no snap); the
ailerons, elevators and rudders on the model move with your inputs. A jet
destroyed in the air blows up in a **big fireball** and its burning wreck
falls and explodes again on impact. The engine sound is much quieter now.

| Action | Key |
| --- | --- |
| Steer | Mouse (with **flight assist**, the default: fly toward the crosshair; the little nose marker shows where the jet points) |
| Throttle up / down | `W` / `S` |
| Afterburner | `Shift` |
| Roll (full 360 degrees; flight assist banks at most about 65 degrees in a turn and levels off smoothly, without overshooting) | `A` / `D` |
| Free look (the controls freeze, the mouse looks around) | Hold **both** mouse buttons |
| Rudder (yaw) | `Q` / `E` |
| **Air brakes** (hold): panels / control surfaces open with a hydraulic whine, the jet sheds speed very fast and turns much tighter (HUD: "Air brakes OPEN"); too slow with them open and it **stalls**. On the ground: the wheel brakes (reverse: `S` at 0%) | `Space` |
| Autocannon (tracers) | Left click (aims a little for you; **overheats** after about two seconds: watch the heat bar) |
| **Missile** | A **click** of right click fires one **unguided** missile straight ahead (also when there's nothing to lock) |
| **Missile lock** | (Round 8: a lock never switches targets: if it loses its target it is gone until you press again; a salvo goes entirely at the locked target; a **left click cancels** the lock, nothing fires.) **Hold** right click: the UFO or aircraft nearest the middle of your view (even behind you; ones **attacking you** first; never creatures) is locked, the camera turns to look at it **while you keep full control of the jet** (the mouse still steers, a ring on the HUD shows where; every key works). Release after **1 s** for one missile, after **3 s** (F-22) or **2 s** (F-16) for a **salvo** (four or two). A missile at a target behind you turns around. The lock is **stable**: once locked, it stays on that target until you let go, it dies or it is more than 2200 blocks away. Locking does not anger other UFOs. After launch the **camera follows the target until the hit** and **you keep full control** of the jet; right click brings the normal view back at once. Let go before LOCKED and nothing fires |
| **Salvo charge** | From the solid lock to the salvo time a **spiral turns and closes in around the target box** (Round 8), with a rising click per missile (4 on the F-22, 2 on the F-16), the box shakes and the screen edge glows orange; when it becomes a solid pulsing circle a release fires the salvo (before that, one missile) |
| **Roll out of a missile** | A hostile missile that gets close when you have **rolled more than about 90 degrees** (either way) loses you and **passes narrowly by** ("MISSILE EVADED!"); it needs a few seconds before it works again, so rolling all the time does not make you immune. Flares still work as always |
| **Flares** | `C` (a burst of decoys; they fool missiles and seeking shots, which may even turn on whoever fired them) |
| Nuclear bomb (**B-2 only**) | `B` (it drops on a parachute: get clear! No cooldown) |
| Chase / cockpit view | `F5` |
| Get out / eject | `F` |
| Stats and controls panel | `I` |

The HUD shows speed, altitude, throttle, heading, the missile lock, flares,
the nuke, the cannon **heat bar**, the jet's health, takeoff hints, and
warnings: **STALL**, **PULL UP**, **CANNON OVERHEATED**, and **MISSILE
INCOMING** with a red arrow around the crosshair pointing at where it comes
from and a beeping that speeds up as it closes in. Missiles have a limited
turn rate: **sharp turns (and flares) make them miss**. With flight assist
off, the mouse is the stick (up/down pitch, left/right roll). **Settings >
Vehicles:** top speed up to 2500 km/h (default about 1000), acceleration, turn
rate, stall speed, flight assist, cannon aim assist, patrol fighters, and
patrol fighters.

**Patrol fighters:** friendly fighters patrol high up, a little faster than
yours, and **hunt UFOs** (only UFOs: they help, but never clear the sky for
you: weaker against UFOs, long pauses, at most three kills, and their kills
don't count as yours). They leave you alone, whatever you shoot, unless you
attack one of them: **only that fighter** turns on you (a message says so),
with missiles from a distance and then its cannon, flares and breaks. The
one exception is the hijacked fighter of Air superiority, in a darker paint.
**Settings > Vehicles:** how many patrol at once (0-3, default 1).

**The nuke** goes off with a blinding white flash, a fireball, a shockwave
racing over the ground, a huge crater, a scorched blast zone and a
mushroom cloud that climbs for a minute; the boom is heard, late and
muffled, from far away. The default **size is 96** (the old maximum; the
Creative setting goes up to 200): the crater is **very wide** (Round 8: its
radius is 1.6x the size, as wide as the mushroom's cap; about 30 blocks deep)
and **everything within 1.85x the size is destroyed**: houses, city blocks,
hangars, towers and **runways, aprons and streets**, in a wave that spreads
out from the centre like the shockwave. Out to 2.6x every tree is **knocked
flat** (trunks lying away from the blast) and all leaves, grass, flowers and
snow burn off; out to 3.3x trees burn down to stumps and grass turns to dirt.
**No vegetation is left** anywhere in the blast zone, including ground that
loads later: the zone is saved with the world (and sent to players who join)
and applied to every chunk as it generates.
**Settings > Weapons:** nuke size (12-200, default 96) and effects intensity.

## Stats

The pause menu's **Stats** screen counts, for this world and for all your
worlds: UFOs shot down, play time, aliens, zombies and skeletons killed, deaths,
abductions survived, times abducted, creatures you abducted, UFOs boarded,
jets called in, missile hits, nukes dropped, fighters (hijacked or patrol) and
motherships/giants shot down, supply crates opened, and the new missions'
counts: time holding ground (and holding out), shelters reached, crash
sites looted, carriers shot down and signal beacons destroyed. **Settings > Gameplay >
Stats on the HUD** shows UFOs shot down and play time in a corner (off by
default).

## Mods

**Mods** (the button at the top of Settings) switches all the UFO COMBAT content on
or off. It's on by default. Off gives plain vanilla survival and creative:
no guns, explosives, vehicles, UFOs or aliens (swords and tools stay).
Switching mid-game is instant and clean: mod items are put away and come
back to the same slots when you switch mods on again; projectiles, UFOs,
aliens and vehicles leave the world.

## Graphics and performance

**Graphics presets** (Settings > Graphics):

- **Low:** no shadows or post-processing. For weak laptops.
- **Medium** (default): sun shadows and bloom.
- **High:** two cascades of soft sun shadows, normal-mapped textures with
  specular light, refractive water, light shafts, 3D grass, reeds, ferns
  and flowers, and fuller tree crowns.
- **Ultra:** everything on High, plus a third shadow cascade with
  contact-hardening soft shadows, parallax (3D) textures up close, water
  reflections of the world, denser plants, and full resolution on high-DPI
  screens.

On every preset you get animated water, light that glows through leaves,
haze that thickens with distance, and low mist over water at sunrise and
sunset. Under water, High and Ultra add light shafts from the surface, and
every preset shows drifting particles.

**Settings > Performance** has one-click presets for different computers:

| Preset | For | Graphics | View distance | Details |
| --- | --- | --- | --- | --- |
| Potato | old laptops | Low | 7 chunks | 3 full-detail chunks, coarse far terrain, 70% resolution, few particles |
| Balanced | most PCs | Medium | 12 chunks | preset detail, medium far terrain and effects |
| Beautiful | gaming PCs | High | 20 chunks | fine far terrain, full effects |
| Max | high-end GPUs | Ultra | 32 chunks | 10 full-detail chunks, fine far terrain |
| Extreme | powerful PCs | Ultra | 72 chunks | 14 full-detail chunks, the finest far terrain |

and the individual controls: **full-detail distance** (up to 24 chunks;
Auto uses the preset's), **far terrain (LOD) quality** (up to Extreme),
**resolution scale** (50-200%: above 100% supersamples) and **effects
detail** (particles).

**Render distance** (Settings > Graphics) goes up to 256 chunks, about 4 km
(default 25). The far terrain is built by a pool of worker threads. The area around you is drawn in full detail, and the land beyond it in
simplified level-of-detail tiles, so you can see hills, lakes and forests to
the horizon.

**On slower computers** the game keeps the heavy work off the frame: the
terrain is generated and the full-detail chunks are meshed in one or two
worker threads (by the number of CPU cores), so a fast flight streams new
ground in without stutter; the main thread only lights the chunks and hands
them to the GPU. The larger shadow cascades (High, Ultra) are redrawn every
second or third frame, creatures out of view cast no shadow, terrain faces
turned away from the sun skip the shadow lookup, bullet holes are one draw
call, and the 3D plants rest while you fly high above them. None of this
changes what you see. (`?genWorkers=0` or `?meshWorkers=0` in the address
keeps that work on the main thread, for comparison.)

## Settings reference

Settings (main menu or pause menu) are grouped in tabs; each tab has a
**Reset to defaults** button for just that group. Every change is saved in
the browser at once (no Save button) and comes back exactly the same after a
reload or a later visit: one versioned settings object, read before anything
else is applied, so your values always win over defaults and presets. A
graphics preset sets the individual graphics options (you can change them
afterwards; they are kept), and keeps a render distance you set yourself.
The settings keep a reserved slot in the browser's storage, so even a storage
filled up by big world saves can't stop them from being saved.

| Tab | Settings (default) |
| --- | --- |
| Graphics | Render distance 2-256 chunks (25), graphics preset Low / **Medium** / High / Ultra with individual options, show FPS (on) |
| Performance | One-click presets Potato / Balanced / Beautiful / Max / Extreme; full-detail distance 0-24 (Auto), far terrain quality Low-Extreme (Medium), resolution scale 50-200% (100%), effects detail (High) |
| Controls | Field of view 50-110 (75), mouse sensitivity 0.1-4x (0.6x), invert Y (off), binocular zoom 2-12x (6x) |
| Audio | Master, blocks and footsteps, weapons and explosions, creatures, player, menus |
| Gameplay | Difficulty Peaceful / Easy / **Normal** / Hard, stats on the HUD (off); **Creative only:** creatures spawn (on), time of day and lock |
| Weapons | Laser blaster color Red / Green / Blue (Red), nuke effects intensity Low / Medium / **High**. **Creative only:** grenade and bazooka blast size (1x); airstrike: meteors per strike 1-40 (7), spread 0-80 (22), delay 1-20 s (5 s), fall angle 0-70 degrees (35), fall speed 30-250 (95), meteor blast size (1x); nuke size 12-200 (96) |
| Mobs | **(Creative only)** Zombie spawn rate Off to APOCALYPSE (1x), max zombies 0-400 (8), zombie health and damage 0.25-5x (1x), daylight zombies (off) |
| UFOs | (**All of this tab is Creative only**: in Survival the mission chain sets the sky.) UFO activity Off to UFO APOCALYPSE (Occasional); **advanced:** spawn chance, max UFOs (Auto), aggression (Never attack to 2x), detection range 40-300 (130), tractor beam lift speed (4), sizes (Balanced), night multiplier 1-6x (3x), toughness 0.25-4x (1x) |
| Vehicles | UFO top speed 20-1200 (300) and slowest speed 0.5-8 (2), ghost mode (off), beam lifts loose blocks (on), teleport dash distance Off-3x (1x) and travel time 0.08-0.6 s (0.25 s), jet flight assist (on; the only one Survival keeps), jet top speed 288-2520 km/h (1080), cannon aim assist (on), patrol fighters 0-3 (1), acceleration 0.5-2.5x (1x), turn rate 0.5-2x (1x), stall speed 90-252 km/h (151) |

**Survival fixes the rules of the game.** Every setting that changes weapon stats, creature or UFO numbers and strength, vehicle performance or the clock (marked *Creative only* above) is hidden in Survival, and in Survival the game uses their defaults whatever was set in Creative (switch modes in the pause menu and your Creative values come back). Survival keeps graphics, performance, controls, audio, difficulty, the stats overlay, the blaster color, the nuke's visual intensity and the jet's flight assist.

Heavy values show a short performance note next to the slider (for example
hundreds of zombies, or a long full-detail distance).

## The world

A world at the scale of classic block games, 128 blocks tall, now with very
different landforms: continents and big oceans; **mountain ranges** with bare
rock, snowy peaks and **deep, wide valleys** between their massifs (Round 9:
on about a seventh of the land, half as much as before, but where a range
rises it is as big as ever, up to the top of the world); **lots of flat
land** (about two thirds of the land is level or nearly so: wide plains,
flowery **meadows** with a lone tree here and there, deserts as flat as a
table, room for the jets and the fights); rivers; and big biomes (forests, plains, taigas,
snowy lands, **much larger deserts and jungles** (the jungle has giant old
oaks), savannas, swamps, badlands, meadows), with caves, coal and gold, and
glowing crystals underground. (Iron and diamonds are gone.) Forests and meadows alternate: oaks with irregular crowns and
branches, pale birch groves, dark pine woods on the hills, and rare huge old
oaks with roots spreading over the ground. On High and Ultra the ground
comes alive with grass, reeds along the water, ferns in the shade of trees,
and flowers.

**Villages** (Round 8: bigger: a cobbled plaza with a well, gravel streets,
six to ten houses with windows, farm plots, lamp posts, up to five villagers;
Round 10: wall torches inside every house and beside every door, and a
**chest** with loot in about half the houses, one more in the biggest), and
much bigger **airports and cities**, are rarer (and spread far apart), except for one regular
airport close to where a new world starts (**F3** shows the nearest). The land is levelled under them, distant terrain
included. **Airports** come in three sizes (small field, regional,
international) with runways from 600 to 920 blocks long and 18-26 wide, an
apron, 2-4 hangars, a tower, a terminal, fuel tanks, a radar and parked
fighters (Round 10: at about two airports in five, one of them, now and then
two, waits inside a hangar whose way out is clear; such a hangar has its
torches on the walls. A hangar only takes a fighter where the airport still
keeps room for four, so a group of up to four always finds a jet each);
many hide a **secured underground bunker** (a ramp down from the
apron to a lit hall) with an alien ship inside and armed human guards who
open fire when you enter the restricted zone. **Cities** have streets,
parks, houses, mid-rise blocks and **skyscrapers** up to about 80 blocks with
setbacks, glass walls and rooftop antennas; (Round 10) every building has
**wall torches** beside its door and in its lobby, and about a third of them
a **chest** in a back corner of the lobby (walk in through the door: loot
rolled the first time anyone opens it, like the village chests; the host's
online). At night an airport's runway
lights show the way within the view distance, dimming with distance and
fading into the fog like the land around them. Supply crates are redesigned (planks, steel brackets, a red
cross; cords tied from the crate to the parachute's rim) and only ever land
on dry ground. Grass is shorter and **breakable** (a swing at the ground cuts
it; explosions burn it away), the leaves are more see-through and the view
sways a little with your steps. Craters, nuke craters included, show in the
distant terrain too. **From far away** (Round 8) airports, cities and
villages show as simple shapes in their own colours (hangars, towers,
skyscrapers with their setbacks, houses with roofs) long before their full
detail loads, and at night **airport lights** (runway edges, thresholds,
approach lights, taxiways, the tower's red beacon) are visible from up to
4.5 km, so a runway can be found in the dark. **Deserts** are bigger, and
now and then one stretches for many kilometres.


- An **airport** has a long dark runway with markings, threshold stripes and
  edge lights that glow at night, an apron with hangars and fighters parked
  in front of them (now and then one inside a hangar), a control tower, a
  terminal, fuel tanks, a radar, a few villagers walking about and, often, a
  guarded bunker.
- A **city** is an airport with a grid of streets and lots of all kinds next
  to it: skyscrapers with windows and lit rooms, mid-rise blocks, houses,
  parks, street lamps, wall torches by the doors, chests in some lobbies, and
  a crowd of villagers.

## Sharing a world

Every world is generated from a numeric **seed**. The same seed always
generates the same terrain.

- The seed is shown on the start menu and in the pause menu.
- To share a world, use **Copy world link** in the pause menu, or add
  `?seed=NUMBER` to the page's URL, e.g. `https://your-deployment-url/?seed=12345`.
- Opening the game without `?seed=` continues the last world you played (a
  random new one on the first visit); use **+ New world** for a fresh one.

Your block edits, position, inventory and settings are saved in your
browser's local storage, per seed, on your device only. Other players who
open the same seed link get the untouched world. Creatures and items lying
on the ground aren't saved.

## Running locally

You need [Node.js](https://nodejs.org/) installed (for `npx`), nothing else.
The game itself has no dependencies; `npx serve` is just an easy local
static file server (the game must be served over HTTP, not opened as a
`file://` URL, for ES module imports to work).

**Windows:**
```
start.bat
```

**macOS / Linux:**
```
./start.sh
```

Either script starts a local server and prints a URL (typically
`http://localhost:5173`). Open it in your browser.

## If the game doesn't start

The page shows **Loading…** until the game is running, and if something goes
wrong it says what and what to try. The most common causes:

- **Opened as a file:** double-clicking `index.html` doesn't work, because
  browsers don't run the game's modules from `file://` pages. Use `start.bat`
  or `./start.sh`.
- **Offline:** the 3D engine (three.js) loads from `cdn.jsdelivr.net`.
- **Just updated:** reload with `Ctrl+Shift+R` (`Cmd+Shift+R` on a Mac) so
  the browser doesn't mix old cached files with new ones.
- **Slow first start:** while the shaders compile, the Play button says
  **Preparing graphics…**. On some computers (Windows especially) High and
  Ultra can take a while the first time. If it's too slow, pick a lower
  preset in **Settings > Graphics** (or **Apply** the FPS suggestion on the
  start menu).
- **Graphics card trouble:** if a start never gets as far as showing the
  world, the next start lowers the graphics a step (the start menu says so).
  If the browser loses the graphics card mid-game, the game saves, lowers the
  setting and asks you to reload. To pick a setting from the address bar,
  add `?graphics=low` (or `medium`, `high`, `ultra`).
- **"WebGL couldn't start":** turn on hardware acceleration in the browser's
  settings, update the browser and graphics driver, and restart the browser:
  after a graphics driver crash, browsers keep WebGL off for a while.

## Deploying

This is a static site: the folder can be hosted as is, including on GitHub
Pages. The `.nojekyll` file makes GitHub Pages serve the `js/` folder
correctly. All imports use relative paths.

## Tests

`/tools` has twenty test suites (`cd tools && npm install && npm test`
runs them all; `npm run test:r10` just the Round 10 ones; the browser tests
need a Chromium binary, set with the `CHROMIUM_PATH` environment variable).
`chaos-tests.mjs` takes 400 random steps (missions, modes, vehicles, blasts,
screens, saves, respawns) looking for errors; `perf-tests.mjs` checks the
streaming budget and that worker-built chunks and meshes match the main
thread's byte for byte:

- `mp-damage-tests.mjs` (Round 9): the multiplayer **damage matrix**. A
  host and a guest in two headless pages (real PeerJS + WebRTC, a local
  signaling server); for every weapon (melee, bow, pistol, laser pistol,
  machine gun, laser minigun, sniper rifle, railgun, bazooka, grenade,
  airstrike, the jet's cannon and missiles, the B-2's nuke, the UFO's laser,
  tractor beam and superweapon) and every kind of target (zombie, skeleton,
  spider, cow, villager, the four aliens, a soldier, a UFO, an enemy
  fighter, the other player, a block), first the guest then the host fires
  through the game's own weapon code, and the test checks the target dies
  on the host, the attacker gets the kill, and the other screen shows the
  same (and the health reads the same on both). The pages don't draw (the
  game runs at full speed). A table of results is printed and saved to
  `probe-out/damage-matrix.json`. About 10 minutes;
  `--only=guest|host`, `--weapon=a,b`, `--target=a,b` narrow it.
- `mp-round9-tests.mjs` (Round 9): a host and **two guests** (three pages):
  the goals for three players, Big game, Operation Sunburn and Steal the
  ship with guests (Big game's ship
  the same on every screen, hit by a guest, kept near a guest far from the
  host; Operation Sunburn completed by a guest's nuke; Steal the ship with
  one ship on every screen, boarded by a guest, lost and replaced once),
  respawning around a mission as a guest, call-ins seen by everyone, mode
  switches that leave inventories alone, and creatures spawning around all
  three players 300 blocks apart, none of them born in water. About 3
  minutes.
- `round9-tests.mjs` (Round 9): mission targets kept (Big game, the village
  raid, scouts), Steal the ship's single ship, death messages, respawning
  around a mission, the classic order's last six missions (Scramble! to
  The Armada) and the victory screen, the call-ins,
  mode switching, the flatter terrain and flat spawn, the airport lights'
  fade, no land creatures in water and the blue alien's matte head. About a
  minute.
- `r10-missions-tests.mjs` (Round 10): the random campaign and the smooth
  dusk. Automation plays the classic chain; a drawn campaign plays by its
  places (the tracker, the classified mission list, jets unlocked by mission
  id, crates after the supply drop, a save keeps the campaign); the long
  night's clock eases to dusk (only forward, speeding up then slowing to
  normal speed) and a lost night eases on to the next dusk; a guest mirrors
  the host's campaign (its order, the place's reward, the victory screen on
  the final, the host's dusk on its sky), at the unit level on one page.
  And the new missions: Don't look up (hunters come, kept and angry; the
  clock runs; a player taken sets it back a minute; done, and the hunters
  leave), Crash site (a UFO falls, its wreck and the zone; the clock runs in
  it and stops while an alien is in it; the recovery team; the wreck looted),
  Run for cover (the shelter, the rings and the spotter, the zone and rings
  sent to guests, arriving counts), Sabotage (beacons land, are guarded,
  stay grounded when shot, count when destroyed) and Rescue (carriers run at
  their own pace, count when shot down, captives freed). `--only` takes
  several substrings separated by `|`. About 6 minutes in all. (The
  campaign's rules over hundreds of seeds: `unit-tests.mjs`.)
- `r10-dash-tests.mjs` (Round 10): the UFO dash: a tap ends in view and a
  moment too long on `R` adds nothing (at 60 and 20 frames a second), ghost
  mode while flying dashes along the view (it used to fly off thousands of
  blocks), the held streak gathers speed, never runs far ahead of the drawn
  ground and stops on release, the dash ceiling, the world's edge and bad
  settings, the ghost ram (creatures, UFOs, aircraft once each, half to a
  boss, nothing through a shield, a knock to your own hull; a plain dash
  passes through), and another player's dash drawn with the smear. Under a
  minute.
- `r10-villages-tests.mjs` (Round 10): a village's wall torches hang on real
  walls and light the rooms, and houses have chests facing into the room; a
  torch on the side of a block hangs on it (on top it stands, underneath it
  doesn't go) with its own selection box; right click opens a chest and a
  real shift-click takes a stack; a reload keeps what is left; a broken wall
  drops its torch; a broken chest spills its contents and one put back starts
  empty; meshes of chunks with the new blocks are byte for byte the same from
  the workers. About 2 minutes. `--mp` adds the online checks (a host and a
  guest through a local PeerJS server): the guest sees the host's contents,
  both screens show each other's clicks, a stale click is refused with
  nothing lost, and a chest the guest breaks spills for both.
- `r10-hangars-tests.mjs` (Round 10): an airport with a fighter in a hangar
  (inside, nose to the doorway, lights off, nothing solid overlapping its
  model, the hangar's shell the same as a plain one's), its wall torches on
  real walls and lit, a clear and flat way out to the runway with nothing
  parked in it, as many fighters as before and the same slots for every
  peer, the marker finding it, boarding it, getting out inside onto the
  floor, taxiing out without a scrape, a taken jet keeping its hangar empty
  (here or another player's) and a lost one set out again; a city's chests
  reachable from the street with wall torches on real walls, and a right
  click opening one with loot. About 20 seconds.
- `r10-weapons-tests.mjs` (Round 10): the guns' real bullets and the
  lasers' speed: a machine-gun bullet takes time to reach a far target, the
  lasers outrun every bullet, a very fast bolt over a very long step (a slow
  frame) never passes through a wall or a creature and strikes the nearest
  thing first, and bolts are reused (no garbage per shot). Each check runs
  in one step of the page, so the machine's frame rate doesn't matter.

- `mp-tests.mjs`: multiplayer, with a host and a client in two headless
  pages (two separate browser profiles) connected by the real PeerJS client
  and real WebRTC data channels, through a local PeerJS signaling server
  (the `peer` package, started by the test): opening a room through the
  menus, joining by room code (the invite link and the nickname prompt),
  nicknames, movement sync both ways, a hidden tab that keeps the game
  going, block changes both ways and a race on one block, a client's
  explosion on the host, the host's UFO on the client, a hit (the client's
  pistol on the host's UFO, applied by the host), the host's zombie hunting
  and hurting the client, a shared mission and its reward for both, the
  host-only mode switch, a vehicle claim (the client flies the host's UFO),
  a Dogfight played to the end (kills, deaths, the death limit, VICTORY and
  DEFEAT, clickable results), a client leaving and rejoining with its things
  kept, and the host leaving. Round 8 added: animations seen by the other
  player (sword, swing, bow, shots), PvP on and off (the host's rule), one
  shared world (a supply crate and dropped items, only one player gets
  each), co-op scaling (goals per player, a crate each), a zombie never
  drawn dead while alive, and a **third player** joining through the menus,
  with the mission goal growing when they join mid-mission and shrinking when
  they leave, airports stocked for three, and the host's creatures shared
  with them. About 5 minutes.

- `round6-tests.mjs`: the Round 6 features in the real game: the fullscreen
  control and the cancelled shortcuts, the bow, laser pistol and UFO limits,
  skeleton arrows at point blank, Survival's locked rule settings, no jet
  calls, air brakes (speed, turn, stall, the panels), rolling out of a
  missile, full control during a lock and the salvo charge, UFOs with no
  ceiling, the tractor beam pulling in UFOs and jets, the lock-on salvo, the
  Touchdown, Falling stars and Overlord missions, and the mission chain
  (the classic order of 28 missions since Round 9).
- `round5-tests.mjs`: the Round 5 features in the real game: the defaults,
  jet throttle and speed, loops and rolls, free look (both mouse buttons),
  armor, bunkers with guards, supply drops on dry land, breakable grass, the
  Long Night, the new UFO shapes and the blue alien.
- `round4-tests.mjs`: the Round 4 features in the real game: jet takeoff at
  144, 60 and 20 FPS, the damped bank, missiles (unguided click, locks on
  aircraft only, attackers first, the camera following the target), the jet
  picker and the F-16, patrol fighters, UFO health, the tractor beam, one
  crew kind per UFO, muzzles, bunker UFOs, the UFO camera, held dash and
  ship weapons, the Survival opening played through (skeleton, bow, landing,
  crate, scout), reloads, armor, the chain's locks and rewards, and the
  parrot. About 3 minutes; `--only=word` and `--from=word` as below.
- `round3-tests.mjs`: the Round 3 features in the real game: UFO shots that
  always hurt, attack styles, the UFO redesign, dashes, rogue fighters, the
  jet's paint and night lights, the world and graphics limits, and the
  mission chain. About 5 minutes.
- `settings-tests.mjs`: every setting in every tab changed through the
  menus, then a reload: all values restored and applied; presets vs. later
  changes, corrupted or missing data, a full browser storage, two open tabs,
  a lost graphics context. About 5 minutes.
- `unit-tests.mjs`: fast Node tests of the pure logic (save format, the
  voxel light engine against a brute-force reference, terrain, caves, trees
  and water, mining rules, inventory, collision, explosion falloff,
  distant-terrain meshes, airports and cities, the mission chain (the
  classic order, and 200 random campaigns checked against every ordering
  rule) and the new missions' rules (real stats, an act, a reward and the
  right acts in 300 campaigns; twists and variant goals; the clock set back),
  and loot).
- `ufo-tests.mjs`: the UFO COMBAT features in the real game in headless
  Chromium (menus, settings and presets, weapons, the airstrike, the laser
  blaster, the sniper scope, binoculars, mods on/off, zombie crowds, and the
  UFO, alien and vehicle features, the fighter jet and its weapons, the
  nuke, the full jet-to-UFO scenario, and stats). About 40 minutes with
  software rendering; `--only=word` runs matching checks, `--from=word`
  starts at the first match.
- `round2-tests.mjs`: the Round 2 features in the real game: settings that
  survive reloads, the jet respawn, terrain and view distance, UFO spawn and
  ranges, aliens and skeletons, the new weapons (railgun, minigun, lock-on,
  armor), the jet (takeoff, cannon heat, missile lock and salvos, flares,
  warnings), enemy jets, UFO piloting, airports and cities, supply crates,
  missions and loot, the difficulty curve, and the main menu. It boots a
  fresh page and takes about 20 minutes with software rendering.
- `smoke-test.mjs`: loads the real game in headless Chromium and plays it
  with real keyboard and mouse input: movement, every graphics preset,
  lighting, the level-of-detail terrain, every weapon, falling sand, mining
  and pickup, crafting through the inventory screens, eating, fall and
  drowning damage, the death screen, mobs, the water, shadows, plants and
  atmosphere on Ultra, saving and reloading, and startup. It fails on any
  console error. (It takes over an hour with software rendering.)

`tools/probe.mjs` boots the game and runs a small scenario file, for quick
experiments and screenshots; `--base=/ufo-combat/` serves the game under a
subpath only, like GitHub Pages.

## Tech notes

- Plain ES modules, no bundler. Three.js r160 comes from a CDN through an
  import map pinned to an exact version (see `index.html`).
- Terrain, caves and ore veins use seeded 2D/3D Perlin noise written from
  scratch (`js/noise.js`, `js/terrain.js`).
- Lighting is a Minecraft-style flood-fill voxel light engine (sky light and
  block light) feeding per-vertex smooth lighting and ambient occlusion
  (`js/light.js`, `js/mesher.js`), combined with cascaded soft sun shadows,
  per-pixel relief, HDR bloom, light shafts and ACES tone mapping
  (`js/shaders.js`, `js/postfx.js`). On High and Ultra the water is drawn in
  its own pass over the finished image of the world, for refraction,
  absorption and reflections.
- Distant terrain is a quadtree of simplified tiles built in a Web Worker
  (`js/lod.js`, `js/lod-mesher.js`, `js/lod-worker.js`); trees come from
  `js/trees.js`, ground plants from `js/grass.js`.
- Block textures (32x32), item icons and mob skins are painted pixel by
  pixel in code (`js/textures.js`, `js/itemtextures.js`, `js/mob-models.js`).
- All sounds are synthesized with the Web Audio API (`js/audio.js`).
- Multiplayer is peer-to-peer WebRTC through PeerJS (loaded only when
  used), host-authoritative, in `js/net/`: the session and rooms
  (`session.js`), snapshot interpolation (`interp.js`), players, vehicles
  (owners, puppets, claims), block edits, effects, the host's entities
  with hit claims, rules, the co-op missions and the Dogfight, one module
  each. Design and decisions: `PROGRESS.md`, Round 7.
- See `PROGRESS.md` for the full development log, design decisions, known
  issues and a self-assessment.
