import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, softDot, trs } from '../../game/biomes/kit'
import { atmos } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import { arrows, crates, drift, edgeLights, gantry, glow, mist, movingDeck, roadZones, zoneFx } from './parts'

/*
 * Storm Coast, the last race. Out of the harbour village and up the cliff
 * road to the lighthouse on the headland (or through the old tunnel under
 * it), down onto the sea bridge and over the drawbridge, which lifts every
 * so often and turns into a ramp. Across the island and back along the low
 * breakwater, where the waves come over the road, and home to the harbour.
 *
 * Lap 1 is a grey, calm evening. Lap 2: rain, wind and the first lightning.
 * Last lap: the full storm. Lightning lights up the whole coast, the waves
 * over the breakwater shove you sideways and the drawbridge opens more often.
 */

const S = 1.42
const SEA = 0
const HEAD = { x: 180, z: -620, r: 200 }
const ISLE = { x: 350, z: 90, r: 150 }
const LIGHT = { x: 250, z: -690 }

const coast = (z: number) => 40 + 30 * Math.sin(z * 0.008)

/** The coast in unscaled metres: mainland to the west, the headland north-east, the island south-east. */
function shore(x: number, z: number): number {
  const n = fbm2(x * 0.02, z * 0.02)
  // the mainland, rising northward to the cliff tops
  const land = smooth(70, 20, x - coast(z))
  const hm = 4 + smooth(-100, -560, z) * 44 + smooth(-30, -260, x) * 22 + n * 6
  let h = THREE.MathUtils.lerp(-12, hm, land)
  // the headland: a plateau with sheer sides
  const dh = Math.hypot(x - HEAD.x, z - HEAD.z) / HEAD.r
  h = Math.max(h, THREE.MathUtils.lerp(50 + n * 4, -12, smooth(0.8, 1.0, dh)))
  // the island
  const di = Math.hypot(x - ISLE.x, z - ISLE.z) / ISLE.r
  h = Math.max(h, THREE.MathUtils.lerp(20 * (1 - di * di * 0.6) + n * 3, -12, smooth(0.85, 1.0, di)))
  return h
}

const pt = (x: number, y: number, z: number, o?: TrackPoint[3]): TrackPoint => [x * S, y, z * S, o]

const BRIDGE = { raised: true, rail: 'LR', deck: 'steel' } as const
const POINTS: TrackPoint[] = [
  // 0: the harbour quay, heading north
  pt(0, 4, 0, { w: 18 }),
  pt(10, 5, -140, { pad: 0 }),
  // 2: the cliff road, climbing
  pt(-25, 14, -280),
  pt(-50, 30, -410, { items: true }), // 3: the old tunnel leaves here
  pt(10, 44, -530, { bank: 3 }),
  // 5: over the headland, round the lighthouse
  pt(110, 50, -600),
  pt(230, 50, -590, { items: true }), // 6: the tunnel rejoins
  // 7: down onto the sea bridge
  pt(300, 42, -480, BRIDGE),
  pt(318, 32, -380, BRIDGE),
  pt(322, 28, -300, BRIDGE),
  pt(323, 28, -262, BRIDGE),
  // 11: the drawbridge
  pt(325, 28, -241, { ...BRIDGE, gap: true }),
  pt(326, 28, -220, BRIDGE),
  pt(328, 27.5, -150, { ...BRIDGE, pad: 0 }),
  pt(330, 24, -70, BRIDGE),
  // 15: over the island
  pt(325, 17, 20),
  pt(290, 12, 130, { items: true }),
  // 17: the breakwater, low over the sea
  pt(210, 3.2, 210, { rail: 'R' }),
  pt(90, 3.2, 250, { rail: 'R' }),
  // 19: up into the village and back to the harbour
  pt(-30, 4, 240),
  pt(-110, 9, 150),
  pt(-80, 6, 60),
]

export const storm: TrackDef = {
  id: 'storm',
  name: 'Storm Coast',
  ambience: 'coast',
  width: 17,
  bank: 2.4,
  shoulder: 16,
  accent: 0x7ab4d8,
  sea: SEA,
  water: { deep: 0x0c1a24, shallow: 0x3a5a64, foam: 0xe8f0f2, waves: 1.3 },
  far: 0x1a2228,
  farY: -14,
  rails: 'steel',
  road: { lines: 'circuit', kerbColors: [0xe8e8e4, 0x2a5a8a], grime: 0x3a3e40, edgeLine: 0xf0f0ec, tone: 0.95, sheen: 0.35, lift: 0.2 },
  terrain: { layers: ['grass', 'rock_pitted_mossy', 'coast_sand_01', 'brown_mud_leaves_01'], tile: [22, 16, 14, 12], tints: [0x7a8a6a, 0x8a8e90, 0xb0aca0, 0x6a6a5a] },
  look: {
    tod: 'sunset', generatedSky: true, top: [0.16, 0.19, 0.24], horizon: [0.5, 0.52, 0.56], mix: 0.9, stars: 0,
    fog: [0.34, 0.38, 0.43], fogDensity: 0.0013, fogBase: 30, fogFall: 0.012, sunGlow: 0.2,
    exposure: 1.3, sun: 0.75, hemi: 1.75, bloom: 0.38, shafts: 0.1, wet: 0.35, headlights: 0.6, env: 0.9,
    grade: [0.92, 1.1, 0.012, 0.014, 0.02, 0.98, 1.0, 1.04, 0.34],
  },
  points: POINTS,
  branches: [
    {
      // the old tunnel under the headland: out of the weather, but narrow and dark
      name: 'Cliff tunnel', from: 3, to: 6, odds: 0.45,
      points: [
        pt(30, 34, -470, { tunnel: true, rail: 'LR', w: 13 }),
        pt(120, 38, -520, { tunnel: true, rail: 'LR', w: 13, pad: 0 }),
        pt(190, 44, -545, { tunnel: true, rail: 'LR', w: 13 }),
      ],
    },
  ],
  ground(x, z) {
    return shore(x / S, z / S)
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.55, 1.0, slope)
    const sand = 1 - smooth(SEA + 1.5, SEA + 5, h)
    const mud = smooth(0.5, 0.65, fbm2(x * 0.02, z * 0.02)) * (1 - sand)
    mix[0] = (1 - rock) * (1 - sand) * (1 - mud)
    mix[1] = rock
    mix[2] = sand
    mix[3] = mud * (1 - rock) + smooth(7, 2, roadDist) * 0.4
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'grass',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Storm Coast', '#7ab4d8')
    arrows(k, 0xe8f0ff)
    mountainRing(root, 100, -250, { inner: 1500, outer: 3400, height: 380, base: -30, rock: 0x3a4248, seed: 61 })
    // the road is lit the whole way round: in the storm it's what you steer by
    edgeLights(k, new THREE.Color(0.85, 0.92, 1), { spacing: 16, pool: 0.2 })

    const land = (_x: number, _z: number, y: number) => y > SEA + 3
    forest(k, 'pine', d.spots(90, 10, 70, { clear: 9, test: land }), { scale: [0.7, 1.1], tints: [0x8a9a88, 0x7a8a78] })
    forest(k, 'pine', d.spots(120, 70, 300, { clear: 30, test: land }), { scale: [0.8, 1.2], solid: 0, tints: [0x7a8a7a] })
    grass(k, { density: 3, reach: 24, height: [0.4, 0.9], colors: [0x7a8a58, 0x6a7a4a, 0x8a9468], test: land })
    const grey = new THREE.Color(0.6, 0.62, 0.64)
    d.prop('rock_09', d.spots(40, 6, 40, { clear: 6, test: land }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 2 + d.rand() * 2)), 0.9, grey)
    d.prop('shrub_02', d.spots(60, 3, 24, { clear: 2, test: land }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.2 + d.rand())))
    crates(d, d.spots(8, 2.5, 7, { from: 0.02, to: 0.09, clear: 1.5 }), 0x6a7a8a)

    village(k)
    surfRocks(k)
    const beam = lighthouse(k)
    const bridge = drawbridge(k)
    tunnelBore(k, c.branches[0]!)
    const waves = breakwater(k)
    const sky = lightning(k)

    // the weather, building lap by lap
    const rain = drift(k, 1400, 0xcdd8e2, 1.6, 48, true)
    rain.visible = false
    const rm = rain.material as THREE.PointsMaterial
    const fogBase = storm.look.fogDensity
    k.onFrame((f) => {
      const u = (f.lap - 1) / Math.max(1, f.totalLaps - 1) // 0 calm, 1 full storm
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      rain.visible = f.lap >= 2
      rm.size = 1.2 + u * 1.2
      rm.opacity = 0.5 + u * 0.4
      k.road.wet.value += ((0.35 + u * 0.6) - k.road.wet.value) * Math.min(1, f.dt * 0.4)
      if (k.water) k.water.swell.value = 1.3 + u * 1.6
      w.wind.x = f.lap >= 2 ? (Math.sin(f.time * 0.35) * 0.6 + 0.6) * (1.5 + u * 3) : 0
      atmos.params.x += (fogBase * (1 + u * 0.9) - atmos.params.x) * Math.min(1, f.dt * 0.3)
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      if (sceneFog) sceneFog.density = atmos.params.x
      beam(f.time)
      bridge(f.time, last ? 11 : f.lap >= 2 ? 15 : 20, f.dt)
      waves(u, f.time, f.dt)
      sky(f.lap, last, f.dt)
    })
  },
}

/**
 * The harbour village: fishermen's cottages round the quay. Painted walls on
 * a stone base, steep slate roofs with an overhang, a chimney, a front door
 * with a lamp over it, framed windows lit warm against the grey, and
 * shutters in a second colour.
 */
function village(k: BuildKit): void {
  const { world: w, d } = k
  const walls = new Mesher(), roofs = new Mesher(), trim = new Mesher(), stone = new Mesher()
  const lit: THREE.Matrix4[] = [], lamps: THREE.Matrix4[] = []
  const paint = [0xf0ece2, 0xe8dcc0, 0xc8d8e0, 0xe8e0b8, 0xd8c8c0, 0xb8c8c8]
  const shutter = [0x2a5a7a, 0x8a2a2a, 0x3a6a4a, 0x2a3a5a, 0x6a4a2a]
  // a point on the house, from its own axes: across (x), up (y), along its depth (z)
  let n = 0
  for (let t = 0; t < 800 && n < 26; t++) {
    const x = (-200 + d.rand() * 220) * S, z = (-60 + d.rand() * 320) * S, y = w.terrainAt(x, z)
    if (y < SEA + 3 || d.roadGap(x, z) < 12 || w.blocked(x, z, 9)) continue
    const yaw = Math.round(d.rand() * 4) * (Math.PI / 2) + (d.rand() - 0.5) * 0.2
    const W = 8 + d.rand() * 4, D = 6 + d.rand() * 2, H = 4.6 + d.rand() * 2.4, roofH = D * 0.42
    const c = Math.cos(yaw), sn = Math.sin(yaw)
    const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c]
    const col = paint[n % paint.length]!, sh = shutter[n % shutter.length]!
    // stone base and painted walls
    stone.box(W + 0.4, 1, D + 0.4, ...at(0, 0.1, 0), 0x7a7672, yaw)
    walls.box(W, H, D, ...at(0, H / 2 + 0.5, 0), col, yaw)
    // the gable ends: triangles of wall up to the ridge
    for (const e of [-1, 1]) {
      const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, roofH)])
      const g = new THREE.ShapeGeometry(tri)
      walls.add(g, trs(...at(e * (W / 2 + 0.01), H + 0.5, 0), yaw + Math.PI / 2 * e), col)
    }
    // the roof: two slate slabs meeting at the ridge, overhanging every edge
    const slope = Math.atan2(roofH, D / 2), run = Math.hypot(roofH, D / 2) + 0.6
    for (const e of [-1, 1]) {
      const [rx, ry, rz] = at(0, H + 0.5 + roofH / 2 + 0.05, e * D / 4)
      roofs.add(new THREE.BoxGeometry(W + 1, 0.22, run), trs(rx, ry, rz, yaw, 1, e * slope), [0x3a4048, 0x2e343c, 0x4a4440][n % 3]!)
    }
    // chimney
    trim.box(1, roofH + 1.6, 1, ...at(W * 0.3, H + 0.5 + roofH * 0.5 + 0.6, -D * 0.15), 0x8a7a70, yaw)
    // front door, its frame and a lamp over it
    const front = D / 2 + 0.05
    trim.box(1.2, 2.2, 0.12, ...at(-W * 0.2, 1.6, front), 0x3a2a20, yaw)
    trim.box(1.5, 0.2, 0.16, ...at(-W * 0.2, 2.8, front), 0xf4f0e8, yaw)
    lamps.push(trs(...at(-W * 0.2 + 0.9, 2.9, front + 0.2), 0, 0.16))
    // windows on the front and back: frame, warm glass, shutters either side
    for (const side of [-1, 1]) for (const wx of side > 0 ? [W * 0.18, W * 0.38] : [-W * 0.3, 0, W * 0.3]) {
      const fz = side * (D / 2 + 0.06), yy = side > 0 ? 2.1 : 2.4
      trim.box(1.3, 1.4, 0.1, ...at(wx, yy, fz), 0xf4f0e8, yaw)
      lit.push(trs(...at(wx, yy, fz + side * 0.06), yaw + (side < 0 ? Math.PI : 0), new THREE.Vector3(1, 1.15, 1)))
      for (const s2 of [-1, 1]) trim.box(0.45, 1.4, 0.08, ...at(wx + s2 * 0.95, yy, fz + side * 0.02), sh, yaw)
      if (H > 6 && side > 0) {
        trim.box(1.3, 1.4, 0.1, ...at(wx, yy + 2.6, fz), 0xf4f0e8, yaw)
        lit.push(trs(...at(wx, yy + 2.6, fz + 0.06), yaw, new THREE.Vector3(1, 1.15, 1)))
      }
    }
    w.addBox(x, z, W / 2 + 0.5, D / 2 + 0.5, yaw)
    n++
  }
  place(k, stone, surface('stone'))
  place(k, walls, surface('plaster'))
  place(k, roofs, surface('stone', { rough: 0.55 }))
  place(k, trim, surface('paint', { rough: 0.6 }))
  d.instanced(new THREE.PlaneGeometry(1, 1), glow(1.5, 0.95, 0.42), lit, false)
  d.instanced(new THREE.SphereGeometry(1, 8, 6), glow(4, 3.2, 1.8), lamps, false)
  // the quay wall and boats riding in the harbour
  const quay = new Mesher()
  for (let z = -60; z < 120; z += 6) quay.box(3, 4, 6.2, (coastX(z) - 8) * S, 1, z * S, 0x7a7c7e)
  place(k, quay, surface('stone'))
  const boats: THREE.Matrix4[] = []
  for (let q = 0; q < 30 && boats.length < 6; q++) {
    const z = -40 + d.rand() * 160, x = coastX(z) + 15 + d.rand() * 60
    if (w.terrainAt(x * S, z * S) < -3 && d.roadGap(x * S, z * S) > 20) boats.push(trs(x * S, -0.4, z * S, d.rand() * 6, 0.18))
  }
  d.prop('dutch_ship_medium', boats, 0, undefined, 700)
}
const coastX = (z: number) => coast(z)

/** Sea stacks and rocks in the surf all round the coast. */
function surfRocks(k: BuildKit): void {
  const { world: w, d } = k
  const stacks: THREE.Matrix4[] = []
  for (let q = 0; q < 300 && stacks.length < 26; q++) {
    const x = (-100 + d.rand() * 600) * S, z = (-800 + d.rand() * 1150) * S, y = w.terrainAt(x, z)
    if (y > -1 || y < -10 || d.roadGap(x, z) < 26) continue
    stacks.push(trs(x, y, z, d.rand() * 6, 4 + d.rand() * 7))
  }
  d.prop('bk:coast_rocks_01', stacks, 0, new THREE.Color(0.55, 0.58, 0.6))
}

/** The lighthouse on the headland: its lamp lit, the beam sweeping the sea. */
function lighthouse(k: BuildKit): (t: number) => void {
  const { world: w, root } = k
  const LX = LIGHT.x * S, LZ = LIGHT.z * S, LY = w.terrainAt(LX, LZ)
  const tower = new Mesher()
  tower.add(new THREE.CylinderGeometry(4.2, 6, 34, 18), trs(LX, LY + 17, LZ), 0xe8e6e0)
  for (let q = 0; q < 3; q++) tower.add(new THREE.CylinderGeometry(4.9 - q * 0.45, 5.3 - q * 0.45, 3.4, 18), trs(LX, LY + 6 + q * 10, LZ), 0xb8302a)
  tower.add(new THREE.CylinderGeometry(5.2, 5.2, 1, 18), trs(LX, LY + 34.5, LZ), 0x2a2e34)
  tower.add(new THREE.ConeGeometry(4.4, 4.6, 18), trs(LX, LY + 41.5, LZ), 0x2a2e34)
  tower.box(10, 4, 8, LX + 8, LY + 2, LZ + 4, 0xe8e6e0)
  place(k, tower, surface('plaster'))
  w.addPost(LX, LZ, 6.5)
  w.addBox(LX + 8, LZ + 4, 5.3, 4.3)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), glow(6, 5.4, 3.6))
  lamp.position.set(LX, LY + 37.5, LZ)
  root.add(lamp)
  const beam = new THREE.Mesh(new THREE.ConeGeometry(16, 320, 22, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.85), transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }))
  beam.geometry.translate(0, -160, 0)
  beam.geometry.rotateZ(Math.PI / 2)
  const pivot = new THREE.Group()
  pivot.position.copy(lamp.position)
  pivot.add(beam)
  root.add(pivot)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xfff0c8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }))
  halo.position.copy(lamp.position)
  halo.scale.setScalar(26)
  root.add(halo)
  return (t) => { pivot.rotation.y = t * 0.7 }
}

/**
 * The drawbridge in the middle of the sea bridge: one steel leaf over the
 * gap. Down, you drive straight over it; every so often the barrier lights
 * flash and it lifts, and then it's a ramp: up it at speed and you jump onto
 * the far side.
 */
function drawbridge(k: BuildKit): (t: number, every: number, dt: number) => void {
  const { circuit: c, world: w, root } = k
  let g0 = -1, g1 = -1
  for (let i = 1; i < c.count; i++) {
    if (c.gap[i] && !c.gap[i - 1] && g0 < 0) g0 = i
    if (!c.gap[i] && c.gap[i - 1] && g0 >= 0) { g1 = i; break }
  }
  if (g0 < 0 || g1 < 0) return () => undefined
  const a = c.samples[g0 - 1]!, b = c.samples[g1]!
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) + 1.5, fx = dx / Math.hypot(dx, dz), fz = dz / Math.hypot(dx, dz)
  const yaw = Math.atan2(fx, fz), Wd = c.widths[g0]! + 1
  const deck = movingDeck(k, Wd, L, 0x3a3e46, 0xe8b020, 1.4)
  deck.pl.kick = true
  // the towers at the hinge: counterweights, and warning lights on the road
  const r = c.rights[g0 - 1]!, half = Wd / 2 + 2.4
  const towers = new Mesher()
  for (const s of [-1, 1]) {
    const x = a.x + r.x * s * half, z = a.z + r.z * s * half
    towers.box(3.4, 16, 3.4, x, a.y + 4, z, 0x4a5058, yaw)
    towers.box(4.2, 1, 4.2, x, a.y + 12.4, z, 0x2a2e34, yaw)
    w.addPost(x, z, 2)
  }
  place(k, towers, surface('metal', { rough: 0.5 }))
  const warn = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.05, 0.02), toneMapped: false })
  const bulbs: THREE.Mesh[] = []
  for (const s of [-1, 1]) for (const up of [0, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), warn)
    m.position.set(a.x + r.x * s * half - fx * (1.8 + up * 0.1), a.y + 9 + up * 1.6, a.z + r.z * s * half - fz * 1.8)
    root.add(m)
    bulbs.push(m)
  }
  let clock = 0
  const MAX = 0.24 // radians up: a ramp, not a wall
  return (t, every, dt) => {
    clock += dt
    const ph = clock % every
    // down … warning (1.5 s) … rising (1.5 s) … up (3 s) … lowering (1.5 s)
    const open = every - 7.5
    let lift = 0
    if (ph > open + 1.5 && ph < open + 3) lift = (ph - open - 1.5) / 1.5
    else if (ph >= open + 3 && ph < open + 6) lift = 1
    else if (ph >= open + 6) lift = 1 - (ph - open - 6) / 1.5
    const blink = ph > open && ph < every && Math.sin(t * 10) > 0
    warn.color.setRGB(blink ? 4 : 0.4, blink ? 0.6 : 0.05, blink ? 0.2 : 0.02)
    const ang = THREE.MathUtils.smoothstep(lift, 0, 1) * MAX
    const run = L * Math.cos(ang), rise = L * Math.sin(ang)
    deck.set(a.x + fx * run / 2, a.z + fz * run / 2, yaw, a.y, a.y + rise, 0, 0)
  }
}

/** The old tunnel under the headland: a bore of grey rock lined with lamps. */
function tunnelBore(k: BuildKit, tunnel: Circuit): void {
  const { d, root } = k
  const shell = new Mesher(), lamps: THREE.Matrix4[] = []
  for (let i = 0; i < tunnel.count; i += 2) {
    if (!tunnel.tunnel[i]) continue
    const p = tunnel.samples[i]!, r = tunnel.rights[i]!, t = tunnel.tangents[i]!
    const R = tunnel.widths[i]! / 2 + 2.4, yaw = Math.atan2(-t.x, -t.z)
    for (let q = 0; q <= 9; q++) {
      const ang = (q / 9) * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang)
      shell.add(new THREE.BoxGeometry(3.6, 1.4, 4.4), trs(p.x + r.x * ca * R, p.y - 0.6 + sa * R * 0.8, p.z + r.z * ca * R, 0, 1).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, ang - Math.PI / 2, 'YXZ'))), [0x4a4e52, 0x44484c, 0x50545a][(i + q) % 3]!)
    }
    if (i % 12 === 0) for (const s of [-1, 1]) lamps.push(trs(p.x + r.x * s * (R - 1.6), p.y + 4.2, p.z + r.z * s * (R - 1.6), 0, 0.3))
  }
  place(k, shell, surface('rock'))
  d.instanced(new THREE.SphereGeometry(1, 8, 6), glow(3, 2.6, 1.6), lamps, false)
  const pool = softDot()
  for (let q = 0; q < lamps.length; q += 2) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pool, color: 0xffd8a0, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }))
    sp.position.setFromMatrixPosition(lamps[q]!)
    sp.scale.setScalar(12)
    root.add(sp)
  }
}

/**
 * The breakwater: a low road over the sea. Waves roll in from the open sea
 * and break over it: a wall of spray, and a shove towards the harbour side.
 * Gentle on lap 1, hard in the storm.
 */
function breakwater(k: BuildKit): (u: number, t: number, dt: number) => void {
  const { circuit: c, root } = k
  const P = storm.points
  const i0 = c.track(P[17]![0], P[17]![2], 0, c.count, P[17]![1]), i1 = c.track(P[18]![0], P[18]![2], 0, c.count, P[18]![1])
  const zones = roadZones(k, c, Math.min(i0, i1) - 6, Math.max(i0, i1) + 6, 8)
  zoneFx(k, zones.map((q) => q.z), 0xe8f0f4, 0.5, 26)
  // the sea is on the road's left (outside): waves push to the right
  const spray = zones.map((q) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xe8f2f6, transparent: true, opacity: 0, depthWrite: false }))
    s.position.set(q.z.x - q.rx * 9, 3, q.z.z - q.rz * 9)
    root.add(s)
    return s
  })
  // big rocks along the seaward edge
  const armour = new Mesher()
  for (let i = Math.min(i0, i1) - 6; i < Math.max(i0, i1) + 6; i += 3) {
    const p = c.samples[i]!, r = c.rights[i]!, off = -(c.widths[i]! / 2 + 2.5)
    armour.add(new THREE.DodecahedronGeometry(1.6 + (i % 3) * 0.4, 0), trs(p.x + r.x * off, p.y - 1, p.z + r.z * off, i, 1), 0x6a6e72)
  }
  place(k, armour, surface('rock'))
  return (u, t) => {
    zones.forEach((q, n) => {
      // each wave arrives a moment after the last, travelling along the wall
      const wave = Math.max(0, Math.sin(t * 0.9 - n * 0.6)) ** 6
      const push = (1.5 + u * 9) * wave
      q.z.on = true
      q.z.vx = q.rx * push
      q.z.vz = q.rz * push
      const s = spray[n]!
      s.material.opacity = wave * (0.25 + u * 0.55)
      s.scale.set(10 + u * 10, (4 + u * 10) * wave + 1, 1)
      s.position.y = 2 + wave * (2 + u * 5)
    })
  }
}

/**
 * Lightning: from lap 2, now and then a jagged bolt strikes the sea and the
 * whole coast flashes white. In the last lap's storm it comes every few
 * seconds.
 */
function lightning(k: BuildKit): (lap: number, last: boolean, dt: number) => void {
  const { d, root } = k
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.4, 5), toneMapped: false, transparent: true, opacity: 1, depthWrite: false, fog: false })
  const bolt = new THREE.Group()
  bolt.visible = false
  root.add(bolt)
  const glowSky = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xc8d8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  glowSky.scale.setScalar(900)
  root.add(glowSky)
  let wait = 4, life = 0
  const strike = (): void => {
    while (bolt.children.length) bolt.remove(bolt.children[0]!)
    // out at sea, east of the coast
    const x = (420 + d.rand() * 500) * S, z = (-700 + d.rand() * 1000) * S
    let p = new THREE.Vector3(x, 420, z)
    const m = new Mesher()
    while (p.y > 0) {
      const q = p.clone().add(new THREE.Vector3((d.rand() - 0.5) * 40, -30 - d.rand() * 30, (d.rand() - 0.5) * 40))
      q.y = Math.max(0, q.y)
      m.bar(p, q, 1.1, 0xffffff, 4)
      if (d.rand() < 0.3) m.bar(q, q.clone().add(new THREE.Vector3((d.rand() - 0.5) * 60, -40, (d.rand() - 0.5) * 60)), 0.6, 0xffffff, 3)
      p = q
    }
    bolt.add(new THREE.Mesh(m.build(), mat))
    bolt.visible = true
    glowSky.position.set(x, 260, z)
    life = 0.35
    k.flash(0.8, 0.86, 1, 0.75)
  }
  return (lap, last, dt) => {
    if (life > 0) {
      life -= dt
      // the bolt flickers as it fades
      mat.opacity = life > 0 && Math.sin(life * 90) > -0.3 ? 1 : 0
      glowSky.material.opacity = Math.max(0, life) * 1.6
      if (life <= 0) { bolt.visible = false; glowSky.material.opacity = 0 }
    }
    if (lap < 2) return
    wait -= dt
    if (wait <= 0) {
      strike()
      wait = last ? 2.5 + d.rand() * 3.5 : 7 + d.rand() * 7
    }
  }
}
