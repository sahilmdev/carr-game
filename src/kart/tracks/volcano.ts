import * as THREE from 'three'
import { canvasTexture, fbm2, smooth, softDot, trs } from '../../game/biomes/kit'
import { atmos } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import type { Solid } from '../World'
import { arrows, crates, drift, edgeLights, gantry, glow, mist } from './parts'

/*
 * Volcano Run. Off the black-sand beach and along the shore, then up the
 * volcano's east flank in long climbing sweeps to the crater rim, round the
 * rim with the lava lake glowing below, and back down the west side: across
 * the first lava river on a stone bridge, and over the second off a steam
 * vent that throws you clear. Or leave the rim through the old lava tube.
 *
 * Lap 2: the flow on the east flank has cooled, and opens as a short cut
 * across the black crust. Last lap: ash falls, the sky turns red and the
 * crater throws burning rock down the mountain.
 */

/** The whole island is laid out in these metres, then stretched by K for a 50–60 s lap. */
const K = 1.22
const V = { x: 0, z: -300 * K }
const BASE = 600 * K, PEAK = 150, CREST = 175 * K, LAKE = 58
/** The young cone in the crater: how far it rises over the lava, and its foot's radius. */
const SPIRE = { h: 150, r: 100 * K }
/** The two lava rivers down the west flank: direction from the crater (radians), and how far down they run. */
const RIVERS = [
  { a: 0, r0: 300 * K, r1: 480 * K },
  // stops short of the road home: it must only cross the road at the vent
  { a: 0, r0: 250 * K, r1: 415 * K },
]

/** The bare cone: how high the mountain stands here, before rivers and noise. */
function cone(x: number, z: number): number {
  const r = Math.hypot(x - V.x, z - V.z)
  const flank = (q: number) => (q < BASE ? PEAK * Math.pow(1 - q / BASE, 1.6) : 0)
  let h = flank(Math.max(r, CREST)) + 8 * Math.exp(-(((r - CREST) / 26) ** 2))
  // the crater: steep inner walls down to the lava lake, and the young cone
  // in its middle, smoking, standing high over everything
  if (r < CREST) {
    h = THREE.MathUtils.lerp(LAKE - 9, flank(CREST) + 8, smooth(120 * K, CREST - 4, r))
    // broad at the foot, steepening to a smoking crater at the top
    const u = Math.max(0, 1 - r / SPIRE.r)
    const spire = SPIRE.h * Math.pow(u, 1.6) - 26 * smooth(18 * K, 6 * K, r) + LAKE - 10
    h = Math.max(h, spire)
  }
  return h
}

/** Where on a river's line a point lies: its distance across and how far down the flank. */
function riverAt(rv: { a: number; r0: number; r1: number }, x: number, z: number): { d: number; r: number } {
  const dx = x - V.x, dz = z - V.z, r = Math.hypot(dx, dz)
  const ca = Math.cos(rv.a), sa = Math.sin(rv.a)
  const along = dx * ca + dz * sa, across = -dx * sa + dz * ca
  return { d: Math.abs(across - Math.sin(along * 0.03) * 6), r: along }
}

function profile(x: number, z: number): number {
  let h = cone(x, z)
  // the shore: land falls away into the sea to the south
  h = THREE.MathUtils.lerp(h + 2.5, -10, smooth(300 * K, 380 * K, z))
  for (const rv of RIVERS) {
    const { d, r } = riverAt(rv, x, z)
    if (r < rv.r0 - 30 || r > rv.r1 + 30) continue
    const run = smooth(rv.r0 - 30, rv.r0, r) * (1 - smooth(rv.r1, rv.r1 + 30, r))
    h -= 10 * smooth(14, 6, d) * run
  }
  return h
}

/** Road height at a point on the flank: just over the bare cone (no river dips). */
const onCone = (x: number, z: number, lift = 0.4): number => Math.max(3, cone(x, z) + 2.5 * (1 - smooth(300 * K, 380 * K, z))) + lift

const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

// the west descent, and where the two lava rivers cross it
const D15: [number, number] = [-180 * K, -86 * K], D16: [number, number] = [-169 * K, 18 * K], D17: [number, number] = [-136 * K, 118 * K]
const MA = lerp2(D15, D16, 0.5), MB = lerp2(D16, D17, 0.5)
RIVERS[0]!.a = Math.atan2(MA[1] - V.z, MA[0] - V.x)
RIVERS[1]!.a = Math.atan2(MB[1] - V.z, MB[0] - V.x)
// the vent jump: a lip before river B, landing after it
const tB = 22 / Math.hypot(D17[0] - D16[0], D17[1] - D16[1])
const VB0 = lerp2(D16, D17, 0.5 - tB), VB1 = lerp2(D16, D17, 0.5 + tB)

/** A point in design metres (scaled by K here); ptW for one already in world metres. */
const ptW = (x: number, z: number, o?: TrackPoint[3], y?: number): TrackPoint => [x, y ?? onCone(x, z), z, o]
const pt = (x: number, z: number, o?: TrackPoint[3], y?: number): TrackPoint => ptW(x * K, z * K, o, y)

const POINTS: TrackPoint[] = [
  // 0: the black-sand beach, heading east along the shore
  pt(-150, 262, { w: 18 }, 3.4),
  pt(20, 268, { pad: 0 }, 3.4),
  pt(200, 255, undefined, 3.8),
  pt(350, 190, { items: true }), // 3: the cooled flow leaves here (from lap 2)
  pt(450, 60),
  // 5: up the east flank in long sweeps
  pt(470, -110),
  pt(420, -250, { bank: 3.4 }), // 6: the cooled flow rejoins
  pt(300, -440, { items: true }),
  pt(140, -540),
  pt(20, -513),
  // 10: the crater rim, the lava lake below on the left
  pt(-80, -465, { rail: 'L' }),
  pt(-134, -412, { rail: 'L', items: true }),
  pt(-169, -345, { rail: 'L' }), // 12: the lava tube leaves here
  pt(-172, -270, { rail: 'L' }),
  // 14: off the rim and down the west flank
  pt(-190, -190),
  ptW(D15[0], D15[1]), // 15: the lava tube rejoins
  // 16: the stone bridge over the first lava river
  ptW(MA[0], MA[1], { raised: true, rail: 'LR' }, onCone(MA[0], MA[1], 1.2)),
  ptW(D16[0], D16[1], { pad: 0 }),
  // 18: the steam vent throws you over the second river
  ptW(VB0[0], VB0[1], undefined, onCone(VB0[0], VB0[1], 0.6)),
  ptW(MB[0], MB[1], { gap: true }, onCone(MB[0], MB[1], 1.5)),
  ptW(VB1[0], VB1[1], undefined, onCone(VB1[0], VB1[1], 0.6)),
  ptW(D17[0], D17[1], { items: true }),
  pt(-200, 200, { bank: 3.6 }),
]

export const volcano: TrackDef = {
  id: 'volcano',
  name: 'Volcano Run',
  ambience: 'volcano',
  width: 17,
  bank: 2.4,
  shoulder: 30,
  accent: 0xff5a1f,
  sea: 0,
  water: { deep: 0x0a1418, shallow: 0x2a3a3c, foam: 0xd8dcd8, waves: 0.9 },
  far: 0x1e1a18,
  farY: -12,
  rails: 'steel',
  road: { lines: 'circuit', kerbColors: [0xc8361a, 0x1e1e22], grime: 0x2a2624, edgeLine: 0xe8dcc8, tone: 1, lift: 0.34 },
  terrain: { layers: ['volcanic_rock_tiles', 'coast_sand_01', 'moon_01', 'mud_cracked_dry_03'], tile: [20, 14, 22, 12], tints: [0x8a8078, 0x5a5654, 0x9a928a, 0x5e5048] },
  look: {
    tod: 'sunset', generatedSky: true, top: [0.1, 0.06, 0.09], horizon: [0.95, 0.42, 0.2], mix: 0.7, stars: 0.1,
    fog: [0.46, 0.3, 0.26], fogDensity: 0.0011, fogBase: 40, fogFall: 0.01, sunGlow: 0.6,
    exposure: 1.42, sun: 1.35, hemi: 1.85, bloom: 0.42, shafts: 0.35, headlights: 0.25, env: 0.9,
    grade: [1.08, 1.08, 0.012, 0.004, 0, 1.05, 0.98, 0.92, 0.3],
  },
  points: POINTS,
  branches: [
    {
      // the cooled flow: a straight run across the black crust, hot and shut on lap 1
      name: 'Cooled flow', from: 3, to: 6, odds: 0,
      points: [
        pt(392, 40, { deck: 'dirt' }),
        pt(410, -100, { deck: 'dirt', pad: 0 }),
      ],
    },
    {
      // the lava tube: off the rim and down inside an old tube of rock
      name: 'Lava tube', from: 12, to: 15, odds: 0.45,
      points: [
        pt(-235, -265, { w: 14, rail: 'LR' }),
        pt(-245, -160, { w: 14, rail: 'LR', pad: 0 }),
      ],
    },
  ],
  ground(x, z) {
    const g = profile(x, z)
    // rough everywhere but the crater floor, which stays under the lava
    const r = Math.hypot(x - V.x, z - V.z)
    const keep = r < CREST ? smooth(LAKE + 2, LAKE + 16, g) : 1
    return g + fbm2(x * 0.012, z * 0.012) * 6 * smooth(4, 20, g) * keep
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.5, 0.95, slope)
    const sand = 1 - smooth(4, 9, h)
    const ash = smooth(60, 100, h)
    const crust = smooth(0.45, 0.6, fbm2(x * 0.015 + 4, z * 0.015)) * (1 - sand)
    mix[0] = rock + (1 - rock) * (1 - sand) * (1 - crust) * (1 - ash) * 0.6
    mix[1] = sand
    mix[2] = ash * (1 - rock)
    mix[3] = crust * (1 - rock) + smooth(8, 3, roadDist) * 0.3
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: (_x, z) => (z > 230 * K ? 'sand' : 'concrete'),
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Volcano Run', '#ff5a1f')
    arrows(k, 0xff8a3a)
    mountainRing(root, V.x, V.z, { inner: 1600, outer: 3200, height: 420, base: -30, rock: 0x3a3230, seed: 23 })
    // the road's edges glow faintly, like the cracks in the rock
    edgeLights(k, new THREE.Color(1, 0.42, 0.12), { spacing: 30, strip: 0.22, pool: 0 })

    const lava = lavaMaterial()
    const hot = lava.mat
    lavaLake(k, hot)
    for (const rv of RIVERS) lavaRiver(k, rv, hot)
    const tube = lavaTube(k, c.branches[1]!, hot)
    const flow = cooledFlow(k, c.branches[0]!, lava)
    ventJump(k)
    beach(k)
    rimHut(k)

    // the mountain: dark rock and dead trees up high, green only by the sea
    const lowland = (_x: number, z: number, y: number) => y > 2 && y < 16 && z > 120 * K
    const flank = (_x: number, _z: number, y: number) => y > 14
    forest(k, 'oak', d.spots(70, 8, 50, { clear: 8, test: lowland }), { scale: [0.7, 1.1], tints: [0x7a9a58, 0x6a8a4a, 0x8aa868] })
    forest(k, 'dead', d.spots(60, 8, 80, { clear: 9, test: flank }), { scale: [0.8, 1.3], tints: [0x4a4440] })
    grass(k, { density: 1.6, reach: 22, height: [0.3, 0.7], colors: [0x6a7a48, 0x5a6a40, 0x7a8a50], test: lowland })
    const dark = new THREE.Color(0.45, 0.42, 0.4)
    d.prop('moon_rock_03', d.spots(60, 6, 40, { clear: 6, test: flank }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 2 + d.rand() * 3)), 0.9, dark)
    d.prop('moon_rock_06', d.spots(50, 8, 60, { clear: 7 }).map((s) => trs(s.x, s.y - 0.4, s.z, d.rand() * 6, 2.5 + d.rand() * 3)), 0.9, dark)
    d.prop('boulder_01', d.spots(30, 10, 70, { clear: 9, test: flank }).map((s) => trs(s.x, s.y - 0.6, s.z, d.rand() * 6, 2 + d.rand() * 2)), 0.9, dark)
    d.prop('dead_tree_trunk', d.spots(18, 6, 30, { clear: 5, test: flank }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4)), 0.4)
    crates(d, d.spots(6, 2.5, 7, { from: 0.03, to: 0.1, clear: 1.5 }), 0x8a6a4a)

    // steam rising off the flank, and a plume from the crater
    mist(k, d.spots(18, 20, 120, { clear: 18, test: flank }).map((s) => s.setY(s.y + 6)), [30, 60], 0xc8b8b0, 0.14)
    mist(k, Array.from({ length: 14 }, (_, q) => new THREE.Vector3(V.x + Math.sin(q * 2.1) * (12 + q * 6), LAKE + SPIRE.h - 20 + q * 22, V.z + Math.cos(q * 2.1) * (12 + q * 6) + q * 10)), [70, 160], 0x5a504e, 0.3)

    // the last lap: ash, a red sky, and the crater throwing rock
    const ash = drift(k, 700, 0x5a5452, 0.45, 2.6)
    ash.visible = false
    const bombs = lavaBombs(k)
    const fogBase = volcano.look.fogDensity
    const baseFog = new THREE.Color(...volcano.look.fog), redFog = new THREE.Color(0.55, 0.2, 0.12)
    k.onFrame((f) => {
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      lava.tex.offset.y = (f.time * 0.05) % 1
      const pulse = 1 + Math.sin(f.time * 1.7) * 0.08 + (last ? 0.25 : 0)
      hot.color.setRGB(2.4 * pulse, 0.95 * pulse, 0.32 * pulse)
      ash.visible = last
      bombs(last, f.dt, f.time)
      tube(f.time)
      flow(f.lap >= 2, f.dt)
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      const want = fogBase * (last ? 1.8 : 1)
      atmos.params.x += (want - atmos.params.x) * Math.min(1, f.dt * 0.3)
      if (sceneFog) {
        sceneFog.density = atmos.params.x
        sceneFog.color.lerp(last ? redFog : baseFog, Math.min(1, f.dt * 0.3))
      }
    })
  },
}

/** Molten rock: a dark crust with bright veins, glowing past white in the bloom. */
function lavaMaterial(): { mat: THREE.MeshBasicMaterial; tex: THREE.CanvasTexture } {
  const tex = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#5a1402'
    g.fillRect(0, 0, W, H)
    for (let q = 0; q < 260; q++) {
      const x = Math.random() * W, y = Math.random() * H, r = 6 + Math.random() * 26
      const gr = g.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, 'rgba(255,214,120,0.95)')
      gr.addColorStop(0.4, 'rgba(255,120,30,0.6)')
      gr.addColorStop(1, 'rgba(255,60,0,0)')
      g.fillStyle = gr
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // dark crust plates floating on it
    for (let q = 0; q < 70; q++) {
      g.fillStyle = `rgba(30,10,6,${0.5 + Math.random() * 0.4})`
      g.beginPath()
      const x = Math.random() * W, y = Math.random() * H
      g.moveTo(x, y)
      for (let s = 0; s < 6; s++) g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30)
      g.closePath()
      g.fill()
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 0.95, 0.32), toneMapped: false })
  return { mat, tex }
}

/** The lava lake in the crater, and a glow over it. */
function lavaLake(k: BuildKit, mat: THREE.Material): void {
  const lake = new THREE.Mesh(new THREE.CircleGeometry(150 * K, 48), mat)
  lake.rotation.x = -Math.PI / 2
  lake.position.set(V.x, LAKE - 1, V.z)
  const uv = lake.geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * 4, uv.getY(q) * 4)
  k.root.add(lake)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff5a1a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
  halo.position.set(V.x, LAKE + 30, V.z)
  halo.scale.setScalar(420)
  k.root.add(halo)
  // lava running down the young cone in bright streaks, and a glow at its vent
  const pos: number[] = [], suv: number[] = [], idx: number[] = []
  for (let q = 0; q < 7; q++) {
    const a0 = (q / 7) * Math.PI * 2 + 0.3, base = pos.length / 3
    let n = 0
    for (let r = 16; r <= SPIRE.r * 0.92; r += 3) {
      const a = a0 + Math.sin(r * 0.08 + q) * 0.12, wd = 1.2 + r * 0.05
      const cx = V.x + Math.cos(a) * r, cz = V.z + Math.sin(a) * r
      for (const s of [-1, 1]) {
        const x = cx - Math.sin(a) * s * wd, z = cz + Math.cos(a) * s * wd
        pos.push(x, k.world.terrainAt(x, z) + 0.6, z)
        suv.push((s + 1) / 2, r / 14)
      }
      if (n > 0) { const o = base + (n - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
      n++
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2))
  g.setIndex(idx)
  const streaks = new THREE.Mesh(g, mat)
  streaks.userData['keep'] = true
  k.root.add(streaks)
  const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff7a2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
  top.position.set(V.x, LAKE - 10 + SPIRE.h - 10, V.z)
  top.scale.setScalar(90)
  k.root.add(top)
}

/** A river of lava down the channel, glowing in its bed. */
function lavaRiver(k: BuildKit, rv: { a: number; r0: number; r1: number }, mat: THREE.Material): void {
  const w = k.world
  const ca = Math.cos(rv.a), sa = Math.sin(rv.a)
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let n = 0
  for (let r = rv.r0 - 20; r <= rv.r1 + 20; r += 4) {
    const off = Math.sin(r * 0.03) * 6
    const cx = V.x + ca * r - sa * off, cz = V.z + sa * r + ca * off
    for (const s of [-1, 1]) {
      const x = cx - sa * s * 7, z = cz + ca * s * 7
      pos.push(x, w.terrainAt(cx, cz) + 0.5, z)
      uv.push((s + 1) / 2, r / 22)
    }
    if (n > 0) { const o = (n - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    n++
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const m = new THREE.Mesh(g, mat)
  m.userData['keep'] = true
  k.root.add(m)
}

/** The old lava tube: a ribbed rock bore over the road, skylights in its roof, lava glowing in cracks at its foot. */
function lavaTube(k: BuildKit, tube: Circuit, hot: THREE.MeshBasicMaterial): (t: number) => void {
  const shell = new Mesher(), cracks = new Mesher()
  const lights: THREE.Sprite[] = []
  // not where the tube still runs alongside the main road (at the fork and the join)
  const clear = (i: number) => k.circuit.roadAt(tube.samples[i]!.x, tube.samples[i]!.z, tube.samples[i]!.y + 1, { i: -1, lat: 0, y: 0 })
  for (let i = 4; i < tube.count - 4; i += 2) {
    let near = false
    for (let q = -10; q <= 10 && !near; q += 2) { const j = i + q; near = j >= 0 && j < tube.count && clear(j) }
    if (near) continue
    const p = tube.samples[i]!, r = tube.rights[i]!, t = tube.tangents[i]!
    const R = tube.widths[i]! / 2 + 2.2, yaw = Math.atan2(-t.x, -t.z)
    const sky = i % 24 < 4
    for (let q = 0; q <= 10; q++) {
      if (sky && q > 3 && q < 7) continue // a skylight: the roof has fallen in here
      const a = (q / 10) * Math.PI, ca = Math.cos(a), sa = Math.sin(a)
      const x = p.x + r.x * ca * R, z = p.z + r.z * ca * R, y = p.y - 0.8 + sa * R * 0.85
      shell.add(new THREE.BoxGeometry(3.4, 1.5, 2.6), trs(x, y, z, 0, 1).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, a - Math.PI / 2, 'YXZ'))), [0x2a2624, 0x322c2a, 0x262220][(i + q) % 3]!)
    }
    for (const s of [-1, 1]) cracks.box(0.5, 0.15, 2.4, p.x + r.x * s * (R - 1.3), p.y + 0.05, p.z + r.z * s * (R - 1.3), 0xffffff, yaw)
    if (i % 16 === 0) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff6a20, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }))
      sp.position.set(p.x, p.y + 2, p.z)
      sp.scale.setScalar(16)
      k.root.add(sp)
      lights.push(sp)
    }
  }
  place(k, shell, surface('rock')).userData['keep'] = true
  const c = new THREE.Mesh(cracks.build(), hot)
  c.userData['keep'] = true
  k.root.add(c)
  return (t) => lights.forEach((s, q) => { s.material.opacity = 0.32 + Math.sin(t * 2.3 + q) * 0.08 })
}

/**
 * The cooled flow: on lap 1 still molten (a glowing skin over the road, a
 * wall of hot rock at its mouth, shut to everyone); from lap 2 the glow dies,
 * the rocks sink and it opens as a short cut.
 */
function cooledFlow(k: BuildKit, cut: Circuit, lava: { mat: THREE.MeshBasicMaterial; tex: THREE.CanvasTexture }): (open: boolean, dt: number) => void {
  const { world: w, root } = k
  // a glowing skin laid over the road
  const skinMat = lava.mat.clone()
  skinMat.transparent = true
  skinMat.depthWrite = false
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const v = new THREE.Vector3()
  // only the stretch clear of the main road: never lava lying across the road everyone drives
  const probe = { i: -1, lat: 0, y: 0 }
  const onMain = (i: number) => [-1, 0, 1].some((sd) => { cut.at(i, sd * (cut.widths[i]! / 2 + 1), 0, v); return k.circuit.roadAt(v.x, v.z, v.y + 1, probe) && Math.abs(probe.lat) < k.circuit.widths[probe.i]! / 2 + 1 })
  for (let i = 0; i < cut.count; i++) {
    const half = cut.widths[i]! / 2 + 1
    for (const s of [-1, 1]) { cut.at(i, s * half, 0.08, v); pos.push(v.x, v.y, v.z); uv.push((s + 1), i / 10) }
    if (i > 0 && !onMain(i) && !onMain(i - 1)) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const skin = new THREE.Mesh(g, skinMat)
  skin.renderOrder = 2
  skin.userData['keep'] = true
  root.add(skin)
  // hot rocks across the mouth
  const i0 = 8, p = cut.samples[i0]!, r = cut.rights[i0]!
  const rocks = new Mesher(), solids: Solid[] = []
  for (let q = -3; q <= 3; q++) {
    const lat = q * 2.6, x = p.x + r.x * lat, z = p.z + r.z * lat, s = 1.8 + Math.abs(Math.sin(q * 3.1)) * 1.2
    rocks.add(new THREE.DodecahedronGeometry(s, 1), trs(x, p.y + s * 0.6, z, q, 1), 0x2a1a14)
    solids.push({ x, z, r: s * 0.95, top: 1e6 })
  }
  const pile = new THREE.Mesh(rocks.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: new THREE.Color(0.9, 0.25, 0.05), emissiveIntensity: 1 }))
  pile.userData['keep'] = true
  root.add(pile)
  w.movers.push(...solids)
  let cool = 0
  return (open, dt) => {
    cool = THREE.MathUtils.clamp(cool + (open ? dt * 0.5 : -dt), 0, 1)
    skinMat.opacity = 1 - cool
    skin.visible = cool < 0.99
    pile.position.y = -cool * 5
    ;(pile.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 - cool
    for (const s of solids) s.top = cool > 0.6 ? -1e6 : 1e6
    cut.shut = cool < 0.6
    cut.join!.odds = cool >= 0.6 ? 0.55 : 0
  }
}

/** The steam vent before the second lava river: a crack that blows you up and over it. */
function ventJump(k: BuildKit): void {
  const { circuit: c, world: w, root } = k
  let lip = -1
  for (let i = 1; i < c.count; i++) if (c.gap[i] && !c.gap[i - 1]) { lip = i - 1; break }
  if (lip < 0) return
  // the vent sits a few metres before the lip, across the whole road
  const vi = Math.max(0, lip - 5), p = c.samples[vi]!, t = c.tangents[vi]!, yaw = Math.atan2(t.x, t.z)
  w.zones.push({ x: p.x, z: p.z, r: 0, hx: c.widths[vi]! / 2 + 1, hz: 3, cos: Math.cos(yaw), sin: Math.sin(yaw), y0: p.y - 2, y1: p.y + 3, lift: 15, on: true })
  // glowing slots in the road and steam pouring out
  const slots = new Mesher()
  for (let q = -3; q <= 3; q++) slots.box(1.6, 0.1, 4.2, q * 2.3, 0.06, 0, 0xffffff)
  const m = new THREE.Mesh(slots.build(), glow(3, 1.4, 0.4))
  m.position.copy(p)
  m.rotation.y = yaw
  m.userData['keep'] = true
  root.add(m)
  mist(k, Array.from({ length: 6 }, (_, q) => new THREE.Vector3(p.x + t.x * q * 2, p.y + 4 + q * 3, p.z + t.z * q * 2)), [10, 22], 0xe8e0d8, 0.32)
  // a sign before it
  const j = Math.max(0, lip - 40), q = c.samples[j]!, qt = c.tangents[j]!
  const sign = canvasTexture(512, 128, (g, W, H) => {
    g.fillStyle = '#16100e'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#ff6a20'
    for (let x = -H; x < W; x += 48) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 24, H); g.lineTo(x + 24 + H * 0.4, H * 0.62); g.lineTo(x + H * 0.4, H * 0.62); g.fill() }
    g.fillStyle = '#fff'; g.font = 'italic 800 52px sans-serif'; g.textAlign = 'center'; g.fillText('RIDE THE VENT', W / 2, 58)
  })
  const board = new THREE.Mesh(new THREE.PlaneGeometry(c.widths[j]! + 3, 2.8), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, side: THREE.DoubleSide }))
  board.position.set(q.x, q.y + 8, q.z)
  board.rotation.y = Math.atan2(qt.x, qt.z) + Math.PI
  root.add(board)
  const posts = new Mesher(), qr = c.rights[j]!, off = c.widths[j]! / 2 + 1.6
  for (const s of [-1, 1]) {
    posts.post(0.15, 0.15, 8.5, q.x + qr.x * s * off, q.y, q.z + qr.z * s * off, 0x2a2624, 8)
    w.addPost(q.x + qr.x * s * off, q.z + qr.z * s * off, 0.3)
  }
  place(k, posts, surface('metal'))
}

/** The black-sand beach at the start: rocks in the surf, a lifeguard tower, an observatory hut. */
function beach(k: BuildKit): void {
  const { world: w, d } = k
  const stacks: THREE.Matrix4[] = []
  for (let q = 0; q < 40 && stacks.length < 14; q++) {
    const x = (-400 + d.rand() * 900) * K, z = (320 + d.rand() * 140) * K, y = w.terrainAt(x, z)
    if (y > -1 || d.roadGap(x, z) < 30) continue
    stacks.push(trs(x, y, z, d.rand() * 6, 4 + d.rand() * 6))
  }
  d.prop('bk:coast_rocks_01', stacks, 0, new THREE.Color(0.35, 0.32, 0.32))
  const m = new Mesher()
  const tx = 120 * K, tz = 300 * K, ty = w.terrainAt(tx, tz)
  for (const [ox, oz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) m.post(0.15, 0.15, 5, tx + ox!, ty, tz + oz!, 0xe8e2d8, 6)
  m.box(4.4, 2.6, 4.4, tx, ty + 6.2, tz, 0xc8361a)
  m.add(new THREE.ConeGeometry(3.6, 1.6, 4), trs(tx, ty + 8.3, tz, Math.PI / 4), 0xe8e2d8)
  place(k, m, surface('paint', { rough: 0.6 }))
  w.addPost(tx, tz, 2.4)
}

/** A small observatory hut on the rim, with its dish turned to the crater. */
function rimHut(k: BuildKit): void {
  const { world: w, d } = k
  const a = -2.6, x = V.x + Math.cos(a) * (CREST + 42), z = V.z + Math.sin(a) * (CREST + 42)
  if (d.roadGap(x, z) < 12) return
  const y = w.terrainAt(x, z)
  const m = new Mesher()
  m.box(9, 4, 7, x, y + 2, z, 0xd8d4cc, a)
  m.box(9.6, 0.5, 7.6, x, y + 4.2, z, 0x3a3e44, a)
  m.post(0.2, 0.2, 5, x + 2, y + 4, z, 0x8a8e94, 6)
  m.add(new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), trs(x + 2, y + 9, z, 0, 1, -1.1), 0xe8e8ea)
  place(k, m, surface('paint', { rough: 0.5 }))
  w.addBox(x, z, 4.8, 3.8, a)
}

/**
 * Burning rock thrown from the crater on the last lap: it arcs high, falls
 * beside the road (never on it) and bursts in a glow.
 */
function lavaBombs(k: BuildKit): (on: boolean, dt: number, t: number) => void {
  const { d, root } = k
  const targets = d.spots(30, 14, 40, { clear: 12 })
  const N = 8
  const geo = new THREE.DodecahedronGeometry(1.4, 1)
  const mat = glow(3, 1.1, 0.3)
  const bombs = Array.from({ length: N }, () => {
    const m = new THREE.Mesh(geo, mat)
    m.visible = false
    root.add(m)
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    root.add(burst)
    return { m, burst, t: -1 - Math.random() * 6, from: new THREE.Vector3(), to: new THREE.Vector3(), boom: 0 }
  })
  const DUR = 3.2
  return (on, dt) => {
    for (const b of bombs) {
      if (b.boom > 0) {
        b.boom = Math.max(0, b.boom - dt * 1.4)
        b.burst.material.opacity = b.boom * 0.8
        b.burst.scale.setScalar(6 + (1 - b.boom) * 18)
      }
      if (!on) { b.m.visible = false; continue }
      b.t += dt
      if (b.t < 0) continue
      if (b.t === dt || !b.m.visible) {
        const s = targets[Math.floor(d.rand() * targets.length)]!
        b.from.set(V.x + (d.rand() - 0.5) * 60, LAKE + 10, V.z + (d.rand() - 0.5) * 60)
        b.to.copy(s)
        b.m.visible = true
        b.t = 0.0001
      }
      const u = Math.min(1, b.t / DUR)
      b.m.position.lerpVectors(b.from, b.to, u)
      b.m.position.y += Math.sin(u * Math.PI) * 140
      b.m.rotation.x += dt * 3
      if (u >= 1) {
        b.m.visible = false
        b.boom = 1
        b.burst.position.copy(b.to).setY(b.to.y + 2)
        b.t = -2 - d.rand() * 5
      }
    }
  }
}
