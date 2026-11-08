import * as THREE from 'three'
import { canvasTexture, trs } from '../../game/biomes/kit'
import { GLSL_NOISE } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import type { Solid } from '../World'
import { arrows, crates, gantry, glowStreak, mist, stands } from './parts'

/*
 * Neon City, as a night out across town. Down the boulevard and through the
 * neon market hall, then round and round the spiral ramp that climbs a tower
 * up to the expressway. The expressway is a double-decker: the covered lower
 * deck with its boost strips, or the open upper deck with the items. Down
 * into the harbour district along the canal, then through the plaza with its
 * giant screen (or cut through the back alley, if you don't mind crates) and
 * home up the boulevard.
 *
 * Lap 2: trams start running across the plaza and the alley. Last lap: the
 * city blacks out; it's your headlights and the signs.
 */

const NEON = [0xff2f8a, 0x25d9ff, 0xffbf2e, 0xa64dff, 0x4dff9a, 0xff5a3c]
const ADS = ['NITRO', 'COSMOS', 'OVERDRIVE', 'FLAT OUT', 'NO BRAKES', 'MIDNIGHT', 'GRID 9', 'VOLT', 'APEX', 'SYNTH', 'RAMEN', 'HOTEL', 'ARCADE', 'KOI']
const STREET = 2.6
const TOWER = { x: 560, z: -170, r: 40 }
const CANAL = { z: -655, half: 22, x0: -320, x1: 90 }
const HALL = { x0: 300, x1: 425, z: -20 }
const TRAM_Z = -370
const PLAZA = { x: -215, z: -370 }

const helix: TrackPoint[] = [90, 20, -50, -120, -190, -260].map((a, q) => {
  const th = (a * Math.PI) / 180
  return [Math.round(TOWER.x + Math.cos(th) * 72), 4 + q * 4.6, Math.round(TOWER.z + Math.sin(th) * 72), q > 0 ? { raised: true, rail: 'LR' } : { rail: 'LR' }] as TrackPoint
})

const POINTS: TrackPoint[] = [
  // 0: the boulevard, heading east
  [0, 3, 0],
  [140, 3, 0, { pad: 0 }],
  [250, 3, -10, { items: true }],
  // 3: through the neon market hall
  [330, 3, -20],
  [420, 3, -20],
  [495, 3, -60],
  // 6: round the spiral ramp up the tower
  ...helix,
  [615, 31.6, -124, { raised: true, rail: 'LR' }],
  // 13: the expressway north (the upper deck leaves here)
  [668, 33, -300, { raised: true, rail: 'L' }],
  [668, 33, -460, { raised: true, rail: 'LR', pad: 0 }],
  [664, 33, -600, { raised: true, rail: 'LR' }],
  [620, 32, -700, { raised: true, rail: 'L' }], // 16: the upper deck rejoins
  // 17: west, and the long descent into the harbour district
  [500, 28, -760, { raised: true, rail: 'LR', items: true }],
  // 18: a span missing from the descent, mid-repair: jump it
  [372, 22, -752, { raised: true, rail: 'LR' }],
  [336, 24, -742, { raised: true, gap: true }],
  [300, 19, -728, { raised: true, rail: 'LR', w: 22 }],
  [240, 13, -705, { raised: true, rail: 'LR' }],
  [150, 4, -630],
  // 21: along the canal
  [20, 3, -598, { pad: 0 }],
  [-110, 3, -560], // 24: the alley leaves here
  // 25: through the plaza, past the giant screen
  [-200, 3, -480],
  [-215, 3, -370, { items: true }],
  [-180, 3, -260],
  [-120, 3, -140], // 28: the alley rejoins
  [-60, 3, -45],
]

export const neon: TrackDef = {
  id: 'neon',
  name: 'Neon City',
  ambience: 'city',
  width: 18,
  bank: 1.6,
  accent: 0xff2fb4,
  far: 0x0c0c14,
  farY: 2,
  sea: 0,
  water: { deep: 0x05060c, shallow: 0x141428, foam: 0x6a6a8a, waves: 0.3 },
  road: { lines: 'highway', kerb: false, grime: 0x14141c, edgeLine: 0x9a9aa8, tone: 0xb8b8c8, sheen: 0x8a3a9a },
  rails: 'steel',
  piers: 'none',
  terrain: { layers: ['grass', 'grass', 'rock_pitted_mossy', 'grass'], tile: [8, 8, 8, 8], tints: [0x1a1a22, 0x1a1a22, 0x1e1e26, 0x1a1a22], roughness: 0.4 },
  look: {
    tod: 'night', generatedSky: true, top: [0.02, 0.02, 0.07], horizon: [0.34, 0.07, 0.34], mix: 1, stars: 0.2, fog: [0.11, 0.05, 0.16], fogDensity: 0.0013, fogBase: 3, fogFall: 0.0045, sunGlow: 0,
    exposure: 1.24, sun: 0.7, hemi: 2.6, bloom: 0.42, wet: 0.72, headlights: 1, grade: [1.2, 1.12, 0.004, 0, 0.012, 1.02, 0.98, 1.04, 0.42],
  },
  points: POINTS,
  branches: [
    {
      // the open upper deck of the expressway, above the lower one
      name: 'Upper deck', from: 13, to: 16, odds: 0.5,
      points: [
        [686, 35, -345, { raised: true, rail: 'R' }],
        [690, 41, -395, { raised: true, rail: 'LR' }],
        [668, 46, -455, { raised: true, rail: 'LR', items: true }],
        [668, 46, -540, { raised: true, rail: 'LR' }],
        [690, 40, -600, { raised: true, rail: 'LR' }],
        [680, 35, -652, { raised: true, rail: 'R' }],
      ],
    },
    {
      // the back alley: narrow, dark, crates everywhere. Shorter, if you can thread it.
      name: 'Alley', from: 24, to: 28, odds: 0.4,
      points: [
        [-118, 3, -450, { w: 10, rail: '' }],
        [-122, 3, -300, { w: 10, rail: '' }],
      ],
    },
  ],
  ground(x, z) {
    if (x > CANAL.x0 && x < CANAL.x1 && Math.abs(z - CANAL.z) < CANAL.half) return -6
    return STREET
  },
  surfaceAt: () => 'concrete',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Neon City', '#ff2fb4')
    stands(k, 8, 42, -1, [0xc0307a, 0x2aa8c8, 0xcfd0d8, 0x2a2e3a, 0x7a3ac0], 0xff2fb4, 'Midnight Run')
    arrows(k, 0xff6fd0)
    const upper = c.branches[0]!, alley = c.branches[1]!

    const blackout = { value: 0 }
    const fronts = streetFronts(k)
    towers(k, blackout, fronts)
    expressway(k)
    const hallLit = marketHall(k)
    spiralTower(k, blackout)
    const { lit, pools, headMat } = signsAndLamps(k)
    canal(k)
    const screen = plaza(k)
    alleyCrates(k, alley)
    const tram = trams(k)

    crates(d, d.spots(16, 1.5, 6, { from: 0.72, to: 1, clear: 1.5 }), 0x6a7a9a)
    d.prop('metal_trash_can', d.spots(30, 1.2, 5, { clear: 1.2, test: (_x, _z, y) => y > 1 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.3)), 0.4)
    d.prop('utility_box_01', d.spots(18, 1.5, 6, { clear: 1.3, test: (_x, _z, y) => y > 1 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4)), 0.5)
    d.prop('fire_hydrant', d.spots(16, 1, 4, { clear: 1, test: (_x, _z, y) => y > 1 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.2)), 0.3)
    mist(k, d.spots(20, 0.5, 6, { clear: 0.2, test: (_x, _z, y) => y > 1 }).map((s) => s.setY(s.y + 3)), [10, 18], 0xa090c0, 0.16)

    // hover traffic high between the towers
    const FLY = 40
    const flyers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.7, 5.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), FLY)
    flyers.frustumCulled = false
    const lanes = Array.from({ length: FLY }, (_, q) => ({ u: d.rand(), lat: (q % 2 ? 1 : -1) * (16 + d.rand() * 16), up: 40 + (q % 3) * 12, v: (q % 2 ? 1 : -1) * (0.012 + d.rand() * 0.01) }))
    lanes.forEach((_, q) => flyers.setColorAt(q, new THREE.Color(NEON[q % NEON.length]!).multiplyScalar(2.4)))
    root.add(flyers)
    const m4 = new THREE.Matrix4()
    k.onFrame((f) => {
      lanes.forEach((l, q) => {
        l.u = (l.u + l.v * f.dt + 1) % 1
        const i = Math.floor(l.u * c.count), p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
        m4.makeRotationY(Math.atan2(t.x, t.z))
        m4.setPosition(p.x + r.x * l.lat, Math.max(p.y, 3) + l.up, p.z + r.z * l.lat)
        flyers.setMatrixAt(q, m4)
      })
      flyers.instanceMatrix.needsUpdate = true
      tram(f.lap >= 2, f.time, f.dt)
      screen(f.time)
      // the final lap goes dark: towers and street lights fail, signs flicker
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      blackout.value += ((last ? 1 : 0) - blackout.value) * Math.min(1, f.dt * 1.5)
      const k2 = 1 - blackout.value
      headMat.color.setRGB(3 * k2 + 0.05, 2.5 * k2 + 0.05, 1.8 * k2 + 0.05)
      hallLit.color.setRGB(2.4 * k2 + 0.2, 1.2 * k2 + 0.1, 2.2 * k2 + 0.2)
      for (const p of pools) (p.material as THREE.MeshBasicMaterial).opacity = 0.5 * k2
      for (const { m, g } of lit) {
        const on = last ? (Math.sin(f.time * 13 + m.id) > 0.2 ? 1.6 : 0.25) : 1.6
        m.color.setScalar(on)
        ;(g.material as THREE.MeshBasicMaterial).opacity = 0.32 * on
      }
    })
    void upper
  },
}

/** Curtain walls: windows from world position, some lit, glass that catches the sky. */
function towerMaterial(blackout: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })
  m.onBeforeCompile = (s) => {
    s.uniforms['uOut'] = blackout
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;\nvarying vec3 vN2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN2 = normal;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vW;\nvarying vec3 vN2;\nuniform float uOut;\nfloat gWin;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.72, 0.14, gWin);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float side = abs(vN2.y) > 0.5 ? 0.0 : 1.0;
          float along = abs(vN2.x) > 0.5 ? vW.z : vW.x;
          vec2 cell = vec2(floor(along / 1.9), floor(vW.y / 3.2));
          vec2 f = vec2(fract(along / 1.9), fract(vW.y / 3.2));
          float win = step(0.08, f.x) * step(f.x, 0.92) * step(0.18, f.y) * step(f.y, 0.8) * side;
          gWin = win;
          float rnd = aHash(cell + floor(vW.x * 0.02) * 3.1);
          float block = aNoise(vec2(cell.x * 0.17, cell.y * 0.31) + floor(vW.z * 0.02) * 1.7);
          float lit = step(0.84 - block * 0.34, rnd);
          vec3 tone = mix(vec3(1.0, 0.72, 0.42), vec3(0.52, 0.8, 1.0), step(0.72, aHash(cell + 9.0)));
          tone = mix(tone, vec3(1.0, 0.42, 0.72), step(0.93, aHash(cell + 21.0)));
          float blind = 0.45 + aHash(cell + 4.0) * 0.55;
          totalEmissiveRadiance += tone * win * lit * blind * 0.62 * (1.0 - uOut);
          totalEmissiveRadiance += vec3(0.5, 0.2, 0.42) * side * (1.0 - win) * exp(-vW.y * 0.06) * 0.14;
        }`)
  }
  m.customProgramCacheKey = () => 'kart-tower'
  return m
}

/** A street front of brick buildings (Poly Haven facade kits) facing the street roads. */
function streetFronts(k: BuildKit): { x: number; z: number; r: number }[] {
  const { circuit: c, world: w, d } = k
  const fronts: { x: number; z: number; r: number }[] = []
  const kinds = [{ name: 'bk:apartment_a', w: 12, d: 9 }, { name: 'bk:apartment_b', w: 9, d: 9 }, { name: 'bk:factory_a', w: 15, d: 9 }] as const
  const fm = new Map<string, THREE.Matrix4[]>()
  for (const p of c.all) for (let i = 0; i < p.count; i += 6) {
    if (p.raised[i] || p.samples[i]!.y > 5 || Math.abs(p.bends[i]!) > 0.005) continue
    const s0 = p.samples[i]!
    if (s0.x > HALL.x0 - 10 && s0.x < HALL.x1 + 10 && Math.abs(s0.z - HALL.z) < 30) continue
    for (const side of [-1, 1]) {
      const kd = kinds[Math.floor(d.rand() * kinds.length)]!, s = 1.25 + d.rand() * 0.2
      const r = p.rights[i]!, off = side * (p.widths[i]! / 2 + 10 + kd.d * s / 2)
      const x = s0.x + r.x * off, z = s0.z + r.z * off, rad = Math.hypot(kd.w, kd.d) * s / 2
      if (w.terrainAt(x, z) < 1 || d.roadGap(x, z) < rad + 5 || fronts.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + rad + 2)) continue
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < 60 || Math.abs(z - TRAM_Z) < 14) continue
      const yaw = Math.atan2(-side * r.x, -side * r.z)
      fronts.push({ x, z, r: rad })
      const list = fm.get(kd.name) ?? []
      list.push(trs(x, STREET, z, yaw, s))
      fm.set(kd.name, list)
      w.addBox(x, z, kd.w * s / 2, kd.d * s / 2, yaw)
    }
  }
  for (const [name, mats] of fm) d.prop(name as 'bk:apartment_a', mats, 0, undefined, 560)
  return fronts
}

/** Towers on a street grid: podium, shaft, setbacks and plant on the roof. */
function towers(k: BuildKit, blackout: { value: number }, fronts: { x: number; z: number; r: number }[]): void {
  const { world: w, d } = k
  const m = new Mesher(), tops = new Mesher(), lamps: THREE.Matrix4[] = []
  const tones = [0x161922, 0x1c1a24, 0x12161e, 0x1e1e2a]
  for (let x = -720; x <= 920; x += 58) for (let z = -1160; z <= 420; z += 58) {
    const cx = x + (d.rand() - 0.5) * 7, cz = z + (d.rand() - 0.5) * 7
    const hx = 15 + d.rand() * 7, hz = 15 + d.rand() * 7, rad = Math.hypot(hx, hz)
    if (d.roadGap(cx, cz) < rad + 6 || w.terrainAt(cx, cz) < 1) continue
    if (Math.hypot(cx - TOWER.x, cz - TOWER.z) < 110 || Math.hypot(cx - PLAZA.x, cz - PLAZA.z) < 70 || Math.abs(cz - TRAM_Z) < rad + 8) continue
    if (fronts.some((f) => Math.hypot(f.x - cx, f.z - cz) < f.r + rad + 1)) continue
    const near = d.roadGap(cx, cz) < 70
    const tall = (near ? 50 : 76) + d.rand() * d.rand() * 230
    const tone = tones[Math.floor(d.rand() * 4)]!
    m.box(hx * 2 + 2, 15, hz * 2 + 2, cx, 7.5, cz, 0x20212c)
    let y = 15, sx = hx * 2, sz = hz * 2
    const tiers = tall > 120 ? 3 : tall > 70 ? 2 : 1
    for (let q = 0; q < tiers; q++) {
      const h = (tall - 15) / tiers
      m.box(sx, h, sz, cx, y + h / 2, cz, tone)
      y += h
      sx *= 0.78; sz *= 0.78
    }
    tops.box(sx * 0.5, 4, sz * 0.5, cx, y + 2, cz, 0x202430)
    if (d.rand() < 0.5) {
      tops.box(0.5, 18, 0.5, cx, y + 11, cz, 0x303440)
      lamps.push(trs(cx, y + 20, cz, 0, 0.9))
    }
    w.addBox(cx, cz, hx + 1, hz + 1)
  }
  place(k, m, towerMaterial(blackout), false)
  place(k, tops, surface('metal'), false)
  d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false }), lamps, false)
}

/** Columns and girders under every raised road, set at the edges so decks can stack. */
function expressway(k: BuildKit): void {
  const { circuit: c, world: w } = k
  const m = new Mesher(), strip = new Mesher()
  for (const p of c.all) for (let i = 0; i < p.count; i += 2) {
    if (!p.raised[i] || p.gap[i]) continue
    const s = p.samples[i]!, r = p.rights[i]!, t = p.tangents[i]!, half = p.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    // the deck: a slab with an edge girder each side
    m.box(p.widths[i]! + 2.4, 1.6, 2.2, s.x, s.y - 1, s.z, 0x3a3c46, yaw)
    if (i % 4 === 0) for (const e of [-1, 1]) strip.box(0.2, 0.25, 4, s.x + r.x * e * (half + 1.1), s.y - 0.7, s.z + r.z * e * (half + 1.1), 0xffffff, yaw)
    if (i % 16) continue
    // columns at the edges, down to the street (or to the deck below, if there is one)
    // a deck with another under it stands its columns wide, clear of the lower road
    let over = false
    for (const o of c.all) {
      const j = o.track(s.x, s.z, 0, o.count, s.y - 6), q = o.samples[j]!
      // (the spiral passes over itself: another turn of the same road counts)
      if (o === p && Math.min(Math.abs(j - i), o.count - Math.abs(j - i)) < 40) continue
      if (q.y < s.y - 4 && Math.hypot(q.x - s.x, q.z - s.z) < o.widths[j]! / 2 + 4) over = true
    }
    const spread = half + (over ? 4.4 : 1.6)
    for (const e of [-1, 1]) {
      const x = s.x + r.x * e * spread, z = s.z + r.z * e * spread
      const base = Math.max(w.terrainAt(x, z), -4)
      // never stand a column on a road below
      let onRoad = false
      for (const o of c.all) {
        const j = o.track(x, z, 0, o.count, base + 2), q = o.samples[j]!, rr = o.rights[j]!
        if (q.y > s.y - 3) continue
        const lat = (x - q.x) * rr.x + (z - q.z) * rr.z, along = Math.abs((x - q.x) * o.tangents[j]!.x + (z - q.z) * o.tangents[j]!.z)
        if (Math.abs(lat) < o.widths[j]! / 2 + 1.8 && along < 3) onRoad = true
      }
      if (onRoad) continue
      if (s.y - base < 3) continue
      m.box(1.4, s.y - base - 1.4, 1.4, x, (s.y - 1.6 + base) / 2, z, 0x4a4c56, yaw)
      w.addPost(x, z, 0.9, s.y - 2.4)
    }
  }
  place(k, m, surface('concrete'), true)
  const lights = new THREE.Mesh(strip.build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 2.6), toneMapped: false }))
  k.root.add(lights)
}

/** The neon market hall the boulevard runs through: stalls, signs and a glowing roof. */
function marketHall(k: BuildKit): THREE.MeshBasicMaterial {
  const { circuit: c, world: w, root } = k
  const shell = new Mesher(), glowM = new Mesher()
  for (let i = 0; i < c.count; i += 3) {
    const p = c.samples[i]!
    if (p.x < HALL.x0 || p.x > HALL.x1 || Math.abs(p.z - HALL.z) > 20 || p.y > 6) continue
    const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
    for (const s of [-1, 1]) {
      const ox = p.x + r.x * s * (half + 9), oz = p.z + r.z * s * (half + 9)
      shell.box(1, 13, 6.2, ox, STREET + 6.5, oz, 0x1c1c26, yaw)
      w.addBox(ox, oz, 0.6, 3.4, yaw)
      // stalls along the walls, each with a lit counter
      const sx = p.x + r.x * s * (half + 4.5), sz = p.z + r.z * s * (half + 4.5)
      shell.box(5, 2.6, 5.6, sx, STREET + 1.3, sz, 0x2a2430, yaw)
      glowM.box(0.2, 0.5, 5.6, sx - r.x * s * 2.6, STREET + 2.4, sz - r.z * s * 2.6, 0xffffff, yaw)
      w.addBox(sx, sz, 2.6, 2.9, yaw)
    }
    shell.box(c.widths[i]! + 20, 1, 6.2, p.x, STREET + 13.2, p.z, 0x15151c, yaw)
    if (i % 9 === 0) glowM.box(c.widths[i]! + 14, 0.25, 0.6, p.x, STREET + 12.4, p.z, 0xffffff, yaw)
  }
  place(k, shell, surface('metal', { rough: 0.6 }))
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.2, 2.2), toneMapped: false })
  root.add(new THREE.Mesh(glowM.build(), mat))
  return mat
}

/** The tower the spiral ramp climbs round, lit in bands. */
function spiralTower(k: BuildKit, blackout: { value: number }): void {
  const { world: w, root } = k
  const m = new Mesher()
  m.add(new THREE.CylinderGeometry(TOWER.r - 6, TOWER.r, 180, 32), trs(TOWER.x, 90, TOWER.z), 0x1a1c26)
  place(k, m, towerMaterial(blackout), false)
  const bands = new Mesher()
  for (let h = 14; h < 180; h += 22) bands.add(new THREE.TorusGeometry(TOWER.r - (h / 180) * 6 + 0.4, 0.35, 6, 48), trs(TOWER.x, h, TOWER.z, 0, 1, Math.PI / 2), 0xffffff)
  root.add(new THREE.Mesh(bands.build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 1.8), toneMapped: false })))
  w.addPost(TOWER.x, TOWER.z, TOWER.r)
}

/** Signs on poles and shopfront glow along the streets, and street lamps with pools of light. */
function signsAndLamps(k: BuildKit): { lit: { m: THREE.MeshBasicMaterial; g: THREE.Mesh }[]; pools: THREE.Mesh[]; headMat: THREE.MeshBasicMaterial } {
  const { circuit: c, world: w, d, root } = k
  const lit: { m: THREE.MeshBasicMaterial; g: THREE.Mesh }[] = []
  const posts = new Mesher()
  for (let i = 6; i < c.count; i += 26) {
    if (Math.abs(c.bends[i]!) > 0.006) continue
    const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, s = (i / 26) % 2 < 1 ? 1 : -1
    const off = s * (c.widths[i]! / 2 + 7)
    const x = p.x + r.x * off, z = p.z + r.z * off
    if (d.roadGap(x, z) < 5 || w.blocked(x, z, 1)) continue
    const col = NEON[Math.floor(d.rand() * NEON.length)]!, cssCol = `#${col.toString(16).padStart(6, '0')}`, ad = ADS[Math.floor(d.rand() * ADS.length)]!
    const vertical = d.rand() < 0.4
    const tex = canvasTexture(vertical ? 96 : 256, vertical ? 320 : 96, (g, W, H) => {
      g.fillStyle = '#05060b'
      g.fillRect(0, 0, W, H)
      g.strokeStyle = cssCol
      g.lineWidth = 5
      g.strokeRect(5, 5, W - 10, H - 10)
      g.fillStyle = cssCol
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      if (vertical) {
        g.font = '800 46px "Barlow Condensed", Arial, sans-serif'
        ;[...ad].slice(0, 6).forEach((ch, q, a) => g.fillText(ch, W / 2, (q + 0.5) * (H / a.length)))
      } else {
        g.font = 'italic 800 56px "Barlow Condensed", Arial, sans-serif'
        g.fillText(ad, W / 2, H / 2 + 2, W - 24)
      }
    })
    const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) })
    const bw = vertical ? 4 : 13, bh = vertical ? 13 : 4.8
    const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), m)
    const base = c.raised[i] ? p.y : STREET
    b.position.set(x, base + 7 + bh / 2, z)
    b.rotation.y = Math.atan2(-t.x, -t.z) + s * 0.5
    root.add(b)
    posts.box(0.5, 8, 0.5, x, base + 3.8, z, 0x23252e)
    if (!c.raised[i]) w.addPost(x, z, 0.5)
    const col3 = new THREE.Color(col).multiplyScalar(0.8)
    const g = glowStreak(k, p.x + r.x * (off * 0.56), (c.raised[i] ? p.y : STREET) + 0.5, p.z + r.z * (off * 0.56), Math.atan2(-t.x, -t.z), col3, 26, 10)
    lit.push({ m, g })
  }
  if (!posts.empty) place(k, posts, surface('metal'), false)
  const poles = new Mesher(), heads: THREE.Matrix4[] = [], pools: THREE.Mesh[] = []
  for (let i = 2; i < c.count; i += 20) {
    if (c.raised[i] || Math.abs(c.bends[i]!) > 0.005) continue
    const p = c.samples[i]!, r = c.rights[i]!, s = (i / 20) % 2 < 1 ? 1 : -1
    const off = s * (c.widths[i]! / 2 + 1.8), x = p.x + r.x * off, z = p.z + r.z * off
    if (d.roadGap(x, z) < 1.4 || w.terrainAt(x, z) < 1) continue
    poles.post(0.12, 0.09, 10, x, STREET, z, 0x23262f, 6)
    poles.bar(new THREE.Vector3(x, 12.4, z), new THREE.Vector3(x - r.x * s * 3, 12.8, z - r.z * s * 3), 0.06, 0x23262f, 4)
    heads.push(trs(x - r.x * s * 3, 12.7, z - r.z * s * 3, 0, new THREE.Vector3(1.6, 0.16, 0.5)))
    pools.push(glowStreak(k, x - r.x * s * 4, 3.1, z - r.z * s * 4, 0, new THREE.Color(1, 0.72, 0.42).multiplyScalar(0.3), 18, 18))
    w.addPost(x, z, 0.4)
  }
  place(k, poles, surface('metal'), false)
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.5, 1.8), toneMapped: false })
  k.d.instanced(new THREE.BoxGeometry(1, 1, 1), headMat, heads, false)
  return { lit, pools, headMat }
}

/** The canal: stone walls, moored boats and a railing along the street side. */
function canal(k: BuildKit): void {
  const { d } = k
  const m = new Mesher()
  for (let x = CANAL.x0; x < CANAL.x1; x += 8) for (const e of [-1, 1]) {
    const z = CANAL.z + e * CANAL.half
    if (d.roadGap(x, z) < 4) continue
    m.box(8.2, 9, 1.6, x + 4, -2, z, 0x3a3a44)
    m.box(8.2, 0.4, 2, x + 4, STREET + 0.2, z, 0x55555e)
  }
  place(k, m, surface('stone'))
  const boats: THREE.Matrix4[] = []
  for (let q = 0; q < 10; q++) boats.push(trs(CANAL.x0 + 30 + d.rand() * (CANAL.x1 - CANAL.x0 - 60), -0.3, CANAL.z + (d.rand() - 0.5) * 20, Math.PI / 2 + (d.rand() - 0.5) * 0.2, 0.16))
  d.prop('dutch_ship_medium', boats, 0, undefined, 500)
}

/** The plaza: a giant screen on a podium building, and a fountain. */
function plaza(k: BuildKit): (t: number) => void {
  const { world: w, root } = k
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 256
  const g = cv.getContext('2d')!
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const sx = PLAZA.x - 70, sz = PLAZA.z
  const body = new Mesher()
  body.box(16, 60, 50, sx, 30, sz, 0x1a1a22)
  place(k, body, surface('metal', { rough: 0.5 }), false)
  w.addBox(sx, sz, 8, 25)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
  screen.position.set(sx + 8.2, 34, sz)
  screen.rotation.y = Math.PI / 2
  root.add(screen)
  const fountain = new Mesher()
  fountain.post(9, 9.5, 1, PLAZA.x + 45, STREET, PLAZA.z + 40, 0x55555e, 24)
  fountain.post(1.4, 1.6, 4, PLAZA.x + 45, STREET, PLAZA.z + 40, 0x55555e, 12)
  place(k, fountain, surface('stone'))
  w.addPost(PLAZA.x + 45, PLAZA.z + 40, 9.5)
  let last = -1
  return (t) => {
    const frame = Math.floor(t * 2)
    if (frame === last) return
    last = frame
    const words = ['NITRO', 'COSMOS', 'NEON CITY', 'FLAT OUT', 'MIDNIGHT RUN']
    const col = NEON[frame % NEON.length]!
    g.fillStyle = '#05060c'
    g.fillRect(0, 0, 512, 256)
    for (let q = 0; q < 14; q++) {
      g.fillStyle = `#${NEON[(frame + q) % NEON.length]!.toString(16).padStart(6, '0')}22`
      g.fillRect(0, q * 18 + ((t * 40) % 18), 512, 6)
    }
    g.fillStyle = `#${col.toString(16).padStart(6, '0')}`
    g.font = 'italic 900 88px "Barlow Condensed", Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(words[Math.floor(frame / 3) % words.length]!, 256, 128, 480)
    tex.needsUpdate = true
  }
}

/** Crates stacked down the alley: they smash, and each one costs a little speed. */
function alleyCrates(k: BuildKit, alley: Circuit): void {
  const { world: w, root, d } = k
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 })
  const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4)
  for (let i = 10; i < alley.count - 10; i += 9) {
    const p = alley.samples[i]!, r = alley.rights[i]!, lat = (d.rand() - 0.5) * (alley.widths[i]! - 3)
    const x = p.x + r.x * lat, z = p.z + r.z * lat
    const box = new THREE.Mesh(geo, mat)
    box.position.set(x, p.y + 0.7, z)
    box.rotation.y = d.rand() * 6
    root.add(box)
    w.addBreakable({ x, z, y: p.y, r: 1, live: true, hit: () => { box.visible = false } })
  }
  // the alley's walls: dark brick backs with fire escapes and a few lit windows
  const walls = new Mesher(), lights = new Mesher()
  for (let i = 0; i < alley.count; i += 4) {
    const p = alley.samples[i]!, r = alley.rights[i]!, t = alley.tangents[i]!, yaw = Math.atan2(-t.x, -t.z)
    for (const s of [-1, 1]) {
      const x = p.x + r.x * s * 8.5, z = p.z + r.z * s * 8.5
      if (d.roadGap(x, z) < 3) continue
      walls.box(4, 22, 8.2, x, STREET + 11, z, 0x2a1e1e, yaw)
      if (i % 12 === 0) lights.box(0.2, 1.4, 1.2, x - r.x * s * 2.1, STREET + 6 + (i % 3) * 3, z - r.z * s * 2.1, 0xffffff, yaw)
      w.addBox(x, z, 2, 4.2, yaw)
    }
  }
  place(k, walls, surface('stone', { rough: 0.95 }), false)
  root.add(new THREE.Mesh(lights.build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.8), toneMapped: false })))
}

/** Trams across the plaza and the alley: rails always, the trams from lap 2. */
function trams(k: BuildKit): (on: boolean, t: number, dt: number) => void {
  const { world: w, root } = k
  const x0 = -330, x1 = -40
  const rails = new Mesher()
  for (const e of [-0.8, 0.8]) rails.box(x1 - x0, 0.08, 0.16, (x0 + x1) / 2, STREET + 0.45, TRAM_Z + e, 0x9a9aa4)
  place(k, rails, surface('metal'))
  const body = new Mesher()
  body.box(24, 3.4, 2.8, 0, 2.2, 0, 0xd8d4c8).box(24.2, 0.5, 3, 0, 4, 0, 0x2a2e38).box(23.6, 1.1, 2.9, 0, 2.8, 0, 0x1a2a3a)
  const tram = new THREE.Mesh(body.build(), surface('paint', { rough: 0.4 }))
  tram.visible = false
  root.add(tram)
  const solid: Solid = { x: x0, z: TRAM_Z, r: 13, hx: 12.5, hz: 1.8, cos: 1, sin: 0, top: -1e6 }
  w.movers.push(solid)
  let u = 0
  return (on, _t, dt) => {
    tram.visible = on
    if (!on) { solid.top = -1e6; return }
    // across and back, about twenty seconds a round trip
    u = (u + dt / 20) % 1
    const s = u < 0.5 ? u * 2 : 2 - u * 2
    const x = x0 + (x1 - x0) * (s * s * (3 - 2 * s))
    tram.position.set(x, STREET, TRAM_Z)
    solid.x = x
    solid.top = STREET + 4
  }
}
