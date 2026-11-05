# HORIZON DRIVE — LEVEL 1 CODE ANALYSIS & ROADMAP

An in-depth analysis of the current state of the game, highlighting its strengths (what is good), limitations (what is bad), and actionable level-1 upgrade opportunities (what can be made better).

---

## 1. EXECUTIVE SUMMARY

The current game represents a highly polished, single-lap arcade racing experience themed around the **Retrowave/Synthwave** aesthetic. Unlike standard prototypes, this implementation bypasses heavy 3D assets by using procedurally generated geometry and synthesized runtime WebAudio, achieving an incredibly small initial payload size (<1MB excluding library packages) and immediate load times.

The project aligns perfectly with the visual upgrades requested in the engineering blueprints, rendering a custom-shaded retrowave sky, glowing orange and green boundary neon lights, a detailed wedge-shaped retro supercar, and beautiful 60fps post-processed graphics.

---

## 2. THE GOOD (Core Strengths & Highlights)

### 🏎️ Procedural Supercar Geometry (`Car.ts`)
*   **Zero-Asset Wedge Supercar**: Rather than loading a large `.glb` or `.gltf` model, the car is constructed procedurally using `THREE.ExtrudeGeometry` with a custom-drawn side profile shape.
*   **Attention to Detail**: Features a greenhouse canopy, side skirts, front splitter, NACA-style hood vents, license plate with canvas-drawn `"ED1TION"` text, diffuser fins, twin exhausts, and a raised rear wing.
*   **Emissive Lighting**: The tail features a bright orange taillight bar with high emissive intensity ($1.4$) designed to catch the bloom pass, and thin headlights on the nose.
*   **Micro-Animations**: Front wheels steer dynamically using yaw lerps, wheels spin based on velocity, and the chassis applies body roll during turning and acceleration/braking pitch.

### 🌅 Stylized Retrowave Atmosphere & Environment (`Sky.ts`, `Scenery.ts`, `Lighting.ts`)
*   **Custom GLSL Shader Sky**: The sky uses a bespoke fragment shader gradient (deep purple zenith $\rightarrow$ magenta $\rightarrow$ hot pink $\rightarrow$ orange sunset) with procedural stars in the upper hemisphere and a scanline-cut retro sun disk reflecting over the water.
*   **Underwater Transition**: When diving below sea level, the fog color/density and sky dome shader transition seamlessly to an underwater teal ocean color with floaty bubble particles.
*   **Zone-Aware Scenery**: The track is decorated with suburban houses (complete with emissive window meshes), instanced palm trees, canyons, mountains, towers, sailboats, and hot air balloons.

### 🏁 Physics & Tracking Pipeline (`Track.ts`, `ChaseCamera.ts`, `Game.ts`)
*   **Spline-Based Road Ribbon**: Uses `THREE.CatmullRomCurve3` centripetal splines to generate a 2.5km loop, building custom road geometry and mapping neon side bounds.
*   **Smart Chase Camera**: A camera system that lags behind the car's heading to communicate weight and speed. It changes Field of View (FOV) at higher velocities and handles cinematic camera orbits on the start screen.
*   **Checkpoints and Progress**: Fully functional progress validation (`samples.length` divided by checkpoint zones) to prevent shortcut cheating.

### 🔊 Synthesized WebAudio Engine (`Audio.ts`)
*   **Synthesized Engine Loop**: Implements twin sawtooth and square oscillators connected to a lowpass filter, altering frequency and filter cutoff in real-time based on normalized speed.
*   **UI Sound Effects**: Retro 8-bit countdown beeps, checkpoint confirmation, crash collision noises, and a finishing fanfare are generated natively using WebAudio primitives without downloading audio assets.

### 🖥️ Post-Processing & Grading (`PostProcessing.ts`)
*   **Cinematic Pipeline**: Uses `EffectComposer` to chain UnrealBloom (thresholding neon emissions), chromatic aberration (scaling with speed and edge distance), split toning (warm highlights, purple shadows), film grain noise, and FXAA anti-aliasing.

---

## 3. THE BAD (Critical Issues & Limitations)

### ⚠️ Abrupt Track Boundary Wall Collisions (`Game.ts`)
*   **Instant Deceleration**: When the car goes past the neon track boundaries, it is instantly clamped to the maximum road width. The first frame of boundary breach applies a harsh speed reduction factor of `0.72` alongside screen-shake trauma.
*   **Sticky Boundary Traps**: If the player continues steering into the wall, the script applies a constant `0.985` scrub factor. Since there is no lateral bounce force, the car stays "stuck" to the wall, killing all momentum and ruining the gameplay flow.

### 📭 Missing Background Music (`Audio.ts`)
*   **Quiet Racing**: While engine sound effects and blips are synthesized perfectly, there is no background soundtrack. A driving retrowave/synthwave background track is essential for reinforcing the emotional state of a high-speed race.

### 📱 Start Screen Touch & Event Unlocking Issues (`main.ts`, `Audio.ts`)
*   **Browser Audio Restrictions**: Modern browsers block audio playback until user interaction occurs. If a click fails to register perfectly, or if a user starts the game using key presses (e.g. headless tests or slow loads), the audio context remains suspended, resulting in silent gameplay.
*   **Interaction Timeouts**: The "START" button can occasionally fail to respond on the first tap because the fade transition waits on a rigid set of timing flags, leading to user confusion.

### 💨 Lack of Dynamic Visual Feedback
*   **No Tire Trails or Skid Smoke**: During a high-speed drift or a hard brake, the tires show no smoke, and there are no tire marks left on the dark road surface.
*   **Missing Collision Sparks**: Crashing into neon walls shakes the screen and makes sound, but does not produce glowing sparks or debris to highlight the impact.

---

## 4. WHAT CAN BE MADE BETTER (Level-1 Upgrade Plan)

### 1. Physics: Lateral Boundary Bounce & Spring Walls
Instead of sticking to the track boundary and scrubbing speed, we should introduce a bounce impulse. When a collision occurs:
*   Calculate the collision normal pointing inward from the track edge.
*   Reflect the velocity vector across the boundary normal.
*   Reduce momentum slightly but push the car *away* from the wall to prevent sticking.

### 2. Audio: Synthesized Retrowave Background Soundtrack
To keep the payload lightweight, we can synthesize a basic retrowave bassline loop directly in `Audio.ts`:
*   Add a secondary scheduler using a standard WebAudio sequencing loop.
*   Implement a simple 4/4 drum/snare synth click and a pulsing retrowave bass pattern (e.g. a driving eighth-note bassline in F# minor).
*   Add a mute button toggle that disables both engine sounds and music.

### 3. FX: Tire Skid Marks & Sparks
*   **Skid Marks**: Draw dynamic ribbon geometry behind tires when the drift velocity divergence angle is large (skidding).
*   **Collision Sparks**: Instantiate a simple particle system at the point of wall collision. Use small glowing orange boxes that fly backward and fade away over time.

### 4. UI/UX: Interactive Leaderboard & Retrospective Upgrades
*   **Leaderboard Panel**: Expand `localStorage` usage to store the top 3 lap times and display them on the end screen in a scrollable list.
*   **Start Screen Glow Hover**: Add active hover states to the start button using a CSS keyframe pulse that changes color from orange to neon pink.

---

## 5. BLUEPRINT GAP COMPARISON

| Feature / Element | Blueprint Spec | Current Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Wedge Car** | Classic wedge supercar, fender flares, spoiler | Yes, procedurally built in `Car.ts` | ✅ Fully Implemented |
| **Edge Neon Lines** | Two glowing neon road border lines | Yes, orange on land, green in tunnel | ✅ Fully Implemented |
| **Atmosphere Fog** | Lerp between sunset and underwater fog | Yes, density and color lerps smoothly | ✅ Fully Implemented |
| **Post-Processing** | UnrealBloom, Chromatic Aberration, Vignette | Yes, custom composited passes | ✅ Fully Implemented |
| **Audio** | Loop engine pitch + UI sound effects | Yes, WebAudio synth oscillators | ✅ Fully Implemented |
| **Splash Shell** | Bold title script, instructions, flags | Yes, matches target fonts & styling | ✅ Fully Implemented |

---

## 6. RECOMMENDATIONS FOR LEVEL-2 UPGRADES
*   **Multiplayer / Shadow Car**: Save the player's best lap coordinate stream and render it as a translucent "ghost car" to race against.
*   **Dynamic Obstacles**: Introduce slow-moving sailboats in the causeway that create wind turbulences or random beach debris on the track.
