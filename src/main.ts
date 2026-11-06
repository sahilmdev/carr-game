import './style.css'
import { Game, formatTime, type GameUI } from './game/Game'
import { CHALLENGES, PAINTS, doneChallenges, paintUnlocked, savePaint, savedPaint } from './game/Progress'
import type { TimeOfDay } from './game/Sky'
import { Lobby } from './ui/Lobby'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './ui/Settings'

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el
}

const canvas = $('game') as HTMLCanvasElement
const minimapCanvas = $('minimap') as HTMLCanvasElement
const splash = $('splash')
const hud = $('hud')
const countdown = $('countdown')
const countdownNum = $('countdown-num')
const endScreen = $('end-screen')
const endTime = $('end-time')
const endBest = $('end-best')
const endNewBest = $('end-newbest')
const endMedal = $('end-medal')
const hudTime = $('hud-time')
const hudMph = $('hud-mph')
const speedArc = $('speed-arc')
const GAUGE_MAX_MPH = 220 // full gauge at this speed
{
  // tick marks every 20 mph round the 270° dial
  const ticks = $('gauge-ticks')
  let svg = ''
  for (let v = 0; v <= GAUGE_MAX_MPH; v += 20) {
    const a = (135 + (v / GAUGE_MAX_MPH) * 270) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
    svg += `<line class="${v >= 180 ? 'tick hot' : 'tick'}" x1="${110 + c * 99}" y1="${110 + s * 99}" x2="${110 + c * 104}" y2="${110 + s * 104}" />`
  }
  ticks.innerHTML = svg
}
const muteBtn = $('mute-btn')
const touchControls = $('touch-controls')
const hudLap = $('hud-lap')
const lapToast = $('lap-toast')
const eventToast = $('event-toast')
const areaCard = $('area-card')
const areaTitle = $('area-title')
const areaSub = $('area-sub')
let eventTimer = 0
let areaTimer = 0
const endLaps = $('end-laps')
const nitroFill = $('nitro-fill')
const nitroBox = nitroFill.closest('.nitro') as HTMLElement
const photoEl = $('photo-mode')
const photoHelp = $('photo-help')
const photoActions = photoEl.querySelector('.photo-actions') as HTMLElement
const photoFlash = $('photo-flash')

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

const dangerEl = $('danger')
const dangerLabel = $('danger-label')
const dangerFill = $('danger-fill')
const dangerVig = $('danger-vig')

const ui: GameUI = {
  setDanger: (label, level, color, soft) => {
    dangerEl.classList.toggle('hidden', label === null)
    dangerVig.style.opacity = label === null || soft ? '0' : (level * level * 0.9).toFixed(3)
    if (label === null) return
    dangerLabel.textContent = label
    dangerFill.style.transform = `scaleX(${level.toFixed(3)})`
    dangerFill.style.background = color
    dangerVig.style.setProperty('--danger', color)
  },
  setTime: (text) => { hudTime.textContent = text },
  setMph: (mph) => {
    hudMph.textContent = String(mph)
    speedArc.setAttribute('stroke-dasharray', `${(Math.min(mph, GAUGE_MAX_MPH) / GAUGE_MAX_MPH * 100).toFixed(1)} 100`)
  },
  showCountdown: (label) => {
    countdown.classList.remove('hidden')
    countdownNum.textContent = label
    // "GO" gets its own green, larger, burst treatment
    countdownNum.classList.toggle('go', label === 'GO')
    // retrigger the pop animation
    countdownNum.style.animation = 'none'
    void countdownNum.offsetHeight
    countdownNum.style.animation = ''
  },
  hideCountdown: () => countdown.classList.add('hidden'),
  onRaceStart: () => {
    endScreen.classList.add('hidden')
    hud.classList.remove('hidden')
    if (isTouchDevice) touchControls.classList.remove('hidden')
  },
  setLap: (current, total) => {
    hudLap.textContent = `LAP ${current}/${total}`
    hudLap.classList.toggle('hidden', total <= 1)
  },
  onLap: (lap, lapMs, isBestLap) => {
    lapToast.textContent = `LAP ${lap}  ${formatTime(lapMs)}${isBestLap ? '  BEST' : ''}`
    lapToast.classList.toggle('best', isBestLap)
    lapToast.classList.remove('hidden')
    lapToast.style.animation = 'none'
    void lapToast.offsetHeight
    lapToast.style.animation = ''
    setTimeout(() => lapToast.classList.add('hidden'), 2600)
  },
  toast: (text, kind) => {
    eventToast.textContent = text
    eventToast.classList.toggle('best', kind === 'best')
    eventToast.classList.remove('hidden')
    eventToast.style.animation = 'none'
    void eventToast.offsetHeight
    eventToast.style.animation = ''
    clearTimeout(eventTimer)
    eventTimer = window.setTimeout(() => eventToast.classList.add('hidden'), 2600)
  },
  area: (title, subtitle) => {
    areaTitle.textContent = title
    areaSub.textContent = subtitle
    areaCard.classList.remove('hidden')
    areaCard.style.animation = 'none'
    void areaCard.offsetHeight
    areaCard.style.animation = ''
    clearTimeout(areaTimer)
    areaTimer = window.setTimeout(() => areaCard.classList.add('hidden'), 3200)
  },
  setNitro: (level, active) => {
    nitroFill.setAttribute('stroke-dasharray', `${(level * 100).toFixed(1)} 100`)
    nitroBox.classList.toggle('active', active)
  },
  onPhotoMode: (active) => {
    photoEl.classList.toggle('hidden', !active)
    hud.style.visibility = active ? 'hidden' : ''
    touchControls.style.visibility = active ? 'hidden' : ''
    photoHelp.classList.remove('hidden')
    photoActions.classList.remove('hidden')
  },
  onFinish: (r) => {
    endTime.textContent = formatTime(r.totalMs)
    endBest.textContent = formatTime(r.bestTotalMs)
    endNewBest.classList.toggle('hidden', !r.isNewBest)
    endMedal.textContent = r.medal ? `${r.medal} MEDAL` : 'NO MEDAL · BRONZE UNDER 2:51'
    endMedal.className = `end-medal ${(r.medal ?? 'none').toLowerCase()}`
    // Lap splits (fastest highlighted) + all-time best lap
    endLaps.innerHTML = ''
    const fastest = Math.min(...r.laps)
    const row = (label: string, value: string, hi = false) => {
      const a = document.createElement('span')
      const b = document.createElement('span')
      a.textContent = label
      b.textContent = value
      if (hi) { a.className = b.className = 'fastest' }
      endLaps.append(a, b)
    }
    if (r.laps.length > 1) r.laps.forEach((ms, i) => row(`LAP ${i + 1}`, formatTime(ms), ms === fastest))
    row(r.isNewBestLap ? 'BEST LAP (NEW!)' : 'BEST LAP', formatTime(r.bestLapMs), r.isNewBestLap)
    // new challenges, this browser's top five and what's still to do
    const unlocks = $('end-unlocks')
    unlocks.innerHTML = ''
    for (const label of r.newChallenges) {
      const d = document.createElement('div')
      d.textContent = `CHALLENGE DONE · ${label}`
      unlocks.append(d)
    }
    const board = $('end-board')
    board.innerHTML = ''
    r.board.forEach((e, k) => {
      const li = document.createElement('li')
      li.textContent = `${formatTime(e.ms)}${e.medal ? '  ' + e.medal[0] : ''}`
      li.classList.toggle('now', k === r.boardPlace)
      board.append(li)
    })
    $('end-count').textContent = `${r.challengesDone}/${r.challengesTotal}`
    const goals = $('end-goals'), done = doneChallenges()
    goals.innerHTML = ''
    for (const c of CHALLENGES) {
      const li = document.createElement('li')
      li.textContent = c.label
      li.classList.toggle('done', done.has(c.id))
      goals.append(li)
    }
    drawPaints()
    if (isTouchDevice) touchControls.classList.add('hidden')
    hud.classList.add('hidden')
  },
  showResults: () => { if (game.phase === 'finished') endScreen.classList.remove('hidden') },
}

const game = new Game(canvas, minimapCanvas, ui)

// ── Loading screen: models, scanned props, shader warm-up ──────────────
{
  const screen = document.getElementById('loading')!
  const fill = document.getElementById('loading-fill')!
  const label = document.getElementById('loading-label')!
  const timer = window.setInterval(() => {
    const p = game.loadProgress
    fill.style.transform = `scaleX(${p.toFixed(3)})`
    label.textContent = p < 0.4 ? 'LOADING CARS & TOWN' : p < 0.99 ? 'LOADING SCENERY' : 'PREPARING SHADERS'
    if (game.loaded) {
      window.clearInterval(timer)
      screen.classList.add('done')
      window.setTimeout(() => screen.remove(), 800)
    }
  }, 100)
}

// ── Race length (laps) ─────────────────────────────────────────────────
const LAPS_KEY = 'horizon-drive-laps'
const lapButtons = Array.from(document.querySelectorAll('#laps-picker .tod-btn')) as HTMLButtonElement[]
function setLaps(n: number): void {
  game.lapCount = n
  lapButtons.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset['laps']) === n)))
  try { localStorage.setItem(LAPS_KEY, String(n)) } catch { /* storage blocked */ }
}
lapButtons.forEach((b) => b.addEventListener('click', () => setLaps(Number(b.dataset['laps']))))
{
  let stored = 1
  try { stored = Number(localStorage.getItem(LAPS_KEY)) || 1 } catch { /* storage blocked */ }
  setLaps([1, 3, 5].includes(stored) ? stored : 1)
}

// ── Paint ──────────────────────────────────────────────────────────────
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
    b.addEventListener('click', () => { savePaint(p.id); game.setPaint(p.hex); drawPaints() })
    box.append(b)
  }
}
drawPaints()

// ── Ghost car ──────────────────────────────────────────────────────────
const GHOST_KEY = 'horizon-drive-ghost-on'
const ghostButtons = Array.from(document.querySelectorAll('#ghost-picker .tod-btn')) as HTMLButtonElement[]
function setGhost(on: boolean): void {
  game.ghost.enabled = on
  ghostButtons.forEach((b) => b.setAttribute('aria-checked', String((b.dataset['ghost'] === 'on') === on)))
  try { localStorage.setItem(GHOST_KEY, on ? 'on' : 'off') } catch { /* storage blocked */ }
}
ghostButtons.forEach((b) => b.addEventListener('click', () => setGhost(b.dataset['ghost'] === 'on')))
{
  let stored: string | null = null
  try { stored = localStorage.getItem(GHOST_KEY) } catch { /* storage blocked */ }
  setGhost(stored !== 'off')
}

// ── Photo mode ─────────────────────────────────────────────────────────
function togglePhoto(on = !game.photoMode): void {
  if (on && !settingsEl.classList.contains('hidden')) return
  game.setPhotoMode(on)
}
async function savePhoto(): Promise<void> {
  // The canvas holds only the 3D view, so the HUD and buttons never end up in the photo
  const blob = await game.capturePhoto()
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.download = `nitro-cosmos-${stamp}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  photoFlash.classList.remove('on')
  void photoFlash.offsetWidth
  photoFlash.classList.add('on')
}
$('hud-photo-btn').addEventListener('click', () => togglePhoto(true))
$('photo-exit').addEventListener('click', () => togglePhoto(false))
$('photo-save').addEventListener('click', () => { void savePhoto() })
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && (game.phase !== 'attract' || game.photoMode)) togglePhoto()
  else if (game.photoMode && e.code === 'KeyH') {
    photoHelp.classList.toggle('hidden')
    photoActions.classList.toggle('hidden')
  } else if (game.photoMode && e.code === 'Enter') void savePhoto()
})
let dragging = false
canvas.addEventListener('pointerdown', (e) => { if (game.photoMode) { dragging = true; canvas.setPointerCapture(e.pointerId) } })
canvas.addEventListener('pointermove', (e) => { if (dragging) game.photoLook(e.movementX, e.movementY) })
canvas.addEventListener('pointerup', () => { dragging = false })
canvas.addEventListener('wheel', (e) => { if (game.photoMode) { e.preventDefault(); game.photoZoom(e.deltaY) } }, { passive: false })

// ── Settings ───────────────────────────────────────────────────────────
let settings: Settings = loadSettings()
const settingsEl = $('settings')
const volumeSlider = $('volume-slider') as HTMLInputElement
const volumeValue = $('volume-value')
const qualityNote = $('quality-note')
const segGroups = Array.from(settingsEl.querySelectorAll('.seg-group')) as HTMLElement[]
const QUALITY_NOTES = {
  low: 'Lower resolution, small shadows, no glow. Smoothest on weak laptops and phones.',
  medium: 'Full detail, sharp shadows. Recommended for laptops.',
  high: 'Adds soft contact shadows (ambient occlusion), 4K shadows and sharper edges. Needs a gaming GPU.',
}

function renderSettings(): void {
  for (const group of segGroups) {
    const key = group.dataset['setting'] as keyof Settings
    for (const b of Array.from(group.querySelectorAll('button'))) {
      b.setAttribute('aria-pressed', String(b.dataset['value'] === String(settings[key])))
    }
  }
  volumeSlider.value = String(Math.round(settings.volume * 100))
  volumeValue.textContent = `${Math.round(settings.volume * 100)}%`
  const tier = settings.quality === 'auto' ? game.autoTier : settings.quality
  qualityNote.textContent = (settings.quality === 'auto' ? `Auto picked ${tier.toUpperCase()} for this device. ` : '') + QUALITY_NOTES[tier]
}

function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  game.applySettings(settings)
  renderSettings()
}

for (const group of segGroups) {
  const key = group.dataset['setting'] as keyof Settings
  group.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    const raw = b.dataset['value']!
    const value = key === 'motionBlur' ? raw === 'true' : raw
    updateSettings({ [key]: value } as Partial<Settings>)
  })
}
volumeSlider.addEventListener('input', () => updateSettings({ volume: Number(volumeSlider.value) / 100 }))
$('settings-reset').addEventListener('click', () => updateSettings({ ...DEFAULT_SETTINGS }))

let pausedForSettings = false
function openSettings(): void {
  renderSettings()
  settingsEl.classList.remove('hidden')
  // Freeze the race while the panel is open
  pausedForSettings = game.phase === 'racing' || game.phase === 'countdown'
  if (pausedForSettings) game.setPaused(true)
  ;($('settings-close') as HTMLButtonElement).focus()
}
function closeSettings(): void {
  settingsEl.classList.add('hidden')
  if (pausedForSettings) game.setPaused(false)
  pausedForSettings = false
}
$('settings-open').addEventListener('click', openSettings)
$('hud-settings-btn').addEventListener('click', openSettings)
$('settings-close').addEventListener('click', closeSettings)
settingsEl.addEventListener('click', (e) => { if (e.target === settingsEl) closeSettings() })
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (game.photoMode) { togglePhoto(false); return }
  if (settingsEl.classList.contains('hidden')) {
    if (game.phase === 'racing' || game.phase === 'countdown') openSettings()
  } else {
    closeSettings()
  }
})
game.applySettings(settings)

// ── Time of day picker ─────────────────────────────────────────────────
const TOD_KEY = 'horizon-drive-tod'
const WEATHER_KEY = 'horizon-drive-weather'
const todPicker = $('tod-picker')
const todButtons = Array.from(todPicker.querySelectorAll('.tod-btn')) as HTMLButtonElement[]
const weatherButtons = Array.from(document.querySelectorAll('#weather-picker .tod-btn')) as HTMLButtonElement[]
function readStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function store(key: string, v: string): void {
  try { localStorage.setItem(key, v) } catch { /* storage blocked */ }
}
const storedTod = readStored(TOD_KEY)
let tod: TimeOfDay = storedTod === 'midday' || storedTod === 'sunset' || storedTod === 'night' || storedTod === 'morning' ? storedTod : 'sunset'
let raining = readStored(WEATHER_KEY) === 'rain'
function renderConditions(): void {
  todButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset['tod'] === tod)))
  weatherButtons.forEach((b) => b.setAttribute('aria-checked', String((b.dataset['weather'] === 'rain') === raining)))
}
function applyConditions(): void {
  game.setConditions(tod, raining)
  store(TOD_KEY, tod)
  store(WEATHER_KEY, raining ? 'rain' : 'clear')
  renderConditions()
}
todButtons.forEach((b) => b.addEventListener('click', () => { tod = b.dataset['tod'] as TimeOfDay; applyConditions() }))
weatherButtons.forEach((b) => b.addEventListener('click', () => { raining = b.dataset['weather'] === 'rain'; applyConditions() }))
// The sky is baked as clear morning at startup: only re-bake if needed
if (tod !== 'morning' || raining) applyConditions()
else renderConditions()
// A photographed sky has a fixed sun, so the time picker is hidden once one
// loads (rain still works on top of it).
const hdriCheck = setInterval(() => {
  if (game.hasPhotoSky) {
    todPicker.classList.add('disabled')
    clearInterval(hdriCheck)
    if (raining) applyConditions()
  }
}, 500)
setTimeout(() => clearInterval(hdriCheck), 15000)

// ── Splash / start flow ────────────────────────────────────────────────
function startRace(): void {
  splash.classList.add('fading')
  setTimeout(() => splash.classList.add('hidden'), 800)
  game.startRace()
}

function exitToMenu(): void {
  hud.classList.add('hidden')
  endScreen.classList.add('hidden')
  touchControls.classList.add('hidden')
  splash.classList.remove('hidden')
  splash.classList.remove('fading')
  game.exitToAttract()
  lobby.reset()
}

const lobby = new Lobby(game, startRace)

$('retry-btn').addEventListener('click', () => {
  endScreen.classList.add('hidden')
  game.startRace()
})
$('exit-btn').addEventListener('click', exitToMenu)
$('end-exit-btn').addEventListener('click', exitToMenu)

muteBtn.addEventListener('click', () => {
  const muted = !game.audio.isMuted()
  game.audio.setMuted(muted)
  muteBtn.classList.toggle('muted', muted)
})

// ── Touch controls ─────────────────────────────────────────────────────
function bindTouch(id: string, set: (active: boolean) => void): void {
  const el = $(id)
  const on = (e: Event) => { e.preventDefault(); set(true) }
  const off = (e: Event) => { e.preventDefault(); set(false) }
  el.addEventListener('touchstart', on, { passive: false })
  el.addEventListener('touchend', off, { passive: false })
  el.addEventListener('touchcancel', off, { passive: false })
  // Mouse fallback for testing
  el.addEventListener('mousedown', () => set(true))
  el.addEventListener('mouseup', () => set(false))
  el.addEventListener('mouseleave', () => set(false))
}

const input = game.getInput()
bindTouch('touch-accel', (a) => input.setTouchAccelerate(a))
bindTouch('touch-brake', (a) => input.setTouchBrake(a))
bindTouch('touch-left', (a) => input.setTouchLeft(a))
bindTouch('touch-right', (a) => input.setTouchRight(a))
bindTouch('touch-nitro', (a) => input.setTouchNitro(a))

// ── FPS counter (press F) ──────────────────────────────────────────────
{
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:20px;top:64px;z-index:50;padding:4px 10px;border-radius:6px;background:rgba(6,8,18,.6);color:#fff;font:700 15px Rajdhani,sans-serif;display:none'
  document.body.append(el)
  let frames = 0, last = performance.now()
  const tick = (now: number) => {
    frames++
    if (now - last >= 500) {
      el.textContent = `${Math.round(frames * 1000 / (now - last))} FPS`
      frames = 0
      last = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !game.photoMode) el.style.display = el.style.display === 'none' ? 'block' : 'none'
  })
}

// Any key or click skips the finish film straight to the trophy
for (const type of ['keydown', 'pointerdown'] as const) window.addEventListener(type, () => game.skipFinish())
