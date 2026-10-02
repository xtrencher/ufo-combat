# UFO COMBAT

A procedurally generated voxel sandbox under alien attack, running entirely
in the browser: no install, no build step, no accounts. Build and survive in
a block world, then take on UFOs with a bow, guns, a railgun, a laser
minigun, homing rockets, meteor airstrikes, two fighter jets (an F-22 and an
F-16, with missiles, flares and a real runway takeoff) and, late in the
game, a flying saucer of your own. Built from scratch with plain JavaScript and
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
(Ctrl+W, Ctrl+T, Ctrl+N) cannot be cancelled outside fullscreen: sprint with a double-tap of `W` instead of `Ctrl+W` there; the browser also asks
before closing the page while you play.

- **Play / Continue** enters the world (the last world you played is
  continued; pick **Survival** or **Creative** with the two cards under the
  button).
- **New World** starts a fresh world, with an optional seed (a number, or any
  text).
- **Settings** has every option, in tabs (Graphics, Performance, Controls,
  Audio, Gameplay, Weapons, Mobs, UFOs, Vehicles), each with **Reset to
  defaults**.
- **Mods** switches the UFO COMBAT content on or off (see below).
- **Controls** lists every key.

Click Play to lock your mouse; **Esc** opens the pause menu (Resume,
Settings, Mods, Stats, Controls, Copy world link, Save & main menu).

- **Survival:** you start with basic gear only (a stone sword, a stone
  pickaxe and five apples) at 17:50 (the golden hour before sunset), and a
  chain of twenty-one **missions** (see below) that starts with a skeleton and
  its bow, goes through jets, a meteor storm and a mothership boss, and
  ends with the slayer's last stand. There is no crafting, and
  missions pay in apples and golden apples only: weapons come from the
  places that make sense (the skeleton's bow, standard weapons in **supply
  crates** that drop by parachute with orange smoke, alien weapons from
  alien leaders). The fighter jets (parked at airports) join with mission 10, alien ships with
  mission 17. Watch your hearts: falls, drowning, zombies, aliens and your
  own grenades and rockets can all kill you.
- **Creative:** every weapon in your hotbar and inventory, every block and
  item in the tabbed **E** palette, instant mining, flight, and no damage.

You can switch modes at any time in the pause menu. Each world remembers its
mode, your position, inventory and health.

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

### Survival basics

- **Health:** 10 hearts. They come back slowly on their own; food heals
  faster (apples, cooked meat). A **golden apple** heals fully and adds four
  golden hearts on top that soak damage first.
- **Mining:** harder blocks take longer; the right tool is much faster.
  Stone and coal need a pickaxe; gold needs a stone pickaxe or better. Tools wear
  out. There is **no crafting**: tools drop from UFOs, aliens and supply crates.
- **Caves and ores:** caves wind underground with coal and gold (iron and
  diamonds are gone: nothing uses them any more; old iron and diamond ore
  blocks in older worlds still break, into cobblestone). Glowing lumen
  crystals grow on deep cave ceilings.
- **Armor** (Round 5; the shield is gone): four slots (head, chest, legs,
  feet) in four tiers (leather, gold, iron, diamond). Every defense point
  turns away 4% of the damage (up to 80%), the HUD shows an armor bar, and
  every hit wears each piece. Pick a piece up with its slot free and it is
  worn at once; right click one in your hand, or use the armor row in the
  inventory. Aliens, UFOs, supply crates and bunker guards drop armor, better
  the further the mission chain has got. Falls, drowning and fire go through.
- **Dying** shows a big red **NOOB!** with the cause. You drop everything
  where you died and respawn at the world spawn with full health.

### Missions, loot and supply crates (Survival)

- **Missions:** twenty-one of them, one after another, shown top right with a
  progress bar per objective, the target's distance and direction, and a
  yellow **marker** over the target (an arrow at the screen's edge when it is
  behind you). **Esc > Missions** lists them all with their rewards, which
  are only ever apples and golden apples.

  | # | Mission | What to do | Reward |
  | --- | --- | --- | --- |
  | 1 | The archer | Kill a skeleton with your sword and take its **bow** | 3 apples |
  | 2 | Visitors | A small UFO lands; its two aliens look around (about 35 s) before they attack: kill them (bow, or sword in melee) | 4 apples |
  | 3 | Supply drop | Open the supply crate dropped for you: the **pistol** | 3 apples |
  | 4 | First contact | Shoot down a small scout UFO | Golden apple |
  | 5 | The crew | Kill the aliens that climb out of the wreck | Golden apple, 2 apples |
  | 6 | The long night | The clock jumps ahead to dusk: survive the night (about 4 minutes) without dying; three alien landing parties come. A death restarts the night | Golden apple, 4 apples |
  | 7 | Laser patrol | Wipe out a landed green patrol; its leader carries the **laser blaster** | Golden apple |
  | 8 | Scout hunter | Shoot down three UFOs | 2 golden apples |
  | 9 | Gray squad | Wipe out a gray squad; its leader carries the **laser minigun** | 2 golden apples |
  | 10 | Take to the air | Take a jet (F-22 or F-16) parked at an airport and take off | 2 golden apples |
  | 11 | Touchdown | Land a jet on an airport's runway and stop; a red squad then drops in on the ground: finish it (get out with `F`) | 2 golden apples |
  | 12 | Dogfight | Shoot down two UFOs from the jet | 2 golden apples |
  | 13 | Air superiority | Shoot down the hijacked fighter hunting you | 2 golden apples |
  | 14 | Village under attack | Shoot down three raiders burning a village (5 minutes) | 3 golden apples |
  | 15 | Red brutes | Wipe out a red squad; its leader carries the **railgun** | 3 golden apples |
  | 16 | Falling stars | A meteor storm at night: dodge the rocks (a red ring marks each landing 4.5 s ahead) and collect four glowing star fragments from the craters before alien salvagers take them | 4 golden apples |
  | 17 | Salvage | The next UFO you down lands intact: board it (alien ships, hangar ones too, are yours from now on) | 3 golden apples |
  | 18 | Big game | Bring down a large UFO | 4 golden apples |
  | 19 | Operation Sunburn | Nuke the airport the aliens turned into a base | 8 golden apples |
  | 20 | The Overlord | **Boss:** a shielded mothership. Shoot down its pylons to drop the shield, then hit the hull (the railgun is made for it) before the shield returns: three shield rounds, an escort, and a red squad dropped on you. Doable on foot | 12 golden apples |
  | 21 | UFO slayer | Shoot down twenty-five more | 10 golden apples |

  Each mission also sets the sky, and in Survival **only the missions do**
  (the UFO activity, spawn chance, max count and size settings are
  Creative's and hidden in Survival): no UFOs at all for the first two
  missions, then a single small one, then more and bigger ones (medium,
  large, motherships and, at the very end, giants), with health, damage,
  aggression and numbers growing along the chain. Every UFO carries one kind
  of alien (green early, grays and reds later).
- **Where weapons come from** (each lane has its own weapons, so nothing
  arrives twice or out of order):
  - **The skeleton** (mission 1): the bow.
  - **Supply crates** (the first one with mission 3, then every 1.5 to 3 minutes
    after it): a standard weapon you don't have yet while any are left, the
    lower ones first as the chain unlocks them (pistol; grenades, machine
    gun, armor; sniper rifle; bazooka; airstrike designator), plus golden
    apples, food and sometimes a tool.
  - **Aliens:** their leaders (missions 7, 9 and 15) carry the alien
    weapons: laser blaster, laser minigun, railgun. Later on ordinary aliens
    of that kind or stronger can drop one you missed. Otherwise aliens drop
    food, tools and golden apples, better the further you are.
  - **Missions:** apples and golden apples only.
  - Downed UFOs and enemy fighters drop food, tools and golden apples.
- **Supply crates:** a crate drifts down on a parachute near you, trailing
  orange smoke (the tracker shows how far it is). Walk up to it.
- **Difficulty curve:** follows the missions (see above).

### Creatures

- **Fluffalo:** a shaggy, humped grazer with a cream mane. Drops fluff (4
  fluff craft into wool) and raw meat.
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

- **Pistol:** real bullets (fast projectiles, 240 blocks/s) with a muzzle
  flash and recoil. Bullets spark and leave holes in blocks, and hurt and
  push back creatures.
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
- **Machine gun:** hold right click for automatic fire with tracers and
  climbing recoil.
- **Sniper rifle:** right click scopes in (a zoomed view through a scope),
  left click fires a long-range, high-damage shot.
- **Laser pistol (blaster):** short glowing sci-fi bolts in red, green or blue
  (**Settings > Weapons**) that glow, spark on impact and leave scorch marks.
  Hold right click for continuous fire: it never reloads, but each bolt is
  a little weaker (6) than the pistol's round at full rate (5 per shot, but a
  magazine to reload).
- **Railgun:** hold right click for about a second (glowing coils, a rising
  whine), then one extremely bright beam that **destroys every block along
  its line** and hits every creature, UFO and vehicle in it, very hard.
- **Laser minigun:** hold right click: the barrels spin up for a second, then
  a huge stream of laser bolts.
- **Airstrike designator:** aim its laser and right click. After the delay a
  shower of meteors screams in at an angle from high up and far away: each
  one has a glowing, white-hot core, a heat glow, a fiery tail and a long
  smoke trail, and lands with a flash, a shockwave and a crater. Settings:
  meteors per strike, spread radius, delay, fall angle, fall speed and
  explosion size.

Explosions shake the camera and sound quieter, more muffled and later the
farther away they are. Sand and gravel fall when the ground under them is
blown away.

## UFOs (Mods on)

UFOs roam the skies anywhere from treetop height to high overhead. They are
**plain, clean shapes** (they look real because they are simple: no
lights, panels or portholes): **smooth saucers** are the most common (lens,
flat disc and gently domed, each with its own proportions), then **gray-black
spheres** with a grainy surface, **white tic-tacs**, **tori** (rings), rounded
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
restricted zone; in Survival boarding works from mission 15,
"Salvage"; before that they are locked), or in Creative spawn one from the
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
| Boost (3x) | `Ctrl` |
| The ship's own weapon (what its kind fires: rapid bursts, heavy plasma, spread fans, charged shots, a sweeping beam, seeker plasma or pulse bolts; bigger ships hit harder) | Left click |
| Tractor beam: works at **any altitude**; lifts creatures and loose blocks, and a bigger ship also **pulls in and swallows smaller UFOs** (at least 1.3x smaller) **and enemy jets** (ship radius 6.5+) | Hold right click |
| **Lock-on salvo**: lock the UFO, jet or hostile creature nearest the crosshair; after 3 s a salvo of homing laser bolts (more for bigger ships) leaves by itself; let go earlier to cancel; 7 s to recharge | Hold `T` |
| **Teleport dash**: the ship streaks along the view at extreme speed (a split second; distance, travel time or off in Settings > Vehicles; shown in the I panel). **Hold** `R` to keep streaking, with no distance limit. Every ship has its own random dash speed (about 900-3500 b/s) | `R` |
| **Superweapon**: after a short charge, a huge laser straight down; hold the ship moving and it carves a continuous trench along its path | `B` |
| **Ghost mode** (fly through terrain; shown in the HUD) | `G` |
| Chase camera / far / belly view | `F5` |
| Stats and controls | `I` |

**Settings > Vehicles:** top and slowest speed, **ghost mode** (fly through
the terrain, burning a tunnel), whether the beam lifts blocks, and the
**teleport dash** distance (Off, 0.5x-3x) and travel time (0.08-0.6 s). Creatures
you beam up are "stored": their drops go to your inventory, as do the blocks.

### Fighter jet

**There is no calling in a jet:** fighters stand **parked at airports**, in front
of the hangars (F-22 Raptors and F-16 Fighting Falcons): walk up to one and
press **F**. In Survival that works from mission 10, "Take to the air" (the
marker points at the nearest parked fighter; **F3** shows the nearest airport).
The **F-22 Raptor** is a heavy stealth fighter (160 health, faster,
four-missile salvos); the **F-16 Fighting Falcon** is light and agile (130
health, turns and rolls harder, a faster-firing cannon, a shorter takeoff
roll, two-missile salvos). The F-22 is a
detailed model (canopy frame, pilot, probes, folding landing gear, a layered
afterburner) in a satin grey paint with panel lines and a subtle two-tone
livery that catches the sun and the moon, so it is clearly visible at night;
both jets have a skin shader with panel tones, soot behind the engines and
faint streaks. Their small navigation, strobe and formation lights switch
on only at night.

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
It can't hover. **Takeoff is a real ground roll** and forgiving: full
throttle, a few seconds on the wheels, the nose rises at flying speed (flight
assist does it for you), the wheels leave the ground and fold away; small
angles and imperfect runways are fine. **Landing is reliable**: come in
level, wheels first, at a reasonable sink rate, and the jet rolls out; hold
`Space` for the wheel brakes until it stops. On the ground, `S` at 0% throttle
**reverses slowly**. A hard slam or a nose/wing-first hit still destroys it,
and you with it, unless you **eject** (F in the air: the seat fires you out
and a parachute opens). Both jets are agile: **full 360 degree rolls** (hold
`A`/`D`; it stops cleanly when you let go) and **loops** work, with the aim
and the jet handled as quaternions so nothing flips at the top. **Free look:
hold both mouse buttons** to freeze the controls and look around freely; the
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
| **Missile lock** | **Hold** right click: the UFO or aircraft nearest the middle of your view (even behind you; ones **attacking you** first; never creatures) is locked, the camera turns to look at it **while you keep full control of the jet** (the mouse still steers, a ring on the HUD shows where; every key works). Release after **1 s** for one missile, after **3 s** (F-22) or **2 s** (F-16) for a **salvo** (four or two). A missile at a target behind you turns around. The lock is **stable**: once locked, it stays on that target until you let go, it dies or it is more than 2200 blocks away. Locking does not anger other UFOs. After launch the **camera follows the target until the hit** and **you keep full control** of the jet; right click brings the normal view back at once. Let go before LOCKED and nothing fires |
| **Salvo charge** | From the solid lock to the salvo time a **ring fills around the target box**, one **pip per missile** lights up with a rising click (4 on the F-22, 2 on the F-16), the box shakes and the screen edge glows orange; at SALVO the ring spins and the pips pulse |
| **Roll out of a missile** | A hostile missile that gets close when you have **rolled more than about 90 degrees** (either way) loses you and **passes narrowly by** ("MISSILE EVADED!"); it needs a few seconds before it works again, so rolling all the time does not make you immune. Flares still work as always |
| **Flares** | `C` (a burst of decoys; they fool missiles and seeking shots, which may even turn on whoever fired them) |
| Nuclear bomb | `B` (it drops on a parachute: get clear! No cooldown) |
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
one exception is the hijacked fighter of mission 12, in a darker paint.
**Settings > Vehicles:** how many patrol at once (0-3, default 1).

**The nuke** goes off with a blinding white flash, a fireball, a shockwave
racing over the ground, a huge crater, a scorched blast zone and a
mushroom cloud that climbs for a minute; the boom is heard, late and
muffled, from far away. The default **size is 96** (the old maximum; the
Creative setting goes up to 200): the crater is **very wide** (its radius is the
size, deep as before: about 30 blocks) and **everything within about 1.3x
the size is destroyed**: trees (trunks and leaves), grass and plants (nothing is
left floating), houses, city blocks, hangars, towers and **runways, aprons and
streets**, in a wave that spreads out from the centre like the shockwave. Out to
twice the size the ground is scorched and the topmost leaves burn off.
**Settings > Weapons:** nuke size (12-200, default 96) and effects intensity.

## Stats

The pause menu's **Stats** screen counts, for this world and for all your
worlds: UFOs shot down, play time, aliens, zombies and skeletons killed, deaths,
abductions survived, times abducted, creatures you abducted, UFOs boarded,
jets called in, missile hits, nukes dropped, fighters (hijacked or patrol) and
motherships/giants shot down, and supply crates opened. **Settings > Gameplay >
Stats on the HUD** shows UFOs shot down and play time in a corner (off by
default).

## Mods

**Mods** (main menu or pause menu) switches all the UFO COMBAT content on
or off. It's on by default. Off gives plain vanilla survival and creative:
no guns, explosives, vehicles, UFOs or aliens (swords and tools stay).
Switching mid-game is instant and clean: mod items are put away and come
back to the same slots when you switch mods on again; projectiles, UFOs,
aliens and vehicles leave the world.

## Graphics and performance

**Graphics presets** (start menu, or Settings > Graphics):

- **Low:** no shadows or post-processing. For weak laptops.
- **Medium:** sun shadows and bloom.
- **High:** two cascades of soft sun shadows, normal-mapped textures with
  specular light, refractive water, light shafts, 3D grass, reeds, ferns
  and flowers, and fuller tree crowns.
- **Ultra** (default): everything on High, plus a third shadow cascade with
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
(default 10). The far terrain is built by a pool of worker threads. The area around you is drawn in full detail, and the land beyond it in
simplified level-of-detail tiles, so you can see hills, lakes and forests to
the horizon.

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
| Graphics | Render distance 2-256 chunks (25), graphics preset Low / Medium / High / **Ultra** with individual options, show FPS (on) |
| Performance | One-click presets Potato / Balanced / Beautiful / Max / Extreme; full-detail distance 0-24 (Auto), far terrain quality Low-Extreme (Medium), resolution scale 50-200% (100%), effects detail (High) |
| Controls | Field of view 50-110 (75), mouse sensitivity (1x), invert Y (off), binocular zoom 2-12x (6x) |
| Audio | Master, blocks and footsteps, weapons and explosions, creatures, player, menus |
| Gameplay | Difficulty Peaceful / Easy / **Normal** / Hard, stats on the HUD (off); **Creative only:** creatures spawn (on), time of day and lock |
| Weapons | Laser blaster color Red / Green / Blue (Red), nuke effects intensity Low / Medium / **High**. **Creative only:** grenade and bazooka blast size (1x); airstrike: meteors per strike 1-40 (7), spread 0-80 (22), delay 1-20 s (5 s), fall angle 0-70 degrees (35), fall speed 30-250 (95), meteor blast size (1x); nuke size 12-200 (96) |
| Mobs | **(Creative only)** Zombie spawn rate Off to APOCALYPSE (1x), max zombies 0-400 (8), zombie health and damage 0.25-5x (1x), daylight zombies (off) |
| UFOs | (**All of this tab is Creative only**: in Survival the mission chain sets the sky.) UFO activity Off to UFO APOCALYPSE (Occasional); **advanced:** spawn chance, max UFOs (Auto), aggression (Never attack to 2x), detection range 40-300 (130), tractor beam lift speed (4), sizes (Balanced), night multiplier 1-6x (3x), toughness 0.25-4x (1x) |
| Vehicles | UFO top speed 20-1200 (300) and slowest speed 0.5-8 (2), ghost mode (off), beam lifts loose blocks (on), teleport dash distance Off-3x (1x) and travel time 0.08-0.6 s (0.25 s), jet flight assist (on; the only one Survival keeps), jet top speed 288-2520 km/h (576), cannon aim assist (on), patrol fighters 0-3 (1), acceleration 0.5-2.5x (1x), turn rate 0.5-2x (1x), stall speed 90-252 km/h (151) |

**Survival fixes the rules of the game.** Every setting that changes weapon stats, creature or UFO numbers and strength, vehicle performance or the clock (marked *Creative only* above) is hidden in Survival, and in Survival the game uses their defaults whatever was set in Creative (switch modes in the pause menu and your Creative values come back). Survival keeps graphics, performance, controls, audio, difficulty, the stats overlay, the blaster color, the nuke's visual intensity and the jet's flight assist.

Heavy values show a short performance note next to the slider (for example
hundreds of zombies, or a long full-detail distance).

## The world

A world at the scale of classic block games, 128 blocks tall, now with very
different landforms: continents and big oceans; **mountain ranges** that are
broader and bigger, with bare rock, snowy peaks and **deep, wide valleys**
between their massifs; **very flat country** (about a seventh of the land is
nearly level: wide plains, flowery **meadows** with a lone tree here and there,
deserts as flat as a table); rivers; and big biomes (forests, plains, taigas,
snowy lands, **much larger deserts and jungles** (the jungle has giant old
oaks), savannas, swamps, badlands, meadows), with caves, coal and gold, and
glowing crystals underground. (Iron and diamonds are gone.) Forests and meadows alternate: oaks with irregular crowns and
branches, pale birch groves, dark pine woods on the hills, and rare huge old
oaks with roots spreading over the ground. On High and Ultra the ground
comes alive with grass, reeds along the water, ferns in the shade of trees,
and flowers.

**Villages** (a few houses and a farm), and much bigger **airports and
cities**, are rarer (and spread far apart), except for one regular
airport close to where a new world starts (**F3** shows the nearest). The land is levelled under them, distant terrain
included. **Airports** come in three sizes (small field, regional,
international) with runways from 600 to 920 blocks long and 18-26 wide, an
apron, 2-4 hangars, a tower, a terminal, fuel tanks, a radar and parked
fighters; many hide a **secured underground bunker** (a ramp down from the
apron to a lit hall) with an alien ship inside and armed human guards who
open fire when you enter the restricted zone. **Cities** have streets,
parks, houses, mid-rise blocks and **skyscrapers** up to about 80 blocks with
setbacks, glass walls and rooftop antennas. Mountains are bigger, with snow
on the peaks. Supply crates are redesigned (planks, steel brackets, a red
cross; cords tied from the crate to the parachute's rim) and only ever land
on dry ground. Grass is shorter and **breakable** (a swing at the ground cuts
it; explosions burn it away), the leaves are more see-through and the view
sways a little with your steps. Craters, nuke craters included, show in the
distant terrain too.


- An **airport** has a long dark runway with markings, threshold stripes and
  edge lights that glow at night, an apron with hangars and fighters parked
  in front of them, a control tower, a terminal, fuel tanks, a radar, a few
  villagers walking about and, often, a guarded bunker.
- A **city** is an airport with a grid of streets and lots of all kinds next
  to it: skyscrapers with windows and lit rooms, mid-rise blocks, houses,
  parks, street lamps, and a crowd of villagers.

## Sharing a world

Every world is generated from a numeric **seed**. The same seed always
generates the same terrain.

- The seed is shown on the start menu and in the pause menu.
- To share a world, use **Copy world link** in the pause menu, or add
  `?seed=NUMBER` to the page's URL, e.g. `https://your-deployment-url/?seed=12345`.
- Opening the game without `?seed=` generates a new random world each time.

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
  **Graphics** setting right on the start menu.
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

`/tools` has nine test suites (`cd tools && npm install && npm test`; the
browser tests need a Chromium binary, set with the `CHROMIUM_PATH`
environment variable):

- `round6-tests.mjs`: the Round 6 features in the real game: the fullscreen
  control and the cancelled shortcuts, the bow, laser pistol and UFO limits,
  skeleton arrows at point blank, Survival's locked rule settings, no jet
  calls, air brakes (speed, turn, stall, the panels), rolling out of a
  missile, full control during a lock and the salvo charge, UFOs with no
  ceiling, the tractor beam pulling in UFOs and jets, the lock-on salvo, the
  Touchdown, Falling stars and Overlord missions, and the 21-mission chain.
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
  distant-terrain meshes, airports and cities, the mission chain and loot).
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
- See `PROGRESS.md` for the full development log, design decisions, known
  issues and a self-assessment.
