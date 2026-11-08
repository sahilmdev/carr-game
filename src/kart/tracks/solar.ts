import * as THREE from 'three'
import { trs } from '../../game/biomes/kit'
import { GLSL_NOISE, windClock } from '../art/atmos'
import { Mesher, place, surface } from '../art/arch'
import type { Solid } from '../World'
import type { BuildKit, PointOpts, TrackDef } from '../types'
import { arrows, drift, gantry, glow } from './parts'

const STAR_Y = -70
const R: PointOpts = { raised: true, deck: 'steel', rail: 'LR' }

/** The star's surface: boiling granulation, bright lanes, dark spots, hot to the eye. */
function photosphere(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uT: windClock, uHeat: { value: 1 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${GLSL_NOISE}
      varying vec3 vW; uniform float uT, uHeat;
      void main(){
        vec2 p = vW.xz * 0.012;
        float t = uT * 0.15;
        // granules: cells of rising plasma with cooler lanes between
        float g = aFbm(p * 3.0 + vec2(t, -t * 0.7));
        float cells = smoothstep(0.25, 0.75, aNoise(p * 9.0 + g * 2.2 + t * 0.6));
        float big = aFbm(p * 0.35 - t * 0.05);
        float spot = smoothstep(0.78, 0.86, aFbm(p * 0.5 + 7.3)) ;
        float h = clamp(0.35 + cells * 0.45 + big * 0.35 - spot * 0.9, 0.0, 1.2) * uHeat;
        vec3 col = mix(vec3(0.35, 0.04, 0.0), vec3(1.5, 0.52, 0.08), smoothstep(0.2, 0.75, h));
        col = mix(col, vec3(2.2, 1.5, 0.7), smoothstep(0.85, 1.15, h));
        float d = length(vW.xz - cameraPosition.xz);
        col = mix(col, vec3(1.3, 0.42, 0.08), smoothstep(900.0, 3600.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
    toneMapped: false,
    fog: false,
  })
}

/** Plasma along a prominence: streaming, flickering, additive. */
function plasma(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uT: windClock, uGain: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_NOISE}
      varying vec2 vUv; uniform float uT, uGain;
      void main(){
        float flow = aFbm(vec2(vUv.x * 18.0 - uT * 1.6, vUv.y * 3.0));
        float edge = sin(vUv.y * 3.14159);
        float a = smoothstep(0.25, 0.8, flow) * edge;
        vec3 c = mix(vec3(1.2, 0.22, 0.03), vec3(2.0, 1.1, 0.35), flow);
        gl_FragColor = vec4(c * a * uGain * 0.7, a * 0.8);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  })
}

/**
 * Solar Crown: a gold road laid in loops over the face of a star. No ground,
 * only the boiling surface far below; flares arch over the road, station rings
 * spin round it, and twice it simply ends and you jump to the next span. The
 * star wakes on the second lap with a great eruption, and on the last, plasma
 * columns break loose and sweep across the road.
 */
export const solar: TrackDef = {
  id: 'solar',
  name: 'Solar Crown',
  ambience: 'space',
  width: 17,
  bank: 3,
  maxBank: 0.28,
  rail: 'LR',
  accent: 0xffcf4a,
  sea: -30,
  groundBelow: 1e6,
  piers: 'none',
  rails: 'steel',
  deck: 'steel',
  road: { lines: 'circuit', kerbColors: [0xffcf4a, 0x8a2a08], grime: 0x6a4a1a, tone: 1.15, edgeLine: 0xffe8a0, sheen: 0.6 },
  look: {
    tod: 'midday', noSky: true, generatedSky: true, fog: [0.3, 0.08, 0.02], fogDensity: 0.00022, fogBase: STAR_Y, fogFall: 0.004, sunGlow: 0,
    exposure: 1.0, sun: 0.7, hemi: 0.55, bloom: 0.55, env: 0.5, stars: 1,
    grade: [1.15, 1.1, 0.02, 0.004, 0, 1.08, 0.96, 0.86, 0.36],
  },
  points: [
    [0, 40, 0, R],
    [120, 40, -4, { ...R, pad: 0 }],
    [222, 44, -40, R],
    [272, 52, -120, R],
    [244, 60, -200, R],
    // a kick up off the end of the span, and a long drop to the next one
    [222, 60.5, -222, R],
    [176, 63, -240, { gap: true }],
    [130, 49, -252, R],
    [100, 44, -252, R],
    [30, 36, -238, R],
    [-40, 30, -252, { ...R, pad: 0 }],
    [-112, 26, -222, R],
    [-172, 32, -160, R],
    [-202, 40, -90, R],
    [-200, 42, -64, R],
    [-186, 50, -26, { gap: true }],
    [-160, 36, 18, R],
    [-140, 40, 40, R],
    [-82, 36, 62, R],
    [-36, 38, 30, R],
  ],
  ground: () => STAR_Y - 200,
  surfaceAt: () => 'concrete',
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Solar Crown', '#ffcf4a')
    // a gold road
    k.road.mat.color.set(0xa07a38)
    k.road.mat.metalness = 0.6
    k.road.mat.roughness = 0.4
    arrows(k, 0xffcf4a)

    // ── the star: a vast curved surface under everything
    const starMat = photosphere()
    const star = new THREE.Mesh(new THREE.SphereGeometry(6000, 96, 48, 0, Math.PI * 2, 0, 0.6), starMat)
    star.position.set(0, STAR_Y - 6000, -100)
    star.frustumCulled = false
    root.add(star)
    // its light comes from below
    const under = new THREE.DirectionalLight(0xffa040, 1.6)
    under.position.set(40, -200, 60)
    root.add(under)
    root.add(under.target)
    const rim = new THREE.HemisphereLight(0x302040, 0xff7020, 0.9)
    root.add(rim)
    // the dark of space, full of stars
    const sp = new Float32Array(3000 * 3)
    for (let q = 0; q < 3000; q++) {
      const u = Math.random(), th = Math.random() * 6.28, ph = Math.acos(u * 0.98)
      sp.set([Math.cos(th) * Math.sin(ph) * 5000, Math.cos(ph) * 5000 - 400, Math.sin(th) * Math.sin(ph) * 5000], q * 3)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }))
    stars.frustumCulled = false
    root.add(stars)
    const bg = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050208, side: THREE.BackSide, fog: false }))
    root.add(bg)

    // ── the road's gold spine and its underside lights
    const spine = new Mesher(), lights: THREE.Matrix4[] = []
    for (let i = 0; i < c.count; i += 3) {
      if (c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      const yaw = Math.atan2(-t.x, -t.z), pitch = Math.asin(THREE.MathUtils.clamp(t.y, -1, 1))
      spine.box(c.widths[i]! + 1.2, 0.5, 6.6, p.x, p.y - 0.65, p.z, 0xc8962a, yaw, 0, pitch)
      spine.box(3, 2.4, 6.6, p.x, p.y - 2, p.z, 0x6a4a1a, yaw, 0, pitch)
      if (i % 9 === 0) {
        spine.box(c.widths[i]! + 4, 0.6, 0.8, p.x, p.y - 1.6, p.z, 0xd8a83a, yaw)
        for (const s of [-1, 1]) lights.push(trs(p.x + r.x * s * (half + 1.9), p.y - 1.6, p.z + r.z * s * (half + 1.9), 0, 0.35))
      }
    }
    place(k, spine, surface('metal', { metal: 0.95, rough: 0.22 }))
    const lightMat = glow(4, 2.6, 0.8)
    d.instanced(new THREE.SphereGeometry(1, 6, 4), lightMat, lights, false)
    // jump lips
    const lips = new Mesher()
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (c.gap[i] === c.gap[j]) continue
      const p = c.samples[i]!, t = c.tangents[i]!
      lips.box(c.widths[i]! + 1.6, 3, 1.6, p.x, p.y - 1.6, p.z, 0xffcf4a, Math.atan2(-t.x, -t.z))
    }
    place(k, lips, surface('metal', { metal: 0.9, rough: 0.2 }))

    // ── station rings the road runs through, turning slowly
    const rings: THREE.Mesh[] = []
    for (const fr of [0.1, 0.42, 0.7, 0.93]) {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, t = c.tangents[i]!
      const g = new Mesher()
      g.add(new THREE.TorusGeometry(19, 1.4, 10, 64), new THREE.Matrix4(), 0xd8b050)
      for (let q = 0; q < 12; q++) g.box(3, 3, 3.6, Math.cos(q * 0.5236) * 19, Math.sin(q * 0.5236) * 19, 0, 0x8a6a2a)
      const m = new THREE.Mesh(g.build(), surface('metal', { metal: 0.9, rough: 0.25 }))
      m.position.set(p.x, p.y + 6, p.z)
      m.lookAt(p.x + t.x, p.y + 6 + t.y, p.z + t.z)
      root.add(m)
      rings.push(m)
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(19, 0.35, 6, 64), glow(4, 2.2, 0.6))
      glowRing.position.z = 1.9
      m.add(glowRing)
    }

    // ── prominences: great arches of plasma, some right over the road
    const plas = plasma()
    const arches: { m: THREE.Mesh; base: number }[] = []
    const arch = (x: number, z: number, span: number, height: number, yaw: number, tube: number): void => {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-span / 2, 0, 0), new THREE.Vector3(0, height * 2, 0), new THREE.Vector3(span / 2, 0, 0))
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, tube, 10, false), plas)
      m.position.set(x, STAR_Y, z)
      m.rotation.y = yaw
      m.frustumCulled = false
      root.add(m)
      arches.push({ m, base: height })
    }
    for (const fr of [0.2, 0.55, 0.82]) {
      const i = Math.floor(c.count * fr), p = c.samples[i]!, t = c.tangents[i]!
      arch(p.x, p.z, 220, p.y - STAR_Y + 46, Math.atan2(t.x, t.z) + Math.PI / 2, 9)
    }
    for (let q = 0; q < 10; q++) {
      const a = d.rand() * 6.28, r = 500 + d.rand() * 1600
      arch(Math.cos(a) * r, -100 + Math.sin(a) * r, 300 + d.rand() * 500, 140 + d.rand() * 320, d.rand() * 6, 16 + d.rand() * 20)
    }
    // the great eruption from lap two: a tall arch rising behind the start
    arch(60, -560, 600, 10, 0.3, 34)
    const eruption = arches[arches.length - 1]!

    // ── mirrors: a flock of collector panels hanging in the light
    const mirrors: THREE.Matrix4[] = []
    for (let q = 0; q < 140; q++) {
      const a = d.rand() * 6.28, r = 90 + d.rand() * 500, x = Math.cos(a) * r, z = -100 + Math.sin(a) * r
      if (d.roadGap(x, z) < 20) continue
      mirrors.push(trs(x, -10 + d.rand() * 100, z, d.rand() * 6, new THREE.Vector3(8, 0.3, 5), 0.9 + d.rand() * 0.4))
    }
    d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffe0a0, metalness: 1, roughness: 0.08, envMapIntensity: 2 }), mirrors, false)

    // ── the last lap: plasma columns that sweep across the road
    const COLS = 3
    const colMat = plasma()
    const columns = Array.from({ length: COLS }, (_, q) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 1, 16, 4, true), colMat)
      m.visible = false
      m.frustumCulled = false
      root.add(m)
      const solid: Solid = { x: 0, z: 0, r: 3.4, top: 1e6 }
      return { m, solid, i: Math.floor(c.count * (0.25 + q * 0.27)), ph: q * 2, on: false }
    })
    const embers = drift(k, 160, 0xffa040, 1.4, -3)
    const em = embers.material as THREE.PointsMaterial
    em.blending = THREE.AdditiveBlending

    k.onFrame((f) => {
      for (const [q, m] of rings.entries()) m.rotateZ(f.dt * (q % 2 ? 0.2 : -0.15))
      const lap = f.lap, total = f.totalLaps
      const wake = lap >= 2 ? 1 : 0
      starMat.uniforms['uHeat']!.value = 1 + wake * 0.15 + Math.sin(f.time * 0.8) * 0.03
      // the eruption grows over a few seconds once lap two starts
      const target = wake ? 520 : 10
      const s = eruption.m.scale.y + (target / 10 - eruption.m.scale.y) * Math.min(1, f.dt * 0.3)
      eruption.m.scale.set(1, Math.max(1, s), 1)
      plas.uniforms['uGain']!.value = 1 + wake * 0.3
      under.intensity = 1.6 + wake * 0.6 + Math.sin(f.time * 1.3) * 0.12
      em.opacity = 0.35 + wake * 0.4
      const last = total > 1 && lap >= total
      for (const col of columns) {
        if (last !== col.on) {
          col.on = last
          col.m.visible = last
          if (last) w.movers.push(col.solid)
          else w.movers.splice(w.movers.indexOf(col.solid), 1)
        }
        if (!last) continue
        const p = c.samples[col.i]!, r = c.rights[col.i]!
        const lat = Math.sin(f.time * 0.5 + col.ph) * (c.widths[col.i]! / 2 + 6)
        const x = p.x + r.x * lat, z = p.z + r.z * lat
        col.solid.x = x; col.solid.z = z
        col.m.position.set(x, (p.y + STAR_Y) / 2 + 20, z)
        col.m.scale.set(1, p.y - STAR_Y + 40, 1)
      }
    })
  },
}
