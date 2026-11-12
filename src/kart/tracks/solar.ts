import * as THREE from 'three'
import { lumpy, softDot, trs } from '../../game/biomes/kit'
import { GLSL_NOISE, windClock } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import type { Solid } from '../World'
import type { Circuit } from '../Circuit'
import type { BuildKit, PointOpts, TrackDef } from '../types'
import { arrows, gantry, glow, loopTracks, twistDress } from './parts'

const R: PointOpts = { raised: true, deck: 'steel', rail: 'LR' }
/** Where the sun hangs in the sky, as a direction from the station. */
const SUN = new THREE.Vector3(-0.62, 0.22, -0.75).normalize()
/** The gas giant the station orbits, far below. */
const PLANET = { x: 900, y: -5200, z: 1400, r: 4800 }
/** The crown: the great ring of the station with its spires, which the road runs through. */
const CROWN = { x: -40, y: 40, z: -150, r: 150 }

/** The gas giant: soft bands of cloud drifting round it, a thin bright limb. */
function giantMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uT: windClock, uSun: { value: SUN.clone() } },
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${GLSL_NOISE}
      varying vec3 vN; varying vec3 vW; uniform float uT; uniform vec3 uSun;
      void main(){
        float lat = vN.y;
        float swirl = aFbm(vec2(vN.x * 3.0 + vN.z * 1.7 + uT * 0.004, lat * 6.0 + vN.z * 2.0)) * 0.35;
        float b = sin((lat + swirl * 0.25) * 38.0) * 0.5 + 0.5;
        float b2 = sin((lat - swirl * 0.4) * 11.0) * 0.5 + 0.5;
        vec3 deep = vec3(0.05, 0.12, 0.24), mid = vec3(0.16, 0.34, 0.48), pale = vec3(0.62, 0.56, 0.46);
        vec3 col = mix(deep, mid, b2);
        col = mix(col, pale, smoothstep(0.55, 0.95, b) * 0.55);
        float lit = clamp(dot(vN, uSun) * 0.8 + 0.35, 0.08, 1.0);
        vec3 view = normalize(cameraPosition - vW);
        float limb = pow(1.0 - clamp(dot(vN, view), 0.0, 1.0), 3.0);
        col = col * lit * 0.8 + vec3(0.3, 0.55, 0.9) * limb * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
    fog: false,
  })
}

/** Deep space: near-black blue with faint violet and teal nebula drifting through it. */
function spaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_NOISE}
      varying vec3 vD; uniform vec3 uSun;
      void main(){
        vec3 d = normalize(vD);
        vec2 p = vec2(d.x * 2.6 + d.y * 0.9, d.z * 2.6 - d.y * 1.3);
        float n = aFbm(p * 1.4 + 3.1), m = aFbm(p * 2.3 - 7.7);
        vec3 col = vec3(0.004, 0.006, 0.018);
        col += vec3(0.10, 0.04, 0.16) * smoothstep(0.45, 0.85, n) * 0.6;
        col += vec3(0.02, 0.10, 0.12) * smoothstep(0.5, 0.9, m) * 0.5;
        // the sun's glare spreading into the dark round it
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.82, 0.55) * (pow(s, 40.0) * 0.6 + pow(s, 6.0) * 0.06);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
}

/*
 * Solar Crown: a circuit round an orbital station above a gas giant, the sun
 * blazing off to one side. Out along the main deck, up round the habitat
 * modules and a boosted leap between two of them; up through the station's
 * crown to its highest spire and off the edge on wings (or down across the
 * solar array, low and quicker); a jump between docking arms (or the
 * maintenance tube, enclosed and safe), and back past the crown to the deck.
 * On the way, a corkscrew turns the deck right over once.
 *
 * Lap 2: a solar flare: the sun swells and the solar wind pushes at you on
 * the open spans. Last lap: debris from the flare tumbles across one lane at
 * a time.
 */
export const solar: TrackDef = {
  id: 'solar',
  name: 'Solar Crown',
  ambience: 'space',
  width: 17,
  bank: 3,
  maxBank: 0.28,
  rail: 'LR',
  accent: 0x6ad8ff,
  sea: -1e5,
  groundBelow: 1e6,
  piers: 'none',
  rails: 'steel',
  deck: 'steel',
  road: { lines: 'circuit', kerbColors: [0xe8f0f8, 0x2a6aa8], grime: 0x3a4250, tone: 1.05, edgeLine: 0x9adfff, sheen: 0.5 },
  look: {
    tod: 'midday', noSky: true, generatedSky: true, fog: [0.02, 0.03, 0.06], fogDensity: 0.00012, fogBase: -600, fogFall: 0.001, sunGlow: 0,
    exposure: 1.05, sun: 0.55, hemi: 0.7, bloom: 0.32, env: 0.7, stars: 1,
    grade: [1.08, 1.1, 0.004, 0.006, 0.014, 1.02, 1.0, 1.02, 0.36],
  },
  points: [
    [0.0, 40, 0.0, { ...R, w: 22 }],
    [156.8, 40, -4.5, { ...R, pad: 0 }],
    [291.2, 42, -44.8, R],
    [380.8, 48, -145.6, R],
    [369.6, 56, -268.8, R],
    [280.0, 62, -358.4, { ...R, items: true }],
    [212.8, 62, -378.6, { ...R, pad: 0 }],
    [174.7, 62, -380.8, { ...R, rail: '', pad: 0 }],
    [140.7, 65.3, -381.8, { gap: true }],
    [124.7, 64.3, -382.6, { gap: true }],
    [101.7, 62.3, -383.4, { ...R, w: 26 }],
    [-11.2, 58, -376.3, R],
    [-100.8, 64, -347.2, R],
    [-190.4, 74, -280.0, R],
    [-240.8, 84, -190.4, { ...R, items: true }],
    [-255.4, 88, -112.0, { ...R, pad: 0, rail: '' }],
    [-256.4, 89, -100.0, { gap: true, glide: true }],
    [-259.4, 81, -50.0, { gap: true, glide: true }],
    [-262.4, 73, 0.0, { gap: true, glide: true }],
    [-264.4, 67, 32.0, { gap: true, glide: true }],
    [-266.4, 62, 64.0, { ...R, w: 28 }],
    [-248.6, 54, 168.0, R],
    [-179.2, 46, 263.2, R],
    // the corkscrew: the deck turns right over once; keep your speed up through the top
    [-151, 44.5, 272.5, { ...R, roll: 2.094 }],
    [-123, 43, 281.8, { ...R, roll: 4.189 }],
    [-95, 41.5, 291, { ...R, roll: 6.283 }],
    [-67.2, 40, 300.2, { ...R, items: true }],
    [44.8, 38, 282.2, R],
    [112.0, 37, 273.3, { ...R, rail: '', pad: 0 }],
    [148.0, 40.5, 271.0, { gap: true }],
    [190.0, 35, 267.6, { ...R, w: 20 }],
    [293.4, 34, 221.8, R],
    [320.3, 36, 134.4, R],
    [179.2, 38, 116.5, R],
    [33.6, 39, 129.9, R],
    [-112.0, 40, 103.0, R],
    [-168.0, 40, 38.1, R],
    [-112.0, 40, -4.5, R],  ],
  // two full loops: one on the run out from the deck, one on the way home
  loops: [{ x: 225, z: -25, r: 13, side: 6 }, { x: 105, z: 123, r: 13, side: -6 }],
  branches: [
    {
      // down across the solar array: lower, on the trusses between the panels, and shorter
      name: 'Solar array', from: 12, to: 21, odds: 0.45,
      points: [
        [-190, 60, -352, { ...R, w: 14 }],
        [-310, 50, -262, { ...R, w: 14, items: true }],
        [-362, 48, -120, { ...R, w: 14 }],
        [-346, 50, 40, { ...R, w: 14, pad: 0 }],
      ],
    },
    {
      // the maintenance tube: enclosed glass, no jump, a little further round
      name: 'Maintenance tube', from: 26, to: 31, odds: 0.4,
      points: [
        [30, 36, 335, { ...R, tunnel: true, w: 14 }],
        [150, 35, 345, { ...R, tunnel: true, w: 14 }],
        [255, 34, 300, { ...R, tunnel: true, w: 14 }],
      ],
    },
  ],
  ground: () => -2000,
  surfaceAt: () => 'concrete',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Solar Crown', '#6ad8ff')
    arrows(k, 0x6ad8ff)
    // a bright alloy road
    k.road.mat.color.set(0x9aa4b0)
    k.road.mat.metalness = 0.45
    k.road.mat.roughness = 0.38

    // ── the sky: deep space, the stars, the sun off to one side
    const space = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), spaceMaterial())
    space.frustumCulled = false
    root.add(space)
    const sp = new Float32Array(4000 * 3)
    for (let q = 0; q < 4000; q++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.28, s = Math.sqrt(1 - u * u)
      sp.set([Math.cos(th) * s * 4600, u * 4600, Math.sin(th) * s * 4600], q * 3)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }))
    stars.frustumCulled = false
    root.add(stars)
    const sunPos = SUN.clone().multiplyScalar(4000)
    const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 6.4), fog: false, toneMapped: false })
    const sun = new THREE.Mesh(new THREE.SphereGeometry(130, 32, 16), sunMat)
    sun.position.copy(sunPos)
    root.add(sun)
    const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: new THREE.Color(1.6, 1.25, 0.8), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }))
    corona.position.copy(sunPos)
    corona.scale.setScalar(1150)
    root.add(corona)
    const sunLight = new THREE.DirectionalLight(0xfff0dc, 2.4)
    sunLight.position.copy(SUN).multiplyScalar(800)
    root.add(sunLight, sunLight.target)
    // the planet's light bouncing up from below, cool teal
    root.add(new THREE.HemisphereLight(0x8aa8d8, 0x2a5a68, 0.7))

    // ── the gas giant below, with a thin ring system
    const giant = new THREE.Mesh(new THREE.SphereGeometry(PLANET.r, 128, 64), giantMaterial())
    giant.position.set(PLANET.x, PLANET.y, PLANET.z)
    giant.frustumCulled = false
    root.add(giant)
    const ringGeo = new THREE.RingGeometry(PLANET.r * 1.35, PLANET.r * 2.1, 128, 4)
    const ringTex = new THREE.DataTexture(new Uint8Array(Array.from({ length: 256 }, (_, i) => { const v = Math.floor(120 + 100 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11))); return [v, v - 10, v - 30, Math.floor(60 + 120 * Math.abs(Math.sin(i * 0.21)))] }).flat()), 256, 1)
    ringTex.needsUpdate = true
    // map the texture across the ring's width
    const ruv = ringGeo.attributes['uv']!, rpos = ringGeo.attributes['position']!
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (Math.hypot(rpos.getX(i), rpos.getY(i)) - PLANET.r * 1.35) / (PLANET.r * 0.75), 0.5)
    const rings = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false, color: new THREE.Color(1.1, 1.05, 0.95) }))
    rings.position.copy(giant.position)
    rings.rotation.set(-Math.PI / 2 + 0.22, 0, 0.3)
    rings.frustumCulled = false
    root.add(rings)

    // ── the road's structure: white deck panels, a blue light strip, ribs underneath
    const deck = new Mesher(), ribs = new Mesher(), strip: THREE.Matrix4[] = []
    for (const p0 of c.all) for (let i = 0; i < p0.count; i += 3) {
      if (p0.gap[i]) continue
      const p = p0.samples[i]!, r = p0.rights[i]!, t = p0.tangents[i]!, half = p0.widths[i]! / 2
      const yaw = Math.atan2(-t.x, -t.z), pitch = Math.asin(THREE.MathUtils.clamp(t.y, -1, 1))
      deck.box(p0.widths[i]! + 1.4, 0.6, 6.6, p.x, p.y - 0.7, p.z, 0xdfe4ea, yaw, 0, pitch)
      ribs.box(4, 2.6, 6.6, p.x, p.y - 2.2, p.z, 0x5a6270, yaw, 0, pitch)
      if (i % 12 === 0) {
        ribs.box(p0.widths[i]! + 5, 0.8, 1, p.x, p.y - 1.6, p.z, 0x8a94a2, yaw)
        for (const s of [-1, 1]) strip.push(trs(p.x + r.x * s * (half + 2.2), p.y - 1.5, p.z + r.z * s * (half + 2.2), yaw, new THREE.Vector3(0.4, 0.4, 2.6)))
      }
    }
    place(k, deck, surface('paint', { rough: 0.35, metal: 0.4 }))
    place(k, ribs, surface('metal', { metal: 0.85, rough: 0.3 }))
    const stripMat = glow(0.6, 2.4, 4.2)
    d.instanced(new THREE.BoxGeometry(1, 1, 1), stripMat, strip, false)
    // jump lips: striped warning plates and blue lamps
    const lips = new Mesher()
    for (const p0 of c.all) for (let i = 1; i < p0.count; i++) {
      if (p0.gap[i - 1] || !p0.gap[i]) continue
      const p = p0.samples[i - 1]!, t = p0.tangents[i - 1]!
      lips.box(p0.widths[i - 1]! + 1.6, 3, 1.6, p.x, p.y - 1.6, p.z, 0xffc83a, Math.atan2(-t.x, -t.z))
    }
    place(k, lips, surface('paint', { rough: 0.3 }))
    glassTube(k, c.branches[1]!)
    loopTracks(k, 0xdfe4ea, 0x6ad8ff)
    // the corkscrew: lit rails and hoops so it reads as a built thing, not a bare sheet
    twistDress(k, new THREE.Color(0.4, 0.85, 1))

    // ── the crown: the station's great ring, its spires rising round it
    const crown = new Mesher(), windows: THREE.Matrix4[] = []
    crown.add(new THREE.TorusGeometry(CROWN.r, 6, 16, 128), trs(CROWN.x, CROWN.y - 30, CROWN.z, 0, 1, Math.PI / 2), 0xe8ecf0)
    crown.add(new THREE.TorusGeometry(CROWN.r - 9, 1.6, 8, 128), trs(CROWN.x, CROWN.y - 30, CROWN.z, 0, 1, Math.PI / 2), 0x6a7480)
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * Math.PI * 2, x = CROWN.x + Math.cos(a) * CROWN.r, z = CROWN.z + Math.sin(a) * CROWN.r
      if (d.roadGap(x, z) < 16) continue
      const tall = q % 3 === 0 ? 120 : q % 3 === 1 ? 80 : 60
      crown.add(new THREE.CylinderGeometry(1.5, 7, tall, 8), trs(x, CROWN.y - 30 + tall / 2, z), 0xf0f2f4)
      windows.push(trs(x, CROWN.y - 30 + tall + 1.5, z, 0, 2.2))
      w.addPost(x, z, 7.5)
    }
    // spokes from the ring to the hub, and the hub itself
    crown.add(new THREE.CylinderGeometry(26, 30, 50, 24), trs(CROWN.x, CROWN.y - 40, CROWN.z), 0xd8dde4)
    crown.add(new THREE.SphereGeometry(24, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), trs(CROWN.x, CROWN.y - 15, CROWN.z), 0x9ac8e8)
    for (let q = 0; q < 6; q++) {
      const a = (q / 6) * Math.PI * 2 + 0.26
      crown.bar(new THREE.Vector3(CROWN.x + Math.cos(a) * 28, CROWN.y - 30, CROWN.z + Math.sin(a) * 28), new THREE.Vector3(CROWN.x + Math.cos(a) * (CROWN.r - 4), CROWN.y - 30, CROWN.z + Math.sin(a) * (CROWN.r - 4)), 2.2, 0xc8cdd4, 8)
    }
    place(k, crown, surface('paint', { rough: 0.3, metal: 0.5 }))
    d.instanced(new THREE.SphereGeometry(1, 10, 6), glow(1.2, 3.6, 5), windows, false)

    // ── habitat modules and solar wings out in the open
    const mods = new Mesher(), lit: THREE.Matrix4[] = [], panels: THREE.Matrix4[] = [], truss = new Mesher()
    const spots: [number, number, number, number][] = [[260, 10, -200, 0.4], [430, 20, 40, 1.2], [60, 0, -560, 0.1], [-420, 30, -360, 2], [-460, 20, 260, 0.8], [120, 0, 420, 1.6], [420, -10, 380, 2.4]]
    for (const [x, y, z, yaw] of spots) {
      if (d.roadGap(x, z) < 50) continue
      const L = 90 + d.rand() * 60
      mods.add(new THREE.CylinderGeometry(16, 16, L, 24), trs(x, y, z, yaw, 1, Math.PI / 2), 0xe4e8ec)
      for (const e of [-1, 1]) mods.add(new THREE.SphereGeometry(16, 20, 10), trs(x + Math.cos(yaw) * e * L / 2, y, z - Math.sin(yaw) * e * L / 2), 0xd0d6dc)
      for (let q = -3; q <= 3; q++) lit.push(trs(x + Math.cos(yaw) * q * L / 8, y + 6, z - Math.sin(yaw) * q * L / 8, yaw, new THREE.Vector3(5, 1.2, 16.4)))
      // a pair of solar wings off each module
      for (const e of [-1, 1]) {
        const ox = Math.sin(yaw) * e, oz = Math.cos(yaw) * e
        truss.bar(new THREE.Vector3(x + ox * 16, y, z + oz * 16), new THREE.Vector3(x + ox * 150, y, z + oz * 150), 0.8, 0x8a94a2, 6)
        for (let s = 0; s < 8; s++) {
          const u = 26 + s * 16
          for (const f of [-1, 1]) panels.push(trs(x + ox * u + Math.cos(yaw) * f * 9, y, z + oz * u - Math.sin(yaw) * f * 9, yaw, new THREE.Vector3(14, 0.3, 15), 0.25))
        }
      }
    }
    // the solar array the branch runs across
    const arr = c.branches[0]!
    for (let i = 10; i < arr.count - 10; i += 9) {
      const p = arr.samples[i]!, r = arr.rights[i]!, t = arr.tangents[i]!, yaw = Math.atan2(-t.x, -t.z)
      for (const s of [-1, 1]) for (let n = 0; n < 4; n++) {
        const off = s * (arr.widths[i]! / 2 + 10 + n * 17)
        panels.push(trs(p.x + r.x * off, p.y - 2.5, p.z + r.z * off, yaw, new THREE.Vector3(15, 0.3, 16), 0.2))
      }
      truss.box(arr.widths[i]! + 150, 0.8, 0.8, p.x, p.y - 3.2, p.z, 0x8a94a2, yaw)
    }
    place(k, mods, surface('paint', { rough: 0.35, metal: 0.4 }))
    place(k, truss, surface('metal', { metal: 0.9, rough: 0.3 }))
    d.instanced(new THREE.BoxGeometry(1, 1, 1), glow(1.6, 2.2, 3), lit, false)
    const cellTex = new THREE.DataTexture(new Uint8Array(Array.from({ length: 64 }, (_, i) => ((i % 8) === 0 || (i >> 3) === 0) ? [200, 210, 220, 255] : [18, 34, 74, 255]).flat()), 8, 8)
    cellTex.wrapS = cellTex.wrapT = THREE.RepeatWrapping
    cellTex.repeat.set(4, 4)
    cellTex.magFilter = THREE.NearestFilter
    cellTex.needsUpdate = true
    d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: cellTex, metalness: 0.7, roughness: 0.18, envMapIntensity: 1.6 }), panels, false)

    // ── asteroids drifting far out
    const rock = lumpy(new THREE.IcosahedronGeometry(1, 2), 0.35, 1.5, 11)
    const roids = new Mesher()
    for (let q = 0; q < 70; q++) {
      const a = d.rand() * 6.28, rr = 700 + d.rand() * 1600, s = 4 + d.rand() * d.rand() * 40
      roids.add(rock, trs(Math.cos(a) * rr, -120 + d.rand() * 400, -100 + Math.sin(a) * rr, d.rand() * 6, new THREE.Vector3(s, s * (0.6 + d.rand() * 0.4), s * (0.7 + d.rand() * 0.5))), [0x5a5550, 0x4a4642, 0x6a625a][q % 3]!)
    }
    const roidMesh = place(k, roids, surface('rock'))

    // ── the flare and the debris
    const debrisGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.3, 1.4, 5)
    const debris = [0.3, 0.56, 0.82].map((fr, q) => {
      const m = new THREE.Mesh(debrisGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a32, roughness: 0.9, emissive: new THREE.Color(0.9, 0.3, 0.05), emissiveIntensity: 0.8 }))
      m.scale.setScalar(2.4)
      m.visible = false
      root.add(m)
      const solid: Solid = { x: 1e6, z: 1e6, r: 2.6, top: -1e6 }
      w.movers.push(solid)
      return { m, solid, i: Math.floor(c.count * fr), ph: q * 2.1 }
    })
    k.onFrame((f) => {
      const flare = f.lap >= 2 ? 1 : 0
      const pulse = 1 + flare * (0.35 + Math.sin(f.time * 0.7) * 0.1)
      sun.scale.setScalar(pulse)
      corona.scale.setScalar(1150 * pulse * (1 + flare * 0.4))
      // the sky stays put round the camera: it is infinitely far away
      const eye = f.camera.position
      space.position.copy(eye)
      stars.position.copy(eye)
      sun.position.copy(eye).add(sunPos)
      corona.position.copy(sun.position)
      sunLight.intensity = 2.4 + flare * 0.8
      stripMat.color.setRGB(0.6 + flare * 1.4, 2.4, 4.2 - flare * 1.2)
      // the solar wind on the open spans, gusting away from the sun
      const gust = flare * Math.max(0, Math.sin(f.time * 0.37)) * (0.6 + 0.4 * Math.sin(f.time * 1.3))
      w.wind.x = -SUN.x * gust * 2.4
      w.wind.z = -SUN.z * gust * 2.4
      roidMesh.rotation.y = f.time * 0.004
      const last = f.totalLaps > 1 && f.lap >= f.totalLaps
      for (const db of debris) {
        db.m.visible = last
        if (!last) { db.solid.top = -1e6; continue }
        // tumbling across the left half of the road, never the whole width
        const p = c.samples[db.i]!, r = c.rights[db.i]!, half = c.widths[db.i]! / 2
        const lat = -half * (0.3 + 0.55 * (0.5 + 0.5 * Math.sin(f.time * 0.8 + db.ph)))
        db.m.position.set(p.x + r.x * lat, p.y + 1.6, p.z + r.z * lat)
        db.m.rotation.set(f.time * 1.3, f.time * 0.9, 0)
        db.solid.x = db.m.position.x
        db.solid.z = db.m.position.z
        db.solid.top = p.y + 3
      }
    })
  },
}

/** The maintenance tube: glass hoops and panes round the road, lit blue from the floor. */
function glassTube(k: BuildKit, tube: Circuit): void {
  const { root } = k
  const hoops = new Mesher()
  const glass = new THREE.MeshStandardMaterial({ color: 0xa8d8f0, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false })
  const pane = new Mesher()
  for (let i = 0; i < tube.count; i += 3) {
    if (!tube.tunnel[i]) continue
    const p = tube.samples[i]!, t = tube.tangents[i]!, half = tube.widths[i]! / 2 + 1.4, yaw = Math.atan2(-t.x, -t.z)
    if (i % 9 === 0) hoops.add(new THREE.TorusGeometry(half, 0.35, 6, 24, Math.PI), trs(p.x, p.y - 0.6, p.z, yaw, 1), 0xdfe4ea)
    pane.add(new THREE.CylinderGeometry(half, half, 6.6, 20, 1, true, Math.PI / 2, Math.PI), new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.6, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)), 0xffffff)
  }
  place(k, hoops, surface('metal', { metal: 0.9, rough: 0.3 }))
  root.add(new THREE.Mesh(pane.build(), glass))
}
