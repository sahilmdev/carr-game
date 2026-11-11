import * as THREE from 'three'
import type { Zone } from '../World'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { canvasTexture, fbm2, lumpy, ridged2, smooth, softDot, trs } from '../../game/biomes/kit'
import { GLSL_NOISE, windClock } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Circuit } from '../Circuit'
import { arrows, drift, findGap, gantry, glow, roadZones, zoneFx } from './parts'

const BASE = import.meta.env.BASE_URL
const fbx = new FBXLoader()

/** A sea creature's mesh, merged and re-centred, one unit long. */
async function creature(name: string): Promise<THREE.BufferGeometry | null> {
  try {
    const src = await fbx.loadAsync(`${BASE}models/fish/${name}.fbx`)
    // the models are skinned: take the mesh in its bind pose, not through the
    // bones (that collapsed every creature to a point)
    let mesh: THREE.Mesh | null = null
    src.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh })
    if (!mesh) return null
    const g = (mesh as THREE.Mesh).geometry.clone()
    for (const a of ['skinIndex', 'skinWeight']) g.deleteAttribute(a)
    g.computeBoundingBox()
    const box = g.boundingBox!, size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
    g.translate(-c.x, -c.y, -c.z)
    const s = 1 / Math.max(size.x, size.y, size.z)
    g.scale(s, s, s)
    // long axis to z, so the head leads
    if (size.y >= size.x && size.y >= size.z) g.rotateX(-Math.PI / 2)
    else if (size.x > size.z) g.rotateY(Math.PI / 2)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  } catch { return null }
}

/** Water colour above and around everything: bright overhead, black below. */
function waterDome(k: BuildKit): void {
  const m = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uT: windClock },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_NOISE}
      varying vec3 vD; uniform float uT;
      void main(){
        float h = vD.y;
        vec3 deep = vec3(0.004, 0.03, 0.06), mid = vec3(0.02, 0.2, 0.3), top = vec3(0.3, 0.66, 0.72);
        vec3 c = mix(deep, mid, smoothstep(-0.5, 0.08, h));
        c = mix(c, top, smoothstep(0.08, 0.95, h));
        // the moving surface, seen from far below
        if (h > 0.2) {
          vec2 p = vD.xz / max(h, 0.06) * 3.0;
          float r = aNoise(p + uT * 0.08) * aNoise(p * 2.1 - uT * 0.11);
          c += vec3(0.5, 0.78, 0.8) * smoothstep(0.12, 0.34, r) * smoothstep(0.2, 0.75, h) * 0.8;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  }))
  m.frustumCulled = false
  m.renderOrder = -10
  k.root.add(m)
  k.onFrame((f) => m.position.copy(f.camera.position))
}

/** The glass tube over one road: fresnel glass, steel hoops, lit strips. Broken open over a gap. */
function tube(k: BuildKit, c: Circuit, strips: THREE.MeshBasicMaterial): void {
  const { root } = k
  const n = c.count, SEG = 14, ARC = Math.PI * 1.04, last = c.closed ? n : n - 1
  // where another road runs alongside (a fork or a join) the tube stays open:
  // its glass and hoops would otherwise stand across the other road
  const shared = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const p = c.samples[i]!
    for (const o of k.circuit.all) {
      if (o === c) continue
      const j = o.track(p.x, p.z, 0, o.count, p.y), q = o.samples[j]!, r = o.rights[j]!, t = o.tangents[j]!
      const lat = Math.abs((p.x - q.x) * r.x + (p.z - q.z) * r.z), along = Math.abs((p.x - q.x) * t.x + (p.z - q.z) * t.z)
      if (along < 4 && Math.abs(p.y - q.y) < 6 && lat < (c.widths[i]! + o.widths[j]!) / 2 + 2) { shared[i] = 1; break }
    }
  }
  const pos: number[] = [], nor: number[] = [], idx: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const rows: number[] = []
  for (let i = 0; i <= last; i += 2) {
    const q = Math.min(i, n - 1) % n, p = c.samples[q]!, r = c.rights[q]!, R = c.widths[q]! / 2 + 0.4
    rows.push(q)
    for (let s2 = 0; s2 <= SEG; s2++) {
      const a2 = -ARC / 2 + (s2 / SEG) * ARC
      const dx = Math.sin(a2), dy = Math.cos(a2) * 0.72
      pos.push(p.x + r.x * dx * R, p.y + dy * R, p.z + r.z * dx * R)
      nor.push(r.x * dx + up.x * dy, dy, r.z * dx)
    }
  }
  const row = SEG + 1
  for (let a2 = 0; a2 < rows.length - 1; a2++) {
    if (c.gap[rows[a2]!] || c.gap[rows[a2 + 1]!] || shared[rows[a2]!] || shared[rows[a2 + 1]!]) continue
    for (let s2 = 0; s2 < SEG; s2++) {
      const o = a2 * row + s2
      idx.push(o, o + 1, o + row, o + 1, o + row + 1, o + row)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  const glass = new THREE.MeshStandardMaterial({ color: 0x6fb8c8, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1 })
  glass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      gl_FragColor.a = 0.03 + pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0) * 0.32;`)
  }
  glass.customProgramCacheKey = () => 'kart-tube'
  const mesh = new THREE.Mesh(g, glass)
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  root.add(mesh)

  // a steel hoop every so often, a foot under some, and a jagged rim where the tube is broken
  const ribs = new Mesher(), legs = new Mesher()
  for (let i = 0; i < n; i += 13) {
    if (c.gap[i] || shared[i]) continue
    const p = c.samples[i]!, r = c.rights[i]!, R = c.widths[i]! / 2 + 0.55
    const yaw = Math.atan2(-c.tangents[i]!.x, -c.tangents[i]!.z)
    ribs.add(new THREE.TorusGeometry(1, 0.03, 6, 22, Math.PI), trs(p.x, p.y - 0.1, p.z, yaw, new THREE.Vector3(R, R * 0.72, 1)), 0x3a4048)
    if (i % 39 === 0) {
      const ground = k.world.terrainAt(p.x, p.z), h = p.y - ground
      if (h > 2) {
        for (const s2 of [-1, 1]) {
          const top = new THREE.Vector3(p.x + r.x * s2 * R * 0.7, p.y - 1, p.z + r.z * s2 * R * 0.7)
          legs.bar(top, new THREE.Vector3(top.x + r.x * s2 * h * 0.26, ground - 1, top.z + r.z * s2 * h * 0.26), 0.55, 0x4a525c, 8)
        }
        legs.box(c.widths[i]! + 3, 1.6, 2.4, p.x, p.y - 1.2, p.z, 0x444c56, yaw)
      }
    }
  }
  for (let i = 1; i < n; i++) {
    if (c.gap[i] === c.gap[i - 1]) continue
    const j = c.gap[i] ? i - 1 : i, p = c.samples[j]!, R = c.widths[j]! / 2 + 0.55
    const yaw = Math.atan2(-c.tangents[j]!.x, -c.tangents[j]!.z)
    ribs.add(new THREE.TorusGeometry(1, 0.18, 6, 22, Math.PI), trs(p.x, p.y - 0.1, p.z, yaw, new THREE.Vector3(R, R * 0.72, 1)), 0xffb030)
  }
  place(k, ribs, surface('metal'), false)
  if (!legs.empty) place(k, legs, surface('metal'))

  // lit strips along the crown
  const strip: number[] = [], sIdx: number[] = []
  for (const lat of [-0.42, 0.42]) {
    const base = strip.length / 3
    for (const q of rows) {
      const p = c.samples[q]!, r = c.rights[q]!, R = c.widths[q]! / 2
      const a2 = lat * R, h = Math.sqrt(1 - lat * lat) * R * 0.72 - 0.2
      strip.push(p.x + r.x * (a2 - 0.06), p.y + h, p.z + r.z * (a2 - 0.06), p.x + r.x * (a2 + 0.06), p.y + h, p.z + r.z * (a2 + 0.06))
    }
    for (let a2 = 0; a2 < rows.length - 1; a2++) {
      if (c.gap[rows[a2]!] || c.gap[rows[a2 + 1]!] || shared[rows[a2]!] || shared[rows[a2 + 1]!]) continue
      const o = base + a2 * 2
      sIdx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    }
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3))
  sg.setIndex(sIdx)
  const sm = new THREE.Mesh(sg, strips)
  sm.frustumCulled = false
  root.add(sm)
}

/** Corals in four forms, built from a few shapes and spread over the reefs. */
function reefs(k: BuildKit, spots: THREE.Vector3[]): void {
  const { d } = k
  const brain = lumpy(new THREE.IcosahedronGeometry(1, 3), 0.16, 3.4, 4)
  brain.scale(1, 0.62, 1)
  const fan = new THREE.BufferGeometry()
  {
    // a sea fan: a flat branching lattice from a canvas would need alpha, so real thin bars
    const m = new Mesher()
    const grow = (a: THREE.Vector3, dir: THREE.Vector3, len: number, depth: number): void => {
      const b = a.clone().addScaledVector(dir, len)
      m.bar(a, b, 0.05 * (depth + 1), 0xffffff, 4)
      if (depth <= 0) return
      for (const t of [-0.55, 0.5]) grow(b, new THREE.Vector3(dir.x + t, dir.y, 0).normalize(), len * 0.74, depth - 1)
    }
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.8, 5)
    fan.copy(m.build())
  }
  const tubes = new Mesher()
  for (let q = 0; q < 7; q++) {
    const a = q * 0.9, r = q ? 0.5 : 0, h = 1.2 + (q % 3) * 0.6
    tubes.add(new THREE.CylinderGeometry(0.26, 0.2, h, 8, 1, true), trs(Math.cos(a) * r, h / 2, Math.sin(a) * r), 0xffffff)
  }
  const staghorn = new Mesher()
  const branch = (a: THREE.Vector3, dir: THREE.Vector3, len: number, depth: number): void => {
    const b = a.clone().addScaledVector(dir, len)
    staghorn.bar(a, b, 0.09 + depth * 0.03, 0xffffff, 5)
    if (depth <= 0) return
    for (let q = 0; q < 2; q++) branch(b, dir.clone().add(new THREE.Vector3((q - 0.5) * 1.1, 0.25, q ? 0.5 : -0.5)).normalize(), len * 0.76, depth - 1)
  }
  for (let q = 0; q < 4; q++) branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(q * 1.57), 1.1, Math.sin(q * 1.57)).normalize(), 0.7, 3)
  const palette = [0xff6a5a, 0xff9a3c, 0xf25ca8, 0xc65cf0, 0x4fd0c0, 0xf0d060, 0xe84a6a]
  const kinds: THREE.BufferGeometry[] = [brain, fan, tubes.build(), staghorn.build()]
  const per: { m: THREE.Matrix4[]; c: THREE.Color[] }[] = kinds.map(() => ({ m: [], c: [] }))
  for (const s of spots) {
    const q = Math.floor(d.rand() * 4), sc = q === 0 ? 1.6 + d.rand() * 3 : 1.8 + d.rand() * 3
    per[q]!.m.push(trs(s.x, s.y + (q === 0 ? sc * 0.2 : -0.1), s.z, d.rand() * 6, sc))
    per[q]!.c.push(new THREE.Color(palette[Math.floor(d.rand() * palette.length)]!).multiplyScalar(0.85 + d.rand() * 0.5))
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, emissive: 0x222226, side: THREE.DoubleSide })
  kinds.forEach((g, q) => { if (per[q]!.m.length) d.instanced(g, mat, per[q]!.m, false, per[q]!.c) })
}

/** Forests of kelp: tall ribbons that lean and sway with the current. */
function kelp(k: BuildKit, spots: THREE.Vector3[]): void {
  const { d } = k
  const N = 14, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  for (let c = 0; c < 2; c++) {
    const base = pos.length / 3, a = c * 1.57, dx = Math.cos(a), dz = Math.sin(a)
    for (let i = 0; i <= N; i++) {
      const y = i / N, wide = 0.55 * (1 - y * 0.55) * (0.72 + Math.sin(y * 19) * 0.28)
      pos.push(-dx * wide, y, -dz * wide, dx * wide, y, dz * wide)
      nor.push(dz, 0.3, -dx, dz, 0.3, -dx)
      uv.push(0, y, 1, y)
      if (i < N) { const o = base + i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9a3a, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x141a06 })
  mat.onBeforeCompile = (s) => {
    s.uniforms['uT'] = windClock
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
          float y = position.y;
          float s = sin(uT * 0.8 + ph + y * 3.2) * 0.09 + sin(uT * 1.7 + ph * 1.7 + y * 6.0) * 0.03;
          transformed.x += s * y * 3.0 / max(length(vec3(instanceMatrix[0])), 1.0) * 8.0;
          transformed.z += cos(uT * 0.6 + ph + y * 2.3) * 0.07 * y * 24.0 / max(length(vec3(instanceMatrix[0])), 1.0);
        }`)
  }
  mat.customProgramCacheKey = () => 'kart-kelp'
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
  for (const s of spots) {
    for (let q = 0; q < 4; q++) {
      const tall = 14 + d.rand() * 30
      mats.push(trs(s.x + (d.rand() - 0.5) * 8, s.y - 0.4, s.z + (d.rand() - 0.5) * 8, d.rand() * 6, new THREE.Vector3(2.1, tall, 2.1)))
      cols.push(new THREE.Color().setHSL(0.17 + d.rand() * 0.08, 0.6, 0.32 + d.rand() * 0.16))
    }
  }
  d.instanced(g, mat, mats, false, cols)
}

/** A sunken city: broken columns, arches and a toppled gate, all in old stone. */
function sunkenCity(k: BuildKit, spots: THREE.Vector3[]): void {
  const { d, world: w } = k
  const m = new Mesher(), tone = [0x9a9a8a, 0x8a8e80, 0xa4a292]
  for (const s of spots) {
    const t = tone[Math.floor(d.rand() * 3)]!, a = d.rand() * 6.28
    const row = 3 + Math.floor(d.rand() * 4)
    for (let q = 0; q < row; q++) {
      const x = s.x + Math.cos(a) * q * 9, z = s.z + Math.sin(a) * q * 9, y = w.terrainAt(x, z)
      const tall = d.rand() < 0.3 ? 3 + d.rand() * 3 : 11 + d.rand() * 5
      m.add(new THREE.CylinderGeometry(1, 1.15, tall, 14), trs(x, y + tall / 2 - 1, z, 0, 1, (d.rand() - 0.5) * 0.14, (d.rand() - 0.5) * 0.14), t)
      m.box(3.2, 1, 3.2, x, y, z, t)
      if (tall > 8) m.box(3.1, 0.9, 3.1, x, y + tall - 0.8, z, t)
      if (q && tall > 8 && d.rand() < 0.6) m.box(10, 1.3, 2.6, x - Math.cos(a) * 4.5, y + tall + 0.3, z - Math.sin(a) * 4.5, t, -a)
    }
  }
  place(k, m, surface('stone'), false)
}

/** The ribs of something enormous, arching right over the tube. */
function bones(k: BuildKit, from: number): void {
  const { circuit: c, world: w } = k
  const m = new Mesher()
  for (let q = 0; q < 12; q++) {
    const i = (from + q * 7) % c.count, p = c.samples[i]!, r = c.rights[i]!
    const ground = w.terrainAt(p.x, p.z), size = 26 - Math.abs(q - 6) * 2.2
    const pts: THREE.Vector3[] = []
    for (let s = -1; s <= 1; s += 2) {
      const line: THREE.Vector3[] = []
      for (let u = 0; u <= 8; u++) {
        const a = (u / 8) * 1.45
        line.push(new THREE.Vector3(p.x + r.x * s * Math.cos(a) * size, Math.max(ground, p.y - 8) + Math.sin(a) * (size + 4), p.z + r.z * s * Math.cos(a) * size))
      }
      for (let u = 0; u < 8; u++) m.bar(line[u]!, line[u + 1]!, 1.25 - u * 0.09, 0xd8d0ba, 7)
      pts.push(line[8]!)
    }
  }
  place(k, m, surface('plaster'), false)
}

/*
 * Deep Blue, as a dive. Leave the research station's hangar dome and follow
 * the glass tube out over the coral gardens. At the wreck, go round the
 * great galleon or straight through its broken ribs. Dive down the glass
 * chute into the trench, jump the break where the tube has cracked open
 * (it's floaty down here), climb out past the bones of something enormous,
 * and home through the sunken city or the narrow maintenance tube in the kelp.
 *
 * Lap 2: the tube springs leaks and water lies on the deck; the lights start
 * to fail. Last lap: red emergency lighting, and the whale comes close.
 */
const TUBE = { raised: true, rail: 'LR' } as const

const POINTS: TrackPoint[] = [
  // 0: out of the station's hangar
  [0, 22, 0, TUBE],
  [190, 22, -14, { ...TUBE, pad: 0 }],
  [350, 26, -68, { ...TUBE, items: true }],
  [486, 30, -176, TUBE],
  [567, 32, -338, TUBE], // 4: the wreck road leaves here (the rail opens where it splits)
  // 5: round the galleon
  [513, 28, -513, TUBE],
  [378, 22, -608, { ...TUBE, deck: 'glass' }],
  [216, 16, -594, { ...TUBE, deck: 'glass' }], // 7: the wreck road rejoins
  // 8: the glass chute down into the trench
  [54, 0, -540, { ...TUBE, deck: 'glass' }],
  [-81, -20, -432, { ...TUBE, deck: 'glass', pad: 0 }],
  [-176, -34, -324, TUBE],
  // 11: the break in the tube: jump it
  [-250, -34, -240, TUBE],
  [-300, -28, -190, { raised: true, gap: true }],
  [-342, -35, -150, { ...TUBE, w: 20 }],
  // 14: the whirlpool basin: wide open, a vortex across the road
  [-378, -30, -72, { ...TUBE, w: 30 }],
  [-400, -20, 0, { ...TUBE, items: true }],
  [-350, 0, 135, TUBE], // 16: the maintenance tube leaves here
  // 16: through the sunken city and home
  [-216, 12, 230, { ...TUBE, deck: 'glass' }],
  [-81, 20, 230, { ...TUBE, deck: 'glass' }],
  [-40, 22, 110, TUBE], // 19: the maintenance tube rejoins
]

export const deep: TrackDef = {
  id: 'deep',
  name: 'Deep Blue',
  ambience: 'underwater',
  width: 17,
  bank: 1.4,
  accent: 0x2fd6d0,
  far: 0x143a48,
  farY: -80,
  deck: 'steel',
  rails: 'none',
  piers: 'none',
  road: { lines: 'plain', grime: 0x1a2a34, edgeLine: 0x2fd6d0 },
  terrain: { layers: ['coast_sand_01', 'coral_gravel', 'rock_pitted_mossy', 'volcanic_rock_tiles'], tile: [18, 12, 22, 26], tints: [0xc8d8cc, 0xd0dcc8, 0xa8c4b8, 0x88a8a8] },
  look: {
    tod: 'midday', generatedSky: true, noSky: true, fog: [0.02, 0.2, 0.3], fogDensity: 0.0034, fogBase: 40, fogFall: 0.0012, sunGlow: 0,
    exposure: 1, sun: 0.9, hemi: 0.75, env: 0.16, bloom: 0.22, caustics: 0.34, headlights: 0.8, grade: [1.2, 1.12, 0, 0.002, 0.008, 0.94, 1.03, 1.06, 0.5],
  },
  points: POINTS,
  // underwater, everything is lighter: jumps float
  gravity: 14,
  // the tube is ~6 m high: a jump mustn't carry the car up through its glass
  airCeiling: 4.6,
  branches: [
    {
      // straight through the galleon's broken ribs: shorter, and narrow
      name: 'Wreck', from: 4, to: 7, odds: 0.45,
      points: [
        [486, 30, -405, { ...TUBE, w: 13 }],
        [405, 24, -486, { ...TUBE, w: 13 }],
        [310, 18, -567, { ...TUBE, w: 13 }],
      ],
    },
    {
      // the maintenance tube through the kelp: steel, narrow, boost strips
      name: 'Maintenance tube', from: 16, to: 19, odds: 0.45,
      points: [
        [-243, 10, 120, { ...TUBE, w: 11, pad: 0 }],
        [-135, 18, 120, { ...TUBE, w: 11 }],
      ],
    },
    {
      // the high road: a glass deck above the trench, over the broken tube.
      // Only the vents at its foot throw you up onto it
      name: 'Vent field', from: 9, to: 13, odds: 0.35,
      points: [
        [-96, -21, -416, { raised: true, w: 16, rail: '', deck: 'glass' }],
        [-108, -21, -402, { raised: true, w: 16, rail: '', deck: 'glass' }],
        [-116, -21, -393, { raised: true, gap: true }],
        [-125, -18.5, -384, { raised: true, gap: true }],
        [-134, -16.5, -375, { ...TUBE, w: 18, deck: 'glass' }],
        [-172, -17, -334, { ...TUBE, w: 15, deck: 'glass', items: true }],
        [-234, -18, -306, { ...TUBE, w: 14, deck: 'glass' }],
        [-292, -22, -242, { ...TUBE, w: 14, deck: 'glass', pad: 0 }],
        [-330, -30, -190, { ...TUBE, w: 15 }],
      ],
    },
  ],
  ground(x, z) {
    const dunes = fbm2(x * 0.006, z * 0.006) * 34 - 56
    const ridge = ridged2(x * 0.0034 + 3, z * 0.0034, 5)
    const reef = smooth(0.54, 0.86, ridge) * 44
    const trench = 60 * smooth(260, 80, Math.hypot(x + 220, z + 260))
    return dunes + reef - trench + fbm2(x * 0.04, z * 0.04) * 3
  },
  splat(x, z, h, slope, _r, mix, tint) {
    const rock = smooth(0.42, 0.9, slope), reef = smooth(0.46, 0.6, fbm2(x * 0.01, z * 0.01))
    mix[0] = (1 - rock) * (1 - reef)
    mix[1] = (1 - rock) * reef
    mix[2] = rock
    mix[3] = smooth(-60, -90, h)
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'sand',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    waterDome(k)
    const strips = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 2.8), toneMapped: false, side: THREE.DoubleSide })
    for (const path of c.all) tube(k, path, strips)
    station(k)
    wreckRibs(k, c.branches[0]!)
    gantry(k, 'Deep Blue', '#2fd6d0')
    arrows(k, 0x2fd6d0)

    const around = (n: number, min: number, max: number, test?: (x: number, z: number, y: number) => boolean): THREE.Vector3[] => {
      const out: THREE.Vector3[] = []
      for (let q = 0; q < n * 8 && out.length < n; q++) {
        const i = Math.floor(d.rand() * c.count), p = c.samples[i]!, r = c.rights[i]!
        const lat = (d.rand() < 0.5 ? -1 : 1) * (min + d.rand() * (max - min))
        const x = p.x + r.x * lat, z = p.z + r.z * lat
        if (d.roadGap(x, z) < 3) continue
        const y = w.terrainAt(x, z)
        if (y > p.y - 3 && Math.abs(lat) < 16) continue // never up through the tube
        if (test && !test(x, z, y)) continue
        out.push(new THREE.Vector3(x, y, z))
      }
      return out
    }

    reefs(k, around(900, 10, 120))
    kelp(k, around(150, 12, 170))
    sunkenCity(k, around(13, 30, 150))
    bones(k, c.track(-400, 0, 0, c.count))
    d.prop('rock_07', around(50, 16, 170).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 4 + d.rand() * 8)), 0, undefined, 320)
    d.prop('boulder_01', around(20, 20, 180).map((s) => trs(s.x, s.y - 1, s.z, d.rand() * 6, 5 + d.rand() * 8)), 0, undefined, 320)
    d.prop('rock_moss_set_02', around(24, 14, 110).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 3 + d.rand() * 4)), 0, undefined, 320)

    // wrecks on the sea floor, treasure spilled round them
    const wreck = (fr: number, lat: number, tilt: number, sc: number, big = false): THREE.Vector3 => {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
      const x = p.x + r.x * lat, z = p.z + r.z * lat, y = w.terrainAt(x, z)
      // the big galleon went down whole, sails and all
      d.prop(big ? 'bk:dutch_ship_large_01' : 'dutch_ship_medium', [trs(x, y + (big ? -1 : 2), z, fr * 9, sc, tilt, tilt * 0.6)], 0, undefined, 420)
      return new THREE.Vector3(x, y, z)
    }
    const hulls = [wreck(0.12, 58, 0.34, 2), wreck(0.28, 120, -0.3, 1.25, true), wreck(0.86, 52, 0.28, 1.7)]
    for (const h of hulls) {
      d.prop('treasure_chest', [trs(h.x + 14, h.y + 0.2, h.z + 6, 1, 3), trs(h.x - 12, h.y + 0.2, h.z - 8, 2.3, 2.4)])
      d.prop('cannon_01', [trs(h.x + 9, h.y + 0.4, h.z - 12, 0.6, 3), trs(h.x - 16, h.y + 0.4, h.z + 7, 2, 3)])
      d.prop('wooden_barrels_01', [trs(h.x + 20, h.y, h.z - 4, 0.9, 2.2)])
    }
    const stat = (name: Parameters<typeof d.prop>[0], fr: number, lat: number, sc: number): void => {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
      const x = p.x + r.x * lat, z = p.z + r.z * lat
      d.prop(name, [trs(x, w.terrainAt(x, z) + 1, z, fr * 6, sc)])
    }
    stat('bronze_whale_statue', 0.3, 34, 22)
    stat('bronze_shark_statue', 0.52, -30, 26)
    stat('bronze_ray_statue', 0.72, 30, 24)

    // research base: pressure domes on legs, joined by pipes, lit from inside
    const dome = new Mesher(), lit: THREE.Matrix4[] = []
    const domes: THREE.Vector3[] = []
    for (const [fr, lat, R] of [[0.08, -62, 22], [0.1, -100, 15], [0.24, 70, 19], [0.93, -66, 24], [0.96, -104, 16]] as const) {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
      const x = p.x + r.x * lat, z = p.z + r.z * lat, y = w.terrainAt(x, z) + 3
      dome.add(new THREE.SphereGeometry(R, 24, 12, 0, 6.3, 0, Math.PI / 2), trs(x, y + 4, z), 0x8fa4ac)
      dome.post(R * 1.05, R * 1.08, 4.4, x, y - 0.4, z, 0x4a525c, 28)
      for (let q = 0; q < 8; q++) {
        const a = q * 0.785
        dome.box(0.5, R * 0.55, 0.5, x + Math.cos(a) * R * 0.86, y + 4 + R * 0.22, z + Math.sin(a) * R * 0.86, 0x2a3036, -a)
        lit.push(trs(x + Math.cos(a) * R * 1.02, y + 2, z + Math.sin(a) * R * 1.02, -a, new THREE.Vector3(2.8, 1, 0.2)))
      }
      domes.push(new THREE.Vector3(x, y + 2, z))
    }
    for (let q = 1; q < domes.length; q++) if (domes[q]!.distanceTo(domes[q - 1]!) < 80) dome.bar(domes[q - 1]!, domes[q]!, 1.8, 0x4a525c, 10)
    place(k, dome, surface('metal', { rough: 0.3 }), false)
    const windows = glow(1.4, 2.6, 2.4)
    d.instanced(new THREE.BoxGeometry(1, 1, 1), windows, lit, false)

    // shafts of sunlight slanting down through the water
    const shaftTex = (() => {
      const cv = document.createElement('canvas')
      cv.width = 64; cv.height = 256
      const g = cv.getContext('2d')!
      const gr = g.createLinearGradient(0, 0, 0, 256)
      gr.addColorStop(0, 'rgba(255,255,255,0.8)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, 64, 256)
      const img = g.getImageData(0, 0, 64, 256)
      for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) { const e = Math.sin((x / 63) * Math.PI); img.data[(y * 64 + x) * 4 + 3]! *= e ** 1.5 }
      g.putImageData(img, 0, 0)
      return new THREE.CanvasTexture(cv)
    })()
    const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: 0x6fc8d0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    const shaftGeo = new THREE.PlaneGeometry(1, 1)
    shaftGeo.translate(0, -0.5, 0)
    const shafts: THREE.Mesh[] = []
    for (const s of around(46, 8, 170)) {
      const m = new THREE.Mesh(shaftGeo, shaftMat)
      m.position.set(s.x, 150, s.z)
      m.scale.set(16 + d.rand() * 34, 170 + d.rand() * 60, 1)
      m.rotation.set(0, d.rand() * 3.14, 0.16)
      root.add(m)
      shafts.push(m)
    }

    // jellyfish: pulsing bells, lit from within
    const JN = 90
    const bell = new THREE.SphereGeometry(1, 14, 8, 0, 6.3, 0, 1.7)
    bell.scale(1, 0.72, 1)
    const jmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const jelly = new THREE.InstancedMesh(bell, jmat, JN)
    jelly.frustumCulled = false
    const jspots = around(JN, 7, 90).map((s) => ({ p: s.clone().setY(Math.max(s.y + 8, -34) + d.rand() * 34), ph: d.rand() * 6.28, s: 0.9 + d.rand() * 1.8 }))
    jspots.forEach((j, q) => jelly.setColorAt(q, new THREE.Color([0xff6ae0, 0x6ae0ff, 0xc08aff, 0x7affd0][q % 4]!).multiplyScalar(1.5)))
    root.add(jelly)
    const halo = softDot()
    const glowDots = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0x000000 }))
    void glowDots

    // fish: great schools turning together, and big animals on long patrols
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc3 = new THREE.Vector3(), fw = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0)
    const schools: { im: THREE.InstancedMesh; c: THREE.Vector3; r: number; v: number; o: Float32Array; ph: number; n: number; size: number }[] = []
    const animals: { m: THREE.Mesh; c: THREE.Vector3; r: number; v: number; ph: number; y: number }[] = []
    const fishMat = (color: number, swim: 'fish' | 'manta' | 'whale' = 'fish', rate = 6) => seaMaterial(color, swim, rate)
    const job = (async () => {
      const [f1, f2, f3, shark, manta, whale] = await Promise.all(['Fish1', 'Fish2', 'Fish3', 'Shark', 'Manta_ray', 'Whale'].map(creature))
      const school = (g: THREE.BufferGeometry | null | undefined, color: number, n: number, fr: number, lat: number, y: number, size: number): void => {
        if (!g) return
        const i = Math.floor(c.count * fr), p = c.samples[i]!, r = c.rights[i]!
        const im = new THREE.InstancedMesh(g, fishMat(color), n)
        im.frustumCulled = false
        const o = new Float32Array(n * 3)
        for (let q = 0; q < n; q++) o.set([(d.rand() - 0.5) * 26, (d.rand() - 0.5) * 12, (d.rand() - 0.5) * 26], q * 3)
        root.add(im)
        schools.push({ im, c: new THREE.Vector3(p.x + r.x * lat, y, p.z + r.z * lat), r: 26 + d.rand() * 30, v: 0.28 + d.rand() * 0.22, o, ph: d.rand() * 6.28, n, size })
      }
      school(f1, 0xf0c040, 70, 0.06, 26, 18, 1.1)
      school(f2, 0x8fd0ff, 90, 0.2, -24, 24, 0.9)
      school(f3, 0xff7a4a, 60, 0.36, 30, 34, 1.3)
      school(f1, 0xe0e4e8, 110, 0.5, -26, 4, 1)
      school(f2, 0xf0a0d0, 70, 0.64, 24, -14, 0.9)
      school(f3, 0x60f0c0, 80, 0.8, -22, 2, 1.1)
      school(f1, 0xf8f0a0, 90, 0.92, 28, 20, 1)
      const big = (g: THREE.BufferGeometry | null | undefined, color: number, len: number, fr: number, lat: number, y: number, r: number, v: number): void => {
        if (!g) return
        const i = Math.floor(c.count * fr), p = c.samples[i]!, rt = c.rights[i]!
        const m = new THREE.Mesh(g, fishMat(color, len > 40 ? 'whale' : g === manta ? 'manta' : 'fish', len > 40 ? 1.2 : 3.5))
        m.scale.setScalar(len)
        root.add(m)
        animals.push({ m, c: new THREE.Vector3(p.x + rt.x * lat, y, p.z + rt.z * lat), r, v, ph: d.rand() * 6.28, y })
      }
      big(shark, 0x6a7a88, 9, 0.12, 40, 16, 70, 0.28)
      big(shark, 0x5a6a78, 8, 0.56, -36, 2, 60, 0.32)
      big(shark, 0x6a7a88, 10, 0.78, 30, 10, 80, 0.26)
      big(manta, 0x3a4a58, 13, 0.3, -46, 44, 60, 0.16)
      big(manta, 0x2e3e4c, 11, 0.7, 40, 18, 50, 0.2)
      big(whale, 0x4a5a6c, 54, 0.42, 20, 62, 150, 0.06)
    })()
    d.wait(job)

    drift(k, 340, 0xc8f0f0, 0.14, 0.6)

    // leaks: water lying on the deck from lap 2 (slippery and slow), with spray from the seams
    const leaks = [0.18, 0.42, 0.7, 0.9].map((u) => { const p = c.samples[Math.floor(c.count * u)]!; return { x: p.x, z: p.z, r: 9, surface: 'mud' as const, on: false } })
    w.patches.push(...leaks)
    const leakMat = new THREE.MeshStandardMaterial({ color: 0x9adce4, roughness: 0.04, transparent: true, opacity: 0, depthWrite: false })
    for (const lk of leaks) {
      const i = c.track(lk.x, lk.z, 0, c.count), p = c.samples[i]!
      const m = new THREE.Mesh(new THREE.CircleGeometry(lk.r, 24), leakMat)
      m.rotation.x = -Math.PI / 2
      m.position.set(p.x, p.y + 0.08, p.z)
      m.scale.set(0.8, 1.2, 1)
      root.add(m)
    }

    const col = new THREE.Color()
    const currents = deepCurrents(k)
    k.onFrame((f) => currents(f.lap, f.totalLaps, f.time))
    whirlpool(k)
    ventField(k, c.branches[2]!)
    k.onFrame((f) => {
      const t = f.time
      jspots.forEach((j, q) => {
        const pulse = 1 + Math.sin(t * 2 + j.ph) * 0.14
        v3.copy(j.p)
        v3.y += Math.sin(t * 0.3 + j.ph) * 3
        m4.compose(v3, q4.identity(), sc3.set(j.s * pulse, j.s / pulse, j.s * pulse))
        jelly.setMatrixAt(q, m4)
      })
      jelly.instanceMatrix.needsUpdate = true
      for (const s of schools) {
        const near = s.c.distanceToSquared(f.camera.position) < 300 * 300
        s.im.visible = near
        if (!near) continue
        const a = t * s.v + s.ph
        fw.set(Math.cos(a), 0, -Math.sin(a))
        const yaw = Math.atan2(fw.x, fw.z) + Math.PI / 2 - Math.PI / 2
        for (let q = 0; q < s.n; q++) {
          const o = q * 3, w2 = t * 2 + q
          v3.set(s.c.x + Math.sin(a) * s.r + s.o[o]! + Math.sin(w2 * 0.31) * 1.6, s.c.y + s.o[o + 1]! + Math.sin(w2 * 0.23) * 0.9, s.c.z + Math.cos(a) * s.r + s.o[o + 2]! + Math.cos(w2 * 0.27) * 1.6)
          q4.setFromAxisAngle(upV, yaw + Math.sin(w2 * 3) * 0.16)
          m4.compose(v3, q4, sc3.setScalar(s.size * (0.8 + (q % 5) * 0.09)))
          s.im.setMatrixAt(q, m4)
        }
        s.im.instanceMatrix.needsUpdate = true
      }
      for (const a of animals) {
        const u = t * a.v + a.ph
        a.m.position.set(a.c.x + Math.sin(u) * a.r, a.y + Math.sin(u * 2.3) * 3, a.c.z + Math.cos(u) * a.r)
        a.m.rotation.set(0, u + Math.PI / 2 + Math.sin(t * 2.2 + a.ph) * 0.07, 0)
      }
      for (const lk of leaks) lk.on = f.lap >= 2
      leakMat.opacity = f.lap >= 2 ? 0.5 : 0
      // the power goes as the race goes on: blue, then amber, then red
      const fail = (f.lap - 1) / Math.max(1, f.totalLaps - 1)
      col.setRGB(1.2 + fail * 2, 2.6 - fail * 2.1, 2.8 - fail * 2.5)
      const flicker = fail > 0.9 ? (Math.sin(t * 9) > -0.2 ? 1 : 0.35) : 1
      strips.color.copy(col).multiplyScalar(flicker)
    })
  },
}

/** The station hangar the race starts in: a glass dome over the start, lit ribs and a gantry. */
function station(k: BuildKit): void {
  const { circuit: c, root, world: w } = k
  const p = c.samples[0]!, t = c.tangents[0]!
  const m = new Mesher()
  for (let q = 0; q < 10; q++) {
    const a = (q / 10) * Math.PI * 2
    m.add(new THREE.TorusGeometry(46, 0.5, 6, 30, Math.PI), trs(p.x, p.y - 2, p.z, a), 0x3a4048)
  }
  m.post(48, 50, 3, p.x, p.y - 5, p.z, 0x444c56, 36)
  place(k, m, surface('metal'), false)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(46, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8fd0e0, roughness: 0.05, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }))
  dome.position.set(p.x, p.y - 2, p.z)
  root.add(dome)
  const lamps = new Mesher()
  for (let q = 0; q < 16; q++) {
    const a = (q / 16) * Math.PI * 2
    lamps.box(0.4, 0.4, 3, p.x + Math.cos(a) * 44, p.y + 6, p.z + Math.sin(a) * 44, 0xffffff, -a)
  }
  root.add(new THREE.Mesh(lamps.build(), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.6, 2.8), toneMapped: false })))
  void t; void w
}

/** The galleon the wreck road runs through: curved ribs and broken planks either side of the tube. */
function wreckRibs(k: BuildKit, wreck: Circuit): void {
  const m = new Mesher()
  const a = Math.floor(wreck.count * 0.2), b = Math.floor(wreck.count * 0.85)
  for (let i = a; i < b; i += 4) {
    const p = wreck.samples[i]!, r = wreck.rights[i]!, half = wreck.widths[i]! / 2 + 3
    const u = (i - a) / (b - a), beam = half + 6 * Math.sin(u * Math.PI)
    for (const s of [-1, 1]) {
      let prev: THREE.Vector3 | null = null
      for (let q = 0; q <= 6; q++) {
        const ang = -0.4 + (q / 6) * 1.9
        const pt = new THREE.Vector3(p.x + r.x * s * Math.cos(ang) * beam, p.y - 6 + Math.sin(ang) * (beam + 2), p.z + r.z * s * Math.cos(ang) * beam)
        if (prev) m.bar(prev, pt, 0.5, 0x3a2e22, 6)
        prev = pt
      }
      if ((i / 4) % 3 !== 0) m.box(0.4, 3, 4.2, p.x + r.x * s * beam, p.y - 4, p.z + r.z * s * beam, 0x4a3a2a, Math.atan2(-wreck.tangents[i]!.x, -wreck.tangents[i]!.z), s * 0.3)
    }
  }
  // the fallen mainmast across the top
  const p = wreck.samples[Math.floor(wreck.count / 2)]!, r = wreck.rights[Math.floor(wreck.count / 2)]!
  m.bar(new THREE.Vector3(p.x - r.x * 40, p.y + 14, p.z - r.z * 40), new THREE.Vector3(p.x + r.x * 30, p.y + 4, p.z + r.z * 30), 1.1, 0x2e241a, 10)
  place(k, m, surface('wood', { rough: 0.95 }), false)
}

/**
 * The water moves. Currents run across the flooded tubes and push you at the
 * wall, a cross-current sweeps the break in the tube while you're in the air,
 * and bubble vents in the trench bounce you up. Harder from lap 2; on the last
 * lap the currents turn round.
 */
function deepCurrents(k: BuildKit): (lap: number, total: number, time: number) => void {
  const c = k.circuit, P = deep.points
  const at = (n: number) => c.track(P[n]![0], P[n]![2], 0, c.count, P[n]![1])
  const stretches = [[1, 3], [8, 10], [15, 17]].map(([a, b]) => roadZones(k, c, at(a!), at(b!), 12))
  const g = findGap(c, -300, -190)
  const gapZones = roadZones(k, c, g.i0 - 10, g.i1 + 6, 6, true)
  const all = [...stretches.flat(), ...gapZones]
  zoneFx(k, all.map((q) => q.z), 0x8ae8ff, 0.45, 30)
  // bubble vents along the trench, in the left lane
  const vents: { z: Zone; fx: THREE.Points }[] = []
  for (const u of [0.25, 0.5, 0.75]) {
    const i = Math.round(at(9) + (at(11) - at(9)) * u), p = c.samples[i]!, r = c.rights[i]!, lat = -c.widths[i]! * 0.25
    const z: Zone = { x: p.x + r.x * lat, z: p.z + r.z * lat, r: 3.4, y0: p.y - 2, y1: p.y + 3, lift: 7.5, on: true }
    k.world.zones.push(z)
    const n = 60, pos = new Float32Array(n * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), color: 0xc8f4ff, size: 0.7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    pts.frustumCulled = false
    pts.userData['base'] = p.y
    k.root.add(pts)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.25, 6, 24), glow(0.6, 2.6, 3.4))
    ring.rotation.x = Math.PI / 2
    ring.position.set(z.x, p.y + 0.15, z.z)
    k.root.add(ring)
    vents.push({ z, fx: pts })
  }
  return (lap, total, time) => {
    const last = total > 1 && lap >= total
    const side = (last ? -1 : 1) * (lap >= 2 ? 6 : 4)
    for (const q of all) {
      q.z.on = true
      q.z.vx = q.rx * side
      q.z.vz = q.rz * side
    }
    for (const v of vents) {
      const pos = v.fx.geometry.attributes['position']! as THREE.BufferAttribute, base = v.fx.userData['base'] as number
      for (let i = 0; i < pos.count; i++) {
        const h = ((time * 6 + i * 0.37) % 10)
        pos.setXYZ(i, v.z.x + Math.sin(i * 2.1 + time) * 1.6, base + h, v.z.z + Math.cos(i * 1.7 + time) * 1.6)
      }
      pos.needsUpdate = true
    }
  }
}

/**
 * The whirlpool: a vortex turning across the wide basin. On one side of the
 * road it carries you forward, on the other it drags you back, and its eye
 * pulls you in and bogs you down. Stronger from lap 2; on the last lap it
 * turns the other way, so the good side swaps.
 */
function whirlpool(k: BuildKit): void {
  const c = k.circuit, P = deep.points
  const i = c.track(P[14]![0], P[14]![2], 0, c.count, P[14]![1]), p = c.samples[i]!
  const R = 22
  const z: Zone = { x: p.x, z: p.z, r: R, y0: p.y - 3, y1: p.y + 12, swirl: 7, pull: 1.5, air: false, on: true }
  k.world.zones.push(z)
  const eye = { x: p.x, z: p.z, r: 4.5, surface: 'mud' as const, on: true }
  k.world.patches.push(eye)
  // the vortex: a spiral of sand and bubbles narrowing as it rises, and a dark
  // swirl on the road where the eye is
  const n = 900, pos = new Float32Array(n * 3), seed = new Float32Array(n * 2)
  for (let q = 0; q < n; q++) { seed[q * 2] = Math.random(); seed[q * 2 + 1] = Math.random() }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), color: 0xbfeaff, size: 0.8, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }))
  pts.frustumCulled = false
  k.root.add(pts)
  const swirlTex = canvasTexture(256, 256, (g) => {
    g.translate(128, 128)
    for (let a = 0; a < 5; a++) {
      g.rotate((Math.PI * 2) / 5)
      g.beginPath()
      for (let t = 0; t < 1; t += 0.02) {
        const rr = t * 124, th = t * 5
        g.lineTo(Math.cos(th) * rr, Math.sin(th) * rr)
      }
      g.strokeStyle = 'rgba(200,240,255,0.55)'
      g.lineWidth = 10
      g.stroke()
    }
  })
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x8ad8ff }))
  disc.rotation.x = -Math.PI / 2
  disc.position.set(p.x, p.y + 0.12, p.z)
  k.root.add(disc)
  let spin = 0
  k.onFrame((f) => {
    const last = f.totalLaps > 1 && f.lap >= f.totalLaps
    const power = f.lap >= 2 ? 10 : 7
    const dir = last ? -1 : 1
    z.swirl = power * dir
    z.pull = f.lap >= 2 ? 2.4 : 1.5
    spin += f.dt * dir * (power / 7) * 1.4
    disc.rotation.z = spin
    for (let q = 0; q < n; q++) {
      const h = (seed[q * 2]! + f.time * 0.18) % 1, rr = 2 + (1 - h) * (R - 2) * (0.5 + seed[q * 2 + 1]! * 0.5)
      const th = seed[q * 2 + 1]! * Math.PI * 2 + spin * (R / rr) * 0.6
      pos[q * 3] = p.x + Math.cos(th) * rr
      pos[q * 3 + 1] = p.y + 0.4 + h * 11
      pos[q * 3 + 2] = p.z + Math.sin(th) * rr
    }
    geo.attributes['position']!.needsUpdate = true
  })
}

/**
 * Sea-creature skin that swims: the body sways side to side in a wave that
 * grows towards the ends (a manta flaps its wings instead), each fish in a
 * school on its own beat. Dark on the back, pale underneath, with a faint
 * sheen of stripes, the way fish are coloured.
 */
function seaMaterial(color: number, swim: 'fish' | 'manta' | 'whale', rate: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.25 })
  const kind = swim === 'fish' ? 0 : swim === 'manta' ? 1 : 2
  m.onBeforeCompile = (sh) => {
    sh.uniforms['uT'] = windClock
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying vec3 vSea;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSea = vec3(position.y, normal.y, position.z);
        float ph = uT * ${rate.toFixed(2)};
        #ifdef USE_INSTANCING
          ph += float(gl_InstanceID) * 1.7;
        #endif
        ${kind === 1
          ? 'transformed.y += sin(ph) * abs(position.x) * abs(position.x) * 0.9;'
          : `transformed.x += sin(ph + position.z * ${kind === 2 ? '3.0' : '7.0'}) * (0.015 + position.z * position.z * ${kind === 2 ? '0.12' : '0.3'});`}`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSea;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float back = 1.0;
        diffuseColor.rgb = mix(diffuseColor.rgb * 1.55 + 0.08, diffuseColor.rgb * 0.55, smoothstep(-0.3, 0.6, vSea.y));
        diffuseColor.rgb *= 0.9 + 0.1 * sin(vSea.z * 60.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.96), smoothstep(-0.2, -0.8, vSea.y) * 0.5 * back);`)
  }
  m.customProgramCacheKey = () => `sea-${kind}-${rate}`
  return m
}

/**
 * The vent field at the foot of the high road: a row of bubble vents across
 * the lane just before its lip. Drive over one and it throws you up onto the
 * glass deck above; miss them all and you go off the lip, back down to the
 * trench road.
 */
function ventField(k: BuildKit, high: Circuit): void {
  let lip = 0
  while (lip < high.count - 1 && !high.gap[lip + 1]) lip++
  const vi = Math.max(0, lip - 6), p = high.samples[vi]!, r = high.rights[vi]!, half = high.widths[vi]! / 2
  const pts: THREE.Vector3[] = []
  for (const u of [-0.62, -0.2, 0.2, 0.62]) {
    const lat = u * half
    const z: Zone = { x: p.x + r.x * lat, z: p.z + r.z * lat, r: 2.4, y0: p.y - 2, y1: p.y + 3, lift: 16, on: true }
    k.world.zones.push(z)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.22, 6, 24), glow(0.6, 2.6, 3.4))
    ring.rotation.x = Math.PI / 2
    ring.position.set(z.x, p.y + 0.15, z.z)
    k.root.add(ring)
    pts.push(new THREE.Vector3(z.x, p.y, z.z))
  }
  // columns of bubbles rising from each vent
  const n = 50 * pts.length, pos = new Float32Array(n * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), color: 0xc8f4ff, size: 0.7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  bubbles.frustumCulled = false
  k.root.add(bubbles)
  k.onFrame((f) => {
    for (let i = 0; i < n; i++) {
      const v = pts[i % pts.length]!, h = (f.time * 7 + i * 0.37) % 14
      pos[i * 3] = v.x + Math.sin(i * 2.1 + f.time) * 1.4
      pos[i * 3 + 1] = v.y + h
      pos[i * 3 + 2] = v.z + Math.cos(i * 1.7 + f.time) * 1.4
    }
    geo.attributes['position']!.needsUpdate = true
  })
}
