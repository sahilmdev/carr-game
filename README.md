# Nitro Cosmos
a
A realistic-looking 3D browser racing game, originally inspired by Shopify's Editions Summer
'25 "Horizon Drive", built with Three.js + TypeScript + Vite. It runs with no downloaded
assets: the sky, textures, buildings, grass and sounds are generated in code. Optional real
photo assets (sky HDRI, textures, a realistic car) can be dropped in and are picked up
automatically. See `REALISM-GUIDE.pdf`.

## Run

```bash
npm install
npm run dev      # http://localhost:5188
npm run build    # production build in dist/
```

## The race

One time-trial lap (about 10.5 km, ~3 minutes) through eleven areas, linked by three jumps:

1. **Coastal town**: shops, apartments with balconies and glass office towers, grass
   verges, street lamps, kerbs, the HORIZON Drive start gate
2. **Ocean causeway**: elevated bridge over an animated sea with waves and shore foam
3. **Underwater tunnel**: a dry concrete trench dives into a glass tube on the sea floor,
   then a descending spiral (the second pass runs under the first, on steel pylons), a
   **double vertical loop** inside the glass tube, and a long run west past a shipwreck,
   sunken ruins, sea fans, coral, kelp, jellyfish, manta rays, a whale, fish and a shark
4. **Space**: a launch ramp fires the car onto a floating moon plateau with a lunar base
   (habitat domes, solar farms, landing pad and lander, rocket on its launch tower, rovers,
   comms masts, runway lights, a rotating ring station overhead) and things to do:
   three **neon launch ramps** (a 3.4 s moon jump with a full barrel roll and a landing speed kick) and **boost pads** in one lane (full
   nitro + a speed kick; aim for them). A second jump drops back down into
5. **Mountain canyon**: rock walls, hoodoos and mesas, and a **vertical loop-the-loop**
   (the car is carried round it while a trackside camera watches), turning south to
6. **Volcano**: a cut through the ash flank, over the rim and round a churning lava lake
   on the crater floor, a **kicker jump over a lava channel**, out through a glowing lava
   tube. Lava rivers spill down the flank, a smoke column rises from the vent and
   **lava bombs** rain onto the road (a pulsing ring marks where each will land; a hit
   costs speed)
7. **Dune sea**: wind-rippled dunes, saguaro and barrel cacti, sandstone arches (one
   spans the road), telegraph poles, an abandoned gas station, tumbleweeds and a
   **sandstorm** halfway through
8. **Salt flats**: a dead-straight run across a cracked white salt pan with a
   land-speed-record camp and a **speed trap** gantry that shows your speed and best
9. **Alpine pass**: switchbacks between snowy peaks and spruce forest, an avalanche
   gallery, snowfall, chalets with chimney smoke, a chairlift, and an **ice road across
   a frozen lake** (low grip; slide it for an ice-drift score). Northern lights at night
10. **Sky islands**: a lit glass highway above a sea of cloud, past floating islands
   with waterfalls, trees, crystals and a ruined temple, through **boost rings**, a
   **barrel roll**, airship, balloons and gulls, ending in a jump down through the clouds
11. **Rainforest**: the road runs **behind a waterfall** under a mossy overhang, crosses
   a gorge on a **rope bridge**, passes a stepped temple pyramid and a fallen arch;
   giant trees, tree ferns, flowers, parrots, sun shafts, and **mud slicks** (slippery)
12. **Neon city**: always night: towers with lit windows, neon signs, animated
   billboards, an elevated highway on piers, wet reflective streets and steam vents,
   then a tiled
   tunnel that brings you out into daylight at the start line

Each area has its own atmosphere (fog, sky tint, light, exposure, ambient particles:
ash, embers, snow, blowing sand, pollen), blended smoothly as you drive between them,
and a title card as you enter it.

Each area has its own colour grade and a flash as you enter it; your split time at each
area is shown against your best. A translucent **ghost** replays your best lap, and the
results screen awards a **medal** (gold under 2:30, silver 2:45, bronze 3:05). Sunset is
the default time of day. A loading screen shows progress while the scanned models load.

Controls: arrow keys / WASD (touch buttons on mobile), **Shift** = nitro, **P** = photo
mode, **Esc** = settings (the race pauses). Race length is 1, 3 or 5 laps (menu); the
results screen shows every lap split. Best total (per race length) and best lap are stored
locally.

**Photo mode** (P or the 📷 button): the world freezes; WASD to fly, Q/E down/up, drag or
arrows to look, scroll to zoom, Shift faster, H hides the help, Enter / SAVE PHOTO downloads
a PNG. P or Esc returns to the race.

## Menu options

- **Time of day**: Morning / Midday / Sunset / Night (hidden when a real HDRI sky photo is
  used, because the photo fixes the sun). Night brings stars and the moon, lit windows,
  glowing street lamps with light pools on the road, and full headlights.
- **Weather**: Clear / Rain. Rain gives an overcast sky, falling rain, a wet road with
  mirror-like puddles, tyre spray, rain sound and denser haze. Works with an HDRI too.
- **Settings** (menu button, the ⚙ button in the race HUD, or Esc):
  - **Graphics**: Auto / Low / Medium / High. Auto picks Medium on laptop and phone GPUs
    and High on gaming GPUs. High adds ambient occlusion, 4K shadows and SMAA (expensive).
  - **Volume**, **Motion blur** on/off, **Camera** near / normal / far

Settings and time of day are saved in the browser.

URL flags for testing: `?hq` (auto = high), `?lowfx` (auto = low), `?skipcountdown`.

## Bundled free assets

Ground photos and scanned props from Poly Haven (CC0), city buildings and swimming sea animals from Quaternius (CC0), and spacecraft from NASA 3D Resources. See `public/models/CREDITS.md`.

## Optional real assets (drop in, refresh)

| File | Replaces |
|---|---|
| `public/hdri/midday.hdr`, `sunset.hdr`, `morning.hdr` | the generated sky for that time of day (sun direction and brightness are taken from the photo; night stays generated). All three ship with Poly Haven pure-sky photos |
| `public/textures/asphalt/{color,normal,roughness}.jpg` | the generated road texture |
| `public/textures/ground/{color,normal,roughness}.jpg` | the generated grass/dirt |
| `public/models/car_hq.glb` | the low-poly player car (ships with a Mazda RX-7 by Anokino, CC-BY; wheels and lamps are found automatically) |
| `public/models/<same name>.glb` | any scenery model |

The town buildings are generated by `src/game/Buildings.ts`. To use downloaded building
models instead, set `USE_PROCEDURAL_BUILDINGS = false` at the top of `src/game/Scenery.ts`.

## Architecture

- `src/engine/`: rAF loop with capped delta; renderer (ACES tone mapping, soft shadows, GPU
  tier detection); post-processing (optional GTAO ambient occlusion → bloom → tone map →
  grade with speed motion blur, vignette, grain → SMAA or FXAA, all switchable at runtime);
  input
- `src/game/`
  - `Sky.ts`: physically based atmosphere (or an HDRI) baked to a cubemap + image-based
    lighting, drifting clouds, time of day, underwater and space modes
  - `Lighting.ts`: one sun with a sharp shadow box that follows the camera
  - `Track.ts` + `trackData.ts`: CatmullRom track, PBR asphalt with lane paint and corner
    skid marks; `RoadDetails.ts`: gravel shoulders, kerbs, guardrails
  - `Scenery.ts`: zone-aware world dressing, realistic water, a realism pass over materials,
    static batching of placed models; `Buildings.ts`: generated buildings;
    `Vegetation.ts`: instanced swaying grass; `Textures.ts`: procedural PBR textures
  - `Car.ts`: arcade physics, spring suspension, car paint, brake lights, headlights, live
    reflections (a small cubemap re-rendered round-robin from the car's position);
    `Weather.ts`: rain streaks; `Trees.ts`: generated palms, street trees and bushes;
    `ChaseCamera.ts`; `SpeedEffects.ts`: tyre smoke, dust, skid marks
  - `Audio.ts`: synthesized engine with a 6-speed gearbox, tyre squeal, wind, gravel rumble
  - `biomes/`: the six southern areas. `Terrain.ts` is one seamless heightfield
    blended from each biome's field and carved to the road (cut, bridge or tunnel);
    `Volcano.ts`, `Desert.ts`, `Snow.ts`, `SkyIslands.ts`, `Jungle.ts`,
    `NeonCity.ts` build each area; `Moods.ts` blends the per-area atmosphere;
    `Particles.ts` is the camera-local ash / snow / sand / pollen; `Props.ts` loads the
    scanned Poly Haven models (simplified at load) that `BiomeProps.ts` places;
    `Countryside.ts` is the farmland, groves and wind turbines between town and bay;
    `SpaceExtras.ts` adds the moon rocks, craters, telescopes and rigs on the plateau
- `src/ui/`: minimap, settings storage
- `index.html` + `src/style.css`: splash (time of day, settings), HUD, countdown, settings
  panel, end screen
