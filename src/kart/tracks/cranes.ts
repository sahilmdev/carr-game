import * as THREE from 'three'
import { fbm2, smooth, trs } from '../../game/biomes/kit'
import { GLSL_NOISE } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest } from '../art/foliage'
import type { Solid } from '../World'
import type { BuildKit, TrackDef } from '../types'
import { arrows, crates, gantry, glow, stands } from './parts'

/** Curtain-wall glass: mullions and spandrels laid out in world space, so any box reads as a tower. */
function glassMaterial(tint: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.18, metalness: 0.75, envMapIntensity: 1.5 })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGw;\nvarying vec3 vGn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGw = (modelMatrix * vec4(position, 1.0)).xyz;\nvGn = normalize(mat3(modelMatrix) * normal);')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vGw;\nvarying vec3 vGn;\nfloat gFrame;`)
      .replace('#include <map_fragment>', `
        {
          float along = abs(vGn.x) > 0.5 ? vGw.z : vGw.x;
          vec2 cell = vec2(along / 1.8, vGw.y / 3.6);
          vec2 f = fract(cell);
          float mull = step(f.x, 0.06) + step(0.94, f.x);
          float floorBand = step(f.y, 0.22);
          gFrame = clamp(mull + floorBand, 0.0, 1.0) * step(abs(vGn.y), 0.5);
          float pane = aNoise(floor(cell) * 0.7);
          diffuseColor.rgb *= mix(0.75 + pane * 0.35, 0.35, gFrame);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.7, gFrame);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, 0.2, gFrame);')
  }
  m.customProgramCacheKey = () => `kart-glass-${tint}`
  return m
}

/** A tower crane: lattice mast, slewing jib and counter-jib. Returns the turning part. */
function crane(k: BuildKit, x: number, z: number, h: number, jib: number): { top: THREE.Group; mast: THREE.Vector3 } {
  const { world: w, root } = k
  const y = w.terrainAt(x, z)
  const mast = new Mesher(), Y = 0xe8b820
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mast.box(0.3, h, 0.3, x + a! * 1, y + h / 2, z + b! * 1, Y)
  for (let q = 0; q < h; q += 3) {
    mast.bar(new THREE.Vector3(x - 1, y + q, z - 1), new THREE.Vector3(x + 1, y + q + 3, z - 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x + 1, y + q, z + 1), new THREE.Vector3(x - 1, y + q + 3, z + 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x - 1, y + q, z + 1), new THREE.Vector3(x - 1, y + q + 3, z - 1), 0.07, Y, 4)
    mast.bar(new THREE.Vector3(x + 1, y + q, z - 1), new THREE.Vector3(x + 1, y + q + 3, z + 1), 0.07, Y, 4)
  }
  mast.box(3.6, 1, 3.6, x, y + 0.5, z, 0x6a6e74)
  place(k, mast, surface('paint', { metal: 0.5, rough: 0.45 }))
  w.addPost(x, z, 2)
  const top = new THREE.Group()
  const t = new Mesher()
  // jib out along +x, counter-jib with its weights along -x
  t.box(jib, 0.3, 0.3, jib / 2, 0, -0.8, Y).box(jib, 0.3, 0.3, jib / 2, 0, 0.8, Y).box(jib * 0.9, 0.3, 0.3, jib * 0.45, 1.8, 0, Y)
  for (let q = 0; q < jib; q += 2.5) {
    t.bar(new THREE.Vector3(q, 0, -0.8), new THREE.Vector3(q + 1.25, 1.8, 0), 0.06, Y, 4)
    t.bar(new THREE.Vector3(q + 1.25, 1.8, 0), new THREE.Vector3(q + 2.5, 0, 0.8), 0.06, Y, 4)
  }
  t.box(16, 0.6, 2, -8, 0, 0, Y).box(4, 3.4, 2.4, -13, -1.4, 0, 0x8a8e94)
  t.box(2.6, 2.6, 2.6, 2, -1.2, 0, 0x30343c) // the cab
  t.box(1.2, 9, 1.2, 0, 5, 0, Y)
  t.bar(new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(jib * 0.85, 1.8, 0), 0.05, 0x404448, 4)
  t.bar(new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(-15, 0.3, 0), 0.05, 0x404448, 4)
  const tm = new THREE.Mesh(t.build(), surface('paint', { metal: 0.5, rough: 0.45 }))
  tm.castShadow = true
  top.add(tm)
  top.position.set(x, y + h, z)
  root.add(top)
  return { top, mast: new THREE.Vector3(x, y + h, z) }
}

const STREET = 0.5

/**
 * Skyline Cranes: off the street, up the ramp and across the rooftops of a
 * half-built district, leaping the gaps between towers and running the
 * scaffolding planks. Tower cranes slew overhead; from the second lap their
 * loads swing low across the road, and on the last lap there are more of them.
 */
export const cranes: TrackDef = {
  id: 'cranes',
  name: 'Skyline Cranes',
  ambience: 'city',
  width: 16,
  bank: 2,
  shoulder: 4,
  accent: 0xffb03a,
  rails: 'steel',
  road: { lines: 'highway', grime: 0x5a5650, edgeLine: 0xf0e8d0, tone: 0.95 },
  terrain: { layers: ['grass', 'aerial_sand', 'rock_pitted_mossy', 'mud_cracked_dry_03'], tile: [20, 14, 20, 16], tints: [0x9aa080, 0xb0a890, 0xa09c94, 0xa89c88] },
  far: 0x6a6660,
  look: {
    tod: 'sunset', fog: [0.86, 0.66, 0.5], fogDensity: 0.0011, fogBase: 0, fogFall: 0.004, sunGlow: 1,
    exposure: 1.05, sun: 1.3, hemi: 0.95, bloom: 0.38, shafts: 0.6, grade: [1.12, 1.08, 0.01, 0.004, 0, 1.06, 0.98, 0.9, 0.32],
  },
  points: [
    [0, STREET, 0],
    [116, STREET, -2, { pad: 0 }],
    [204, STREET, 14],
    [276, STREET, -16],
    [290, STREET, -80],
    [258, 5, -126, { raised: true, rail: 'LR' }],
    [200, 14, -150, { raised: true, rail: 'LR', deck: 'steel' }],
    [148, 24, -184, { raised: true, rail: '' }],
    [80, 26, -194, { raised: true, rail: '' }],
    [22, 29, -190, { gap: true }],
    [-30, 16, -182, { raised: true, rail: '' }],
    [-100, 19, -160, { raised: true, rail: 'LR', deck: 'wood' }],
    [-150, 25, -122, { raised: true, rail: 'LR', deck: 'wood' }],
    [-172, 26, -62, { raised: true, rail: 'LR', deck: 'wood', pad: 0 }],
    [-164, 30, -2, { gap: true }],
    [-136, 12, 52, { raised: true, rail: 'LR' }],
    [-96, 3, 94],
    [-40, STREET, 114],
    [6, STREET, 84],
    [-34, STREET, 46],
    [-44, STREET, 12],
  ],
  ground: (x, z) => fbm2(x * 0.004, z * 0.004) * 1.2 - 0.6 + smooth(700, 1100, Math.hypot(x, z + 80)) * -20,
  splat(x, z, _h, _slope, roadDist, mix, tint) {
    const lot = fbm2(x * 0.012, z * 0.012)
    mix[0] = smooth(0.55, 0.7, lot) * smooth(14, 30, roadDist)
    mix[1] = 1 - mix[0]
    mix[2] = 0
    mix[3] = smooth(0.4, 0.3, lot) * 0.6
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'concrete',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Skyline Cranes', '#ffb03a')
    stands(k, 8, 40, 1, [0xe8a03a, 0x2a3448, 0xe8e6e0, 0x3a7ab0, 0xc04a3a], 0xffb03a, 'Skyline Cranes')
    arrows(k, 0xffb03a)

    // ── the buildings the rooftop road runs across, and scaffolding under the planks
    const blocks = new Mesher(), roofs = new Mesher(), scaff = new Mesher()
    const glass = [glassMaterial(0x8aa0b8), glassMaterial(0x9a8a7a), glassMaterial(0x7a9a9a)]
    const towers = [new Mesher(), new Mesher(), new Mesher()]
    let runStart = -1
    const flushRun = (a: number, b: number): void => {
      // one building per run of rooftop road, broken into blocks every ~40 m
      for (let i = a; i < b; i += 20) {
        const j = Math.min(b, i + 20), p = c.samples[i]!, q = c.samples[j]!
        const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, top = Math.min(p.y, q.y) - 0.6
        const t = c.tangents[i]!, yaw = Math.atan2(-t.x, -t.z), len = Math.hypot(q.x - p.x, q.z - p.z) + 3
        const wide = c.widths[i]! + 18
        towers[(i / 20) % 3 | 0]!.box(wide, top - STREET, len, mx, (top + STREET) / 2, mz, 0xffffff, yaw)
        roofs.box(wide + 0.6, 0.8, len + 0.4, mx, top + 0.1, mz, 0x6a6660, yaw)
        // a parapet on each edge of the roof, set back from the road
        const r = c.rights[i]!
        for (const s of [-1, 1]) roofs.box(0.5, 1.2, len, mx + r.x * s * (wide / 2), top + 1, mz + r.z * s * (wide / 2), 0x8a847c, yaw)
        w.addBox(mx, mz, wide / 2, len / 2, yaw, top - 1.2)
      }
    }
    for (let i = 0; i <= c.count; i++) {
      // only under level rooftop road: a ramp must never run into a building's side
      const on = i < c.count && c.raised[i]! && !c.gap[i]! && c.deck[i] !== 2 && c.samples[i]!.y > 15 && Math.abs(c.tangents[i]!.y) < 0.07
      if (on && runStart < 0) runStart = i
      if (!on && runStart >= 0) { flushRun(runStart, i); runStart = -1 }
    }
    towers.forEach((t, q) => { if (!t.empty) place(k, t, glass[q]!) })
    place(k, roofs, surface('concrete'))
    // scaffolding: tubes and boards under the wooden decks
    for (let i = 0; i < c.count; i += 4) {
      if (c.deck[i] !== 2 || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, half = c.widths[i]! / 2
      for (const s of [-1, -0.33, 0.33, 1]) {
        const x = p.x + r.x * s * half, z = p.z + r.z * s * half
        scaff.post(0.08, 0.08, p.y - STREET, x, STREET, z, 0x9aa0a8, 5)
        if (Math.abs(s) === 1) w.addPost(x, z, 0.25, p.y - 1.2)
      }
      for (let y = STREET + 2; y < p.y - 1; y += 2.2) {
        scaff.bar(new THREE.Vector3(p.x - r.x * half, y, p.z - r.z * half), new THREE.Vector3(p.x + r.x * half, y, p.z + r.z * half), 0.05, 0x9aa0a8, 4)
        if (i % 8 === 0) scaff.bar(new THREE.Vector3(p.x - r.x * half, y, p.z - r.z * half), new THREE.Vector3(p.x + r.x * half, y + 2.2, p.z + r.z * half), 0.04, 0x9aa0a8, 4)
      }
      // safety netting on the outside
      for (const s of [-1, 1]) scaff.box(0.05, 2.6, 8.2, p.x + r.x * s * (half + 0.6), p.y - 0.4, p.z + r.z * s * (half + 0.6), 0x3a6a3a, Math.atan2(-c.tangents[i]!.x, -c.tangents[i]!.z))
    }
    place(k, scaff, surface('metal', { rough: 0.5 }))
    // the jump lips, striped like a hoarding
    const lips = new Mesher()
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (!(!c.gap[i] && c.gap[j])) continue
      const p = c.samples[i]!, t = c.tangents[i]!
      lips.box(c.widths[i]! + 1, 1.8, 1.2, p.x, p.y - 1.1, p.z, 0xffb03a, Math.atan2(-t.x, -t.z))
    }
    place(k, lips, surface('paint'))

    // ── the city: towers on a grid, real brick blocks along the streets
    const city = [new Mesher(), new Mesher(), new Mesher()], cityRoofs = new Mesher()
    for (let x = -700; x <= 760; x += 64) for (let z = -720; z <= 520; z += 64) {
      const cx = x + (d.rand() - 0.5) * 10, cz = z + (d.rand() - 0.5) * 10
      const hx = 13 + d.rand() * 9, hz = 13 + d.rand() * 9
      if (d.roadGap(cx, cz) < Math.hypot(hx, hz) + 8 || w.blocked(cx, cz, Math.hypot(hx, hz))) continue
      const near = d.roadGap(cx, cz) < 90
      const tall = (near ? 30 : 60) + d.rand() * d.rand() * 220
      const unfinished = d.rand() < 0.18
      const q = Math.floor(d.rand() * 3)
      if (unfinished) {
        // a concrete frame still going up: floors on columns, no walls yet
        for (let y = 0; y < tall * 0.6; y += 4) {
          blocks.box(hx * 2, 0.5, hz * 2, cx, y + 4, cz, 0xa8a49c)
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) blocks.box(0.8, 4, 0.8, cx + a! * (hx - 0.5), y + 2, cz + b! * (hz - 0.5), 0xb0aca4)
        }
        crane(k, cx + hx + 4, cz, tall * 0.6 + 26, 34).top.rotation.y = d.rand() * 6
      } else {
        city[q]!.box(hx * 2, tall, hz * 2, cx, tall / 2, cz, 0xffffff)
        cityRoofs.box(hx * 1.2, 3, hz * 1.2, cx, tall + 1.5, cz, 0x5a5e64)
      }
      w.addBox(cx, cz, hx, hz)
    }
    city.forEach((t, q) => { if (!t.empty) place(k, t, glass[q]!) })
    place(k, cityRoofs, surface('concrete'))
    if (!blocks.empty) place(k, blocks, surface('concrete'))
    const kinds = ['bk:apartment_a', 'bk:apartment_b', 'bk:factory_a'] as const
    const fronts = new Map<string, THREE.Matrix4[]>()
    for (let i = 0; i < c.count; i += 8) {
      if (c.raised[i] || Math.abs(c.bends[i]!) > 0.004) continue
      const p = c.samples[i]!, r = c.rights[i]!, side = d.rand() < 0.5 ? 1 : -1, kd = kinds[Math.floor(d.rand() * 3)]!
      const off = side * (c.widths[i]! / 2 + 18), x = p.x + r.x * off, z = p.z + r.z * off
      if (d.roadGap(x, z) < 14 || w.blocked(x, z, 9)) continue
      const yaw = Math.atan2(-side * r.x, -side * r.z), s = 1.3
      const l = fronts.get(kd) ?? []
      l.push(trs(x, STREET - 0.1, z, yaw, s))
      fronts.set(kd, l)
      w.addBox(x, z, kd === 'bk:factory_a' ? 10 : 8, 6, yaw)
    }
    for (const [n, m] of fronts) d.prop(n as 'bk:apartment_a', m, 0, undefined, 520)
    d.prop('bk:street_lamp_01', d.spots(30, 1.5, 2.5, { clear: 1.2, test: (_x, _z, y) => y < 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4)), 0.25)
    d.prop('concrete_road_barrier', d.spots(24, 2, 6, { clear: 1.8, test: (_x, _z, y) => y < 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1)), 0.8)
    crates(d, d.spots(18, 2, 7, { clear: 1.5 }), 0xc8a060)
    forest(k, 'oak', d.spots(40, 4, 12, { clear: 4, test: (_x, _z, y) => y < 2 }), { scale: [0.5, 0.75], tints: [0xc8d8a0, 0xb8cc90] })

    // ── the cranes over the road: their loads swing low across it from lap two
    const swingers: { top: THREE.Group; beam: THREE.Mesh; cable: THREE.Mesh; i: number; solid: Solid; lap: number; ph: number; reach: number }[] = []
    const beamGeo = new Mesher().box(1.2, 1.2, 14, 0, 0, 0, 0xc04a2a).build()
    const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4)
    for (const [fr, lap] of [[0.34, 2], [0.62, 2], [0.48, 3]] as const) {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
      const side = lap === 3 ? -1 : 1, reach = 28
      const mx = p.x + r.x * side * reach, mz = p.z + r.z * side * reach
      const cr = crane(k, mx, mz, p.y + 34 - w.terrainAt(mx, mz), 44)
      cr.top.rotation.y = Math.atan2(r.z * side, -r.x * side)
      const beam = new THREE.Mesh(beamGeo, surface('paint', { metal: 0.6, rough: 0.4 }))
      const cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7 }))
      beam.castShadow = true
      root.add(beam, cable)
      const solid: Solid = { x: 0, z: 0, r: 8, hx: 0.8, hz: 7, cos: 1, sin: 0, top: -1e6 }
      w.movers.push(solid)
      swingers.push({ top: cr.top, beam, cable, i, solid, lap, ph: fr * 9, reach })
    }

    // warning lights on the crane tips
    const tips = swingers.map((s) => s.top)
    const tipMat = glow(4, 0.4, 0.2)
    const tipLights = d.instanced(new THREE.SphereGeometry(0.6, 8, 6), tipMat, tips.map(() => new THREE.Matrix4()), false)
    tipLights.frustumCulled = false

    const v = new THREE.Vector3(), m4 = new THREE.Matrix4()
    k.onFrame((f) => {
      tipMat.color.setRGB(Math.sin(f.time * 4) > 0 ? 5 : 0.4, 0.3, 0.2)
      swingers.forEach((s, q) => {
        const active = f.lap >= s.lap
        const p = c.samples[s.i]!, r = c.rights[s.i]!, t = c.tangents[s.i]!
        // slew back and forth; when active the hook sweeps right over the road
        const sweep = active ? Math.sin(f.time * 0.45 + s.ph) : 0.6 + Math.sin(f.time * 0.2 + s.ph) * 0.2
        // the hook's distance from the road's centre, on the crane's side
        const L = active ? THREE.MathUtils.lerp(s.reach - 6, -c.widths[s.i]! * 0.6, (sweep + 1) / 2) : s.reach - 6 + sweep * 2
        const side = s.lap === 3 ? -1 : 1
        const hx = p.x + r.x * side * L, hz = p.z + r.z * side * L
        const drop = active ? p.y + 1.1 : p.y + 16
        const top = s.top.position
        s.top.rotation.y = Math.atan2(-(hz - top.z), hx - top.x)
        const beamY = THREE.MathUtils.lerp(s.beam.position.y || drop, drop, Math.min(1, f.dt * 0.8))
        s.beam.position.set(hx, beamY, hz)
        s.beam.rotation.y = Math.atan2(-t.x, -t.z) + Math.PI / 2
        v.set(hx, (top.y + beamY) / 2, hz)
        s.cable.position.copy(v)
        s.cable.scale.set(1, top.y - beamY, 1)
        s.solid.x = hx; s.solid.z = hz
        s.solid.cos = Math.cos(s.beam.rotation.y); s.solid.sin = Math.sin(s.beam.rotation.y)
        // only solid while it hangs at car height
        s.solid.top = beamY < p.y + 3 ? beamY + 0.6 : -1e6
        m4.makeTranslation(top.x + Math.cos(s.top.rotation.y) * 44, top.y + 0.6, top.z - Math.sin(s.top.rotation.y) * 44)
        tipLights.setMatrixAt(q, m4)
      })
      tipLights.instanceMatrix.needsUpdate = true
    })
  },
}
