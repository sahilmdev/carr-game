import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, trs } from '../../game/biomes/kit'
import { atmos } from '../art/atmos'
import { Mesher, pagodaShape, place, surface, toriiShape } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import type { Solid } from '../World'
import { arrows, crates, drift, gantry, glow, mist, stands } from './parts'

/*
 * Blossom Pass, as a pilgrimage up the mountain at sunset. Leave the lakeside
 * village, climb through a long corridor of red gates, drift up the hairpins
 * through the cherry trees to the temple on the summit and round its pagoda,
 * left or right. On the way down, drift the stack of six hairpins, or the ridge
 * road and its jump over the ravine (only a boost clears it). Then across the
 * gorge on the red arched bridge beside the falls, and down to the lake.
 *
 * Lap 2: the wind picks up, the petals blow thick and the lanterns are lit.
 * Last lap: dusk; mist rolls up out of the valley.
 */

const SEA = 0
const PEAK = { x: 140, z: -480, h: 85, s: 90000 }
const LAKE = { x: -50, z: 300 }
const GORGE_X = 430
const PAGODA = { x: 160, z: -620 }
const RAVINE = { x: 398, z: -360 }

function profile(x: number, z: number): number {
  let h = 12 + PEAK.h * Math.exp(-((x - PEAK.x) ** 2 + (z - PEAK.z) ** 2) / PEAK.s)
  const l = Math.hypot(x - LAKE.x, z - LAKE.z)
  if (l < 240) h = THREE.MathUtils.lerp(-8, h, smooth(140, 235, l))
  const g = Math.abs(x - GORGE_X)
  // the gorge runs from the falls (z -262) down to the lake
  if (g < 70 && z < 100 && z > -300) h = THREE.MathUtils.lerp(-24, h, Math.min(1, smooth(16, 66, g) + smooth(40, 100, z) + smooth(-250, -290, z)))
  // the ravine the ridge road jumps: a cleft across the slope
  const rx = Math.abs(z - RAVINE.z), ry = Math.abs(x - RAVINE.x)
  if (rx < 56 && ry < 74) h = THREE.MathUtils.lerp(h - 42, h, Math.max(smooth(34, 54, rx), smooth(46, 72, ry)))
  return h
}

const POINTS: TrackPoint[] = [
  // 0: the lakeside village, heading west along the shore
  [158, 6, 172],
  [40, 6, 132, { pad: 0 }],
  [-106, 7.6, 106, { items: true }],
  // 3: the corridor of gates, climbing
  [-224, 12.6, 40],
  [-264, 20.8, -79],
  [-238, 30.6, -198],
  [-158, 40.4, -284],
  // 7: the climb through the cherry trees, sweeping up to the summit
  [-92, 52, -364, { items: true }],
  [-40, 72, -476, { bank: 4, w: 19 }],
  [40, 86.4, -568], // 9: the courtyard's north path leaves here
  // 10: the temple courtyard, south of the pagoda
  [132, 91.3, -581, { items: true }],
  [211, 92.9, -541], // 11: the north path rejoins
  [264, 89.6, -475], // 12: the ridge road leaves here
  // 13: the hairpin stack: six hairpins stacked down the mountain, a drift
  // in each, linked into one chain if you get them right
  [306, 86, -452, { w: 19 }],
  [286, 83.5, -428],
  [250, 81, -428],
  [230, 78.5, -408, { w: 19 }],
  [250, 76, -388, { items: true }],
  [286, 73.5, -388],
  [308, 71, -368, { w: 19 }],
  [286, 68.5, -348],
  [250, 66, -348],
  [230, 63.5, -328, { w: 19 }],
  [250, 61, -308],
  [286, 58.5, -308],
  [308, 56, -288, { w: 19 }],
  [286, 53.5, -268],
  [250, 51, -268],
  [230, 48.5, -248, { w: 19 }],
  [250, 46, -228],
  [310, 44, -200, { pad: 0 }],
  [356, 42.1, -158, { pad: 0 }], // 31: the ridge road rejoins
  // 22: the red bridge over the gorge, and down to the lake
  [436, 37.2, -119, { raised: true, rail: 'LR' }],
  [502, 33.9, -79],
  [528, 25.7, 26],
  [475, 17.5, 132],
  [370, 9.3, 198, { items: true }],
  [264, 6, 198],
]

export const blossom: TrackDef = {
  id: 'blossom',
  // the drift mountain: drifts linked hairpin to hairpin build a bigger and bigger boost
  driftChain: 0.4,
  name: 'Blossom Pass',
  ambience: 'snow',
  width: 17,
  bank: 2.2,
  shoulder: 40,
  accent: 0xff6fa8,
  far: 0x6a6a48,
  farY: -30,
  sea: SEA,
  water: { deep: 0x1a3a4a, shallow: 0x5a8a8a, foam: 0xf4e8ec, waves: 0.4 },
  rails: 'wood',
  road: { lines: 'circuit', kerbColors: [0xb8261c, 0xe8e2d8], grime: 0x6a5a50, tone: 0xffffff, lift: 0.26 },
  terrain: { layers: ['grass', 'forest_floor', 'rock_pitted_mossy', 'aerial_sand'], tile: [24, 10, 18, 26], tints: [0xa4d070, 0xe4c0c0, 0xcac0c0, 0xe0c8b8] },
  look: {
    tod: 'sunset', fog: [0.92, 0.6, 0.54], fogDensity: 0.0008, fogBase: 30, fogFall: 0.009, sunGlow: 1,
    exposure: 1.22, sun: 1.3, hemi: 1.3, bloom: 0.3, shafts: 0.7, grade: [1.1, 1.08, 0.008, 0, 0.012, 1.04, 0.98, 0.96, 0.34],
  },
  points: POINTS,
  branches: [
    {
      // round the north side of the pagoda: the same length, a boost strip instead of items
      name: 'North court', from: 9, to: 11, odds: 0.5,
      points: [
        [90, 89, -622, { pad: 0 }],
        [160, 92, -664],
        [232, 93, -606],
      ],
    },
    {
      // the ridge road: shorter and steeper, with a jump over the ravine
      name: 'Ridge jump', from: 12, to: 31, odds: 0.35,
      points: [
        [330, 89, -500],
        [392, 87, -518, { bank: 3 }],
        [397, 84, -460],
        [396, 80, -405, { raised: true, pad: 0 }],
        [396, 82, -376, { raised: true, gap: true }],
        [398, 79, -348, { raised: true, gap: true }],
        [400, 76.5, -321, { raised: true, w: 20 }],
        [400, 69, -268, { raised: true, w: 20 }],
        [390, 55, -230],
      ],
    },
    {
      // the drift gate: link five drifts down the hairpins and the gate at
      // the fifth swings open on a cut straight past the last of them
      name: 'Drift gate', from: 25, to: 30, odds: 0,
      points: [
        [330, 53, -266, { w: 15 }],
        [337, 49, -232, { w: 15, pad: 0 }],
        [327, 45.5, -211, { w: 15 }],
      ],
    },
  ],
  ground(x, z) {
    const g = profile(x, z)
    return g + fbm2(x * 0.01, z * 0.01) * 18 * smooth(10, 30, g)
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.6, 1.05, slope)
    const petals = smooth(0.48, 0.62, fbm2(x * 0.02 + 9, z * 0.02))
    const shore = 1 - smooth(SEA + 1, SEA + 4, h)
    mix[0] = (1 - rock) * (1 - petals * 0.6) * (1 - shore)
    mix[1] = (1 - rock) * petals
    mix[2] = rock
    mix[3] = Math.max(shore, smooth(8, 3, roadDist) * 0.7)
    tint.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.8, 0.86), petals * 0.5)
  },
  surfaceAt: () => 'grass',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Blossom Pass', '#ff6fa8')
    stands(k, 8, 44, -1, [0xc8506a, 0xe8e2d8, 0x9a2a30, 0xd8a8b4, 0x2e2a34], 0xc23a5a, 'Blossom Pass Hill Climb')
    arrows(k, 0xffb0c8)
    mountainRing(root, 170, -250, { inner: 1300, outer: 3200, height: 760, base: -40, rock: 0x6a5a6a, snow: 0xe8dade, snowLine: 0.6, seed: 6 })

    const pinks = [0xffffff, 0xfff0f4, 0xffe0ea, 0xffd0e0]
    const land = (_x: number, _z: number, y: number) => y > SEA + 2
    forest(k, 'cherry', d.spots(240, 6, 26, { clear: 6, test: land }), { scale: [0.9, 1.35], tints: pinks })
    forest(k, 'cherry', d.spots(300, 24, 240, { clear: 12, test: land }), { scale: [1, 1.6], solid: 0, tints: pinks })
    forest(k, 'pine', d.spots(120, 60, 340, { clear: 30, test: land }), { scale: [0.8, 1.2], solid: 0, tints: [0xc8d0c0, 0xb8c4b0] })
    grass(k, { density: 4, reach: 26, height: [0.4, 0.85], colors: [0x90b458, 0xa0bc64, 0x84a850, 0xb4c470], test: land })
    const flat = (x: number, z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, z) - w.terrainAt(x - e, z), gz = w.terrainAt(x, z + e) - w.terrainAt(x, z - e)
      return Math.hypot(gx, gz) / (2 * e) < 0.35 && y > SEA + 2
    }
    d.prop('rock_09', d.spots(34, 6, 30, { clear: 6, test: flat }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 2 + d.rand() * 2)), 0.9)
    d.prop('bk:celandine_01', d.spots(240, 1.2, 16, { clear: 1, test: land }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2 + d.rand() * 1.5)))
    d.prop('shrub_04', d.spots(50, 2, 24, { clear: 1.5, test: land }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4 + d.rand())))
    crates(d, d.spots(8, 2, 7, { from: 0.0, to: 0.1, clear: 1.5 }), 0xc89a7a)

    gates(k)
    const flame = lanterns(k)
    temple(k)
    village(k)
    redBridge(k)
    const fall = waterfall(k)
    ravineSign(k, c.branches[1]!)
    driftGate(k, c.branches[2]!)

    mist(k, d.spots(26, 60, 300, { clear: 40 }).map((s) => s.setY(s.y + 8)), [90, 170], 0xffd8c8, 0.16)
    const petals = drift(k, 520, 0xffc4d8, 0.42, 2.2)
    const pm = petals.material as THREE.PointsMaterial
    const base = blossom.look.fogDensity
    k.onFrame((f) => {
      const up = (f.lap - 1) / Math.max(1, f.totalLaps - 1)
      pm.size = 0.42 + up * 0.4
      const lit = f.lap >= 2 ? 2.2 + up * 2.2 : 0.6
      flame.color.setRGB(1.6 * lit * 0.6, 0.86 * lit * 0.6, 0.32 * lit * 0.6)
      w.wind.x = f.lap >= 2 ? Math.sin(f.time * 0.3) * (1.5 + up * 2) : 0
      // the last lap: mist climbs out of the valley
      const fog = base * (1 + (f.totalLaps > 1 && f.lap >= f.totalLaps ? 1.6 : 0))
      atmos.params.x += (fog - atmos.params.x) * Math.min(1, f.dt * 0.3)
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      if (sceneFog) sceneFog.density = atmos.params.x
      fall.map!.offset.y = (f.time * 0.8) % 1
    })
  },
}

/** A corridor of red gates up the first climb, then single gates along the road. */
function gates(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const from = c.track(-224, 40, 0, c.count), to = c.track(-158, -284, 0, c.count)
  const mats: THREE.Matrix4[] = []
  for (let i = 12; i < c.count - 12; i++) {
    const corridor = i >= from && i <= to
    if (corridor ? i % 4 : i % 46) continue
    if (!corridor && Math.abs(c.bends[i]!) > 0.006) continue
    if (c.raised[i] || c.gap[i]) continue
    const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
    const yaw = Math.atan2(-t.x, -t.z), half = c.widths[i]! / 2 + 1.7
    mats.push(trs(p.x, p.y - 0.1, p.z, yaw))
    for (const s of [-1, 1]) w.addPost(p.x + r.x * s * half, p.z + r.z * s * half, 0.8)
  }
  d.instanced(toriiShape(c.widths[0]! + 3.4, 12.5).build(), surface('paint', { rough: 0.5 }), mats)
}

/** Stone lanterns along the road; their flames are lit from lap 2. */
function lanterns(k: BuildKit): THREE.MeshBasicMaterial {
  const { circuit: c, world: w, d } = k
  const lantern = new Mesher(), cap = 0x7c7972, S = 0x8e8a82
  lantern.post(0.5, 0.42, 0.3, 0, 0, 0, cap, 8)
  lantern.post(0.18, 0.15, 1.3, 0, 0.3, 0, S, 8)
  lantern.post(0.6, 0.55, 0.16, 0, 1.6, 0, cap, 6)
  lantern.add(new THREE.ConeGeometry(0.8, 0.42, 6), trs(0, 2.5, 0), cap)
  lantern.add(new THREE.SphereGeometry(0.16, 8, 6), trs(0, 2.82, 0), S)
  const lamps: THREE.Matrix4[] = [], lights: THREE.Matrix4[] = []
  for (const p of c.all) for (let i = 10; i < p.count; i += 22) {
    if (Math.abs(p.bends[i]!) > 0.005 || p.raised[i]) continue
    const s = p.samples[i]!, r = p.rights[i]!, side = (i / 22) % 2 < 1 ? 1 : -1
    const off = side * (p.widths[i]! / 2 + 3.4), x = s.x + r.x * off, z = s.z + r.z * off
    if (d.roadGap(x, z) < 2 || w.blocked(x, z, 1)) continue
    const y = w.terrainAt(x, z)
    if (y < SEA + 1) continue
    lamps.push(trs(x, y, z, d.rand() * 6, 1.25))
    lights.push(trs(x, y + 2.1, z, 0, new THREE.Vector3(0.5, 0.5, 0.5)))
    w.addPost(x, z, 0.55)
  }
  d.instanced(lantern.build(), surface('stone'), lamps)
  const flame = glow(1, 0.5, 0.2)
  d.instanced(new THREE.BoxGeometry(1, 1, 1), flame, lights, false)
  return flame
}

/** The summit temple: the pagoda, a low wall round the court, gates where the roads come in. */
function temple(k: BuildKit): void {
  const { world: w, d } = k
  const sy = w.terrainAt(PAGODA.x, PAGODA.z)
  const pg = pagodaShape(5, 22)
  const at = trs(PAGODA.x, sy - 1, PAGODA.z, 0.4)
  for (const [m, mat] of [[pg.body, surface('plaster')], [pg.roof, surface('stone', { rough: 0.55 })]] as const) place(k, m, mat).applyMatrix4(at)
  place(k, pg.lit, glow(2.6, 1.5, 0.7), false).applyMatrix4(at)
  w.addBox(PAGODA.x, PAGODA.z, 17, 17, 0.4)
  const wall = new Mesher()
  for (let a = 0; a < Math.PI * 2; a += 0.06) {
    const x = PAGODA.x + Math.cos(a) * 88, z = PAGODA.z + Math.sin(a) * 74
    if (d.roadGap(x, z) < 6) continue
    const y = w.terrainAt(x, z)
    wall.box(5.6, 2.6, 1, x, y + 1, z, 0xe6dccb, -a + Math.PI / 2)
    wall.box(6, 0.5, 1.6, x, y + 2.5, z, 0x3a2a24, -a + Math.PI / 2)
    w.addPost(x, z, 1.2)
  }
  place(k, wall, surface('plaster'))
  // bells and incense in the court
  d.prop('bk:celandine_01', d.spots(30, 2, 10, { from: 0.42, to: 0.5, clear: 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2)))
}

/** The lakeside village: dark timber houses with tiled roofs, a jetty and boats. */
function village(k: BuildKit): void {
  const { world: w, d } = k
  const wood = new Mesher(), roofs = new Mesher()
  let n = 0
  for (let t = 0; t < 600 && n < 22; t++) {
    const x = -200 + d.rand() * 520, z = 100 + d.rand() * 160, y = w.terrainAt(x, z)
    if (y < SEA + 2 || d.roadGap(x, z) < 10 || w.blocked(x, z, 8)) continue
    const yaw = d.rand() * 0.6 - 0.3 + (z > 170 ? Math.PI : 0), wd = 9 + d.rand() * 4, dp = 7 + d.rand() * 2
    wood.box(wd, 4.4, dp, x, y + 1.8, z, [0x4a3020, 0x3a2618, 0x5a3a24][n % 3]!, yaw)
    wood.box(wd - 1, 2.6, 0.1, x + Math.sin(yaw) * (dp / 2 + 0.05), y + 1.9, z + Math.cos(yaw) * (dp / 2 + 0.05), 0xe8dcc0, yaw)
    roofs.add(new THREE.ConeGeometry(0.7071, 1, 4, 1), trs(x, y + 5.2, z, yaw + Math.PI / 4, new THREE.Vector3(wd * 1.25 * Math.SQRT2, 2.6, dp * 1.3 * Math.SQRT2)), 0x2e3238)
    w.addBox(x, z, wd / 2 + 0.3, dp / 2 + 0.3, yaw)
    n++
  }
  place(k, wood, surface('wood'))
  place(k, roofs, surface('stone', { rough: 0.6 }))
  const boats: THREE.Matrix4[] = []
  for (let q = 0; q < 30 && boats.length < 8; q++) {
    const x = -150 + d.rand() * 220, z = 230 + d.rand() * 120
    if (w.terrainAt(x, z) < -3 && d.roadGap(x, z) > 20) boats.push(trs(x, -0.3, z, d.rand() * 6, 0.2))
  }
  d.prop('dutch_ship_medium', boats, 0, undefined, 700)
}

/** The red arched bridge over the gorge. */
function redBridge(k: BuildKit): void {
  const { circuit: c, world: w } = k
  const m = new Mesher()
  const span: number[] = []
  for (let i = 0; i < c.count; i++) if (c.raised[i] && Math.abs(c.samples[i]!.x - GORGE_X) < 60) span.push(i)
  if (span.length < 4) return
  for (const s of [-1, 1]) {
    let prev: THREE.Vector3 | null = null
    span.forEach((i, q) => {
      const p = c.samples[i]!, r = c.rights[i]!, u = q / (span.length - 1)
      const off = s * (c.widths[i]! / 2 - 0.4)
      const a = new THREE.Vector3(p.x + r.x * off, p.y - 2 - Math.sin(u * Math.PI) * 0 - (1 - Math.sin(u * Math.PI)) * 16, p.z + r.z * off)
      if (prev) m.bar(prev, a, 0.7, 0xb8261c, 8)
      if (q % 3 === 0) m.bar(a, new THREE.Vector3(a.x, p.y - 0.4, a.z), 0.25, 0xb8261c, 6)
      prev = a
    })
  }
  // stone piers where the arch meets the gorge walls
  for (const i of [span[0]!, span[span.length - 1]!]) {
    const p = c.samples[i]!
    m.box(c.widths[i]! + 4, 24, 6, p.x, p.y - 14, p.z, 0x8a8478, Math.atan2(-c.tangents[i]!.x, -c.tangents[i]!.z))
  }
  place(k, m, surface('paint', { rough: 0.5 }))
  void w
}

/** The falls at the head of the gorge. */
function waterfall(k: BuildKit): THREE.MeshBasicMaterial {
  const tex = canvasTexture(256, 1024, (g, Wd, H) => {
    g.fillStyle = 'rgba(225,236,240,0.6)'
    g.fillRect(0, 0, Wd, H)
    for (let q = 0; q < 900; q++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`
      g.fillRect(Math.random() * Wd, Math.random() * H, 1 + Math.random() * 3.5, 30 + Math.random() * 180)
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.84, side: THREE.DoubleSide, depthWrite: false })
  const top = k.world.terrainAt(GORGE_X, -300) + 2
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(26, top + 4), mat)
  sheet.position.set(GORGE_X, top / 2 - 2, -262)
  k.root.add(sheet)
  mist(k, Array.from({ length: 8 }, (_, q) => new THREE.Vector3(GORGE_X - 14 + q * 4, 3 + (q % 2) * 3, -250)), [20, 34], 0xffeef0, 0.3)
  return mat
}

/** A striped lip and a warning board at the ravine jump. */
function ravineSign(k: BuildKit, ridge: Circuit): void {
  let lip = -1
  for (let i = 1; i < ridge.count; i++) if (ridge.gap[i] && !ridge.gap[i - 1]) { lip = i - 1; break }
  if (lip < 0) return
  const p = ridge.samples[lip]!, t = ridge.tangents[lip]!
  const m = new Mesher()
  m.box(ridge.widths[lip]! + 1, 1.6, 1, p.x, p.y - 1, p.z, 0x6a5a50, Math.atan2(-t.x, -t.z))
  m.box(ridge.widths[lip]! + 1, 0.25, 1.1, p.x, p.y - 0.1, p.z, 0xff6fa8, Math.atan2(-t.x, -t.z))
  place(k, m, surface('paint'))
  const sign = canvasTexture(512, 128, (g, Wd, H) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, Wd, H)
    for (let x = -H; x < Wd; x += 48) { g.fillStyle = '#ff6fa8'; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H * 0.4, H * 0.6); g.lineTo(x + H * 0.4, H * 0.6); g.fill() }
    g.fillStyle = '#ffffff'; g.font = 'italic 800 54px sans-serif'; g.textAlign = 'center'; g.fillText('BOOST TO CLEAR', Wd / 2, 58)
  })
  const j = Math.max(0, lip - 26), q = ridge.samples[j]!, qt = ridge.tangents[j]!, qr = ridge.rights[j]!
  const board = new THREE.Mesh(new THREE.PlaneGeometry(ridge.widths[j]! + 3, 2.8), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, side: THREE.DoubleSide }))
  board.position.set(q.x, q.y + 8, q.z)
  board.rotation.y = Math.atan2(qt.x, qt.z) + Math.PI
  k.root.add(board)
  const posts = new Mesher()
  const off = ridge.widths[j]! / 2 + 1.6
  for (const s of [-1, 1]) posts.post(0.15, 0.15, 8.5, q.x + qr.x * s * off, q.y, q.z + qr.z * s * off, 0x2a2e34, 8)
  place(k, posts, surface('metal'))
  for (const s of [-1, 1]) k.world.addPost(q.x + qr.x * s * off, q.z + qr.z * s * off, 0.3)
}

/**
 * The drift gate. Drifts count from the top of the hairpin stack: each one
 * finished within a few seconds of the last links on, a pause breaks the
 * chain. Five linked by the fifth hairpin and the red gate swings open for
 * a few seconds, on a cut past the last hairpin. Five lanterns on the gate
 * light up as your chain grows, so you can see how you're doing.
 */
function driftGate(k: BuildKit, cut: Circuit): void {
  const { circuit: c, world: w, root } = k
  const P = blossom.points
  const top = c.track(P[12]![0], P[12]![2], 0, c.count, P[12]![1])
  const gi = 10, gp = cut.samples[gi]!, gt = cut.tangents[gi]!, gr = cut.rights[gi]!
  const half = cut.widths[gi]! / 2 + 0.8, yaw = Math.atan2(-gt.x, -gt.z)
  // the gateway: two red posts, a beam, and a pair of doors between them
  const frame = new Mesher()
  for (const sd of [-1, 1]) {
    frame.post(0.6, 0.7, 8, gp.x + gr.x * sd * half, gp.y - 0.5, gp.z + gr.z * sd * half, 0xc8261c, 10)
    w.addPost(gp.x + gr.x * sd * half, gp.z + gr.z * sd * half, 0.8)
  }
  frame.box(half * 2 + 4, 0.8, 1, gp.x, gp.y + 7.4, gp.z, 0xc8261c, yaw)
  frame.box(half * 2 + 2, 0.5, 0.8, gp.x, gp.y + 6.2, gp.z, 0x2a1a14, yaw)
  place(k, frame, surface('paint', { rough: 0.5 }))
  const doorMat = surface('wood', { rough: 0.6 })
  const doors = [-1, 1].map((sd) => {
    const hinge = new THREE.Group()
    hinge.position.set(gp.x + gr.x * sd * (half - 0.6), gp.y, gp.z + gr.z * sd * (half - 0.6))
    hinge.rotation.y = yaw
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(half - 0.6, 5.6, 0.4), doorMat)
    leaf.position.set(-sd * (half - 0.6) / 2, 2.8, 0)
    hinge.add(leaf)
    hinge.userData['keep'] = true
    root.add(hinge)
    return { hinge, sd }
  })
  const lamps = Array.from({ length: 5 }, (_, q) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.06, 0.04), toneMapped: false }))
    const u = (q - 2) * 2.2
    m.position.set(gp.x + gr.x * u, gp.y + 6.9, gp.z + gr.z * u)
    root.add(m)
    return m
  })
  const solid: Solid = { x: gp.x, z: gp.z, r: half + 1, hx: half, hz: 0.6, cos: Math.cos(yaw), sin: Math.sin(yaw), top: gp.y + 7 }
  w.movers.push(solid)
  // each racer's chain: how many linked, when the last drift finished, and its drift count then
  const chains: { n: number; last: number; seen: number }[] = []
  let openFor = 0, swing = 0, t = 0
  const LINK = 5
  k.onFrame((f) => {
    t += f.dt
    let player = 0
    f.racers.forEach((r, q) => {
      const ch = chains[q] ?? (chains[q] = { n: 0, last: -99, seen: r.drifts })
      const into = (r.s - top + c.count) % c.count
      const onStack = r.path === c && into < c.count * 0.2
      if (!onStack) { ch.n = 0; ch.seen = r.drifts; return }
      if (r.drifts > ch.seen) {
        ch.n = t - ch.last < 4.5 ? ch.n + 1 : 1
        ch.last = t
        ch.seen = r.drifts
        if (ch.n >= LINK) openFor = 6
      }
      if (t - ch.last > 4.5 && ch.n < LINK) ch.n = 0
      if (r.isPlayer) player = ch.n
    })
    openFor = Math.max(0, openFor - f.dt)
    const open = openFor > 0
    swing += ((open ? 1 : 0) - swing) * Math.min(1, f.dt * 4)
    for (const d of doors) d.hinge.rotation.y = yaw + d.sd * swing * 1.5
    solid.top = swing > 0.7 ? -1e6 : gp.y + 7
    cut.join!.odds = open ? 0.7 : 0
    // closed, nobody is steered onto it by mistake (or rescued there)
    cut.shut = swing < 0.5
    lamps.forEach((m, q) => {
      const lit = open || q < player
      ;(m.material as THREE.MeshBasicMaterial).color.setRGB(lit ? 5 : 0.3, lit ? 2.6 : 0.06, lit ? 0.6 : 0.04)
    })
  })
}
