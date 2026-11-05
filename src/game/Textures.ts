import * as THREE from 'three'

/**
 * Procedural PBR texture sets (color + normal + roughness) generated on a
 * canvas at startup, so the game has real surface detail without shipping
 * any image files. Every set can be overridden by dropping real photo-scanned
 * textures into `public/textures/<folder>/` (color.jpg, normal.jpg,
 * roughness.jpg) — see applyTextureOverrides().
 */
export interface PbrSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

let maxAnisotropy = 8

/** Called once by Game with the renderer's real limit (sharp road at grazing angles). */
/** Resolves once the UI web fonts used on in-world signs are loaded (or failed). */
let fontsPromise: Promise<unknown> | null = null
export function signFontsReady(): Promise<unknown> {
  fontsPromise ??= Promise.all(
    ['700 40px Rajdhani', '600 40px Rajdhani', 'italic 800 40px "Barlow Condensed"', 'italic 700 40px "Barlow Condensed"'].map((f) =>
      document.fonts.load(f).catch(() => null),
    ),
  )
  return fontsPromise
}

export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = Math.max(1, n)
}

// ── Tileable value noise ──────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One octave of wrap-around value noise, `period` lattice cells across `size` px. */
function noiseOctave(size: number, period: number, rand: () => number): Float32Array {
  const grid = new Float32Array(period * period)
  for (let i = 0; i < grid.length; i++) grid[i] = rand()
  const out = new Float32Array(size * size)
  const cell = size / period
  for (let y = 0; y < size; y++) {
    const gy = y / cell
    const y0 = Math.floor(gy) % period
    const y1 = (y0 + 1) % period
    let ty = gy - Math.floor(gy)
    ty = ty * ty * (3 - 2 * ty)
    for (let x = 0; x < size; x++) {
      const gx = x / cell
      const x0 = Math.floor(gx) % period
      const x1 = (x0 + 1) % period
      let tx = gx - Math.floor(gx)
      tx = tx * tx * (3 - 2 * tx)
      const a = grid[y0 * period + x0]!
      const b = grid[y0 * period + x1]!
      const c = grid[y1 * period + x0]!
      const d = grid[y1 * period + x1]!
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
    }
  }
  return out
}

/** Fractal sum of octaves, normalised to 0–1. */
function fbm(size: number, periods: number[], weights: number[], seed: number): Float32Array {
  const rand = mulberry32(seed)
  const out = new Float32Array(size * size)
  let total = 0
  periods.forEach((p, i) => {
    const w = weights[i]!
    total += w
    const o = noiseOctave(size, p, rand)
    for (let k = 0; k < out.length; k++) out[k]! += o[k]! * w
  })
  for (let k = 0; k < out.length; k++) out[k]! /= total
  return out
}

// ── Canvas → texture helpers ──────────────────────────────────────────

function toTexture(
  size: number,
  fill: (data: Uint8ClampedArray) => void,
  isColor: boolean
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  fill(img.data)
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = maxAnisotropy
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Tangent-space (OpenGL convention) normal map from a wrap-around height field. */
function normalFromHeight(size: number, h: Float32Array, strength: number): THREE.CanvasTexture {
  return toTexture(size, (d) => {
    for (let y = 0; y < size; y++) {
      const yu = ((y - 1 + size) % size) * size
      const yd = ((y + 1) % size) * size
      for (let x = 0; x < size; x++) {
        const xl = (x - 1 + size) % size
        const xr = (x + 1) % size
        const dx = (h[y * size + xr]! - h[y * size + xl]!) * strength
        const dy = (h[yd + x]! - h[yu + x]!) * strength
        const len = Math.sqrt(dx * dx + dy * dy + 1)
        const i = (y * size + x) * 4
        d[i] = ((-dx / len) * 0.5 + 0.5) * 255
        d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
        d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
        d[i + 3] = 255
      }
    }
  }, false)
}

const cache = new Map<string, PbrSet>()

/** Fine-grained asphalt: dark binder, light aggregate stones, small pits. */
export function asphaltSet(): PbrSet {
  const hit = cache.get('asphalt')
  if (hit) return hit
  const S = 512
  const base = fbm(S, [8, 32, 64, 128], [0.35, 0.3, 0.2, 0.15], 11)
  const grit = fbm(S, [256], [1], 23)
  const rand = mulberry32(7)
  const stone = new Float32Array(S * S)
  for (let k = 0; k < stone.length; k++) {
    const r = rand()
    stone[k] = r > 0.93 ? 0.5 + (r - 0.93) * 7 : r < 0.025 ? -0.6 : 0
  }
  const height = new Float32Array(S * S)
  for (let k = 0; k < height.length; k++) height[k] = base[k]! * 0.6 + grit[k]! * 0.4 + stone[k]! * 0.35

  const map = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      let v = 52 + (base[k]! - 0.5) * 26 + (grit[k]! - 0.5) * 22
      if (stone[k]! > 0) v += 28 + stone[k]! * 30
      if (stone[k]! < 0) v -= 16
      d[k * 4] = v + 2
      d[k * 4 + 1] = v + 1
      d[k * 4 + 2] = v
      d[k * 4 + 3] = 255
    }
  }, true)
  const roughnessMap = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      const v = (0.82 + (grit[k]! - 0.5) * 0.14 - (stone[k]! > 0 ? 0.12 : 0)) * 255
      d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v
      d[k * 4 + 3] = 255
    }
  }, false)
  const set = { map, normalMap: normalFromHeight(S, height, 3.2), roughnessMap }
  cache.set('asphalt', set)
  return set
}

/** Dry grass / dirt mix for the open land under and around the track. */
export function groundSet(): PbrSet {
  const hit = cache.get('ground')
  if (hit) return hit
  const S = 512
  const patches = fbm(S, [4, 8, 16], [0.5, 0.3, 0.2], 31)
  const detail = fbm(S, [64, 128, 256], [0.4, 0.35, 0.25], 47)
  const dirt = [112, 96, 72]
  const dry = [128, 122, 78]
  const green = [78, 94, 50]

  const map = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      const p = patches[k]!
      const t1 = THREE.MathUtils.smoothstep(p, 0.35, 0.55)
      const t2 = THREE.MathUtils.smoothstep(p, 0.55, 0.75)
      const shade = 0.82 + (detail[k]! - 0.5) * 0.5
      for (let c = 0; c < 3; c++) {
        const v = dirt[c]! + (dry[c]! - dirt[c]!) * t1 + (green[c]! - dry[c]!) * t2
        d[k * 4 + c] = v * shade
      }
      d[k * 4 + 3] = 255
    }
  }, true)
  const roughnessMap = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      const v = (0.9 + (detail[k]! - 0.5) * 0.1) * 255
      d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v
      d[k * 4 + 3] = 255
    }
  }, false)
  const set = { map, normalMap: normalFromHeight(S, detail, 6), roughnessMap }
  cache.set('ground', set)
  return set
}

/** Weathered rock / concrete for cliffs, embankments and supports. */
export function rockSet(): PbrSet {
  const hit = cache.get('rock')
  if (hit) return hit
  const S = 256
  const h = fbm(S, [4, 8, 16, 32, 64], [0.3, 0.25, 0.2, 0.15, 0.1], 59)
  const map = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      const v = 0.75 + (h[k]! - 0.5) * 0.7
      d[k * 4] = 255 * v
      d[k * 4 + 1] = 250 * v
      d[k * 4 + 2] = 242 * v
      d[k * 4 + 3] = 255
    }
  }, true)
  const roughnessMap = toTexture(S, (d) => {
    for (let k = 0; k < S * S; k++) {
      const v = (0.88 + (h[k]! - 0.5) * 0.15) * 255
      d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v
      d[k * 4 + 3] = 255
    }
  }, false)
  const set = { map, normalMap: normalFromHeight(S, h, 5), roughnessMap }
  cache.set('rock', set)
  return set
}

/** Clone a set with its own tiling (textures share the same canvas image). */
export function tiled(set: PbrSet, repeatX: number, repeatY: number): PbrSet {
  const t = (src: THREE.Texture) => {
    const c = src.clone()
    c.repeat.set(repeatX, repeatY)
    c.needsUpdate = true
    return c
  }
  return { map: t(set.map), normalMap: t(set.normalMap), roughnessMap: t(set.roughnessMap) }
}

const BASE = import.meta.env.BASE_URL
const loader = new THREE.TextureLoader()

/** A Poly Haven photo material from public/textures/biomes (colour + normal). */
export function photoSet(name: string, repeatX = 1, repeatY = repeatX): { map: THREE.Texture; normalMap: THREE.Texture } {
  const load = (suffix: string, srgb: boolean) => {
    const t = loader.load(`${BASE}textures/biomes/${name}_${suffix}.jpg`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeatX, repeatY)
    t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return { map: load('diff', true), normalMap: load('nor', false) }
}

/**
 * Swap in real photo textures if the player dropped them in
 * `public/textures/<folder>/{color,normal,roughness}.jpg`. Missing files are
 * silently ignored, so the procedural set stays. Tiling, wrapping and
 * anisotropy are copied from the procedural texture being replaced.
 */
export function applyTextureOverrides(mat: THREE.MeshStandardMaterial, folder: string): void {
  const slots: [keyof PbrSet, string, boolean][] = [
    ['map', 'color.jpg', true],
    ['normalMap', 'normal.jpg', false],
    ['roughnessMap', 'roughness.jpg', false],
  ]
  for (const [slot, file, isColor] of slots) {
    loader.load(
      `${BASE}textures/${folder}/${file}`,
      (tex) => {
        const prev = mat[slot]
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        tex.anisotropy = maxAnisotropy
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace
        if (prev) {
          tex.repeat.copy(prev.repeat)
          tex.offset.copy(prev.offset)
        }
        mat[slot] = tex
        mat.needsUpdate = true
      },
      undefined,
      () => { /* not provided — keep the procedural texture */ }
    )
  }
}
