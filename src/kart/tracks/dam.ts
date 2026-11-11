import * as THREE from 'three'
import { canvasTexture, fbm2, ridged2, smooth, softDot, trs } from '../../game/biomes/kit'
import { windClock } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import { buildWater } from '../art/water'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Solid } from '../World'
import { arrows, crates, drift, gantry, glow, stands } from './parts'

/*
 * The Great Dam, as a journey. Start in the valley town at the foot of the
 * gorge, with the dam a grey wall nine hundred metres up the valley. Climb
 * the east side on switchbacks (or gamble on the quarry haul road and its
 * pit jump), cross the curved crest of the dam above the reservoir, drop
 * down the spillway channel and fly off its lip on wings, glide down the
 * gorge and land on the ramp to the power house. Drive through the turbine
 * hall, jump the broken bridge over the side canyon (only with a boost),
 * then round the meander and back into town over the river bridge.
 *
 * Lap 2: the spillway gates open. The river rises, and the sluice gate on
 * the flood channel lifts: a wet shortcut across the meander. Last lap: the
 * gates open wide, spray hangs over the gorge and the low road floods.
 */

const CREST = 62
const LAKE = 56
const SEA = 1

/** The river's line down the gorge. */
const xr = (z: number) => 30 * Math.sin(z * 0.006)
/** Half-width of the flat valley floor. */
const fh = (z: number) => 70 + smooth(0, 160, z) * 40 + smooth(640, 820, z) * 170
/** How far the walls take to rise: the east side lies back for the switchbacks. */
const wallW = (z: number, east: boolean) => (east ? 120 + smooth(80, 260, z) * 150 * (1 - smooth(560, 700, z)) : 115)
const top = (z: number) => 95 - smooth(700, 900, z) * 38

/** The knoll the river bends round: the main road goes round it, the flood channel cuts inside. */
const KNOLL = { x: -140, z: 760, r: 75, h: 18 }
/** The side canyon the broken bridge crosses. */
const SIDE = { z: 628, half: 40 }

/** Smooth ground with no noise: the road is laid on this. */
function profile(x: number, z: number): number {
  // the gorge below the dam
  const d = Math.abs(x - xr(z)), east = x > xr(z), f = fh(z)
  const bed = d < 26 ? -3 + (d / 26) * 4 : 1 + smooth(26, f, d) * 6
  const u = smooth(f, f + wallW(z, east), d)
  let g = bed + (top(z) - bed) * Math.pow(u, 1.3)
  // the reservoir valley above it, drowned
  const lakeBed = THREE.MathUtils.lerp(16, 104, Math.pow(smooth(90, 280, Math.abs(x)), 1.2))
  g = THREE.MathUtils.lerp(g, lakeBed, smooth(-10, -60, z))
  // the knoll in the meander
  const k = Math.hypot(x - KNOLL.x, z - KNOLL.z)
  g += KNOLL.h * Math.exp(-(k * k) / (KNOLL.r * KNOLL.r))
  // the side canyon: a cut down to the water from the west wall
  if (x < xr(z) - 25) g = THREE.MathUtils.lerp(g, -3, smooth(SIDE.half + 14, SIDE.half - 4, Math.abs(z - SIDE.z)) * smooth(-25, -45, x - xr(z)))
  return g
}

/** A point on the ground (plus a lift). */
const on = (x: number, z: number, lift = 0.4, o?: TrackPoint[3]): TrackPoint => [x, Math.max(SEA + 1.4, profile(x, z) + lift), z, o]

/** The crest's curve: the arch bows upstream. */
const crestZ = (x: number) => -30 * (1 - (x / 182) ** 2)

const POINTS: TrackPoint[] = [
  // 0: the town, east bank, heading up the valley
  on(72, 905),
  on(80, 840, 0.4, { items: true }),
  on(100, 770, 0.4, { pad: 0 }),
  on(120, 690),
  // 4: the climb: first leg north along the slope
  [131, 9, 600],
  [178, 14, 500, { items: true }],
  [205, 18, 410],
  [222, 22, 340],
  [232, 24, 300],
  // 9: first hairpin, then the second leg back south
  [252, 26, 266, { bank: 4, w: 20 }],
  [272, 29, 300],
  [282, 32, 370],
  [286, 35, 430],
  // 13: second hairpin, then the long third leg north
  [304, 37, 468, { bank: 4, w: 20 }],
  [322, 40, 430],
  [330, 44, 360, { pad: 0 }],
  [326, 48, 280],
  [300, 52, 200],
  [250, 56, 120],
  [205, 59, 60], // 19: the service bridge leaves here
  // 20: onto the dam crest, across the top of the arch
  [182, CREST, 6, { rail: 'LR' }],
  [120, CREST, crestZ(120), { raised: true, rail: 'LR' }],
  [40, CREST, crestZ(40), { raised: true, rail: 'LR', items: true }],
  [-40, CREST, crestZ(-40), { raised: true, rail: 'LR' }],
  [-120, CREST, crestZ(-120), { raised: true, rail: 'LR' }],
  [-184, CREST, 4, { rail: 'LR' }],
  // 26: the service bridge rejoins; down the spillway channel cut through the rock
  [-214, 61, 40],
  [-206, 58, 92, { pad: 0 }],
  [-176, 54, 132],
  // 29: the lip: a ski-jump of concrete over the gorge, then wings
  [-146, 54, 158, { raised: true, w: 20 }],
  [-136, 55, 166, { raised: true, gap: true, glide: true }],
  [-112, 47, 214, { raised: true, gap: true, glide: true }],
  [-90, 39, 266, { raised: true, gap: true, glide: true }],
  [-77, 33, 298, { raised: true, gap: true, glide: true }],
  // 34: the landing ramp, down to the power house
  [-66, 28, 330, { raised: true, w: 28 }],
  [-58, 16, 392, { raised: true, w: 22 }],
  on(-58, 450, 0.4, { items: true }),
  // 37: through the turbine hall
  on(-62, 500),
  [-66, 4.8, 540, { raised: true, pad: 0, rail: 'LR' }],
  // 39: the broken bridge over the side canyon: only a boost (or nitro, or a
  // drift boost) carries you over; arrive at plain top speed and you drop in
  [-70, 8.2, 566, { raised: true, rail: 'LR' }],
  [-72, 11.5, 600, { raised: true, gap: true }],
  [-74, 9.5, 624, { raised: true, gap: true }],
  [-76, 7.5, 656, { raised: true, rail: 'LR' }],
  // 43: the meander, round the west side of the knoll (the flood channel leaves here)
  on(-108, 692),
  on(-170, 680, 0.5),
  on(-230, 730, 0.5, { items: true }),
  on(-232, 800, 0.5),
  on(-180, 850),
  // 48: into town (the flood channel rejoins here), and over the river bridge
  on(-110, 882),
  on(-62, 925),
  [-38, 6, 958, { raised: true, rail: 'LR' }],
  [4, 6.5, 978, { raised: true, rail: 'LR' }],
  on(50, 968),
]

export const dam: TrackDef = {
  id: 'dam',
  name: 'The Great Dam',
  ambience: 'canyon',
  width: 18,
  bank: 2.6,
  shoulder: 26,
  accent: 0x7fb0c8,
  sea: SEA,
  water: { deep: 0x1c3a40, shallow: 0x5a8a7a, foam: 0xeef4f0, waves: 0.6 },
  rails: 'steel',
  road: { lines: 'highway', grime: 0x8a8070, edgeLine: 0xe8e4d8, dirt: 'mud_cracked_dry_03' },
  terrain: { layers: ['grass', 'forest_floor', 'rock_pitted_mossy', 'aerial_sand'], tile: [26, 11, 22, 20], tints: [0xc4d098, 0xd0d4a8, 0xc8c0b0, 0xd8ccb0] },
  look: {
    tod: 'midday', fog: [0.74, 0.8, 0.86], fogDensity: 0.00055, fogBase: 20, fogFall: 0.01, sunGlow: 0.6,
    exposure: 1, sun: 1.15, hemi: 1, bloom: 0.25, shafts: 0.3, grade: [1.08, 1.06, 0, 0.004, 0.01, 1.02, 1, 0.98, 0.28],
  },
  points: POINTS,
  branches: [
    {
      // the old service bridge across the face of the dam: narrow, no rails, a
      // long way down. Straighter than the crest, with boost strips.
      name: 'Service bridge', from: 19, to: 27, odds: 0.4,
      points: [
        [150, 52, 22, { raised: true, w: 11, deck: 'steel' }],
        [60, 50, 16, { raised: true, w: 11, deck: 'steel', pad: 0 }],
        [-60, 50, 16, { raised: true, w: 11, deck: 'steel', pad: 0 }],
        [-150, 52, 24, { raised: true, w: 11, deck: 'steel' }],
        [-186, 56, 50, { w: 12 }],
      ],
    },
    {
      // the flood channel: shut on the first lap, a wet shortcut after
      name: 'Flood channel', from: 43, to: 48, odds: 0,
      points: [
        [-92, 2.4, 712, { w: 15 }],
        [-94, 2.4, 780, { w: 15 }],
        [-104, 2.6, 840, { w: 15 }],
      ],
    },
  ],
  ground(x, z) {
    const n = fbm2(x * 0.01, z * 0.01)
    const g = profile(x, z)
    // rock texture on the walls, a little roll on the floor
    const steep = smooth(10, 50, g)
    return g + ridged2(x * 0.02, z * 0.02, 4) * 6 * steep + n * (1.5 + steep * 3)
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.42, 0.8, slope)
    const shore = smooth(4.5, 1.5, h)
    mix[0] = (1 - rock) * (1 - shore)
    mix[1] = (1 - rock) * 0.4
    mix[2] = rock
    mix[3] = Math.max(shore, smooth(9, 3, roadDist) * 0.5)
    tint.setRGB(1, 1, 1)
    void x; void z
  },
  surfaceAt: (x, z) => (Math.abs(x - xr(z)) < 40 ? 'sand' : 'grass'),
  async build(k) {
    const { circuit: c, world: w, d, root, road } = k
    gantry(k, 'The Great Dam', '#7fb0c8')
    stands(k, 6, 30, -1, [0x2a6a9a, 0xe8e6e0, 0xd8a83a, 0x3a4a5a, 0xc05a4a], 0x7fb0c8, 'Great Dam')
    arrows(k, 0xffc040)
    mountainRing(root, 0, 450, { inner: 1200, outer: 3400, height: 560, rock: 0x6a7068, snow: 0xf4f6f8, snowLine: 0.62, seed: 21 })
    const service = c.branches[0]!, channel = c.branches[1]!

    buildDam(k)
    buildTown(k)
    buildPowerHouse(k)
    buildBrokenBridge(k)
    buildServiceBridge(k, service)

    // ── the gorge: pine forest on the rims, oaks on the floor, rock faces
    const rim = (_x: number, _z: number, y: number) => y > 34
    forest(k, 'pine', d.spots(320, 10, 160, { clear: 9, test: rim }), { scale: [0.8, 1.35], tints: [0xc8d8b8, 0xb8cca8, 0xd4dcc0] })
    forest(k, 'pine', d.spots(260, 120, 420, { clear: 30, test: rim }), { scale: [0.9, 1.4], solid: 0, tints: [0xc0d0b0] })
    forest(k, 'oak', d.spots(110, 8, 60, { clear: 8, test: (_x, _z, y) => y > 3 && y < 30 }), { scale: [0.6, 1], tints: [0xc8dca0, 0xb8cc90] })
    grass(k, { density: 2.4, reach: 22, height: [0.4, 0.9], colors: [0x8aa060, 0x7a9450, 0x9cac6c], test: (_x, _z, y) => y > 3 })
    // rocks only where the ground is gentle enough to hold them: on a cliff
    // face they hang in the air
    const flat = (lim: number) => (x: number, _z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, _z) - w.terrainAt(x - e, _z), gz = w.terrainAt(x, _z + e) - w.terrainAt(x, _z - e)
      return Math.hypot(gx, gz) / (2 * e) < lim && y > SEA + 1
    }
    d.prop('bk:namaqualand_boulder_03', d.spots(46, 6, 50, { clear: 7, test: flat(0.35) }).map((s) => trs(s.x, s.y - 0.5, s.z, d.rand() * 6, 1.4 + d.rand() * 1.8)), 1)
    d.prop('bk:sand_rocks_small_01', d.spots(50, 3, 24, { clear: 3, test: (x, z, y) => y < 10 && flat(0.3)(x, z, y) }).map((s) => trs(s.x, s.y - 0.1, s.z, d.rand() * 6, 0.8 + d.rand() * 0.8)))
    d.prop('boulder_01', d.spots(24, 8, 60, { clear: 9, test: flat(0.3) }).map((s) => trs(s.x, s.y - 0.8, s.z, d.rand() * 6, 2 + d.rand() * 2)), 1.6)
    // the knoll: rock and pines on its top
    forest(k, 'pine', Array.from({ length: 26 }, () => {
      const a = d.rand() * 6.28, r = d.rand() * 40, x = KNOLL.x + Math.cos(a) * r, z = KNOLL.z + Math.sin(a) * r
      return new THREE.Vector3(x, w.terrainAt(x, z), z)
    }).filter((v) => d.roadGap(v.x, v.z) > 10), { scale: [0.9, 1.3] })
    pylons(k)

    // ── the flood channel's sluice gate: shut on lap 1
    const gate = sluice(k, channel)

    // ── lap changes
    const lake = k.water
    const mist = drift(k, 120, 0xeef4f6, 3, 1.4)
    mist.visible = false
    const wet = [
      ...[0.25, 0.5, 0.75].map((u) => { const p = channel.samples[Math.floor(channel.count * u)]!; return { x: p.x, z: p.z, r: 26, surface: 'mud' as const, on: false } }),
      ...[0.1, 0.4].map((u) => { const i = Math.floor(c.count * (0.775 + u * 0.05)), p = c.samples[i]!; return { x: p.x, z: p.z, r: 20, surface: 'mud' as const, on: false } }),
    ]
    w.patches.push(...wet)
    let open = 0
    k.onFrame((f) => {
      const target = f.lap >= 2 ? (f.totalLaps > 2 && f.lap >= f.totalLaps ? 1 : 0.6) : 0
      open += (target - open) * Math.min(1, f.dt * 0.4)
      damFrame(f.time, open)
      // the river rises
      if (lake) lake.mesh.position.y = SEA + open * 1.1
      gate(open > 0.15, f.dt)
      channel.join!.odds = open > 0.15 ? 0.65 : 0
      for (let q = 0; q < wet.length; q++) wet[q]!.on = q < 3 ? open > 0.15 : open > 0.8
      road.wet.value = 0.1 + open * 0.55
      const cam = f.camera.position
      mist.visible = open > 0.7 && cam.z > 100 && cam.z < 420
    })
  },
}

let damFrame: (t: number, open: number) => void = () => undefined

/** The dam: a curved arch wall with its crest road, spillway gates and power lines. */
function buildDam(k: BuildKit): void {
  const { circuit: c, world: w, root, d } = k
  // the reservoir behind it
  const lake = buildWater(w, root, LAKE, { deep: 0x163640, shallow: 0x3a6a70, foam: 0xe8f0ee, waves: 0.4 })
  lake.mesh.geometry.dispose()
  lake.mesh.geometry = new THREE.PlaneGeometry(1800, 1600)
  lake.mesh.position.set(0, LAKE, -40 - 800)
  // the downstream face: from under the crest down to the gorge floor, bowed like the crest
  const faceAt = (x: number, u: number, out: THREE.Vector3): THREE.Vector3 => {
    const z0 = crestZ(x) + 7
    const g = Math.min(profile(x, z0), profile(x, z0 + 40)) - 5
    const drop = CREST - 1.2 - g
    return out.set(x, CREST - 1.2 - u * Math.max(0, drop), z0 + Math.pow(u, 1.35) * Math.max(0, drop) * 0.72)
  }
  const ribbon = (x0: number, x1: number, cols: number, rows: number, lift: number, fn: typeof faceAt): THREE.BufferGeometry => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], v = new THREE.Vector3()
    for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
      const x = x0 + ((x1 - x0) * i) / cols
      fn(x, j / rows, v)
      pos.push(v.x, v.y + lift * 0.4, v.z + lift)
      uv.push(i / cols, j / rows)
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b2 = a + rows + 1
      idx.push(a, a + 1, b2, a + 1, b2 + 1, b2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }
  const wall = new Mesher()
  wall.add(ribbon(-182, 182, 91, 26, 0, faceAt), new THREE.Matrix4(), 0x9c988e)
  // the body behind the crest road, down into the lake
  for (let x = -182; x < 182; x += 8) {
    const zc = crestZ(x + 4), g = Math.min(profile(x + 4, zc), profile(x + 4, zc - 20)) - 4
    if (g > CREST - 3) continue
    wall.box(8.4, CREST - 1.2 - g, 14, x + 4, (CREST - 1.2 + g) / 2, zc, 0x948f86, -Math.atan(-60 * (x + 4) / (182 * 182)))
  }
  for (let x = -176; x <= 176; x += 16) wall.add(ribbon(x - 0.25, x + 0.25, 1, 26, 0.12, faceAt), new THREE.Matrix4(), 0x6e6a62)
  place(k, wall, surface('concrete'))

  // the crest: parapets, lamps, hard walls each side
  const crest = new Mesher(), lampHeads: THREE.Matrix4[] = []
  for (let i = 0; i < c.count; i += 3) {
    const p = c.samples[i]!
    if (!c.raised[i] || p.y < CREST - 0.5 || Math.abs(p.x) > 186 || p.z > 20) continue
    const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
    const yaw = Math.atan2(-t.x, -t.z)
    crest.box(c.widths[i]! + 5, 3, 6.4, p.x, p.y - 1.6, p.z, 0xc0bcb4, yaw)
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * (half + 1.6), z = p.z + r.z * s * (half + 1.6)
      crest.box(0.7, 1.3, 6.4, x, p.y + 0.5, z, 0xd4d0c8, yaw)
      if (i % 24 === 0) {
        crest.post(0.12, 0.1, 7, x, p.y + 1, z, 0x3a3e44, 6)
        lampHeads.push(trs(x - r.x * s * 1.2, p.y + 8, z - r.z * s * 1.2, yaw, new THREE.Vector3(1.4, 0.2, 0.5)))
      }
      w.addBox(x + r.x * s * 0.2, z + r.z * s * 0.2, 0.6, 3.4, yaw)
    }
  }
  place(k, crest, surface('concrete'))
  d.instanced(new THREE.BoxGeometry(1, 1, 1), glow(2.4, 2.3, 2), lampHeads, false)

  // the spillway gates in the middle, on the lake side of the crest
  const gates = new Mesher()
  for (let q = -2; q <= 3; q++) gates.box(3, 16, 10, q * 13 - 6.5, CREST - 9, crestZ(q * 13) - 16, 0xb8b4ac)
  for (let q = -2; q <= 2; q++) gates.add(new THREE.CylinderGeometry(5, 5, 10, 16, 1, false, 0, Math.PI / 2), trs(q * 13, CREST - 7, crestZ(q * 13) - 16, 0, 1, 0, Math.PI / 2), 0x3a5a6a)
  // the gate house over them
  gates.box(84, 7, 9, 0, CREST + 9, crestZ(0) - 16, 0xc8c2b6).box(86, 0.8, 11, 0, CREST + 12.9, crestZ(0) - 16, 0x5a5e64)
  for (const x of [-38, 38]) gates.box(4, 12, 9, x, CREST + 3, crestZ(x) - 16, 0xb0aaa0)
  place(k, gates, surface('concrete'))

  // falling water and spray, shown when the gates open
  const fallTex = canvasTexture(128, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H)
    for (let q = 0; q < 700; q++) {
      g.fillStyle = `rgba(235,245,248,${0.18 + Math.random() * 0.55})`
      g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 40 + Math.random() * 160)
    }
  })
  fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping
  fallTex.repeat.set(3, 2)
  const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide, color: 0xdfeef2 })
  const sheet = new THREE.Mesh(ribbon(-32, 32, 16, 30, 0.5, faceAt), fallMat)
  root.add(sheet)
  const sprayTex = softDot()
  const sprays = Array.from({ length: 30 }, (_, q) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprayTex, color: 0xf0f6f8, transparent: true, opacity: 0, depthWrite: false }))
    s.position.set(-36 + (q % 15) * 5, 6 + Math.random() * 8, 70 + Math.floor(q / 15) * 12)
    s.scale.setScalar(18 + Math.random() * 14)
    root.add(s)
    return s
  })
  damFrame = (t, open) => {
    fallMat.opacity = Math.min(0.9, open * 1.4)
    fallTex.offset.y = -(t * 1.6) % 1
    for (const s of sprays) s.material.opacity = open * 0.4
  }

  // a work barge on the lake and a boom of floats
  d.prop('dutch_ship_medium', [trs(-80, LAKE - 0.6, -190, 0.6, 1.1)], 0, undefined, 0)
  d.prop('ocean_buoy', Array.from({ length: 14 }, (_, q) => trs(-105 + q * 15, LAKE, -70, 0, 1.2)))
}

/** The valley town: brick fronts on both streets, lamps, the river bridge. */
function buildTown(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const kinds = [{ name: 'bk:apartment_a', w: 12, d: 9 }, { name: 'bk:apartment_b', w: 9, d: 9 }, { name: 'bk:factory_a', w: 15, d: 9 }] as const
  const fronts: { x: number; z: number; r: number }[] = []
  const fm = new Map<string, THREE.Matrix4[]>()
  const inTown = (i: number) => c.samples[i]!.z > 840
  for (let i = 0; i < c.count; i += 5) {
    if (!inTown(i) || c.raised[i]) continue
    for (const side of [-1, 1]) {
      const kd = kinds[Math.floor(d.rand() * kinds.length)]!, s = 1.2 + d.rand() * 0.25
      const p = c.samples[i]!, r = c.rights[i]!
      const off = side * (c.widths[i]! / 2 + 9 + kd.d * s / 2)
      const x = p.x + r.x * off, z = p.z + r.z * off, rad = Math.hypot(kd.w, kd.d) * s / 2
      if (Math.abs(x - xr(z)) < 34 || d.roadGap(x, z) < rad + 4 || fronts.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + rad + 1.5)) continue
      fronts.push({ x, z, r: rad })
      const yaw = Math.atan2(-side * r.x, -side * r.z)
      const list = fm.get(kd.name) ?? []
      list.push(trs(x, w.terrainAt(x, z) + 2.4, z, yaw, s))
      fm.set(kd.name, list)
      w.addBox(x, z, kd.w * s / 2, kd.d * s / 2, yaw)
    }
  }
  for (const [name, mats] of fm) d.prop(name as 'bk:apartment_a', mats, 0, undefined, 700)
  // street lamps along the town roads
  const lamps: THREE.Matrix4[] = []
  for (let i = 0; i < c.count; i += 14) {
    if (!inTown(i)) continue
    const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * (c.widths[i]! / 2 + 2.2), z = p.z + r.z * s * (c.widths[i]! / 2 + 2.2)
      lamps.push(trs(x, c.raised[i] ? p.y : w.terrainAt(x, z), z, Math.atan2(-t.x, -t.z) + (s > 0 ? Math.PI / 2 : -Math.PI / 2), 1))
      w.addPost(x, z, 0.3)
    }
  }
  d.prop('bk:street_lamp_01', lamps, 0, undefined, 400)
  // the river bridge: a steel arch over the roadway
  const arch = new Mesher()
  // follows the road over the river, standing just outside its edges, with solid feet
  const i0 = c.track(-40, 960, 0, c.count), i1 = c.track(10, 981, 0, c.count)
  const lo = Math.min(i0, i1), hi = Math.max(i0, i1)
  for (const s of [-1, 1]) {
    let prev: THREE.Vector3 | null = null
    for (let q = 0; q <= 16; q++) {
      const u = q / 16, i = Math.round(lo + (hi - lo) * u), sp = c.samples[i]!, r = c.rights[i]!
      const off = s * (c.widths[i]! / 2 + 1.6)
      const p = new THREE.Vector3(sp.x + r.x * off, sp.y + Math.sin(u * Math.PI) * 15 + 0.5, sp.z + r.z * off)
      if (prev) arch.bar(prev, p, 0.45, 0x2f6f8a, 6)
      if (q > 0 && q < 16 && q % 2 === 0) arch.bar(p, new THREE.Vector3(p.x, sp.y + 0.6, p.z), 0.08, 0x2f6f8a, 4)
      if (q === 0 || q === 16) w.addPost(p.x, p.z, 0.6)
      prev = p
    }
  }
  place(k, arch, surface('metal', { rough: 0.4 }))
  // boats moored by the town quay
  d.prop('bk:dutch_ship_large_01', [trs(-6, SEA - 0.3, 900, 0.2, 0.5)], 0, undefined, 0)
}

/** The power house the road runs through: a long hall with the turbines either side. */
function buildPowerHouse(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const hall = new Mesher(), lit = new Mesher()
  let i0 = -1, i1 = -1
  for (let i = 0; i < c.count; i++) {
    const p = c.samples[i]!
    if (p.z > 486 && p.z < 572 && p.x < 0) { if (i0 < 0) i0 = i; i1 = i }
  }
  if (i0 < 0) return
  const turbines: THREE.Matrix4[] = []
  for (let i = i0; i <= i1; i += 3) {
    const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, yaw = Math.atan2(-t.x, -t.z), half = c.widths[i]! / 2
    const g = p.y
    for (const s of [-1, 1]) {
      // outer wall, with tall windows every few metres
      const ox = p.x + r.x * s * (half + 13), oz = p.z + r.z * s * (half + 13)
      hall.box(1.2, 16, 6.2, ox, g + 8, oz, (i - i0) % 12 < 3 ? 0x8e8a82 : 0xb4ab9a, yaw)
      if ((i - i0) % 12 >= 3) lit.box(0.3, 9, 4, ox - r.x * s * 0.7, g + 8.5, oz - r.z * s * 0.7, 0xffffff, yaw)
      w.addBox(ox, oz, 0.8, 3.4, yaw)
      if ((i - i0) % 15 === 6) turbines.push(trs(p.x + r.x * s * (half + 6.5), g, p.z + r.z * s * (half + 6.5), yaw, 1))
    }
    // the roof and its crane rail
    hall.box(c.widths[i]! + 28, 1.4, 6.2, p.x, g + 16.6, p.z, 0x6a6e74, yaw)
    if ((i - i0) % 9 === 0) for (const s of [-1, 1]) lit.box(2.6, 0.25, 1.2, p.x + r.x * s * 6, g + 15.5, p.z + r.z * s * 6, 0xffffff, yaw)
  }
  place(k, hall, surface('concrete'))
  const litMesh = new THREE.Mesh(lit.build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.7), toneMapped: false }))
  k.root.add(litMesh)
  // the generators: drums with a red housing and a walkway rail
  const gen = new Mesher()
  gen.add(new THREE.CylinderGeometry(4, 4.4, 3.2, 28), trs(0, 1.6, 0), 0x8a3a2a)
  gen.add(new THREE.CylinderGeometry(3, 3, 1.4, 24), trs(0, 3.9, 0), 0x6e7378)
  gen.add(new THREE.TorusGeometry(4.6, 0.08, 6, 32), trs(0, 3.3, 0, 0, 1, Math.PI / 2), 0xd8c040)
  gen.add(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 16), trs(0, 5.6, 0), 0x3a4048)
  d.instanced(gen.build(), surface('metal', { rough: 0.45 }), turbines)
  for (const m of turbines) w.addPost(m.elements[12]!, m.elements[14]!, 4.4)
  // penstocks: three great pipes coming down the bank from the dam
  const pipes = new Mesher()
  for (let q = 0; q < 3; q++) {
    const pts = [new THREE.Vector3(-156 + q * 7, 22, 236), new THREE.Vector3(-130 + q * 7, 14, 330), new THREE.Vector3(-104 + q * 6, 8, 470)]
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!, b = pts[s + 1]!
      for (let u = 0; u < 1; u += 0.1) {
        const p = a.clone().lerp(b, u), p2 = a.clone().lerp(b, u + 0.1)
        p.y = Math.max(p.y, w.terrainAt(p.x, p.z) + 2.2)
        p2.y = Math.max(p2.y, w.terrainAt(p2.x, p2.z) + 2.2)
        pipes.bar(p, p2, 1.5, 0x3e5a48, 14)
        pipes.box(4, Math.max(0.5, p.y - w.terrainAt(p.x, p.z)), 1.2, p.x, (p.y + w.terrainAt(p.x, p.z)) / 2 - 0.5, p.z, 0x9a968c)
      }
    }
  }
  place(k, pipes, surface('metal', { rough: 0.55 }))
}

/** The bridge over the side canyon, with its middle span fallen into the water. */
function buildBrokenBridge(k: BuildKit): void {
  const { circuit: c, root } = k
  const m = new Mesher()
  let lip = -1, land = -1
  for (let i = 1; i < c.count; i++) {
    const p = c.samples[i]!
    if (Math.abs(p.z - SIDE.z) > 60 || p.x > 0) continue
    if (c.gap[i] && !c.gap[i - 1]) lip = i - 1
    if (!c.gap[i] && c.gap[i - 1]) land = i
  }
  if (lip < 0 || land < 0) return
  for (const [i, dir] of [[lip, 1], [land, -1]] as const) {
    const p = c.samples[i]!, t = c.tangents[i]!, r = c.rights[i]!, yaw = Math.atan2(-t.x, -t.z)
    // jagged broken ends of the deck, and bent rebar
    for (let q = -4; q <= 4; q++) {
      const len = 1 + Math.abs(Math.sin(q * 3.7)) * 2.4
      m.box(2, 1.6, len, p.x + r.x * q * 2 + t.x * dir * len / 2, p.y - 1.1, p.z + r.z * q * 2 + t.z * dir * len / 2, 0xa8a49a, yaw)
      const a = new THREE.Vector3(p.x + r.x * q * 2, p.y - 0.6, p.z + r.z * q * 2)
      m.bar(a, a.clone().addScaledVector(t, dir * (2 + (q & 1) * 1.5)).add(new THREE.Vector3(0, -1.2 - (q & 1), 0)), 0.05, 0x5a3a2a, 4)
    }
  }
  // the fallen span, tipped into the water
  const a = c.samples[lip]!, b = c.samples[land]!, mid = a.clone().lerp(b, 0.5)
  const t = c.tangents[lip]!
  m.add(new THREE.BoxGeometry(18, 1.6, 26), trs(mid.x, SEA + 1.5, mid.z, Math.atan2(-t.x, -t.z), 1, 0.25, 0.12), 0xa09c92)
  place(k, m, surface('concrete'))
  // warning boards: stripes and a boost arrow, before the lip
  const sign = canvasTexture(512, 128, (g, W, H) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, W, H)
    for (let x = -H; x < W; x += 48) { g.fillStyle = '#f2b21c'; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H * 0.4, H * 0.6); g.lineTo(x + H * 0.4, H * 0.6); g.fill() }
    g.fillStyle = '#ffffff'; g.font = 'italic 800 54px sans-serif'; g.textAlign = 'center'; g.fillText('BOOST TO CLEAR', W / 2, 58)
  })
  const i = Math.max(0, lip - 40), p = c.samples[i]!, tt = c.tangents[i]!, r = c.rights[i]!
  const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, side: THREE.DoubleSide }))
  board.position.set(p.x, p.y + 9, p.z)
  board.rotation.y = Math.atan2(tt.x, tt.z) + Math.PI
  root.add(board)
  const posts = new Mesher()
  for (const s of [-1, 1]) posts.post(0.18, 0.18, 9.5, p.x + r.x * s * (c.widths[i]! / 2 + 1), p.y, p.z + r.z * s * (c.widths[i]! / 2 + 1), 0x2a2e34, 8)
  posts.box(c.widths[i]! + 3, 0.4, 0.4, p.x, p.y + 10.8, p.z, 0x2a2e34, Math.atan2(-tt.x, -tt.z))
  place(k, posts, surface('metal'))
  k.world.addPost(p.x + r.x * (c.widths[i]! / 2 + 1), p.z + r.z * (c.widths[i]! / 2 + 1), 0.3)
  k.world.addPost(p.x - r.x * (c.widths[i]! / 2 + 1), p.z - r.z * (c.widths[i]! / 2 + 1), 0.3)
}

/** The old service bridge: a steel trestle on tall legs, no rails. */
function buildServiceBridge(k: BuildKit, b: import('../Circuit').Circuit): void {
  const { world: w } = k
  const m = new Mesher()
  for (let i = 0; i < b.count; i += 4) {
    if (!b.raised[i]) continue
    const p = b.samples[i]!, r = b.rights[i]!, t = b.tangents[i]!, half = b.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    // the deck girders and a lattice under each edge
    for (const s of [-1, 1]) {
      const e = new THREE.Vector3(p.x + r.x * s * (half - 0.3), p.y - 1.4, p.z + r.z * s * (half - 0.3))
      m.bar(e, e.clone().addScaledVector(t, 8), 0.22, 0x8a3a2a, 4)
      if (i % 8 === 0) m.bar(e, new THREE.Vector3(e.x + t.x * 4, e.y - 3.2, e.z + t.z * 4), 0.12, 0x8a3a2a, 4)
    }
    // tall trestle legs down to the ground every 24 m
    if (i % 12 === 0) {
      const g = w.terrainAt(p.x, p.z)
      if (p.y - g > 4) {
        for (const s of [-1, 1]) {
          const top = new THREE.Vector3(p.x + r.x * s * (half - 1), p.y - 1.6, p.z + r.z * s * (half - 1))
          const foot = new THREE.Vector3(p.x + r.x * s * (half + 4), g, p.z + r.z * s * (half + 4))
          m.bar(top, foot, 0.35, 0x6e3020, 6)
        }
        for (let h = 8; h < p.y - g - 2; h += 10) m.box(b.widths[i]! + 6 * (h / (p.y - g)), 0.3, 0.3, p.x, p.y - 1.6 - h, p.z, 0x6e3020, yaw)
      }
    }
  }
  place(k, m, surface('paint', { rough: 0.6 }))
}

/** Pylons marching up the gorge, wires slung between them. */
function pylons(k: BuildKit): void {
  const { world: w, d } = k
  const m = new Mesher(), wires = new Mesher()
  const spots: THREE.Vector3[] = []
  for (let z = 120; z < 900; z += 130) {
    const x = xr(z) + 300 + Math.sin(z * 0.01) * 30
    if (d.roadGap(x, z) < 16) continue
    spots.push(new THREE.Vector3(x, w.terrainAt(x, z), z))
  }
  for (const s of spots) {
    for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) m.bar(new THREE.Vector3(s.x + a! * 1.6, s.y, s.z + b! * 1.6), new THREE.Vector3(s.x + a! * 0.3, s.y + 36, s.z + b! * 0.3), 0.18, 0x6a6e74, 4)
    for (let h = 6; h < 36; h += 6) m.box(5 - h * 0.1, 0.25, 5 - h * 0.1, s.x, s.y + h, s.z, 0x6a6e74)
    m.box(18, 0.5, 1, s.x, s.y + 36, s.z, 0x6a6e74)
    w.addPost(s.x, s.z, 4)
  }
  for (let q = 0; q < spots.length - 1; q++) for (const e of [-8, 0, 8]) {
    const a = spots[q]!, b = spots[q + 1]!
    let prev = new THREE.Vector3(a.x + e, a.y + 35.5, a.z)
    for (let u = 0.1; u <= 1.001; u += 0.1) {
      const p = new THREE.Vector3(THREE.MathUtils.lerp(a.x, b.x, u) + e, THREE.MathUtils.lerp(a.y, b.y, u) + 35.5 - Math.sin(u * Math.PI) * 6, THREE.MathUtils.lerp(a.z, b.z, u))
      wires.bar(prev, p, 0.05, 0x22262a, 3)
      prev = p
    }
  }
  place(k, m, surface('metal'), false)
  place(k, wires, surface('metal'), false)
}

/** The sluice gate across the flood channel: down on lap 1, up once the gates open. */
function sluice(k: BuildKit, ch: import('../Circuit').Circuit): (open: boolean, dt: number) => void {
  const i = 22, p = ch.samples[i]!, t = ch.tangents[i]!, r = ch.rights[i]!, yaw = Math.atan2(-t.x, -t.z), half = ch.widths[i]! / 2 + 2
  const frame = new Mesher()
  for (const s of [-1, 1]) frame.box(1.6, 14, 1.6, p.x + r.x * s * (half + 0.8), p.y + 7, p.z + r.z * s * (half + 0.8), 0x5a6068, yaw)
  frame.box(half * 2 + 3.2, 1.6, 2, p.x, p.y + 14, p.z, 0x5a6068, yaw)
  place(k, frame, surface('metal'))
  const sign = canvasTexture(256, 64, (g, W, H) => {
    for (let x = 0; x < W; x += 32) { g.fillStyle = (x / 32) % 2 ? '#121418' : '#e8c020'; g.fillRect(x, 0, 32, H) }
  })
  const plate = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 5, 0.6), [surface('metal', { rough: 0.5 }), surface('metal', { rough: 0.5 }), surface('metal'), surface('metal'), new THREE.MeshStandardMaterial({ map: sign }), new THREE.MeshStandardMaterial({ map: sign })])
  plate.position.set(p.x, p.y + 2.5, p.z)
  plate.rotation.y = yaw
  k.root.add(plate)
  k.world.addPost(p.x + r.x * (half + 0.8), p.z + r.z * (half + 0.8), 1)
  k.world.addPost(p.x - r.x * (half + 0.8), p.z - r.z * (half + 0.8), 1)
  const solid: Solid = { x: p.x, z: p.z, r: Math.hypot(half, 0.6), hx: half, hz: 0.6, cos: Math.cos(yaw), sin: Math.sin(yaw), top: 1e6 }
  k.world.movers.push(solid)
  let lift = 0
  return (open, dt) => {
    lift += ((open ? 1 : 0) - lift) * Math.min(1, dt * 0.8)
    plate.position.y = p.y + 2.5 + lift * 10
    solid.top = lift > 0.5 ? -1e6 : 1e6
  }
}
