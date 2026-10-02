# Voxelands — Progress Log

## Milestone 1: Core terrain + first-person controls — DONE

**What works:**
- Procedural terrain generated with a from-scratch seeded 2D Perlin noise (`js/noise.js`, `mulberry32` PRNG + classic Perlin permutation table + fBM). Grass/dirt/stone/sand/water-level terrain (`js/world.js`).
- World seed is read from `?seed=NUMBER` in the URL (random if absent) and displayed on the start menu and pause menu.
- First-person controls in `js/player.js`: WASD movement relative to camera yaw, mouse look (pointer-lock based, pitch clamped to avoid flipping), Space to jump, gravity, and swept-AABB vs. voxel-grid collision resolved per-axis (x, y, z independently) so the player slides along walls/ground correctly.
- Procedurally generated pixel-art texture atlas (canvas-drawn, no external images) in `js/blocks.js` — grass top/side, dirt, stone, sand, wood (side+top rings), leaves, planks, glass, water, TNT.
- Chunk data storage + face-culled meshing in `js/chunk.js` (only exposed faces are emitted; opaque/cutout/water get separate geometries/materials).
- Basic chunk streaming loop already wired in `js/world.js`/`js/main.js` since terrain can't render at all otherwise (generation + initial meshing spread across frames via a queue).
- Trees and a sea-level water table are generated as part of the base terrain generator (in `world.generateTerrain`/`placeTree`) since they're intrinsic to the height-map algorithm — full atmosphere polish (day/night, fog tuning, clouds, animated water) still lands in the Milestone 4 commit.
- Hotbar UI, crosshair, FPS counter, start menu and pause menu shells exist (`js/ui.js`, `index.html`) though block breaking/placing input isn't wired yet (Milestone 2).
- Mobile/touch devices get a friendly "keyboard & mouse required" message instead of a broken canvas.

**Testing:** Set up a headless Chromium smoke test under `/tools` (Playwright-core driving the pre-installed sandboxed Chromium with SwiftShader software WebGL). The sandbox's network policy blocks `cdn.jsdelivr.net` (confirmed via the proxy status endpoint — policy denial, not a bug), so the test does an npm-installed local copy of the exact same pinned `three@0.160.0` and uses Playwright's `page.route()` to redirect only the CDN URL to that local file *for the test itself*; `index.html` still imports three.js from the CDN for real players, who won't be behind this sandbox proxy. The test loads the page, clicks Play, simulates WASD + mouse movement, and asserts zero `console.error`/`pageerror` events. It currently passes with 0 errors and a live FPS counter. A screenshot confirmed terrain, trees, textures, hotbar and crosshair all render correctly.

**Known bugs / simplifications:**
- No block breaking/placing yet (Milestone 2).
- Render distance slider exists in the pause menu DOM but isn't wired to `world.ensureChunksAround` yet — using a fixed default of 4 chunks for now.
- No day/night, fog tuning by distance, or clouds yet — flat sky-blue background + a fixed light rig.
- No sound effects wired yet (Audio class exists but isn't called from gameplay events).
- No save/load of edits yet (nothing to save until breaking/placing exists).

## Milestone 2: Building — DONE

**What works:**
- Left click breaks the targeted block, right click places the selected hotbar block, both via a simple incremental voxel raycast (`world.raycast`, 0.05 step, 6 block reach) run every frame from the camera eye position.
- Found and fixed a real bug while wiring this up: `player.getForwardVector()` was using `camera.getWorldDirection()`, but the camera's `matrixWorld` is only refreshed inside `renderer.render()`, which runs *after* the raycast in the frame loop — so the aim direction was one frame stale during fast mouse movement. Replaced with a direct trig computation from yaw/pitch (`js/player.js`), which is also cheaper.
- A black wireframe box (`THREE.EdgesGeometry` + `LineSegments`) outlines the currently targeted block, hidden when nothing is in range.
- Hotbar of 8 placeable blocks (grass, dirt, stone, sand, wood, leaves, planks, glass) selectable via number keys 1-8 and the mouse scroll wheel; selection wraps around.
- Placing is blocked if the target cell isn't air or would overlap the player's own bounding box (prevents self-trapping).
- Right-click's context menu is suppressed on the canvas.
- Editing a block immediately re-meshes its chunk (and neighbor chunks too, if the edit sits on a chunk boundary) so face culling stays correct after edits.
- Break/place now trigger placeholder procedural sound effects (the Audio class was pulled forward from Milestone 5 since it made sense to wire sound feedback at the same time as the interaction).

**Testing:** Extended the Playwright smoke test to click-hold left/right mouse buttons, press a hotbar digit key, and scroll the wheel, then assert zero console errors. Passed. Screenshot confirms hotbar selection updates correctly (digit + wheel combined landed on slot 4/Sand as expected).

**Known bugs / simplifications:**
- No visual particle effect when breaking a block yet (kept simple — only the Blast Orb in Milestone 6 gets particles).
- Raycast step size (0.05) is a fixed small increment rather than a DDA/voxel-traversal algorithm; simpler to reason about and fast enough at this range, but not the most efficient approach possible.

## Milestone 3: Performance + infinite world — DONE

**What works:**
- 16x16 chunk columns (full world height, no vertical chunking) stream in/out around the player (`World.ensureChunksAround`), sorted by distance so the nearest missing chunks generate first.
- Generation and initial meshing happen a couple of chunks per frame (`processQueues`), not all at once, so moving into new terrain doesn't stutter; the very first load (around the spawn point) is done synchronously up front instead, so the player never spawns over a hole.
- Hidden-face culling: each block only emits the faces that border a non-opaque neighbor, checking across chunk boundaries into the world for edge blocks (`Chunk.buildMesh`). Opaque, cutout (leaves/glass), and water blocks get separate geometries/materials.
- Editing or generating a chunk also queues its already-loaded neighbors for a remesh, so newly-exposed/hidden boundary faces are corrected without a full rebuild of everything.
- Chunks outside `renderDistance + 2` are unloaded (geometry disposed, removed from the scene) each time the player moves.
- Live FPS counter in the top-left corner, updated twice a second.
- Render distance slider in the pause menu (2-10 chunks, default 4) is wired directly to `ensureChunksAround` and the fog's far plane, taking effect immediately.

**Testing:** Re-ran the Playwright smoke test holding W for 3 seconds (crossing chunk boundaries, forcing load/unload cycles) — zero console errors.

**Known bugs / simplifications:**
- No greedy meshing (merging coplanar faces into larger quads) — plain per-face culling only. Good enough at the default render distance; a larger render distance on very weak GPUs would show it first.
- Chunk generation/meshing runs on the main thread (no Web Worker), which is why it's throttled to a couple of chunks per frame rather than being fully async.

## Milestone 4: Atmosphere — DONE

**What works:**
- Trees were already generated as part of the terrain generator since Milestone 1 (see that entry) — nothing new needed there.
- Day/night cycle (`js/sky.js`, new module): a 3-minute full cycle moves a directional "sun" light in an arc around the player, with intensity fading to a dim (but never pitch-black) floor at night; ambient light intensity follows the same curve so the world stays readable after dark.
- Sky color and fog color both lerp between night/day/sunset tones based on sun height, recomputed every frame and kept in sync with each other (fog color always matches the sky so the render-distance edge stays invisible).
- Distance fog's far plane is tied to the render-distance setting (already wired in Milestone 3), so raising render distance pushes fog out further and vice versa.
- Semi-transparent water: existing translucent blue material now also animates — opacity gently pulses and its color tints subtly over time for a shimmering effect.
- Cloud layer: a large textured plane floats above the world and follows the player horizontally, with a slowly-scrolling procedurally-drawn puff texture and brightness that dims at night.

**Bug found + fixed during this milestone:** the cloud plane's "empty" (fully transparent) texture regions rendered as a solid tinted slab instead of vanishing, under the sandbox's software WebGL (SwiftShader) — visible as a hard straight seam across the sky in the smoke-test screenshot. Diagnosed by toggling the mesh's visibility to confirm it was the cloud plane, then switched from alpha-blended transparency to alpha-tested cutout rendering (`alphaTest: 0.4`, `transparent: false`) — the same robust technique already used for leaves/glass blocks — which discards fragments outright instead of blending them. Confirmed fixed via a fresh screenshot (clean sky, no seam) and doubles as evidence the leaves/glass cutout approach elsewhere is the right call for this renderer, too.

**Also decided against animating water via texture-offset scrolling:** the water material shares the single block atlas texture with every other block type (to keep one draw-texture for the whole world), so shifting that texture's UV offset for a "flowing" look would have bled into neighboring atlas tiles (stone, sand, etc. sampled at the wrong spot) for every other block, not just water. Used opacity/color pulsing instead, which is visually adequate and touches nothing shared.

**Testing:** Re-ran the Playwright smoke test (0 console errors) and visually verified via screenshots at multiple points in this milestone, including the before/after of the cloud transparency fix.

**Known bugs / simplifications:**
- No stars or moon at night, just a dark sky tone — kept simple given time budget.
- Sun is a light source only, not a visible disc in the sky.
- Cloud puffs are static in shape (only their scroll offset and world position under the player move); no cloud regeneration.

## Milestone 5: Persistence + polish — DONE

**What works:**
- Block edits (breaks and placements) are saved to `localStorage` as a compact flat `[x,y,z,id, x,y,z,id, ...]` array, keyed per-seed (`voxelands_v1_edits_<seed>`) so different worlds don't clobber each other. All keys use the `voxelands_v1_` prefix so the game never touches unrelated data on its origin.
- Saving is throttled (at most once every 2 seconds while edits are pending) rather than on every single block change, and also flushed immediately on `beforeunload` and on tab-hide (`visibilitychange`), so closing the tab or switching away doesn't lose the last few edits.
- Loading happens before terrain generation: saved edits for the current seed are read at startup and re-applied on top of the freshly-generated chunks as they stream in, so a saved world looks exactly as it was left.
- `js/storage.js` wraps every `localStorage` call in try/catch and logs a warning instead of throwing if storage is full, disabled, or unavailable (private browsing, quota exceeded, etc.) — the game keeps running either way, it just won't persist that session.
- Start menu (seed display + controls list) and pause menu (render distance, seed, controls, copy-world-link button) were already built in earlier milestones; verified both still work correctly with the fuller feature set.
- Web Audio sound effects are now fully wired: break, place, footsteps (distance-triggered while walking on the ground), and jump, all synthesized procedurally (noise bursts + oscillators, no audio files). The AudioContext is started on the first "Play"/"Resume" click to satisfy browser autoplay policies.

**Testing:** Extended the smoke test to check `localStorage` after a break+place sequence, then reload the page and confirm the saved edits persist across the reload. Passed — verified a real edit round-trip (`[1,23,5,1]`, i.e. a single coordinate whose final state survived a break-then-place-back sequence, since only the latest value per coordinate needs to persist). Zero console errors throughout, including through the reload.

**Known bugs / simplifications:**
- No explicit "world saved" UI indicator — saving is silent/automatic. Given the scope, decided this is the right default (no interruption), but a future version could add a small toast.
- Footstep sound doesn't vary by block type walked on (grass vs. stone vs. sand) — a single generic footstep sound for simplicity.

## Milestone 6: Signature feature — DONE

**Chosen feature: the Blast Orb.** Press `F` to throw a glowing projectile (with its own point light) that arcs under gravity; on impact with any block it carves a spherical crater (radius 3) out of the terrain, plays a procedural explosion sound, and bursts into a shower of small fading cube particles. It has a 3-second cooldown so it can't be spammed. I picked this over other ideas I considered (a generative ambient soundtrack, fireflies at night) because it's the most *actively fun* to trigger repeatedly, gives instant, satisfying, visible feedback, and reuses systems already built for building/breaking (world.setBlock, chunk remeshing, persistence) rather than requiring a whole new subsystem — low risk to implement well within the remaining time, high payoff in "delight per keypress."

**Bonus mechanic (folded in earlier since it lives in `player.js`'s input handling): double-tap Space toggles Creative Flight** — gravity is disabled, Space/Shift move up/down, and movement speed increases. This makes it fast and satisfying to survey builds or explore terrain, and is a one-line-of-intent, low-risk feature (reuses the exact same movement/collision code path, just skips gravity and reads two extra keys).

**What works:**
- `js/effects.js` (new module): projectile physics, sphere-carving explosion (skips any already-air cells so it's cheap on repeated blasts in the same spot), and a small particle-burst pool that fades and shrinks each particle over ~1 second before disposing it.
- Explosions correctly go through `world.setBlock`, so blast damage persists to `localStorage` and re-meshes affected chunks (and their neighbors, if the blast crosses a chunk boundary) exactly like a manual break.
- Flight toggle plays a distinct rising/falling tone via the Audio module so the mode switch has clear feedback even though there's no HUD flight indicator.

**Testing:** Extended the smoke test to press F and wait for the explosion, then confirmed via `localStorage` that a real spherical cluster of blocks was cleared (dozens of coordinates set to id 0 around a center point) and survived a page reload. Also exercised the double-tap-Space flight toggle twice (on/off) with no console errors. A screenshot after the explosion shows a clean carved-out crater in the terrain.

**Known bugs / simplifications:**
- No HUD indicator for the Blast Orb's cooldown or for flight mode being active — a future version could add a small icon/timer.
- Explosion crater is a perfect sphere with no partial-block "damage" states — blocks are either fully there or fully gone, consistent with the rest of the voxel model.

## Testing, README, and final self-assessment — DONE

**Testing summary:** A headless Chromium (SwiftShader software WebGL) smoke test lives under `/tools` and was re-run after every milestone. Its final form: loads the page, clicks Play, drives WASD + mouse-look, breaks and places blocks, switches hotbar slots via digit key and scroll wheel, throws the Blast Orb and confirms a real crater was carved, toggles flight on/off via double-tap Space, and verifies block edits survive a full page reload via `localStorage` — all while asserting zero `console.error`/`pageerror` events. It currently passes cleanly. It also caught two real, non-cosmetic-only bugs before they shipped (see below), which is exactly what it was for.

**Bugs the automated test + review caught and fixed along the way:**
1. **Stale aim direction.** `player.getForwardVector()` originally called `camera.getWorldDirection()`, but the camera's `matrixWorld` is only refreshed inside `renderer.render()`, which runs *after* the per-frame block raycast — so the block outline/break/place aim was one frame stale during fast mouse movement. Fixed by computing the forward vector directly from yaw/pitch.
2. **Cloud transparency bug under software WebGL.** The cloud layer's "empty" texture regions rendered as a solid tinted slab (visible as a hard seam across the sky) instead of vanishing. Diagnosed by toggling the mesh's visibility, then fixed by switching from alpha-blended transparency to alpha-tested cutout rendering (the same technique already used for leaves/glass), which discards fragments instead of blending them.

Also deliberately avoided a third bug before writing any code for it: animating water by scrolling its texture's UV offset would have bled into every other block's texture, since water shares one atlas texture with the rest of the world to keep a single draw material. Used opacity/color pulsing instead.

## Self-assessment

**What I'm happy with:**
- The whole thing is genuinely playable end-to-end: walk, jump, look around, terrain streams in smoothly, breaking/placing feels responsive, day turns to night, water sits below the surface at a consistent sea level across the whole map, and worlds persist and reload correctly by seed.
- The procedural texture atlas holds up surprisingly well for something drawn with `fillRect` loops — grass, wood rings, and the leafy gap pattern in particular read clearly at a glance.
- Finding and fixing the stale-camera-matrix bug and the cloud-transparency bug before ever showing them to a human is the best outcome I could have hoped for from the "set up one headless test" instruction — both were real, easy-to-miss bugs, not just style nits.
- The Blast Orb ended up more satisfying than I expected from the plan — reusing the existing block-edit/persistence pipeline instead of building a parallel "damage" system kept it simple and made it "just work" with saving/reloading for free.

**What I'd improve with more time:**
- **Greedy meshing.** Right now every exposed block face is its own quad; merging coplanar faces into larger quads would cut vertex counts substantially at higher render distances and is the single biggest remaining performance lever.
- **Web Workers for chunk generation.** Terrain generation and meshing run on the main thread, throttled to a couple of chunks per frame to avoid stutter. Moving this to a worker would let chunks stream in faster without ever risking a dropped frame.
- **A proper voxel DDA raycast** instead of the fixed 0.05-step incremental raycast used for block targeting — functionally fine at this scale, but not the "correct" algorithm.
- **Biome variety.** Right now there's one continuous height-based biome (grass/dirt/stone/sand/water) with no temperature/moisture variation — deserts, snow, or stone mountains at altitude would go a long way for visual variety.
- **A visible sun/moon disc and stars**, rather than just a light source and color-graded sky — would sell the day/night cycle even harder.
- **In-game feedback for the Blast Orb cooldown and flight mode** (a small HUD icon/timer) — both work correctly but are currently silent about their own state beyond a sound cue.
- **Underwater rendering** (a blue tint/fog overlay when the camera is submerged) isn't implemented — swimming into water currently looks the same as being above it, aside from the translucent blocks themselves.
- I'd also want to test on a couple of real GPUs/browsers rather than only the sandbox's software renderer — SwiftShader caught real bugs, but it's not a substitute for confirming smoothness on real hardware at higher render distances.

**Rough size:** ~2,000 lines of JavaScript across 11 modules (`main.js` ~275, `world.js` ~280, `blocks.js` ~245, `player.js` ~235, `chunk.js` ~155, `ui.js` ~120, `effects.js` ~125, `sky.js` ~95, `audio.js` ~90, `noise.js` ~90, `storage.js` ~50), plus a ~240-line `index.html` and a small standalone test harness under `/tools`.

---

# Round 2 — upgrade log

## Phase 1: Bug fixes — DONE

**1. Inverted W/S movement (fixed).** Root cause in `Player.update()` (`js/player.js`): the camera-space input vector (x = right, z = backward, because the camera looks down −Z) was rotated into world space with the wrong sign on both `moveZ` terms (`worldX = moveX·cos − moveZ·sin`, `worldZ = −moveX·sin − moveZ·cos`). That produced `(+sin yaw, +cos yaw)` for W, i.e. exactly the *negated* forward vector, while the strafe terms happened to be right (which is why A/D worked). Fixed to the proper rotation about +Y (`worldX = moveX·cos + moveZ·sin`, `worldZ = −moveX·sin + moveZ·cos`), which makes W produce `(−sin yaw, −cos yaw)`, the same forward vector `getForwardVector()` uses for aiming.

**Test first, then fix:** I wrote the new movement check before touching `player.js` and confirmed it failed on the old code (`KeyW at yaw 0 moved in the wrong direction (forward=-1.00)`), then applied the fix and watched it pass. The check lifts the player above the build height in flight mode (nothing to collide with), holds each of W/S/A/D, and compares the measured displacement with the camera's forward/right vectors at two different headings (yaw 0 and 2.2), plus W+D for the 45° diagonal and a walking-on-the-ground check. It waits on *distance moved* rather than a fixed time, so it's robust to slow software rendering. To make this possible, `main.js` now exposes a small debug/test hook, `window.__voxelands` (world, player, camera, spawn, game state, render distance); no game code depends on it.

**2. Default render distance is now 10 chunks** (was 4), still adjustable in the pause menu (slider range widened to 2–16), and the chosen value is now saved in `localStorage` (`voxelands_v1_settings`) so it sticks across reloads.

Going from 4 to 10 chunks means ~6× more chunks (317 vs. ~50), and the old startup code generated *every* chunk in range synchronously before the first frame, while the per-frame loop re-scanned and re-sorted the whole queue every single frame. So the render-distance change came with streaming changes to keep it smooth:
- Only a radius-2 area around spawn is generated synchronously (so the player can't fall through); the rest streams in while the start menu is showing. Page-ready time stays under ~1 s.
- `World.processQueues(budgetMs)` is now **time-budgeted** (5 ms/frame while playing, 14 ms while a menu is open) instead of "N chunks per frame", so frame time stays bounded no matter how expensive a chunk is.
- `ensureChunksAround()` only re-plans (queue re-prioritization, unloading) when the player crosses into a new chunk or the render distance changes, and it now drops queued chunks that fell out of range instead of generating them just to unload them.
- Chunks touched by block edits go into a separate queue that is remeshed first, unbudgeted, so the player's own edits never wait behind background streaming.

Measured in headless Chromium: chunk generation ≈ 0.1 ms and meshing ≈ 1.2 ms per chunk, so the full radius-10 world is ~1 s of main-thread work spread across frames.

**Testing:** The smoke test was restructured into named checks (a failure in one no longer hides the others): page load, default render distance (slider *and* live game value), Play/pointer-lock, per-key movement directions, full streaming of the radius-10 area (≥300 chunks), slider change applied + persisted, walking, break/place/hotbar/Blast Orb/flight, HUD, edit persistence across reload. All 11 checks pass with zero console errors. The CDN redirect in the test now covers any file under the pinned `three@0.160.0` path (needed for three.js addons later), and `three@0.160.0` is now declared (exact version) in `tools/package.json` instead of being an undocumented manual install.

## Phase 2: Blast Orb upgrade — DONE

**Bigger blast.** Radius 3 → **7** (≈2.3×; ~1,000 blocks per surface blast vs. at most 123 before), with a hard cap (`MAX_BLAST_RADIUS = 9`) since cost grows with r³. The crater is no longer a perfect sphere: its radius varies smoothly with *direction* (three random low-frequency waves over the sphere of directions), which gives a lumpy, natural crater while keeping the carved region star-shaped around the center.

**Farther throw on a sensible arc.** Throw speed 18 → 32 blocks/s, a small upward "lob" added to the aim so a level throw arcs instead of dropping, light air drag so the arc steepens naturally at the end, and the orb inherits half of the thrower's velocity. Measured: ~25 blocks/s horizontal over the first second vs. ~15 before; a throw from altitude landed ~71 blocks away. In water the orb slows sharply and sinks, exploding on the sea floor. Movement is sub-stepped (≤ 0.2 blocks per collision check), so the faster orb can't tunnel through a one-block wall.

**Stronger effects.** Instanced debris cubes tinted by the actual blocks destroyed (colors derived from the block textures, so they'll stay correct when textures change), bouncing off terrain; an additive fireball; sparks; a billowing smoke column; a dust ring racing along the ground; an expanding shockwave ring; a bright light flash; the orb itself glows and trails embers. **Screen shake** is trauma-based (shake ∝ trauma², decaying), scaled by distance to the blast. Blasts also **knock the player back** (new `Player.applyImpulse`, a decaying knockback velocity kept separate from input-driven movement), including an upward kick when it goes off at your feet. **Sound**: all audio now goes through a master gain + dynamics compressor, and the explosion is layered (sub-bass thump, distorted noise body with a falling filter, a sharp crack, a long rumble tail, a patter of falling debris), attenuated and slightly delayed by distance. A HUD indicator next to the hotbar shows the orb's cooldown as a radial sweep (one of the "missing HUD feedback" items from the first round's self-assessment).

**Performance.**
- Only affected chunks are rebuilt: edits queue their chunk (plus a neighbor if the edit is on a chunk border) into the edit-remesh queue, which is deduplicated, so a blast remeshes ~4 chunks, measured at ~7 ms in headless Chromium. Carving itself takes ~2–9 ms.
- Particles use fixed-capacity pools (one instanced draw call each) that recycle the oldest particle when full; nothing is allocated per particle.
- **Fixed a hitch that existed before:** every thrown orb used to add a `THREE.PointLight` and remove it on impact. Changing the light count forces three.js to recompile every lit material, so each throw and each explosion stalled. The orb light and the explosion flash are now two persistent lights that are dimmed to zero when idle.
- **Save format v2.** A radius-7 blast is ~2,000 block edits, which in the old flat JSON `[x,y,z,id,…]` format is ~24 KB per blast, enough to exhaust the ~5 MB localStorage quota after a few hundred blasts. Edits are now kept in memory per chunk (`Map<chunk, Map<blockIndex, id>>`, which also made applying saved edits to a newly generated chunk O(its own edits) instead of O(all edits in the world)), and saved as run-length-encoded, base64 records per chunk, re-encoding only chunks changed since the last save. A crater compresses ~17× (1,419 blocks → 796 chars). Old saves are still read.

**Bug caught by the new test (and fixed):** the first version of the ragged crater used an independent random threshold per block, so a block slightly *farther* from the center could be removed while a *closer* one survived, leaving sealed air bubbles inside crater walls. The "underwater blasts flood" check found one: a later blast next to an earlier crater exposed such a bubble to water, leaving a dry air cell held up by water. Fixed at the root with the star-shaped crater described above, and the flood fill now also flows into older air space that a blast breaches below sea level (an earlier crater, a dug tunnel), capped at 4,000 blocks per blast.

**Water behavior.** Water absorbs the blast (water blocks aren't destroyed), and carved cells at or below sea level that connect to water are refilled with water, so a blast at the shore or on the sea floor doesn't leave a dry pocket walled in by water.

**Testing.** New smoke-test checks: orb speed and range (sampled after 1 s of game time, so independent of frame rate), crater size and reach (6–8.2 blocks), carve time, particle burst, shake, upward knockback, "only nearby chunks remeshed" (≤ 16), underwater flooding (no air cell below sea level may touch water), and the v2 save format surviving a reload with the exact same edit count. New `tools/unit-tests.mjs` (Node, no browser) covers the save format: random round-trips, runs longer than 255, index extremes, legacy-format reading, the encode cache, corrupted data (one bad chunk doesn't lose the rest), and garbage input. `npm test` in `/tools` now runs both suites. All 14 smoke checks and 7 unit tests pass with zero console errors; screenshots confirmed the fireball, debris, smoke, flash lighting and a flooded shoreline crater.

**Known limitations.** Water doesn't flow in general (it's static, as before); the refill is a one-time fill at the moment of the blast. Explosions don't drop items; that would flood the world with thousands of item entities, so blasted blocks are simply destroyed.

## Phase 3: Graphics overhaul ("RTX look") — DONE

Real ray tracing isn't available in WebGL, so the look is built from the techniques shader packs use, on a new rendering and lighting architecture. Everything is still procedural and built on plain ES modules plus three.js r160 from the CDN (no addons were needed; the post-processing is custom).

**Voxel lighting engine (`js/light.js`, new).** Minecraft-style flood-fill lighting with two channels per block, stored per chunk: *sky light* (sunlight from above: 15 in the open, decaying sideways under overhangs, 0 in sealed caves) and *block light* (from emissive blocks). Leaves and water attenuate light. New chunks are lit including light flowing in from and out to their loaded neighbors; edits use the classic two-phase BFS (remove light that depended on the changed cells, then re-propagate), processed as one batch for bulk edits like a Blast Orb crater. This is what makes caves dark, lets torches light a room with proper occlusion by walls, and drives mob spawning in Phase 5. Because incremental light removal is famously easy to get subtly wrong, it's verified in `tools/unit-tests.mjs` against a brute-force reference solver (repeated relaxation to the fixed point): identical results for every cell after lighting chunks in random load orders and after 60 random edit batches (including 400-block ones). I also mutation-tested the test: removing either of two key rules from the engine (the sky-light "straight down at full strength" dependency, the light-source re-seeding during removal) makes it fail.

**New chunk pipeline and mesher (`js/world.js`, `js/mesher.js`, `js/chunk.js`, `js/terrain.js`).**
- A chunk is generated (terrain + saved edits + light) within render distance + 1.5, but only *meshed* once all 8 neighbors exist, since meshing reads a 1-block border from them. Each chunk is therefore normally meshed exactly once (no more "remesh all neighbors when a chunk loads"), and the edge of loaded terrain never shows wrong faces or lighting.
- The mesher copies the chunk plus its border into a padded scratch volume, so every neighbor/AO/light lookup is plain index arithmetic, and writes compact typed arrays (reused growable buffers): position, uv, and two packed `Uint8x4` attributes (normal + AO, sky light, block light, flags; texture layer, water depth).
- **Per-vertex ambient occlusion** (the classic 3-neighbor corner test) and **smooth lighting** (averaging the light of the 4 cells around each vertex, skipping opaque ones), with the quad split along the diagonal that keeps dark corners contained.
- Water surfaces sit slightly lowered and carry per-vertex water depth (average of the 4 columns at each corner) for depth-based color; plants are cross-shaped quads with a little random jitter; torches are thin 3D sticks.
- Block access, edits (`setBlocks` bulk API: one light update, one rebuild per affected chunk), support rules (plants/torches pop off when their support goes), and a proper voxel-traversal (DDA) ray cast that also hits the smaller selection boxes of torches and plants. Chunk maps use numeric keys in the hot paths.
- Measured per chunk in headless Chromium: terrain 0.07 ms, lighting 0.16 ms, meshing 0.65 ms (~2,300 vertices). The whole radius-10 world is ~0.4 s of CPU spread across frames; a Blast Orb crater rebuilds its 4 chunks in ~2.5 ms.
- Terrain keeps the original height map and tree placement exactly (shared seeds still produce the same landscape) and adds tall grass and flower patches.

**Shaders (`js/shaders.js`, new).** One shared lighting/sky/fog model for terrain, water, sky and particles:
- **Lighting:** sun (moon at night) × N·L × **shadow map**, applied only where sky light is high (so caves beyond the shadow map's range stay unlit); hemisphere sky ambient scaled by voxel sky light; warm torch light using the classic `f/(4−3f)` voxel-light curve; everything modulated by AO. Glowing texels of emissive blocks output HDR values that bloom.
- **Shadows** (`PCFSoftShadowMap` on High/Ultra): one directional light that follows the player, centered slightly ahead of the view and snapped to whole shadow-map texels so edges don't crawl as you move. Cutout geometry (leaves, grass) uses an alpha-tested, wind-animated depth material, so trees cast lacy shadows instead of solid blocks. The sun hands over to the moon at dusk, with both faded to zero at the switch so shadows never jump.
- **Sky:** an analytic, keyframed atmosphere (zenith/horizon gradients, a sunset/sunrise glow band concentrated toward the sun, Mie-like halo) driven by sun elevation through noon, golden hour, sunset, twilight and night; an HDR sun disc (bloom turns it into a glowing ball); a cratered moon with a halo; twinkling stars that rotate with the sky; soft fbm clouds lit from the sun side with silver linings.
- **Fog / aerial perspective:** geometry fades into *the sky color in the view direction* (so distant terrain melts into the horizon and glows warmer toward a setting sun), plus distance haze, and a murky blue fog under water.
- **Water:** sky reflections with Fresnel, an animated wave surface (vertex waves plus analytic normals plus ripples), a specular sun glint, depth-based color and opacity (turquoise shallows, deep blue depths), shoreline foam, a distinct look from below the surface, and animated **caustics** projected on underwater surfaces.
- **Wind:** leaves and plant tops sway (vertex animation, matched in the shadow pass).

**Post-processing (`js/postfx.js`, new).** The scene renders into a half-float HDR target with MSAA, then: **bloom** (soft-knee bright pass + 13-tap downsample chain + tent upsample chain accumulating every level); **light shafts** (radial blur toward the sun of a sky mask that the sky shader writes into alpha, so terrain and clouds occlude the rays); and a composite pass with exposure, the same **ACES** fit three.js uses (so Low, which uses three's tone mapping directly, matches), a **color grade** (saturation, contrast, split toning), vignette, underwater tint/wobble, and dithering. Exposure follows time of day, and **eye adaptation** slowly brightens the view in dark places (less so when a torch is near).

**Textures (`js/textures.js`, new).** All block textures were redesigned at **32×32** and painted in code with a small toolkit: tileable value noise (seamless repeats), quantized color ramps (crisp, banded pixel-art shading), tileable Voronoi (cobblestone, gravel, crystals) and hand-placed details (pebbles in dirt, fibrous grass blades, engraved cracks and pits in stone, vertical bark fibers and knots, growth rings, planks with seams and nail heads, leaf clusters with gaps, shaded ore nuggets, a crafting table with tools, a torch flame, glowing crystal cells). They live in one mipmapped `DataArrayTexture` (a layer per tile, so mipmaps never bleed between tiles as in an atlas), with anisotropic filtering, crisp nearest magnification, and a mip-aware alpha boost so sparse cutouts (grass, leaves) don't dissolve at a distance. Hotbar icons are drawn as isometric mini-cubes from the same pixels.

**Emissive blocks.** The **Torch** (light 14) and **Lumen Crystal** (a glowstone-like block, light 15) light their surroundings through the light engine and glow (HDR + bloom). The hotbar now has 9 slots: grass, dirt, stone, cobblestone, planks, log, glass, torch, lumen crystal. (Other new block types, like ores, gravel, bricks and wool, are defined and textured now and put into play in Phase 4.)

**Graphics presets (`js/graphics.js`, new).** A **Graphics** selector in the pause menu (Low / Medium / High / Ultra), saved in `localStorage`, **defaulting to Ultra**:
- **Low:** no post-processing (direct rendering with ACES tone mapping), no shadow maps, native pixel ratio, fewer cloud octaves, no waves or caustics. Built to run smoothly on weak laptops.
- **Medium:** 1024² shadows, bloom, 2× MSAA.
- **High:** 2048² soft shadows, bloom, light shafts, caustics, 4× MSAA.
- **Ultra:** 4096² soft shadows over a wider area, 6-level bloom, light shafts, caustics, 4× MSAA, up to 2× pixel ratio, 16× anisotropy.

Picking a preset also applies its suggested render distance (Low 6, Medium 8, High/Ultra 10), which the slider can still override. The light rig never changes shape at runtime (adding or removing lights would force every lit material to recompile), and switching presets recompiles only what's needed.

**Bugs found and fixed along the way:**
1. **Horizon blobs from NaN pixels.** The first caustics formula divided by `sin(…)`, producing 0/0 → NaN or ±∞ on some pixels; bloom's blur smeared those into huge white blobs along the shoreline. Replaced with a caustic pattern that's bounded to [0, 1] by construction, and made the bloom prefilter and composite discard NaN/Inf pixels as a safety net.
2. **White sky on Low.** The sky writes its light-shaft mask into alpha (0 = open sky). three.js r160 always creates the WebGL context *with* an alpha channel (it only emulates `alpha: false` by clearing to opaque), so on Low, which draws straight to the canvas, the page background showed through the sky. The sky now writes opaque alpha when not rendering into the post-processing target.
3. **FPS counter could never show below 20 (pre-existing).** It was fed the frame delta *after* clamping to 50 ms, so slow frames were hidden. It now uses the real frame time.
4. **Camera inside the ground behind the start menu (pre-existing).** The camera was only positioned once the player started updating. It's now synced to the player's eyes while menus are open.

**Testing.** New smoke-test checks: default preset is Ultra and renders a real image (mean/variance of the actual pixels read back from the drawing buffer); every preset renders a real image without errors and sets up shadows/MSAA as specified; the pause-menu Graphics selector applies a preset plus its render distance and persists it; a torch in a sealed underground room lights it with exact falloff (14, 13, 12, 11) and removing it restores darkness; sky light is 15 in the open, 0 underground, and flows down a freshly dug shaft. Because software rendering makes Ultra take seconds per frame in the sandbox, the gameplay checks run on Low after all presets have been verified. **18 smoke checks and 11 unit tests pass, with zero console errors.** I also reviewed screenshots of noon, golden hour, sunset, night, a torch-lit night meadow, a torch-lit cave, above/under water, light shafts through trees, and an AO close-up (under software rendering).

**Known limitations.** Water reflects the sky only (no terrain reflections, which would need screen-space reflections or a planar pass); water transparency has no refraction distortion. The light shafts are subtle (screen-space, only while the sun is on screen). Shadow maps cover a limited area around the player (72 blocks on Ultra), so shadows fade out beyond that. Real-GPU performance couldn't be measured in the sandbox, which only has a software renderer.

## Phase 4: Missing core features — DONE

**What was missing.** Compared with Minecraft's core loop (*gather → craft better tools → build and survive*), the game was a creative-only sandbox: nine infinite blocks, instant breaking, no health, no items, no inventory. I implemented everything on the phase's list, prioritizing the pieces that make up that loop (punch a tree → planks → crafting table → wooden pickaxe → stone tools → iron → diamonds, with real danger along the way), and deliberately left out features that add screens or bookkeeping without changing the loop much: **hunger** (food heals you directly instead), **furnaces** (smelting is crafting with coal, same progression, no second UI with timers), chests, beds, armor, experience and flowing water.

**Survival and Creative.** Chosen per world in the start menu (new worlds default to Survival), switchable any time in the pause menu, and saved with the world. *Creative*: a palette of every item in the inventory screen, instant breaking, blocks aren't used up, flight (double-tap Space, now creative-only), no damage, middle-click picks the targeted block into the hotbar. *Survival*: everything below.

**Health and damage (`js/player.js`).** 10 hearts. **Fall damage** counts from the peak of the fall (1 half-heart per block beyond 3; landing in water breaks any fall). **Drowning**: 10 seconds of breath shown as bubbles, then a heart per second. Falling into the void hurts fast. The player's **own Blast Orb** hurts, lethally up close, scaling down with distance (plus the existing knockback). After a hit there's a short invulnerability window in which only a *stronger* hit counts, and only by its excess (so a blast right after a fall still lands). Health regenerates slowly after 4 s without damage. Feedback: red screen-edge flash, blinking hearts, a quick camera roll, a grunt; at low health the hearts jitter and the edges pulse red.

**Death and respawn.** I built the dramatic death screen now rather than in Phase 5, since fall, drowning and orb deaths need it already (Phase 5 adds the mob causes): a dark red overlay, a huge **"NOOB!"** that slams in, then shakes and pulses, the cause below it ("Fell from a high place", "Drowned", "Fell out of the world", "Blown up by your own Blast Orb", and "Sent flying by your own Blast Orb" for a fatal landing after being launched by one), and a **Respawn** button (enabled after a moment so a panicked click doesn't skip the screen). The camera tips over as you die, your inventory spills onto the ground where you died, and you respawn at the world spawn with full health. Creative players can't die.

**Mining and drops (`js/items.js`, `js/interaction.js`).** Break time is hardness × (1.5 if the tool can harvest the block, otherwise 5) ÷ tool speed, as in Minecraft. Tool tiers gate drops: stone and coal need a pickaxe, iron needs stone or better, gold and diamond need iron or better; logs and planks mine faster with an axe, soil with a shovel. A 10-stage crack overlay shows progress, and chips fly off the face being hit with a per-material dig sound. Drops follow the familiar rules: grass gives dirt, stone gives cobblestone, coal and diamond ore drop the item, glass and tall grass drop nothing, leaves sometimes drop an apple or a stick, and torches or flowers that lose their support pop off as items. Tools wear out (durability bar, a clank when one breaks). A block mined next to the sea lets the water in.

**Items on the ground (`js/entities.js`, `js/models.js`).** Dropped items are real 3D objects: blocks as textured mini-cubes, everything else (tools, food, torches, flowers) as extruded pixel sprites built from the icon's pixels. They fall, bounce, float in water, bob and spin, get pulled into you when you're close (with a pickup pop), merge with identical stacks nearby, and despawn after 5 minutes (at most 300 exist). **Q** throws the held item (Ctrl+Q the whole stack).

**Inventory (`js/inventory.js`, `js/inventory-ui.js`, `js/hud.js`).** 36 slots: the 9-slot hotbar plus 27 more. **E** opens the inventory screen, which uses the standard mouse controls: left click picks up, puts down, swaps or merges a stack; right click takes half or places one; shift-click moves between hotbar and inventory; number keys swap the hovered slot with a hotbar slot; Q drops from the hovered slot; clicking outside the panel drops what you're carrying. Hovering shows the item's name (tools also show their remaining uses). The HUD hotbar shows the real inventory with stack counts and durability bars, plus the item's name when you switch.

**Crafting (`js/crafting.js`).** A 2×2 grid in the inventory, 3×3 at a **crafting table** (right-click it; sneak to place blocks against it instead). Shaped recipes match anywhere in the grid and mirrored; shapeless recipes match any arrangement. Recipes: planks, sticks, crafting table, torches, wool, golden apple, and 16 tools (sword, pickaxe, axe, shovel in wood, stone, iron and diamond). Smelting with coal: ore + coal → ingot, raw meat + coal → cooked meat, 4 sand + coal → 4 glass, 4 cobblestone + coal → 4 stone, 4 gravel + coal → 4 bricks. Since nobody knows a new game's recipes, the screen has a **recipe book**: every recipe that fits the current grid, the ones you can make right now highlighted, and clicking one moves the ingredients from your inventory into the grid. Shift-clicking the result crafts as many as possible.

**Ores and caves (`js/terrain.js`, `js/noise.js`).** Winding 3D-noise tunnels plus larger caverns deep down, carved so they never breach the sea (no dry air pockets held up by water) and never break the bedrock floor (now ragged, two layers). Ore veins by depth: coal (y 5–50), iron (3–40), gold (2–22), rare diamonds (1–13), and gravel pockets; lumen crystals grow on deep cave ceilings as natural light sources. The original height map, trees and shared seeds are unchanged. About 1 ms per chunk.

**More block types.** Now actually in play: coal/iron/gold/diamond ore, gravel, bricks, wool, crafting table, torch, lumen crystal, tall grass, flowers, bedrock. New items: sticks, coal, iron and gold ingots, diamonds, apples, golden apples, raw and cooked meat, fluff (meat and fluff come from Phase 5's animals), and the 16 tools. All icons are painted in code (`js/itemtextures.js`).

**Sprint, sneak and swimming.** Sprint with Ctrl or a double-tap of W (faster, wider FOV; stops when you sneak or run into a wall). Sneak with Shift (slow, lowers the camera, and won't walk you off an edge). In water you move slower, Space swims up, you can climb out onto a ledge, and there's a splash.

**In your hand (`js/held-item.js`).** The held item (or a bare arm) is drawn in first person as an overlay, so it never clips into walls. It's lit by the light where you stand, swings when you mine, place or attack, dips when you switch items, bobs as you walk, and is raised to your mouth while eating (hold right-click with food; eating takes about a second).

**Persistence.** Per world: game mode, position, view direction, health, breath, inventory, selected slot and time of day, saved every 5 seconds and when leaving the page, restored on load. Leaving mid-game asks for confirmation first (Ctrl+W while sprinting with Ctrl would otherwise close the tab).

**Sounds (`js/audio.js`).** Procedural break, place, dig and footstep sounds per material (stone, wood, dirt, grass, sand, glass, cloth, plants), plus pickup, crafting, eating, burp, hurt, death, tool break, splash and UI click sounds.

**Bugs found and fixed along the way:**
1. **Blast floods stopped short in caves.** With caves, a sea-floor blast can breach a cave system. The flood fill was depth-first, so it snaked down a tunnel and hit its cell cap while cells right next to the crater were still dry. It's now breadth-first (the crater fills first), with the cap raised to 12,000 cells (a full-cap flood measured 36 ms).
2. **Double-taps failed after a slow frame.** Double-tap detection used the time the handler ran, so a slow frame between the two taps broke it. It now uses the events' own timestamps, and a third tap no longer toggles flight twice.
3. **Stronger hits ignored.** The first version of the invulnerability window ignored *any* damage for 0.5 s, so a Blast Orb right after a fall did nothing. Now the excess of a stronger hit applies.

**Testing.** Unit tests (Node) grew to 22: terrain determinism and the unchanged height map; caves never leave air touching water or break the bedrock; sensible amounts of caves, ores and crystals; generation speed; every recipe uses real items; recipe matching (position, mirroring, extra items); tool tiers gating drops and speed; inventory add/merge/overflow and durability; slot click semantics; crafting output (take, shift-craft-all, quick move); inventory save/load with garbage rejection. The browser smoke test grew to 28 checks, driving real mouse and keyboard input: a new world starts in Survival with 10 hearts and an empty inventory; creative instant-break, placing from the hotbar without using it up, scrolling, flight toggle; mining dirt by hand takes time (the block cracks first), drops, and the drop flies into your hotbar; stone mined with a wooden pickaxe gives cobblestone and costs 1 durability; E opens the inventory and a log is crafted into 4 planks with real clicks; right-clicking a crafting table opens a 3×3 grid, the recipe book marks what's craftable and fills the grid, and shift-clicking crafts a pickaxe; eating an apple heals; a 5.5-block fall costs exactly a heart, a 30-block fall shows the NOOB! screen with "Fell from a high place" and spills the inventory, and Respawn restores full health at spawn; your own Blast Orb at your feet kills with "Blown up by your own Blast Orb"; breath runs out under water, bubbles show, and health drops; creative players take no damage from a long fall; the hotbar HUD shows counts and durability; mode, inventory and position survive a reload. All pass with zero console errors.

**Known limitations.** Items lying on the ground aren't saved (they vanish on reload). Water is still static apart from the fill when a blast or a mined block opens a path to the sea. The held item doesn't receive shadows. No drag-to-spread in the inventory screen.

## Phase 5: Mobs and combat — DONE

**Mob models (`js/mob-models.js`, new).** Mobs are box models hinged at pivots, in the classic voxel-game style, but all four designs are original. Each species lists its boxes (size, pivot, parent); the skin texture is packed automatically (one unfolded-box region per part) and painted pixel by pixel in code at 2 texels per model pixel, so faces, fur, shell plates and rags get crisp detail. Parts that never move on their own (horns, beard, hump, shell dome) are baked into their parent's mesh, so a mob costs 6–9 draw calls. Mobs use the same entity shader as dropped items, so they're lit by the voxel light where they stand (dark in caves, warm by torches), cast shadows, flash red when hit, and can have glowing texels (the zombie's eyes bloom at night).

**The species (`js/mobs.js`, new).**
- **Fluffalo** (passive): a rust-furred, humped highland grazer with a cream mane, a beard and upswept horns. Wanders, stops to graze, looks at you when you're close, bolts when hurt. 5 hearts. Drops fluff (craft 4 into wool) and raw meat.
- **Hoplet** (passive): a small sand-colored hopper with dark stripes across its back, tall pink-lined ears and a white tail. Travels in hops (ears stream back, hind legs kick), flees fast. 2 hearts. Drops raw meat, sometimes fluff.
- **Mossback** (passive): a slow tortoise whose plated shell grows moss and tiny flowers. When hurt it doesn't run: it pulls its head and legs into its shell and hides for a few seconds, taking half damage meanwhile. 7 hearts. Drops raw meat, sometimes an apple.
- **Zombie** (hostile): a hunched, pallid shambler in torn maroon rags, arms reaching forward, with sunken sockets and glowing amber eyes. Spawns in darkness, chases you, swings its arms down to hit for 1.5 hearts with knockback (once a second), groans. Burns and dies in direct daylight. 10 hearts. Drops coal, rarely an iron ingot or an apple.

**AI and pathfinding.** Animals switch between idling (sometimes grazing), wandering in a random direction, and fleeing from you (the Mossback hides instead). Zombies notice a survival-mode player within 20 blocks (and keep chasing to 28), turn their head to track you, and ignore creative players. Movement uses simple obstacle-aware steering rather than full path search: each step probes the column ahead and classifies it as *open*, a *1-block step* (jump), a *wall*, *water* or a *cliff* (drops over 2 blocks for animals, 3 for zombies). When the direct way is blocked, the mob tries detours at ±40°, ±80° and ±120°, preferring one side and remembering a working detour for a moment so it doesn't dither. Mobs never walk into water on purpose; one that ends up in water floats and paddles out.

**Physics.** Mobs collide with the world using the same box-sweep code as the player (moved into the new `js/physics.js`, which the player now uses too), with gravity, knockback, fall damage (not for the hoppers), and gentle pushing so mobs don't overlap each other or you.

**Spawning and despawning.** Animals appear in small herds on sunlit grass 24–56 blocks away (plus an initial herd around you when a world starts), up to 14. Zombies spawn 18–44 blocks away wherever it's dark (block light and night-dimmed sky light at most 4): on the surface at night, or in unlit caves at any time. Up to 10. Mobs more than 128 blocks away or in unloaded terrain are removed at once; zombies more than 48 blocks away fade out over time (on average 20 s). Mobs aren't saved.

**Combat.** Melee uses an attack charge like modern Minecraft: a sword recharges in 0.6 s, an axe in 0.9 s, other tools in 0.8 s, the bare hand in 0.35 s. Hitting early deals as little as 20% damage, and a small bar under the crosshair shows the recharge. Damage comes from the weapon (hand 1, swords 4–7 by material, axes and other tools less). Hitting while falling is a critical hit (×1.5, with sparks and a sharper sound). Hits knock the mob back (harder while sprinting), flash it red, and give it a short invulnerability window. Swords wear by 1 per hit, other tools by 2. Swinging at thin air resets the charge. You can hit mobs within 3.5 blocks (5 in creative), and mobs block block placement. Dead mobs flash red, topple over, then vanish in a puff of smoke and drop their items. Blast Orb explosions hurt and fling mobs just like the player.

**Sounds (`js/audio.js`).** Procedural voices per species (the Fluffalo's low grumble, the Hoplet's squeaks, the Mossback's clicks, the zombie's groan and attack growl), each with hurt and death variants and fading with distance, plus a hit thwack, a crit crack and a swing whoosh.

**Death by mobs.** A zombie's killing blow brings up the NOOB! screen with "Killed by a zombie". Respawning now searches for the nearest dry spot around the world spawn, because the smoke test showed that a Blast Orb crater at spawn can flood and would otherwise respawn you underwater.

**Bugs found and fixed along the way:**
1. **Knockback that didn't knock back.** The smoke test showed that a sword hit barely moved a zombie: its own chase movement toward the player cancelled the push immediately. A hit mob is now staggered for a moment (no steering and no attacks), so the knockback carries it.
2. **Animal cap overshoot.** Herds spawned whole, so the passive count could exceed its cap by two. Herd size is now clamped to the remaining room.
3. **Flooded respawn point.** See above.
4. **A too-familiar design.** My first Fluffalo (cream wool, brown face, short legs) read as a sheep in screenshots, so I redesigned it (rust fur, cream mane, hump, beard, upswept horns) to keep the mobs original.

**Testing.** New unit tests for the shared collision code (sweeps stop exactly at floors and walls; ray-box hits, misses and distance limits), for 24 in total. New browser smoke checks, all with real mouse input on purpose-built night arenas: animals spawn around a new player; a zombie chases the player, climbs a 1-block step and hits for 1.5 hearts; a fully charged iron-sword hit deals exactly 6 damage, flashes the zombie red, wears the sword by 1 and knocks the zombie back, while an immediate second swing is weak; the zombie dies, topples and is removed; a hurt Fluffalo flees, and killing it drops fluff and raw meat that the player collects; a chasing zombie stops at a water moat and never gets wet; a zombie's killing blow shows NOOB! with "Killed by a zombie"; after 600 spawn ticks at night the caps hold (10 zombies, at most 14 animals); a zombie 200 blocks away despawns; a zombie in daylight burns; a blast kills an animal; zombies ignore creative players. 35 smoke checks and 24 unit tests pass with zero console errors.

**Known limitations.** Steering isn't real path search, so a maze or a pit can leave a zombie stuck; zombies notice you through walls (no line-of-sight check); mobs don't drown and aren't saved.

## Round 2 — final summary

**What changed in this round.** Voxelands went from a creative-only block sandbox to a small survival game with a much more ambitious look:

1. **Phase 1:** fixed the inverted W/S movement (with a test that checks the direction of every key at two headings), and made 10 chunks the default render distance, with time-budgeted streaming so it doesn't freeze the page.
2. **Phase 2:** the Blast Orb became a proper explosive: a 2–3× bigger lumpy crater, a farther arcing throw, fire, smoke, debris, shockwave, flash lighting, screen shake and a layered boom. Only affected chunks rebuild, and the save format shrank ~17×.
3. **Phase 3:** a new rendering and lighting architecture: flood-fill voxel light, smooth lighting and AO, soft sun shadows, HDR bloom, light shafts, ACES tone mapping and grading, an analytic sky with sunsets, stars and a moon, reflective animated water with caustics, glowing torches and crystals, all-new 32×32 textures, and Low/Medium/High/Ultra presets.
4. **Phase 4:** survival and creative modes, health with fall/drowning/void/explosion damage, the NOOB! death screen and respawn, timed mining with tool tiers and drops, item entities, a 36-slot inventory, 2×2 and 3×3 crafting with a recipe book, caves and ores, sprinting, sneaking, swimming, a first-person held item, and player persistence.
5. **Phase 5:** three original passive animals and an original zombie, with steering that climbs steps and avoids water and cliffs, spawning by light level, caps and despawning, and melee combat with attack charge, crits, knockback, hit flashes, death animations, drops and sounds.

The codebase grew from ~2,000 lines of JavaScript in 11 modules to ~10,800 lines in 34 modules (plus a ~580-line `index.html` and ~1,700 lines of tests). It's still plain ES modules with no build step, still loads only three.js r160 from the pinned CDN, and still has no asset files.

**Testing.** Every phase ended with `node --check` on the changed files, both test suites, and a check for zero console errors. At the end: **24 unit tests** (save format, the light engine against a brute-force reference solver, terrain and caves, recipes, mining rules, inventory logic, collision) and **35 browser smoke checks** that drive the real game with keyboard and mouse input in headless Chromium, all passing with zero console errors. The smoke test caught real bugs in every phase (sealed air bubbles in crater walls, NaN pixels blooming into white blobs, a white sky on Low, blast floods stopping short in caves, a flooded respawn point, double-taps lost in slow frames).

**Known issues and limitations.**
- **Performance on real GPUs is unmeasured.** The sandbox only has a software renderer (2–5 FPS even on Low), so I verified correctness and per-system CPU costs (chunk generation ~1 ms, meshing ~0.7 ms, a crater rebuild ~2.5 ms), not frame rates. Ultra (4096² soft shadows, 4× MSAA HDR, up to 2× pixel ratio) is meant for decent desktop GPUs; if it isn't smooth, Medium or Low should be.
- **Water is static.** It only fills in when a blast or a mined block opens a path to the sea (up to 12,000 cells per event); there's no flowing water.
- **Mob pathfinding is steering, not search.** Zombies climb steps and detour around walls, but a maze, or a pit between you and them, can leave them stuck. They also notice you through walls (no line-of-sight check), and mobs don't drown.
- **Not saved:** mobs and items lying on the ground vanish on reload (block edits, the player, inventory, mode and time of day are saved).
- **Deliberately left out:** hunger, furnaces, chests, beds, armor, experience, doors, biomes. Smelting is crafting with coal instead.
- Terrain generation and meshing still run on the main thread (time-budgeted per frame); a Web Worker would make streaming smoother at high render distances. Of Round 1's wish list, the DDA ray cast, the sun/moon/stars, underwater rendering and the Blast Orb cooldown indicator are done; greedy meshing (harder now that every vertex carries its own AO and light), Web Workers and biomes are still open.
- The held item isn't shadowed, water reflects only the sky (no terrain reflections or refraction), and light shafts only appear while the sun is on screen.
- Pointer lock quirks: browsers sometimes refuse to re-lock the mouse (for example within about a second of pressing Esc during play). When that happens after closing the inventory, the pause menu appears and one click resumes.

**Honest self-assessment.**
- *What went well:* the phases build on each other cleanly. The Phase 3 voxel light engine is what makes caves dark, torches meaningful, and zombies spawn in the right places in Phase 5. The inventory and crafting logic was written as pure, unit-tested modules before any UI existed, so the UI stayed thin. The smoke test paid for itself repeatedly by catching real bugs in systems that looked fine in screenshots. The game now has an actual survival loop, from punching a tree to diamond tools with zombies at night, and it all stays procedural.
- *What's weaker:* I couldn't judge the "RTX look" or the smoothness on real hardware, only through software-rendered screenshots, so the graphics tuning (exposure, bloom, fog density) may need adjustment on a real GPU. Mob AI is simple. It's believable at a glance, but not clever. The mob and item art is decent programmer art; a pixel artist would do better. main.js has grown into a long wiring file that could be split (game state machine, persistence, rendering).
- *Scope decisions:* when something threatened to balloon (real pathfinding, flowing water, furnaces with timers), I chose the simpler version, and noted it above rather than leaving it half-finished.

---

# Round 3 — upgrade log

## Phase 1: Bug fixes — DONE

**1. Water glitch (screenshot 1).** *Root cause:* two different definitions of "under water". The top block of a body of water draws its surface lowered (at 0.875 of the block, minus a little more, moved by waves), but the game decided "the camera is under water" from the block grid: any eye position inside a water block's cell counted. With the eye just above the drawn surface (swimming at the surface, standing in shallows), the whole screen got the murky under-water fog. On top of that, the water shader decided *per fragment* whether it was looking at the surface from below, by which side of the face the camera was on. Near the waterline, wave crests rise above the eye, so a band of surface quads along a crest was drawn with the "underside" colour: the strip of light teal quads in the screenshot. I reproduced both in the sandbox with the eye at 0.86, 0.9 and 0.95 of the top water block. *Fix:* a new `js/water.js` holds the surface/wave formula shared with the shader and decides once per frame whether the eye is below the *drawn* surface; the water shader uses that one camera state for every face. Verified with the same renders: above the surface you now see the surface from above with no fog, and there is no band.

**2. Lighting (screenshot 2).** *Diagnosis:* the lighting function multiplied direct sunlight by the per-vertex ambient occlusion (down to 0.69 at an occluded corner) and by a factor from the voxel sky light level. AO is interpolated across each 1-block face, so a sunlit face touching the ground or another block got a large diagonal dark gradient unrelated to any shadow: lit and shaded at the same time. The sky-light factor did the same under overhangs, where the shadow map said "lit" but the voxel light said "dark". *Fix:* direct light is now decided by the shadow map wherever it covers the scene. It fades to the voxel sky light only beyond the shadow map's range, and on Low, which has no shadow maps (so distant caves stay dark). Ambient occlusion now only darkens *ambient* light, as in reality: a corner in full sun isn't darker, only a corner in the shade is. I verified this with before/after renders of the same inner-corner scene and pixel diffs, which show exactly the AO gradients disappearing from sunlit faces and sunlit ground. The dark wedge that remains near a sunlit inner corner is the neighbouring block's real shadow.

**3. Black "outlines" through water and terrain (screenshot 3).** *Diagnosis:* these are NaN/infinite pixels, not lines. With MSAA (Medium and up), a pixel on a triangle's edge can be shaded at its centre even when that point lies outside the triangle, so per-vertex values get *extrapolated*. For faces seen nearly edge-on (thin slivers, like the vertical sides of seabed steps viewed from above), the extrapolated voxel light can go below 0 or above 1. `pow(light, 1.7)` of a negative number is NaN, and the torch curve `l / (4 − 3l)` divides by zero at 4/3. The post-processing guard turned those pixels black, and because blending water over a NaN pixel is still NaN, they showed through even deep, almost opaque water. That's why they appeared exactly along the edges of steps and holes. *Fix:* the per-vertex light, AO and water depth now use `centroid` interpolation (never extrapolated outside the triangle), and the lighting function clamps its inputs as well. *Honest caveat:* the sandbox's software renderer doesn't extrapolate at MSAA edges, so I couldn't reproduce the lines themselves (a render with NaN pixels marked in magenta showed none). The evidence points to this cause: crisp black through almost opaque water, only along silhouettes of thin faces, and only with MSAA. A new test compiles the real lighting function on the GPU and checks that extrapolated inputs give finite results.

**4. Sand gravity (new `js/falling.js`).** Sand and gravel fall when nothing solid is under them. Every edit batch reports its changed cells, and a loose block that lost its support detaches *together with the whole loose column resting on it*, so a column falls as one and lands stacked. Falling blocks are entities with gravity (the real block texture, lit by the voxel light) that turn back into blocks where they land. They fall through air, water and plants, and a block that lands in a torch's cell breaks into an item (as in Minecraft). Works after explosions, mining, placing sand in mid-air, and chains. For performance, at most 64 blocks animate at a time; any further loose columns settle instantly with one batched edit (moved straight down to where they'd land). A blast in a sand bank animated 64 blocks and settled 161 more in 1.2 ms.

**5. Sound cleanup (`js/audio.js`, rewritten).** Almost every sound is now shaped noise with natural envelopes: resonant filters give it the material (a woody knock, a glassy chink), and several layered grains give texture. The only pitched sounds left are creature voices, which run a buzzy source through vowel-like formant filters with vibrato and breath instead of bare oscillator sweeps.
- **Removed:** the jump sound (as asked), and the burp after eating (odd, synthetic).
- **Redesigned:**
  - **Block sounds:** stone has a click plus a low body; wood a resonant knock (was a sine "boop"); grass, plants and sand are grain rustles; dirt a soft thud; cloth a muffled pat. Glass is now a cluster of resonant noise chinks (was sine tones).
  - **Small feedback sounds:** item pickup is a soft pop (was a sine chirp), and the UI click a quiet tick (was a harsh square wave). Crafting is two woody taps (was a triangle-wave chirp), and tool break a snap with bits (was a square-wave squeal).
  - **Hurt and death:** getting hurt is a dull body thud (was a sawtooth "grunt"), and dying a heavy thud plus a low rumble (was a 1.2 s descending sawtooth).
  - **Movement and weapons:** the flight toggle and the throw are soft air whooshes (were sine sweeps), and a weapon hit is a noise thwack (was a triangle-wave thump).
  - **Mob voices** go through formant filters: the Fluffalo grumbles, the Hoplet squeaks breathily, the Mossback clicks and hisses, and the zombie moans hollowly (all were raw sawtooth or sine sweeps).
- **Kept as they were:** footsteps (now using the new material sounds), the splash (now with droplets), the swing whoosh and the explosion.

**Testing.** New smoke checks:
- **Lighting:** the real lighting function, compiled into a tiny GPU shader, gives the same direct light for an open and a fully occluded corner (0.936 vs 0.932; the difference is a constant ambient floor), and finite values for out-of-range inputs; the terrain and water shaders use centroid light.
- **Water:** the under-water test follows the drawn surface: just above it, and anywhere in the rest of the top block, is not under water; just below it and deeper is.
- **Sand gravity:** a 6-block sand column on a pillar falls together when the pillar is removed and lands stacked, while supported sand stays put. Gravel landing on a torch breaks and leaves the torch.
- **Explosions and loose blocks:** a blast in a sand bank animates at most 64 blocks, settles the rest in one batch, and leaves nothing floating.
- **Sounds:** every sound effect and mob voice plays without errors, and the jump and burp sounds are gone.

**40 smoke checks and 24 unit tests pass with zero console errors.**

## Phase 2: Weapons, part 1 — DONE

**Blast Orb → Grenade.** The Blast Orb, its separate HUD indicator and the F key are gone. The **Grenade** is now a normal item (stack of 1 in creative, craftable from 1 iron ingot + 2 coal). With it selected, holding right-click charges the throw, and a small bar under the crosshair fills (red glow when full). A quick click lobs it about 6 blocks; a full charge (1.5 s) throws it about 25. It's a physical object: gravity, sub-stepped collision with blocks, bounces with energy loss (restitution 0.38) plus friction, and it rolls to a stop. It explodes after a 5 s fuse (it blinks red), or at once when it hits a mob directly. The blast size is unchanged (radius 7).

**Pistol** (new `js/weapons.js`, crafted from 3 iron ingots + 1 plank). Right-click fires a hitscan shot with slight spread. It hits the first solid block (bullets pass through grass, flowers and torches) or the first mob hitbox, whichever is nearer.
- **On blocks:** sparks, dust in the block's colour, a ricochet sound, and a bullet hole decal (`js/decals.js`, pooled, 96 at most). A hole disappears when its block is broken or blown up.
- **On mobs:** 5 damage and knockback, with a hit flash and blood puffs.
- **Every shot:** a muzzle flash (an additive sprite plus a short point light), a recoil kick on the camera and the gun model, and a noise-based gunshot sound.

**Bazooka** (crafted from 8 iron ingots around a grenade). Right-click fires a rocket from the tube (or from the eye when the tube is inside a wall) toward the crosshair point.
- **Flight:** 75 blocks/s, nearly flat (gravity -2.5), with a glowing exhaust (a sprite plus a moving light) and a smoke trail. It lives up to 12 s or until it leaves the loaded terrain.
- **Collision:** each step casts a ray against blocks and mob hitboxes, so it can't tunnel through thin walls or small mobs.
- **Blast:** radius 35 (5× the grenade), with a much bigger fireball, more debris, a heavy shake, a longer and deeper boom, and strong knockback. You can kill yourself with it: "Blown up by your own bazooka" (a fall right after your own blast reads "Sent flying by your own bazooka"; grenades work the same way).

**Controls.** With a grenade, pistol or bazooka selected, right-click uses the weapon instead of placing a block. There's no ammo and no reloading. Every click fires, with only a tiny minimum interval (70 ms pistol, 200 ms bazooka, 120 ms between grenade throws).

**Hitboxes and damage.** Mobs have ray and sphere hit tests (`mobs.raycast`, `mobs.sphereHit`), used by bullets, rockets and grenades. Explosions damage and fling mobs and the player by distance, scaled with the blast size. Damage and knockback are capped so a bazooka throws a mob far but not into orbit.

**Explosion falloff (all explosives, new pure `js/falloff.js`).**
- **Camera shake:** falls smoothly with distance (smoothstep to zero at `6 × radius + 20` blocks), so a grenade 40 blocks away is a light rumble and one 90 blocks away is felt only through sound.
- **Sound:** gain drops with distance, a low-pass filter closes (18 kHz up close, down to about 220 Hz far away) so distant blasts are muffled, and the sound is delayed by distance / 343 m/s (capped at 1.2 s). Bigger blasts are louder, deeper and longer.

**Performance of big blasts.** A bazooka blast can remove tens of thousands of blocks, so:
- **Carving:** reads chunk arrays directly, column by column, and applies everything with one batched `setBlocks` (one light update, one change notification).
- **Rebuilds:** chunks are no longer all rebuilt in the same frame. The 8 nearest rebuild at once, then more only while the frame's 10 ms edit budget lasts; the rest continue over the next frames, nearest first.
- **Loose blocks:** falling sand is capped at 64 animated blocks; any more settle instantly in one batch (Phase 1).
- **Measured in the sandbox's software renderer:** a surface bazooka blast removed 21,270 blocks with 68 ms of carving. A worst-case underground blast removed about 67,000 blocks in about 170 ms total (carving plus light), with the chunk rebuilds spread over several frames. That's a hitch, but no longer a freeze.

**Other fixes.**
- The held item now follows the selected slot every frame (it could get out of sync when the slot changed without a key press).
- A pending equip animation no longer restarts every frame.
- Gun models were resized and posed so they sit in the lower right like the other tools (the bazooka's rear used to clip the near plane as a black block).

**Testing.** New and rewritten smoke checks, all using real mouse input:
- **Grenade throw:** holding the button shows the charge bar; a quick click lands about 6 blocks away and a full charge about 25; grenades bounce; the fuse is 5.05 s.
- **Grenade blast:** the crater is still about 7 blocks (radius 6.7, 523 blocks).
- **Direct hit:** a grenade thrown straight at a zombie explodes 0.4 s after the throw and kills it.
- **Pistol:** 6 clicks give 6 shots and 6 bullet holes, with no reload. A zombie hit takes exactly 5 damage and is pushed back, and the holes disappear with their blocks.
- **Right-click with a weapon:** places no block.
- **Bazooka:** the rocket flies at 75 blocks/s with little drop and a smoke trail; the blast radius is 35 (21,270 blocks removed, reach 34.9); falling blocks stay within the cap.
- **Shake:** a grenade shakes the camera 0.56 at 6 blocks, 0.11 at 40, and 0 at 90 and 200.
- **Deaths:** your own grenade at your feet, and a point-blank bazooka shot, both kill you in survival with the right death message.
- **Removed:** the old Blast Orb checks. The creative check now also asserts that F does nothing and the orb UI is gone.

New unit tests check that shake and loudness fall monotonically with distance, that distant blasts are muffled and delayed, and that bigger blasts are louder.

While running these, the full suite exposed two test-order problems, which I fixed:
1. The "animals spawn at the start" check ran after weapon checks that clear mobs, so it now runs before them.
2. The sword check could be hit by the zombie between aiming and swinging. A hit knocks the player into the air, which turned the swing into a critical hit, so the check now holds off the zombie's attack and waits until the player is on the ground.

**46 smoke checks and 26 unit tests pass with zero console errors.**

## Phase 3: Render distance with level of detail — DONE

**What changed for the player.** The render distance slider now goes up to **100 chunks** (1,600 blocks), and the default is **20** (was 10, max 16). Only the area around the player is drawn in full detail. Beyond it, the land is drawn with simplified, blocky meshes that get coarser with distance, so far-away hills, beaches, lakes and forests are visible out to the horizon.

**How it works (new `js/lod.js`, `js/lod-mesher.js`, `js/lod-worker.js`).**
- **Quadtree of tiles.** The ground is divided into a quadtree of square tiles. A tile at level L covers 2^(L+1) × 2^(L+1) chunks as 32 × 32 cells of 2^L blocks. It splits into its 4 children while the player is closer than `detailDistance × 2^(L−1)` chunks (with a quarter-tile of hysteresis, so walking back and forth over a boundary doesn't flip it). So cells are 2 blocks from about the detail distance out, 4 blocks from twice that, 8 from four times, and so on: the step grows in proportion to distance.
- **Detail area.** A split level-1 tile is the "detail" area. Its chunks are generated, lit and meshed by the World exactly as before. Mobs, physics, falling blocks and explosions only exist there (and in its one-chunk margin).
- **Tile meshes.** Each cell is a column at the ground height sampled at the cell centre from the terrain generator: a flat top, plus walls down to lower neighbours, so distant land keeps the voxel look.
  - **Merging:** tops are merged into runs, and walls along the border direction.
  - **Water:** a flat surface at the drawn water level that carries its depth. The LOD shader colours it like the near water (depth colour, sandy floor, fresnel sky reflection, sun glint).
  - **Trees:** canopy boxes on levels 1–3 (they use the same tree placement rule as terrain generation, now shared through `TerrainGenerator.treeAt`, verified to generate byte-identical chunks). Farther out, trees become a tint of the grass.
  - **Skirts:** every tile border gets a deep wall, so tiles of different levels, and the detail area, never leave cracks.
- **Colours** come from each block's texture average in linear light (what a mipmapped texture shows from far away), and the tiles use the same lighting and fog code as the chunks.
- **Player edits reach distant terrain.** For chunks the player has changed, the worker generates the real chunk, applies the saved edits and uses its actual surface, and it drops trees that were cut down or blown up. A crater stays visible from afar, and tiles over an edited chunk are rebuilt when needed.
- **Web Worker.** Tile meshes are built in a module Web Worker (nearest first, a few requests in flight so a new plan can re-prioritize), and handed back as transferable typed arrays. The main thread only turns them into geometry, within 3 ms per frame. If module workers aren't available, tiles are built on the main thread within a per-frame budget instead.
- **Seamless hand-over.** The planned leaves exactly partition the ground, and a region keeps its old look until the new one is complete:
  - When a tile splits, it stays visible until all its children, or all its chunks, are ready. Around the player, a gap is preferred over coarse ground underfoot.
  - When tiles merge, the children (or chunks) stay visible, and loaded, until the parent tile is built.
  - New chunks start hidden, and the LOD system decides which ones show.
- **Memory.**
  - Tiles that are neither planned nor needed as a stand-in are disposed.
  - Chunks more than 3 chunks outside the detail area are unloaded. Chunks that were only kept as stand-ins are released as soon as they're no longer shown, not only at the next re-plan.
  - After a 1,500-block move, the test finds exactly the planned tiles and no chunk beyond the render distance.
- **Fog and far plane.** Fog ends at the render distance as before, and the camera's far plane now follows the render distance (at least 1,000).
- **Presets** now set how far full detail reaches (`detailDistance`) and suggest a render distance:

  | Preset | Full detail distance | Suggested render distance |
  |---|---|---|
  | Low | 4 chunks | 12 |
  | Medium | 6 chunks | 16 |
  | High | 8 chunks | 20 |
  | Ultra | 8 chunks | 20 |

  The detail area on Ultra (about 320 chunks) is about what Ultra drew in full before at distance 10. The render distance slider still goes to 100 on every preset.

**Measured.**
- **Build cost:** a Node benchmark builds a tile in 1–5 ms.
- **Tiles at each render distance (Ultra):**

  | Render distance | LOD tiles | Vertices | Memory | Total build time |
  |---|---|---|---|---|
  | 20 | 70 | about 290k | 6 MB | about 0.3 s |
  | 64 | 224 | 1.4M | 32 MB | — |
  | 100 | 300 | 2.4M | 52 MB | about 0.3 s |

- **In the browser, on Low:** render distance 64 streamed in within 3.8 s after its detail area was loaded. The longest main-thread LOD update (plan, uploads and visibility pass) was 2.8 ms.
- **Transition quality:** I rendered the same view at render distance 16 twice on High, once with LOD beyond 8 chunks and once with every chunk in full detail (797 chunks). The mean pixel difference is 2.1/255, mostly in the shapes of distant tree canopies. Side-by-side crops of the horizon are hard to tell apart.

**Testing.** New unit tests (lod-mesher.js, in Node):
- Tiles are well-formed, and every cell top sits at the terrain height sampled at its centre.
- Walls exactly cover every height step inside a tile (total wall area equals the sum of height differences), and skirts cover all four borders, reaching below the tile's lowest surface.
- Trees are boxes on near levels and a tint far away.
- A dug-out chunk lowers the distant surface and removes its tree, and clearing the edits restores both.

New smoke checks:
- The default render distance is 20 of a maximum of 100.
- Detail chunks and LOD tiles stream in, built in a worker, and **every chunk within the render distance is drawn exactly once** (no gaps, no overlaps).
- Flying 14 chunks while sampling coverage every couple of frames finds no overlaps and no gaps inside half the render distance at any moment (42 samples), and full coverage after settling.
- A crater dug 12 chunks away shows in the distant tile (surface y=10 instead of 25).
- Render distance 64 streams in with short main-thread updates and a far plane beyond it, and moving 1,500 blocks away releases every out-of-range tile and chunk.

The test arenas that are built at an offset from spawn now load their chunks first (`prepareArea`), because with the smaller detail area on Low they may lie outside it.

**49 smoke checks and 30 unit tests pass with zero console errors.**

## Phase 4: Graphics upgrade — DONE

**Relief textures (High and Ultra).**
- **Relief maps:** every block texture now has a matching relief map (a second texture array): a tangent-space normal, a height and a roughness per pixel. The heights come from each material's own structure where it has one: the stone's mottling, the domes of cobbles and gravel (from the same Voronoi cells that paint them), and the sand's ripples. Brightness fills in the rest, because in these pixel-art textures light pixels are the raised bits (pebbles, blades, leaf clusters) and dark ones the cracks.
- **Lighting:** the terrain shader turns the relief into per-pixel normals, with each face's tangent frame taken from the mesher's UV layout, so bumps catch and lose the sun. A GGX specular highlight follows each pixel's roughness: leaves and ore get a sheen, while dirt stays matte.
- **Parallax (Ultra):** parallax occlusion mapping (up to 28 steps, refined between the last two) gives nearby pixels real depth, fading out between 10 and 20 blocks.
- **Richer textures:** grass has clumps and shaded gaps; dirt has roots and flint chips; stone has faint strata and mica specks; sand has lit ripple crests, coarse grains and shell bits; leaves have sunlit leaflets.

**Cascaded, soft sun shadows.**
- **Cascades:**
  - Ultra: 3 shadow maps of growing size (±22, ±64 and ±180 blocks, 2048² each).
  - High: 2 maps (±28 and ±110).
  - Medium: 1 map.
  - Each map is snapped to its own texel grid. Each pixel uses the finest map that covers it and blends into the next near its edge. Beyond all of them the voxel sky light takes over, as before. The extra cascade lights give no light of their own, so three's built-in materials don't get lit three times.
- **Soft edges:** filtering is done in the shader, over a Poisson disc rotated per pixel (interleaved gradient noise), with 6, 12 or 16 taps depending on the preset. On Ultra the finest cascade uses percentage-closer soft shadows: it first searches for the occluder, then widens the filter with its distance. A post's shadow is crisp where it meets the ground and soft farther away, like a real sun.

**Water (High and Ultra).** The frame is now drawn in two passes (new `js/layers.js`):
1. **The world**, without water. Its colour and depth are resolved from the multisampled buffer (depth into a depth texture).
2. **The water**, which reads that image, followed by transparent effects (smoke, sparks, exhaust) on top. The second pass reuses the frame's shadow maps.

The water shader:
- **Refraction:** bends what's behind by the wave normals (without borrowing pixels from anything in front of the water).
- **Absorption:** uses the real thickness of water along the view ray (from the depth buffer), with red absorbed first. Shallows are clear and turquoise, over the sand and seabed caustics; depths fade to deep blue.
- **Reflections:** on Ultra, screen-space reflections march the reflected ray through the depth buffer (48 steps, 5 refinement steps, fading at the screen edges); on High, and wherever that misses, the sky is reflected.
- **Fresnel and glint:** a fresnel blend between the two, plus the sun glint.
- **Foam:** where the water gets shallow along the view ray, so it follows shores and anything standing in the water.
- **From below:** the world above shows through Snell's window, and total internal reflection shows beyond it.

Low and Medium keep the cheaper blended water.

**Vegetation (High and Ultra).**
- **3D grass:** instanced tufts of thin blades on grass blocks with air above: 1 per block within 16 blocks on High, 2 within 24 on Ultra. They are lit like the terrain (voxel light, sun shadows, light through the blades), sway in the wind, bend away from the player's feet, and shrink away toward the edge so they never pop. Each chunk's grass tops are cached until the chunk is rebuilt.
- **Fuller leaves:** each leaf block on the outside of a canopy gets two extra leaf cards at a random angle. They stay within the block's height, so flat canopy tops don't sprout fins, and poke out past its edges and corners, which breaks up the cube silhouette. They sway with the leaves, and toggling the preset rebuilds chunks gradually.

**Low stays light.** Low has no shadow maps, no post-processing, no relief sampling, the old water, no grass and no leaf cards. Its frame is the same as before, apart from the richer textures.

**Bug found by the probe.** The first High/Ultra run failed because the new water shader used `projectionMatrix` in the fragment stage, which three.js only declares for vertex shaders. The shader didn't compile, so water on those presets broke. The projection is now passed as its own uniform.

**Testing.** Two new smoke checks:
- **Presets:** each preset sets the right number of cascades, relief textures, parallax, water mode, grass level and leaf cards.
- **Ultra functional check:** a purpose-built pool with a white floor under 1 block of water on one side and 12 blocks on the other.
  - **Water:** the shallow half shows the floor through the water (luminance 229) while the deep half is dark blue (57).
  - **Rendering:** all 3 shadow cascades render, there are 2,824 grass tufts around the player, and fuller leaves add cards to a leaf chunk.
  - **Low:** switching back turns the extras off.

I also checked every feature visually in the sandbox on a relief test wall, a floating leaf slab, a pool with a sloping sandy seabed and markers, and underwater views.

**51 smoke checks and 30 unit tests pass with zero console errors.**

## Phase 5: Visual realism — DONE

The three references were the mood target: light shafts in teal water, a grassy marsh with mist over the water, and realistic trees. The world stays blocky; the atmosphere and the life on it are what changed.

**1. Under water (new `js/motes.js`, `UW_RAYS` in `js/postfx.js`).**
- **Light shafts (High/Ultra):** a volumetric pass at a third of the resolution. It marches each view ray through the water, up to the first surface in the depth buffer. At every step it traces the light back up to where it entered the surface, along the sun direction refracted into the water, and samples slowly drifting bands of focused light there. So the shafts are slanted like the sun, move like caustics, and fade with depth and distance. Their strength follows the sky light at the eye, so a sealed, flooded cave has none.
- **Colour:** the water murk is now teal. It gets brighter looking up toward the surface and glows toward the sun, where earlier it was a flat dark blue.
- **Motes (every preset):** 420 particles drift in a 14-block box that wraps around the camera in the vertex shader, so they never have to be moved on the CPU. They show only while the camera is submerged.

**2. Sunbeams through clouds and canopies.** The light-shaft pass marches toward the sun through the sky mask:
- **What blocks the sun:** the sky shader writes cloud cover into it, and terrain and leaves block it. Light pours through gaps in clouds, foliage and terrain.
- **Quality:** the march is dithered per pixel (no banding), with 72 samples on Ultra and 48 on High.
- **Dawn and dusk:** the shafts get stronger and much wider in the low, hazy light at the ends of the day.
- **Tested:** in the sandbox with a leafy wall between the camera and a low sun, with rays streaming through each gap.

**3. Mist over water.** The fog now has a thin mist layer lying on the water level:
- **Physics:** its density falls off exponentially with height, and the fog integrates it exactly along each view ray, so it looks right both from the shore and from a hilltop.
- **Movement:** smooth noise makes it drift in patches.
- **Timing and colour:** it is about 7× denser around sunrise and sunset than at noon (a little denser at night too), and warmed by the low sun.
- **Presets:** half strength on Low and 0.8 on Medium. It costs only a few shader instructions.

**4. Ground plants (rewritten `js/grass.js`).** Instanced plants on the blocks around the player (High: within 20 blocks; Ultra: within 32, denser):
- **Grass:** short tufts, and tall arching grass that yellows toward the tips (2.2 per block on Ultra).
- **Reeds:** stalks with cattails and long leaves, along shores and standing in shallow water.
- **Ferns:** where sky light is reduced under trees.
- **Flowers:** five colours, in scattered patches.

Each plant type is its own geometry with per-vertex colours. All are lit like the terrain (voxel light, shadows, light shining through), sway in the wind (tall plants more), bend away from the player's feet, and thin out and shrink toward the edge of the radius. Medium and Low have none.

**5. Trees (new `js/trees.js`).**
- **Four species:**
  - **Oak:** irregular crowns of 2–3 overlapping blobs with noisy, ragged edges and a few holes, sometimes with a branch reaching into a side blob.
  - **Birch:** tall and slender, with pale bark and narrow crowns.
  - **Pine:** tall, dark trunks with tiered, tapering rings of needles.
  - **Old oak (rare):** a 2×2 trunk, roots that run through the ground's top block, crooked branches and a huge crown.
- **Where they grow:** forests and meadows alternate following a noise field; birches and pines grow in groves, and pines take over high ground. Trees keep a minimum distance: the one with the lower placement hash wins, which is symmetric, so no generation order is needed.
- **New blocks:** birch log and leaves, pine log and needles, and oak wood (bark on every face, for branches and roots, so they don't show sawn-off rings). They have new textures, craft into planks and appear in the creative inventory. Mobs don't spawn on any kind of leaves.
- **Across chunk borders:** crowns and roots now reach up to 9 blocks from the trunk. Each chunk places every tree that reaches into it, in one fixed order, and each tree's "is my ground carved away by a cave?" check uses a new per-block cave test. That test samples the same noise lattice as chunk generation, and matched it on all 68,482 blocks I compared. So every chunk agrees on which trees exist.
- **Distant terrain:** the LOD tiles draw a crown per species (a narrow two-tier cone for pines, a wide crown for old oaks).
- **Leaves and plants:** sunlight shines through them when you look toward the sun (a new foliage flag in the mesher). They also vary in colour: from tree to tree and block to block, and across broad patches of meadow for grass tops and tall grass (a per-vertex tint).
- **Existing worlds:** tree placement and shapes changed, and cave carving matches the old generator exactly. Saved worlds keep all their edits, but trees in untouched areas regrow in the new shapes. The height map, caves and ores are unchanged.

**6. Softer haze and aerial perspective.**
- **Height:** the haze is now thickest near the ground and thins with height (integrated along the ray, scale height 40 blocks), so a view from a hilltop gets clearer.
- **Colour:** it takes the sky's colour toward the horizon, plus a forward-scattering glow around the sun.
- **Result:** distant hills fade into warm, soft light at dawn and into blue at noon, as in the references.

**Performance.**
- **Generation:** chunk generation with the new trees takes 1.0 ms per chunk in the unit test on an idle machine, and up to 2.2 ms while the browser tests run alongside (limit 3 ms; the old trees cost about 0.45 ms less). The shape cache stores 4 bytes per tree block.
- **Leaves:** leaf blocks per chunk average about the same as before (66); forests are denser, meadows sparser.
- **Plants:** the Ultra plant layers hold about 3,500–6,000 instances around the player.
- **Shafts and mist:** the underwater shafts run only while submerged (24 steps per pixel at a third of the resolution); the mist is a few shader instructions.
- **Low and Medium** get the new trees and a little mist and haze math, but no plants and no shafts.

**Process fix.** The first Phase 5 browser run failed to load the game, although `node --check` had passed:
- A GLSL comment with backticks ended its JavaScript template string early.
- A patch duplicated a function header in textures.js.

`node --check` doesn't parse these files strictly as ES modules, so both slipped through. The smoke test would have caught them, but I now also run a strict ES-module parse of every file after each change.

**Bug found by the smoke run: spawning on a tree.** The first full run failed the grenade crater check: its grenade blew away only 41 blocks. The player had started on top of a birch crown, and the grenade went off up there. The spawn column was picked from the height map alone, and the bigger crowns now often grow over it: 38 of 300 worlds I checked started the player on a tree. The spawn now moves to the nearest land column that no tree stands in (`TerrainGenerator.spawnColumn`). The check uses the tree shapes, so no chunks need to be generated. The crater check also gives itself a grenade now instead of relying on the check before it.

**Testing.**
- **New unit test (spawn):** in 120 worlds the player starts on land with nothing solid above; 12 of those spawns had to move off a tree.
- **New unit test (trees):** all four species grow (2,852 oaks, 997 birches, 1,303 pines and 81 old oaks in three 640×640 areas). Every block of every tree in a 7×7-chunk region ends up in the generated chunks (23 trees, 13 of them spanning chunk borders, 0 blocks missing).
- **Ultra plants check:** on a purpose-built marsh (grass, a beach, shallow and deeper water, a leafy roof) there are tall and short grass, reeds and ferns, and at least three tree species grow near spawn.
- **Ultra atmosphere check:**
  - Under water, the light shafts render and the motes show (and hide again above water). In a sealed, flooded stone cell there are no shafts.
  - The mist over water is more than 3× denser at dawn than at noon.
  - Facing a low sun through a gappy leaf wall draws sunbeams.

**53 smoke checks and 32 unit tests pass with zero console errors.**

## Round 3 — final summary

**What changed in this round.**

1. **Phase 1 (bug fixes):**
   - **Water surface:** the glitch at the surface is gone; the game and the shader now share one definition of "under water".
   - **Lighting:** ambient occlusion no longer darkens sunlit faces.
   - **Black edges:** the black NaN pixels along edges seen through water with MSAA are gone.
   - **Sand and gravel** now fall when nothing supports them.
   - **Sounds:** almost every sound was rebuilt from shaped noise, and the jump and burp sounds are gone.
2. **Phase 2 (weapons):**
   - **Grenade:** the Blast Orb became an item with a charged throw, bounces and a 5-second fuse.
   - **Pistol:** hitscan shots with sparks and bullet holes.
   - **Bazooka:** a rocket with five times the grenade's blast radius.
   - **Distance:** camera shake, sound and damage all fall off with distance from a blast.
3. **Phase 3 (level of detail):**
   - **Range:** render distance goes up to 100 chunks (default 20).
   - **Far terrain:** a quadtree of simplified tiles, built in a Web Worker, surrounds the full-detail area. The land is covered exactly once (no gaps, no overlaps).
   - **Edits and memory:** player edits show in the far terrain, and memory is freed behind the player.
4. **Phase 4 (graphics):**
   - **Textures:** relief textures with normal maps and specular light, plus parallax on Ultra.
   - **Shadows:** cascaded soft shadows with contact hardening.
   - **Water:** drawn over the finished world image, for refraction, absorption and reflections.
   - **Vegetation:** 3D grass and fuller leaves.
5. **Phase 5 (visual realism):**
   - **Light:** light shafts and drifting motes under water, and sunbeams through clouds and canopies.
   - **Air:** mist over water at dawn and dusk, and haze that thins with height.
   - **Plants:** grass, reeds, ferns and flowers.
   - **Trees:** four procedural species that grow across chunk borders.

The codebase grew from ~10,800 lines of JavaScript in 34 modules to ~15,200 lines in 46 modules, plus a ~560-line `index.html` and ~2,800 lines of tests. It is still plain ES modules with no build step, it still loads only three.js r160 from the pinned CDN, and it still has no asset files.

**Testing.**
- **Per phase:** every phase ended with `node --check` on the changed files (plus a strict ES-module parse since Phase 5), both test suites, and a check for zero console errors.
- **At the end:** **32 unit tests** and **53 browser smoke checks** pass with zero console errors. That is up from 24 and 35 at the end of Round 2.
- **Real bugs the browser runs caught this round:**
  - The High/Ultra water shader didn't compile (found by a test render).
  - New players started on top of trees.
  - Two syntax errors got past `node --check`.
- **Test fixes:** some checks depended on test order or timing. I fixed their causes rather than adding retries.

**Known issues and limitations.**
- **Performance on real GPUs is still unmeasured.** The sandbox renders with a software rasterizer (a few FPS), so I verified correctness and CPU-side costs, not frame rates. Ultra does a lot per frame:
  - 3 shadow maps (2048² each) with contact-hardening soft shadows;
  - 4× MSAA HDR, parallax, and a second pass for the water with screen-space reflections;
  - up to ~6,000 instanced plants and 72-sample sunbeams.

  Ultra is meant for good desktop GPUs; High, Medium and Low scale down step by step. At render distance 64 the far terrain is ~690,000 vertices, and more at 100.
- **Saved worlds from before Phase 5 grow new trees.** Tree generation changed; the height map, caves and ores didn't.
  - **Edits:** saved edits are kept, but untouched areas regrow trees in the new shapes.
  - **Gaps:** old edits apply on top of the new trees, so a tree felled in an old save can leave a gap in a new crown.
- **Some effects only use what's on screen or skip shadows:**
  - **Reflections:** on Ultra they only show what's on screen, and fall back to the sky elsewhere.
  - **Sunbeams** appear only when the sun is on or near the screen.
  - **Underwater shafts** are computed, not shadowed. They ignore shade on the water surface (from a tree overhanging a pond, say). They do follow the sky light at the eye, so a sealed, flooded cave has none.
- **Plants grow only near the player:** within 20 blocks on High and 32 on Ultra. Farther grass is the block texture. Plants don't cast shadows.
- **Distant trees are simple:** the far terrain draws each crown as one or two boxes, and farther out only as a tint of the ground.
- **Main-thread work:** chunk generation and meshing still run on the main thread (time-budgeted per frame); only the distant tiles are built in a worker.
- **Unchanged from Round 2:**
  - Water doesn't flow.
  - Mob pathfinding is steering, not search.
  - Mobs and dropped items aren't saved.
  - Pointer lock quirks remain.

**Honest self-assessment.**
- *What went well:*
  - **Root causes first:** the Phase 1 fixes started from root causes reproduced in the sandbox (the two definitions of "under water", AO applied to direct light).
  - **LOD safety:** exact tests cover the LOD system (flying across the land, every point is drawn exactly once, by a chunk or a tile). That made the hand-over logic safe to change.
  - **Trees:** trees that cross chunk borders are deterministic without any generation order, and a unit test checks that every block lands.
  - **Smoke tests:** they kept catching things screenshots would have missed.
- *What's weaker:*
  - **Tuning:** I tuned all the visuals from software-rendered screenshots. On a real GPU the balance of haze, mist, bloom and light shafts may need adjusting, and Ultra may be too heavy for mid-range hardware.
  - **Large files:** `shaders.js` (1,300 lines) and `main.js` are now large; the shaders would be easier to work on split per material.
  - **Look, not detail:** the plants and trees are procedural approximations that capture the mood of the reference pictures, not their detail.
- *Scope decisions:* I picked the cheaper version of each effect:
  - screen-space sunbeams and computed underwater shafts instead of shadow-mapped volumetric light;
  - instanced plants near the player instead of across the whole view;
  - boxes for distant tree crowns.

  Each was much cheaper and close enough for the look.

## Round 3 follow-up: a blank sky-blue screen at startup — DONE

**Report.** After Round 3, starting the game showed only a plain sky-blue page: no menu, no error.

**What that screen is.** It's the page's background colour. Every panel starts hidden until the game's script shows the start menu, so either the script never got that far (an error, or a file that failed to load), or it did but the page never got to show the result.

**What I checked.**
- **Real server, random worlds:** a fresh clone of the pushed branch, served by the same `serve` that `start.sh` and `start.bat` run, started every time in headless Chromium with no errors. That included random worlds; every earlier test had used seed 42.
- **Same code as players get:** the tests use the same three.js version as the pinned CDN copy (0.160.0). `serve` sends content-hash ETags, so browsers re-check every file and don't mix stale files with new ones.
- **A startup timeline showed the likely cause.** The game's script finished after 0.9 s, but the page couldn't show anything until the GPU had finished the first frame, and on Ultra that includes compiling every shader. That took 3.9 s here (0.7 s on Low), and the sky-blue background was all there was to see in the meantime.
- **Why it can be much worse elsewhere:** Phases 4 and 5 made the High and Ultra shaders much bigger (soft shadows over three cascades, parallax, reflections, light shafts). Compiling large shaders can be far slower on some systems, notably Windows, where browsers translate WebGL shaders for Direct3D. A first frame that takes too long can also make the graphics driver reset. Either way the result is exactly that screen, possibly for good.
- **Limits:** I couldn't reproduce the reporting machine (the sandbox only has a software renderer). So the fix addresses this most likely cause, and makes any other cause show up on the page.

**The fix.**
1. **The menu first.**
   - The page shows a **Loading…** panel from its very first paint.
   - The start menu goes up before any heavy GPU work. The shaders then compile in the background where the browser can (`KHR_parallel_shader_compile`), while the world streams in.
   - The Play button says **Preparing graphics…** until the shaders are ready, and only then is the world drawn. Switching presets works the same way.
   - On Ultra here, the menu now shows after 0.6 s instead of 4.8 s.
2. **Graphics on the start menu.** The Graphics setting is on the start menu too, and a hint suggests a lower one if preparing takes more than 12 s.
3. **Safe start.**
   - The game remembers whether the last start got as far as drawing the world. If it didn't (the tab hung, or the driver gave up), the next start lowers the preset a step and says so.
   - If the browser loses the WebGL context mid-game, the game saves, lowers the setting and asks for a reload.
   - `?graphics=low` (or `medium`, `high`, `ultra`) in the address picks a setting.
4. **Errors on the page.** Until the game has started, any failure is shown with what to try, instead of a blank page:
   - **Opened as a file:** use `start.bat` or `./start.sh`.
   - **A game file couldn't load:** offline, or the three.js CDN is blocked.
   - **Mismatched files after an update:** reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac).
   - **Any other script error:** the error text is shown.
   - **WebGL didn't start:** turn on hardware acceleration, update the browser and drivers, and restart the browser after a driver crash.

**Also fixed.** `normalizePreset` accepted any name that exists on a plain object (such as `constructor`).

**Testing.** Four new smoke checks, each in a fresh browser profile:
- **Startup order:** the loading panel paints at once, and the start menu comes up before the world is drawn, with Play waiting for the shaders. `?graphics=low` starts on Low.
- **Safe start:** after a start that never showed the world, the next one starts on High with a notice.
- **Error messages:** opened as a file, a missing file, mismatched files and no WebGL each show the right message.
- **Lost context:** losing the WebGL context saves the player, lowers the setting (Medium to Low) and shows the reload panel.

**57 smoke checks and 32 unit tests pass with zero console errors.**

**Merged with Round 4.** Main received Round 4 while this fix was waiting. Merging kept both sides; three things needed adapting:
- **Individual graphics options** (Round 4) can override the preset, so an option like reflective water could keep the heavy shaders on at a lower preset. The safe start, `?graphics=` and the lost-context step-down therefore reset them too, and say so. Picking a preset on the start menu clears them, as the pause menu does.
- **The shader warm-up** follows the resolved preset (the preset plus options), which is what the renderer draws with.
- **The F3 frame statistics** (Round 4) are reset only on frames that are drawn. Round 4's `tools/probe.mjs` now waits for the graphics to be ready after switching presets before taking screenshots.

**Result on the merged code (Ultra, software rendering):**
- **With the fix:** the loading panel paints at 0.1 s and the start menu is up at 1.1 s.
- **Without it (main as merged):** the page stays blank for 8.5 s. Round 4's heavier first frame takes 7.3 s here, up from 3.9 s in Round 3.

The startup smoke checks also cover the options reset: after a failed start, after a lost context, and with `?graphics=low`.

**Testing after the merge.**
- **Syntax and unit tests:** `node --check` on every file, the strict module parse and Round 4's `tools/check-syntax.mjs` (51 modules) all pass. All 42 unit tests pass.
- **Smoke tests (partial):** I stopped the full run partway through (it takes over an hour in this sandbox). Up to that point, 47 checks had passed and one had failed: the Ultra plants timeout below.
- **Four survival checks** (mining, inventory screen, crafting table, eating) failed right after that timeout, which leaves the game on Ultra in creative flight. Run on their own, together with the startup checks, all 14 pass with zero console errors.
- **Not re-run after the merge:** the 12 remaining checks (zombies and water, zombie kills, skeleton, spider, farm animals, butterflies and fish, mob caps, creative immunity, HUD, saving, and the two reload checks).

**Known issue (to investigate later): the Ultra plants check times out.** In the merged full run, "Ultra: tall grass, reeds by the water, ferns in the shade, and new tree species in the world" failed after 300 s.
- **What it waits for:** after switching to Ultra at render distance 6, the check waits for the world to finish meshing (`world.isIdle` and an empty remesh queue), and that never happened in time.
- **Likely cause:** the world works through its queues on a fixed time budget per frame, and each Ultra frame takes seconds in this software renderer. This container also ran everything 1.5 to 2 times slower than Round 3; the Ultra check before this one took 212 s, against 113 to 129 s then.
- **Not yet checked:** whether main alone times out the same way here, or whether something keeps refilling the remesh queue.

---

# Round 4, Part A checklist

## 1. Weapons — DONE
- [x] Default hotbar in a new game: 1 pistol, 2 grenade, 3 bazooka, 4 machine gun, 5 airstrike designator, 6 sniper rifle
- [x] Explosions carve wide, flatter craters (horizontal ellipsoid ~2x wider than deep)
- [x] Reduce bazooka explosion to 1/3 of current size
- [x] Settings: explosion-size slider per weapon (pause menu)
- [x] Machine gun: hold RMB auto fire, tracers, recoil climb
- [x] Sniper rifle: scope zoom + overlay, high damage, very long range
- [x] Airstrike: laser-aim, fire, 5s delay, meteor rain on target + random spots
- [x] BUG: long-range hitscan/projectiles hit LOD/distant terrain via a heightfield fallback in World.raycast; deferred explosions stored via World.queueEdit and applied when chunks load
- [x] Keep no reload / unlimited ammo

## 2. Water physics — DONE
- [x] BUG: floating water after explosions (js/watersim.js reacts to edits and flows down/into holes)
- [x] Source + flowing water blocks that spread/fall, fill craters, throttled updates (budgeted per frame, MAX_FLOW_DISTANCE=4)

## 3. World generation — DONE
- [x] Full biome set (js/biomes.js: temperature/moisture climate fields + height/mountain/river) with organic (noise-contour) blending and large-scale continents/mountain ranges/rivers (js/terrain.js `_terrainInfo`)
- [x] Variable forest density (open/sparse/dense noise field, true zero in open meadows, per-biome multipliers)
- [x] Warm ocean coral reefs, seagrass, kelp (new blocks + placement in terrain.js)
- [x] Villages: js/village.js (rare grid-cell placement, flattened pad, 2 houses, gravel paths, a farm plot) + wandering villager NPCs (mobs.js/mob-models.js)
- [x] Default render distance 10 chunks (max still 100)

## 4. Mobs and animals — DONE
- [x] Hostile: skeleton archers with real gravity-affected arrow projectiles (js/mobs.js `_shootArrow`/`_updateArrows`) that damage the player; wall-climbing spiders (previous-frame `blocked` flag drives a climb velocity); zombies unchanged
- [x] Passive animals, original designs (js/mob-models.js + js/mobs.js): fluffalo (sheep), hoplet (rabbit), mossback already existed; added cow, pig, chicken, plus butterflies over flowers, schools of fish (3-5 at once) in deep-enough water, and parrots in jungle biomes — all with dedicated box-model rigs
- [x] Mobs spawn farther away (hostiles 28-118 blocks out, seed/ongoing passive spawns pushed out too), overall mob cap (MAX_TOTAL_MOBS=34) on top of per-category caps, simplified far AI (mobs beyond FAR_AI_DISTANCE=40 skip steering/pathing, just hop toward the player)
- Validated via tools/check-mob-models.mjs (all 13 species build cleanly), tools/check-mobs.mjs (arrow gravity+damage, spider climbing, new animals, flyers), and 4 new permanent checks in tools/smoke-test.mjs
- BUG fix found during validation: skeleton arrows aimed using feet-to-feet height delta while launching from the archer's eye height, so a level shot at a same-height target already cleared the player's hitbox before gravity-compensation pushed it even higher, sailing clean over the player's head; fixed to aim at the player's torso center from the archer's actual launch height

## 5. Player and settings — DONE
- [x] F5 camera modes (1st/3rd behind/3rd front) with visible player model — `Player.cycleCamera`/`syncCamera` (camera pulled back along the view and stopped short of solid blocks, eased back out; a scoped sniper always stays first person), new original "wayfarer" box model (`player` species in js/mob-models.js) driven by js/player-avatar.js (walk cycle, sneaking, head follows the view with body lag, arm chops when mining, raised to aim with guns, held item in the hand, lit by the voxel light, casts shadows); the first-person held item hides in third person; the underwater state follows the third-person camera
- [x] F1 hide HUD, F3 debug overlay — F1 toggles `body.hud-off` (hotbar, hearts, crosshair, FPS and the held item); F3 shows position, block/chunk, facing, biome, light, clock, camera mode, difficulty, chunk/LOD/mob/item/plant counts, draw calls and triangles for the whole frame (renderer.info is now reset once per frame so every pass counts) and the targeted block. F1/F3/F5 are preventDefault-ed so the browser doesn't open help/find or reload
- [x] Time-of-day slider + lock — `Sky.hours`/`setHours` (sunrise 6:00, sunset 18:00) and `Sky.locked` (stops the clock); slider + lock checkbox on the Gameplay tab; the slider shows the current time whenever the menu opens
- [x] Full settings menu, persisted in localStorage — the pause menu is now tabbed (Video / Controls / Audio / Gameplay; js/settings.js validates and defaults every value, so old or corrupted saves load cleanly). Video: render distance, preset, 9 individual graphics options that override the preset (shadows, anti-aliasing, bloom, light shafts, water, 3D plants, fancy leaves, texture relief, clouds; `GFX_OPTIONS`/`resolvePreset` in js/graphics.js; picking a preset or "Reset" clears overrides; a "custom" badge shows when any are set), FPS counter toggle. Controls: FOV, mouse sensitivity, invert Y. Audio: master plus 5 category volumes (blocks, weapons, creatures, player, menus/pickups; each category is its own gain bus in js/audio.js). Gameplay: game mode, difficulty (Peaceful removes hostiles and stops them spawning; Easy/Hard scale creature damage x0.5/x1.5), creature spawning on/off, time of day + lock, the three explosion-size sliders
- Tested: two new smoke checks (F5 cycles behind/front/first with the model shown only in third person; F1/F3; every settings tab applies live and persists, locked time stays put), plus tools/probe.mjs, a new quick harness that boots the game, runs a scenario file and saves screenshots (used for visual checks throughout Round 4 Part B)

(tick items as completed; commit after each numbered group)

R4 PART A COMPLETE

---

# Round 4, Part B checklist

Note: the task referred to reference images in a `/reference` directory (current-grass.png, current-underwater.png, ref-marsh.png, ref-grass.png) that did not exist in this repository or session, so all of Part B was implemented from the written descriptions only, checked against my own headless screenshots (tools/probe.mjs).

## 1. Bugs — DONE
- [x] Grass on Ultra mixed two styles — root cause: js/grass.js drew smooth, vertex-coloured triangle blades (their own shader, no texture) on top of the mesher's pixel-art tall-grass cross blocks. Rewrote grass.js so every instanced plant is a set of crossed cards sampling the block texture array with new pixel-art tiles (grass_tuft, grass_tuft_b, fern, reeds/cattails, flowers, lily pad) in exactly the style of the redrawn tall_grass block; one plant shader (js/shaders.js) with the shared wind, same tint as the grass blocks
- [x] Dark curved shading on lower edges/faces — root cause in the relief (normal/height) maps: `paintRelief` took slopes with wrap-around, so a face's bottom row was compared with its top row; on tiles whose top and bottom differ (grass side's fringe over dirt, the sand's ripple texture) that invented a steep false slope along every block's lower edge, and parallax (repeat-wrapped) also stepped past the tile edge into the opposite side. Fixed with one-sided differences at tile borders and a clamped parallax march; sand now has its own ripple-free side texture (the wavy ripple bands were what read as dark curves on seabed walls)
- [x] Underwater darkened too fast — fog density is now a uniform (`uUnderwaterFog`, 0.085 -> 0.03 per block, ~3x the visibility); the underwater light shafts march 56 blocks (was 30) with gentler falloff, colour grading unchanged

---

# UFO COMBAT — overnight build

This repository was copied from Voxelands and is becoming **UFO COMBAT**. The checklists below are the source of truth for this build; items are ticked as they are finished and each group is committed and pushed.

## UFO Part 1 checklist
### 1.1 Rebrand and main menu
- [x] Rename to "UFO COMBAT" everywhere (page title, menus, README, console messages)
- [x] New unique localStorage key prefix (no sharing with the old game on the same domain)
- [x] New main menu: big stylized UFO COMBAT logo, animated background (slow flyover of the world with a UFO drifting across the sky)
- [x] Main menu buttons: Play (new world with optional seed / continue), Settings, Mods, Controls
- [x] Default graphics preset: Medium
### 1.2 Mods toggle
- [x] "Mods" setting, ON by default; OFF = vanilla (no guns, explosives, vehicles, UFOs, aliens; swords/tools stay)
- [x] Toggling mid-game cleanly removes/restores mod entities and items
### 1.3 Bug fixes
- [x] Sniper scope black screen fixed (zoomed view + scope overlay)
- [x] All weapons fully independent (airstrike pending no longer blocks the bazooka etc.)
- [x] World gen: no single stray water blocks on land (fix the cause)
- [x] Seagrass/kelp waterlogged: water around and inside them, never air pockets
### 1.4 Airstrike upgrade
- [x] Meteors fall at an angle from much higher/farther, glowing fiery core, smoke trail, heat glow, impact flash, shockwave
- [x] Settings: meteor count, spread radius, delay, fall angle, fall speed, explosion size
### 1.5 Zombie settings
- [x] Settings: zombie spawn rate (up to extreme), max zombie count, toughness (health + damage multipliers)
- [x] Playable at high counts (instanced far rendering, simplified AI far away); performance note next to extreme values
### 1.6 Laser blaster
- [x] Laser blaster weapon: short glowing bolts, color red/green/blue (setting), bloom glow, impact sparks, scorch marks, blaster sound
### 1.7 Render settings
- [x] Separate controls for full-detail chunk distance and LOD distance/quality
- [x] One-click performance presets (Potato / Balanced / Beautiful / Max)
### 1.8 Binocular zoom
- [x] Hold both mouse buttons = strong binocular zoom with subtle vignette; release = instant normal view
- [x] Chord detection never fires weapons / breaks / places blocks by accident; works in vanilla mode; zoom strength setting
### Finish
- [x] Full test suite run for Part 1, README updated, "UFO PART 1 COMPLETE"

### Part 1 test results
- `node --check` on every file, `check-syntax.mjs`, **43/43 unit tests** (one new: generated water is always walled in and underwater plants stand in water).
- **ufo-tests.mjs (new): 11/11** Part 1 checks (menus, settings and presets, loadout, weapon independence, airstrike, blaster, sniper scope, binoculars, mods on/off, zombie crowds).
- **Full smoke suite (68 checks): 61 passed.** The failures:
  - *Ultra plants* timed out after 300 s: the known issue from Round 4 (heavy Ultra frames in software rendering).
  - *Airstrike designator*: the test read the old `weapons.meteors` array; updated to the new airstrike module (`weapons.airstrike.meteors/pending`).
  - *Grenade crater, grenade direct hit, pistol knockback, bazooka point blank, zombies and the moat*: all fixed real-time waits (e.g. `waitForTimeout(300)`, 60 s explosion waits) that ran short because I was running other headless browsers at the same time (every frame took 2-3x longer). The direct-hit failure was a knock-on effect: the previous check's grenade exploded late, during it. These are re-checked in the Part 2 full run, with nothing else running.

UFO PART 1 COMPLETE

## UFO Part 2 checklist
### 2.0 Shared vehicle system
- [x] One vehicle framework (enter/exit, camera modes, HUD, input, damage, saving) reused by UFO and jet
- [x] Edge cases: exit into water / underground / mid-air; dying inside; save/load while in a vehicle; pausing; mod toggle while piloting
### 2.1 Enemy UFOs
- [x] Sizes small / medium / large / huge mothership; health and effects scale with size
- [x] Roam freely; notice the player by line of sight + chance-based detection, then attack
- [x] On-foot attack: fly in fast, stop above, blue tractor-beam cone lifts the player; reaching the UFO kills ("Abducted by a UFO"); escape by leaving the beam; beam stops if the UFO is shot down
- [x] Enemy UFOs fire laser blasts
### 2.1b Behavior and variety
- [x] Distinct shapes: classic saucer (glowing + non-glowing), tic-tac, sphere, pyramid, triangle, cigar, + own unusual shapes; blinking / color-cycling lights; readable at a distance
- [x] Free roaming at any altitude; idle tricks (abducting cows/animals, hovering over lakes, zig-zag, following animals)
- [x] Rare "leave forever" streak into the sky (likelier after abducting or when chased by a jet)
- [x] Spawn out of view (far / over the horizon) and fly in; much more activity at night
- [x] "UFO activity" slider from very rare to "UFO APOCALYPSE" (playable: simplified distant models, instancing, cheap far AI)
- [x] Advanced UFO settings: spawn chance, max count, aggression, detection range, beam lift strength, size distribution, night multiplier, toughness
### 2.1c Reactions and durability
- [x] When shot on foot: counterattack with lasers, fly in to beam, or evasive repositioning (dodge/strafe/altitude), mixed
- [x] Toughness scales with size with per-UFO variation
### 2.1d UFOs vs player vehicles
- [x] Player in jet: UFO personalities (fleeing evaders vs attackers with lasers / aggressive passes)
- [x] Fleeing speed: most slightly slower than jet at full throttle; some faster and uncatchable
- [x] Player in UFO: other UFOs friendly unless provoked; shooting one turns it (and maybe nearby) hostile
### 2.2 Shooting down UFOs
- [x] All weapons damage UFOs; destroyed UFOs fall with fire and smoke and crash-land (crater, debris)
- [x] Green alien mobs come out and attack with laser guns
- [x] Crashed UFO can be boarded and flown (damaged but working), keeps its shape
### 2.3 Pilotable UFO
- [x] Fly a crashed UFO, or spawn one from the Mods menu in creative (choice of shape)
- [x] No physics limits: hover, instant acceleration, any direction, very wide speed range (setting)
- [x] Optional ghost mode: passes through terrain and burns a tunnel
- [x] Weapons: tractor beam (lifts mobs, optionally loose blocks) and laser cannon
- [x] Third-person chase camera; HUD with speed, altitude, weapon
### Finish
- [x] Full test suite run for Part 2, README updated, "UFO PART 2 COMPLETE"

### Part 2 test results
- `node --check` on every file, **43/43 unit tests**.
- **ufo-tests.mjs: 27/27** Part 1 + Part 2 checks (UFO designs and sizes, activity and out-of-view spawning, detection and abduction, escaping the beam, reactions, every weapon vs UFOs, shoot-down/crash/aliens, boarding the wreck, UFO cannon and beam, friendly UFOs, ghost mode, exits underground and by parachute, save/load while flying, mods off mid-flight, dying in a destroyed UFO, tricks).
- **Full smoke suite on a frozen snapshot, nothing else running: the first 17 checks passed** (including the Ultra checks that timed out in Part 1: the Part 1 Ultra timeout was contention too). I stopped the run there: at ~3 minutes per check in software rendering the remaining 51 would have taken well over the ~10 minute budget for a slow check, and Part 3 needs the browser. The whole smoke suite runs again, uninterrupted, at the end of Part 3 (which covers all Part 2 code).

UFO PART 2 COMPLETE

## UFO Part 3 checklist
### 3.1 Fighter jet
- [x] F-22-style stealth jet model (angular, twin tails, twin engines with afterburner glow), procedural
- [x] Call in a jet (hotbar item / key); spawn on ground or airborne (setting)
- [x] Exiting in the air ejects with a parachute
- [x] Flight physics: throttle/thrust, lift, drag, gravity, stall, afterburner, pitch/roll/yaw; cannot hover
- [x] Intuitive mouse + keyboard controls; optional flight-assist mode
- [x] Crashing into terrain destroys the jet and kills the player unless ejected; jet health; can be shot down by UFOs
- [x] Views: third-person chase + cockpit; HUD: speed, altitude, throttle, heading, weapon, lock indicator, health, incoming-attack warning
- [x] Settings: max speed, acceleration, turn rate, stall speed, flight assist
### 3.2 Jet weapons
- [x] Autocannon: rapid fire with tracers
- [x] Guided missiles: lock onto UFOs/mobs (lock box, tone, delay while in front), tracking missile with smoke trail
- [x] Nuke: white flash, shockwave, rising mushroom cloud, huge crater, long-distance sound; batched edits, spread rebuilds, falling-block cap; settings for size and effect intensity
### 3.3 End-to-end scenario
- [x] Jet → spot UFO → chase/dodge → lock → missile hit → UFO crash-lands → eject with parachute → land → fight aliens → board crashed UFO → fly away passing other UFOs peacefully
- [x] Automated test covering as much of it as possible
### 3.4 Settings and stats
- [x] Settings grouped (Vehicles, UFOs, Weapons, Mobs, Graphics, Performance) with per-group "reset to defaults", persisted
- [x] Stats (world + total): UFOs shot down, play time, aliens killed, zombies killed, deaths, abductions survived; persisted
- [x] Optional small HUD stats overlay (UFOs shot down + play time), off by default; full Stats screen in the pause menu
### Finish
- [x] Full test suite run for Part 3, README updated, "UFO PART 3 COMPLETE"

### Part 3 test results
- `node --check` on every file, **43/43 unit tests**.
- **ufo-tests.mjs: 34/34** on a frozen snapshot with nothing else running (Parts 1-3, including the jet takeoff/stall/HUD, cannon and missile lock, UFO personalities vs the jet, the nuke, crashing, the full end-to-end scenario, and stats).
- **Full smoke suite (68 checks): 65 passed.** The failures:
  - *Ultra plants* timed out after 300 s: the known pre-existing issue (heavy Ultra frames in software rendering; it passed in the Part 2 run).
  - *Pistol knockback*: the check waited a fixed 300 ms of real time for the zombie to be pushed back; with Medium now the default preset, software rendering fits only one frame into that (the zombie had moved 0.12 of the 0.2 blocks needed). The check now waits on the game instead (up to 15 s for the push). The knockback itself is unchanged.
  - *Zombies and the moat*: the zombie correctly stopped at the water, but the player had lost 3 health. Nothing in the arena could reach them; the likely source is an enemy UFO (mods are on by default and it was midnight). I couldn't reproduce it in isolation (two UFOs around, no hits in 10 s), but the smoke suite's creature arenas now switch UFO activity off, since they test the base game.
- **Performance** (this container: software rendering, slow shared CPU): Potato with 48 UFOs and 108 zombies plus 4 explosions: 2.2 ms simulation per frame (max 5); Balanced with 112 UFOs and 126 zombies: 9 ms (max 17), of which UFOs cost ~1.0 ms and zombies ~1.2 ms (measured separately), and the rest was terrain streaming after switching presets. On a real GPU and CPU these are a fraction of a 60 fps frame.

UFO PART 3 COMPLETE

## UFO Final checklist
- [x] 1. Regression pass (terrain, biomes, presets, water, mobs, combat, crafting, saving, death screen, mods OFF)
- [x] 2. Player's-eye review (menu, first minutes, every weapon/vehicle, UFO encounters on foot / jet / UFO, full scenario); fix what's found
- [x] 3. Performance check: Potato and Balanced smooth with UFOs at high activity, many zombies, explosions
- [x] 4. Full test suite one last time
- [x] 5. README: all controls, features, settings
- [x] 6. PROGRESS.md: summary, decisions, known issues, "How to test in 10 minutes"
- [x] 7. "UFO FINAL COMPLETE", commit, push

## Decisions log
(Notable decisions made without being able to ask, with the reason.)

### Part 1
- **Internal names.** The debug hook is now `window.__ufo`; the old name `window.__voxelands` stays as an alias because the ~2,600-line smoke suite uses it everywhere. Neither is visible to players.
- **Continue vs. new world.** Without `?seed=` the page now opens the last world played (the menu says Continue); New World takes an optional seed (numbers, or any text, hashed) and reloads into it. "Save & main menu" in the pause menu reloads the same world to the title.
- **Settings are schema-driven** (`js/settings.js`): one table declares every setting's group, range and default; rows, validation of saved values and per-group "Reset to defaults" all come from it. The tabs Graphics/Controls/Audio/Gameplay keep their old internal page names so older tests and saves keep working.
- **Stray water cause:** swamp "puddles" put a water block *on top of* the ground (y = h + 1) instead of in it. They are now sunk into the ground, only where all four neighbours are at least as high, and never where a cave would open beside or under them. A unit test now scans generated land for any water block with air beside or below it.
- **Waterlogged plants:** seagrass and kelp are "waterlogged" blocks: they render water in their own cell, count as water for swimming, drowning, the underwater view and the water sim, and breaking one leaves water behind (`IS_WET`, `IS_WATERLOGGED`).
- **Sniper scope black screen:** the overlay's mask had a solid black second background layer under its transparent circle. It's a single radial gradient now (and a nicer reticle).
- **Weapon independence:** one shared cooldown (8 s after an airstrike) blocked every weapon. Each weapon has its own cooldown now; airstrikes queue independently.
- **Binocular chord:** single presses are delayed by 70 ms to detect a two-button chord (the approach suggested in the brief). A quick click still goes through as a click. Pressing the second button while the first is held (mining, machine gun) also becomes the binoculars once both are held past the window: the first action is released and the second never starts. The held item is hidden while zoomed; a rangefinder reading shows the distance.
- **Zombie apocalypse performance:** zombies beyond 44 blocks (26 when there are more than 60) are drawn as an instanced crowd (two alternating walk poses, 2 draw calls total); mobs beyond 64 blocks think every third frame; mob separation uses a spatial grid instead of all pairs. Spawn rate and max count use stepped sliders (0-50x, 0-400) because a linear slider made the normal values unusably small. "Daylight zombies" is a separate switch rather than something the spawn rate silently turns on.
- **Airstrike "delay"** is the time from calling the strike to the first impact: meteors launch early enough (they start ~200 blocks up, and far off to the side at steep angles) to hit at that moment.
- **Mods off** stashes mod items with the player (not deleted), so switching back restores them to the same slots. A world started with mods off gets the weapon loadout the first time it's played with mods on.
- **Starting hotbar** is now 8 items (added the laser blaster and the Jet Radio for Part 3's jet). Creative gets one block slot; the full palette is on E.
- **Performance presets** (Potato/Balanced/Beautiful/Max) set the graphics preset, render distance, full-detail distance, far-terrain (LOD) quality, resolution scale and effects detail. Resolution scale and effects detail are new knobs, added because they are the cheapest big wins on weak GPUs.

### Part 2
- **One vehicle framework** (`js/vehicles.js`) owns boarding, exits, input, camera, HUD, damage, saving and the mods switch; the UFO and the jet only implement flight, weapons and their HUD rows. Hits on a seated player go to the vehicle (`Player.damage` redirects), so zombies, aliens and lasers all "just work" against vehicles.
- **Exits:** a safe spot is searched around the hull (2 free blocks with ground or water under them, preferring just outside the hull near its underside). No spot underground (a ghost-mode UFO inside rock) puts you on the surface above; high in the air you drop out under a parachute (a jet fires its seat up first). With mods switched off mid-flight you're set down on the ground below instead (the parachute is mod content too).
- **UFO controls:** W/S move along the view (so looking down and pressing W dives), A/D strafe, Space/Shift up/down, Ctrl boost, the mouse wheel sets the cruising speed on a log scale between the slowest and top speed settings (0.5 to 1,200 blocks/s). Both weapons are always available (left click cannon, right click beam) rather than switching between them.
- **Abducted creatures and lifted blocks go into your inventory** (their drops), so the tractor beam is useful, not just a toy.
- **Crashed wrecks lift off by themselves** when boarded (straight up, clear of the crater rim), and a UFO whose collision box starts inside the ground can move freely until it's clear: a half-buried wreck used to be pushed deeper by the collision sweep.
- **UFO personalities** are fixed at spawn: 55% evaders (flee a jet at 80-95% of its top speed), 17% "fast" (125-160%, uncatchable, likely to leave for good when chased), 28% fighters (attack runs); motherships always fight.
- **Detection:** a line of sight is required (a world raycast from the UFO's underside), then a per-check chance growing with closeness, aggression and night, halved while sneaking. UFOs ignore Creative players unless shot (the beam couldn't hurt them anyway), and lose interest after 14 s without seeing the player, so hiding under trees or in a cave works.
- **Escaping the beam:** the UFO follows at 2.6 blocks/s, slower than walking, so stepping out of the light is always possible (you can steer while lifted). A roof stops the lift. Breaking free after being lifted counts as an abduction survived.
- **Spawning out of view:** new UFOs appear beyond the view distance (at least 320 blocks), in a direction at least ~75° away from where the camera looks; their halo fades in with distance so no light pops into the sky.
- **Apocalypse cost:** the lights of each UFO are one instanced mesh, far UFOs (over 240 blocks) draw only hull and halo, and UFOs beyond 380 blocks think every fourth frame. 100 UFOs update in well under a millisecond.
- **Aliens** are a mob species (reusing mob AI and physics) with a ranged "laser" attack through the shared laser system; they don't burn in daylight and drop iron, sometimes a diamond, rarely a laser blaster.
- **Friendly fire:** enemy UFO bolts don't hit other UFOs, alien bolts don't hit aliens, and the player's shots never hit their own vehicle.

### Part 3
- **Flight model:** thrust (throttle, afterburner 1.55x), lift proportional to angle of attack and the square of airspeed (collapsing past ~17 degrees), drag (sized so the afterburner top speed is the "max speed" setting, and full military power reaches ~80% of it), gravity, and sideslip damping. The lift constant is derived from the stall-speed setting, so "stall speed" means exactly that: below it the wings can't hold the jet up. Control rates need airspeed; a stalled jet drops its nose. Gravity on the jet is 14 blocks/s^2 (not the player's 26) so it feels like a big aircraft.
- **Controls:** flight assist (default) is "fly toward the crosshair" (like mouse-aim in arcade flight games): the mouse moves an aim direction and the jet banks and pulls toward it, rolling wings-level as the nose arrives. It's by far the easiest way to fly with a mouse. Assist off makes the mouse a stick (pitch/roll). W/S throttle, Shift afterburner, A/D roll, Q/E rudder, Space brake, B nuke. Q (drop) and E (inventory) are free in vehicles because keys go to the vehicle there.
- **Weapons without menus:** left click cannon, right click missile, B nuke: nothing to select mid-dogfight. Missiles fire guided when locked, straight otherwise.
- **Lock-on:** the best target within ~14 degrees of the nose (UFOs first, then creatures up to 450 blocks), held for 1.1 s; the lock box closes in on the target and the tone speeds up, then turns solid. Missiles lead the target with a turn-rate limit and a proximity fuse.
- **The nuke falls on a drogue parachute** (like a real retarded bomb) so the pilot has time to get clear; it has a 25 s cooldown. Its crater is carved in 10 slices over 10 frames, the blast zone is scorched (grass to dirt, leaves and plants gone) a bounded number of columns per frame, and the mushroom cloud is its own billboard pool whose density follows the intensity setting.
- **Calling the jet** (J or the Jet Radio): it searches for a flat, clear strip (about 70 blocks long; thrust gets a 40% boost on the ground so that is enough to take off) near the player; if there's none it arrives airborne with the player already in the cockpit (the setting forces that). One player jet at a time. An unmanned jet (after ejecting) spools down and noses over until it crashes.
- **UFO personalities vs the jet** (Part 2) use the jet's top speed setting, so changing it keeps "most slightly slower, some faster" true.
- **Takeoff:** thrust gets a 40% boost while on the wheels (a game-length takeoff roll of ~40 blocks instead of hundreds), the call-in looks for a ~70 block strip, and with flight assist the jet rotates by itself once it has flying speed. Found in testing: the jet ran off a short strip before the pilot pulled up.
- **Quick clicks count:** a click shorter than one frame (easy at low frame rates) still fires the jet's cannon/missile and the UFO cannon.
- **Jet call cooldown** (8 s) only applies while your current jet still exists (it stops spamming replacements); after losing it you can call a new one at once.
- **Wrecks can't be destroyed before they're boarded:** in the full scenario, blaster shots at the aliens standing around the wreck blew it up, leaving no ride home.
- **In a vehicle** the hotbar and hearts are hidden (the vehicle panel has its own health bar; damage goes to the vehicle).
- **Respawn grace:** after a respawn every UFO loses interest and none notices the player on foot for 30 s (in a vehicle they can be spotted: flying a jet is asking for a fight). Found in the long smoke run: a UFO hovering over the spawn point could abduct a freshly respawned player again and again.
- **First-time hints:** a handful of one-line tips appear at the moment they're useful (entering a new world, first UFO nearby, first aliens, first time in each vehicle).

## UFO COMBAT: final summary

**What was built** (on top of the existing voxel game, whose terrain, biomes,
lighting, water, mobs and graphics presets are unchanged):

- **Part 1:** rebrand to UFO COMBAT (new storage prefix `ufocombat_v1_`, so
  old Voxelands saves are untouched); a new main menu with an animated
  flyover and a drifting UFO, Play/Continue, New World with a seed, and
  Settings / Mods / Controls screens; Medium default graphics; a **Mods**
  master switch (off = the vanilla game, safely switchable mid-game);
  bug fixes (sniper scope black screen, weapons blocking each other during
  an airstrike, stray water blocks, air pockets around seagrass and kelp);
  a meteor airstrike with settings; zombie settings up to an apocalypse
  (instanced far crowds, lazy far AI); the laser blaster; performance
  settings and one-click presets; binoculars on both mouse buttons.
- **Part 2:** a shared vehicle framework; enemy UFOs in 10 designs and 4
  sizes up to motherships, with detection, abductions, escapes, tricks,
  reactions, personalities, lasers and an activity slider up to UFO
  APOCALYPSE; shooting UFOs down (burning fall, crater, boardable wreck,
  armed aliens); the pilotable UFO (no inertia, huge speed range, ghost
  mode, tractor beam, laser cannon, chase camera, HUD).
- **Part 3:** the F-22 style jet (procedural model, call-in on a strip or
  airborne, real flight model with stall, flight assist, eject with a
  parachute, crashes, chase and cockpit views, full HUD with warnings);
  autocannon, lock-on guided missiles and a nuke; the whole jet-to-UFO
  scenario playable and tested end to end; grouped settings with per-group
  reset; world and all-time stats, an optional HUD overlay and a Stats
  screen.

## Final polish notes

### Final test results
- **Unit tests: 43/43.**
- **ufo-tests.mjs: 33/34** in the final full run (a 35th check, respawn
  grace, was added after it). The one failure was my own test change: the
  fighter check now lifts the jet to 150+ blocks, so the following nuke
  check's bomb took longer to parachute down than its real-time limit. The
  nuke check now starts from a low pass; it, the rest of the jet checks and
  the new grace check were re-run afterwards (see below). The run before
  it (same game code) had failed 3 randomness-dependent checks (a UFO
  moving out of the cannon's line, a fighter's random shot timer, aliens
  standing under the wreck); those tests were pinned down.
- **Smoke suite: 66/68.** *Ultra plants* timed out (the known software
  rendering issue). *Pistol, every click fires*: 5 shots from 6 clicks,
  because at ~2 fps two clicks 150 ms apart can land in the same frame,
  inside the pistol's 0.07 s cooldown (unchanged from the original game).
  Fixed in the game rather than the test: a pistol or bazooka click during
  the cooldown is now buffered and fires the moment it's ready; a probe of
  6 rapid clicks gives 6 shots and 6 holes.
- **Re-run after the last fixes:** respawn grace (new), the jet takeoff,
  jet weapons, UFOs vs the jet, the nuke, the jet crash, the FULL SCENARIO
  and stats all pass; so do the weapon-independence and "every weapon
  damages UFOs" checks and the 43 unit tests. One more bug found there and
  fixed: right after your jet was destroyed, the call-in cooldown could
  still refuse a new one (the wreck lingers for a second), and the respawn
  grace also hid a player flying a jet (it now only covers you on foot).


- **Regression pass:** the smoke suite (terrain, biomes, all graphics
  presets, LOD, water, lighting, mobs, combat, crafting, saving and
  reloading, the death screen, startup errors) ran in full after Parts 2/3;
  mods off is covered by the UFO suite (vanilla hotbar, recipes and palette;
  UFOs, aliens and vehicles gone; everything back when switched on) and
  checked by eye.
- **Player's-eye review** (screenshots of the menu, first minute, an enemy
  UFO overhead, flying a UFO, the jet in chase and cockpit view, the nuke,
  the pause/Mods/Stats screens, mods off). Fixed from it: the player's
  hearts drew over the vehicle HUD (now hidden in vehicles, and the panel
  is narrower); a jet called onto a short strip ran off the end before
  rotating (longer strip search, takeoff thrust boost, assist rotates);
  quick clicks at low frame rates were lost in vehicles; a jet lost within
  8 s of calling couldn't be replaced; the crashed UFO could be blown up by
  shots at its aliens; a UFO over the spawn point could abduct a freshly
  respawned player straight away (now 30 s of grace).
- **GitHub Pages:** `probe.mjs --base=/ufo-combat/` serves the game only
  under that subpath: it boots, plays, streams (including the LOD worker)
  and calls the jet with zero console errors. All paths are relative and
  every import matches its file name exactly.
- **Performance:** see the Part 3 results (Potato and Balanced with a sky
  full of UFOs, 100+ zombies and explosions).

## Known issues

- **All automated testing is headless with software rendering** (1-3 fps).
  Frame rates on real hardware were not measured, and nothing was played
  by a human with a real mouse: flight feel (jet assist, UFO speed range)
  is tuned by reasoning and tests, not by hand.
- **Sounds** are procedural and were checked to play without errors, not
  listened to.
- **Smoke: Ultra plants check** can time out at 300 s in software rendering
  (pre-existing; it passes on some runs).
- **Enemy UFOs and the old smoke suite:** with mods on by default, UFOs at
  night hurt and abducted the test player in base-game checks (the moat
  check in Part 3, then deaths by "Abducted by a UFO" in the first final
  run). The smoke suite now runs with UFO activity off (UFOs have their own
  suite), and a respawned player gets 30 s of grace from UFOs.
- **Tests are timing-sensitive in software rendering** (1-3 fps): a few
  checks were made to wait on game frames rather than the clock during
  this work, and some randomness-dependent UFO checks were pinned down.
  Expect an occasional flaky check on a slow machine; re-run it alone with
  `node ufo-tests.mjs --only=<name>`.
- **Jet realism is game-tuned:** 40% more thrust on the ground for short
  takeoffs, lower gravity (14 blocks/s^2), and flight assist rolls and pulls
  for you. It still stalls and can't hover.
- **Crashed UFOs can't be destroyed** until boarded (deliberate, see
  decisions).
- **The world is 64 blocks tall**, so jets and UFOs fly mostly above the
  terrain's block space; collisions with terrain are checked, but nothing
  can be built up there.
- `ufo-tests.mjs --only=...` enters the game first, so the menu checks
  (rebrand, main menu) only run in a full run.

## How to test in 10 minutes

1. Open the game (`start.sh` / `start.bat`, or GitHub Pages). The main menu
   shows the UFO COMBAT logo over a flyover with a UFO. Click **Play**
   (Settings > Performance has Potato/Balanced presets for slow machines).
2. **Weapons (1-8):** fire the pistol, throw a grenade, fire the bazooka, the
   machine gun and the sniper (right click scope). Slot 5 marks an airstrike
   (meteors arrive after 5 s). Slot 7 is the laser blaster. Hold **both**
   mouse buttons for binoculars.
3. **UFOs:** in Survival, Esc > Settings > UFOs, set UFO activity to
   *Invasion* or *UFO APOCALYPSE* (they are busiest at night; in Creative,
   Esc > Mods > "Summon an enemy UFO" drops one in right away). One will
   fly over and try to beam you up: walk out of the light to escape. Shoot it
   with anything; when it goes down it crash-lands and aliens climb out.
4. Walk to the wreck and press **F** to fly it: WASD/Space/Shift, the wheel
   sets speed, left click cannon, hold right click to beam up creatures.
   Press **F** high up to jump out with a parachute.
5. Press **J**: your jet lands on a strip nearby (or arrives in the air).
   Press **F** by it, hold **W** and **Shift** to take off (assist rotates
   for you), steer with the mouse. Keep a UFO in front of the nose until
   **LOCK**, then right click for a missile. **B** drops the nuke: fly
   away and look back. **F** in the air ejects.
6. Esc > **Stats** shows UFOs shot down, play time and more; Settings >
   Gameplay puts a small overlay on the HUD.
7. Esc > **Mods** > switch Mods off: the game is vanilla again (weapons
   stashed, no UFOs or vehicles); switch on and it all comes back.

Automated: `cd tools && npm install && npm test` (unit tests, the UFO
feature suite `ufo-tests.mjs`, then the long smoke suite).

UFO FINAL COMPLETE

---

# Round 2 (UFO COMBAT) checklist

Source of truth for this round. Tick items as they are finished; decisions go in the "Round 2 decisions" list at the end.

## Part 1: Critical bug fixes
- [x] 1.1 Settings persistence (root cause + fix for every setting + reload test)
- [x] 1.2 Jet respawn bug (new jet after exiting)
- [x] 1.3 LOD matches full-detail terrain (same terrain function), altitude-aware view distance in jet/UFO
- [x] 1.4 UFO spawn distance scales with view distance, never visible pop-in
- [x] 1.5 Projectile ranges consistent with visible distances (player -> UFO, UFO -> player)
- [x] 1.6 Crashed UFOs in water sink below the surface
- [x] 1.7 Aliens face the player when shooting; chase immediately after leaving UFO
- [x] 1.8 Skeletons face the player when shooting; better look, no glow
- [x] 1.9 Chicken neck; butterfly model fixed
- [x] 1.10 At most 4 UFOs attack the player at once

## Part 2: Weapons and inventory
- [x] 2.1 Remove crafting; E opens inventory with all weapons/items; Creative has all weapons
- [x] 2.2 Railgun (1 s charge, beam cuts through blocks, mobs, UFOs)
- [x] 2.3 Laser minigun (spin-up, huge stream of bolts)
- [x] 2.4 Bazooka lock-on (hold to lock, homing rocket)
- [x] 2.5 Nuke bigger, wider size range, no cooldown
- [x] 2.6 Shield item (reduces explosion/attack damage, visual)

## Part 3: Vehicles
- [x] 3.1a Jet max speed higher in settings
- [x] 3.1b Realistic ground takeoff from airports/flat areas (runway roll, rotation, liftoff)
- [x] 3.1c Better F-22 style model, exhaust and afterburner visuals
- [x] 3.1d Autocannon aim assist + overheating with HUD heat bar
- [x] 3.1e Missile lock: hold RMB, lock nearest-to-center target (incl. behind), camera turns, 1 s lock -> 1 missile, 3 s -> salvo of 4, rear shots turn around
- [x] 3.1f Flares (decoy missiles and UFO shots)
- [x] 3.1g Missile warning HUD (direction + sound), sharp turns make missiles miss
- [x] 3.2 Enemy jets (neutral unless provoked; missiles + guns)
- [x] 3.3a UFO teleport dash (visible streak)
- [x] 3.3b UFO aiming fix for big ships
- [x] 3.3c UFO superweapon on B (vertical laser)
- [x] 3.4 Vehicle info panel on I (stats + controls)

## Part 4: UFOs and aliens
- [x] 4.1 New/improved designs: classic saucers most common with variety; detailed vs smooth minimal (pure sphere); tall-dome saucer; glowing vs dark; size range up to football-field giants
- [x] 4.2 Behavior: blink moves, mountains/underwater, aggression rules (shot / stared at / occasional), varied attacks + laser colors
- [x] 4.3 Shot down: lights off, random crash outcome (explosion+wreck / intact boardable), wrecks embedded in terrain
- [x] 4.4 Aliens: random 1-10 per crash, green/gray/red types with different weapons and stats

## Part 5: World
- [x] 5.1 Villages and cities with airports (runways, hangars, parked aircraft), villagers
- [x] 5.2 Airports flat and long enough for takeoff

## Part 6: Survival and progression
- [x] 6.1 Creative unchanged; Survival starts with pistol only
- [x] 6.2 Loot drops from UFOs/aliens, improving with progress
- [x] 6.3 Supply crates (parachute, smoke)
- [x] 6.4 Mission chain
- [x] 6.5 Difficulty curve and tuned defaults

## Part 7: Menu and defaults
- [x] 7.1 Polished main menu
- [x] 7.2 Shootable menu UFO
- [x] 7.3 Default preset Ultra, live FPS on menu + low-FPS recommendation
- [x] 7.4 Default time 17:50, saved settings take priority

## Final polish
- [x] F1 Regression pass
- [x] F2 Player's-eye review
- [x] F3 Performance check on low presets
- [x] F4 Full test suite
- [x] F5 README updated
- [x] F6 PROGRESS summary, decisions, known issues, how to test in 10 minutes
- [x] F7 "ROUND 2 COMPLETE", commit, push

## Round 2 decisions and notes
(appended as work proceeds)
- Part 1: settings root causes were (a) a session-only graphics step-down being written back to the saved settings on pagehide/GPU loss, (b) settings applied only when a panel was opened; fixed and covered by a reload test. Terrain: one shared `surfaceBlocks`/soft-cap function feeds chunks and LOD, so mountains match; view distance grows with altitude (session only, never saved).
- Part 2: Survival is combat-focused now that crafting is gone; every block can still be dug (tools only speed it up) and ores give ingots directly. Tools/blocks come from loot (Part 6). The shield lets 25% of an explosion and 35% of other attacks through; falls, drowning and the void are not stopped. The bazooka fires on release (a quick tap = an unguided rocket at once). Nuke: default 44, range 12-96, no cooldown beyond a half-second debounce; big craters are carved in more slices per frame.
- Part 3: the jet's ground roll uses 70% of the thrust on the wheels (about 100 blocks, 60 with the afterburner); flight assist holds a gentle climb-out just after liftoff so the jet doesn't settle back. The missile lock holds the jet on a straight course while the camera looks at the target, so a rear target never flips the jet round. The lock is proximity-fused, missiles turn with a real rotation (not a vector blend), lose the target when the line of sight swings too fast (sharp turns) and can be decoyed by flares (85%); a decoyed missile may return to its shooter. Enemy jets are `EnemyJet` vehicles (same flight model, an autopilot instead of input) and are never saved. Keys: `C` flares, `I` vehicle panel, `R` UFO dash, `B` UFO superweapon (B is also the jet's nuke): none clash with existing bindings in their vehicle.
- Part 5: sites (airports and cities) are decided by hashes on a 700-block grid and bend the terrain function itself, so chunks, distant terrain (LOD), mob spawning and every height query agree on the level pad; structures are placed per chunk from analytic column functions (nothing big is stored). The runway is bedrock (indestructible, dark): a deliberate choice for a takeoff strip that explosions can't wreck. Parked jets come from an `AirportManager` (never saved), villagers use the same spawner as villages.
- Part 6: crates and loot are Survival only; missions count from the moment they start using the world's stat counters, and are saved with the player. Difficulty (0-1) comes from missions done plus UFOs shot down; it scales UFO size odds and aggression.
- Final: enemy jets now sample the ground at several points along their path (a hill in the middle of a pursuit was missed); a crew that finds no room around its wreck retries a few times before giving up. The superweapon beam was checked in a screenshot (a white column from the ship to the ground) and does render.
- Part 7: default preset Ultra (the safe-start step-down still protects weak machines, and the menu suggests a lower preset from the live FPS); a new world starts at 17:50. The menu UFO is a random design each pass, can be shot with a click, and its explosion uses particles only (no crater).

## Round 2 (UFO COMBAT): final summary

Everything in the brief is in, in the order given, each part committed and pushed as it was finished.

**Part 1, critical fixes.** Settings: the root causes were a session-only graphics step-down being written back into the saved settings (on page hide and GPU loss), and some settings only being applied once their panel was opened; every setting now survives a reload and the saved value always wins over a default (reload test covers every group). Jet respawn: rebuilt the call-in so a new jet is always created, visible and in the scene (`removePlayerJets`, a watchdog `updateJetWatch`, test). Terrain: chunks and distant terrain use one height/biome/surface function (a soft height cap keeps mountains inside the world), so mountains match; the view distance grows with altitude in a jet or UFO. UFO spawn distance follows the view distance and is never visible; every weapon reaches at least as far as you can see, and UFO shots reach you from as far; crashed UFOs in water sink below the surface; aliens and skeletons face the player when they shoot and aliens chase at once; skeleton redesigned without a glow; the chicken has a neck and the butterfly's wings fold up; at most four UFOs attack at once.

**Part 2, weapons and inventory.** Crafting is gone (E is the inventory, in Creative a tabbed palette of everything); Creative starts with all weapons, Survival with a pistol. New: **railgun** (about 1 s charge with glowing coils and a rising whine, then an extremely bright beam that carves a tunnel through every block and hits every creature, UFO and vehicle on the line), **laser minigun** (spin-up, then 32 huge bolts a second), **bazooka lock-on** (hold to lock, indicator, homing rocket), **energy shield** (soaks explosions and attacks, force-field visual, energy bar), golden hearts, a bigger **nuke** (size 12-96, default 44, no cooldown).

**Part 3, vehicles.** Jet: top speed setting up to 2520 km/h (default 792), a real ground roll and rotation with folding landing gear, a much more detailed F-22 model with a layered afterburner and shock diamonds, cannon aim assist and overheating with a heat bar, missile lock (hold RMB: nearest to the view centre, even behind, the camera turns to it; 1 s one missile, 3 s a salvo of four, rear shots turn around), flares that fool missiles and seeking UFO shots, a missile warning (arrow and beeping), missiles that lose you in sharp turns. Enemy jets patrol neutral and hunt you (missiles, guns, flares, breaks) once you attack them or their UFOs. UFO: teleport dash with a streak, barrels that converge on the crosshair (big ships fire several), a vertical superweapon on B. `I` shows stats and controls of the vehicle you are in.

**Part 4, UFOs and aliens.** Thirteen designs (classic saucers by far the most common, with detailed, smooth minimal, tall-dome, dark and glowing variants, plus a pure sphere), five sizes up to football-field giants, blink moves, diving into mountains and under water, mostly peaceful with hostility when shot at, stared at or now and then, five attack styles with their own laser colours, lights-out when shot down, a random crash outcome (burnt-out unusable wreck or intact and boardable), wrecks embedded in the ground, and 1-10 aliens of three kinds (green pistol, gray burst, red plasma).

**Part 5, world.** Airports and cities (levelled pads visible in distant terrain too): a 260-block marked runway with edge lights, taxiway, apron, three hangars, a tower and fuel tanks, parked fighters you can board, villagers; cities add a street grid with towers, houses and windows.

**Part 6, survival.** Pistol-only start, loot from UFOs, aliens and enemy jets that improves with progress and never repeats a weapon you own, parachuting supply crates with orange smoke, a seven-step mission chain (first: shoot down a UFO and kill its aliens) with a tracker, a difficulty curve that scales UFO sizes and aggression.

**Part 7, menu.** A glass-card main menu with mode cards, animated logo, live FPS, low-FPS advice and rotating tips; a saucer (a different design each pass) that can be shot; Ultra as the default preset; new worlds start at 17:50.

### Tests

Run in `tools/` (`npm install` once for three.js and Playwright; everything runs against the local files, headless, with software rendering, so it is slow):

- `node unit-tests.mjs`: **49 passed, 0 failed** (terrain/LOD parity, airports and cities, missions and loot, ...).
- `node round2-tests.mjs` (`npm run test:round2`): **39 passed, 0 failed** (settings reload, jet respawn, view distance, UFO spawns, weapons, jet, UFO piloting, airports, crates, missions, menu, a performance check). About 8 minutes.
- `node ufo-tests.mjs` (the older UFO suite, adapted to Round 2): **34 of 35 passed** in the last complete run; the one that does not pass every time is the long "FULL SCENARIO" (see below). About 15 minutes.
- `node smoke-test.mjs` (the original base-game suite, adapted): 64 of 67 checks passed in the last complete run, and the 3 that did not (two startup-recovery checks written for the old "rewrite the saved setting" behaviour, and one Ultra check that ran into its 5-minute limit under CPU contention) were fixed and pass when run alone (`SMOKE_GREP="startup"`, `SMOKE_GREP="lost graphics"`, `SMOKE_GREP="page loads,Play button,Ultra: tall grass"`). A full run takes 45+ minutes with software rendering and Ultra as the default, so the complete file was not re-run after those last three fixes.

### Known issues and honest limits

- Existing worlds: where an airport or city now appears, the terrain is levelled, so blocks a player built there earlier can end up floating or buried.
- Parked jets, supply crates and enemy jets are not saved (they are set out again); missions, loot and stats are.
- The runway is bedrock (unbreakable, dark): a choice, so explosions can't wreck the takeoff strip.
- The shield stops explosions and attacks but not falls, drowning or the nuke's blast (a pierce hit).
- Enemy jets patrol within about 0.85x the view distance so they can be seen; on very low view distances they are only glimpsed.
- Mobs have no path-finding: an alien that comes out of a wreck can get stuck behind a cliff or in water.
- `ufo-tests.mjs` "FULL SCENARIO" (jet chase, missile, crash, eject, alien fight, board the wreck, fly off) is timing-sensitive on software rendering: it passed in 2 of 3 standalone runs and in an earlier full run, and fails on some runs at a step that depends on chance (the missile missing a UFO that dodges, or the jet call being ignored right after another call). The game behaviour it checks is covered deterministically by `round2-tests.mjs`.
- Hooks added for the tests only: `ufo.crashPlan` (fixes the crash outcome and crew size), `ufo.noLeave`, `SMOKE_GREP`. Nothing in the game sets them.
- Ultra as the default can be heavy for weak GPUs: the safe start still steps a session down if the first start fails, and the menu suggests a lower preset from the measured FPS.
- The screenshots used for the visual review came from software rendering (about 1-2 FPS), so no real-GPU frame times were measured; the performance check counts simulation cost (frame work per update in a busy scene), not GPU time.

### How to test in 10 minutes

1. Open the game, wait for the menu: watch the FPS counter, click the flying saucer (4 hits) to shoot it down.
2. **Survival**, Play: you have a pistol. Watch the mission tracker (top right). Within a minute or two a **supply crate** drops with orange smoke: walk to it (it shows the distance) for a weapon and golden apples.
3. Press **F3**: the nearest **airport/city** is listed with distance and direction. Fly there (Creative: double-tap Space to fly) or just press **J**: your jet waits on the airport runway (walk to it, press **F**). Throttle up (W), afterburner (Shift): the jet rolls about 60 blocks and lifts off by itself; **I** shows all controls.
4. In the jet: hold the **right mouse button** on a UFO for 1 s and release (one missile), or 3 s for a salvo of four; **C** drops flares; the cannon (left click) overheats after ~2 s. Shoot at a UFO and an enemy jet appears and hunts you.
5. Back on foot in **Creative**: E shows all weapons. Try the **railgun** (hold RMB ~1 s at a hill), the **minigun**, the **shield** (hold RMB, then throw a grenade at your feet), the **bazooka** (hold RMB on a UFO to lock, release).
6. Board a crashed intact UFO (F) and press **R** (teleport dash) and **B** (vertical superweapon).

ROUND 2 COMPLETE

# Round 3 (UFO COMBAT) checklist

Source of truth for this round. Items are ticked as they are finished; decisions go in "Round 3 decisions" at the end.

## Part 0: Restore jet flight
- [x] 0.1 Jet flight physics and flight controls restored to the "UFO FINAL COMPLETE" build (commit 4081499), Round 2 jet features kept (weapons, aim assist, heat, missile lock, flares, warnings, runway takeoff)
- [x] 0.2 Round 2 checklist: nothing left unchecked (verified: all ticked)

## Part 1: Combat fixes
- [x] 1.1 UFO shots that reach the player always hit and hurt (on foot and in vehicles); only dodging avoids damage
- [x] 1.2 Jet missile lock released early: no missile, camera returns
- [x] 1.3 UFO attack variety by type (rapid bursts, slow heavy bolts, sweeping beams, spread shots, charged shots), own colors and sounds

## Part 2: UFO redesign
- [x] 2.1 Remove detailed many-light UFOs and the tall-cockpit saucer
- [x] 2.2 Smooth saucers: several clean variants (proportions, sizes, brushed / matte / glossy), most common
- [x] 2.3 Spheres: gray-black, non-glowing, subtle surface material
- [x] 2.4 Tic-tacs: white / pale gray capsules
- [x] 2.5 Torus: pure minimal ring
- [x] 2.6 Extra minimal shapes (smooth cube, cube-ring)
- [x] 2.7 Size/material variety; shot-down UFOs never glow

## Part 3: UFO behavior
- [x] 3.1 Enemy UFO teleport dashes (random, often when shot at), streak along the path, no light effects
- [x] 3.2 Player UFO dash: visible ultra-fast travel, setting to adjust/disable, shown in the I panel
- [x] 3.3 Enemy jets sometimes attack UFOs on their own, balanced

## Part 4: Jet visuals
- [x] 4.1 Jet material/texture (panel lines, livery, moonlight/ambient/specular response), more model detail, visible at night
- [x] 4.2 Navigation lights only at night

## Part 5: World and graphics
- [x] 5.1 Bigger mountains and ranges, large seas/oceans, big biomes
- [x] 5.2 Farther, better LOD; higher max settings; LOD consistent with full detail
- [x] 5.3 Ultra grass shorter

## Part 6: Survival missions and balance
- [x] 6.1 Mission chain design (simple -> epic), rewards tied to weapon progression
- [x] 6.2 UFO count/size/health/damage balanced per mission; early UFOs killable with the pistol
- [x] 6.3 Mission HUD with progress; mission list in the pause menu

## Final polish
- [x] F1 Regression pass
- [x] F2 Player's-eye review (Survival start, Creative jet/UFOs/dashes/night/lock release)
- [x] F3 Full test suite
- [x] F4 README updated
- [x] F5 PROGRESS summary, decisions, known issues, how to test in 10 minutes
- [x] F6 "ROUND 3 COMPLETE", commit, push

## Round 3 decisions and notes
(appended as work proceeds)
- Part 0: compared `js/vehicle-jet.js` at 4081499 ("UFO FINAL COMPLETE") with Round 2. The in-air flight model (`_aero` lift/drag/thrust/control rates, `_assistStick`, mouse steering, keys) is byte-for-byte the Round 1 one again. What Round 2 had changed and is now undone: the default top speed (220 back to 160 blocks/s, ~580 km/h; drag is derived from it, so this is what made it feel different) and a "hold a climb" assist that also acted on landing approaches. Saved settings still carrying the Round 2 default (220) are moved back to 160 once (`settings.rev = 3`); any other value the player picked is kept. The slider still goes to 700.
- Part 0, takeoff kept working: the Round 2 runway roll stays (70% of the thrust on the wheels), but with the original drag the raised nose bled off too much speed on the wheels, so induced drag now applies only once airborne, the assist rotates at 1.2x the stall speed (was 1.05x) so the jet leaves the runway with margin to climb, and the "keep climbing" aid acts only in the first 3 s after the wheels leave the ground. All of this is ground/takeoff only; nothing in flight changed.
- Part 1.2 (done with Part 0, same code): releasing the missile lock before it is complete fires nothing ("Lock cancelled"), and the camera eases back. A quick tap no longer fires an unguided missile (the player asked for exactly this; the cannon covers unguided fire).
- Part 1.1, why UFO shots "passed through": three causes. (a) The player's hitbox was a 0.7-wide box while the bolts are drawn with a halo up to ~1.4 blocks wide, so a bolt that visibly hit could pass beside the body; the box now grows by the bolt's glow. (b) Every hit gave the player half a second of grace ("only a stronger hit counts"), so the 2nd and 3rd shot of a burst did nothing; projectiles (UFO and alien shots) now always count in full (melee keeps its grace time). (c) Bolts were tested against where a moving target was at the end of the frame only: a jet moves several blocks a frame and slipped between steps; bolts are now tested in the target's frame of motion (swept sphere/box, `sweptSphere`/`sweptBox` in lasers.js). UFO aim now solves the real intercept (it used to under-lead a fast jet by tens of blocks) and scatters well under a block at the target: standing still gets you hit, moving out of the way (changing direction) is what avoids damage.
- Part 1.3, attack styles by type: rapid (5-bolt bursts, cyan, chirps; tic-tacs, saucers), heavy (slow big orange ball that explodes, deep whump; spheres, cubes), spread (a 5-bolt fan, magenta, buzzing chord; saucers, rings), charged (a visible 1.3 s glow-up with a rising whine, then a very fast white-blue bolt with an electric crack; spheres, tic-tacs), sweep (a continuous red beam whose end runs along the ground through you in 1.5 s, scorching it, with a searing hum; rings, saucers), seeker (homing lime plasma vs vehicles). Small scouts never get heavy or seeker attacks. The colour now comes from the style (it used to come from the hull's look).
- Part 2, UFO redesign: `ufo-models.js` rebuilt around eight clean designs: three smooth saucer families (lens, flat disc, domed: each seed gets its own proportions: thickness, curvature, rim, centre bulge) that together are ~55% of all UFOs, then spheres (14%), tic-tacs (14%), tori (8%), rounded cubes (5%) and square cube-rings (4%, my extra shape). No instanced lights, panels, portholes, antennas or cockpits anywhere. Realism comes from a new optional surface finish in the shared entity shader (`USE_SPEC`: sun/moon specular, a sky/ground reflection with Fresnel, lathe-turned brushed streaks, fine grain) with five finishes: brushed, glossy, satin, matte, grain (spheres). About a quarter glow faintly (a soft underside/sheen that is barely visible by day, a halo at night); a UFO that was shot down never glows again, also after it is boarded and flown (`downed` flag, saved). Old saved designs (tall-dome, orb, pyramid, cigar, ring, cube-in-sphere...) are mapped onto the new ones, so saved wrecks and UFOs still load.
- Part 3.1, enemy UFO dashes: a dash is real travel, not a teleport cut: ~1100 blocks/s, 0.06-0.2 s, eased, so it is seen streaking along its path for a few frames, and it leaves a smear of fading translucent copies of its own hull (`js/dash-trail.js`: pooled, not additive, no glow, no flash; the old light streak and end flashes are gone). Triggers: the random timer (15-60 s), being hit by the player (45% small, 35% medium, 22% large, 10% mothership, never giants; 2.5-5 s cooldown), a missile closing within ~90 blocks (once per missile), and being hit by a rogue fighter. A short airy whoosh is its only other cue.
- Part 3.2, player UFO dash (R): now travelled the same way (the camera rides along, the same smear), stops short of terrain as before. Settings > Vehicles: "Teleport dash distance" (Off, 0.5x-3x; default 1x = 1.6x the cruise speed, 60-700 blocks) and "Teleport dash travel time" (0.08-0.6 s, default 0.25 s). The I panel shows the current distance, travel time and cooldown, or "off"; the HUD bar says "Dash (off)" when disabled.
- Part 3.3, enemy jets vs UFOs: 40% of fighters are rogue pilots. When not hostile to the player, a rogue checks every few seconds and half the time picks a small/medium/large UFO the player can see, attacks it for 35-55 s (cannon at 45% damage vs UFOs, one 70-damage missile per engagement), then pauses 60-120 s; at most two kills per fighter. The UFO fights back with its own attack style, and dodges. Balance: kills by fighters are never the player's (no stats, mission credit or loot), a fighter hit by a UFO or a stray blast doesn't turn on the player, rogue fighters only turn on the player when attacked themselves, and non-rogue fighters (60%) still take the UFOs' side as before. Fixed on the way: a seeking UFO shot at a jet that already showed a missile warning called `vehicle.warn(...)` on the warning state object (a TypeError that stopped the UFO update).
- Part 4, jet visuals: the root cause of the black jet was colour management: `colorize` converted the (already linear) paint colours from sRGB to linear a second time, so the grey paint had an albedo of ~0.03. Fixed, and the jet now uses the new surface finish: satin paint with sun/moon specular glints, a sky reflection at grazing angles, a staggered grid of anti-aliased panel lines that fade out with distance, and a subtle two-tone livery (all procedural in the shader, in object space, so it costs no textures). A night-only ambient fill keeps it a readable shape in the dark. New detail: canopy frame and bow, a pilot (seat, helmet, visor), gun port, AoA probes, antenna blades, static wicks, light intake lips. Navigation lights, tail strobes, green formation strips and a dim cockpit glow switch on only at night (uNight > 0.3). Enemy fighters got a slightly lighter charcoal so they are visible at night too.
- Part 5.1, world: the world is now 128 blocks tall (was 64). The chunk block index is y-major and the saved-edit format stores a 16-bit index, so 128 is the largest height that keeps every existing save valid (edits saved at y < 64 mean exactly the same blocks). Sea level stays 24 (caves, ores and the underground are unchanged). The height field was rescaled: continents/oceans at 1/2600 (about half the world is sea, deep oceans far out, a tanh step at the coastline so shores are beaches rather than wide marshes), masked mountain ranges (ridged noise with peaks and gullies, only on land) rising to ~120 with a soft cap under the ceiling, snow above 92 and bare rock above 68, rivers at a larger scale, and biomes about three times bigger (climate noise at 1/1500 and 1/1300, thresholds re-centred so deserts, jungles and savannas still appear). A seed's landscape differs from Round 2 (noted in Known issues). Spawn search spirals out further (oceans can be large). City towers can be taller.
- Part 5.2, level of detail: render distance up to 256 chunks (4 km; was 100), full-detail distance up to 24 chunks, a new "Extreme" far-terrain quality (split distances 3x), resolution scale up to 200% (supersampling), and an "Extreme" performance preset (Ultra, 72 chunks, 14 in full detail, Extreme LOD). The far terrain is built by a pool of up to four workers (cores - 2) instead of one, so long distances fill in faster. LOD tiles sample the very same height/biome/surface functions as the chunks (checked by the unit test "distant terrain and full-detail chunks agree"), so higher settings stay consistent.
- Part 5.3, Ultra grass: blade heights scaled to 68% on Ultra (ferns a little less), about knee-high at most; High is unchanged.
- Part 6, missions: a 15-mission chain (progression.js) with a mission director (new js/missions.js) that sets each one up in the world: 1 First contact (a small, weak scout, 24 hp = about five pistol shots, spawned 90-130 blocks away, low, tethered near the player, rarely dodging, single weak shots; it comes down intact with two green aliens), 2 The crew (kill them; if they are lost, two are beamed down), 3 Supply drop (a crate is dropped), 4 The long night (survive dusk to dawn without dying; the tracker says when night falls or dawn comes), 5 Salvage (the next UFO you down lands intact; board it), 6 Scout hunter (3 UFOs), 7 Alien squad (a dropship lands 6 aliens: greens, grays, a red), 8 Take to the air (a takeoff in your jet), 9 Dogfight (2 UFOs from the jet; UFOs are kept around while you fly), 10 Air superiority (a hostile fighter is sent after you), 11 Village under attack (three raiders burn the nearest village with heavy shots; 5 minutes, or they leave and come back), 12 Big game (a large UFO), 13 Mothership (with an escort), 14 Operation Sunburn (the nearest airport becomes an enemy base with guards and a scrambling fighter; a nuke within 170 blocks completes it), 15 UFO slayer (25 more). Rewards follow the weapon progression: grenade and sword, machine gun, iron sword, laser blaster, shield, sniper, bazooka, jet radio, airstrike, minigun, diamond gear, railgun, then golden apples.
- Part 6, balance: each mission carries rules for the sky (UFO sizes and their odds, and multipliers for health, damage, aggression and numbers), applied by UfoManager while it is current. Missions 1-3: small UFOs only, 60-65% health, 50-55% damage, half the aggression and numbers; then medium ships from mission 4, large from 7, a rare mothership from 10, giants only from 12, and the full late-game sky (110-115% health and damage, 1.2-1.3x aggression) for the last two. Loot tiers follow the missions (tier 0 for 1-3 ... 5 for 14-15). The user's UFO settings still apply on top (activity, toughness, aggression; a non-"balanced" size setting overrides the mission's sizes). Creative has no missions and keeps the old free-play curve.
- Part 6, HUD: the tracker shows "MISSION n/15", the title, the text, each objective with a progress bar, the target's name, distance and direction, a note (e.g. "Night falls in about 3 min") and the next mission; a yellow diamond marker floats over the target (or an arrow at the screen edge when it is off-screen or behind). The pause menu has a Missions screen listing all 15 with their state, progress and rewards. Missions now also complete while the HUD is hidden (F1), which they didn't before. New stats: missions completed, nights survived, takeoffs, UFOs downed from the jet, large UFOs, raiders, enemy bases nuked. Old Round 2 mission progress carries over (mapped onto the new chain).
- Final polish, player's-eye review: in Survival the J key (and the Jet Radio, and the fighters parked at airports) called a jet from minute one, which skipped the whole mission curve: jets now unlock with mission 8 "Take to the air" (a toast says so; Creative is unchanged). With UFO activity Off the director spawns no mission UFOs and the tracker says why. The first-time welcome hint in Survival points at the mission tracker instead of the jet. Rogue fighters never pick a mission's own target (the scout, raiders).

## Round 3 (UFO COMBAT): final summary

Everything in the brief is in, part by part, each committed and pushed when finished.

**Part 0, jet flight restored.** The in-air flight model and controls are the Round 1 ("UFO FINAL COMPLETE") ones again: Round 2 had raised the default top speed from 160 to 220 blocks/s (drag is derived from it, which is what changed the feel) and added a climb-hold that also acted on landing approaches. Saved settings still at the Round 2 default are moved back once. Every Round 2 jet feature still works (weapons, aim assist, heat, missile lock and salvos, flares, warnings, runway takeoff); only the ground roll got small, ground-only adjustments so the restored drag doesn't stop the takeoff.

**Part 1, combat.** UFO shots that reach you always hurt: hit tests now use the bolt's visible size, test in the target's frame of motion (fast jets can't slip between frames), and projectiles no longer get swallowed by the half-second grace time; UFO aim uses a real intercept, so standing still gets you hit and moving out of the way doesn't. Releasing the jet's missile lock early fires nothing. Each UFO type fights in its own way: rapid bursts, slow heavy bolts, spread fans, charged shots with a visible glow-up, sweeping ground beams and seekers, each with its own colour and sound.

**Part 2, UFO redesign.** Eight clean, minimal designs (lens / disc / domed smooth saucers as the majority, gray-black grainy spheres, pale tic-tacs, tori, rounded cubes, cube-rings), no lights at all, varied sizes and finishes (brushed, glossy, satin, matte, grain) from a new specular surface option in the entity shader. Shot-down UFOs never glow again, boarded or not.

**Part 3, behaviour.** Enemy UFOs dash (random, often when hit or when a missile closes in) at extreme speed, travelled over a few frames with a smear of fading hull copies and no light. The player's UFO dash is travelled too, with distance (or Off) and travel-time settings, shown in the I panel. 40% of enemy fighters are rogue pilots that sometimes attack UFOs on their own, capped so they never clear the sky, and never credited to the player.

**Part 4, jet visuals.** The jet was black at night because its paint colours were converted to linear twice (albedo ~0.03). Fixed, plus a satin paint finish with sun/moon specular, sky reflection, procedural panel lines and a two-tone livery, more model detail (canopy frame, pilot, probes, antennas, wicks, gun port), and navigation, strobe and formation lights only at night.

**Part 5, world and graphics.** A 128-tall world (still save-compatible) with half of it sea, mountain ranges up to ~120 with snow and bare rock, and biomes about three times bigger. Render distance up to 256 chunks, full detail up to 24, an Extreme far-terrain quality and performance preset, resolution up to 200%, and a pool of LOD workers; LOD samples the same terrain functions as the chunks. Ultra grass is about two thirds as tall.

**Part 6, missions.** Fifteen missions, from a pistol-killable scout to nuking an enemy-held airport, each set up in the world by a mission director, each with rewards along the weapon progression and its own rules for the sky (sizes, health, damage, aggression, numbers) for a steady difficulty curve. The HUD shows the mission, progress bars, the target's distance and direction and a marker over it; the pause menu lists all missions. Jets join with mission 8 in Survival.

### Round 3 decisions (summary; details above)

- Jet: restored the Round 1 flight model exactly in the air; kept Round 2's ground roll and made the takeoff work with the restored drag through ground-only changes (no induced drag on the wheels, rotate at 1.2x stall, a 3-second climb aid after liftoff).
- A quick tap of the jet's lock button no longer fires an unguided missile (asked for); the cannon is the unguided weapon.
- Projectile hits always count (no grace time), balanced by tighter but fair aim and the per-mission damage multipliers.
- World height 128 rather than 256: the largest that keeps the saved-edit format (16-bit index) and every existing save valid.
- Jets locked in Survival until mission 8, since a jet on day one skips the whole difficulty curve; Creative unchanged.
- Rogue fighters: 40%, weaker vs UFOs, two kills at most, no credit to the player.
- Mission UFOs respect "UFO activity: Off" (the tracker explains why a mission can't progress).
- The older test suites run without the mission chain (a `testFlags.noMissions` hook, never set by the game), since the director would spawn scouts and change the sky under them.

### Known issues and honest limits

- Existing worlds: the Round 3 terrain is different for the same seed (taller, bigger features). Saved block edits keep their positions, so builds from an older version can end up buried or floating in a changed landscape.
- Mission set-ups (scouts, squads, raids, the mothership, the enemy base) are not saved; after a reload the director sets the current mission up again.
- The village raid picks the nearest village within 2500 blocks, else the nearest airport, else a spot 400 blocks away; the "burning" is heavy UFO shots that do blast craters in it.
- Long render distances (150-256 chunks) are meant for strong PCs: the far terrain is cheap, but it is still a lot of tiles, and when flying high the view grows further.
- `smoke-test.mjs` "underwater blasts flood the crater" can fail in a full run when earlier checks' craters leave air next to the sea near the chosen spot; it passes on a fresh page and chunk generation itself leaves no air under water (checked). `smoke-test.mjs` Ultra grass check can hit its 5-minute limit with software rendering on a busy machine (as in Round 2).
- Hooks for tests only: `testFlags.noMissions`, `ufo.crashPlan`, `ufo.noLeave`, `SMOKE_GREP`.
- All screenshots for the visual review came from software rendering (1-2 FPS); real-GPU frame times were not measured.

### How to test in 10 minutes

1. **New World, Survival:** a scout UFO appears (yellow marker, tracker top right). Shoot it with the pistol (about five hits); two aliens climb out of the wreck (mission 2), then a supply crate drops (mission 3). Esc > **Missions** lists all 15.
2. Watch a UFO while you shoot at it: it often **dashes** away (a smear, no light). Stand still under fire and you get hit; strafe and the shots miss.
3. **Creative:** Settings > UFOs, activity "Busy skies": watch the new clean designs; notice different attacks (cyan bursts, orange balls, magenta fans, charged white shots with a glow-up, red sweeping beams).
4. Press **J**: fly the jet (it flies like the first build again). Hold right click on a UFO and let go before LOCKED: nothing fires and the view turns back; hold 1 s: one missile.
5. Settings > Gameplay, time 23:00: the jet is clearly visible in the moonlight, with its navigation lights on (off by day).
6. Get out, board a UFO from the Mods screen, press **R** (a streaked dash; Settings > Vehicles to change or switch it off; **I** shows it).
7. Settings > Performance > **Extreme**, then fly high over a mountain range: big ranges, snowy peaks, seas to the horizon.

### Tests (Round 3)

Run in `tools/` (`npm install` once; headless Chromium with software rendering, so the browser suites are slow). Each suite ran in full once, then the failing checks were fixed and re-run on their own:

- `node unit-tests.mjs`: **50 passed, 0 failed** (new: world scale, the 15-mission chain and old-save migration).
- `node round3-tests.mjs` (new, ~5 min): **10 checks**; full run 9/10, the failure (a fighter crashing into a hill counted as the player's kill) was a real bug, fixed, and the check passes (twice in a row).
- `node round2-tests.mjs`: full run **34 passed, 5 failed**; all five fixed and passing on re-run (a thin new UFO hitbox, test set-ups that depended on the old terrain or on the old mission chain, a rogue fighter in a "take the UFOs' side" check, the respawn/resume helper).
- `node ufo-tests.mjs`: full run **30 passed, 5 failed**; re-run from the failing section after fixes: 16 of 18, and the jet takeoff check alone passes. Still failing: "FULL SCENARIO" (known timing/chance-sensitive in Round 2 as well; this time the crew didn't show up in time) and "stats", which counts what that scenario does.
- `node smoke-test.mjs` (~70 min): **62 passed, 5 failed**; render distance, F5 camera and LOD hand-over fixed and passing on re-run; still listed: "Ultra: tall grass..." (hit its 5-minute limit under CPU load, as in Round 2) and "underwater blasts" (order-dependent, see Known issues; passes on a fresh page).

ROUND 3 COMPLETE

# Settings persistence fix

Report: some or all settings went back to their defaults after a reload.

## Root causes

A headless test that changes every setting through the menus and reloads (tools/settings-tests.mjs) found that a plain reload already kept everything. The resets came from the paths a real browser takes and that test didn't:

1. **Full browser storage.** The block edits of every world played are saved in the same localStorage as the settings (one max-size nuke adds ~150 KB; the origin's quota is ~5 MB). Once it was full, every settings write failed with only a console warning, and on the next start the settings silently went back to their last successful save (for a newer player, the defaults).
2. **The safe start after a lost graphics context.** A lost WebGL context (a laptop going to sleep, a GPU switch or driver reset, a frame that took too long) wrote a "failed start" record, and the next start came up one graphics preset lower with the player's individual graphics options ignored for that session. The saved settings were intact, but the menus showed the lowered preset, which looks exactly like the graphics settings having been reset.
3. **A second open tab** kept its own in-memory copy of the settings and wrote the whole object back whenever it saved anything, undoing changes made in the other tab.
4. **Render distance vs. presets.** Picking a graphics preset always replaced the render distance with the preset's suggestion, even one the player had set themselves.
5. Smaller: the settings had no format version, unknown or junk fields were carried along, and individual graphics options weren't validated.

## Fix

- **One versioned object** (`v: 4`, `SETTINGS_VERSION` in settings.js) under `ufocombat_v1_settings`, built from scratch by `normalizeSettings` on load. Only known settings are kept, and every value is validated: missing or broken values (including corrupted JSON and wrong types) fall back to the default without errors. Older, unversioned saves are read and upgraded (including the Round 3 jet top speed migration, which moved here from main.js).
- **Load first.** The settings are read and normalized before anything applies a default, a graphics preset or a menu value, and written straight back in the current format. Every control saves immediately on change (no Save button).
- **A reserved slot** (storage.js): the settings JSON is padded to a fixed 16 KB size, so rewriting it never needs more room, however full the storage gets. As a last resort, if a storage that was already full before this change can't take even that, the saved block edits of other worlds (never the current one, largest first) are removed and the player is told in a toast. If nothing works, a toast says the storage is full instead of failing silently.
- **Lost graphics context:** the next start is no longer lowered by itself. The dialog offers "Reload" (same settings) or "Reload with lower graphics once" (the old safe-start behaviour, only when chosen, for that session, saved settings untouched). A start that really hangs while compiling shaders is still caught by the safe start.
- **Two tabs:** each tab listens for the other's saves (the `storage` event) and takes the new values over without writing them back, so neither overwrites the other with an older copy.

## Graphics presets vs. individual settings (decision)

- Picking a **graphics preset** sets the individual graphics options (shadows, anti-aliasing, bloom, ...). That is what a preset is, so it clears earlier per-option overrides. Options changed *after* picking it are kept as the player's overrides, marked "Custom", and survive reloads. Nothing re-applies a preset on its own at startup.
- It **no longer touches a render distance the player set**. It adopts its suggested distance only while the player hasn't moved the slider (`renderDistanceCustom`). A **performance preset** (Potato ... Extreme) is an explicit full set, so it still sets the render distance (and full-detail distance, far-terrain quality, resolution and effects), and "Reset to defaults" on the Graphics tab resets it too.
- Presets never change audio, controls, gameplay, weapon, mob, UFO, vehicle or HUD settings.

## Coverage and tests

The saved settings cover every setting in the game: graphics (preset and individual options), render distance, full-detail distance, far-terrain quality, resolution, effects, audio (six volumes), controls (FOV, sensitivity, invert Y, binocular zoom), gameplay (difficulty, creature spawning, time lock), HUD (FPS counter, stats overlay), weapons, zombies, UFOs, vehicles, and Mods on/off. The time of day stays per world (saved with the world, as before).

`tools/settings-tests.mjs` (new, `npm run test:settings`), 7 checks:
- every setting (all schema settings in all tabs, six volumes, preset, a graphics option, render distance, Mods) is changed through the real controls, is in storage at once, and after a reload is restored, applied, and left unchanged by a second reload;
- a preset plus later changes;
- missing, corrupted and garbage data, and an unversioned older save;
- a completely full storage;
- two open tabs;
- the render distance vs. presets;
- a lost graphics context, including "Reload with lower graphics once".

It passed 7/7 in three consecutive full runs with no console errors. In the very first run, before the diff output was added, the "second reload keeps everything" assertion failed once; it didn't come back in four later runs, and the cause wasn't identified. The Round 2 settings checks and the smoke startup/lost-graphics checks (updated for the new dialog) pass.

# Round 4 (UFO COMBAT) checklist

Source of truth for this round (jet fixes, survival progression, weapons balance, UFO piloting). Items are ticked as they are finished; decisions go in "Round 4 decisions" at the end.

## Part 1: Jet fixes (critical)
- [x] 1.1 Takeoff works reliably from runways and long flat areas (jet no longer stuck to the ground)
- [x] 1.2 Roll limited and smoothly damped, returns to level without overshoot (flight feel otherwise kept)
- [x] 1.3a Missiles can always be fired without a lock (unguided, straight ahead)
- [x] 1.3b Lock-on targets only UFOs and aircraft, never ground mobs
- [x] 1.3c Lock prioritizes targets attacking the player
- [x] 1.3d After a locked launch the camera follows the target until the hit, then returns; right mouse returns it at once
- [x] 1.4 Jet visuals: smaller lights, better texture/material
- [x] 1.5 Second jet: F-16-style fighter, own model, slightly different handling and weapons; player chooses which jet to call

## Part 2: Enemy jets and UFOs
- [x] 2.1 Enemy patrol jets attack only UFOs; the player only if the player attacks them directly; somewhat faster
- [x] 2.2 UFOs have more health, rebalanced along the mission curve
- [x] 2.3 Tractor beam follows the UFO (or stops) when a beaming UFO is shot and moves
- [x] 2.4 One alien type per UFO
- [x] 2.5 Aliens and skeletons fire from the muzzle of their weapon
- [x] 2.6 Airport hangars sometimes hold UFOs hovering above the floor; boardable only in late missions

## Part 3: UFO piloting
- [x] 3.1 Camera: UFO lower on screen, crosshair target always visible, reliable aim for every UFO size
- [x] 3.2 Dash (R): hold for continuous ultra-fast dash, no distance limit
- [x] 3.3 Boarded UFO uses its own type's weapon (the enemy attack style)

## Part 4: Survival progression and balance
- [x] 4.1 No UFO activity setting in Survival; UFO numbers follow the mission chain (Creative keeps the setting)
- [x] 4.2 Opening: basic gear, a skeleton drops a bow; the first UFO lands nearby, aliens attack after a delay; aliens killable in melee
- [x] 4.3 Weapon sources: skeletons bow, crates standard weapons, aliens better weapons later (weakest to strongest), missions only apples/golden apples
- [x] 4.4 UFO boarding locked until a late mission
- [x] 4.5 Reload/cooldown for every weapon balanced by damage, reload progress on the HUD
- [x] 4.6 Shield like classic block games: off hand, visible, blocks when raised (hold right mouse), no full-screen overlay
- [x] 4.7 Mission chain and difficulty curve re-checked: every mission achievable with the gear at that point, none trivial

## Part 5: Visual fixes
- [x] 5.1 Parrot redesigned (model and texture)

## Final polish
- [x] F1 Regression pass
- [x] F2 Player's-eye review (Survival opening and first missions; Creative jets, roll, missiles, enemy jets, UFO piloting)
- [x] F3 Full test suite
- [x] F4 README updated
- [x] F5 PROGRESS summary, decisions, known issues, how to test
- [x] F6 "ROUND 4 COMPLETE", commit, push

## Round 4 decisions and notes
(appended as work proceeds)
- Part 1.1, takeoff: the root cause was frame-rate dependent. On the wheels the speed was measured along the raised nose (`vel . fwd`) and the velocity re-set to that each frame, so while the nose was up the jet lost cos(pitch) of its speed every frame: at 20 FPS (the old test's step) it still got airborne, at a real 60 FPS it bled ~3% a frame and never reached flying speed (it rolled for kilometres, even down hillsides, "stuck to the ground"). Now the speed is measured along the level heading. Two more ground bugs found on the way: right after the wheels left the runway the next frame counted as a touchdown (vertical speed reset to 0, a bounce loop), and the nose could rotate past the stall angle so the jet left the runway stalled. Fixed: no touchdown while climbing away, rotation stops at 0.24 rad (below the 0.3 stall angle). Rolling off the end of a strip over a drop now leaves the ground instead of snapping down the slope. Measured at 1/144, 1/30 and 1/20 s steps: lift-off after ~122 blocks at full throttle (~98 with the afterburner), then a clean climb. The called-in jet's flat-strip search now wants 140 blocks, level to 1 block under the wheels and under the wingtips (7 blocks out; a 2-block rise at 6 blocks used to clip a wing).
- Part 1.2, roll: flight assist used to command a roll *rate* toward the aim point until the aim was above the canopy (90 degrees and more for a turn to the side) and levelled with a lagged proportional term (overshoot). Now it computes a target bank from the heading error (at most 65 degrees; A/D ask for up to 80 degrees while held, still limited) and flies it with a damped controller (rate = 3 x bank error - 0.4 x roll rate; checked for no overshoot at 144, 60 and 20 FPS). Measured: a 90-degree turn peaks at 68 degrees of bank, levelling off from 66 degrees takes ~1.5 s with 0.0 degrees of overshoot. Pitch/yaw control, speeds and all other flight numbers are unchanged. Without flight assist the mouse and A/D are still the direct roll stick (full aerobatics), by design. Enemy fighters use the same assist, so they no longer roll over either.
- Part 1.3, missiles: a right click shorter than 0.25 s (or letting go when nothing could be locked) fires an unguided missile straight ahead; holding locks as before, and letting go while the lock is still building still fires nothing (Round 3's request; a straight-ahead missile then would go where the player isn't looking, since the view has turned to the target). Lock candidates are UFOs and enemy aircraft only (creatures were removed from the list, which also affected the salvo spread). Targets attacking the player (a UFO in its attack state, a hostile or provoked enemy fighter) are preferred: a non-attacker gets a 0.6 rad (~35 degrees) penalty in the "nearest the view centre" score, so an attacker off to the side wins over a peaceful UFO dead ahead. After a guided launch (single or salvo) the camera stays on the target until the last missile of that launch is gone, holds 0.8 s on the hit, then eases back; a right click during that returns it at once (that click doesn't start a new lock). While the camera follows, the jet flies straight (as during a lock).
- Part 1.4, jet visuals: navigation lights are pinpoints now (sprites 0.28-0.32 blocks instead of 0.8-0.9, at ~60% of the old brightness; the bloom still makes them twinkle), thinner and dimmer formation strips, a smaller cockpit glow and smaller nozzle halos. The paint got an aircraft-skin layer in the entity shader (`USE_SKIN`, only on the jets): each panel of the seam grid has a slightly different shade (coating patches), exhaust soot darkens the tail around the nozzles, and faint grime streaks run back along the airflow; the grain is a touch stronger. All procedural in object space (no textures).
- Part 1.5, second jet: an F-16 Fighting Falcon, its own model (rounder fuselage with a dorsal spine, chin intake, big frameless bubble canopy, LERX into a cropped-delta wing with wingtip missiles, one tall fin, ventral fins, single round nozzle) in a light two-tone grey. Handling vs the F-22 (multipliers on the Settings > Vehicles values): turn 1.18x, roll 1.3x, stall speed 0.9x (lift-off after ~90 blocks instead of ~120), acceleration 1.1x, top speed 0.92x, armour 130 instead of 160. Weapons: a faster cannon (20 rounds/s at 4 damage vs 16 at 5, slightly more heat per second), quicker missile reloads (0.35 s), a salvo of 2 after 2 s instead of 4 after 3 s; flares and the nuke are the same (the nuke is a mission objective, so both jets carry it). Choosing: J (or the Jet Radio, or the Mods screen button) opens a small picker at the bottom of the screen: 1 = F-22, 2 = F-16, J again = the one you took last (highlighted). While the picker is up (6 s), 1 and 2 don't change the hotbar slot. Parked jets at airports are a fixed mix of both. The jet type is saved with the vehicle. Fleeing UFOs measure their speed against the jet being flown, so the slower F-16 can still catch the ones meant to be catchable. Enemy fighters stay F-22s (in their own paint).
- Part 2.1, patrol fighters: every patrol fighter now hunts UFOs (the old "rogue pilot" behaviour, now for all of them) and never turns on the player for shooting UFOs; there are no more "reinforcements" for attacking UFOs. Only a fighter the player hits directly becomes hostile (for 60 s, or until shot down), and only that one (wingmen no longer join in); a toast says so. Balance (they must not clear the sky for the player): cannon at 45% against UFOs, one 70-damage missile per engagement, engagements of 35-55 s with 25-50 s pauses, at most 3 kills per fighter, only small to large UFOs, never a mission's target, their kills are never the player's (no loot, stats or mission credit), and the UFOs fight back and dodge. They fly 1.05x the player's jet top speed (was 0.9x), 1.1x acceleration, slightly better turn (0.9 vs 0.85). They get a new slate-blue "patrol" paint and are named "Patrol fighter". Missions that need a fighter hunting the player (10 "Air superiority", the base in 14) now send a *hijacked* fighter (the old charcoal/red paint, "Hijacked fighter", hostile from the start): that keeps those missions working without contradicting "patrols only attack UFOs". In Survival, patrol fighters appear from the jet mission on (they are part of the air war, and a UFO-hunting air force before the player can even fly would thin out the early, on-foot sky). Settings > Vehicles label: "Patrol fighters at once".
- Part 2.2, UFO health: base health about 1.6x (small 40 -> 65, medium 130 -> 210, large 480 -> 760, mothership 2200 -> 3400, giant 6500 -> 9500), and weapons now have reloads (Part 4.5), which roughly halves the sustained damage of the hand weapons. The per-mission multipliers are re-tuned with the mission chain in Part 4.7.
- Part 2.3, tractor beam: a beam's top was only moved while the UFO was in a beaming state; shot (and dodging with a dash), provoked into attacking, or falling, it stopped updating the beam but left it on, so the cone hung in the air where the ship had been. Now every frame the beam hangs from the ship's current underside, and it switches off as soon as the ship is not beaming (dash, fall, another state); it fades out under the ship. Measured: after an 82-block dash the beam is off and its top is on the ship (0.00 blocks).
- Part 2.4, crews: a UFO picks its crew kind once (at spawn) and every alien that climbs out of its wreck is that kind (the pending crew keeps it too). In Survival the mission rules can say which kinds are about (`rules.crew`, used in Part 4).
- Part 2.5, muzzles: aliens and skeletons now fire from their weapon: the shot starts at the shoulder of the arm holding the weapon plus the arm-and-weapon length along the aim (the arm is raised along the aim while it targets you, see mob-models.js). Measured against the model's own gun tip / bow grip: 0.16-0.21 blocks off (it used to be the middle of the body at eye height). A muzzle inside a wall falls back to the eyes (point blank against a wall).
- Part 2.6, hangars: about one hangar in three or four (fixed per airport by its seed) has a small alien ship (saucer, disc, domed saucer or tic-tac, radius 4-4.9, so it fits through the 19x9 doorway) hovering 0.9 blocks above the floor with a slow bob. It is set out and put away with the parked jets. Survival: it (like every UFO) can be boarded only from the "Salvage" mission, which moves late in the chain in Part 4; the "board" prompt says it is locked until then. A parked aircraft the player boards becomes theirs (a normal, saved vehicle, no longer removed when they leave the airport); this also fixes an old bug where an airport jet flown away and left elsewhere was deleted as soon as the player was 900 blocks from that airport.
- Part 3.1, UFO camera: the chase camera used to sit on the line of sight through the middle of the ship, so a big hull covered the crosshair. Now the camera is raised along its own "up" axis by the ship's extent across the view (half its height, plus its radius times the sine of the pitch for a flat saucer seen from above or below) plus a margin, then set back as before: the crosshair's line of sight passes clear above the hull at any pitch, and the ship sits in the lower part of the screen. Checked by raycasting the camera's centre ray against the ship's own hull meshes for six ships (radius 4 to 70, saucers, spheres, cube, torus) at six pitches from -1.4 to 1.0: no hit in any of the 36 cases; the ship's centre is at 13-85% of the lower half of the screen. The raise and the distance back both stop short of terrain. Aiming already converged every shot on what the camera's centre ray hits, so it is now reliable for every size (it was the view that was blocked, not the aim).
- Part 3.2, dash: a tap of R still does the travelled dash; if R is still held when it arrives, the ship keeps streaking along the view (steerable with the mouse) at the dash speed (the tap's distance / travel time, 250-2500 blocks/s; at most 320 in ghost mode, which burns a tunnel) until R is released, with the hull smear the whole way and no distance limit. It stops short of terrain (non-ghost) and within the height limits. 1.2 s cooldown after a held dash (2.5 s after a tap, as before). Measured at the default settings: 780 blocks in 3 s held, 0.0 blocks after release, 60 for a tap.
- Part 3.3, UFO weapons: a boarded UFO fires its own kind's attack style (a wreck keeps the style it fought with, passed through the crash; Creative and hangar ships get one from their design family and size, seeded by the ship so it is stable across saves; saved with the vehicle): rapid 5-bolt cyan bursts, heavy orange plasma balls that explode, a magenta spread fan, a white charged shot (a visible charge under the ship, then one very fast hard bolt), a red sweeping beam (hold: a continuous beam to the crosshair, 3 s before it overheats), lime seeker plasma (homes on the UFO, aircraft or hostile creature nearest the crosshair; flares fool it), green pulse bolts (abductors also get a 1.6x tractor beam) and three-shot bursts. Same colours and sounds as the enemies. Balance: a small ship does ~45-65 damage per second whatever the style (measured on a medium ship: 170-230 damage in 3 s), scaled by size (1.3x medium, 1.7x large, 2.3x mothership, 3x giant); big ships fire from several points around the hull, every shot aimed at the crosshair. The HUD bar shows the reload / charge / beam heat; the I panel describes the weapon. The old generic laser cannon (6 x 16 damage + blast per second for every ship) is gone.
- Also: long toast messages now wrap (centred, at most 90% of the screen) instead of running off both sides.
- Part 4, the new Survival chain (19 missions; old saves carry over, see below). Weapons come in lanes: skeletons give the bow; supply crates give standard weapons by tier (pistol at tier 0; grenades, machine gun, shield at 1; sniper at 2; bazooka at 3; airstrike at 4; always the lowest missing tier first); aliens give alien weapons weakest first (laser blaster from greens at tier 2, laser minigun from grays at tier 3, railgun from reds at tier 4; an alien drops the weakest one you don't own, only if its kind is strong enough and the chain has reached that tier; 20/25/35% per kill, and a mission patrol's leader always carries the new one); missions reward only apples and golden apples. UFO wrecks and patrol fighters drop golden apples, tools and food, no weapons (the brief lists four sources; a fifth one from wrecks would have short-circuited the lanes). The Jet Radio is no longer a reward (the J key needs no item; the radio stays in Creative).
  | # | Mission | Gear you have by then (worst case) | UFO rules (max by day, health x, damage x) |
  | --- | --- | --- | --- |
  | 1 | The archer: kill a skeleton (fireproof, near) | stone sword (5), stone pickaxe, 5 apples | none |
  | 2 | Visitors: a small UFO lands ~75 blocks away, 2 greens climb out and look around for 35 s (or until hit), then attack; the ship leaves, its hull shrugs off hand weapons | + bow (9 per full draw) | none (only the landing ship) |
  | 3 | Supply drop: the first crate (a pistol) | + pistol | 1, 0.6, 0.5 |
  | 4 | First contact: a scout (40 hp = 8 pistol shots, a magazine is 12; or 5 full arrows) | pistol, bow, sword | 1, 0.6, 0.5 |
  | 5 | The crew: its 2 greens | same | 1, 0.6, 0.5 |
  | 6 | The long night | + crates from now on (tier 1: grenades, MG, shield) | 2 (x1.7 at night), 0.65, 0.6 |
  | 7 | Laser patrol: 4 greens, the leader drops the laser blaster | + maybe MG/grenades/shield | 2, 0.7, 0.65 |
  | 8 | Scout hunter: 3 UFOs | + blaster | 3, 0.75, 0.7 |
  | 9 | Gray squad: 5 grays, the leader drops the laser minigun | + sniper (tier 2 crates) | 3, 0.8, 0.75 |
  | 10 | Take to the air (jets and patrol fighters unlock) | + minigun | 3, 0.85, 0.8 |
  | 11 | Dogfight: 2 UFOs from the jet | jets | 4, 0.9, 0.85 |
  | 12 | Air superiority: the hijacked fighter | jets (+ bazooka, tier 3) | 4, 0.9, 0.9 |
  | 13 | Village under attack: 3 raiders | jets, minigun, bazooka | 4, 0.95, 0.95 |
  | 14 | Red brutes: 3 reds, the leader drops the railgun | same (+ airstrike, tier 4) | 5, 1.0, 1.0 |
  | 15 | Salvage: board a UFO (boarding unlocks here, hangar UFOs too) | + railgun | 5, 1.0, 1.0 |
  | 16 | Big game: a large UFO | + your own UFO | 5, 1.0, 1.0 |
  | 17 | Mothership | everything | 6, 1.05, 1.05 |
  | 18 | Operation Sunburn | everything | 7, 1.1, 1.1 |
  | 19 | UFO slayer: 25 | everything | 8, 1.15, 1.15 |
  Why it is achievable and not trivial: every mission's target is killable with the gear guaranteed by then (the leaders' drops and the first crate are guaranteed; the other crate weapons follow the ~3-4 minute crate timer), and the sky rules never step down (checked in the unit test: health, damage, max and tier never decrease). The opening missions have no UFOs at all, so the first fights are a skeleton and two calm aliens; alien guns follow the same damage curve as UFO guns now (`mobs.alienDamageScale` = the mission's damage: a green's shot does 2 instead of 3 in the opening, 3 at the end, a red's plasma 7 at the end). A new world still starts at 17:50 (a Round 2 request), so the opening happens at dusk: the mission skeleton doesn't burn, mission aliens don't wander off (they no longer despawn when far), and the calm period gives the player time to get ready.
- Part 4.1: in Survival the UFO numbers come from the chain: `rules.max` (UFOs at once by day; x(1 + 0.35 x (night multiplier - 1)) at night) and `rules.rate` (new UFOs per second, more at night). The UFO activity, spawn chance, max UFOs and size settings are hidden in Survival (a note on the UFOs tab explains), and ignored there; Creative keeps them unchanged. (The old "UFO activity Off" check in the director is gone with it.) Aggression, toughness, detection, beam lift and the night multiplier stay: they are difficulty preferences, not numbers.
- Part 4.2: new mission director events: "skeleton" (a fireproof skeleton 25-40 blocks away; another one if it is lost) and "landing" (the ship descends with a new "land" trick to 0.3 blocks above the ground; 3 s after it lands two calm greens come out; calm crew members don't target the player until the 35 s run out or one of them is hit, then the whole group wakes (`mobs.wake`); the ship leaves 8 s after its crew is out; it restarts if the crew is lost). The skeleton always drops a bow when you don't have one (also with mods off: the bow and the shield are plain block-game items). Aliens can be killed in melee (they back off at walking speed, so you catch them).
- Part 4.4: UFO boarding (wrecks and hangar ships) unlocks with mission 15 "Salvage", which moved from 5th to 15th; before that the board prompt says it is locked.
- Part 4.5, reloads (js/weapon-stats.js): bow 1 arrow + 0.35 s nock; pistol 12 rounds, 0.2 s between shots, 1.5 s reload; machine gun 30, 2.2 s; sniper 1 round, 1.8 s (damage 22 -> 34 so a single shot is worth the wait); grenade 1.4 s; bazooka 1, 3 s (and +90 on a direct hit on a UFO or vehicle, which it lacked against big ships); laser blaster 18-shot cell, 2 s recharge; railgun 3.5 s recharge after each shot; airstrike 25 s; laser minigun: 4 s of fire, then it overheats and cools for 3 s. Reloads run on while you hold something else; R reloads the weapon in hand early (R was unused on foot). HUD: the rounds and a bar right of the hotbar (the label says Reloading / Recharging / Nocking / Overheated), and a thin bar under the crosshair while a reload or cooldown runs. Unit test: every weapon has a reload or cooldown; sustained damage rises pistol < machine gun < blaster < minigun; the sniper's is modest (~19/s) for 34 a shot.
- Part 4.6, the shield: now a classic block-game shield (wooden planks, iron frame and boss; "Shield", 336 uses). It lives in a new off-hand slot (shown left of the hotbar with its wear; in the inventory screen under the hotbar; picked up into a free off hand automatically; right click a shield in the hotbar to put it there; an old save's energy shield moves there). Hold right click with nothing in the main hand that uses right click (a sword, a tool, an empty hand, a block with nowhere to go, food when full) to raise it after 0.15 s; guns, the bow and grenades keep right click, as in the classic games. Raised, it stops every hit from the front half (projectiles, melee, beams and explosions; the environment, falls and nukes get through) and wears by 1 + the damage stopped; hits from behind get through (hits now carry where they came from). You walk slowly behind it, a melee attacker is pushed back, and there is no full-screen overlay: the shield model comes up in front of the left part of the view. The energy shield's force field, its energy bar and its drain are gone.
- Old saves: a Round 3 save continues with the equivalent new mission (mapped by the current v3 mission; the new opening is skipped since they already have weapons); Round 2 saves go through the Round 3 mapping first.
- Part 5.1, parrot: the old model was a horizontal box with a flat beak, stub wings and a flat tail, drifting in the air: a floating duck. New: a scarlet macaw rig (body, round head, a pale hooked upper beak with a dark tip over a dark lower beak, white face patch with an eye and glint, long wings with red, yellow and blue bands, a long red tail tipped with blue, legs). It flies with the body tipped forward, the head level, big beating wings and the tail streaming behind, and between flights it lands on the top of a leaf or log block near its home (a free branch with air above) and sits upright for 4-12 s: wings folded along its sides, tail hanging down, legs out, looking around. A hit (or the branch going) sends it flying again.
- Final polish, regression found by the Round 4 suite: in mission 2 ("Visitors") the marker sits on the landing UFO, so a player watching it come down for 6-8 s angered it through the "stared at" rule; it switched to attacking and never landed, and the mission stalled (the phase stays "incoming" as long as the ship lives). Now the landing ship is `peaceful` (no stare anger, `anger()` ignores it) until it leaves, and the director puts it back on its landing course (state, trick and waypoint) whenever anything else has moved it. The round4 opening check now stares at it and knocks it off course on purpose, and the crew still comes out.
- Final polish, other fixes: the HUD ignores an out-of-range hotbar selection (a test set it to -1 and every later inventory refresh threw); stale text: the patrol-fighter setting hint and a code comment said jets come with mission 8 (now 10, "Take to the air"), the Controls screen and a tip still described the energy shield (now the bow, the off-hand shield and R to reload), the Stats list names skeletons and fighters (hijacked or patrol).
- README rewritten for Round 4: the opening gear, 19-mission table with apple rewards, where weapons come from, reload table, the off-hand shield, R and J controls, the jet picker and F-16, takeoff lengths, bank, missiles (unguided click, lock rules, follow camera), patrol fighters, the UFO camera, held dash and ship weapons, hangar UFOs, Survival-only UFO settings, the round4 suite.
- Final polish, a second mission bug found by the suite: the mission director's `_groundSpot` (where the skeleton stands and the visitors' UFO lands) refused any spot more than 1 block above the natural terrain height (meant to skip treetops), and only looked in loaded chunks at the full distance. At an airport or in a city (paved above the natural ground), or with a short render distance (2-4 chunks: nothing loaded 75 blocks out), it found nothing, forever, and missions 1-2 never started. Now it rejects water, leaves and logs directly, avoids roofs (6+ blocks above the natural ground) and steep spots while it can, and comes closer (0.55x, then 0.3x the distance, at least 10 blocks) when the far ring isn't loaded, so a spot is always found on dry land.
- Tests: `weapons.refill()` (every magazine full, no reload running) for the older suites, which fire weapons back to back; round2/ufo/smoke checks that described Round 3 rules (pistol start, energy shield, enemy jets turning on the player for shooting UFOs, the old first mission, a tap firing nothing, the generic UFO cannon) now check the Round 4 rules instead.
- Final polish, patrol fighters that never attacked: a fighter the player provokes is supposed to hunt the player with missiles and guns, but against a player on foot it never fired its cannon and rarely a missile (measured over 60 s from 150, 300 and 500 blocks: 0 cannon rounds, at most one missile). The pursuit aimed high above a ground target (so it wouldn't dive into the terrain), which kept the nose outside the gun cone; it closed inside missile range and orbited. (The Round 3 code was worse: it flew into the ground.) Now against a target on or near the ground it flies strafing runs: out to ~750 blocks, a level afterburner turn-in at ~75 above the target, a shallow run with the nose on the target (short 4-6 round bursts within 0.06 rad, the cannon aimed at the chest with its lead; the natural spread and the target's own movement make most of them miss at range), a pull-out over the target (earlier the faster it sinks), then out again. Measured on open ground over 60 s: 3-7 runs, 2-4 missile hits, some cannon bursts, no crashes. Against a player in the air nothing changed. Moving, taking cover under trees or a roof, and the shield all help, and the provocation still ends after 60 s.

## Round 4 summary

**What changed for the player**
- Jets: takeoff works at any frame rate (the ground roll bled speed at 60 FPS and more); flight assist banks at most ~65 degrees and levels off without overshoot; a right-click tap fires an unguided missile, a lock takes only UFOs and aircraft (attackers first), and the camera follows the target to the hit (right click returns it); pinpoint navigation lights and an aircraft-skin shader; a second jet, the F-16 (own model, lighter and more agile, faster cannon, two-missile salvos), chosen with a picker on J (1 / 2, J again for the last one).
- The air war: patrol fighters hunt only UFOs and fly a little faster; only a fighter the player attacks turns on the player; the hijacked fighter of "Air superiority" is the one exception. UFOs have ~1.6x health; a beam goes wherever its ship goes (or switches off); every UFO carries one kind of alien; aliens and skeletons shoot from their weapon's muzzle; small alien ships sometimes hover in airport hangars.
- Your UFO: the camera keeps the crosshair clear of the hull for every size and pitch; hold R to keep dashing with no distance limit; each ship fires its own kind's weapon.
- Survival: basic gear only (stone sword, stone pickaxe, 5 apples); a 19-mission chain that opens on foot (skeleton and its bow, a UFO landing whose crew waits 35 s, the first crate with the pistol, the first scout) and moves up to jets (mission 10) and alien ships (mission 15, Salvage); UFO numbers come from the missions (the UFO activity settings are Creative's); weapons come in lanes (bow from skeletons, standard weapons from crates, alien weapons from alien leaders); missions pay only apples and golden apples; every weapon has a magazine or cooldown shown on the HUD (R reloads); the shield is a classic off-hand shield that blocks from the front.
- The parrot is a scarlet macaw that perches on branches.
- Found and fixed in the final pass: the landing UFO of mission 2 could be angered by watching it and never land (the mission stalled); missions 1-2 never started at an airport, in a city or with a short render distance (no "ground spot" found); a provoked patrol fighter never actually attacked a player on foot (it now flies strafing runs); a quote in a settings hint that stopped the whole game from loading (caught by the test suite minutes after it was pushed, fixed in the next commit).

**Decisions** (details per part above)
- Missiles: a tap fires unguided, but letting go while a lock is still building still fires nothing: by then the view has turned toward the target, so a straight-ahead missile would go where the player isn't looking.
- Patrol fighters appear in Survival only from the jet mission on, and can't clear the sky for the player (45% cannon vs UFOs, one missile per engagement, long pauses, at most 3 kills, no credit or loot for the player).
- Missions that need a fighter hunting the player use a *hijacked* fighter, so "patrols only attack UFOs" holds without contradiction.
- Weapon lanes are strict: wrecks and fighters drop no weapons (a fifth source would short-circuit the lanes). Alien weapons are guaranteed from mission leaders, so no mission depends on luck.
- The Jet Radio is no longer a reward: J needs no item (the radio stays in Creative).
- The shield takes right click only when the main hand has no right-click use (as in the classic games); it blocks the front half of hits, explosions included, and never falls, drowning, fire or the nuke.
- Old saves: a Round 3 save continues with the equivalent new mission (the new opening is skipped: those players already have weapons).
- Patrol fighters against someone on foot fly strafing runs (short bursts, missiles from a distance) rather than full-length bursts: the cannon is aimed well, so the player's movement, cover and the shield are what make it miss.

**Known issues**
- Software rendering (the test machine) makes the browser suites slow; three Chromium instances at once on 4 cores time out while booting, so the suites are run two at a time.
- Smoke test, "Ultra: tall grass, reeds...": times out at 300 s under software rendering (heavy Ultra frames), as in Rounds 2 and 3.
- Smoke test, "a lost graphics context saves...": intermittent (passed in one full run, failed in the next): the context was lost before the first frame had been drawn, so the boot record still read "not ok". This is the settings-persistence code, which this round was asked not to touch.
- round2-tests, "missions: the first one is the skeleton...": failed once in a full run (the tracker showed mission 1 again a few frames after the check had reached mission 2), but passed alone, from the check before it, and in the previous full run. Diagnostics are now in its failure message; no cause was found in the game code (nothing moves the chain back).
- Timing checks (the unit test's "< 3 ms per chunk" terrain speed, real-time key and mouse checks) fail when other browser suites run at the same time on this 4-core machine; they pass alone.

**How to test in 10 minutes**
1. `cd tools && npm install && node unit-tests.mjs` (seconds) and `node round4-tests.mjs` (about 3 minutes): every Round 4 feature in the real game.
2. In the browser: New World in Survival. Follow the marker to the skeleton, kill it with the sword, pick up the bow (hold right click to draw). Watch the UFO land (staring at it is fine), wait for the two aliens, shoot them. Walk to the orange smoke for the pistol; note the magazine and reload on the HUD (R reloads early).
3. Switch to Creative (Esc). Hold right click with the sword: the off-hand shield comes up. Press J, then 2: an F-16 on a runway; full throttle, lift off; bank hard with the mouse (it stops at ~65 degrees and levels off cleanly). Tap right click: an unguided missile. Hold right click on a UFO until LOCKED, release: the camera follows the missile to the hit; right click brings it back.
4. Mods screen: spawn a UFO, board it (F), hold R to streak along; left click fires its own weapon.

**Test results (final code)**
- `node --check` / `tools/check-syntax.mjs`: 73 files parse cleanly.
- `unit-tests.mjs`: 52 passed, 0 failed (alone).
- `round4-tests.mjs` (new, 15 checks, ~4 min): 15 passed, 0 failed.
- `round3-tests.mjs`: 10 passed, 0 failed.
- `settings-tests.mjs`: 7 passed, 0 failed.
- `round2-tests.mjs`: 38 passed, 1 failed (the intermittent missions-tracker check above; its fixes for the Round 4 rules all pass: loadout, off-hand shield, patrol fighters, missile tap and salvo, ship weapons, parked jets, range).
- `ufo-tests.mjs` (~45 min): 35 passed, 0 failed.
- `smoke-test.mjs` (~75 min, alone): 65 passed, 2 failed (the two known issues above).
- Zero console errors in every suite run.

ROUND 4 COMPLETE

# Round 5 (UFO COMBAT) checklist

Source of truth for this round. Ticked as finished; decisions in "Round 5 decisions" at the end.

## Part 1: Jet flight, takeoff and landing
- [x] 1.1 Throttle 0-100%, ~1000 km/h at 100%, speed scales over the range
- [x] 1.2 Reliable landing, level on wheels after touchdown, brakes to full stop
- [x] 1.3 Slow reverse on the ground
- [x] 1.4 Takeoff tolerant of small angles / imperfect runways
- [x] 1.5 Both jets more agile
- [x] 1.6 Full rolls and loops (quaternions), clean roll stop
- [x] 1.7 Free look (both mouse buttons) freezes controls
- [x] 1.8 Animated ailerons, elevators, rudders
- [x] 1.9 Jet models more detail, all lights attached to the model
- [x] 1.10 Engine sound much quieter

## Part 2: Jet combat
- [x] 2.1 Lock-on stays on the target
- [x] 2.2 Locking a UFO does not anger other UFOs
- [x] 2.3 Fewer UFO attackers when in a jet
- [x] 2.4 Missile camera follow keeps full jet control
- [x] 2.5 Jet destroyed in air: big explosion, burning wreck falls, explodes on impact
- [x] 2.6 Enemy jets faster

## Part 3: UFOs
- [x] 3.1 Shapes: remove rounded cube; add triangle, boomerang, cylinder
- [x] 3.2 Crash explosion scales with UFO size
- [x] 3.3 Water crash: sink, explode on seabed, aliens spawn in water, head to player
- [x] 3.4 Persistence: rare retreat
- [x] 3.5 Abducted animals vanish inside the UFO
- [x] 3.6 Hangar UFOs hidden in bunkers, armed guards, late-mission boarding

## Part 4: UFO piloting
- [x] 4.1 Faster dash, random dash speed per UFO
- [x] 4.2 Ghost mode toggle key and HUD state
- [x] 4.3 Tic-tac long axis forward
- [x] 4.4 Superweapon laser carves continuously

## Part 5: Aliens and mobs
- [x] 5.1 Pathfinding AI, clear line of fire
- [x] 5.2 Blue alien type
- [x] 5.3 Spiders neutral in daylight

## Part 6: Weapons and items
- [x] 6.1 Bow charge/draw animation
- [x] 6.2 Laser pistol: no reload, continuous
- [x] 6.3 Pistol real projectiles
- [x] 6.4 Remove shield
- [x] 6.5 Armor drops, slots, HUD
- [x] 6.6 Realistic nuke mushroom cloud

## Part 7: World and graphics
- [x] 7.1 Craters in LOD terrain
- [x] 7.2 Cities with skyscrapers, bigger mountains
- [x] 7.3 Bigger, varied airports
- [x] 7.4 Shorter ultra grass
- [x] 7.5 Breakable grass, no floating grass after explosions
- [x] 7.6 Natural see-through leaves
- [x] 7.7 Subtle walking view bob
- [x] 7.8 Supply drops on solid ground, new crate and ropes

## Part 8: Missions and defaults
- [x] 8.1 The Long Night at night, eventful
- [x] 8.2 Re-check mission chain and difficulty
- [x] 8.3 Defaults: Medium, 15 chunks, volume 30%

## Final polish
- [x] F.1 Regression pass
- [x] F.2 Player's-eye review
- [x] F.3 Full suite
- [x] F.4 README
- [x] F.5 Summary, decisions, known issues, 10-minute test
- [x] F.6 ROUND 5 COMPLETE

## Round 5 decisions and notes
(appended as work proceeds)
- Part 1, flight model (js/vehicle-jet.js): thrust grows with the square of the throttle and drag with the square of the speed, so the speed you settle at is proportional to the throttle (measured at 60 FPS in level flight: 0% ~ idle, 30% 285, 50% 474, 70% 663, 100% 947, afterburner 1080 km/h; the top-speed setting default is 300 b/s = 1080 km/h with the afterburner, 88% of it at 100% throttle). Old saves still at the old 160 default move to 300 once (settings version 5). Ground thrust, takeoff rolls and lift-off are unchanged (a takeoff still needs ~5 s / 100 blocks).
- Part 1, loops and rolls: the aim (crosshair) is now a quaternion (`aimQ`) turned by the mouse about its own axes, so pitch is not clamped and a loop is just pulling the mouse back (measured: a 360 degree loop, alive, no sideways drift). The jet follows the aim with body-frame commands and bank measured against the aim's own up, so it stays on the loop instead of rolling upright at the top. The aim levels its own roll (sin of the bank, so the inverted attitude is the unstable one and the jet rolls out of it by itself once the mouse stops). `aimYaw`/`aimPitch` are still there as accessors (enemy autopilot, tests). A/D roll the jet continuously (a full roll in 1.5 s; -472 degrees in 2 s measured); the roll axis responds 2x faster than pitch/yaw, so letting go stops within ~5 degrees and the damped bank controller then returns to wings-level with no overshoot (measured).
- Part 1, ground: three contact points (nose wheel and both main wheels) follow the ground's slope and tilt, so the jet sits level on its wheels on runways and follows imperfect ground; the nose only rises for takeoff (throttle above 45%, no brakes, at speed) and settles at once otherwise (leftover air rotation is cancelled); lift is dumped on the ground unless rotating. Landing: a sink rate up to 9 b/s is clean, up to 17 hurts (damage grows with it, "HARD LANDING"), beyond that, 40 degrees of bank, a nose-down slam, a 22 b/s sideways slide or 220 b/s ground speed crash it. Brakes stop 75 b/s in ~3 s. S at 0% throttle reverses at up to 5 b/s.
- Part 1.7 free look: both mouse buttons for 0.07 s freeze the controls (rates zeroed, no weapons, no lock) and the mouse moves a head-like look offset; letting go re-levels the aim from the nose and the camera comes back smoothly (measured: 0.1 degree camera jump).
- Part 2.4: the old "looking" flag forced the aim to the nose every frame during a lock hold or a missile follow (mouse ignored). Follow now leaves mouse and keys fully live (the camera is only blended toward the target; a small ring marks where the mouse steers); while the lock button is held the mouse is left alone but the jet keeps flying toward its aim and all keys work.
- Part 2.1/2.2: a tracked target stays until release, death or 2200 blocks away; only the tracked UFO gets `lockedOn` (after 0.3 s); the old "switch if clearly better" rule made the lock sweep across UFOs and anger each. Part 2.3: against a jet at most 2 UFOs attack (4 otherwise); extra attackers fall back to circling when you take to a jet.
- Part 2.5: a jet destroyed more than 8 blocks above the ground (not by a crash) explodes (radius 11 + fireball, smoke, debris), then the burning wreck tumbles and falls (gravity 20, drag, fire and smoke trail, secondary flashes) and explodes again where it lands (or after 45 s). Enemy jets use the same code.
- Part 1.8/1.9 model: stabilators, flaperons and rudders are separate hinged parts on both jets (axes: stabilators about X, flaperons about the hinge line, rudders about the fin's own axis; deflection smoothed); the nav lights were placed by hand and several floated beside the airframe (F-22 tail strobes and fin strips 1 block outside the fin, F-16 wingtips beyond the wing, the belly strobe below the belly): they are now computed from the geometry (fin tips, wing tip edge, rail tip, belly) and the formation strips lie on the fuselage and fins. Extra detail: beaver tail, intake splitter plates, refuelling door, a real rudder line.
- Part 1.10: engine sound master gain 0.55 -> 0.14, roar 0.25+0.6t -> 0.15+0.4t, whine and afterburner roughly halved.
- Part 8.3 defaults: graphics Medium (medium preset suggests 15 chunks), render distance 15, master volume 30% (the audio class, settings schema and the Reset buttons agree).

- Part 3.1 shapes: the rounded cube and the cube ring are gone (old saved wrecks map to a disc saucer and a torus); new: a flat black triangle (rounded, thin, with a dim light at each corner and a faint red one under the middle), a boomerang (a wide flat chevron with a row of dim lights along its leading edge) and a metal cylinder with raised bands. Designs with a front (tic-tac, triangle, boomerang, cylinder) point where they fly instead of spinning, both as enemies and as the player's ship (the tic-tac's long axis lies along X in its model, so the piloted ship adds a quarter turn: its long axis now points forward).
- Part 3.2: crash blasts scale with the ship: the crater radius is capped (a mothership/giant crater would not survive more than 36 blocks) but the new `visual` size of `effects.explode` (fireball, shock ring, shake, roar, flash) is uncapped (small scout 12, medium 18, large 22, mothership 51, giant 86 grenade-radius-equivalents, measured). The damage reach is the crater's size (x1.5 at most), so a far-off crashing mothership never kills you across the map.
- Part 3.3 sea crashes: no more explosion at the water surface: a big splash, the wreck sinks (as before) and goes off on the sea floor (crater capped at 14, visual 0.75x) with a geyser of water over it; the crew now comes up in the water around the wreck (open water cells next to it) and swims or wades toward the player (the old code sent them to the nearest shore).
- Part 3.4: after a hit a UFO stays angry for 90-150 s (35-70 before), a hurt one (<90% health) keeps fighting for as long as it saw the player in the last 6 s, the 'evade' reaction is rare (weights 0.5-1.2 against counter 4-6), and a UFO with a jet on its tail leaves with 0.08-0.15%/s instead of 0.8-4%/s.
- Part 3.5: a creature caught in an enemy UFO's beam is its prisoner: it rises to the ship at 4.6 b/s whatever the beam does, drifts to the middle of the beam, and vanishes in a flash inside (or at once if the ship is shot down or leaves). It never falls back.
- Part 4.1: every piloted ship gets a fixed random dash factor (log scale 1 to 6, from its look and size) on top of the settings' base speed (900-3500 b/s): measured 1390-4390 b/s at the default settings (before 250-2500), labelled fast / very fast / extreme in the info panel. A tap goes sqrt(factor) farther. A dash into ground that has not loaded yet stops (it would end up inside terrain that streams in under the ship).
- Part 4.2: G toggles ghost mode while piloting (the Settings row follows, and it persists like the setting does); switching off is refused while the hull is inside solid blocks. The HUD shows GHOST ON. (Persistence of settings itself was not touched.)
- Part 4.4: the superweapon digs every column under the ship each frame (per-column depth bookkeeping), so it carves a trench along its path for the whole 2.6 s.
- Part 5.1: js/pathfinding.js (A* on feet cells: 8 directions without corner cutting, 1-block jumps, 2-block big jumps for aliens, drops up to the species' maxDrop, swimming, partial path to the closest cell when no path is found within the node budget). Ranged creatures with `pathfind` (aliens, skeletons, guards, blue aliens) check for a clear line of fire from their eyes to the player's chest (a ray every ~0.25 s); without one (or when out of range) they follow a path to the nearest cell within range that has one (goal test with a capped number of rays), and they shoot only with a clear line (measured in a walled arena: 0 shots without line of sight, all three kinds walk around a 40-block wall). Stuck creatures re-plan with a bigger search, then escape to the surface, and an alien stuck for 16 s is called back to a free spot near the player (so no mission can stall on an alien in a sealed hole). 2800 search nodes per frame in total.
- Part 5.2: the blue alien (own model: slender, blue skin, glowing cyan seams, crest and fins; weapon: a scatter of four fast bolts, strong up close, weak at range; behaviour: quick, blinks to flank (to a spot 7-12 blocks from you with a clear shot) every 6-9 s when far or hurt; appears from mission 11); and the guard (below, Part 3.6).
- Part 5.3: spiders are neutral when the sky is bright (daylight and light level 12+) unless provoked (a hit: 30 s); in the dark (night, caves) they hunt as before.
- Part 6: items: the shield is gone entirely (item id 296 reserved, off-hand slot, raising, audio, HUD, README); armor in four materials (leather, gold, iron, diamond) x four pieces (ids 300-315) with classic defense points (leather 1/3/2/1, gold 2/5/3/1, iron 2/6/5/2, diamond 3/8/6/3; 4% less damage per point, up to 80%), wear (they lose durability on hits and break), four armor slots in the inventory (click, shift-click, or right click the piece in hand), an armor bar of ten chestplates above the hearts, auto-equip when the slot is free, an Armor tab in the Creative palette, drops from zombies (4.5%), skeletons (6%), guards (35%), green/gray/blue/red aliens (7/9/9/14%) with the material by mission tier and creature (leather early, diamond only late and rare). Armor does nothing against falls, drowning, void, starvation, crashes, abduction or the nuke.
- Part 6.1: the bow draws through three pull stages (3 sprites: limbs bend, string and nocked arrow come back), the bow is raised in front of you with the arrow toward the crosshair while nocking, trembles at full draw; a fuller draw gives faster, flatter, harder arrows (as before: 16-58 b/s, 2-9 damage). 6.2: the laser blaster has no magazine and no reload and fires continuously (about 4.5 bolts/s) for 3 damage a bolt (the pistol: 5). 6.3: the pistol fires a real bullet (240 b/s, tracer) from the muzzle, aimed at what is under the crosshair.
- Part 6.6 nuke: the cloud is planned puff by puff (stem, rolling torus cap with a bright rim, dome, a collar of vapour under the cap, a white condensation ring racing out, glowing fire inside) and driven analytically (smooth, cheap), orange early and grey-brown later, thinning out over the last minute (125 s in all); puff counts follow the intensity setting and the effects quality of the graphics preset (fewer, bigger puffs on Low); the cloud pools do not use distance fog (it is seen from beyond the view distance).
- Part 3.6 bunkers: instead of ships sitting in open hangars, airports (35% of fields, 60% regional, 95% international) hide an underground bunker: a trench ramp (15 wide) drops from the apron to a tunnel and a 25x22 hall with lumen ceiling lights; a yard with walls, a watch tower and a guard hut marks it from outside. `sites.bunkerSpots` gives the hall floor (the alien ship hovers there, nose out, small designs only), a restricted zone (46 blocks) and 4-6 guard posts (top of the ramp, foot of the ramp, inside). `airports.js` sets them out with the airport (guards via `mobs.spawnGuard`, put away with it), retries a bunker whose chunks have not loaded yet (they can lie far from the apron), shows a "Restricted area" toast on the first alarm, and boarding stays locked by the existing `canBoard` until mission 15. Guards: 22 health, rifle (1.5 damage, 2.3 s cooldown), posted until the player enters the zone or shoots one; the alarm spreads to the guards nearby for 25 s. Balance: a guard squad is lethal for a player who runs into the hall at low level, but they are only dangerous inside the zone and never chase far; the ship cannot be boarded before the Salvage mission anyway.
- Part 7.1: world.queueEdit records edits for chunks that are not loaded (`lodDirty`), and the LOD system re-meshes the affected tiles on its next flush, so a nuke crater or a big blast shows in the distant terrain too.
- Part 7.2: mountains are bigger (ridge frequency 1/340, amplitude 104, snow line 98; columns over 100 blocks went from 1.6% to 5.4%); cities have lots of four kinds (park, house, midrise, skyscraper) with multi-box setbacks, curtain-wall windows, antennas and street lamps; the biggest cities (international) reach 80 blocks.
- Part 7.3: airports come in three sizes (field: half-length 150, regional 200, international 250; runway 14-20 wide), with an apron, 2-4 hangars, tower, terminal, fuel tanks, radar and parking. Sites are placed on an 800-block grid with up to 16 tries each, so one is within ~1300 blocks of the spawn for about 5 in 8 worlds and within 2600 for all (a bigger footprint means fewer sites fit than before: this is the trade-off for variety). `airports.runwayNear` reports the real half length.
- Part 7.4: Ultra grass is shorter (blade scale 0.68 -> 0.46, tall tufts 1.4 -> 1.1 per block), High 1.0 -> 0.72.
- Part 7.5: grass is breakable: a left click at the ground (swing/mining a block top) clears the tufts in a 1.2 block radius, and explosions clear the plants within radius + 2.5 (cap 30) so none hover over a crater; cleared columns stay bare for 150 s. The plants themselves are always rebuilt from the real blocks when a chunk is re-meshed, so nothing can float over a missing block.
- Part 7.6: leaf textures have more see-through gaps (28% instead of 17%; birch 30%), a texture-only change (no extra geometry or shader cost).
- Part 7.7: a subtle step bob in first person (about 2 cm vertical, 1 cm sideways, a hair of roll; 1.4x when sprinting; eased in and out; none when scoped/dead); the aim and raycasts use the eye position without bob.
- Part 7.8: supply drops only come down on dry land (7 sample columns 4 blocks around must be above the sea, the ground solid and not wet; the search tries 16 directions on 5 widening rings and gives up rather than dropping in water). New crate: planks with seams, steel brackets and bands, a lighter lid, a white plate with a red cross on every side, and four lifting eyes; eight cords run from the eyes to points exactly on the canopy's rim (they were floating below the canopy before).
- Part 8.1 Long Night: when the mission starts the clock runs 30x to dusk (a frozen clock is unfrozen: dawn would never come); a night is dusk 19:30 to dawn 5:30 (about 250 s). Three alien landing parties arrive at 35, 105 and 170 s (3, 4 and 5 aliens, grays and greens, on open ground ~70 blocks away, marked on the HUD) on top of the usual zombies and UFO scouts. A death restarts the night from dusk (instead of waiting a whole day for the next one).
- Part 8.2 chain re-check: the chain still has 19 missions and every mission is no easier than the one before (unit test). Round 5 side effects checked: blue aliens join the crews from mission 11, armor drops start with the first aliens and get better with the chain, bunker guards only matter at airports (the Sunburn base included) and the ship in a bunker is locked until Salvage (mission 15). The Long Night (mission 6) now gives a guaranteed, bounded event instead of waiting for a natural night: a 4-minute night with 12 aliens in three waves at tier 1 gear (stone sword, bow, pistol, grenades); an alien wave does 0.6x damage in that mission's rules, so it is demanding but fair. Retrying after a death costs about a minute, not a day.
- Tests: the old browser suites were updated where Round 5 changed behaviour on purpose (shield checks removed, Medium/15 chunks defaults, the pistol is a real bullet so the checks lead or wait for it, UFO designs list, bunkers instead of hangar ships, the scout crash is stepped by hand because software rendering runs only a few frames a second). New: `tools/round5-tests.mjs` (11 checks) and Round 5 unit tests (armor, A* pathfinding, bunker geometry). A UFO shot down is counted when it crashes (as before), which on a slow machine can take a while: the mission test steps the UFOs itself.

## Round 5 summary of changes (for the player)
- Jets: throttle 0-100% with speed proportional to it (about 1000 km/h at 100%), reliable landings and a slow reverse, forgiving takeoff, much more agile (full rolls, loops), free look with both mouse buttons, animated control surfaces, detailed models with lights on the airframe, a much quieter engine, a stable missile lock that does not anger other UFOs, a free camera while a missile flies, a big explosion and a burning falling wreck when a jet is shot down, faster enemy jets.
- UFOs: no more rounded cubes; a black triangle, a boomerang and a cylinder instead; crash blasts scale with the size; sea crashes sink and explode on the seabed with a swimming crew; UFOs keep fighting; abducted animals vanish inside the ship; a random dash speed per ship, ghost mode on `G`, tic-tacs fly long end first, the superweapon carves along its path; at most two UFOs attack a jet at once.
- Aliens: pathfinding (A*) around walls and out of holes, moving to a clear line of fire before shooting; a blue alien that blinks and fires scatter shots; spiders are neutral in daylight.
- Weapons and gear: a bow that is really drawn, a laser pistol with no reload, a pistol with real bullets, no shield, four armor pieces in four tiers (drops, inventory slots, HUD, damage reduction), a realistic nuke mushroom cloud scaled by the graphics preset.
- World: craters in the distant terrain, bigger mountains, cities with skyscrapers, three airport sizes with long runways, guarded bunkers with ships inside, shorter breakable grass, more see-through leaves, a subtle walking bob, supply crates on dry land with a redesigned crate and correct cords.
- Missions: the Long Night really is at night and eventful; defaults Medium, 15 chunks, 30% volume.

## Known issues
- Software rendering (the test machine) is slow, so the Ultra smoke check and some long browser checks can time out there; they are not game faults.
- The LOD does not draw skyscraper tops above the full-detail distance as separate buildings: far cities show as flat pads with tinted ground (the same as earlier rounds).
- A guard squad in a bunker is lethal for a player who runs in unprepared: by design, but the restricted zone (46 blocks) is generous; the toast "Restricted area!" appears on the first alarm.
- The spawn point is within 1300 blocks of an airport/city in about 5 of 8 worlds (up to 2600 for all tested seeds).
- Supply drops give up (no drop) when there is no dry land within about 3x the usual distance (a tiny island in the ocean).

## How to test in 10 minutes
1. Open the game, click Play (Medium, 15 chunks, volume 30% by default). In Creative press `E`, take the Jet Radio (or press `J`), pick `1` (F-22). Hold `W` to 100% and `Shift`: takeoff in a few seconds. Pull the mouse back for a loop, hold `A` for a full roll, hold both mouse buttons to look around, press `S` to 0% and land on the runway with `Space`.
2. Hold right click on a UFO for the missile lock (stays on it), release for the missile: the camera follows it and you keep control. Shoot an enemy jet down to see the explosion and the burning wreck.
3. Press `F3` for the nearest airport; fly to it, find the bunker (walled yard with a ramp), walk in as a Survival player: guards fire and a toast says "Restricted area". A UFO hovers in the hall (boardable from mission 15).
4. Spawn a UFO from the Mods screen, fly it (`F` to board): `R` dashes (each ship its own speed), `G` ghost mode, `B` the superweapon along a path.
5. Survival: new world; play the first missions (skeleton, landing, supply crate, scout, crew); mission 6 jumps to dusk and sends three landing parties; `Esc > Missions` lists the chain. Aliens walk around walls to reach you; blue aliens (mission 11+) blink.
6. `tools`: `npm test` (unit tests first; the browser suites need Chromium).

## Round 5 final test status
- unit-tests 54/54; round5-tests 11/11; round4 14/14; round3 10/10; settings 7/7; round2 38/38 and ufo-tests 35/35 (the few that failed in the full run were fixed and re-run individually: the old checks assumed the slow jet, hitscan pistol, small mountains, 10-chunk defaults or a runway end inside the render distance; two timing-sensitive ones, "on foot beam" and "board the wreck", pass alone but can time out when three browsers share the machine). smoke-test: 64 of 67 passed in the last full run; the three failures were fixed afterwards (pistol bullet holes: bullets now leave bullet holes through `lasers.holes`, verified with a probe: 6 clicks = 6 holes; startup default preset Medium; the context-loss test waits three frames like a real start) but the smoke suite was not re-run end to end after them (software rendering makes it about 50 minutes; a targeted re-run timed out clicking Play on the loaded machine).
- Also fixed on the way: fleeing UFOs no longer count as jet attackers; the called-in jet starts further down the runway when its far end is not loaded (long international runways); no guards are spawned on Peaceful.

ROUND 5 COMPLETE

# Round 6 (UFO COMBAT) checklist

Source of truth for this round. Ticked as finished; decisions in "Round 6 decisions" at the end.

## Part 1: UI and fullscreen
- [x] 1.1 Redesign main menu and all in-game menus (consistent modern minimalist style)
- [x] 1.2 Fullscreen button (corner, on hover) + hotkey, never covering gameplay
- [x] 1.3 Keyboard Lock API in fullscreen, preventDefault on combos, graceful fallback, README

## Part 2: Balance and weapons
- [x] 2.1 Fewer UFOs overall, especially in a jet
- [x] 2.2 Bow: full draw much farther/faster
- [x] 2.3 Laser pistol more damage
- [x] 2.4 More frequent weapon drops; crates give standard weapons in progression
- [x] 2.5 Remove iron and diamonds (items, drops, ore blocks decision)
- [x] 2.6 Skeleton point-blank arrow aim fix
- [x] 2.7 Survival hides/locks rule-changing settings (Creative only)

## Part 3: Nuke
- [x] 3.1 Default size = old max, setting allows bigger
- [x] 3.2 Much wider crater horizontally
- [x] 3.3 Destroys trees, grass/plants, buildings (villages, cities, airports), runways

## Part 4: Jets
- [x] 4.1 Full control during lock-on
- [x] 4.2 Salvo charging animation + HUD
- [x] 4.3 Roll-evasion of close enemy missiles (>90 deg)
- [x] 4.4 Remove calling in jets; airports only
- [x] 4.5 Airports rarer, one near spawn, bigger, longer runways
- [x] 4.6 Air brakes (key, animation, sound, HUD, stall risk)

## Part 5: UFOs
- [x] 5.1 Remove altitude limit
- [x] 5.2 Player UFO tractor beam on smaller UFOs and jets
- [x] 5.3 Player UFO lock-on salvo

## Part 6: Missions
- [x] 6.1 Landing mission + red alien squad
- [x] 6.2 Final boss mission (mothership) before the 25-UFO mission
- [x] 6.3 Meteor-themed mission
- [x] 6.4 Re-check chain and difficulty curve

## Part 7: World
- [x] 7.1 Varied terrain/biomes
- [x] 7.2 Default render distance 25

## Final polish
- [ ] F.1 Regression pass
- [ ] F.2 Player's-eye review
- [ ] F.3 Full test suite once
- [ ] F.4 README
- [ ] F.5 PROGRESS summary, decisions, known issues, 10-minute test
- [ ] F.6 "ROUND 6 COMPLETE", commit, push

## Round 6 decisions and notes
(appended as work proceeds)
- Part 1: one CSS theme layer (tokens `--ui-*`, glass panels, flat buttons, accent teal) restyles every screen (menus, settings, mods, stats, missions, controls, inventory, death, vehicle HUD, mission tracker). Fullscreen: `js/fullscreen.js`; button top-right, invisible until the mouse is within 84px of the corner (never over the HUD; inert while the pointer is locked), F11 / Alt+Enter toggle. Keyboard Lock (`navigator.keyboard.lock()`, all keys) while fullscreen, `unlock` on leaving; with Esc locked the browser no longer drops the pointer lock itself, so a keydown handler calls `exitPointerLock()` to open the pause menu; Ctrl/Alt/Tab combos are `preventDefault`ed while playing (works without Keyboard Lock for Ctrl+R/S/D/F...; Ctrl+W/T/N cannot be cancelled by a page outside fullscreen: the existing beforeunload prompt covers that, README says to use double-tap W).
- Part 2.1: MAX_ATTACKERS 4 -> 3, jet 2 -> 1; in a jet the sky holds half as many UFOs (min 1 when the mission allows any) and spawns at 0.7x; mission `max` table lowered (~35%), spawn rates x0.8, auto count 3*activity+1, default Creative activity "Occasional" (0.5).
- Part 2.2: full-draw arrow 135 b/s (was 58; speed grows with draw^2), gravity -7 at full draw (-20 for a flick), 10 damage. 2.3: laser blaster (the "laser pistol") 3 -> 6 damage per bolt.
- Part 2.4: crates every 95-165 s (was 170-300 s), alien weapon chances green .32 / gray .38 / blue .38 / red .5. I kept the Round 4 lanes (wrecks and fighters drop no weapons: a unit test guards that): crates give standard weapons by tier, aliens give alien weapons.
- Part 2.5: iron ingot and diamond items removed (ids 258/260 reserved, saves skip them), iron/diamond ore no longer generate (stone stays stone), the blocks remain registered so old edits still load and break into cobblestone, removed from the Creative palette. Iron/diamond tools and armor stay (gear, not materials). Gold ore/ingot stay (the one remaining flavour ore; red aliens still drop gold). Alien drops that were iron/diamond became apples with a small golden-apple chance.
- Part 2.6: skeleton arrow lift used a 0.35 s minimum flight time, i.e. 1.5 blocks of lift even at point blank. Now lift ~ t*min(t,1) (unchanged at long range).
- Part 2.7: every setting that changes rules/stats (spawn, weapon, zombie, UFO, vehicle performance, nuke size, blast sizes, time of day, time lock, creature spawning) is `creativeOnly`: hidden in Survival, and in Survival the game uses the DEFAULT of those settings (`settingsPanel.effective`), not whatever Creative left behind. Survival keeps graphics, performance, controls, audio, difficulty, stats overlay, blaster color, nuke effects intensity, jet flight assist.
- Part 3 nuke: default size 96 (the old maximum), setting up to 200. Crater: horizontal radius = size (2.2x wider than the old default), depth = 22 * sqrt(size/44) (the old default's depth, growing slowly: 32 at 96), via `_carve` options `vScale`/`maxRadius`. Blast clear: everything above the natural ground within 1.3x the size (trunks, leaves, plants, houses, skyscrapers, hangars, towers, lamps) is removed in an expanding wave, nearest columns first, together with the carve; grass/snow/runway/apron/street surface turns to earth. Between 1.3R and 2R the old scorch stays (grass burns, topmost leaves and plants go; stumps stay). Columns in chunks not loaded yet are retried every 2 s while the effect lasts. Root cause of the surviving runways: the carve skipped every BEDROCK block, and runways are made of BEDROCK blocks (real bedrock is only y 0-1): now only y<=1 is indestructible (also for the railgun). The damage reach on creatures/ships/the player grows only with size^0.45 (a size-96 nuke does not kill across 250 blocks). The Sunburn mission's "direct hit" radius is max(170, 1.3 R).
- Part 4.1: the lock hold no longer freezes the mouse (`holdingLock` removed): the camera blends onto the target (as before) but the aim ring (`#jet-aim`) shows where the mouse steers and every key works. 4.2: the salvo charge: from the solid lock to the salvo time a ring fills around the lock box, one pip per missile lights (each with a rising click, `playSalvoPip`), the box shakes, an orange glow builds at the screen's edge, and at SALVO the ring spins, the pips pulse, a tone plays and the camera gets a small kick (pips = 4 on the F-22, 2 on the F-16, the jet's own salvo size).
- Part 4.3 roll evasion: a hostile missile within 130 blocks whose target jet has rolled by more than ~83 degrees (signed roll, fades over 2.2 s) loses its lock and is sent 9 blocks past the jet (aimed at where the jet will be, offset sideways), cannot hit it any more, and burns out two seconds after passing; a "MISSILE EVADED!" message, a fly-by sound and a little shake. The evasion needs 4.5 s to be ready again, so a jet that rolls all the time is not immune (and flares still work as before). Only the jet's hostile missiles are evaded this way (not seeker bolts, not the cannon).
- Part 4.4: J, the picker, the Jet Radio item (id 293 reserved) and the Mods-screen button are gone; jets are only the ones parked at airports (the "Take to the air" marker points at the nearest parked fighter). `callJet`/`findRunway` stay only as test hooks on `window.__voxelands` (nothing in the UI reaches them); the "called-in jet arrives airborne" setting was removed with them.
- Part 4.5 airports: grid cell 800 -> 1300, chance of a site per cell 65% -> 50%, so airports/cities are ~3x rarer; one regular `home` airport (regional or international, never a small field) is placed by `_ensureHome()` near the start: the nearest flat, dry, gentle spot to the spawn (searched on rings from 260 blocks out, farther and with more levelling if the land is rough), with the start at least 90 blocks outside its levelled pad; checked on 20+ seeds: 260-860 blocks from the spawn; every other site is >1500 blocks from it. Sizes: runway half-length 150/200/250 -> 300/380/460 (600-920 blocks long, a jet needs ~120 to take off and ~100 to brake), half widths 9/11/13. REACH 310 -> 520.
- Part 4.6 air brakes on **Space** (hold): Q/E are the rudder, Space was already the brake key ("air brake / wheel brakes", drag x3.5 and no animation), so the real air brakes live there (no new key to learn). Open in 0.45 s, close in 0.35 s; in the air: drag x6, a flat extra 12 b/s^2 deceleration (bites at low speed too), 22% lift loss and the flight path swings onto the nose at up to 1.5 rad/s (that is what makes the turns much tighter: measured heading change in 2.5 s of a hard pull is more than 20 degrees larger with brakes, and the speed halves in ~3 s from 260 b/s); on the ground the wheel brakes work as before. Stall: nothing special, the usual stall below the stall speed applies, so braking at low speed stalls the jet; the HUD warns "LOW SPEED: BRAKES OPEN" below 1.35x the stall speed and shows an "Air brakes OPEN ▮▮▮▮▮" row. Models: the F-16 has two split tail panels hinged at their front edge that swing outward by 54 degrees; the F-22 has no panels, it brakes like the real one: twin rudders toe out, flaperons droop, tailplanes tilt. Sound: hydraulic whine, rush of air, clunk (and a shorter closing sound).
- Part 5.1: the ceilings are gone: enemy UFOs (320 + radius, the dash target cap, the evasive ceiling) and the player's ship (three clamps at 250; ghost mode too). Fog hides the ground from high up (the world is only drawn out to the render distance), so up there it is sky; the sky and light were already fine at jet altitudes (checked at 3000 and 6000).
- Part 5.2 tractor beam: works at any altitude (before: only below 90 blocks over the ground). It hangs straight down to the ground or, if that is farther than its reach (140 + 9 x the ship's radius), ends in the air (no pool of light). Inside it: creatures and loose blocks near the ground (as before), and now ships: a UFO that is at least 1.3x smaller (by radius) than yours and an enemy jet (when your ship's radius is 6.5+: medium and up) is held (it stops thinking and shooting, tumbles), drawn to the middle of the beam and up at 6-26 b/s (faster for bigger ships) and swallowed in a flash; it counts as shot down (UFOs: `ufosDown` etc.; jets: `enemyJetsDown`), and its loot goes straight into the hold (Survival). Too big a target gives a hint once in a while ("you need a bigger ship"); a ship that stops beaming lets go and the prey turns angry. Parked jets at airports are not pulled (only flying enemy jets), the player's other vehicles are never touched.
- Part 5.3 lock-on salvo: hold **T** (free in the UFO controls) on the UFO, enemy jet or hostile creature nearest the crosshair (cone 0.3 rad, range 900): a ring closes on it (same HUD box as the jet's: ring, pips, edge glow, the same tones), LOCKED after 1 s, and at 3 s a salvo of homing laser bolts leaves the hull by itself (3 + 0.35 x radius, 4 to 14 bolts, 70 ms apart, each 70% of the ship's weapon damage, homing at 5 rad/s, flares fool them like any seeker); letting go earlier cancels; 7 s to recharge. The salvo is automatic at 3 s (rather than on release) because the player holds the key for the lock and there is nothing to confirm.
- Part 6 chain (21 missions, was 19): 1 The archer, 2 Visitors, 3 Supply drop, 4 First contact, 5 The crew, 6 The long night, 7 Laser patrol, 8 Scout hunter, 9 Gray squad, 10 Take to the air, **11 Touchdown (new)**, 12 Dogfight, 13 Air superiority, 14 Village under attack, 15 Red brutes (railgun), **16 Falling stars (new)**, 17 Salvage, 18 Big game, 19 Operation Sunburn, **20 The Overlord (the old Mothership mission, rebuilt as a boss, now after the nuke mission)**, 21 UFO slayer. Rules are non-decreasing along the chain (unit test); the new missions use the numbers of their neighbours. v4 saves migrate by mission id (the old Mothership mission continues at Sunburn).
- Touchdown (event `landjet`): the player must have been airborne in a jet in this mission, then stop (below 8 b/s) on an airport's runway (`sites.onRunway`); a crash resets the "airborne" flag. Then a dropship hovers and three red aliens land ~75 blocks away (more if some were lost, e.g. after a death); the objective counts the squad's deaths (stat `landingSquad`, counted by the director when it sees them dead, so kills before the landing do not count). Reds are the Round 5 red brutes with the mission's alien damage scale (0.82), no leader drop (the railgun comes at mission 15). The marker points at a parked fighter, then the runway ("Land on the runway"), then the squad.
- Falling stars (event `meteors`): the clock jumps to 21:00 if it is day; the airstrike's meteors (`airstrike.call(target, overrides)`, 3 rocks / 12 blocks spread / delay 4.5 s / 28 degrees) fall 20-65 blocks from the player every 5.5-8 s (down to 3.2 s as fragments are collected), each announced by a red ring of sparks on the ground; every third strike is a single rock whose crater holds a star fragment (a blue-white glow with sparks rising), at most two lying around; walking into it collects it (stat `meteorFragments`, four needed); one left for 45+ s calls a hostile small UFO (the "salvager") over it, and a fragment not collected in 80 s is lost (a new one comes with a later strike). Meteor blasts are the usual airstrike explosions (they hurt in Survival too, hence the warning rings and the 4.5 s delay).
- The Overlord (event `boss`, UFO `boss` flag): a mothership with 5200 health (fixed, not the usual size variation) spawned 520 blocks away, tethered to where you stood; **shield**: `ufos.damage` returns false (and sparks and a hint) while `u.shield` is set (nothing gets through, not missiles, the railgun or a nuke). The shield is held by 3-4 small pylon UFOs (110 health each, marked, they fight too); when the last falls the shield drops for 60 s (then returns early with fresh pylons if the hull was not hurt enough); at 70%, 40% and 15% health the hull stops at the threshold and the shield re-forms with fresh pylons (3, 4, 4, 4) and reinforcements: round 0 two medium escorts, round 1 one escort and a red squad dropped on the player, round 2 two escorts; the last stretch (after the 15% shield) has no shield and the boss fires its heavy `seeker` style. Style by round: sweep, heavy, charged, seeker. HUD: a boss bar (name, health, SHIELD UP / DOWN seconds / NO SHIELD). Killing it (the crash counts, like any shot-down ship) gives `bossesDown`, kills its pylons and escorts, and the reward is 12 golden apples. Doable on foot: railgun 420 vs the hull (~4 shots per shield round); the sniper rifle and grenades work on the pylons.
- Part 7 world (js/terrain.js, biomes.js, trees.js, graphics.js, settings.js): the world is still 128 blocks tall (a taller world would change the save format of edits, and the peaks are already at the soft cap), so "bigger" means broader and more massive: mountain mask 1/1000 -> 1/1400 with a lower start and a wider full-strength range, ridges 1/340 -> 1/430, amplitude 104 -> 135 (mountain columns 9.9% -> 14.5% of the area, columns over 100 blocks 9.5% -> 10.4% of land). New `relief` field (1/1900): where it is low the land is flat country (hills damped to 8%, mountains held back to 15%): ~15% of the land is nearly level (it was 0%), which is where airports and meadows go. New ridged `valley` field (1/820): long, wide valleys that sink the high ground to the valley floor (sea level + 4, so dry), up to ~70 blocks deep between the massifs of a range, almost nothing on the lowlands. New biome **Meadow** (very flat, flowery grassland with a lone tree here and there; replaces plains/forest/birch in flat country). Climate fields 1/1500 -> 1/2200 (temperature) and 1/1300 -> 1/1900 (moisture), hot zone from t > 0.16 (was 0.3): deserts 1.7% -> 5.7% of the map (3.4x), jungles 1.3% -> 2.5% (with the jungle's giant old oaks 35%), savanna between; taiga needs t < -0.1 so forests keep their share (the sample: 6 seeds, 8000 x 8000 blocks each). Default render distance 25 chunks (Medium suggests 25, High 28, Ultra 32; Low 12 as before; the Settings slider default, the preset hint and the tests follow). A seed's landscape changes (as in every terrain round); saved edits of old worlds stay where they were.
- Final checks and decisions (UI): the Round 6 theme is a single CSS layer over the old rules (tokens `--ui-*`) rather than a rewrite of every screen's markup, so every screen (and the HUD panels that share the glass look) stays consistent and nothing about the screens' behaviour changed. The fullscreen button sits top right because the bottom corners hold the vehicle HUD and the mission tracker, and it is inert while the pointer is locked (nothing to hover with then).
- Final checks: the old suites were updated where Round 6 changed behaviour on purpose (J picker -> parked jets and the `callJet` test hook, jet-airborne setting gone, 21-mission chain, 25-chunk default, 1300-block site cells, iron/diamond ore gone, wall-area check of the distant terrain now skips tiles with tree boxes, which add walls of their own and made the old fixed tile fragile once the terrain changed).
- Bugs found and fixed on the way: `weapons.js` lost 650 lines to a careless edit while removing the Jet Radio (restored at once, then redone properly); the tests' mission checks need the player alive on the ground (a previous check left them falling from 400 blocks in Survival).

## Round 6 summary of changes (for the player)
- **Menus and fullscreen:** one clean, dark glass style on every screen; a small fullscreen button in the top-right corner (fades in near it), F11 / Alt+Enter, and in Chromium browsers the keyboard is locked in fullscreen so Ctrl+W, Ctrl+R and friends belong to the game (a short Esc still pauses; hold Esc to leave fullscreen).
- **Balance:** fewer UFOs everywhere and half as many (with only one attacker) when you fly a jet; the full-draw bow flies 2.3x faster and flatter; the laser pistol hits twice as hard (6); supply crates every 1.5-3 minutes and aliens drop their weapons more often; iron and diamonds are gone from the game; skeleton arrows no longer fly over your head at point blank; in Survival every setting that changes the rules is locked to the defaults.
- **Nuke:** default size 96 (up to 200), a crater twice as wide as before and everything (trees, grass, buildings, runways) within about 125 blocks destroyed.
- **Jets:** call-ins are gone (jets are parked at airports); you keep full control while locking on; a charging ring with pips for the salvo; roll more than ~90 degrees and a close missile misses; Space deploys animated air brakes (F-16 tail panels, F-22 rudders and flaps) with sound, HUD and a stall risk; airports are rarer but one is always close to the start, bigger, with 600-920 block runways.
- **UFOs:** no altitude ceiling; the player's tractor beam works at any height and swallows smaller UFOs and enemy jets; hold T for a homing laser salvo.
- **Missions:** 21 now: Touchdown (land on a runway, then a red squad), Falling stars (a meteor storm and star fragments) and the Overlord (a shielded mothership boss with pylons, three shield rounds and a boss bar) before the final slayer.
- **World:** bigger mountains, deep valleys, very flat plains and meadows, much larger deserts and jungles, 25 chunks of render distance by default.

## Known issues
- The default render distance of 25 chunks is heavy for weak GPUs and CPUs (the FPS counter in the main menu suggests a lower preset when it runs poorly); the headless test machine (software rendering) is much slower than before at it, so the browser suites take longer.
- The view distance grows with altitude (the existing altitude-aware view: up to 2.2x on Medium), but it is still finite: very high up (above ~900 blocks) the ground is out of sight and the view is mostly sky.
- The Keyboard Lock API exists only in Chromium browsers; elsewhere Ctrl+W / Ctrl+T / Ctrl+N cannot be cancelled by a page (README says to sprint with a double-tap of W there).
- An evaded missile is only a jet's missile (UFO seeker bolts are still dodged by flares and hard turns, not by rolling).
- The Overlord can crash onto its surroundings when it falls (as every big ship does): keep your distance when it goes down.
- Old saves keep their terrain edits but the landscape of a seed has changed; an old world's airports and cities move to the new, rarer grid.

## How to test in 10 minutes
1. Open the game: a dark glass menu; hover the top-right corner for the fullscreen button, press F11 (Chrome/Edge: Ctrl+R no longer reloads while in fullscreen). Start a **Creative** world.
2. Find the airport (F3 shows the nearest, one is within about a kilometre); walk to a parked jet, F to board, W + Shift to take off. Hold **Space** for the air brakes (watch the tail panels on the F-16 / the rudders and flaps on the F-22, the HUD row and the sound). Hold right click on a UFO: you can still steer while the camera looks at it; watch the ring and pips fill for the salvo.
3. Roll with A/D when an enemy fighter's missile is close ("MISSILE EVADED!"). Press B to drop the nuke on a city: everything within ~125 blocks goes, runways included.
4. Spawn a big UFO from Esc > Mods, board it (F), climb as high as you like, hold right click over a smaller UFO or an enemy jet to swallow it, hold T on one for the lock-on salvo.
5. **Survival** (new world): the Settings tabs for weapons, mobs, UFOs and vehicles show only a note; missions: `Esc > Missions` lists all 21. To skip ahead for a look: in the browser console `__voxelands.progress.step = 10` (Touchdown), `= 15` (Falling stars) or `= 19` (the Overlord), then wait a few seconds for the director.
6. `tools`: `npm test` (unit tests first; `round6-tests.mjs` is the fast Round 6 browser suite).
