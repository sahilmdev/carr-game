import * as THREE from 'three'
import type { Car } from '../game/Car'
import type { InputState } from '../engine/Input'
import type { Circuit } from './Circuit'
import type { Hit, World } from './World'
import { DECKS, type Surface } from './types'

const GRAVITY = 26
/** Pull on a glider, and the fastest it sinks. */
const GLIDE_G = 12
const GLIDE_SINK = -13
const RADIUS = 1.7
const TOP_ON: Record<Surface, number> = { grass: 0.6, sand: 0.55, mud: 0.45, snow: 0.6, concrete: 0.95 }
const ICE = DECKS.indexOf('ice'), DIRT = DECKS.indexOf('dirt')
/** How long a trick takes: land before it's done and it doesn't count. */
const TRICK_TIME = 0.42
const SPIN_TIME = 1.25

export interface RacerEvents {
  crash(r: Racer, strength: number, at: THREE.Vector3): void
  landed(r: Racer, strength: number): void
  rescued(r: Racer): void
  smashed(r: Racer): void
  boosted(r: Racer): void
  trick?(r: Racer, landed: boolean): void
  hit?(r: Racer, blocked: boolean): void
}

const under = { i: -1, lat: 0, y: 0 }
const hit: Hit = { nx: 0, nz: 0, depth: 0 }
const fwd = new THREE.Vector3()

/** One car in the race. The player's car and the rivals share all of this. */
export class Racer {
  /** The main-loop sample it stands for (for laps and places), and laps done. */
  s = 0
  /** The road it's following (the loop or a branch) and the sample on it. */
  path: Circuit
  pi = 0
  lap = 0
  finished = false
  finishMs = 0
  lastLapMs = 0
  bestLapMs = Infinity
  lapStart = 0
  points = 0
  /** Total distance along the race (for positions). */
  progress = 0

  vy = 0
  air = false
  airTime = 0
  onRoad = true
  surface: Surface = 'grass'
  /** Rescue: seconds left, and where to. */
  rescue = 0
  private rescueFrom = new THREE.Vector3()
  private rescueTo = new THREE.Vector3()
  private rescueYaw = 0
  private stuck = 0
  private low = 0
  private safeI = 0
  private safePath: Circuit
  /** Recently hit: no more crash effects for a moment. */
  private hitCool = 0
  wrongWay = 0
  crashes = 0
  falls = 0
  hits = 0
  tricks = 0

  /** Hit by an item: spinning, no control. */
  spin = 0
  /** Seconds of shield left: it takes one hit. */
  shield = 0
  /** Wings out over a glide drop. */
  gliding = false
  /** Seconds left in a trick spin; set when one was started on this jump. */
  trickT = 0
  private tricked = false
  private brakeWas = false
  private aiTrick = 0
  private canGlide = false

  constructor(readonly car: Car, readonly name: string, readonly isPlayer: boolean, readonly world: World, readonly circuit: Circuit) {
    this.path = circuit
    this.safePath = circuit
  }

  place(pos: THREE.Vector3, yaw: number, i: number): void {
    this.car.reset(pos, yaw)
    this.s = i
    this.path = this.circuit
    this.pi = i
    this.safeI = i
    this.safePath = this.circuit
    this.lap = 0
    this.finished = false
    this.vy = 0
    this.air = false
    this.rescue = 0
    this.spin = 0
    this.shield = 0
    this.gliding = false
    this.trickT = 0
    this.progress = i - this.circuit.count
    this.prevS = i
    this.low = 0
    this.stuck = 0
    this.watchT = 0
    this.watchAt = this.progress
    this.climb = 0
    this.airTime = 0
    this.crashes = 0
    this.falls = 0
    this.hits = 0
    this.tricks = 0
    this.settle()
  }

  /** Drop onto the ground where it stands. */
  settle(): void {
    const p = this.car.position
    const g = this.groundAt(p.x, p.z, p.y + 3)
    p.y = g
    this.groundY = g
    this.car.mesh.position.y = g
  }

  /** The highest road under this point the car could be on, else the ground. */
  private groundAt(x: number, z: number, y: number): number {
    let best = -1e9
    for (const c of this.circuit.all) {
      // in the air you come down onto a road from above; you don't step up onto it
      if (!c.roadAt(x, z, y, under, this.air ? 0.8 : 2.6) || under.y <= best) continue
      best = under.y
      this.roadPath = c
      this.roadI = under.i
      this.roadLat = under.lat
    }
    if (best > -1e9) { this.onRoad = true; return best }
    this.onRoad = false
    return this.world.terrainAt(x, z)
  }

  /** How far a point is from a road sample: outside its width, and off its height. */
  private score(c: Circuit, i: number): number {
    const p = this.car.position, s = c.samples[i]!
    const d = Math.hypot(p.x - s.x, p.z - s.z) - c.widths[i]! / 2
    return Math.max(0, d) + Math.max(0, Math.abs(p.y - s.y) - 3) * 2
  }

  /**
   * Which road the car is following. It stays on the one it's on until
   * another is clearly closer: where a branch leaves, the two overlap.
   */
  private follow(): void {
    const main = this.circuit, p = this.car.position, N = main.count
    const cur = this.path
    let bestPath = cur, bestI = cur.track(p.x, p.z, this.pi, 90, p.y)
    let bestD = this.score(cur, bestI) - 1.5
    for (const c of main.all) {
      if (c === cur) continue
      let i: number
      if (c === main) i = main.track(p.x, p.z, this.s, 90, p.y)
      else {
        const j = c.join!, off = (this.s - j.from + N) % N, span = (j.to - j.from + N) % N
        if (off > span + 25 && off < N - 25) continue
        i = c.track(p.x, p.z, 0, 90, p.y)
      }
      const d = this.score(c, i)
      if (d < bestD) { bestD = d; bestPath = c; bestI = i }
    }
    this.path = bestPath
    this.pi = bestI
    this.s = bestPath === main ? bestI : bestPath.mainAt(bestI, N)
  }

  /**
   * The road `steps` samples ahead, along this car's road; at a fork it
   * takes `choice` if that branch starts in reach.
   */
  ahead(steps: number, choice: Circuit | null = null): [Circuit, number] {
    const main = this.circuit, N = main.count
    if (this.path !== main) {
      const j = this.pi + steps, c = this.path
      if (j < c.count) return [c, j]
      return [main, (c.join!.to + j - (c.count - 1)) % N]
    }
    if (choice?.join) {
      // just past the fork but not yet over on the branch: still heading for it
      const past = (this.s - choice.join.from + N) % N
      if (past < 60) {
        const j = past + steps
        if (j < choice.count) return [choice, j]
        return [main, (choice.join.to + j - (choice.count - 1)) % N]
      }
      const d = (choice.join.from - this.s + N) % N
      if (d <= steps) {
        const j = steps - d
        if (j < choice.count) return [choice, j]
        return [main, (choice.join.to + j - (choice.count - 1)) % N]
      }
    }
    return [main, (this.s + steps) % N]
  }

  private edgeRail(): void {
    // low rails along the road edge: only where the track has them
    const c = this.path, p = this.car.position
    const i = this.pi, half = c.widths[i]! / 2
    const sp = c.samples[i]!, r = c.rights[i]!
    if (Math.abs(p.y - sp.y) > 4) return
    const lat = (p.x - sp.x) * r.x + (p.z - sp.z) * r.z
    const side = lat > 0 ? c.railR[i] : c.railL[i]
    if (!side || Math.abs(lat) < half - 1.2 || Math.abs(lat) > half + 3.5) return
    const push = Math.abs(lat) - (half - 1.2), dir = -Math.sign(lat)
    p.x += r.x * dir * push
    p.z += r.z * dir * push
    this.scrape(r.x * dir, r.z * dir)
  }

  /** Slide along something: steer the car away and lose speed by how square it hit. */
  private scrape(nx: number, nz: number): void {
    const car = this.car
    car.getForwardDir(fwd)
    const sp = car.getSpeed()
    const into = -(fwd.x * nx + fwd.z * nz) * Math.sign(sp || 1)
    if (into > 0) {
      const tx = fwd.x + nx * into * 1.05, tz = fwd.z + nz * into * 1.05
      let d = Math.atan2(-tx, -tz) - car.heading
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      if (Math.abs(sp) > 3 && into < 0.8) car.heading += d * 0.3
      const fast = Math.abs(sp)
      if (this.hitCool <= 0 && fast > 7 && into > 0.16) {
        this.hitCool = 0.45
        this.crashes++
        this.events?.crash(this, into, car.position)
      }
      // head-on at speed is a hard stop; a glancing touch costs a little
      car.scrubSpeed(into > 0.72 && fast > 22 ? 0.12 : 1 - Math.min(0.6, into * 0.09))
    }
  }

  events: RacerEvents | null = null

  /** Struck by an item: a shield takes it, otherwise the car spins out. */
  struck(): boolean {
    if (this.rescue > 0 || this.spin > 0) return false
    if (this.shield > 0) {
      this.shield = 0
      this.events?.hit?.(this, true)
      return false
    }
    this.spin = SPIN_TIME
    this.hits++
    this.car.scrubSpeed(0.3)
    this.events?.hit?.(this, false)
    return true
  }

  /** One frame of ground, gravity and contact, after the car has moved. */
  step(dt: number, input: InputState, drive: boolean): void {
    const car = this.car, p = car.position, c = this.circuit, w = this.world
    this.hitCool -= dt
    this.shield = Math.max(0, this.shield - dt)
    if (this.rescue > 0) { this.stepRescue(dt); return }

    const prevY = p.y, prevX = p.x, prevZ = p.z
    const spinning = this.spin > 0
    // in the air you keep your speed: no brake (it's the trick button), no drag
    if (drive && !spinning) car.update(dt, this.air ? { ...input, brake: false, accelerate: true } : input)
    else car.update(dt, NO_INPUT)
    if (spinning) {
      this.spin = Math.max(0, this.spin - dt)
      car.scrubSpeed(Math.pow(0.4, dt))
      // the body whirls round; the car itself keeps its heading
      car.mesh.rotation.y = car.heading + (1 - this.spin / SPIN_TIME) * Math.PI * 4
    }

    if (this.air || this.path.raised[this.pi]) { p.x += w.wind.x * dt; p.z += w.wind.z * dt }

    // solid things
    if (w.collide(p.x, p.z, p.y + 0.6, RADIUS, hit)) {
      p.x += hit.nx * hit.depth
      p.z += hit.nz * hit.depth
      this.scrape(hit.nx, hit.nz)
    }
    if (w.smash(p.x, p.z, RADIUS) > 0) {
      car.scrubSpeed(0.93)
      this.events?.smashed(this)
    }
    this.follow()
    this.edgeRail()

    const g = this.groundAt(p.x, p.z, p.y)
    // a wall of earth is as solid as a building
    // too steep to drive up (a hillside, the wall of a cutting): it stops you
    // like a wall, so the mountains can't be climbed to skip the road
    const moved = Math.hypot(p.x - prevX, p.z - prevZ)
    // judged over at least a quarter metre, so a crawling car isn't stopped by a ripple
    const steep = !this.onRoad && !this.air && moved > 0.01 && g - prevY > 0.62 * Math.max(moved, 0.25)
    if (!this.onRoad && (g > p.y + 2.2 || steep)) {
      p.x = prevX
      p.z = prevZ
      this.scrape(...awayFrom(prevX, prevZ, w))
      this.groundAt(p.x, p.z, p.y)
    }
    const gy = this.onRoad ? g : this.groundAt(p.x, p.z, p.y)
    this.groundY = gy

    // a trick: tap the brake just after take-off
    const tap = !!input.brake && !this.brakeWas && drive
    this.brakeWas = !!input.brake
    if (this.air) {
      if (this.canGlide && this.airTime > 0.1) this.gliding = true
      const grav = this.gliding ? GLIDE_G : (w.def.gravity ?? GRAVITY)
      this.vy -= grav * dt
      if (this.gliding) this.vy = Math.max(this.vy, GLIDE_SINK)
      p.y += this.vy * dt
      this.airTime += dt
      const wantTrick = this.isPlayer ? tap : this.aiTrick > 0 && this.airTime > this.aiTrick
      if (wantTrick && !this.tricked && !spinning && this.airTime < 0.9) {
        this.tricked = true
        this.trickT = TRICK_TIME
        this.aiTrick = 0
      }
      this.trickT = Math.max(0, this.trickT - dt)
      if (p.y <= gy) {
        p.y = gy
        const hard = Math.min(1, -this.vy / 22)
        this.air = false
        this.vy = 0
        if (this.tricked) {
          // finished the trick before landing: a kick; still turning: a stumble
          const clean = this.trickT <= 0
          if (clean) { car.kick(1.05); this.tricks++ } else car.scrubSpeed(0.8)
          this.events?.trick?.(this, clean)
        }
        this.tricked = false
        this.trickT = 0
        this.gliding = false
        this.canGlide = false
        if (this.airTime > 0.25) this.events?.landed(this, hard)
        this.airTime = 0
      }
    } else {
      const speedY = (gy - prevY) / Math.max(dt, 1e-3)
      // the ground fell away faster than the car can follow: airborne
      if (gy < prevY - 0.55) {
        this.air = true
        this.airTime = 0
        this.tricked = false
        // wings only off a glide lip: the road ahead is a marked glide
        const gp = this.roadPath ?? this.path, gi = this.roadPath ? this.roadI : this.pi
        this.canGlide = false
        for (let k = 0; k < 8 && !this.canGlide; k++) this.canGlide = !!gp.glide[gp.closed ? (gi + k) % gp.count : Math.min(gp.count - 1, gi + k)]
        this.aiTrick = !this.isPlayer && Math.random() < 0.75 ? 0.28 + Math.random() * 0.12 : 0
        this.vy = this.climb
        p.y = prevY + this.vy * dt
      } else {
        p.y = gy
        this.climb += (THREE.MathUtils.clamp(speedY, -40, 40) - this.climb) * Math.min(1, dt * 14)
      }
    }

    // how the ground feels
    const under2 = this.onRoad
    this.surface = under2 ? 'concrete' : w.surfaceAt(p.x, p.z)
    if (!this.air) {
      car.topBonus = under2 ? 1 : TOP_ON[this.surface]
      car.surfaceDrag = under2 ? 0 : 12
      const rp = this.roadPath
      const deck = rp.deck[this.roadI]
      car.surfaceSlip = !under2 && this.surface === 'mud' ? 0.55 : !under2 && this.surface === 'snow' ? 0.35 : !under2 ? 0.15
        : Math.max(this.roadSlip, deck === ICE ? 0.5 : deck === DIRT ? 0.24 : 0)
      // mud or flood water lying on the road: slower and slippery
      if (under2) {
        const patch = w.patchAt(p.x, p.z)
        if (patch === 'mud' || patch === 'snow') { car.topBonus = 0.8; car.surfaceSlip = Math.max(car.surfaceSlip, 0.45) }
      }
      // a boost strip kicks anyone who crosses it
      if (under2 && rp.pad[this.roadI] && Math.abs(this.roadLat - rp.padLat[this.roadI]!) < 4 && this.padCool <= 0) {
        this.padCool = 0.5
        car.kick(1.1)
        this.events?.boosted(this)
      }
    }
    this.padCool -= dt
    void c

    this.pose(dt)
    this.rules(dt)
  }

  private watchT = 0
  private watchAt = 0
  private roadPath: Circuit = null!
  private roadI = 0
  private roadLat = 0
  private padCool = 0
  /** Ground height under the car, for its shadow. */
  groundY = 0
  /** Grip lost on this track's road surface (wet, icy). */
  roadSlip = 0
  private climb = 0

  private pose(dt: number): void {
    const car = this.car, c = this.path, p = car.position
    car.mesh.position.y = p.y
    if (this.onRoad && !this.air) {
      const t = c.tangents[this.pi]!
      car.setSlopePitch(Math.asin(THREE.MathUtils.clamp(t.y, -1, 1)) * Math.cos(this.headingDelta()), 0.2)
      car.mesh.rotation.z = THREE.MathUtils.lerp(car.mesh.rotation.z, Math.atan(Math.tan(c.banks[this.pi]!)), Math.min(1, dt * 8))
    } else if (this.air) {
      car.setSlopePitch(THREE.MathUtils.clamp(this.vy * 0.012, -0.4, 0.3), 0.08)
      // a barrel roll for a trick, a gentle bank for a glider
      if (this.trickT > 0) car.mesh.rotation.z = (1 - this.trickT / TRICK_TIME) * Math.PI * 2
      else {
        const rz = car.mesh.rotation.z, bank = this.gliding ? -car.steer * 0.35 : 0
        car.mesh.rotation.z = THREE.MathUtils.lerp(Math.atan2(Math.sin(rz), Math.cos(rz)), bank, Math.min(1, dt * 4))
      }
    } else {
      // on open ground, tilt with the slope
      const f = car.getForwardDir(fwd)
      const a = this.world.terrainAt(p.x + f.x * 2, p.z + f.z * 2), b = this.world.terrainAt(p.x - f.x * 2, p.z - f.z * 2)
      car.setSlopePitch(Math.atan((a - b) / 4), 0.2)
      car.mesh.rotation.z = THREE.MathUtils.lerp(car.mesh.rotation.z, 0, Math.min(1, dt * 8))
    }
  }

  private headingDelta(): number {
    const t = this.path.tangents[this.pi]!
    return this.car.heading - Math.atan2(-t.x, -t.z)
  }

  /** Water, falling under the road, leaving the map, getting wedged. */
  private rules(dt: number): void {
    const w = this.world, p = this.car.position
    const sp = this.path.samples[this.pi]!
    if (this.onRoad && !this.air) { this.safeI = this.roadI; this.safePath = this.roadPath }
    const drowned = p.y < w.sea + 0.1
    const lost = w.outside(p.x, p.z)
    // down off a viaduct with no way back up
    const below = !this.onRoad && !this.air && sp.y - p.y > 5 && Math.hypot(sp.x - p.x, sp.z - p.z) < 60
    this.low = below ? this.low + dt : 0
    const far = Math.hypot(sp.x - p.x, sp.z - p.z) > (this.gliding ? 260 : 150)
    // pushing against something and going nowhere
    this.stuck = Math.abs(this.car.getSpeed()) < 1.5 && !this.isPlayer && this.spin <= 0 ? this.stuck + dt : 0
    // shuffling about without getting anywhere: the drone lifts you out.
    // Rivals get six seconds; you get ten, in case you meant it.
    this.watchT += dt
    if (this.watchT > (this.isPlayer ? 10 : 6)) {
      const moved = Math.abs(this.progress - this.watchAt)
      this.watchT = 0
      this.watchAt = this.progress
      if (moved < (this.isPlayer ? 45 : 30) && !this.finished) { this.startRescue(); return }
    }
    if (drowned || lost || far || this.low > 1.4 || p.y < -80 || this.stuck > 3) this.startRescue()
  }

  startRescue(): void {
    if (this.rescue > 0) return
    this.falls++
    // a little way back from where the road was lost, on the centre of the
    // lane. That's the last place it was on the road, if that's on the road
    // it's following and not far behind; otherwise just behind where it is.
    let c = this.safePath, from = this.safeI
    const behind = c === this.path ? (c.closed ? (this.pi - from + c.count) % c.count : this.pi - from) : -1
    if (behind < 0 || behind > 160) { c = this.path; from = c.closed ? (this.pi - 20 + c.count) % c.count : Math.max(0, this.pi - 20) }
    let i = c.closed ? (from - 6 + c.count) % c.count : Math.max(0, from - 6)
    // never put down over a gap
    for (let k = 0; k < 40 && c.gap[i]; k++) i = c.closed ? (i - 1 + c.count) % c.count : Math.max(0, i - 1)
    // a jump just ahead: go back far enough to get up to speed for it
    const at = (j: number) => (c.closed ? ((j % c.count) + c.count) % c.count : Math.max(0, Math.min(c.count - 1, j)))
    for (let k = 0; k < 60; k++) {
      if (!c.gap[at(i + k)]) continue
      const want = i + k - 110
      // a branch too short for the run-up: start it back on the main road
      if (!c.closed && want < 0 && c.join) {
        const main = this.circuit
        i = (c.join.from + want + main.count) % main.count
        c = main
      } else i = at(want)
      break
    }
    const t = c.tangents[i]!
    this.rescueFrom.copy(this.car.position)
    this.rescueTo.copy(c.samples[i]!)
    this.rescueYaw = Math.atan2(-t.x, -t.z)
    this.rescue = RESCUE_TIME
    this.air = false
    this.gliding = false
    this.tricked = false
    this.trickT = 0
    this.spin = 0
    this.vy = 0
    this.climb = 0
    this.car.setSpeed(0)
    this.path = c
    this.pi = i
    this.events?.rescued(this)
  }

  private stepRescue(dt: number): void {
    const car = this.car, p = car.position
    this.rescue -= dt
    const u = 1 - Math.max(0, this.rescue) / RESCUE_TIME
    // lifted, carried over, set down
    const e = u * u * (3 - 2 * u)
    p.lerpVectors(this.rescueFrom, this.rescueTo, e)
    p.y += Math.sin(u * Math.PI) * 14
    let d = this.rescueYaw - car.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    car.heading += d * Math.min(1, dt * 4)
    car.mesh.position.copy(p)
    car.mesh.rotation.y = car.heading
    car.mesh.rotation.z = 0
    if (this.rescue <= 0) {
      this.rescue = 0
      p.copy(this.rescueTo)
      car.heading = this.rescueYaw
      car.setSpeed(0)
      const main = this.circuit
      this.s = this.path === main ? this.pi : this.path.mainAt(this.pi, main.count)
      this.settle()
    }
  }

  /**
   * Hidden lap tracking: distance is added up along the road, so reversing
   * takes it away again and a lap can't be faked at the line.
   */
  updateLap(now: number, totalLaps: number): 'lap' | 'finish' | null {
    const n = this.circuit.count
    let d = this.s - this.prevS
    if (d > n / 2) d -= n
    if (d < -n / 2) d += n
    this.prevS = this.s
    this.progress += d
    const done = Math.floor(this.progress / n)
    if (done <= this.lap) return null
    this.lap = done
    const ms = now - this.lapStart
    this.lastLapMs = ms
    this.bestLapMs = Math.min(this.bestLapMs, ms)
    this.lapStart = now
    return this.lap >= totalLaps ? 'finish' : 'lap'
  }
  private prevS = 0
}

export const RESCUE_TIME = 3
const NO_INPUT: InputState = { accelerate: false, brake: false, left: false, right: false }

function awayFrom(x: number, z: number, w: World): [number, number] {
  const e = 3
  const dx = w.terrainAt(x - e, z) - w.terrainAt(x + e, z), dz = w.terrainAt(x, z - e) - w.terrainAt(x, z + e)
  const l = Math.hypot(dx, dz) || 1
  return [dx / l, dz / l]
}
