# Horizon Drive — Upgrade Brief #3 (Real Models Everywhere, Denser World, Correct Car & POV)

**For the executing agent (recommended: Opus 4.8, one model start-to-finish).**
Working Three.js + TypeScript + Vite game at
`C:\Users\sm091\Downloads\ONGOING-PROJECTS\3d-game\claude-game\`. It already loads real GLB models
via `src/game/AssetLoader.ts` (GLTFLoader + Draco), swaps the car via `Car.applyModel()`, and adds
scenery model props via `Scenery.applyModels(get)` (called from `Game.ts` after `loadAll`). Models
live in `public/models/`, credited in `public/models/CREDITS.md`.

**The core complaint driving this round (take it seriously):** most of the world is still
procedural polygons (cone "mountains", box buildings, box/cone cave, etc.), the car isn't the
retrowave wedge from the reference, the roadsides feel EMPTY while driving, the camera POV doesn't
match the reference, and the space/canyon biomes are over too fast. Fix all of that with REAL
downloaded models and denser placement — stop generating geometry where a model will do.

**Process rule that must be followed this time:** verify by driving FULL LAPS and looking at
frames from a normal chase view, not by inspecting features in isolation. Several past bugs
(car sideways, arches in the road, cave you clip through, mountains underwater) shipped because
features were checked alone but broke each other in a real lap. After each section, drive a lap.

---

## What MUST stay procedural (do NOT try to model these — it's correct as-is)
- **The road ribbon + neon edge lines** — generated to follow the runtime track spline; no
  downloadable model can bend along a curve we generate. Keep procedural.
- **The sky + sun** — a gradient shader on a sphere. This is exactly what the real Shopify game
  does (`sky_icosphere.glb` + shader). Keep it; just tune colors.
- **Lighting** — light objects, not models.
- **Particle FX** — bubbles, meteors, fish sprites, camera flashes, speed trails. Keep.

Everything ELSE below should become a real model wherever one exists.

---

## SECTION 1 — The car (points 1, 2)

The current car is a Quaternius "Sports Car" (`car_sports.glb`) — it doesn't match the reference.
The reference car is a **black 80s wedge supercar (Lamborghini Countach / De Tomaso Pantera style)**:
very low and angular, wide rear, two rectangular **orange glowing taillights**, a **rear wing**, a
**roof scoop**, dark tinted windows, and a front license plate reading **"EDITION"**.

- Find a low-poly CC0/CC-BY model matching that silhouette. Search Poly Pizza / Sketchfab /
  Quaternius / Kenney for: `countach`, `lamborghini countach`, `de tomaso`, `pantera`,
  `80s supercar`, `wedge car`, `retro sports car`, `vaporwave car`. Poly Pizza already listed a
  "DeLorean DMC-12" and multiple "Sports Car" / "80s Car" entries — evaluate several and pick the
  closest wedge. (`car_80s.glb` is already downloaded — check if it's the right shape first.)
- Swap it in via the existing `Car.applyModel()` path. Keep ALL physics untouched (that method
  already normalizes scale/orientation and reparents wheels into spin/steer pivots).
- **Guarantee these details** (overlay procedurally if the model lacks them): orange emissive
  taillight bar, an "EDITION" license plate (the code already has a canvas plate texture), and a
  rear wing. Dark near-black body paint with a little metalness so it catches the sunset.
- Record license in `CREDITS.md`.

## SECTION 2 — Camera POV to match the reference (point 6)

The reference chase view sits **closer and lower behind the car**, with the car filling the lower-
center of the frame and lots of road visible ahead — it feels planted right behind the bumper, not
pulled way back. Tune `src/game/ChaseCamera.ts` (`height`, `distance`, `lookAhead`) so the framing
matches the screenshots: car noticeably bigger in frame than now, camera lower. Keep the subtle
speed-FOV and the (already-fixed) `rotateZ` lean. Verify against the reference screenshots by eye.

## SECTION 3 — Real models EVERYWHERE, replacing procedural (points 3, 5, 7)

Go download a broad batch of free models and replace procedural geometry. **Method that works**
(curl, from the repo dir):
```
# find candidates
curl -sL "https://poly.pizza/search/<term>" -A "Mozilla/5.0" | grep -oE '/m/[A-Za-z0-9_-]+' | sort -u
# resolve a model page to its direct GLB + license
curl -sL "https://poly.pizza/m/<id>" -A "Mozilla/5.0" | grep -oE 'https://static.poly.pizza/[a-f0-9-]+\.glb'
curl -sL "https://poly.pizza/m/<id>" -A "Mozilla/5.0" | grep -oiE 'CC0|Creative Commons Attribution|Public Domain'
# download
curl -sL "<glb-url>" -A "Mozilla/5.0" -o public/models/<name>.glb
```
Prefer CC0; CC-BY is fine but must be attributed in `CREDITS.md`. Kenney.nl (CC0) and Quaternius
(CC0, on Poly Pizza) are the best sources. Inspect each GLB's real size/orientation at runtime with
the existing `placeModel()` normalizer (scales to a target height, drops base to ground).

**Replace these procedural pieces with real models:**
- **Mountains** — the cone "mountains" (`Scenery.buildMountains`) → real **cliff / mountain / rock-
  formation** models (search `mountain`, `cliff`, `rock formation`, `terrain rock`, `mesa`). Big
  low-poly rock masses on the horizon of every land biome.
- **Canyon cave + walls** — the box/cone cave (`buildCanyonCave`) → real **cliff/arch/canyon-wall**
  models forming a pass the road threads through. If a true tunnel model isn't found, build the
  portal from real cliff models placed either side + a rock arch model over the road (never through
  the drivable surface — keep the road gap clear; this was a bug before).
- **Buildings** — the remaining procedural houses/towers (`buildHouses`, `buildTowers`) → real
  **building / skyscraper / house** models (search `building`, `skyscraper`, `apartment`,
  `house`, `hotel`, `city building`). Use several distinct models so the town isn't repetitive.
- **Trees** — keep/expand the palm model; add other **tree/bush/cactus** models for variety.
- **Space/industrial** — the procedural tanks/pipes (`buildSpaceIndustrial`) → real **sci-fi /
  industrial / space-station / fuel-tank / satellite / rocket** models (Kenney Space Kit,
  Quaternius Sci-Fi). Search `space station`, `sci fi building`, `fuel tank`, `satellite dish`,
  `rocket`, `industrial pipe`.
- **Props for density** — add **billboards, road signs, fences, barriers, benches, hydrants,
  boxes, containers** along roadsides so the world feels lived-in.

**Performance note:** cloning many full GLBs raises draw calls. For high-count props (trees, lamps,
rocks, roadside clutter) either keep counts sane (a few dozen each) or extract the GLB's merged
geometry into an `InstancedMesh`. Kenney/low-poly models are cheap; target < ~400 draw calls
desktop. Always keep the procedural fallback so a missing file never crashes the game.

## SECTION 4 — Fill the empty roadsides (point 7)

Driving currently feels empty. For EVERY biome, place scenery densely enough that there's always
something interesting passing by — but never intruding on the drivable surface (respect the
existing clearance = `track.width/2 + margin`). Vary distance from the road (near clutter + mid
props + far skyline) for depth. Town: buildings, lamps, trees, signs, benches, parked props.
Coast: palms, sailboats (keep), piers, rocks. Canyon: cliffs, boulders, arches, dead trees.
Space: stations, tanks, gantries, satellites, floating rocks. Underwater already reads full —
leave it. Use the per-sample zone labels (`track.zoneOfSample(i)`) to gate placement.

## SECTION 5 — Longer space + canyon biomes (point 4)

Both biomes end too fast. In `src/game/trackData.ts`, add more control points to the `space` and
`canyon` spans so they cover more of the lap (more curves, more distance). Keep the zone label
structure and the two `flight` gaps intact (the launch/landing autopilot depends on them). After
editing, drive a lap and confirm: zone order unchanged, both flights still trigger and hand back
cleanly, embankment/coverage still holds (no floating road), checkpoints/finish still work. The
total lap can grow (a longer, more epic run is the goal).

## SECTION 6 — Graphics quality pass (point 5)

- Materials on loaded models: convert to `MeshStandardMaterial`, set `envMapIntensity` so paint/
  metal catch the baked sunset env map, keep emissive on lights/neon.
- Keep the recent post-FX restraint (chromatic aberration is now top-speed-only, grain halved) —
  do NOT crank CA/grain back up; it reads as cheap blur.
- Ensure the car and key scenery are clearly LIT (not black blobs) in every biome — the sunset
  and space light rigs already lerp; tune so model detail reads.
- Match the reference palette per biome (warm sunset town/coast, teal underwater, deep-space
  purple/blue). Bloom stays subtle (high threshold) so only neon/emissive glows.

---

## Execution order & acceptance
1. Car swap + POV (Sections 1–2) — the most visible fix; get it looking like the reference first.
2. Longer space/canyon (Section 5) — cheap, do before re-dressing those biomes.
3. Real-model replacement (Section 3) — mountains → cave → buildings → space/industrial → trees.
4. Density pass (Section 4).
5. Graphics/material/lighting tuning (Section 6).
6. Drive a FULL lap after each; final regression: full auto-lap through all zones, both flights,
   3 checkpoints, finish screen, no floating/clipping geometry, `npm run build` + `tsc` clean.

**Acceptance:** load the game (real loading bar), drive a full lap — the car is the black 80s wedge
with orange taillights + EDITION plate from the reference; the chase POV matches the screenshots;
mountains/cave/buildings/space props are REAL models, not cones and boxes; roadsides are full and
lively in every biome; space and canyon each last noticeably longer; the image reads sharp and
richly lit like the original, not blurry/cheap. Every model's license is logged in
`public/models/CREDITS.md`.
