import * as THREE from 'three'
import type { Circuit } from './Circuit'
import type { Surface, TrackDef } from './types'

const CELL = 5
const HASH = 16

export interface Solid {
  x: number
  z: number
  /** Radius, or half-size when it is a box. */
  r: number
  hx?: number
  hz?: number
  cos?: number
  sin?: number
  /** Only blocks cars lower than this. */
  top: number
  /** And only cars higher than this (a wall standing over a cellar). */
  floor?: number
  /** Springy (a bumper car, a padded wall): knocks you away at this many metres per second. */
  bounce?: number
}

export interface Breakable {
  x: number
  z: number
  y: number
  r: number
  live: boolean
  hit?: () => void
}

export interface Hit { nx: number; nz: number; depth: number; bounce?: number }

/**
 * A force in the world: a current, a gust, a vent, a swirl, a rut. A circle
 * of radius `r` (or a turned box when `hx` is set) between heights `y0` and
 * `y1`. Anything inside is pushed at (`vx`, `vz`) metres per second, swirled
 * round the centre at `swirl` and drawn in at `pull`, steered towards `yaw`
 * by `grab`, or thrown upward at `lift`. Track code moves them and turns them
 * on and off.
 */
export interface Zone {
  x: number
  z: number
  r: number
  hx?: number
  hz?: number
  cos?: number
  sin?: number
  y0: number
  y1: number
  vx?: number
  vz?: number
  swirl?: number
  pull?: number
  grab?: number
  yaw?: number
  lift?: number
  /** An updraft: lifts a car in the air (metres per second per second). */
  rise?: number
  /** Works on cars in the air as well as on the ground. */
  air?: boolean
  on: boolean
}

/**
 * A moving deck a car can drive on: a train wagon, a crane jib, a lift. A box
 * turned by `cos`/`sin` (like a solid), whose top runs from `y0` at its back
 * (local -z) to `y1` at its front, so it can be a ramp. `vx`/`vz` is how fast
 * it is moving: a car standing on it is carried along.
 */
export interface Platform {
  x: number
  z: number
  hx: number
  hz: number
  cos: number
  sin: number
  y0: number
  y1: number
  vx: number
  vz: number
  live: boolean
  /** Leaving off its front edge gives a boost (a kicker). */
  kick?: boolean
}

/**
 * A vine (or any rope) hanging from a pivot high over a gap. A car flying off
 * the lip towards it catches it and swings across under the pivot, along
 * (`fx`, `fz`), until it lets go. `holds` collects where riders are this
 * frame (x, y, z triples) so the track can draw the rope to them.
 */
export interface Vine {
  x: number
  z: number
  /** Height of the pivot. */
  y: number
  /** Rope length. */
  L: number
  fx: number
  fz: number
  holds: number[]
}

/**
 * A wall you can ride: a panel standing along one edge of a road between two
 * samples. Hit it fast and running along it, and you go up onto it, sideways,
 * rising to `h` metres in the middle and coming back down at the end.
 */
export interface WallRide {
  c: Circuit
  i0: number
  i1: number
  /** Which edge: 1 right, -1 left. */
  side: number
  h: number
}

/**
 * Everything a car can touch: the height field, the road, solid objects and
 * things that smash. The same rules apply to the player and the rivals.
 */
export class World {
  private readonly nx: number
  private readonly nz: number
  private readonly x0: number
  private readonly z0: number
  readonly heights: Float32Array
  readonly sea: number
  private readonly solids = new Map<number, Solid[]>()
  private readonly breaks = new Map<number, Breakable[]>()
  /** Solids that move: train cars, swinging things. Track code updates them. */
  readonly movers: Solid[] = []
  /** Crosswind on exposed road and in the air, in metres per second. */
  readonly wind = { x: 0, z: 0 }
  /** Metres from each ground cell to the road. */
  readonly roadDist: Float32Array
  /** Forces: currents, gusts, vents, swirls, ruts. Track code moves and switches them. */
  readonly zones: Zone[] = []
  /** Moving decks cars can drive on. Track code moves them every frame. */
  readonly platforms: Platform[] = []
  /** Panels to ride along sideways. */
  readonly wallRides: WallRide[] = []
  /** Vines to swing on over gaps. */
  readonly vines: Vine[] = []
  /** Extra surface patches: mud that spreads, ice. */
  readonly patches: { x: number; z: number; r: number; surface: Surface; on: boolean }[] = []

  constructor(readonly def: TrackDef, readonly circuit: Circuit) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9
    for (const p of circuit.all.flatMap((c) => c.samples)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
    }
    const pad = 420
    this.x0 = minX - pad
    this.z0 = minZ - pad
    this.nx = Math.ceil((maxX - minX + pad * 2) / CELL) + 1
    this.nz = Math.ceil((maxZ - minZ + pad * 2) / CELL) + 1
    this.heights = new Float32Array(this.nx * this.nz)
    this.sea = def.sea ?? -1e6
    this.roadDist = new Float32Array(this.nx * this.nz).fill(1e9)
    this.carve()
  }

  get gridSize(): { nx: number; nz: number; x0: number; z0: number; cell: number } {
    return { nx: this.nx, nz: this.nz, x0: this.x0, z0: this.z0, cell: CELL }
  }

  /** Natural ground, then the road pressed in with soft shoulders. */
  private carve(): void {
    const { def } = this
    const reach = def.shoulder ?? 34
    const dist = this.roadDist
    const roadY = new Float32Array(this.nx * this.nz)
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      this.heights[j * this.nx + i] = def.ground(this.x0 + i * CELL, this.z0 + j * CELL)
    }
    // the lowest road surface over each cell near a road: on a hairpin or
    // where two roads pass close, the nearest one isn't always the lowest, and
    // ground pressed to the higher one poked up through the other
    const under = new Float32Array(this.nx * this.nz).fill(1e9)
    const edgeP = new THREE.Vector3()
    for (const c of this.circuit.all) for (let s = 0; s < c.count; s += 1) {
      if (c.raised[s]) continue
      const p = c.samples[s]!, half = c.widths[s]! / 2, rt = c.rights[s]!
      // the road's own tilt across (bank, camber): its surface height at any lateral offset
      const tilt = (c.at(s, half, 0, edgeP).y - p.y) / half
      const r = half + reach
      const i0 = Math.max(0, Math.floor((p.x - r - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.ceil((p.x + r - this.x0) / CELL))
      const j0 = Math.max(0, Math.floor((p.z - r - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.ceil((p.z + r - this.z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i
        const dx = this.x0 + i * CELL - p.x, dz = this.z0 + j * CELL - p.z
        const d = Math.hypot(dx, dz) - half
        const lat = THREE.MathUtils.clamp(dx * rt.x + dz * rt.z, -half, half)
        const y = p.y + lat * tilt
        if (d < dist[k]!) { dist[k] = d; roadY[k] = y }
        // a cell within a few metres of the tarmac must sit under it (cells are 5 m apart)
        if (d < CELL + 1 && y < under[k]!) under[k] = y
      }
    }
    for (let k = 0; k < dist.length; k++) {
      if (dist[k]! > reach) continue
      const t = THREE.MathUtils.smoothstep(dist[k]!, 3.5, reach)
      let h = THREE.MathUtils.lerp(roadY[k]! - 0.3, this.heights[k]!, t)
      // a road far below (an underpass) mustn't drag the ground out from under this one
      if (roadY[k]! - under[k]! < 6) h = Math.min(h, under[k]! - 0.45)
      this.heights[k] = h
    }
    // raised road isn't carved, but the ground must never poke up through it,
    // nor up into the flight path over a jump
    for (const c of this.circuit.all) for (let s = 0; s < c.count; s++) {
      if (!c.raised[s] || c.tunnel[s]) continue
      const under = c.gap[s] ? 5 : 1.2
      const p = c.samples[s]!, half = c.widths[s]! / 2 + 2
      const i0 = Math.max(0, Math.floor((p.x - half - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.ceil((p.x + half - this.x0) / CELL))
      const j0 = Math.max(0, Math.floor((p.z - half - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.ceil((p.z + half - this.z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (Math.hypot(this.x0 + i * CELL - p.x, this.z0 + j * CELL - p.z) > half) continue
        const k = j * this.nx + i
        this.heights[k] = Math.min(this.heights[k]!, p.y - under)
      }
    }
  }

  /** The highest moving deck under a point that a car at height `y` could be on (within `reach` above it). */
  platformAt(x: number, z: number, y: number, reach: number): { p: Platform; top: number } | null {
    let best: { p: Platform; top: number } | null = null
    for (const p of this.platforms) {
      if (!p.live) continue
      const dx = x - p.x, dz = z - p.z
      const lx = dx * p.cos - dz * p.sin, lz = dx * p.sin + dz * p.cos
      if (Math.abs(lx) > p.hx || Math.abs(lz) > p.hz) continue
      const top = p.y0 + (p.y1 - p.y0) * (lz / p.hz + 1) / 2
      if (top > y + reach || top < y - 6) continue
      if (!best || top > best.top) best = { p, top }
    }
    return best
  }

  /** Is this point inside the zone? */
  inZone(q: Zone, x: number, z: number, y: number): boolean {
    if (!q.on || y < q.y0 || y > q.y1) return false
    const dx = x - q.x, dz = z - q.z
    if (q.hx === undefined) return dx * dx + dz * dz < q.r * q.r
    const lx = dx * q.cos! - dz * q.sin!, lz = dx * q.sin! + dz * q.cos!
    return Math.abs(lx) < q.hx && Math.abs(lz) < q.hz!
  }

  /** Ground height under a point, not counting the road. */
  terrainAt(x: number, z: number): number {
    const fx = (x - this.x0) / CELL, fz = (z - this.z0) / CELL
    const i = THREE.MathUtils.clamp(Math.floor(fx), 0, this.nx - 2), j = THREE.MathUtils.clamp(Math.floor(fz), 0, this.nz - 2)
    const u = THREE.MathUtils.clamp(fx - i, 0, 1), v = THREE.MathUtils.clamp(fz - j, 0, 1)
    const h = this.heights, k = j * this.nx + i
    return (h[k]! * (1 - u) + h[k + 1]! * u) * (1 - v) + (h[k + this.nx]! * (1 - u) + h[k + this.nx + 1]! * u) * v
  }

  /** True at the outer limit of the map. */
  outside(x: number, z: number): boolean {
    const m = 30
    return x < this.x0 + m || z < this.z0 + m || x > this.x0 + (this.nx - 1) * CELL - m || z > this.z0 + (this.nz - 1) * CELL - m
  }

  /** A patch (mud, flood water) covering this point, on the road or off it. */
  patchAt(x: number, z: number): Surface | null {
    for (const p of this.patches) if (p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r) return p.surface
    return null
  }

  surfaceAt(x: number, z: number): Surface {
    for (const p of this.patches) if (p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r) return p.surface
    return this.def.surfaceAt?.(x, z) ?? 'grass'
  }

  private key(x: number, z: number): number { return Math.floor(x / HASH) * 100003 + Math.floor(z / HASH) }

  private put<T>(map: Map<number, T[]>, x: number, z: number, r: number, v: T): void {
    const a0 = Math.floor((x - r) / HASH), a1 = Math.floor((x + r) / HASH), b0 = Math.floor((z - r) / HASH), b1 = Math.floor((z + r) / HASH)
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
      const k = a * 100003 + b
      const l = map.get(k)
      if (l) l.push(v)
      else map.set(k, [v])
    }
  }

  /** A round solid: tree trunk, pillar, lamp post. */
  addPost(x: number, z: number, r: number, top = 1e6): void {
    this.put(this.solids, x, z, r + 2, { x, z, r, top })
  }

  /** A solid box: building, wall. `yaw` turns it about its centre. */
  addBox(x: number, z: number, hx: number, hz: number, yaw = 0, top = 1e6): void {
    const r = Math.hypot(hx, hz)
    this.put(this.solids, x, z, r + 2, { x, z, r, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), top })
  }

  addBreakable(b: Breakable): void {
    this.put(this.breaks, b.x, b.z, b.r + 2, b)
  }

  /** Take away fixed solids (not movers) whose centre passes `drop`. Returns how many went. */
  clearSolids(drop: (s: Solid) => boolean): number {
    let n = 0
    const gone = new Set<Solid>()
    for (const [k, l] of this.solids) {
      const keep = l.filter((s) => { const d = gone.has(s) || drop(s); if (d) gone.add(s); return !d })
      if (keep.length !== l.length) this.solids.set(k, keep)
    }
    n = gone.size
    return n
  }

  /** Fixed solids whose hash cells touch a circle (may repeat none: deduplicated). */
  solidsNear(x: number, z: number, r: number): Solid[] {
    const out = new Set<Solid>()
    const a0 = Math.floor((x - r) / HASH), a1 = Math.floor((x + r) / HASH), b0 = Math.floor((z - r) / HASH), b1 = Math.floor((z + r) / HASH)
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (const s of this.solids.get(a * 100003 + b) ?? []) out.add(s)
    return [...out]
  }

  /** Does a solid reach within `r` of a point (its footprint, not its height)? */
  overlaps(s: Solid, x: number, z: number, r: number): boolean {
    if (s.hx === undefined) return Math.hypot(x - s.x, z - s.z) < s.r + r
    const dx = x - s.x, dz = z - s.z
    const lx = dx * s.cos! - dz * s.sin!, lz = dx * s.sin! + dz * s.cos!
    return Math.abs(lx) < s.hx + r && Math.abs(lz) < s.hz! + r
  }

  /** Is there something solid here, for placing scenery and for the tests. */
  blocked(x: number, z: number, r: number): boolean {
    const l = this.solids.get(this.key(x, z))
    return !!l?.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r)
  }

  /** Overlap with a solid, as a push-out normal and depth. */
  collide(x: number, z: number, y: number, radius: number, out: Hit): boolean {
    const fixed = this.solids.get(this.key(x, z))
    if (!fixed && !this.movers.length) return false
    let hit = false
    out.depth = 0
    out.bounce = 0
    for (const s of fixed ? (this.movers.length ? fixed.concat(this.movers) : fixed) : this.movers) {
      if (y > s.top || (s.floor !== undefined && y < s.floor)) continue
      if (s.hx === undefined) {
        const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz), depth = s.r + radius - d
        if (depth > out.depth && d > 1e-4) { out.nx = dx / d; out.nz = dz / d; out.depth = depth; out.bounce = s.bounce ?? 0; hit = true }
      } else {
        const dx = x - s.x, dz = z - s.z
        const lx = dx * s.cos! - dz * s.sin!, lz = dx * s.sin! + dz * s.cos!
        const ox = s.hx + radius - Math.abs(lx), oz = s.hz! + radius - Math.abs(lz)
        if (ox <= 0 || oz <= 0) continue
        const depth = Math.min(ox, oz)
        if (depth <= out.depth) continue
        const nlx = ox < oz ? Math.sign(lx) : 0, nlz = ox < oz ? 0 : Math.sign(lz)
        out.nx = nlx * s.cos! + nlz * s.sin!
        out.nz = -nlx * s.sin! + nlz * s.cos!
        out.depth = depth
        out.bounce = s.bounce ?? 0
        hit = true
      }
    }
    return hit
  }

  /** Smash anything small here; returns how many broke. */
  smash(x: number, z: number, radius: number): number {
    const l = this.breaks.get(this.key(x, z))
    if (!l) return 0
    let n = 0
    for (const b of l) {
      if (!b.live || (b.x - x) ** 2 + (b.z - z) ** 2 > (b.r + radius) ** 2) continue
      b.live = false
      b.hit?.()
      n++
    }
    return n
  }
}
