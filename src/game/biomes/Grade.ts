import type { Track, ZoneName } from '../Track'

/**
 * Per-area colour grade (like a film grade per scene): saturation,
 * contrast, a shadow tint (lift), a highlight tint (gain) and vignette.
 * Blended per track sample over ~160 samples so areas melt into each other.
 */
export interface GradeProfile {
  sat: number
  con: number
  lift: [number, number, number]
  gain: [number, number, number]
  vig: number
}

const G = (sat: number, con: number, lift: [number, number, number], gain: [number, number, number], vig: number): GradeProfile => ({ sat: sat + 0.14, con: con + 0.04, lift, gain, vig: vig + 0.06 })

const COAST = G(1.12, 1.06, [0.02, 0.0, 0.04], [1.06, 0.99, 0.9], 0.28)
const UNDER = G(1.15, 1.05, [0.0, 0.03, 0.05], [0.9, 1.02, 1.06], 0.36)
const SPACE = G(1.04, 1.12, [0.01, 0.0, 0.03], [0.98, 1.0, 1.06], 0.4)
const CANYON = G(1.12, 1.08, [0.03, 0.01, 0.0], [1.08, 0.98, 0.88], 0.3)
const SKY = G(1.1, 1.0, [0.02, 0.01, 0.04], [1.02, 1.0, 1.04], 0.2)

export const GRADES: Record<ZoneName, GradeProfile> = {
  town: COAST, coast: COAST, causeway: COAST,
  underwater: UNDER, rampUp: UNDER,
  flight1: SPACE, space: SPACE, flight2: SPACE,
  canyon: CANYON, loop: CANYON,
  volcano: G(1.1, 1.12, [0.04, 0.0, 0.0], [1.1, 0.95, 0.85], 0.4),
  desert: G(1.08, 1.05, [0.02, 0.01, 0.0], [1.06, 1.0, 0.9], 0.26),
  saltflat: G(1.04, 1.03, [0.0, 0.01, 0.02], [1.04, 1.02, 0.98], 0.22),
  snow: G(0.96, 1.05, [0.0, 0.01, 0.03], [0.96, 1.0, 1.06], 0.25),
  sky: SKY, roll: SKY, flight3: SKY,
  jungle: G(1.15, 1.06, [0.0, 0.02, 0.01], [1.0, 1.04, 0.94], 0.32),
  city: G(1.25, 1.1, [0.03, 0.0, 0.06], [1.04, 0.96, 1.08], 0.4),
}

/** 11 floats per sample: sat, con, lift rgb, gain rgb, vig, pad, pad */
export class GradeTable {
  private readonly data: Float32Array
  constructor(track: Track) {
    const n = track.sampleCount
    const raw = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) {
      const g = GRADES[track.zoneOfSample(i)]
      raw.set([g.sat, g.con, ...g.lift, ...g.gain, g.vig], i * 9)
    }
    const W = 80
    this.data = new Float32Array(n * 9)
    const acc = new Float64Array(9)
    for (let o = -W; o <= W; o++) for (let c = 0; c < 9; c++) acc[c]! += raw[((o + n) % n) * 9 + c]!
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 9; c++) this.data[i * 9 + c] = acc[c]! / (2 * W + 1)
      const out = ((i - W) % n + n) % n, inn = (i + W + 1) % n
      for (let c = 0; c < 9; c++) acc[c]! += raw[inn * 9 + c]! - raw[out * 9 + c]!
    }
  }

  /** Write the grade at sample i into `out` (length 9). */
  sample(i: number, out: Float32Array): void {
    out.set(this.data.subarray(i * 9, i * 9 + 9))
  }
}
