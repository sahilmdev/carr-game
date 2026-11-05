/**
 * Fully synthesized WebAudio — no audio files needed.
 *
 * Driving sound is layered like a real car recording:
 *  - engine: harmonic oscillators at the firing frequency of a simulated
 *    V8 (rpm from a 6-speed gearbox, with shift dips), soft-clipped for grit
 *    and opened up by throttle
 *  - intake roar: band-passed noise that rises with throttle and rpm
 *  - tyre squeal: narrow band-passed noise driven by sideways slip / braking
 *  - wind: low-passed noise growing with speed²
 *  - gravel rumble: deep noise when running off the road edge
 * Plus the UI blips (countdown, checkpoints, finish).
 */
import { SoundFx, type SfxName, type LoopName } from './Sfx'

export interface DrivingSound {
  /** 0–1 normalized speed */
  speed: number
  /** 0/1 throttle pressed */
  throttle: number
  /** 0–1 sideways slip (or brake lock-up) */
  slip: number
  /** 0–1 how far off the road edge */
  offroad: number
}

/** Upper normalized-speed limit of each gear (6-speed box). */
const GEARS = [0.13, 0.26, 0.41, 0.57, 0.76, 1.0]
const IDLE_RPM = 900
const REDLINE = 7200

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private muted = false
  private volume = 0.8

  private engine: {
    oscs: OscillatorNode[]
    harmonics: number[]
    filter: BiquadFilterNode
    gain: GainNode
    intake: BiquadFilterNode
    intakeGain: GainNode
    squeal: BiquadFilterNode
    squealGain: GainNode
    wind: BiquadFilterNode
    windGain: GainNode
    rumble: BiquadFilterNode
    rumbleGain: GainNode
    sources: AudioBufferSourceNode[]
  } | null = null

  private fx: SoundFx | null = null
  private water: BiquadFilterNode | null = null
  private echo: GainNode | null = null
  private rainLevel = 0
  private rainGain: GainNode | null = null

  private gear = 0
  private rpm = IDLE_RPM
  private shiftUntil = 0

  /** Must be called from a user gesture (Start click). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    // Gentle bus compression keeps the layers from clipping together
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    // Everything passes one filter (dull under water, thin in space) and can
    // send to a generated echo for tunnels
    this.water = this.ctx.createBiquadFilter()
    this.water.type = 'lowpass'
    this.water.frequency.value = 20000
    this.master.connect(this.water)
    const conv = this.ctx.createConvolver()
    conv.buffer = this.tunnelImpulse()
    this.echo = this.ctx.createGain()
    this.echo.gain.value = 0
    this.master.connect(conv)
    conv.connect(this.echo)
    this.echo.connect(this.water)
    this.water.connect(comp)
    comp.connect(this.ctx.destination)

    const len = this.ctx.sampleRate * 2
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.fx = new SoundFx(this.ctx, this.master, this.noise)
    this.setRain(this.rainLevel)
  }

  /** A decaying noise tail: what a concrete tunnel does to a sound. */
  private tunnelImpulse(): AudioBuffer {
    const c = this.ctx!
    const len = Math.floor(c.sampleRate * 1.3)
    const b = c.createBuffer(2, len, c.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    return b
  }

  sfx(name: SfxName, vol = 1, pitch = 0): void { this.fx?.play(name, vol, pitch) }
  setLoop(name: LoopName, level: number): void { this.fx?.setLoop(name, level) }

  /** Per frame: area ambience, how submerged / in space the camera is, and whether it's in a tunnel. */
  setWorld(zone: string, underwater: number, space: number, enclosed: boolean, dt: number): void {
    if (!this.ctx || !this.fx || !this.water || !this.echo) return
    this.fx.setZone(zone)
    this.fx.update(dt)
    const t = this.ctx.currentTime
    const hz = 20000 * Math.pow(650 / 20000, underwater) * Math.pow(2600 / 20000, space)
    this.water.frequency.setTargetAtTime(hz, t, 0.12)
    this.echo.gain.setTargetAtTime(enclosed ? 0.28 : 0, t, 0.25)
  }

  /**
   * Rain ambience: a bright hiss (drops on surfaces) over a soft low wash.
   * Runs independently of the engine so it's heard on the menu too.
   */
  setRain(level: number): void {
    this.rainLevel = level
    if (!this.ctx || !this.master || !this.noise) return
    if (!this.rainGain) {
      const hiss = this.noiseThrough('highpass', 2500, 0.5)
      const wash = this.noiseThrough('lowpass', 500, 0.6)
      const sum = this.ctx.createGain()
      sum.gain.value = 0
      hiss.gain.disconnect(); wash.gain.disconnect()
      hiss.gain.gain.value = 0.55
      wash.gain.gain.value = 0.8
      hiss.gain.connect(sum); wash.gain.connect(sum)
      sum.connect(this.master)
      this.rainGain = sum
    }
    this.rainGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.4)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05)
    }
  }

  /** Freeze all sound (game paused) without touching the mute setting. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return
    if (paused) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  /** Master volume 0–1 (settings). */
  setVolume(v: number): void {
    this.volume = v
    this.setMuted(this.muted)
  }

  isMuted(): boolean { return this.muted }

  private noiseThrough(filterType: BiquadFilterType, freq: number, q: number): { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master!)
    src.start()
    return { src, filter, gain }
  }

  startEngine(): void {
    if (!this.ctx || !this.master || this.engine) return
    const ctx = this.ctx

    // Soft-clip for a gritty, mechanical edge
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 2.2)
    }
    shaper.curve = curve

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 1.4
    filter.frequency.value = 500
    const gain = ctx.createGain()
    gain.gain.value = 0
    shaper.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)

    // Firing frequency harmonics: sub, fundamental, 2nd, 3rd (half-order adds lumpiness)
    const harmonics = [0.5, 1, 2, 3]
    const types: OscillatorType[] = ['sine', 'sawtooth', 'square', 'sawtooth']
    const levels = [0.5, 0.55, 0.18, 0.08]
    const oscs = harmonics.map((_, i) => {
      const o = ctx.createOscillator()
      o.type = types[i]!
      const g = ctx.createGain()
      g.gain.value = levels[i]!
      o.connect(g)
      g.connect(shaper)
      o.start()
      return o
    })

    const intake = this.noiseThrough('bandpass', 400, 1.1)
    const squeal = this.noiseThrough('bandpass', 1150, 9)
    const wind = this.noiseThrough('lowpass', 700, 0.7)
    const rumble = this.noiseThrough('lowpass', 160, 1.2)

    this.engine = {
      oscs, harmonics, filter, gain,
      intake: intake.filter, intakeGain: intake.gain,
      squeal: squeal.filter, squealGain: squeal.gain,
      wind: wind.filter, windGain: wind.gain,
      rumble: rumble.filter, rumbleGain: rumble.gain,
      sources: [intake.src, squeal.src, wind.src, rumble.src],
    }
    this.gear = 0
    this.rpm = IDLE_RPM
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.4)
  }

  stopEngine(): void {
    this.fx?.silenceLoops()
    if (!this.ctx || !this.engine) return
    const e = this.engine
    const t = this.ctx.currentTime
    for (const g of [e.gain, e.intakeGain, e.squealGain, e.windGain, e.rumbleGain]) g.gain.setTargetAtTime(0, t, 0.15)
    setTimeout(() => {
      for (const o of e.oscs) o.stop()
      for (const s of e.sources) s.stop()
    }, 700)
    this.engine = null
  }

  /** Simple form used outside racing (countdown rev, finish coast-down). */
  updateEngine(normalizedSpeed: number): void {
    this.updateDriving({ speed: normalizedSpeed, throttle: normalizedSpeed > 0.04 ? 0.6 : 0, slip: 0, offroad: 0 })
  }

  /** Called every frame while driving. */
  updateDriving(s: DrivingSound): void {
    if (!this.ctx || !this.engine) return
    const e = this.engine
    const t = this.ctx.currentTime

    // ── Gearbox → rpm ──
    let g = GEARS.findIndex((top) => s.speed <= top)
    if (g < 0) g = GEARS.length - 1
    if (g > this.gear) this.shiftUntil = t + 0.14 // upshift: brief throttle cut
    this.gear = g
    const lo = g === 0 ? 0 : GEARS[g - 1]!
    const hi = GEARS[g]!
    const inGear = (s.speed - lo) / (hi - lo)
    const base = g === 0 ? IDLE_RPM : REDLINE * 0.55
    // Top gear is the cruising gear: flat out it sits at ~86% of redline
    // instead of bouncing off the limiter for the whole lap.
    const top = g === GEARS.length - 1 ? REDLINE * 0.86 : REDLINE
    const lug = 1 - s.slip * 0.06 // engine labours a little when the tyres are loaded
    const targetRpm = Math.max(IDLE_RPM, base + inGear * (top - base)) * (s.throttle ? 1 : 0.9) * lug
    this.rpm += (targetRpm - this.rpm) * 0.25

    // V8 four-stroke: 4 firing pulses per revolution
    const fire = (this.rpm / 60) * 4 * 0.5 // halved so the fundamental sits in a car-like range
    e.oscs.forEach((o, i) => o.frequency.setTargetAtTime(fire * e.harmonics[i]!, t, 0.03))

    const shifting = t < this.shiftUntil
    const load = shifting ? 0.25 : s.throttle ? 1 : 0.35
    const rpmN = (this.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM)
    e.filter.frequency.setTargetAtTime(350 + load * (600 + rpmN * 2200), t, 0.05)
    e.gain.gain.setTargetAtTime((0.09 + rpmN * 0.08) * (0.6 + load * 0.4), t, 0.05)

    // Intake roar
    e.intake.frequency.setTargetAtTime(fire * 3.5, t, 0.05)
    e.intakeGain.gain.setTargetAtTime(load * rpmN * 0.09, t, 0.08)

    // Tyre squeal: pitch wobbles a little like real rubber
    const squeal = Math.max(0, Math.min(1, (s.slip - 0.15) / 0.3)) * Math.min(1, s.speed * 4)
    e.squeal.frequency.setTargetAtTime(1050 + Math.random() * 250, t, 0.04)
    e.squealGain.gain.setTargetAtTime(squeal * 0.2, t, 0.06)

    // Wind grows with speed²
    e.wind.frequency.setTargetAtTime(500 + s.speed * 1400, t, 0.1)
    e.windGain.gain.setTargetAtTime(s.speed * s.speed * 0.1, t, 0.15)

    // Gravel rumble off the road
    e.rumbleGain.gain.setTargetAtTime(s.offroad * Math.min(1, s.speed * 3) * 0.25, t, 0.05)
  }

  private blip(freq: number, duration: number, type: OscillatorType = 'square', volume = 0.25): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t)
    osc.stop(t + duration)
  }

  playCountdownBeep(): void { this.blip(660, 0.18) }
  playGoBeep(): void { this.blip(990, 0.4) }
  playCheckpoint(): void { this.blip(1320, 0.12, 'sine', 0.3) }

  playFinish(): void {
    if (!this.ctx) return
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.3, 'square', 0.2), i * 130)
    })
  }

  /** Impact: a low thump plus a short burst of crunch noise. */
  /** Nitro ignition: a rising whoosh of filtered noise. */
  playBoost(): void {
    if (!this.ctx || !this.master || !this.noise) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.5
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.6)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
    src.connect(f)
    f.connect(g)
    g.connect(this.master)
    src.start(t, Math.random())
    src.stop(t + 0.95)
  }

  playCollision(): void {
    this.blip(90, 0.18, 'sine', 0.35)
    if (!this.ctx || !this.master || !this.noise) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 900
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.25, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    src.connect(f)
    f.connect(g)
    g.connect(this.master)
    src.start(t, Math.random())
    src.stop(t + 0.22)
  }
}
