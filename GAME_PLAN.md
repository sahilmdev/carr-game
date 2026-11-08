# Nitro Cosmos: game plan

Agreed rules for the kart-style game. The current full race stays as it is, as the Grand Tour.

## Structure
- Menu: Grand Prix or Single Race, then car, then cup or track.
- Grand Prix: 4 cups of 4 races, 3 laps each. Trophies unlock the next cup.
- Single Race: any track, 1, 3 or 5 laps.
- Single player against 5 simulated rivals. No online play for now.
- Each race loads only its own assets. Set a size and detail limit per track.
- Fixed sky and lighting per track. Time and weather options are for the Grand Tour only.
- Laps of about 50-60 seconds (changed 2026-11-08 after playtesting: the 25-35 s loops felt tiny). A lap is a journey: it leaves the start, goes somewhere new and comes back another way. You should not see the whole track from one spot.
- Design driving first: each track gets 2-3 signature moments, at least one fork or shortcut, and a lap change; scenery comes last.

## Driving rules
- No barriers by default. Walls only where the world needs them.
- Leaving the road is allowed. Off-road slows you, so cutting a corner is a trade.
- Solid things are solid: crash, then reverse out. Small things can break.
- Reverse is available. A wall behind the grid on lap 1 stops you driving off backwards.
- A fall returns you to the road near where you fell. No visible checkpoints.
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
All 16 are confirmed: Cosmos Bay (strongly elevated road), Rainforest Run, Neon City, Deep Blue (far more scenery), Sky Islands, Ghost Galleon Bay, Gold Rush Line, Bobsleigh Peak, Mars Colony, Blossom Pass, Midnight Carnival, The Great Dam, Skyline Cranes, Solar Crown, Hollow Manor, and the Grand Tour as the finale.

## Items and nitro
- Items are in (2026-11-08). Rows of crystals across the road hand out one item each, weighted by place: leaders get mines, shields and darts; the back gets triple turbos and seekers. Items: turbo, triple turbo, dart (straight, bounces off walls; hold brake to throw behind), seeker (follows the road to the car ahead), mine (dropped behind), shield (takes one hit). A hit spins the car out. Press E or Q. Rivals collect and use them too. Tracks mark rows with `items: true`; a track with none gets three automatic rows.
- Earned nitro on the new tracks: the tank starts empty and fills from drifts, jumps and clean landings. The Grand Tour keeps its current tank.

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
- Nova: Deep Blue, Gold Rush Line, Bobsleigh Peak, Sky Islands
- Eclipse: Midnight Carnival, The Great Dam, Skyline Cranes, Mars Colony
- Supernova: Hollow Manor, Ghost Galleon Bay, Solar Crown, Grand Tour

## What each cup is
- **Comet Cup: Places you know, pushed further.** Bright, readable, real-world places. Teaches drifting, corner cuts, off-road and recovery. Built and playable.
- **Nova Cup: The road stops being a road.** Each race changes what you drive on: glass tunnels, a moving train, an ice run, gaps in the sky.
- **Eclipse Cup: Built by people, falling apart.** Machines and structures that change around you: a coaster, a flooding dam, swinging cranes, a Mars colony.
- **Supernova Cup: The final trial.** Haunted, sunken and burning worlds, ending with the whole journey in the Grand Tour.

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
- Forks: `branches` on a track are second roads that leave the loop and rejoin it. Rivals pick a branch by its odds (a track can change the odds by lap, e.g. a gate that opens).
- Moving solids (`World.movers`): the train, rockfalls, snowballs. Rivals look ahead, steer round them and wait for the train.

## Status
- All four cups are built: 15 kart tracks in `src/kart/tracks`, plus the Grand Tour as the Supernova Cup finale.
- Eclipse Cup: Midnight Carnival (coaster road, fireworks and dodgems from lap 2), The Great Dam (gates open on lap 2 and flood the basin road), Skyline Cranes (rooftop jumps, crane loads swing across the road from lap 2), Mars Colony (low gravity, crater jumps, a dust storm that thickens each lap).
- Supernova Cup: Hollow Manor (through the great hall and off the roof; storm on lap 2, ghosts on the last), Ghost Galleon Bay (along the decks of two wrecks; the tide rises, a phantom ship fires on the last lap), Solar Crown (a road over a star; an eruption on lap 2, plasma columns on the last), then the Grand Tour.
- The Grand Tour round runs in its own page: the cup is saved in session storage, and the tour's medal comes back as your place (gold 1st, silver 2nd, bronze 3rd, none 6th); the rivals fill the other places by standing.
- Tracks can set `gravity` (Mars uses 13 against the usual 26).
- Dev-only test helpers live in `src/kart/devtools.ts` (`__look`, `__race`, `__clear`, `__fly`, `__gaps`); they are not in the production build.
- The Great Dam is rebuilt to the new standard (3.2 km, laps of about 52-60 s): valley town start, hairpin climb, the crest or the narrow service bridge across the dam face, the spillway lip and a glide down the gorge, the turbine hall, a broken bridge you can only clear with a boost, the meander or (from lap 2) the flood channel, and back over the river bridge.
- The kart engine in `src/kart` loads one track at a time. The Grand Tour runs separately as `?tour`.
- The Comet Cup is rebuilt to the same standard (2026-11-08):
  - Cosmos Bay (2.8 km): seafront promenade, hillside town, lighthouse headland, a tall cable-stayed bridge to the island, a cove jump, the low causeway back, the east cliffs, then round the harbour or off the pier (boost only). Lap 2 wind and waves over the causeway; last lap a storm swell.
  - Rainforest Run (2.9 km): river village, rope bridge or the muddy ford, a ledge behind the waterfall, switchbacks up the cliff, a walkway through the tree crowns, a glide down to the temple, round it or through its tunnel. Lap 2 rain, mud and a sliding stone trap in the tunnel; last lap the river is up.
  - Blossom Pass (3 km): lakeside village, a corridor of red gates, hairpins to the summit temple and round the pagoda either way, then the sweeping descent or the ridge road with a boost-only ravine jump, the red bridge by the falls. Lap 2 wind, petals and lanterns; last lap valley mist.
  - Neon City (3.15 km): boulevard, neon market hall, a spiral ramp round a tower up to the expressway, the double-decker (covered lower deck or open upper deck), a jump over a missing span, the canal, then the plaza or the crate-filled alley. Lap 2 trams; last lap blackout.
- Engine fixes found while building them: cars keep their speed in the air (no braking or drag mid-jump); mud lying on the road now slows you; stacked roads (a road passing over itself) pick the higher deck; steep hillsides block cars like walls; terrain never pokes through raised roads or into jump paths; rivals hold their fork choice until clear of the fork, keep to the middle through it, brake for real bends before jumps, and skip a shortcut they just fell off.

## Next
1. Playtest the Comet Cup and The Great Dam: length, forks, jumps, items, tricks.
2. Rebuild the remaining 11 tracks (Nova, Eclipse, Supernova) to that standard, one design sheet each first (Skyline Cranes on rooftops only; Gold Rush with mine carts and a rail-or-dirt fork; Midnight Carnival through the rides; Solar Crown needs a visual rethink).
3. Hero models (cars, the Gold Rush train, sea life) are still the weakest art; there is no CC0 source for them, so they need Sketchfab CC-BY files you download yourself.
4. Mars Colony is the heaviest track to draw; trim it further if it stutters.
5. Later: wall-ride and half-pipe sections, a touch button for items, branches on the minimap, full replay.
