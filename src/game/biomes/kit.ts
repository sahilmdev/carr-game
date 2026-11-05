import * as THREE from 'three'
import type { Track, ZoneName } from '../Track'

/** Shared helpers for the biome builders: noise, road queries, textures. */

export const UP = new THREE.Vector3(0, 1, 0)

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 2D value noise ──────────────────────────────────────────────────────
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z)
  let fx = x - ix, fz = z - iz
  fx = fx * fx * (3 - 2 * fx)
  fz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1)
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}
export function fbm2(x: number, z: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1, norm = 0
  for (let k = 0; k < oct; k++) {
    v += amp * noise2(x * f + k * 17.3, z * f - k * 9.1)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return v / norm
}
/** Ridged multifractal: sharp crests (mountain ridges, dune crests). */
export function ridged2(x: number, z: number, oct = 5): number {
  let v = 0, amp = 0.5, f = 1, norm = 0
  for (let k = 0; k < oct; k++) {
    const n = 1 - Math.abs(noise2(x * f + k * 31.7, z * f + k * 5.3) * 2 - 1)
    v += amp * n * n
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return v / norm
}
export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// ── Track helpers ───────────────────────────────────────────────────────
export function zoneIndices(track: Track, ...zones: ZoneName[]): number[] {
  const out: number[] = []
  const set = new Set(zones)
  for (let i = 0; i < track.sampleCount; i++) if (set.has(track.zoneOfSample(i))) out.push(i)
  return out
}

export function rightAt(track: Track, i: number): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(track.tangents[i]!, UP).normalize()
}

/**
 * Spatial hash of road samples for fast "how close is the road" queries
 * (horizontal distance). Gap samples (jumps, loops) are left out unless
 * asked for.
 */
export class RoadIndex {
  private readonly cells = new Map<number, number[]>()
  constructor(private readonly track: Track, private readonly cell = 24, includeGaps = false) {
    for (let i = 0; i < track.sampleCount; i++) {
      if (!includeGaps && track.isGap(i)) continue
      const p = track.samples[i]!
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.z / cell))
      let arr = this.cells.get(k)
      if (!arr) this.cells.set(k, (arr = []))
      arr.push(i)
    }
  }
  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096)
  }
  /** Nearest sample within `maxR` (or -1), and its horizontal distance. */
  nearest(x: number, z: number, maxR: number, filter?: (i: number) => boolean): { i: number; d: number } {
    const c = this.cell
    const r = Math.ceil(maxR / c)
    const cx = Math.floor(x / c), cz = Math.floor(z / c)
    let best = -1, bd = maxR * maxR
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const arr = this.cells.get(this.key(cx + a, cz + b))
        if (!arr) continue
        for (const i of arr) {
          if (filter && !filter(i)) continue
          const p = this.track.samples[i]!
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)
          if (d < bd) { bd = d; best = i }
        }
      }
    }
    return { i: best, d: Math.sqrt(bd) }
  }
  /** True when (x, z) is within `r` of any road sample (± a height band). */
  near(x: number, z: number, r: number, y?: number, band = 30): boolean {
    const c = this.cell
    const k = Math.ceil(r / c)
    const cx = Math.floor(x / c), cz = Math.floor(z / c)
    const r2 = r * r
    for (let a = -k; a <= k; a++) {
      for (let b = -k; b <= k; b++) {
        const arr = this.cells.get(this.key(cx + a, cz + b))
        if (!arr) continue
        for (const i of arr) {
          const p = this.track.samples[i]!
          if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r2 && (y === undefined || Math.abs(p.y - y) < band)) return true
        }
      }
    }
    return false
  }
}

/**
 * Coarse grid of distance-to-zone (horizontal), bilinear sampled. Used to
 * weight each biome's terrain field by how close it is to its own road.
 */
export class ZoneDistance {
  private readonly data: Float32Array
  private readonly nx: number
  private readonly nz: number
  constructor(track: Track, zones: ZoneName[], private readonly x0: number, private readonly z0: number, x1: number, z1: number, private readonly cell = 10) {
    this.nx = Math.ceil((x1 - x0) / cell) + 1
    this.nz = Math.ceil((z1 - z0) / cell) + 1
    this.data = new Float32Array(this.nx * this.nz).fill(1e5)
    const pts = zoneIndices(track, ...zones).filter((_, k) => k % 4 === 0).map((i) => track.samples[i]!)
    for (let j = 0; j < this.nz; j++) {
      const z = z0 + j * cell
      for (let i = 0; i < this.nx; i++) {
        const x = x0 + i * cell
        let best = 1e10
        for (const p of pts) {
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)
          if (d < best) best = d
        }
        this.data[j * this.nx + i] = Math.sqrt(best)
      }
    }
  }
  at(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)))
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)))
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j))
    const d = this.data
    const a = d[j * this.nx + i]!, b = d[j * this.nx + i + 1]!
    const c = d[(j + 1) * this.nx + i]!, e = d[(j + 1) * this.nx + i + 1]!
    return lerp(lerp(a, b, tx), lerp(c, e, tx), tz)
  }
}

// ── Textures ────────────────────────────────────────────────────────────
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Instanced mesh from a list of matrices (shadow flags on). */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], cast = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length))
  mats.forEach((x, k) => m.setMatrixAt(k, x))
  if (colors) colors.forEach((c, k) => m.setColorAt(k, c))
  m.count = mats.length
  m.castShadow = cast
  m.receiveShadow = true
  m.computeBoundingSphere()
  return m
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
export function trs(x: number, y: number, z: number, ry = 0, s: number | THREE.Vector3 = 1, rx = 0, rz = 0): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'))
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, sc)
}

/** Displace a geometry's vertices along their normals by fbm noise. */
export function lumpy(geo: THREE.BufferGeometry, amount: number, freq: number, seed = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const merged = mergeVerts(g)
  const pos = merged.getAttribute('position') as THREE.BufferAttribute
  merged.computeVertexNormals()
  const nrm = merged.getAttribute('normal') as THREE.BufferAttribute
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
    const n = (fbm2(x * freq + seed, z * freq + y * freq * 0.7 - seed, 3) - 0.5) * 2 * amount
    pos.setXYZ(k, x + nrm.getX(k) * n, y + nrm.getY(k) * n, z + nrm.getZ(k) * n)
  }
  merged.computeVertexNormals()
  return merged
}

/** Weld identical positions so displacement keeps the surface closed. */
function mergeVerts(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const map = new Map<string, number>()
  const verts: number[] = []
  const index: number[] = []
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    let id = map.get(key)
    if (id === undefined) {
      id = verts.length / 3
      map.set(key, id)
      verts.push(x, y, z)
    }
    index.push(id)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  out.setIndex(index)
  return out
}

/** Tag a group as belonging to a biome (Scenery's neighbour culling). */
export function biomeGroup(name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = name
  g.userData['biome'] = name
  return g
}

/** Soft round sprite (white, alpha falloff) for smoke, glow and particles. */
let _soft: THREE.CanvasTexture | null = null
export function softDot(): THREE.CanvasTexture {
  _soft ??= canvasTexture(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, w)
  })
  return _soft
}

/** Billowy smoke puff sprite (noisy alpha). */
let _puff: THREE.CanvasTexture | null = null
export function puffTexture(): THREE.CanvasTexture {
  _puff ??= canvasTexture(128, 128, (g, w) => {
    for (let k = 0; k < 26; k++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.45
      const y = w / 2 + (Math.random() - 0.5) * w * 0.45
      const r = w * (0.12 + Math.random() * 0.2)
      const gr = g.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, 'rgba(255,255,255,0.32)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, w)
    }
  })
  return _puff
}

/** A post-mounted road sign with text drawn in the game's display font. */
export function roadSign(lines: string[], bg: string, fg: string, w = 3.2, h = 1.6, postH = 2.4): THREE.Group {
  const tex = canvasTexture(512, Math.round(512 * (h / w)), (g, W, H) => {
    g.fillStyle = bg
    g.fillRect(0, 0, W, H)
    g.strokeStyle = fg
    g.lineWidth = W * 0.025
    g.strokeRect(W * 0.03, W * 0.03, W - W * 0.06, H - W * 0.06)
    g.fillStyle = fg
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const lh = (H * 0.78) / lines.length
    lines.forEach((t, k) => {
      g.font = `700 ${Math.round(lh * (k === 0 ? 0.78 : 0.6))}px Rajdhani, Arial, sans-serif`
      g.fillText(t, W / 2, H * 0.11 + lh * (k + 0.5))
    })
  })
  const grp = new THREE.Group()
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
    new THREE.MeshStandardMaterial({ color: 0x777777 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x8a8f93, metalness: 0.6, roughness: 0.5 }),
  ])
  board.position.y = postH + h / 2
  board.castShadow = true
  grp.add(board)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.7, roughness: 0.4 })
  for (const sx of [-w * 0.3, w * 0.3]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, postH + h * 0.8, 8), postMat)
    post.position.set(sx, (postH + h * 0.8) / 2, -0.08)
    post.castShadow = true
    grp.add(post)
  }
  return grp
}

/** Place `obj` beside the road at sample i, `off` metres to the right, facing traffic. */
export function besideRoad(track: Track, i: number, off: number, obj: THREE.Object3D, y?: number): THREE.Object3D {
  const p = track.samples[i]!, t = track.tangents[i]!
  const r = rightAt(track, i)
  obj.position.set(p.x + r.x * off, y ?? p.y, p.z + r.z * off)
  obj.rotation.y = Math.atan2(-t.x, -t.z) // +Z face looks back at oncoming cars
  return obj
}

export interface ScatterOpts {
  /** lateral distance from the road centre line (m) */
  minOff: number
  maxOff: number
  /** keep this far from any road sample */
  clear?: number
  /** ground height lookup (defaults to the road height) */
  ground?: (x: number, z: number) => number
  /** surface normal for the slope test */
  normal?: (x: number, z: number) => THREE.Vector3
  maxSlope?: number
  minY?: number
  /** extra rejection test */
  reject?: (x: number, z: number, y: number) => boolean
  jitter?: number
}

/** Random spots beside the road samples `ids`, clear of every road. */
export function scatter(track: Track, ids: number[], road: RoadIndex, count: number, rand: () => number, o: ScatterOpts): [number, number, number][] {
  const out: [number, number, number][] = []
  const clear = o.clear ?? track.width / 2 + 3
  for (let k = 0; k < count * 8 && out.length < count; k++) {
    const i = ids[Math.floor(rand() * ids.length)]!
    const p = track.samples[i]!, r = rightAt(track, i)
    const off = (rand() < 0.5 ? -1 : 1) * (o.minOff + Math.pow(rand(), 1.4) * (o.maxOff - o.minOff))
    const j = o.jitter ?? 8
    const x = p.x + r.x * off + (rand() - 0.5) * j, z = p.z + r.z * off + (rand() - 0.5) * j
    if (road.near(x, z, clear)) continue
    const y = o.ground ? o.ground(x, z) : p.y
    if (o.minY !== undefined && y < o.minY) continue
    if (o.normal && o.maxSlope !== undefined && o.normal(x, z).y < Math.cos(o.maxSlope)) continue
    if (o.reject?.(x, z, y)) continue
    out.push([x, y, z])
  }
  return out
}
