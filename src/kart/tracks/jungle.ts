import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, trs } from '../../game/biomes/kit'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import type { Solid } from '../World'
import { arrows, crates, drift, gantry, glow, mist, roadZones, stands, zoneFx } from './parts'

/*
 * Rainforest Run, as an expedition. Leave the river village on a red-dirt
 * trail; at the river take the rope bridge high over the water, or splash
 * through the ford below it. Up the west bank to the falls, along the ledge
 * that runs behind the curtain of water, then switchbacks up the cliff onto
 * the plateau. A walkway through the crowns of the giant trees ends at a
 * launch platform: wings out, and a long glide down over the canopy to the
 * temple. Round the temple, or through the tunnel inside it, and back past
 * the ruins and the giant tree to the village.
 *
 * Lap 2: the rain starts, mud spreads across the trail and a trap in the
 * temple tunnel starts sliding its stone across. Last lap: the river is up,
 * the ford is a mudbath and the rain is heavy.
 */

const SEA = 2
const riverDist = (x: number, z: number): number => {
  const ax = -90, az = -540, bx = 10, bz = 80
  const dx = bx - ax, dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(x - ax - dx * t, z - az - dz * t)
}
const LAKE = { x: 0, z: 200 }
const TEMPLE = { x: -348, z: -20, size: 66, tunnel: 9 }
const FALLS = { x0: -140, x1: -42, z: -531, top: 56 }

function profile(x: number, z: number): number {
  let h = 10 + Math.sin(x * 0.01) * 6 + Math.cos(z * 0.013) * 6
  h += smooth(-500, -575, z) * 72 // the plateau and its cliff
  const r = riverDist(x, z)
  if (r < 70 && z > -560) h = THREE.MathUtils.lerp(-6, h, smooth(18, 64, r))
  const l = Math.hypot(x - LAKE.x, z - LAKE.z)
  if (l < 150) h = THREE.MathUtils.lerp(-6, h, smooth(70, 140, l))
  return h
}

const W = { raised: true, w: 13, rail: 'LR', bank: 0, deck: 'wood' } as const

const POINTS: TrackPoint[] = [
  // 0: the river village, heading north up the east bank
  [196, 14, 70],
  [186, 15, -20, { pad: 3 }],
  [160, 16, -105, { items: true }],
  [130, 16, -170], // 3: the ford leaves here
  [90, 16, -230],
  // 5: the rope bridge, high over the river
  [30, 18, -262, W],
  [-60, 18, -292, W],
  [-140, 16, -330], // 7: the ford rejoins
  // 8: up the west bank to the falls, and behind them
  [-175, 24, -420, { items: true }],
  [-155, 32, -512],
  [-118, 36, -544],
  [-60, 37, -548, { pad: 0 }],
  [0, 41, -540],
  // 13: switchbacks up the cliff
  [90, 47, -536],
  [170, 53, -546],
  [198, 57, -572, { bank: 4, w: 20 }],
  [150, 62, -592],
  [70, 68, -598],
  [0, 74, -608, { items: true }],
  [-60, 82, -622],
  // 20: the walkway through the crowns, out to the launch platform
  [-120, 92, -630, W],
  [-200, 92, -612, W],
  [-262, 92, -565, W],
  [-296, 92, -512, { raised: true, w: 16, rail: '', bank: 0, deck: 'wood' }],
  // 24: wings out over the canopy
  [-304, 93, -498, { raised: true, gap: true, glide: true }],
  [-311, 82, -450, { raised: true, gap: true, glide: true }],
  [-316, 72, -400, { raised: true, gap: true, glide: true }],
  // 27: the landing ramp, down to the temple plaza
  [-318, 57, -356, { raised: true, w: 26 }],
  [-322, 45, -262, { raised: true, w: 22 }],
  [-326, 33, -170],
  [-335, 24, -96, { pad: 0 }], // 30: the temple tunnel leaves here
  // 31: round the temple, then back past the ruins to the village
  [-275, 22, -40],
  [-282, 19, 40], // 32: the tunnel rejoins
  [-220, 16, 95],
  [-110, 14, 80, { items: true }],
  [40, 12, 40],
  // the last corner, onto the village straight: opened out and banked, so it
  // reads from a long way off instead of arriving all at once
  [118, 12, 138],
  [170, 13, 156, { bank: 4, w: 20 }],
  [205, 13, 143, { bank: 4, w: 20 }],
  [216, 13, 108],
]

export const jungle: TrackDef = {
  id: 'jungle',
  name: 'Rainforest Run',
  news: ['THE RAIN STARTS - WATCH THE TEMPLE TRAP', 'THE RIVER IS UP'],
  ambience: 'jungle',
  width: 17,
  bank: 3,
  shoulder: 22,
  accent: 0x5dff9a,
  far: 0x2a4a30,
  sea: SEA,
  water: { deep: 0x123a2e, shallow: 0x3f7a58, foam: 0xdce8d8, waves: 0.4 },
  deck: 'dirt',
  rails: 'wood',
  piers: 'none',
  road: { lines: 'plain', dirt: 'brown_mud_leaves_01', grime: 0x2c2416, tone: 0xe0b890 },
  terrain: { layers: ['forest_floor', 'brown_mud_leaves_01', 'rock_pitted_mossy', 'grass'], tile: [12, 9, 18, 24], tints: [0xc4d0a4, 0xd4c8a8, 0xb6c8a0, 0x9ab470] },
  look: {
    tod: 'morning', fog: [0.34, 0.5, 0.4], fogDensity: 0.0034, fogBase: 26, fogFall: 0.016, sunGlow: 0.4,
    // the low sun was glaring straight into the screen: less haze glow, fewer shafts
    exposure: 1, sun: 1.1, hemi: 0.95, bloom: 0.22, shafts: 0.35, wet: 0.2, grade: [1.1, 1.14, 0, 0.004, 0, 0.98, 1.03, 0.94, 0.36],
  },
  points: POINTS,
  branches: [
    {
      // the ford: down the bank and through the shallows. Shorter, but muddy.
      name: 'Ford', from: 3, to: 7, odds: 0.4,
      points: [
        [70, 9, -180, { w: 15 }],
        [10, 3.5, -205, { w: 15 }],
        [-55, 3.5, -235, { w: 15 }],
        [-110, 9, -285, { w: 15 }],
      ],
    },
    {
      // through the temple: a dark stone tunnel, with a trap from lap 2
      name: 'Temple tunnel', from: 30, to: 32, odds: 0.5,
      points: [
        [-345, 23, -62, { w: 13 }],
        [-348, 22, -20, { w: 12 }],
        [-346, 21, 22, { w: 13 }],
      ],
    },
    {
      // the vine swing: off the bank, grab the vine and swing over the river.
      // Let go just after the bottom for the fast line; too soon and you're in
      // the water; hang on and you land safe but slow
      name: 'Vine swing', from: 4, to: 8, odds: 0.35,
      points: [
        [70, 18, -286, { w: 14, pad: 0 }],
        [40, 19, -300, { w: 14, rail: '' }],
        [10, 15, -313, { gap: true, w: 14 }],
        [-15, 13, -324, { gap: true, w: 14 }],
        [-30, 13, -330.5, { raised: true, w: 22, deck: 'wood', rail: '', bank: 0 }],
        [-62, 13, -345, { raised: true, w: 20, deck: 'wood', rail: 'LR', bank: 0 }],
        [-112, 17, -372, { w: 16 }],
        [-150, 22, -402, { w: 16 }],
      ],
    },
  ],
  ground(x, z) {
    const g = profile(x, z)
    return g + fbm2(x * 0.008, z * 0.008) * 14 * smooth(6, 20, g) * (1 - smooth(-480, -560, z)) + fbm2(x * 0.03, z * 0.03) * 3
  },
  splat(_x, _z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.62, 1.05, slope), bank = 1 - smooth(SEA, SEA + 4, h)
    mix[0] = (1 - rock) * (1 - bank)
    mix[1] = Math.max(bank, smooth(10, 3, roadDist) * 0.9)
    mix[2] = rock
    mix[3] = (1 - rock) * 0.6
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'mud',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Rainforest Run', '#5dff9a')
    stands(k, 8, 46, 1, [0x4a8a5a, 0xdcd8c8, 0xc89a3a, 0xb0603a, 0x2e3a34], 0x3fae68, 'Rainforest Run')
    arrows(k, 0xa8e070)
    mountainRing(root, -60, -200, { inner: 1300, outer: 3000, height: 520, rock: 0x3d5a48, seed: 9 })
    const ford = c.branches[0]!, tunnel = c.branches[1]!

    const dry = (x: number, z: number, y: number) => y > SEA + 4 && riverDist(x, z) > 30
    forest(k, 'rainforest', d.spots(260, 12, 90, { clear: 9, test: dry }), { scale: [0.75, 1.25], tints: [0xe8f0d0, 0xc8e0b0, 0xf0f4c8] })
    forest(k, 'rainforest', d.spots(240, 90, 320, { clear: 40, test: dry }), { scale: [0.9, 1.4], solid: 0, tints: [0xe0ecc8, 0xc4dcac] })
    forest(k, 'oak', d.spots(150, 3, 16, { clear: 3.5, test: dry }), { scale: [0.5, 0.8], tints: [0xa8d088, 0x90c078, 0xbcdc90] })
    d.trees('palm', d.spots(80, 3, 34, { clear: 4, test: (_x, _z, y) => y > SEA + 2 }), [0.9, 1.5], 0.7)
    grass(k, { density: 3, reach: 18, height: [0.7, 1.5], colors: [0x5f9a48, 0x4f8a3e, 0x74aa50, 0x3f7a38], test: (_x, _z, y) => y > SEA + 1 })
    d.prop('fern_02', d.spots(160, 1, 18, { clear: 0.8, test: dry }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.8 + d.rand() * 2.4)))
    d.prop('calathea_orbifolia_01', d.spots(50, 1, 14, { clear: 0.8, test: dry }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2.4 + d.rand() * 2)))
    const flat = (x: number, z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, z) - w.terrainAt(x - e, z), gz = w.terrainAt(x, z + e) - w.terrainAt(x, z - e)
      return Math.hypot(gx, gz) / (2 * e) < 0.35 && y > SEA + 1
    }
    d.prop('rock_moss_set_01', d.spots(34, 7, 44, { clear: 7, test: flat }).map((s) => trs(s.x, s.y - 0.3, s.z, d.rand() * 6, 1.6 + d.rand() * 2)), 1.2)
    d.prop('root_cluster_01', d.spots(10, 6, 20, { clear: 6, test: flat }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4 + d.rand())), 0.9)
    d.prop('tree_stump_01', d.spots(20, 4, 12, { clear: 4, test: flat }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2)), 0.8)
    crates(d, d.spots(10, 2, 7, { from: 0.0, to: 0.12, clear: 1.5 }), 0xc0a070)

    village(k)
    ropeBridge(k)
    const fall = falls(k)
    canopy(k)
    const trap = temple(k, tunnel)
    ruins(k, d.spots(18, 3, 11, { from: 0.86, to: 0.97, clear: 3 }))
    giantTree(k, -40, -70)

    // rain, mud and the river: what changes each lap
    const rain = drift(k, 900, 0xcfe0ea, 1.6, 42, true)
    rain.visible = false
    // muddy water lying on the trail: brown, glossy, see-through at the edges
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a4628, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false, envMapIntensity: 1.4 })
    const patches: { m: THREE.Mesh; lap: number; i: number }[] = []
    const puddle = (p: Circuit, fr: number, lat: number, r: number, lap: number) => {
      const q = Math.floor(p.count * fr), s = p.samples[q]!, rt = p.rights[q]!
      const x = s.x + rt.x * lat, z = s.z + rt.z * lat
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 22), dark)
      m.rotation.x = -Math.PI / 2
      m.position.set(x, s.y + 0.09, z)
      m.scale.set(0.8, 1.3, 1)
      m.visible = false
      root.add(m)
      w.patches.push({ x, z, r, surface: 'mud', on: false })
      patches.push({ m, lap, i: w.patches.length - 1 })
    }
    for (const [fr, lat, r, lap] of [[0.08, 4, 6, 2], [0.2, -4, 7, 2], [0.36, 3, 6, 2], [0.45, -4, 6, 3], [0.88, 4, 7, 3], [0.95, -3, 7, 2]] as const) puddle(c, fr, lat, r, lap)
    // the ford is always muddy; on the last lap the river is up and it's worse
    for (const [fr, lap] of [[0.3, 1], [0.5, 1], [0.7, 1], [0.4, 3], [0.6, 3]] as const) puddle(ford, fr, 0, 9, lap)
    // the river runs through the ford: it carries you downstream as you cross,
    // and on the last lap, with the river up, it is strong
    const rdx = 100 / Math.hypot(100, 620), rdz = 620 / Math.hypot(100, 620)
    const flow = roadZones(k, ford, Math.floor(ford.count * 0.22), Math.floor(ford.count * 0.8), 8)
    zoneFx(k, flow.map((q) => q.z), 0xd8e8e0, 0.35, 34)
    // ruts in the mud past the ruins: once the rain has softened them they
    // grab the wheels and drag the car along them, snaking from side to side
    const P = jungle.points
    const at = (n: number) => c.track(P[n]![0], P[n]![2], 0, c.count, P[n]![1])
    const ruts = roadZones(k, c, at(33), at(35), 7)
    const rutMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.3, transparent: true, opacity: 0.75, depthWrite: false })
    const rutMeshes: THREE.Mesh[] = []
    ruts.forEach((q, n) => {
      const off = (n % 2 ? 1 : -1) * 0.2
      q.z.grab = 1.4
      q.z.yaw = Math.atan2(-q.fx, -q.fz) + off
      for (const sd of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, q.z.hz! * 2), rutMat)
        m.rotation.set(-Math.PI / 2, 0, 0)
        const g = new THREE.Group()
        g.add(m)
        g.position.set(q.z.x + q.rx * sd * 3, c.samples[c.track(q.z.x, q.z.z, 0, c.count)]!.y + 0.08, q.z.z + q.rz * sd * 3)
        g.rotation.y = Math.atan2(q.fx, q.fz) - off
        g.visible = false
        root.add(g)
        rutMeshes.push(g as unknown as THREE.Mesh)
      }
    })
    k.onFrame((f) => {
      const up = f.totalLaps > 1 && f.lap >= f.totalLaps
      for (const q of flow) { q.z.on = true; q.z.vx = rdx * (up ? 8 : 4); q.z.vz = rdz * (up ? 8 : 4) }
      for (const q of ruts) q.z.on = f.lap >= 2
      for (const m of rutMeshes) m.visible = f.lap >= 2
    })
    k.onFrame((f) => {
      fall.map!.offset.y = (f.time * 0.9) % 1
      const storm = (f.lap - 1) / Math.max(1, f.totalLaps - 1)
      rain.visible = storm > 0
      k.road.wet.value += ((0.2 + storm * 0.8) - k.road.wet.value) * Math.min(1, f.dt * 0.4)
      if (k.water) k.water.mesh.position.y = SEA + storm * 0.9
      for (const p of patches) {
        const on = f.lap >= p.lap
        p.m.visible = on
        w.patches[p.i]!.on = on
      }
      trap(f.lap >= 2, f.time)
    })
    vineSwing(k, c.branches[2]!)
  },
}

/** Stilt huts with thatched roofs round the village clearing. */
function village(k: BuildKit): void {
  const { world: w, d } = k
  const wood = new Mesher(), thatch = new Mesher()
  let n = 0
  for (let t = 0; t < 400 && n < 16; t++) {
    const x = 60 + d.rand() * 220, z = 20 + d.rand() * 220, y = w.terrainAt(x, z)
    if (y < SEA + 2 || d.roadGap(x, z) < 12 || w.blocked(x, z, 7)) continue
    const yaw = d.rand() * 6, s = 0.9 + d.rand() * 0.4
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) wood.post(0.18, 0.18, 3.2 * s, x + a! * 2.6 * s, y - 0.5, z + b! * 2.6 * s, 0x5a4028, 6)
    wood.box(6.4 * s, 0.4, 6.4 * s, x, y + 2.8 * s, z, 0x6a4a2c, yaw)
    wood.box(5.6 * s, 2.6 * s, 5.6 * s, x, y + 4.2 * s, z, 0x8a6a40, yaw)
    thatch.add(new THREE.ConeGeometry(5.4 * s, 3.6 * s, 8), trs(x, y + 7.2 * s, z, yaw), 0xb09050)
    w.addBox(x, z, 3.4 * s, 3.4 * s, yaw)
    n++
  }
  place(k, wood, surface('wood'))
  place(k, thatch, surface('wood', { rough: 1 }))
}

/** The rope bridge: towers at each end, cables sagging between, ropes to the deck. */
function ropeBridge(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const span: number[] = []
  for (let i = 0; i < c.count; i++) {
    const p = c.samples[i]!
    if (c.raised[i] && p.y < 30 && p.z > -320 && p.z < -245) span.push(i)
  }
  if (!span.length) return
  const timber = new Mesher(), ropes: THREE.Matrix4[] = []
  for (const i of [span[0]!, span[span.length - 1]!]) {
    const p = c.samples[i]!, r = c.rights[i]!, half = c.widths[i]! / 2 + 0.6
    for (const s of [-1, 1]) {
      timber.box(1.1, 16, 1.1, p.x + r.x * s * half, p.y + 5, p.z + r.z * s * half, 0x4a3524)
      w.addPost(p.x + r.x * s * half, p.z + r.z * s * half, 0.9)
    }
    timber.box(half * 2 + 3, 0.9, 0.9, p.x, p.y + 12.6, p.z, 0x4a3524, Math.atan2(c.tangents[i]!.x, c.tangents[i]!.z))
  }
  for (let q = 0; q < span.length; q += 3) {
    const i = span[q]!, p = c.samples[i]!, r = c.rights[i]!, half = c.widths[i]! / 2 + 0.3
    const u = q / span.length, sag = 4 * (u - 0.5) ** 2
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * half, z = p.z + r.z * s * half
      ropes.push(trs(x, p.y + 1 + (2.4 + sag * 8.5) / 2, z, 0, new THREE.Vector3(0.05, 2.4 + sag * 8.5, 0.05)))
    }
    timber.box(c.widths[i]! + 2, 0.2, 0.4, p.x, p.y - 0.5, p.z, 0x38281a, Math.atan2(c.tangents[i]!.x, c.tangents[i]!.z))
  }
  place(k, timber, surface('wood'))
  d.instanced(new THREE.CylinderGeometry(1, 1, 1, 5), new THREE.MeshStandardMaterial({ color: 0x8a7650, roughness: 0.9 }), ropes, false)
}

/** The falls: a rock lip over the ledge road and a curtain of water in front of it. */
function falls(k: BuildKit): THREE.MeshBasicMaterial {
  const { root, world: w } = k
  const tex = canvasTexture(256, 1024, (g, Wd, H) => {
    g.fillStyle = 'rgba(205,232,240,0.62)'
    g.fillRect(0, 0, Wd, H)
    for (let q = 0; q < 900; q++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`
      g.fillRect(Math.random() * Wd, Math.random() * H, 1 + Math.random() * 3.5, 30 + Math.random() * 180)
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 1)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false })
  const wide = FALLS.x1 - FALLS.x0, mid = (FALLS.x0 + FALLS.x1) / 2
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(wide, FALLS.top + 2), mat)
  curtain.position.set(mid, FALLS.top / 2, FALLS.z)
  root.add(curtain)
  // the overhang the water pours from, and the plateau cliff behind the ledge
  const rock = new Mesher()
  rock.box(wide + 30, 7, 30, mid, FALLS.top + 2, FALLS.z - 14, 0x5a6a50, 0, 0.04)
  for (let q = 0; q < 8; q++) rock.box(10 + q, 5, 8, FALLS.x0 - 10 + q * 16, FALLS.top - 2 - (q % 3), FALLS.z - 3, 0x4e5e46, q * 0.3)
  place(k, rock, surface('rock'))
  mist(k, Array.from({ length: 16 }, (_, q) => new THREE.Vector3(FALLS.x0 + q * (wide / 15), 4 + (q % 3) * 3, FALLS.z + 10)), [30, 52], 0xeaf4f4, 0.32)
  void w
  return mat
}

/** The walkway through the crowns: giant trunks either side, platforms round them. */
function canopy(k: BuildKit): void {
  const { circuit: c, world: w } = k
  const deck = new Mesher(), spots: THREE.Vector3[] = []
  let lastAt = -99
  for (let i = 0; i < c.count; i += 2) {
    const p = c.samples[i]!
    if (!c.raised[i] || c.gap[i] || p.y < 80) continue
    if (i - lastAt < 16) continue
    lastAt = i
    const r = c.rights[i]!, half = c.widths[i]! / 2, s = (i / 16) % 2 < 1 ? 1 : -1
    const x = p.x + r.x * s * (half + 7), z = p.z + r.z * s * (half + 7), g = w.terrainAt(x, z)
    // a giant trunk carrying a ring platform at deck height
    deck.add(new THREE.CylinderGeometry(2.6, 3.6, p.y - g + 26, 12), trs(x, (p.y + g + 26) / 2, z), 0x5a4c3e)
    deck.add(new THREE.CylinderGeometry(6, 6, 0.6, 16), trs(x, p.y - 0.6, z), 0x6a4a2c)
    spots.push(new THREE.Vector3(x, p.y + 18, z))
    // the walkway's own posts down to the ground
    for (const e of [-1, 1]) deck.post(0.3, 0.3, p.y - g, p.x + r.x * e * (half - 0.4), g, p.z + r.z * e * (half - 0.4), 0x4a3524, 6)
  }
  place(k, deck, surface('wood'))
  forest(k, 'rainforest', spots, { scale: [2.2, 2.8], solid: 0, tints: [0xdcecc4, 0xc8e0b0] })
  // the launch platform: vines and a striped edge
  for (let i = 1; i < c.count; i++) {
    if (!c.gap[i] || c.gap[i - 1] || !c.glide[i]) continue
    const p = c.samples[i - 1]!, t = c.tangents[i - 1]!, m = new Mesher()
    m.box(c.widths[i - 1]! + 2, 1.4, 1.2, p.x, p.y - 0.9, p.z, 0x5a4028, Math.atan2(-t.x, -t.z))
    m.box(c.widths[i - 1]! + 2, 0.25, 1.3, p.x, p.y - 0.1, p.z, 0x5dff9a, Math.atan2(-t.x, -t.z))
    place(k, m, surface('paint'))
  }
}

/**
 * A stepped temple with a tunnel straight through it, torches inside, and a
 * stone slab that slides across the tunnel from lap 2.
 */
function temple(k: BuildKit, tn: Circuit): (on: boolean, t: number) => void {
  const { world: w, root } = k
  const { x, z, size, tunnel } = TEMPLE
  const y = w.terrainAt(x, z)
  const m = new Mesher(), stone = [0x8f8b70, 0x83806a, 0x9a947a]
  let h = y - 1
  for (let q = 0; q < 7; q++) {
    const s = size - q * 9, tall = 6.2
    if (h + tall < y + 13) {
      // the lowest tiers are split either side of the tunnel
      const side = (s - tunnel * 2) / 2
      for (const e of [-1, 1]) m.box(side, tall, s, x + e * (tunnel + side / 2), h + tall / 2, z, stone[q % 3]!)
    } else m.box(s, tall, s, x, h + tall / 2, z, stone[q % 3]!)
    m.box(s + 1.2, 0.7, s + 1.2, x, h + tall - 0.1, z, 0x79765f)
    h += tall
  }
  // the tunnel's ceiling and lintels at each mouth
  m.box(tunnel * 2 + 2, 1.4, size, x, y + 12.2, z, 0x6e6b58)
  for (const e of [-1, 1]) m.box(tunnel * 2 + 6, 3, 2, x, y + 13.5, z + e * size / 2, 0x79765f)
  for (const [dx, dz, ry] of [[1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]] as const) {
    for (let st = 0; st < 42; st++) m.box(9, 1.02, 1.5, x + dx * (size / 2 + 1 - st * 0.74), y + st * 1.02, z + dz, 0x8a866e, ry)
  }
  m.box(16, 10, 16, x, h + 5, z, 0x8a866e)
  m.box(19, 1.2, 19, x, h + 10.6, z, 0x79765f)
  place(k, m, surface('stone'))
  for (const e of [-1, 1]) {
    const side = (size - tunnel * 2) / 2
    w.addBox(x + e * (tunnel + side / 2), z, side / 2, size / 2)
  }
  // torches along the tunnel walls
  const flames: THREE.Matrix4[] = []
  for (let q = -3; q <= 3; q++) for (const e of [-1, 1]) flames.push(trs(x + e * (tunnel - 0.4), y + 5, z + q * 9, 0, new THREE.Vector3(0.4, 0.8, 0.4)))
  k.d.instanced(new THREE.BoxGeometry(1, 1, 1), glow(3.2, 1.6, 0.5), flames, false)
  // the trap: a slab that slides out of the wall and back
  const i = Math.floor(tn.count / 2), p = tn.samples[i]!
  const slab = new THREE.Mesh(new THREE.BoxGeometry(tunnel * 2, 6, 3), surface('stone'))
  slab.position.set(x - tunnel * 2.2, p.y + 3, p.z)
  root.add(slab)
  const solid: Solid = { x: slab.position.x, z: p.z, r: Math.hypot(tunnel, 1.5), hx: tunnel, hz: 1.5, cos: 1, sin: 0, top: -1e6 }
  w.movers.push(solid)
  return (on, t) => {
    // in the tunnel for a third of each 4.5 s cycle
    const u = on ? Math.max(0, Math.sin((t / 4.5) * Math.PI * 2)) : 0
    slab.position.x = x - tunnel * 2.2 + u * tunnel * 2.2
    solid.x = slab.position.x
    solid.top = u > 0.15 ? p.y + 6 : -1e6
  }
}

/** Tall ruined columns and fallen blocks beside the road. */
function ruins(k: BuildKit, spots: THREE.Vector3[]): void {
  const m = new Mesher()
  for (const s of spots) {
    const tall = 4 + k.d.rand() * 7, tilt = (k.d.rand() - 0.5) * 0.12
    m.add(new THREE.CylinderGeometry(0.85, 1, tall, 12), trs(s.x, s.y + tall / 2 - 0.3, s.z, 0, 1, tilt, -tilt), 0x8d8a72)
    m.box(2.6, 0.7, 2.6, s.x, s.y + 0.1, s.z, 0x7c7960)
    k.world.addPost(s.x, s.z, 1.2)
  }
  if (!m.empty) place(k, m, surface('stone'))
}

/** The giant in the middle of the loop: buttressed trunk under a huge crown. */
function giantTree(k: BuildKit, gx: number, gz: number): void {
  const { world: w } = k, gy = w.terrainAt(gx, gz)
  const giant = new Mesher()
  giant.add(new THREE.CylinderGeometry(9, 15, 96, 18, 1), trs(gx, gy + 46, gz), 0x5a4c3e)
  for (let q = 0; q < 8; q++) {
    const a = q * 0.785, reach = 26
    giant.bar(new THREE.Vector3(gx + Math.cos(a) * reach, gy - 2, gz + Math.sin(a) * reach), new THREE.Vector3(gx + Math.cos(a) * 9, gy + 34, gz + Math.sin(a) * 9), 3.4, 0x54463a, 7)
  }
  place(k, giant, surface('rock'))
  w.addPost(gx, gz, 24)
  forest(k, 'rainforest', [new THREE.Vector3(gx, gy + 40, gz), new THREE.Vector3(gx - 34, gy + 26, gz + 18), new THREE.Vector3(gx + 30, gy + 30, gz - 20), new THREE.Vector3(gx + 10, gy + 22, gz + 36)], { scale: [2.6, 3.2], solid: 0, tints: [0xdcecc4] })
}

/**
 * The vine: hung from a bough of a giant tree leaning over the river. A car
 * off the lip catches it (see Racer.catchVine); here it's drawn, swaying when
 * no one's on it and pulled taut to whoever is.
 */
function vineSwing(k: BuildKit, swing: Circuit): void {
  const { world: w, root } = k
  // the lip: the last road before the gap
  let lip = 0
  while (lip < swing.count - 1 && !swing.gap[lip + 1]) lip++
  const a = swing.samples[lip]!, t = swing.tangents[lip]!
  const f = new THREE.Vector2(t.x, t.z).normalize()
  const L = 28, reach = 22
  const vine = { x: a.x + f.x * reach, z: a.z + f.y * reach, y: a.y + L * Math.cos(Math.asin(reach / L)) + 0.6, L, fx: f.x, fz: f.y, holds: [] as number[] }
  w.vines.push(vine)
  // the tree on the far bank, its bough reaching out over the river to the pivot
  const tx = vine.x + f.x * 40 - f.y * 30, tz = vine.z + f.y * 40 + f.x * 30, ty = w.terrainAt(tx, tz)
  const tree = new Mesher()
  tree.post(3.2, 4.6, vine.y + 10 - ty, tx, ty - 2, tz, 0x4a3a2a, 12)
  const bough = new THREE.Vector3(vine.x, vine.y + 1, vine.z)
  tree.bar(new THREE.Vector3(tx, vine.y + 6, tz), bough, 1.3, 0x4a3a2a, 8)
  tree.bar(bough, new THREE.Vector3(vine.x - f.x * 14 + f.y * 6, vine.y + 3, vine.z - f.y * 14 - f.x * 6), 0.8, 0x4a3a2a, 6)
  for (let q = 0; q < 10; q++) tree.add(new THREE.SphereGeometry(5 + (q % 3) * 1.5, 8, 6), trs(tx + Math.sin(q * 2.3) * 12, vine.y + 12 + (q % 4) * 3, tz + Math.cos(q * 2.3) * 12, 0, 1), [0x2e5a2a, 0x3a6a30, 0x2a4e26][q % 3]!)
  place(k, tree, surface('wood', { rough: 0.9 }))
  w.addPost(tx, tz, 4.4)
  // the vines themselves: one for each rider, and one hanging free
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 0.9 })
  const ropes = Array.from({ length: 7 }, () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 5), mat); m.frustumCulled = false; root.add(m); return m })
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 5), new THREE.MeshStandardMaterial({ color: 0x5a8a3a, roughness: 0.9 }))
  root.add(leaves)
  const top = new THREE.Vector3(vine.x, vine.y, vine.z), end = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const set = (m: THREE.Mesh, to: THREE.Vector3) => {
    const d = to.clone().sub(top), len = d.length()
    m.visible = true
    m.position.copy(top).addScaledVector(d, 0.5)
    m.scale.set(1, len, 1)
    m.quaternion.setFromUnitVectors(up, d.divideScalar(len || 1))
  }
  k.onFrame((fr) => {
    // the free vine sways back towards the lip, ready to be caught
    const th = -Math.asin(reach / L) * (0.82 + Math.sin(fr.time * 1.3) * 0.08)
    end.set(vine.x + vine.fx * L * Math.sin(th), vine.y - L * Math.cos(th) + 1.4, vine.z + vine.fz * L * Math.sin(th))
    set(ropes[0]!, end)
    leaves.position.copy(end)
    for (let q = 1; q < ropes.length; q++) {
      const h = vine.holds, j = (q - 1) * 3
      if (j + 2 < h.length) set(ropes[q]!, end.set(h[j]!, h[j + 1]!, h[j + 2]!))
      else ropes[q]!.visible = false
    }
    vine.holds.length = 0
  })
}
