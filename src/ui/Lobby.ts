import { CARS, CUPS, GRAND_TOUR, TRACKS, cupOpen, cupTrophies, saveCar, savedCar, trackById, type CarInfo, type CupInfo, type TrackInfo } from '../game/Catalog'
import { CHALLENGES, doneChallenges } from '../game/Progress'
import { ASSET_CREDITS } from './credits'

type ScreenName = 'title' | 'car' | 'cups' | 'tracks' | 'trophies' | 'credits'
type Mode = 'gp' | 'single' | 'trial'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface LobbyHost {
  unlockAudio(): void
  setCar(c: CarInfo): void | Promise<void>
  preview(t: TrackInfo): Promise<void>
  stopPreview(): Promise<void>
  /** The car screen is open: show the car close up, turning. */
  carView?(on: boolean): void
  startCup(c: CupInfo, d: Difficulty): void
  startTrack(t: TrackInfo, laps: number, d: Difficulty, trial?: boolean): void
  startTour(): void
}

const CUP_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20v12a10 10 0 0 1-20 0V6Z"/><path d="M14 10H6v4a8 8 0 0 0 8 8M34 10h8v4a8 8 0 0 1-8 8" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 28h6v7h-6zM14 36h20v6H14z"/></svg>'
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h2v11H5V10h2Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>'

const stored = (key: string, fallback: string): string => {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
const keep = (key: string, v: string): void => {
  try { localStorage.setItem(key, v) } catch { /* storage blocked */ }
}

/**
 * The way into a race: title, then car, then cup or track. Picking a track
 * loads it and plays it live behind the menu.
 */
export class Lobby {
  private readonly root = document.getElementById('lobby')!
  private readonly fade = document.getElementById('lobby-fade')!
  private readonly notice = document.getElementById('lobby-notice')!
  private screen: ScreenName = 'title'
  private mode: Mode = 'single'
  private cup = 0
  private track: TrackInfo = TRACKS[0]!
  private car: CarInfo = savedCar()
  private cycle = 0
  private previewing = ''
  private difficulty: Difficulty = stored('nitro-cosmos-difficulty', 'medium') as Difficulty
  private laps = Number(stored('horizon-drive-laps', '3')) || 3

  constructor(private readonly host: LobbyHost) {
    this.on('go-gp', () => { this.mode = 'gp'; this.show('car') })
    this.on('go-single', () => { this.mode = 'single'; this.show('car') })
    this.on('go-trial', () => { this.mode = 'trial'; this.show('car') })
    this.on('go-credits', () => this.show('credits'))
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
    window.addEventListener('pointerdown', () => this.host.unlockAudio(), { once: true })
    this.bindPickers()
    this.drawCars()
    this.show('title')
  }

  private bindPickers(): void {
    const group = (sel: string, attr: string, current: string, set: (v: string) => void) => {
      const btns = Array.from(this.root.querySelectorAll<HTMLButtonElement>(`${sel} .tod-btn`))
      const mark = (v: string) => btns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === v)))
      btns.forEach((b) => b.addEventListener('click', () => { mark(b.dataset[attr]!); set(b.dataset[attr]!) }))
      mark(current)
    }
    for (const sel of ['#difficulty-picker', '#difficulty-picker-2']) {
      group(sel, 'level', this.difficulty, (v) => {
        this.difficulty = v as Difficulty
        keep('nitro-cosmos-difficulty', v)
        for (const other of ['#difficulty-picker', '#difficulty-picker-2']) this.root.querySelectorAll<HTMLElement>(`${other} .tod-btn`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset['level'] === v)))
      })
    }
    group('#laps-picker', 'laps', String(this.laps), (v) => { this.laps = Number(v); keep('horizon-drive-laps', v) })
    group('#tod-picker', 'tod', stored('horizon-drive-tod', 'sunset'), (v) => keep('horizon-drive-tod', v))
    group('#weather-picker', 'weather', stored('horizon-drive-weather', 'clear'), (v) => keep('horizon-drive-weather', v))
    group('#ghost-picker', 'ghost', stored('horizon-drive-ghost-on', 'on'), (v) => keep('horizon-drive-ghost-on', v))
  }

  private on(id: string, fn: () => void): void {
    document.getElementById(id)!.addEventListener('click', fn)
  }

  get open(): boolean { return !document.getElementById('splash')!.classList.contains('hidden') }

  /** Back to the title after a race. */
  /** Straight to the track list (after a single race: pick another without redoing the car). */
  openTracks(): void {
    this.mode = 'single'
    this.show('tracks')
  }

  reset(): void {
    this.previewing = ''
    this.showcaseId = ''
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
    if (s === 'title') this.showcase()
    else if (s === 'car' || s === 'trophies' || s === 'credits') this.stopPreview()
    if (s === 'car') this.drawCars()
    this.host.carView?.(s === 'car')
    if (s === 'cups') this.drawCups()
    if (s === 'tracks') this.drawTracks()
    if (s === 'credits') this.drawCredits()
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
    // Q / E: the cup tab to the left / right
    if (this.screen === 'tracks' && (e.code === 'KeyQ' || e.code === 'KeyE')) {
      e.preventDefault()
      const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#cup-tabs .cup-tab'))
      tabs[(this.tab + (e.code === 'KeyE' ? 1 : -1) + tabs.length) % tabs.length]?.click()
      return
    }
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
    const blurb = document.getElementById('car-blurb')!
    blurb.textContent = this.car.blurb
    // the model's author, as its licence asks
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
    void this.host.setCar(c)
    this.root.querySelector<HTMLElement>('.car-card[aria-checked="true"]')?.focus({ preventScroll: true })
  }

  // ── background preview ──
  private preview(t: TrackInfo): void {
    if (this.previewing === t.id) return
    this.previewing = t.id
    if (!t.built || t.id === GRAND_TOUR.id) return
    // a dip to black while the track loads
    this.fade.classList.add('on')
    void this.host.preview(t).then(() => {
      if (this.previewing === t.id) this.fade.classList.remove('on')
    })
  }

  /** Behind the title: a random track, the camera following a car round it, its name in the corner. */
  private showcaseId = ''
  private showcase(): void {
    const pool = TRACKS.filter((t) => t.built && t.id !== GRAND_TOUR.id)
    if (!pool.length) return
    if (!this.showcaseId) this.showcaseId = pool[Math.floor(Math.random() * pool.length)]!.id
    const t = trackById(this.showcaseId)
    document.getElementById('live-tag')!.innerHTML = `<i></i>Live · ${t.name}`
    this.preview(t)
  }

  private stopPreview(): void {
    if (!this.previewing) return
    this.previewing = ''
    this.fade.classList.add('on')
    void this.host.stopPreview().then(() => { if (!this.previewing) this.fade.classList.remove('on') })
  }

  private tile(t: TrackInfo, onPick: () => void, selected: boolean): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'track-tile'
    b.style.setProperty('--a', t.tint[0])
    b.style.setProperty('--b', t.tint[1])
    // a picture of the track, over its colours (they show if the picture is missing)
    b.style.setProperty('--pic', `url("${import.meta.env.BASE_URL}previews/${t.id}.jpg")`)
    b.setAttribute('aria-pressed', String(selected))
    b.innerHTML = `<span class="track-name">${t.name}</span>${t.built ? '' : '<span class="track-tag">Coming soon</span>'}`
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
    show(c.races[0]!)
  }

  private startCup(): void {
    const cup = CUPS[this.cup]!
    if (cup.races.some((id) => !trackById(id).built)) {
      this.showNotice(`${cup.name} isn't built yet`, 'Only the Comet and Nova Cups are ready so far.')
      return
    }
    window.clearInterval(this.cycle)
    this.previewing = ''
    this.host.startCup(cup, this.difficulty)
  }

  // ── single race ──
  private pickTrack(t: TrackInfo): void {
    this.track = t
    this.root.querySelectorAll('#track-list .track-tile').forEach((el) => {
      const on = el.querySelector('.track-name')!.textContent === t.name
      el.setAttribute('aria-pressed', String(on))
      el.setAttribute('aria-checked', String(on))
    })
    const cup = CUPS.find((c) => c.races.includes(t.id))
    document.getElementById('track-cup')!.textContent = cup ? `${cup.name}  ·  Race ${cup.races.indexOf(t.id) + 1} of ${cup.races.length}` : 'The full journey'
    document.getElementById('track-title')!.textContent = t.name
    document.getElementById('track-blurb')!.textContent = t.blurb
    document.getElementById('tour-options')!.classList.toggle('hidden', t.id !== GRAND_TOUR.id)
    this.preview(t)
  }

  /** Which cup's tab is open on the track screen (the Grand Tour has its own, last). */
  private tab = 0
  private drawTracks(): void {
    // the same screen for a race and a time trial; a trial has no rivals, so no difficulty
    const trial = this.mode === 'trial'
    document.getElementById('tracks-title')!.textContent = trial ? 'Time Trial' : 'Single Race'
    document.getElementById('difficulty-row')!.classList.toggle('hidden', trial)
    ;(document.getElementById('track-start') as HTMLButtonElement).textContent = trial ? 'Start' : 'Race'
    // open on the cup that holds the chosen track
    const k = CUPS.findIndex((c) => c.races.includes(this.track.id))
    this.tab = this.track.id === GRAND_TOUR.id ? CUPS.length : k >= 0 ? k : 0
    this.drawTabs()
    this.drawCards()
    this.pickTrack(this.track)
  }

  private drawTabs(): void {
    const box = document.getElementById('cup-tabs')!
    box.innerHTML = ''
    const names = [...CUPS.map((c) => c.name.replace(/ Cup$/, '')), 'Grand Tour']
    names.forEach((n, k) => {
      const b = document.createElement('button')
      b.className = 'cup-tab'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(k === this.tab))
      if (k < CUPS.length) b.style.setProperty('--cup', CUPS[k]!.color)
      b.textContent = n
      b.addEventListener('click', () => {
        this.tab = k
        this.drawTabs()
        this.drawCards()
        const first = k < CUPS.length ? trackById(CUPS[k]!.races[0]!) : GRAND_TOUR
        this.pickTrack(first)
      })
      box.append(b)
    })
  }

  private drawCards(): void {
    const box = document.getElementById('track-list')!
    box.innerHTML = ''
    const list = this.tab < CUPS.length ? CUPS[this.tab]!.races.map((id) => trackById(id)) : [GRAND_TOUR]
    list.forEach((t, n) => {
      const card = this.tile(t, () => this.pickTrack(t), t.id === this.track.id)
      card.classList.add('track-card')
      card.setAttribute('role', 'radio')
      card.insertAdjacentHTML('afterbegin', `<span class="card-num">${this.tab < CUPS.length ? n + 1 : ''}</span>`)
      box.append(card)
    })
  }

  private startTrack(): void {
    if (this.track.id === GRAND_TOUR.id) { this.host.startTour(); return }
    if (!this.track.built) { this.showNotice(`${this.track.name} isn't built yet`, 'This one is still to come.'); return }
    this.previewing = ''
    this.host.startTrack(this.track, this.laps, this.difficulty, this.mode === 'trial')
  }

  private showNotice(title: string, text: string): void {
    document.getElementById('notice-title')!.textContent = title
    document.getElementById('notice-text')!.textContent = text
    this.notice.classList.remove('hidden')
    document.getElementById('notice-back')!.focus()
  }

  // ── credits: every model and asset's author, as their licences ask ──
  private drawCredits(): void {
    const box = document.getElementById('credits-list')!
    box.innerHTML = ''
    const add = (head: string, rows: string[]) => {
      if (!rows.length) return
      const sec = document.createElement('section')
      sec.innerHTML = `<h2>${head}</h2>`
      const ul = document.createElement('ul')
      for (const r of rows) { const li = document.createElement('li'); li.textContent = r; ul.append(li) }
      sec.append(ul)
      box.append(sec)
    }
    add('Cars', CARS.filter((c) => c.credit).map((c) => `${c.name}: ${c.credit}`))
    add('Tracks and scenery', ASSET_CREDITS)
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
