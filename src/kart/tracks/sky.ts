import * as THREE from 'three'
import { canvasTexture, fbm2, lumpy, smooth, trs } from '../../game/biomes/kit'
import { GLSL_NOISE, windClock } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import type { BuildKit, TrackDef, TrackPoint } from '../types'
import type { Zone } from '../World'
import { arrows, cloudTexture, crates, drift, findGap, gantry, glow, movingDeck, stands, zoneFx } from './parts'

interface Isle { x: number; z: number; rx: number; rz: number; y: number; a: number }

const ISLES: Isle[] = [
  { x: 40, z: 0, rx: 260, rz: 120, y: 60, a: 0 }, // the start
  { x: 455, z: -185, rx: 150, rz: 160, y: 64, a: 0 },
  { x: 540, z: -590, rx: 160, rz: 150, y: 96, a: 0.2 },
  { x: 170, z: -800, rx: 200, rz: 120, y: 120, a: 0.1 }, // the summit: the glide leaves from here
  { x: -270, z: -640, rx: 170, rz: 150, y: 70, a: 0.4 },
  { x: -500, z: -330, rx: 150, rz: 180, y: 64, a: 0 },
  { x: -380, z: 90, rx: 170, rz: 130, y: 58, a: 0.2 },
  // far islands, for the view
  { x: 920, z: 160, rx: 170, rz: 120, y: 90, a: -0.3 },
  { x: -980, z: -700, rx: 180, rz: 130, y: 44, a: 0.5 },
  { x: 220, z: 460, rx: 150, rz: 120, y: 54, a: 0.3 },
  { x: 120, z: -1300, rx: 220, rz: 130, y: 140, a: 0.1 },
]

const isleEdge = (s: Isle, x: number, z: number): number => {
  const c = Math.cos(s.a), n = Math.sin(s.a), dx = x - s.x, dz = z - s.z
  const u = (dx * c + dz * n) / s.rx, v = (-dx * n + dz * c) / s.rz
  return 1 - Math.hypot(u, v) + (fbm2(x * 0.012, z * 0.012) - 0.5) * 0.32
}

/** The undersides: great hanging masses of rock below every island. */
function roots(k: BuildKit): void {
  const { d } = k
  const m = new Mesher()
  const rock = lumpy(new THREE.ConeGeometry(1, 1, 9, 5), 0.2, 2.2, 3)
  for (const s of ISLES) {
    for (let q = 0; q < 46; q++) {
      const a = d.rand() * 6.28, u = Math.sqrt(d.rand()) * 0.86
      const x = s.x + Math.cos(a) * s.rx * u, z = s.z + Math.sin(a) * s.rz * u
      const size = 26 + (1 - u) * 42 + d.rand() * 20, tall = (1 - u * 0.7) * (70 + d.rand() * 110)
      m.add(rock, trs(x, s.y - 14 - tall / 2 + 2, z, d.rand() * 6, new THREE.Vector3(size, tall, size), Math.PI), [0x8a7a68, 0x7a6a5c, 0x6e6052][q % 3]!)
    }
  }
  place(k, m, surface('rock'), false)
}

/** A sea of cloud far below, drifting slowly. */
function cloudFloor(k: BuildKit): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), new THREE.ShaderMaterial({
    uniforms: { uT: windClock, uTop: { value: new THREE.Color(1, 0.96, 0.9) }, uLow: { value: new THREE.Color(0.66, 0.72, 0.86) }, uHaze: { value: new THREE.Color(0.86, 0.9, 0.96) } },
    transparent: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${GLSL_NOISE}
      varying vec3 vW; uniform float uT; uniform vec3 uTop, uLow, uHaze;
      void main(){
        vec2 p = vW.xz * 0.0052 + vec2(uT * 0.012, uT * 0.006);
        float a = aFbm(p), b = aFbm(p * 2.7 + a * 1.4), c = aFbm(p * 7.0 - b);
        float h = a * 0.6 + b * 0.3 + c * 0.1;
        vec3 col = mix(uLow, uTop, smoothstep(0.3, 0.66, h));
        float dist = length(vW - cameraPosition);
        col = mix(col, uHaze, smoothstep(600.0, 3800.0, dist));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }))
  m.rotation.x = -Math.PI / 2
  m.position.y = -60
  m.frustumCulled = false
  k.root.add(m)
  k.onFrame((f) => { m.position.x = f.camera.position.x; m.position.z = f.camera.position.z })
}

/** Rivers that run off the edge and fall into the cloud. */
function falls(k: BuildKit, spots: [number, number, number, number][]): void {
  const tex = canvasTexture(128, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H)
    for (let q = 0; q < 500; q++) {
      const x = W / 2 + (Math.random() - 0.5) * W * 0.8 * (0.5 + Math.random() * 0.5)
      g.fillStyle = `rgba(240,250,255,${0.15 + Math.random() * 0.5})`
      g.fillRect(x, Math.random() * H, 1 + Math.random() * 3, 40 + Math.random() * 140)
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 })
  for (const [x, y, z, yaw] of spots) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, y + 70), mat)
    m.position.set(x, (y - 70) / 2, z)
    m.rotation.y = yaw
    k.root.add(m)
  }
  k.onFrame((f) => { tex.offset.y = (f.time * 0.7) % 1 })
}

/** Old stone arches and colonnades, weathered and overgrown. */
function ruins(k: BuildKit, list: { x: number; z: number; a: number }[]): void {
  const { world: w, d } = k
  const m = new Mesher(), c = [0xcfc4ac, 0xc0b49c, 0xd8ccb4]
  for (const r of list) {
    const y = w.terrainAt(r.x, r.z)
    for (let q = 0; q < 5; q++) {
      const x = r.x + Math.cos(r.a) * q * 8, z = r.z + Math.sin(r.a) * q * 8, h = w.terrainAt(x, z)
      const t = c[q % 3]!, tall = q === 3 ? 4 : 12
      m.add(new THREE.CylinderGeometry(0.9, 1, tall, 14), trs(x, h + tall / 2, z), t)
      m.box(2.6, 0.9, 2.6, x, h + 0.2, z, t)
      if (tall > 8) m.box(2.6, 0.8, 2.6, x, h + tall, z, t)
      k.world.addPost(x, z, 1.2)
    }
    m.box(26, 1.4, 3, r.x + Math.cos(r.a) * 10, y + 12.9, r.z + Math.sin(r.a) * 10, c[1]!, -r.a)
    if (d.rand() < 0.5) m.add(new THREE.SphereGeometry(7, 20, 10, 0, 6.3, 0, 1.57), trs(r.x, y + 13, r.z), 0x7f9a8c)
  }
  place(k, m, surface('stone'))
}

/** A steel-and-canvas airship. */
function airship(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(lumpy(new THREE.SphereGeometry(1, 24, 14), 0.002, 1, 2), new THREE.MeshStandardMaterial({ color: 0xc8b48c, roughness: 0.62 }))
  body.scale.set(9, 9, 34)
  body.castShadow = false
  g.add(body)
  const m = new Mesher()
  m.box(3.4, 2.4, 11, 0, -10.4, 2, 0x4a3422)
  m.box(3.6, 0.5, 11.6, 0, -9, 2, 0x8a6a3a)
  for (const a of [0, 1.57, 3.14, 4.71]) {
    const fin = new THREE.BoxGeometry(0.3, 8, 10)
    m.add(fin, trs(Math.cos(a) * 8, Math.sin(a) * 8, -26, 0, 1, 0, a - 1.57), 0x8a2a24)
  }
  for (const s of [-1, 1]) for (const z of [-3, 7]) m.bar(new THREE.Vector3(s * 1.5, -9, z), new THREE.Vector3(s * 3, -7.6, z), 0.1, 0x2a2a2c, 4)
  const hard = new THREE.Mesh(m.build(), surface('wood'))
  g.add(hard)
  return g
}

/*
 * Sky Islands, as an island-hopping tour above the clouds. Leap from the
 * start island to the next, climb the glass highway to the high island, then
 * cross to the summit on the glass bridge or over the top of a moored
 * airship. From the summit, wings out: a long glide down across open sky to
 * the western islands, another leap, and the glass highway home.
 *
 * Lap 2: a crosswind on the bridges and in the air. Last lap: the wind is a
 * gale and loose rocks drift across the glass highway.
 */
const G = { raised: true, rail: 'LR', deck: 'glass' } as const

const POINTS: TrackPoint[] = [
  // 0: the start island, heading east
  [-20, 60, 10],
  [110, 60, 4, { pad: 0 }],
  [220, 61, -14, { items: true }],
  // 3: the first leap, over open air to the next island
  [282, 64, -44],
  [326, 70, -92, { gap: true }],
  [366, 58, -136],
  [440, 60, -210],
  [500, 62, -300, { items: true }],
  // 8: up the glass highway to the high island
  [520, 68, -380, G],
  [536, 80, -460, G],
  [560, 92, -540],
  [540, 96, -620, { pad: 0 }], // 11: the airship road leaves here
  // 12: the glass bridge to the summit island
  [430, 100, -650, G],
  [340, 110, -700, G],
  [280, 116, -750], // 14: the airship road rejoins
  [170, 122, -820, { items: true }],
  [60, 121, -805],
  // 17: off the summit's edge: wings out over open sky
  [-14, 120, -784, { raised: true, w: 18 }],
  [-40, 119, -770, { raised: true, gap: true, glide: true }],
  [-90, 106, -740, { raised: true, gap: true, glide: true }],
  [-125, 96, -715, { raised: true, gap: true, glide: true }],
  [-152, 84, -700, { raised: true, w: 26 }],
  [-210, 74, -660, { raised: true, w: 22 }],
  [-290, 70, -620],
  // 24: the second leap
  [-380, 70, -560, { pad: 0 }],
  [-430, 76, -500, { gap: true }],
  [-462, 66, -462],
  [-500, 64, -410],
  [-560, 64, -320, { items: true }],
  [-560, 64, -200],
  // 30: the glass highway home
  [-520, 62, -100, G],
  [-460, 60, -20, G],
  [-400, 58, 60],
  [-300, 58, 120],
  [-200, 59, 90, G],
  [-110, 60, 50, G],
]

export const sky: TrackDef = {
  id: 'sky',
  name: 'Sky Islands',
  ambience: 'sky',
  width: 17,
  bank: 2.4,
  shoulder: 12,
  accent: 0x8fd6ff,
  sea: -30,
  groundBelow: -28,
  piers: 'none',
  road: { lines: 'circuit', grime: 0x8a8068, kerbColors: [0x2f7fd0, 0xece8e0] },
  terrain: { layers: ['grass', 'forest_floor', 'rock_pitted_mossy', 'aerial_sand'], tile: [24, 11, 24, 26], tints: [0xc0dc84, 0xd8e0a0, 0xd0c4b0, 0xe4d4b0] },
  look: {
    tod: 'morning', fog: [0.84, 0.88, 0.94], fogDensity: 0.00036, fogBase: -40, fogFall: 0.006, sunGlow: 1,
    exposure: 1, sun: 1.25, hemi: 1.05, bloom: 0.3, shafts: 0.55, grade: [1.14, 1.08, 0, 0.002, 0.008, 1.03, 1, 0.98, 0.3],
  },
  points: POINTS,
  branches: [
    {
      // over the top of a moored airship: a timber deck laid along its back
      name: 'Airship', from: 11, to: 14, odds: 0.5,
      points: [
        [556, 99, -690, { raised: true, deck: 'wood', w: 17, rail: 'LR' }],
        [505, 105, -755, { raised: true, deck: 'wood', w: 17, rail: 'LR' }],
        [446, 112, -786, { raised: true, deck: 'wood', w: 17, rail: 'LR' }],
        // the airship itself: its deck is not moored fast, it drifts and rises under you
        [412, 112, -790, { gap: true }],
        [372, 112, -790, { gap: true }],
        [336, 113, -789, { raised: true, deck: 'wood', w: 17, rail: 'LR' }],
      ],
    },
  ],

  ground(x, z) {
    let best = -300
    for (const s of ISLES) {
      const e = isleEdge(s, x, z)
      if (e <= -0.2) continue
      const top = s.y - 2 + fbm2(x * 0.016 + s.y, z * 0.016) * 12 * smooth(0, 0.5, e)
      // a sharp rim: the top holds level, then drops away fast
      const h = THREE.MathUtils.lerp(-40, top, smooth(-0.04, 0.09, e))
      if (h > best) best = h
    }
    return best
  },
  splat(_x, _z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.7, 1.2, slope)
    mix[0] = 1 - rock
    mix[1] = (1 - rock) * 0.3
    mix[2] = Math.max(rock, smooth(30, 0, h))
    mix[3] = smooth(9, 3, roadDist) * 0.7
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: () => 'grass',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Sky Islands', '#8fd6ff')
    stands(k, 8, 52, -1, [0x3a7fc0, 0xe8e6e0, 0xd8a83a, 0xc05a4a, 0x2e3a48], 0x3a9ae0, 'Sky Islands')
    arrows(k, 0x8fd6ff)
    cloudFloor(k)
    roots(k)

    const land = (_x: number, _z: number, y: number) => y > 30
    forest(k, 'oak', d.spots(110, 5, 90, { clear: 5, test: land }), { scale: [0.65, 1.05], tints: [0xd8ecb0, 0xc8e4a0, 0xe4f0bc] })
    forest(k, 'pine', d.spots(70, 10, 100, { clear: 8, test: land }), { scale: [0.6, 1], tints: [0xdce8d0, 0xd0e0c4] })
    forest(k, 'cherry', d.spots(40, 5, 60, { clear: 5, test: land }), { scale: [0.8, 1.2], tints: [0xffffff, 0xffe8f0] })
    // the far islands are wooded too
    for (const s of ISLES.slice(4)) {
      const list: THREE.Vector3[] = []
      for (let q = 0; q < 70; q++) {
        const a = d.rand() * 6.28, u = Math.sqrt(d.rand()) * 0.8, x = s.x + Math.cos(a) * s.rx * u, z = s.z + Math.sin(a) * s.rz * u
        const y = w.terrainAt(x, z)
        if (y > 20) list.push(new THREE.Vector3(x, y, z))
      }
      forest(k, 'oak', list, { scale: [0.8, 1.3], solid: 0, tints: [0xd8ecb0, 0xc8e4a0] })
    }
    grass(k, { density: 3.6, reach: 24, height: [0.45, 0.95], colors: [0x9ab864, 0x8aac58, 0xb0c470, 0xa4bc68], test: land })
    d.prop('rock_07', d.spots(36, 7, 60, { clear: 7, test: land }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 2 + d.rand() * 2)), 1.2)
    d.prop('bk:island_tree_01', d.spots(22, 6, 60, { clear: 6, test: land }).map((s) => trs(s.x, s.y - 0.2, s.z, d.rand() * 6, 1.5 + d.rand() * 0.8)), 0.2)
    d.prop('bk:island_tree_02', d.spots(22, 6, 60, { clear: 6, test: land }).map((s) => trs(s.x, s.y - 0.2, s.z, d.rand() * 6, 1.7 + d.rand() * 0.8)), 0.2)
    d.prop('shrub_04', d.spots(70, 2, 40, { clear: 2, test: land }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.2 + d.rand())))
    crates(d, d.spots(10, 2, 7, { from: 0.02, to: 0.15, clear: 1.5 }), 0xc8a878)
    ruins(k, [{ x: 240, z: 40, a: 0.3 }, { x: 480, z: -250, a: 1.2 }, { x: 200, z: -850, a: 0.7 }, { x: -520, z: -280, a: 2 }, { x: -380, z: -10, a: 1.5 }, { x: 60, z: 70, a: 2.8 }, { x: -300, z: -680, a: 0.4 }])
    falls(k, [[690, 92, -600, 1.5], [100, 118, -915, 0], [-645, 62, -330, 1.57], [200, 56, 118, 2.9], [-420, 56, 215, 0.4], [600, 62, -150, 1.57]])

    // the glass highway: hung from a steel spine with cables to towers
    const span = new Mesher(), cables: THREE.Matrix4[] = []
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < c.count; i += 8) {
      if (!c.raised[i] || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      const yaw = Math.atan2(-t.x, -t.z)
      span.box(c.widths[i]! + 1.4, 0.4, 1, p.x, p.y - 0.9, p.z, 0x3a4048, yaw)
      span.box(1.2, 1.2, 16.4, p.x, p.y - 1.8, p.z, 0x4a525c, yaw)
      if (i % 40 === 0) for (const s of [-1, 1]) {
        const x = p.x + r.x * s * (half + 0.7), z = p.z + r.z * s * (half + 0.7)
        span.post(0.42, 0.26, 26, x, p.y - 1, z, 0xd8dade, 10)
        w.addPost(x, z, 0.6)
        for (let q = -5; q <= 5; q++) {
          if (!q) continue
          const j = (i + q * 7 + c.count) % c.count, a = c.samples[j]!, ar = c.rights[j]!
          if (!c.raised[j]) continue
          const from = new THREE.Vector3(x, p.y + 24, z), to = new THREE.Vector3(a.x + ar.x * s * (half + 0.3), a.y + 1, a.z + ar.z * s * (half + 0.3))
          const mid = from.clone().add(to).multiplyScalar(0.5)
          cables.push(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize()), new THREE.Vector3(0.05, from.distanceTo(to), 0.05)))
        }
      }
    }
    if (!span.empty) place(k, span, surface('metal'))
    d.instanced(new THREE.CylinderGeometry(1, 1, 1, 4), new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 0.7, roughness: 0.3 }), cables, false)

    // the jumps: steel lips with chevrons so you can read them at speed
    const lips = new Mesher(), lights: THREE.Matrix4[] = []
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (c.gap[i] === c.gap[j]) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      const yaw = Math.atan2(-t.x, -t.z)
      lips.box(c.widths[i]! + 1, 2.6, 1.4, p.x, p.y - 1.5, p.z, 0x5a626c, yaw)
      for (const s of [-1, 1]) {
        const x = p.x + r.x * s * half, z = p.z + r.z * s * half
        lips.post(0.14, 0.12, 5, x, p.y, z, 0xe8e8ec, 6)
        lights.push(trs(x, p.y + 5.2, z, 0, 0.4))
      }
    }
    place(k, lips, surface('metal'))
    const beacons = glow(3.2, 1.8, 0.4)
    d.instanced(new THREE.SphereGeometry(1, 8, 6), beacons, lights, false)

    const shipMove = mooredAirship(k, c.branches[0]!)
    // updrafts rising out of the clouds under the summit glide: fly through
    // one and it lifts you, so a good line holds height all the way down
    {
      const ups: Zone[] = []
      for (let i = 0; i < c.count; i++) {
        if (!c.glide[i] || i % 26 !== 0) continue
        const p = c.samples[i]!, r = c.rights[i]!, lat = (ups.length % 2 ? 1 : -1) * c.widths[i]! * 0.25
        const z: Zone = { x: p.x + r.x * lat, z: p.z + r.z * lat, r: 10, y0: p.y - 45, y1: p.y + 6, rise: 16, air: true, on: true }
        k.world.zones.push(z)
        ups.push(z)
      }
      zoneFx(k, ups, 0xffffff, 0.9, 40)
    }
    const drifters = rockDrift(k)

    // windmills on the hills
    const mills: THREE.Object3D[] = []
    const millTower = new Mesher()
    for (const [x, z] of [[60, 66], [420, -220], [-250, -700], [-350, 40], [250, -830]] as const) {
      const y = w.terrainAt(x, z)
      millTower.add(new THREE.CylinderGeometry(3, 4.6, 16, 10), trs(x, y + 8, z), 0xd4ccba)
      millTower.add(new THREE.ConeGeometry(3.6, 4, 10), trs(x, y + 18, z), 0x6a3a2a)
      w.addPost(x, z, 4.4)
      const sails = new Mesher()
      for (let q = 0; q < 4; q++) sails.box(1.6, 9, 0.1, 0, 5, 0.2, 0xece4d4, 0, q * 1.57).add(new THREE.BoxGeometry(0.2, 10, 0.2), trs(Math.sin(q * 1.57) * -5, Math.cos(q * 1.57) * 5, 0, 0, 1, 0, q * 1.57), 0x4a3422)
      const m = new THREE.Mesh(sails.build(), surface('wood', { double: true }))
      m.position.set(x, y + 15, z + 4.2)
      root.add(m)
      mills.push(m)
    }
    place(k, millTower, surface('plaster'))

    // loose rocks hanging in the air, drifting up and down
    const floaters: { p: THREE.Vector3; ph: number; s: number }[] = []
    const rock = lumpy(new THREE.IcosahedronGeometry(1, 2), 0.3, 1.5, 7)
    for (let q = 0; q < 46; q++) {
      const i = Math.floor(d.rand() * c.count), p = c.samples[i]!, r = c.rights[i]!, lat = (d.rand() < 0.5 ? -1 : 1) * (40 + d.rand() * 180)
      const x = p.x + r.x * lat, z = p.z + r.z * lat
      if (w.terrainAt(x, z) > 0) continue
      floaters.push({ p: new THREE.Vector3(x, p.y - 10 + d.rand() * 50, z), ph: d.rand() * 6.28, s: 3 + d.rand() * 13 })
    }
    const fl = new THREE.InstancedMesh(new Mesher().add(rock, new THREE.Matrix4(), 0x7a6c5c).build(), surface('rock'), floaters.length)
    fl.frustumCulled = false
    root.add(fl)

    // airships and balloons on long slow circuits
    const ships = [0, 1, 2].map((q) => {
      const s = airship()
      s.scale.setScalar(1.3 - q * 0.2)
      root.add(s)
      return { s, r: 520 + q * 200, y: 150 + q * 60, v: 0.03 - q * 0.006, ph: q * 2.1 }
    })
    const balloon = new Mesher()
    balloon.add(new THREE.SphereGeometry(7, 18, 12), trs(0, 12, 0, 0, new THREE.Vector3(1, 1.15, 1)), 0xd84a3a)
    balloon.add(new THREE.ConeGeometry(4.6, 6, 12), trs(0, 4, 0, 0, 1, Math.PI), 0xe8b03a)
    balloon.box(2, 1.4, 2, 0, 0, 0, 0x5a4029)
    const balloons = new THREE.InstancedMesh(balloon.build(), surface('paint'), 7)
    const bspots = Array.from({ length: 7 }, (_, q) => ({ x: Math.cos(q * 0.9) * (300 + q * 90), z: Math.sin(q * 0.9) * (300 + q * 80) - 120, y: 90 + (q % 3) * 40, ph: q * 1.3 }))
    balloons.frustumCulled = false
    root.add(balloons)

    // far cloud banks for depth
    const tex = cloudTexture()
    for (let q = 0; q < 34; q++) {
      const a = d.rand() * 6.28, r = 500 + d.rand() * 1700
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xfff6ec, transparent: true, opacity: 0.8, depthWrite: false }))
      s.position.set(100 + Math.cos(a) * r, -30 + d.rand() * 90, -150 + Math.sin(a) * r)
      s.scale.set(300 + d.rand() * 420, 110 + d.rand() * 160, 1)
      root.add(s)
    }

    const streaks = drift(k, 120, 0xffffff, 2.4, 0, true)
    streaks.visible = false
    const pm = streaks.material as THREE.PointsMaterial
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), eu = new THREE.Euler()
    k.onFrame((f) => {
      for (const m of mills) m.rotation.z = f.time * 0.6
      floaters.forEach((o, q) => {
        v3.copy(o.p)
        v3.y += Math.sin(f.time * 0.4 + o.ph) * 3.2
        m4.compose(v3, q4.setFromEuler(eu.set(o.ph, f.time * 0.05 + o.ph, 0)), sc.setScalar(o.s))
        fl.setMatrixAt(q, m4)
      })
      fl.instanceMatrix.needsUpdate = true
      for (const s of ships) {
        const a = f.time * s.v + s.ph
        s.s.position.set(100 + Math.cos(a) * s.r, s.y, -150 + Math.sin(a) * s.r)
        s.s.rotation.y = -a + Math.PI
      }
      bspots.forEach((b, q) => {
        m4.makeTranslation(b.x, b.y + Math.sin(f.time * 0.3 + b.ph) * 8, b.z)
        balloons.setMatrixAt(q, m4)
      })
      balloons.instanceMatrix.needsUpdate = true
      beacons.color.setRGB(Math.sin(f.time * 6) > 0 ? 4 : 0.8, Math.sin(f.time * 6) > 0 ? 2.2 : 0.4, 0.4)
      // the wind gets up on lap two, and blows harder on the last
      const gust = (f.lap - 1) / Math.max(1, f.totalLaps - 1)
      const blow = gust * (Math.sin(f.time * 0.5) * 0.5 + Math.sin(f.time * 1.3) * 0.5) * 4.5
      w.wind.x = blow
      w.wind.z = blow * 0.6
      streaks.visible = gust > 0
      drifters(f.totalLaps > 1 && f.lap >= f.totalLaps, f.time)
      shipMove(f.lap, f.dt)
      pm.opacity = 0.2 + gust * 0.3
    })
  },
}

/** The airship the deck road runs along: a great hull under the boards, moored to the islands. */
function mooredAirship(k: BuildKit, deck: import('../Circuit').Circuit): (lap: number, dt: number) => void {
  const { root, world: w } = k
  // the deck rides on the ship over the gap in the boards
  const g = findGap(deck, 392, -790)
  const lip = deck.samples[g.i0 - 1]!, land = deck.samples[g.i1 + 1]!
  const a = lip.clone().lerp(land, -0.25), b = lip.clone().lerp(land, 1.25)
  const mid = lip.clone().lerp(land, 0.5), yaw = Math.atan2(land.x - lip.x, land.z - lip.z)
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  const ship = airship()
  const scale = a.distanceTo(b) / 70
  ship.scale.setScalar(scale)
  ship.rotation.y = yaw
  root.add(ship)
  const len = Math.hypot(land.x - lip.x, land.z - lip.z) + 18
  const top = movingDeck(k, deck.widths[g.i0 - 1]!, len, 0x7a5a3a, 0xe8c070, 0.8)
  // mooring lines down to posts on the islands either side
  const m = new Mesher()
  for (const end of [deck.samples[2]!, deck.samples[deck.count - 3]!]) {
    const g = w.terrainAt(end.x, end.z)
    if (g < 0) continue
    for (const s of [-1, 1]) {
      const post = new THREE.Vector3(end.x + s * 14, g, end.z)
      m.post(0.5, 0.5, 6, post.x, g, post.z, 0x4a3422, 8)
      m.bar(post.clone().setY(g + 6), new THREE.Vector3(mid.x, mid.y - 4, mid.z), 0.06, 0x3a3020, 3)
    }
  }
  place(k, m, surface('wood'), false)
  // it drifts along its length and rises and sinks on the air; more from lap 2
  let t = 0, prev = 0
  return (lap, dt) => {
    t += dt
    const amp = lap >= 2 ? 6 : 4
    const off = Math.sin(t * 0.45) * amp, bob = Math.sin(t * 0.7) * (lap >= 2 ? 1.1 : 0.7)
    const v = dt > 0 ? (off - prev) / dt : 0
    prev = off
    const x = mid.x + fx * off, z = mid.z + fz * off, y = mid.y + bob
    top.set(x, z, yaw, y, y, fx * v, fz * v)
    ship.position.set(x, y - 9.6 * scale - 0.6, z)
  }
}

/** Loose rocks drifting across the glass highway on the last lap. */
function rockDrift(k: BuildKit): (on: boolean, t: number) => void {
  const { circuit: c, world: w, root } = k
  const spans: number[] = []
  for (let i = 0; i < c.count; i += 1) if (c.raised[i] && c.deck[i] === 5 && !c.gap[i]) spans.push(i)
  const geo = lumpy(new THREE.IcosahedronGeometry(1, 2), 0.3, 1.5, 7)
  const rocks = [0, 1, 2, 3].map((q) => {
    const m = new THREE.Mesh(geo, surface('rock'))
    m.scale.setScalar(2.4 + q * 0.3)
    m.visible = false
    root.add(m)
    const solid = { x: 1e6, z: 1e6, r: 2.4 + q * 0.3, top: -1e6 }
    w.movers.push(solid)
    return { m, solid, at: spans[Math.floor(((q + 0.5) / 4) * spans.length)] ?? 0, ph: q * 1.7 }
  })
  return (on, t) => {
    for (const r of rocks) {
      r.m.visible = on
      if (!on) { r.solid.top = -1e6; continue }
      const p = c.samples[r.at]!, rt = c.rights[r.at]!, lat = Math.sin(t * 0.35 + r.ph) * (c.widths[r.at]! / 2 + 8)
      r.m.position.set(p.x + rt.x * lat, p.y + r.solid.r * 0.8 + Math.sin(t + r.ph) * 0.4, p.z + rt.z * lat)
      r.m.rotation.set(t * 0.3 + r.ph, t * 0.2, 0)
      r.solid.x = r.m.position.x
      r.solid.z = r.m.position.z
      r.solid.top = p.y + 4
    }
  }
}
