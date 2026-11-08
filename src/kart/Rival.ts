import * as THREE from 'three'
import type { InputState } from '../engine/Input'
import type { Racer } from './Racer'
import type { Circuit } from './Circuit'
import type { Hit } from './World'

export interface Driver {
  name: string
  /** Fraction of a perfect run they can manage (0.85–1). */
  pace: number
  /** Chance per bend of getting it wrong. */
  mistakes: number
  /** How close to the road edge they dare go (0–1). */
  bold: number
  color: number
  car: string
}

export const DRIVERS: Driver[] = [
  { name: 'Kai Mercer', pace: 0.985, mistakes: 0.07, bold: 0.45, color: 0x1f6fe0, car: 'stiletto' },
  { name: 'Rosa Vance', pace: 0.97, mistakes: 0.17, bold: 0.85, color: 0xf2b21c, car: 'vector' },
  { name: 'Otto Brandt', pace: 0.955, mistakes: 0.05, bold: 0.2, color: 0xeaeef2, car: 'stiletto' },
  { name: 'Mina Sato', pace: 0.94, mistakes: 0.22, bold: 0.7, color: 0x18b67a, car: 'vector' },
  { name: 'Theo Lund', pace: 0.92, mistakes: 0.13, bold: 0.35, color: 0xc23ae0, car: 'stiletto' },
]

const probe: Hit = { nx: 0, nz: 0, depth: 0 }
const LANES = [0, 3.5, -3.5, 6, -6]

export type Difficulty = 'easy' | 'medium' | 'hard'
const LEVEL: Record<Difficulty, number> = { easy: 0.8, medium: 0.89, hard: 0.97 }

/** A simulated driver: presses the same pedals the player does. */
export class Rival {
  private lane: number
  private laneTo: number
  private laneTimer = 0
  /** Running wide: seconds left, and which way. */
  private error = 0
  private errorDir = 0
  private nextBend = 0
  private inBend = false
  private reversing = 0
  private scanT = 0
  /** Something across the whole road ahead: wait for it. */
  private hold = 0
  private readonly level: number
  input: InputState = { accelerate: true, brake: false, left: false, right: false, nitro: false }
  /** Driving off the road on purpose (a bold cut across a corner). */
  mistakesMade = 0
  /** The branch this driver means to take at the next fork, if any. */
  private route: Circuit | null = null
  private routeFor: Circuit | null = null
  /** A shortcut it just fell off: skipped once. */
  private burnt: Circuit | null = null
  private fallsSeen = 0
  /** Wants an item: lines up on a crystal ahead. */
  wantItem = true

  constructor(readonly racer: Racer, readonly d: Driver, difficulty: Difficulty, private readonly rand: () => number) {
    this.level = LEVEL[difficulty]
    this.lane = (rand() - 0.5) * 8
    this.laneTo = this.lane
  }

  /** Look down the road for anything solid, and pick a lane round it. */
  private scan(dt: number): void {
    this.scanT -= dt
    if (this.scanT > 0) return
    this.scanT = 0.12
    const r = this.racer, w = r.world, y = r.car.position.y + 0.6
    const speed = Math.abs(r.car.getSpeed())
    const clear = (lane: number): boolean => {
      for (const ahead of [8, 15, 24, 34 + speed * 0.3]) {
        const [c, i] = r.ahead(Math.round(ahead / 2), this.route), p = c.samples[i]!, rt = c.rights[i]!
        if (c.gap[i]) continue
        if (w.collide(p.x + rt.x * lane, p.z + rt.z * lane, y, 2.3, probe)) return false
      }
      return true
    }
    if (clear(this.lane)) return
    const half = r.path.widths[r.pi]! / 2 - 2.2
    for (const off of LANES) {
      const lane = Math.max(-half, Math.min(half, this.lane + off))
      if (clear(lane)) {
        this.laneTo = lane
        this.lane += (lane - this.lane) * 0.5
        this.laneTimer = 1.4
        return
      }
    }
    this.hold = 0.3
  }

  drive(dt: number, leaderGap: number): void {
    const r = this.racer, car = r.car, main = r.circuit, N = main.count
    const speed = car.getSpeed(), p = car.position

    // fell off a shortcut: take the long way round next time
    if (r.falls > this.fallsSeen) {
      this.fallsSeen = r.falls
      if (this.route) { this.routeFor = this.route; this.route = null }
    }
    // a fork coming: decide once which way to go
    for (const b of main.branches) {
      const d = (b.join!.from - r.s + N) % N
      if (r.path === main && d > 4 && d < 110 && this.routeFor !== b) {
        this.routeFor = b
        // a shut branch (odds 0) stays shut whoever is driving
        const odds = b.join!.odds <= 0 || this.burnt === b ? 0 : Math.min(0.95, Math.max(0.05, b.join!.odds + (this.d.bold - 0.5) * 0.3))
        if (this.burnt === b) this.burnt = null
        this.route = this.rand() < odds ? b : null
      }
      // well past this fork (or not yet near it): decide afresh next time round
      if (d >= 160 && d <= N - 120 && this.routeFor === b && r.path === main) {
        this.routeFor = null
        if (this.route === b) this.route = null
      }
    }

    // wander across the road, so no two laps or two drivers match
    this.laneTimer -= dt
    if (this.laneTimer <= 0) {
      this.laneTimer = 1.5 + this.rand() * 3
      const half = r.path.widths[r.pi]! / 2 - 2.2
      this.laneTo = (this.rand() - 0.5) * 2 * half * (0.45 + this.d.bold * 0.55)
    }
    // a row of item crystals ahead: aim for the nearest one
    if (this.wantItem) {
      const [ic, ii] = r.ahead(18, this.route)
      for (const at of ic.items) {
        const d = ii - at
        if (d >= 0 && d < 12) {
          const step = 5, half = ic.widths[at]! / 2 - 2.5
          this.laneTo = Math.max(-half, Math.min(half, Math.round(this.lane / step) * step))
        }
      }
    }
    this.lane += (this.laneTo - this.lane) * Math.min(1, dt * 1.3)
    // line up square for a jump
    // at a fork, keep to the middle of the chosen road until it's clear of the other
    for (const b of main.branches) {
      const d = (b.join!.from - r.s + N) % N
      if (r.path === main && (d < 70 || d > N - 40)) this.laneTo = 0
    }
    if (r.path !== main && r.pi < 40) this.laneTo = 0
    let jump = false
    for (let k = 8; k <= 70 && !jump; k += 6) { const [gc, gi] = r.ahead(k, this.route); jump = gc.gap[gi]! }
    if (jump) this.laneTo = 0

    this.scan(dt)

    // a bend coming: maybe get it wrong
    const look = Math.round(8 + Math.abs(speed) * 0.3)
    const [c, ai] = r.ahead(look, this.route)
    const bend = c.safe[ai]! < 58
    // an open edge over a drop is where nerves show: a mistake there can mean a fall
    const openL = c.raised[ai] && !c.gap[ai] && !c.railL[ai], openR = c.raised[ai] && !c.gap[ai] && !c.railR[ai]
    const exposed = openL || openR
    const risky = bend || !!exposed
    if (risky && !jump && !this.inBend && this.rand() < this.d.mistakes * (1.6 - this.level) * (exposed ? 2.2 : 1)) {
      this.error = 1.1 + this.rand() * 1.4
      // run wide: towards the outside of the bend, or off the open side
      const t0 = r.path.tangents[r.pi]!, t1 = c.tangents[ai]!
      this.errorDir = exposed ? (openR ? 1 : -1) : t0.x * t1.z - t0.z * t1.x > 0 ? -1 : 1
      this.mistakesMade++
    }
    this.inBend = risky
    this.error = Math.max(0, this.error - dt)

    const lane = this.lane + (this.error > 0 ? this.errorDir * (c.widths[ai]! / 2 + 7) : 0)
    const t = c.samples[ai]!, rt = c.rights[ai]!
    const tx = t.x + rt.x * lane - p.x, tz = t.z + rt.z * lane - p.z
    let turn = Math.atan2(-tx, -tz) - car.heading
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2

    // stuck against something: back out, then carry on
    if (Math.abs(speed) < 2 && !r.air && r.rescue <= 0) this.reversing += dt
    else if (this.reversing < 1) this.reversing = 0
    if (this.reversing > 1) {
      this.reversing += dt
      if (this.reversing > 2.3) this.reversing = 0
      this.input = { accelerate: false, brake: true, left: turn < 0, right: turn > 0, nitro: false }
      return
    }

    // how fast this driver dares go, with a little help or hindrance so the
    // pack stays close to the player
    const band = THREE.MathUtils.clamp(leaderGap / 260, -0.06, 0.07)
    const pace = this.d.pace * this.level * (1 + band)
    // a jump coming: everything it's got, or it falls short
    // (but a real bend on the way to it still needs braking for)
    const bendLimit = Math.min(90, Math.sqrt(25 / Math.max(Math.abs(c.bends[ai]!), 0.0015)))
    const sharp = bendLimit < 62
    const target = jump && !sharp ? 1e9 : Math.min(car.topSpeed * 1.1, (jump ? bendLimit : c.safe[ai]!) * (0.9 + 0.12 * this.d.bold) * pace)
    const over = speed - target
    this.hold = Math.max(0, this.hold - dt)
    this.input = {
      accelerate: over < 0 && this.hold <= 0,
      brake: over > 6 || (this.hold > 0 && speed > 6),
      left: turn > 0.035,
      right: turn < -0.035,
      nitro: (car.nitro > 0.35 && over < -6 && Math.abs(turn) < 0.12) || (jump && car.nitro > 0.1),
    }
  }
}
