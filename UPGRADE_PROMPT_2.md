# Horizon Drive — Upgrade Brief #2 (Real CC0 Models + Controls + Steering + Full Visual Overhaul)

**For whichever agent picks this up (recommended: Opus 4.8, one model start-to-finish).**
This is a working Three.js + TypeScript + Vite racing game at
`C:\Users\sm091\Downloads\ONGOING-PROJECTS\3d-game\claude-game\`. It currently builds ALL geometry
procedurally from code primitives (boxes/cones/cylinders/extrusions) with zero external asset
files. **This brief deliberately ends that constraint:** the #1 goal is replacing the most
important procedural geometry with real, free, low-poly CC0 3D models to close the quality gap
with the reference screenshots. Before editing anything, read the current state of every file —
numbers/paths below are a starting point to verify, not gospel.

Current architecture:
- `src/engine/` — GameLoop, Renderer (ACES tonemap, FXAA), PostProcessing (bloom → grade shader →
  FXAA), Input (keyboard + touch)
- `src/game/` — Car (procedural wedge + arcade drift physics), Track (CatmullRom ribbon + neon
  edge lines, reads `trackData.ts`), trackData (control points with per-span zone labels — single
  source of truth for zones), Scenery (zone-aware instanced dressing), Sky (shader gradient with
  underwater/space modes, baked to PMREM env map), Lighting (sunset + space rigs), ChaseCamera,
  CinematicCamera, SpeedEffects, ScreenShake, Audio (synth WebAudio), Game (orchestrator: phase
  machine, followTrack, updateAtmosphere, flight autopilot for the two ramp jumps, blob shadow)
- `src/ui/Minimap.ts`, `index.html` + `src/style.css` (splash/HUD/countdown/end screen)
- Lap zones (in order): town → coast → causeway → underwater → rampUp → flight1 → space →
  flight2 → canyon → town. The two `flight` zones are real road gaps the car flies across on
  autopilot.

The reference screenshots the owner supplied are frames from the real Shopify "Horizon Drive"
game — treat them as the visual target for each biome.

---

## SECTION 0 — Asset pipeline (do this FIRST; everything else depends on it)

### 0.1 Add a GLTF/GLB loader to the engine

There is currently no model loader. Add one:
- Use `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`, plus `DRACOLoader`
  (`three/examples/jsm/loaders/DRACOLoader.js`) with the decoder path pointed at
  `/draco/` (copy the decoder from `node_modules/three/examples/jsm/libs/draco/` into
  `public/draco/`, or use the gstatic CDN decoder as the real game does).
- Create `src/game/AssetLoader.ts`: a small class that preloads a manifest of GLBs, exposes
  `get(name): THREE.Group` returning a fresh `clone()` (with `SkeletonUtils.clone` if any model
  is skinned/animated), and reports load progress through the existing `assets:loaded` event
  pattern so the splash's loading bar (already in the shell) can show real progress.
- Models load ASYNC. The Game constructor currently builds everything synchronously — refactor so
  the heavy scene build waits for `AssetLoader.loadAll()` to resolve, showing the loading bar
  meanwhile. Keep a **procedural fallback** for any model that fails to load (so the game never
  hard-crashes on a missing file) — log a warning and use the existing procedural mesh instead.

### 0.2 Where to get the models (all free, CC0 / public-domain-equivalent)

Put downloaded `.glb` files in `public/models/`. Primary sources, in priority order:

- **Kenney.nl** (kenney.nl/assets) — CC0, no attribution. The single best source here. Grab:
  - **Car Kit** (low-poly cars — pick a sporty/muscle one, or assemble one)
  - **City Kit (Commercial/Suburban)** — buildings, houses, skyscrapers
  - **City Kit Roads / Racing Kit** — traffic cones, barriers, guard rails, directional
    chevron/arrow signs, warning signs, street lights
  - **Nature Kit** — palm trees, rocks, cliffs
  - **Space Kit** — industrial tanks, pipes, structures, satellite dishes, rockets (for the space
    biome)
- **Quaternius** (quaternius.com) — CC0. "Ultimate Cars Pack" (great muscle-car options),
  "Ultimate Modular Sci-Fi", nature/rock packs.
- **Poly Pizza** (poly.pizza) — CC0 + CC-BY low-poly, searchable, direct GLB download. Good for a
  Countach-style car ("low poly sports car" / "retro supercar"), kelp/coral, lamp posts.
- **Sketchfab** (sketchfab.com) — filter Downloadable + CC0/CC-BY. Search "low poly muscle car",
  "retro sports car countach". If CC-BY, keep an `ASSET_CREDITS.md` with attributions.

**Verify each model's license before committing it.** Record every model's source + license in a
new `public/models/CREDITS.md`. Prefer CC0; if using CC-BY, attribute it there.

The owner may drop models into `public/models/` themselves, or the executing agent may fetch them
if it has network/download access. If download isn't possible in the runtime, still do all the
loader + integration wiring against a documented expected filename manifest, and leave the
procedural fallback active so the game runs until the files arrive.

### 0.3 Materialize loaded models to match the retrowave look

Loaded GLBs often ship with flat unlit or plain materials. On load, traverse each model and:
- Ensure meshes use `MeshStandardMaterial` (convert if `MeshBasicMaterial`), so the sunset/space
  lighting affects them.
- Set `envMapIntensity` so car paint/glass pick up the baked sky reflection (the scene already has
  a PMREM env map — this is what made our ocean reflect the sunset).
- Keep car taillights/headlights emissive (bloom already keys off emissive intensity ≥ ~1).
- `castShadow = false` on the car (we use a blob-decal shadow — keep that system).

---

## SECTION 1 — The car (biggest single visual win)

Points 1, 7, 9. Swap the procedural wedge in `Car.ts`'s `buildMesh()` for a real low-poly muscle
car GLB (Countach/80s-supercar silhouette to match the reference).

- Keep the **entire physics class intact** — only the *mesh* changes. `Car.ts` exposes `this.mesh`
  (a Group) and `this.bodyGroup` (rolls/pitches for body-lean); the loaded model becomes the
  contents of `bodyGroup`, scaled/oriented so it faces -Z (the code's forward), sits on the road
  at the right ride height, and is centered.
- **Re-wire the four wheels:** find the wheel meshes in the GLB (by name, or by picking the 4
  lowest-outer meshes) and register them as the spinnable/steerable wheel objects the physics
  already animates (`this.wheels`). If the model has no separable wheels, keep the procedural
  wheels and hide the model's molded ones.
- Preserve the emissive **taillight bar** and **EDITION license plate** treatment — if the GLB
  lacks them, overlay the existing procedural taillight quads + plate canvas texture onto it.
- Add a subtle car-mounted fill light (already exists) tuned so the body reads clearly instead of
  going black — see Section 8 (the current car is too dark).

---

## SECTION 2 — Controls: remove reverse, spacebar = brake

Point 2. Files: `src/engine/Input.ts`, `src/game/Car.ts`.

- **No reverse.** In `Car.ts`, the car may only move forward or coast to a stop. Change the
  longitudinal physics so `speed` is clamped to `[0, maxSpeed]` (remove `maxReverseSpeed` and the
  "reversing" branch). Braking decelerates toward 0 and stops there — it never goes negative.
- **Steering only affects heading while moving forward** (already speed-scaled; just ensure the
  `Math.sign(speed)` logic can't invert now that speed is never negative — steering should feel
  natural down to a full stop, then simply do nothing at speed 0).
- **Spacebar = brake.** In `Input.ts`, map `Space` to the `brake` action (currently brake is
  ArrowDown / S — keep those too, add Space). Accelerate stays ArrowUp / W. Note `Space` is
  already in the preventScroll list; make sure holding it brakes without scrolling/other side
  effects.
- Update the splash control hints + any on-screen legend to reflect: **↑ accelerate, ← → steer,
  Space brake** (no down-to-reverse).

---

## SECTION 3 — Steering overhaul (make it feel like the real game)

Points 5, 12. This is about *feel*, in `Car.ts` + `ChaseCamera.ts`. The real game's steering feels
weighty, smooth, and responsive with a satisfying drift. Ours is basic/twitchy. Improve:

- **Smoothed steering input:** don't apply raw left/right instantly. Ramp a `steerAmount` toward
  the input target over a short time constant (fast attack, slightly slower release), so taps feel
  crisp but sustained turns feel weighted. Expose the smoothing constant.
- **Speed-sensitive turn rate:** turn rate should peak in the mid-speed band and tighten less at
  very high speed (so the car doesn't spin out at top speed) — refine the existing
  `effectiveTurnSpeed` curve; make it a tunable curve, not a single linear scale.
- **Drift/grip that reads:** tune `driftFactor`/`downforce` so hard cornering produces a visible,
  controllable tail slide that recovers smoothly — not ice, not rails. Add a subtle counter-rotate
  of the body (`bodyGroup`) into the slide.
- **Camera that leans into turns:** in `ChaseCamera.ts`, add a small lateral offset + slight roll
  toward the outside of the turn based on steer amount and speed, plus a touch more positional lag
  on hard corners (communicates momentum). Keep it subtle — this is game-feel, tune by eye.
- **Front-wheel visual steer:** already present; make sure it tracks the smoothed steer amount.
- Keep ALL of these as named, tunable constants at the top of `Car.ts` (the project convention).

---

## SECTION 4 — Camera angle + wider, more drivable roads

Points 4, 12, 17. Match the reference framing: camera sits a bit lower and closer, the car fills
more of the lower-center, and the road reads as **wider**.

- **Wider road:** raise `Track.width` (currently 15) to ~20–22, and widen the boundary clamp
  accordingly in `Game.ts` `handleTrackBoundary()`. Re-check neon-line offsets, start line, and
  scenery clearances so nothing intrudes on the wider surface.
- **Camera:** in `ChaseCamera.ts`, lower + tighten the offset and lookAhead to match the reference
  (car larger in frame, more road visible ahead). Keep the speed-based FOV widening.
- **Curves:** in `trackData.ts`, smooth out any kinks that make the current lap feel jerky — the
  CatmullRom control points should produce flowing, drivable curves (no near-hairpins at speed).
  Also, per point 17, let the road **gently rise and fall** in more places (vary control-point `y`)
  so it undulates like the reference, not just flat-then-ramp.

---

## SECTION 5 — HUD speed meter redesign

Point 3. The reference has a distinctive **angular, segmented speed gauge** in the bottom-right:
a curved/hexagonal bar made of segments that fill and shift color (purple → pink → red) as speed
climbs, with a large "### MPH" number. Files: `index.html`, `src/style.css`, and the HUD update in
`src/main.ts` / wherever `setMph` writes.

- Rebuild the bottom-right speed readout as a segmented angular gauge (5–7 skewed segments in a
  shallow curve, matching the screenshot's shape). Segments light up cumulatively with speed and
  ramp from purple/blue at low speed to hot pink/red near top speed.
- Keep the big pixel-font MPH number to the right of the gauge.
- The number already updates via the HUD `setMph`; add a normalized-speed value (0–1) to drive how
  many segments are lit + their color. Pure CSS/SVG is fine (skewed divs or an inline SVG).
- Keep the existing minimap; the gauge sits with it in the bottom-right cluster.

---

## SECTION 6 — Per-biome asset & visual upgrades

Use loaded GLBs where they raise quality; keep procedural for cheap filler. Gate everything by the
existing per-sample zone labels (`track.zoneOfSample(i)`).

### 6.1 Town / coast (points 11, 16)
- Replace procedural houses/towers with **Kenney City Kit** building GLBs (mix of suburban houses
  + a few tall towers/striped hotel). Keep lit-window emissive variety.
- Add **street lamp GLBs** lining the road (reference image 4) — tall posts with warm glowing
  heads. Per point 11, street lights don't need to be in every biome — town/coast (and optionally
  causeway) is enough.
- Keep palms (swap for nicer palm GLBs from Kenney/Quaternius Nature if available).

### 6.2 Directional chevron light-signs along the road (point 16)
- Add glowing **yellow chevron / arrow direction boards** on the outside of curves (reference
  images 2, 5, 8) — they light the way through corners. Build as emissive quads or a small GLB.
- Place them programmatically on sharper curves across ALL biomes **except underwater** (point 16
  explicitly excludes water). Detect corner sharpness from the change in tangent between nearby
  samples and drop chevrons on the outside edge.

### 6.3 The launch ramp (point 13, reference image 5)
- Redesign the rampUp zone dressing to match the reference: a built-up **ramp structure** with a
  big **warning-triangle sign**, **yellow chevron boards** flanking it, **traffic cones**, and
  palms around the base. Use Kenney Racing/Road Kit GLBs for cones/signs/barriers.
- The ramp lip should read clearly as a jump takeoff.

### 6.4 Canyon → mountain with a cave/tunnel (point 10, reference image 3)
- The canyon biome should route the road **through a cave/tunnel bored through a mountain**
  (reference image 3): a large dark mountain mass with a tunnel opening the road passes into and
  out of, with hanging lamps / neon rings inside lighting it. Build the mountain as a big GLB rock/
  cliff (Kenney/Quaternius) or a procedural mass; the tunnel interior gets emissive hanging lamps
  and the existing neon edge lines carry through it.
- Keep the varied spires/mesas outside; add the cave as the canyon's centerpiece.

### 6.5 Underwater — clean & readable (point 14, reference image 6)
- The target is CLEAN and clear: bright teal water, crisp orange neon tunnel **arches/rings** over
  the road, green edge lines, kelp, bubbles, rocks — all readable, not murky. Reduce underwater fog
  density if it's hiding the arches; make the arch rings brighter/cleaner; keep the caustics subtle.
- Keep the shark + fish, but ensure they don't clutter the readable path.

### 6.6 Space — Earth, neon rails, industrial structures, banking road (points 15, 17; images 7–9)
- Match the reference: deep starfield with **shooting-star streaks**, **Earth** prominent in the
  sky, glowing **blue/cyan neon rail lines** along the road (light-trail look), and **industrial
  structures** flanking the track — tanks, pipe clusters, cranes, gantries, satellite dishes
  (Kenney Space Kit / Quaternius Sci-Fi GLBs).
- Per points 15 + 17, the space road should **bank and rise/curve upward** dramatically (reference
  image 9) — vary the space-zone control-point `y` and add banking so it feels like a rollercoaster
  through a space station. (Banking = rotate the road cross-section around the tangent; if full
  banking is too invasive, at least add strong elevation change + tighter neon rails.)
- Add meteor/shooting-star particle streaks to the space sky.

---

## SECTION 7 — Fix: car clips under the ramp (point 6)

Point 6 — the owner suspects proper graphics will fix this, but it's really a **geometry/physics
bug** and should be fixed directly, not left to chance:
- At some ramp transitions the car dips under the ramp surface. Root cause is `followTrack()` in
  `Game.ts` lerping the car's Y toward the nearest sample's Y with a smoothing that lags on steep
  slope changes, and/or the flight trigger firing a frame late so the car briefly follows the road
  through the takeoff instead of launching.
- Fix: (a) tighten the Y-follow so on steep rampUp samples the car sticks to the surface (raise the
  lerp rate when |tangent.y| is large), and (b) make sure the flight autopilot triggers exactly at
  the ramp lip (first `flight` sample) so there's a clean handoff with no clip. Verify by driving
  the ramp repeatedly and confirming the car never intersects the ramp mesh.
- Also re-verify the Section 0 coverage/embankment pass still holds with wider roads — no floating
  or clipped road at any of the four biome seams.

---

## SECTION 8 — Lighting pass (point 9)

Point 9 — "better car + improved lighting would improve the entire game." After the car swap:
- Ensure the car body is **clearly lit** in every biome (it currently reads as a near-black
  silhouette). Balance the car fill light + ambient so the body shape and paint are visible while
  keeping the moody retrowave tone.
- Keep the sunset ↔ underwater ↔ space light-rig lerp (already in `updateAtmosphere`), but retune
  each rig so scenery detail is legible (the reference scenes are dark-but-readable, not crushed).
- Push emissive/bloom on neon elements so the road lines, chevrons, signs, and Earth glow like the
  reference, without blooming the whole frame into mush (bloom threshold stays high).

---

## SECTION 9 — Execution order & acceptance

Keep the game runnable at every step:
1. **Asset pipeline (Section 0)** — loader + Draco + async build + procedural fallback. Verify the
   game still runs with zero models present (fallback path).
2. **Car swap (Section 1)** + **lighting (Section 8)** — the biggest visual jump; get the car
   looking right and lit before anything else.
3. **Controls (Section 2)** + **steering (Section 3)** + **camera/wider road (Section 4)** — the
   feel pass; this is what the owner most wants to "feel crazy."
4. **HUD speed gauge (Section 5).**
5. **Ramp clip fix (Section 7).**
6. **Per-biome asset upgrades (Section 6)** — town/lights, chevrons, ramp, cave, underwater
   cleanup, space overhaul — each independent, do in any order.
7. Final tuning pass.

**Whole-brief acceptance test:** load the game (real loading bar while GLBs stream in), drive a
full lap: the car is a proper lit low-poly model; it only goes forward/left/right with Space to
brake (no reverse); steering feels smooth and weighty with a readable drift; the camera framing +
wider road match the reference; the segmented speed gauge fills and shifts color with speed; every
biome uses real models and reads like its reference screenshot (town w/ street lamps + buildings,
chevron-lit curves, a proper signposted ramp, a cave through the canyon mountain, a clean readable
underwater tunnel, a banking space section with Earth + neon rails + industrial structures + meteor
streaks); the car never clips through the ramp; no floating/broken geometry at any seam; and the
checkpoint/finish/best-time flow still works exactly as today. Record every model used + its
license in `public/models/CREDITS.md`. `npm run build` and `npx tsc --noEmit` both pass.

**Honest note to carry into execution:** the model quality *is* the graphics quality in this genre.
The single most important thing in this whole brief is Section 0 + 1 (getting real CC0 car +
scenery models loading and lit correctly). If asset download isn't available in the runtime, wire
everything up against the documented manifest, keep the procedural fallback live, and tell the
owner exactly which files to drop into `public/models/` — do not fake it or claim models are in
place when they aren't.
