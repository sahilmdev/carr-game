import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvasTexture, rng, trs } from '../../game/biomes/kit'
import { GLSL_NOISE, windClock } from './atmos'
import type { BuildKit } from '../types'

/**
 * Building blocks for everything man-made. Shapes are merged into one mesh
 * with colours per part, and surfaces get their look from world position:
 * masonry courses, plank grain, weathering and streaks down the walls, so
 * nothing reads as a clean plastic box.
 */
export type Finish = 'stone' | 'wood' | 'plaster' | 'metal' | 'paint' | 'concrete' | 'rock'

const FINISH: Record<Finish, string> = {
  stone: /* glsl */ `
    float row = floor(wp.y / 0.85);
    float along = (abs(wn.x) > abs(wn.z) ? wp.z : wp.x) / 1.7 + row * 0.5;
    vec2 f = vec2(fract(along), fract(wp.y / 0.85));
    float seam = smoothstep(0.0, 0.035, f.x) * smoothstep(1.0, 0.965, f.x) * smoothstep(0.0, 0.07, f.y) * smoothstep(1.0, 0.93, f.y);
    float tone = 0.74 + aHash(vec2(floor(along), row)) * 0.42;
    albedo *= mix(0.4, tone, seam) * (0.84 + aFbm(wp.xz * 0.9 + wp.y) * 0.3);`,
  wood: /* glsl */ `
    float plank = floor((wp.y + wp.x * 0.001) / 0.42);
    float grain = aNoise(vec2(plank * 7.3 + wp.y * 9.0, (wp.x + wp.z) * 0.8));
    float seam = smoothstep(0.0, 0.05, fract(wp.y / 0.42));
    albedo *= mix(0.42, 0.72 + aHash(vec2(plank, 2.0)) * 0.4 + grain * 0.28, seam);`,
  plaster: /* glsl */ `
    albedo *= 0.88 + aFbm(wp.xy * 0.5 + wp.z * 0.5) * 0.24;
    albedo *= 1.0 - smoothstep(0.55, 0.8, aFbm(vec2((wp.x + wp.z) * 0.5, wp.y * 0.08))) * 0.26;`,
  metal: /* glsl */ `
    albedo *= 0.8 + aFbm(wp.xz * 1.3 + wp.y * 0.8) * 0.36;
    albedo = mix(albedo, albedo * vec3(0.72, 0.48, 0.32), smoothstep(0.58, 0.78, aFbm(wp.xy * 0.33 + wp.z * 0.33)) * 0.6);`,
  paint: /* glsl */ `
    albedo *= 0.9 + aFbm(wp.xy * 0.8 + wp.z * 0.8) * 0.18;`,
  concrete: /* glsl */ `
    float lift = floor(wp.y / 2.4);
    float line = smoothstep(0.0, 0.02, fract(wp.y / 2.4));
    albedo *= mix(0.72, 0.84 + aHash(vec2(lift, 4.0)) * 0.14, line);
    albedo *= 0.86 + aFbm(wp.xz * 0.6 + wp.y * 0.4) * 0.26;
    albedo *= 1.0 - smoothstep(0.52, 0.78, aFbm(vec2((wp.x + wp.z) * 0.8, wp.y * 0.05))) * 0.34;`,
  rock: /* glsl */ `
    float st = aFbm(vec2((wp.x + wp.z) * 0.08, wp.y * 0.55));
    albedo *= 0.62 + st * 0.75;
    albedo *= 0.8 + aFbm(wp.xz * 0.9 + wp.y) * 0.4;`,
}

const mats = new Map<string, THREE.MeshStandardMaterial>()

/** A shared material for merged parts with this finish (colours come from the parts). */
export function surface(finish: Finish, o: { rough?: number; metal?: number; double?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = `${finish}|${o.rough}|${o.metal}|${o.double}`
  let m = mats.get(key)
  if (m) return m
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? (finish === 'metal' ? 0.5 : 0.88), metalness: o.metal ?? (finish === 'metal' ? 0.55 : 0), side: o.double ? THREE.DoubleSide : THREE.FrontSide })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAw;\nvarying vec3 vAn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vAw = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          vAn = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
        #else
          vAw = (modelMatrix * vec4(position, 1.0)).xyz;
          vAn = mat3(modelMatrix) * normal;
        #endif`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vAw;\nvarying vec3 vAn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wp = vAw, wn = normalize(vAn), albedo = diffuseColor.rgb;
          ${FINISH[finish]}
          diffuseColor.rgb = albedo;
        }`)
  }
  m.customProgramCacheKey = () => `kart-surface-${finish}`
  m.userData['keep'] = true
  mats.set(key, m)
  return m
}

const _c = new THREE.Color()

/** Collects shapes with colours, then hands back one geometry. */
export class Mesher {
  private readonly parts: THREE.BufferGeometry[] = []

  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: number): this {
    const p = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m)
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') p.deleteAttribute(k)
    if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2))
    const n = p.getAttribute('position').count, col = new Float32Array(n * 3)
    _c.set(color)
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3)
    p.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.parts.push(p)
    return this
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, ry = 0, rz = 0, rx = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), trs(x, y, z, ry, 1, rx, rz), color)
  }

  /** Cylinder standing on (x, y, z). */
  post(r0: number, r1: number, h: number, x: number, y: number, z: number, color: number, seg = 10): this {
    return this.add(new THREE.CylinderGeometry(r1, r0, h, seg), trs(x, y + h / 2, z), color)
  }

  /** A pipe or strut between two points. */
  bar(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, seg = 6): this {
    const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    return this.add(new THREE.CylinderGeometry(r, r, len, seg), new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), color)
  }

  build(): THREE.BufferGeometry { return mergeGeometries(this.parts, false)! }
  get empty(): boolean { return !this.parts.length }
}

/** Put a mesher's geometry in the world. */
export function place(k: BuildKit, g: Mesher, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(g.build(), mat)
  m.castShadow = cast
  m.receiveShadow = true
  k.root.add(m)
  return m
}

/** The same shape at many transforms. */
export function repeat(k: BuildKit, g: Mesher, mat: THREE.Material, at: THREE.Matrix4[], cast = true): THREE.InstancedMesh {
  return k.d.instanced(g.build(), mat, at, cast)
}

/** A curved beam: swept box along a curve, for gate tops and roof ridges. */
export function curvedBeam(out: Mesher, half: number, lift: number, h: number, d: number, color: number, y: number): void {
  const N = 16
  const pos: number[] = [], idx: number[] = []
  const at = (u: number) => {
    const x = (u * 2 - 1) * half
    return [x, y + lift * Math.abs(u * 2 - 1) ** 2.4] as const
  }
  for (let i = 0; i <= N; i++) {
    const [x, yy] = at(i / N)
    const end = Math.abs(i / N * 2 - 1)
    const hh = h * (1 + end * 0.35)
    pos.push(x, yy, d / 2, x, yy + hh, d / 2, x, yy + hh, -d / 2, x, yy, -d / 2)
    if (i < N) for (let q = 0; q < 4; q++) {
      const a = i * 4 + q, b = i * 4 + (q + 1) % 4
      idx.push(a, a + 4, b, b, a + 4, b + 4)
    }
  }
  idx.push(0, 1, 2, 0, 2, 3)
  const e = N * 4
  idx.push(e, e + 2, e + 1, e, e + 3, e + 2)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  out.add(flat, new THREE.Matrix4(), color)
}

/** A shrine gate sized to span `span` metres. */
export function toriiShape(span: number, height: number): Mesher {
  const m = new Mesher(), red = 0xb8261c, black = 0x1a1412, half = span / 2
  for (const s of [-1, 1]) {
    m.post(0.72, 0.56, height, s * half, 0, 0, red, 14)
    m.post(0.86, 0.84, 1.1, s * half, -0.1, 0, black, 14)
  }
  m.box(span + 3, 0.7, 0.62, 0, height * 0.72, 0, red)
  m.box(0.5, height * 0.2, 0.5, 0, height * 0.85, 0, red)
  m.box(2.6, 1.5, 0.3, 0, height * 0.83, 0.32, black)
  curvedBeam(m, half + 3.4, 1.15, 0.72, 1.3, red, height * 0.965)
  curvedBeam(m, half + 3.9, 1.3, 0.34, 1.7, black, height * 0.965 + 0.74)
  return m
}

function roofShell(m: Mesher, inner: number, outer: number, y: number, rise: number, color: number): void {
  // a square hip roof with upswept corners, from a ring of quads
  const A = 48, R = 7
  const pos: number[] = [], idx: number[] = []
  for (let r = 0; r <= R; r++) for (let a = 0; a <= A; a++) {
    const th = (a / A) * Math.PI * 2, u = r / R
    const c = Math.cos(th), s = Math.sin(th), q = Math.max(Math.abs(c), Math.abs(s))
    const rad = inner + (outer - inner) * u
    const corner = Math.abs(Math.sin(th * 2)) ** 0.0 * (1 - Math.abs(Math.cos(th * 2))) * 0
    const flare = Math.abs(Math.cos(th * 2)) ** 3
    const yy = y + rise * (1 - u) ** 1.9 + flare * u ** 3 * rise * 0.46 + corner
    pos.push((c / q) * rad, yy, (s / q) * rad)
  }
  const row = A + 1
  for (let r = 0; r < R; r++) for (let a = 0; a < A; a++) {
    const p = r * row + a
    idx.push(p, p + 1, p + row, p + 1, p + row + 1, p + row)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  m.add(flat, new THREE.Matrix4(), color)
}

/** A tiered pagoda. Windows and lanterns come back separately so they can glow. */
export function pagodaShape(tiers: number, base: number): { body: Mesher; roof: Mesher; lit: Mesher } {
  const body = new Mesher(), roof = new Mesher(), lit = new Mesher()
  const wall = 0x8c3a2a, post = 0x3a1a14, cream = 0xe2d6bd
  let y = 0, w = base
  body.box(w * 1.5, 2.2, w * 1.5, 0, 1.1, 0, 0x7d7a74)
  body.box(w * 1.3, 1.4, w * 1.3, 0, 2.9, 0, 0x8a8780)
  y = 3.6
  for (let t = 0; t < tiers; t++) {
    const h = 7.4 - t * 0.5
    body.box(w, h, w, 0, y + h / 2, 0, cream)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.post(0.42, 0.38, h, (sx * w) / 2, y, (sz * w) / 2, wall, 8)
    for (const s of [-1, 1]) for (let q = -1; q <= 1; q++) {
      body.box(0.34, h, 0.34, s * (w / 2 + 0.05), y + h / 2, q * w * 0.27, post)
      body.box(0.34, h, 0.34, q * w * 0.27, y + h / 2, s * (w / 2 + 0.05), post)
      lit.box(0.1, h * 0.46, w * 0.15, s * (w / 2 + 0.1), y + h * 0.52, q * w * 0.27 + w * 0.13, 0xffb860)
      lit.box(w * 0.15, h * 0.46, 0.1, q * w * 0.27 + w * 0.13, y + h * 0.52, s * (w / 2 + 0.1), 0xffb860)
    }
    body.box(w + 3.4, 0.5, w + 3.4, 0, y + 0.25, 0, post)
    const eave = w / 2 + 4.4 - t * 0.2
    roofShell(roof, w * 0.16, eave, y + h - 0.3, 5.4 - t * 0.3, 0x2b3236)
    roof.box(eave * 2, 0.4, eave * 2, 0, y + h - 0.1, 0, post)
    y += h + 2.8
    w *= 0.82
  }
  // the finial
  body.post(0.3, 0.06, 9, 0, y - 1.5, 0, 0x8c7a3a, 8)
  for (let q = 0; q < 6; q++) body.add(new THREE.TorusGeometry(0.72 - q * 0.08, 0.09, 6, 14), trs(0, y + 0.3 + q * 0.95, 0, 0, 1, Math.PI / 2), 0x8c7a3a)
  return { body, roof, lit }
}

// ── Crowds ── (off: the player asked for no spectators anywhere)
const SHOW_CROWDS = false

let crowdTex: THREE.CanvasTexture | null = null
function crowdTexture(): THREE.CanvasTexture {
  if (crowdTex) return crowdTex
  crowdTex = canvasTexture(1024, 256, (g, W, H) => {
    const r = rng(77)
    const skin = ['#e6bd9c', '#c99a76', '#8f6446', '#f0cfb4', '#5e4030']
    const hair = ['#2a1c14', '#50321c', '#0f0f12', '#8a6a3a', '#b8b0a4', '#7a2f1c']
    for (let f = 0; f < 8; f++) {
      const cx = (f + 0.5) * (W / 8), b = H - 6, u = W / 8
      const wave = f % 3 === 0, s = skin[Math.floor(r() * 5)]!
      // shirt is white here, so each person's own colour multiplies through
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.moveTo(cx - u * 0.3, b); g.lineTo(cx - u * 0.33, b - H * 0.46)
      g.quadraticCurveTo(cx, b - H * 0.6, cx + u * 0.33, b - H * 0.46)
      g.lineTo(cx + u * 0.3, b); g.closePath(); g.fill()
      g.strokeStyle = s
      g.lineWidth = u * 0.13
      g.lineCap = 'round'
      g.beginPath()
      if (wave) { g.moveTo(cx - u * 0.3, b - H * 0.46); g.lineTo(cx - u * 0.4, b - H * 0.86); g.moveTo(cx + u * 0.3, b - H * 0.46); g.lineTo(cx + u * 0.42, b - H * 0.9) } else { g.moveTo(cx - u * 0.32, b - H * 0.44); g.lineTo(cx - u * 0.36, b - H * 0.14); g.moveTo(cx + u * 0.32, b - H * 0.44); g.lineTo(cx + u * 0.36, b - H * 0.14) }
      g.stroke()
      g.fillStyle = s
      g.beginPath(); g.arc(cx, b - H * 0.68, u * 0.19, 0, 6.29); g.fill()
      g.fillStyle = hair[Math.floor(r() * 6)]!
      g.beginPath(); g.arc(cx, b - H * 0.72, u * 0.2, Math.PI, 0); g.fill()
    }
  })
  return crowdTex
}

let crowdMat: THREE.MeshStandardMaterial | null = null
function crowdMaterial(): THREE.MeshStandardMaterial {
  if (crowdMat) return crowdMat
  crowdMat = new THREE.MeshStandardMaterial({ map: crowdTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 })
  crowdMat.onBeforeCompile = (s) => {
    s.uniforms['uT'] = windClock
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nattribute float aPick;\nvarying float vPick;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vPick = aPick;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
          float hop = max(0.0, sin(uT * 4.0 + ph)) * step(0.45, fract(ph * 0.31));
          transformed.y += hop * 0.16;
        }`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 crowdPx = texture2D(map, vec2((vMapUv.x + floor(fract(vInstanceColorPick) * 8.0)) / 8.0, vMapUv.y));
        diffuseColor *= crowdPx;`)
      .replace('#include <common>', '#include <common>\nvarying float vPick;\n#define vInstanceColorPick vPick')
  }
  crowdMat.customProgramCacheKey = () => 'kart-crowd'
  return crowdMat
}

/** Rows of people. `spots` are [x, y, z, yaw]; shirts are their colours. */
export function crowd(k: BuildKit, spots: [number, number, number, number][], shirts: number[]): void {
  if (!SHOW_CROWDS) return
  if (!spots.length) return
  const { d } = k
  const g = new THREE.PlaneGeometry(1, 1.5)
  g.translate(0, 0.72, 0)
  const pick = new Float32Array(spots.length)
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
  spots.forEach(([x, y, z, yaw], i) => {
    mats.push(trs(x, y, z, yaw, 0.85 + d.rand() * 0.25))
    cols.push(new THREE.Color(shirts[Math.floor(d.rand() * shirts.length)]!).multiplyScalar(0.62 + d.rand() * 0.35))
    pick[i] = d.rand()
  })
  g.setAttribute('aPick', new THREE.InstancedBufferAttribute(pick, 1))
  const im = d.instanced(g, crowdMaterial(), mats, false, cols)
  im.receiveShadow = false
}

/** A covered grandstand with seating tiers, a roof and an advertising wall. */
export function grandstand(k: BuildKit, from: number, to: number, side: number, shirts: number[], accent: number, brand: string): void {
  const { circuit: c, world: w, d } = k
  const n = c.count
  const conc = new Mesher(), steel = new Mesher(), seats: [number, number, number, number][] = []
  const TIERS = 9, STEP = 1.05, RISE = 0.72, OFF = 7
  const adMats: THREE.Matrix4[] = []
  for (let q = from; q < to; q += 3) {
    const i = (q + n) % n, p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
    const yaw = Math.atan2(t.x, t.z)
    const half = c.widths[i]! / 2
    const at = (lat: number) => [p.x + r.x * side * (half + lat), p.z + r.z * side * (half + lat)] as const
    for (let tier = 0; tier < TIERS; tier++) {
      const [x, z] = at(OFF + tier * STEP), y = p.y + 1.1 + tier * RISE
      conc.box(STEP + 0.06, y - p.y + 3, 6.2, x, y - (y - p.y + 3) / 2, z, tier % 2 ? 0x8d9096 : 0x83868c, yaw + Math.PI / 2 - Math.PI / 2)
      for (let f = -2; f <= 2; f++) {
        if (d.rand() < 0.14) continue
        seats.push([x + t.x * f * 1.15 + (d.rand() - 0.5) * 0.2, y, z + t.z * f * 1.15 + (d.rand() - 0.5) * 0.2, yaw + (side > 0 ? -1.57 : 1.57) + 1.57 * 0 ])
      }
    }
    // back wall and the roof
    const [bx, bz] = at(OFF + TIERS * STEP + 0.5), topY = p.y + TIERS * RISE + 7
    conc.box(1, topY - p.y + 2, 6.2, bx, (topY + p.y - 2) / 2, bz, 0x74777d, yaw)
    if (q % 9 === from % 9) {
      steel.bar(new THREE.Vector3(bx, topY, bz), new THREE.Vector3(...((): [number, number, number] => { const [x, z] = at(OFF - 1); return [x, topY + 2.4, z] })()), 0.2, 0x2a2e36)
      const [fx, fz] = at(OFF + 2)
      steel.post(0.2, 0.18, topY - p.y - 1, fx, p.y + 1, fz, 0x2a2e36, 8)
    }
    const [rx, rz] = at(OFF + TIERS * STEP * 0.5 - 0.6)
    steel.box(TIERS * STEP + 3.4, 0.25, 6.2, rx, topY + 1.2, rz, 0xd4d7dc, yaw, 0, side * 0.0)
    // low wall along the front, with sponsor boards
    const [ax, az] = at(OFF - 1.1)
    conc.box(0.4, 1.4, 6.2, ax, p.y + 0.5, az, 0x53565c, yaw)
    adMats.push(trs(ax - r.x * side * 0.24, p.y + 0.7, az - r.z * side * 0.24, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), new THREE.Vector3(6.1, 1.1, 1)))
    const [cx, cz] = at(OFF + 4)
    w.addPost(cx, cz, 6.5, p.y + 3)
  }
  place(k, conc, surface('concrete'))
  place(k, steel, surface('metal', { double: true }))
  crowd(k, seats, shirts)
  const css = `#${accent.toString(16).padStart(6, '0')}`
  const tex = canvasTexture(512, 92, (g, W, H) => {
    g.fillStyle = '#10131a'
    g.fillRect(0, 0, W, H)
    g.fillStyle = css
    g.fillRect(0, 0, 18, H)
    g.fillStyle = '#f4f5f7'
    g.font = 'italic 800 62px "Barlow Condensed", Arial, sans-serif'
    g.textBaseline = 'middle'
    g.fillText(brand.toUpperCase(), 34, H / 2 + 3, W - 44)
  })
  k.d.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }), adMats, false)
}
