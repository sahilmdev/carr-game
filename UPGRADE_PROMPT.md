# Horizon Drive — Major Upgrade Brief (Space Biome + Visual Overhaul + Bug Fixes)

**Context for whichever agent picks this up:** this is a working Three.js + TypeScript + Vite
browser racing game at `C:\Users\sm091\Downloads\ONGOING-PROJECTS\3d-game\claude-game\`. It is a
from-scratch clone of Shopify's "Horizon Drive" (shopify.com/editions/summer2025/drive), built
procedurally with zero external asset files — every model, texture, and sound is generated in
code. Before touching anything, read the current state of every file mentioned below; exact
numeric values (fractions, offsets, colors) may have drifted since this brief was written, so
treat all specific numbers here as a *starting point to verify*, not gospel.

Current architecture (do not restructure this, extend it):
- `src/engine/` — GameLoop, Renderer (ACES tonemap, capped pixel ratio), PostProcessing (bloom →
  custom grade shader with chromatic aberration/split-toning/vignette/grain → FXAA), Input
- `src/game/` — Car (procedural wedge mesh + arcade drift physics), Track (CatmullRom spline +
  road ribbon + neon edge lines), Scenery (zone-aware instanced set dressing), Sky (shader gradient
  baked into a PMREM env map), Lighting, ChaseCamera, CinematicCamera (attract-mode splash orbit),
  SpeedEffects, ScreenShake, Audio (synthesized WebAudio, no files)
- `src/game/Game.ts` — the orchestrator: owns phase state (`attract`/`countdown`/`racing`/
  `finished`), drives `followTrack()` (glues car to road elevation/slope), `updateAtmosphere()`
  (fog + sky lerp between surface and underwater), `handleTrackBoundary()` (lateral clamp against
  the neon edge lines), `handleProgress()` (checkpoint + lap detection)
- `src/ui/Minimap.ts`, `index.html` + `src/style.css` (the cinematic shell: splash/HUD/countdown/
  end screen)

Track today is a single closed CatmullRom loop (~2.3 km, `Track.SEGMENTS = 1600` samples) built
from a hardcoded array of 3D control points in `Track.ts`'s constructor. Zone boundaries are
tracked two different, **inconsistent** ways that need reconciling as part of this work: some
zones (causeway, canyon) are detected by *fraction of lap* (`ZONES` export + a local `fraction(i)`
helper), while the underwater zone is detected purely by *elevation* (`y < -2.5`, no fraction check
at all). This mismatch is the direct cause of the transition bugs described in section 3.

---

## 0. Reference screenshots you were given

Two screenshots show real, current bugs in this build at the zone transitions:

1. **A glowing arch floating half-out of the ocean**, poking above the water surface with canyon
   mountains visible behind it across open water — this is an underwater-tunnel arch that got
   placed too close to the surface.
2. **An isolated strip of road hovering in black void** with nothing underneath it and distant
   canyon mountains behind — an elevated road segment with no ground/support geometry built under
   it at all.

Both must be root-caused and fixed (see section 3), not just visually patched.

---

## 1. New biome: SPACE (the 4th zone) — reached via two auto-drive launch ramps

Investigation of the real Shopify game (see `INSP.md` in this same folder) confirmed their game
has a genuine **moon/space biome** — real asset filenames pulled off their CDN include
`racing_game_track_69_moon.glb`, `earth_512_256.png`, and `star_64.png`. Our game currently only
has 3 biomes (town/coast, underwater, canyon). Add the 4th.

### 1.1 Where it sits in the lap

Insert the space biome **between the end of the underwater tunnel and the start of the canyon**,
replacing the current plain "rising back up to the beach" transition. New lap order:

```
town → causeway → underwater tunnel → [LAUNCH RAMP] → SPACE → [LANDING RAMP] → canyon → town
```

### 1.2 The launch ramp (underwater exit → space entry)

Mechanically, exactly as described by the project owner:

- As the car approaches the end of the underwater tunnel, the road rises into a visible **ramp**
  (steep upward incline, neon edge lines continuing up it and then stopping abruptly at the lip —
  do not taper them off gradually, they should look like they physically end at the edge).
- The instant the car's position crosses the ramp's start trigger point (a specific
  fraction-of-lap or a specific sample index), **player input must be completely ignored** —
  don't just zero it out, actually skip calling `car.update(dt, input)` with real input during this
  window; feed it a fixed/no-op input instead, or bypass the normal per-frame car-physics-plus-
  track-follow path entirely for this window (see below).
- The car then **launches off the ramp and travels through the air** — there is a real gap in the
  visible road mesh here (no road geometry across the jump — this sells "traveling in air", not a
  road that secretly continues under the hood). During this gap, the car's position/rotation
  should be driven by an **authored flight arc** (a simple parabola or quadratic Bezier is enough),
  computed once when the ramp is triggered, from:
  - **Start pose:** the car's actual position + heading + tangent direction at the ramp-exit
    sample (read straight from `track.samples[i]` / `track.tangents[i]` at that index — don't
    hardcode world coordinates, derive them from the track so this survives future track edits).
  - **End pose:** the position + heading of the space-biome's entry sample (same approach).
  - Interpolate over a fixed duration (roughly 2.5–3.5 seconds felt right in similar games — tune
    by feel), easing the car up through the apex and back down, with a nose-up pitch on launch and
    nose-down pitch on approach for the landing (reuse/extend the existing pitch visual logic in
    `Car.ts`, don't fight it).
  - Player input stays fully disabled for the whole gap.
- **Landing:** the instant the car reaches the space-biome entry pose, hand control straight back
  to the player (re-enable input, resume normal `followTrack()` + physics) with **zero visible
  pop** — the car's mesh position at the last authored-flight frame must exactly match its first
  normal-physics frame.
- Add feedback for the moment of launch/landing: a short screen-shake pulse (`ScreenShake` already
  exists, just call `addTrauma()`), and ideally a light/particle cue (an engine-flare burst on
  launch, a dust/spark burst on landing) — reuse `SpeedEffects`-style particle patterns rather than
  inventing a new particle system from scratch if it fits.

### 1.3 The landing ramp (space exit → canyon entry)

Exact mirror of section 1.2: a downward ramp at the end of the space biome, same "input fully
disabled, scripted flight arc between two track-derived anchor poses" mechanic, landing into the
start of the canyon zone.

### 1.4 State machine change needed in `Game.ts`

You'll need some notion of "am I currently in an auto-piloted flight segment, and if so which one
and how far through it am I" — this doesn't have to be a new top-level `phase` (the existing
`attract`/`countdown`/`racing`/`finished` states are about screens, not mid-race track segments),
but `updateRacing()` needs a branch that:
1. Checks whether `trackIndexHint`'s fraction currently falls inside a launch or landing trigger
   zone (new `ZONES` entries, e.g. `spaceLaunchStart`/`spaceLaunchEnd`/`spaceLandingStart`/
   `spaceLandingEnd`).
2. If a flight is already in progress, advances it by elapsed time and short-circuits the normal
   `car.update(dt, input)` + `followTrack(dt)` + `handleTrackBoundary()` calls for that frame,
   directly setting `car.position`/`car.mesh` pose from the authored arc instead.
3. If the flight just started this frame, capture the start/end anchor poses once and stash the
   elapsed-time accumulator.
4. If the flight just completed this frame, snap exactly onto the landing anchor pose and resume
   normal control.

Keep this as a small, clearly-named addition (e.g. a private `flightSegment: { active: boolean,
startTime: number, duration: number, from: Pose, to: Pose } | null` field) — don't scatter the
logic across multiple files.

### 1.5 Space biome visual spec

This is a full re-skin of `Scenery.ts`'s dressing and `Sky.ts`'s shader for this stretch of track
(gate all of it behind the same fraction range used for the launch/landing zones):

- **Sky:** replace the warm retrowave gradient with a space palette — deep near-black/navy zenith,
  a dense starfield (reuse/extend the existing star-hashing technique already in `Sky.ts`'s
  fragment shader, just increase density and don't fade it out — it should be visible everywhere
  in this zone, not just "upper sky"), and a large **Earth** visible on/near the horizon — a
  textured sphere or even a simple shaded-gradient sphere (blue/white/green swirl look) sitting low
  in the view, matching what the real game's `earth_512_256.png` implies. This can be a uniform
  toggle on the existing sky shader (`uSpaceMode`, `uEarthPosition` etc.) or a separate mesh added
  to the scene only while in this zone — whichever is less invasive given the current shader
  structure.
- **Ground/terrain:** grey/silver cratered moon surface instead of purple canyon rock. Simplest
  approach: reuse the existing instanced-rock/mesa techniques already in `buildCanyon()` but
  recolor (desaturated greys, no purple) and add flattened crater shapes (a disc with a shallow
  depression — a scaled, y-flattened sphere or a custom lathe geometry works fine, doesn't need to
  be fancy) scattered near the road.
- **Road:** reuse the existing road ribbon + neon edge line system, but retint the edge lines for
  this zone — cyan/electric-white instead of the orange (surface) / green (underwater) already
  used. This means `Track.ts`'s edge-line builder needs a third material + a third zone-detection
  condition (fraction-based, matching the new space `ZONES` range) alongside the existing
  orange/green split.
- **Lighting:** cooler, dimmer ambient (no warm sunset hemisphere here) — a soft blue-white key
  light, minimal fill, let the starfield/Earth read clearly against a darker overall scene. Don't
  reuse `setupRetrowaveLighting()`'s warm sun as-is for this zone; either add a zone check inside
  it or swap in a dedicated light rig while the car is in this range.
- **Optional stretch (skip if it complicates the physics):** a slightly "floatier" feel — reduced
  `downforce`/longer body-roll and pitch lerp times — to sell low gravity without touching the core
  arcade physics model. Ship the visual re-skin first; only attempt this if it's cheap.
- **Optional bonus dressing:** distant satellite/space-station silhouettes, a ringed planet far in
  the background, meteor streak particles. Nice-to-have, not required for this biome to "count."

---

## 2. The 4 specific features requested (in priority order)

### 2.1 Shark (or similar creature) in the underwater tunnel

Add a large animated silhouette swimming through the background/foreground of the underwater
zone — this is currently the single biggest gap versus the real game (their CDN has a literal
`shark_super_optimized.glb`). Procedural approach (matching the rest of this project's "no external
assets" constraint): build a simple low-poly shark silhouette in code (a stretched, tapered body
shape — an extruded profile similar to how `Car.ts` builds its wedge body works well here — plus a
dorsal fin, tail fin, pectoral fins), dark flat-shaded material so it reads as a silhouette against
the teal underwater fog. Animate it on a slow patrol path that crosses the player's view
periodically (not constantly) — a simple sine-wave lateral drift along a line parallel to the
track, timed so it doesn't always appear at the same lap fraction (or does, for a scripted "jump
scare" moment — either is a legitimate design choice, pick one and be consistent). Scale it big
enough to feel like a real threat/spectacle, not a fish.

### 2.2 Camera-flash burst effects

Fire a few quick white flash bursts at the finish line (and optionally at each checkpoint crossing)
for a "you're famous now" polish moment — this is a real detail confirmed from the actual game's
`camera_flashes_atlas` texture. Cheap implementation: a handful of small additive-blended white
quads (billboarded to face the camera) positioned around the finish gate / checkpoint markers, each
briefly flashing from `opacity 0 → ~1 → 0` over a few hundred milliseconds when triggered, staggered
slightly so they don't all pop at the exact same frame. Trigger this from `Game.ts`'s existing
`handleProgress()` checkpoint/finish logic — don't build a separate detection system, hook into what
already fires `audio.playCheckpoint()` / `finishRace()`.

### 2.3 Animated water normal map + caustics

The ocean is currently a static reflective plane (`Scenery.ts`'s `buildOcean()`); the underwater
road/seabed has no light-caustic effect. Both need motion:
- **Ocean surface:** give it a scrolling normal map so the reflection ripples over time instead of
  looking perfectly still. This can be a small procedurally-generated normal-map texture (or a
  simple custom `ShaderMaterial` that perturbs the surface normal using a couple of scrolling sine
  waves in the fragment shader — either approach is fine, whichever is less code given the existing
  `MeshStandardMaterial` setup) — the goal is visible motion in the water's highlights as the
  camera passes, not photorealism.
- **Underwater caustics:** add a caustic-light shimmer projected onto the underwater road surface
  and seabed — a scrolling/distorting light-pattern texture (or a procedural shader pattern using
  overlapping sine/voronoi-style noise, animated over time) blended additively onto the existing
  underwater road material (`Track.ts`'s road `ShaderMaterial`, gated to only apply while
  underwater) and the seabed mesh (`Scenery.ts`'s `buildUnderwater()` seabed). This is one of the
  highest-value cheap wins for making the underwater zone feel alive instead of static.

### 2.4 Fish sprites swimming through the underwater tunnel

Add a school of fish as cheap billboard sprites (quads that always face the camera, small additive
or alpha-blended fish-silhouette texture, or even simple procedurally-drawn canvas textures like
the project already does elsewhere for the license plate / tower windows) drifting through the
underwater zone in loose clusters, each with slight independent sine-wave motion so the school
doesn't move as one rigid block. Reuse the existing `bubbles` Points-system pattern in
`Scenery.ts`'s `buildUnderwater()` as a structural template (bounds computed from the underwater
samples, per-particle velocity/phase array, updated in `Scenery.update()`) — fish just need
billboarded sprite quads instead of `THREE.Points`, and 2D wandering motion instead of pure vertical
drift.

---

## 3. Fix the biome-transition bugs shown in the reference screenshots

Both bugs stem from the same root problem: **zone/support geometry is authored per-zone using two
different, not-fully-reconciled detection rules** (some things check `fraction(i)` against `ZONES`,
underwater-only things check raw `y < -2.5`), and there's no single system guaranteeing that
*every* sample along the lap has *some* ground/support geometry under it.

Concretely:

1. **Floating arch bug:** `Scenery.ts`'s `buildUnderwater()` places a torus arch every ~30 samples
   wherever `isUw(i)` (`y < -2.5`) is true, with no margin from the surface. Near the boundary
   where the road first dips below `-2.5`, the road might be barely submerged (e.g. `y ≈ -2.6`)
   while the arch's own radius (~9.5–10 units) reaches well above sea level, poking the top of the
   arch out of the water. **Fix:** only place arches (and ideally other deep-underwater dressing)
   where the road is submerged by a real safety margin — e.g. require `y < -6` (or whatever value
   keeps the arch crown at least a couple of units below `y = 0` given its actual radius), or skip
   arch placement for the first/last N samples of each contiguous underwater run. Verify by
   actually inspecting `track.samples` y-values along the real curve, not by guessing a constant.

2. **Floating road segment bug:** somewhere between the underwater zone rising back up and the
   canyon/space zone beginning, there's a stretch of elevated road with no ground, causeway
   pillars, canyon fill, or ocean beneath it — because `buildCauseway()`'s pillar logic only covers
   its own fraction range (currently roughly 0.17–0.44) AND requires the road to be above
   `-2.5`, `buildUnderwater()` only covers its own `y < -2.5` range, and `buildCanyon()` only covers
   its own fraction range (currently roughly 0.66–0.92) AND requires `y > -1` — leaving a gap in
   coverage for any elevated segment that falls outside all three. **Fix this generically, not with
   a one-off patch:** after all zone-specific dressing is built, do a **coverage pass** — walk every
   track sample, and for any sample not already covered by causeway pillars / underwater seabed /
   canyon terrain / the flat ground plane, build *some* form of support (extend the causeway-pillar
   system to be a general "elevated road support" builder keyed only on `road.y` exceeding a small
   threshold and not otherwise covered, rather than being fraction-range-gated to just the causeway
   zone; or add a dedicated "beach/transition terrain" strip that follows the road's elevation
   profile with margin through this stretch). Whichever approach you take, the acceptance bar is:
   **drive/inspect the entire lap and confirm zero frames where the road appears disconnected from
   any ground/support geometry.**

3. As part of this fix, and because the space biome insertion in section 1 will shift where the
   underwater zone ends, **recompute and reconcile `ZONES`** so fraction-based and elevation-based
   zone checks agree with each other along the whole lap — consider making elevation-based checks
   (`y < -2.5` for underwater, etc.) the single source of truth and deriving everything else from
   actual sampled track data rather than maintaining a hand-tuned parallel fraction table that can
   drift out of sync with it, since that drift is exactly what caused these two bugs.

**Acceptance criterion for this whole section:** drive one full lap (or inspect it programmatically
sample-by-sample) and confirm there is no floating geometry, no arches breaching the surface, and
no visually-broken seam at any of the (now four) biome boundaries.

---

## 4. General visual overhaul — "make it look way more crazy, closer to the real game"

The three existing biomes need to look noticeably richer, not just bug-fixed. Concrete, per-zone
suggestions (treat these as a menu to pull from, not a rigid checklist):

- **Town/coast zone:** more variety in buildings than the current repeated box-body + cone-roof
  houses and flat striped towers — add at least one or two distinct landmark structures (a taller
  hotel using the striped texture that's already coded but under-used, a pier/boardwalk feature
  matching the coastal vibe, maybe a Ferris wheel silhouette) to break up repetition. Increase
  window-glow color variety (not every lit window needs to be the same orange). Consider adding a
  lighthouse near the start gate for a stronger establishing landmark.
- **Underwater zone:** covered by section 2 (shark, fish, caustics, animated water) — this alone
  should be the single biggest visual jump in the whole game once implemented.
- **Canyon zone:** currently fairly sparse/uniform (repeated cone spires at a fixed distance from
  the road). Add shape variety (not every rock formation needs to be a simple cone — mix in blockier
  mesa-style clusters, tilted/leaning spires), and consider adding some closer, smaller foreground
  rocks near the road edges for depth (respect the existing clearance logic that keeps them from
  intruding on the drivable surface). A glowing crack/vein of neon color running through some rock
  faces would fit the retrowave aesthetic and tie it visually to the neon road lines.
- **Across all zones:** consider increasing background element density generally (more instanced
  scenery per zone reads as "richer" without much perf cost since it's already instanced), and
  richer/more varied emissive accents (not just the road lines and windows — scattered small neon
  signage, accent lights on structures) to push the bloom pass to do more visual work, matching how
  saturated/glowy the real game's screenshots look.

---

## 5. Engineering changes worth adopting (from `INSP.md`)

### 5.1 Blob-shadow decal instead of a real-time shadow map for the car

The real game fakes the car's ground contact shadow with a cheap projected blob-decal texture
instead of a real shadow map — confirmed from their `car_shadow_128_256_compressed.png` asset. This
is a legitimate performance win (real shadow maps are one of the more expensive things in the
current renderer) and matches the "performance budget" philosophy this whole project is built on.
**Implementation:** stop the car mesh from casting/receiving real-time shadows (or at least make it
optional/toggleable), and instead add a simple soft-edged radial-gradient circular quad (a small
plane with a radial-gradient alpha texture — can be generated on a `<canvas>` at startup exactly
like the license-plate/tower-window textures already are) positioned just above the road surface
directly under the car, following `car.position` every frame, always facing up. Keep it subtle —
this replaces a shadow, it shouldn't look like a spotlight.

### 5.2 Externalize track control points / zone data

`Track.ts` currently hardcodes the CatmullRom control-point array and the `ZONES` fraction table
directly in source. Move this to an external data file (a `.json` or a dedicated `.ts` data module
that's clearly separated from the geometry-building logic) that `Track.ts` loads/imports at
construction time — mirroring the real game's externalized `track_data_*.json` approach. This isn't
urgent for correctness, but given this brief is asking for a 4th biome and new launch/landing
trigger ranges, doing this refactor *now* will make it meaningfully easier to iterate on the new
control points and zone boundaries without repeatedly editing class internals. Reasonable scope:
one data file exporting the control-point array + all `ZONES` fractions (old and new), imported by
`Track.ts`; no need to build a generic data-driven track *editor* or tooling around it.

---

## 6. Suggested execution order

Doing these roughly in this order keeps the project drivable/testable at every step rather than
breaking the game for a long stretch:

1. Fix the two transition bugs (section 3) on the *current* 3-biome track first — this is
   independent of the space biome and gives an immediate, verifiable improvement.
2. Externalize track data (section 5.2) — do this *before* adding the space biome's new control
   points, so the new points go straight into the clean data file rather than back into
   hardcoded class internals.
3. Add the space biome zone + both auto-drive ramps (section 1) — the biggest structural change.
   Get the mechanic (input disabled, scripted flight, clean handoff) working with *placeholder*
   visuals before polishing the space re-skin, so the hard engineering part is validated in
   isolation from art tuning.
4. Polish the space biome visuals (section 1.5).
5. Implement the 4 requested underwater/finish-line features (section 2) — each is independent and
   can be done in any order or in parallel.
6. Blob-shadow swap (section 5.1) — small, low-risk, do whenever convenient.
7. General visual density/variety pass (section 4) — last, since it's the least structural and
   easiest to keep tuning incrementally after everything else is stable.

**Whole-brief acceptance test:** start the game, drive a complete lap through all four biomes back
to the finish line, and confirm: no floating/disconnected geometry anywhere, both launch/landing
ramps take control away cleanly and hand it back with no visual pop, the space biome reads clearly
as a distinct 4th location (starfield + Earth + grey terrain + cyan road lines), a shark and fish
are visible in the underwater tunnel, the water/caustics visibly animate, camera flashes fire at the
finish line, and the finish screen still correctly shows the lap time / best time / new-best state
exactly as it does today.
