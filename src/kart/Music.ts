/**
 * Race music, composed live: drums, bass, chords and a lead, scheduled just
 * ahead of the clock. Each track has its own key, tempo and instrument
 * colour, and the band plays fuller the faster you go.
 */
interface Theme { bpm: number; root: number; scale: number[]; chords: number[]; wave: OscillatorType; leadWave: OscillatorType; swing?: number; sparse?: boolean }

const MINOR = [0, 2, 3, 5, 7, 8, 10]
const DORIAN = [0, 2, 3, 5, 7, 9, 10]
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const PENTA = [0, 3, 5, 7, 10, 12, 15]
const JAPAN = [0, 1, 5, 7, 8, 12, 13]

const THEMES: Record<string, Theme> = {
  bay: { bpm: 128, root: 45, scale: MAJOR, chords: [0, 5, 3, 4], wave: 'sawtooth', leadWave: 'triangle' },
  jungle: { bpm: 118, root: 43, scale: DORIAN, chords: [0, 3, 0, 6], wave: 'square', leadWave: 'triangle', swing: 0.12 },
  blossom: { bpm: 112, root: 40, scale: JAPAN, chords: [0, 3, 4, 3], wave: 'triangle', leadWave: 'sine', sparse: true },
  neon: { bpm: 138, root: 38, scale: MINOR, chords: [0, 5, 2, 6], wave: 'sawtooth', leadWave: 'square' },
  deep: { bpm: 100, root: 36, scale: MINOR, chords: [0, 2, 5, 4], wave: 'sine', leadWave: 'sine', sparse: true },
  goldrush: { bpm: 142, root: 41, scale: PENTA, chords: [0, 3, 0, 4], wave: 'triangle', leadWave: 'sawtooth', swing: 0.18 },
  bobsleigh: { bpm: 150, root: 42, scale: MINOR, chords: [0, 6, 5, 4], wave: 'sawtooth', leadWave: 'triangle' },
  sky: { bpm: 124, root: 47, scale: MAJOR, chords: [0, 4, 5, 3], wave: 'triangle', leadWave: 'sine' },
}

export class Music {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private theme: Theme | null = null
  private timer = 0
  private next = 0
  private step = 0
  private intensity = 0.4
  private volume = 0.6
  private noise: AudioBuffer | null = null
  private seed = 1

  private rand(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647 }

  setVolume(v: number): void {
    this.volume = v
    if (this.out) this.out.gain.value = v * 0.34
  }

  setIntensity(v: number): void { this.intensity = v }

  setPaused(on: boolean): void {
    if (!this.ctx) return
    void (on ? this.ctx.suspend() : this.ctx.resume())
  }

  start(id: string): void {
    this.stop()
    this.theme = THEMES[id] ?? THEMES['bay']!
    try {
      this.ctx ??= new AudioContext()
    } catch { return }
    const c = this.ctx
    void c.resume()
    this.out = c.createGain()
    this.out.gain.value = this.volume * 0.34
    const comp = c.createDynamicsCompressor()
    this.out.connect(comp).connect(c.destination)
    if (!this.noise) {
      this.noise = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    this.seed = id.length * 977 + 13
    this.step = 0
    this.next = c.currentTime + 0.1
    this.timer = window.setInterval(() => this.tick(), 60)
  }

  stop(): void {
    window.clearInterval(this.timer)
    this.timer = 0
    if (this.out && this.ctx) {
      const o = this.out
      o.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25)
      setTimeout(() => o.disconnect(), 1500)
    }
    this.out = null
    this.theme = null
  }

  private tick(): void {
    const c = this.ctx, t = this.theme
    if (!c || !t) return
    const sixteenth = 60 / t.bpm / 4
    while (this.next < c.currentTime + 0.18) {
      const swing = this.step % 2 ? sixteenth * (t.swing ?? 0) : 0
      this.play(this.step, this.next + swing, sixteenth)
      this.next += sixteenth
      this.step++
    }
  }

  private note(deg: number, oct = 0): number {
    const t = this.theme!, s = t.scale
    const i = ((deg % s.length) + s.length) % s.length
    return t.root + s[i]! + 12 * (oct + Math.floor(deg / s.length))
  }

  private tone(midi: number, at: number, len: number, wave: OscillatorType, vol: number, cut: number): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter()
    o.type = wave
    o.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    f.type = 'lowpass'
    f.frequency.setValueAtTime(cut, at)
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cut * 0.35), at + len)
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(vol, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0008, at + len)
    o.connect(f).connect(g).connect(this.out!)
    o.start(at)
    o.stop(at + len + 0.03)
  }

  private hit(at: number, len: number, vol: number, hp: number): void {
    const c = this.ctx!, s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter()
    s.buffer = this.noise
    f.type = 'highpass'
    f.frequency.value = hp
    g.gain.setValueAtTime(vol, at)
    g.gain.exponentialRampToValueAtTime(0.0008, at + len)
    s.connect(f).connect(g).connect(this.out!)
    s.start(at)
    s.stop(at + len + 0.02)
  }

  private kick(at: number): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain()
    o.frequency.setValueAtTime(130, at)
    o.frequency.exponentialRampToValueAtTime(42, at + 0.1)
    g.gain.setValueAtTime(0.9, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.24)
    o.connect(g).connect(this.out!)
    o.start(at)
    o.stop(at + 0.26)
  }

  private play(step: number, at: number, s: number): void {
    const t = this.theme!, bar = Math.floor(step / 16), b = step % 16
    const chord = t.chords[bar % t.chords.length]!
    const full = this.intensity
    // drums
    if (b % 4 === 0 && (!t.sparse || b % 8 === 0 || full > 0.6)) this.kick(at)
    if (b === 4 || b === 12) this.hit(at, 0.16, 0.34, 1300)
    if (b % 2 === 0 || full > 0.75) this.hit(at, 0.04, b % 4 === 2 ? 0.14 : 0.07, 7000)
    // bass: root and fifth
    const bassPat = t.sparse ? [0, 8, 11] : [0, 3, 6, 8, 11, 14]
    if (bassPat.includes(b)) this.tone(this.note(chord + (b === 11 ? 4 : 0), -1), at, s * 2.6, t.wave, 0.28, 520 + full * 700)
    // chords: three notes on the first beat of the half bar
    if (b === 0 || b === 8) for (const d of [0, 2, 4]) this.tone(this.note(chord + d, 1), at, s * 7, 'triangle', 0.055, 1500)
    // arpeggio comes in at speed
    if (full > 0.42 && b % 2 === 0) this.tone(this.note(chord + [0, 2, 4, 7, 4, 2, 0, 4][(b / 2) % 8]!, 2), at, s * 1.6, t.wave, 0.05 + full * 0.03, 1400 + full * 2200)
    // a lead that wanders over the chords on the second half of each phrase
    if (full > 0.6 && bar % 4 >= 2 && [0, 3, 6, 10, 12].includes(b) && this.rand() < 0.8) {
      this.tone(this.note(chord + Math.floor(this.rand() * 7), 2), at, s * 3.4, t.leadWave, 0.075, 3000)
    }
  }
}
