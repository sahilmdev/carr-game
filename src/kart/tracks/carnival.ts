import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, crowd, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { Solid } from '../World'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import { arrows, gantry, glow, glowStreak, loopTracks, railTrack, stands, edgeLights } from './parts'

const BULBS = [0xffd24a, 0xff4a8a, 0x4ad8ff, 0xff8a2a, 0xb06aff, 0x6aff9a]

/** Red and white canvas, for the big top and the stall awnings. */
function stripes(a: string, b: string, n = 12): THREE.CanvasTexture {
  const t = canvasTexture(256, 64, (g, W, H) => {
    for (let q = 0; q < n; q++) { g.fillStyle = q % 2 ? a : b; g.fillRect((q * W) / n, 0, W / n + 1, H) }
    g.fillStyle = 'rgba(0,0,0,0.12)'
    g.fillRect(0, H - 6, W, 6)
  })
  t.wrapS = THREE.RepeatWrapping
  return t
}

/** A string of coloured bulbs hanging between two points. */
function festoon(out: THREE.Matrix4[], cols: THREE.Color[], a: THREE.Vector3, b: THREE.Vector3, sag: number, every: number, rand: () => number): void {
  const n = Math.max(2, Math.round(a.distanceTo(b) / every))
  for (let q = 0; q <= n; q++) {
    const u = q / n, p = a.clone().lerp(b, u)
    p.y -= Math.sin(u * Math.PI) * sag
    out.push(trs(p.x, p.y, p.z, 0, 0.16))
    cols.push(new THREE.Color(BULBS[Math.floor(rand() * BULBS.length)]!).multiplyScalar(3))
  }
}

/*
 * Midnight Carnival, through the rides rather than past them. Down the midway
 * between the stalls and through the neon fun house, up the coaster's lift
 * hill, the long drop and the camelback, then stay on the coaster for its
 * launch over the flume pond, or drop into the log-flume channel and ride the
 * current. Through the middle of the big top, past the carousel and back to
 * the midway.
 *
 * Lap 2: fireworks, and the dodgems break out across the plaza road. Last
 * lap: a coaster car runs the track with you.
 */
const S = 1.45
const sc = (x: number, y: number, z: number, o?: TrackPoint[3]): TrackPoint => [x * S, y, z * S, o]
const C = { raised: true, deck: 'steel', rail: 'LR' } as const

const POINTS: TrackPoint[] = [
  // 0: the midway, heading east
  sc(0, 1, 0),
  sc(130, 1, -6, { pad: 0 }),
  sc(240, 1, -30, { items: true }),
  // 3: through the fun house
  sc(330, 1, -90),
  sc(360, 1, -180),
  sc(330, 2, -270),
  // 6: up the lift hill
  sc(260, 10, -320, { ...C, lock: true }),
  sc(170, 26, -350, { ...C, lock: true }),
  sc(80, 36, -360, { ...C, lock: true }),
  // 9: the drop and the camelback
  sc(0, 12, -340, { ...C, lock: true }),
  sc(-70, 6, -300, { ...C, lock: true }),
  sc(-130, 15, -260, { ...C, lock: true }),
  sc(-190, 9, -210, C), // 12: the flume leaves here
  sc(-250, 14, -150, { ...C, items: true }),
  sc(-296, 14, -95, { ...C, bank: 4, pad: 0 }),
  // 15: the launch over the flume pond
  sc(-300, 15, -30, { ...C, rail: '', pad: 0 }),
  sc(-298, 18.5, -10, { gap: true }),
  sc(-295, 16.5, 9, { gap: true }),
  sc(-291, 14.5, 29, { ...C, rail: 'LR', w: 20 }), // 18: the landing deck
  sc(-280, 10, 90, C),
  // 20: through the big top, past the carousel, back to the midway
  sc(-220, 1, 170),
  sc(-140, 1, 190, { pad: 0 }),
  sc(-80, 1, 260),
  sc(10, 2, 270, { items: true }),
  sc(70, 1, 190),
  sc(50, 1, 100),
  sc(-10, 1, 50),
]
const POND = { x: -295 * S, z: 4 * S, rx: 46, ry: 52 }
const TOP = { x: -180 * S, z: 180 * S, r: 40 }
const HOUSE = { x: 345 * S, z: -135 * S }

export const carnival: TrackDef = {
  id: 'carnival',
  name: 'Midnight Carnival',
  news: ['FIREWORKS - DODGEMS LOOSE', 'A COASTER CAR JOINS THE RACE'],
  ambience: 'town',
  width: 17,
  bank: 3,
  maxBank: 0.32,
  shoulder: 8,
  accent: 0xffd24a,
  sea: -6,
  piers: 'none',
  rails: 'steel',
  road: { lines: 'circuit', kerbColors: [0xffd24a, 0x5a1a8a], grime: 0x3a3028, sheen: 0.5, lift: 0.04 },
  terrain: { layers: ['grass', 'brown_mud_leaves_01', 'rock_pitted_mossy', 'aerial_sand'], tile: [22, 9, 20, 18], tints: [0x8a9a6a, 0xa09078, 0x9a9488, 0xb8a888] },
  look: {
    tod: 'night', generatedSky: true, top: [0.06, 0.04, 0.14], horizon: [0.42, 0.2, 0.36], mix: 0.85, stars: 1,
    fog: [0.2, 0.12, 0.22], fogDensity: 0.0014, fogBase: 4, fogFall: 0.03, sunGlow: 0,
    exposure: 1.65, sun: 1.4, hemi: 2.4, bloom: 0.6, wet: 0.35, headlights: 1, env: 0.9,
    grade: [1.18, 1.1, 0.012, 0.004, 0.02, 1.05, 0.98, 1.05, 0.38],
  },
  points: POINTS,
  // a full loop at the bottom of the drop, while you're on the coaster's rails
  loops: [{ x: -35 * S, z: -322 * S, r: 12, side: 0 }],
  branches: [
    {
      // the log flume: down the channel on the current. Wet and slippery, but quick.
      name: 'Flume', from: 12, to: 20, odds: 0.45,
      points: [
        sc(-212, 6, -150, { deck: 'wood', w: 13, rail: 'LR', pad: 0 }),
        sc(-232, 3, -60, { deck: 'wood', w: 13, rail: 'LR' }),
        sc(-250, 2.2, 30, { deck: 'wood', w: 13, rail: 'LR', pad: 0 }),
        sc(-238, 1.5, 110, { deck: 'wood', w: 13, rail: 'LR' }),
      ],
    },
    {
      // the bumper-car arena: straight across the dodgem floor, through the
      // cars. Shorter, if you don't get knocked about too much.
      name: 'Bumper arena', from: 24, to: 26, odds: 0.35,
      points: [
        [128, 1, 252, { w: 16, deck: 'steel' }],
        [150, 1, 205, { w: 40, deck: 'steel', items: true }],
        [142, 1, 152, { w: 40, deck: 'steel' }],
        [104, 1, 98, { w: 16, deck: 'steel' }],
      ],
    },
  ],

  ground(x, z) {
    const r = Math.hypot(x + 10, z + 80)
    const hills = smooth(560, 900, r) * (18 + fbm2(x * 0.006, z * 0.006) * 60)
    const pond = Math.max(0, 1 - Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.ry))
    return fbm2(x * 0.02, z * 0.02) * 0.8 + hills - pond * 12
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const path = smooth(26, 6, roadDist)
    const rock = smooth(0.6, 1, slope)
    mix[0] = (1 - path) * (1 - rock)
    mix[1] = path * 0.85 + fbm2(x * 0.05, z * 0.05) * 0.2
    mix[2] = Math.max(rock, smooth(-3, -8, h))
    mix[3] = smooth(10, 3, roadDist) * 0.4
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: (x, z) => (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.ry) < 1 ? 'mud' : 'grass'),
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Midnight Carnival', '#ffd24a')
    stands(k, 8, 44, -1, [0xd83a6a, 0xffd24a, 0x3ab0e0, 0x2a2e3a, 0x8a3ad0, 0xe8e6e0], 0xffd24a, 'Midnight Carnival')
    arrows(k, 0xffd24a)
    // fairground bulbs along both edges of every road: warm gold, not the city's neon
    edgeLights(k, new THREE.Color(1, 0.78, 0.35), { spacing: 10, pool: 0.32 })
    mountainRing(root, -10, -80, { inner: 1200, outer: 3000, height: 260, rock: 0x2a2836, seed: 11 })
    forest(k, 'oak', d.spots(140, 30, 220, { clear: 14, test: (x, z) => Math.hypot(x + 10, z + 80) > 520 }), { scale: [0.8, 1.3], solid: 0, tints: [0x5a6a4a, 0x4a5a40] })
    forest(k, 'pine', d.spots(60, 40, 260, { clear: 20 }), { scale: [0.9, 1.4], solid: 0, tints: [0x4a5a48] })
    grass(k, { density: 1.6, reach: 20, height: [0.3, 0.7], colors: [0x5a6a40, 0x4e5e38, 0x66744a], test: (_x, _z, y) => y > -1 })

    const lights: THREE.Matrix4[] = [], lightCols: THREE.Color[] = []

    // ── the coaster: red lattice legs and a steel spine under the raised road
    const steel = new Mesher()
    for (let i = 0; i < c.count; i += 5) {
      if (!c.raised[i] || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      const yaw = Math.atan2(-t.x, -t.z), pitch = Math.asin(THREE.MathUtils.clamp(t.y, -1, 1))
      steel.box(c.widths[i]! + 0.8, 0.5, 10.6, p.x, p.y - 0.95, p.z, 0x9a1a22, yaw, 0, pitch)
      steel.box(1.1, 1.4, 10.6, p.x + r.x * (half - 1.2), p.y - 1.9, p.z + r.z * (half - 1.2), 0xb02028, yaw, 0, pitch)
      steel.box(1.1, 1.4, 10.6, p.x - r.x * (half - 1.2), p.y - 1.9, p.z - r.z * (half - 1.2), 0xb02028, yaw, 0, pitch)
      if (i % 15 === 0) {
        const g = w.terrainAt(p.x, p.z)
        for (const s of [-1, 1]) {
          const x = p.x + r.x * s * (half - 1.2), z = p.z + r.z * s * (half - 1.2)
          steel.post(0.42, 0.5, p.y - 1.5 - g + 1, x, g - 1, z, 0xb8242c, 8)
          w.addPost(x, z, 0.6, p.y - 2.5)
        }
        // cross bracing between the legs
        for (let y = g + 4; y < p.y - 3; y += 7) {
          const a = new THREE.Vector3(p.x + r.x * (half - 1.2), y, p.z + r.z * (half - 1.2))
          const b = new THREE.Vector3(p.x - r.x * (half - 1.2), Math.min(y + 6, p.y - 2), p.z - r.z * (half - 1.2))
          steel.bar(a, b, 0.16, 0xa01e26, 5)
        }
      }
      // running lights under each edge
      if (i % 5 === 0) for (const s of [-1, 1]) {
        lights.push(trs(p.x + r.x * s * (half + 0.3), p.y - 0.3, p.z + r.z * s * (half + 0.3), 0, 0.22))
        lightCols.push(new THREE.Color(BULBS[(i / 5) % BULBS.length]!).multiplyScalar(3.4))
      }
    }
    place(k, steel, surface('paint', { rough: 0.45, metal: 0.4 }))

    // the launch ramp's lip, over the flume pond
    const lip = new Mesher()
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (!(!c.gap[i] && c.gap[j])) continue
      const p = c.samples[i]!, t = c.tangents[i]!
      lip.box(c.widths[i]! + 1.2, 2.2, 1.6, p.x, p.y - 1.3, p.z, 0xffd24a, Math.atan2(-t.x, -t.z))
    }
    place(k, lip, surface('paint'))
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x0a1a2a, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.6 }))
    pond.rotation.x = -Math.PI / 2
    pond.scale.set(POND.rx, POND.ry, 1)
    pond.position.set(POND.x, -2.5, POND.z)
    root.add(pond)
    flumeRide(k, c.branches[0]!)
    railTrack(k, c, 0xe8b820)
    loopTracks(k, 0xd83a6a, 0xffd24a)
    funHouse(k)

    // ── the Ferris wheel, turning, rimmed with lights
    const wheel = new THREE.Group()
    const WX = 150 * S, WZ = -180 * S, WR = 34, WY = WR + 6
    const frame = new Mesher()
    for (const s of [-1, 1]) {
      frame.bar(new THREE.Vector3(WX - 16, 0, WZ + s * 5), new THREE.Vector3(WX, WY, WZ + s * 3), 0.7, 0xe8e6e0, 8)
      frame.bar(new THREE.Vector3(WX + 16, 0, WZ + s * 5), new THREE.Vector3(WX, WY, WZ + s * 3), 0.7, 0xe8e6e0, 8)
    }
    place(k, frame, surface('paint'))
    w.addPost(WX - 16, WZ, 2)
    w.addPost(WX + 16, WZ, 2)
    const spin = new Mesher()
    for (const s of [-1, 1]) {
      for (let q = 0; q < 48; q++) {
        const a0 = (q / 48) * Math.PI * 2, a1 = ((q + 1) / 48) * Math.PI * 2
        spin.bar(new THREE.Vector3(Math.cos(a0) * WR, Math.sin(a0) * WR, s * 3), new THREE.Vector3(Math.cos(a1) * WR, Math.sin(a1) * WR, s * 3), 0.32, 0xf0eee8, 5)
      }
      for (let q = 0; q < 16; q++) {
        const a = (q / 16) * Math.PI * 2
        spin.bar(new THREE.Vector3(0, 0, s * 3), new THREE.Vector3(Math.cos(a) * WR, Math.sin(a) * WR, s * 3), 0.16, 0xd8d6d0, 4)
      }
    }
    const spinMesh = new THREE.Mesh(spin.build(), surface('paint', { metal: 0.5, rough: 0.4 }))
    wheel.add(spinMesh)
    const rimLights: THREE.Matrix4[] = []
    for (const s of [-1, 1]) for (let q = 0; q < 96; q++) {
      const a = (q / 96) * Math.PI * 2
      rimLights.push(trs(Math.cos(a) * (WR + 0.4), Math.sin(a) * (WR + 0.4), s * 3.4, 0, 0.32))
    }
    for (let q = 0; q < 16; q++) {
      const a = (q / 16) * Math.PI * 2
      for (let u = 0.2; u < 1; u += 0.2) rimLights.push(trs(Math.cos(a) * WR * u, Math.sin(a) * WR * u, 3.4, 0, 0.22))
    }
    const rimMat = glow(3, 2.2, 1.2)
    const rim = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), rimMat, rimLights.length)
    rimLights.forEach((m, q) => rim.setMatrixAt(q, m))
    wheel.add(rim)
    wheel.position.set(WX, WY, WZ)
    root.add(wheel)
    // gondolas hang level as the wheel turns
    const gondolaG = new Mesher()
    gondolaG.box(3.4, 2.6, 3, 0, -2.4, 0, 0xd8344a).box(3.8, 0.3, 3.4, 0, -1, 0, 0xf0d040).post(0.08, 0.08, 1.2, 0, -1, 0, 0x2a2a2a, 4)
    const GN = 16
    const gondolas = new THREE.InstancedMesh(gondolaG.build(), surface('paint'), GN)
    const gCols = [0xd8344a, 0x3a9ae0, 0xffd24a, 0x5ad07a]
    for (let q = 0; q < GN; q++) gondolas.setColorAt(q, new THREE.Color(gCols[q % 4]!))
    gondolas.frustumCulled = false
    root.add(gondolas)

    // ── the carousel: striped canopy, turning, lit round the edge
    const CX = -50 * S, CZ = 160 * S
    const caro = new THREE.Group()
    caro.position.set(CX, 0, CZ)
    root.add(caro)
    const top = stripes('#e8384a', '#f4ecd8', 24)
    top.repeat.x = 2
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(17, 8, 24, 1, true), new THREE.MeshStandardMaterial({ map: top, roughness: 0.7, side: THREE.DoubleSide }))
    canopy.position.y = 13
    caro.add(canopy)
    const base = new Mesher()
    base.add(new THREE.CylinderGeometry(16, 16.5, 1.2, 32), trs(0, 0.6, 0), 0x6a2a3a)
    base.add(new THREE.CylinderGeometry(2.2, 2.2, 10, 16), trs(0, 6, 0), 0xd8b040)
    for (let q = 0; q < 18; q++) {
      const a = (q / 18) * Math.PI * 2
      base.post(0.12, 0.12, 8.4, Math.cos(a) * 12, 1, Math.sin(a) * 12, 0xe8c050, 6)
      base.box(0.8, 1.2, 2.4, Math.cos(a) * 12, 3 + (q % 2) * 0.8, Math.sin(a) * 12, [0xf0ece0, 0x3a2a24, 0xc89a5a][q % 3]!, -a)
    }
    const caroTurn = new THREE.Mesh(base.build(), surface('paint'))
    caro.add(caroTurn)
    w.addPost(CX, CZ, 17)
    for (let q = 0; q < 48; q++) {
      const a = (q / 48) * Math.PI * 2
      lights.push(trs(CX + Math.cos(a) * 16.8, 9.2, CZ + Math.sin(a) * 16.8, 0, 0.3))
      lightCols.push(new THREE.Color(q % 2 ? 0xffd24a : 0xfff0d0).multiplyScalar(3.2))
    }

    // ── the big top: the road runs through the ring
    bigTop(k, lights, lightCols)

    // ── the midway: stalls both sides, bulbs strung across the road
    const stall = new Mesher(), awnings: THREE.Matrix4[] = [], glowFront: THREE.Matrix4[] = [], glowCols: THREE.Color[] = []
    const posts: [THREE.Vector3, number][] = []
    for (let i = 0; i < c.count; i += 9) {
      if (c.raised[i] || c.gap[i] || Math.abs(c.bends[i]!) > 0.012) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      for (const s of [-1, 1]) {
        if (d.rand() < 0.2) continue
        const off = s * (half + 7.5), x = p.x + r.x * off, z = p.z + r.z * off
        if (d.roadGap(x, z) < 5.5 || w.blocked(x, z, 4)) continue
        const yaw = Math.atan2(-s * r.x, -s * r.z)
        stall.box(7, 3, 4.5, x, 1.5, z, [0xe8dcc0, 0xd0c0a0, 0xc8d4dc][Math.floor(d.rand() * 3)]!, yaw)
        stall.box(7.4, 0.3, 5, x, 3.2, z, 0x4a2a1a, yaw)
        awnings.push(new THREE.Matrix4().compose(new THREE.Vector3(x - r.x * s * 2.9, 3.5, z - r.z * s * 2.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, yaw, 0, 'YXZ')), new THREE.Vector3(7.4, 2.6, 1)))
        glowFront.push(new THREE.Matrix4().compose(new THREE.Vector3(x - r.x * s * 2.3, 1.7, z - r.z * s * 2.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(6.4, 2.2, 1)))
        glowCols.push(new THREE.Color(BULBS[Math.floor(d.rand() * BULBS.length)]!).multiplyScalar(1.6))
        w.addBox(x, z, 3.6, 2.4, yaw)
        // the stall's light spills across the midway
        glowStreak(k, x - r.x * s * 7, p.y + 0.08, z - r.z * s * 7, yaw, glowCols[glowCols.length - 1]!.clone().multiplyScalar(0.18), 12, 9)
      }
      if (i % 27 === 0) for (const s of [-1, 1]) posts.push([new THREE.Vector3(p.x + r.x * s * (half + 2), 0, p.z + r.z * s * (half + 2)), i])
    }
    place(k, stall, surface('wood'))
    const awningTex = stripes('#d8304a', '#f4ecd8', 10)
    d.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: awningTex, roughness: 0.8, side: THREE.DoubleSide }), awnings, false)
    d.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }), glowFront, false, glowCols)
    // light poles in pairs across the road, festooned
    const poles = new Mesher()
    for (let q = 0; q + 1 < posts.length; q += 2) {
      const [a, ia] = posts[q]!, [b] = posts[q + 1]!
      if (d.roadGap(a.x, a.z) < 1 || d.roadGap(b.x, b.z) < 1) continue
      for (const p of [a, b]) {
        const y = w.terrainAt(p.x, p.z)
        poles.post(0.14, 0.12, 9, p.x, y, p.z, 0x2a2a34, 6)
        w.addPost(p.x, p.z, 0.3)
      }
      festoon(lights, lightCols, a.clone().setY(w.terrainAt(a.x, a.z) + 9), b.clone().setY(w.terrainAt(b.x, b.z) + 9), 1.6, 1.4, d.rand)
      void ia
    }
    if (!poles.empty) place(k, poles, surface('metal'), false)

    crowd(k, d.spots(80, 4.5, 7, { clear: 4 }).filter((s) => !w.blocked(s.x, s.z, 0.6)).map((s) => [s.x, s.y, s.z, d.rand() * 6.28] as [number, number, number, number]), [0xd83a6a, 0xffd24a, 0x3ab0e0, 0x2a2e3a, 0x8a3ad0, 0xe8e6e0, 0x4a8a5a])

    const bulbs = d.instanced(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lights, false, lightCols)
    bulbs.frustumCulled = false

    // ── the bumper-car arena: a padded rink the arena road crosses, its dodgems roaming the floor
    const arena = c.branches[1]!
    const ac = arena.samples[Math.floor(arena.count * 0.5)]!
    const AX = ac.x, AZ = ac.z, AW = 34, AD = 30
    const rinkFloor = new Mesher()
    // a low padded wall round the floor, open where the roads come in and out
    const pad = new Mesher()
    for (let q = 0; q < 96; q++) {
      const a = (q / 96) * Math.PI * 2, x = AX + Math.cos(a) * AW, z = AZ + Math.sin(a) * AD
      if (d.roadGap(x, z) < 3) continue
      pad.box(3.6, 1.1, 1.2, x, 0.55 + ac.y - 1, z, q % 2 ? 0xd83a3a : 0xf2c230, Math.atan2(Math.cos(a), -Math.sin(a)) + Math.PI / 2)
      w.movers.push({ x, z, r: 1.4, top: ac.y + 2, bounce: 9 })
    }
    place(k, pad, surface('paint', { rough: 0.5 }))
    // the canopy on posts, strung with bulbs
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = AX + sx * (AW + 3), z = AZ + sz * (AD + 3)
      rinkFloor.post(0.35, 0.35, 9, x, ac.y - 1, z, 0xd8b040, 8)
      w.addPost(x, z, 0.6)
    }
    for (const sx of [-1, 1]) rinkFloor.box(AW * 2 + 7, 0.6, 1, AX, ac.y + 8, AZ + sx * (AD + 3), 0x6a2a8a)
    for (const sx of [-1, 1]) rinkFloor.box(1, 0.6, AD * 2 + 7, AX + sx * (AW + 3), ac.y + 8, AZ, 0x6a2a8a)
    place(k, rinkFloor, surface('metal'))
    const DN = 8
    const carG = new Mesher()
    carG.box(1.9, 0.75, 2.7, 0, 0.62, 0, 0xffffff).box(2.4, 0.4, 3.2, 0, 0.3, 0, 0x2a2a2a).post(0.04, 0.04, 3, 0, 1, -1, 0x888888, 4)
    const dodgems = new THREE.InstancedMesh(carG.build(), surface('paint', { rough: 0.3 }), DN)
    for (let q = 0; q < DN; q++) dodgems.setColorAt(q, new THREE.Color(BULBS[q % BULBS.length]!))
    dodgems.frustumCulled = false
    dodgems.userData['keep'] = true
    root.add(dodgems)
    const dSolids: Solid[] = Array.from({ length: DN }, () => ({ x: AX, z: AZ, r: 1.7, top: ac.y + 2.5, bounce: 14 }))
    w.movers.push(...dSolids)

    // ── fireworks: bursts of sparks over the park from the second lap
    const FW = 900
    const fwPos = new Float32Array(FW * 3), fwCol = new Float32Array(FW * 3)
    const fwVel = new Float32Array(FW * 3), fwAge = new Float32Array(FW).fill(99)
    const fwGeo = new THREE.BufferGeometry()
    fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3))
    fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3))
    const fw = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 2.6, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    fw.frustumCulled = false
    root.add(fw)
    let nextBurst = 0, burstAt = 0

    const coasterCar = coasterTrain(k)
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), e3 = new THREE.Euler()
    k.onFrame((f) => {
      const a = f.time * 0.09
      spinMesh.rotation.z = a
      rim.rotation.z = a
      for (let q = 0; q < GN; q++) {
        const g = a + (q / GN) * Math.PI * 2
        m4.makeTranslation(WX + Math.cos(g) * WR, WY + Math.sin(g) * WR, WZ)
        gondolas.setMatrixAt(q, m4)
      }
      gondolas.instanceMatrix.needsUpdate = true
      caroTurn.rotation.y = f.time * 0.5
      const late = f.totalLaps > 1 && f.lap >= f.totalLaps
      rimMat.color.setRGB(late ? 4 : 3, late ? 0.6 + Math.max(0, Math.sin(f.time * 8)) * 2 : 2.2, late ? 0.6 : 1.2)

      // dodgems: roaming the arena floor, faster and more of them in the way from lap 2
      const busy = f.lap >= 2 ? 1.4 : 1
      for (let q = 0; q < DN; q++) {
        const ph = f.time * (0.22 + q * 0.03) * busy + q * 1.7
        const ang = ph * 1.3 + q, rr = 0.5 + 0.42 * Math.sin(ph * 0.9 + q * 2.1)
        const x = AX + Math.cos(ang) * rr * (AW - 6), z = AZ + Math.sin(ang) * rr * (AD - 6)
        const s = dSolids[q]!
        const yaw = Math.atan2(x - s.x, z - s.z)
        s.x = x; s.z = z
        m4.compose(v3.set(x, ac.y - 0.1, z), q4.setFromEuler(e3.set(0, yaw, 0)), one)
        dodgems.setMatrixAt(q, m4)
      }
      dodgems.instanceMatrix.needsUpdate = true

      coasterCar(f.totalLaps > 1 && f.lap >= f.totalLaps, f.time)
      // fireworks
      if (f.lap >= 2 && f.time > nextBurst) {
        nextBurst = f.time + 0.5 + Math.random() * 1.2
        const cx = -40 + (Math.random() - 0.5) * 400, cz = -100 + (Math.random() - 0.5) * 300, cy = 90 + Math.random() * 60
        const col = new THREE.Color(BULBS[Math.floor(Math.random() * BULBS.length)]!).multiplyScalar(2.6)
        for (let n = 0; n < 150; n++) {
          const p = burstAt
          burstAt = (burstAt + 1) % FW
          const u = Math.random() * 2 - 1, th = Math.random() * 6.28, sp = 16 + Math.random() * 6, rr = Math.sqrt(1 - u * u)
          fwPos.set([cx, cy, cz], p * 3)
          fwVel.set([Math.cos(th) * rr * sp, u * sp, Math.sin(th) * rr * sp], p * 3)
          fwCol.set([col.r, col.g, col.b], p * 3)
          fwAge[p] = 0
        }
      }
      for (let p = 0; p < FW; p++) {
        if (fwAge[p]! > 3) { if (fwAge[p]! < 90) { fwPos[p * 3 + 1] = -999; fwAge[p] = 99 } continue }
        fwAge[p]! += f.dt
        const o = p * 3
        fwVel[o + 1]! -= 9 * f.dt
        fwPos[o]! += fwVel[o]! * f.dt; fwPos[o + 1]! += fwVel[o + 1]! * f.dt; fwPos[o + 2]! += fwVel[o + 2]! * f.dt
        const fade = Math.max(0, 1 - fwAge[p]! / 3) * 0.04 + 0.96
        fwCol[o]! *= fade; fwCol[o + 1]! *= fade; fwCol[o + 2]! *= fade
      }
      fwGeo.getAttribute('position').needsUpdate = true
      fwGeo.getAttribute('color').needsUpdate = true
    })
  },
}

/** The log flume's channel: timber troughs, water running in them, splash where it meets the pond. */
function flumeRide(k: BuildKit, flume: Circuit): void {
  const { world: w, root } = k
  const m = new Mesher(), probe = { i: -1, lat: 0, y: 0 }
  for (let i = 0; i < flume.count; i += 3) {
    const p = flume.samples[i]!, r = flume.rights[i]!, t = flume.tangents[i]!, half = flume.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * (half + 0.3), z = p.z + r.z * s * (half + 0.3)
      // no trough wall standing on the main road where the flume leaves and rejoins it
      if (k.circuit.roadAt(x, z, p.y + 1, probe) && Math.abs(probe.lat) < k.circuit.widths[probe.i]! / 2 + 1) continue
      m.box(0.6, 1.8, 6.4, x, p.y + 0.4, z, 0x8a5a2a, yaw)
    }
    if (i % 12 === 0) {
      const g = w.terrainAt(p.x, p.z)
      if (p.y - g > 1.5) for (const s of [-1, 1]) m.post(0.3, 0.35, p.y - g, p.x + r.x * s * half, g, p.z + r.z * s * half, 0x6a4a2a, 6)
    }
  }
  place(k, m, surface('wood'))
  // water lying in the channel: slippery
  const water = new THREE.MeshStandardMaterial({ color: 0x3a8aa8, roughness: 0.04, transparent: true, opacity: 0.55, depthWrite: false })
  for (const u of [0.2, 0.45, 0.7, 0.92]) {
    const i = Math.floor(flume.count * u), p = flume.samples[i]!
    w.patches.push({ x: p.x, z: p.z, r: 8, surface: 'mud', on: true })
    const sheet = new THREE.Mesh(new THREE.CircleGeometry(8, 20), water)
    sheet.rotation.x = -Math.PI / 2
    sheet.position.set(p.x, p.y + 0.1, p.z)
    sheet.scale.set(0.8, 1.5, 1)
    root.add(sheet)
  }
}

/** The fun house: a tunnel of mirrors and flashing panels the midway runs through. */
function funHouse(k: BuildKit): void {
  const { circuit: c, world: w, root } = k
  const shell = new Mesher(), panels = new Mesher()
  for (let i = 0; i < c.count; i += 3) {
    const p = c.samples[i]!
    if (Math.hypot(p.x - HOUSE.x, p.z - HOUSE.z) > 75 || c.raised[i]) continue
    const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    for (const s of [-1, 1]) {
      const ox = p.x + r.x * s * (half + 2), oz = p.z + r.z * s * (half + 2)
      shell.box(1, 11, 6.2, ox, p.y + 5.5, oz, 0x2a1a3a, yaw)
      w.addBox(ox, oz, 0.6, 3.4, yaw)
      if (i % 6 === 0) panels.box(0.2, 3.6, 4.4, ox - r.x * s * 0.6, p.y + 3.4 + (i % 4), oz - r.z * s * 0.6, 0xffffff, yaw)
    }
    shell.box(c.widths[i]! + 6, 1, 6.2, p.x, p.y + 11.2, p.z, 0x1e1428, yaw)
    if (i % 9 === 0) panels.box(c.widths[i]!, 0.3, 0.8, p.x, p.y + 10.5, p.z, 0xffffff, yaw)
  }
  place(k, shell, surface('paint', { rough: 0.3, metal: 0.5 }))
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.6, 2.2), toneMapped: false })
  root.add(new THREE.Mesh(panels.build(), mat))
  k.onFrame((f) => { const h = (f.time * 0.4) % 1; mat.color.setHSL(h, 1, 0.5).multiplyScalar(4) })
  // the face over the entrance
  const sign = canvasTexture(512, 128, (g, W, H) => {
    g.fillStyle = '#12081e'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#ffd24a'; g.font = 'italic 900 78px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('FUN HOUSE', W / 2, 92)
  })
  let i0 = -1
  for (let i = 0; i < c.count; i++) if (Math.hypot(c.samples[i]!.x - HOUSE.x, c.samples[i]!.z - HOUSE.z) < 75) { i0 = i; break }
  if (i0 >= 0) {
    const p = c.samples[i0]!, t = c.tangents[i0]!
    const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, side: THREE.DoubleSide }))
    board.position.set(p.x, p.y + 15, p.z)
    board.rotation.y = Math.atan2(t.x, t.z) + Math.PI
    root.add(board)
  }
}

/** The big top: striped canvas over the ring, doorways where the road goes in and out, seats inside. */
function bigTop(k: BuildKit, lights: THREE.Matrix4[], lightCols: THREE.Color[]): void {
  const { world: w, root, d } = k
  const tent = stripes('#c8243a', '#f6efe0', 32)
  tent.repeat.x = 3
  const tentMat = new THREE.MeshStandardMaterial({ map: tent, roughness: 0.8, side: THREE.DoubleSide })
  // the wall, in panels, leaving doorways where the road passes
  const wall = new Mesher(), seats = new Mesher()
  const N = 48
  for (let q = 0; q < N; q++) {
    const a = (q / N) * Math.PI * 2, x = TOP.x + Math.cos(a) * TOP.r, z = TOP.z + Math.sin(a) * TOP.r
    if (d.roadGap(x, z) < 6) continue
    wall.box(5.4, 9, 0.3, x, 4.5, z, 0xffffff, -a + Math.PI / 2)
    w.addBox(x, z, 2.7, 0.4, -a + Math.PI / 2)
    // tiers of seats inside the wall, facing the ring
    const sx = TOP.x + Math.cos(a) * (TOP.r - 5), sz = TOP.z + Math.sin(a) * (TOP.r - 5)
    if (d.roadGap(sx, sz) > 4) for (let t = 0; t < 3; t++) seats.box(5.2, 0.8, 1.6, TOP.x + Math.cos(a) * (TOP.r - 3 - t * 1.6), 0.6 + t * 0.9, TOP.z + Math.sin(a) * (TOP.r - 3 - t * 1.6), 0x6a2a3a, -a + Math.PI / 2)
  }
  const wm = new THREE.Mesh(wall.build(), tentMat)
  root.add(wm)
  place(k, seats, surface('wood'))
  const roof = new THREE.Mesh(new THREE.ConeGeometry(TOP.r + 4, 24, 48, 1, true), tentMat)
  roof.position.set(TOP.x, 21, TOP.z)
  root.add(roof)
  for (const [dx, dz] of [[0, -14], [0, 14]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 40, 8), surface('paint'))
    const x = TOP.x + dx!, z = TOP.z + dz!
    if (d.roadGap(x, z) < 3) continue
    mast.position.set(x, 20, z)
    root.add(mast)
    w.addPost(x, z, 0.6)
    lights.push(trs(x, 40.5, z, 0, 0.6))
    lightCols.push(new THREE.Color(4, 0.6, 0.4))
  }
  // spotlights inside, and festoons out from the peak
  for (let q = 0; q < 24; q++) {
    const a = (q / 24) * Math.PI * 2
    festoon(lights, lightCols, new THREE.Vector3(TOP.x, 34, TOP.z), new THREE.Vector3(TOP.x + Math.cos(a) * (TOP.r + 22), 2.5, TOP.z + Math.sin(a) * (TOP.r + 22)), 3, 2.2, d.rand)
  }
  const crowdSpots: [number, number, number, number][] = []
  for (let q = 0; q < 160; q++) {
    const a = d.rand() * Math.PI * 2, rr = TOP.r - 3 - d.rand() * 4, x = TOP.x + Math.cos(a) * rr, z = TOP.z + Math.sin(a) * rr
    if (d.roadGap(x, z) > 4) crowdSpots.push([x, 1.4 + (TOP.r - 3 - rr) * 0.6, z, a + Math.PI])
  }
  crowd(k, crowdSpots, [0xd83a6a, 0xffd24a, 0x3ab0e0, 0x2a2e3a, 0x8a3ad0, 0xe8e6e0])
}

/** A coaster car that runs the coaster with you on the last lap: a moving solid in the left lane. */
function coasterTrain(k: BuildKit): (on: boolean, t: number) => void {
  const { circuit: c, world: w, root } = k
  const track: number[] = []
  for (let i = 0; i < c.count; i++) if (c.raised[i] && !c.gap[i] && c.deck[i] === 4) track.push(i)
  const car = new Mesher()
  car.box(3.2, 1.2, 6, 0, 0.9, 0, 0xffd24a).box(3.4, 0.5, 6.4, 0, 0.3, 0, 0x2a2a34).box(3, 1, 0.4, 0, 1.9, -2.6, 0xd83a6a)
  const mesh = new THREE.Mesh(car.build(), surface('paint', { rough: 0.3 }))
  mesh.visible = false
  root.add(mesh)
  const solid: Solid = { x: 1e6, z: 1e6, r: 3.6, hx: 1.7, hz: 3.2, cos: 1, sin: 0, top: -1e6 }
  w.movers.push(solid)
  return (on, t) => {
    mesh.visible = on && track.length > 0
    if (!mesh.visible) { solid.top = -1e6; return }
    const u = (t * 0.045) % 1, i = track[Math.floor(u * track.length)]!
    const p = c.samples[i]!, r = c.rights[i]!, tg = c.tangents[i]!, lat = -(c.widths[i]! / 2 - 2.6)
    mesh.position.set(p.x + r.x * lat, p.y, p.z + r.z * lat)
    const yaw = Math.atan2(-tg.x, -tg.z)
    mesh.rotation.set(0, yaw, 0)
    solid.x = mesh.position.x
    solid.z = mesh.position.z
    solid.cos = Math.cos(yaw)
    solid.sin = Math.sin(yaw)
    solid.top = p.y + 2.5
  }
}
