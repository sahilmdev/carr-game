import * as THREE from 'three'
import { canvasTexture, fbm2, lumpy, ridged2, smooth, trs } from '../../game/biomes/kit'
import { GLSL_NOISE, atmos } from '../art/atmos'
import { Mesher, crowd, place, surface } from '../art/arch'
import { forest } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { Solid } from '../World'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import { arrows, drift, gantry, glow, mist } from './parts'

/*
 * Bobsleigh Peak, top to bottom and back. Start in the summit village and go
 * straight down the ski-jump in-run: off the lip, wings out, and a long glide
 * down the landing hill. Then the bobsleigh run proper: an ice chute with
 * walls, banked bends one after another (or bail out onto the forest trail
 * and its creek jump). At the bottom, round the frozen lake or straight across
 * the ice, then the rack railway hauls you all the way back up to the village.
 *
 * Lap 2: snowballs come bowling down the chute. Last lap: a blizzard rolls
 * in, and the lake ice cracks.
 */

const ICE = 3
const LAKE = { x: 95, z: 645, r: 115, y: 38 }

const POINTS: TrackPoint[] = [
  // 0: the summit village, heading east to the ski jump
  [-40, 205, -220, { deck: 'asphalt', rail: '', w: 18 }],
  [40, 205, -205, { deck: 'asphalt', rail: '', w: 18, pad: 0 }],
  // 2: down the in-run
  [100, 204, -200, { raised: true, deck: 'steel', rail: 'LR', w: 16 }],
  [140, 200, -200, { raised: true, deck: 'steel', rail: 'LR', w: 16 }],
  [175, 197, -200, { raised: true, deck: 'steel', rail: '', w: 16 }],
  // 5: off the lip: wings out over the landing hill
  [190, 197.5, -200, { raised: true, gap: true, glide: true }],
  [240, 188, -200, { raised: true, gap: true, glide: true }],
  [290, 178, -200, { raised: true, gap: true, glide: true }],
  [330, 170, -200, { raised: true, deck: 'asphalt', rail: '', w: 28 }],
  [380, 160, -195, { deck: 'asphalt', rail: '', w: 22, items: true }],
  // 10: the bobsleigh run: an ice chute, walls both sides, banked bends
  [440, 155, -150],
  [500, 148, -60],
  [480, 140, 40, { bank: 6 }],
  [400, 132, 100, { rail: '' }], // 13: the forest trail leaves here (the chute opens)
  [310, 124, 150, { pad: 0 }],
  [260, 116, 240, { bank: 6 }],
  [320, 108, 330],
  [430, 100, 360, { rail: '' }], // 17: the forest trail rejoins
  [530, 92, 330, { bank: 6 }],
  [600, 84, 400],
  [580, 74, 500, { items: true }],
  [480, 64, 560],
  // 22: out of the chute and down to the frozen lake (the ice road leaves at 23)
  [360, 52, 600, { deck: 'asphalt', rail: '', w: 18 }],
  [220, 44, 640, { deck: 'asphalt', rail: '', w: 18 }],
  [90, 42, 772, { deck: 'asphalt', rail: '', w: 18 }],
  [-30, 44, 640, { deck: 'asphalt', rail: '', w: 18 }], // 25: the ice road rejoins
  // 26: the rack railway, all the way back up
  [-90, 60, 540, { deck: 'steel', rail: 'LR', w: 16, pad: 0 }],
  [-110, 100, 360, { deck: 'steel', rail: 'LR', w: 16, items: true }],
  [-110, 140, 180, { deck: 'steel', rail: 'LR', w: 16, pad: 0 }],
  [-100, 175, 20, { deck: 'steel', rail: 'LR', w: 16 }],
  [-100, 198, -90, { deck: 'asphalt', rail: '', w: 18 }],
  [-105, 204, -150, { deck: 'asphalt', rail: '', w: 18 }],
]

const BRANCHES = [
  {
    // the forest trail: packed snow between the firs, a creek to jump. Shorter, slower going.
    name: 'Forest trail', from: 13, to: 17, odds: 0.4,
    points: [
      [418, 126, 172, { deck: 'dirt', rail: '', w: 15 }],
      [436, 120, 222, { deck: 'dirt', rail: '', w: 15 }],
      [442, 121, 246, { deck: 'dirt', rail: '', w: 15, gap: true }],
      [448, 113, 272, { deck: 'dirt', rail: '', w: 15 }],
      [450, 106, 318, { deck: 'dirt', rail: '', w: 15 }],
    ] as TrackPoint[],
  },
  {
    // straight across the frozen lake: glassy ice, and on the last lap, cracks
    name: 'Ice road', from: 23, to: 25, odds: 0.5,
    points: [
      [150, LAKE.y + 1.4, 655, { deck: 'ice', rail: '', w: 24, raised: true }],
      [60, LAKE.y + 1.4, 650, { deck: 'ice', rail: '', w: 24, raised: true }],
    ] as TrackPoint[],
  },
]

/** The ground follows the route: an interpolated surface through the road, with mountains beyond. */
const ANCHORS: [number, number, number, number][] = (() => {
  const a: [number, number, number, number][] = []
  for (const p of POINTS) if (!p[3]?.gap) a.push([p[0], p[1], p[2], 1])
  for (const b of BRANCHES) for (const p of b.points) if (!p[3]?.gap && !p[3]?.raised) a.push([p[0], p[1], p[2], 1])
  // the landing hill under the glide: it falls away below the flight
  a.push([200, 192, -200, 2], [240, 170, -200, 2], [290, 158, -200, 2], [240, 168, -170, 1], [240, 168, -230, 1])
  // the summit peaks behind the village, and the ridges
  a.push([-260, 290, -380, 0.6], [-120, 260, -420, 0.6], [80, 250, -420, 0.5], [-300, 240, -100, 0.5], [260, 230, -360, 0.4])
  // the lake bed and the valley floor
  a.push([LAKE.x, LAKE.y - 6, LAKE.z, 3], [LAKE.x + 60, LAKE.y - 4, LAKE.z - 40, 1], [LAKE.x - 60, LAKE.y - 4, LAKE.z - 30, 1], [300, 40, 800, 0.6], [-200, 40, 820, 0.5])
  return a
})()

function terrain(x: number, z: number): number {
  let sw = 0, sh = 0, near = 1e9
  for (const [ax, ay, az, w] of ANCHORS) {
    const d2 = (x - ax) ** 2 + (z - az) ** 2 + 400
    const wt = w / (d2 * d2)
    sw += wt
    sh += wt * ay
    near = Math.min(near, d2)
  }
  return sh / sw + Math.sqrt(near) * 0
}

export const bobsleigh: TrackDef = {
  id: 'bobsleigh',
  name: 'Bobsleigh Peak',
  ambience: 'snow',
  width: 15,
  bank: 6,
  maxBank: 0.3,
  shoulder: 22,
  accent: 0x7fd0ff,
  far: 0xe4ecf6,
  farY: 20,
  sea: LAKE.y,
  water: { deep: 0xb8d0e0, shallow: 0xe4f0f8, foam: 0xffffff, waves: 0.02 },
  deck: 'ice',
  rail: 'LR',
  rails: 'none',
  piers: 'none',
  road: { lines: 'plain', kerb: false, grime: 0xdfe8f0, edgeLine: 0x2f6fd0 },
  terrain: { layers: ['snow_02', 'snow_02', 'rock_pitted_mossy', 'snow_02'], tile: [16, 40, 24, 9], tints: [0xf4f8ff, 0xe8f0fa, 0x8e9aa8, 0xfaf8f4], roughness: 0.72 },
  look: {
    tod: 'morning', fog: [0.78, 0.86, 0.96], fogDensity: 0.0007, fogBase: 60, fogFall: 0.005, sunGlow: 0.9,
    exposure: 0.98, sun: 1.25, hemi: 1, bloom: 0.26, shafts: 0.5, grade: [1.1, 1.1, 0, 0.002, 0.012, 1, 1, 1.04, 0.3],
  },
  points: POINTS,
  branches: BRANCHES,
  ground(x, z) {
    const base = terrain(x, z)
    // rougher further from the run, rock on the high ground
    const rough = ridged2(x * 0.006, z * 0.006, 5) * 30 + fbm2(x * 0.02, z * 0.02) * 6
    let near = 1e9
    for (const [ax, , az] of ANCHORS) near = Math.min(near, (x - ax) ** 2 + (z - az) ** 2)
    return base + rough * smooth(40, 220, Math.sqrt(near))
  },
  splat(x, z, _h, slope, _r, mix, tint) {
    const rock = smooth(0.85, 1.3, slope + (fbm2(x * 0.03, z * 0.03) - 0.5) * 0.5)
    mix[0] = 1 - rock
    mix[1] = (1 - rock) * 0.5
    mix[2] = rock
    mix[3] = (1 - rock) * 0.4
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'snow',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Bobsleigh Peak', '#7fd0ff')
    arrows(k, 0x4fa8ff)
    channel(k)
    mountainRing(root, 150, 200, { inner: 1500, outer: 3800, height: 1050, base: -30, rock: 0x6a7686, snow: 0xf4f8ff, snowLine: 0.3, seed: 15 })
    const trail = c.branches[0]!, ice = c.branches[1]!

    const dry = (_x: number, _z: number, y: number) => y > LAKE.y + 2
    forest(k, 'snowpine', d.spots(320, 8, 60, { clear: 7, test: dry }), { scale: [0.7, 1.15], tints: [0xffffff, 0xf0f4f8] })
    forest(k, 'snowpine', d.spots(520, 60, 320, { clear: 24, test: dry }), { scale: [0.8, 1.35], solid: 0, tints: [0xffffff, 0xe8eef4] })
    // the trail runs through thick forest
    const firs: THREE.Vector3[] = []
    for (let i = 0; i < trail.count; i += 3) for (const s of [-1, 1]) {
      const p = trail.samples[i]!, r = trail.rights[i]!, off = s * (trail.widths[i]! / 2 + 3 + d.rand() * 10)
      const x = p.x + r.x * off, z = p.z + r.z * off
      if (d.roadGap(x, z) > 4) firs.push(new THREE.Vector3(x, w.terrainAt(x, z), z))
    }
    forest(k, 'snowpine', firs, { scale: [0.8, 1.2], tints: [0xffffff] })
    const flat = (x: number, z: number, y: number) => {
      const e = 3, gx = w.terrainAt(x + e, z) - w.terrainAt(x - e, z), gz = w.terrainAt(x, z + e) - w.terrainAt(x, z - e)
      return Math.hypot(gx, gz) / (2 * e) < 0.35 && y > LAKE.y + 1
    }
    d.prop('rock_09', d.spots(36, 8, 60, { clear: 8, test: flat }).map((s) => trs(s.x, s.y - 0.5, s.z, d.rand() * 6, 3 + d.rand() * 3)), 0.7)
    d.prop('boulder_01', d.spots(20, 12, 80, { clear: 11, test: flat }).map((s) => trs(s.x, s.y - 1, s.z, d.rand() * 6, 3 + d.rand() * 3)), 0.8)

    village(k)
    skiJump(k)
    rackRailway(k)
    lakeside(k)
    const cabins = gondola(k)
    creekSign(k, trail)

    drift(k, 480, 0xffffff, 0.3, 4.4)
    mist(k, d.spots(16, 40, 220, { clear: 30 }).map((s) => s.setY(s.y + 10)), [100, 180], 0xf4f8ff, 0.14)

    // the trail is packed snow: slower going
    for (const u of [0.2, 0.75]) {
      const p = trail.samples[Math.floor(trail.count * u)]!
      w.patches.push({ x: p.x, z: p.z, r: 16, surface: 'snow', on: true })
    }
    // the lake ice cracks on the last lap
    const cracks = [0.3, 0.7].map((u) => { const p = ice.samples[Math.floor(ice.count * u)]!; return { x: p.x, z: p.z, r: 14, surface: 'mud' as const, on: false } })
    w.patches.push(...cracks)
    const crackMat = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, opacity: 0, depthWrite: false })
    for (const cp of cracks) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(cp.r, 24), crackMat)
      m.rotation.x = -Math.PI / 2
      m.position.set(cp.x, LAKE.y + 1.5, cp.z)
      root.add(m)
    }

    // lap two: snowballs bowling down the chute
    const balls: { m: THREE.Mesh; s: Solid; u: number; lat: number; r: number }[] = []
    const ballGeo = lumpy(new THREE.IcosahedronGeometry(1, 3), 0.1, 2, 5)
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.84 })
    const run0 = c.track(440, -150, 0, c.count), run1 = c.track(480, 560, 0, c.count)
    for (let q = 0; q < 4; q++) {
      const r = 2.2 + q * 0.4
      const m = new THREE.Mesh(ballGeo, ballMat)
      m.scale.setScalar(r)
      m.castShadow = true
      m.visible = false
      root.add(m)
      const s: Solid = { x: 1e6, z: 1e6, r, top: 1e6 }
      w.movers.push(s)
      balls.push({ m, s, u: q / 4, lat: ((q % 3) - 1) * 3.6, r })
    }

    const base = bobsleigh.look.fogDensity
    k.onFrame((f) => {
      cabins(f.time)
      const on = f.lap >= 2
      for (const ball of balls) {
        ball.m.visible = on
        if (!on) { ball.s.x = 1e6; ball.s.z = 1e6; continue }
        ball.u = (ball.u + f.dt * 0.03) % 1
        const i = run0 + Math.floor(ball.u * (run1 - run0))
        const p = c.samples[i]!, r = c.rights[i]!
        const x = p.x + r.x * ball.lat, z = p.z + r.z * ball.lat
        ball.m.position.set(x, p.y + ball.r * 0.9, z)
        ball.m.rotation.x -= f.dt * 6
        ball.s.x = x
        ball.s.z = z
      }
      // last lap: blizzard and cracking ice
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      const fog = base * (last ? 3 : 1)
      atmos.params.x += (fog - atmos.params.x) * Math.min(1, f.dt * 0.4)
      const sceneFog = (root.parent as THREE.Scene | null)?.fog as THREE.FogExp2 | undefined
      if (sceneFog) sceneFog.density = atmos.params.x
      for (const cp of cracks) cp.on = last
      crackMat.opacity = last ? 0.85 : 0
      w.wind.x = last ? Math.sin(f.time * 0.6) * 3 : 0
    })
  },
}

/** The chute: curved ice walls either side of the run, with a packed-snow lip. */
function channel(k: BuildKit): void {
  const { circuit: c, root } = k
  const n = c.count, STEPS = 6
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  for (const side of [-1, 1]) {
    const flag = side < 0 ? c.railL : c.railR
    const base = pos.length / 3
    let along = 0
    for (let i = 0; i <= n; i++) {
      const q = i % n, p = c.samples[q]!, r = c.rights[q]!, half = c.widths[q]! / 2, lean = Math.tan(c.banks[q]!)
      for (let s = 0; s <= STEPS; s++) {
        const a = (s / STEPS) * 1.5, out = (1 - Math.cos(a)) * 2.6, up = Math.sin(a) * 3.4
        const lat = side * (half - 0.6 + out)
        const nx = -Math.sin(a) * side, ny = Math.cos(a)
        pos.push(p.x + r.x * lat, p.y + lat * lean + up, p.z + r.z * lat)
        nor.push(r.x * nx, ny, r.z * nx)
        uv.push(s / STEPS, along * 0.1)
      }
      along += 2
      if (i < n && flag[q] && !c.gap[q] && c.deck[q] === ICE) {
        for (let s = 0; s < STEPS; s++) {
          const o = base + i * (STEPS + 1) + s, wd = STEPS + 1
          if (side > 0) idx.push(o, o + 1, o + wd, o + 1, o + wd + 1, o + wd)
          else idx.push(o, o + wd, o + 1, o + 1, o + wd, o + wd + 1)
        }
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0.02, side: THREE.DoubleSide, envMapIntensity: 1.6 })
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvC = uv;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec2 vC;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n = aFbm(vec2(vC.x * 3.0, vC.y * 1.3));
        vec3 ice = mix(vec3(0.42, 0.68, 0.86), vec3(0.8, 0.92, 0.98), n);
        float lip = smoothstep(0.72, 0.9, vC.x + (n - 0.5) * 0.2);
        ice = mix(ice, vec3(0.97, 0.98, 1.0), lip);
        ice = mix(ice, vec3(1.0), smoothstep(0.7, 0.86, aNoise(vec2(vC.x * 22.0, vC.y * 0.5))) * 0.4);
        diffuseColor.rgb = ice;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.14, 0.9, smoothstep(0.72, 0.9, vC.x));')
  }
  mat.customProgramCacheKey = () => 'kart-chute'
  const m = new THREE.Mesh(g, mat)
  m.frustumCulled = false
  m.receiveShadow = true
  root.add(m)
}

/** A timber chalet with a deep snow-loaded roof and glowing windows. */
function chalet(wood: Mesher, snow: Mesher, lit: Mesher, x: number, y: number, z: number, yaw: number, W: number, D: number, floors: number): void {
  const H = floors * 3.2, cs = Math.cos(yaw), sn = Math.sin(yaw)
  const at = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs]
  wood.box(W + 0.5, 1.6, D + 0.5, x, y + 0.2, z, 0x6a6a68, yaw)
  wood.box(W, H, D, x, y + 1 + H / 2, z, 0x6a4a2e, yaw)
  const rise = W * 0.42, slab = Math.hypot(W / 2 + 1.2, rise), tilt = Math.atan2(rise, W / 2 + 1.2)
  for (const s of [-1, 1]) {
    const [rx, rz] = at(s * (W / 4 + 0.3), 0)
    wood.box(slab, 0.34, D + 2.6, rx, y + 1 + H + rise / 2, rz, 0x3a2a1e, yaw, -s * tilt)
    snow.box(slab + 0.2, 0.7, D + 2.9, rx, y + 1.5 + H + rise / 2, rz, 0xffffff, yaw, -s * tilt)
  }
  for (let f = 0; f < floors; f++) for (const lx of [-W * 0.26, W * 0.26]) {
    for (const s of [-1, 1]) {
      const [wx, wz] = at(lx, s * (D / 2 + 0.04))
      lit.box(1.5, 1.6, 0.06, wx, y + 2.6 + f * 3.2, wz, 0xffc070, yaw)
    }
  }
  const [bx, bz] = at(0, D / 2 + 0.8)
  wood.box(W * 0.9, 0.2, 1.6, bx, y + 1 + 3.2, bz, 0x4a3422, yaw)
  wood.box(W * 0.9, 1, 0.1, bx + sn * 0.75, y + 1 + 3.7, bz + cs * 0.75, 0x4a3422, yaw)
}

/** The summit village: chalets round the start, spectators and flags along the in-run. */
function village(k: BuildKit): void {
  const { circuit: c, world: w, d, root } = k
  const wood = new Mesher(), snow = new Mesher(), lit = new Mesher()
  for (let i = 0; i < c.count; i += 9) {
    const p = c.samples[i]!
    if (p.y < 190 || c.raised[i]) continue
    const r = c.rights[i]!
    for (const s of [-1, 1]) {
      const lat = s * (c.widths[i]! / 2 + 14 + d.rand() * 16), x = p.x + r.x * lat, z = p.z + r.z * lat
      if (d.roadGap(x, z) < 10 || w.blocked(x, z, 8)) continue
      const y = w.terrainAt(x, z), W = 9 + d.rand() * 4, D = 8 + d.rand() * 3, yaw = Math.atan2(r.x * s, r.z * s) + Math.PI
      chalet(wood, snow, lit, x, y, z, yaw, W, D, 1 + Math.floor(d.rand() * 2))
      w.addBox(x, z, W / 2 + 0.5, D / 2 + 0.5, yaw)
    }
  }
  place(k, wood, surface('wood'))
  place(k, snow, surface('plaster', { rough: 0.8 }))
  place(k, lit, glow(2.4, 1.6, 0.8), false)
  const fans: [number, number, number, number][] = []
  for (let i = 4; i < 70; i++) {
    const p = c.samples[i]!, r = c.rights[i]!
    if (c.raised[i]) continue
    for (const s of [-1, 1]) for (let row = 0; row < 2; row++) {
      if (d.rand() < 0.4) continue
      const lat = s * (c.widths[i]! / 2 + 5.5 + row), x = p.x + r.x * lat, z = p.z + r.z * lat
      fans.push([x, w.terrainAt(x, z), z, Math.atan2(r.x * s, r.z * s) + 1.57])
    }
  }
  crowd(k, fans, [0xc82a2a, 0x2a5ac8, 0xe8e8e8, 0x2a9a6a, 0xe8b02a, 0x2a2e38])
  const flagTex = canvasTexture(128, 64, (g, W, H) => {
    const cols = ['#c8262a', '#f4f4f4', '#2a5ac8', '#e8b02a', '#1a9a6a']
    cols.forEach((col, q) => { g.fillStyle = col; g.fillRect(0, (q / cols.length) * H, W, H / cols.length + 1) })
  })
  const poles = new Mesher()
  for (let i = 6; i < 60; i += 10) {
    const p = c.samples[i]!, r = c.rights[i]!
    if (c.raised[i]) continue
    for (const s of [-1, 1]) {
      const lat = s * (c.widths[i]! / 2 + 4.2), x = p.x + r.x * lat, z = p.z + r.z * lat, y = w.terrainAt(x, z)
      poles.post(0.08, 0.05, 9, x, y, z, 0xd8d8dc, 6)
      const f = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.7), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }))
      f.position.set(x + 1.5, y + 8, z)
      root.add(f)
      w.addPost(x, z, 0.2)
    }
  }
  place(k, poles, surface('paint'), false)
}

/** The ski jump: the in-run on its steel trestle, the judges' tower, flags down the landing hill. */
function skiJump(k: BuildKit): void {
  const { circuit: c, world: w } = k
  const m = new Mesher()
  for (let i = 0; i < c.count; i += 3) {
    const p = c.samples[i]!
    if (!c.raised[i] || c.gap[i] || p.y < 190 || c.deck[i] !== 4) continue
    const r = c.rights[i]!, half = c.widths[i]! / 2, t = c.tangents[i]!, yaw = Math.atan2(-t.x, -t.z)
    m.box(c.widths[i]! + 2, 1.2, 6.4, p.x, p.y - 0.8, p.z, 0xd4d8de, yaw)
    if (i % 9 === 0) for (const s of [-1, 1]) {
      const x = p.x + r.x * s * (half + 0.6), z = p.z + r.z * s * (half + 0.6), g = w.terrainAt(x, z)
      if (p.y - g > 1.5) m.post(0.6, 0.7, p.y - g, x, g, z, 0x7a8088, 8)
    }
  }
  // the judges' tower beside the landing hill
  const jx = 250, jz = -240, jy = w.terrainAt(jx, jz)
  m.box(8, 22, 8, jx, jy + 11, jz, 0x8a9098).box(10, 4, 10, jx, jy + 24, jz, 0x5a6068)
  w.addBox(jx, jz, 4, 4)
  place(k, m, surface('concrete'))
  // a line of red flags marking the landing hill
  const flags = new Mesher()
  for (let q = 0; q < 10; q++) for (const s of [-1, 1]) {
    const x = 200 + q * 15, z = -200 + s * 22, y = w.terrainAt(x, z)
    flags.post(0.06, 0.05, 3, x, y, z, 0xc82a2a, 5)
  }
  place(k, flags, surface('paint'), false)
}

/** The rack railway back up: a toothed rail down the middle and gantries over it. */
function rackRailway(k: BuildKit): void {
  const { circuit: c, root } = k
  const teeth: THREE.Matrix4[] = [], frames = new Mesher()
  for (let i = 0; i < c.count; i += 1) {
    const p = c.samples[i]!
    if (c.deck[i] !== 4 || c.raised[i]) continue
    const t = c.tangents[i]!, r = c.rights[i]!, yaw = Math.atan2(-t.x, -t.z), half = c.widths[i]! / 2
    teeth.push(trs(p.x, p.y + 0.12, p.z, yaw, new THREE.Vector3(0.9, 0.18, 0.5)))
    if (i % 20 === 0) {
      for (const s of [-1, 1]) frames.post(0.25, 0.25, 8, p.x + r.x * s * (half + 0.8), p.y, p.z + r.z * s * (half + 0.8), 0x3a4048, 8)
      frames.box(c.widths[i]! + 2.4, 0.5, 0.5, p.x, p.y + 8, p.z, 0x3a4048, yaw)
      frames.box(3, 0.3, 0.8, p.x, p.y + 7.6, p.z, 0xffffff, yaw)
    }
  }
  k.d.instanced(new THREE.BoxGeometry(1, 1, 1), surface('metal', { rough: 0.4 }), teeth, false)
  place(k, frames, surface('metal'))
  void root
}

/** The frozen lake: fishing huts on the ice, a boathouse, reeds poking through the snow. */
function lakeside(k: BuildKit): void {
  const { world: w, d } = k
  const huts = new Mesher()
  for (let q = 0; q < 7; q++) {
    const a = d.rand() * 6.28, r = 30 + d.rand() * 70, x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r
    if (d.roadGap(x, z) < 10) continue
    huts.box(3.6, 2.6, 3.2, x, LAKE.y + 1.3, z, [0xc23a2a, 0x2a5ac8, 0xe8b02a][q % 3]!, d.rand() * 6)
    huts.add(new THREE.ConeGeometry(2.8, 1.4, 4), trs(x, LAKE.y + 3.3, z, Math.PI / 4), 0xffffff)
    w.addPost(x, z, 2.4)
  }
  place(k, huts, surface('wood'))
}

/** Cabins on a cable over the valley, gliding round. */
function gondola(k: BuildKit): (t: number) => void {
  const { world: w, root, d } = k
  const towers = [new THREE.Vector3(-260, 0, 700), new THREE.Vector3(-300, 0, 360), new THREE.Vector3(-320, 0, 40), new THREE.Vector3(-260, 0, -260)]
  const pylons = new Mesher()
  for (const t of towers) {
    t.y = w.terrainAt(t.x, t.z)
    pylons.post(1, 0.5, 36, t.x, t.y - 1, t.z, 0x5a626c, 8)
    pylons.box(9, 0.8, 1, t.x, t.y + 35, t.z, 0x4a525c, -0.7)
    t.y += 35
    if (d.roadGap(t.x, t.z) > 3) w.addPost(t.x, t.z, 1.2)
  }
  for (let q = 1; q < towers.length; q++) pylons.bar(towers[q - 1]!, towers[q]!, 0.05, 0x24262a, 4)
  place(k, pylons, surface('metal'), false)
  const cabin = new Mesher()
  cabin.box(3.4, 2.4, 2.4, 0, -4.4, 0, 0xc23a2a).box(3.5, 1, 2.5, 0, -4.2, 0, 0x2a3a4a).post(0.05, 0.05, 3, 0, -3, 0, 0x24262a, 4)
  const cabins = new THREE.InstancedMesh(cabin.build(), surface('paint'), 8)
  cabins.frustumCulled = false
  root.add(cabins)
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3()
  return (time) => {
    for (let q = 0; q < 8; q++) {
      const u = ((time * 0.012 + q / 8) % 1) * (towers.length - 1), seg = Math.floor(u), t = u - seg
      v.lerpVectors(towers[seg]!, towers[seg + 1]!, t)
      m4.makeTranslation(v.x, v.y, v.z)
      cabins.setMatrixAt(q, m4)
    }
    cabins.instanceMatrix.needsUpdate = true
  }
}

/** A striped log at the creek jump on the forest trail. */
function creekSign(k: BuildKit, trail: Circuit): void {
  let lip = -1
  for (let i = 1; i < trail.count; i++) if (trail.gap[i] && !trail.gap[i - 1]) { lip = i - 1; break }
  if (lip < 0) return
  const p = trail.samples[lip]!, t = trail.tangents[lip]!
  const m = new Mesher()
  m.box(trail.widths[lip]! + 1, 1.4, 1.2, p.x, p.y - 0.8, p.z, 0x5a4028, Math.atan2(-t.x, -t.z))
  m.box(trail.widths[lip]! + 1, 0.25, 1.3, p.x, p.y - 0.1, p.z, 0x7fd0ff, Math.atan2(-t.x, -t.z))
  place(k, m, surface('wood'))
  // the creek itself: dark water in the cut below the jump
  const water = new THREE.Mesh(new THREE.PlaneGeometry(trail.widths[lip]! + 30, 22), new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.1, metalness: 0.2 }))
  water.rotation.x = -Math.PI / 2
  water.rotation.z = Math.atan2(t.x, t.z)
  const mid = trail.samples[Math.min(trail.count - 1, lip + 12)]!
  water.position.set(mid.x, k.world.terrainAt(mid.x, mid.z) + 0.3, mid.z)
  k.root.add(water)
}

function crackTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H)
    g.strokeStyle = 'rgba(40,70,90,0.9)'
    g.lineWidth = 2
    for (let q = 0; q < 14; q++) {
      g.beginPath()
      let x = W / 2, y = H / 2
      g.moveTo(x, y)
      const a = Math.random() * 6.28
      for (let s = 0; s < 8; s++) {
        x += Math.cos(a + (Math.random() - 0.5)) * 16
        y += Math.sin(a + (Math.random() - 0.5)) * 16
        g.lineTo(x, y)
      }
      g.stroke()
    }
  })
}
