# Horizon Drive — Ours vs. Shopify's (CORRECTED, evidence-based)

> **This replaces an earlier, wrong version of this document.** The first pass
> concluded "we already implement almost all of it — 3 concrete differences."
> That was too optimistic and it was built the wrong way: from source code and
> Shopify's asset *filenames*, while waving off the running game because my
> browser pane wouldn't composite screenshots. That was a mistake. Feature
> **presence** in code is not the same as feature **quality** on screen. This
> version is grounded in **measurements taken from the actual running game** at
> `http://localhost:5188` via its `window.__hd` debug handle (real pixel
> readback + projected car size + physics ticks).

---

## How this version was verified

I drove the game programmatically (forcing the physics `update()` loop by hand,
because `requestAnimationFrame` is throttled to 0 when the pane is hidden — that
throttle, not a bug, is why an idle capture reads "0 MPH"), rendered frames, and
read them back off the WebGL buffer. Numbers below are real.

| Measurement | Value (running game) | What it means |
|---|---|---|
| Avg frame brightness | **28–40 / 255** | Very dark overall |
| Near-black pixels | **~44%** of frame | Almost half the screen is black |
| **Sky (top third) brightness** | **10.9 / 255** | The sunset sky is nearly black |
| Mid band (road/horizon) | 36.7 / 255 | Dim |
| Bottom third (road at car) | 72.2 / 255 | OK near the car only |
| **Car size on screen** | **12.2% height, 7.6% width** | Car is small / not dominant |
| Car vertical position | ~42% from bottom (mid-frame) | Should sit lower (lower third) |
| Camera distance / height / FOV | 10.5 / 4.3 / 62° | Pulled back and high |
| Acceleration → speed → HUD | 0→30→59→62 MPH, HUD tracks exactly | **Physics/HUD are correct** |

So: your visual read was right, and my first report was wrong to dismiss it.

---

## Point-by-point against your critique

### ✅ CONFIRMED — Scene is too dark / hard to read
- Whole frame averages **28–40/255**; **~44% of pixels are essentially black**.
- The **sky reads 10.9/255 — nearly black.** A retrowave sunset should have a
  bright, glowing orange/pink sky filling the top of the frame. Ours doesn't.
- Because the sky is dark, buildings silhouette as **black blocks** against it —
  that is precisely your "dark blocky buildings" observation, and it's a
  measurable lighting/atmosphere problem, not a matter of taste.
- **Root causes (in code):**
  - `Sky.ts` gradient is too dark at the top; the sun/glow band is too low and
    too dim, so it doesn't light the upper sky.
  - Building materials in `Scenery.ts` (`buildHouses`/`buildTowers`) are dark and
    under-lit — no emissive window glow to read against the sky, so they go flat
    black instead of the lit neon towers in the reference.
  - Fog color `0x451740` (dark purple) + `PostProcessing` vignette pull the
    edges/top down further.

### ✅ CONFIRMED — Camera framing: car too small, not dominant, sits too high
- Car occupies only **12% of screen height** and sits at **~42% from bottom**
  (roughly centered). An arcade chase cam wants the car bigger (~20–28% height)
  and lower (lower third), with road opening out ahead.
- **Root cause:** `ChaseCamera.ts` `distance = 10.5` (too far), `height = 4.3`
  (too high), and the look target is only `+0.9` above the car, so the car rides
  up the middle of the frame instead of sitting low.

### ✅ CONFIRMED — Track readability / guidance is weak
- With a near-black sky and dark buildings, the **road-edge neon lines** are
  carrying almost all the guidance load, and the world behind them isn't staged
  to pull your eye forward. The reference uses bright sky + lit buildings + the
  bridge + palms as **layers of depth** that show you where the road goes; ours
  collapses to "bright strip on black."
- The minimap helps, but you're right: the **world itself** should guide, and
  right now it doesn't because everything past the road edge is too dark.

### ✅ PARTLY CONFIRMED — Sense of speed
- The "0 MPH" you saw is **not** a wiring bug: when the loop runs, speed and the
  HUD update correctly (measured 0→62 MPH in lockstep). It reads 0 only when the
  tab is unfocused (rAF paused) or before you accelerate.
- BUT your underlying point stands: the *feeling* of speed is weak because the
  **camera is far/high** (less ground rushing past), the **FOV widening is mild**
  (62→~71 only), and the **speed streaks** (`SpeedEffects.ts`) are faint cyan
  sparks rather than strong road-streaking. So the systems fire, but they're
  tuned too subtly to sell speed.

### ⚠️ Driving feel (needs your play-test, but here's the code reality)
- Acceleration: `26 m/s²` to a `52` max — fine numerically, but the *visual*
  payoff is weak (see speed point above).
- Steering/lean: body roll is tiny (`bodyRollAmount 0.015`) and there's **no
  camera roll** (deliberately removed earlier) and **no lateral camera slide**
  (`sideLean = 0`) — so turns feel visually flat. This matches your "not enough
  arcade personality."
- Drift: `driftFactor 0.15` is mild — corners won't slide much.
- Collision/lane-keeping: the boundary clamp works (measured) but scrubs speed
  hard on contact, which can feel like hitting an invisible wall.

### ✅ CONFIRMED — World polish / density affects gameplay
- The menu and roadsides read emptier and darker than the reference. Combined
  with the dark sky, there's less foreground/mid/far layering, so the drive
  looks static and under-dressed even though many props exist in code.

### ✅ CONFIRMED — "GO"/countdown & branding presentation don't match
- Countdown is functional (3-2-1-GO) but presented as plain CSS text; the
  reference has more polished, animated (Rive) presentation and stronger branded
  framing. No paparazzi/finish flourish parity in practice.

### Note on "title/sign interfering at race start"
- The `HORIZON Drive` start gate (`buildStartGate`) sits at the spawn; with the
  high/far camera it can crowd the opening frame. Worth relocating/shrinking or
  moving the spawn a few metres past it.

---

## Corrected verdict

The game has the **right skeleton** — biomes, car, HUD, countdown, collision,
underwater/space set-pieces all exist and the physics/HUD are wired correctly.
But it **fails on the things that actually make the reference feel good**:
brightness/atmosphere, camera framing, readability, and sense of speed. Those
are not "3 small differences" — they're the core of the arcade feel, and they're
measurably off. My earlier "already implements almost all of it" was wrong.

---

## ✅ P0 APPLIED (2026-07-27) — measured before → after

| Metric | Before | After |
|---|---|---|
| Sky (top third) brightness | 10.9 / 255 | **147.4 / 255** |
| Whole-frame brightness | 28–40 / 255 | **98 / 255** |
| Near-black pixels | ~44% | **~10.5%** |
| Car screen height | 12.2% | **22.3%** |
| Car vertical position | 42% (mid) | **32% from bottom (lower third)** |

Changes: `Sky.ts` (brighter top/mid/horizon/sunset colors, wider+stronger sun
glow, higher env intensity), `ChaseCamera.ts` (distance 10.5→7.8, height
4.3→3.1, look-target +0.9→+2.1), `PostProcessing.ts` (vignette 0.5→0.36, +0.03
lift). `tsc` clean, no shader errors.

## ✅ P1 APPLIED — speed, feel & staging (measured)

| Metric | Before | After |
|---|---|---|
| FOV at top speed | ~78° | **86°** (baseFov 62→60, boost 16→27) |
| Speed-trail opacity | flat 0.5 always | **0→0.9, scaled by speed** (4 lanes, was 2) |
| Body roll into turns | ~1° | **4°** (bodyRollAmount 0.015→0.05) |
| Camera lean on turns | none (sideLean 0) | **lateral slide (sideLean 1.5)** |
| Drift | driftFactor 0.15 | **0.24** (more slide) |
| Accel / top speed / turn | 26 / 52 / 2.3 | **30 / 54 / 2.55** (snappier) |
| Scene props (roadside density) | ~sparse | **+neon guide-posts both sides through land biomes, denser 2-row town** |

Files: `ChaseCamera.ts`, `Car.ts`, `SpeedEffects.ts` (rewritten: 4 speed-scaled
lanes), `Scenery.ts` (`buildRoadsidePosts()` added — cyan/magenta guide-posts
that let you read the route from the world; denser two-row houses; start gate
pushed 6→18 units ahead + real pylons/crossbeam so it no longer crowds the
opening frame).

## ✅ P2 APPLIED — presentation

- Countdown: expanding neon ring behind each number (`countRing`); **"GO" now
  green, larger, with its own burst** (`.go` class in `main.ts` + `style.css`).
- Finish: **paparazzi finale** — 5 staggered camera-flash volleys around the
  finish line + bigger screen shake (0.2→0.45) in `Game.finishRace()`.

All verified: `tsc --noEmit` clean, `npm run build` succeeds, no console/shader
errors, measured live on the running game.

## Prioritized fix plan (all verifiable by re-measuring)

**P0 — Light the world (biggest visible win) — DONE**
1. `Sky.ts`: brighten the upper gradient and raise/intensify the sun-glow band so
   the top third goes from ~11/255 to a glowing sunset (~90–140/255).
   *Verify:* re-measure top-third brightness.
2. `Scenery.ts` buildings: add emissive window/neon glow and lift base material
   value so towers read as lit shapes, not black blocks.
3. Lift `toneMappingExposure` slightly and warm the fog; ease the vignette in
   `PostProcessing.ts`.

**P0 — Fix the camera (second biggest win)**
4. `ChaseCamera.ts`: `distance ~7.5`, `height ~3.0`, raise look-target height so
   the car drops into the lower third and grows to ~22–26% of screen height.
   *Verify:* re-measure car screen-height % and vertical position.

**P1 — Sell speed & feel**
5. Widen the speed-FOV curve; strengthen `SpeedEffects` into real road-streaks;
   add a little camera lateral slide / roll on turns; bump `bodyRollAmount` and
   `driftFactor` for arcade personality.

**P1 — Staging & density**
6. Re-dress roadsides with layered near/mid/far props so the world guides the
   eye; move/shrink the start gate so it doesn't crowd the opening frame.

**P2 — Presentation parity**
7. More polished countdown/GO and branded framing; finish-line flash flourish.

I can implement P0 now and prove each change by re-measuring brightness and car
framing on the running game (I don't need a visible screenshot to verify those
numerically). Say the word and I'll start with the sky + camera.
