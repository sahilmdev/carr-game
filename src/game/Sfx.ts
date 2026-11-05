/**
 * World sound, all synthesized: one-shot effects, looping roars that follow a
 * danger level, and an ambient bed per area that crossfades as you drive.
 */
export type SfxName =
  | 'crack' | 'shatter' | 'grate' | 'boom' | 'eruption' | 'whumpf' | 'thud' | 'ring' | 'gust'
  | 'rocketLaunch' | 'rockfall' | 'rockImpact' | 'sting' | 'fail' | 'whale' | 'splash' | 'firework' | 'cheer' | 'meltdown'
export type LoopName = 'lava' | 'avalanche' | 'storm' | 'rocket' | 'crowd'
type BedName = 'sea' | 'deep' | 'space' | 'wind' | 'magma' | 'insects' | 'city'

/** Ambient mix per area: bed levels, plus how bright the wind sounds. */
const AMBIENCE: Record<string, { beds: Partial<Record<BedName, number>>; windHz?: number }> = {
  town: { beds: { sea: 0.3, wind: 0.15 }, windHz: 500 },
  coast: { beds: { sea: 0.85, wind: 0.25 }, windHz: 700 },
  causeway: { beds: { sea: 1, wind: 0.35 }, windHz: 800 },
  underwater: { beds: { deep: 1 } },
  rampUp: { beds: { sea: 0.4, wind: 0.3 }, windHz: 900 },
  flight1: { beds: { space: 0.7, wind: 0.3 }, windHz: 1200 },
  space: { beds: { space: 1 } },
  flight2: { beds: { space: 0.5, wind: 0.5 }, windHz: 1100 },
  canyon: { beds: { wind: 0.55 }, windHz: 550 },
  loop: { beds: { wind: 0.5 }, windHz: 600 },
  volcano: { beds: { magma: 1, wind: 0.25 }, windHz: 380 },
  desert: { beds: { wind: 0.45 }, windHz: 850 },
  saltflat: { beds: { wind: 0.3 }, windHz: 1300 },
  snow: { beds: { wind: 0.75 }, windHz: 1250 },
  sky: { beds: { wind: 0.9 }, windHz: 800 },
  roll: { beds: { wind: 0.9 }, windHz: 800 },
  flight3: { beds: { wind: 1 }, windHz: 1000 },
  jungle: { beds: { insects: 1, wind: 0.12 }, windHz: 450 },
  city: { beds: { city: 1 } },
}

export class SoundFx {
  private readonly loops = new Map<LoopName, GainNode>()
  private readonly beds = new Map<BedName, GainNode>()
  private windFilter: BiquadFilterNode | null = null
  private zone = ''
  private nextBird = 2
  private nextBubble = 1
  private nextHorn = 6

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode, private readonly noise: AudioBuffer) {
    this.buildBeds()
  }

  // ── building blocks ──

  private looped(type: BiquadFilterType, freq: number, q: number, to: AudioNode, level = 1): BiquadFilterNode {
    const c = this.ctx
    const src = c.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = c.createGain()
    g.gain.value = level
    src.connect(f)
    f.connect(g)
    g.connect(to)
    src.start(0, Math.random())
    return f
  }

  /** Slowly wobble an audio parameter. */
  private lfo(rate: number, depth: number, target: AudioParam): void {
    const o = this.ctx.createOscillator()
    o.frequency.value = rate
    const g = this.ctx.createGain()
    g.gain.value = depth
    o.connect(g)
    g.connect(target)
    o.start()
  }

  private bus(level = 0): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = level
    g.connect(this.out)
    return g
  }

  /** A short burst of filtered noise; frequency sweeps f0 → f1. */
  private burst(type: BiquadFilterType, f0: number, f1: number, q: number, vol: number, attack: number, decay: number, at = 0): void {
    const c = this.ctx, t = c.currentTime + at
    const src = c.createBufferSource()
    src.buffer = this.noise
    const f = c.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    src.connect(f)
    f.connect(g)
    g.connect(this.out)
    src.start(t, Math.random())
    src.stop(t + attack + decay + 0.05)
  }

  /** A tone gliding f0 → f1. */
  private tone(type: OscillatorType, f0: number, f1: number, vol: number, dur: number, at = 0, attack = 0.005): void {
    const c = this.ctx, t = c.currentTime + at
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(this.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  // ── one-shots ──

  /** @param vol 0–1 loudness; @param pitch semitones up (chimes) */
  play(name: SfxName, vol = 1, pitch = 0): void {
    const v = Math.max(0, Math.min(1, vol))
    if (v < 0.02) return
    const r = Math.random
    switch (name) {
      case 'crack':
        for (const [d, a] of [[0, 1], [0.07, 0.7], [0.15, 0.85], [0.34, 0.6], [0.5, 0.9]] as const) {
          this.burst('bandpass', 3800 + r() * 2400, 2600, 5, 0.8 * a * v, 0.002, 0.05, d)
          this.tone('sine', 2100 + r() * 1800, 1500, 0.2 * a * v, 0.05, d)
        }
        break
      case 'shatter':
        this.burst('highpass', 2600, 5200, 0.7, 0.42 * v, 0.004, 0.75)
        this.burst('lowpass', 900, 200, 0.7, 0.34 * v, 0.004, 0.2)
        for (let k = 0; k < 18; k++) {
          const f = 2800 + r() * 5200
          this.tone(k % 2 ? 'sine' : 'triangle', f, f * 0.97, (0.04 + r() * 0.07) * v, 0.08 + r() * 0.22, r() * 0.8)
        }
        break
      case 'grate':
        for (let k = 0; k < 8; k++) {
          this.tone('square', 150 + r() * 70, 110, 0.24 * v, 0.05, k * 0.045)
          this.burst('bandpass', 1400, 900, 3, 0.16 * v, 0.002, 0.04, k * 0.045)
        }
        break
      case 'boom':
        this.tone('sine', 72, 30, 0.6 * v, 0.9)
        this.burst('lowpass', 900, 90, 0.8, 0.5 * v, 0.006, 1.1)
        this.burst('bandpass', 1300, 500, 1, 0.2 * v, 0.003, 0.18)
        break
      case 'eruption':
        this.tone('sine', 58, 25, 0.7 * v, 2.8, 0, 0.05)
        this.burst('lowpass', 620, 70, 0.8, 0.6 * v, 0.05, 3.2)
        this.burst('bandpass', 1500, 400, 0.8, 0.22 * v, 0.02, 1.4)
        break
      case 'whumpf':
        this.tone('sine', 95, 38, 0.55 * v, 0.8)
        this.burst('lowpass', 300, 70, 0.8, 0.55 * v, 0.03, 1.2)
        for (let k = 0; k < 6; k++) this.burst('bandpass', 1800, 900, 3, 0.1 * v, 0.002, 0.05, 0.2 + r() * 0.6)
        break
      case 'thud':
        this.tone('sine', 125, 52, 0.5 * v, 0.28)
        this.burst('lowpass', 800, 150, 0.7, 0.32 * v, 0.003, 0.3)
        break
      case 'ring': {
        const f = 880 * Math.pow(2, pitch / 12)
        this.tone('sine', f, f, 0.2 * v, 0.55)
        this.tone('sine', f * 1.5, f * 1.5, 0.12 * v, 0.7, 0.05)
        this.tone('triangle', f * 2, f * 2, 0.05 * v, 0.35, 0.09)
        break
      }
      case 'gust':
        this.burst('bandpass', 380, 1500, 1.6, 0.7 * v, 0.42, 0.9)
        this.burst('highpass', 3000, 5000, 0.7, 0.1 * v, 0.3, 0.9)
        break
      case 'rocketLaunch':
        this.tone('sawtooth', 55, 190, 0.2 * v, 1.3, 0, 0.1)
        this.burst('bandpass', 280, 2400, 0.8, 0.5 * v, 0.12, 1.4)
        this.burst('lowpass', 500, 120, 0.8, 0.5 * v, 0.02, 1.2)
        break
      case 'rockfall':
        this.burst('lowpass', 260, 90, 0.8, 0.7 * v, 0.2, 1)
        for (let k = 0; k < 9; k++) {
          const d = r() * 1.05
          this.burst('bandpass', 380 + r() * 560, 250, 2.5, (0.34 + r() * 0.3) * v, 0.002, 0.09, d)
        }
        break
      case 'rockImpact':
        this.tone('sine', 105, 40, 0.5 * v, 0.4)
        this.burst('lowpass', 950, 130, 0.7, 0.46 * v, 0.003, 0.55)
        for (let k = 0; k < 5; k++) this.burst('bandpass', 640 + r() * 900, 350, 2.5, 0.15 * v, 0.002, 0.08, r() * 0.25)
        break
      case 'sting':
        for (const [k, f] of [523, 659, 784, 1047].entries()) {
          this.tone('triangle', f, f, 0.18 * v, 0.42, k * 0.075)
          this.tone('sine', f * 2, f * 2, 0.05 * v, 0.3, k * 0.075)
        }
        break
      case 'fail':
        this.tone('triangle', 330, 318, 0.16 * v, 0.28)
        this.tone('triangle', 233, 220, 0.16 * v, 0.5, 0.2)
        break
      case 'splash':
        this.burst('lowpass', 2400, 180, 0.7, 0.9 * v, 0.01, 0.7)
        this.burst('highpass', 3000, 1500, 0.6, 0.3 * v, 0.02, 1.1, 0.05)
        break
      case 'firework':
        this.tone('sine', 300, 1300, 0.05 * v, 0.5)
        this.burst('lowpass', 900, 70, 1, 0.8 * v, 0.004, 0.55, 0.5)
        for (let k = 0; k < 7; k++) this.burst('highpass', 4200, 2600, 1, 0.09 * v, 0.002, 0.08, 0.7 + r() * 0.7)
        break
      case 'cheer':
        this.burst('bandpass', 900, 1500, 0.5, 0.8 * v, 0.35, 3.2)
        this.burst('bandpass', 2100, 2800, 0.8, 0.28 * v, 0.3, 2.6, 0.1)
        break
      case 'meltdown':
        this.burst('lowpass', 1500, 50, 0.8, 1.1 * v, 0.006, 1.5)
        this.tone('sawtooth', 240, 42, 0.2 * v, 1.1)
        this.burst('highpass', 2600, 900, 0.7, 0.3 * v, 0.03, 1.4, 0.1)
        break
      case 'whale': {
        const f = 150 + r() * 60
        this.tone('sine', f, f * 2.1, 0.16 * v, 1.5, 0, 0.45)
        this.tone('sine', f * 2.1, f * 1.2, 0.13 * v, 1.9, 1.4, 0.2)
        this.tone('triangle', f * 1.01, f * 2.12, 0.04 * v, 1.5, 0.03, 0.45)
        break
      }
    }
  }

  // ── looping roars ──

  private buildLoop(name: LoopName): GainNode {
    const g = this.bus()
    const c = this.ctx
    if (name === 'lava') {
      this.looped('lowpass', 130, 1, g, 1.5)
      const crackle = this.looped('bandpass', 720, 2.5, g, 0.55)
      this.lfo(7, 260, crackle.frequency)
      const o = c.createOscillator()
      o.frequency.value = 38
      const og = c.createGain()
      og.gain.value = 0.32
      o.connect(og)
      og.connect(g)
      o.start()
    } else if (name === 'crowd') {
      const a = this.looped('bandpass', 760, 0.6, g, 1.5)
      this.lfo(0.37, 180, a.frequency)
      const b = this.looped('bandpass', 1700, 1.1, g, 0.6)
      this.lfo(0.71, 330, b.frequency)
      this.looped('lowpass', 240, 0.7, g, 0.5)
    } else if (name === 'avalanche') {
      this.looped('lowpass', 95, 1, g, 1.6)
      const roar = this.looped('lowpass', 520, 0.8, g, 0.8)
      this.lfo(0.9, 160, roar.frequency)
      this.looped('highpass', 3200, 0.6, g, 0.1)
    } else if (name === 'storm') {
      const howl = this.looped('bandpass', 880, 3, g, 1)
      this.lfo(0.31, 430, howl.frequency)
      const howl2 = this.looped('bandpass', 1500, 5, g, 0.45)
      this.lfo(0.47, 620, howl2.frequency)
      this.looped('highpass', 3600, 0.6, g, 0.22) // sand hissing on the bodywork
    } else {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = 74
      const f = c.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 420
      const og = c.createGain()
      og.gain.value = 0.32
      o.connect(f)
      f.connect(og)
      og.connect(g)
      o.start()
      this.lfo(23, 7, o.frequency)
      this.looped('bandpass', 1150, 0.7, g, 0.8)
      this.looped('lowpass', 190, 1, g, 1)
    }
    this.loops.set(name, g)
    return g
  }

  /** Level 0–1; created the first time it's needed. */
  setLoop(name: LoopName, level: number): void {
    const g = this.loops.get(name) ?? (level > 0 ? this.buildLoop(name) : null)
    if (!g) return
    const peak = name === 'storm' ? 0.3 : name === 'rocket' ? 0.24 : name === 'crowd' ? 0.34 : 0.3
    g.gain.setTargetAtTime(level * peak, this.ctx.currentTime, level > 0 ? 0.18 : 0.5)
  }

  silenceLoops(): void {
    for (const n of this.loops.keys()) this.setLoop(n, 0)
  }

  // ── ambience ──

  private buildBeds(): void {
    const c = this.ctx
    const add = (n: BedName): GainNode => { const g = this.bus(); this.beds.set(n, g); return g }

    const sea = add('sea')
    const swell = c.createGain()
    swell.gain.value = 0.6
    swell.connect(sea)
    this.looped('lowpass', 520, 0.7, swell, 1)
    this.looped('highpass', 2600, 0.6, swell, 0.1)
    this.lfo(0.13, 0.38, swell.gain) // waves rolling in

    const deep = add('deep')
    const dF = this.looped('lowpass', 200, 1.2, deep, 1.6)
    this.lfo(0.08, 70, dF.frequency)

    const space = add('space')
    for (const [f, l] of [[55, 0.5], [55.4, 0.5], [82.6, 0.28], [164, 0.08]] as const) {
      const o = c.createOscillator()
      o.frequency.value = f
      const g = c.createGain()
      g.gain.value = l
      o.connect(g)
      g.connect(space)
      o.start()
    }

    const wind = add('wind')
    this.windFilter = this.looped('bandpass', 700, 1.1, wind, 1)
    this.lfo(0.21, 190, this.windFilter.frequency)

    const magma = add('magma')
    this.looped('lowpass', 85, 1.2, magma, 2)
    const fizz = this.looped('bandpass', 1100, 3, magma, 0.14)
    this.lfo(5, 420, fizz.frequency)

    const insects = add('insects')
    const buzz = c.createGain()
    buzz.gain.value = 0.5
    buzz.connect(insects)
    this.looped('bandpass', 5200, 7, buzz, 0.55)
    this.lfo(8.5, 0.42, buzz.gain) // cicada pulse

    const city = add('city')
    this.looped('lowpass', 240, 1, city, 1.2)
    const traffic = this.looped('bandpass', 620, 0.8, city, 0.3)
    this.lfo(0.11, 200, traffic.frequency)
  }

  /** Crossfade to an area's ambience. */
  setZone(zone: string): void {
    if (zone === this.zone) return
    this.zone = zone
    const a = AMBIENCE[zone] ?? AMBIENCE['town']!
    const t = this.ctx.currentTime
    const peaks: Record<BedName, number> = { sea: 0.24, deep: 0.17, space: 0.032, wind: 0.11, magma: 0.17, insects: 0.2, city: 0.1 }
    for (const [n, g] of this.beds) g.gain.setTargetAtTime((a.beds[n] ?? 0) * peaks[n], t, 1.1)
    if (a.windHz) this.windFilter?.frequency.setTargetAtTime(a.windHz, t, 1.2)
  }

  /** Occasional life on top of the beds: birds, bubbles, far-off horns, whales. */
  update(dt: number): void {
    const r = Math.random
    if (this.zone === 'jungle') {
      this.nextBird -= dt
      if (this.nextBird <= 0) {
        this.nextBird = 0.8 + r() * 2.4
        const f = 1900 + r() * 1700
        const notes = 2 + Math.floor(r() * 4)
        for (let k = 0; k < notes; k++) this.tone('sine', f * (1 + r() * 0.25), f * (0.8 + r() * 0.3), 0.035 + r() * 0.03, 0.09, k * 0.13)
      }
    } else if (this.zone === 'underwater') {
      this.nextBubble -= dt
      if (this.nextBubble <= 0) {
        this.nextBubble = 0.5 + r() * 2
        for (let k = 0; k < 4; k++) { const f = 320 + r() * 500; this.tone('sine', f, f * 1.9, 0.03, 0.07, k * (0.05 + r() * 0.06)) }
        if (r() < 0.12) this.play('whale', 0.55)
      }
    } else if (this.zone === 'city') {
      this.nextHorn -= dt
      if (this.nextHorn <= 0) {
        this.nextHorn = 5 + r() * 8
        const f = 300 + r() * 160
        this.tone('sawtooth', f, f, 0.012, 0.4, 0, 0.03)
        this.tone('sawtooth', f * 1.26, f * 1.26, 0.009, 0.4, 0, 0.03)
      }
    }
  }
}
