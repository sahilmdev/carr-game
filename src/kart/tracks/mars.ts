import * as THREE from 'three'
import { fbm2, lumpy, ridged2, smooth, softDot, trs } from '../../game/biomes/kit'
import { atmos } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef } from '../types'
import type { Zone } from '../World'
import type { Circuit } from '../Circuit'
import { arrows, brokenLips, crates, drift, gantry, glow, mist, stands, zoneFx } from './parts'

const CRATER = { x: 290, z: -487, r: 160 }
const MESA = { x: -455, z: -470, r: 165, edge: 240, h: 46 }
const RIFT = { x: -26, z0: -1150, z1: -730 }
const DOMES = [
  { x: -200, z: 74, r: 46, road: true },
  { x: 70, z: 110, r: 34, road: false },
  { x: 180, z: 100, r: 24, road: false },
  { x: -20, z: 170, r: 22, road: false },
]

/** A geodesic glass dome: faint glass, a ribbed frame, lit from within. */
function dome(k: BuildKit, x: number, z: number, r: number, inside = false): void {
  const { world: w, root } = k
  const y = w.terrainAt(x, z) - 0.5
  const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
    color: 0xc8e0e8, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.16, envMapIntensity: 2.2, side: inside ? THREE.DoubleSide : THREE.FrontSide, depthWrite: false,
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

/*
 * Mars Colony, in low gravity. Out of the colony and across the plain to the
 * crater: leap in off the north rim, cross the floor, and launch out over the
 * south rim (or keep to the rim road round the east side). West along the
 * canyon to the rift, which only a boost clears, then the long climb up the
 * mesa and a glide off its edge, floating in the thin gravity (or the lava
 * tube through the mesa underneath). Home through the glass tube and the big
 * dome.
 *
 * Lap 2: the dust storm rolls in and dunes drift over the road. Last lap: the
 * storm is thick and the rocket on the far pad launches.
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
  maxBank: 0.36,
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
    [0.0, 2, 0.0, { w: 20 }],
    [162.4, 2, -4.6, { pad: 0 }],
    [313.2, 3, -34.8, { items: true }],
    [452, 4, -40],
    [520, 6, -150],
    [452, 8, -222],
    [371.2, 12, -249.4],
    [310.9, 22, -306.2, { rail: '' }],
    [299.3, 20, -373.5, { gap: true }],
    [290.0, 2, -443.1, { w: 22 }],
    // the crater bowl: a steep banked sweep round the east wall of the crater
    [318, 3, -458, { w: 22, bank: 12 }],
    [346, 6, -490, { w: 22, bank: 12, items: true }],
    [336, 7, -532, { w: 22, bank: 12 }],
    [302, 7, -560, { w: 20, bank: 8 }],
    [290.0, 13, -597.4],
    [292.3, 15, -661.2, { gap: true }],
    [297.0, 3, -737.8, { w: 22 }],
    // the canyon floor: a half-pipe between the rock walls. Ride up a wall and
    // swoop back down for a burst of speed
    [208.8, 2, -817.8, { pipe: 4 }],
    [145, 2, -830, { pipe: 6.5, w: 20, items: true }],
    [81.2, 2, -837.5, { pad: 0 }],
    [34.8, 2, -838.7, { rail: '', pad: 0 }],
    [-10.0, 5.6, -839.7, { gap: true }],
    [-50.0, 3.6, -840.7, { gap: true }],
    [-94.0, 1.3, -841.7, { w: 22 }],
    [-197.2, 2, -812.0],
    [-290.0, 8, -748.2],
    [-382.8, 27, -655.4],
    [-443.1, 43.5, -539.4],
    [-454.7, 46, -429.2, { items: true }],
    [-447.8, 46, -348.0, { pad: 0, rail: '' }],
    [-445.8, 47, -336.0, { gap: true, glide: true }],
    [-439.8, 39, -286.0, { gap: true, glide: true }],
    [-433.8, 30, -236.0, { gap: true, glide: true }],
    [-429.8, 23, -204.0, { gap: true, glide: true }],
    [-425.8, 18, -172.0, { raised: true, w: 28 }],
    [-388.6, 6, -46.4],
    [-303.9, 4, 34.8],
    [-249.4, 6, 60.3, { raised: true, deck: 'glass', rail: 'LR' }],
    [-197.2, 3, 76.6, { deck: 'steel' }],
    [-127.6, 2, 71.9],
    [-63.8, 2, 34.8],
  ],
  branches: [
    {
      // round the crater's east rim: no leaps, a little further
      name: 'Rim road', from: 6, to: 16, odds: 0.35,
      points: [
        [445, 14, -360],
        [482, 16, -490, { items: true }],
        [452, 14, -640],
      ],
    },
    {
      // the lava tube: straight through the mesa, no climb, in the dark
      name: 'Lava tube', from: 24, to: 35, odds: 0.4,
      points: [
        [-222, 3, -700],
        [-282, 3, -598],
        [-330, 3, -480, { tunnel: true, rail: 'LR' }],
        [-345, 3, -372, { tunnel: true, rail: 'LR' }],
        [-346, 4, -268],
        [-352, 5, -160, { pad: 0 }],
      ],
    },
  ],

  ground(x, z) {
    const n = fbm2(x * 0.008, z * 0.008)
    const rcr = Math.hypot(x - CRATER.x, z - CRATER.z) / CRATER.r
    const bowl = -9 * smooth(1, 0.2, rcr)
    const rim = 22 * Math.exp(-((rcr - 1) ** 2) / 0.02)
    const mesas = smooth(0.55, 0.62, ridged2(x * 0.0022, z * 0.0022, 3)) * 70 * smooth(1150, 1400, Math.hypot(x + 60, z + 380))
    const small = Math.max(0, 1 - Math.hypot((x + 320) / 40, (z - 220) / 40)) * -8
    // the mesa: a flat top with cliffs round it
    const rm = Math.hypot(x - MESA.x, z - MESA.z)
    const mesa = MESA.h * smooth(MESA.edge, MESA.r, rm + fbm2(x * 0.01, z * 0.01) * 20)
    // the rift: a deep crack running north-south across the canyon road
    const along = smooth(RIFT.z0 - 60, RIFT.z0 + 60, z) * smooth(RIFT.z1 + 60, RIFT.z1 - 20, z)
    const rift = -38 * smooth(30, 10, Math.abs(x - RIFT.x + Math.sin(z * 0.012) * 6)) * along
    return Math.max(n * 6 - 1 + bowl + rim + mesas + small + rift, mesa > 1 ? mesa + n * 2 : -1e9)
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
    // where the road breaks off over the rift and the crater: a ragged lip, not a clean cut
    brokenLips(k, 0x8a4a2e, 0x3a2e2a)
    mountainRing(root, -60, -380, { inner: 1300, outer: 3200, height: 380, rock: 0x9a5a3a, seed: 31 })

    // ── domes; the big one has a garden inside and the road runs through it
    for (const dm of DOMES) dome(k, dm.x, dm.z, dm.r, dm.road)
    const big = DOMES[0]!
    const inside = (x: number, z: number) => Math.hypot(x - big.x, z - big.z) < big.r - 6
    forest(k, 'oak', d.spots(26, 6, 30, { clear: 6, test: (x, z) => inside(x, z) }), { scale: [0.55, 0.85], tints: [0xa8d088, 0x98c478] })
    grass(k, { density: 2.5, reach: 30, height: [0.4, 0.9], colors: [0x6a9a48, 0x5a8a40, 0x7aa858], test: (x, z) => inside(x, z) })
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

    lavaTube(k, c.branches[1]!)
    craterBowl(k)

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
    void d.scaled('nasa/dsn34.glb', [near(330, 100)], 42)
    w.addPost(330, 100, 10)
    const RX = 640, RZ = -260
    const rocket = new THREE.Group()
    const rocketY = w.terrainAt(RX, RZ)
    rocket.position.set(RX, rocketY, RZ)
    root.add(rocket)
    d.wait(d.model('nasa/saturn_v.glb').then((m) => {
      if (!m) return
      const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
      m.scale.setScalar(110 / Math.max(size.x, size.y, size.z, 0.001))
      rocket.add(m)
    }))
    w.addPost(RX, RZ, 12)
    // solar fields: rows of tilted panels
    const panels: THREE.Matrix4[] = [], legs = new Mesher()
    for (const [fx, fz, rows, cols] of [[60, 20, 4, 10], [-60, -140, 5, 8], [180, -170, 4, 6]] as const) {
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
    for (const [x, z] of [[40, -40], [-90, 10], [200, 30], [-30, -200], [120, -560], [-150, -600]] as const) {
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
    // dust devils: from lap 2 they wander back and forth across the road and
    // swirl anything inside them round and sideways
    const devils = [0.12, 0.3, 0.47, 0.64, 0.86].map((u, q) => {
      const i = Math.floor(c.count * u), p = c.samples[i]!, r = c.rights[i]!
      const zone: Zone = { x: p.x, z: p.z, r: 10, y0: p.y - 4, y1: p.y + 30, swirl: 11, pull: 2.5, air: true, on: false }
      w.zones.push(zone)
      return { x: p.x, z: p.z, rx: r.x, rz: r.z, ph: q * 1.7, zone }
    })
    const devilMat = new THREE.MeshBasicMaterial({ color: 0xc88a60, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
    const devilMeshes = devils.map(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(9, 2, 60, 18, 6, true), devilMat)
      root.add(m)
      return m
    })
    mist(k, d.spots(12, 30, 200, { clear: 20 }).map((s) => s.setY(s.y + 6)), [50, 100], 0xd8a078, 0.22)
    const dust = drift(k, 220, 0xd89a70, 1.4, -2)
    const dm = dust.material as THREE.PointsMaterial
    const base = mars.look.fogDensity
    // dunes that drift across the open road once the storm is in: soft sand, slow
    const dunes: { x: number; z: number; r: number; surface: 'sand'; on: boolean }[] = []
    const duneMat = new THREE.MeshStandardMaterial({ color: 0xc8805a, roughness: 1 })
    const duneMeshes: THREE.Mesh[] = []
    for (const fr of [0.09, 0.4, 0.6, 0.93]) {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
      const off = (fr * 10 % 2 < 1 ? 1 : -1) * c.widths[i]! * 0.22
      const patch = { x: p.x + r.x * off, z: p.z + r.z * off, r: 7, surface: 'sand' as const, on: false }
      dunes.push(patch)
      w.patches.push(patch)
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), duneMat)
      m.scale.set(8, 0.6, 5)
      m.rotation.y = Math.atan2(r.x, r.z)
      m.position.set(patch.x, p.y - 0.1, patch.z)
      m.visible = false
      root.add(m)
      duneMeshes.push(m)
    }
    const plume = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 1), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }))
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0xd8c8b8, roughness: 1, transparent: true, opacity: 0.75, depthWrite: false }))
    plume.visible = smoke.visible = false
    root.add(plume, smoke)
    let launchAt = -1
    const blast: Zone = { x: RX, z: RZ, r: 330, y0: -1e5, y1: 1e5, pull: -7, air: true, on: false }
    w.zones.push(blast)
    k.onFrame((f) => {
      tipMat.color.setRGB(Math.sin(f.time * 3) > 0.6 ? 5 : 0.4, 0.3, 0.2)
      const dusty = f.lap >= 2
      dunes.forEach((dn, q) => { dn.on = dusty; duneMeshes[q]!.visible = dusty })
      // the last lap: the rocket goes
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      if (!last) launchAt = -1
      else if (launchAt < 0) launchAt = f.time
      const lt = last ? f.time - launchAt : -1
      const lift = lt > 4 ? (lt - 4) ** 2 * 1.6 : 0
      // the blast as it lights and climbs away: a shove outward across the plain
      blast.on = lt > 3 && lt < 11
      blast.pull = -9 * Math.max(0, 1 - Math.abs(lt - 5) / 6)
      rocket.position.y = rocketY + lift
      plume.visible = lt > 0 && lift < 2500
      smoke.visible = lt > 0
      if (lt > 0) {
        plume.position.set(RX, rocketY + lift - 40, RZ)
        plume.rotation.x = Math.PI
        smoke.position.set(RX, rocketY + 10, RZ)
        smoke.scale.setScalar(Math.min(120, 20 + lt * 12))
        ;(smoke.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.75 - lt * 0.012)
      }
      const storm = Math.max(0, f.lap - 1) / Math.max(1, f.totalLaps - 1)
      const fog = base * (1 + storm * 2.4)
      atmos.params.x = fog
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      if (sceneFog) sceneFog.density = fog
      dm.opacity = 0.25 + storm * 0.6
      devils.forEach((dv, q) => {
        const m = devilMeshes[q]!
        const lat = f.lap >= 2 ? Math.sin(f.time * 0.22 + dv.ph) * 34 : 90 + Math.sin(f.time * 0.1 + dv.ph) * 40
        const x = dv.x + dv.rx * lat, z = dv.z + dv.rz * lat
        m.position.set(x, w.terrainAt(x, z) + 30, z)
        dv.zone.x = x
        dv.zone.z = z
        dv.zone.on = f.lap >= 2
        m.rotation.y = f.time * 2
      })
      devilMat.opacity = 0.12 + storm * 0.18
    })
  },
}

/** The lava tube: a basalt arch the whole way through the mesa, lava glowing in the cracks at its foot. */
function lavaTube(k: BuildKit, tube: Circuit): void {
  const { d, root } = k
  const shell = new Mesher(), seams: THREE.Matrix4[] = []
  const N = 9
  for (let i = 0; i < tube.count; i += 2) {
    if (!tube.tunnel[i]) continue
    const p = tube.samples[i]!, r = tube.rights[i]!, t = tube.tangents[i]!
    const R = tube.widths[i]! / 2 + 2.5, yaw = Math.atan2(-t.x, -t.z)
    for (let q = 0; q <= N; q++) {
      const a = (q / N) * Math.PI, ca = Math.cos(a), sa = Math.sin(a)
      const x = p.x + r.x * ca * R, z = p.z + r.z * ca * R, y = p.y - 0.6 + sa * R * 0.75
      const tone = [0x3a2622, 0x2e1e1c, 0x44302a][(i + q) % 3]!
      shell.add(new THREE.BoxGeometry(3.8, 1.4, 4.6), trs(x, y, z, 0, 1).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, a - Math.PI / 2, 'YXZ'))), tone)
    }
    if (i % 4 === 0) for (const s of [-1, 1]) seams.push(trs(p.x + r.x * s * (R - 1.2), p.y + 0.3, p.z + r.z * s * (R - 1.2), yaw, new THREE.Vector3(0.5, 0.25, 3.6)))
  }
  place(k, shell, surface('rock'))
  d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.4, 0.3), toneMapped: false }), seams, false)
  // a warm light pooled on the floor every so often
  const pool = softDot()
  for (let i = 0; i < tube.count; i += 24) {
    if (!tube.tunnel[i]) continue
    const p = tube.samples[i]!
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pool, color: 0xff6a30, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.position.set(p.x, p.y + 1.5, p.z)
    sp.scale.setScalar(16)
    root.add(sp)
  }
}

/**
 * The crater bowl: a sea-wall of red rock built up round the outside of the
 * banked sweep, and a push along the road for anyone riding high on the
 * outside, so the brave line round the wall slings you on to the launch.
 */
function craterBowl(k: BuildKit): void {
  const c = k.circuit
  const wall = new Mesher()
  const zones: Zone[] = []
  for (let i = 0; i < c.count; i++) {
    const p = c.samples[i]!
    if (Math.hypot(p.x - CRATER.x, p.z - CRATER.z) > 90 || Math.abs(c.banks[i]!) < 0.16 || c.gap[i]) continue
    const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    // the outside of the bend is the high side of the bank
    const sd = Math.sign(c.banks[i]!) || 1, rise = half * Math.tan(Math.abs(c.banks[i]!))
    if (i % 2 === 0) {
      wall.box(3, rise + 5, 2.6, p.x + r.x * sd * (half + 1.4), p.y + (rise + 5) / 2 - 1.5, p.z + r.z * sd * (half + 1.4), 0x9a4a2a, yaw, 0, -sd * 0.35)
      if (i % 6 === 0) wall.box(0.5, 0.3, 2.8, p.x + r.x * sd * (half - 0.4), p.y + rise + 0.1, p.z + r.z * sd * (half - 0.4), 0xf0e6d8, yaw)
    }
    if (i % 8 === 0) {
      const lat = sd * half * 0.55
      const z: Zone = { x: p.x + r.x * lat, z: p.z + r.z * lat, r: 0, hx: half * 0.45, hz: 9, cos: Math.cos(yaw), sin: Math.sin(yaw), y0: p.y - 2, y1: p.y + rise + 4, vx: -Math.sin(yaw) * 8, vz: -Math.cos(yaw) * 8, on: true }
      k.world.zones.push(z)
      zones.push(z)
    }
  }
  place(k, wall, surface('rock', { rough: 0.9 }))
  zoneFx(k, zones, 0xffb07a, 0.6, 30)
}
