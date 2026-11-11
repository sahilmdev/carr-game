import * as THREE from 'three'
import type { Car } from '../game/Car'
import type { InputState } from '../engine/Input'
import type { Circuit } from './Circuit'
import type { Hit, Platform, Vine, WallRide, World } from './World'
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
const _tv = new THREE.Vector3(), _tw = new THREE.Vector3(), _tz = new THREE.Vector3(), _tm = new THREE.Matrix4()

/** One car in the race. The player's car and the rivals share all of this. */
const _roof = new THREE.Vector3()

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
  private rescueSpeed = 0
  private safePath: Circuit
  /** Recently hit: no more crash effects for a moment. */
  private hitCool = 0
  wrongWay = 0
  crashes = 0
  falls = 0
  hits = 0
  tricks = 0

  /** Swinging on a vine: the vine, the rope's angle from straight down and its rate, sideways offset. */
  swingV: Vine | null = null
  private swingTh = 0
  private swingW = 0
  private swingB = 0
  private swingLet = 0.6
  private nitroWas = false
  /** On a twisting road (a corkscrew): the road, where along it, and how far across. */
  twistC: Circuit | null = null
  private twistS = 0
  private twistLat = 0
  /** Riding a wall panel: the panel, where along it (a sample index) and where the ride began. */
  wallR: WallRide | null = null
  private wallS = 0
  private wallS0 = 0
  /** Knocked by a bumper: sliding away at this velocity (m/s), fading. */
  private shoveX = 0
  private shoveZ = 0
  /** Set by a rival's brain while it waits for something across the road (a gate) to clear. */
  waiting = 0
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
    this.carried = null
    this.platform = null
    this.looping = false
    this.swingV = null
    this.wallR = null
    this.rescue = 0
    this.twistC = null
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
    // a moving deck (a train wagon) above the road
    const deck = this.world.platforms.length ? this.world.platformAt(x, z, y, this.air ? 0.8 : 2.6) : null
    this.platform = deck && deck.top > best ? deck.p : null
    if (this.platform) { this.onRoad = true; return deck!.top }
    if (best > -1e9) { this.onRoad = true; return best }
    this.onRoad = false
    return this.world.terrainAt(x, z)
  }

  /** The moving deck the car is standing on, if any. */
  platform: Platform | null = null
  private carried: Platform | null = null

  private readonly carriedV = { x: 0, z: 0 }
  private zoneCool = 0
  /** Drifts finished in all (for tracks that count them). */
  driftCount = 0
  /** Drifts chained one after another, and time left to chain the next. */
  chain = 0
  private chainT = 0
  /** Thrown off the rails for leaning the wrong way. */
  derails = 0
  /** In a vertical loop: how far round (0..1), its centre frame and the entry speed. */
  looping = false
  private loopA = 0
  private loopR = 0
  private loopSide = 0
  /** Where across the road you entered the loop. */
  private loopLat0 = 0
  private readonly loopO = new THREE.Vector3()
  private readonly loopF = new THREE.Vector3()
  private readonly loopRt = new THREE.Vector3()

  /**
   * Locked on rails: the car holds the middle of the track and points along
   * it; steering is ignored. Through a bend you lean into it (steer towards
   * the inside); lean the wrong way, or not at all, in a hard bend at speed
   * and you're thrown off your line and lose most of your speed.
   */
  private onRails(dt: number, input: InputState, drive: boolean): void {
    if (this.air || !this.onRoad || this.platform) return
    const c = this.roadPath, i = this.roadI
    if (!c || !c.lock[i]) return
    const car = this.car, p = car.position, s = c.samples[i]!, r = c.rights[i]!
    const lat = (p.x - s.x) * r.x + (p.z - s.z) * r.z
    const pull = Math.min(1, dt * 8)
    p.x -= r.x * lat * pull
    p.z -= r.z * lat * pull
    const t0 = c.tangents[i]!, j = Math.min(c.count - 1, i + 6), t1 = c.tangents[j]!
    car.heading = Math.atan2(-t0.x, -t0.z)
    car.setSpeed(car.getSpeed())
    // which way the track turns, and how hard
    const turn = t0.x * t1.z - t0.z * t1.x
    const sp = car.getSpeed(), g = sp * sp * Math.abs(c.bends[i] ?? 0)
    if (g < 9 || !drive) return
    const inside = turn < 0 ? 'left' : 'right'
    const leaning = inside === 'left' ? !!input.left && !input.right : !!input.right && !input.left
    if (leaning) { car.surge = Math.max(car.surge, 0.12); return }
    if (g > 20 && this.hitCool <= 0 && this.spin <= 0) {
      this.hitCool = 1.2
      this.derails++
      car.scrubSpeed(0.45)
      this.spin = SPIN_TIME * 0.5
      this.events?.crash(this, 0.8, p)
    }
  }

  /** Crossing the entry of a loop on the road: start round it. */
  private checkLoop(prevPath: Circuit, prevPi: number): void {
    const loops = this.circuit.loops
    if (!loops.length || this.air || this.path !== this.circuit || prevPath !== this.circuit) return
    for (const L of loops) {
      const crossed = prevPi < L.i && this.pi >= L.i && this.pi - prevPi < 40
      if (!crossed) continue
      const s = this.circuit.samples[L.i]!, t = this.circuit.tangents[L.i]!, r = this.circuit.rights[L.i]!
      const p = this.car.position
      if (Math.abs((p.x - s.x) * r.x + (p.z - s.z) * r.z) > this.circuit.widths[L.i]! / 2) continue
      this.looping = true
      this.loopA = 0
      this.loopR = L.r
      this.loopSide = L.side
      this.loopLat0 = (p.x - s.x) * r.x + (p.z - s.z) * r.z
      this.loopO.set(s.x, s.y, s.z)
      this.loopF.set(t.x, 0, t.z).normalize()
      this.loopRt.copy(r)
      return
    }
  }

  /**
   * Round a vertical loop: you climb the inside of the hoop, go over upside
   * down and come out the bottom a little to one side. Gravity takes speed off
   * on the way up; too slow at the top and you fall out of it.
   */
  private stepLoop(dt: number, input: InputState, drive: boolean): void {
    const car = this.car, p = car.position, R = this.loopR
    const grav = this.world.def.gravity ?? GRAVITY
    let sp = car.getSpeed()
    // throttle still pushes, gravity pulls along the hoop
    if (drive && input.accelerate) sp += 14 * dt
    sp -= grav * Math.sin(this.loopA * Math.PI * 2) * dt
    car.setSpeed(Math.max(0, sp))
    this.loopA += (Math.max(0, sp) * dt) / (Math.PI * 2 * R)
    const th = this.loopA * Math.PI * 2
    // too slow near the top: you drop out of the loop
    if (th > Math.PI * 0.6 && th < Math.PI * 1.4 && sp * sp < grav * R * 0.8) {
      this.looping = false
      this.air = true
      this.vy = 0
      this.airTime = 0
      car.mesh.rotation.x = 0
      return
    }
    // onto the hoop's line from wherever you came in, then across to its far side
    const a = Math.min(1, this.loopA), S = this.loopSide
    const ease = 1 - THREE.MathUtils.smoothstep(a, 0, 0.18)
    const side = -S / 2 + S * a + (this.loopLat0 + S / 2) * ease
    p.set(
      this.loopO.x + this.loopF.x * R * Math.sin(th) + this.loopRt.x * side,
      this.loopO.y + R * (1 - Math.cos(th)),
      this.loopO.z + this.loopF.z * R * Math.sin(th) + this.loopRt.z * side,
    )
    car.mesh.position.copy(p)
    car.mesh.rotation.set(0, car.heading, 0)
    car.mesh.rotateX(th)
    if (this.loopA >= 1) {
      this.looping = false
      car.mesh.rotation.set(0, car.heading, 0)
      p.y = this.loopO.y
      this.follow()
      // come out on the road, whatever line you took round
      const c = this.path, s = c.samples[this.pi]!, r = c.rights[this.pi]!, half = c.widths[this.pi]! / 2 - 2
      const lat = (p.x - s.x) * r.x + (p.z - s.z) * r.z
      if (Math.abs(lat) > half) { const d = lat - Math.sign(lat) * half; p.x -= r.x * d; p.z -= r.z * d }
      this.settle()
    }
    this.pose(dt)
    car.mesh.rotation.set(0, car.heading, 0)
    car.mesh.rotateX(Math.min(1, this.loopA) * Math.PI * 2)
    car.mesh.position.copy(p)
  }

  /** Just off a lip, in reach of a vine and flying towards it: grab it. */
  private catchVine(input: InputState): boolean {
    const p = this.car.position
    this.car.getForwardDir(fwd)
    for (const v of this.world.vines) {
      const dx = p.x - v.x, dz = p.z - v.z
      const a = dx * v.fx + dz * v.fz, b = -dx * v.fz + dz * v.fx
      if (a < -v.L * 0.85 || a > -v.L * 0.4 || Math.abs(b) > 9) continue
      const th = Math.asin(a / v.L)
      if (Math.abs(p.y - (v.y - v.L * Math.cos(th))) > 4.5) continue
      const along = fwd.x * v.fx + fwd.z * v.fz
      if (along < 0.6) continue
      const vh = this.car.getSpeed() * along
      if (vh < 6) continue
      this.swingV = v
      this.swingTh = th
      this.swingW = (vh * Math.cos(th) + this.vy * Math.sin(th)) / v.L
      this.swingB = b
      // rivals let go somewhere after the bottom; most pick a good moment
      this.swingLet = 0.48 + Math.random() * 0.3
      this.nitroWas = !!input.nitro
      this.brakeWas = !!input.brake
      this.gliding = false
      this.tricked = false
      this.trickT = 0
      return true
    }
    return false
  }

  /**
   * On a vine: a pendulum under its pivot. Let go (nitro or brake) just after
   * the bottom and you're thrown out fast and flat; too soon and you drop
   * short; hang on and it lets you go at the top of the swing, slow but safe.
   */
  private stepSwing(dt: number, input: InputState, drive: boolean): void {
    const v = this.swingV!, car = this.car, p = car.position
    const g = this.world.def.gravity ?? GRAVITY
    this.swingW -= (g / v.L) * Math.sin(this.swingTh) * dt
    this.swingTh += this.swingW * dt
    const press = drive && ((!!input.nitro && !this.nitroWas) || (!!input.brake && !this.brakeWas))
    this.nitroWas = !!input.nitro
    this.brakeWas = !!input.brake
    const letGo = this.swingTh >= 1.0 || this.swingW <= 0.05 || (this.isPlayer ? press : this.swingTh >= this.swingLet)
    this.swingB *= 1 - Math.min(1, dt * 0.8)
    const th = this.swingTh, sp = this.swingW * v.L
    // the car hangs under the vine's end: the vine meets the middle of its roof
    p.set(v.x + v.fx * v.L * Math.sin(th) - v.fz * this.swingB, v.y - v.L * Math.cos(th) - 1.5, v.z + v.fz * v.L * Math.sin(th) + v.fx * this.swingB)
    car.heading = Math.atan2(-v.fx, -v.fz)
    car.setSpeed(Math.max(0, sp * Math.cos(th)))
    this.follow()
    car.mesh.position.copy(p)
    car.mesh.rotation.set(0, car.heading, 0)
    car.mesh.rotateX(th * 0.6)
    const roof = _roof.set(0, 1.5, 0).applyQuaternion(car.mesh.quaternion).add(p)
    v.holds.push(roof.x, roof.y, roof.z)
    if (letGo) {
      this.swingV = null
      this.air = true
      this.airTime = 0.3
      this.vy = sp * Math.sin(th)
      this.canGlide = false
      this.groundY = this.groundAt(p.x, p.z, p.y)
    }
  }

  /** Onto a twisting stretch: from here the car holds to the road surface, whichever way up it is. */
  private startTwist(): void {
    const c = this.path, i = this.pi, s = c.samples[i]!, r = c.rights[i]!, p = this.car.position
    this.twistC = c
    this.twistS = i
    this.twistLat = THREE.MathUtils.clamp((p.x - s.x) * r.x + (p.z - s.z) * r.z, -c.widths[i]! / 2 + 1.2, c.widths[i]! / 2 - 1.2)
  }

  /**
   * Round a corkscrew: you stick to the road as it turns over, steering
   * across it as normal. Too slow while upside down and you drop off.
   */
  private stepTwist(dt: number, input: InputState, drive: boolean): void {
    const c = this.twistC!, car = this.car, p = car.position
    let sp = car.getSpeed()
    if (drive && input.accelerate) sp = Math.min(sp + 9 * dt, 62)
    if (drive && input.brake) sp = Math.max(0, sp - 20 * dt)
    car.setSpeed(sp)
    this.twistS += (sp * dt) / (c.length / c.count)
    const n = c.count, i = c.closed ? Math.floor(this.twistS) % n : Math.min(n - 1, Math.floor(this.twistS))
    const half = c.widths[i]! / 2 - 1.2
    const steer = drive ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0
    this.twistLat = THREE.MathUtils.clamp(this.twistLat + steer * 9 * dt, -half, half)
    const tilt = c.tilt(i)
    c.at(i, this.twistLat, 0, p)
    const o = c.at(i, this.twistLat, 1, _tv).sub(p)
    const rt = c.at(i, this.twistLat + 1, 0, _tw).sub(p).normalize()
    const t = c.tangents[i]!
    car.heading = Math.atan2(-t.x, -t.z)
    _tm.makeBasis(rt, o.normalize(), _tz.copy(t).normalize().negate())
    car.mesh.position.copy(p)
    car.mesh.quaternion.setFromRotationMatrix(_tm)
    this.follow()
    // hanging upside down too slowly: you fall off
    const fall = Math.abs(tilt) > 1.9 && sp < 13
    if (Math.abs(tilt) < 0.04 || fall || (!c.closed && i >= n - 1)) {
      this.twistC = null
      car.mesh.rotation.set(0, car.heading, 0)
      if (fall) { this.air = true; this.vy = 0; this.airTime = 0; p.y -= 1.5 }
      else this.settle()
      this.pi = i
    }
  }

  /** Running along the edge of a road beside a wall panel, fast and straight: up onto it. */
  private catchWall(): boolean {
    const c = this.path, i = this.pi, p = this.car.position
    for (const wr of this.world.wallRides) {
      if (wr.c !== c || i < wr.i0 || i > wr.i1 - 10) continue
      const s = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      const lat = (p.x - s.x) * r.x + (p.z - s.z) * r.z
      if (lat * wr.side < half - 3.6) continue
      this.car.getForwardDir(fwd)
      if (fwd.x * t.x + fwd.z * t.z < 0.85 || this.car.getSpeed() < 15) continue
      this.wallR = wr
      this.wallS = i
      this.wallS0 = i
      return true
    }
    return false
  }

  /**
   * Up on a wall panel, sideways: you run along it, rising to its middle and
   * back down, a little faster for it. Steer away to drop off early.
   */
  private stepWall(dt: number, input: InputState, drive: boolean): void {
    const wr = this.wallR!, c = wr.c, car = this.car, p = car.position
    let sp = car.getSpeed()
    if (drive && input.accelerate) sp = Math.min(sp + 6 * dt, 70)
    car.setSpeed(sp)
    this.wallS += (sp * dt) / (c.length / c.count)
    const i = Math.min(wr.i1, Math.floor(this.wallS)), j = Math.min(wr.i1, i + 1), u = this.wallS - Math.floor(this.wallS)
    const a = c.samples[i]!, b = c.samples[j]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
    const k = THREE.MathUtils.clamp((this.wallS - this.wallS0) / Math.max(1, wr.i1 - this.wallS0), 0, 1)
    const lift = Math.sin(k * Math.PI)
    const lat = wr.side * (half - 0.6)
    p.set(a.x + (b.x - a.x) * u + r.x * lat, a.y + (b.y - a.y) * u + wr.h * lift + 0.2, a.z + (b.z - a.z) * u + r.z * lat)
    car.heading = Math.atan2(-t.x, -t.z)
    this.follow()
    car.mesh.position.copy(p)
    car.mesh.rotation.set(0, car.heading, 0)
    car.mesh.rotateZ(wr.side * 1.3 * Math.min(1, lift * 1.6))
    const away = drive && (wr.side > 0 ? !!input.left && !input.right : !!input.right && !input.left)
    if (k >= 1 || (away && k > 0.15)) {
      this.wallR = null
      car.mesh.rotation.set(0, car.heading, 0)
      // off the wall, back onto the road: a lane in from the edge, with a kick for riding it
      p.x -= r.x * wr.side * 2
      p.z -= r.z * wr.side * 2
      this.air = true
      this.airTime = 0.3
      this.vy = 0
      if (k >= 1) { car.kick(1.08); this.events?.boosted(this) }
      this.groundY = this.groundAt(p.x, p.z, p.y)
    }
  }

  /** The deck's velocity along the car's heading. */
  private along(pl: Platform, v: { x: number; z: number } = { x: pl.vx, z: pl.vz }): number {
    this.car.getForwardDir(fwd)
    return v.x * fwd.x + v.z * fwd.z
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
      if (c === cur || c.shut) continue
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
    // a broken number in the car's position (it shouldn't happen): put it back on the road
    if (!Number.isFinite(p.x + p.y + p.z + car.heading + car.getSpeed())) {
      const s = this.path.samples[this.pi]!
      p.copy(s)
      car.heading = 0
      car.setSpeed(0)
      this.vy = 0
      this.startRescue()
      return
    }

    if (this.looping) { this.stepLoop(dt, input, drive); return }
    if (this.swingV) { this.stepSwing(dt, input, drive); return }
    if (this.wallR) { this.stepWall(dt, input, drive); return }
    if (this.twistC) { this.stepTwist(dt, input, drive); return }
    const prevY = p.y, prevX = p.x, prevZ = p.z
    const prevPi = this.pi, prevPath = this.path
    const spinning = this.spin > 0
    // in the air you keep your speed: no brake (it's the trick button), no drag
    if (drive && !spinning) car.update(dt, this.air ? { ...input, brake: false, accelerate: true } : input)
    else car.update(dt, NO_INPUT)
    // a chain of drifts: each one released soon after the last pays more
    this.chainT -= dt
    if (car.driftPaid > 0) {
      this.driftCount++
      this.chain = this.chainT > 0 ? this.chain + 1 : 1
      this.chainT = 1.8
      const per = w.def.driftChain ?? 0.15
      if (this.chain > 1) { car.kick(car.surge + Math.min(4, this.chain - 1) * per); this.events?.boosted(this) }
    }
    if (spinning) {
      this.spin = Math.max(0, this.spin - dt)
      car.scrubSpeed(Math.pow(0.4, dt))
      // the body whirls round; the car itself keeps its heading
      car.mesh.rotation.y = car.heading + (1 - this.spin / SPIN_TIME) * Math.PI * 4
    }

    if (this.air || this.path.raised[this.pi]) { p.x += w.wind.x * dt; p.z += w.wind.z * dt }
    // standing on a moving deck: it carries you
    // (in the air too: you keep the speed it gave you until you land)
    // forces: currents, gusts, swirls push; ruts steer; vents throw you up
    this.zoneCool -= dt
    for (const q of w.zones) {
      if (!w.inZone(q, p.x, p.z, p.y) || (this.air && !q.air)) continue
      if (q.vx) p.x += q.vx * dt
      if (q.vz) p.z += q.vz * dt
      if (q.swirl || q.pull) {
        const dx = p.x - q.x, dz = p.z - q.z, d = Math.max(1, Math.hypot(dx, dz))
        const tx = -dz / d, tz = dx / d
        p.x += (tx * (q.swirl ?? 0) - (dx / d) * (q.pull ?? 0)) * dt
        p.z += (tz * (q.swirl ?? 0) - (dz / d) * (q.pull ?? 0)) * dt
      }
      if (q.grab && !this.air) {
        let d = (q.yaw ?? 0) - car.heading
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        car.heading += d * Math.min(1, q.grab * dt)
      }
      if (q.rise && this.air) this.vy += q.rise * dt
      if (q.lift && !this.air && this.zoneCool <= 0) {
        this.zoneCool = 1.2
        this.air = true
        this.airTime = 0
        this.tricked = false
        this.canGlide = false
        this.aiTrick = !this.isPlayer && Math.random() < 0.6 ? 0.3 : 0
        this.vy = q.lift
        p.y += 0.6
        this.events?.boosted(this)
      }
    }
    const ride = this.carried
    if (ride) {
      const vx = this.air ? this.carriedV.x : ride.vx, vz = this.air ? this.carriedV.z : ride.vz
      p.x += vx * dt; p.z += vz * dt
    }

    // solid things
    if (w.collide(p.x, p.z, p.y + 0.6, RADIUS, hit)) {
      p.x += hit.nx * hit.depth
      p.z += hit.nz * hit.depth
      if (hit.bounce) {
        // a bumper: knocked away, spun a little, no crash
        this.shoveX = hit.nx * hit.bounce
        this.shoveZ = hit.nz * hit.bounce
        car.heading += (Math.random() - 0.5) * 0.5
        if (this.hitCool <= 0) { this.hitCool = 0.4; this.events?.crash(this, 0.3, p) }
      } else this.scrape(hit.nx, hit.nz)
    }
    // still sliding from a bump
    if (this.shoveX || this.shoveZ) {
      p.x += this.shoveX * dt
      p.z += this.shoveZ * dt
      const f = Math.pow(0.08, dt)
      this.shoveX = Math.abs(this.shoveX) < 0.2 ? 0 : this.shoveX * f
      this.shoveZ = Math.abs(this.shoveZ) < 0.2 ? 0 : this.shoveZ * f
    }
    if (w.smash(p.x, p.z, RADIUS) > 0) {
      car.scrubSpeed(0.93)
      this.events?.smashed(this)
    }
    this.follow()
    if (w.wallRides.length && !this.air && this.catchWall()) return
    if (!this.air && Math.abs(this.path.tilt(this.pi)) > 0.04) { this.startTwist(); return }
    // up the wall of a half-pipe: gravity pulls you back down towards the middle
    if (!this.air && this.path.pipe[this.pi]) {
      const c = this.path, i = this.pi, s = c.samples[i]!, r = c.rights[i]!
      const lat = (p.x - s.x) * r.x + (p.z - s.z) * r.z
      const slope = (c.lift(i, lat + 0.3) - c.lift(i, lat - 0.3)) / 0.6
      if (slope) {
        const g = (w.def.gravity ?? GRAVITY) * 0.32 * slope / Math.sqrt(1 + slope * slope)
        p.x -= r.x * g * dt * 3
        p.z -= r.z * g * dt * 3
        // swooping back down off a high wall: a pump of speed
        if (Math.abs(slope) > 0.8) car.surge = Math.max(car.surge, 0.06)
      }
    }
    this.edgeRail()
    this.onRails(dt, input, drive)
    this.checkLoop(prevPath, prevPi)

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
      // inside a tube: never up through its roof
      if (w.def.airCeiling !== undefined) {
        const top = this.path.samples[this.pi]!.y + w.def.airCeiling
        if (p.y > top) { p.y = top; this.vy = Math.min(this.vy, 0) }
      }
      this.airTime += dt
      if (w.vines.length && !this.gliding && this.catchVine(input)) return
      const wantTrick = this.isPlayer ? tap : this.aiTrick > 0 && this.airTime > this.aiTrick
      if (wantTrick && !this.tricked && !spinning && this.airTime < 0.9) {
        this.tricked = true
        this.trickT = TRICK_TIME
        this.aiTrick = 0
      }
      this.trickT = Math.max(0, this.trickT - dt)
      // coming down beside a cliff: ground well above you is a wall, not a floor to snap up onto
      const cliff = p.y <= gy && !this.onRoad && gy - p.y > 1.5
      if (cliff) {
        p.x = prevX
        p.z = prevZ
        this.scrape(...awayFrom(prevX, prevZ, w))
        this.groundY = this.groundAt(p.x, p.z, p.y)
      }
      if (p.y <= gy && !cliff) {
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
        // launched off a kicker deck: a burst on top
        if (this.carried?.kick) { car.kick(1.08); this.events?.boosted(this) }
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

    // onto a moving deck: your speed is now measured against it; off it: you keep what it gave you
    const now = this.air ? this.carried : this.platform
    if (now !== this.carried) {
      if (this.carried) car.setSpeed(car.getSpeed() + this.along(this.carried, this.carriedV))
      if (now) car.setSpeed(car.getSpeed() - this.along(now))
      this.carried = now
    }
    // the deck's velocity as you left it: it may slow down under you, but you don't
    if (this.carried && !this.air) { this.carriedV.x = this.carried.vx; this.carriedV.z = this.carried.vz }

    // how the ground feels
    const under2 = this.onRoad
    this.surface = under2 ? 'concrete' : w.surfaceAt(p.x, p.z)
    if (!this.air) {
      car.topBonus = under2 ? 1 : TOP_ON[this.surface]
      car.surfaceDrag = under2 ? 0 : 12
      const rp = this.roadPath
      const deck = this.platform || !rp ? 0 : rp.deck[this.roadI]
      car.surfaceSlip = !under2 && this.surface === 'mud' ? 0.55 : !under2 && this.surface === 'snow' ? 0.35 : !under2 ? 0.15
        : Math.max(this.roadSlip, deck === ICE ? 0.5 : deck === DIRT ? 0.24 : 0)
      // mud or flood water lying on the road: slower and slippery
      if (under2) {
        const patch = w.patchAt(p.x, p.z)
        if (patch === 'mud' || patch === 'snow') { car.topBonus = 0.8; car.surfaceSlip = Math.max(car.surfaceSlip, 0.45) }
      }
      // a boost strip kicks anyone who crosses it
      if (under2 && !this.platform && rp && rp.pad[this.roadI] && Math.abs(this.roadLat - rp.padLat[this.roadI]!) < 4 && this.padCool <= 0) {
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
      const lat = (p.x - c.samples[this.pi]!.x) * c.rights[this.pi]!.x + (p.z - c.samples[this.pi]!.z) * c.rights[this.pi]!.z
      const wall = c.pipe[this.pi] ? (c.lift(this.pi, lat + 0.3) - c.lift(this.pi, lat - 0.3)) / 0.6 : 0
      car.mesh.rotation.z = THREE.MathUtils.lerp(car.mesh.rotation.z, Math.atan(Math.tan(c.banks[this.pi]!) + wall), Math.min(1, dt * 8))
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
    // pushing against something and going nowhere (but not waiting at a gate on purpose)
    this.waiting -= dt
    if (this.waiting > 0) { this.watchT = 0; this.watchAt = this.progress }
    this.stuck = Math.abs(this.car.getSpeed()) < 1.5 && !this.isPlayer && this.spin <= 0 && this.waiting <= 0 ? this.stuck + dt : 0
    // shuffling about without getting anywhere: the drone lifts you out.
    // Rivals get six seconds; you get ten, in case you meant it.
    this.watchT += dt
    if (this.watchT > (this.isPlayer ? 10 : 6)) {
      const moved = Math.abs(this.progress - this.watchAt)
      this.watchT = 0
      this.watchAt = this.progress
      if (moved < (this.isPlayer ? 25 : 30) && !this.finished) { this.startRescue(); return }
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
    // a road that's shut: back to the main road before it
    if (c.shut && c.join) { from = c.join.from; c = this.circuit }
    let i = c.closed ? (from - 6 + c.count) % c.count : Math.max(0, from - 6)
    // never put down over a gap, or on a twist
    for (let k = 0; k < 60 && (c.gap[i] || Math.abs(c.tilt(i)) > 0.04); k++) i = c.closed ? (i - 1 + c.count) % c.count : Math.max(0, i - 1)
    // a jump just ahead: go back only far enough to get up to speed for it
    // (you're set down already rolling, so a short run-up does)
    const at = (j: number) => (c.closed ? ((j % c.count) + c.count) % c.count : Math.max(0, Math.min(c.count - 1, j)))
    this.rescueSpeed = 14
    for (let k = 0; k < 40; k++) {
      if (!c.gap[at(i + k)]) continue
      this.rescueSpeed = 30
      if (k >= 32) break
      const want = i + k - 34
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
    this.looping = false
    this.swingV = null
    this.wallR = null
    this.twistC = null
    this.carried = null
    this.platform = null
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
      car.setSpeed(this.rescueSpeed)
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

export const RESCUE_TIME = 2.2
const NO_INPUT: InputState = { accelerate: false, brake: false, left: false, right: false }

function awayFrom(x: number, z: number, w: World): [number, number] {
  const e = 3
  const dx = w.terrainAt(x - e, z) - w.terrainAt(x + e, z), dz = w.terrainAt(x, z - e) - w.terrainAt(x, z + e)
  const l = Math.hypot(dx, dz) || 1
  return [dx / l, dz / l]
}
