import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, crowd, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { Solid } from '../World'
import type { BuildKit, TrackDef } from '../types'
import { arrows, gantry, glow, glowStreak, stands } from './parts'

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

/**
 * Midnight Carnival: down the midway between the stalls, then up the lift hill
 * and onto the coaster itself: a long drop, a camelback that throws you into
 * the air, and a launch off the end of the track over the flume pond. From the
 * second lap the fireworks start and the dodgems break out across the plaza.
 */
export const carnival: TrackDef = {
  id: 'carnival',
  name: 'Midnight Carnival',
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
    tod: 'night', generatedSky: true, top: [0.03, 0.02, 0.08], horizon: [0.2, 0.08, 0.22], mix: 0.85, stars: 1,
    fog: [0.1, 0.06, 0.14], fogDensity: 0.0016, fogBase: 4, fogFall: 0.03, sunGlow: 0,
    exposure: 1.4, sun: 0.9, hemi: 1.35, bloom: 0.62, wet: 0.35, headlights: 1, env: 0.7,
    grade: [1.18, 1.1, 0.012, 0.004, 0.02, 1.05, 0.98, 1.05, 0.38],
  },
  points: [
    [0, 1, 0],
    [110, 1, -6, { pad: 0 }],
    [196, 1, -34],
    [244, 1, -96],
    [246, 2, -164],
    [214, 8, -222, { raised: true, deck: 'steel', rail: 'LR' }],
    [156, 20, -258, { raised: true, deck: 'steel', rail: 'LR' }],
    [88, 30, -272, { raised: true, deck: 'steel', rail: 'LR' }],
    [24, 30, -262, { raised: true, deck: 'steel', rail: 'LR', pad: 0 }],
    [-36, 13, -240, { raised: true, deck: 'steel', rail: 'LR' }],
    [-88, 6, -214, { raised: true, deck: 'steel', rail: 'LR' }],
    [-138, 15, -188, { raised: true, deck: 'steel', rail: 'LR' }],
    [-188, 9, -156, { raised: true, deck: 'steel', rail: 'LR' }],
    [-236, 10, -112, { raised: true, deck: 'steel', rail: 'LR', bank: 5 }],
    [-262, 12, -56, { raised: true, deck: 'steel', rail: 'LR' }],
    [-262, 12, -4, { gap: true }],
    [-246, 2, 52],
    [-196, 1, 92],
    [-120, 1, 104, { pad: 0 }],
    [-60, 1, 78],
    [-36, 1, 34],
  ],
  ground(x, z) {
    const r = Math.hypot(x + 10, z + 80)
    const hills = smooth(330, 620, r) * (18 + fbm2(x * 0.006, z * 0.006) * 60)
    const pond = Math.max(0, 1 - Math.hypot((x + 262) / 46, (z + 4) / 34))
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
  surfaceAt: (x, z) => (Math.hypot((x + 262) / 46, (z + 4) / 34) < 1 ? 'mud' : 'grass'),
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Midnight Carnival', '#ffd24a')
    stands(k, 8, 44, -1, [0xd83a6a, 0xffd24a, 0x3ab0e0, 0x2a2e3a, 0x8a3ad0, 0xe8e6e0], 0xffd24a, 'Midnight Carnival')
    arrows(k, 0xffd24a)
    mountainRing(root, -10, -80, { inner: 900, outer: 2600, height: 260, rock: 0x2a2836, seed: 11 })
    forest(k, 'oak', d.spots(140, 30, 220, { clear: 14, test: (x, z) => Math.hypot(x + 10, z + 80) > 260 }), { scale: [0.8, 1.3], solid: 0, tints: [0x5a6a4a, 0x4a5a40] })
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
    pond.scale.set(46, 34, 1)
    pond.position.set(-262, -2.5, -4)
    root.add(pond)
    // a flume log ride's chute curling into the pond
    const flume = new Mesher()
    for (let q = 0; q < 26; q++) {
      const a = q * 0.22, x = -262 + Math.cos(a) * (60 + q * 0.6), z = -4 + Math.sin(a) * (44 + q * 0.4), y = 2 + q * 0.9
      if (d.roadGap(x, z) < 6) continue
      flume.box(4, 1.6, 7, x, y, z, 0x8a5a2a, -a)
      flume.post(0.25, 0.3, y, x, 0, z, 0x6a4a2a, 6)
    }
    place(k, flume, surface('wood'))

    // ── the Ferris wheel, turning, rimmed with lights
    const wheel = new THREE.Group()
    const WX = 130, WZ = 86, WR = 34, WY = WR + 6
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
    const CX = -132, CZ = 178
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

    // ── the big top
    const BX = 34, BZ = 170
    const tent = stripes('#c8243a', '#f6efe0', 32)
    tent.repeat.x = 3
    const tentMat = new THREE.MeshStandardMaterial({ map: tent, roughness: 0.8, side: THREE.DoubleSide })
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 9, 48, 1, true), tentMat)
    wall.position.set(BX, 4.5, BZ)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(42, 24, 48, 1, true), tentMat)
    roof.position.set(BX, 21, BZ)
    root.add(wall, roof)
    for (const [dx, dz] of [[0, 0], [-16, 0], [16, 0]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 40, 8), surface('paint'))
      mast.position.set(BX + dx!, 20, BZ + dz!)
      root.add(mast)
      lights.push(trs(BX + dx!, 40.5, BZ + dz!, 0, 0.6))
      lightCols.push(new THREE.Color(4, 0.6, 0.4))
    }
    w.addBox(BX, BZ, 38, 38)
    for (let q = 0; q < 24; q++) {
      const a = (q / 24) * Math.PI * 2
      festoon(lights, lightCols, new THREE.Vector3(BX, 38, BZ), new THREE.Vector3(BX + Math.cos(a) * 60, 2.5, BZ + Math.sin(a) * 60), 3, 2.2, d.rand)
    }

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

    // ── dodgems: a rink by the plaza, and from lap two they come out onto the road
    const DI = Math.floor(c.count * 0.9)
    const dp = c.samples[DI]!, dr = c.rights[DI]!
    const rink = new THREE.Vector3(dp.x + dr.x * 34, 0, dp.z + dr.z * 34)
    const rinkFloor = new Mesher()
    rinkFloor.box(30, 0.6, 22, rink.x, 0.3, rink.z, 0x3a3a48)
    for (const [sx, sz] of [[-15, -11], [15, -11], [-15, 11], [15, 11]]) rinkFloor.post(0.2, 0.2, 6, rink.x + sx!, 0, rink.z + sz!, 0xd8b040, 6)
    rinkFloor.box(31, 0.5, 23, rink.x, 6.2, rink.z, 0x6a2a8a)
    place(k, rinkFloor, surface('metal'))
    w.addBox(rink.x, rink.z, 15, 11)
    const DN = 6
    const carG = new Mesher()
    carG.box(1.8, 0.7, 2.6, 0, 0.6, 0, 0xffffff).box(2.2, 0.35, 3, 0, 0.3, 0, 0x2a2a2a).post(0.04, 0.04, 3, 0, 1, -1, 0x888888, 4)
    const dodgems = new THREE.InstancedMesh(carG.build(), surface('paint', { rough: 0.3 }), DN)
    for (let q = 0; q < DN; q++) dodgems.setColorAt(q, new THREE.Color(BULBS[q]!))
    dodgems.frustumCulled = false
    root.add(dodgems)
    const dSolids: Solid[] = Array.from({ length: DN }, () => ({ x: 0, z: 0, r: 1.6, top: 1e6 }))
    let dodgemsOut = false

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

      // dodgems: round the rink, then out over the plaza road from lap 2
      const out = f.lap >= 2
      if (out !== dodgemsOut) {
        dodgemsOut = out
        if (out) w.movers.push(...dSolids)
        else w.movers.splice(w.movers.indexOf(dSolids[0]!), DN)
      }
      for (let q = 0; q < DN; q++) {
        const ph = f.time * (0.35 + q * 0.04) + q * 1.7
        let x: number, z: number
        if (out && q % 2 === 0) {
          // a slow figure-eight that crosses the racing line
          const lat = Math.sin(ph) * (c.widths[DI]! / 2 + 4), along = Math.sin(ph * 2) * 10
          const t = c.tangents[DI]!
          x = dp.x + dr.x * lat + t.x * along
          z = dp.z + dr.z * lat + t.z * along
        } else {
          x = rink.x + Math.cos(ph) * 11
          z = rink.z + Math.sin(ph * 1.3) * 7
        }
        const s = dSolids[q]!
        const yaw = Math.atan2(x - s.x, z - s.z)
        s.x = x; s.z = z
        m4.compose(v3.set(x, Math.max(c.samples[DI]!.y, out && q % 2 === 0 ? dp.y : 0.6) - 0.1, z), q4.setFromEuler(e3.set(0, yaw, 0)), one)
        dodgems.setMatrixAt(q, m4)
      }
      dodgems.instanceMatrix.needsUpdate = true

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
