# Nitro Cosmos: game plan

Agreed rules for the kart-style game. (The Grand Tour, the old full race, is not part of any cup; it is the fifth tab on the track select.)

## Structure
- Menu (cinematic style): Grand Prix, Single Race or Time Trial, then car, then cup or track.
- Grand Prix: 4 cups of 4 races, 3 laps each. Trophies unlock the next cup.
- Single Race: any track, 1, 3 or 5 laps.
- Time Trial: you alone against the clock; your best lap runs as a ghost car (only in this mode).
- Track select: cup tabs along the top (Q / E to switch, Grand Tour as the fifth tab), the cup's four tracks as numbered cards, and one strip at the bottom with the track name, laps, rival difficulty (hidden in Time Trial) and Race.
- A field of 6: you against 5 simulated rivals. No online play for now.
- Pause (Esc or the HUD button): Resume, Restart race (single races only), Settings, Exit to menu.
- End of a single race: Watch replay, Exit, Play again (Restart or New race). End of a cup race: Watch replay, Exit, Continue. The race keeps running behind the results after you finish.
- Each race loads only its own assets. Set a size and detail limit per track.
- Fixed sky and lighting per track. Some daytime tracks can roll weather for a race (rain, fog or snowfall, about 1 race in 3): `TrackDef.weather`.
- Laps of about 50-60 seconds (changed 2026-11-08 after playtesting: the 25-35 s loops felt tiny). A lap is a journey: it leaves the start, goes somewhere new and comes back another way. You should not see the whole track from one spot.
- Design driving first: each track gets 2-3 signature moments, at least one fork or shortcut, and a lap change; scenery comes last.

## Driving rules
- No barriers by default. Walls only where the world needs them.
- Leaving the road is allowed. Off-road slows you, so cutting a corner is a trade.
- Solid things are solid: crash, then reverse out. Small things can break.
- Reverse is available. A wall behind the grid on lap 1 stops you driving off backwards.
- A fall returns you to the road near where you fell. No visible checkpoints.
- The recovery drone never picks you up mid-jump or while you sit on the road; it only comes for a fall, a car that's stuck, or one that's lost. It sets you down a little ahead, or just behind with a run-up if a jump lies in between, so a rescue never carries you over a jump.
- Laps are checked by hidden progress tracking, so they can't be cheated.
- Each lap should change something on the track.

## Edge kit
Choose every edge on purpose:

| Edge | Result |
|---|---|
| Soft ground | Slows you, can be cut across |
| Solid object | Crash and reverse out |
| Low rail | Scrape along it, a heavy hit can break through |
| Open drop | Fall, then rescue |
| Lower road | Land on another route and keep racing (the preferred fall-back) |
| Deadly surface | Instant rescue |
| Hard wall | Only where you must not go, such as an underwater glass tube |

## Rivals
- Each has a skill level, a personality and its own line, which changes by lap.
- They make mistakes, bump each other, try some shortcuts, fall and get rescued.
- They should not move as one group or always take the best route.

## Races
All 16 are confirmed: Cosmos Bay (strongly elevated road), Rainforest Run, Neon City, Deep Blue (far more scenery), Sky Islands, Ghost Galleon Bay, Volcano Run, Bobsleigh Peak, Mars Colony, Blossom Pass, Midnight Carnival, The Great Dam, Skyline Cranes, Solar Crown, Hollow Manor, Storm Coast, and Solar Crown as the finale. (Volcano Run replaced Gold Rush Line and Storm Coast replaced the Grand Tour, 2026-11-12.)

## Items and nitro
- Items are in (2026-11-08). Rows of crystals across the road hand out one item each, weighted by place: leaders get mines, shields and darts; the back gets triple turbos and seekers. Items: turbo, triple turbo, dart (straight, bounces off walls; hold brake to throw behind), seeker (follows the road to the car ahead), mine (dropped behind), shield (takes one hit). A hit spins the car out. Press E or Q. Rivals collect and use them too. Tracks mark rows with `items: true`; a track with none gets three automatic rows.
- Earned nitro on the new tracks: the tank starts empty and fills from drifts, jumps and clean landings.

## Agreed details
- Commit a local save point before starting. No pushing.
- Crashes mostly bounce. A hard stop only for a head-on hit at speed.
- Rescue takes about 3 seconds.
- Grass cuts top speed by about 40%.
- The far edge of each world is mountains, sea or a drop, depending on the track.
- 5 rivals, with simple driver names and their own car and colour.
- Easy, Medium and Hard, chosen before a cup.
- Free realistic car models may be downloaded, stating each file and licence first.

## Cups
- Comet: Cosmos Bay, Rainforest Run, Blossom Pass, Neon City
- Nova: Deep Blue, Volcano Run, Bobsleigh Peak, Sky Islands
- Eclipse: Midnight Carnival, The Great Dam, Skyline Cranes, Mars Colony
- Supernova: Hollow Manor, Ghost Galleon Bay, Storm Coast, Solar Crown (the finale)

## What each cup is
- **Comet Cup: Places you know, pushed further.** Bright, readable, real-world places. Teaches drifting, corner cuts, off-road and recovery. Built and playable.
- **Nova Cup: The road stops being a road.** Each race changes what you drive on: glass tunnels, lava rivers and a steam vent, an ice run, gaps in the sky.
- **Eclipse Cup: Built by people, falling apart.** Machines and structures that change around you: a coaster, a flooding dam, swinging cranes, a Mars colony.
- **Supernova Cup: The final trial.** Haunted, sunken and storm-lashed worlds, ending with the crown in space.

## Art kit
Shared by every track, in `src/kart/art`. New tracks should build from these, not from raw boxes and spheres.
- `atmos.ts`: height fog with sun glow, caustics, on every material.
- `terrain.ts`: four photo layers blended per pixel, rock projected from the side, mountain rings.
- `foliage.ts`: branching trees with leaf cards (cherry, oak, rainforest, pine, snow pine, dead) and grass tufts.
- `water.ts`: depth-coloured water with shore foam.
- `arch.ts`: merged buildings with world-space finishes (stone, wood, plaster, metal, concrete, rock), grandstands, crowds, gates, pagodas.
- `Build.ts`: road decks (asphalt, dirt, wood, ice, steel, glass), kerbs, wear, wet patches, boost strips.
- `public/models/baked`: Poly Haven scans (CC0) shrunk in Blender 5.2, loaded as `bk:<name>` props. Raw scans run 1–1.6 M triangles; baked ones 3–30 k with 512–1024 px WebP textures. The three city buildings (`apartment_a`, `apartment_b`, `factory_a`) are assembled from the Poly Haven facade kits, with lit rooms behind the glass. Scripts in `scripts/blender`: `fetch_ph.py` (download), `bake.py` (shrink), `building.py` (assemble a building), `render.py` (check render). Raw downloads stay outside the repo.

## Driving additions
- Hold a slide and let go for a boost. Longer slides pay more.
- Boost strips on every track.
- Jumps: a `gap` in the road is open air, and the road really stops at its edge (until 2026-11-08 a bug let cars drive on across gaps). Distance depends on speed and the take-off slope, so a gap can need a boost. Fall short and the drone brings you back, far enough before the jump for a run-up. Test gaps with `__gaps(id)`.
- Tricks: tap brake just after take-off for a barrel roll; finish it before landing for a boost, land mid-roll and you lose speed.
- Gliding: a gap marked `glide` opens wings; you sink slowly and can steer.
- Forks: `branches` on a track are second roads that leave the loop and rejoin it. Rivals pick a branch by its odds (a track can change the odds by lap, e.g. a gate that opens). A branch with a jump only a boost clears is taken only with nitro in hand, unless the branch is `bridged` (a moving deck spans the gap, like the Skyline Cranes lift). Rails open only where two roads overlap by a couple of metres, so a fork never leaves a sliver to drop through.
- Catch-up items: Comet and Storm, for the back of the field. Swinging booms guard some shortcuts.
- Camera: the horizon stays level through banked bends; only when the car rolls well past any bank (a corkscrew or loop) does the camera roll with it, so it stays above the deck.
- Moving solids (`World.movers`): the train, rockfalls, snowballs. Rivals look ahead, steer round them and wait for the train.

## Status
- All four cups are built: 16 kart tracks in `src/kart/tracks` (Gold Rush Line's file is kept but no longer registered).
- Tracks can set `gravity` (Mars uses 13 against the usual 26).
- Dev-only test helpers live in `src/kart/devtools.ts` (`__look`, `__race`, `__clear`, `__fly`, `__gaps`); they are not in the production build.
- The Great Dam is rebuilt to the new standard (3.2 km, laps of about 52-60 s): valley town start, hairpin climb, the crest or the narrow service bridge across the dam face, the spillway lip and a glide down the gorge, the turbine hall, a broken bridge you can only clear with a boost, the meander or (from lap 2) the flood channel, and back over the river bridge.
- The kart engine in `src/kart` loads one track at a time. The Grand Tour runs separately as `?tour`.
- The Comet Cup is rebuilt to the same standard (2026-11-08):
  - Cosmos Bay (2.8 km): seafront promenade, hillside town, lighthouse headland, a tall cable-stayed bridge to the island, a cove jump, the low causeway back, the east cliffs, then round the harbour or off the pier (boost only). Lap 2 wind and waves over the causeway; last lap a storm swell.
  - Rainforest Run (2.9 km): river village, rope bridge or the muddy ford, a ledge behind the waterfall, switchbacks up the cliff, a walkway through the tree crowns, a glide down to the temple, round it or through its tunnel. Lap 2 rain, mud and a sliding stone trap in the tunnel; last lap the river is up.
  - Blossom Pass (3 km): lakeside village, a corridor of red gates, hairpins to the summit temple and round the pagoda either way, then the sweeping descent or the ridge road with a boost-only ravine jump, the red bridge by the falls. Lap 2 wind, petals and lanterns; last lap valley mist.
  - Neon City (3.15 km): boulevard, neon market hall, a spiral ramp round a tower up to the expressway, the double-decker (covered lower deck or open upper deck), a jump over a missing span, the canal, then the plaza or the crate-filled alley. Lap 2 trams; last lap blackout.
- The Nova Cup is rebuilt to the same standard (2026-11-08):
  - Deep Blue (2.8 km, underwater gravity so jumps float): out of the station dome, round the galleon or through its ribs, a glass chute into the trench and a jump over a broken section of tube, then the sunken city or the maintenance tube in the kelp. Lap 2 leaks on the deck; last lap red emergency light.
  - Gold Rush Line (2.6 km): main street beside the railway, two level crossings with the train, over the mesa or through the mine under it (ore carts cross from lap 2), a jump over the broken trestle, and a canyon short cut the dynamite opens on lap 2. Last lap the train runs faster.
  - Bobsleigh Peak (3.3 km, ground now built to follow the route instead of a deep trench): summit village, ski-jump in-run and a glide down the landing hill, the ice chute or the forest trail with its creek jump, round the frozen lake or across the ice, then the rack railway back up. Lap 2 snowballs; last lap blizzard and cracking ice.
  - Sky Islands (3.2 km): island leaps, the glass highway, the glass bridge or the deck along a moored airship, a glide off the summit island. Lap 2 crosswind; last lap a gale and drifting rocks.
- The Eclipse Cup is rebuilt to the same standard (2026-11-09):
  - Midnight Carnival (3.2 km): down the midway and through the neon fun house, up the coaster's lift hill, the drop and camelback, a boosted launch over the flume pond or the log-flume channel, through the middle of the big top and past the carousel. Lap 2 fireworks and dodgems on the plaza; last lap a coaster car runs the track with you.
  - Skyline Cranes (3.1 km, every metre on the roofs): podium-roof start, down to the low roofs, a boosted leap across the avenue or round by the service bridge, ramps up to the high roofs, a drop across the gap to the next block, the climb to the summit tower and a glide off it, or the scaffolding on the half-built block. Lap 2 crane loads hang across one lane; last lap gusts on the roofs.
  - Mars Colony (3.2 km, low gravity): out to the crater, a leap in and a launch out (or the rim road), a long floaty leap over the rift, the climb up the mesa and a glide off its edge (or the lava tube through it), home through the big dome. Lap 2 dust storm and dunes drifting over the road; last lap the rocket launches.
- The Supernova Cup is rebuilt to the same standard (2026-11-09):
  - Hollow Manor (2.9 km): the long drive, the great-hall ramp and the jump off the wing roof into the graveyard, the chapel bluff or the hedge maze, a boosted leap over the boathouse inlet or round on the boardwalk, the lake shore home. Lap 2 storm; last lap ghosts.
  - Ghost Galleon Bay (3.2 km): the quay and the town, the lighthouse headland and a glide off the cliff to the piers (or the rope bridge across the cove), the wreck's deck and the bow jump, a leap off the broken pier to the islet (a pad or a trick off the bow jump carries you), the sea cave, the causeway, the west hills or the smugglers' tunnel. Lap 2 tide; last lap the phantom galleon.
  - Solar Crown (3.1 km), new look: a white and blue orbital station over a banded gas giant, the sun a bright disc in a dark, starry sky, nebula, asteroids, solar wings, a crown ring with spires. A boosted leap between modules, a glide off the crown's highest spire (or the solar array), a jump between docking arms (or the glass maintenance tube). Lap 2 solar flare and solar wind; last lap debris across one lane.
- Rails now open by themselves only where another road actually runs alongside (a fork or a join), so no point needs `rail: ''` at a junction any more, and nothing opens before the branch has split off.
- Track upgrades follow the blueprints in `bps/` (one PDF per track): each track gets one core mechanic. Shared engine pieces come first, each proven on one track.
- Engine piece 1, moving road (2026-11-09): `World.platforms` are moving decks a car can drive on (sloped tops allowed, so they can be ramps). A car on one is carried along; its speed is measured against the deck while on it, and it keeps the deck's speed when it leaves, through the air until it lands. Rivals treat a deck as road, line up on it and ride it.
- Gold Rush Line proof (3.26 km, laps about 50-65 s): a Railway branch runs along the track bed. The train is a car-carrier rake (ramp wagon, flat cars, a kicker at the front) that paces itself to meet the player on that stretch; catch it, drive up, run along the wagons and launch off the kicker over the engine at about 95 m/s. The wagons are only drivable on that stretch; everywhere else the train is a wall. A loop round the south of town was added for length.
- Moving road on four more tracks (2026-11-09), using `movingDeck` and `findGap` in `tracks/parts.ts` (a deck laid over a gap in the road):
  - Cosmos Bay: a two-leaf drawbridge over the harbour mouth lifts on a cycle (flat, then a ramp you jump the split from, higher from lap 2, faster on the last lap).
  - Skyline Cranes: a crane in the street swings its jib into line across the rooftop gap; in line you drive over it, swung away you jump.
  - Sky Islands: the airship deck is no longer fixed; it drifts along its length and rises and sinks under you, more from lap 2.
  - Bobsleigh Peak: the ice road crosses an open lead on drifting floes, which drift further on the last lap.
- Engine piece 2, force zones (2026-11-09): `World.zones` push (currents, gusts), swirl and pull (dust devils, blasts), steer (`grab`, mud ruts) or throw up (`lift`, vents). `roadZones` and `zoneFx` in `tracks/parts.ts` lay zones along a road and show them as drifting specks.
  - Deep Blue: sideways currents through the flooded tubes (stronger from lap 2, reversed on the last lap), a cross-current over the broken tube, bubble vents in the trench.
  - Rainforest Run: the river carries you downstream across the ford (strong on the last lap); mud ruts past the ruins drag the car from lap 2.
  - Mars Colony: dust devils sweep back and forth across the road from lap 2 and swirl you; the rocket's blast shoves you on the last lap.
  - Ghost Galleon Bay: waves break across the causeway every few seconds and push you sideways, bigger with the tide.
- Clean-up pass on the nine upgraded tracks (2026-11-09) with a new dev scanner, `__clutter(id)`, which lists anything visible sitting on a road. Fixed: mine timbers over the Gold Rush main road, rooftop parapets across the Cranes forks, Deep Blue tubes standing across the other road at forks. Engine: a branch now takes the main road's height where they overlap and eases away, so forks have no ledges (ends near a jump are left alone).
- Engine pieces 3-6 (2026-11-09):
  - Locked-on rails (`lock: true` points): no steering, you lean into bends; lean wrong in a hard bend and you're thrown and lose speed. `railTrack` draws the rails. Used on the Carnival coaster (lift hill, drop, camelback) and the Gold Rush mine carts.
  - Vertical loops (`loops` on a track): you ride round the hoop; gravity takes speed off and too slow at the top drops you out. `loopTracks` draws them. Carnival has one at the bottom of the coaster drop, Solar Crown two.
  - Routes that change during a race: Hollow Manor's ground-floor Gallery, whose doors slam shut on a cycle (rivals only go in when the doors will still be open); Cosmos Bay's beach road, dry and quick on lap 1, wet from lap 2, under water and closed on the last lap.
  - Traffic: Neon City has cars, vans and taxis in the outer lanes (5 on lap 1, 10 at rush hour).
  - Drift chains: drifts released one after another pay more each time (strongest on Blossom Pass, `driftChain: 0.4`). Only the player's car earns drift boosts, so rivals don't use it.
  - Updrafts (`rise` zones) lift gliding cars: Sky Islands has them under the summit glide.
  - Bobsleigh Peak's chute has curved ice walls, higher on the outside of bends, and riding the outside wall through a bend slings you on.
  - Ghost Galleon Bay: on the wreck decks you slide with the ships' roll, harder from lap 2.
- Physics fixes: a car coming down beside a cliff hits it as a wall instead of snapping up onto it (cars used to hop up mesas); cars come out of a loop on the road.
- Blueprint pieces finished (2026-11-10):
  - Mars Colony: the crater is a steep banked bowl round its east wall; riding high on the outside pushes you on to the launch.
  - Deep Blue: a whirlpool basin after the tube break. One side carries you forward, the other drags you back, the eye bogs you down; stronger from lap 2, reversed on the last lap.
  - Skyline Cranes: a crane-lift fork. A hoisted deck ramps from the low roof to the high one on a cycle, with a lamp, and a boom gate that holds you until there's time to cross.
  - Hollow Manor: the cellar route under the hall, boarded until lap 2, when the floor gives way.
  - Blossom Pass: the descent is a stack of six hairpins; the climb was straightened to keep laps near a minute.
  - Rainforest Run: a vine-swing fork beside the rope bridge (World.vines, Racer.catchVine/stepSwing). Let go with nitro or brake just after the bottom for the fast line; too soon and you're in the river; hang on and it lets go at the top.
  - Neon City: a hole in the upper deck (boost over it or drop to the lower deck), and two billboards you can ride sideways (World.wallRides, Racer.catchWall/stepWall, parts.wallPanel).
  - Ghost Galleon Bay: the hulls, masts and sails visibly roll with the deck push.
- Engine and rival fixes in the same round:
  - Rivals only take a boost-only shortcut with nitro in hand.
  - A rival waiting at a gate isn't rescued as stuck.
  - Circuit.shut keeps cars off (and out of rescues onto) a closed road.
  - Solar Crown's habitat leap shortened so the pads clear it.
- Polish: forks and shortcuts drawn on the minimap; shaped city cars in Neon traffic; a more detailed steam engine; mist fades as you reach it; Mars has single-sided small domes, less mist and less dome grass.
- Round of 2026-11-11:
  - Half-pipe road (`pipe` point option): the road curves up into walls; gravity pulls you back down and a swoop off a high wall gives a burst. Used on the Mars canyon run.
  - Twisting road (`roll` point option): the road turns over about its length and the car sticks to it upside down, steering as normal; too slow at the top and you drop off. A corkscrew on Solar Crown. (Racer.startTwist/stepTwist, Circuit.at.)
  - Touch controls in kart races, with an item button that glows when an item is ready.
  - Replays: every race is recorded; "Watch replay" on the results screen plays it back with changing camera angles. Items and moving scenery aren't re-synced in the replay.
  - Vector 88 is a hand-built model (art/heroCar.ts).
  - Deep Blue sea creatures were invisible (the loader collapsed the skinned meshes); fixed. They now swim, with a dark back and pale belly.
- Round of 2026-11-11 (2):
  - Rescue drone: puts you down rolling and only a short run-up before a jump, never on a twist or over a gap, and the flight is quicker (2.2 s).
  - Black screen: Sky Islands' updraft specks had NaN positions (round zones have no turn); fixed. The broken-pixel filter uses isnan/isinf (a self-compare is optimised away on Intel through ANGLE); dynamic resolution changes at most every 6 s and only after two slow readings; guards against a broken camera or car position.
  - Road clean-up for track-built geometry (tidy.carveRoads): anything in the lanes at car height is cut, with any fixed solid there. Gold Rush buildings on the canyon rims (floating over the road) are gone.
  - Rivals: a mistake over an open drop is a wobble to the edge, and they hold the middle of narrow decks with an open side.
  - Blossom drift gate: link five drifts down the hairpins and the gate at the fifth opens on a cut past the last one; lanterns show your chain.
  - Hollow Manor: hedges close one half of the maze at two places; the layout changes every lap.
  - Deep Blue vent field: vents at the foot of a high glass deck throw you up onto it, over the broken tube.
  - Midnight Carnival bumper arena: a route across the dodgem rink; bumper cars and padded walls knock you aside (Solid.bounce). The dodgems no longer come out onto the plaza road.
  - Replays now include whatever moves in the scene (trains, lifts, doors, bumper cars, item shots), found by watching the scene during the race.
  - Vector 88 rebuilt with a smooth lofted body and canopy.
- Still open: Mars performance trimmed but not measured on the target laptop.
- Fixes from playtest (2026-11-09):
  - Black flashing screen: a single bad pixel (not a number, or over the half-float limit when many additive glows stack) was smeared over the whole frame by the bloom blur. A cleaning pass right after the scene render (`engine/PostProcessing.ts`) now removes such pixels. Measured: Sky, Mars, Deep and Solar went from up to 54 fully black frames per race to none.
  - Props on or beside roads: `kart/tidy.ts` runs after every track loads. Scattered props (trees, rocks, lamps, crates) standing on a road are removed; tall ones within a few metres of a road edge get a solid post sized so it never reaches onto the road. Anything with `userData.keep` (items) is left alone.
  - The Dam's river-bridge arch now follows the road and stands outside its edges, with solid feet.
  - Dev tools: `__dark(id)` races with items and watches for black frames; `__ghosts(id)` lists props you could drive through.
- New engine option: `tunnel` points run inside a hill (no carving, no supports; the track builds the bore).
- Engine fixes found while building them: cars keep their speed in the air (no braking or drag mid-jump); mud lying on the road now slows you; stacked roads (a road passing over itself) pick the higher deck; steep hillsides block cars like walls; terrain never pokes through raised roads or into jump paths; rivals hold their fork choice until clear of the fork, keep to the middle through it, brake for real bends before jumps, and skip a shortcut they just fell off.

- Round of 2026-11-12:
  - Volcano Run (3.0 km, laps about 47-53 s): black-sand beach, the east flank in climbing sweeps, round the crater rim over a lava lake and a smoking cone, down the west side over one lava river on a bridge and another off a steam vent (a `lift` zone). Branches: a lava tube off the rim; a cooled flow across the east flank, molten and shut on lap 1, open from lap 2. Last lap: ash, a red sky, and lava bombs (with impact sounds). Ridged flanks and glowing cracks beside the road.
  - Storm Coast (3.2 km, laps about 49-55 s), the Supernova finale: harbour village (cottages with slate roofs, lit windows), cliff road, lighthouse with a sweeping beam, the sea bridge with a drawbridge that lifts into a ramp (a tilting moving deck), the island, the breakwater where waves shove you sideways. Calm on lap 1, rain and lightning on lap 2, full storm on the last lap (screen flashes, thunder). Branch: a cliff tunnel.
  - Cars: 8 (Zephyr and Vortex SR replaced Rotor GT and Aurora on 2026-11-13, keeping their ids and stats; then Stiletto V12, Goblin V12, Cheetah, Mohawk, Patriot XR, Meridian GT); every one takes your paint and faces the right way; combined wheel meshes are split so every car's wheels turn; headlight and tail-light glows, and a beam at night.
  - Rivals tuned per difficulty (speed and catch-up); unfinished rivals get a projected time at the end; last place draws stronger items.
  - No crowds or grandstands anywhere; full-width start line; loops enter and leave a full deck apart; the corkscrew has lit rails and hoops.
  - Roads: ground always under every road (no hill through a hairpin), side roads meet the road they join flush, no rails, edge lights or troughs across another road, ragged ground and broken slabs at road gaps.
  - Night tracks (Manor, Galleon, Carnival) have glowing strips and lamps along both road edges.
  - Race extras: lap-2 and last-lap banners per track (`TrackDef.news`), slow motion when you win, your best lap as a ghost car in single races (saved per track), surface effects (dust on dirt and snow, spray in water, sparks on steel), a loading card with the track's picture, blurb and a tip, track pictures on the menu tiles (`public/previews`), a turntable on the car screen, a podium at the end of a cup, a Restart / Choose another track choice after a single race.
  - Test runs open the game with `?mute`, which forces the volume to 0.

- Round of 2026-11-13:
  - New cars: Zephyr (cartoon sports car, RCC Design, CC BY) and Vortex SR (supercar, SINNIK, CC BY; interior removed and cut to about 90 k triangles). `CarInfo.wheels` names wheel nodes for models that don't call them wheels.
  - Track select rebuilt with cup tabs and smaller cards; a real pause menu.
  - Skyline Cranes: rivals now use the crane lift (wider mouth, a rail along the inside of the split, rails at the gate and the landing, rivals wait at the gate instead of being "rescued").
  - Solar Crown: the camera rolls with the car through the corkscrew.
  - Storm Coast: a lighter lap 1 (paler sky, thinner fog), red-and-white kerbs, brighter verges, an asphalt sea bridge, and a wind farm out in the bay whose blades spin faster as the storm builds.
  - Sky Islands: the rock masses under the islands no longer poke out of the cliff faces; glass decks are frosted so the low sky doesn't glare off them.

## Next
1. Playtest all four cups by hand: length, forks, jumps, items, tricks, the new tracks, rival difficulty.
2. Check the new sounds (thunder, lava bombs) and the sound mix in general.
3. Mars Colony is the heaviest track to draw; trim it further if it stutters.
