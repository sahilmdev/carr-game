import * as THREE from 'three'
import { rng } from '../../game/biomes/kit'
import { windClock } from './atmos'
import type { BuildKit } from '../types'

/**
 * Real trees from code: a branching wooden skeleton with hundreds of leaf
 * cards on the branch tips. Leaf normals point out of the crown, so a whole
 * tree shades as one soft volume with a lit side and a dark side, and the
 * cards are built from drawn leaves with no dark fringes. Far trees swap to a
 * sparse copy, and forests are split into cells so unseen ones cost nothing.
 */
export type Species = 'cherry' | 'oak' | 'rainforest' | 'pine' | 'snowpine' | 'dead'

interface Spec {
  height: number
  trunkR: number
  /** Share of the height that is bare trunk. */
  bare: number
  depth: number
  kids: number
  spread: number
  /** Upward pull on the branches: negative droops. */
  lift: number
  card: number
  cards: number
  leaf: LeafKind
  bark: number
  conifer?: boolean
}

type LeafKind = 'blossom' | 'broad' | 'jungle' | 'needle' | 'snowneedle'

const SPECS: Record<Species, Spec> = {
  cherry: { height: 8.5, trunkR: 0.3, bare: 0.28, depth: 4, kids: 3, spread: 0.95, lift: 0.1, card: 2.1, cards: 8, leaf: 'blossom', bark: 0x3b2a2a },
  oak: { height: 15, trunkR: 0.55, bare: 0.3, depth: 4, kids: 3, spread: 0.8, lift: 0.18, card: 3, cards: 7, leaf: 'broad', bark: 0x5a4a3a },
  rainforest: { height: 32, trunkR: 0.9, bare: 0.62, depth: 4, kids: 3, spread: 1.05, lift: 0.1, card: 4.6, cards: 7, leaf: 'jungle', bark: 0x5e5244 },
  pine: { height: 22, trunkR: 0.5, bare: 0.1, depth: 1, kids: 0, spread: 0, lift: -0.25, card: 3, cards: 3, leaf: 'needle', bark: 0x4a3a2e, conifer: true },
  snowpine: { height: 20, trunkR: 0.48, bare: 0.08, depth: 1, kids: 0, spread: 0, lift: -0.3, card: 3, cards: 3, leaf: 'snowneedle', bark: 0x45372d, conifer: true },
  dead: { height: 11, trunkR: 0.4, bare: 0.25, depth: 3, kids: 3, spread: 0.9, lift: 0.05, card: 0, cards: 0, leaf: 'broad', bark: 0x6a6058 },
}

// ── Textures ──

/** Canvas to texture, with transparent pixels given the leaves' average colour. */
function clean(canvas: HTMLCanvasElement): THREE.DataTexture {
  const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height
  const img = g.getImageData(0, 0, W, H), d = img.data
  let r = 0, gg = 0, b = 0, n = 0
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 128) { r += d[i]!; gg += d[i + 1]!; b += d[i + 2]!; n++ }
  n = Math.max(1, n); r /= n; gg /= n; b /= n
  const out = new Uint8Array(d.length)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4
    const a = d[s + 3]!
    if (a < 10) { out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = 0 } else { out[o] = d[s]!; out[o + 1] = d[s + 1]!; out[o + 2] = d[s + 2]!; out[o + 3] = a }
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

function draw(size: number, fn: (g: CanvasRenderingContext2D, S: number, r: () => number) => void, seed: number): THREE.DataTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  fn(c.getContext('2d', { willReadFrequently: true })!, size, rng(seed))
  return clean(c)
}

function leafShape(g: CanvasRenderingContext2D, x: number, y: number, len: number, wide: number, ang: number, a: string, b: string): void {
  g.save()
  g.translate(x, y)
  g.rotate(ang)
  const grad = g.createLinearGradient(0, -len * wide, 0, len * wide)
  grad.addColorStop(0, a)
  grad.addColorStop(1, b)
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, 0)
  g.quadraticCurveTo(len * 0.45, -len * wide, len, 0)
  g.quadraticCurveTo(len * 0.45, len * wide, 0, 0)
  g.fill()
  g.strokeStyle = 'rgba(20,30,10,0.35)'
  g.lineWidth = Math.max(1, len * 0.03)
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.92, 0); g.stroke()
  g.restore()
}

const leafTextures = new Map<LeafKind, THREE.DataTexture>()
function leafTexture(kind: LeafKind): THREE.DataTexture {
  let t = leafTextures.get(kind)
  if (t) return t
  if (kind === 'blossom') t = draw(512, (g, S, r) => {
    // twigs under the flowers, then hundreds of five-petal blooms
    g.strokeStyle = '#3a2528'
    for (let q = 0; q < 12; q++) {
      g.lineWidth = 2 + r() * 3
      g.beginPath()
      g.moveTo(S / 2 + (r() - 0.5) * 60, S / 2 + (r() - 0.5) * 60)
      g.quadraticCurveTo(r() * S, r() * S, r() * S, r() * S)
      g.stroke()
    }
    const pinks = ['#ffe3ec', '#ffd0df', '#ffc0d4', '#ffb0c9', '#ffeef3', '#fda6c2']
    for (let q = 0; q < 330; q++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * S * 0.47
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, s = 9 + r() * 11
      const col = pinks[Math.floor(r() * pinks.length)]!
      const rot = r() * 6.28
      for (let p = 0; p < 5; p++) {
        const pa = rot + p * 1.257
        g.fillStyle = col
        g.beginPath()
        g.ellipse(x + Math.cos(pa) * s * 0.55, y + Math.sin(pa) * s * 0.55, s * 0.55, s * 0.36, pa, 0, 6.29)
        g.fill()
      }
      g.fillStyle = '#c23a68'
      g.beginPath(); g.arc(x, y, s * 0.2, 0, 6.29); g.fill()
    }
  }, 11)
  else if (kind === 'broad') t = draw(512, (g, S, r) => {
    const shades: [string, string][] = [['#6f9a3c', '#3f6a26'], ['#7fae48', '#4d7a2e'], ['#5b8a34', '#335a22'], ['#8ab552', '#557f30']]
    for (let q = 0; q < 170; q++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * S * 0.46, [c1, c2] = shades[Math.floor(r() * 4)]!
      leafShape(g, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 30 + r() * 34, 0.3, r() * 6.28, c1, c2)
    }
  }, 12)
  else if (kind === 'jungle') t = draw(512, (g, S, r) => {
    const shades: [string, string][] = [['#4f9a3a', '#1f5f2a'], ['#3c8a38', '#17502a'], ['#66ad42', '#2a6f2c'], ['#2f7a36', '#123f24']]
    for (let q = 0; q < 80; q++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * S * 0.42, [c1, c2] = shades[Math.floor(r() * 4)]!
      leafShape(g, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 60 + r() * 70, 0.34, r() * 6.28, c1, c2)
    }
  }, 13)
  else t = draw(512, (g, S, r) => {
    // a drooping spray: a stem with needles down both sides
    const greens = ['#2f5a3a', '#264e34', '#3a6a44', '#1f4430']
    for (let q = 0; q < 9; q++) {
      const x0 = S * (0.1 + r() * 0.8), y0 = S * 0.04, x1 = x0 + (r() - 0.5) * S * 0.2, y1 = S * (0.7 + r() * 0.28)
      g.strokeStyle = '#3a2c20'
      g.lineWidth = 3
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke()
      for (let n = 0; n < 150; n++) {
        const u = r(), x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, s = r() < 0.5 ? -1 : 1, l = (1 - u * 0.6) * (30 + r() * 26)
        g.strokeStyle = greens[Math.floor(r() * 4)]!
        g.lineWidth = 1.6 + r() * 1.4
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * l, y + l * (0.5 + r() * 0.5)); g.stroke()
      }
    }
    if (kind === 'snowneedle') {
      for (let q = 0; q < 190; q++) {
        g.fillStyle = `rgba(${236 + r() * 19},${243 + r() * 12},255,${0.86})`
        const x = r() * S, y = r() * S * 0.8
        g.beginPath(); g.ellipse(x, y, 14 + r() * 26, 7 + r() * 11, (r() - 0.5) * 0.6, 0, 6.29); g.fill()
      }
    }
  }, 14)
  leafTextures.set(kind, t)
  return t
}

let barkTex: THREE.CanvasTexture | null = null
function bark(): THREE.CanvasTexture {
  if (barkTex) return barkTex
  const c = document.createElement('canvas')
  c.width = 256; c.height = 512
  const g = c.getContext('2d')!, r = rng(21)
  g.fillStyle = '#b8aea0'
  g.fillRect(0, 0, 256, 512)
  for (let q = 0; q < 420; q++) {
    const x = r() * 256, y = r() * 512, l = 40 + r() * 140
    g.strokeStyle = r() < 0.6 ? `rgba(40,30,24,${0.25 + r() * 0.5})` : `rgba(230,220,205,${0.12 + r() * 0.2})`
    g.lineWidth = 1 + r() * 4
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 16, y + l * 0.3, x + (r() - 0.5) * 16, y + l * 0.7, x + (r() - 0.5) * 10, y + l); g.stroke()
  }
  barkTex = new THREE.CanvasTexture(c)
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping
  barkTex.colorSpace = THREE.SRGBColorSpace
  barkTex.anisotropy = 4
  return barkTex
}

// ── Materials ──

function sway(s: THREE.WebGLProgramParametersWithUniforms, amount: number, flutter: number): void {
  s.uniforms['uT'] = windClock
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uT;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec2 root = instanceMatrix[3].xz;
        #else
          vec2 root = vec2(0.0);
        #endif
        float ph = root.x * 0.09 + root.y * 0.07;
        float big = sin(uT * 1.1 + ph) * 0.6 + sin(uT * 2.3 + ph * 1.7) * 0.4;
        float tip = sin(uT * 5.0 + position.x * 2.3 + position.z * 1.9 + position.y * 1.3);
        transformed.xz += vec2(big, big * 0.6) * ${amount.toFixed(3)} * position.y;
        transformed += vec3(tip, tip * 0.5, -tip) * ${flutter.toFixed(3)};
      }`)
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>()
function leafMaterial(kind: LeafKind): THREE.MeshStandardMaterial {
  let m = leafMats.get(kind)
  if (m) return m
  const map = leafTexture(kind)
  m = new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: kind === 'blossom' ? 0.16 : 0.1, alphaTest: 0.38, side: THREE.DoubleSide,
    roughness: 0.72, vertexColors: true,
  })
  m.onBeforeCompile = (s) => {
    sway(s, 0.0035, 0.05)
    // the crown is one soft volume: never flip a card's normal for its back face
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
  }
  m.customProgramCacheKey = () => `kart-leaf-${kind}`
  leafMats.set(kind, m)
  return m
}

const woodMats = new Map<number, THREE.MeshStandardMaterial>()
function woodMaterial(color: number): THREE.MeshStandardMaterial {
  let m = woodMats.get(color)
  if (m) return m
  m = new THREE.MeshStandardMaterial({ map: bark(), color, roughness: 0.92 })
  m.onBeforeCompile = (s) => sway(s, 0.0026, 0)
  m.customProgramCacheKey = () => 'kart-wood'
  woodMats.set(color, m)
  return m
}

// ── Tree building ──

class Parts {
  wp: number[] = []; wn: number[] = []; wu: number[] = []; wi: number[] = []
  lp: number[] = []; ln: number[] = []; lu: number[] = []; lc: number[] = []; li: number[] = []

  tube(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides: number, v0: number): void {
    const dir = b.clone().sub(a), len = dir.length()
    dir.normalize()
    const side = new THREE.Vector3(1, 0.2, 0.1).cross(dir).normalize(), up = dir.clone().cross(side).normalize()
    const base = this.wp.length / 3
    for (let e = 0; e < 2; e++) for (let s = 0; s <= sides; s++) {
      const th = (s / sides) * Math.PI * 2, c = Math.cos(th), n = Math.sin(th)
      const r = e ? rb : ra, o = e ? b : a
      const nx = side.x * c + up.x * n, ny = side.y * c + up.y * n, nz = side.z * c + up.z * n
      this.wp.push(o.x + nx * r, o.y + ny * r, o.z + nz * r)
      this.wn.push(nx, ny, nz)
      this.wu.push(s / sides * 2, v0 + (e ? len / 3 : 0))
    }
    const row = sides + 1
    for (let s = 0; s < sides; s++) {
      const p = base + s
      this.wi.push(p, p + 1, p + row, p + 1, p + row + 1, p + row)
    }
  }

  card(at: THREE.Vector3, size: number, rot: THREE.Quaternion, normal: THREE.Vector3, shade: number, stretch = 1): void {
    const base = this.lp.length / 3
    const h = size / 2
    for (const [x, y] of [[-h, -h * stretch], [h, -h * stretch], [h, h * stretch], [-h, h * stretch]] as const) {
      const v = new THREE.Vector3(x, y, 0).applyQuaternion(rot).add(at)
      this.lp.push(v.x, v.y, v.z)
      this.ln.push(normal.x, normal.y, normal.z)
      this.lc.push(shade, shade, shade)
    }
    this.lu.push(0, 0, 1, 0, 1, 1, 0, 1)
    this.li.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  geos(): { wood: THREE.BufferGeometry; leaf: THREE.BufferGeometry | null } {
    const wood = new THREE.BufferGeometry()
    wood.setAttribute('position', new THREE.Float32BufferAttribute(this.wp, 3))
    wood.setAttribute('normal', new THREE.Float32BufferAttribute(this.wn, 3))
    wood.setAttribute('uv', new THREE.Float32BufferAttribute(this.wu, 2))
    wood.setIndex(this.wi)
    if (!this.lp.length) return { wood, leaf: null }
    const leaf = new THREE.BufferGeometry()
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(this.lp, 3))
    leaf.setAttribute('normal', new THREE.Float32BufferAttribute(this.ln, 3))
    leaf.setAttribute('uv', new THREE.Float32BufferAttribute(this.lu, 2))
    leaf.setAttribute('color', new THREE.Float32BufferAttribute(this.lc, 3))
    leaf.setIndex(this.li)
    return { wood, leaf }
  }
}

const q4 = new THREE.Quaternion()
const eul = new THREE.Euler()

function randomRot(r: () => number): THREE.Quaternion {
  eul.set(r() * 6.28, r() * 6.28, r() * 6.28)
  return q4.setFromEuler(eul).clone()
}

function broadTree(sp: Spec, r: () => number, lod: 0 | 1): { wood: THREE.BufferGeometry; leaf: THREE.BufferGeometry | null } {
  const P = new Parts(), tips: THREE.Vector3[] = []
  const H = sp.height * (0.88 + r() * 0.24), sides = lod ? 4 : 7
  // the trunk, flared at the foot
  let p = new THREE.Vector3(0, -0.4, 0), dir = new THREE.Vector3(0, 1, 0), radius = sp.trunkR * 1.5
  const segs = lod ? 3 : 5, trunkTop = H * (sp.bare + 0.14)
  for (let s = 0; s < segs; s++) {
    dir = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.22, 0, (r() - 0.5) * 0.22)).normalize()
    const next = p.clone().addScaledVector(dir, trunkTop / segs + (s === 0 ? 0.4 : 0))
    const rn = s === 0 ? sp.trunkR : sp.trunkR * (1 - (s / segs) * 0.35)
    P.tube(p, next, radius, rn, sides, s)
    p = next
    radius = rn
  }
  const grow = (from: THREE.Vector3, d: THREE.Vector3, len: number, rad: number, depth: number): void => {
    const steps = lod || depth > 2 ? 1 : 2
    let at = from, dd = d
    for (let s = 0; s < steps; s++) {
      dd = dd.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, sp.lift + (r() - 0.5) * 0.2, (r() - 0.5) * 0.5)).normalize()
      const next = at.clone().addScaledVector(dd, len / steps)
      P.tube(at, next, rad, rad * 0.72, depth > 2 ? 3 : lod ? 3 : 5, s)
      at = next
      rad *= 0.72
    }
    if (depth >= sp.depth) { tips.push(at); return }
    for (let k = 0; k < sp.kids; k++) {
      const a = r() * 6.28 + k * 2.1
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      grow(at, dd.clone().multiplyScalar(0.7).addScaledVector(side, sp.spread).normalize(), len * (0.62 + r() * 0.2), rad, depth + 1)
    }
  }
  const crown = H - trunkTop
  for (let k = 0; k < 4; k++) {
    const a = k * 1.57 + r()
    grow(p, new THREE.Vector3(Math.cos(a) * sp.spread, 0.8, Math.sin(a) * sp.spread).normalize(), crown * 0.5, sp.trunkR * 0.62, 1)
  }
  if (sp.cards && tips.length) {
    const c = new THREE.Vector3()
    for (const t of tips) c.add(t)
    c.divideScalar(tips.length)
    let reach = 0
    for (const t of tips) reach = Math.max(reach, t.distanceTo(c))
    const n = lod ? Math.max(1, Math.round(sp.cards * 0.3)) : sp.cards
    const size = sp.card * (lod ? 1.9 : 1)
    const nor = new THREE.Vector3(), at = new THREE.Vector3()
    for (const t of tips) for (let q = 0; q < n; q++) {
      at.copy(t).add(new THREE.Vector3((r() - 0.5), (r() - 0.5) * 0.7, (r() - 0.5)).multiplyScalar(sp.card * 1.3))
      nor.copy(at).sub(c).normalize()
      nor.y += 0.35
      nor.normalize()
      const out = Math.min(1, at.distanceTo(c) / Math.max(reach, 1))
      const shade = 0.46 + out * 0.5 + (at.y > c.y ? 0.1 : -0.08)
      P.card(at, size * (0.75 + r() * 0.5), randomRot(r), nor, Math.min(1.05, shade))
    }
  }
  return P.geos()
}

function conifer(sp: Spec, r: () => number, lod: 0 | 1): { wood: THREE.BufferGeometry; leaf: THREE.BufferGeometry | null } {
  const P = new Parts()
  const H = sp.height * (0.82 + r() * 0.36), sides = lod ? 4 : 6
  const top = new THREE.Vector3(0, H, 0)
  P.tube(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, H * 0.5, 0), sp.trunkR, sp.trunkR * 0.55, sides, 0)
  P.tube(new THREE.Vector3(0, H * 0.5, 0), top, sp.trunkR * 0.55, 0.03, sides, 3)
  const whorls = lod ? 7 : 14, nor = new THREE.Vector3()
  for (let w = 0; w < whorls; w++) {
    const u = w / (whorls - 1)
    const y = H * (sp.bare + (1 - sp.bare) * u * 0.97)
    const reach = (1 - u) ** 0.85 * H * 0.27 + 0.6
    const arms = lod ? 4 : 7 - Math.floor(u * 3)
    const off = r() * 6.28
    for (let a = 0; a < arms; a++) {
      const th = off + (a / arms) * 6.28 + (r() - 0.5) * 0.4
      const dx = Math.cos(th), dz = Math.sin(th)
      const droop = sp.lift * (1 + (1 - u))
      const tip = new THREE.Vector3(dx * reach, y + droop * reach, dz * reach)
      if (!lod && u < 0.8) P.tube(new THREE.Vector3(0, y, 0), tip, 0.09, 0.02, 3, 0)
      // a spray hanging along the arm, seen from every side
      const mid = new THREE.Vector3(dx * reach * 0.6, y + droop * reach * 0.6 - reach * 0.16, dz * reach * 0.6)
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-dz, 0.3, dx), new THREE.Vector3(dx, -droop - 0.8, dz).normalize())
      const rot = new THREE.Quaternion().setFromRotationMatrix(look)
      nor.set(dx, 0.75, dz).normalize()
      const shade = 0.55 + (1 - Math.abs(u - 0.6)) * 0.3 + r() * 0.15
      P.card(mid, Math.max(1.6, reach * 1.25) * (lod ? 1.4 : 1), rot, nor, shade, 1.05)
      if (!lod) {
        const rot2 = rot.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2))
        P.card(mid, Math.max(1.4, reach), rot2, nor, shade * 0.9, 1.05)
      }
    }
  }
  return P.geos()
}

interface Variant { wood: THREE.BufferGeometry; leaf: THREE.BufferGeometry | null }
const pool = new Map<Species, { hi: Variant[]; lo: Variant[] }>()

function variants(s: Species): { hi: Variant[]; lo: Variant[] } {
  let v = pool.get(s)
  if (v) return v
  const sp = SPECS[s], make = sp.conifer ? conifer : broadTree
  const r = rng(s.length * 991 + 7)
  v = { hi: [make(sp, r, 0), make(sp, r, 0)], lo: [make(sp, r, 1), make(sp, r, 1)] }
  pool.set(s, v)
  return v
}

export interface ForestOpts {
  /** Size against the species' natural size. */
  scale?: [number, number]
  /** Solid trunk radius in metres, 0 for trees too far off to reach. */
  solid?: number
  /** Leaf colour tints to pick from. */
  tints?: number[]
}

const CELL = 170
const NEAR = 170
const FAR = 1100

/** Plant trees at these spots, in cells that switch detail with distance. */
export function forest(k: BuildKit, species: Species, spots: THREE.Vector3[], o: ForestOpts = {}): void {
  if (!spots.length) return
  const { d, world: w } = k
  const v = variants(species), sp = SPECS[species]
  const [s0, s1] = o.scale ?? [0.85, 1.25]
  const cells = new Map<string, { mats: THREE.Matrix4[][]; tints: THREE.Color[][]; x: number; z: number; n: number }>()
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
  for (const s of spots) {
    const key = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`
    let c = cells.get(key)
    if (!c) { c = { mats: [[], []], tints: [[], []], x: 0, z: 0, n: 0 }; cells.set(key, c) }
    const sc = s0 + d.rand() * (s1 - s0), which = d.rand() < 0.5 ? 0 : 1
    q.setFromAxisAngle(up, d.rand() * 6.28)
    m4.compose(new THREE.Vector3(s.x, s.y - 0.15, s.z), q, new THREE.Vector3(sc, sc * (0.92 + d.rand() * 0.16), sc))
    c.mats[which]!.push(m4.clone())
    const tint = new THREE.Color(o.tints ? o.tints[Math.floor(d.rand() * o.tints.length)]! : 0xffffff).offsetHSL(0, 0, (d.rand() - 0.5) * 0.08)
    c.tints[which]!.push(tint)
    c.x += s.x; c.z += s.z; c.n++
    if (o.solid !== 0) w.addPost(s.x, s.z, (o.solid ?? sp.trunkR * 1.1) * sc)
  }
  const wood = woodMaterial(sp.bark), leaf = leafMaterial(sp.leaf)
  const groups: { near: THREE.Object3D[]; far: THREE.Object3D[]; x: number; z: number }[] = []
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast: boolean, cols?: THREE.Color[]): THREE.InstancedMesh => {
    const im = d.instanced(geo, mat, mats, cast, cols)
    im.userData['shared'] = true
    im.receiveShadow = false
    return im
  }
  for (const c of cells.values()) {
    const g = { near: [] as THREE.Object3D[], far: [] as THREE.Object3D[], x: c.x / c.n, z: c.z / c.n }
    for (const which of [0, 1]) {
      const mats = c.mats[which]!, cols = c.tints[which]!
      if (!mats.length) continue
      const hi = v.hi[which]!, lo = v.lo[which]!
      g.near.push(add(hi.wood, wood, mats, true))
      g.far.push(add(lo.wood, wood, mats, false))
      if (hi.leaf) g.near.push(add(hi.leaf, leaf, mats, true, cols))
      if (lo.leaf) g.far.push(add(lo.leaf, leaf, mats, false, cols))
    }
    for (const o2 of g.near) o2.visible = false
    groups.push(g)
  }
  let tick = 0
  k.onFrame((f) => {
    if (++tick % 10) return
    const cx = f.camera.position.x, cz = f.camera.position.z
    for (const g of groups) {
      const dist = Math.hypot(g.x - cx, g.z - cz), near = dist < NEAR
      for (const o2 of g.near) o2.visible = near
      // past this the fog has most of them anyway: long laps would draw every tree
      for (const o2 of g.far) o2.visible = !near && dist < FAR
    }
  })
}

// ── Grass ──

let grassTex: THREE.DataTexture | null = null
function grassTexture(): THREE.DataTexture {
  grassTex ??= draw(256, (g, S, r) => {
    for (let q = 0; q < 150; q++) {
      const x = r() * S, lean = (r() - 0.5) * 70, h = S * (0.45 + r() * 0.53), w = 3 + r() * 5
      const v = 150 + r() * 95
      g.fillStyle = `rgb(${v},${v},${v * 0.92})`
      g.beginPath()
      g.moveTo(x - w, S)
      g.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h)
      g.quadraticCurveTo(x + lean * 0.3 + w * 0.5, S - h * 0.5, x + w, S)
      g.fill()
    }
  }, 31)
  return grassTex
}

let tuft: THREE.BufferGeometry | null = null
function tuftGeometry(): THREE.BufferGeometry {
  if (tuft) return tuft
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = []
  for (let c = 0; c < 3; c++) {
    const a = c * 1.05 + 0.3, x = Math.cos(a) * 0.75, z = Math.sin(a) * 0.75, b = pos.length / 3
    pos.push(-x, 0, -z, x, 0, z, x, 1, z, -x, 1, -z)
    uv.push(0, 0, 1, 0, 1, 1, 0, 1)
    for (let q = 0; q < 4; q++) nor.push(0, 1, 0)
    col.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1)
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  tuft = new THREE.BufferGeometry()
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  tuft.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  tuft.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  tuft.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  tuft.setIndex(idx)
  return tuft
}

let grassMat: THREE.MeshStandardMaterial | null = null
function grassMaterial(): THREE.MeshStandardMaterial {
  if (grassMat) return grassMat
  grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true })
  grassMat.onBeforeCompile = (s) => {
    s.uniforms['uT'] = windClock
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 root = instanceMatrix[3].xz;
          float w = sin(uT * 1.8 + root.x * 0.25 + root.y * 0.21) + sin(uT * 3.1 + root.x * 0.7) * 0.4;
          transformed.xz += vec2(w, w * 0.6) * 0.16 * position.y;
        }`)
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
  }
  grassMat.customProgramCacheKey = () => 'kart-grass'
  return grassMat
}

export interface GrassOpts {
  /** Tufts per metre of road, both sides together. */
  density?: number
  /** Furthest from the road edge (m). */
  reach?: number
  height?: [number, number]
  colors: number[]
  test?: (x: number, z: number, y: number) => boolean
}

/** Tufts along both sides of the road, in stretches that fade out behind you. */
export function grass(k: BuildKit, o: GrassOpts): void {
  const { circuit: c, world: w, d } = k
  const per = o.density ?? 3.2, reach = o.reach ?? 24, [h0, h1] = o.height ?? [0.6, 1.25]
  const STRETCH = 45 // samples
  const cols = o.colors.map((x) => new THREE.Color(x))
  const blocks: { m: THREE.InstancedMesh; x: number; z: number }[] = []
  for (let i0 = 0; i0 < c.count; i0 += STRETCH) {
    const mats: THREE.Matrix4[] = [], tint: THREE.Color[] = []
    const n = Math.round(per * STRETCH * 2)
    for (let q = 0; q < n; q++) {
      const i = (i0 + Math.floor(d.rand() * STRETCH)) % c.count
      if (c.raised[i] || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, side = d.rand() < 0.5 ? -1 : 1
      const u = d.rand()
      const off = side * (c.widths[i]! / 2 + 0.5 + u * u * reach)
      const x = p.x + r.x * off, z = p.z + r.z * off
      const y = w.terrainAt(x, z)
      if (y < w.sea + 0.4 || Math.abs(y - p.y) > 30) continue
      if (Math.hypot(w.terrainAt(x + 2.5, z) - y, w.terrainAt(x, z + 2.5) - y) > 1.5) continue // too steep to hold grass
      if (o.test && !o.test(x, z, y)) continue
      if (d.roadGap(x, z) < 0.4) continue
      const s = h0 + d.rand() * (h1 - h0)
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.06, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rand() * 6.28), new THREE.Vector3(s * 1.1, s, s * 1.1))
      mats.push(m)
      tint.push(cols[Math.floor(d.rand() * cols.length)]!.clone().offsetHSL(0, 0, (d.rand() - 0.5) * 0.06))
    }
    if (!mats.length) continue
    const m = d.instanced(tuftGeometry(), grassMaterial(), mats, false, tint)
    m.userData['shared'] = true
    m.receiveShadow = true
    const mid = c.samples[(i0 + 22) % c.count]!
    blocks.push({ m, x: mid.x, z: mid.z })
  }
  let tick = 0
  k.onFrame((f) => {
    if (++tick % 12) return
    const cx = f.camera.position.x, cz = f.camera.position.z
    for (const b of blocks) b.m.visible = Math.hypot(b.x - cx, b.z - cz) < 170
  })
}
