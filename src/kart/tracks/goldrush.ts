import * as THREE from 'three'
import { canvasTexture, fbm2, lumpy, ridged2, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, crowd, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { Platform, Solid } from '../World'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import { arrows, crates, gantry, glow, mist, railTrack } from './parts'

/*
 * Gold Rush Line, as a run round the valley. Down the boomtown's main street
 * with the railway alongside, over the level crossing (the train doesn't
 * stop), then up and over the mesa, or straight through it in the old mine,
 * where ore carts cross the galleries. Down off the mesa and over the gorge
 * on a broken trestle, back across the railway, and home round the canyon
 * (from lap 2, the dynamite blasts a short cut through the canyon wall).
 * The last lap: the train runs hot.
 */

const RAIL_Y = 16
const RX = 640, RZ = 36, CZ = -150
const MESA = { x: 210, z: -470, r: 175, h: 74 }
const GORGE = { x: -258, z0: -470, z1: -230, half: 44 }
const SLOT = { x0: -360, x1: -160 }

/** Where the railway loop runs: a long thin oval through the valley. */
const railPoint = (a: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.cos(a) * RX, 0, CZ + Math.sin(a) * RZ)
const railDist = (x: number, z: number): number => {
  const u = x / RX, v = (z - CZ) / RZ
  return Math.abs(Math.hypot(u, v) - 1) * RZ
}

const T = { tunnel: true, w: 13, deck: 'wood', rail: 'LR', lock: true } as const

const POINTS: TrackPoint[] = [
  // 0: main street, heading east with the railway alongside
  [0, 14, -60],
  [130, 14, -62, { pad: 0 }],
  [250, 15, -66, { items: true }],
  [380, 16, -60],
  // 4: over the level crossing, and up towards the mesa
  [452, 17, -150],
  [482, 24, -270],
  [430, 36, -370], // 6: the mine leaves here
  // 7: up and over the mesa
  [340, 58, -450],
  [210, 70, -500, { items: true }],
  [80, 62, -490],
  [-30, 44, -430], // 10: the mine rejoins
  [-150, 38, -380, { pad: 0 }],
  // 12: the broken trestle over the gorge: jump the missing span
  [-212, 40, -334, { raised: true, deck: 'wood', w: 15, rail: '' }],
  [-258, 44, -322, { raised: true, gap: true }],
  [-302, 36, -310, { raised: true, deck: 'wood', w: 15, rail: '' }],
  [-360, 30, -262],
  // 16: back over the railway, and round the canyon (the blast short cut leaves at 17)
  [-424, 18, -150],
  [-400, 17, -40],
  [-472, 16, 50],
  [-390, 14, 112, { pad: 0, items: true }],
  [-240, 14, 104],
  [-120, 14, 40], // 21: the blast short cut rejoins
  // 22: out round the south of town and back to main street
  [-200, 14, 150],
  [-110, 14, 250, { pad: 0 }],
  [20, 14, 232, { items: true }],
  [72, 14, 122],
  [-40, 14, 40],
  [-82, 14, -38],
]

export const goldrush: TrackDef = {
  id: 'goldrush',
  name: 'Gold Rush Line',
  ambience: 'desert',
  width: 18,
  bank: 2.6,
  shoulder: 26,
  accent: 0xe8a03a,
  far: 0xa8704a,
  deck: 'dirt',
  rails: 'wood',
  piers: 'none',
  road: { lines: 'plain', dirt: 'aerial_sand', grime: 0x8a6240, tone: 0xe0a070 },
  terrain: { layers: ['aerial_sand', 'mud_cracked_dry_03', 'rock_pitted_mossy', 'coast_sand_01'], tile: [24, 14, 26, 18], tints: [0xe0a878, 0xd8a478, 0xc06840, 0xe0b488] },
  look: {
    tod: 'sunset', fog: [0.86, 0.56, 0.36], fogDensity: 0.0008, fogBase: 18, fogFall: 0.008, sunGlow: 1,
    exposure: 1.1, sun: 1.3, hemi: 1.05, bloom: 0.3, shafts: 0.5, grade: [1.16, 1.12, 0.01, 0.002, 0, 1.05, 0.98, 0.9, 0.36],
  },
  points: POINTS,
  branches: [
    {
      // through the old mine: timber galleries under the mesa, ore carts crossing from lap 2
      name: 'Mine', from: 6, to: 10, odds: 0.5,
      points: [
        [380, 37, -410, T],
        [290, 38, -440, { ...T, pad: 0 }],
        [180, 39, -455, T],
        [80, 40, -450, T],
      ],
    },
    {
      // the railway: over the line and onto the track bed, east with the train.
      // Catch it, drive up the ramp wagon, along the flat cars and off the
      // kicker over the engine, with the train's speed on top of yours
      name: 'Railway', from: 1, to: 5, odds: 0.45,
      points: [
        [180, 15, -105, { w: 16 }],
        [207, 16, -152, { w: 16 }],
        [236, 16, -183.4, { w: 18, deck: 'wood' }],
        [300, 16, -181.8, { w: 18, deck: 'wood' }],
        [370, 16, -179.5, { w: 18, deck: 'wood' }],
        [440, 16, -176.1, { w: 18, deck: 'wood' }],
        [505, 16, -172.1, { w: 18, deck: 'wood' }],
        [565, 17, -182, { w: 18 }],
        [588, 20, -224, { w: 16 }],
        [545, 22, -262, { w: 16 }],
      ],
    },
    {
      // the slot the dynamite blasts through the canyon wall on lap 2
      name: 'Blast cut', from: 17, to: 21, odds: 0,
      points: [
        [-330, 16, -12, { w: 14 }],
        [-230, 15, 22, { w: 14 }],
      ],
    },
  ],
  ground(x, z) {
    // mesas in bands of rock, kept back from the valley floor
    const m = fbm2(x * 0.0052 + 2, z * 0.0052)
    const lift = smooth(0.46, 0.62, m)
    const bands = Math.floor(lift * 5) / 5 * 0.7 + lift * 0.3
    let h = 13 + fbm2(x * 0.018, z * 0.018) * 6 + bands * 100 + ridged2(x * 0.012, z * 0.012, 3) * 14 * lift
    // the big mesa the road climbs over (and the mine runs under)
    const md = Math.hypot(x - MESA.x, z - MESA.z)
    h = Math.max(h, THREE.MathUtils.lerp(14, MESA.h + fbm2(x * 0.02, z * 0.02) * 4, smooth(MESA.r + 60, MESA.r - 20, md)))
    // the canyon walls either side of the blast cut
    if (x > SLOT.x0 && x < SLOT.x1) h = Math.max(h, THREE.MathUtils.lerp(14, 58, smooth(70, 20, Math.abs(z - 5 + (x + 260) * 0.17))))
    // the railway bed is level
    h = THREE.MathUtils.lerp(RAIL_Y, h, smooth(10, 42, railDist(x, z)))
    // the gorge under the trestle
    if (z > GORGE.z0 && z < GORGE.z1) h = THREE.MathUtils.lerp(-4, h, smooth(GORGE.half * 0.4, GORGE.half, Math.abs(x - GORGE.x)) + smooth(GORGE.z0 + 40, GORGE.z0, z) + smooth(GORGE.z1 - 40, GORGE.z1, z))
    return h
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.42, 0.85, slope)
    const flat = 1 - rock
    const n = fbm2(x * 0.02, z * 0.02)
    mix[0] = flat * (1 - n)
    mix[1] = flat * n
    mix[2] = rock
    mix[3] = smooth(9, 3, roadDist) * flat
    const b = Math.sin(h * 0.42 + fbm2(x * 0.01, z * 0.01) * 5)
    tint.setRGB(1, 1, 1)
    if (rock > 0.1) tint.setRGB(1 + b * 0.16, 0.96 + b * 0.2, 0.92 + b * 0.28)
  },
  surfaceAt: () => 'sand',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Gold Rush Line', '#e8a03a')
    arrows(k, 0xffb040)
    mountainRing(root, 0, -200, { inner: 1400, outer: 3200, height: 480, rock: 0x8a5038, seed: 12 })
    const mine = c.branches[0]!, cut = c.branches[2]!
    westernTown(k)
    trestle(k)

    // townsfolk along the boardwalk
    const folk: [number, number, number, number][] = []
    for (let i = 4; i < c.count; i += 2) {
      const p = c.samples[i]!
      if (p.x < -20 || p.x > 400 || p.z < -90) continue
      const r = c.rights[i]!, t = c.tangents[i]!
      for (const s of [-1, 1]) {
        if (d.rand() < 0.45) continue
        const lat = s * (c.widths[i]! / 2 + 3.4 + d.rand() * 1.4)
        const x = p.x + r.x * lat + t.x * d.rand() * 3, z = p.z + r.z * lat + t.z * d.rand() * 3
        if (railDist(x, z) < 8 || d.roadGap(x, z) < 2 || c.all.some((q) => q.roadAt(x, z, w.terrainAt(x, z) + 3, { i: -1, lat: 0, y: 0 }))) continue
        folk.push([x, w.terrainAt(x, z), z, Math.atan2(r.x * s, r.z * s) * -1 + 1.57])
      }
    }
    crowd(k, folk, [0x7a4a30, 0x4a5a6a, 0x8a7a5a, 0x5a3a2a, 0xa89878, 0x3a3a3e])

    const open = (_x: number, _z: number, y: number) => y < 40
    const flat = (x: number, z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, z) - w.terrainAt(x - e, z), gz = w.terrainAt(x, z + e) - w.terrainAt(x, z - e)
      return Math.hypot(gx, gz) / (2 * e) < 0.35 && y > 2
    }
    d.prop('quiver_tree_01', d.spots(30, 6, 70, { clear: 6, test: open }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.8 + d.rand() * 1.4)), 0.5)
    d.prop('dead_tree_trunk', d.spots(30, 6, 60, { clear: 6, test: flat }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4 + d.rand())), 0.6)
    d.prop('namaqualand_boulder_02', d.spots(24, 8, 70, { clear: 8, test: flat }).map((s) => trs(s.x, s.y - 0.5, s.z, d.rand() * 6, 2 + d.rand() * 3)), 0.8)
    d.prop('namaqualand_boulders_01', d.spots(14, 10, 70, { clear: 9, test: flat }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2 + d.rand() * 2)), 0.8)
    d.prop('bk:namaqualand_boulder_03', d.spots(18, 8, 70, { clear: 8, test: (x, z, y) => open(x, z, y) && flat(x, z, y) }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 1.6 + d.rand() * 1.6)), 0.6)
    d.prop('bk:searsia_lucida', d.spots(50, 3, 45, { clear: 3, test: open }).map((s) => trs(s.x, s.y - 0.1, s.z, d.rand() * 6, 1.4 + d.rand() * 0.9)), 0.15)
    d.prop('wild_rooibos_bush', d.spots(60, 2, 30, { clear: 1.8 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4 + d.rand())))
    d.prop('wooden_barrels_01', d.spots(16, 2, 6, { from: 0.0, to: 0.12, clear: 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.2)), 0.9)
    d.prop('rusted_wheel_rim_01', d.spots(14, 3, 16, { clear: 2.5 }).map((s) => trs(s.x, s.y + 0.2, s.z, d.rand() * 6, 2, 0.8)))
    forest(k, 'dead', d.spots(40, 10, 90, { clear: 8, test: open }), { scale: [0.7, 1.2] })
    grass(k, { density: 1.6, reach: 18, height: [0.4, 0.9], colors: [0xc8a860, 0xb09050, 0xd8bc78, 0x9a8a50], test: open })
    crates(d, d.spots(12, 2, 7, { from: 0.85, to: 0.98, clear: 1.5 }), 0xc8a06a)
    mist(k, d.spots(14, 30, 200, { clear: 26 }).map((s) => s.setY(s.y + 5)), [90, 160], 0xf0b888, 0.1)

    const carts = mineGalleries(k, mine)
    railTrack(k, mine)
    const blast = blastCut(k, cut)
    const train = railway(k, c.branches[1]!)
    railSign(k, c.branches[1]!)
    gorgeSign(k)

    k.onFrame((f) => {
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      train(last ? 40 : 32, f.dt, f.time, f.player)
      carts(f.lap >= 2, f.time)
      blast(f.lap >= 2, f.dt)
      cut.join!.odds = f.lap >= 2 ? 0.7 : 0
    })
  },
}

/** Timber bents and bracing under a trestle bridge. */
function trestle(k: BuildKit): void {
  const { circuit: c, world: w } = k
  const m = new Mesher(), wood = 0x5a4029, dark = 0x45301f
  for (let i = 0; i < c.count; i += 7) {
    if (!c.raised[i] || c.gap[i] || c.tunnel[i]) continue
    const p = c.samples[i]!, r = c.rights[i]!, half = c.widths[i]! / 2
    const g = Math.min(w.terrainAt(p.x, p.z), p.y - 3)
    const h = p.y - g
    const foot = half + h * 0.16
    const at = (lat: number, y: number) => new THREE.Vector3(p.x + r.x * lat, y, p.z + r.z * lat)
    for (const s of [-1, -0.34, 0.34, 1]) m.bar(at(s * half * 0.96, p.y - 0.4), at(s * foot, g - 1), 0.34, wood, 5)
    for (let y = p.y - 7; y > g; y -= 8) {
      const u = (p.y - y) / h, wide = half + (foot - half) * u
      m.bar(at(-wide, y), at(wide, y), 0.2, dark, 4)
      m.bar(at(-wide, y), at(wide, y - 8), 0.13, dark, 4)
      m.bar(at(wide, y), at(-wide, y - 8), 0.13, dark, 4)
    }
    m.bar(at(-half - 1, p.y - 0.9), at(half + 1, p.y - 0.9), 0.3, wood, 4)
  }
  if (!m.empty) place(k, m, surface('wood'))
}

/** False-fronted timber buildings on the town side of main street, boardwalks and lit windows. */
function westernTown(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const names = ['SALOON', 'ASSAY', 'GENERAL', 'HOTEL', 'BANK', 'SHERIFF', 'MERCANTILE', 'BARBER', 'STABLES', 'GUNSMITH']
  const paints = [0x8a6a4a, 0x9a7a54, 0x7a5a3e, 0xa88a60, 0x6e5238, 0x8e4a34, 0x5a6a6a]
  const wood = new Mesher(), glass = new Mesher()
  const signs: { x: number; y: number; z: number; yaw: number; w: number; text: string }[] = []
  let n = 0
  const street = (p: THREE.Vector3) => (p.x > -40 && p.x < 400 && p.z > -90) || (p.x < -100 && p.x > -480 && p.z > 60)
  for (let i = 0; i < c.count; i += 11) {
    const p = c.samples[i]!
    if (!street(p)) continue
    const r = c.rights[i]!
    for (const side of [-1, 1]) {
      const half = c.widths[i]! / 2, lat = side * (half + 15)
      const x = p.x + r.x * lat, z = p.z + r.z * lat, y = w.terrainAt(x, z)
      if (d.roadGap(x, z) < 8 || railDist(x, z) < 24 || w.blocked(x, z, 9)) continue
      // only at street level: on a canyon rim a building hangs in the air over the road
      if (Math.abs(y - p.y) > 2.5) continue
      const W = 15 + d.rand() * 5, D = 12, H = 6 + d.rand() * 4, F = H + 2.5 + d.rand() * 2.5
      const yaw = Math.atan2(-r.x * side, -r.z * side)
      const cs = Math.cos(yaw), sn = Math.sin(yaw)
      const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs]
      const col = paints[Math.floor(d.rand() * paints.length)]!
      wood.box(W, H, D, x, y + H / 2, z, col, yaw)
      const [fx, fz] = at(0, D / 2 + 0.2)
      wood.box(W + 1, F, 0.4, fx, y + F / 2, fz, col, yaw)
      wood.box(W + 1.8, 0.4, 0.7, fx, y + F + 0.1, fz, 0x4a3524, yaw)
      const [px, pz] = at(0, D / 2 + 2.2)
      wood.box(W + 1, 0.3, 4, px, y + 3.7, pz, 0x4a3524, yaw)
      wood.box(W + 1.4, 0.3, 4.4, px, y + 0.4, pz, 0x6a4e34, yaw)
      for (const lx of [-W / 2, -W / 6, W / 6, W / 2]) {
        const [ax, az] = at(lx, D / 2 + 3.9)
        wood.box(0.26, 3.5, 0.26, ax, y + 1.95, az, 0x4a3524, yaw)
      }
      for (const lx of [-W * 0.3, W * 0.3]) {
        const [ax, az] = at(lx, D / 2 + 0.44)
        glass.box(2.4, 2, 0.06, ax, y + 2.3, az, 0xffc070, yaw)
        wood.box(2.8, 2.4, 0.04, ax, y + 2.3, az, 0x33241a, yaw)
      }
      const [dx, dz] = at(0, D / 2 + 0.42)
      wood.box(1.8, 2.9, 0.08, dx, y + 1.75, dz, 0x2a1c12, yaw)
      const [sx, sz] = at(0, D / 2 + 0.44)
      signs.push({ x: sx, y: y + F * 0.72, z: sz, yaw, w: W * 0.7, text: names[n++ % names.length]! })
      w.addBox(x, z, W / 2 + 0.5, D / 2 + 3.6, yaw)
    }
  }
  place(k, wood, surface('wood'))
  place(k, glass, glow(2.2, 1.5, 0.7), false)
  for (const s of signs) {
    const tex = canvasTexture(512, 96, (g, W, H) => {
      g.fillStyle = '#d8c8a4'
      g.fillRect(0, 0, W, H)
      g.strokeStyle = '#3a2413'
      g.lineWidth = 7
      g.strokeRect(6, 6, W - 12, H - 12)
      g.fillStyle = '#3a2413'
      g.font = '700 62px Georgia, "Times New Roman", serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(s.text, W / 2, H / 2 + 3, W - 40)
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w * 0.19), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
    m.position.set(s.x, s.y, s.z)
    m.rotation.y = s.yaw
    k.root.add(m)
  }
}

/** The mine: timber sets, boarded walls and a roof the whole way, lanterns, gold in the rock, ore carts. */
function mineGalleries(k: BuildKit, mine: Circuit): (on: boolean, t: number) => void {
  const { world: w, d, root } = k
  const frames = new Mesher(), lamps: THREE.Matrix4[] = [], flecks: THREE.Matrix4[] = []
  const probe = { i: -1, lat: 0, y: 0 }
  // nothing of the mine may stand over the main road where the two still overlap
  const overMain = (x: number, z: number, y: number) => k.circuit.roadAt(x, z, y + 12, probe) && probe.y < y + 12 && Math.abs(probe.lat) < k.circuit.widths[probe.i]! / 2 + 3
  let first = -1, last = -1
  for (let i = 0; i < mine.count; i++) if (mine.tunnel[i] && !overMain(mine.samples[i]!.x, mine.samples[i]!.z, mine.samples[i]!.y)) { if (first < 0) first = i; last = i }
  for (let i = 0; i < mine.count; i += 3) {
    if (!mine.tunnel[i] || i < first || i > last) continue
    const p = mine.samples[i]!, r = mine.rights[i]!, t = mine.tangents[i]!
    const half = mine.widths[i]! / 2 + 0.5, yaw = Math.atan2(t.x, t.z), H = 9
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * half, z = p.z + r.z * s * half
      frames.box(0.3, H + 1, 6.4, x + r.x * s * 0.5, p.y + H / 2, z + r.z * s * 0.5, 0x3e2c1c, yaw)
      // (no posts where the gallery still overlaps the main road at either end)
      const onMain = k.circuit.roadAt(x, z, p.y + 2, { i: -1, lat: 0, y: 0 })
      if (i % 6 === 0 && !onMain) { frames.box(0.7, H, 0.7, x, p.y + H / 2, z, 0x4a3422, yaw); w.addPost(x, z, 0.6, p.y + H) }
      if (i % 15 === 0) lamps.push(trs(x - r.x * s * 0.6, p.y + 6.4, z - r.z * s * 0.6, 0, 0.42))
      if (d.rand() < 0.5) flecks.push(trs(x - r.x * s * 0.2, p.y + 1 + d.rand() * 6, z - r.z * s * 0.2, d.rand() * 6, 0.1 + d.rand() * 0.14))
    }
    if (i % 6 === 0) frames.box(half * 2 + 1.4, 0.8, 0.8, p.x, p.y + H + 0.1, p.z, 0x4a3422, yaw)
    frames.box(half * 2 + 2.4, 0.4, 6.4, p.x, p.y + H + 0.7, p.z, 0x38281a, yaw)
  }
  // the portals: timber frames set into the rock face at each end
  for (const i of [first + 2, last - 2]) {
    const p = mine.samples[i]!, t = mine.tangents[i]!, half = mine.widths[i]! / 2 + 1.5, yaw = Math.atan2(t.x, t.z)
    frames.box(half * 2 + 6, 3, 1.4, p.x, p.y + 11, p.z, 0x4a3422, yaw)
    const r = mine.rights[i]!
    for (const s of [-1, 1]) frames.box(2, 12, 1.4, p.x + r.x * s * (half + 1), p.y + 5.5, p.z + r.z * s * (half + 1), 0x4a3422, yaw)
  }
  place(k, frames, surface('wood'))
  d.instanced(new THREE.BoxGeometry(1, 1.4, 1), glow(3.4, 2, 0.8), lamps, false)
  d.instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.6), toneMapped: false }), flecks, false)
  const pool = softDot()
  for (const m of lamps) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pool, color: 0xffa050, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }))
    s.position.setFromMatrixPosition(m)
    s.scale.setScalar(9)
    root.add(s)
  }
  // ore carts that roll across the gallery from side tunnels
  const cartGeo = new Mesher()
  cartGeo.box(2.4, 1.6, 3.4, 0, 1.4, 0, 0x5a4029).add(lumpy(new THREE.SphereGeometry(1, 10, 6), 0.2, 2, 3), trs(0, 2.4, 0, 0, new THREE.Vector3(1, 0.6, 1.4)), 0xb08a3a)
  for (const x of [-0.9, 0.9]) for (const z of [-1.1, 1.1]) cartGeo.add(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 10), trs(x, 0.5, z, 0, 1, 0, Math.PI / 2), 0x1a1a1c)
  const geo = cartGeo.build()
  const crossings = [0.3, 0.68].map((u, q) => {
    const i = Math.floor(mine.count * u), p = mine.samples[i]!, r = mine.rights[i]!, t = mine.tangents[i]!
    const m = new THREE.Mesh(geo, surface('wood'))
    m.rotation.y = Math.atan2(r.x, r.z)
    m.visible = false
    root.add(m)
    // a rail across the floor
    const rail = new THREE.Mesh(new THREE.BoxGeometry(mine.widths[i]! + 4, 0.1, 1.6), surface('metal'))
    rail.position.set(p.x, p.y + 0.06, p.z)
    rail.rotation.y = Math.atan2(-t.x, -t.z)
    root.add(rail)
    const solid: Solid = { x: 1e6, z: 1e6, r: 2, top: -1e6 }
    w.movers.push(solid)
    return { m, solid, p, r, half: mine.widths[i]! / 2 + 3, ph: q * 2.3 }
  })
  return (on, t) => {
    for (const cr of crossings) {
      cr.m.visible = on
      if (!on) { cr.solid.top = -1e6; continue }
      const lat = Math.sin(t * 0.55 + cr.ph) * cr.half
      cr.m.position.set(cr.p.x + cr.r.x * lat, cr.p.y, cr.p.z + cr.r.z * lat)
      cr.solid.x = cr.m.position.x
      cr.solid.z = cr.m.position.z
      cr.solid.top = cr.p.y + 3
    }
  }
}

/** The rock barrier across the slot: down on lap 1, blown open from lap 2. */
function blastCut(k: BuildKit, cut: Circuit): (open: boolean, dt: number) => void {
  const { world: w, root, d } = k
  const i = 10, p = cut.samples[i]!, r = cut.rights[i]!, t = cut.tangents[i]!
  const rock = new Mesher(), solids: Solid[] = []
  for (let q = -3; q <= 3; q++) {
    const lat = q * 2.4, x = p.x + r.x * lat, z = p.z + r.z * lat, s = 2.4 + d.rand() * 1.4
    rock.add(lumpy(new THREE.IcosahedronGeometry(1, 2), 0.24, 1.3, q + 9), trs(x, p.y + s * 0.7, z, d.rand() * 6, s), 0x9a5a3e)
    solids.push({ x, z, r: s * 0.9, top: 1e6 })
  }
  const pile = place(k, rock, surface('rock'))
  w.movers.push(...solids)
  // dynamite crates and a warning board
  const sign = canvasTexture(256, 96, (g, W, H) => {
    g.fillStyle = '#d8c8a4'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#8a1a12'; g.font = '700 40px Georgia, serif'; g.textAlign = 'center'; g.fillText('DANGER', W / 2, 42)
    g.font = '700 26px Georgia, serif'; g.fillText('BLASTING', W / 2, 78)
  })
  const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.9), new THREE.MeshStandardMaterial({ map: sign, side: THREE.DoubleSide }))
  board.position.set(p.x - t.x * 18 + r.x * 9, p.y + 3, p.z - t.z * 18 + r.z * 9)
  board.rotation.y = Math.atan2(t.x, t.z)
  root.add(board)
  const dot = softDot()
  const dust = Array.from({ length: 14 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xc89a6a, transparent: true, opacity: 0, depthWrite: false }))
    s.position.set(p.x + (d.rand() - 0.5) * 24, p.y + 3, p.z + (d.rand() - 0.5) * 24)
    root.add(s)
    return s
  })
  let blown = false, puff = 0
  return (open, dt) => {
    if (open && !blown) {
      blown = true
      puff = 1
      pile.visible = false
      for (const s of solids) s.top = -1e6
    }
    if (!open && blown) {
      blown = false
      pile.visible = true
      for (const s of solids) s.top = 1e6
    }
    if (puff > 0) {
      puff = Math.max(0, puff - dt * 0.25)
      dust.forEach((s, q) => { s.scale.setScalar(10 + (1 - puff) * 34 + q); s.material.opacity = puff * 0.55 })
    }
  }
}

/** The railway: sleepers and rails round the valley, crossing signals, and the train. */
function railway(k: BuildKit, bed: Circuit): (base: number, dt: number, time: number, player: THREE.Vector3) => void {
  const { circuit: c, world: w, d, root } = k
  const probe = { i: -1, lat: 0, y: 0 }
  // the rail top: on the ground, or on the road where the line runs along it
  const railY = (x: number, z: number): number => {
    let y = w.terrainAt(x, z)
    for (const p of c.all) if (p.roadAt(x, z, y + 4, probe)) y = Math.max(y, probe.y)
    return y
  }
  const sleepers: THREE.Matrix4[] = [], railSeg: THREE.Matrix4[] = []
  const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const STEPS = 900
  const onRoad = (x: number, z: number, y: number) => c.all.some((p) => p.roadAt(x, z, y + 4, { i: -1, lat: 0, y: 0 }))
  for (let q = 0; q < STEPS; q++) {
    railPoint((q / STEPS) * Math.PI * 2, a0)
    railPoint(((q + 1) / STEPS) * Math.PI * 2, a1)
    const y0 = railY(a0.x, a0.z) + 0.16, y1 = railY(a1.x, a1.z) + 0.16
    a0.y = y0; a1.y = y1
    const yaw = Math.atan2(a1.x - a0.x, a1.z - a0.z)
    if (!onRoad(a0.x, a0.z, y0)) sleepers.push(trs(a0.x, y0 - 0.06, a0.z, yaw, new THREE.Vector3(3, 0.16, 0.34)))
    for (const s of [-0.8, 0.8]) {
      const ox = Math.cos(yaw) * s, oz = -Math.sin(yaw) * s
      const mid = new THREE.Vector3((a0.x + a1.x) / 2 + ox, (y0 + y1) / 2 + 0.14, (a0.z + a1.z) / 2 + oz)
      const q4 = new THREE.Quaternion().setFromUnitVectors(up, a1.clone().sub(a0).normalize())
      railSeg.push(new THREE.Matrix4().compose(mid, q4, new THREE.Vector3(0.09, a0.distanceTo(a1) + 0.1, 0.09)))
    }
  }
  d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }), sleepers, false)
  d.instanced(new THREE.CylinderGeometry(1, 1, 1, 4), new THREE.MeshStandardMaterial({ color: 0x8a8880, metalness: 0.8, roughness: 0.35 }), railSeg, false)

  // crossing signals
  const crossings: THREE.Vector3[] = []
  for (let q = 0; q < STEPS; q++) {
    railPoint((q / STEPS) * Math.PI * 2, a0)
    a0.y = w.terrainAt(a0.x, a0.z)
    if (onRoad(a0.x, a0.z, a0.y) && !crossings.some((p) => p.distanceTo(a0) < 40)) crossings.push(a0.clone())
  }
  const signal = new Mesher(), bulbs: THREE.Matrix4[] = []
  for (const p of crossings) {
    const i = c.track(p.x, p.z, 0, c.count), r = c.rights[i]!
    for (const s of [-1, 1]) {
      const lat = s * (c.widths[i]! / 2 + 2)
      const x = p.x + r.x * lat, z = p.z + r.z * lat, y = w.terrainAt(x, z)
      if (c.all.some((q) => q.roadAt(x, z, y + 4, probe))) continue
      signal.post(0.12, 0.1, 5, x, y, z, 0x2a2a2c, 6)
      signal.box(2.6, 0.3, 0.1, x, y + 4.4, z, 0xe8e0d0, 0, 0.7)
      signal.box(2.6, 0.3, 0.1, x, y + 4.4, z, 0xe8e0d0, 0, -0.7)
      bulbs.push(trs(x + 0.5, y + 3.5, z, 0, 0.3), trs(x - 0.5, y + 3.5, z, 0, 0.3))
      w.addPost(x, z, 0.3)
    }
  }
  if (!signal.empty) place(k, signal, surface('paint'), false)
  const bulbMat = glow(0.3, 0.02, 0.02)
  if (bulbs.length) d.instanced(new THREE.SphereGeometry(1, 8, 6), bulbMat, bulbs, false)

  // the train: the engine, then a car-carrier rake you can drive on. From
  // the front: a kicker wagon, flat wagons, and a ramp wagon at the back.
  const parts = engine()
  const loco = new THREE.Group()
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, into: THREE.Group): void => {
    const m = new THREE.Mesh(g, mat)
    m.castShadow = true
    into.add(m)
  }
  add(parts.loco.build(), surface('wood'), loco)
  add(parts.black.build(), surface('metal', { rough: 0.42 }), loco)
  add(parts.brass.build(), surface('metal', { rough: 0.25, metal: 0.9 }), loco)
  type Wagon = { o: THREE.Object3D; solid: Solid | null; deck: Platform | null; off: number; y0: number; y1: number; top: number }
  const cars: Wagon[] = []
  const addCar = (o: THREE.Object3D, off: number, half: number, y0: number, y1: number, top: number, hx: number): void => {
    o.traverse((q) => { q.frustumCulled = false })
    root.add(o)
    let solid: Solid | null = null
    // (top below zero: no solid while the wagon can be driven on, a wall otherwise)
    if (top !== 0) { solid = { x: 0, z: 0, r: half + 3, hx, hz: half, cos: 1, sin: 0, top }; w.movers.push(solid) }
    let deck: Platform | null = null
    if (y1 > 0) { deck = { x: 0, z: 0, hx: y0 < 1 ? 4.6 : 3.2, hz: half + 0.25, cos: 1, sin: 0, y0, y1, vx: 0, vz: 0, live: true }; w.platforms.push(deck) }
    cars.push({ o, solid, deck, off, y0, y1, top })
  }
  // the engine is solid up to its boiler top, so a car flying over clears it
  addCar(loco, 0, 7, 0, 0, 5.6, 1.7)
  const L = 12, DECK = 2.4, KICK = 5.4
  addCar(carrier(0), 13.6, 5.8, DECK, KICK, 1.2, 3.2)
  cars[cars.length - 1]!.deck!.kick = true
  for (let q = 1; q <= 4; q++) addCar(carrier(1), 13.6 + q * L, 5.8, DECK, DECK, 1.2, 3.2)
  addCar(carrier(2), 13.6 + 5 * L, 5.8, 0.35, DECK, -1, 3.2)
  const TAIL = 13.6 + 5 * L + 6
  const puffs: { s: THREE.Sprite; t: number; x: number; y: number; z: number }[] = []
  const dot = softDot()
  for (let q = 0; q < 24; q++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x5a5854, transparent: true, opacity: 0, depthWrite: false }))
    root.add(s)
    puffs.push({ s, t: 9, x: 0, y: 0, z: 0 })
  }
  const circum = Math.PI * Math.sqrt(2 * (RX * RX + RZ * RZ))
  const TAU = Math.PI * 2
  const angleOf = (x: number, z: number): number => Math.atan2((z - CZ) / RZ, x / RX)
  // where the drivable stretch of line starts
  const bedStart = bed.samples[Math.floor(bed.count * 0.3)]!
  const aStart = angleOf(bedStart.x, bedStart.z)
  const N = c.count, metre = c.length / N
  let a = aStart - 0.9, speed = 32, puffT = 0, puffN = 0
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3()
  return (base, dt, time, player) => {
    // pacing: while you are on your way to the line, the train makes sure
    // its tail is just ahead of you when you get there
    let want = base
    const pi = c.track(player.x, player.z, 0, N)
    const toFork = ((bed.join!.from - pi + N) % N) * metre
    const pa = angleOf(player.x, player.z)
    const tail = a - (TAIL / circum) * TAU
    // already on the track bed behind the train: it eases off so you can catch it
    let behind = ((tail - pa) % TAU + TAU) % TAU
    if (behind > Math.PI) behind -= TAU
    const onBranch = bed.roadAt(player.x, player.z, player.y + 2, probe)
    if (onBranch) {
      // on the way to the train or on the track bed: hold back while you're behind it
      if (behind > 0 && behind * circum / TAU < 300) want = Math.min(base, 22)
    }
    else if (toFork > 20 && toFork < c.length - 60) {
      // all the way round the lap: aim to be there when you are
      const t = (toFork + 150) / (toFork > 650 ? 50 : 44)
      // metres the tail still has to go to reach the start of the track bed
      const gap = (((aStart - tail) % TAU + TAU) % TAU / TAU) * circum
      // just past it already: dawdle so you catch it, if you can; else go round again
      const past = circum - gap
      want = past + 12 * t < 200 ? 12 : THREE.MathUtils.clamp((gap + 20) / t, 12, 55)
    }
    speed += (want - speed) * Math.min(1, dt * 0.6)
    root.userData['train'] = { speed, want, toFork, tailX: cars[cars.length - 1]!.o.position.x, tailZ: cars[cars.length - 1]!.o.position.z, headX: cars[0]!.o.position.x }
    a = (a + (speed / circum) * TAU * dt) % TAU
    for (const car of cars) {
      const u = a - (car.off / circum) * TAU
      railPoint(u, pos)
      railPoint(u + 0.004, ahead)
      const y = railY(pos.x, pos.z) + 0.2
      const yaw = Math.atan2(ahead.x - pos.x, ahead.z - pos.z)
      car.o.position.set(pos.x, y, pos.z)
      car.o.rotation.y = yaw
      // the wagons can only be driven on along the track bed; anywhere else the train is a wall
      const rideable = bed.roadAt(pos.x, pos.z, y + 2, probe) && probe.i > 4 && probe.i < bed.count * 0.82
      if (car.deck) car.deck.live = rideable
      if (car.solid) {
        car.solid.x = pos.x; car.solid.z = pos.z
        car.solid.cos = Math.cos(yaw); car.solid.sin = Math.sin(yaw)
        car.solid.top = rideable ? y + car.top : 1e6
      }
      if (car.deck) {
        const dk = car.deck
        dk.x = pos.x; dk.z = pos.z
        dk.cos = Math.cos(yaw); dk.sin = Math.sin(yaw)
        dk.y0 = y + car.y0; dk.y1 = y + car.y1
        dk.vx = Math.sin(yaw) * speed; dk.vz = Math.cos(yaw) * speed
      }
    }
    let warn = false
    railPoint(a, pos)
    for (const p of crossings) if (Math.hypot(p.x - pos.x, p.z - pos.z) < 200) warn = true
    const on = warn && Math.sin(time * 9) > 0
    bulbMat.color.setRGB(on ? 4 : 0.25, on ? 0.3 : 0.02, on ? 0.2 : 0.02)
    puffT -= dt
    if (puffT <= 0) {
      puffT = 0.13
      const p = puffs[puffN++ % puffs.length]!, l = cars[0]!.o
      p.x = l.position.x + Math.sin(l.rotation.y) * 5.4
      p.z = l.position.z + Math.cos(l.rotation.y) * 5.4
      p.y = l.position.y + 8
      p.t = 0
    }
    for (const p of puffs) {
      p.t += dt
      const m = p.s.material
      if (p.t > 3) { m.opacity = 0; continue }
      p.s.position.set(p.x, p.y + p.t * 3.4, p.z)
      p.s.scale.setScalar(2.4 + p.t * 4.4)
      m.opacity = 0.5 * (1 - p.t / 3)
    }
  }
}

/**
 * A car-carrier wagon, 6.4 m wide so a kart fits on it: kind 0 is the front
 * kicker (the deck rises to launch you over the engine), 1 a flat car, 2 the
 * ramp at the back you drive up from the track bed.
 */
function carrier(kind: number): THREE.Group {
  const g = new THREE.Group()
  const m = new Mesher(), stripes = new Mesher()
  const H = 5.8
  for (const z of [-4, 4]) for (const s of [-1, 1]) m.add(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 14), trs(s * 1.25, 0.65, z, 0, 1, 0, Math.PI / 2), 0x1a1a1c)
  m.box(2.8, 0.6, H * 2, 0, 1.3, 0, 0x26272a)
  const y0 = kind === 2 ? 0.35 : 2.4, y1 = kind === 0 ? 5.4 : 2.4
  // the deck, tilted to run from y0 at the back to y1 at the front
  const len = Math.hypot(H * 2, y1 - y0), pitch = Math.atan2(y1 - y0, H * 2)
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, 0))
  m.add(new THREE.BoxGeometry(kind === 2 ? 9.2 : 6.4, 0.4, len), new THREE.Matrix4().compose(new THREE.Vector3(0, (y0 + y1) / 2 - 0.2, 0), tilt, new THREE.Vector3(1, 1, 1)), 0x6a4a2e)
  // supports under a sloping deck
  if (kind !== 1) for (const z of [-3, 0, 3]) {
    const top = y0 + (y1 - y0) * ((z + H) / (H * 2))
    if (top > 1.8) for (const s of [-1, 1]) m.box(0.3, top - 1.6, 0.3, s * 2.6, 1.6 + (top - 1.6) / 2, z, 0x3a3a3c)
  }
  // yellow edges, so you can read it at speed
  for (const s of [-1, 1]) stripes.add(new THREE.BoxGeometry(0.3, 0.3, len), new THREE.Matrix4().compose(new THREE.Vector3(s * (kind === 2 ? 4.5 : 3.1), (y0 + y1) / 2 + 0.05, 0), tilt, new THREE.Vector3(1, 1, 1)), 0xe8b020)
  if (kind === 0) stripes.box(6.4, 0.5, 0.4, 0, y1 + 0.05, H - 0.2, 0xe8b020)
  // painted chevrons pointing forward, so the way on reads at a glance
  for (const z of [-2.6, 2.6]) {
    const y = y0 + (y1 - y0) * ((z + H) / (H * 2)) + 0.03
    for (const s of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, s * 0.7, 0, 'YXZ'))
      stripes.add(new THREE.BoxGeometry(0.5, 0.06, 2.6), new THREE.Matrix4().compose(new THREE.Vector3(s * 0.85, y, z - 0.6), q, new THREE.Vector3(1, 1, 1)), 0xffc030)
    }
  }
  const a = new THREE.Mesh(m.build(), surface('wood', { rough: 0.8 }))
  const b = new THREE.Mesh(stripes.build(), surface('paint', { rough: 0.4 }))
  a.castShadow = true
  g.add(a, b)
  return g
}

/** A striped beam at the broken end of the trestle. */
function gorgeSign(k: BuildKit): void {
  const { circuit: c } = k
  const m = new Mesher()
  for (let i = 1; i < c.count; i++) {
    if (!(c.gap[i] && !c.gap[i - 1])) continue
    const p = c.samples[i - 1]!, t = c.tangents[i - 1]!
    m.box(c.widths[i - 1]! + 1, 1.6, 1.2, p.x, p.y - 1, p.z, 0x5a4029, Math.atan2(-t.x, -t.z))
    m.box(c.widths[i - 1]! + 1, 0.25, 1.3, p.x, p.y - 0.1, p.z, 0xe8a03a, Math.atan2(-t.x, -t.z))
  }
  if (!m.empty) place(k, m, surface('paint'))
}

/** A steam engine and its train, built along +z. */
function engine(): { loco: Mesher; black: Mesher; brass: Mesher } {
  const loco = new Mesher(), black = new Mesher(), brass = new Mesher()
  const boiler = new THREE.CylinderGeometry(1.5, 1.5, 8.4, 18)
  black.add(boiler, trs(0, 3.2, 2.6, 0, 1, Math.PI / 2), 0x1e1f22)
  black.add(new THREE.CylinderGeometry(1.56, 1.56, 0.5, 18), trs(0, 3.2, 6.9, 0, 1, Math.PI / 2), 0x2a2b2e)
  black.add(new THREE.CylinderGeometry(0.72, 0.42, 2.8, 12), trs(0, 5.8, 5.4), 0x16171a)
  black.add(new THREE.CylinderGeometry(1, 0.7, 0.8, 12), trs(0, 7.4, 5.4), 0x16171a)
  brass.add(new THREE.SphereGeometry(0.7, 12, 8), trs(0, 5, 2.6), 0xb08a3a)
  brass.add(new THREE.CylinderGeometry(0.34, 0.42, 0.9, 10), trs(0, 5.1, 0.2), 0xb08a3a)
  brass.add(new THREE.CylinderGeometry(0.46, 0.46, 0.6, 12), trs(0, 3.4, 7.3, 0, 1, Math.PI / 2), 0xffe0a0)
  for (const z of [-0.8, 1.4, 3.6, 5.8]) for (const s of [-1, 1]) {
    black.add(new THREE.CylinderGeometry(1, 1, 0.3, 18), trs(s * 1.3, 1, z, 0, 1, 0, Math.PI / 2), 0x7a2a22)
  }
  for (const s of [-1, 1]) black.box(0.2, 0.3, 6.6, s * 1.5, 1.2, 2.5, 0x9a9a9a)
  black.box(3.2, 0.6, 12, 0, 1.55, 1.6, 0x26272a)
  // cab and cowcatcher
  loco.box(3.4, 3.4, 3.4, 0, 3.8, -3.1, 0x6a2a22)
  black.box(3.8, 0.3, 4, 0, 5.6, -3.1, 0x1e1f22)
  black.add(new THREE.ConeGeometry(1.8, 2.4, 4), trs(0, 1.1, 8.5, Math.PI / 4, 1, Math.PI / 2 * 0.9), 0x7a2a22)
  // brass bands round the boiler, a bell, a headlamp box on the smokebox
  for (const z of [-0.6, 1.6, 3.8, 6]) brass.add(new THREE.CylinderGeometry(1.54, 1.54, 0.16, 18), trs(0, 3.2, z, 0, 1, Math.PI / 2), 0xb08a3a)
  brass.add(new THREE.CylinderGeometry(0.22, 0.4, 0.5, 10), trs(0, 4.95, 4.1), 0xc8a048)
  black.box(0.9, 0.8, 0.8, 0, 5, 7.1, 0x1e1f22)
  brass.box(0.6, 0.5, 0.06, 0, 5, 7.52, 0xfff0c0)
  // running boards and a handrail along each side, coupling rods on the drivers
  for (const s of [-1, 1]) {
    black.box(0.5, 0.12, 9.4, s * 1.75, 2.05, 2.6, 0x26272a)
    brass.box(0.06, 0.06, 7.4, s * 1.62, 3.9, 2.6, 0xb08a3a)
    black.box(0.12, 0.22, 6.8, s * 1.62, 1.0, 2.5, 0xb0b0b4)
    for (const z of [-0.8, 1.4, 3.6, 5.8]) brass.add(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 10), trs(s * 1.48, 1, z, 0, 1, 0, Math.PI / 2), 0xb08a3a)
  }
  // the cab: windows, a curved roof overhang, a whistle
  for (const s of [-1, 1]) black.box(0.06, 1.1, 1.4, s * 1.72, 4.6, -3.1, 0x0c0d10)
  black.box(2.4, 1, 0.06, 0, 4.6, -1.38, 0x0c0d10)
  black.add(new THREE.CylinderGeometry(2.1, 2.1, 4.2, 16, 1, false, -0.7, 1.4), trs(0, 3.95, -3.1, 0, 1, -Math.PI / 2), 0x1e1f22)
  brass.add(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8), trs(0, 6.2, -1.6), 0xc8a048)
  return { loco, black, brass }
}

function wagon(kind: number): Mesher {
  const m = new Mesher()
  m.box(3, 0.5, 10.6, 0, 1.5, 0, 0x26272a)
  for (const z of [-3.4, 3.4]) for (const s of [-1, 1]) m.add(new THREE.CylinderGeometry(0.62, 0.62, 0.26, 14), trs(s * 1.25, 0.65, z, 0, 1, 0, Math.PI / 2), 0x1a1a1c)
  if (kind === 0) {
    // open ore wagon, heaped
    m.box(3, 1.8, 10.2, 0, 2.7, 0, 0x5a4029)
    m.add(lumpy(new THREE.SphereGeometry(1, 12, 8), 0.2, 2.2, 3), trs(0, 3.4, 0, 0, new THREE.Vector3(1.4, 1, 4.8)), 0xb08a3a)
  } else {
    m.box(3.1, 3.3, 10.2, 0, 3.4, 0, kind === 1 ? 0x7a2e24 : 0x6a5a3a)
    m.add(new THREE.CylinderGeometry(1.9, 1.9, 10.2, 12, 1, false, 0, Math.PI), trs(0, 4.7, 0, 0, new THREE.Vector3(0.86, 0.3, 1), Math.PI / 2), 0x3a3a3c)
  }
  return m
}

/** A board where the railway branch leaves: catch the train. */
function railSign(k: BuildKit, bed: Circuit): void {
  const { world: w, root } = k
  const i = Math.floor(bed.count * 0.06), p = bed.samples[i]!, r = bed.rights[i]!, t = bed.tangents[i]!
  const side = bed.widths[i]! / 2 + 3, x = p.x + r.x * side, z = p.z + r.z * side, y = w.terrainAt(x, z)
  const tex = canvasTexture(512, 256, (g, W, H) => {
    g.fillStyle = '#2a1a10'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#e8b020'; g.fillRect(8, 8, W - 16, H - 16)
    g.fillStyle = '#2a1a10'; g.textAlign = 'center'
    g.font = '900 64px "Barlow Condensed", Arial, sans-serif'; g.fillText('CATCH THE', W / 2, 100)
    g.font = '900 92px "Barlow Condensed", Arial, sans-serif'; g.fillText('TRAIN', W / 2, 196)
  })
  const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }))
  board.position.set(x, y + 5.5, z)
  board.rotation.y = Math.atan2(t.x, t.z) + Math.PI
  root.add(board)
  const m = new Mesher()
  for (const s of [-1, 1]) m.post(0.18, 0.18, 7.5, x + t.z * s * 3, y, z - t.x * s * 3, 0x3a2a1a, 6)
  place(k, m, surface('wood'))
  w.addPost(x, z, 1)
}
