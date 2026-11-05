import * as THREE from 'three'
import type { Track, ZoneName } from '../Track'

/**
 * Per-biome atmosphere: fog, a sky tint, light scaling, exposure, bloom and
 * ambient particles. Profiles are blended per track sample (smoothed over
 * ~140 samples) so the air changes gradually as you drive between biomes.
 */
export interface MoodProfile {
  fog: [number, number, number]
  fogDensity: number
  skyTop: [number, number, number]
  skyHorizon: [number, number, number]
  skyMix: number
  sun: number
  hemi: number
  hemiTint: [number, number, number]
  exposure: number
  bloom: number
  env: number
  stars: number
  aurora: number
  /** dims with the time of day (false for the always-night city) */
  dayLit: boolean
  particles: Partial<Record<ParticleKind, number>>
}

export type ParticleKind = 'ash' | 'embers' | 'snow' | 'sand' | 'pollen'
export const PARTICLE_KINDS: ParticleKind[] = ['ash', 'embers', 'snow', 'sand', 'pollen']

const P = (o: Partial<MoodProfile> & Pick<MoodProfile, 'fog' | 'fogDensity' | 'skyTop' | 'skyHorizon' | 'skyMix'>): MoodProfile => ({
  sun: 1, hemi: 1, hemiTint: [1, 1, 1], exposure: 1, bloom: 0, env: 1, stars: 0, aurora: 0, dayLit: true, particles: {}, ...o,
})

export const MOODS: Record<string, MoodProfile> = {
  volcano: P({
    fog: [0.3, 0.17, 0.11], fogDensity: 0.0042, skyTop: [0.09, 0.065, 0.06], skyHorizon: [0.5, 0.24, 0.12], skyMix: 0.96,
    sun: 0.55, hemi: 0.75, hemiTint: [0.95, 0.82, 0.74], exposure: 1.05, bloom: 0.12, env: 0.45, particles: { ash: 1, embers: 0.8 },
  }),
  desert: P({
    fog: [0.86, 0.74, 0.58], fogDensity: 0.0013, skyTop: [0.32, 0.52, 0.85], skyHorizon: [0.92, 0.82, 0.64], skyMix: 0.35,
    sun: 1.15, hemiTint: [1, 0.95, 0.85], particles: { sand: 0.25 },
  }),
  sandstorm: P({
    fog: [0.74, 0.56, 0.36], fogDensity: 0.016, skyTop: [0.6, 0.48, 0.34], skyHorizon: [0.78, 0.6, 0.4], skyMix: 0.96,
    sun: 0.45, hemi: 0.9, hemiTint: [1, 0.85, 0.65], env: 0.6, particles: { sand: 1 },
  }),
  saltflat: P({
    fog: [0.86, 0.89, 0.93], fogDensity: 0.0009, skyTop: [0.22, 0.48, 0.9], skyHorizon: [0.94, 0.95, 0.97], skyMix: 0.3,
    sun: 1.2, exposure: 0.95,
  }),
  snow: P({
    fog: [0.82, 0.87, 0.94], fogDensity: 0.0026, skyTop: [0.5, 0.6, 0.76], skyHorizon: [0.88, 0.91, 0.95], skyMix: 0.7,
    sun: 0.85, hemi: 1.15, hemiTint: [0.86, 0.93, 1.05], aurora: 1, particles: { snow: 1 },
  }),
  sky: P({
    fog: [0.66, 0.77, 0.93], fogDensity: 0.0006, skyTop: [0.08, 0.26, 0.7], skyHorizon: [0.78, 0.85, 0.96], skyMix: 0.6,
    sun: 1.05, hemi: 1.0, exposure: 0.9, aurora: 0.6,
  }),
  jungle: P({
    fog: [0.42, 0.52, 0.42], fogDensity: 0.0045, skyTop: [0.38, 0.52, 0.58], skyHorizon: [0.6, 0.68, 0.6], skyMix: 0.4,
    sun: 0.75, hemi: 0.85, hemiTint: [0.8, 1, 0.75], particles: { pollen: 1 },
  }),
  city: P({
    fog: [0.05, 0.04, 0.09], fogDensity: 0.0032, skyTop: [0.008, 0.006, 0.025], skyHorizon: [0.15, 0.05, 0.2], skyMix: 1,
    sun: 0.05, hemi: 0.32, hemiTint: [0.6, 0.55, 1], exposure: 1.25, bloom: 0.16, env: 0.2, stars: 0.7, dayLit: false,
  }),
}
const KEYS = Object.keys(MOODS)

export class MoodTable {
  /** weights[i * M + m] — share of mood m at sample i */
  private readonly weights: Float32Array
  private readonly M = KEYS.length
  constructor(track: Track, keyOf: (i: number, zone: ZoneName) => string | null) {
    const n = track.sampleCount
    const raw = new Int8Array(n).fill(-1)
    for (let i = 0; i < n; i++) {
      const k = keyOf(i, track.zoneOfSample(i))
      raw[i] = k ? KEYS.indexOf(k) : -1
    }
    const W = 70
    this.weights = new Float32Array(n * this.M)
    const acc = new Float32Array(this.M)
    // running box filter (wraps round the lap)
    for (let o = -W; o <= W; o++) { const r = raw[(o + n) % n]!; if (r >= 0) acc[r]!++ }
    for (let i = 0; i < n; i++) {
      for (let m = 0; m < this.M; m++) this.weights[i * this.M + m] = acc[m]! / (2 * W + 1)
      const out = raw[(i - W + n) % n]!, inn = raw[(i + W + 1) % n]!
      if (out >= 0) acc[out]!--
      if (inn >= 0) acc[inn]!++
    }
  }

  /** Blended profile at sample i; returns the total mood weight (0 = plain). */
  sample(i: number, out: BlendedMood): number {
    const base = i * this.M
    out.reset()
    let total = 0
    for (let m = 0; m < this.M; m++) {
      const w = this.weights[base + m]!
      if (w < 1e-4) continue
      total += w
      out.add(MOODS[KEYS[m]!]!, w)
    }
    if (total > 0) out.normalize(total)
    out.weight = Math.min(1, total)
    return out.weight
  }
}

export class BlendedMood {
  weight = 0
  fog = new THREE.Color()
  fogDensity = 0
  skyTop = new THREE.Color()
  skyHorizon = new THREE.Color()
  skyMix = 0
  sun = 1
  hemi = 1
  hemiTint = new THREE.Color(1, 1, 1)
  exposure = 1
  bloom = 0
  env = 1
  stars = 0
  aurora = 0
  dayLit = 1
  particles: Record<ParticleKind, number> = { ash: 0, embers: 0, snow: 0, sand: 0, pollen: 0 }

  reset(): void {
    this.fog.setRGB(0, 0, 0); this.skyTop.setRGB(0, 0, 0); this.skyHorizon.setRGB(0, 0, 0); this.hemiTint.setRGB(0, 0, 0)
    this.fogDensity = this.skyMix = this.sun = this.hemi = this.exposure = this.bloom = this.env = this.stars = this.aurora = this.dayLit = 0
    for (const k of PARTICLE_KINDS) this.particles[k] = 0
  }
  add(p: MoodProfile, w: number): void {
    this.fog.r += p.fog[0] * w; this.fog.g += p.fog[1] * w; this.fog.b += p.fog[2] * w
    this.skyTop.r += p.skyTop[0] * w; this.skyTop.g += p.skyTop[1] * w; this.skyTop.b += p.skyTop[2] * w
    this.skyHorizon.r += p.skyHorizon[0] * w; this.skyHorizon.g += p.skyHorizon[1] * w; this.skyHorizon.b += p.skyHorizon[2] * w
    this.hemiTint.r += p.hemiTint[0] * w; this.hemiTint.g += p.hemiTint[1] * w; this.hemiTint.b += p.hemiTint[2] * w
    this.fogDensity += p.fogDensity * w
    this.skyMix += p.skyMix * w
    this.sun += p.sun * w
    this.hemi += p.hemi * w
    this.exposure += p.exposure * w
    this.bloom += p.bloom * w
    this.env += p.env * w
    this.stars += p.stars * w
    this.aurora += p.aurora * w
    this.dayLit += (p.dayLit ? 1 : 0) * w
    for (const k of PARTICLE_KINDS) this.particles[k] += (p.particles[k] ?? 0) * w
  }
  normalize(t: number): void {
    const s = 1 / t
    this.fog.multiplyScalar(s); this.skyTop.multiplyScalar(s); this.skyHorizon.multiplyScalar(s); this.hemiTint.multiplyScalar(s)
    this.fogDensity *= s; this.skyMix *= s; this.sun *= s; this.hemi *= s; this.exposure *= s
    this.bloom *= s; this.env *= s; this.stars *= s; this.aurora *= s; this.dayLit *= s
    // particles are a presence, not a mix: keep them scaled by the total weight
    for (const k of PARTICLE_KINDS) this.particles[k] *= s * Math.min(1, t)
  }
}
