import '../style.css'
import '../cinema.css'
import { KartApp, fmt, type KartUI, type RaceResultRow } from './KartApp'
import { Lobby } from '../ui/Lobby'
import { CUPS, TRACKS, saveTrophy, savedCar, trackById, type CupInfo, type CupTrophy, type TrackInfo } from '../game/Catalog'
import { PAINTS, paintUnlocked, savePaint, savedPaint, CHALLENGES } from '../game/Progress'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../ui/Settings'
import type { Difficulty } from './Rival'

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el
}

const POINTS = [15, 12, 10, 8, 6, 4]
const hud = $('hud'), splash = $('splash'), countdown = $('countdown'), countdownNum = $('countdown-num')
const hudLap = $('hud-lap'), eventToast = $('event-toast'), nitroFill = $('nitro-fill')
const nitroBox = nitroFill.closest('.nitro') as HTMLElement
const speedArc = $('speed-arc'), hudMph = $('hud-mph')
const GAUGE_MAX_MPH = 220
{
  let svg = ''
  for (let v = 0; v <= GAUGE_MAX_MPH; v += 20) {
    const a = (135 + (v / GAUGE_MAX_MPH) * 270) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
    svg += `<line class="${v >= 180 ? 'tick hot' : 'tick'}" x1="${110 + c * 99}" y1="${110 + s * 99}" x2="${110 + c * 104}" y2="${110 + s * 104}" />`
  }
  $('gauge-ticks').innerHTML = svg
}
$('hud-photo-btn').classList.add('hidden')
$('loading').remove()

let toastTimer = 0

/** Item icons, drawn as SVG so they stay sharp. */
const ITEM_ICONS: Record<string, string> = {
  comet: '<svg viewBox="0 0 64 64"><defs><linearGradient id="itc" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ff4a8a" stop-opacity="0"/></linearGradient></defs><path d="M8 56 L40 20 L46 26 Z" fill="url(#itc)"/><circle cx="44" cy="20" r="11" fill="#ffd64a" stroke="#fff" stroke-width="2.5"/></svg>',
  storm: '<svg viewBox="0 0 64 64"><path d="M14 30 a12 12 0 0 1 22 -10 a10 10 0 0 1 16 10 a8 8 0 0 1 -2 16 H18 a8 8 0 0 1 -4 -16 Z" fill="#5a6478" stroke="#fff" stroke-width="2.5"/><path d="M34 36 L26 50 H33 L28 60 L42 44 H35 L40 36 Z" fill="#ffe14a" stroke="#fff" stroke-width="1.5"/></svg>',
  turbo: '<svg viewBox="0 0 64 64"><defs><linearGradient id="it1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6a0"/><stop offset="1" stop-color="#ff7a1a"/></linearGradient></defs><path d="M14 40 L34 10 L32 28 L50 24 L30 54 L32 36 Z" fill="url(#it1)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  triple: '<svg viewBox="0 0 64 64"><g stroke="#fff" stroke-width="2" stroke-linejoin="round" fill="#ffb02a"><path d="M6 34 L18 14 L17 26 L28 23 L16 44 L17 32 Z"/><path d="M36 34 L48 14 L47 26 L58 23 L46 44 L47 32 Z"/><path d="M21 52 L33 32 L32 44 L43 41 L31 62 L32 50 Z" fill="#ffe070"/></g></svg>',
  dart: '<svg viewBox="0 0 64 64"><defs><linearGradient id="it2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1a8cff" stop-opacity="0"/><stop offset="0.5" stop-color="#5ad8ff"/><stop offset="1" stop-color="#e8fbff"/></linearGradient></defs><path d="M8 56 L40 24" stroke="url(#it2)" stroke-width="8" stroke-linecap="round"/><path d="M36 16 L56 8 L48 28 Z" fill="#e8fbff" stroke="#5ad8ff" stroke-width="2"/></svg>',
  seeker: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#ff5a3a" stroke="#fff" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="25" ry="9" fill="none" stroke="#ffb040" stroke-width="3" transform="rotate(-25 32 32)"/><circle cx="28" cy="28" r="4" fill="#fff" opacity="0.7"/></svg>',
  mine: '<svg viewBox="0 0 64 64"><g stroke="#cfd6e0" stroke-width="4" stroke-linecap="round"><path d="M32 8v10M32 46v10M8 32h10M46 32h10M15 15l7 7M42 42l7 7M49 15l-7 7M22 42l-7 7"/></g><circle cx="32" cy="32" r="15" fill="#2a2f38" stroke="#cfd6e0" stroke-width="2.5"/><circle cx="32" cy="26" r="4" fill="#ff3a2a"/></svg>',
  shield: '<svg viewBox="0 0 64 64"><defs><radialGradient id="it3"><stop offset="0.55" stop-color="#5ad8ff" stop-opacity="0.15"/><stop offset="1" stop-color="#8ae6ff" stop-opacity="0.9"/></radialGradient></defs><circle cx="32" cy="32" r="24" fill="url(#it3)" stroke="#e8fbff" stroke-width="2.5"/><path d="M32 18 L44 23 V33 C44 41 38 46 32 48 C26 46 20 41 20 33 V23 Z" fill="none" stroke="#fff" stroke-width="2.5"/></svg>',
}
const ITEM_LIST = Object.keys(ITEM_ICONS)
let itemRoll = 0
function setItem(kind: string | null, rolling: boolean, count: number): void {
  const box = $('hud-item'), icon = $('hud-item-icon')
  clearInterval(itemRoll)
  box.classList.toggle('empty', !kind)
  box.classList.toggle('rolling', rolling)
  box.classList.remove('ready')
  $('touch-item').classList.toggle('ready', !!kind && !rolling)
  $('hud-item-count').textContent = kind && count > 1 ? `×${count}` : ''
  if (!kind) { icon.innerHTML = ''; return }
  if (rolling) {
    let k = 0
    itemRoll = window.setInterval(() => { icon.innerHTML = ITEM_ICONS[ITEM_LIST[k++ % ITEM_LIST.length]!]!; }, 70)
    return
  }
  icon.innerHTML = ITEM_ICONS[kind] ?? ''
  void box.offsetWidth
  box.classList.add('ready')
}
const TIPS = [
  'Hold a drift and let go for a boost. Longer drifts boost harder.',
  'Tap the brake just after a jump for a trick boost on landing.',
  'Side roads have their own items. Taking one never means missing out.',
  'The track changes on lap 2 and again on the last lap. Watch for the banner.',
  'Fall off and the recovery drone sets you back on the road.',
  'In last place, item crystals give stronger catch-up items.',
  'Nitro fills up as you drift. Save it for the jumps that need it.',
]
// the track pictures (menu tiles, loading cards): fetched up front so they're there when needed
for (const t of TRACKS) new Image().src = `${import.meta.env.BASE_URL}previews/${t.id}.jpg`

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`

const ui: KartUI = {
  setTime: (t) => { $('hud-time').textContent = t },
  setMph: (mph) => {
    hudMph.textContent = String(mph)
    speedArc.setAttribute('stroke-dasharray', `${(Math.min(mph, GAUGE_MAX_MPH) / GAUGE_MAX_MPH * 100).toFixed(1)} 100`)
  },
  setLap: (c, t) => { hudLap.textContent = `LAP ${c}/${t}`; hudLap.classList.remove('hidden') },
  // (alone in a time trial there's no place to show)
  setPlace: (p, of) => { const el = $('hud-place'); el.classList.toggle('hidden', of <= 1); el.innerHTML = `${ordinal(p)}<small>/${of}</small>` },
  setNitro: (l, a) => { nitroFill.setAttribute('stroke-dasharray', `${(l * 100).toFixed(1)} 100`); nitroBox.classList.toggle('active', a) },
  setItem: (kind, rolling, count) => setItem(kind, rolling, count),
  warn: (t) => { const w = $('hud-warn'); w.textContent = t ?? ''; w.classList.toggle('hidden', !t) },
  countdown: (l) => {
    countdown.classList.toggle('hidden', l === null)
    if (!l) return
    countdownNum.textContent = l
    countdownNum.classList.toggle('go', l === 'GO')
    countdownNum.style.animation = 'none'
    void countdownNum.offsetHeight
    countdownNum.style.animation = ''
  },
  toast: (t, best) => {
    eventToast.textContent = t
    eventToast.classList.toggle('best', !!best)
    eventToast.classList.remove('hidden')
    eventToast.style.animation = 'none'
    void eventToast.offsetHeight
    eventToast.style.animation = ''
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => eventToast.classList.add('hidden'), 2400)
  },
  raceStarted: () => {
    splash.classList.add('hidden')
    hud.classList.remove('hidden')
    $('race-end').classList.add('hidden')
  },
  raceEnded: (rows) => showResults(rows),
  raceUpdate: (rows) => drawResults(rows),
  replay: (on) => {
    $('replay-bar').classList.toggle('hidden', !on)
    $('race-end').classList.toggle('hidden', on)
  },
  loading: (on, text) => {
    const box = $('track-loading')
    box.classList.toggle('hidden', !on)
    if (!text) return
    $('track-loading-name').textContent = text
    // the track's colours, its picture and its blurb, and a tip while you wait
    const t = TRACKS.find((x) => x.name === text)
    $('track-loading-blurb').textContent = t?.blurb ?? ''
    $('track-loading-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]!
    box.style.setProperty('--tl-a', t?.tint[0] ?? '#1a1030')
    box.style.setProperty('--tl-b', t?.tint[1] ?? '#05060c')
    box.classList.toggle('has-pic', !!t)
    if (t) box.style.setProperty('--tl-pic', `url("${import.meta.env.BASE_URL}previews/${t.id}.jpg")`)
  },
}

const app = new KartApp($('game') as HTMLCanvasElement, $('minimap') as HTMLCanvasElement, ui)

// ── touch: steer, brake, accelerate, nitro and use the item, on phones and tablets
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
const touch = $('touch-controls'), itemBtn = $('touch-item')
itemBtn.classList.remove('hidden')
function bindTouch(id: string, set: (active: boolean) => void): void {
  const el = $(id)
  const on = (e: Event) => { e.preventDefault(); set(true) }
  const off = (e: Event) => { e.preventDefault(); set(false) }
  el.addEventListener('touchstart', on, { passive: false })
  el.addEventListener('touchend', off, { passive: false })
  el.addEventListener('touchcancel', off, { passive: false })
  el.addEventListener('mousedown', () => set(true))
  el.addEventListener('mouseup', () => set(false))
  el.addEventListener('mouseleave', () => set(false))
}
bindTouch('touch-accel', (a) => app.input.setTouchAccelerate(a))
bindTouch('touch-brake', (a) => app.input.setTouchBrake(a))
bindTouch('touch-left', (a) => app.input.setTouchLeft(a))
bindTouch('touch-right', (a) => app.input.setTouchRight(a))
bindTouch('touch-nitro', (a) => app.input.setTouchNitro(a))
bindTouch('touch-item', (a) => app.input.setTouchItem(a))
// show the pad while racing on a touch screen; the item button glows when there's something to use
new MutationObserver(() => touch.classList.toggle('hidden', !isTouch || hud.classList.contains('hidden'))).observe(hud, { attributes: true, attributeFilter: ['class'] })

// ── the current run ──
interface Run { cup: CupInfo | null; round: number; track: string; laps: number; difficulty: Difficulty; totals: Map<string, number>; trial?: boolean }
let run: Run | null = null

async function beginRace(): Promise<void> {
  if (!run) return
  await app.settled()
  if (app.def?.id !== run.track) await app.loadTrack(run.track)
  // your best-lap ghost only rides along in a time trial, never in a race against rivals
  app.ghostOn = !!run.trial
  app.solo = !!run.trial
  await app.startRace(run.laps, run.difficulty)
}

/** The results table; in a cup, the points this place is worth and where that leaves the standings. */
function drawResults(rows: RaceResultRow[]): void {
  if (!run) return
  const cup = run.cup, table = $('end-table')
  table.innerHTML = ''
  rows.forEach((row, k) => {
    const tr = document.createElement('div')
    tr.className = `end-row${row.isPlayer ? ' me' : ''}`
    const time = row.finished ? fmt(row.timeMs) : 'Racing'
    tr.innerHTML = `<span>${k + 1}</span><span>${row.name}</span><span>${time}</span>${cup ? `<span>+${POINTS[k] ?? 0}</span><span>${(run!.totals.get(row.name) ?? 0) + (POINTS[k] ?? 0)}</span>` : ''}`
    table.append(tr)
  })
}

/** The race is decided for good (leaving the results): points go on the board from the final order. */
function settleRace(): [string, number][] {
  const r = run!
  app.finalRows().forEach((row, k) => r.totals.set(row.name, (r.totals.get(row.name) ?? 0) + (POINTS[k] ?? 0)))
  return [...r.totals.entries()].sort((a, b) => b[1] - a[1])
}

function showResults(rows: RaceResultRow[]): void {
  hud.classList.add('hidden')
  if (!run) return
  const r = run, cup = r.cup
  drawResults(rows)
  $('end-race-name').textContent = trackById(r.track).name
  const lastRound = !!cup && r.round >= cup.races.length - 1
  $('end-round').textContent = cup ? `${cup.name}  ·  Race ${r.round + 1} of ${cup.races.length}` : r.trial ? 'Time trial' : `${r.laps} ${r.laps === 1 ? 'lap' : 'laps'}`
  $('end-main').classList.remove('hidden')
  $('end-again').classList.add('hidden')
  const next = $('end-next') as HTMLButtonElement
  // a cup goes on to the next race (no restarts); a single race offers another go
  next.textContent = cup ? (lastRound ? 'See results' : 'Continue') : 'Play again'
  $('end-replay').classList.toggle('hidden', !app.hasReplay)
  $('race-end').classList.remove('hidden')
  next.focus()
  next.onclick = () => {
    if (!cup) {
      $('end-main').classList.add('hidden')
      $('end-again').classList.remove('hidden')
      $('end-restart').focus()
      return
    }
    const standings = settleRace()
    if (lastRound) { cupFinished(cup, standings); return }
    r.round++; r.track = cup.races[r.round]!
    if (r.track === 'tour') { toTour(r); return }
    $('race-end').classList.add('hidden')
    void beginRace()
  }
}
$('end-restart').addEventListener('click', () => {
  if (!run) return
  $('race-end').classList.add('hidden')
  void beginRace()
})
$('end-again-back').addEventListener('click', () => {
  $('end-again').classList.add('hidden')
  $('end-main').classList.remove('hidden')
  ;($('end-next') as HTMLButtonElement).focus()
})

/** The Grand Tour runs in its own page: keep the cup's state, go, and come back with a medal. */
const CUP_RUN_KEY = 'nc-cup-run', TOUR_MEDAL_KEY = 'nc-cup-tour-medal'
function toTour(r: Run): void {
  try {
    sessionStorage.removeItem(TOUR_MEDAL_KEY)
    sessionStorage.setItem(CUP_RUN_KEY, JSON.stringify({ cup: r.cup!.id, round: r.round, difficulty: r.difficulty, totals: [...r.totals] }))
  } catch { /* storage blocked: the tour still runs, the cup ends without it */ }
  location.href = `${location.pathname}?tour&cup=1`
}
/** Back from the Grand Tour: its medal is your place, the rivals fill the rest by standing. */
function resumeCupAfterTour(): void {
  let saved: { cup: string; round: number; difficulty: Difficulty; totals: [string, number][] } | null = null
  let medal: string | null = null
  try {
    saved = JSON.parse(sessionStorage.getItem(CUP_RUN_KEY) ?? 'null')
    medal = sessionStorage.getItem(TOUR_MEDAL_KEY)
    sessionStorage.removeItem(CUP_RUN_KEY)
    sessionStorage.removeItem(TOUR_MEDAL_KEY)
  } catch { return }
  const cup = saved && CUPS.find((c) => c.id === saved!.cup)
  if (!saved || !cup || !medal) return
  const totals = new Map(saved.totals)
  const place = medal === 'GOLD' ? 0 : medal === 'SILVER' ? 1 : medal === 'BRONZE' ? 2 : 5
  const rivals = [...totals.keys()].filter((n) => n !== 'You').sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
  const order: string[] = []
  for (let k = 0, q = 0; k < 6; k++) order.push(k === place ? 'You' : rivals[q++] ?? '')
  order.forEach((n, k) => { if (n) totals.set(n, (totals.get(n) ?? 0) + (POINTS[k] ?? 0)) })
  splash.classList.add('hidden')
  cupFinished(cup, [...totals.entries()].sort((a, b) => b[1] - a[1]))
}

function cupFinished(cup: CupInfo, standings: [string, number][]): void {
  $('race-end').classList.add('hidden')
  const place = standings.findIndex(([n]) => n === 'You') + 1
  const trophy: CupTrophy | null = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : null
  if (trophy) saveTrophy(cup.id, trophy)
  // the top three on the podium behind the standings
  app.showPodium(standings.slice(0, 3).map(([n]) => n))
  $('cup-end-title').textContent = trophy ? `${trophy} trophy` : 'No trophy this time'
  $('cup-end-title').className = `cup-end-title ${trophy ?? ''}`
  $('cup-end-sub').textContent = `${cup.name}: you finished ${ordinal(place)}.`
  const box = $('cup-end-table')
  box.innerHTML = ''
  standings.forEach(([n, p], k) => {
    const row = document.createElement('div')
    row.className = `end-row${n === 'You' ? ' me' : ''}`
    row.innerHTML = `<span>${k + 1}</span><span>${n}</span><span>${p} pts</span>`
    box.append(row)
  })
  $('cup-end').classList.remove('hidden')
}

function backToLobby(): void {
  run = null
  ui.countdown(null)
  ui.warn(null)
  $('race-end').classList.add('hidden')
  $('cup-end').classList.add('hidden')
  hud.classList.add('hidden')
  splash.classList.remove('hidden')
  app.exitRace()
  lobby.reset()
}
$('end-exit').addEventListener('click', backToLobby)
$('end-other').addEventListener('click', () => { backToLobby(); lobby.openTracks() })
$('end-replay').addEventListener('click', () => { app.startReplay() })
$('replay-skip').addEventListener('click', () => app.stopReplay())
$('cup-end-done').addEventListener('click', backToLobby)
$('exit-btn').addEventListener('click', backToLobby)

const DEFAULT_TRACK = 'bay'
const lobby = new Lobby({
  unlockAudio: () => app.audio.unlock(),
  setCar: (c) => app.setCar(c),
  async preview(t: TrackInfo) {
    if (!t.built || t.id === 'tour') return
    if (app.def?.id !== t.id) await app.loadTrack(t.id, true)
    await app.settled()
    if (app.def?.id === t.id) app.startPreview()
  },
  async stopPreview() {
    // keep whatever track is behind the menu; only load one if there is none
    if (!app.def) await app.loadTrack(DEFAULT_TRACK, true)
    await app.settled()
    app.showGrid()
  },
  carView(on) { app.turntable = on },
  startCup(cup, difficulty) {
    run = { cup, round: 0, track: cup.races[0]!, laps: 3, difficulty, totals: new Map() }
    void beginRace()
  },
  startTrack(t, laps, difficulty, trial) {
    run = { cup: null, round: 0, track: t.id, laps, difficulty, totals: new Map(), trial }
    void beginRace()
  },
  startTour() { location.href = `${location.pathname}?tour` },
})

// ── Paint ──
function drawPaints(): void {
  const box = $('paint-picker'), current = savedPaint()
  box.innerHTML = ''
  for (const p of PAINTS) {
    const open = paintUnlocked(p)
    const b = document.createElement('button')
    b.className = 'paint-btn'
    b.style.setProperty('--paint', `#${p.hex.toString(16).padStart(6, '0')}`)
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(p.id === current.id))
    const need = CHALLENGES.find((c) => c.id === p.unlock)
    b.setAttribute('aria-label', open ? p.name : `${p.name}, locked`)
    b.title = open ? p.name : `Locked: ${need?.label ?? ''}`
    b.disabled = !open
    b.addEventListener('click', () => { savePaint(p.id); app.setPaint(p.hex); drawPaints() })
    box.append(b)
  }
}
drawPaints()

// ── Settings ──
let settings: Settings = loadSettings()
const settingsEl = $('settings')
const volumeSlider = $('volume-slider') as HTMLInputElement
const volumeValue = $('volume-value')
const groups = Array.from(settingsEl.querySelectorAll('.seg-group')) as HTMLElement[]
function renderSettings(): void {
  for (const g of groups) {
    const key = g.dataset['setting'] as keyof Settings
    for (const b of Array.from(g.querySelectorAll('button'))) b.setAttribute('aria-pressed', String(b.dataset['value'] === String(settings[key])))
  }
  volumeSlider.value = String(Math.round(settings.volume * 100))
  volumeValue.textContent = `${Math.round(settings.volume * 100)}%`
  $('quality-note').textContent = ''
}
function update(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  app.applySettings(settings)
  renderSettings()
}
for (const g of groups) {
  const key = g.dataset['setting'] as keyof Settings
  g.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    const raw = b.dataset['value']!
    update({ [key]: key === 'motionBlur' ? raw === 'true' : raw } as Partial<Settings>)
  })
}
volumeSlider.addEventListener('input', () => update({ volume: Number(volumeSlider.value) / 100 }))
$('settings-reset').addEventListener('click', () => update({ ...DEFAULT_SETTINGS }))
let pausedForSettings = false
function openSettings(): void {
  renderSettings()
  settingsEl.classList.remove('hidden')
  pausedForSettings = app.phase === 'racing' || app.phase === 'countdown'
  if (pausedForSettings) app.setPaused(true)
}
function closeSettings(): void {
  settingsEl.classList.add('hidden')
  // opened from the pause menu: back to it, still paused
  if (!pauseEl.classList.contains('hidden')) { ($('pause-settings') as HTMLButtonElement).focus(); return }
  if (pausedForSettings) app.setPaused(false)
  pausedForSettings = false
}

// ── the pause menu: Esc in a race ──
const pauseEl = $('pause')
function openPause(): void {
  if (!run || !(app.phase === 'racing' || app.phase === 'countdown')) return
  app.setPaused(true)
  pausedForSettings = true
  const cup = run.cup
  $('pause-kicker').textContent = cup ? `${cup.name}  ·  Race ${run.round + 1} of ${cup.races.length}` : run.trial ? 'Time trial' : 'Single race'
  $('pause-title').textContent = trackById(run.track).name
  // a cup is raced through: no restarts there
  $('pause-restart').classList.toggle('hidden', !!cup)
  pauseEl.classList.remove('hidden')
  ;($('pause-resume') as HTMLButtonElement).focus()
}
function closePause(): void {
  pauseEl.classList.add('hidden')
  settingsEl.classList.add('hidden')
  app.setPaused(false)
  pausedForSettings = false
}
$('pause-resume').addEventListener('click', closePause)
$('pause-settings').addEventListener('click', openSettings)
$('pause-restart').addEventListener('click', () => { closePause(); void beginRace() })
$('pause-exit').addEventListener('click', () => { closePause(); backToLobby() })
pauseEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const list = Array.from(pauseEl.querySelectorAll<HTMLButtonElement>('.menu-item')).filter((b) => !b.classList.contains('hidden'))
  const at = list.indexOf(document.activeElement as HTMLButtonElement)
  list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]!.focus()
})

$('settings-open').addEventListener('click', openSettings)
$('hud-settings-btn').addEventListener('click', openPause)
$('settings-close').addEventListener('click', closeSettings)
settingsEl.addEventListener('click', (e) => { if (e.target === settingsEl) closeSettings() })
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!settingsEl.classList.contains('hidden')) closeSettings()
  else if (!pauseEl.classList.contains('hidden')) closePause()
  else if (app.phase === 'racing' || app.phase === 'countdown') openPause()
})
const muteBtn = $('mute-btn')
muteBtn.addEventListener('click', () => {
  const m = !app.audio.isMuted()
  app.audio.setMuted(m)
  muteBtn.classList.toggle('muted', m)
})
app.applySettings(settings)

// ── FPS (press F) ──
{
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:20px;top:64px;z-index:50;padding:4px 10px;border-radius:6px;background:rgba(6,8,18,.6);color:#fff;font:700 15px Rajdhani,sans-serif;display:none'
  document.body.append(el)
  let frames = 0, last = performance.now()
  const tick = (now: number) => {
    frames++
    if (now - last >= 500) { el.textContent = `${Math.round(frames * 1000 / (now - last))} FPS`; frames = 0; last = now }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyF') el.style.display = el.style.display === 'none' ? 'block' : 'none' })
}

// first screen: the title's live track (the lobby has already started loading it); Cosmos Bay only as a fallback
void app.setCar(savedCar()).then(() => app.settled()).then(() => (app.def ? undefined : app.loadTrack(DEFAULT_TRACK)))
resumeCupAfterTour()
void CUPS


// ── dev only: test helpers on window (__look, __race, __clear) ──
if (import.meta.env.DEV) void import('./devtools').then((m) => m.install(app))
