# UFO COMBAT

A procedurally generated voxel sandbox under alien attack, running entirely
in the browser: no install, no build step, no accounts. Build and survive in
a block world, then take on UFOs with guns, a railgun, a laser minigun,
homing rockets, meteor airstrikes, a fighter jet (with missiles, flares and a
real runway takeoff) and, once you've shot one down, a flying saucer of your
own. Built from scratch with plain JavaScript and
[Three.js](https://threejs.org/).

Everything is generated in code at runtime: the terrain, every block
texture, item icon and mob skin, the models, and all the sound effects.
There are no image, model or audio files.

## Play

Open the game (see **Running locally** below). The main menu flies slowly
over your world at sunset while UFOs drift by. **Click one to shoot it**: a
few hits and it blows up (the next one comes by sooner). The menu shows a
live **FPS** counter; if it runs poorly it suggests a lower graphics preset.
The default preset is **Ultra**; anything you choose is saved and always wins.

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

- **Survival:** you start with a **pistol** only, at 17:50 (the golden hour
  before sunset), and a chain of fifteen **missions** (see below) that starts
  with one small scout UFO and ends with nuking an alien base. There is no
  crafting: better weapons and tools come from mission rewards, shooting UFOs
  and their alien crews, and **supply crates** that drop by parachute with
  orange smoke. Your fighter jet joins with mission 8. Watch your hearts:
  falls, drowning, zombies, aliens and your own grenades and rockets can all
  kill you.
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
| **Binoculars** (a strong zoom, with a rangefinder) | Hold **both** mouse buttons |
| Select hotbar slot | `1`-`9` or scroll wheel |
| Inventory (in Creative: every block, tool and weapon, in tabs) | `E` |
| Drop the held item (whole stack with `Ctrl`) | `Q` |
| Fly up / down (Creative) | Double-tap `Space` to toggle, then `Space` / `Shift` |
| Pick the targeted block (Creative) | Middle click |
| Pause menu | `Esc` (also steps back out of any menu screen) |
| Board / leave a vehicle (Mods on) | `F` |
| Stats and controls of the vehicle you are in | `I` |
| Call your fighter jet (Mods on; in Survival from mission 8) | `J` |
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
  Stone and coal need a pickaxe; iron needs a stone pickaxe or better; gold
  and diamonds need iron or better. Tools wear out. There is **no
  crafting**: tools drop from UFOs, aliens and supply crates; ores give
  their ingots directly.
- **Caves and ores:** caves wind underground with coal, iron, gold and, deep
  down, diamonds. Glowing lumen crystals grow on deep cave ceilings.
- **Dying** shows a big red **NOOB!** with the cause. You drop everything
  where you died and respawn at the world spawn with full health.

### Missions, loot and supply crates (Survival)

- **Missions:** fifteen of them, one after another, shown top right with a
  progress bar per objective, the target's distance and direction, and a
  yellow **marker** over the target (an arrow at the screen's edge when it is
  behind you). **Esc > Missions** lists them all with their rewards.

  | # | Mission | What to do | Reward |
  | --- | --- | --- | --- |
  | 1 | First contact | Shoot down a small scout UFO with your pistol | Grenade, stone sword, food |
  | 2 | The crew | Kill the two aliens that climb out of the wreck | Machine gun |
  | 3 | Supply drop | Open the supply crate dropped for you | Iron sword |
  | 4 | The long night | Survive a night, dusk to dawn, without dying | Laser blaster |
  | 5 | Salvage | The next UFO you down lands intact: board it | Energy shield |
  | 6 | Scout hunter | Shoot down three UFOs | Sniper rifle |
  | 7 | Alien squad | Wipe out a landed squad of six aliens | Bazooka |
  | 8 | Take to the air | Call your jet and take off | Jet Radio |
  | 9 | Dogfight | Shoot down two UFOs from the jet | Airstrike designator |
  | 10 | Air superiority | Shoot down the enemy fighter hunting you | Laser minigun |
  | 11 | Village under attack | Shoot down three raiders burning a village (5 minutes) | Diamond sword and pickaxe |
  | 12 | Big game | Bring down a large UFO | Railgun |
  | 13 | Mothership | Destroy a mothership and its escort | Golden apples |
  | 14 | Operation Sunburn | Nuke the airport the aliens turned into a base | Golden apples |
  | 15 | UFO slayer | Shoot down twenty-five more | Golden apples |

  Each mission also sets the sky: at first only a few small, weak UFOs
  (early ones go down to a pistol), then medium, large, motherships and, at
  the very end, giants, with health, damage, aggression and numbers growing
  along the chain. Your UFO settings still apply on top.
- **Loot:** downed UFOs and fallen aliens drop items, and the better the
  more you have done: green aliens drop food and basic gear, gray ones more,
  red elites the best; big UFOs drop several items. Weapons you already own
  are never dropped again.
- **Supply crates:** every few minutes a crate drifts down on a parachute
  near you, trailing orange smoke (the tracker shows how far it is). Walk up
  to it: a weapon you don't have yet, golden apples, maybe a shield or a tool.
- **Difficulty curve:** follows the missions (see above).

### Creatures

- **Fluffalo:** a shaggy, humped grazer with a cream mane. Drops fluff (4
  fluff craft into wool) and raw meat.
- **Hoplet:** a striped little hopper with tall ears. Quick to flee.
- **Mossback:** a slow, moss-covered tortoise that hides in its shell when
  hit.
- **Cows, pigs and chickens** graze in the meadows; **villagers** wander
  their villages; **butterflies**, **parrots** and **fish** add life.
- **Zombie:** comes out in the dark (at night, or in unlit caves), chases
  you, and hits hard. Zombies burn in daylight. Swords recharge between
  swings (watch the bar under the crosshair); hit while falling for a
  critical hit.
- **Skeletons** shoot real arrows; **spiders** climb walls.

**Zombie settings** (Settings > Mobs): spawn rate (off to 50x, the
"APOCALYPSE"), maximum count (up to 400), health and damage multipliers,
and daylight zombies (they spawn by day and don't burn). Far zombies are
drawn as simplified crowds and think less often, so hundreds stay playable;
a note warns next to the heavy values.

### Weapons (Mods on)

Survival starts with the pistol; Creative has them all (the hotbar first, the
rest in the inventory). With one selected, right click uses it instead of
placing a block. There's no ammo and no reloading, and every weapon has its
own cooldown, so none of them blocks another.

- **Pistol:** hitscan shots with a muzzle flash and recoil. Bullets spark and
  leave holes in blocks, and hurt and push back creatures.
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
- **Laser blaster:** short glowing sci-fi bolts in red, green or blue
  (**Settings > Weapons**) that glow, spark on impact and leave scorch marks.
  Hold right click for repeat fire.
- **Railgun:** hold right click for about a second (glowing coils, a rising
  whine), then one extremely bright beam that **destroys every block along
  its line** and hits every creature, UFO and vehicle in it, very hard.
- **Laser minigun:** hold right click: the barrels spin up for a second, then
  a huge stream of laser bolts.
- **Energy shield:** hold right click to raise it (a curved force field
  shimmers in front of you; a bar shows its energy). It soaks explosions and
  attacks (a quarter of an explosion and about a third of other hits get
  through) but drains, and breaks (and recharges slowly) if you ask too much.
  Falls and drowning aren't stopped.
- **Airstrike designator:** aim its laser and right click. After the delay a
  shower of meteors screams in at an angle from high up and far away: each
  one has a glowing, white-hot core, a heat glow, a fiery tail and a long
  smoke trail, and lands with a flash, a shockwave and a crater. Settings:
  meteors per strike, spread radius, delay, fall angle, fall speed and
  explosion size.
- **Jet Radio:** calls in your fighter jet (see **Vehicles**).

Explosions shake the camera and sound quieter, more muffled and later the
farther away they are. Sand and gravel fall when the ground under them is
blown away.

## UFOs (Mods on)

UFOs roam the skies anywhere from treetop height to high overhead. They are
**plain, clean shapes** (they look real because they are simple: no
lights, panels or portholes): **smooth saucers** are the most common (lens,
flat disc and gently domed, each with its own proportions), then **gray-black
spheres** with a grainy surface, **white tic-tacs**, **tori** (rings), rounded
**cubes** and square **cube-rings**. Finishes vary: brushed metal, satin,
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
- **On foot:** a hostile UFO races over, stops above you and lifts you in a
  cone of blue light. Reach the ship and you're **abducted**. Get out of the
  light (you can still move), hide under a roof, or shoot it down. After you
  respawn, UFOs leave you alone for half a minute.
- **Shot down:** its lights go out and it falls. Over land it crashes, and
  then either **explodes into a burnt-out wreck** (unusable) or **lands in
  one piece**, embedded in the ground, and can be boarded with **F** and
  flown (damaged, but it works). Over the sea it sinks below the surface.
  Between **1 and 10 aliens** climb out (more from bigger ships): **green**
  ones with pistols, **gray** ones with fast three-shot bursts, and tough
  **red** ones with plasma. They face you when they shoot and chase you the
  moment they are out.
- **In your jet** each UFO has a personality: most flee (a bit slower than
  the jet at full throttle, so you can catch them), some are faster and get
  away, and fighters attack you with lasers and head-on passes.
- **Enemy jets** (below) patrol the sky in a darker paint. Most take the UFOs'
  side once you attack them; some rogue pilots go after UFOs on their own.

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

Board a crashed UFO, or in Creative spawn one from the **Mods** screen (any
shape and size). It has no physics limits: it hovers perfectly still and
moves instantly in any direction.

| Action | Key |
| --- | --- |
| Look / steer | Mouse |
| Move along the view / back | `W` / `S` |
| Sideways | `A` / `D` |
| Up / down | `Space` / `Shift` |
| Cruising speed | Mouse wheel (from a slow hover to extremely fast) |
| Boost (3x) | `Ctrl` |
| Laser cannon (big ships fire several barrels, all aimed at the crosshair) | Left click |
| Tractor beam (lifts creatures, and loose blocks, into the ship) | Hold right click |
| **Teleport dash**: the ship streaks along the view at extreme speed (a split second; distance, travel time or off in Settings > Vehicles; shown in the I panel) | `R` |
| **Superweapon**: after a short charge, a huge laser straight down that burns a shaft through the ground | `B` |
| Chase camera / far / belly view | `F5` |
| Stats and controls | `I` |

**Settings > Vehicles:** top and slowest speed, **ghost mode** (fly through
the terrain, burning a tunnel), whether the beam lifts blocks, and the
**teleport dash** distance (Off, 0.5x-3x) and travel time (0.08-0.6 s). Creatures
you beam up are "stored": their drops go to your inventory, as do the blocks.

### Fighter jet

Press **J** (or right click with the **Jet Radio**) to call in your F-22
style stealth fighter (in Survival from mission 8; always in Creative): a
detailed model (canopy frame, pilot, probes, folding landing gear, a layered
afterburner) in a satin grey paint with panel lines and a subtle two-tone
livery that catches the sun and the moon, so it is clearly visible at night.
Its navigation, strobe and formation lights switch on only at night. It lands on the **runway of a nearby
airport** if there is one, or on any flat strip, or, if there's no flat ground
around (or **Settings > Vehicles > Called-in jet arrives airborne** is on),
it arrives in the air with you already in the cockpit. Airports also have
fighters parked in front of the hangars: walk up and press **F**.

It flies like a jet (the flight model of the first UFO COMBAT build): thrust
from the throttle (and the afterburner), lift that needs airspeed, drag,
gravity, and a stall below the stall speed (the nose drops). It can't hover.
**Takeoff is a real ground roll**: full throttle, about 130 blocks on the
wheels (less with the afterburner), the nose rises at flying speed (flight
assist does it for you), the wheels leave the ground and fold away. Land gently, level and wheels first, gear down. Hitting
the ground any other way destroys it, and you with it, unless you **eject**
(F in the air: the seat fires you out and a parachute opens).

| Action | Key |
| --- | --- |
| Steer | Mouse (with **flight assist**, the default: fly toward the crosshair; the little nose marker shows where the jet points) |
| Throttle up / down | `W` / `S` |
| Afterburner | `Shift` |
| Roll | `A` / `D` |
| Rudder (yaw) | `Q` / `E` |
| Air brake / wheel brakes | `Space` |
| Autocannon (tracers) | Left click (aims a little for you; **overheats** after about two seconds: watch the heat bar) |
| **Missile lock** | **Hold** right click: the target nearest the middle of your view (even behind you) is locked, the camera turns to look at it. Release after **1 s** for one missile, after **3 s** for a **salvo of four**. A missile at a target behind you turns around. Let go before LOCKED and nothing fires: the camera just turns back |
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
Vehicles:** top speed up to 2500 km/h (default about 580), acceleration, turn
rate, stall speed, flight assist, cannon aim assist, enemy jets, and whether
the jet arrives airborne.

**Enemy jets:** there are hostile fighters too. They patrol high up,
**neutral**, until you attack them or (most of them) shoot at UFOs: then they
hunt you, first with missiles from a distance and then with their cannon,
drop flares and break away from your missiles. Shoot one down for good loot.
Some are **rogue pilots** that now and then attack a UFO on their own (the
UFO fights back and dodges): handy, but they never clear the sky for you
(weaker against UFOs, long pauses, at most two kills, and their kills don't
count as yours). **Settings >
Vehicles:** how many patrol at once (0-3, default 1).

**The nuke** goes off with a blinding white flash, a fireball, a shockwave
racing over the ground, a huge crater, a scorched blast zone and a
mushroom cloud that climbs for a minute; the boom is heard, late and
muffled, from far away. **Settings > Weapons:** nuke size (12-96, default 44)
and effects intensity.

## Stats

The pause menu's **Stats** screen counts, for this world and for all your
worlds: UFOs shot down, play time, aliens and zombies killed, deaths,
abductions survived, times abducted, creatures you abducted, UFOs boarded,
jets called in, missile hits, nukes dropped, enemy jets and
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
| Graphics | Render distance 2-256 chunks (10), graphics preset Low / Medium / High / **Ultra** with individual options, show FPS (on) |
| Performance | One-click presets Potato / Balanced / Beautiful / Max / Extreme; full-detail distance 0-24 (Auto), far terrain quality Low-Extreme (Medium), resolution scale 50-200% (100%), effects detail (High) |
| Controls | Field of view 50-110 (75), mouse sensitivity (1x), invert Y (off), binocular zoom 2-12x (6x) |
| Audio | Master, blocks and footsteps, weapons and explosions, creatures, player, menus |
| Gameplay | Difficulty Peaceful / Easy / **Normal** / Hard, creatures spawn (on), time of day and lock, stats on the HUD (off) |
| Weapons | Grenade and bazooka blast size (1x), laser blaster color Red / Green / Blue (Red); airstrike: meteors per strike 1-40 (7), spread 0-80 (22), delay 1-20 s (5 s), fall angle 0-70 degrees (35), fall speed 30-250 (95), meteor blast size (1x); nuke size 12-96 (44), nuke effects intensity Low / Medium / **High** |
| Mobs | Zombie spawn rate Off to APOCALYPSE (1x), max zombies 0-400 (8), zombie health and damage 0.25-5x (1x), daylight zombies (off) |
| UFOs | UFO activity Off to UFO APOCALYPSE (Normal); **advanced:** spawn chance, max UFOs (Auto), aggression (Never attack to 2x), detection range 40-300 (130), tractor beam lift speed (4), sizes (Balanced), night multiplier 1-6x (3x), toughness 0.25-4x (1x) |
| Vehicles | UFO top speed 20-1200 (300) and slowest speed 0.5-8 (2), ghost mode (off), beam lifts loose blocks (on), teleport dash distance Off-3x (1x) and travel time 0.08-0.6 s (0.25 s), jet flight assist (on), jet arrives airborne (off), jet top speed 288-2520 km/h (576), cannon aim assist (on), enemy jets 0-3 (1), acceleration 0.5-2.5x (1x), turn rate 0.5-2x (1x), stall speed 90-252 km/h (151) |

Heavy values show a short performance note next to the slider (for example
hundreds of zombies, or a long full-detail distance).

## The world

A world at the scale of classic block games, 128 blocks tall: continents
and big oceans, long **mountain ranges** rising a hundred blocks above the
sea with bare rock and snowy peaks, rivers, and big biomes (forests, plains,
taigas, snowy lands, deserts, savannas, jungles, swamps, badlands), with
caves, ores and glowing crystals underground. Forests and meadows alternate: oaks with irregular crowns and
branches, pale birch groves, dark pine woods on the hills, and rare huge old
oaks with roots spreading over the ground. On High and Ultra the ground
comes alive with grass, reeds along the water, ferns in the shade of trees,
and flowers.

**Villages** (a few houses and a farm), and much bigger **airports and
cities**, dot the land (usually one within about a thousand blocks of the
start; **F3** shows the nearest). The land is levelled under them, distant
terrain included:

- An **airport** has a 260-block dark runway with markings, threshold
  stripes and edge lights that glow at night, a taxiway, an apron with three
  hangars and fighters parked in front of them, a control tower and fuel
  tanks, and a few villagers walking about.
- A **city** is an airport with a grid of streets and buildings of all
  heights next to it: towers with windows, floors and lit rooms, houses, and
  a crowd of villagers.

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

`/tools` has six test suites (`cd tools && npm install && npm test`; the
browser tests need a Chromium binary, set with the `CHROMIUM_PATH`
environment variable):

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
  shield), the jet (takeoff, cannon heat, missile lock and salvos, flares,
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
