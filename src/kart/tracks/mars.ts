import * as THREE from 'three'
import { fbm2, lumpy, ridged2, smooth, trs } from '../../game/biomes/kit'
import { atmos } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef } from '../types'
import { arrows, crates, drift, gantry, glow, mist, stands } from './parts'

const CRATER = { x: 60, z: -240, r: 132 }
const DOMES = [
  { x: -125, z: 50, r: 46, road: true },
  { x: 70, z: 104, r: 34, road: false },
  { x: 176, z: 92, r: 24, road: false },
  { x: -10, z: 150, r: 22, road: false },
]

/** A geodesic glass dome: faint glass, a ribbed frame, lit from within. */
function dome(k: BuildKit, x: number, z: number, r: number): void {
  const { world: w, root } = k
  const y = w.terrainAt(x, z) - 0.5
  const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
    color: 0xc8e0e8, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.16, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false,
  }))
  glass.position.set(x, y, z)
  glass.renderOrder = 2
  root.add(glass)
  const ribs = new Mesher()
  const lat = 6, lon = 18
  for (let a = 0; a < lon; a++) for (let b = 0; b < lat; b++) {
    const t0 = (a / lon) * Math.PI * 2, t1 = ((a + 1) / lon) * Math.PI * 2
    const p0 = (b / lat) * Math.PI / 2, p1 = ((b + 1) / lat) * Math.PI / 2
    const P = (t: number, p: number) => new THREE.Vector3(x + Math.cos(t) * Math.cos(p) * r, y + Math.sin(p) * r, z + Math.sin(t) * Math.cos(p) * r)
    ribs.bar(P(t0, p0), P(t0, p1), 0.18, 0xd8dcdc, 4)
    ribs.bar(P(t0, p0), P(t1, p0), 0.14, 0xd8dcdc, 4)
    if (b % 2 === 0) ribs.bar(P(t0, p0), P(t1, p1), 0.08, 0xc8ccd0, 4)
  }
  ribs.add(new THREE.TorusGeometry(r, 0.8, 6, 48), trs(x, y + 0.4, z, 0, 1, Math.PI / 2), 0x8a8e94)
  place(k, ribs, surface('metal', { rough: 0.35, metal: 0.7 }), false)
}

/**
 * Mars Colony: dust roads between the domes and habitats, out to a crater you
 * leap into and out of again (gravity here is half of Earth's, so the jumps
 * last), then a glass tube that runs straight through the biggest dome. A
 * dust storm rolls in on the second lap and is thick by the last.
 */
export const mars: TrackDef = {
  id: 'mars',
  name: 'Mars Colony',
  ambience: 'desert',
  width: 17,
  bank: 2.4,
  shoulder: 12,
  accent: 0xff7a4a,
  gravity: 13,
  deck: 'dirt',
  road: { lines: 'plain', dirt: 'mud_cracked_dry_03', grime: 0x8a4a2a, tone: 0.95 },
  terrain: { layers: ['aerial_sand', 'mud_cracked_dry_03', 'volcanic_rock_tiles', 'moon_01'], tile: [26, 12, 18, 22], tints: [0xd8865a, 0xc87a50, 0xa86a52, 0xc88a6a] },
  far: 0x8a4a30,
  farY: -4,
  look: {
    tod: 'morning', generatedSky: true, top: [0.42, 0.28, 0.2], horizon: [0.86, 0.6, 0.42], mix: 0.92,
    fog: [0.8, 0.54, 0.38], fogDensity: 0.0009, fogBase: 6, fogFall: 0.006, sunGlow: 0.9,
    exposure: 1.02, sun: 1.15, hemi: 0.95, bloom: 0.3, shafts: 0.45, env: 0.8,
    grade: [1.06, 1.08, 0.012, 0.004, 0, 1.04, 0.98, 0.9, 0.3],
  },
  points: [
    [0, 2, 0],
    [120, 2, -4, { pad: 0 }],
    [222, 3, -36],
    [272, 8, -108],
    [252, 16, -186],
    [198, 22, -226],
    [138, 20, -244, { gap: true }],
    [76, 4, -248],
    [16, 3, -236, { pad: 0 }],
    [-36, 14, -240],
    [-92, 15, -236, { gap: true }],
    [-150, 3, -212],
    [-218, 4, -156],
    [-252, 6, -82],
    [-228, 8, -16, { raised: true, deck: 'glass', rail: 'LR' }],
    [-182, 6, 26, { raised: true, deck: 'glass', rail: 'LR' }],
    [-125, 3, 50, { deck: 'steel' }],
    [-72, 2, 46],
    [-36, 2, 14],
  ],
  ground(x, z) {
    const n = fbm2(x * 0.008, z * 0.008)
    const rcr = Math.hypot(x - CRATER.x, z - CRATER.z) / CRATER.r
    const bowl = -9 * smooth(1, 0.2, rcr)
    const rim = 22 * Math.exp(-((rcr - 1) ** 2) / 0.02)
    const mesas = smooth(0.55, 0.62, ridged2(x * 0.0022, z * 0.0022, 3)) * 70 * smooth(420, 600, Math.hypot(x, z + 60))
    const small = Math.max(0, 1 - Math.hypot((x + 320) / 40, (z - 160) / 40)) * -8
    return n * 6 - 1 + bowl + rim + mesas + small
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.4, 0.8, slope)
    mix[0] = (1 - rock) * 0.8
    mix[1] = (1 - rock) * smooth(0.45, 0.6, fbm2(x * 0.02, z * 0.02))
    mix[2] = rock
    mix[3] = smooth(10, 3, roadDist) * 0.5 + smooth(10, 30, h) * 0.3
    tint.setRGB(1, 0.97, 0.94)
  },
  surfaceAt: () => 'sand',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Mars Colony', '#ff7a4a')
    stands(k, 8, 40, -1, [0xe86a3a, 0xe8e6e0, 0x3a5a7a, 0xd8b03a, 0x2a2e38], 0xff7a4a, 'Ares Base')
    arrows(k, 0xff9a5a)
    mountainRing(root, 0, -60, { inner: 1100, outer: 3000, height: 380, rock: 0x9a5a3a, seed: 31 })

    // ── domes; the big one has a garden inside and the road runs through it
    for (const dm of DOMES) dome(k, dm.x, dm.z, dm.r)
    const big = DOMES[0]!
    const inside = (x: number, z: number) => Math.hypot(x - big.x, z - big.z) < big.r - 6
    forest(k, 'oak', d.spots(26, 6, 30, { clear: 6, test: (x, z) => inside(x, z) }), { scale: [0.55, 0.85], tints: [0xa8d088, 0x98c478] })
    grass(k, { density: 4, reach: 30, height: [0.4, 0.9], colors: [0x6a9a48, 0x5a8a40, 0x7aa858], test: (x, z) => inside(x, z) })
    // the dome's glass edge is solid except where the road goes in and out
    for (const dm of DOMES) for (let q = 0; q < 72; q++) {
      const a = (q / 72) * Math.PI * 2, x = dm.x + Math.cos(a) * dm.r, z = dm.z + Math.sin(a) * dm.r
      if (d.roadGap(x, z) > 2) w.addPost(x, z, 1.4)
    }
    // airlock portals where the road meets the glass
    const locks = new Mesher()
    for (let i = 0; i < c.count; i += 1) {
      const p = c.samples[i]!, dd = Math.hypot(p.x - big.x, p.z - big.z)
      const q = c.samples[(i + 1) % c.count]!, dq = Math.hypot(q.x - big.x, q.z - big.z)
      if ((dd - big.r) * (dq - big.r) > 0) continue
      const t = c.tangents[i]!, r = c.rights[i]!, half = c.widths[i]! / 2 + 1.2, yaw = Math.atan2(-t.x, -t.z)
      for (const s of [-1, 1]) locks.box(1.4, 9, 3, p.x + r.x * s * half, p.y + 4.5, p.z + r.z * s * half, 0xe8e6e0, yaw)
      locks.box(half * 2 + 1.4, 1.4, 3, p.x, p.y + 9, p.z, 0xe8e6e0, yaw)
      locks.box(half * 2 + 1.6, 0.4, 3.2, p.x, p.y + 8, p.z, 0xff7a4a, yaw)
    }
    place(k, locks, surface('paint'))

    // the glass tube: hoops and panes over the raised road
    const tube = new Mesher()
    for (let i = 0; i < c.count; i += 4) {
      if (c.deck[i] !== 5) continue
      const p = c.samples[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2 + 1
      tube.add(new THREE.TorusGeometry(half + 0.3, 0.22, 6, 24, Math.PI), trs(p.x, p.y - 0.4, p.z, Math.atan2(-t.x, -t.z), 1), 0xd8dcdc)
      if (i % 12 === 0) tube.post(0.5, 0.6, p.y - w.terrainAt(p.x, p.z), p.x, w.terrainAt(p.x, p.z), p.z, 0xa8acb0, 8)
    }
    place(k, tube, surface('metal', { rough: 0.3, metal: 0.7 }), false)
    // ── the colony: habitats, a rover, a deep-space dish, a rocket on its pad
    void d.buildings('nasa/habitat1.glb', [{ x: 30, z: 60, yaw: 0.4 }, { x: 120, z: 46, yaw: 2 }, { x: -60, z: 96, yaw: 1.1 }], 9)
    void d.buildings('nasa/habitat2.glb', [{ x: 230, z: 40, yaw: -0.6 }, { x: -170, z: -40, yaw: 2.4 }, { x: 70, z: -60, yaw: 0.2 }], 8)
    const near = (x: number, z: number, h = 0) => trs(x, w.terrainAt(x, z) + h, z, 0)
    void d.scaled('nasa/perseverance.glb', [trs(160, w.terrainAt(160, -60), -60, 2.1)], 7)
    void d.scaled('nasa/dsn34.glb', [near(330, -10)], 42)
    w.addPost(330, -10, 10)
    void d.scaled('nasa/saturn_v.glb', [trs(380, w.terrainAt(380, -330), -330, 0)], 110)
    w.addPost(380, -330, 12)
    // solar fields: rows of tilted panels
    const panels: THREE.Matrix4[] = [], legs = new Mesher()
    for (const [fx, fz, rows, cols] of [[60, 10, 4, 10], [-60, -120, 5, 8], [180, -150, 4, 6]] as const) {
      for (let a = 0; a < rows; a++) for (let b = 0; b < cols; b++) {
        const x = fx + b * 7, z = fz + a * 9, y = w.terrainAt(x, z)
        if (d.roadGap(x, z) < 8) continue
        panels.push(trs(x, y + 1.8, z, 0, new THREE.Vector3(6, 0.12, 3.6), 0.5))
        legs.post(0.08, 0.08, 1.8, x, y, z, 0x8a8e94, 5)
      }
      w.addBox(fx + cols * 3.5, fz + rows * 4.5, cols * 3.5, rows * 4.5)
    }
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.15, metalness: 0.6, envMapIntensity: 1.6 })
    d.instanced(new THREE.BoxGeometry(1, 1, 1), panelMat, panels, false)
    place(k, legs, surface('metal'), false)
    // landing pad by the start, ringed with lights
    const pad = new Mesher(), padLights: THREE.Matrix4[] = []
    const PX = 110, PZ = 60
    pad.add(new THREE.CylinderGeometry(24, 25, 1.2, 40), trs(PX, w.terrainAt(PX, PZ) + 0.2, PZ), 0x5a5e64)
    for (let q = 0; q < 24; q++) padLights.push(trs(PX + Math.cos(q * 0.2618) * 23, w.terrainAt(PX, PZ) + 1, PZ + Math.sin(q * 0.2618) * 23, 0, 0.3))
    place(k, pad, surface('concrete'), false)
    d.instanced(new THREE.SphereGeometry(1, 6, 4), glow(4, 1.4, 0.4), padLights, false)
    void d.scaled('nasa/lunar_module.glb', [trs(PX, w.terrainAt(PX, PZ) + 0.8, PZ, 0.7)], 10)
    w.addPost(PX, PZ, 5)
    // comms masts with blinking tips
    const masts = new Mesher(), tips: THREE.Matrix4[] = []
    for (const [x, z] of [[40, -40], [-90, 10], [200, 20], [-30, -180], [260, -260]] as const) {
      const y = w.terrainAt(x, z)
      for (const [a, b] of [[-1, -1], [1, -1], [0, 1]]) masts.bar(new THREE.Vector3(x + a! * 1.4, y, z + b! * 1.4), new THREE.Vector3(x, y + 28, z), 0.1, 0xd8dcdc, 4)
      tips.push(trs(x, y + 28.6, z, 0, 0.6))
      w.addPost(x, z, 1.4)
    }
    place(k, masts, surface('metal'), false)
    const tipMat = glow(4, 0.4, 0.3)
    d.instanced(new THREE.SphereGeometry(1, 6, 4), tipMat, tips, false)

    // ── the land: boulders, rock outcrops, ripples of loose dust
    const rock = lumpy(new THREE.IcosahedronGeometry(1, 2), 0.3, 1.6, 9)
    const rocks = new Mesher()
    for (const s of d.spots(140, 6, 120, { clear: 6 })) {
      const sz = 0.8 + d.rand() * d.rand() * 6
      rocks.add(rock, trs(s.x, s.y + sz * 0.2, s.z, d.rand() * 6, new THREE.Vector3(sz, sz * (0.5 + d.rand() * 0.4), sz * (0.8 + d.rand() * 0.4))), [0x8a4a32, 0x7a3e2a, 0x9a5a3e][Math.floor(d.rand() * 3)]!)
      if (sz > 2.5 && d.roadGap(s.x, s.z) < 40) w.addPost(s.x, s.z, sz * 0.7)
    }
    place(k, rocks, surface('rock'))
    d.prop('bk:namaqualand_boulder_03', d.spots(30, 8, 80, { clear: 8 }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 1.6 + d.rand() * 2)), 1, new THREE.Color(1, 0.62, 0.48))
    d.prop('moon_rock_03', d.spots(40, 4, 60, { clear: 5 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2 + d.rand() * 3)), 0.9, new THREE.Color(0.95, 0.55, 0.4))
    crates(d, d.spots(14, 2, 8, { from: 0.85, to: 0.98, clear: 1.6 }), 0xd8d4cc)

    // two small moons hang in the sky
    for (const [dx, dy, dz, s] of [[-900, 520, -1400, 34], [1200, 340, -900, 20]] as const) {
      const m = new THREE.Mesh(lumpy(new THREE.IcosahedronGeometry(1, 3), 0.2, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1, fog: false }))
      m.position.set(dx, dy, dz)
      m.scale.set(s, s * 0.8, s * 0.9)
      root.add(m)
    }

    // ── the storm: dust devils wander, the air thickens lap by lap
    const devils = Array.from({ length: 5 }, (_, q) => ({ x: -200 + q * 110, z: -100 + (q % 2) * 160, ph: q * 1.7 }))
    const devilMat = new THREE.MeshBasicMaterial({ color: 0xc88a60, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
    const devilMeshes = devils.map(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(9, 2, 60, 18, 6, true), devilMat)
      root.add(m)
      return m
    })
    mist(k, d.spots(20, 30, 200, { clear: 20 }).map((s) => s.setY(s.y + 6)), [60, 120], 0xd8a078, 0.18)
    const dust = drift(k, 220, 0xd89a70, 1.4, -2)
    const dm = dust.material as THREE.PointsMaterial
    const base = mars.look.fogDensity
    k.onFrame((f) => {
      tipMat.color.setRGB(Math.sin(f.time * 3) > 0.6 ? 5 : 0.4, 0.3, 0.2)
      const storm = Math.max(0, f.lap - 1) / Math.max(1, f.totalLaps - 1)
      const fog = base * (1 + storm * 2.4)
      atmos.params.x = fog
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      if (sceneFog) sceneFog.density = fog
      dm.opacity = 0.25 + storm * 0.6
      devils.forEach((dv, q) => {
        const m = devilMeshes[q]!
        m.position.set(dv.x + Math.sin(f.time * 0.07 + dv.ph) * 120, w.terrainAt(dv.x, dv.z) + 30, dv.z + Math.cos(f.time * 0.05 + dv.ph) * 90)
        m.rotation.y = f.time * 2
      })
      devilMat.opacity = 0.12 + storm * 0.18
    })
  },
}
