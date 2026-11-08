import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import { arrows, crates, gantry, glow, stands } from './parts'

/*
 * Cosmos Bay, as a journey round a bay. Start on the seafront promenade,
 * climb through the hillside town onto the headland and past the lighthouse,
 * then out over the water on the tall cable-stayed bridge to the island. Jump
 * the cove on the island's crest, come back across the low causeway with the
 * waves breaking over it, along the east cliffs, and home past the harbour:
 * round the basin, or off the end of the pier, which only a boost clears.
 *
 * Lap 2: the wind gets up (a crosswind on the bridge and the causeway) and
 * waves start washing over the causeway. Last lap: a storm swell, spray
 * everywhere, and the causeway is half under water.
 */

const blob = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => 1 - Math.hypot((x - cx) / rx, (z - cz) / rz)
const BASIN = { x: 285, z: -55, r: 75 }
const COVE = { x: -24, z: -738, r: 30 }

function landform(x: number, z: number): number {
  const town = blob(x, z, -10, 170, 460, 240), head = blob(x, z, -420, -170, 165, 340), isle = blob(x, z, -20, -690, 270, 135), east = blob(x, z, 440, -220, 140, 360)
  const m = Math.max(town, head, isle, east)
  const land = smooth(-0.1, 0.22, m)
  const hills = smooth(0.1, 0.9, town) * smooth(-20, 300, z) * 55 + smooth(0.1, 0.8, head) * 30 + smooth(0.1, 0.8, isle) * 26 + smooth(0.1, 0.8, east) * 24
  let h = -16 + 22 * land + hills
  const b = Math.hypot(x - BASIN.x, z - BASIN.z)
  if (b < BASIN.r) h = Math.min(h, -16 + (h + 16) * smooth(BASIN.r * 0.55, BASIN.r, b))
  const cv = Math.hypot(x - COVE.x, z - COVE.z)
  if (cv < COVE.r * 1.8) h = THREE.MathUtils.lerp(-10, h, smooth(COVE.r * 0.8, COVE.r * 1.8, cv))
  return h
}

const POINTS: TrackPoint[] = [
  // 0: the seafront promenade, heading west along the shore
  [160, 5, -14],
  [40, 5, -30, { pad: -4 }],
  [-80, 5, -28, { items: true }],
  // 3: up through the old town onto the headland
  [-200, 8, -10],
  [-262, 16, 40],
  [-335, 25, 30],
  [-400, 32, -40],
  [-432, 36, -140, { items: true }],
  // 8: past the lighthouse, to the north tip
  [-462, 40, -260],
  [-445, 41, -360, { pad: 0 }],
  // 10: the bridge: up over the open water and down onto the island
  [-390, 50, -462, { raised: true, rail: 'LR' }],
  [-320, 60, -540, { raised: true, rail: 'LR' }],
  [-250, 56, -600, { raised: true, rail: 'LR' }],
  [-175, 46, -660, { raised: true, rail: 'LR' }],
  // 14: across the island's crest, and the jump over the cove
  [-110, 34, -705, { items: true }],
  [-62, 30, -728],
  [-24, 33, -738, { gap: true }],
  [12, 26, -746],
  [70, 26, -735],
  [130, 24, -705, { pad: 0 }],
  [185, 16, -660],
  // 21: the low causeway back to the east shore
  [240, 5, -600, { raised: true, rail: 'LR' }],
  [320, 5, -520, { raised: true, items: true, rail: 'LR' }],
  [385, 8, -450],
  // 24: along the east cliffs
  [432, 16, -360],
  [452, 22, -260],
  [422, 18, -160, { pad: 0 }],
  [362, 9, -90], // 27: the pier leaves here
  // 28: round the harbour basin and home
  [350, 6, 0],
  [270, 5, 42],
  [205, 5, 12],
]

export const bay: TrackDef = {
  id: 'bay',
  name: 'Cosmos Bay',
  ambience: 'coast',
  width: 18,
  bank: 3.2,
  shoulder: 24,
  accent: 0xff8a3c,
  sea: 0,
  water: { deep: 0x063a66, shallow: 0x1fa7a8, waves: 0.7 },
  road: { lines: 'circuit', grime: 0x8a7a62, kerbColors: [0xc42b22, 0xece8e0] },
  terrain: { layers: ['grass', 'coast_sand_01', 'rock_pitted_mossy', 'aerial_sand'], tile: [26, 12, 34, 30], tints: [0xc8d29a, 0xffffff, 0xe0d6c4, 0xf0dcb6] },
  look: {
    tod: 'midday', fog: [0.72, 0.82, 0.92], fogDensity: 0.00026, fogBase: 0, fogFall: 0.008, sunGlow: 0.55,
    exposure: 0.96, sun: 1.1, hemi: 1, bloom: 0.2, shafts: 0.28, grade: [1.14, 1.1, 0, 0, 0.004, 1.03, 1.0, 0.97, 0.3],
  },
  points: POINTS,
  branches: [
    {
      // off the end of the fishing pier and over the harbour mouth: a boost
      // (or nitro, or a drift boost) carries you across; flat out isn't enough
      name: 'Pier jump', from: 27, to: 0, odds: 0.35,
      points: [
        [345, 6, -86, { raised: true, deck: 'wood', w: 13, pad: 0 }],
        [318, 8.5, -80, { raised: true, deck: 'wood', w: 13 }],
        [300, 11, -76, { raised: true, gap: true, w: 13 }],
        [270, 8, -68, { raised: true, gap: true, w: 13 }],
        [244, 6.5, -63, { raised: true, w: 16 }],
        [205, 5, -40, { w: 16 }],
      ],
    },
  ],
  ground(x, z) {
    return landform(x, z) + fbm2(x * 0.012, z * 0.012) * 8 * smooth(4, 20, landform(x, z))
  },
  splat(_x, _z, h, slope, roadDist, mix, tint) {
    const beach = 1 - smooth(1.8, 4.4, h)
    const rock = smooth(0.5, 0.95, slope)
    mix[0] = (1 - beach) * (1 - rock)
    mix[1] = beach
    mix[2] = rock
    mix[3] = (1 - beach) * smooth(9, 3, roadDist) * 0.8
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: (x, z) => (landform(x, z) < 4 ? 'sand' : 'grass'),
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Cosmos Bay', '#ff8a3c')
    stands(k, 8, 50, 1, [0xd8462e, 0xe8e6e0, 0x2f7fb0, 0xd9a62e, 0x2a2e38, 0x5a8a5a], 0xff8a3c, 'Cosmos Bay Grand Prix')
    arrows(k, 0xffa040)
    mountainRing(root, 0, -300, { inner: 1500, outer: 3600, height: 420, rock: 0x6a7a78, seed: 4 })

    buildTown(k)
    buildHarbour(k, c.branches[0]!)
    buildBridge(k)
    buildIsland(k)
    const beacon = lighthouse(k, -528, -250)

    // trees and ground cover: olives and oaks on the hills, pines on the headland and the island
    const dry = (_x: number, _z: number, y: number) => y > 5
    forest(k, 'oak', d.spots(160, 14, 140, { clear: 9, test: dry }), { scale: [0.6, 1], tints: [0xcfe0a0, 0xbcd490, 0xdce8b4] })
    forest(k, 'pine', d.spots(140, 20, 220, { clear: 12, test: (_x, _z, y) => y > 14 }), { scale: [0.7, 1.05], tints: [0xd0e0c0] })
    forest(k, 'oak', d.spots(120, 120, 320, { clear: 30, test: dry }), { scale: [0.8, 1.2], solid: 0, tints: [0xcfe0a0, 0xbcd490] })
    grass(k, { density: 3.2, reach: 24, height: [0.5, 1.05], colors: [0xa8b870, 0x96aa60, 0xbcc484, 0xc4b878], test: (_x, _z, y) => y > 3.4 })
    const flat = (lim: number) => (x: number, z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, z) - w.terrainAt(x - e, z), gz = w.terrainAt(x, z + e) - w.terrainAt(x, z - e)
      return Math.hypot(gx, gz) / (2 * e) < lim && y > 1.5
    }
    d.prop('rock_07', d.spots(30, 6, 44, { clear: 6, test: flat(0.35) }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 2 + d.rand() * 3)), 0.8)
    d.prop('bk:island_tree_01', d.spots(22, 8, 50, { clear: 7, test: (x, z, y) => y > 5 && flat(0.4)(x, z, y) }).map((s) => trs(s.x, s.y - 0.2, s.z, d.rand() * 6, 1.4 + d.rand() * 0.6)), 0.2)
    d.prop('bk:island_tree_02', d.spots(14, 10, 60, { clear: 8, test: (x, z, y) => y > 8 && flat(0.4)(x, z, y) }).map((s) => trs(s.x, s.y - 0.2, s.z, d.rand() * 6, 1.3 + d.rand() * 0.5)), 0.2)
    d.prop('shrub_02', d.spots(40, 2, 26, { clear: 2.4, test: dry }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.2 + d.rand())))
    // shore: rock shelves and scattered stones where land meets water
    const shore: THREE.Vector3[] = []
    for (let t = 0; t < 4000 && shore.length < 40; t++) {
      const x = -650 + d.rand() * 1250, z = -900 + d.rand() * 1100, y = w.terrainAt(x, z)
      if (y > -1.2 && y < 1 && d.roadGap(x, z) > 14 && !shore.some((o) => Math.hypot(o.x - x, o.z - z) < 30)) shore.push(new THREE.Vector3(x, y, z))
    }
    d.prop('bk:coast_rocks_01', shore.map((s) => trs(s.x, s.y - 1.2, s.z, d.rand() * 6, 0.22 + d.rand() * 0.14)), 0, undefined, 520)
    d.prop('bk:sand_rocks_small_01', d.spots(24, 4, 30, { clear: 4, test: (_x, _z, y) => y < 3.5 && y > 0.4 }).map((s) => trs(s.x, s.y - 0.1, s.z, d.rand() * 6, 0.8 + d.rand() * 0.6)))

    // the bay: sailing boats rocking at anchor, a tall ship further out
    const hull = new Mesher()
    hull.add(new THREE.CylinderGeometry(1.2, 0.5, 9, 10, 1), trs(0, 0.6, 0, 0, new THREE.Vector3(1, 1, 0.42), Math.PI / 2), 0xf0eee8)
    hull.box(0.14, 11, 0.14, 0, 6.2, 0.3, 0x8a8a8a)
    const sail = new THREE.BufferGeometry()
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.6, 0.4, 0, 11, 0.4, 0, 1.6, 4, 0, 1.6, 0.2, 0, 10, 0.2, 0, 1.6, -3], 3))
    sail.computeVertexNormals()
    hull.add(sail, new THREE.Matrix4(), 0xf4f0e6)
    const boats: THREE.Matrix4[] = []
    for (let q = 0; q < 40 && boats.length < 22; q++) {
      const x = -260 + d.rand() * 600, z = -560 + d.rand() * 440
      if (d.roadGap(x, z) > 24 && w.terrainAt(x, z) < -6) boats.push(trs(x, 0.2, z, d.rand() * 6.28, 1, 0, 0.1))
    }
    d.instanced(hull.build(), surface('paint', { double: true }), boats)
    d.prop('bk:dutch_ship_large_01', [trs(40, -1.2, -380, 2.2, 1.3)], 0, undefined, 0)
    d.prop('ocean_buoy', [trs(-120, 0, -300, 0, 1.6), trs(120, 0, -250, 1, 1.6), trs(-30, 0, -460, 2, 1.6), trs(200, 0, -420, 2, 1.6)])

    // ── lap changes: wind, waves over the causeway, a storm swell on the last lap
    const spray: THREE.Sprite[] = []
    const dot = softDot()
    for (let q = 0; q < 30; q++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xf2faff, transparent: true, depthWrite: false, opacity: 0 }))
      root.add(s)
      spray.push(s)
    }
    const causeway: number[] = []
    for (let i = 0; i < c.count; i++) if (c.raised[i] && c.samples[i]!.y < 8) causeway.push(i)
    const sprayAt = spray.map((_, q) => {
      const i = causeway[Math.floor((q / spray.length) * causeway.length)] ?? 0
      const p = c.samples[i]!, r = c.rights[i]!, s = q % 2 ? 1 : -1
      return new THREE.Vector3(p.x + r.x * s * (c.widths[i]! / 2 + 3), 1, p.z + r.z * s * (c.widths[i]! / 2 + 3))
    })
    const wash = [0.2, 0.5, 0.8].map((u) => {
      const i = causeway[Math.floor(u * causeway.length)] ?? 0, p = c.samples[i]!
      return { x: p.x, z: p.z, r: 16, surface: 'mud' as const, on: false }
    })
    w.patches.push(...wash)
    const sheetMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f0, transparent: true, opacity: 0, roughness: 0.05, depthWrite: false })
    const sheets = wash.map((p) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), sheetMat)
      m.rotation.x = -Math.PI / 2
      m.position.set(p.x, 5.12, p.z)
      m.scale.set(13, 9, 1)
      root.add(m)
      return m
    })
    void sheets
    k.onFrame((f) => {
      const power = (f.lap - 1) / Math.max(1, f.totalLaps - 1)
      if (k.water) k.water.swell.value = 0.7 + power * 1.1
      const windy = f.lap >= 2
      w.wind.x = windy ? Math.sin(f.time * 0.4) * (2 + power * 3) : 0
      w.wind.z = windy ? 1.2 + power * 1.5 : 0
      spray.forEach((s, q) => {
        const u = (f.time * 0.5 + q * 0.37) % 1, b = sprayAt[q]!
        s.position.set(b.x, b.y + u * (4 + power * 16), b.z)
        s.scale.setScalar(5 + u * (6 + power * 12))
        s.material.opacity = (0.12 + power * 0.5) * (1 - u)
      })
      for (const p of wash) p.on = f.lap >= 2
      sheetMat.opacity = f.lap >= 2 ? 0.25 + power * 0.35 + Math.sin(f.time * 2) * 0.08 : 0
      k.road.wet.value = 0.05 + power * 0.4
      beacon.rotation.y = f.time
    })
  },
}

/** A whitewashed house with a terracotta roof, shutters and a little balcony. */
function villa(m: Mesher, roofs: Mesher, x: number, y: number, z: number, yaw: number, w: number, d: number, floors: number, rand: () => number): void {
  const wall = [0xf0e6d4, 0xeadcc2, 0xf4eee2, 0xe8cfae, 0xdcb48c][Math.floor(rand() * 5)]!
  const H = floors * 3.3, c = Math.cos(yaw), s = Math.sin(yaw)
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c]
  m.box(w, H + 2, d, x, y + H / 2 - 1, z, wall, yaw)
  m.box(w + 0.3, 0.3, d + 0.3, x, y + H, z, 0xd8ccb6, yaw)
  for (let f = 0; f < floors; f++) for (let q = 0; q < Math.floor(w / 2.8); q++) {
    const lx = -w / 2 + 1.6 + q * 2.8, wy = y + 1.8 + f * 3.3
    const [ax, az] = at(lx, d / 2 + 0.04)
    m.box(1, 1.5, 0.08, ax, wy, az, 0x1f2a33, yaw)
    const shutter = rand() < 0.5 ? 0x2d6a8a : 0x3f7a5a
    for (const e of [-1, 1]) {
      const [bx, bz] = at(lx + e * 0.78, d / 2 + 0.08)
      m.box(0.46, 1.55, 0.06, bx, wy, bz, shutter, yaw)
    }
    if (f > 0 && rand() < 0.3) {
      const [bx, bz] = at(lx, d / 2 + 0.5)
      m.box(1.7, 0.1, 0.9, bx, wy - 0.85, bz, 0x4a4a4e, yaw)
      m.box(1.7, 0.6, 0.05, bx + s * 0.42, wy - 0.55, bz + c * 0.42, 0x2e2e32, yaw)
    }
  }
  const rise = 2.2 + rand() * 0.8
  roofs.add(new THREE.ConeGeometry(0.7071, 1, 4, 1), trs(x, y + H + rise / 2 + 0.1, z, yaw + Math.PI / 4, new THREE.Vector3(w * 1.12 * Math.SQRT2, rise, d * 1.12 * Math.SQRT2)), [0xb5542e, 0xa8482a, 0xc0653a][Math.floor(rand() * 3)]!)
}

/** The hillside town: villas facing the road, palms and lamps along the front. */
function buildTown(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const walls = new Mesher(), roofs = new Mesher()
  const inTown = (p: THREE.Vector3) => p.z > -60 && p.x < 240 && p.x > -380
  for (let i = 0; i < c.count; i += 7) {
    const p = c.samples[i]!
    if (!inTown(p)) continue
    const r = c.rights[i]!, t = c.tangents[i]!
    for (const side of [-1, 1]) for (let row = 0; row < 4; row++) {
      const lat = side * (c.widths[i]! / 2 + 9 + row * 14 + d.rand() * 4), x = p.x + r.x * lat, z = p.z + r.z * lat
      if (d.roadGap(x, z) < 12 || w.blocked(x, z, 7)) continue
      const y = w.terrainAt(x, z)
      if (y < 3.5) continue
      const wd = 7 + d.rand() * 5, dp = 6 + d.rand() * 3, yaw = Math.atan2(-side * r.x, -side * r.z) + Math.PI
      villa(walls, roofs, x, y, z, yaw, wd, dp, 2 + Math.floor(d.rand() * 2 + (row > 1 ? 1 : 0)), d.rand)
      w.addBox(x, z, wd / 2 + 0.3, dp / 2 + 0.3, yaw)
      void t
    }
  }
  place(k, walls, surface('plaster'))
  place(k, roofs, surface('stone', { rough: 0.8 }))
  // palms and lamps along the promenade, on the sea side
  const front: THREE.Vector3[] = [], lamps: THREE.Matrix4[] = []
  for (let i = 0; i < c.count; i += 6) {
    const p = c.samples[i]!
    if (p.z < -60 || p.z > 60 || p.x < -150 || p.x > 240 || c.raised[i]) continue
    const r = c.rights[i]!
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * (c.widths[i]! / 2 + 3.4), z = p.z + r.z * s * (c.widths[i]! / 2 + 3.4), y = w.terrainAt(x, z)
      if (y < 0.6 || d.roadGap(x, z) < 2 || w.blocked(x, z, 1)) continue
      if (i % 12 === 0) lamps.push(trs(x, y, z, Math.atan2(-r.x * s, -r.z * s), 1.35))
      else front.push(new THREE.Vector3(x, y, z))
    }
  }
  d.trees('palm', front, [1.1, 1.6], 0.7)
  d.prop('bk:street_lamp_01', lamps, 0.25)
  crates(d, d.spots(12, 2, 8, { from: 0.0, to: 0.1, clear: 1.5 }), 0xc8a878)
}

/** The harbour: stone quay round the basin, piles under the pier, fishing boats. */
function buildHarbour(k: BuildKit, pier: import('../Circuit').Circuit): void {
  const { world: w, d, root } = k
  const quay = new Mesher()
  for (let a = 0; a < Math.PI * 2; a += 0.09) {
    const x = BASIN.x + Math.cos(a) * BASIN.r, z = BASIN.z + Math.sin(a) * BASIN.r
    if (d.roadGap(x, z) < 6) continue
    quay.box(7.4, 6, 3, x, 0.5, z, 0xa89c88, -a + Math.PI / 2)
  }
  place(k, quay, surface('stone'))
  // the pier: timber piles under the deck, and the kicker at its end painted in stripes
  const piles = new Mesher()
  for (let i = 0; i < pier.count; i += 3) {
    if (!pier.raised[i] || pier.gap[i]) continue
    const p = pier.samples[i]!, r = pier.rights[i]!, half = pier.widths[i]! / 2 - 0.6
    for (const s of [-1, 1]) piles.post(0.3, 0.3, p.y + 5, p.x + r.x * s * half, -5, p.z + r.z * s * half, 0x4a3828, 8)
  }
  place(k, piles, surface('wood'))
  let lip = -1
  for (let i = 1; i < pier.count; i++) if (pier.gap[i] && !pier.gap[i - 1]) { lip = i - 1; break }
  if (lip > 0) {
    const p = pier.samples[lip]!, t = pier.tangents[lip]!, r = pier.rights[lip]!
    const sign = canvasTexture(512, 128, (g, W, H) => {
      g.fillStyle = '#121418'; g.fillRect(0, 0, W, H)
      for (let x = -H; x < W; x += 48) { g.fillStyle = '#ff8a3c'; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H * 0.4, H * 0.6); g.lineTo(x + H * 0.4, H * 0.6); g.fill() }
      g.fillStyle = '#ffffff'; g.font = 'italic 800 54px sans-serif'; g.textAlign = 'center'; g.fillText('BOOST TO CLEAR', W / 2, 58)
    })
    const j = Math.max(0, lip - 22), q = pier.samples[j]!, qt = pier.tangents[j]!, qr = pier.rights[j]!
    const board = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.8), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, side: THREE.DoubleSide }))
    board.position.set(q.x, q.y + 7.5, q.z)
    board.rotation.y = Math.atan2(qt.x, qt.z) + Math.PI
    root.add(board)
    const posts = new Mesher()
    for (const s of [-1, 1]) posts.post(0.15, 0.15, 8, q.x + qr.x * s * (pier.widths[j]! / 2 + 1.4), q.y, q.z + qr.z * s * (pier.widths[j]! / 2 + 1.4), 0x2a2e34, 8)
    place(k, posts, surface('metal'))
    void p; void t; void r
  }
  // boats in the basin and a ship on the quay
  const boats: THREE.Matrix4[] = []
  for (let q = 0; q < 30 && boats.length < 8; q++) {
    const a = d.rand() * 6.28, rr = 20 + d.rand() * 40, x = BASIN.x + Math.cos(a) * rr, z = BASIN.z + Math.sin(a) * rr
    if (d.roadGap(x, z) > 10) boats.push(trs(x, -0.4, z, d.rand() * 6, 0.24 + d.rand() * 0.08))
  }
  d.prop('dutch_ship_medium', boats, 0, undefined, 600)
  d.prop('lateral_sea_marker', [trs(BASIN.x - 80, 0, BASIN.z - 60, 0, 2), trs(BASIN.x - 20, 0, BASIN.z - 95, 1, 2)])
  void w
}

/** The cable-stayed bridge: two A-frame towers, cables fanning to the deck. */
function buildBridge(k: BuildKit): void {
  const { circuit: c, world: w, d } = k
  const pylon = new Mesher(), wires: THREE.Matrix4[] = []
  for (const at of [new THREE.Vector3(-360, 0, -500), new THREE.Vector3(-232, 0, -615)]) {
    const i = c.track(at.x, at.z, 0, c.count), p = c.samples[i]!, r = c.rights[i]!
    const half = c.widths[i]! / 2 + 2.4, base = Math.max(w.terrainAt(p.x, p.z), -4), top = p.y + 62
    const foot = (s: number, spread: number) => new THREE.Vector3(p.x + r.x * s * spread, base, p.z + r.z * s * spread)
    const head = new THREE.Vector3(p.x, top, p.z)
    const deck = (s: number) => new THREE.Vector3(p.x + r.x * s * half, p.y - 1, p.z + r.z * s * half)
    for (const s of [-1, 1]) {
      pylon.bar(foot(s, half + 9), deck(s), 1.9, 0xc4c6c8, 8)
      pylon.bar(deck(s), head, 1.5, 0xc4c6c8, 8)
      w.addPost(deck(s).x, deck(s).z, 2.2, p.y - 2)
      for (let q = 1; q <= 9; q++) for (const dir of [-1, 1]) {
        const j = (i + dir * q * 9 + c.count) % c.count, a = c.samples[j]!, ar = c.rights[j]!
        const from = new THREE.Vector3(p.x, top - 3 - q * 2.2, p.z)
        const to = new THREE.Vector3(a.x + ar.x * s * (c.widths[j]! / 2 + 0.3), a.y + 0.4, a.z + ar.z * s * (c.widths[j]! / 2 + 0.3))
        const mid = from.clone().add(to).multiplyScalar(0.5)
        const q4 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
        wires.push(new THREE.Matrix4().compose(mid, q4, new THREE.Vector3(0.09, from.distanceTo(to), 0.09)))
      }
    }
    // the cross beam runs under the deck, not through it
    pylon.bar(deck(-1).setY(p.y - 3), deck(1).setY(p.y - 3), 1.2, 0xb4b6b8, 6)
    pylon.post(3, 3, 2, p.x, top - 1, p.z, 0xb4b6b8, 10)
    // the towers stand on the deck's edges: solid only beside the road, never across it
  }
  place(k, pylon, surface('concrete'))
  d.instanced(new THREE.CylinderGeometry(1, 1, 1, 5), new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.35, metalness: 0.6 }), wires, false)
}

/** The island: an old fort on the crest, the cove and its warning board. */
function buildIsland(k: BuildKit): void {
  const { circuit: c, world: w, d, root } = k
  const fort = [new THREE.Vector3(60, 0, -790), new THREE.Vector3(-140, 0, -620)]
    .map((p) => p.setY(w.terrainAt(p.x, p.z)))
    .filter((p) => d.roadGap(p.x, p.z) > 22)
  d.prop('bk:fort_tower', fort.map((s) => trs(s.x, s.y - 1.5, s.z, d.rand() * 6, 1.3)), 0, undefined, 0)
  for (const s of fort) w.addPost(s.x, s.z, 10)
  // rocks ringing the cove below the jump
  const rocks: THREE.Matrix4[] = []
  for (let a = 0; a < 6.28; a += 0.5) {
    const x = COVE.x + Math.cos(a) * COVE.r * 1.3, z = COVE.z + Math.sin(a) * COVE.r * 1.3
    if (d.roadGap(x, z) > 6) rocks.push(trs(x, w.terrainAt(x, z) - 1, z, d.rand() * 6, 0.18 + d.rand() * 0.1))
  }
  d.prop('bk:coast_rocks_01', rocks, 0, undefined, 400)
  // a striped board at the lip so the jump reads from a distance
  let lip = -1
  for (let i = 1; i < c.count; i++) if (c.gap[i] && !c.gap[i - 1] && c.samples[i]!.z < -700) { lip = i - 1; break }
  if (lip > 0) {
    const p = c.samples[lip]!, t = c.tangents[lip]!
    const m = new Mesher()
    m.box(c.widths[lip]! + 1, 1.6, 1, p.x, p.y - 1, p.z, 0x8a7a62, Math.atan2(-t.x, -t.z))
    m.box(c.widths[lip]! + 1, 0.25, 1.1, p.x, p.y - 0.1, p.z, 0xff8a3c, Math.atan2(-t.x, -t.z))
    place(k, m, surface('paint'))
  }
  void root
}

/** Stone lighthouse with a red band and a turning lamp. */
function lighthouse(k: BuildKit, x: number, z: number): THREE.Object3D {
  const { world: w, root } = k, y = w.terrainAt(x, z)
  const stone = new Mesher(), paint = new Mesher(), iron = new Mesher()
  stone.post(19, 16, 6, x, y - 2, z, 0xb4ac9c, 28)
  paint.post(9.5, 6, 62, x, y + 3, z, 0xf0ece2, 28)
  for (const b of [18, 40]) paint.post(9.5 - (b / 62) * 3.5 + 0.06, 9.5 - ((b + 10) / 62) * 3.5 + 0.06, 10, x, y + 3 + b, z, 0xb02a24, 28)
  iron.add(new THREE.CylinderGeometry(8.4, 6.2, 1, 24), trs(x, y + 65.4, z), 0x23262c)
  for (let a = 0; a < 20; a++) {
    const th = (a / 20) * 6.283
    iron.post(0.07, 0.07, 1.4, x + Math.cos(th) * 8, y + 65.8, z + Math.sin(th) * 8, 0x23262c, 5)
  }
  iron.add(new THREE.TorusGeometry(8, 0.09, 6, 30), trs(x, y + 67.2, z, 0, 1, Math.PI / 2), 0x23262c)
  iron.post(4.2, 4.2, 0.5, x, y + 65.8, z, 0x23262c, 16)
  iron.add(new THREE.ConeGeometry(4.9, 3.2, 16), trs(x, y + 73, z), 0x1f3a3a)
  place(k, stone, surface('stone'))
  place(k, paint, surface('plaster'))
  place(k, iron, surface('metal'))
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 14), glow(3.4, 2.8, 1.8))
  lamp.position.set(x, y + 68.8, z)
  root.add(lamp)
  w.addPost(x, z, 11)
  return lamp
}
