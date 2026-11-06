import type { Game } from '../game/Game'
import { CARS, CUPS, GRAND_TOUR, TRACKS, cupOpen, cupTrophies, saveCar, savedCar, trackById, type CarInfo, type CupInfo, type TrackInfo } from '../game/Catalog'
import { CHALLENGES, doneChallenges } from '../game/Progress'

type ScreenName = 'title' | 'car' | 'cups' | 'tracks' | 'trophies'
type Mode = 'gp' | 'single'

const CUP_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20v12a10 10 0 0 1-20 0V6Z"/><path d="M14 10H6v4a8 8 0 0 0 8 8M34 10h8v4a8 8 0 0 1-8 8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 28h6v7h-6zM14 36h20v6H14z"/></svg>'
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h2v11H5V10h2Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>'

/**
 * The way into a race: title, then car, then cup or track. Picking a track
 * plays it live behind the menu. Only the Grand Tour can be raced so far.
 */
export class Lobby {
  private readonly root = document.getElementById('lobby')!
  private readonly fade = document.getElementById('lobby-fade')!
  private readonly notice = document.getElementById('lobby-notice')!
  private screen: ScreenName = 'title'
  private mode: Mode = 'single'
  private cup = 0
  private track: TrackInfo = GRAND_TOUR
  private car: CarInfo = savedCar()
  private cycle = 0
  private previewing = ''

  constructor(private readonly game: Game, private readonly onRace: () => void) {
    this.on('go-gp', () => { this.mode = 'gp'; this.show('car') })
    this.on('go-single', () => { this.mode = 'single'; this.show('car') })
    this.on('go-trophies', () => this.show('trophies'))
    this.on('car-next', () => this.show(this.mode === 'gp' ? 'cups' : 'tracks'))
    this.on('cup-start', () => this.startCup())
    this.on('track-start', () => this.startTrack())
    this.on('notice-back', () => this.notice.classList.add('hidden'))
    this.on('notice-tour', () => {
      this.notice.classList.add('hidden')
      this.mode = 'single'
      this.show('tracks')
      this.pickTrack(GRAND_TOUR)
    })
    this.root.querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()))
    window.addEventListener('keydown', (e) => this.onKey(e))
    // sound can only start after the first press on the page
    window.addEventListener('pointerdown', () => this.game.audio.unlock(), { once: true })
    this.drawCars()
    this.show('title')
  }

  private on(id: string, fn: () => void): void {
    document.getElementById(id)!.addEventListener('click', fn)
  }

  get open(): boolean { return !document.getElementById('splash')!.classList.contains('hidden') }

  /** Back to the title after a race. */
  reset(): void {
    this.previewing = ''
    this.show('title')
  }

  private back(): void {
    if (!this.notice.classList.contains('hidden')) { this.notice.classList.add('hidden'); return }
    if (this.screen === 'cups' || this.screen === 'tracks') this.show('car')
    else if (this.screen !== 'title') this.show('title')
  }

  private show(s: ScreenName): void {
    window.clearInterval(this.cycle)
    this.screen = s
    this.root.querySelectorAll<HTMLElement>('.lobby-screen').forEach((el) => el.classList.toggle('active', el.dataset['screen'] === s))
    if (s === 'title' || s === 'car' || s === 'trophies') this.stopPreview()
    if (s === 'car') this.drawCars()
    if (s === 'cups') this.drawCups()
    if (s === 'tracks') this.drawTracks()
    if (s === 'trophies') this.drawTrophies()
    window.requestAnimationFrame(() => {
      const first = this.root.querySelector<HTMLElement>('.lobby-screen.active [data-primary]') ?? this.focusables()[0]
      first?.focus({ preventScroll: true })
    })
  }

  private focusables(): HTMLElement[] {
    const scope = this.notice.classList.contains('hidden') ? this.root.querySelector('.lobby-screen.active') : this.notice
    return Array.from(scope?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []).filter((b) => b.offsetParent !== null)
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return
    if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); this.back(); return }
    const step = e.code === 'ArrowRight' || e.code === 'ArrowDown' ? 1 : e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const list = this.focusables()
    if (!list.length) return
    const at = list.indexOf(document.activeElement as HTMLElement)
    list[(at + step + list.length) % list.length]!.focus()
  }

  // ── car ──
  private drawCars(): void {
    const list = document.getElementById('car-list')!
    list.innerHTML = ''
    for (const c of CARS) {
      const b = document.createElement('button')
      b.className = 'car-card'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(c.id === this.car.id))
      b.textContent = c.name
      b.addEventListener('click', () => this.pickCar(c))
      list.append(b)
    }
    document.getElementById('car-name')!.textContent = this.car.name
    document.getElementById('car-blurb')!.textContent = this.car.blurb
    const bars = document.getElementById('car-bars')!
    bars.innerHTML = ''
    for (const [label, v] of [['Top speed', this.car.bars.speed], ['Acceleration', this.car.bars.accel], ['Grip', this.car.bars.grip], ['Drift', this.car.bars.drift]] as const) {
      const row = document.createElement('div')
      row.className = 'stat-row'
      row.innerHTML = `<span>${label}</span><span class="stat-pips" role="img" aria-label="${v} out of 5">${'<i class="on"></i>'.repeat(v)}${'<i></i>'.repeat(5 - v)}</span>`
      bars.append(row)
    }
  }

  private pickCar(c: CarInfo): void {
    this.car = c
    saveCar(c.id)
    this.drawCars()
    void this.game.setCar(c)
    this.root.querySelector<HTMLElement>('.car-card[aria-checked="true"]')?.focus({ preventScroll: true })
  }

  // ── background preview ──
  private preview(t: TrackInfo): void {
    if (this.previewing === t.id) return
    this.previewing = t.id
    // a quick dip to black hides the jump to the other side of the world
    this.fade.classList.add('on')
    window.setTimeout(() => {
      if (this.previewing === t.id) this.game.startPreview(t.zone, t.at)
      window.setTimeout(() => this.fade.classList.remove('on'), 120)
    }, 220)
  }

  private stopPreview(): void {
    if (!this.previewing) return
    this.previewing = ''
    this.fade.classList.add('on')
    window.setTimeout(() => {
      this.game.stopPreview()
      window.setTimeout(() => this.fade.classList.remove('on'), 120)
    }, 220)
  }

  private tile(t: TrackInfo, onPick: () => void, selected: boolean): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'track-tile'
    b.style.setProperty('--a', t.tint[0])
    b.style.setProperty('--b', t.tint[1])
    b.setAttribute('aria-pressed', String(selected))
    b.innerHTML = `<span class="track-name">${t.name}</span>${t.concept ? '<span class="track-tag">New idea</span>' : ''}`
    b.addEventListener('click', onPick)
    return b
  }

  // ── cups ──
  private drawCups(): void {
    const box = document.getElementById('cup-list')!, won = cupTrophies()
    box.innerHTML = ''
    CUPS.forEach((c, k) => {
      const open = cupOpen(k), trophy = won[c.id]
      const b = document.createElement('button')
      b.className = 'cup-card'
      b.style.setProperty('--cup', c.color)
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(k === this.cup))
      b.classList.toggle('locked', !open)
      b.innerHTML = `<span class="cup-icon ${trophy ?? ''}">${open ? CUP_ICON : LOCK_ICON}</span><span class="cup-name">${c.name}</span><span class="cup-result">${open ? (trophy ?? 'No trophy yet') : 'Locked'}</span>`
      b.addEventListener('click', () => { this.cup = k; this.drawCups() })
      box.append(b)
    })
    this.drawCupDetail(CUPS[this.cup]!, cupOpen(this.cup))
  }

  private drawCupDetail(c: CupInfo, open: boolean): void {
    document.getElementById('cup-title')!.textContent = c.name
    document.getElementById('cup-tagline')!.textContent = open ? c.tagline : `Win any trophy in the ${CUPS[this.cup - 1]!.name} to unlock.`
    const races = document.getElementById('cup-races')!
    races.innerHTML = ''
    const show = (id: string) => {
      races.querySelectorAll('.track-tile').forEach((el, k) => el.setAttribute('aria-pressed', String(c.races[k] === id)))
      this.preview(trackById(id))
    }
    for (const id of c.races) races.append(this.tile(trackById(id), () => { window.clearInterval(this.cycle); show(id) }, false))
    ;(document.getElementById('cup-start') as HTMLButtonElement).disabled = !open
    // the background walks through the cup's four tracks
    let k = 0
    show(c.races[0]!)
    window.clearInterval(this.cycle)
    this.cycle = window.setInterval(() => { k = (k + 1) % c.races.length; show(c.races[k]!) }, 7000)
  }

  private startCup(): void {
    this.showNotice(`${CUPS[this.cup]!.name} isn't built yet`, 'This is the menu only for now. The cup races come next, and each one will be 3 laps.')
  }

  // ── single race ──
  private pickTrack(t: TrackInfo): void {
    this.track = t
    this.root.querySelectorAll('#track-list .track-tile').forEach((el) => {
      el.setAttribute('aria-pressed', String(el.querySelector('.track-name')!.textContent === t.name))
    })
    document.getElementById('track-title')!.textContent = t.name
    document.getElementById('track-blurb')!.textContent = t.blurb
    document.getElementById('tour-options')!.classList.toggle('hidden', t.id !== GRAND_TOUR.id)
    this.preview(t)
  }

  private drawTracks(): void {
    const box = document.getElementById('track-list')!
    box.innerHTML = ''
    for (const t of [GRAND_TOUR, ...TRACKS]) box.append(this.tile(t, () => this.pickTrack(t), false))
    this.pickTrack(this.track)
  }

  private startTrack(): void {
    if (this.track.built) { this.previewing = ''; this.onRace(); return }
    this.showNotice(`${this.track.name} isn't built yet`, 'This is the menu only for now. The Grand Tour is ready to race.')
  }

  private showNotice(title: string, text: string): void {
    document.getElementById('notice-title')!.textContent = title
    document.getElementById('notice-text')!.textContent = text
    this.notice.classList.remove('hidden')
    document.getElementById('notice-back')!.focus()
  }

  // ── trophies ──
  private drawTrophies(): void {
    const cups = document.getElementById('trophy-cups')!, won = cupTrophies()
    cups.innerHTML = ''
    for (const c of CUPS) {
      const trophy = won[c.id]
      const d = document.createElement('div')
      d.className = 'trophy-slot'
      d.style.setProperty('--cup', c.color)
      d.innerHTML = `<span class="cup-icon ${trophy ?? 'empty'}">${CUP_ICON}</span><span>${c.name}</span><small>${trophy ?? 'Not won'}</small>`
      cups.append(d)
    }
    const done = doneChallenges(), list = document.getElementById('trophy-goals')!
    list.innerHTML = ''
    for (const g of CHALLENGES) {
      const li = document.createElement('li')
      li.textContent = g.label
      li.classList.toggle('done', done.has(g.id))
      list.append(li)
    }
    document.getElementById('trophy-count')!.textContent = `${done.size} of ${CHALLENGES.length}`
  }
}
