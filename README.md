# MINECLAUDE

A procedurally generated voxel sandbox, running entirely in the browser: no
install, no build step, no accounts. There are three ways to play (see
**Three ways to play** below). **Survival**, the default, is normal Minecraft:
crafting, smelting, mining, farming, hunger, experience, beds, redstone,
enchanting, brewing, weather, the Nether and the End, and vanilla blocks,
items, mobs, villagers, structures and terrain. **Creative** builds and flies
with every block. **Missions** is the mods add-on: the same normal world with
the UFO war on top, where you build and survive, then take on UFOs with
a bow, guns, a railgun, a laser minigun, homing rockets, meteor airstrikes,
two fighter jets (an F-22 and an F-16, with missiles, flares, radar and a
real runway takeoff), a B-2 stealth bomber that carries the nuke and, late in
the game, a flying saucer of your own (stolen from a guarded bunker if need
be). Play alone or with friends in every mode (peer-to-peer, up to 8 players,
one shared world). Built from scratch with plain JavaScript and
[Three.js](https://threejs.org/).

(Before Round 12 the game was called UFO COMBAT: your saved worlds, settings
and invite links keep working.)

Everything is generated in code at runtime: the terrain, every block
texture, item icon and mob skin, the models, and all the sound effects.
There are no image, model or audio files.

## Play

Open the game (see **Running locally** below). The main menu has the
**MINECLAUDE** logo (blocky letters, with a yellow splash line) and flies
slowly over your world at sunset. For a **Survival** or **Creative** world it
is a calm flight over the land; pick **Missions** and a **UFO flies in**
(pick Survival again and it climbs away). **Click the UFO to shoot it**: a few
hits and it blows up (the next one comes by sooner). The menu shows a live
**FPS** counter. Graphics start on **Auto**: the best the game has (Ultra, 32
chunks: the Max performance preset), stepped down a level at a time on its
own while the frame rate in play stays under 40 FPS, until it runs smoothly;
where it settles is remembered for the next time (after a long smooth spell
it tries one level higher, once a session; if that turns out slow it goes
back down and doesn't try again for a few sessions). Online the step waits
for a moment out of play (the pause menu, the inventory), since the picture
stops while a new level is prepared. Pick any preset or change any graphics
or performance setting and Auto is off for good: your choice is saved and
always wins (**Auto (best for this PC)** in Settings turns it back on).
Master volume starts at 15%.

Every screen (main menu, pause menu, settings, inventory, mods, missions,
stats) shares one clean, dark glass style.

The main menu has:

- **Play**, which enters the world (the last world you played is continued)
  the way picked right under it, one of three cards:
  - **Survival** (the default; a new player's first world is a Survival
    world): normal Minecraft (gather, craft, survive), no UFOs, missions or
    mod weapons.
  - **Creative**: build with every block, fly, no damage, in plain Minecraft
    (a Survival world played in Creative).
  - **Missions**: the mods add-on: the normal world with the UFO war on top
    (missions, loot, supply drops, vehicles, the mod weapons). Its own
    Creative, with every mod item and the call-ins, is in its pause menu
    (**Game mode**).

  **Survival** and **Missions** are **world types**: a world is one or the
  other for good. Picking a card of the other type turns Play into
  **Continue Survival world** / **Continue Creative world** (your last
  Survival world, where you left it, in that mode) or **New Survival world**
  (a fresh one; the same for Missions). Press it and you are **straight in
  that world**: the page reloads into it (a world is built as the page loads)
  and the game starts at once, with a **Click to play** (the browser hands
  the mouse to a page only after a click there); there is no second Play.
  Reloading the page yourself, or a link you copy, shows the main menu as
  always. The same card shows the world's seed and type ("saved Missions
  world", "new Survival world", "saved Survival world, in Creative"...) and
  a small **+ New world** link: pick **Survival**, **Creative** (a Survival
  world started in Creative) or **Missions**, and an optional seed (a number,
  or any text). A seed you already have a world for continues that world, in
  its own type and mode.
- **Multiplayer** hosts a game for your friends in any mode, or joins theirs
  (see **How to play with friends** below).
- **Settings** has every option, in tabs (Graphics, Performance, Controls,
  Audio, Gameplay, Weapons, Mobs, UFOs, Vehicles), each with **Reset to
  defaults**; the **Missions mods** switch (see below) and the **key list**
  are buttons at its top, and the graphics preset and **Fullscreen** live in
  its Graphics tab.
- **Fullscreen** (next to Settings; **Leave fullscreen** while it is on).

Click Play to lock your mouse; **Esc** opens the pause menu (Resume,
Settings, Fullscreen, Missions (in a Missions world), Stats, Multiplayer, Copy
world link, Save & main menu, and the **Game mode**; in Creative (either
world type) also the **call-ins**: F-22, F-16, B-2 or a random UFO, and
you are straight in the air at the controls of it; or the Tiger tank, the
battle tank or the missile truck, parked on open ground just ahead with you
straight in it).

**Fullscreen.** Settings > Graphics > **Fullscreen** keeps the game
fullscreen: with it on, the game goes fullscreen as you enter it (Play,
Resume, Click to play; a web page can only go fullscreen on a click). The
**Fullscreen** buttons on the main and pause menus, **F11**, **Alt+Enter** and
the small corner button (top right, when the mouse is near it; it never sits
over the game) switch it too, and the setting follows them. In fullscreen,
Chromium browsers (Chrome, Edge, Opera and friends) **lock the keyboard** (the
Keyboard Lock API): browser shortcuts like **Ctrl+W** (sprint), **Ctrl+R**,
**Ctrl+T**, **Ctrl+N**, **Ctrl+S**, **Ctrl+Tab**, **Tab** and **Esc** reach
the game and cannot close, reload or leave the page, in the menus too (text
fields keep copy and paste). Hold **Esc** to leave fullscreen then (that turns
the Fullscreen setting off too); a short **Esc** still opens the pause menu.
**Only fullscreen fully stops Ctrl+W**: outside it (and in Firefox and Safari,
which have no Keyboard Lock) the game cancels the shortcuts a page is allowed
to cancel (Ctrl+R, Ctrl+S, Ctrl+D, Ctrl+F, Ctrl+P, Alt+key, Tab...), but
browsers never let a page cancel Ctrl+W, Ctrl+T or Ctrl+N: the browser asks
"leave the page?" before closing it while you play (your world is saved either
way), and you can sprint (and boost a UFO) with a double-tap of `W` instead of
`Ctrl+W`.

### Three ways to play

- **Survival** (the default): normal Minecraft (see **Survival (vanilla
  Minecraft)** below), with the Nether and the End (see **The Nether and the
  End**). You start with **nothing** (no starter kit), and the world is
  vanilla: **Mods are off for that world** (no guns, mod explosives, UFOs,
  aliens or mod vehicles; vanilla's TNT, boats and minecarts stay; your own
  Mods setting is kept for your Missions worlds, and the Missions mods
  switch shows locked there), no
  missions, supply crates, call-ins or airport aircraft and guards, no
  Missions button in the pause menu, and its land has **no airports or
  cities** (villages stay). Difficulty and Peaceful work as everywhere.
- **Creative:** every block and item in the tabbed **E** palette, instant
  mining, flight, and no damage, and (Round 13) the aircraft: the palette's
  **Vehicles** tab has the **F-22 Raptor**, the **F-16 Fighting Falcon**, the
  **B-2 Spirit** and a **UFO**, in either world type (see **Vehicles in
  Creative** below). The main menu's Creative card plays a Survival world
  (plain Minecraft: its land stays as it is, with no airports or cities, no
  UFO fleets and no missions); a Missions world has its own Creative in its
  pause menu, with every weapon in your hotbar and the call-ins too.
- **Missions** (the mods add-on): **the normal world with the UFO war on
  top** (Round 13). It is a Survival world in everything (the same land,
  villages, structures, ores, the Nether and the End, crafting and smelting,
  hunger, experience, beds, weather, vanilla's creatures and drops, every
  block and item) plus its airports, cities and military bases, the UFOs and
  aliens, the missions, supply crates, the mod weapons and the vehicles.
  You start with basic gear (a stone sword, a stone pickaxe and five apples)
  at 17:50 (the golden hour before sunset), fed, and a **campaign** of 26 to
  30 **missions** drawn afresh for every new Missions game from a pool of 34
  (see **Missions** below): it starts with a skeleton and its bow, goes
  through jets, a meteor storm and a mothership boss, abductor ships hunting
  you, crash sites and radio beacons to hold, then the aliens'
  counterattack (fighter wings, abductors, a titan, a night of swarms, a
  fortress), and ends with the Armada and its flagship: win that and the war
  is won (a victory screen; the game goes on). Missions pay in apples and
  golden apples; the mod weapons come from the places that make sense (the
  skeleton's bow, standard weapons in **supply crates** that drop by
  parachute with orange smoke, alien weapons from alien leaders): they can't
  be crafted. The fighter jets (parked at airports) join with "Take to the
  air", alien ships with "Salvage". Watch your hearts and your hunger.

  (Worlds saved before Round 13: a Missions world keeps the land it was made
  with, so your builds stay where they were: the old terrain, with its own
  villages and no vanilla structures, ores or strongholds (so no way into
  the End there; the Nether is: build a portal). Everything else, crafting,
  hunger, beds and the rest, is the same as in a new one. A new Missions
  world gets the new land.)

You can switch between the world's own game and Creative at any time in the
pause menu (**Game mode**: Missions or Creative in a Missions world, Survival
or Creative in a Survival world, like vanilla's game mode): a Survival world
in Creative stays a Survival world, and the switch never changes your
inventory (what you took from the Creative palette stays, and nothing is added
or taken away). Each world remembers its type, its mode, your position,
inventory and health; a world saved before Round 11 is a Missions
world (and one saved before Round 13 keeps its old land: see above). A
new world starts on flat, open, dry ground. A world link (`?seed=N`)
without a type still opens a Missions world, as it always did; a new player's
first world (no link, nothing saved) is a Survival world.

### Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look around | Mouse |
| Jump / swim up | `Space` |
| Climb a ladder or vine | Walk into it, or `Space`; `Shift` holds you in place |
| Sprint (not with 6 food points or less, outside Creative; the view widens, and a sprint-jump carries you further, as in Minecraft) | `Ctrl` + `W`, or double-tap `W` |
| Sneak (slow, won't walk off edges; in bed: get up) | `Shift` |
| Mine a block / attack (hold to keep mining) | Left click |
| Place a block / use / eat or drink (hold) / fire the weapon in hand | Right click |
| Use a vanilla item in hand: raise a shield (hold), cast and reel in a fishing rod, throw an egg, snowball, ender pearl, eye of ender, splash potion or bottle o' enchanting, fill or pour a bucket, fill a glass bottle at water or a cauldron, till with a hoe (a shovel makes a path), grow things with bone meal, light a fire, TNT or a nether portal with flint and steel or a fire charge, put an eye of ender in an end portal frame, charge a respawn anchor with glowstone, turn diamond gear into netherite at a smithing table | Right click |
| Wear a piece of armor (when it is in your hand) | Right click |
| Open a chest, a barrel or a shulker box (whatever is in your hand) | Right click |
| Open a crafting table, a furnace, smoker or blast furnace, an enchanting table, an anvil, a brewing stand, a grindstone, a stonecutter, a hopper, a dropper or a dispenser (whatever is in your hand; `Shift` with something in hand places against it) | Right click |
| Open or close a door, trapdoor or fence gate (not an iron one) | Right click |
| Sleep in a bed / set your spawn point | Right click (on the bed) |
| Flip a lever, press a button, set a repeater's delay, tune a note block, edit a sign, eat a slice of cake, plant in a flower pot or take the plant back, ring a bell, put raw food on a campfire, fill a composter, put an item in an item frame (or turn it), dress an armor stand | Right click (on it) |
| Get into a boat or a minecart | Right click (on it) |
| **In a boat or a minecart:** row a boat (`W` in a cart nudges it) / get out | `W` `A` `S` `D` / `Shift` |
| Trade with a villager, milk a cow (empty bucket), shear or dye a sheep, feed or breed an animal, tame a wolf (bones) and make it sit or stand, barter with a piglin (a gold ingot) | Right click (on it, with the item) |
| Reload the weapon in hand | `R` |
| **Binoculars** (a strong zoom, with a rangefinder) | Hold **both** mouse buttons |
| Select hotbar slot | `1`-`9` or scroll wheel |
| Inventory (in Creative: every block, tool and item, and in a Missions world every weapon, in tabs; outside Creative with a 2x2 crafting grid) | `E` |
| Drop the held item (whole stack with `Ctrl`) | `Q` |
| Fly up / down (Creative) | Double-tap `Space` to toggle, then `Space` / `Shift` |
| Glide with an elytra (worn in the chest slot) | `Space` while falling |
| Pick the targeted block (Creative) | Middle click |
| Pause menu | `Esc` (also steps back out of any menu screen) |
| Board / leave a vehicle (Mods on; in a Survival world: in Creative) | `F` (near it) |
| Swap the item in hand with the off hand (when no vehicle you can board is in reach) | `F` |
| Stats and controls of the vehicle you are in | `I` |
| Fullscreen (and the keyboard lock in Chromium) | `F11` or `Alt+Enter` |
| Hide the HUD / debug info | `F1` / `F3` |
| Camera: first person, third person behind, third person in front (facing you) | `F5` |
| Go to the next dimension (Creative in a Survival world, for testing: Overworld, Nether, End) | `F7` |

Pressing both mouse buttons together never mines, places or fires: a single
press waits a few hundredths of a second to see whether the other button
follows. The zoom strength is in **Settings > Controls**.

**Third person** (`F5`, as in Minecraft): the first press puts the camera
4 blocks behind you, the second in front of you looking back, the third
back at your eyes. The camera comes in when a wall or the ground is in the
way (it never looks through blocks). You see your own body: it walks,
sprints, sneaks (lower, arms hanging), swings at what you mine or hit,
eats and drinks (the hand at the mouth), draws the bow, raises the shield,
holds the item in hand and the off hand's, wears your armor (each
material its colour), flashes red when hurt and falls over when you die.
The crosshair hides in the front view (it would point nowhere); behind
you it stays (the camera sits on your line of sight, so it still aims
true: vanilla hides it there too, but the Missions world's guns need it).
A scope, the binoculars and a bed always look from your eyes.

**In the inventory screen:** left click picks up, puts down or swaps a stack;
right click takes half or places one; `Shift` + click moves a stack between
the hotbar and the inventory; number keys swap the hovered slot with a hotbar
slot; `Q` drops from the hovered slot; clicking outside the window drops what
you're carrying. In Creative the palette has tabs (Combat, Blocks, Tools,
Items, Vehicles, Search, opening on Blocks; Round 13: in both world types, a
Missions world's Combat tab with the mod weapons too): click to take a
stack, `Shift` + click to add it to the inventory; the Search tab filters
every item by name. The armor row has an **off-hand** slot (Round 13: in
both world types): `F` swaps the item in hand with
it (or, in the inventory, the hovered slot's), and a shield there blocks with
right click while the main hand holds a tool or nothing.
**A chest** (right click on it) opens the same screen with the chest's 27
slots (a large chest's 54; a barrel's, a shulker box's or a chest boat's or
minecart's 27) above your inventory and the same clicks: `Shift` + click
moves a stack between the chest and your inventory. `E` or `Esc` closes it.

**Crafting** (both world types; Missions since Round 13): the inventory has
a 2x2 **crafting grid** (top right; not in Creative, as in Minecraft), and a
**crafting table** (right click on it) opens a 3x3 one. Put the ingredients in the grid's shape
(anywhere in the grid, and mirrored left to right where that matters): the
result shows on the right. Click it (left or right) to take one craft onto the
mouse (again to add another of the same), `Shift` + click to craft as many as
fit into your inventory (they go into the hotbar from its right end first, as
in Minecraft), a number key to craft one into that empty hotbar slot, `Q` to
craft one and throw it. At the table, `Shift` + click on your inventory moves
a stack into the grid. Whatever is left in the grid goes back into your
inventory when the screen closes (dropped if it is full); a milk bucket used in
a cake leaves its empty bucket in the grid.

**A furnace** (right click on it) has an input slot (top), a fuel slot
(bottom) and the output (right), with the flame (how long the fuel burns on)
and the arrow (the item cooking). `Shift` + click on your inventory puts what
can be smelted into the input and fuel into the fuel slot; the fuel slot takes
only fuel; the output only gives (all, half with the right button). Taking from
the output gives the experience of what was smelted.

## Missions

The UFO war (a **Missions** world): everything in this section, and the
**UFOs**, **Vehicles** and **The ground war** sections further down, belongs
to it (except Creative's aircraft: see **Vehicles in Creative**). A Survival
world has none of it (see **Survival (vanilla Minecraft)**); everything else
in a Missions world is a Survival world's.

### Missions basics

- **Health and hunger** (Round 13: as in a Survival world): 10 hearts and 10
  drumsticks. Health comes back while you are well fed; food fills the
  hunger bar (see **Food, hunger and health**). A **golden apple** heals and
  adds golden hearts on top that soak damage first. Supply crates, wrecks and
  chests bring food.
- **Mining and crafting:** as in a Survival world (see **Crafting and
  smelting**, **Mining and ores**): the 2x2 grid in the inventory, the
  crafting table, the furnace. Tools also drop from UFOs, aliens and supply
  crates.
- **Caves and ores:** vanilla's (iron, copper, redstone, lapis, diamonds,
  emeralds...); an old Missions world's (before Round 13) keeps coal, gold
  and the glowing lumen crystals on deep cave ceilings.
- **Torches and chests** (Round 10): a torch placed on the side of a block
  hangs on the wall, leaning out like in classic block games (on top of a
  block it stands; under a block it doesn't go), and drops off as a torch
  when its wall is mined or blown away. **Chests** hold 27 stacks. The chests
  in city lobbies (and an old Missions world's village houses; see **The
  world**) hold the missions' loot, rolled
  the first time anyone opens one: food, torches, now and then a golden
  apple or a tool, sometimes a standard weapon the campaign already allows,
  rarely a piece of armor (less than a supply crate). A chest you place
  (Creative palette, or one you broke and picked up) starts empty. Breaking
  a chest spills what it holds. Opened chests are saved with the world. A
  new Missions world's villages, dungeons, mineshafts and temples have
  vanilla's loot, as in a Survival world.
- **Armor** (Round 5): four slots (head, chest, legs,
  feet) in four tiers (leather, gold, iron, diamond). Every defense point
  turns away 4% of the damage (up to 80%), the HUD shows an armor bar, and
  every hit wears each piece. Right click one in your hand to put it on, or
  use the armor row in the inventory (Round 13: as vanilla, a piece you pick
  up goes into your inventory). Aliens, zombies, skeletons and bunker guards drop armor, better
  the further the mission chain has got. Falls, drowning and fire go through.
- **Dying** shows a big red **NOOB!** with the cause. You drop everything
  where you died and respawn with full health around the current mission's
  location (when no mission is running, at your bed or the world spawn: see
  **Beds, sleeping and dying**).

### Missions, loot and supply crates

- **Missions:** a campaign of 26 to 30, one after another, shown top right
  with a progress bar per objective, the target's distance and direction,
  and a yellow **marker** over the target (an arrow at the screen's edge
  when it is behind you).
- **A different campaign every game** (Round 10): each new Missions world
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
  | I: On foot | The archer | Kill a skeleton with your sword and take its **bow** (and the 16 arrows it drops with it) | |
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

  Each place in the campaign also sets the sky, and in Missions **only the
  missions do** (the UFO activity, spawn chance, max count and size
  settings are Creative's and hidden in Missions): no UFOs at all for the
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
  - **The skeleton** ("The archer", always first or second): the bow, with
    16 arrows (the bow takes arrows, as vanilla's).
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
  - **Chests** in city lobbies (and an old Missions world's villages): now
    and then a standard weapon the campaign already allows (see **Missions
    basics**; vanilla's villages and structures hold vanilla's loot).
  - **Missions:** apples and golden apples only.
  - Downed UFOs and enemy fighters drop food, tools and golden apples.
- **Supply crates:** a crate drifts down on a parachute near you, trailing
  orange smoke (the tracker shows how far it is). Walk up to it.
- **Difficulty curve:** follows your place in the campaign (see above).

### Creatures

These are the Missions world's own creatures (Round 13: among vanilla's: a
quarter of the herds are fluffalos, hoplets or mossbacks, and butterflies
flutter by the flowers; see **Mobs** for the rest).

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
  critical hit. (Melee is Java's, in both world types since Round 13: each tool's own damage
  and attack speed, an axe slow and strong, a full-charge sword hit sweeps
  the creatures around the target, and no crit while sprinting.)
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

Missions starts with a sword (weapons come from the lanes above); Creative
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

## Survival (vanilla Minecraft)

A **Survival** world (Round 11) is normal Minecraft, fitted to this game:
vanilla's recipes, numbers, blocks, items, creatures and terrain. You start
with nothing; everything you have, you gather, craft, smelt, farm or trade
for, and your body works like normal Minecraft's (hunger, experience, beds).
There are no UFOs, missions, mod weapons or mod vehicles (see **Three ways to
play**). (Round 13) Everything in this section is in a **Missions** world
too: it is the same world with the missions on top. None of the body rules
are in **Creative**. Every block and item is in the Creative palette in both
world types (a Missions world's has the mod weapons too, in the Combat tab).

The day is vanilla's **20 minutes** in both world types (Round 13: a
Missions world's was 10); a new Survival world starts at 6:00 in the
morning, a new Missions world at 17:50.

Both world types have the **Nether** and the **End** (see **The Nether and
the End** below). Not in this game (yet): maps, banners (so the loom has no
screen), trapped chests, hopper, TNT and furnace minecarts, comparators and
glow item frames.

### Crafting and smelting

(How the grid and the furnace screen work: see **Controls**.)

- **Crafting** works like Minecraft's, with Minecraft's recipes: a log makes 4
  planks (of its wood), 2 planks 4 sticks, 4 planks a crafting table; the
  table makes the tools (wooden, stone, iron, golden and diamond swords,
  pickaxes, axes, shovels and hoes), armor (leather, iron, gold, diamond;
  chainmail can't be crafted, as in Minecraft), the chest, the furnace,
  torches (coal or charcoal), the storage blocks of iron, gold, diamond,
  emerald, lapis, redstone, coal and copper (and back to nine), nuggets and
  ingots, the bucket, shears, flint and steel, compass, clock, bow, arrows,
  fishing rod, paper, books, bookshelves, bread, cake, cookies, pumpkin pie,
  golden apples and carrots, bowls, mushroom stew and beetroot soup, wool from
  string, beds, ladders, glass panes, iron bars, stone bricks, the shield
  and more; the building, nature, decoration, redstone and magic blocks add
  their own (stairs, slabs, fences, doors, dyes, signs, pistons, TNT, the
  enchanting table, boats, rails...: see **Building blocks**, **Farming and
  growing**, **Dyes and decoration**, **Redstone and TNT**, **Boats,
  minecarts and rails**, **Enchanting, anvils and brewing** and **Chests and
  work blocks**).
- **Smelting:** a furnace cooks one item every **10 seconds** while its fuel
  burns: coal or charcoal 80 s (8 items), a coal block 800 s, a log or planks
  15 s, a wooden slab 7.5 s, a stick or a sapling 5 s, a lava bucket 1000 s
  (its bucket stays in the fuel slot)... It smelts raw iron, gold and copper
  (and their ores) into ingots, sand and red sand into glass, cobblestone into
  stone, stone into smooth stone, logs into charcoal, clay balls into bricks
  and clay into terracotta, raw meat and fish into cooked, potatoes into baked
  potatoes, a cactus into green dye, and iron or gold gear back into a nugget. A burning furnace glows
  (light 13) and keeps working while you are away (as long as its ground is
  loaded); the experience of what it smelted waits in it until someone takes
  from the output. Breaking a furnace drops what is in it. Furnaces are saved
  with the world.

### Mining and ores

A Survival world's terrain (and, since Round 13, a new Missions world's) is
vanilla Minecraft's, fitted to this world (128 blocks tall, the sea at 24):

- **Ores** at their usual depths: coal everywhere up into the hills, iron and
  copper common down to the sea and a little above, gold under 30 (and plenty
  more in the badlands), lapis around 15, redstone and diamonds in the deepest
  15 blocks, emeralds only in the mountains. Granite, diorite and andesite
  pockets, dirt and gravel. No alien crystals.
- **Tools:** iron, copper and lapis need a stone pickaxe; gold, diamond,
  redstone and emerald an iron one; obsidian a diamond one.
- **Drops, like the classic game:** iron, gold and copper ore give raw metal
  to smelt; diamond, emerald and coal ore their diamond, emerald or coal,
  lapis ore 4-9 lapis and redstone ore 4-5 dust. Gravel gives flint one time
  in ten; tall grass and ferns give wheat seeds one time in eight; oak and
  dark oak leaves sometimes an apple, all leaves sometimes sticks; a dead bush
  gives sticks; a snow block gives four snowballs (with a shovel).
- Mining coal, diamond, emerald, lapis and redstone ore gives **experience**
  (see **Experience**).

### The land

- **Biomes:** snowy plains and taigas under a layer of snow (dig it with a
  shovel for snowballs), frozen seas and rivers in the cold (break the ice
  and the sea comes back; a bright lamp melts it), red sand and banded
  terracotta in the badlands, clay in river and lake beds (4 clay balls),
  podzol in the taiga, coarse dirt in the savanna, sugar cane by the water,
  lily pads on the water by the swamps, pumpkin patches, melons in the jungle,
  mushrooms in the shade and in caves, and the flowers of each biome (tulips,
  daisies, cornflowers, alliums, bluets, blue orchids in swamps, lilies of
  the valley).
- **Trees:** oaks, birches and spruces as before, plus the savanna's bent
  acacias and the dark forest's dark oaks, each with its own wood and leaves.
- **Jungles** as vanilla's: thick with trees and hung with vines. Giant jungle
  trees (a 2x2 trunk 10 to 31 blocks tall, branches ending in tufts of
  leaves, a wide flat canopy on top), tall jungle trees with cocoa pods,
  jungle bushes (a log in a mound of leaves) all over the floor, ferns and
  grass, melon patches, and vines up the trunks and hanging from the leaves
  (they fall when their trunk is cut). Toward a jungle's edge it thins out (no
  giants there). Parrots fly in the canopy. Jungles are about twice as common
  as before: about one stretch of land in twelve, mostly within a kilometre
  or two of the start. **Bamboo jungles** inside the jungles (about a third
  of them): tall thick bamboo everywhere on podzol, fewer trees (the giants
  and bushes); a stalk of bamboo now and then in the rest of the jungle.
- **No airports or cities** in a Survival world (a Missions world has them,
  and its military bases, on top); villages, temples and the other
  structures are vanilla's (see **Structures**).

### Structures

- **Dungeons:** small mossy cobblestone rooms where a cave opens into the
  rock (about one every dozen chunks), each with a **monster spawner**
  (zombies, now and then skeletons or spiders) and one or two chests against
  the walls: bones, gunpowder, rotten flesh, string, iron and gold, bread,
  wheat, a bucket, redstone, coal, seeds and sometimes a golden apple.
- **Abandoned mineshafts:** under the land of about one region in five,
  winding 3-wide corridors with oak plank and fence supports every 5 blocks,
  crossings, stairs, plank bridges over the caves and cobwebs in the
  corners; a dirt-floored room where they start. Some corridors are thick
  with cobwebs round a spider spawner. Now and then a chest stands by a
  corridor's wall (golden apples, an iron pickaxe, ingots, redstone, lapis,
  diamonds, coal, bread, seeds, torches).
- **Desert temples:** stepped sandstone pyramids in the deserts (vanilla's
  spacing: a few hundred blocks apart at most where the desert is wide), with
  two hollow towers at the front (a doorway into the hall, capped with
  stairs), the blue-eyed orange terracotta patterns on them, an entrance
  block framed in cut sandstone, and four pillars in the hall. Under the blue
  terracotta in the middle of the floor a shaft drops 11 blocks into the
  hidden room: four chests in alcoves (diamonds, iron, gold, emeralds, bones,
  spider eyes, rotten flesh, golden apples...), and nine TNT under the
  pressure plate in its middle. Dig down carefully.
- **Jungle temples:** mossy cobblestone temples in the jungles, overgrown with
  vines: a hall with stairs up to a second floor and a terrace, and stairs
  down to the dark basement. There, three levers on the wall of a hallway:
  the right one turns off a hidden redstone torch and two sticky pistons pull
  a door aside, opening a little room with a chest; the other two do nothing
  (vanilla's lever puzzle, simpler: one right lever instead of a sequence).
  A second chest waits at the end of a narrow hallway (vanilla's tripwire and
  arrow trap there are left out). The chests: diamonds, iron, gold, emeralds, bones, rotten flesh and sometimes an
  enchanted book.
- **Villages** in the plains and meadows, deserts, savannas, taigas and snowy
  plains, each in its own style (oak and cobblestone; sandstone with flat
  roofs and coloured terracotta; acacia; spruce, mossy cobblestone and
  lanterns; spruce and white walls), as vanilla's: a **well** in the middle of a
  square, **streets** of dirt path (smooth sandstone in the desert) branching
  out over the land as it lies, with planks where they cross water, and along
  them **houses** facing the street, each standing level on a foundation at
  its street's height. Small, medium and big houses with beds, a crafting
  table and a chest; **farms** (wheat, carrots, potatoes or beetroots by a
  water channel); **animal pens**; a **library** lined with bookshelves; a
  **church** with a tower and a brewing stand on its altar; a **blacksmith**
  (furnaces, a grindstone and a chest of weapons and iron); and the armorer's,
  toolsmith's, butcher's, fletcher's, shepherd's, mason's and fisher's
  houses and the tannery, each with its trade's block (see **Chests and work
  blocks**). **Lamp posts** (a black wool lamp with four torches, or a
  lantern) light the streets; hay bales lie about. Each house's **chest** holds vanilla's loot for it: bread,
  potatoes, apples, emeralds, saplings in the houses (cactus and dead bushes
  in the desert, snowballs in the snowy ones, spruce logs in the taiga); iron,
  diamonds, iron tools and armour, obsidian at the blacksmith's; wool and
  shears at the shepherd's; meat at the butcher's; fish at the fisher's;
  leather armour at the tannery; redstone and lapis at the church. (No bells
  in the villages yet, though a bell can be placed.)
- **Desert wells:** a little sandstone well with a roof, very rarely.
- **Strongholds** (deep underground, with the End's portal) and **ruined
  portals** (broken nether portal frames): see **The Nether and the End**.
- **Monster spawners** work as in vanilla: within 16 blocks of a player, one
  spawns up to 4 of its creature every 10-40 seconds around itself (4 blocks
  across, 1 up or down), in light of 11 or less, and stops while 6 of them
  are near. Light it up with torches (or break it: it drops nothing but a
  good handful of experience). Flames flicker inside a spawner that is awake.
  None on Peaceful. A spawner is in the Creative palette (zombie, skeleton
  and spider) and works in either kind of world.
- Things vanilla's chests hold that the game doesn't have (saddles, name
  tags, horse armour, music discs, maps), and the rails and bamboo they
  hold, are left out; the rest keep vanilla's odds, enchanted books (one random enchantment) included.

### Farming and growing

- Till grass or dirt with a **hoe** into farmland (water within 4 blocks
  keeps it wet, and wet farmland grows crops faster; bare dry farmland turns
  back to dirt). Plant **wheat seeds** (from tall grass and ferns),
  **carrots**, **potatoes**, **beetroot seeds**, **pumpkin seeds** and
  **melon seeds** on it. Crops grow by themselves in the light (rows grow
  faster than square blocks), and drop seeds until ripe; ripe wheat gives
  wheat and 1-4 seeds, carrots and potatoes 2-5 (now and then a poisonous
  potato), beetroots a beetroot and seeds. Pumpkin and melon stems grow their
  fruit on a free block beside them.
- A **shovel** flattens grass into a dirt path.
- **Bone meal** (3 from a bone) makes crops jump ahead, a sapling grow
  (sometimes it takes two), and grass sprout tall grass and flowers around.
- **Saplings** drop from leaves (one in 20, jungle one in 40) and grow into
  their tree when there is room. Four dark oak saplings in a square make a
  dark oak (one alone never grows); four jungle saplings make a giant jungle
  tree.
- **Leaves** more than 6 blocks from a log decay once their tree is cut;
  leaves you place yourself never do.
- **Sugar cane** grows 3 tall beside water (sugar from it); **cactus** grows
  3 tall too, only on sand with nothing solid beside it (it breaks off
  otherwise, as vanilla); mushrooms spread slowly in the dark.
- **Bamboo**: plant it on grass, dirt, sand, gravel, podzol or mycelium (a
  shoot); it grows a block at a time to 12-16 tall in the light (thin at the
  bottom, thick higher up, leafy at the top), bone meal adds one or two
  blocks; breaking a stalk takes everything above it. 2 bamboo make a stick,
  9 a **block of bamboo**; it burns as fuel (2.5 s).
- **Scaffolding** (6 bamboo and a string: 6): climb it like a ladder (jump
  to go up, sneak to hold on). Right click scaffolding with scaffolding:
  on its side it builds the tower up, on its top it reaches out the way
  you look (sneak to place it as any block). It stands 6 blocks out from
  the scaffolding on a block below; any further, or with its support gone,
  it falls (drops). (Simplified: its top can't be stood on, and it drops
  instead of falling as a block.)
- **Recipes from the land:** hay bale (9 wheat, and back), melon (9 slices),
  seeds from melon slices and pumpkins, sugar, bone meal, the bricks block (4
  bricks), clay (4 clay balls), snow block (4 snowballs) and snow layers,
  packed ice (9 ice), coarse dirt, jack o'lantern (a carved pumpkin over a
  torch: carve a pumpkin with shears).

### Food, hunger and health

- **Hunger:** ten drumsticks right of the hearts (20 food points), with hidden
  **saturation** under them. Running, swimming, jumping, fighting, mining and
  getting hurt use them up (vanilla's rates: sprinting costs 0.1 a metre,
  jumping 0.05, a sprint-jump 0.2, a hit you land 0.1, a block 0.005; every 4
  of these take a saturation point, then a food point). Walking is free.
  - With **18 food points or more** you heal a half-heart every 4 s; with a
    **full bar and saturation left**, twice a second. Below that, no healing.
  - At **6 or less** you can't sprint. At **0** you starve, down to 5 hearts
    on Easy, half a heart on Normal, to death on Hard. **Peaceful** refills
    the bar and heals.
  - When saturation runs out the drumsticks shake.
- **Eating:** hold right click with food for 1.6 s (only when not full; a
  golden apple always). Each food has vanilla's values (food points /
  saturation): bread 5 / 6, steak and cooked porkchop 8 / 12.8, cooked
  chicken, mutton and salmon 6, cooked cod and baked potatoes 5, a golden
  carrot 6 / 14.4 (the best saturation), pumpkin pie 8, cookies 2, mushroom
  stew and beetroot soup 6. Stews and soups leave their bowl. A **cake** is
  placed and eaten a slice at a time (see **Dyes and decoration**).
- **Side effects:** **rotten flesh** (80%) and **raw chicken** (30%) give
  **Hunger** (green drumsticks: you get hungry fast), a **spider eye** and
  (60%) a **poisonous potato** **Poison** (green hearts: it hurts, but never
  below half a heart), a **golden apple** **Regeneration II** for 5 s and
  **Absorption** (two golden hearts) for 2 minutes. Status effects show top
  right, with the time left; they blink in their last 10 seconds. A **milk
  bucket** (drunk like food, even with a full bar) clears them and leaves the
  empty bucket.

### Experience

Green orbs from mining coal (0-2), diamond and emerald (3-7), lapis (2-5) and
redstone ore (1-5) with the right pickaxe, killing creatures (5 for a
monster, 12 for a baby zombie, 1-3 for an animal, nothing for a baby animal),
smelting (when you take the furnace's output), breeding, trading and fishing.
They fly to you within 8 blocks and fill the **XP bar** over the hotbar, with
your **level** in green (vanilla's curve: 7 points to level 1, more for each
level after). Dying drops 7 points a level (at most 100) as orbs where you
died; the rest is lost.

### Beds, sleeping and dying

- **Beds:** right click a bed to set your **spawn point** ("Respawn point
  set", any time of day) and, at night (from about 18:30 to 5:30) or in a
  thunderstorm, to sleep: not with monsters within 8 blocks ("You may not
  rest now; there are monsters nearby"). Asleep, the screen darkens; after 5 seconds the night is
  skipped to the morning. `Shift` gets you up (so does being hit). In a
  Missions world nobody can sleep through a night mission ("You may not rest
  now; the invasion goes on tonight"), and a mission's own respawn spot
  comes before your bed.
- **Dying** shows the **NOOB!** screen (with your **score**, the experience
  you collected, as Minecraft's) and drops everything where you died, as in
  Missions. You respawn next to your bed (or a charged respawn anchor in the
  Nether: see **The Nether and the End**), with full food; if the bed was
  broken or blocked in, at the world spawn ("Your home bed was missing or
  obstructed"). Your experience is lost (some of it drops as orbs: see
  **Experience**).

### Weather

- **Rain** comes and goes as in vanilla: clear for 10 minutes to 2.5 hours,
  rain for 10 to 20 minutes (the day is vanilla's 20 minutes). The sky turns grey and darker, the clouds close in, the
  haze thickens, and you hear it (muffled under a roof). Rain falls only
  where the sky is open: not under roofs or trees.
- **Snow** falls instead in the snowy plains, the snowy taigas, the
  mountains and over the cold seas and rivers, and settles a layer on the
  ground; nothing falls in deserts, savannas or badlands. Still water in
  the cold freezes over from its shores (rain or not).
- **Thunderstorms** (now and then while it rains, 3 to 13 minutes): an
  even darker sky, and **lightning**, a bolt every 15 seconds or so near you
  where it rains. It strikes the ground or a creature or player within 3
  blocks of where it falls: 2.5 hearts and 8 seconds of burning to anything
  near, and fire where it lands (on Normal and Hard). Monsters come out by
  day in a storm.
- Rain **puts out fires** (soon, unless they are sheltered) and burning
  players and creatures, keeps **farmland** wet, fills **cauldrons**, and
  zombies and skeletons don't burn in daylight while it rains on them.
- You can **sleep** during a thunderstorm, day or night; a night slept
  through ends the rain.
- Online the host's weather is everyone's (the same rain, the same bolts).

### Lava, water, fire and other dangers

- **Lava** fills the bottom of the caves (y 10 and below), and now and then a
  lava pool lies in the open. Lava glows (it lights itself, day or night, and
  everything near it), and its surface moves like water's: a pool churns
  slowly, flowing lava slides downhill along its flow and pours down its
  sides. It burns and sets fire to wood, leaves and grass near it. It flows 3
  blocks over flat ground, slowly (a block every 1.5 s; three times faster in
  the Nether), and falls into holes. Water on a lava source makes
  **obsidian**, on flowing lava **cobblestone**; lava pouring onto water
  makes **stone**. Water flows 7 blocks.
- **Fire** (flint and steel, a fire charge, lava, lightning) burns with moving
  flames (as vanilla's, 20 frames a second), spreads to planks, logs, leaves,
  wool, hay, grass and flowers, burns them away and goes out once nothing is
  left. Punch it to put it out. Rain puts it out.
- A **magma block** burns the feet of whoever stands on it (not sneaking);
  **soul fire** is the blue fire of soul sand; fire on netherrack never goes
  out.
- **Getting hurt:** lava burns (2 hearts every half second) and sets you on
  fire for 15 s, fire for 8 s (half a heart a second while burning, the
  flames show on screen); water puts you out. A **cactus** pricks (half a
  heart every half second you touch it: walking into it, standing or
  landing on it, jumping into one overhead; never in Creative; creatures too) and destroys items that touch it. A block at
  your eyes **suffocates**, and your breath lasts **15 seconds** under water (10
  bubbles). Falls hurt as before (a half-heart a block beyond 3); a hay bale
  takes 80% of it, a bed half. Armor helps against lava, fire, cactus and
  creatures, not against falls, drowning, burning, hunger, suffocation or a
  witch's potions. The view tilts away from a blow (as Minecraft's hurt tilt:
  toward where it came from, a roll for a hurt from nowhere).

### Building blocks

Every vanilla building block, with vanilla recipes (crafting table or the
2x2 grid), hardness and tools; Creative has them all in its palette (in
both world types).

- **Wood:** planks of six woods (oak, spruce, birch, jungle, acacia, dark
  oak; the Nether's crimson and warped: see **The Nether**), each with its **stairs** (6 planks: 4), **slab** (3 planks: 6),
  **fence** (4 planks and 2 sticks: 3) and **fence gate** (2 planks and 4
  sticks). Oak, spruce and birch **doors** (6 planks: 3), the oak
  **trapdoor** (6 oak planks: 2), the **ladder** (7 sticks: 3), the
  **bookshelf** (6 planks, 3 books).
- **Stone:** stairs and slabs of cobblestone, stone, stone bricks, bricks,
  sandstone and mossy cobblestone, the smooth stone slab; walls of
  cobblestone, mossy cobblestone, stone bricks, bricks and sandstone (6: 6).
  Stone bricks (4 stone: 4) and their mossy (with a vine), cracked
  (smelted) and chiseled (2 stone brick slabs) kinds, smooth stone (smelted
  stone), mossy cobblestone (cobblestone and a vine), granite, diorite,
  andesite (diorite and cobblestone: 2) and their polished kinds (4: 4),
  sandstone (4 sand), cut (4: 4), chiseled (2 slabs) and smooth (smelted).
- **Iron:** the iron door (6 ingots: 3) and trapdoor (4 ingots), iron bars
  (6 ingots: 16), the **lantern** (8 iron nuggets around a torch; light 15,
  stands on a block or hangs under one). **Glass panes** (6 glass: 16;
  broken, they drop nothing, like glass).
- **Colours:** wool, terracotta, concrete, **concrete powder**, **stained
  glass**, **stained glass panes**, **carpets** and **beds** in the 16
  colours, all dyed with the dyes (see **Dyes and decoration**). Carpets: 2
  wool of a colour: 3. Glass panes of a colour: 6 stained glass: 16.
- **Beds:** 3 wool of one colour over 3 planks makes that colour's bed. Right
  click one to sleep (see **Beds, sleeping and dying**).

How they behave, as in vanilla:

- **Stairs** face away from you and go upside down when placed under a
  block or on the upper half of a block's side; next to each other they
  turn their corners (outer and inner) by themselves, and you bump into
  exactly what you see.
- **Slabs** go in the lower or upper half the same way; one more of the
  same kind on its open side makes the full block.
- **Fences, walls, panes and bars** join their own kind, full blocks and
  gates across them. A fence or a wall is 1.5 blocks tall: it can't be
  jumped. An open gate is walked through. Stained glass panes join the plain
  ones and each other the same way.
- **Doors** take two blocks; right click opens and closes both halves
  (iron ones don't open by hand); breaking either half breaks the door and
  drops one. A door placed beside another is hinged on the other side, so
  the two open as a pair. **Trapdoors** hinge on the block you click (upper
  or lower half by where), or lie on the floor or ceiling; right click
  opens them. **Ladders** go on a wall's side and come off with it. A
  **bed** takes two blocks (its foot where you click, its head beyond);
  breaking either half takes both.
- **Moving:** you walk up slabs and stairs (half a block) without jumping.
  **Ladders** (and vines) are climbed by walking into them or holding
  `Space`; `Shift` holds you in place; nothing hurts while you slide down.
  Cobwebs hold you. (Ladders, the step up and cobwebs work in any world.)

### Dyes and decoration

- **The 16 dyes**, from the classic game's sources (one dye each unless said):
  - white: **bone meal**, a lily of the valley;
  - red: a poppy (the red flower), a red tulip, a **beetroot**;
  - yellow: a dandelion (the yellow flower);
  - blue: **lapis lazuli**, a cornflower;
  - brown: **cocoa beans** (cocoa pods grow on jungle trunks; plant beans on
    a jungle log's side; a ripe pod gives 3);
  - green: **smelt a cactus** (1 experience);
  - black: an **ink sac** (fishing now and then brings one up);
  - orange: an orange tulip, or red + yellow (2);
  - magenta: an allium, or purple + pink (2), blue + red + pink (3), blue +
    2 red + white (4);
  - light blue: a blue orchid, or blue + white (2);
  - pink: a pink tulip, or red + white (2);
  - light gray: an azure bluet, an oxeye daisy, a white tulip, or gray +
    white (2), black + 2 white (3);
  - lime: green + white (2); gray: black + white (2); cyan: blue + green
    (2); purple: blue + red (2).
- **Dyeing:** wool of any colour and a dye (anywhere in the grid): wool of
  that colour; a bed of any colour and a dye: that bed; 8 carpets, 8
  terracotta, 8 glass or 8 glass panes around a dye: 8 of that colour
  (terracotta: the plain one).
- **A sheep** right clicked with a dye turns that colour (one dye; not a
  shorn sheep): its wool, shorn or when it dies, is that colour, and it is
  kept with the world.
- **Concrete powder:** a dye, 4 sand (or red sand) and 4 gravel: 8. It falls
  like sand; the moment water touches it (on a side or from above: poured,
  flowing, or the powder placed or landing by it) it turns into **concrete**
  of its colour. Powder dropped onto water sinks into it and sets there.
- **Signs** (oak, spruce, birch; 6 planks over a stick: 3, stacks of 16; the
  other woods' planks make oak ones): on the top of a block a sign stands,
  turned to face you (16 ways); on the side of one it hangs on the wall (and
  comes off with it). Placing one opens its editor: **4 lines of up to 15
  characters** (`Enter` the next line, `Esc` or Done to finish); the text
  shows on the sign. Right click a sign to edit it again; right click it with
  a dye and the text is that colour (one dye). The text is saved with the
  world.
- **The cake** (3 milk buckets, 2 sugar, an egg, 3 wheat; the buckets come
  back): right click with it to place it on a block, right click the cake to
  eat a slice (7 slices; 2 food points, 0.4 saturation each; only when you
  aren't full). Broken, it drops
  nothing.
- **Flower pots** (3 bricks in a V): right click one with a flower, a
  sapling (oak, spruce, birch, jungle, acacia, dark oak), a fern, a dead
  bush, bamboo, a mushroom, a cactus, or the Nether's crimson and warped
  fungi and roots to plant it; right click a planted pot to take it back.
  Broken, a pot drops itself and its plant.
- Stained glass and its panes drop nothing when broken (as glass), except
  with Silk Touch. Stained glass is cut out like the game's glass: its colour
  is in its frame and streaks, the rest clear.
- **Item frame** (8 sticks round leather): hang it on any side of a block
  (walls, floors, ceilings). Right click with an item puts one in, shown on
  the frame; right click again turns it an eighth. Breaking the frame drops
  it and its item (vanilla's first punch drops only the item: here both go
  at once).
- **Armor stand** (6 sticks and a smooth stone slab): two blocks tall,
  facing you in eighths of a turn. Right click with a piece of armor puts
  it on (swapping what it wore there); with an empty hand, click the feet,
  legs, body or head to take that piece back. Breaking it drops the stand
  and its armor. A dispenser puts armor on one in front of it.

### Redstone and TNT

Vanilla redstone, with vanilla recipes; Creative has every piece in its
palette, and circuits work in both world types.

- **Redstone dust:** right click with redstone dust on top of a block (a
  full block, glass, a top slab, an upside-down stair, a piston). It joins
  the dust and the redstone pieces beside it, climbs and drops one block
  along steps (over glass power goes up, not down), and carries power from
  15 down to 0, one less a block: 15 blocks of dust at most from a source.
  Its red is darker the weaker the power.
- **Power:** a **lever** (a stick on cobblestone; on a wall, a floor or a
  ceiling; right click flips it), a **stone button** (a stone: 1 s of
  power) or an **oak button** (any planks: 1.5 s), a **stone pressure
  plate** (2 stone: players and creatures) or an **oak** one (2 planks:
  items too), a **redstone torch** (redstone over a stick: on unless the
  block it stands or hangs on is powered, a tick later, so it inverts; a
  torch blinking too fast burns out for 8 s) and the **block of
  redstone**. A lever, button or plate powers the block it is on "strongly"
  (that block then powers dust beside it); a torch powers the block over
  it. Any powered block powers the lamps, doors and pistons beside it.
- **Repeater** (2 redstone torches, a redstone dust and 3 stone): carries
  power one way, back to front, at full strength, after 1-4 ticks (0.1 s
  each; right click sets the delay, the second torch moves).
- **What power does:** a **redstone lamp** (4 redstone round a glowstone
  block, as vanilla; light 15) lights; **doors**,
  **trapdoors** and **fence gates** open (the iron ones only this way) and
  close again when the power goes; a **piston** (3 planks, 4 cobblestone,
  an iron ingot and a redstone) pushes up to 12 blocks in front of it
  (never obsidian, bedrock, chests or furnaces; torches, dust, plants and
  doors in the way break off) and pulls back when the power goes; a
  **sticky piston** (a slime ball on a piston) pulls the block in front back
  with it; a **note block** (8 planks round a redstone) plays its note
  (right click raises it a semitone, two octaves round; the block under it
  picks the instrument: wood a bass, stone a bass drum, sand a snare, glass
  clicks, wool a guitar, gold a bell, clay a flute, packed ice chimes, iron
  a xylophone, anything else a harp).
- **TNT** (5 gunpowder and 4 sand): set off by power, flint and steel, fire
  beside it or another blast. It hops, flashes white and goes off after 4 s
  (one caught by a blast after 0.5-1.5 s) with power 4: bigger than a
  creeper, it breaks the blocks round it (in water it breaks none) and sets
  off the TNT it reaches, so TNT goes off in chains. In a Survival world
  every block it breaks drops, and blasts (TNT's and creepers') hurt as
  vanilla's and leave obsidian, bedrock, enchanting tables, anvils and
  liquids standing.
- **Observer** (6 cobblestone, 2 redstone and a nether quartz): its face
  watches the block in front of it (placed, it looks the way you look: you
  see its back). Whenever that block changes (placed, broken, a crop
  growing, dust changing power, a door opening) it sends a short pulse out
  of its back (one tick, a tick later; the red dot lights), strongly into
  the block there. Two observers face to face make a fast clock.
- **Tripwire hook** (an iron ingot over a stick over planks: 2): on a
  wall's side. Two hooks facing each other on the same level with
  **string** between them (right click with string: it can hang in the air;
  up to 40) are strung; anyone or anything (players, creatures, dropped
  items) touching the string pulls them: 15 power (strongly into their
  walls) until half a second after it leaves.
- **Dropper** (7 cobblestone round a redstone) and **dispenser** (the same
  with a bow in the middle, or a dropper with 3 sticks and 3 string): 9
  slots (right click opens them; placed, they face you). Each time power
  comes (also when the block over them is powered, as vanilla) they fire
  one item from a random slot: a dropper puts it into the container in
  front (chest, furnace, hopper, another dropper...) or throws it out; a
  dispenser shoots **arrows** (they hurt players and creatures; one that
  hits a block can be picked up), **fire charges** (they set fire where
  they land), **snowballs** and **eggs**, places **water** and **lava**
  from buckets and scoops a source back into an empty bucket, uses **bone
  meal** on what is in front, lights fire or TNT with **flint and steel**,
  primes **TNT**, puts **armor** on the player or the armor stand in front,
  and throws anything else out. Empty, it only clicks.
- **Hopper** (5 iron ingots round a chest): 5 slots. Placed against a
  block's side it points into it, otherwise down. Every 0.4 s it passes an
  item on into the container it points at and takes one from the container
  above it, or picks up the items dropped into its bowl (not through a
  full block over it). Chests, furnaces (the top fills the input, the
  sides the fuel, a hopper underneath takes the output), brewing stands
  (the ingredient from the top, bottles and blaze powder from the sides,
  finished bottles from below), droppers, dispensers and other hoppers all
  work with it. A powered hopper is locked: nothing moves.
- (Simplified: pistons move their blocks at once, with no sliding, and don't
  shove players or creatures; hoppers, droppers and dispensers can't be
  pushed; no comparators or repeater locking yet. Online, hoppers,
  droppers and dispensers work where the host is: in a dimension only a
  guest is in, they wait.)

### Boats, minecarts and rails

Vanilla Java 1.20's, with vanilla's recipes (the Creative palette has them
all, in both world types).

- **Boats:** one of each wood (oak, spruce, birch, jungle, acacia, dark oak:
  five planks in a U), and the **boat with a chest** (a boat and a chest).
  Right click on water (or the ground) to put one down, right click it to get
  in, **Shift** to get out. W/S/A/D row it: W forward, S back, A/D turn (and
  paddle slowly on the spot); the view turns with the boat. On water it
  reaches about 8 blocks a second; on land it hardly moves; on ice it flies
  (about 40 blocks a second). A boat seats two (the second behind, the first
  steers); a creature it bumps into while no player steers it climbs in (and
  stays until the boat is broken; an animal sits sideways in a full boat). A
  chest boat seats one: sneak and right click to open its 27-slot chest. A
  boat held under water for 3 seconds throws its riders out; one that falls
  more than 3 blocks onto land breaks into 3 planks and 2 sticks (its riders
  take the fall); lava burns it up. Hit it to break it (a few punches, one
  blow of a sword or an axe; at once in Creative, with nothing dropped): it
  drops itself (and its chest's contents). Boats burn in a furnace for 60 s.
- **Rails** (six iron ingots and a stick: 16): placed on a block with a whole
  top, a rail joins the rails beside it: straight lines, curves where two meet
  at a corner, slopes up or down one block. A rail already joined at both ends
  is left alone; at a T or a crossing the curve goes south-east (north-west
  while the rail is powered: redstone power switches a junction). An ascending
  rail comes off if the block it leans on goes.
- **Powered rails** (gold, a stick, redstone: 6) boost a cart while powered
  (redstone power beside one powers up to 8 more along the line) and brake it
  while not; a cart standing still on a powered one starts off a block behind
  it. **Detector rails** (iron, a stone pressure plate, redstone: 6) give
  redstone power while a cart is on them (and a second after). **Activator
  rails** (iron, sticks, a redstone torch: 6), powered, throw a cart's rider
  out.
- **Minecarts** (five iron ingots in a U) and the **minecart with a chest** (a
  minecart and a chest: right click opens its 27 slots): right click a rail to
  put one down, right click it to get in, Shift to get out. Carts roll along
  the rails as vanilla's: down slopes, boosted by powered rails, at most 8
  blocks a second; with nobody in them they slow down quickly. Walk into an
  empty one to push it; inside, hold W to nudge a cart that is nearly still.
  Carts bump the carts ahead of them along; an empty cart rolling into a
  creature picks it up. Hit one to break it (it drops itself, and its chest's
  contents).
- **Online:** everyone sees the boats and carts and who sits in them; two
  players can share a boat; the driver steers it for everyone. Boats and carts
  are saved with the world (a player who saved sitting in one is back in it).
- *Not like vanilla:* players are pushed off boats and carts instead of
  standing on them; a rider gets out on the spot when travelling to another
  dimension (vehicles don't go through portals); a detector rail powers what
  is beside it but not the block under it (without the redstone's optional
  hook); no hopper, TNT or furnace minecarts.

### Items and tools

A Survival world has the classic game's items, with its numbers:

- **Materials:** iron, gold and copper ingots and nuggets, raw iron, gold and
  copper (smelt them), diamonds, emeralds, lapis lazuli, redstone dust,
  flint, charcoal, leather, feathers, string, bones, gunpowder, slimeballs,
  paper, books, glass bottles and bowls.
- **Tools:** golden tools (the fastest of all, but they break after 32 uses
  and mine only what wood can), hoes of every material (right click turns
  grass or dirt into farmland), **shears** (cut leaves, wool, cobwebs, vines
  and grass fast and keep them whole; carve a pumpkin; shear sheep),
  **flint and steel** (sets fire to the face you click; 64 uses).
- **Buckets:** an empty bucket picks up a water or lava source (not flowing
  water), a water bucket pours a new source, a lava bucket pours lava; milk a
  cow with an empty bucket. Buckets stack to 16 when empty. In Creative a
  full bucket stays full.
- **The bow takes arrows:** one arrow a shot, from your inventory (no
  arrows, no draw); an arrow stuck in a block can be picked up again for a
  minute. In Creative no arrows are needed (and none are left to pick up).
- **Fishing:** right click with a fishing rod casts the bobber; where it
  lands in water, wait (5-30 s, slower under a roof): bubbles come in, the
  bobber dips with a splash, and a right click within a second or two reels
  in a catch (mostly cod and salmon, sometimes junk such as a bowl, leather,
  a bone, an ink sac or an old pair of boots, rarely, from open water, an
  enchanted book or an enchanted bow or fishing rod) that flies to you with
  a little experience. Reeling in from the
  ground costs the rod two uses, a catch one (64 uses in all).
- **Thrown items:** eggs (a chick hatches one time in eight), snowballs and
  **ender pearls** (you are taken where it lands, for 5 damage; one a second).
  Eggs and pearls stack to 16.
- **Compass and clock:** in hand, the compass's needle points to the world
  spawn and the clock's dial shows the sun or the moon.
- **Chainmail armor** (2/5/4/1 points, an iron set's wear; not crafted: an
  armorer sells it) and the **shield**: hold right click with it for a quarter of a
  second and it turns away blows, arrows and shots from in front (the half
  you face); a hit of 3 or more wears it by 1 + the damage. It works from
  the off hand too; a blow it turns away pushes the attacker back, and a
  blow with an axe knocks it down for 5 seconds. Eating, drinking, drawing
  a bow and a raised shield slow you to a walk, as vanilla. Flint and steel,
  a fishing rod and a shield wear only by their own use, not by breaking
  blocks or hitting.
- **Village chests** hold vanilla's loot for their house (see
  **Structures**): bread, apples, potatoes and emeralds in the houses, iron,
  diamonds and iron gear at the blacksmith's, wool and shears at the
  shepherd's, fish at the fisher's, and so on.
- **Picking items up** works as in Minecraft: walk within about a block
  and a half of an item (a block beside your body, half a block above or
  below it) and it flies into your inventory, even sprinting past it. A
  freshly dropped item waits half a second, one you throw (`Q`, or from
  the inventory) 2 seconds, before anyone can take it. Online the host
  gives each item to the first player who reaches it, and everyone sees
  it fly to them.

### Enchanting, anvils and brewing

**Enchanting table** (book, 2 diamonds, 4 obsidian). Right click it, put in the
item and lapis lazuli: three offers appear, cheap to dear (the top one costs 1
lapis and 1 level, the middle 2, the bottom 3; each needs the level shown).
Bookshelves around it raise the offers: place up to 15 in a ring one block away
(two high, air between the table and the shelves) to reach level 30 offers. The
offers stay the same until you enchant something. A book becomes an enchanted
book. In Creative it costs nothing.

All of vanilla's enchantments are in: Efficiency, Silk Touch, Fortune,
Unbreaking (tools); Sharpness, Smite, Bane of Arthropods, Knockback, Fire Aspect,
Looting (swords; the damage ones on axes with an anvil); Protection, Fire, Blast
and Projectile Protection, Feather Falling, Respiration, Aqua Affinity, Thorns
(armor); Power, Punch, Flame, Infinity (the bow); Lure and Luck of the Sea (the
fishing rod). They work as in vanilla: Silk Touch keeps stone, ores, glass and
ice whole; Fortune III gives about 2.2 diamonds an ore; Aqua Affinity mines at
full speed under water (otherwise 5 times slower); Infinity keeps your last
arrow; Looting adds drops; Thorns hurts what hits you. Enchanted items shine
(in the inventory and in your hand) and their tooltips list the enchantments.
Enchanted books also come from fishing (treasure, more with Luck of the Sea).

**Anvil** (3 iron blocks, 4 iron ingots). Combine two of the same tool or armor
(their durability adds up, plus 12%), add an enchanted book, raise two equal
enchantments a level (Efficiency IV + IV = V), repair with the material (diamonds
for diamond tools, ingots, leather, planks...), or type a new name. The cost is
in levels (vanilla's: it grows each time an item goes through an anvil;
"Too Expensive!" from 40). The anvil falls like sand and wears out with use:
chipped, damaged, then it breaks.

**Brewing stand** (a blaze rod over 3 cobblestone or blackstone). Its fuel is
**blaze powder** (left slot): one powder lasts 20 brews. Put water bottles (a
glass bottle right-clicked on water, or on a cauldron) in the three bottle
slots and an ingredient on top; each brew takes 20 seconds and acts on every
bottle.

First make the base: **nether wart** on a water bottle gives an **Awkward
Potion** (glowstone dust gives a Thick Potion and redstone or most other
ingredients a Mundane Potion: they do nothing). Then:

| Ingredient (on an Awkward Potion) | Potion |
| --- | --- |
| Sugar | Swiftness |
| Spider eye | Poison |
| Glistering melon slice (melon slice + 8 gold nuggets) | Healing |
| Golden carrot | Night Vision |
| Ghast tear | Regeneration |
| Blaze powder | Strength |
| Magma cream (blaze powder + slimeball) | Fire Resistance |
| Raw salmon (the pufferfish isn't in the game) | Water Breathing |

A fermented spider eye (spider eye, brown mushroom, sugar) on a water bottle
makes Weakness. Then: redstone makes a potion last longer, glowstone dust
makes it stronger (level II), a fermented spider eye turns Healing and Poison
into Harming, Swiftness into Slowness and Night Vision into Invisibility, and
gunpowder makes any potion a splash potion. (Older worlds' potions brewed
with Round 11's stand-ins stay as they are; an old stand's stand-in
ingredient stays in its slot until you take it out.) Nether wart, blaze rods,
ghast tears and glowstone come from the Nether (see **The Nether and the
End**).

Drink a potion by holding right click (you get the bottle back). Throw a splash
potion with right click: it acts on everyone within 4 blocks (less the farther
away), creatures too (Healing and Harming; on zombies and skeletons the other
way round). A Bottle o' Enchanting thrown gives 3-11 experience.

**Cauldron** (7 iron ingots): fill it with a water bucket; a glass bottle takes
a third of it as a water bottle, a water bottle puts one back.

### Chests and work blocks

**Chests, barrels and shulker boxes.** Two chests placed side by side, facing
the same way, join into a large chest of 54 slots (sneak to place a chest
beside another without joining). Break one half and the other is a single
chest again, keeping its own things. A barrel holds 27 like a chest. A shulker
box (two shulker shells over a chest) keeps what it holds when broken: the box
drops with its contents inside, and placing it puts them back. A shulker box
can't go into another.

**Smoker and blast furnace.** Furnaces that work twice as fast: the smoker
cooks only food, the blast furnace smelts only ores, raw metals and iron or
gold tools and armour. Crafted from a furnace with four logs, or with five
iron ingots and three smooth stone.

**Campfire.** Gives light 15 (the soul campfire 10). Right-click raw food onto
it: up to four pieces cook in 30 seconds and pop off. Smoke rises from it,
much higher over a hay bale (a signal fire). It burns whoever stands on it
(not while sneaking). A shovel or a water bucket puts it out; flint and steel
or a fire charge lights it again. Broken, it drops charcoal (the soul campfire
soul soil).

**Composter.** Right-click plant matter in (seeds, leaves, crops, flowers,
bread...; each has vanilla's chance to raise the level). Full, it is ready a
moment later; right-click to take the bone meal.

**Grindstone.** Put an enchanted item in: it comes out without its
enchantments, and you get some of the experience back. Put two of the same
worn tool or armour in: they come out as one, repaired (their uses added, plus
5%).

**Stonecutter.** Put a stone block in, pick what to cut it into (slabs, two
per block; stairs, walls, bricks, chiselled and polished blocks, pillars...),
and take it: one block per cut.

**Job blocks.** The lectern, fletching table, cartography table and loom are
placeable (as decoration for now: the game has no books to read, maps or
banners). Villages have the real job blocks: a composter by each farm, a
lectern in the library, a smoker at the butcher's, a blast furnace at the
armourer's, a smithing table at the toolsmith's, a grindstone at the
blacksmith's, a loom at the shepherd's, a fletching table at the fletcher's,
a stonecutter at the mason's, a barrel at the fisher's and a cauldron at the
tannery.

**Bell.** Right-click to ring it; everyone nearby hears it (online too).

Online, all of these work for guests too: the host keeps every container's
contents and what lies on each campfire.

### Mobs

Both world types have vanilla Minecraft's creatures (a Missions world adds
its own among them: fluffalos, hoplets, mossbacks and butterflies, see
**Creatures**; a Survival world has none of those):

- **By night and in the dark** (no torch light at all, as in vanilla):
  **zombies** (rotten flesh; rarely iron, a carrot or a potato; one in twenty
  is a fast **baby zombie**; they go after villagers too), **skeletons**
  (bones, arrows, now and then their bow), **spiders** (string, spider eyes;
  calm in daylight unless hit), **creepers**, **endermen** and **witches**.
  Zombies and skeletons burn in the sun.
- **Creeper:** walks up silently; within 3 blocks it hisses, swells and
  flashes for 1.5 s, then bursts: a crater, the blocks it blew away (a third
  of them drop), and heavy damage close by. Get more than 7 blocks away (or
  out of its sight) and it calms down. Drops gunpowder.
- **Enderman:** tall, black, neutral. **Don't look it in the eyes** (the
  crosshair on its head): it screams and comes for you fast, teleporting
  closer. It dodges arrows and bullets (teleports away unhurt), hates water,
  and picks up and puts down blocks (grass, dirt, sand, flowers, pumpkins...).
  Drops an ender pearl.
- **Slime:** hops in swamps at night, and deep underground in "slime
  chunks" (one chunk in ten) at any time. A big one splits into medium ones,
  a medium one into small ones; only the small ones drop slime balls.
- **Witch:** keeps her distance and throws splash potions (poison, harming,
  slowness), and drinks a healing potion when hurt. Drops odds and ends
  (glass bottles, redstone, gunpowder, spider eyes, sugar, sticks).
- **Animals:** **cows** (beef, leather; **right click with a bucket for
  milk**), **pigs** (porkchops), **chickens** (chicken, feathers; they lay an
  **egg** every 5-10 minutes) and **sheep** (mutton and their wool: mostly
  white, sometimes grey, black, brown, very rarely pink). **Shears** on a
  sheep give 1-3 wool of its colour; it grows back when the sheep eats grass
  (which turns to dirt). A **dye** on a sheep dyes it. Animals that die burning (fire, lava) drop their
  meat cooked. **Cod** and **salmon** swim in the sea and the rivers.
- **Breeding:** hold an animal's food and it follows you (cows and sheep:
  wheat; pigs: carrots, potatoes, beetroot; chickens: seeds). Feed two of a
  kind and they fall in love (hearts) and have a **baby**, which grows up in
  20 minutes (feeding it speeds that up); breeding gives experience. A parent
  can breed again after 5 minutes. Animals you bred, fed or shore stay where
  they are when you walk away, and are saved with the world.
- **Wolves** live in packs in forests and the taiga. Hit one and the pack
  comes for you; wild wolves hunt sheep and skeletons. **Tame one with bones**
  (each has a one-in-three chance): it gets a red collar and sits; right
  click to make it stand or sit. A tame wolf follows you (teleporting to you
  when you get far ahead), fights whatever hurts you and whatever you hit
  (never a creeper), heals with meat and, healthy, breeds with meat too (the
  pups are yours as well).
- **Spawn eggs** (Creative): one for each of these creatures and for the
  Nether's and the End's (the villager and the iron golem too); right click
  a block to make it there.
- The Nether's and the End's own creatures (ghasts, piglins, blazes,
  shulkers and the rest) are in **The Nether's and the End's creatures**
  below.

(Differences from vanilla, kept on purpose: no drowned, husks, strays or cave
spiders yet; the Overworld's mobs spawn one at a time, not in packs (the
Nether's and the End's come in vanilla's groups); the monster cap is 20 per
player (24 in the End), which in the area the game keeps loaded is as busy
as vanilla's 70; piglins fight with golden swords only (no crossbows yet) and
don't pick up gold you drop (give it with a right click), don't get angry at
opened chests or mined gold, and there are no piglin brutes; silverfish
don't hide in stone (no infested blocks yet); striders can't be ridden;
nether biomes are read in two dimensions, not three.)

### Villagers and trading

- **Villagers** (farmers, librarians, armorers, toolsmiths, butchers,
  clerics, fishermen, shepherds, fletchers, cartographers, masons,
  leatherworkers, weaponsmiths; each dressed for the trade) **trade**: right
  click one to see its offers beside your inventory. Click an offer to trade
  once (the price leaves your inventory, the goods come in), shift-click for
  as many as you can. **Emeralds** are the money: a farmer pays one for 20
  wheat, a cleric for 32 rotten flesh, an armorer sells iron armor for
  emeralds... Each offer has a stock that comes back now and then. (Nitwits,
  in green, don't trade.) Trading gives experience.
  A village has a villager for each bed (up to ten about at once), and one
  living in a trade's house has that trade (the librarian in the library,
  the cleric in the church...); the farms find farmers among the others.
- An **iron golem** guards each village: it fights every monster near it
  (not creepers) and anyone who hurts a villager.

(Differences from vanilla, kept on purpose: villagers have no levels or
experience of their own and offer the trades of their first three levels at
once, at fixed prices. A village's villagers and its iron golem stay where
they are and are saved with the world, professions and trades too; a killed
golem is replaced after 5 to 10 minutes.)

## The Nether and the End

Both world types have three dimensions, as in Minecraft: the **Overworld**,
the **Nether** and the **End** (Creative too). In a **Missions** world the
UFO war stays in the Overworld: in the Nether and the End there are no UFOs,
aliens, missions, supply drops or aircraft (fly in? You can't: get out of the
aircraft first), and they are back when you come home (a mission's fight
starts over: a boss you left comes back at full strength). Online the war
follows the host: while the host is in the Nether or the End the missions
wait for everyone.

- **Travelling.** Standing in a nether portal for 4 seconds (at once in
  Creative) takes you to the other side: the Nether is 8 times smaller, so a
  step there is 8 blocks in the Overworld. You arrive in the portal nearest
  the matching spot (within 128 blocks in the Overworld, 16 in the Nether),
  or a new one is made for you. Step out of the portal before using it
  again. The End's portal (in a stronghold: see **Finding the End**) takes
  you at once to a small obsidian platform
  near the End's island; its exit portal brings you back to your bed (or the
  world spawn). While the new dimension's ground loads you wait on an
  "Entering the Nether" screen.
- **What is different there.** The Nether has no sun, moon, stars, weather
  or day: a red haze, a bedrock roof, a lava sea and dim light. Water poured
  there boils away. The End has no day or weather either, only the void
  under its islands: fall off and you die. Beds explode in both (use them in
  the Overworld). Lava flows three times faster in the Nether.
- **Dying** in the Nether or the End brings you back to your bed or the
  world spawn in the Overworld (or to a charged respawn anchor in the
  Nether); what you carried stays where you died, in that dimension, and so
  do the XP orbs your death dropped (they wait there for your return).
- **Saves.** Each dimension keeps its own changes, chests, furnaces,
  brewing stands and signs (and its own dropped items while you play); a chest at the same place in two
  dimensions is two chests. The game remembers which dimension you were in
  and starts you there. Worlds from before work as before: they are the
  Overworld.
- **Testing in Creative:** **F7** goes Overworld -> Nether -> End ->
  Overworld.

### The Nether

**Getting there.** Build a frame of **obsidian** at least 4 wide and 5 high (2
x 3 inside; up to 23 x 23; the corners can be left out) and light the inside
with **flint and steel** or a **fire charge** (any fire inside does it): it
fills with a purple **nether portal**. Stand in it (see **Travelling** above):
the screen swirls purple and you come out in the Nether, standing in a portal
there (one is built for you if there is none near, on the nearest solid spot,
else on a small obsidian platform). Walk back into it to go home to the portal
you came from. Breaking any block of the frame puts the portal out. A frame
can't be lit in the End. A portal 100 blocks away in the Nether comes out 800
blocks away at home, and since you come out at the portal nearest the matching
spot, portals close together at home can share one in the Nether. **Ruined
portals** stand here and there in the Overworld: broken frames with crying
obsidian, netherrack and a chest of gold things; replace the crying obsidian
with obsidian and light them.

**The land.** A huge cavern world under a bedrock roof, with a sea of lava at
height 31 and no day, rain or water (water poured here boils away; a water
bucket just empties). Five biomes, each with its own haze:

- **Nether wastes** (dark red): netherrack, glowstone hanging from the roof,
  nether quartz and gold ores, lava falling from the walls, fires that never
  go out, soul sand and gravel on the lava's shores.
- **Soul sand valleys** (cyan-grey haze, ash in the air): soul sand and soul
  soil, basalt pillars, bone fossils, blue soul fire.
- **Crimson forests** (red, crimson spores): crimson nylium, huge crimson
  fungi with shroomlights and weeping vines, roots and fungi on the ground.
- **Warped forests** (dark purple haze, warped spores): the same in teal,
  twisting vines, nether sprouts.
- **Basalt deltas** (grey haze, white ash): basalt and blackstone, basalt
  columns, pools of lava rimmed with magma.

**Structures.**

- **Nether fortresses**: long nether brick bridges on tall pillars,
  crossings and enclosed corridors; **blaze spawners** on raised thrones;
  rooms of soul sand with **nether wart**; chests (diamonds, gold, iron,
  golden armor, nether wart, obsidian...). Blazes and wither skeletons spawn
  inside.
- **Bastion remnants**: ruined keeps of polished blackstone bricks with gold
  blocks and gilded blackstone, a lava pit, chests on the ramparts and a
  treasure chest at the top (netherite, ancient debris, diamond gear, gold,
  and always a **Netherite Upgrade**). Piglins live there.

**Blocks and what they do.**

- **Netherrack**: fire on it (or on a magma block) burns forever, in the
  Overworld too.
- **Soul sand** slows whoever walks on it; **soul soil** doesn't. Fire lit on
  either is blue **soul fire**.
- **Magma blocks** burn your feet unless you sneak (or have Fire
  Resistance).
- **Glowstone** gives 2-4 glowstone dust (4 make the block again; Silk Touch
  keeps it whole; Fortune adds, up to 4).
- **Nether quartz ore** gives quartz (and experience), **nether gold ore**
  2-6 gold nuggets (both smelt too).
- **Ancient debris**, deep down (mostly at heights 8-24) and never in the
  open: diamond pickaxe, immune to explosions. Smelt it into **netherite
  scrap**; 4 scrap + 4 gold ingots make a **netherite ingot**.
- **Netherite gear**: at a **smithing table** (2 iron ingots over 4 planks),
  right-click holding a diamond tool or piece of armor with a Netherite
  Upgrade and a netherite ingot in your inventory: it becomes netherite,
  enchantments and wear kept (the strongest tier: sword 8 damage, 2031 uses;
  armor 3/8/6/3). A Netherite Upgrade can be copied: 7 diamonds around it and
  netherrack.
- **Nether wart** grows on soul sand (slowly, in any light); ripe it gives
  2-4. Nine make a nether wart block; with nether bricks, red nether bricks.
- **Crimson and warped** stems (an axe strips them), hyphae, planks (sticks,
  tools, a crafting table or a chest from them; they don't burn), stairs,
  slabs, fences and fence gates; fungi (bone meal on a fungus planted on its
  own nylium grows a huge one), roots, sprouts, wart blocks, shroomlights,
  climbable weeping vines (they grow down) and twisting vines (up).
- **Nether bricks** (smelt netherrack into nether brick items, 4 make the
  block) and their stairs, slabs, fences and walls; **blackstone** and
  polished blackstone (bricks), basalt, polished and smooth basalt, quartz
  blocks, pillars and bricks, bone blocks, crying obsidian.
- **Respawn anchor** (6 crying obsidian, 3 glowstone): charge it with
  glowstone (up to 4). Used in the Nether it sets your spawn point there
  (each respawn uses a charge); used anywhere else it explodes. It is the
  Nether's bed: beds explode there.
- **Items**: blaze rods (2 blaze powder; fuel for 120 s), ghast tears, magma
  cream, fire charges (blaze powder, coal, gunpowder: 3), gold nuggets.

### The Nether's and the End's creatures

The Nether has no day and night: its creatures come at any light (except
skeletons, wither skeletons and endermen, which want it dark, and blazes,
which come where the block light is 11 or less), each biome with its own,
as in vanilla.

- **Ghast** (Nether wastes, soul sand valleys, basalt deltas): a huge white
  floating cube with tentacles, crying and moaning far off. It only notices
  you when you are about level with it, then opens its red eyes and spits a
  **fireball** (6 damage, then a small blast that breaks blocks and starts
  fires) every 3 seconds. **Hit the fireball** (a blow or an arrow) and it
  flies back the way you look: a ghast hit by its own fireball dies at once
  ("Return to Sender"). Drops gunpowder and ghast tears.
- **Zombified piglin** (Nether wastes, in groups of four; now and then one
  steps out of a nether portal in the Overworld): neutral. **Hit one and the
  whole group within 20 blocks comes for you** with golden swords, for half a
  minute. Drops rotten flesh, gold nuggets, rarely a gold ingot or its sword.
- **Piglin** (crimson forests, bastion remnants): attacks anyone who isn't
  wearing **at least one piece of gold armor**; hit one and the piglins near
  it turn on you whatever you wear. **Bartering:** right click a piglin with
  a gold ingot; it holds it up and admires it for 6 seconds, then throws you
  something from vanilla's list (obsidian, crying obsidian, fire charges,
  leather, soul sand, nether bricks, gravel, blackstone, string, quartz,
  ender pearls, iron nuggets, fire resistance potions, iron boots...).
  Brought into the Overworld, a piglin shakes for 15 seconds and turns into
  a zombified piglin. Baby piglins just run about.
- **Hoglin** (crimson forests): a big hostile beast; its charge tosses you
  into the air. It keeps away from **warped fungi**, nether portals and
  respawn anchors; feed two crimson fungi and they breed. Drops porkchops
  (cooked if it burned) and leather. In the Overworld it turns into a
  **zoglin**, which attacks anything that moves.
- **Blaze** (nether fortresses, and their spawners): hovers and rises to your
  height, bursts into flame for 3 seconds, then fires **three small
  fireballs** (5 damage each, setting you alight), then rests 5 seconds; up
  close it strikes. Water, rain and **snowballs** (3 damage) hurt it. Drops
  blaze rods (only when a player kills it).
- **Magma cube** (basalt deltas, a few in the wastes and fortresses): a
  slime of lava that leaps high and pulls apart like an accordion as it
  jumps; it hurts on touch (even the small ones), splits as slimes do, and
  big and medium ones may drop magma cream. Fire and lava don't hurt it.
- **Wither skeleton** (nether fortresses): a tall black skeleton with a
  stone sword; its blow gives **Wither** (10 seconds of damage that can
  kill). Drops coal, bones, rarely its skull (an item for now) or its sword.
- **Strider** (on the lava sea, everywhere in the Nether): walks on lava,
  red and warm; on land it turns purple, cold and shivers, and looks for
  lava again. Warped fungi tempt it; feed two and they breed. Drops string.
  (There are no saddles yet, so it can't be ridden.)
- **Endermen** in the Nether's warped forests, soul sand valleys and wastes,
  and **many in the End** (the only creature that comes there by itself).
  They also go after **endermites**: one time in twenty a thrown **ender
  pearl** leaves one where you stood (it lives two minutes).
- **Shulker** (end cities): a purple box stuck to a block, lid shut (very
  tough then, arrows glance off). It peeks now and then; with you within 16
  blocks it opens and shoots slow **homing bullets** (4 damage and 10 seconds
  of **Levitation**: you float up, and fall when it ends). Hit a bullet to
  break it. Hurt below half, it may teleport. Drops shulker shells (one in
  two; two make a shulker box: see **Chests and work blocks**). Shulkers are kept with the world.
- **Silverfish** (the stronghold's spawner): small and quick.
- Fire and lava don't hurt the Nether's own creatures (ghasts, blazes,
  magma cubes, zombified piglins, wither skeletons, striders).

(What is left out on purpose is listed at the end of **Mobs**.)

### Finding the End: eyes of ender and strongholds

- **Eye of ender:** an ender pearl and blaze powder in the crafting grid.
  Thrown (right click) in the Overworld, it flies up to 12 blocks toward the
  nearest **stronghold**, rising, hangs there for a moment, then drops so
  you can pick it up again (4 times in 5) or shatters. Follow the eyes; when
  you are close, an eye dives down into the ground: dig there.
- **Strongholds** are hidden under the ground, as in Minecraft: 128 of them
  in rings round the middle of the world, the nearest three between 1280
  and 2816 blocks out. Inside: mossy and cracked stone brick corridors,
  turns, crossing rooms, stairs, prison cells with iron bars and iron doors
  (a stone button opens one), a library full of bookshelves and cobwebs,
  chests with vanilla's loot, and the **portal room**: lava, a silverfish
  spawner on the stairs, and twelve **end portal frames** round a 3 x 3
  hole. A frame takes an eye of ender (right click with one); a frame here
  and there already has its eye. With all twelve filled the **end portal**
  opens: a starry black pool. Jump in to go to the End.

### The End

- You arrive on a small **obsidian platform** floating near the main island
  (it is rebuilt every time you come). The island is end stone over the
  **void**: fall off and you die (unless you are in Creative). The sky is a
  dark, scratchy grey; there is no day, no weather and no sleeping (a bed
  explodes).
- Round the island's middle stand **ten obsidian pillars**, each with an
  **end crystal** on its top (two of them in iron-bar cages). In the middle
  is the **exit portal**, an empty bedrock bowl until the dragon dies.
  **Endermen** wander everywhere: don't look them in the eyes.

### The Ender Dragon

- The **Ender Dragon** (200 health, its boss bar at the top of the screen)
  circles the pillars, swoops at you and spits **dragon fireballs** that
  burst into clouds of purple **dragon's breath** (they hurt through armour:
  get out of them). Its wings throw you aside and its bite hurts badly.
  Now and then it lands on the exit portal, roars and breathes fire on the
  ground in front of it: hit its **head** then (a blow to its head counts in
  full, anywhere else much less; arrows glance off it while it sits; it
  takes off again after enough damage).
- **End crystals heal the dragon** (a beam from the nearest one). Shoot them
  with arrows or hit them: a crystal **explodes** (stand back), and the one
  that was healing the dragon hurts it. The caged ones need climbing or a
  good shot. Beds explode in the End: a classic way to hurt the dragon, and
  yourself. TNT hurts it too.
- A **glass bottle** used in a cloud of breath gives **dragon's breath**.
- When it dies the dragon flies back over the exit portal, rises there in
  beams of light and bursts: **12,000 experience** the first time (500 after), the **exit portal opens** (step in
  to go home, to your bed or the world spawn), the **dragon egg** sits on top
  the first time (punch it or right click it and it teleports away), and an
  **end gateway** appears at the edge of the island.
- **Bring it back:** four **end crystals** (crafted from glass, an eye of
  ender and a ghast tear) placed on the exit portal's rim, one on each side,
  rebuild the pillars and summon a new dragon.

### Beyond the gateways: end cities

- An **end gateway** (a floating starry block in bedrock) takes you 1024
  blocks out to the **outer islands**: walk in, or throw an ender pearl into
  it. An exit gateway appears there to bring you back.
- The outer islands are covered in **chorus plants**. Their **chorus fruit**
  can be eaten (even when full) and teleports you up to 8 blocks away;
  smelted it becomes **popped chorus fruit**, four of which make **purpur
  blocks**. A chorus flower planted on end stone grows into a new plant.
- **End cities**: towers of purpur with end rods on their roofs, bridges, and
  sometimes an **end ship** moored beside them, a dragon head on its bow.
  Their chests hold diamonds, iron and gold, gear and emeralds; the ship's
  cabin keeps a chest with an **elytra**. **Shulkers** guard them.
- **Elytra:** wear it in the chest slot, then press **jump while falling** to
  spread it and glide; look down to dive and gain speed, up to climb a
  little (and slow down). Landing or water folds it. It wears out with
  flight only (432 seconds of it; hits don't wear it, and worn down it stops
  working but never breaks); flying into a wall fast hurts. There are no
  fireworks yet to boost it.
- **End blocks:** end stone and end stone bricks (stairs, slabs, wall),
  purpur blocks, pillars, stairs and slabs, **end rods** (lights you can
  point any way), chorus plants and flowers, the dragon egg and the dragon
  head, the end crystal.

## How to play with friends (multiplayer)

Up to **8 players**, free, with no account and no server of your own: the
browsers connect **directly to each other** (peer-to-peer WebRTC). A free
public matchmaking server (PeerJS) only introduces them; after that the
game's data goes straight between the players' browsers. The game stays a
plain static site (GitHub Pages).

### Host a game

1. Open the game and press **Multiplayer** (on the main menu, or in the
   pause menu during a game: Esc > Multiplayer).
2. Type your **nickname**, pick the mode, named as on the main menu:
   **Survival**, **Creative**, **Missions** or **Dogfight**, and press
   **Open room**. Survival and Creative rooms play a Survival world,
   Missions and Dogfight rooms a Missions world. A mode of the other world
   type opens that world first (your last one of that type, or a new one):
   the page reloads into it, your world here saved, the game starts at once
   (Click to play) and the room opens there by itself (the room code shows
   in a message and in the corner chip; Esc > Multiplayer has the lobby and
   the invite link).
3. You get a 5-character **room code** (like `K7MPQ`). Send it to your
   friends, or press **Copy invite link** and send them the link.
4. Press **Play**. Your current world becomes the shared world. It stays
   yours: it is saved on your computer as usual, with everything your
   friends build in it.

The room plays the host's world, and so its type: guests in a Survival room
play normal Minecraft (empty-handed when new, Mods off for everyone), guests
in a Missions room the UFO war. Once the room is open, the lobby (Esc >
Multiplayer) switches between the world's modes: a Survival world's
Survival and Creative, a Missions world's Missions, Creative and Dogfight.
A Missions room's guests play the host's world as it is (its land's version
too: an old Missions world's guests get its old land).

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

- **Missions together:** one mission chain for the whole group, the host's.
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
- **Survival together** (a Survival world): normal Minecraft for everyone in
  the host's world; no missions, UFOs or mod weapons. Each player has their
  own hunger, effects, XP and bed (the host keeps a guest's between visits).
  XP orbs are your own: only the player who mined, killed, smelted, bred or
  traded sees and picks them up. Everyone in the Overworld must be asleep to
  skip the night (the dead, and players in the Nether or the End, don't
  count): the screen says "1/2 players sleeping", and the others see you
  lying in your bed. The host's computer runs every
  creature: guests see them as they are (a sheep's colour and wool, babies, a
  creeper swelling, an enderman's block) and can shear, milk, feed, breed,
  tame and trade with them like the host (the host keeps each villager's
  stock, so two players can't buy the same last item).
- **The Nether and the End together** (a Survival world): every player is
  in a dimension of their own choosing: the player list shows who is in the
  Nether or the End, and you only see (and fight) the players in yours.
  Everything built or broken in a dimension is kept by the host and shown to
  whoever goes there, so a friend coming back from the Nether sees what you
  built meanwhile. The host runs the world (creatures, fire, redstone,
  crops) of the dimension it is in; a dimension the host is not in is run by
  the first player who joined of those there, and its creatures are each
  player's own until the host comes. In the host's dimension the Nether's
  and the End's creatures are the host's like the rest (the ghasts' and the
  blazes' fireballs and the shulkers' bullets fly on the host and everyone
  sees them); you can hit a ghast's fireball back yourself, barter with the
  host's piglins, and they know whether you wear gold. The **dragon's
  fight** is shared by everyone in the End: the host runs it while there
  (else the first player who joined of those in the End), it goes on from
  where it was when someone else takes over, each player gets their own
  experience when it dies, and the host keeps the fight in its save.
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
  UFO" (Missions mods screen) asks the host's game for it. Everyone can use the
  pause menu's **call-ins** (an F-22, F-16, B-2 or UFO, straight into the
  air; a tank or the missile truck on the ground): the others see the aircraft and who flies it. The palette's vehicle
  items work the same online, in a Survival world's Creative too: everyone
  sees the aircraft anyone puts down or flies. Switching between
  Creative and Missions (or Survival) never changes anyone's inventory.
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
  with their health (outside Creative) and the distance when they are far.
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
- **Furnaces** are the host's too: everyone sees the same furnace (two
  players can use one at once), it smelts at the host's world (also near a
  guest far from the host), and the one who takes from the output gets the
  experience. Crafting happens in your own inventory (nothing to wait for).
- **Brewing stands** are the host's as well (like furnaces: everyone sees the
  same bottles); the enchanting table and the anvil are each player's own
  screen. Enchantments and names stay on items in chests, furnaces, on the
  ground and in saves, and splash potions reach every player and the host's
  creatures.
- **Signs** are the host's too: a guest's text goes to the host and on to
  everyone, a joining player sees every sign's text, and a broken sign's
  text goes with it. The host saves them with its world.
- **Redstone** runs at the host: a guest's lever, button or plate works
  like any block change and the host's circuits answer for everyone; primed
  TNT is seen falling and flashing on every screen, and note blocks,
  pistons and buttons are heard by everyone near them.
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

New blocks and items go in a content module (`js/content/*.js`, listed in
`js/content/index.js` with its id ranges): block and item definitions,
texture and icon painters, mesh shapes (a box helper lights and shades them
like cubes), recipes, and handlers for right clicks on a block or with an
item, random ticks and drops. A module imports only `js/content/base.js`;
edits its handlers make travel online like a player's.

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

## Vehicles

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

### Vehicles in Creative

In Creative, in a Survival world as much as in a Missions world, you can fly
everything: the palette's **Vehicles** tab (`E`) has the **F-22 Raptor**, the
**F-16 Fighting Falcon**, the **B-2 Spirit** (with its nuke) and a **UFO**.
Take one into your hotbar and **right click**:

- aimed at the ground (up to about 96 blocks away), the aircraft is put down
  there, facing the way you look, its tail clear of you: on its wheels (a
  jet) or hovering just over the ground (a UFO). Walk up and press `F`. A jet
  needs dry, open ground (not water; a B-2's wings span 43 blocks): if
  something is in the way you are told so;
- aimed at the sky, you are straight in the air at the controls (like the
  pause menu's call-ins).

Each UFO you put down is the next of the nine designs (sneak while you place
it for a small one; the Mods screen's "Spawn a UFO to fly" picks the design
and size). Everything works as in a Missions world: the flight, the cannon,
the missiles, the bombs and the nuke, the UFO's weapons and beam, at the
creatures around (a Survival world still makes no UFO fleets, aliens,
missions, airports or cities). A jet takes off from any long, flat field and
lands on any flat ground: no runway needed. The vehicles you put down stay in
the world and are saved with it, like boats (up to 8: the oldest empty one
goes when you put down a ninth). They stay in the Overworld: in the Nether or
the End you can't summon one, and the ones you left are waiting when you are
back.

The Vehicles tab also has the **Tiger Tank**, the **Battle Tank** and the
**Missile Launcher (TEL)** (see **The ground war**): put one down on the
ground (right click) and get in with F. In the launcher, aim at the ground
and left click: it raises the missile and launches at that point (at least
120 blocks off); right click calls it off before ignition.

In a Survival world this is Creative's only: in Survival mode the vehicle
items do nothing, you can't board a vehicle (`F` swaps your hands as usual),
and switching to Survival while flying sets you down (on a parachute from up
high). Online, everyone sees everyone's aircraft (a host or guest in Creative
puts them down; a player in Survival mode can't).

### Your UFO

Board a UFO that came down in one piece, or one of the small ships that
sometimes hover in the hall of a **secured underground bunker** at an
airport (armed human guards stand watch and open fire when you enter the
restricted zone; in Missions boarding works from the "Salvage" mission;
before that they are locked), or in Creative spawn one from the
**Missions mods** screen (any shape and size). It has no physics limits (and no ceiling: fly as high as you like): it hovers
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
| **Lock-on salvo**: lock the UFO, jet or hostile creature nearest the crosshair; after 3 s a salvo of homing laser bolts (more for bigger ships) leaves by itself; let go earlier to cancel; 7 s to recharge. (Round 13) It uses the same targeting symbols and seeker tone as the jets | Hold `T` |
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

**In Missions there is no calling in a jet** (Creative: see **Vehicles in
Creative**): fighters stand **parked at airports**, in front
of the hangars (F-22 Raptors and F-16 Fighting Falcons), and (Round 10) now and
then **inside a hangar**, nose to the open doorway, with a clear way out to the
taxiway (nothing is parked in front of it): get in and taxi straight out. And a
**B-2 Spirit** bomber at every airport (always outside: it is too big for a
hangar): in its own spot on the apron, or (Round 9) where
the apron has no room for its wing, on the runway just past the end of the
apron, lined up for takeoff. Walk up to one and press **F** (the B-2 near
the middle of its wing). In Missions that works from "Take to the air" (the
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

**Hit where it is** (Round 10): every aircraft is hit by its real shape, not
a ball around it: the F-22 and the F-16 by their fuselage, cockpit, intakes,
wings, tailplanes and fins, the B-2 by its own planform and thickness, out to
its wing tips. A shot that passes beside the nose or just over the back
misses; one that clips a wing tip hits. A blast counts from the nearest part
of the airframe (one under the wing hurts, one well off the nose or above the
back doesn't), missiles go off a couple of blocks from the airframe, and the
same goes for parked aircraft and other players' aircraft online. Standing
under a parked aircraft's wing no longer shields you: shots that pass under
the wing reach you, and only the ones that meet the wing hit it. UFOs (yours
and the enemy's) keep their shapes.

**Collisions** (Round 10): aircraft that touch, on the runway or in the air,
are hurt by how fast they meet: a gentle bump (under about 4 blocks/s) just
stops them with a knock, a taxiing scrape dents both, and a real crash (about
28 blocks/s or more between them, such as head-on in the air) destroys both,
with the usual explosion: eject in time. The heavier one takes less: a B-2
shrugs off a bump that would wreck a fighter. Your UFO counts too (except
mid-dash: the dash rams as before). Online every player's aircraft, the
patrol fighters and the parked ones collide alike, and each collision is
counted once.


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
| **Missile** | A **click** of right click fires a missile: a **homing** one at the target the auto aim has locked (see below), else one **unguided**, straight ahead |
| **Auto aim** (Round 13, Settings > Vehicles, on by default) | A **seeker circle** sits round the crosshair. Keep a UFO or an enemy aircraft in it and the seeker **slides onto it and closes round it** while the lock builds (a low **growl** that rises and quickens); after about **2 s** it is **LOCKED** (a solid box with a diamond, a **LOCK** tag, a solid high tone, like a real AIM-9's). A slip out of the circle costs time, not the whole lock; once locked it holds while the target stays within about 55 degrees of your view and 2200 blocks. A right **click** then sends a missile after it (your view stays with you, and so does the lock, for the next one); **holding** right click goes on from the lock as before (the salvo, the view on the target). Only a lock made tells a UFO it is locked (it gets angry): just looking at one doesn't |
| **Missile lock** | (Round 8: a lock never switches targets: if it loses its target it is gone until you press again; a salvo goes entirely at the locked target; a **left click cancels** the lock, nothing fires.) **Hold** right click: the UFO or aircraft nearest the middle of your view (even behind you; ones **attacking you** first; never creatures) is locked, the camera turns to look at it **while you keep full control of the jet** (the mouse still steers, a ring on the HUD shows where; every key works). Release after **1 s** (at once if the auto aim already has it locked) for one missile, after **3 s** (F-22) or **2 s** (F-16) for a **salvo** (four or two). A missile at a target behind you turns around. The lock is **stable**: once locked, it stays on that target until you let go, it dies or it is more than 2200 blocks away. Locking does not anger other UFOs. After launch the **camera follows the target until the hit** and **you keep full control** of the jet; right click brings the normal view back at once. Let go before LOCKED and nothing fires |
| **Salvo charge** | From the solid lock to the salvo time the salvo's **pips fill one by one under the target box** (Round 13; it was a spiral), with a rising click per missile (4 on the F-22, 2 on the F-16); when they are all lit (**SALVO x4**) a release fires the salvo (before that, one missile) |
| **Roll out of a missile** | A hostile missile that gets close when you have **rolled more than about 90 degrees** (either way) loses you and **passes narrowly by** ("MISSILE EVADED!"); it needs a few seconds before it works again, so rolling all the time does not make you immune. Flares still work as always |
| **Flares** | `C` (a salvo of 6 decoys, one after another every tenth of a second, left and right in turn, as a real dispenser fires them; any of them can fool a missile or a seeking shot, which may even turn on whoever fired it; 5 s to reload; the B-2 and the enemy fighters fire the same salvo) |
| Nuclear bomb (**B-2 only**) | `B` (it drops on a parachute: get clear! No cooldown) |
| Chase / cockpit view | `F5` |
| Get out / eject | `F` |
| Stats and controls panel | `I` |

The HUD shows speed (with the **Mach number**), altitude, throttle, heading,
the missile lock, flares, the nuke, the cannon **heat bar**, the jet's
health, takeoff hints, and warnings: **STALL**, **PULL UP**, **CANNON
OVERHEATED**. (Round 13) **The targeting symbols** are a fighter's HUD: the
seeker circle, corner brackets that track the target (sized to it) with its
**name** (UFO, BALL UFO, MOTHERSHIP, the boss's name, BANDIT), its **range**
and **closure speed** (VC, km/h) beside them, the lock's progress, then the
solid box, diamond and LOCK tag; an **arrow on the screen's edge** when the
target is off the screen; a small **diamond on each of your guided missiles**
on its way, with its **time to go** (TTG) by the target. **MISSILE** flashes
low in the middle of the screen (faster when it is close, with its range)
with a red triangle on a ring round the crosshair pointing where it comes
from, and a beeping that speeds up as it closes in; an amber **LOCK** (and a
thin warble) means an aircraft out to get you has its nose on you. Your
guided missiles fly **proportional navigation**, as real ones do (they lead a
crossing target onto a collision course); missiles still have a limited
turn rate: **sharp turns (and flares) make them miss**, and an enemy fighter
drops flares at yours. With flight assist off, the mouse is the stick
(up/down pitch, left/right roll). **Settings > Vehicles:** top speed (default
about 1000 km/h), acceleration, turn rate, stall speed, flight assist,
cannon aim assist, **auto aim (missiles)**, **pilot voice callouts**, and
patrol fighters. (**Settings > Audio:** a **Pilot voice** volume.)

**The sound barrier** (Round 13): Mach 1 is **1235 km/h** (767 mph; the HUD
shows the Mach number). With the **afterburner lit** the fighters now go a
little past it (the F-22 to about Mach 1.1, 1360 km/h, the F-16 to about
Mach 1.06), as the real ones do; the B-2 stays subsonic like the real one
(unless the top speed setting is raised in Creative). Going through it: a
**vapor cone**, a white conical collar of mist round the fuselage that
flashes for about a second, a **shock ring** racing out from it, a puff of
condensation, a jolt, and the **sonic boom**, the double crack of the shock
wave over a deep thump: heard by everyone around, later and more muffled the
farther away they are (at the speed of sound), and felt close by. Slowing
back through it: a softer boom and a faint ring, no cone. Your UFO does it
too (it is fast), and so do the enemy fighters, the UFOs and, online, the
other players' aircraft: each machine sees them break it. (A missile chasing
a supersonic jet is faster too: it keeps its old edge.)

**Missile blasts** (Round 13) are bigger: a white-hot flash, a larger rolling
fireball, a shock sphere, burning fragments arcing out, a dark smoke ball
and a deeper boom; on the ground a crater a third wider (6.5). The damage to
UFOs and creatures is as before (190 for a hit; the splash a few points more
from the wider blast). Online everyone sees them.

**The pilot's voice** (Round 13): callouts over the radio (a click and a
burst of squelch before and after each line): **"Splash one!"** for an
enemy fighter, **"UFO destroyed!"** (or "Object taken down!", "Bogey
down!"), **"Ball UFO down!"**, **"Mothership destroyed!"**, **"Target
destroyed!"** for a boss, **"Tank destroyed!"**; **"Fox two!"** when a guided
missile leaves the rail, **"Missile, missile!"** when one comes for you,
**"Missile defeated!"** when you roll out of one. One line at a time, never
the same twice in a row; the words are your browser's own speech (an
English voice: Chrome and Edge have good ones); without speech you hear
just the radio. **Settings > Vehicles: Pilot voice callouts** (on by
default); **Settings > Audio: Pilot voice** volume (it follows the master
volume too).

**Patrol fighters:** friendly fighters patrol high up, a little faster than
yours, and **hunt UFOs** (only UFOs: they help, but never clear the sky for
you: weaker against UFOs, long pauses, at most three kills, and their kills
don't count as yours). They leave you alone, whatever you shoot, unless you
attack one of them: **only that fighter** turns on you (a message says so),
with missiles from a distance and then its cannon, flares and breaks (Round 10: it breaks off rather than ram you; aircraft that
touch now crash). The
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

## The ground war: tanks and missile launchers

**Tanks.** Two to drive: the **Tiger** (a heavy WWII tank: thick armour, the
long 88, a slow turret) and a modern **battle tank** (faster, a quicker
turret). Walk up and press **F**.

| Key | |
|---|---|
| W / S | forward / brake, then reverse |
| A / D | turn the hull (on the spot too) |
| Space | brake |
| Mouse | aim: the turret and the gun follow at their own speed |
| Left click | the main gun (an HE shell on a real arc; reload 4-5 s) |
| Right click | the coaxial machine gun |
| V (or F5) | the gunner's sight: zoomed, with stadia, range marks and the rangefinder |
| C | smoke launchers: a white screen the enemy can't see through (25 s) |
| F | get out |

The white cross is where you aim; the green circle is where a shell would
land right now: it slides onto the cross as the turret comes round (the
fire control works out the range and the elevation). The ring round the
cross fills as the gun reloads. A tank climbs one-block steps, crushes
leaves and plants, is slowed by water and won't go into deep water; walls
and tree trunks stop it. Below half its armour it smokes, below a quarter
it burns; at nothing it cooks off and throws its turret.

**Enemy tanks, AA and launchers (Missions).** The aliens have hijacked
tanks, AA vehicles and ballistic missile launchers. Their tanks swing their
turrets round slowly and their aim settles a moment before they fire: keep
moving. AA vehicles track aircraft with their radar: tracer flak with black
bursts, and SAMs (your missile warning sees them; flares, C, and hard turns
fool them). Their wrecks often leave a supply crate. After the tank battle
mission, a platoon or an AA site turns up now and then on its own.

**Ballistic missiles.** A launcher (a TEL truck) lowers its jacks, raises
its missile upright, vents, and lights it: the missile leaves very slowly,
then climbs faster and faster high into the sky on a long flame and a thick
white trail, arcs over and comes down far away in a huge blast. A red ring
on the ground marks where an incoming one will land.

**Military bases.** New Missions worlds have airbases: an airfield with a
big walled base behind it (fences, walls and watchtowers with floodlights,
a gate with guardhouses, barracks, a command building, vehicle sheds, a
yard of parked tanks and missile trucks, radar dishes, a helipad, fuel
tanks, ammo bunkers, AA positions). The yard's tanks are yours to take from
the tank battle mission on (in Creative at once). Worlds saved before
Round 13 keep their land and sites as they were.

**New missions:** *Tank battle* (always in a run: a tank of ours, a platoon
of theirs), *Stop the launch* (destroy the launchers before they fire at
the airport), *Convoy* (destroy a column from the air), *Air defense*
(destroy the AA vehicles), *Base assault* (take back an enemy-held base).

Online: the host runs the enemy; everyone sees the tanks, their shots, the
SAMs and the missiles; anyone's hits count.

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

**Missions mods** (the button at the top of Settings) switches all the Missions content on
or off. It's on by default. Off takes the UFO war out of a Missions world:
no guns, explosives, vehicles, UFOs or aliens (swords and tools stay, and
so does everything of normal Minecraft underneath: crafting, hunger, vanilla
mobs and the rest). Switching mid-game is instant and clean: mod items are put away and come
back to the same slots when you switch mods on again; projectiles, UFOs,
aliens and vehicles leave the world.

A **Survival world** never has Mods: in one, the switch shows off and locked
(with a note), whatever your setting, which stays yours for your Missions
worlds.

## Graphics and performance

**Auto (best for this PC)** is the default (the first choice of the graphics
preset row in Settings > Graphics, and the first button of the
performance presets). It starts at the best graphics and performance (Ultra,
32 chunks, 10 full-detail chunks, Ultra far terrain) and, while you play,
watches the frame rate: if it stays under 40 FPS for about six seconds it
steps down one level and lets it settle, then again if it's still low,
down to the lightest:

| Level | Graphics | View | Full detail | Resolution |
| --- | --- | --- | --- | --- |
| Max | Ultra | 32 chunks | 10 | 100% |
| High | High | 28 | 8 | 100% |
| High, shorter view | High | 20 | 6 | 100% |
| Medium | Medium | 20 | 6 | 100% |
| Medium, lower resolution | Medium | 16 | 5 | 80% |
| Low | Low | 12 | 4 | 100% |
| Low, lower resolution | Low | 9 | 3 | 75% |
| Lowest | Low | 7 | 3 | 60% |

It only measures in play (not on menus, paused, while shaders compile or
right after a load or a teleport, while a burst of chunks streams in),
ignores single hitches, and a short message tells you when it lowers the
graphics. If two steps in a row don't help (the computer is busy elsewhere,
not drawing), it stops lowering. Once in a session it can go back up one
level, to one that ran fine earlier, after a long stretch with lots of
headroom. Where it settles is saved, and the next start begins there. Pick a
preset (graphics or performance) or change any graphics or performance
setting yourself and Auto turns off for good, keeping your settings; choose
**Auto** again (or **Reset to defaults**) to turn it back on.

**Graphics presets** (Settings > Graphics):

- **Low:** no shadows or post-processing. For weak laptops.
- **Medium:** sun shadows and bloom.
- **High:** two cascades of soft sun shadows, normal-mapped textures with
  specular light, refractive water, light shafts, 3D grass, reeds, ferns
  and flowers, and fuller tree crowns.
- **Ultra:** everything on High, plus a third shadow cascade with
  contact-hardening soft shadows, parallax (3D) textures up close, water
  reflections of the world, plants reaching farther (Round 12: as thick as
  High's, finer and a little lower, so what lies in the grass stays in
  sight), and full resolution on high-DPI screens.

On every preset you get animated water, moving lava and fire, light that glows
through leaves, haze that thickens with distance, and low mist over water at
sunrise and sunset. Caves are lit only by what is in them (torches, lava,
glowing blocks): the sun and the moon never reach rock that can't see the sky
(no glints on cave walls, no thin lines of light along their edges), and a
cave's air holds no sky-coloured haze or mist. A cave without any light is
dark but faintly visible, as vanilla's light level 0, and the same by day and
by night. Under water, High and Ultra add light shafts from the surface, and
every preset shows drifting particles. **Rain and snow** (both world types) are
drawn round the camera on Medium, High and Ultra (more drops on the higher
presets); Low draws none (the sky still turns grey, and you still hear the
rain).

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
(Auto starts at 32). The far terrain is built by a pool of worker threads. The area around you is drawn in full detail, and the land beyond it in
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
| Graphics | Render distance 2-256 chunks (Auto's), graphics preset **Auto (best for this PC)** / Low / Medium / High / Ultra with individual options, show FPS (on), Fullscreen |
| Performance | One-click presets **Auto** / Potato / Balanced / Beautiful / Max / Extreme; full-detail distance 0-24 (Auto's), far terrain quality Low-Extreme (Auto's), resolution scale 50-200% (Auto's), effects detail (Auto's) |
| Controls | Field of view 50-110 (75), mouse sensitivity 0.1-4x (0.5x), invert Y (off), binocular zoom 2-12x (6x) |
| Audio | Master (15%), blocks and footsteps, weapons and explosions, creatures, player, menus, pilot voice |
| Gameplay | Difficulty Peaceful / Easy / **Normal** / Hard, stats on the HUD (off); **Creative only:** creatures spawn (on), time of day and lock |
| Weapons | Laser blaster color Red / Green / Blue (Red), nuke effects intensity Low / Medium / **High**. **Creative only:** grenade and bazooka blast size (1x); airstrike: meteors per strike 1-40 (7), spread 0-80 (22), delay 1-20 s (5 s), fall angle 0-70 degrees (35), fall speed 30-250 (95), meteor blast size (1x); nuke size 12-200 (96) |
| Mobs | **(Creative only)** Zombie spawn rate Off to APOCALYPSE (1x), max zombies 0-400 (8), zombie health and damage 0.25-5x (1x), daylight zombies (off) |
| UFOs | (**All of this tab is Creative only**: in Missions the mission chain sets the sky.) UFO activity Off to UFO APOCALYPSE (Occasional); **advanced:** spawn chance, max UFOs (Auto), aggression (Never attack to 2x), detection range 40-300 (130), tractor beam lift speed (4), sizes (Balanced), night multiplier 1-6x (3x), toughness 0.25-4x (1x) |
| Vehicles | UFO top speed 20-1200 (300) and slowest speed 0.5-8 (2), ghost mode (off), beam lifts loose blocks (on), teleport dash distance Off-3x (1x) and travel time 0.08-0.6 s (0.25 s), jet flight assist (on; the only one Missions keeps), jet top speed 288-2520 km/h (1080), cannon aim assist (on), auto aim for missiles (on), pilot voice callouts (on), patrol fighters 0-3 (1), acceleration 0.5-2.5x (1x), turn rate 0.5-2x (1x), stall speed 90-252 km/h (151) |

**Missions and Survival fix the rules of the game.** Every setting that changes weapon stats, creature or UFO numbers and strength, vehicle performance or the clock (marked *Creative only* above) is hidden outside Creative, and there the game uses their defaults whatever was set in Creative (switch modes in the pause menu and your Creative values come back). Missions and Survival keep graphics, performance, controls, audio, difficulty, the stats overlay, the blaster color, the nuke's visual intensity and the jet's flight assist.

Heavy values show a short performance note next to the slider (for example
hundreds of zombies, or a long full-detail distance).

## The world

(Round 13) A new Missions world's land is a Survival world's (vanilla's
ores, lava, frozen water, biomes, trees and jungles, villages, its
structures: dungeons, mineshafts, desert and jungle temples, ruined portals,
strongholds; see **Survival (vanilla Minecraft)** and **The Nether and the
End**), with the airports, cities and military bases on top; a Survival
world has no airports or cities. What follows is the land of a Missions
world made before Round 13, which keeps it (its old saves look the same:
the terrain, ores, trees and water as before Round 11), with all the blocks
and items in its Creative palette; the airports and cities below are in new
Missions worlds too.

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
glowing crystals underground. (Iron and diamonds are gone from an old Missions world.) Forests and meadows alternate: oaks with irregular crowns and
branches, pale birch groves, dark pine woods on the hills, and rare huge old
oaks with roots spreading over the ground. On High and Ultra the ground
comes alive with grass, reeds along the water, ferns in the shade of trees,
and flowers. (Round 12) No grass grows over a dropped item lying in it, so
you always see what you dropped.

**Villages** (Round 8: bigger: a cobbled plaza with a well, gravel streets,
six to ten houses with windows, farm plots, lamp posts, up to five villagers;
Round 10: wall torches inside every house and beside every door, and a
**chest** with loot in about half the houses, one more in the biggest;
a Survival world's villages are vanilla's since Round 12, in the style of
their biome (see **Structures** under **Survival (vanilla Minecraft)**),
and so are a new Missions world's (Round 13), while an old Missions world's
villages are as before), and much bigger **airports and cities** (Missions worlds only), are rarer (and spread far apart), except for one regular
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
- A Survival world's **Copy world link** carries its type (`&type=survival`):
  a friend who opens it makes a Survival world from that seed (someone who
  already has a world with that seed continues their own, in its own type).

Your block edits, position, inventory and settings are saved in your
browser's local storage, per seed, on your device only. Other players who
open the same seed link get the untouched world. Creatures and items lying
on the ground aren't saved (except, in a Survival world, the animals you
bred, fed, shore or tamed); chests, furnaces and brewing stands keep their
contents, signs their text, redstone circuits their state, and a Survival
world its weather.

Worlds from older versions open unchanged, with every block edit. A world
saved with one of the new (Round 11) blocks in it is saved in a newer format
that older versions of the game can't read; worlds without them stay
readable by older versions too.

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
  preset in **Settings > Graphics** (Auto lowers the graphics on its own
  once you play, if the frame rate is low).
- **Graphics card trouble:** if a start never gets as far as showing the
  world, the next start lowers the graphics a step (the start menu says so).
  On Auto, that lower level is kept (Auto had found its limit).
  If the browser loses the graphics card mid-game, the game saves, lowers the
  setting and asks you to reload. To pick a setting from the address bar,
  add `?graphics=low` (or `medium`, `high`, `ultra`) (that is a choice of
  your own: Auto turns off).
- **"WebGL couldn't start":** turn on hardware acceleration in the browser's
  settings, update the browser and graphics driver, and restart the browser:
  after a graphics driver crash, browsers keep WebGL off for a while.

## Deploying

This is a static site: the folder can be hosted as is, including on GitHub
Pages. The `.nojekyll` file makes GitHub Pages serve the `js/` folder
correctly. All imports use relative paths.

## Tests

`/tools` has thirty-three test suites (`cd tools && npm install && npm test`
runs all of them; `npm run test:r10` just the Round 10 ones, `npm run
test:r11` just the twelve Round 11 ones; the browser tests need a Chromium
binary, set with the `CHROMIUM_PATH` environment variable).
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

- `r10-planes-tests.mjs` (Round 10): the aircraft's hit shapes and
  collisions. In Node, the shapes themselves (a ray beside a fighter's nose
  or over its back misses, one through a wing tip or a fin hits, the F-16's
  wingtip missile and the B-2's wing tips count, a block under the B-2's wing
  is clear, distances to the airframe, two fighters passing through each
  other in one long frame touch). In the game: a player's bolt beside a
  fighter's nose or over its back misses and one through the wing tip hits;
  an alien's shot at a player standing under a B-2's wing reaches the player
  and one from above meets the wing; a blast under a fighter's wing hurts it
  and one well over its back doesn't; two jets meeting head-on both blow up;
  a gentle bump on the runway stops the jet and leaves both nearly intact; a
  taxiing scrape dents both and destroys neither. About a minute.

- `r11-modes-tests.mjs` (Round 11): the three ways to play. A new Missions
  world as before (the starter kit, the missions, Mods on) and the main
  menu's three cards; a new Survival world made from the New World screen:
  empty-handed, Mods off for it (the setting untouched, the switch locked),
  no missions, crates, UFOs, aliens, vehicles or call-ins, no Missions
  button, and no airports or cities in its terrain; Creative and back keeps
  it a Survival world, and its type survives a reload (the save's, not the
  link's); an old save without a type loads as a Missions world; the other
  type's card opens the last world of that type. Online (a host and a guest
  through a local PeerJS server): a Survival room gives the guest a Survival
  world with Mods off and offers only Survival and Creative (no Dogfight); a
  Missions room is as before. `--solo` skips the online part.
- `r11-engine16-tests.mjs` (Round 11): the 16-bit block ids and the content
  registries in the real game, with the test-only Debug Block and Debug Slab
  (`js/content/debug.js`): placed by a right click, meshed in the workers
  byte for byte like the main thread, lit, stood on (the slab's half-height
  collision), block use, item use and placeAs, random ticks, broken into an
  item, picked up and placed again, saved and reloaded, an old (byte-format)
  save, the distant terrain's colour; with `--mp` the join snapshot and live
  edits both ways between a host and a guest. About 4 minutes (6 with `--mp`).
- `r11-crafting-tests.mjs` (Round 11): crafting and smelting in a Survival
  world. The inventory's 2x2 grid (a log into planks, planks into sticks,
  four planks into a crafting table, a shapeless recipe in any slot, the
  result onto the mouse, shift-click crafting as many as fit into the
  hotbar's end first, what is left going back into the inventory on
  closing); the crafting table's 3x3 grid (a wooden pickaxe, an axe
  mirrored, a recipe shifted in the grid, a milk bucket's bucket left
  behind); a Missions world with no grid and a crafting table that opens
  nothing; the furnace (placed facing the player, raw iron and coal into an
  ingot after 10 s of game time, the burn times, the lit block and its light,
  the experience on taking the output, the fuel slot refusing what doesn't
  burn, its contents kept through a reload and dropped when it is broken).
  Online, a guest uses the host's furnace (fills it, the host smelts, the
  guest takes the output and its experience; a stale click is refused);
  `--solo` skips that.
- `r11-building-tests.mjs` (Round 11): the building blocks. Stairs placed
  facing away from the player and upside down on a side's upper half or
  under a block; vanilla stair corners in the shape and the collision; a
  slab onto its other half making the full block (not across kinds); a door
  placing both halves, opening both, breaking either taking both and
  dropping one door, the second of a pair hinged right, an iron door that
  doesn't open by hand; fence, gate and wall connections and heights (a
  fence 1.5 tall, a slab stood on at half height, an open gate walked
  through); a bed's two cells and the sleep hook; a ladder and a hanging
  lantern coming off with their block; every shape meshed byte for byte the
  same in a worker and on the main thread; icons and 3D item models for
  every building block; every building recipe resolving; in Node, a
  Survival world's village with doors, beds and panes and a Missions world's
  with none of the new blocks (`--nobrowser` runs only that).
- `r11-decor-tests.mjs` (Round 11): dyes, signs, cakes and the rest. In
  Node: every dye has a source (a plant or thing of the world, or mixing
  dyes that have one), the dyeing recipes and their yields, the texture
  budget (`--nobrowser` runs only these). In a Survival world: a bed of wool
  of each colour; a sheep dyed (its skin, kept with the world, its wool that
  colour, a shorn one refused); a sign placed opening its editor, the text
  typed with the keyboard (15 characters a line) drawn on its front, a dye
  colouring it, a right click editing it again, the text and colour through a
  save and a reload and gone with the sign; signs online through a stand-in
  session (the host keeps a guest's cleaned text and passes it on, refuses one
  from afar; a guest takes the host's word and sends its own); the cake
  placed from its item, a slice feeding 2 / 0.4, none when full, gone after
  seven; a coloured bed's two cells and a night's sleep in it; concrete
  powder set beside water, sinking into water under it, falling like sand;
  flower pots; stained panes' joins in the collision; every decor shape
  meshed byte for byte the same in a worker; icons, item models and recipes
  for everything. `--overlay=dir` serves files from dir first (to try other
  files' patches before they are merged).
- `r11-nature-tests.mjs` (Round 11; Node only, a few seconds): a Survival
  world's terrain (ores at their depths, lava lakes and pools, frozen water,
  snow, red sand, the new trees and their vines, lily pads), a Missions
  world's terrain hashing as before Round 11, lava flowing and drying, lava
  and water (obsidian, cobblestone, stone), water's reach (7 or 4), tilling,
  planting and crops growing and dropping, bone meal and saplings (the 2x2
  dark oak), leaf decay, sugar cane and stems, fire spreading and burning
  out, the blocks' shapes and drops.
- `r11-items-tests.mjs` (Round 11; about 2 minutes): in a new Survival
  world, every vanilla item has a name, a painted icon and its stack size and
  the foods their classic values; a bucket picks up a water source and pours
  it back; flint and steel sets fire; the bow takes one arrow a shot (none in
  Creative) and a stuck arrow is picked up again; a fishing rod casts into
  water and a forced bite reels in a catch; an ender pearl takes you where it
  lands (5 damage) and an egg is thrown; shears cut leaves whole, golden
  tools mine at gold's speed and the ores drop raw metal and gems; a village
  chest holds the classic village loot; the compass and the clock turn in
  hand. Then a Missions world: the bow needs no arrows and ores and chests
  are as before.
- `r11-survival-tests.mjs` (Round 11): a Missions world keeps today's rules;
  in a Survival world, sprinting drains food over distance, starving stops
  at each difficulty's floor (Peaceful refills), regeneration needs 18 food
  points, bread restores 5 / 6 through a held right click, a golden apple's
  effects, poison's floor and a stew's bowl, a mined coal ore's XP orbs fill
  the bar (vanilla's curve), death drops 7 a level, milk clears the effects
  (and gives its bucket back), a raised shield stops a blow from in front, a
  witch's potion goes through armor, a baby zombie gives 12 XP, sleeping at
  night skips to the morning and sets the spawn (and not by day or with
  monsters near; a broken bed sends you to the world spawn), lava, burning,
  water, cactus and suffocation damage, 15 s of air, the step up onto a
  slab, ladder climbing, and a reload keeps it all. `--online`: a host and a
  guest must both sleep (the count shows), the host skips the night and the
  guest wakes.
- `r11-mobs-tests.mjs` (Round 11): a Survival world's mobs. Its spawners
  make only vanilla kinds (creepers, endermen, slimes and witches do spawn at
  night, no monster in daylight in the open); a creeper near the player
  swells and bursts, breaking blocks and hurting the player; a sheep is shorn
  and its wool grows back as it eats grass; two cows fed wheat have a calf
  that grows up, a cow gives milk; an enderman stared at gets angry and
  dodges a shot; a big slime splits; a spawn egg works; a villager's trade
  swaps the items; a wolf tamed with bones sits, follows and defends its
  owner; Survival drops (rotten flesh, cooked meat from a burning cow); a
  Missions world's mob set and drops are today's. Online (a host and a
  guest): the guest sees the host's mobs as they are, shears, feeds, trades
  and tames through the host, and a creeper's blast reaches the guest.
  `--solo` skips the online part.
- `r11-redstone-tests.mjs` (Round 11): redstone and TNT. In Node (a world
  of plain chunks, a second): a lever's dust lights a lamp 10 and 15 blocks
  away but not 16; a torch inverts a tick late; buttons pulse 1 and 1.5 s;
  a pressure plate under a player opens an iron door and shuts it after; a
  repeater delays and is one-way; a piston pushes a row (12 at most, never
  obsidian) and a sticky one pulls back; dust up and down steps, up glass
  and not down it, across a chunk border; a torch clock burns out; TNT lit
  by flint and steel goes off after 4 s and sets off the TNT beside it,
  powered TNT, a guest's lit TNT and fire prime it; a note block plays once
  a pulse; an edit far from redstone costs nothing; the recipes. In the
  game (a Survival world): the same through real right clicks (a lever,
  redstone dust placed, a button, flint and steel on TNT with its crater
  and chain, a piston placed facing the player), every redstone shape
  meshed the same in a worker and on the main thread, icons and item
  models, and a save and a reload keeping the circuits working.
  `--nobrowser` runs only the Node part.
- `r11-world-tests.mjs` (Round 11; the Node part takes seconds, the game
  part a few minutes): a Survival world's structures over three seeds:
  dungeons at a plausible rate with their spawner, mossy floor and chests
  (known as dungeon chests), mineshafts (planks, fences, cobwebs, chests),
  desert temples only in deserts with the blue terracotta, the shaft, the
  hidden room's four chests and its TNT when the redstone blocks exist;
  the chests' loot (vanilla's tables, vanilla's odds for what exists); a
  Missions world's chunks hash as before and have no structures. The
  weather: the cycle stays within vanilla's times and fades over 5 s, it is
  saved, never in a Missions world; rain in the open but not under a roof
  nor in a desert, snow settling in a snowy biome, water freezing, a
  cauldron filling; lightning finding a player within 3 blocks, hurting (5)
  and setting them alight, lighting fire (Normal, not Easy), striking now and
  then on its own; rain putting a burning player and fires out. A monster
  spawner spawning in the dark near a player, at most 6 near, not far away,
  not in the light, not on Peaceful. In the game: a storm darkens the sky,
  drops fall on Medium (none on Low), a bolt flashes, the weather is saved;
  `--online` adds a host and a guest: the guest gets the weather on joining
  and when it turns, can't change it, and a bolt by the guest hurts it.
  `--node` runs the Node part only.
- `r11-magic-tests.mjs` (Round 11): enchanting, anvils, brewing and
  potions in a new Survival world: the magic blocks and items (names,
  icons, the palette, recipes, the texture budget); an Efficiency V pickaxe
  mines stone faster, Silk Touch drops stone, Fortune III gives more
  diamonds on average, Sharpness hits harder (Smite more on a zombie),
  Protection and Feather Falling take damage away and Unbreaking saves
  wear; the bow's Power and Infinity, Fire Aspect setting a zombie alight,
  Looting; the anvil combining worn tools and enchantments, renaming,
  refusing conflicts and costing levels; the enchanting table counting its
  bookshelves and making an enchanted book for lapis and levels; healing
  and poison potions, a splash reaching the player, the brewing stand
  brewing Swiftness from a water bottle and sugar, a cauldron filling a
  bottle, a splash of Harming and a Bottle o' Enchanting's experience;
  enchantments through a chest, a dropped item, and a save and a reload.

All the Round 11 suites take `--only=substring`; the browser ones, like the
others, fail on any console or page error.

- `r13-air-tests.mjs` (Round 13, part air): auto aim locks a UFO kept
  round the crosshair in about 2 s (not before 1.6 s) with the seeker's
  growl then a solid tone, and the HUD canvas shows the lock building and
  made; a click then fires a missile that homes on a UFO flying across and
  hits it, with "Fox two"; with nothing in the seeker a missile flies
  straight; a fighter on its afterburner breaks Mach 1 (one boom, a vapor
  cone), one under Mach 1 makes none, slowing through it booms softly; a
  missile's blast is the bigger one (6.5) with its shock rings; kills queue
  the callouts ("UFO destroyed", "Ball UFO down", "Splash one"; speech is
  stubbed). `SHOTS=dir` saves screenshots, `SIZE=1600x900` a bigger page.
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
  skeleton arrows at point blank, Missions' locked rule settings, no jet
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
  ship weapons, the Missions opening played through (skeleton, bow, landing,
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
  voxel light engine against a brute-force reference, the 16-bit block ids
  (wide edits, old saves, unreadable data failing loudly, light, meshing and
  collision of a 16-bit block), terrain, caves, trees
  and water, mining rules, inventory, collision, explosion falloff,
  distant-terrain meshes, airports and cities, the mission chain (the
  classic order, and 200 random campaigns checked against every ordering
  rule) and the new missions' rules (real stats, an act, a reward and the
  right acts in 300 campaigns; twists and variant goals; the clock set back),
  and loot).
- `ufo-tests.mjs`: the Missions features in the real game in headless
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
- Block ids are 16-bit (chunks are `Uint16Array`s; 0-255 the original
  blocks, 256-1023 items, 1024-4095 new blocks; `js/content/base.js`). New
  blocks, items, textures, icons, mesh shapes, recipes and behaviours (block
  and item use, random ticks, drops) live in content modules, one per area,
  in `js/content/`; `js/content/index.js` documents what a module may export
  and checks each keeps to its id range. The tables are built once at load,
  the same on the main thread and in the workers.
- A world's type (Missions or Survival) is fixed for its life
  (`js/worldtype.js`); the systems that differ ask `isVanilla()`: crafting
  and smelting (`js/crafting.js`, `js/furnace.js`), hunger, effects and the
  body (`js/survival.js`, `js/player.js`), experience (`js/xp.js`), beds
  (`js/sleep.js`), the vanilla mobs and trades (`js/mobs.js`,
  `js/trading.js`), the terrain, its structures (`js/structures.js`) and the
  weather (`js/weather.js`, drawn by `js/weather-fx.js`). Redstone is a
  block-update-driven simulation the host runs (`js/redstone-sim.js`);
  enchanting is `js/enchant.js`, brewing and thrown potions `js/brewing.js`,
  sign text `js/signs.js`.
- All sounds are synthesized with the Web Audio API (`js/audio.js`).
- Multiplayer is peer-to-peer WebRTC through PeerJS (loaded only when
  used), host-authoritative, in `js/net/`: the session and rooms
  (`session.js`), snapshot interpolation (`interp.js`), players, vehicles
  (owners, puppets, claims), block edits, effects, the host's entities
  with hit claims, rules, the co-op missions and the Dogfight, one module
  each. Design and decisions: `PROGRESS.md`, Round 7.
- See `PROGRESS.md` for the full development log, design decisions, known
  issues and a self-assessment.
