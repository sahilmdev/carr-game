import type { Track } from '../Track'
import type { BiomeEvents, FrameCtx } from './types'
import type { SfxName, LoopName } from '../Sfx'

export interface ChaseOpts {
  label: string
  loop: LoopName
  startSfx: SfxName
  caughtSfx: SfxName
  /** Danger colour for the HUD (CSS). */
  color: string
  startText: string
  caughtText: string
  /** Start text is shown once the car enters; end text gets the metres of lead. */
  endText: (lead: number) => string
  startGap: number
  /** The front's speed when `gap` equals `holdGap` (m/s). */
  base: number
  holdGap: number
  /** Replaces the normal catch: called each time it reaches the car. */
  onCatch?: (ev: BiomeEvents) => void
  /** Extra HUD text and a floor for the danger level (the volcano's heat). */
  status?: () => { text: string; level: number }
}

/**
 * Something racing up the road behind the car (lava, an avalanche). It speeds
 * up when far back and eases off when close, so at full speed it stays on your
 * heels without catching you, while a crash or a bad line lets it through.
 */
export class Chase {
  private readonly order = new Map<number, number>()
  private readonly cum: number[] = []
  running = false
  /** Metres along the stretch. */
  front = 0
  gap = 0
  carK = 0
  private lastCar = 0
  /** It holds still after catching you, so you can get going again. */
  private pause = 0
  private catches = 0

  constructor(track: Track, readonly ids: number[], private readonly o: ChaseOpts) {
    let d = 0
    ids.forEach((i, k) => {
      if (k > 0) d += track.samples[i]!.distanceTo(track.samples[ids[k - 1]!]!)
      this.cum.push(d)
      this.order.set(i, k)
    })
  }

  /** Drop the front back behind the car and hold it there for a moment. */
  setBack(metres: number, seconds: number): void {
    this.front = this.cum[this.carK]! - metres
    this.gap = metres
    this.pause = seconds
  }

  /** Index into `ids` at `m` metres along the stretch. */
  kAt(m: number): number {
    let a = 0, b = this.cum.length - 1
    while (a < b) {
      const c = (a + b + 1) >> 1
      if (this.cum[c]! <= m) a = c
      else b = c - 1
    }
    return a
  }

  /** Returns true on the frame the car escapes the end of the stretch. */
  update(f: FrameCtx, ev: BiomeEvents): boolean {
    const k = this.order.get(f.carIdx)
    if (k === undefined) {
      if (!this.running) return false
      this.running = false
      ev.danger(null, 0, this.o.color)
      ev.loop(this.o.loop, 0)
      // left through the far end, not by restarting the race
      if (this.lastCar < this.cum[this.cum.length - 1]! - 60) return false
      ev.toast(this.o.endText(Math.round(this.gap)), 'best')
      ev.sfx('sting')
      ev.refill()
      return true
    }
    const car = this.cum[k]!
    this.carK = k
    this.lastCar = car
    if (!this.running) {
      if (k > 12) return false // joined part-way (a reset): leave it alone
      this.running = true
      this.front = car - this.o.startGap
      this.pause = 0
      this.catches = 0
      ev.toast(this.o.startText)
      ev.sfx(this.o.startSfx)
    }
    this.gap = car - this.front
    const v = Math.min(82, Math.max(38, this.o.base + (this.gap - this.o.holdGap) * 0.35))
    this.pause = Math.max(0, this.pause - f.dt)
    if (this.pause === 0) this.front += v * f.dt
    if (this.gap <= 0) {
      if (this.o.onCatch) {
        this.o.onCatch(ev)
        this.pause = 3
      } else if (this.catches < 2) {
        this.catches++
        ev.hit(1)
        ev.toast(this.o.caughtText)
        ev.sfx(this.o.caughtSfx)
        this.pause = 4
      }
      // two catches per stretch at most: after that it only keeps you moving
      this.front = car - 55
      this.gap = 55
    }
    const st = this.o.status?.()
    const level = Math.max(st?.level ?? 0, Math.min(1, 1 - this.gap / 95))
    ev.danger(this.o.label + '  ' + Math.round(this.gap) + ' M' + (st?.text ? '  ' + st.text : ''), level, this.o.color)
    ev.rumble(level * level * 0.5 * f.dt * 6)
    ev.loop(this.o.loop, 0.35 + 0.65 * level)
    return false
  }
}
