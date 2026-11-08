import * as THREE from 'three'
import { DECKS, type BranchDef, type TrackDef, type TrackPoint } from './types'

const STEP = 2 // metres between samples
const CELL = 14

/**
 * A road: evenly spaced samples with width, banking, rails and flags, plus
 * the lookups the driving needs. It knows nothing about scenery. The main
 * loop is closed; a branch is an open road that leaves the loop and rejoins
 * it further on (a fork, a shortcut).
 */
export class Circuit {
  /** Roads that leave this loop and rejoin it. */
  readonly branches: Circuit[] = []
  /** For a branch: the main-loop samples where it leaves and rejoins, and how keen rivals are on it. */
  join: { from: number; to: number; odds: number; name: string } | null = null
  /** Inside a hill: the ground above stays put. */
  readonly tunnel: boolean[] = []
  /** Glide here: wings out over the drop. */
  readonly glide: boolean[] = []
  /** Item crystals across the road at these samples. */
  readonly items: number[] = []
  readonly samples: THREE.Vector3[] = []
  readonly tangents: THREE.Vector3[] = []
  readonly rights: THREE.Vector3[] = []
  readonly widths: number[] = []
  readonly banks: number[] = []
  /** True where the road stands clear of the ground (nothing is carved to it). */
  readonly raised: boolean[] = []
  readonly railL: boolean[] = []
  readonly railR: boolean[] = []
  /** Open air: the road isn't there. */
  readonly gap: boolean[] = []
  /** Road surface, as an index into DECKS. */
  readonly deck: number[] = []
  pad: boolean[] = []
  padLat: number[] = []
  /** Signed curvature, smoothed. */
  readonly bends: number[] = []
  /** Top speed for each sample (m/s) at a lateral grip of 1. */
  readonly safe: number[] = []
  readonly length: number
  readonly count: number
  readonly maxHalf: number
  private readonly grid = new Map<number, number[]>()

  constructor(def: TrackDef, points?: TrackPoint[], readonly closed = true) {
    const pts = points ?? def.points
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'centripetal')
    curve.arcLengthDivisions = pts.length * 60
    this.length = curve.getLength()
    const n = closed ? Math.round(this.length / STEP) : Math.round(this.length / STEP) + 1
    this.count = n
    const span = closed ? pts.length : pts.length - 1
    /** Index n samples on, wrapping round a loop or held at the ends of a branch. */
    const at = (i: number) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)))
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < n; i++) {
      const u = closed ? i / n : i / (n - 1)
      const p = curve.getPointAt(u)
      const t = curve.getTangentAt(u).normalize()
      this.samples.push(p)
      this.tangents.push(t)
      this.rights.push(new THREE.Vector3().crossVectors(t, up).normalize())
      // the control point span this sample falls in, for its road options
      const f = Math.min(curve.getUtoTmapping(u, 0) * span, span - 1e-6)
      const a = pts[Math.floor(f) % pts.length]!, b = pts[(Math.floor(f) + 1) % pts.length]!
      const k = f - Math.floor(f)
      const wa = a[3]?.w ?? def.width, wb = b[3]?.w ?? def.width
      this.widths.push(wa + (wb - wa) * k)
      const o = k < 0.5 ? a[3] : b[3]
      this.gap.push(!!o?.gap)
      this.glide.push(!!o?.glide)
      this.raised.push(!!o?.raised || !!o?.gap || !!o?.tunnel)
      this.tunnel.push(!!o?.tunnel)
      this.deck.push(DECKS.indexOf(o?.deck ?? def.deck ?? 'asphalt'))
      const rail = (k < 0.5 ? a[3]?.rail : b[3]?.rail) ?? def.rail ?? ''
      this.railL.push(rail.includes('L'))
      this.railR.push(rail.includes('R'))
    }
    // lean into corners, and work out how fast each bend can be taken
    const curv = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const a = this.tangents[at(i - 6)]!, b = this.tangents[at(i + 6)]!
      const turn = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)
      curv[i] = turn / (12 * STEP)
    }
    for (let i = 0; i < n; i++) {
      let c = 0
      for (let k = -8; k <= 8; k++) c += curv[at(i + k)]!
      c /= 17
      const pt = this.spanOf(pts, closed ? i / n : i / (n - 1), curve, span)
      const mb = def.maxBank ?? 0.2
      this.banks.push(THREE.MathUtils.clamp(c * (pt?.bank ?? def.bank ?? 3), -mb, mb))
      this.bends.push(c)
      this.safe.push(Math.min(90, Math.sqrt(25 / Math.max(Math.abs(c), 0.0015))))
    }
    // brake before a bend: slow samples pull the ones before them down
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        if (!closed && i === n - 1) continue
        const next = this.safe[at(i + 1)]!
        this.safe[i] = Math.min(this.safe[i]!, Math.sqrt(next * next + 2 * 26 * STEP))
      }
    }
    // boost strips sit in the sixteen metres after each marked point
    this.pad = new Array<boolean>(n).fill(false)
    this.padLat = new Array<number>(n).fill(0)
    const nearest = (pt: TrackPoint): number => {
      let best = 0, bd = 1e12
      const v = new THREE.Vector3(pt[0], pt[1], pt[2])
      for (let i = 0; i < n; i++) {
        const d = this.samples[i]!.distanceToSquared(v)
        if (d < bd) { bd = d; best = i }
      }
      return best
    }
    for (const pt of pts) {
      if (pt[3]?.items) this.items.push(nearest(pt))
      if (pt[3]?.pad === undefined || pt[3].pad === false) continue
      const lat = pt[3].pad === true ? 0 : pt[3].pad
      const best = nearest(pt)
      for (let k = 0; k < 9; k++) { this.pad[at(best + k)] = true; this.padLat[at(best + k)] = lat }
    }
    // nobody lifts for a jump: slowing down means falling short
    for (let i = 0; i < n; i++) if (this.gap[i]) for (let k = -70; k <= 8; k++) this.safe[at(i + k)] = 90
    this.maxHalf = Math.max(...this.widths) / 2
    const reach = Math.ceil((this.maxHalf + 3) / CELL)
    for (let i = 0; i < n; i++) {
      const p = this.samples[i]!, cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL)
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        const k = (cx + a) * 100003 + cz + b
        const l = this.grid.get(k)
        if (l) l.push(i)
        else this.grid.set(k, [i])
      }
    }
  }

  private spanOf(pts: TrackPoint[], u: number, curve: THREE.CatmullRomCurve3, span: number): TrackPoint[3] {
    return pts[Math.min(span - 1, Math.floor(curve.getUtoTmapping(u, 0) * span)) % pts.length]![3]
  }

  /** The main loop with the track's branches built off it. */
  static withBranches(def: TrackDef): Circuit {
    const main = new Circuit(def)
    for (const b of def.branches ?? []) main.addBranch(def, b)
    return main
  }

  private addBranch(def: TrackDef, b: BranchDef): void {
    const P = def.points
    const pts: TrackPoint[] = [P[b.from]!, ...b.points, P[b.to]!]
    const br = new Circuit(def, pts, false)
    const near = (v: THREE.Vector3) => this.track(v.x, v.z, 0, this.count)
    br.join = { from: near(br.samples[0]!), to: near(br.samples[br.count - 1]!), odds: b.odds ?? 0.5, name: b.name ?? '' }
    this.branches.push(br)
  }

  /** Main-loop sample a branch sample stands for, for lap progress. */
  mainAt(i: number, mainCount: number): number {
    const j = this.join
    if (!j) return i
    const span = (j.to - j.from + mainCount) % mainCount
    return (j.from + Math.round((i / Math.max(1, this.count - 1)) * span)) % mainCount
  }

  /** This loop and every branch off it. */
  get all(): Circuit[] { return [this, ...this.branches] }

  /** Samples whose road could cover this point. */
  near(x: number, z: number): number[] | undefined {
    return this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL))
  }

  /**
   * The road under a point: the highest stretch the car could be on (the
   * nearest, among those at that level), or -1. `lat` is metres right of the centre line.
   */
  roadAt(x: number, z: number, y: number, out: { i: number; lat: number; y: number }, reachUp = 2.6): boolean {
    const list = this.near(x, z)
    out.i = -1
    if (!list) return false
    // among the stretches under the point, the highest one the car could be
    // on (a road that passes over itself, like a spiral, has two), then the nearest
    let best = 1e9, bestY = -1e9
    for (const i of list) {
      if (this.gap[i]) continue
      const p = this.samples[i]!
      const dx = x - p.x, dz = z - p.z
      const d = dx * dx + dz * dz
      if (p.y < bestY - 3) continue
      if (d >= best && p.y < bestY + 3) continue
      const r = this.rights[i]!
      const lat = dx * r.x + dz * r.z
      const half = this.widths[i]! / 2
      if (Math.abs(lat) > half) continue
      // past the end of the road (a gap's edge): the road stops here, it
      // doesn't carry on through the air to the nearest sample over the gap
      const t = this.tangents[i]!, th = Math.hypot(t.x, t.z) || 1
      if (Math.abs((dx * t.x + dz * t.z) / th) > 2.6) continue
      const ry = p.y + lat * Math.tan(this.banks[i]!)
      // at the far edge of a gap, a car that comes in low hits the edge: it
      // can't step up onto the road the way it would climbing a slope
      const edge = this.gap[i - 1] || this.gap[i - 2] || this.gap[i + 1] || this.gap[i + 2]
      if (ry > y + (edge ? 0.5 : reachUp)) continue
      best = d
      bestY = p.y
      out.i = i
      out.lat = lat
      out.y = ry
    }
    return out.i >= 0
  }

  /** Nearest sample to a point, searching a window round `from`. */
  /**
   * Nearest sample to a point, searching a window round `from`. With a
   * height, roads stacked or laid one above another on a slope (hairpins)
   * are told apart by how far up or down they are, not just across.
   */
  track(x: number, z: number, from: number, window = 90, y?: number): number {
    const n = this.count
    const dist = (p: THREE.Vector3) => (p.x - x) ** 2 + (p.z - z) ** 2 + (y === undefined ? 0 : (Math.max(0, Math.abs(p.y - y) - 1.5) * 3) ** 2)
    if (!this.closed) {
      let best = 0, bd = 1e12
      for (let i = 0; i < n; i++) {
        const d = dist(this.samples[i]!)
        if (d < bd) { bd = d; best = i }
      }
      return best
    }
    let best = from, bd = 1e12
    for (let k = -window; k <= window; k += 2) {
      const i = (from + k + n) % n
      const d = dist(this.samples[i]!)
      if (d < bd) { bd = d; best = i }
    }
    for (let k = -2; k <= 2; k++) {
      const i = (best + k + n) % n
      const d = dist(this.samples[i]!)
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  /** Grid slot behind the line: `slot` 0 is pole, two abreast. */
  gridSpot(slot: number): { pos: THREE.Vector3; yaw: number; i: number } {
    const n = this.count
    const i = (n - 8 - Math.floor(slot / 2) * 4 - (slot % 2) * 2 + n) % n
    const p = this.samples[i]!, r = this.rights[i]!, t = this.tangents[i]!
    const side = slot % 2 ? 1 : -1
    const pos = p.clone().addScaledVector(r, side * 3.2)
    return { pos, yaw: Math.atan2(-t.x, -t.z), i }
  }
}
