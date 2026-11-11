import * as THREE from 'three'
import { fbm2, smooth, trs } from '../../game/biomes/kit'
import { GLSL_NOISE } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest } from '../art/foliage'
import type { Solid } from '../World'
import type { Circuit } from '../Circuit'
import type { BuildKit, TrackDef } from '../types'
import { arrows, crates, drift, findGap, gantry, glow, movingDeck, stands } from './parts'

/** Curtain-wall glass: mullions and spandrels laid out in world space, so any box reads as a tower. */
function glassMaterial(tint: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.18, metalness: 0.75, envMapIntensity: 1.5 })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGw;\nvarying vec3 vGn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGw = (modelMatrix * vec4(position, 1.0)).xyz;\nvGn = normalize(mat3(modelMatrix) * normal);')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vGw;\nvarying vec3 vGn;\nfloat gFrame;`)
      .replace('#include <map_fragment>', `
        {
          float along = abs(vGn.x) > 0.5 ? vGw.z : vGw.x;
          vec2 cell = vec2(along / 1.8, vGw.y / 3.6);
          vec2 f = fract(cell);
          float mull = step(f.x, 0.06) + step(0.94, f.x);
          float floorBand = step(f.y, 0.22);
          gFrame = clamp(mull + floorBand, 0.0, 1.0) * step(abs(vGn.y), 0.5);
          float pane = aNoise(floor(cell) * 0.7);
          diffuseColor.rgb *= mix(0.75 + pane * 0.35, 0.35, gFrame);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.7, gFrame);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, 0.2, gFrame);')
  }
  m.customProgramCacheKey = () => `kart-glass-${tint}`
  return m
}

/** A tower crane: lattice mast, slewing jib and counter-jib. Returns the turning part. */
function crane(k: BuildKit, x: number, z: number, h: number, jib: number): { top: THREE.Group; mast: THREE.Vector3 } {
  const { world: w, root } = k
  const y = w.terrainAt(x, z)
  const mast = new Mesher(), Y = 0xe8b820
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mast.box(0.3, h, 0.3, x + a! * 1, y + h / 2, z + b! * 1, Y)
  for (let q = 0; q < h; q += 3) {
    mast.bar(new THREE.Vector3(x - 1, y + q, z - 1), new THREE.Vector3(x + 1, y + q + 3, z - 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x + 1, y + q, z + 1), new THREE.Vector3(x - 1, y + q + 3, z + 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x - 1, y + q, z + 1), new THREE.Vector3(x - 1, y + q + 3, z - 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x + 1, y + q, z - 1), new THREE.Vector3(x + 1, y + q + 3, z + 1), 0.07, Y, 4)
  }
  mast.box(3.6, 1, 3.6, x, y + 0.5, z, 0x6a6e74)
  place(k, mast, surface('paint', { metal: 0.5, rough: 0.45 }))
  w.addPost(x, z, 2)
  const top = new THREE.Group()
  const t = new Mesher()
  // jib out along +x, counter-jib with its weights along -x
  t.box(jib, 0.3, 0.3, jib / 2, 0, -0.8, Y).box(jib, 0.3, 0.3, jib / 2, 0, 0.8, Y).box(jib * 0.9, 0.3, 0.3, jib * 0.45, 1.8, 0, Y)
  for (let q = 0; q < jib; q += 2.5) {
    t.bar(new THREE.Vector3(q, 0, -0.8), new THREE.Vector3(q + 1.25, 1.8, 0), 0.06, Y, 4)
    t.bar(new THREE.Vector3(q + 1.25, 1.8, 0), new THREE.Vector3(q + 2.5, 0, 0.8), 0.06, Y, 4)
  }
  t.box(16, 0.6, 2, -8, 0, 0, Y).box(4, 3.4, 2.4, -13, -1.4, 0, 0x8a8e94)
  t.box(2.6, 2.6, 2.6, 2, -1.2, 0, 0x30343c) // the cab
  t.box(1.2, 9, 1.2, 0, 5, 0, Y)
  t.bar(new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(jib * 0.85, 1.8, 0), 0.05, 0x404448, 4)
  t.bar(new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(-15, 0.3, 0), 0.05, 0x404448, 4)
  const tm = new THREE.Mesh(t.build(), surface('paint', { metal: 0.5, rough: 0.45 }))
  tm.castShadow = true
  top.add(tm)
  top.position.set(x, y + h, z)
  root.add(top)
  return { top, mast: new THREE.Vector3(x, y + h, z) }
}

const STREET = 0.5

/*
 * Skyline Cranes: never touches the street. The start is on a podium roof;
 * down a ramp to the low roofs, a boosted leap across the avenue between two
 * towers (or round by the service bridge), up the ramps to the high roofs,
 * a drop across the gap to the next block, then the climb to the summit
 * tower and a glide off its edge down to the west roofs (or the scaffolding
 * on the half-built block, inside and lower). Tower cranes slew overhead.
 *
 * Lap 2: the cranes lower their loads across one lane. Last lap: the wind
 * gets up on the roofs and pushes you sideways, harder the higher you are.
 */
export const cranes: TrackDef = {
  id: 'cranes',
  name: 'Skyline Cranes',
  ambience: 'city',
  width: 16,
  bank: 2,
  shoulder: 4,
  accent: 0xffb03a,
  rails: 'steel',
  rail: 'LR',
  road: { lines: 'highway', grime: 0x5a5650, edgeLine: 0xf0e8d0, tone: 0.95 },
  terrain: { layers: ['grass', 'aerial_sand', 'rock_pitted_mossy', 'mud_cracked_dry_03'], tile: [20, 14, 20, 16], tints: [0x9aa080, 0xb0a890, 0xa09c94, 0xa89c88] },
  far: 0x6a6660,
  look: {
    tod: 'sunset', fog: [0.86, 0.66, 0.5], fogDensity: 0.0011, fogBase: 0, fogFall: 0.004, sunGlow: 1,
    exposure: 1.05, sun: 1.3, hemi: 0.95, bloom: 0.38, shafts: 0.6, grade: [1.12, 1.08, 0.01, 0.004, 0, 1.06, 0.98, 0.9, 0.32],
  },
  points: [
  [-170.4, 30, 284.0, { raised: true, w: 20 }],
  [0.0, 30, 284.0, { raised: true, pad: 0 }],
  [156.2, 30, 276.9, { raised: true, items: true }],
  [255.6, 24, 269.8, { raised: true, deck: 'steel' }],
  [355.0, 18, 241.4, { raised: true }],
  [440.2, 18, 170.4, { raised: true }],
  [480.0, 18, 71.0, { raised: true, pad: 0 }],
  [482.0, 18, 35.0, { raised: true, rail: '', pad: 0 }],
  [483.0, 21.3, 1.0, { gap: true }],
  [484.0, 19.3, -23.0, { gap: true }],
  [485.0, 17.3, -55.0, { raised: true, w: 22 }],
  [491.3, 22, -213.0, { raised: true }],
  [468.6, 34, -340.8, { raised: true, deck: 'steel' }],
  [411.8, 46, -454.4, { raised: true }],
  [312.4, 46, -489.9, { raised: true, items: true }],
  [213.0, 46, -497.0, { raised: true, rail: '' }],
  [191.0, 47.5, -498.0, { gap: true }],
  [169.0, 44.5, -499.0, { gap: true }],
  [147.0, 40.5, -500.0, { raised: true, w: 20 }],
  [28.4, 40, -505.5, { raised: true }],
  [-113.6, 40, -489.9, { raised: true }],
  [-241.4, 47, -454.4, { raised: true, deck: 'steel' }],
  [-340.8, 55, -397.6, { raised: true, deck: 'steel' }],
  [-411.8, 62, -312.4, { raised: true, items: true }],
  [-433.1, 62, -248.5, { raised: true, pad: 0, rail: '' }],
  [-434.1, 63, -236.5, { gap: true, glide: true }],
  [-436.1, 55, -186.5, { gap: true, glide: true }],
  [-438.1, 47, -136.5, { gap: true, glide: true }],
  [-439.1, 41, -104.5, { gap: true, glide: true }],
  [-440.1, 36, -72.5, { raised: true, w: 28 }],
  [-408.0, 32, 112.0, { raised: true, w: 20 }],
  [-355.0, 30, 241.4, { raised: true }],
  [-345.0, 24, 345.0, { raised: true, deck: 'steel' }],
  [-262.0, 22, 382.0, { raised: true }],
  [-200.0, 27, 322.0, { raised: true, deck: 'steel' }],
  ],
  branches: [
    {
      // round the corner on the service bridge: no leap, but the long way
      name: 'Service bridge', from: 5, to: 11, odds: 0.35,
      points: [
        [520, 18, 110, { raised: true, deck: 'steel', w: 14, rail: 'LR' }],
        [560, 20, 0, { raised: true, deck: 'steel', w: 14, rail: 'LR' }],
        [548, 21, -120, { raised: true, deck: 'steel', w: 14, rail: 'LR' }],
      ],
    },
    {
      // down the scaffolding of the half-built block: the inside line, on planks
      name: 'Scaffolding', from: 20, to: 30, odds: 0.5,
      points: [
        [-168, 40, -462, { raised: true, deck: 'wood', w: 14, rail: 'LR' }],
        [-215, 34, -390, { raised: true, deck: 'wood', w: 13, rail: 'LR' }],
        [-262, 31, -300, { raised: true, deck: 'wood', w: 13, rail: 'LR', items: true }],
        [-330, 30, -180, { raised: true, deck: 'wood', w: 13, rail: 'LR' }],
        [-362, 30, -50, { raised: true, deck: 'wood', w: 13, rail: 'LR', pad: 0 }],
        [-384, 31, 36, { raised: true, deck: 'wood', w: 14, rail: 'LR' }],
      ],
    },
    {
      // the crane lift: a crane hoists a steel deck between the low roof and
      // the high one. Raised, it's a ramp straight up; lowered, the gate is
      // down and you wait. Arrive as it goes green and it's the quick way up.
      name: 'Crane lift', from: 11, to: 14, odds: 0.4,
      points: [
        [478, 22, -262, { raised: true, w: 14, rail: 'LR' }],
        [462, 22, -290, { raised: true, w: 14, rail: '' }],
        [446, 30, -318, { gap: true, w: 14 }],
        [430, 38, -346, { gap: true, w: 14 }],
        [414, 46, -374, { raised: true, w: 14, rail: '' }],
        [384, 46, -428, { raised: true, w: 14, rail: 'LR', pad: 0 }],
      ],
    },
  ],

  ground: (x, z) => fbm2(x * 0.004, z * 0.004) * 1.2 - 0.6 + smooth(700, 1100, Math.hypot(x, z + 80)) * -20,
  splat(x, z, _h, _slope, roadDist, mix, tint) {
    const lot = fbm2(x * 0.012, z * 0.012)
    mix[0] = smooth(0.55, 0.7, lot) * smooth(14, 30, roadDist)
    mix[1] = 1 - mix[0]
    mix[2] = 0
    mix[3] = smooth(0.4, 0.3, lot) * 0.6
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'concrete',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    const paths = c.all
    gantry(k, 'Skyline Cranes', '#ffb03a')
    stands(k, 8, 40, 1, [0xe8a03a, 0x2a3448, 0xe8e6e0, 0x3a7ab0, 0xc04a3a], 0xffb03a, 'Skyline Cranes')
    arrows(k, 0xffb03a)

    // ── the buildings the rooftop road runs across, and scaffolding under the planks
    const blocks = new Mesher(), roofs = new Mesher(), scaff = new Mesher()
    const glass = [glassMaterial(0x8aa0b8), glassMaterial(0x9a8a7a), glassMaterial(0x7a9a9a)]
    const towers = [new Mesher(), new Mesher(), new Mesher()]
    for (const cc of paths) {
      let runStart = -1
      const flushRun = (a: number, b: number): void => {
        // one building per run of rooftop road, broken into blocks every ~40 m
        for (let i = a; i < b; i += 20) {
          const j = Math.min(b - 1, i + 20), p = cc.samples[i]!, q = cc.samples[j]!
          if (j - i < 4) continue
          const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, top = Math.min(p.y, q.y) - 0.6
          const t = cc.tangents[i]!, yaw = Math.atan2(-t.x, -t.z), len = Math.hypot(q.x - p.x, q.z - p.z) + 3
          const wide = cc.widths[i]! + 18
          towers[(i / 20) % 3 | 0]!.box(wide, top - STREET, len, mx, (top + STREET) / 2, mz, 0xffffff, yaw)
          roofs.box(wide + 0.6, 0.8, len + 0.4, mx, top + 0.1, mz, 0x6a6660, yaw)
          // a parapet on each edge of the roof, set back from the road
          const r = cc.rights[i]!
          for (const s of [-1, 1]) {
            // no parapet where another road crosses this roof (at a fork or a join)
            const px = mx + r.x * s * (wide / 2), pz = mz + r.z * s * (wide / 2)
            let crossed = false
            for (let f = -0.5; f <= 0.5 && !crossed; f += 0.25) {
              const qx = px + Math.sin(yaw + Math.PI) * 0 + (q.x - p.x) * f, qz = pz + (q.z - p.z) * f
              crossed = paths.some((o) => o !== cc && o.roadAt(qx, qz, top + 3, { i: -1, lat: 0, y: 0 }))
            }
            if (!crossed) roofs.box(0.5, 1.2, len, px, top + 1, pz, 0x8a847c, yaw)
          }
          w.addBox(mx, mz, wide / 2, len / 2, yaw, top - 1.2)
        }
      }
      for (let i = 0; i <= cc.count; i++) {
        // only under level rooftop road: a ramp must never run into a building's side
        const on = i < cc.count && cc.raised[i]! && !cc.gap[i]! && cc.deck[i] !== 2 && cc.deck[i] !== 4 && cc.samples[i]!.y > 15 && Math.abs(cc.tangents[i]!.y) < 0.07
        if (on && runStart < 0) runStart = i
        if (!on && runStart >= 0) { flushRun(runStart, i); runStart = -1 }
      }
    }
    towers.forEach((t, q) => { if (!t.empty) place(k, t, glass[q]!) })
    place(k, roofs, surface('concrete'))
    // scaffolding: tubes and boards under the wooden decks
    for (const c of paths) for (let i = 0; i < c.count; i += 4) {
      if (c.deck[i] !== 2 || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, half = c.widths[i]! / 2
      for (const s of [-1, -0.33, 0.33, 1]) {
        const x = p.x + r.x * s * half, z = p.z + r.z * s * half
        scaff.post(0.08, 0.08, p.y - STREET, x, STREET, z, 0x9aa0a8, 5)
        if (Math.abs(s) === 1) w.addPost(x, z, 0.25, p.y - 1.2)
      }
      for (let y = STREET + 2; y < p.y - 1; y += 2.2) {
        scaff.bar(new THREE.Vector3(p.x - r.x * half, y, p.z - r.z * half), new THREE.Vector3(p.x + r.x * half, y, p.z + r.z * half), 0.05, 0x9aa0a8, 4)
        if (i % 8 === 0) scaff.bar(new THREE.Vector3(p.x - r.x * half, y, p.z - r.z * half), new THREE.Vector3(p.x + r.x * half, y + 2.2, p.z + r.z * half), 0.04, 0x9aa0a8, 4)
      }
      // safety netting on the outside
      for (const s of [-1, 1]) scaff.box(0.05, 2.6, 8.2, p.x + r.x * s * (half + 0.6), p.y - 0.4, p.z + r.z * s * (half + 0.6), 0x3a6a3a, Math.atan2(-c.tangents[i]!.x, -c.tangents[i]!.z))
    }
    place(k, scaff, surface('metal', { rough: 0.5 }))
    // the jump lips, striped like a hoarding
    const lips = new Mesher()
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (!(!c.gap[i] && c.gap[j])) continue
      const p = c.samples[i]!, t = c.tangents[i]!
      lips.box(c.widths[i]! + 1, 1.8, 1.2, p.x, p.y - 1.1, p.z, 0xffb03a, Math.atan2(-t.x, -t.z))
    }
    place(k, lips, surface('paint'))

    // ── the city: towers on a grid, real brick blocks along the streets
    const city = [new Mesher(), new Mesher(), new Mesher()], cityRoofs = new Mesher()
    for (let x = -1000; x <= 1000; x += 64) for (let z = -1000; z <= 800; z += 64) {
      const cx = x + (d.rand() - 0.5) * 10, cz = z + (d.rand() - 0.5) * 10
      const hx = 13 + d.rand() * 9, hz = 13 + d.rand() * 9
      if (d.roadGap(cx, cz) < Math.hypot(hx, hz) + 8 || w.blocked(cx, cz, Math.hypot(hx, hz))) continue
      const near = d.roadGap(cx, cz) < 90
      const tall = (near ? 30 : 60) + d.rand() * d.rand() * 220
      const unfinished = d.rand() < 0.18
      const q = Math.floor(d.rand() * 3)
      if (unfinished) {
        // a concrete frame still going up: floors on columns, no walls yet
        for (let y = 0; y < tall * 0.6; y += 4) {
          blocks.box(hx * 2, 0.5, hz * 2, cx, y + 4, cz, 0xa8a49c)
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) blocks.box(0.8, 4, 0.8, cx + a! * (hx - 0.5), y + 2, cz + b! * (hz - 0.5), 0xb0aca4)
        }
        crane(k, cx + hx + 4, cz, tall * 0.6 + 26, 34).top.rotation.y = d.rand() * 6
      } else {
        city[q]!.box(hx * 2, tall, hz * 2, cx, tall / 2, cz, 0xffffff)
        cityRoofs.box(hx * 1.2, 3, hz * 1.2, cx, tall + 1.5, cz, 0x5a5e64)
      }
      w.addBox(cx, cz, hx, hz)
    }
    city.forEach((t, q) => { if (!t.empty) place(k, t, glass[q]!) })
    place(k, cityRoofs, surface('concrete'))
    if (!blocks.empty) place(k, blocks, surface('concrete'))
    d.prop('bk:street_lamp_01', d.spots(30, 1.5, 2.5, { clear: 1.2, test: (_x, _z, y) => y < 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4)), 0.25)
    d.prop('concrete_road_barrier', d.spots(24, 2, 6, { clear: 1.8, test: (_x, _z, y) => y < 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1)), 0.8)
    crates(d, d.spots(18, 2, 7, { clear: 1.5 }), 0xc8a060)
    forest(k, 'oak', d.spots(40, 4, 12, { clear: 4, test: (_x, _z, y) => y < 2 }), { scale: [0.5, 0.75], tints: [0xc8d8a0, 0xb8cc90] })

    // ── the cranes over the road: their loads swing low across it from lap two
    const swingers: { top: THREE.Group; beam: THREE.Mesh; cable: THREE.Mesh; i: number; solid: Solid; lap: number; ph: number; reach: number }[] = []
    const beamGeo = new Mesher().box(1.2, 1.2, 14, 0, 0, 0, 0xc04a2a).build()
    const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4)
    const P = cranes.points
    for (const [pt, lap] of [[14, 2], [19, 2], [2, 3]] as const) {
      const i = c.track(P[pt]![0], P[pt]![2], 0, c.count, P[pt]![1]), p = c.samples[i]!, r = c.rights[i]!, fr = i / c.count
      const side = lap === 3 ? -1 : 1, reach = 28
      const mx = p.x + r.x * side * reach, mz = p.z + r.z * side * reach
      const cr = crane(k, mx, mz, p.y + 34 - w.terrainAt(mx, mz), 44)
      cr.top.rotation.y = Math.atan2(r.z * side, -r.x * side)
      const beam = new THREE.Mesh(beamGeo, surface('paint', { metal: 0.6, rough: 0.4 }))
      const cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7 }))
      beam.castShadow = true
      root.add(beam, cable)
      const solid: Solid = { x: 0, z: 0, r: 8, hx: 0.8, hz: 7, cos: 1, sin: 0, top: -1e6 }
      w.movers.push(solid)
      swingers.push({ top: cr.top, beam, cable, i, solid, lap, ph: fr * 9, reach })
    }

    // ── the jib bridge: a crane stands in the street between the two blocks and
    // swings its jib into line across the gap. In line, you drive straight over
    // it; swung away, you jump the gap; part way, you may land on it as it moves.
    {
      const g = findGap(c, 180, -498)
      const lip = c.samples[g.i0 - 1]!, land = c.samples[g.i1 + 1]!
      const along = Math.atan2(land.x - lip.x, land.z - lip.z)
      const span = Math.hypot(land.x - lip.x, land.z - lip.z) + 6
      const mx = (lip.x + land.x) / 2, mz = (lip.z + land.z) / 2
      const jib = movingDeck(k, 10, span, 0xe8b820, 0x2a2a30, 1.4)
      // the mast down to the street, and the slewing top
      const mast = new Mesher(), y0 = w.terrainAt(mx, mz), top = Math.min(lip.y, land.y) - 1.6
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mast.box(0.35, top - y0, 0.35, mx + a! * 1.3, (top + y0) / 2, mz + b! * 1.3, 0xe8b820)
      for (let q = y0; q < top; q += 3) mast.bar(new THREE.Vector3(mx - 1.3, q, mz - 1.3), new THREE.Vector3(mx + 1.3, q + 3, mz + 1.3), 0.08, 0xe8b820, 4)
      place(k, mast, surface('paint', { metal: 0.5, rough: 0.45 }))
      w.addPost(mx, mz, 2, top - 2)
      const cab = new THREE.Mesh(new Mesher().box(4, 3, 4, 0, -3, 0, 0x30343c).box(1.2, 14, 1.2, 0, 7, 0, 0xe8b820).build(), surface('paint', { metal: 0.5, rough: 0.45 }))
      root.add(cab)
      let ph = 0
      k.onFrame((f) => {
        ph = (ph + f.dt * (f.lap >= 2 ? 1.2 : 1)) % 15
        // in line 6 s, swing out over 3 s, hold 3 s, back over 3 s
        const u = ph < 6 ? 0 : ph < 9 ? (ph - 6) / 3 : ph < 12 ? 1 : 1 - (ph - 12) / 3
        const yaw = along + 1.25 * u * u * (3 - 2 * u)
        // which end is higher follows the swing: in line it runs down from lip to landing
        jib.set(mx, mz, yaw, lip.y, land.y, 0, 0)
        jib.pl.live = u < 0.95
        cab.position.set(mx, (lip.y + land.y) / 2 + 1.5, mz)
        cab.rotation.y = yaw
      })
    }

    craneLift(k, c.branches[2]!)

    // grit blowing across the roofs on the last lap
    const dust = drift(k, 900, 0xc8b8a0, 0.35, 2, true)
    dust.visible = false

    // warning lights on the crane tips
    const tips = swingers.map((s) => s.top)
    const tipMat = glow(4, 0.4, 0.2)
    const tipLights = d.instanced(new THREE.SphereGeometry(0.6, 8, 6), tipMat, tips.map(() => new THREE.Matrix4()), false)
    tipLights.frustumCulled = false

    const v = new THREE.Vector3(), m4 = new THREE.Matrix4()
    k.onFrame((f) => {
      tipMat.color.setRGB(Math.sin(f.time * 4) > 0 ? 5 : 0.4, 0.3, 0.2)
      swingers.forEach((s, q) => {
        const active = f.lap >= s.lap
        const p = c.samples[s.i]!, r = c.rights[s.i]!, t = c.tangents[s.i]!
        // slew back and forth; when active the hook sweeps right over the road
        const sweep = active ? Math.sin(f.time * 0.45 + s.ph) : 0.6 + Math.sin(f.time * 0.2 + s.ph) * 0.2
        // the hook's distance from the road's centre, on the crane's side
        // never past the middle of the road: the far lane always stays open
        const L = active ? THREE.MathUtils.lerp(s.reach - 6, c.widths[s.i]! * 0.12, (sweep + 1) / 2) : s.reach - 6 + sweep * 2
        const side = s.lap === 3 ? -1 : 1
        const hx = p.x + r.x * side * L, hz = p.z + r.z * side * L
        const drop = active ? p.y + 1.1 : p.y + 16
        const top = s.top.position
        s.top.rotation.y = Math.atan2(-(hz - top.z), hx - top.x)
        const beamY = THREE.MathUtils.lerp(s.beam.position.y || drop, drop, Math.min(1, f.dt * 0.8))
        s.beam.position.set(hx, beamY, hz)
        s.beam.rotation.y = Math.atan2(-t.x, -t.z) + Math.PI / 2
        v.set(hx, (top.y + beamY) / 2, hz)
        s.cable.position.copy(v)
        s.cable.scale.set(1, top.y - beamY, 1)
        s.solid.x = hx; s.solid.z = hz
        s.solid.cos = Math.cos(s.beam.rotation.y); s.solid.sin = Math.sin(s.beam.rotation.y)
        // only solid while it hangs at car height
        s.solid.top = beamY < p.y + 3 ? beamY + 0.6 : -1e6
        m4.makeTranslation(top.x + Math.cos(s.top.rotation.y) * 44, top.y + 0.6, top.z - Math.sin(s.top.rotation.y) * 44)
        tipLights.setMatrixAt(q, m4)
      })
      tipLights.instanceMatrix.needsUpdate = true
      // the last lap: gusts across the roofs
      const gusty = f.totalLaps > 1 && f.lap >= f.totalLaps
      const g = gusty ? (0.6 + 0.4 * Math.sin(f.time * 0.9)) * Math.max(0, Math.sin(f.time * 0.31)) : 0
      w.wind.x = g * 4.5
      w.wind.z = g * -1.5
      dust.visible = gusty
    })
  },
}

/**
 * The crane lift: a steel deck hung from a crane across the gap on the lift
 * road. Lowered, it lies flat at the low roof and ends in thin air; raised,
 * it's a ramp from the low roof up to the high one. Up for 7 s in every 15
 * (6 in 13 from lap 2), with a lamp that goes green while it's up and
 * flashes before it drops. A boom gate before the lip stays down unless
 * there's time to get across, so you wait for the lift rather than fall.
 */
function craneLift(k: BuildKit, lift: Circuit): void {
  const { world: w, root } = k
  const g = findGap(lift, 438, -332)
  const lip = lift.samples[Math.max(0, g.i0 - 1)]!, land = lift.samples[Math.min(lift.count - 1, g.i1 + 1)]!
  const yaw = Math.atan2(land.x - lip.x, land.z - lip.z)
  const span = Math.hypot(land.x - lip.x, land.z - lip.z) + 4
  const mx = (lip.x + land.x) / 2, mz = (lip.z + land.z) / 2
  const deck = movingDeck(k, lift.widths[g.i0]! + 0.6, span, 0x5a6068, 0xe8b820, 1.2)
  const hang = crane(k, mx + Math.cos(yaw) * 22, mz - Math.sin(yaw) * 22, Math.max(lip.y, land.y) + 30, 34)
  // the hoist cables from the jib down to each end of the deck
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.6 })
  const cables = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 5), cableMat); root.add(m); return m })
  const lampMat = glow(0.3, 3, 0.4)
  for (const e of [lip, land]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lampMat)
    lamp.position.set(e.x + Math.cos(yaw) * 9, e.y + 4.5, e.z - Math.sin(yaw) * 9)
    root.add(lamp)
    w.addPost(lamp.position.x, lamp.position.z, 0.3)
  }
  // a boom gate at the lip: it drops whenever the deck won't be up by the
  // time you're over it, so you wait for the lift rather than drive off
  const gi = Math.max(0, g.i0 - 6), gp = lift.samples[gi]!, gt = lift.tangents[gi]!, gr = lift.rights[gi]!
  const gyaw = Math.atan2(-gt.x, -gt.z), ghalf = lift.widths[gi]! / 2
  const arm = new THREE.Group()
  arm.position.set(gp.x + gr.x * (ghalf + 0.6), gp.y + 1.1, gp.z + gr.z * (ghalf + 0.6))
  arm.rotation.y = gyaw
  const armMesh = new THREE.Mesh(new Mesher().box(ghalf * 2 + 0.8, 0.35, 0.35, -(ghalf + 0.4), 0, 0, 0xe8e8e8).box(1.2, 0.36, 0.36, -2, 0, 0, 0xd83a2a).box(1.2, 0.36, 0.36, -5, 0, 0, 0xd83a2a).box(1.2, 0.36, 0.36, -8, 0, 0, 0xd83a2a).box(1.2, 0.36, 0.36, -11, 0, 0, 0xd83a2a).build(), surface('paint'))
  const armPivot = new THREE.Group()
  armPivot.add(armMesh)
  arm.add(armPivot)
  root.add(arm)
  const gate: Solid = { x: gp.x, z: gp.z, r: ghalf + 1, hx: ghalf + 1, hz: 0.5, cos: Math.cos(gyaw), sin: Math.sin(gyaw), top: -1e6 }
  w.movers.push(gate)
  w.addPost(arm.position.x, arm.position.z, 0.5)
  let armA = 0
  const v = new THREE.Vector3()
  let ph = 0
  k.onFrame((f) => {
    const cycle = f.lap >= 2 ? 13 : 15
    ph = (ph + f.dt) % cycle
    // down 4 s, up over 2 s, held 7 s (6 from lap 2), down over 2 s
    const held = f.lap >= 2 ? 6 : 7
    const u = ph < cycle - held - 4 ? 0 : ph < cycle - held - 2 ? (ph - (cycle - held - 4)) / 2 : ph < cycle - 2 ? 1 : 1 - (ph - (cycle - 2)) / 2
    const e = u * u * (3 - 2 * u)
    const front = lip.y + (land.y - lip.y) * e
    deck.set(mx, mz, yaw, lip.y, front, 0, 0)
    hang.top.rotation.y = Math.atan2(-(mz - hang.mast.z), mx - hang.mast.x)
    // cables from the jib over the deck down to each end
    for (let q = 0; q < 2; q++) {
      const ex = mx + Math.sin(yaw) * span * (q ? 0.3 : -0.3), ez = mz + Math.cos(yaw) * span * (q ? 0.3 : -0.3)
      const ey = (lip.y + front) / 2 + (front - lip.y) * (q ? 0.3 : -0.3)
      const top = hang.mast.y
      v.set(ex, (ey + top) / 2, ez)
      cables[q]!.position.copy(v)
      cables[q]!.scale.set(1, top - ey, 1)
    }
    const upFor = u >= 1 ? cycle - 2 - ph : 0
    const warn = u >= 1 && upFor < 1.5
    lampMat.color.setRGB(u >= 1 ? (warn && Math.sin(f.time * 14) > 0 ? 5 : 0.3) : 4, u >= 1 ? (warn ? 0.6 : 3) : 0.4, 0.3)
    // the gate is open from just before the deck is fully up until well
    // before it drops: anyone through the gate makes it over
    const open = (u > 0.7 && ph < cycle - held - 2 + 0.1) || (u >= 1 && upFor > 4.4)
    armA += ((open ? 1.45 : 0) - armA) * Math.min(1, f.dt * 5)
    armPivot.rotation.z = -armA
    gate.top = armA < 0.6 ? gp.y + 6 : -1e6
    lift.join!.odds = 0.4
  })
}
