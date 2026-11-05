# INSP — What the real Horizon Drive does that ours doesn't

Investigated `https://www.shopify.com/editions/summer2025/drive` directly: read the live DOM/network
traffic, pulled the actual (unminified-enough-to-read) asset filenames off Shopify's CDN, and fetched
the real production JS bundles to see what libraries and structures they use. I was **not** able to get
a live gameplay screenshot — this sandbox's browser pane doesn't composite frames when hidden, and
their WebGL canvas appears to mount only once the page is genuinely visible/foregrounded, so the
canvas never initialized during automated capture. Everything below is verified from real network
requests, real fetched source files, and the four reference screenshots you gave me earlier in this
conversation (not guessed).

## Biggest discovery: it's not "coast + canyon" — it's coast + a literal MOON

The network log while the page loaded pulled these actual model files off `cdn.shopify.com/3d/models/…`:

```
racing_game_track_64_underwater.glb
racing_game_track_69_moon.glb        ← there is a MOON / SPACE biome
racing_game_track_69_beach.glb
racing_game_car_18.glb
trail.glb                            ← the speed trail is a real 3D mesh, not particles
sky_icosphere.glb                    ← their "sky" is a literal geometry sphere, not shader-only
racing_game_sign_break_12.glb        ← a breakable sign/gate model
shark_super_optimized.glb            ← there's a shark in the underwater section
```

So the real lap is **town/beach → underwater (with a shark swimming past) → a moon/space
segment** (textures below confirm it), not a purple mountain canyon. Our "canyon" zone is a
plausible retrowave biome but it's an invention, not what they built. If you want to match them
exactly, that third zone should become low-gravity moon driving under a starfield with Earth
visible in the sky, not rock spires.

## Textures that reveal how each biome actually works

```
waternormals_512-min.jpg          — animated normal map on the ocean surface (real reflections, not a flat color)
caustics-texture_128.jpg          — underwater light-caustic shimmer projected onto the road/seabed
bubble_blue_transparent_64.png    — bubble sprites (we did this one right)
fish_atlas_256.png                — a sprite sheet of fish swimming past underwater
car_shadow_128_256_compressed.png — the car's shadow is a soft blob-decal texture, NOT a real shadow map
earth_512_256.png                 — Earth visible in the sky during the moon segment
star_64.png                       — starfield sprite for the moon segment
camera_flashes_atlas_256.png      — paparazzi camera-flash bursts (a juice/polish detail we don't have at all)
```

The `car_shadow` finding matters for performance: they fake the car's contact shadow with a cheap
projected blob texture instead of a real-time shadow map, which is exactly the kind of "performance
budget" trick the blueprint preaches but we didn't actually take — we run full PCF soft shadow maps
on the sun light. Worth stealing if we ever profile low and need the headroom back.

## Confirmed tech stack (from the real fetched bundles), and where it differs from the blueprint

| Area | Blueprint assumed | What they actually ship |
|---|---|---|
| Framework | Next.js App Router | **Shopify Hydrogen/Oxygen (Remix)** — route chunk is literally named `(_locale).editions.summer2025_.drive-*.js` |
| Physics | `@dimforge/rapier3d` (WASM rigid body) | **No physics engine at all.** I grepped the full 1MB game bundle for Rapier/Cannon/Ammo — zero hits. It's raycast-based collision (`raycast` appears 35×), same lightweight approach our own Track.nearest()-based clamping uses |
| Sky | "Skip HDR, use a shader gradient" (blueprint-2's own recommendation) | They still bake a real environment map — `PMREMGenerator`/`envMap` show up 127× in the bundle, plus an **EXR loader** is bundled, meaning they likely load a real `.exr` HDRI for reflections on top of their `sky_icosphere.glb` mesh. This is actually closer to what I did (bake the shader sky into a PMREM env map) than to blueprint-2's "shader only" suggestion |
| Motion | GSAP timelines | **Confirmed** — `CustomEase-*.js` is its own bundle chunk, exactly as the blueprint describes |
| Vector/UI animation | Framer Motion for HUD only | They also ship **Rive** (`rive.wasm`, `@rive-app/webgl2`) — the animated checkered-flag icons and HUD button states are Rive vector animations, not CSS or Framer Motion. We used pure CSS, which is actually fine for our scope but explains why their flag icon has that extra bit of "alive" motion the blueprint's screenshots show |
| State | Zustand | **Confirmed**, and the shape matches almost exactly: their store exposes `countdownNumber`, `setCountdownNumber`, `startRace`, `isTouchDevice` — same idea as our own `phase`/`onRaceStart` split |
| Track data | Hardcoded control points | Their track geometry ships as **Draco-compressed GLB per biome** plus a separate `track_data_39_condensed_2.json` (checkpoint/spline data as data, not code) — more production-grade than our hardcoded control-point array, but functionally the same idea |

## Small but real details worth copying

- **`?skipcountdown=true`** — an actual dev query-flag in their shipped code that skips the 3-2-1
  countdown and calls `startRace()` immediately. Cheap thing to add to ours for faster manual testing.
- Countdown store logic: starts at `3`, decrements once per second via `setTimeout`, calls `startRace()`
  the instant it hits `0` — same "GO! shown, racing already begins" approach I used.
- Separate mobile vs. desktop HUD components chosen by an `isTouchDevice` store flag, rather than
  CSS-only `md:hidden` breakpoints like ours. Functionally similar outcome, cleaner separation on
  their end.
- MPH digits use a dedicated `drive-headline3-mono-touch-device` tabular-number class — confirms
  monospace/tabular digits are load-bearing for that no-jitter HUD look, which we already do.
- A `camera_flashes_atlas` texture implies flash-bulb effects fire somewhere in the experience
  (most likely at the finish line, "you're famous now" moment) — pure delight/polish, zero gameplay
  function, and something we have no equivalent of at all.

## Honest gaps in this investigation

I could not directly capture their gameplay feel (drift weight, camera lag, FOV widening curve,
exact frame timing) because the WebGL canvas never mounted in this headless capture — I only ever
saw two small unrelated `<canvas>` elements (Rive icon canvases, 300×150 and ~170×80), never a
full-viewport game canvas, even after forcing `?skipcountdown=true`. Everything about the actual
*feel* of their car — weight, drift, camera — I can only judge from the four screenshots you gave
me, not from playing it live. If you want that comparison too, the most reliable path is you playing
it yourself on a real browser tab and telling me what specifically feels different from ours (turn
sharpness, drift length, how hard the camera lags on corners, etc.) — that's not something I can
extract from source code.
