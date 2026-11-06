import * as THREE from 'three'
import { GameLoop } from '../engine/GameLoop'
import { GameRenderer } from '../engine/Renderer'
import { PostProcessing } from '../engine/PostProcessing'
import { InputManager } from '../engine/Input'
import { Car } from './Car'
import { Track } from './Track'
import { FLIGHT_ZONES, SPACE_ZONES, LOOPS, ROLLS, rollPhase } from './trackData'
import { ChaseCamera } from './ChaseCamera'
import { CinematicCamera } from './CinematicCamera'
import { Scenery } from './Scenery'
import { SpeedEffects } from './SpeedEffects'
import { Rain } from './Weather'
import { ScreenShake } from './ScreenShake'
import { GameAudio } from './Audio'
import { SkySystem, type TimeOfDay } from './Sky'
import { setupLighting, followShadow, setShadowMapSize, DAY_RIG, SPACE_RIG, type LightRig } from './Lighting'
import type { Settings } from '../ui/Settings'
import { setMaxAnisotropy } from './Textures'
import { AssetLoader, type ModelManifest } from './AssetLoader'
import { Minimap } from '../ui/Minimap'
import { BlendedMood } from './biomes/Moods'
import { props } from './biomes/Props'
import { Ghost } from './Ghost'
import { CarFx } from './CarFx'
import { Warp } from './Warp'
import { Trophy } from './biomes/Finish'
import { Flourish } from './Flourish'
import { sweepRoad } from './RoadSweep'
import { savedCar, type CarInfo } from './Catalog'
import { addToBoard, CHALLENGES, doneChallenges, savedPaint, scoreRun, type BoardEntry, type RunStats } from './Progress'
import type { ZoneName } from './Track'
import type { SfxName, LoopName } from './Sfx'

const BASE = import.meta.env.BASE_URL
const MODEL_MANIFEST: ModelManifest = {
  car: `${BASE}models/car_wedge.glb`,
  // Optional realistic car: drop any car GLB here and it replaces the wedge.
  carHQ: `${BASE}models/car_hq.glb`,
  palm: `${BASE}models/palm.glb`,
  streetlight: `${BASE}models/streetlight.glb`,
  building: `${BASE}models/building.glb`,
  rock: `${BASE}models/rock.glb`,
  cone: `${BASE}models/cone.glb`,
  cliff: `${BASE}models/cliff.glb`,
  mountain: `${BASE}models/mountain.glb`,
  skyscraper: `${BASE}models/skyscraper.glb`,
  house: `${BASE}models/house.glb`,
  satellite: `${BASE}models/satellite.glb`,
  rocket: `${BASE}models/rocket.glb`,
  // ── Town biome dressing (biome 1) ──
  townShop: `${BASE}models/town_shop.glb`,
  townStore: `${BASE}models/town_store.glb`,
  townDiner: `${BASE}models/town_diner.glb`,
  townKiosk: `${BASE}models/town_kiosk.glb`,
  townTower2: `${BASE}models/town_tower2.glb`,
  townAwning: `${BASE}models/town_awning.glb`,
  townBillboard: `${BASE}models/town_billboard.glb`,
  townSign: `${BASE}models/town_sign.glb`,
  townTraffic: `${BASE}models/town_traffic.glb`,
  townBench: `${BASE}models/town_bench.glb`,
  townFence: `${BASE}models/town_fence.glb`,
  townCrate: `${BASE}models/town_crate.glb`,
  townVan: `${BASE}models/town_van.glb`,
  townLamp2: `${BASE}models/town_lamp2.glb`,
  townTree: `${BASE}models/town_tree.glb`,
  townPier: `${BASE}models/town_pier.glb`,
  townBoat: `${BASE}models/town_boat.glb`,
  // Quaternius Downtown City MegaKit (CC0): complete buildings
  dtLarge: `${BASE}models/downtown/Building_Large_2.gltf`,
  dtMedium: `${BASE}models/downtown/Building_Medium_2_001.gltf`,
  dtSmall: `${BASE}models/downtown/Building_Small_1.gltf`,
}

export type GamePhase = 'attract' | 'preview' | 'countdown' | 'racing' | 'finished'

export interface GameUI {
  setTime(text: string): void
  setMph(mph: number): void
  setDanger(label: string | null, level: number, color: string, soft?: boolean): void
  showCountdown(label: string): void
  hideCountdown(): void
  onRaceStart(): void
  /** Lap counter, e.g. 2 of 3. */
  setLap(current: number, total: number): void
  /** A lap was completed (not the final one). */
  onLap(lap: number, lapMs: number, isBestLap: boolean): void
  /** Nitro tank 0–1 and whether it is firing. */
  setNitro(level: number, active: boolean): void
  onFinish(result: RaceResult): void
  /** The finish sequence reached the trophy: show the results panel. */
  showResults(): void
  /** Photo mode toggled (hide/show the HUD). */
  onPhotoMode(active: boolean): void
  /** Short event message (speed trap, drift score…). */
  toast(text: string, kind?: 'info' | 'best'): void
  /** Entering a new area: big title + subtitle. */
  area(title: string, subtitle: string): void
}

/** Flash colour as the race enters each area. */
const AREA_FLASH: Partial<Record<string, number>> = {
  town: 0xffd9a8, causeway: 0xffc58a, underwater: 0x7fe6ff, space: 0xc9d4ff, canyon: 0xffb27a,
  volcano: 0xff6a2a, desert: 0xffd28a, saltflat: 0xffffff, snow: 0xe8f4ff, sky: 0xbfe8ff, jungle: 0xb8ff9a, city: 0xff4fd8,
}

/** Area cards shown when the race enters each part of the lap. */
const AREAS: Partial<Record<string, [string, string]>> = {
  town: ['COSMOS BAY', 'Start / finish'],
  causeway: ['OCEAN CAUSEWAY', 'Over the bay'],
  underwater: ['UNDERWATER TUNNEL', 'Double loop ahead'],
  space: ['LUNAR PLATEAU', 'Low gravity · boost pads'],
  canyon: ['RED ROCK CANYON', 'Rockslides · boost strips'],
  volcano: ['VOLCANO', 'Erupting · outrun the lava'],
  desert: ['DUNE SEA', 'Sandstorm ahead'],
  saltflat: ['SALT FLATS', 'Speed trap · flat out'],
  snow: ['ALPINE PASS', 'Ice on the lake'],
  sky: ['SKY ISLANDS', 'Glass highway · barrel roll'],
  jungle: ['RAINFOREST', 'Waterfall · rope bridge'],
  city: ['NEON CITY', 'Elevated highway · tunnel'],
}

export interface RaceResult {
  totalMs: number
  bestTotalMs: number
  isNewBest: boolean
  laps: number[]
  bestLapMs: number
  isNewBestLap: boolean
  /** Medal for the fastest lap: gold / silver / bronze, or none */
  medal: 'GOLD' | 'SILVER' | 'BRONZE' | null
  /** Challenges finished for the first time this race. */
  newChallenges: string[]
  challengesDone: number
  challengesTotal: number
  board: BoardEntry[]
  /** This race's place on the board, or -1. */
  boardPlace: number
}

/** Lap-time targets for the medals (ms). */
const MEDALS: [NonNullable<RaceResult['medal']>, number][] = [['GOLD', 141000], ['SILVER', 154000], ['BRONZE', 171000]]
const SPLIT_KEY = 'horizon-drive-split-'
/** Replay buffer: 30 frames a second for 7 seconds. */
const REPLAY_N = 210
const REPLAY_HZ = 30
/** Finish sequence: slow-motion crossing, trackside replay, then the trophy. */
const FIN_SLOW = 1.5
const FIN_TROPHY = 6.6

const BEST_KEY = 'horizon-drive-best-ms'
const BEST_LAP_KEY = 'horizon-drive-best-lap-ms'
/** Best total time is kept per race length (1 lap keeps the old key). */
const bestTotalKey = (laps: number) => (laps === 1 ? BEST_KEY : `${BEST_KEY}-${laps}laps`)
const readMs = (key: string): number => {
  try { const v = Number(localStorage.getItem(key)); return v > 0 ? v : Infinity } catch { return Infinity }
}
const writeMs = (key: string, ms: number): void => {
  try { localStorage.setItem(key, String(ms)) } catch { /* storage blocked */ }
}
const CHECKPOINT_COUNT = 3 // evenly spaced; finish line is sample 0

export function formatTime(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(millis).padStart(3, '0')}`
}

/** Orchestrator: owns all engine + game systems, drives them by phase. */
/** Average road length per track sample in the space zone (metres). */
const MS_PER_SAMPLE = 1.74

export class Game {
  public phase: GamePhase = 'attract'

  private readonly gfx: GameRenderer
  private readonly post: PostProcessing
  private readonly loop: GameLoop
  private readonly input: InputManager
  private readonly track: Track
  private readonly car: Car
  private readonly chaseCam: ChaseCamera
  private readonly cineCam: CinematicCamera
  private readonly scenery: Scenery
  private readonly effects: SpeedEffects
  private readonly rain: Rain
  /** Base surface fog density (clear 0.0008, denser in rain). */
  private surfaceFog = 0.0008
  // Live car reflections: a small cubemap re-rendered a face or two per frame
  private readonly reflectRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false })
  private readonly reflectCam = new THREE.CubeCamera(0.5, 1500, this.reflectRT)
  private reflectFace = 0
  private reflectFacesPerFrame = 1
  private readonly shake: ScreenShake
  private readonly minimap: Minimap
  public readonly audio: GameAudio
  private readonly lights: LightRig
  private readonly assets: AssetLoader

  // Race state
  private raceTime = 0
  /** Race length in laps (menu: 1 / 3 / 5). */
  public lapCount = 1
  private lapTimes: number[] = []
  private lapStart = 0
  private wasBoosting = false
  // Photo mode: free camera with the world frozen
  public photoMode = false
  private photoYaw = 0
  private photoPitch = 0
  private readonly photoSavedPos = new THREE.Vector3()
  private readonly photoSavedQuat = new THREE.Quaternion()
  private photoSavedFov = 60
  private readonly _pv = new THREE.Vector3()
  private trackIndexHint = 0
  private checkpointsHit: boolean[] = []
  private wasOffTrack = false
  private countdownTimer = 0
  private countdownStep = 0

  // Flight autopilot (ramp jumps into/out of the space biome).
  // `idx` is a fractional sample index advanced at `speed` along the arc.
  private flight: { idx: number; speed: number; off: number; rings: number } | null = null
  /** Riding the vertical loop (scripted: the car follows the loop deck). */
  private loopRide: { idx: number; speed: number; yaw: number; pitch: number; loop: number; roll: number } | null = null

  // Blob shadow decal (replaces the car's real-time shadow)
  private readonly blobShadow: THREE.Group

  private readonly _emptyInput = { accelerate: false, brake: false, left: false, right: false }
  private readonly _lateral = new THREE.Vector3()
  private readonly _flightPos = new THREE.Vector3()

  // Zone atmosphere: sunset ↔ underwater ↔ space
  private readonly fogSurface = new THREE.Color(0xb8c6d4) // replaced by the sky's horizon color
  private readonly fogUnderwater = new THREE.Color(0x0a4d57)
  private readonly fogSpace = new THREE.Color(0x05050f)
  private readonly _fogColor = new THREE.Color()
  private readonly _rigColor = new THREE.Color()
  private underwaterFactor = 0
  private spaceFactor = 0
  private readonly sky: SkySystem
  private readonly mood = new BlendedMood()
  private baseExposure = 0.95
  private baseHeadlights = 0
  readonly ghost: Ghost
  private readonly fx: CarFx
  private readonly warp = new Warp()
  private readonly trophy = new Trophy()
  private trophyT = -1
  private stats: RunStats = this.freshStats()
  private lapRings = 0
  private lastToast = ''
  private lastToastAt = 0
  private flourish!: Flourish
  private roadWet = 0
  /** Throttle pressed this long before GO, or -1. */
  private revAt = -1
  /** Last seconds of driving, replayed trackside at the finish. */
  private readonly replay = new Float32Array(REPLAY_N * 5)
  private replayHead = 0
  private replayCount = 0
  private replayAcc = 0
  private replayT = 0
  private readonly replayCam = new THREE.Vector3()
  private resultsShown = false
  private finishMedal: string | null = null
  private modelProgress = 0
  /** True once every model and prop has loaded and the shaders are built. */
  loaded = false
  /** 0–1 overall loading progress (models, then scanned props). */
  get loadProgress(): number {
    return this.loaded ? 1 : Math.min(0.99, this.modelProgress * 0.4 + props.progress * 0.6)
  }
  private readonly _grade = new Float32Array(9)
  private flash = 0
  private readonly flashColor = new THREE.Color(1, 1, 1)
  private headlights = -1
  private baseBloom: [number, number] = [0.22, 1.15]
  private drafting = false
  private lastArea = ''
  private readonly _white = new THREE.Color(1, 1, 1)
  private readonly _tint = new THREE.Color()
  private readonly biomeEvents = {
    hit: (s: number) => {
      if (this.phase !== 'racing' || this.flight || this.loopRide) return
      this.stats.hits++
      this.car.scrubSpeed(1 - 0.45 * s)
      this.shake.addTrauma(0.25 + 0.4 * s)
      this.car.bump(0.6 + s)
      this.audio.playCollision()
      this.effects.crash(this.car, s > 0.5 ? 2 : 0.8)
    },
    toast: (text: string, kind?: 'info' | 'best') => {
      // the same message twice in a row within 2 s is one message
      if (this.phase !== 'racing' || (text === this.lastToast && this.raceTime - this.lastToastAt < 2000)) return
      this.lastToast = text
      this.lastToastAt = this.raceTime
      this.ui.toast(text, kind)
    },
    draft: (on: boolean) => { this.drafting = on },
    danger: (label: string | null, level: number, color: string, soft?: boolean) => { if (this.phase !== 'preview') this.ui.setDanger(label, level, color, soft) },
    nitro: (a: number) => { this.car.nitro = Math.min(1, this.car.nitro + a) },
    push: (x: number, z: number) => {
      if (this.phase !== 'racing' || this.flight || this.loopRide) return
      this.car.position.x += x
      this.car.position.z += z
    },
    rumble: (a: number) => { if (this.phase === 'racing') this.shake.addTrauma(a) },
    refill: () => { this.car.nitro = 1 },
    flash: (color: number, amount: number) => {
      if (this.phase !== 'racing') return
      this.flashColor.set(color)
      this.flash = Math.max(this.flash, amount)
    },
    wreck: (text: string) => this.wreck(text),
    sfx: (name: SfxName, vol?: number, pitch?: number) => { if (this.phase === 'racing') this.audio.sfx(name, vol, pitch) },
    loop: (name: LoopName, level: number) => { this.audio.setLoop(name, this.phase === 'preview' ? 0 : level) },
  }
  private readonly _shadowFocus = new THREE.Vector3()
  private readonly _camFwd = new THREE.Vector3()

  constructor(
    canvas: HTMLCanvasElement,
    minimapCanvas: HTMLCanvasElement,
    private readonly ui: GameUI
  ) {
    this.gfx = new GameRenderer(canvas)

    // "Auto" quality tier. High (ambient occlusion + 4K shadows) costs
    // ~25 ms a frame on integrated graphics, so auto picks it only on
    // dedicated GPUs. The settings menu can override; so can the URL
    // (?hq = high, ?lowfx = low) for quick testing.
    const params = new URLSearchParams(window.location.search)
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    this.autoTier = params.has('hq') ? 'high' : params.has('lowfx') ? 'low'
      : (!isTouch && !this.gfx.isIntegratedGpu()) ? 'high' : 'medium'
    const highQuality = this.autoTier === 'high'
    this.post = new PostProcessing(this.gfx.renderer, this.gfx.scene, this.gfx.camera, { ao: highQuality, smaa: highQuality, bloom: this.autoTier !== 'low' })
    this.input = new InputManager()
    this.audio = new GameAudio()
    setMaxAnisotropy(Math.min(8, this.gfx.renderer.capabilities.getMaxAnisotropy()))

    this.sky = new SkySystem(this.gfx.renderer, this.gfx.scene)
    this.lights = setupLighting(this.gfx.scene, this.sky.sunDir, highQuality)
    // Photographed skies per time of day (public/hdri/<time>.hdr). Any that
    // exist replace the generated sky for that time; re-apply the current
    // conditions once they've loaded so the change shows immediately.
    void this.sky.loadHdris({
      morning: `${BASE}hdri/morning.hdr`,
      midday: `${BASE}hdri/midday.hdr`,
      sunset: `${BASE}hdri/sunset.hdr`,
    }).then((loaded) => {
      if (loaded) this.setConditions(this.sky.currentTod, this.sky.rain > 0.5)
    })

    this.track = new Track()
    this.gfx.scene.add(this.track.group)

    this.scenery = new Scenery(this.track)
    this.gfx.scene.add(this.scenery.group)

    this.car = new Car()
    this.car.setPaint(savedPaint().hex)
    this.car.reset(this.track.spawnPosition, this.track.spawnHeading)
    this.gfx.scene.add(this.car.mesh)

    // Load real models async; swap them in when ready (procedural fallback
    // keeps the game fully playable until/unless they arrive).
    this.assets = new AssetLoader()
    // Flatten every scenery model to one mesh per material (huge draw-call
    // win). The car is excluded: Car.applyModel() locates wheels by node name.
    void this.assets.loadAll(MODEL_MANIFEST, (f) => { this.modelProgress = f }, (name) => name !== 'car' && name !== 'carHQ').then(() => {
      void this.setCar(savedCar())
      this.scenery.applyModels((name) => this.assets.get(name))
      return this.scenery.biomes.propsReady
    }).then(() => {
      sweepRoad(this.scenery.group, this.track)
      this.precompile()
      this.loaded = true
    })

    this.fx = new CarFx()
    this.gfx.scene.add(this.fx.group, this.warp.mesh, this.trophy.group)
    this.flourish = new Flourish(this.track, (i) => this.scenery.biomes.enclosed(i))
    this.gfx.scene.add(this.flourish.group)
    this.ghost = new Ghost(this.track.sampleCount + ':' + Math.round(this.track.length))
    this.ghost.buildPace(this.track, 62)
    this.gfx.scene.add(this.ghost.mesh)
    this.blobShadow = this.buildBlobShadow()
    this.gfx.scene.add(this.blobShadow)

    this.chaseCam = new ChaseCamera()
    this.cineCam = new CinematicCamera()
    this.effects = new SpeedEffects(this.gfx.scene)
    this.rain = new Rain()
    this.gfx.scene.add(this.rain.lines)
    // Faces are rendered by hand (round-robin), so set up the cube cameras'
    // orientation for this renderer once, as CubeCamera.update() would.
    this.reflectCam.coordinateSystem = this.gfx.renderer.coordinateSystem
    this.reflectCam.updateCoordinateSystem()
    this.applySkyLighting() // needs car + effects (headlights, smoke color)
    this.shake = new ScreenShake()
    this.minimap = new Minimap(minimapCanvas, this.track)
    this.minimap.drawStatic()

    window.addEventListener('resize', this.onResize)

    this.loop = new GameLoop(this.update, this.render)
    this.loop.start()

    // Dev debug hook (harmless in prod; used for headless frame capture)
    ;(window as unknown as Record<string, unknown>)['__hd'] = this
  }

  /**
   * Morning / midday / sunset. Re-bakes the procedural sky and relights the
   * world; ignored (returns false) when a photographed HDRI sky is in use.
   */
  setTimeOfDay(tod: TimeOfDay): boolean {
    return this.setConditions(tod, this.sky.rain > 0.5)
  }

  /**
   * Time of day + weather together. Returns false if the time of day could
   * not change (a photographed HDRI sky fixes the sun; rain still applies).
   */
  setConditions(tod: TimeOfDay, raining: boolean): boolean {
    const ok = this.sky.setConditions(tod, raining)
    this.applySkyLighting()
    return ok
  }

  /** Quality tier chosen by 'auto' for this device (or forced by the URL). */
  public readonly autoTier: 'low' | 'medium' | 'high'
  /** Tier actually in use after applySettings(). */
  public activeTier: 'low' | 'medium' | 'high' = 'medium'

  /**
   * Apply player settings live: quality tier (resolution, shadows, AO,
   * anti-aliasing, bloom), volume, motion blur and camera distance.
   */
  applySettings(s: Settings): void {
    const tier = s.quality === 'auto' ? this.autoTier : s.quality
    this.activeTier = tier
    const dpr = window.devicePixelRatio || 1
    const r = this.gfx.renderer
    if (tier === 'low') {
      r.setPixelRatio(Math.min(dpr, 1) * 0.8)
      setShadowMapSize(this.lights, 1024)
      this.post.setOptions({ ao: false, smaa: false, bloom: false })
    } else if (tier === 'medium') {
      r.setPixelRatio(Math.min(dpr, 1.5))
      setShadowMapSize(this.lights, 2048)
      this.post.setOptions({ ao: false, smaa: false, bloom: true })
    } else {
      r.setPixelRatio(Math.min(dpr, 2))
      setShadowMapSize(this.lights, 4096)
      this.post.setOptions({ ao: true, smaa: true, bloom: true })
    }
    this.onResize()
    // Live car reflections: off on Low, 1 cube face per frame on Medium
    // (full refresh 10×/s), 2 on High
    this.reflectFacesPerFrame = tier === 'low' ? 0 : tier === 'medium' ? 1 : 2
    this.car.setReflection(tier === 'low' ? null : this.reflectRT.texture)
    this.post.setMotionBlur(s.motionBlur)
    this.audio.setVolume(s.volume)
    this.chaseCam.setDistanceScale(s.camera === 'near' ? 0.8 : s.camera === 'far' ? 1.25 : 1)
  }

  /** Swap to another car: its model and its handling. */
  async setCar(info: CarInfo): Promise<void> {
    const ticket = ++this.carTicket
    if (info.file && !this.assets.get(info.model)) await this.assets.loadAll({ [info.model]: `${BASE}models/${info.file}` }, () => undefined, () => false)
    if (ticket !== this.carTicket) return // picked another while this one loaded
    const model = this.assets.get(info.model) ?? this.assets.get('car')
    this.car.setStats(info.stats)
    if (!model) return
    const yaw = this.car.heading, tilt = this.car.mesh.rotation.x
    this.car.applyModel(model, 4.5, 0, !!info.hq)
    this.car.mesh.rotation.set(tilt, yaw, 0)
    this.car.setPaint(savedPaint().hex)
  }
  private carTicket = 0

  // ── Track preview: the car drives a stretch of road behind the menu ──
  private previewRun: number[] = []
  private previewPos = 0
  private previewT = 0

  /** Drive the stretch of road `at` (0–1) of the way through this zone. */
  startPreview(zone: ZoneName, at: number): void {
    const t = this.track, n = t.sampleCount
    const ids: number[] = []
    for (let i = 0; i < n; i++) if (t.zoneOfSample(i) === zone) ids.push(i)
    const run: number[] = []
    for (let i = ids[Math.floor(ids.length * at)] ?? 0; run.length < 520; i = (i + 1) % n) {
      const z = t.zoneOfSample(i)
      if (t.isGap(i) || z === 'loop' || z === 'roll') { if (run.length > 150) break; run.length = 0; continue }
      run.push(i)
    }
    this.previewRun = run
    this.previewPos = 0
    this.previewT = 0
    this.flight = null
    this.loopRide = null
    this.clearHop()
    this.ghost.mesh.visible = false
    this.phase = 'preview'
    this.car.setSpeed(40)
  }

  /** Back to the car on the start line. */
  stopPreview(): void {
    if (this.phase !== 'preview') return
    this.phase = 'attract'
    this.resetRaceState()
  }

  private updatePreview(dt: number): void {
    const t = this.track, run = this.previewRun
    if (!run.length) return
    this.previewT += dt
    this.previewPos += (40 * dt) / MS_PER_SAMPLE
    if (this.previewPos >= run.length - 2) {
      this.previewPos = 0
      this.flashColor.set(0x000000)
      this.flash = 1
    }
    const k = Math.floor(this.previewPos), fr = this.previewPos - k
    const i = run[k]!, tg = t.tangents[i]!
    this._flightPos.lerpVectors(t.samples[i]!, t.samples[run[k + 1]!]!, fr)
    this.car.setPose(this._flightPos, Math.atan2(-tg.x, -tg.z))
    this.car.setSlopePitch(Math.asin(THREE.MathUtils.clamp(tg.y, -1, 1)), 0.2)
    this.car.mesh.rotation.z = Math.atan(t.bank[i]!)
    this.car.spinWheels(40 * dt)
    this.trackIndexHint = i
    this.updateBlobShadow(this._flightPos.y)

    // three slow cuts; a tunnel only has room for the view from behind
    const cam = this.gfx.camera, p = this._flightPos
    const fx = -Math.sin(this.car.heading), fz = -Math.cos(this.car.heading), rx = -fz, rz = fx
    const shot = this.scenery.biomes.enclosed(i) ? 0 : Math.floor(this.previewT / 6) % 3
    const s = Math.sin(this.previewT * 0.35)
    if (shot === 0) {
      cam.position.set(p.x - fx * 10 + rx * s * 4, p.y + 3, p.z - fz * 10 + rz * s * 4)
      cam.lookAt(p.x + fx * 12, p.y + 1.6, p.z + fz * 12)
    } else if (shot === 1) {
      cam.position.set(p.x + fx * 13 + rx * 7, p.y + 1.7, p.z + fz * 13 + rz * 7)
      cam.lookAt(p.x, p.y + 1, p.z)
    } else {
      cam.position.set(p.x - fx * 5 + rx * 15, p.y + 8, p.z - fz * 5 + rz * 15)
      cam.lookAt(p.x + fx * 8, p.y + 1, p.z + fz * 8)
    }
    if (cam.fov !== 56) { cam.fov = 56; cam.updateProjectionMatrix() }
  }

  /** Respray the car. */
  setPaint(hex: number): void { this.car.setPaint(hex) }

  /** Freeze / resume the whole game (settings panel open mid-race). */
  setPaused(paused: boolean): void {
    if (paused) this.loop.stop()
    else this.loop.start()
    this.audio.setPaused(paused)
  }

  /**
   * Photo skies are now chosen per time of day, so the time picker always
   * stays available. (Kept for main.ts; never hides the picker.)
   */
  get hasPhotoSky(): boolean {
    return false
  }

  /**
   * Compile every material up front (all biomes shown for the call), so the
   * first look at a new area doesn't stall the race while shaders build.
   */
  private precompile(): void {
    // synchronous, so no frame is ever drawn with everything switched on
    const hidden: THREE.Object3D[] = []
    const reveal = (o: THREE.Object3D) => { if (!o.visible) { hidden.push(o); o.visible = true } }
    this.scenery.group.traverse(reveal)
    this.flourish.group.traverse(reveal)
    const cam = this.gfx.camera
    const pos = cam.position.clone(), quat = cam.quaternion.clone(), far = cam.far, fov = cam.fov
    // particles only appear in their biomes: give them a weight for the frame
    const ps = this.scenery.biomes.particles
    ps.update(cam, 0, 0, { ash: 1, embers: 1, snow: 1, sand: 1, pollen: 1 })
    try {
      // a couple of frames of the whole world from high above, through the
      // real render path: uploads every mesh and texture and builds every
      // shader (including the shadow pass) before the race needs them
      cam.far = 9000
      cam.fov = 120
      cam.updateProjectionMatrix()
      for (const [x, z] of [[0, -300], [300, 400], [700, -700]] as const) {
        cam.position.set(x, 2600, z)
        cam.lookAt(x, 0, z)
        this.sky.follow(cam.position)
        this.post.render(0)
        // the car's reflection probe renders without the car (so without its
        // headlight): every material needs that light setup compiled too
        const r = this.gfx.renderer
        this.car.mesh.visible = false
        r.setRenderTarget(this.reflectRT, 3)
        r.render(this.gfx.scene, cam)
        r.setRenderTarget(null)
        this.car.mesh.visible = true
      }
    } finally {
      for (const o of hidden) o.visible = false
      cam.far = far
      cam.fov = fov
      cam.updateProjectionMatrix()
      cam.position.copy(pos)
      cam.quaternion.copy(quat)
      this.sky.follow(pos)
      this.post.render(0) // leave a normal frame on screen
    }
  }

  /** Copy the sky's sun direction/color and horizon haze into lights + fog. */
  private applySkyLighting(): void {
    DAY_RIG.sunColor.copy(this.sky.sunColor)
    this.lights.sun.color.copy(this.sky.sunColor)
    this.fogSurface.copy(this.sky.horizonColor)
    // Smoke is lit by the same sky (orange at sunset, white at noon)
    this.effects.smokeColor.copy(this.sky.horizonColor).multiplyScalar(1.25)
    const night = this.sky.night
    const wet = this.sky.rain
    // Headlights on when the sun is low, at night, or in the rain
    const low = night ? 0 : 1 - THREE.MathUtils.smoothstep(this.sky.sunDir.y, 0.05, 0.25)
    this.baseHeadlights = Math.max(low, night, wet * 0.7)
    this.car.setHeadlights(this.baseHeadlights)
    // Night: lamps, windows, stars; brighter exposure and stronger glow
    this.scenery.setNight(night)
    this.baseExposure = night ? 1.3 : wet ? 1.05 : 0.95
    this.baseBloom = [night ? 0.48 : 0.34, night ? 0.7 : 1.0]
    this.gfx.renderer.toneMappingExposure = this.baseExposure
    this.post.setBloom(this.baseBloom[0], this.baseBloom[1])
    // Rain: wet road + ground, falling rain, tyre spray, rain sound, denser haze
    this.track.setWetness(wet)
    this.scenery.setWet(wet)
    this.effects.wetness = wet
    this.rain.setLevel(wet)
    this.audio.setRain(wet)
    this.surfaceFog = wet ? 0.0026 : night ? 0.0013 : 0.0011
  }

  /**
   * Re-render part of the car's reflection cubemap (round-robin faces) from
   * the car's position, so its paint and glass mirror the real buildings,
   * trees and road around it instead of only the sky.
   */
  private updateCarReflection(): void {
    const n = this.reflectFacesPerFrame
    if (n <= 0) return
    const r = this.gfx.renderer
    const cam = this.reflectCam
    cam.position.copy(this.car.position)
    cam.position.y += 0.9
    cam.updateMatrixWorld()
    const prevTarget = r.getRenderTarget()
    const prevAuto = r.shadowMap.autoUpdate
    r.shadowMap.autoUpdate = false // reuse this frame's shadow map
    this.car.mesh.visible = false
    this.blobShadow.visible = false
    const rainVisible = this.rain.lines.visible
    this.rain.lines.visible = false
    for (let k = 0; k < n; k++) {
      r.setRenderTarget(this.reflectRT, this.reflectFace)
      r.render(this.gfx.scene, cam.children[this.reflectFace] as THREE.Camera)
      this.reflectFace = (this.reflectFace + 1) % 6
      if (this.reflectFace === 0) this.reflectRT.texture.needsPMREMUpdate = true
    }
    r.setRenderTarget(prevTarget)
    r.shadowMap.autoUpdate = prevAuto
    this.car.mesh.visible = true
    this.blobShadow.visible = this.flight === null && this.loopRide === null
    this.rain.lines.visible = rainVisible
  }

  private onResize = (): void => {
    this.gfx.resize(window.innerWidth, window.innerHeight)
    this.post.resize(window.innerWidth, window.innerHeight)
  }

  // ── Blob shadow ──────────────────────────────────────────────────────
  private buildBlobShadow(): THREE.Group {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 128
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62)
    // Soft contact shadow only — the real shadow map now draws the car's shadow
    g.addColorStop(0, 'rgba(0,0,0,0.45)')
    g.addColorStop(0.5, 'rgba(0,0,0,0.25)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    const tex = new THREE.CanvasTexture(c)

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 5.6),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      })
    )
    plane.rotation.x = -Math.PI / 2
    plane.renderOrder = 1
    const group = new THREE.Group()
    group.add(plane)
    return group
  }

  private updateBlobShadow(roadY: number): void {
    this.blobShadow.visible = this.flight === null && this.loopRide === null
    this.blobShadow.position.set(this.car.position.x, roadY + 0.05, this.car.position.z)
    this.blobShadow.rotation.y = this.car.heading
  }

  // ── Phase transitions ────────────────────────────────────────────────

  startRace(): void {
    this.audio.unlock()
    this.resetRaceState()
    this.chaseCam.snap(this.gfx.camera, this.car)
    this.audio.startEngine()
    this.ui.onRaceStart()

    // Dev flag (same trick the real game ships): skip the 3-2-1
    if (new URLSearchParams(window.location.search).has('skipcountdown')) {
      this.phase = 'racing'
      this.ui.hideCountdown()
      return
    }
    this.phase = 'countdown'
    this.countdownTimer = 0
    this.countdownStep = 0
  }

  exitToAttract(): void {
    this.phase = 'attract'
    this.audio.stopEngine()
    this.resetRaceState()
    this.ui.hideCountdown()
  }

  private resetRaceState(): void {
    this.car.reset(this.track.spawnPosition, this.track.spawnHeading)
    this.raceTime = 0
    this.lapTimes = []
    this.lapStart = 0
    this.ui.setLap(1, this.lapCount)
    this.ui.setNitro(1, false)
    this.trackIndexHint = 0
    this.checkpointsHit = new Array<boolean>(CHECKPOINT_COUNT).fill(false)
    this.lastArea = ''
    this.ghost.mesh.visible = false
    this.trophy.hide()
    this.trophyT = -1
    this.revAt = -1
    this.stats = this.freshStats()
    this.lapRings = 0
    this.replayCount = 0
    this.resultsShown = false
    this.flourish.rearm()
    this.scenery.biomes.stadium.rearm()
    this.ghost.startLap(this.car.mesh)
    this.wasOffTrack = false
    this.flight = null
    this.loopRide = null
    this.hopping = false
    this.hopY = 0
    this.effects.clear()
    this.ui.setTime(formatTime(0))
    this.ui.setMph(0)
    this.minimap.update(this.car.position)
  }

  // ── Main update ──────────────────────────────────────────────────────

  private update = (dt: number, time: number): void => {
    if (this.photoMode) {
      // World frozen; only the free camera moves (clouds/water keep animating)
      this.updatePhotoCamera(dt)
      this.sky.update(time)
      this.sky.follow(this.gfx.camera.position)
      return
    }
    this.scenery.update(time, dt)
    this.scenery.biomes.update({
      time, dt, camera: this.gfx.camera, carPos: this.car.position, carIdx: this.trackIndexHint,
      carSpeed: Math.abs(this.car.getSpeed()), zone: this.track.zoneOfSample(this.trackIndexHint), night: this.sky.night,
    }, this.biomeEvents)

    switch (this.phase) {
      case 'attract':
        this.cineCam.update(this.gfx.camera, dt, this.car.mesh.position, this.car.heading)
        this.post.setSpeed(0)
        break

      case 'preview':
        this.updatePreview(dt)
        this.post.setSpeed(0.2)
        break

      case 'countdown':
        this.updateCountdown(dt)
        this.car.update(dt, this._emptyInput)
        this.followTrack(dt)
        this.updateCountdownCam()
        this.audio.updateEngine(this.input.get().accelerate ? 0.55 : 0.05)
        break

      case 'racing':
        this.updateRacing(dt)
        break

      case 'finished':
        this.updateFinish(dt)
        this.audio.updateEngine(this.car.getNormalizedSpeed() * 0.4)
        this.post.setSpeed(0)
        break
    }

    this.updateAtmosphere(dt, time)
    this.updateWarp(dt, time)
    if (this.phase !== 'attract') {
      const z = this.track.zoneOfSample(this.trackIndexHint)
      this.flourish.update({ time, dt, idx: this.trackIndexHint, zone: z, carPos: this.car.position, sfx: this.biomeEvents.sfx }, this.flight !== null)
      // salt that mirrors the sky, neon on wet streets
      const wet = Math.max(this.sky.rain, z === 'saltflat' ? 0.9 : z === 'city' && this.mood.dayLit < 0.5 ? 0.7 : 0)
      this.roadWet += (wet - this.roadWet) * (1 - Math.pow(0.05, dt))
      this.track.setWetness(this.roadWet)
    }
    {
      const i = this.trackIndexHint, biomes = this.scenery.biomes
      const zone = this.phase === 'attract' ? 'town' : this.gfx.camera.position.y < 0 ? 'underwater' : this.track.zoneOfSample(i)
      this.audio.setWorld(zone, this.underwaterFactor, this.spaceFactor, this.phase !== 'attract' && biomes.enclosed(i), dt)
    }
    this.scenery.updateUnderwater(time, this.gfx.camera)
    this.sky.update(time)
    this.sky.follow(this.gfx.camera.position)
    this.post.setTime(time)
    this.shake.update(this.gfx.camera, dt)
    this.updateShadowFocus()
    // Rain stays above water and out of space
    this.rain.update(this.gfx.camera, dt, this.underwaterFactor < 0.2 && this.spaceFactor < 0.2)
  }

  /** Centre the sharp shadow box a little ahead of the camera. */
  private updateShadowFocus(): void {
    const cam = this.gfx.camera
    cam.getWorldDirection(this._camFwd)
    this._camFwd.y = 0
    this._camFwd.normalize()
    this._shadowFocus.copy(cam.position).addScaledVector(this._camFwd, 35)
    this._shadowFocus.y = this.car.position.y
    followShadow(this.lights, this._shadowFocus, this.sky.sunDir)
  }

  /** Elevation + slope pitch: glue the car to the track ribbon. */
  private followTrack(dt: number): void {
    const nearest = this.track.nearest(this.car.position, this.trackIndexHint)
    this.trackIndexHint = nearest.index
    // banked corners: the car sits on the tilted surface, wherever it is across it
    const bank = this.track.bank[nearest.index]!
    const tg = this.track.tangents[nearest.index]!
    const across = ((this.car.position.x - nearest.point.x) * -tg.z + (this.car.position.z - nearest.point.z) * tg.x) / (Math.hypot(tg.x, tg.z) || 1)
    const targetY = nearest.point.y + this.hopY + bank * THREE.MathUtils.clamp(across, -10.5, 10.5)
    if (!this.hopSpin) this.car.mesh.rotation.z = THREE.MathUtils.lerp(this.car.mesh.rotation.z, Math.atan(bank), 0.2)

    // Vertical follow must be STIFF on slopes or the car clips through
    // ramps. On flat ground a gentler follow smooths over bumps; the
    // steeper the road, the harder we snap the car onto the surface.
    const tangent = this.track.tangents[nearest.index]!
    const slope = Math.abs(tangent.y)
    const yRate = slope > 0.12 || this.hopping
      ? 1 // steep (ramp): hard-lock to the surface
      : 1 - Math.pow(0.00002, dt)
    this.car.position.y = THREE.MathUtils.lerp(this.car.position.y, targetY, yRate)
    this.car.mesh.position.y = this.car.position.y

    // In a low-gravity hop the nose follows the arc a little
    this.car.setSlopePitch(Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1)) + (this.hopping ? this.hopV * 0.018 : 0))
    this.updateBlobShadow(nearest.point.y)
  }

  private warpLevel = 0
  /** Light-speed on the way to the moon, burning re-entry on the way down. */
  private updateWarp(dt: number, time: number): void {
    const f = this.flight
    const z = f ? this.track.zoneOfSample(this.trackIndexHint) : ''
    const target = z === 'flight1' || z === 'flight2' ? 1 : 0
    this.warpLevel += (target - this.warpLevel) * (1 - Math.pow(0.002, dt))
    if (this.warpLevel > 0.3) this.chaseCam.kick(26 * this.warpLevel)
    const cam = this.gfx.camera
    cam.getWorldDirection(this._camFwd)
    const down = z === 'flight2' || (!f && this.track.zoneOfSample(this.trackIndexHint) === 'canyon')
    this.warp.update(time * 1.6, this.warpLevel, cam.position, this._camFwd, down ? 0xff6a1e : 0x5a2cff, down ? 0xffd26a : 0x38e8ff)
  }

  /** Lerp fog, sky, road and light rig between sunset / underwater / space. */
  private updateAtmosphere(dt: number, time: number): void {
    const zone = this.track.zoneOfSample(this.trackIndexHint)
    const inRace = this.phase !== 'attract'

    // Underwater look follows the CAMERA crossing the sea surface (sharp,
    // like dipping a real camera in), not the car's depth
    const camY = this.gfx.camera.position.y
    const uwTarget = inRace ? THREE.MathUtils.clamp((0.2 - camY) / 1.2, 0, 1) : 0
    const spaceTarget = !inRace ? 0 : SPACE_ZONES.has(zone) ? 1 : zone === 'rampUp' ? 0.35 : 0

    const rate = 1 - Math.pow(0.005, dt)
    this.underwaterFactor = THREE.MathUtils.lerp(this.underwaterFactor, uwTarget, rate)
    this.spaceFactor = THREE.MathUtils.lerp(this.spaceFactor, spaceTarget, rate)
    const fUw = this.underwaterFactor * (1 - this.spaceFactor)
    const fSpace = this.spaceFactor

    // Biome mood (volcano ash, alpine haze, neon night…) on the surface look
    const m = this.mood
    const mw = this.scenery.biomes.moods.sample(this.trackIndexHint, m) * (1 - fUw) * (1 - fSpace)
    const night = this.sky.night
    const dayLum = THREE.MathUtils.lerp(1, 1 - 0.8 * night, m.dayLit)
    this._fogColor.copy(this.fogSurface).lerp(this._tint.copy(m.fog).multiplyScalar(dayLum), mw)
    const surfFog = THREE.MathUtils.lerp(this.surfaceFog, Math.max(this.surfaceFog * 0.8, m.fogDensity), mw)
    this.sky.setMood(mw * m.skyMix, this._tint.copy(m.skyTop).multiplyScalar(dayLum), this._rigColor.copy(m.skyHorizon).multiplyScalar(dayLum),
      m.stars * mw, m.aurora * mw * Math.max(night, 0.15 * (1 - m.dayLit)))
    this.scenery.biomes.particles.update(this.gfx.camera, dt, time, m.particles)
    // dark biomes (the night city, the volcano's ash cloud) switch the lights on
    const lights = Math.max(this.baseHeadlights, mw * (1 - m.dayLit), mw * (1 - m.sun) * 0.8)
    if (Math.abs(lights - this.headlights) > 0.02) { this.headlights = lights; this.car.setHeadlights(lights) }

    // Fog: surface → underwater → space
    this._fogColor.lerp(this.fogUnderwater, fUw)
    this._fogColor.lerp(this.fogSpace, fSpace)
    const density = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(surfFog, 0.016, fUw),
      0.0008,
      fSpace
    )

    const fog = this.gfx.scene.fog as THREE.FogExp2
    fog.color.copy(this._fogColor)
    fog.density = density
    this.track.setCaustics(fUw, time)

    this.sky.setZones(fUw, fSpace)
    // Sky reflections fade out underwater / in space
    this.gfx.scene.environmentIntensity = THREE.MathUtils.lerp(this.sky.envIntensity, 0.35, Math.max(fUw, fSpace)) * THREE.MathUtils.lerp(1, m.env, mw)
    this.gfx.renderer.toneMappingExposure = this.baseExposure * THREE.MathUtils.lerp(1, m.exposure, mw)
    this.post.setBloom(this.baseBloom[0] + m.bloom * mw, this.baseBloom[1] - 0.35 * m.bloom * mw)
    // per-area colour grade, plus the flash that marks entering a new area
    this.scenery.biomes.grades.sample(this.trackIndexHint, this._grade)
    this.post.setGrade(this._grade)
    this.fx.update(dt, time, this.car.mesh, this.car.heading, this.flight ? 1.1 : this.loopRide ? this.loopRide.speed / 60 : this.car.getNormalizedSpeed(), this.track.accents[this.trackIndexHint]!,
      inRace && !this.flight && !this.loopRide && !this.hopping && this.phase !== 'finished', this.gfx.camera, this.sky.sunDir, (1 - fUw) * (1 - fSpace) * (1 - (1 - m.dayLit) * mw) * (1 - this.sky.night) * (1 - this.sky.rain))
    this.flash = Math.max(0, this.flash - dt * 2.2)
    this.post.setFlash(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash * this.flash * 0.55)
    this.scenery.setSpaceFactor(fSpace, fUw)
    // Per-biome culling: only the current biome's props (+ neighbours) render,
    // so no biome's scenery bleeds into another. Submerged hides all surface.
    const submerged = inRace && camY < -0.15
    const currentBiome = Scenery.biomeOfZone(zone)
    this.scenery.updateVisibility(currentBiome, submerged, inRace && this.spaceFactor > 0.5,
      zone === 'rampUp' || SPACE_ZONES.has(zone), this.gfx.camera.position)
    // a whole world swapping in or out hides behind a flash
    if (this.scenery.exclusiveChanged && inRace) {
      this.flashColor.set(submerged ? 0x7fe6ff : 0xffffff)
      this.flash = 1
    }

    // Light rig: daylight ↔ cold space
    const L = this.lights
    L.hemi.intensity = THREE.MathUtils.lerp(DAY_RIG.hemiIntensity * this.sky.ambientScale, SPACE_RIG.hemiIntensity, fSpace)
    L.hemi.color.copy(this._rigColor.lerpColors(DAY_RIG.hemiSky, SPACE_RIG.hemiSky, fSpace))
    L.hemi.groundColor.copy(this._rigColor.lerpColors(DAY_RIG.hemiGround, SPACE_RIG.hemiGround, fSpace))
    L.sun.intensity = THREE.MathUtils.lerp(DAY_RIG.sunIntensity * this.sky.sunStrength, SPACE_RIG.sunIntensity, fSpace)
    L.sun.color.copy(this._rigColor.lerpColors(DAY_RIG.sunColor, SPACE_RIG.sunColor, fSpace))
    L.fill.intensity = THREE.MathUtils.lerp(DAY_RIG.fillIntensity, SPACE_RIG.fillIntensity, fSpace)
    L.fill.color.copy(this._rigColor.lerpColors(DAY_RIG.fillColor, SPACE_RIG.fillColor, fSpace))
    L.ambient.intensity = THREE.MathUtils.lerp(DAY_RIG.ambientIntensity, SPACE_RIG.ambientIntensity, fSpace)
    L.ambient.color.copy(this._rigColor.lerpColors(DAY_RIG.ambientColor, SPACE_RIG.ambientColor, fSpace))
    if (mw > 0.001) {
      const k = THREE.MathUtils.lerp(1, m.hemi, mw)
      L.sun.intensity *= THREE.MathUtils.lerp(1, m.sun, mw)
      L.hemi.intensity *= k
      L.fill.intensity *= k
      L.ambient.intensity *= k
      L.hemi.color.multiply(this._tint.copy(this._white).lerp(m.hemiTint, mw))
    }
  }

  private updateCountdown(dt: number): void {
    this.countdownTimer += dt
    const steps = ['3', '2', '1', 'GO']
    const stepDuration = 0.9

    const expectedStep = Math.floor(this.countdownTimer / stepDuration)
    if (expectedStep > this.countdownStep - 1 && this.countdownStep < steps.length) {
      const label = steps[this.countdownStep]!
      this.ui.showCountdown(label)
      if (label === 'GO') this.audio.playGoBeep()
      else this.audio.playCountdownBeep()
      this.countdownStep++
    }

    const accel = this.input.get().accelerate
    if (!accel) this.revAt = -1
    else if (this.revAt < 0) this.revAt = this.countdownTimer

    if (this.countdownTimer >= stepDuration * 3) {
      this.phase = 'racing'
      // Throttle caught in the last moment before GO: a perfect launch
      const perfect = this.revAt >= stepDuration * 3 - 0.7
      this.car.launch = perfect ? 7 : 4
      if (perfect) {
        this.stats.perfectLaunch = true
        this.car.setSpeed(30)
        this.chaseCam.kick(14)
        this.shake.addTrauma(0.3)
        this.audio.playBoost()
        this.ui.toast('PERFECT LAUNCH', 'best')
      }
      this.scenery.biomes.stadium.celebrate(2.5)
      setTimeout(() => this.ui.hideCountdown(), 700)
    }
  }

  /** Sweep from the nose round to the chase position during the 3-2-1. */
  private updateCountdownCam(): void {
    const u = THREE.MathUtils.clamp(this.countdownTimer / 2.5, 0, 1)
    const e = u * u * (3 - 2 * u)
    const cam = this.gfx.camera, p = this.car.position, a = this.car.heading + (1 - e) * 2.7
    const r = THREE.MathUtils.lerp(6.2, 7.8, e)
    cam.position.set(p.x + Math.sin(a) * r, p.y + THREE.MathUtils.lerp(0.9, 3.1, e), p.z + Math.cos(a) * r)
    const f = this.car.getForwardDir(this._pv)
    cam.lookAt(p.x + f.x * 8 * e, p.y + THREE.MathUtils.lerp(0.8, 2.1, e), p.z + f.z * 8 * e)
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix() }
  }

  /** Engine destroyed: stop dead on the road, pay the time, drive on. */
  private wreck(text: string): void {
    if (this.phase !== 'racing' || this.flight || this.loopRide) return
    this.clearHop()
    this.effects.crash(this.car, 5)
    const near = this.track.nearest(this.car.position, this.trackIndexHint)
    const t = this.track.tangents[near.index]!
    this.car.setPose(near.point, Math.atan2(-t.x, -t.z))
    this.car.setSpeed(0)
    this.car.launch = 3
    this.raceTime += 4000
    this.stats.melts++
    this.flashColor.set(0xff7a2a)
    this.flash = 1
    this.shake.addTrauma(0.8)
    this.audio.sfx('meltdown')
    this.ui.toast(text)
  }

  /** Dust colour for the ground the car lands on. */
  private groundColor(): THREE.Color {
    const z = this.track.zoneOfSample(this.trackIndexHint)
    return this._dust.set(z === 'snow' ? 0xeef4fb : z === 'desert' ? 0xd8ab6e : z === 'saltflat' ? 0xf1ece2 : z === 'canyon' ? 0xb0683f : z === 'volcano' ? 0x3a3432 : z === 'space' ? 0x9b9b9f : 0x8c8378)
  }
  private readonly _dust = new THREE.Color()

  // ── Racing (with flight autopilot for the ramp jumps) ────────────────

  private updateRacing(dt: number): void {
    const prevIdx = this.trackIndexHint

    if (this.loopRide) {
      this.updateLoop(dt)
    } else if (this.flight) {
      this.updateFlight(dt)
    } else {
      const zone = this.track.zoneOfSample(this.trackIndexHint)
      if (zone === 'loop' || zone === 'roll') {
        this.startLoop()
        this.updateLoop(dt)
      } else if (FLIGHT_ZONES.has(zone)) {
        this.startFlight()
        this.updateFlight(dt)
      } else {
        const input = this.input.get()
        const surf = this.hopping ? null : this.scenery.biomes.surface(this.trackIndexHint)
        this.car.surfaceSlip = surf?.slip ?? 0
        this.car.surfaceDrag = surf?.drag ?? 0
        this.car.topBonus = zone === 'saltflat' ? 1.14 : 1
        if (zone === 'saltflat') this.stats.saltMph = Math.max(this.stats.saltMph, this.car.getSpeedMph())
        this.car.update(dt, input)
        this.followTrack(dt)
        this.handleTrackBoundary()
        this.updateSpacePlay(prevIdx, dt)
        this.scenery.biomes.snow.addDrift(this.car.getSlip(), Math.abs(this.car.getSpeed()), dt)
        if (this.drafting) {
          // slipstream: refills nitro and tows you along a little
          this.car.nitro = Math.min(1, this.car.nitro + dt * 0.3)
          this.car.setSpeed(Math.min(this.car.topSpeed * 1.1, Math.abs(this.car.getSpeed()) + 4 * dt))
        }
        this.updateArea()
      }
    }

    this.handleProgress(prevIdx)

    this.recordReplay(dt)
    this.raceTime += dt * 1000
    this.ghost.record(this.raceTime - this.lapStart, this.car.mesh)
    this.ghost.update(this.raceTime - this.lapStart, true)
    this.ui.setTime(formatTime(this.raceTime))
    this.ui.setMph(Math.round(this.loopRide ? this.loopRide.speed * 2.237 : this.flight ? this.flight.speed * 2.237 + this.warpLevel * 700 : this.car.getSpeedMph()))

    if (this.loopRide && this.loopRide.loop >= 0) this.updateLoopCamera(dt)
    else this.chaseCam.update(this.gfx.camera, this.car, dt)
    // Tyre smoke / dust / skid marks. offroad = how far past the road edge.
    const under = this.track.nearest(this.car.position, this.trackIndexHint)
    const offroad = this.flight || this.loopRide ? 0 : THREE.MathUtils.clamp((under.distance - (this.track.width / 2 - 2.4)) / 1.4, 0, 1)
    this.effects.update(this.car, dt, offroad, under.point.y)
    const lockUp = this.car.braking && Math.abs(this.car.getSpeed()) > 12 ? 0.5 : 0
    this.audio.updateDriving({
      speed: this.flight ? 0.85 : this.car.getNormalizedSpeed(),
      throttle: this.flight ? 1 : this.car.throttle,
      slip: this.flight ? 0 : Math.max(this.car.getSlip(), lockUp),
      offroad,
    })
    // Nitro: stronger motion blur, a kick of shake and a whoosh on ignition
    const boost = this.car.boosting && !this.flight
    if (boost && !this.wasBoosting) { this.audio.playBoost(); this.shake.addTrauma(0.18) }
    this.wasBoosting = boost
    this.ui.setNitro(this.car.nitro, boost)
    const salt = this.track.zoneOfSample(this.trackIndexHint) === 'saltflat' ? 0.3 : 0
    this.post.setSpeed(this.loopRide ? 0.15 : this.flight ? 0.9 : Math.min(1, this.car.getNormalizedSpeed()) + (boost ? 0.45 : 0) + salt)
    this.minimap.update(this.car.position)
  }

  private recordReplay(dt: number): void {
    this.replayAcc += dt
    if (this.replayAcc < 1 / REPLAY_HZ) return
    this.replayAcc -= 1 / REPLAY_HZ
    const o = this.replayHead * 5, m = this.car.mesh
    this.replay.set([m.position.x, m.position.y, m.position.z, m.rotation.y, m.rotation.x], o)
    this.replayHead = (this.replayHead + 1) % REPLAY_N
    this.replayCount = Math.min(REPLAY_N, this.replayCount + 1)
  }

  /**
   * The ending, in three shots: the crossing in slow motion from low at the
   * side of the car, a trackside replay of the run through the bowl, then the
   * trophy rising in front of the parked car.
   */
  private updateFinish(dt: number): void {
    this.trophyT += dt
    const t = this.trophyT, cam = this.gfx.camera
    if (t < FIN_SLOW) {
      const slow = dt * 0.3
      this.car.update(slow, this._emptyInput)
      this.followTrack(slow)
      const f = this.car.getForwardDir(this._pv), p = this.car.position
      const u = t / FIN_SLOW
      cam.position.set(p.x + f.x * (7 - 11 * u) - f.z * 8, p.y + 1, p.z + f.z * (7 - 11 * u) + f.x * 8)
      cam.lookAt(p.x, p.y + 0.9, p.z)
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix() }
      return
    }
    if (t < FIN_TROPHY && this.replayCount > 40) {
      this.updateReplayShot(t - FIN_SLOW)
      return
    }
    this.updateTrophyShot(dt)
  }

  private updateReplayShot(t: number): void {
    const cam = this.gfx.camera
    // last 3 seconds of the run at 60% speed, watched from the barrier by the line
    const frames = Math.min(this.replayCount - 1, REPLAY_HZ * 3)
    const u = Math.min(1, t / (FIN_TROPHY - FIN_SLOW))
    const fi = u * frames, f0 = Math.floor(fi), fr = fi - f0
    const slot = (k: number) => ((this.replayHead - 1 - frames + k + REPLAY_N * 2) % REPLAY_N) * 5
    const a = slot(f0), b = slot(Math.min(frames, f0 + 1)), R = this.replay
    this._flightPos.set(R[a]! + (R[b]! - R[a]!) * fr, R[a + 1]! + (R[b + 1]! - R[a + 1]!) * fr, R[a + 2]! + (R[b + 2]! - R[a + 2]!) * fr)
    this.car.setPose(this._flightPos, R[a + 3]!)
    this.car.mesh.rotation.x = R[a + 4]!
    this.car.spinWheels(0.5)
    this.car.setHeadlights(0) // head-on to this camera they would flare out the whole car
    this.updateBlobShadow(this._flightPos.y - 0.02)
    if (t < 0.05) {
      this.flashColor.set(0xffffff)
      this.flash = 0.6
      const n = this.track.sampleCount, k = n - 26, p = this.track.samples[k]!, tg = this.track.tangents[k]!
      this.replayCam.set(p.x - tg.z * 9.4, p.y + 1.5, p.z + tg.x * 9.4)
      cam.fov = 34
      cam.updateProjectionMatrix()
    }
    cam.position.copy(this.replayCam)
    cam.lookAt(this._flightPos.x, this._flightPos.y + 0.8, this._flightPos.z)
  }

  private updateTrophyShot(dt: number): void {
    const cam = this.gfx.camera
    const t = this.trophy.group
    if (!t.visible) {
      // park on the far side of the line, trophy just ahead of the nose
      const k = 34, p = this.track.samples[k]!, tg = this.track.tangents[k]!
      this.trackIndexHint = k
      this.car.setPose(p, Math.atan2(-tg.x, -tg.z))
      this.car.setSpeed(0)
      this.car.mesh.rotation.x = 0
      this.car.mesh.rotation.z = 0
      this.updateBlobShadow(p.y)
      const f = this._pv.set(-Math.sin(this.car.heading), 0, -Math.cos(this.car.heading))
      this.trophy.show(this.car.position.clone().addScaledVector(f, 13), this.finishMedal)
      this.flashColor.set(0xffffff)
      this.flash = 1
      this.scenery.biomes.stadium.celebrate(14)
      this.audio.sfx('cheer')
      this.replayT = 0
    }
    this.replayT += dt
    if (!this.resultsShown && this.replayT > 1.4) { this.resultsShown = true; this.ui.showResults() }
    this.trophy.update(dt)
    const a = this.car.heading + 0.5 + Math.sin(this.replayT * 0.22) * 0.45
    const h = this.trophy['home'] as THREE.Vector3
    cam.position.set(h.x + Math.sin(a) * 9.5, h.y + 3.1, h.z + Math.cos(a) * 9.5)
    // aim right of the cup so it sits left of the results panel
    this._pv.set(Math.cos(a), 0, -Math.sin(a))
    cam.lookAt(h.x + this._pv.x * 2.4, h.y + 3, h.z + this._pv.z * 2.4)
    if (cam.fov !== 42) { cam.fov = 42; cam.updateProjectionMatrix() }
  }

  /** Any key or click during the finish film jumps to the trophy. */
  skipFinish(): void {
    if (this.phase === 'finished' && this.trophyT < FIN_TROPHY) this.trophyT = FIN_TROPHY
  }

  /** Take over: the car flies the authored arc along the flight samples. */
  private freshStats(): RunStats {
    return { laps: 0, perfectLaunch: false, rings: 0, ringsTotal: 0, hits: 0, melts: 0, saltMph: 0, fastestLapMs: Infinity, medal: null }
  }

  private clearHop(): void {
    this.hopping = false
    this.hopY = 0
    this.car.mesh.rotation.z = 0
  }

  private startFlight(): void {
    this.clearHop()
    const i = this.trackIndexHint, p0 = this.track.samples[i]!, tg0 = this.track.tangents[i]!
    const rl = Math.hypot(tg0.x, tg0.z) || 1
    const off = ((this.car.position.x - p0.x) * -tg0.z + (this.car.position.z - p0.z) * tg0.x) / rl
    this.flight = {
      idx: i,
      speed: THREE.MathUtils.clamp(Math.abs(this.car.getSpeed()), 36, 58),
      off: THREE.MathUtils.clamp(off, -8, 8),
      rings: 0,
    }
    this.shake.addTrauma(0.35)
    const zone = this.track.zoneOfSample(i)
    if (zone === 'flight1' || zone === 'flight2') {
      this.audio.playGoBeep()
      this.audio.sfx('rocketLaunch')
    } else {
      this.audio.sfx('gust')
      this.chaseCam.kick(10)
    }
    this.blobShadow.visible = false
  }

  // ── Space gameplay: low-gravity jump ramps and boost pads ─────────────
  private hopping = false
  private hopY = 0
  private hopV = 0
  private hopG = 4.2
  private hopT = 0
  private hopDur = 1
  private hopPeak = 0
  private hopSpin = 0

  /** Split time at each area, against your best split there. */
  private split(zone: string): void {
    if (this.phase !== 'racing' || zone === 'town') return
    const ms = Math.round(this.raceTime - this.lapStart)
    const key = SPLIT_KEY + zone
    let best = Infinity
    try { best = Number(localStorage.getItem(key)) || Infinity } catch { /* blocked */ }
    const better = ms < best
    if (better) { try { localStorage.setItem(key, String(ms)) } catch { /* blocked */ } }
    const delta = best === Infinity ? '' : `  ${better ? '−' : '+'}${(Math.abs(ms - best) / 1000).toFixed(2)}`
    this.ui.toast(`SPLIT  ${formatTime(ms)}${delta}`, better ? 'best' : 'info')
  }

  /** Area title card when the race moves into a new part of the lap. */
  private updateArea(): void {
    const z = this.track.zoneOfSample(this.trackIndexHint)
    const a = AREAS[z]
    if (!a || z === this.lastArea) return
    if (this.lastArea === '' && z === 'town') { this.lastArea = z; return }
    this.lastArea = z
    this.ui.area(a[0], a[1])
    this.split(z)
    // a short flash in the new area's colour, a whoosh and an FOV kick
    this.flashColor.set(AREA_FLASH[z] ?? 0xffffff)
    this.flash = 1
    this.chaseCam.kick(9)
    this.audio.playBoost()
  }

  private updateSpacePlay(prevIdx: number, dt: number): void {
    const t = this.track
    const n = t.sampleCount
    const curr = this.trackIndexHint
    if (this.hopping) {
      this.hopV -= this.hopG * dt // moon gravity in space, real elsewhere
      this.hopY += this.hopV * dt
      this.hopT += dt
      this.hopPeak = Math.max(this.hopPeak, this.hopY)
      if (this.hopSpin) {
        const u = Math.min(1, this.hopT / (this.hopDur * 0.8))
        this.car.mesh.rotation.z = this.hopSpin * Math.PI * 2 * (u * u * (3 - 2 * u))
      }
      if (this.hopY <= 0) {
        this.hopY = 0
        this.hopping = false
        this.car.mesh.rotation.z = 0
        this.shake.addTrauma(0.35)
        this.car.bump(0.8)
        this.audio.playCollision()
        this.effects.landing(this.car, Math.min(1, 0.45 + this.hopPeak / 12), this.groundColor())
        if (this.hopSpin) {
          // stick the landing: a speed kick and a score
          this.car.setSpeed(Math.max(Math.abs(this.car.getSpeed()), this.car.topSpeed * 1.2))
          this.chaseCam.kick(8)
          this.flashColor.set(0x66e8ff)
          this.flash = 0.5
          this.ui.toast(`BIG AIR  ${this.hopPeak.toFixed(1)} M  ${this.hopT.toFixed(1)} S`, 'best')
        }
      }
    }
    const delta = (curr - prevIdx + n) % n
    if (delta === 0 || delta > 60) return
    for (let step = 1; step <= delta; step++) {
      const k = (prevIdx + step) % n
      if (!this.hopping && this.scenery.kickers.includes(k) && Math.abs(this.car.getSpeed()) > 8) {
        this.hopping = true
        this.hopY = 0.01
        this.hopG = this.scenery.kickerGravity.get(k) ?? 8
        const moon = this.hopG < 9
        const speed = Math.abs(this.car.getSpeed())
        // a moon jump lasts 3.4 s whatever the speed, so it lands before the
        // next ramp, and never flies past the end of the plateau
        let left = 0
        while (left < 400 && t.zoneOfSample((k + left) % n) === 'space') left++
        const air = Math.min(3.4, (left * MS_PER_SAMPLE * 0.9) / Math.max(speed, 1))
        this.hopV = moon ? (this.hopG * air) / 2 : 5 + speed * 0.1
        this.hopT = 0
        this.hopPeak = 0
        // on the moon every launch is a full barrel roll, alternating sides
        this.hopSpin = moon ? (this.hopSpin > 0 ? -1 : 1) : 0
        this.hopDur = 2 * this.hopV / this.hopG
        this.car.nitro = 1
        this.chaseCam.kick(14)
        this.flashColor.set(moon ? 0x66e8ff : 0xffb060)
        this.flash = 0.8
        this.shake.addTrauma(0.3)
        this.audio.playBoost()
      }
      for (const pad of this.scenery.boostPads) {
        if (pad.i !== k || this.hopping) continue
        const p = t.samples[k]!, tg = t.tangents[k]!
        // lateral position (+ = right of travel)
        const rx = -tg.z, rz = tg.x
        const rl = Math.hypot(rx, rz) || 1
        const lat = ((this.car.position.x - p.x) * rx + (this.car.position.z - p.z) * rz) / rl
        if (Math.abs(lat - pad.lat) < pad.half + 1.2) {
          this.car.nitro = 1
          this.car.setSpeed(Math.max(Math.abs(this.car.getSpeed()), this.car.topSpeed * 1.45))
          this.audio.playBoost()
          this.shake.addTrauma(0.28)
          this.chaseCam.kick(13)
          this.flashColor.set(0x38d8ff)
          this.flash = 0.7
        }
      }
    }
  }

  /** Enter the vertical loop: the car is carried round the deck. */
  private startLoop(): void {
    this.clearHop()
    const p = this.track.samples[this.trackIndexHint]!
    if (this.track.zoneOfSample(this.trackIndexHint) === 'roll') {
      let best = 0
      ROLLS.forEach((R, k) => {
        const b = ROLLS[best]!
        if (Math.hypot(R.start[0] - p.x, R.start[2] - p.z) < Math.hypot(b.start[0] - p.x, b.start[2] - p.z)) best = k
      })
      const R = ROLLS[best]!
      this.loopRide = {
        idx: this.trackIndexHint,
        speed: THREE.MathUtils.clamp(Math.abs(this.car.getSpeed()), 34, 75),
        yaw: Math.atan2(-R.dir[0], -R.dir[1]),
        pitch: 0,
        loop: -1,
        roll: best,
      }
      this.blobShadow.visible = false
      return
    }
    let best = 0
    LOOPS.forEach((L, k) => {
      const b = LOOPS[best]!
      if (Math.hypot(L.center[0] - p.x, L.center[2] - p.z) < Math.hypot(b.center[0] - p.x, b.center[2] - p.z)) best = k
    })
    const L = LOOPS[best]!
    this.loopRide = {
      idx: this.trackIndexHint,
      // needs real speed to stay on the deck at the top
      speed: THREE.MathUtils.clamp(Math.abs(this.car.getSpeed()), 30, 70),
      yaw: Math.atan2(-L.dir[0], -L.dir[1]),
      pitch: 0,
      loop: best,
      roll: -1,
    }
    this.blobShadow.visible = false
  }

  private updateLoop(dt: number): void {
    const r = this.loopRide!
    const t = this.track
    const n = t.sampleCount
    // Advance by real distance along the samples
    let dist = r.speed * dt
    let i0 = Math.floor(r.idx) % n
    let frac = r.idx - Math.floor(r.idx)
    while (dist > 0) {
      const seg = t.samples[i0]!.distanceTo(t.samples[(i0 + 1) % n]!) || 0.01
      const left = seg * (1 - frac)
      if (dist < left) { frac += dist / seg; dist = 0 } else { dist -= left; frac = 0; i0 = (i0 + 1) % n }
    }
    r.idx = i0 + frac
    const i1 = (i0 + 1) % n
    this._flightPos.lerpVectors(t.samples[i0]!, t.samples[i1]!, frac)
    if (r.roll >= 0) {
      // Barrel roll: hold the heading, spin about the travel axis
      const R = ROLLS[r.roll]!
      const s = ((this._flightPos.x - R.start[0]) * R.dir[0] + (this._flightPos.z - R.start[2]) * R.dir[1]) / R.length
      this.car.setPose(this._flightPos, r.yaw)
      this.car.mesh.rotation.x = 0
      this.car.mesh.rotation.z = -rollPhase(s)
      this.car.spinWheels(r.speed * dt)
      this.trackIndexHint = i0
      if (!t.isLoop(i0)) {
        const tt = t.tangents[i0]!
        this.car.setPose(t.samples[i0]!, Math.atan2(-tt.x, -tt.z))
        this.car.mesh.rotation.z = 0
        this.car.setSpeed(r.speed)
        this.loopRide = null
        this.shake.addTrauma(0.2)
        this.car.bump(0.5)
        this.updateBlobShadow(t.samples[i0]!.y)
      }
      return
    }
    // Pitch = angle round the loop, unwrapped so it runs smoothly 0 → 2π
    const L = LOOPS[r.loop]!
    const tg = t.tangents[i0]!
    const fwd = tg.x * L.dir[0] + tg.z * L.dir[1]
    let a = Math.atan2(tg.y, fwd)
    while (a - r.pitch > Math.PI) a -= Math.PI * 2
    while (a - r.pitch < -Math.PI) a += Math.PI * 2
    r.pitch = a
    // Gravity: slows on the way up, speeds up coming down
    r.speed = Math.max(24, r.speed - 9.81 * tg.y * dt)
    this.car.setPose(this._flightPos, r.yaw)
    this.car.mesh.rotation.x = r.pitch
    this.car.spinWheels(r.speed * dt)
    this.trackIndexHint = i0

    if (!t.isLoop(i0)) {
      // Out the bottom: hand back to normal driving
      const tt = t.tangents[i0]!
      this.car.setPose(t.samples[i0]!, Math.atan2(-tt.x, -tt.z))
      this.car.mesh.rotation.x = 0
      this.car.setSpeed(r.speed)
      this.loopRide = null
      this.shake.addTrauma(0.25)
      this.car.bump(0.6)
      this.updateBlobShadow(t.samples[i0]!.y)
    }
  }

  /** In the loop: a trackside camera that watches the car go round. */
  private updateLoopCamera(dt: number): void {
    const L = LOOPS[this.loopRide!.loop]!
    const cam = this.gfx.camera
    // Dry loop: from the open side, well back. Under the sea (thick
    // water haze, the spiral on the other side): closer, beyond the exit
    const under = L.center[1] < 0
    const side = under ? L.shift + 34 : -58
    const target = this._loopCam.set(
      L.center[0] + L.lateral[0] * side - L.dir[0] * (under ? 10 : 22),
      L.center[1] - L.radius + (under ? 9 : 7),
      L.center[2] + L.lateral[1] * side - L.dir[1] * (under ? 10 : 22),
    )
    cam.position.lerp(target, 1 - Math.pow(0.002, dt))
    cam.lookAt(this.car.position)
  }
  private readonly _loopCam = new THREE.Vector3()

  private updateFlight(dt: number): void {
    const f = this.flight!
    const n = this.track.sampleCount
    const spacing = this.track.length / n

    f.idx += (f.speed * dt) / spacing
    const i0 = Math.floor(f.idx) % n
    const i1 = (i0 + 1) % n
    const frac = f.idx - Math.floor(f.idx)

    this._flightPos.lerpVectors(this.track.samples[i0]!, this.track.samples[i1]!, frac)
    const tangent = this.track.tangents[i0]!
    const heading = Math.atan2(-tangent.x, -tangent.z)

    // steer in the air, through the rings
    const input = this.input.get()
    f.off += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 13 * dt
    f.off = THREE.MathUtils.clamp(f.off, -8, 8)
    const rl = Math.hypot(tangent.x, tangent.z) || 1
    this._flightPos.x += (-tangent.z / rl) * f.off
    this._flightPos.z += (tangent.x / rl) * f.off
    const got = this.flourish.collectRings(this.trackIndexHint, i0, f.off)
    if (got) {
      f.rings += got
      this.lapRings += got
      this.stats.rings = Math.max(this.stats.rings, this.lapRings)
      f.speed = Math.min(72, f.speed + 3.5 * got)
      this.car.nitro = Math.min(1, this.car.nitro + 0.3 * got)
      this.audio.sfx('ring', 1, f.rings * 2)
      this.chaseCam.kick(6)
      this.ui.toast(`RING  +NITRO`, 'best')
    }

    this.car.setPose(this._flightPos, heading)
    this.car.setSlopePitch(Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1)), 0.25)
    this.car.spinWheels(f.speed * dt)
    this.trackIndexHint = i0

    // Landed? The sample under us is no longer a flight-gap sample.
    if (!FLIGHT_ZONES.has(this.track.zoneOfSample(i0))) {
      const landIdx = i0
      const t = this.track.tangents[landIdx]!
      const p = this.track.samples[landIdx]!
      const tl = Math.hypot(t.x, t.z) || 1
      this.car.setPose(this._flightPos.set(p.x - (t.z / tl) * f.off, p.y, p.z + (t.x / tl) * f.off), Math.atan2(-t.x, -t.z))
      this.car.setSpeed(f.speed)
      this.effects.landing(this.car, 1, this.groundColor())
      this.trackIndexHint = landIdx
      this.flight = null
      this.shake.addTrauma(0.4)
      this.chaseCam.kick(7)
      this.car.bump(1)
      this.audio.playCollision()
      this.updateBlobShadow(p.y)
    }
  }

  private handleTrackBoundary(): void {
    const nearest = this.track.nearest(this.car.position, this.trackIndexHint)
    const maxDist = this.track.width / 2 - 0.9

    if (nearest.distance > maxDist) {
      this._lateral.copy(this.car.position).sub(nearest.point)
      this._lateral.y = 0
      this._lateral.normalize()
      this.car.position.copy(nearest.point).addScaledVector(this._lateral, maxDist)

      // Realign the heading toward the road direction while scraping the
      // wall. Without this the position is clamped but the heading keeps
      // rotating, so the car ends up sideways, grinding along at 90°.
      const t = this.track.tangents[nearest.index]!
      const roadHeading = Math.atan2(-t.x, -t.z)
      let diff = roadHeading - this.car.heading
      while (diff > Math.PI) diff -= 2 * Math.PI
      while (diff < -Math.PI) diff += 2 * Math.PI
      if (Math.abs(diff) < Math.PI / 2) {
        // glance off: steer the car back along the wall quickly
        this.car.heading += diff * 0.16
      } else {
        // Nearly backwards into the wall: bleed speed hard + straighten fast
        this.car.heading += diff * 0.15
        this.car.scrubSpeed(0.95)
      }

      // grinding the barrier throws sparks from that side of the car
      const sp = Math.abs(this.car.getSpeed())
      if (sp > 6) {
        this._pv.copy(this.car.position).addScaledVector(this._lateral, 1).setY(this.car.position.y + 0.5)
        this.effects.sparks(this._pv, this.car.getForwardDir(this._flightPos).multiplyScalar(-sp * 0.35), this.wasOffTrack ? 2 : 22)
      }
      if (!this.wasOffTrack) {
        // a scrape costs some speed, not the whole run
        this.car.scrubSpeed(0.87)
        this.shake.addTrauma(0.22)
        this.car.bump(0.45)
        this.audio.playCollision()
        this.wasOffTrack = true
      } else {
        this.car.scrubSpeed(0.993)
      }
    } else {
      this.wasOffTrack = false
    }
  }

  private handleProgress(prev: number): void {
    const n = this.track.sampleCount
    const curr = this.trackIndexHint

    // Forward travel distance in samples (wrap-aware); ignore reverse
    const delta = (curr - prev + n) % n
    if (delta === 0 || delta > n / 2) return

    // Check every sample index passed this frame
    for (let step = 1; step <= delta; step++) {
      const idx = (prev + step) % n
      for (let c = 0; c < CHECKPOINT_COUNT; c++) {
        const cpIdx = Math.floor(((c + 1) * n) / (CHECKPOINT_COUNT + 1))
        if (idx === cpIdx && !this.checkpointsHit[c]) {
          this.checkpointsHit[c] = true
          this.audio.playCheckpoint()
          this.scenery.flashBurst(this.track.samples[cpIdx]!)
        }
      }
      if (idx === 0 && this.checkpointsHit.every(Boolean)) {
        const lapMs = Math.round(this.raceTime - this.lapStart)
        this.lapTimes.push(lapMs)
        this.ghost.finishLap(lapMs)
        this.ghost.startLap(this.car.mesh)
        if (this.lapTimes.length >= this.lapCount) {
          this.finishRace()
          return
        }
        // Next lap: re-arm the checkpoints, announce the split
        this.lapStart = this.raceTime
        this.checkpointsHit.fill(false)
        this.lapRings = 0
        this.flourish.rearm()
        this.scenery.biomes.stadium.rearm()
        const bestSoFar = Math.min(...this.lapTimes.slice(0, -1), readMs(BEST_LAP_KEY))
        this.ui.onLap(this.lapTimes.length, lapMs, lapMs < bestSoFar)
        this.ui.setLap(this.lapTimes.length + 1, this.lapCount)
        this.audio.playCheckpoint()
      }
    }
  }

  private finishRace(): void {
    this.phase = 'finished'
    const timeMs = Math.round(this.raceTime)

    const totalKey = bestTotalKey(this.lapCount)
    const prevBest = readMs(totalKey)
    const isNewBest = timeMs < prevBest
    if (isNewBest) writeMs(totalKey, timeMs)
    const fastest = Math.min(...this.lapTimes)
    const prevBestLap = readMs(BEST_LAP_KEY)
    const isNewBestLap = fastest < prevBestLap
    if (isNewBestLap) writeMs(BEST_LAP_KEY, fastest)

    this.audio.playFinish()
    this.shake.addTrauma(0.45)
    // Paparazzi finale: several staggered flash volleys around the finish line.
    const finishPos = this.car.position.clone()
    this.scenery.flashBurst(finishPos)
    for (let k = 1; k <= 4; k++) {
      setTimeout(() => this.scenery.flashBurst(finishPos), k * 260)
    }
    this.ghost.mesh.visible = false
    const medal = MEDALS.find(([, ms]) => fastest <= ms)?.[0] ?? null
    this.finishMedal = medal
    this.trophyT = 0
    const stadium = this.scenery.biomes.stadium
    stadium.setScreen(formatTime(timeMs), medal ? `${medal} MEDAL` : isNewBest ? 'NEW BEST' : 'FINISHED', medal === 'GOLD' ? '#ffcf4a' : '#25d9ff')
    stadium.celebrate(7)
    this.audio.sfx('cheer')
    const st = this.stats
    st.laps = this.lapCount
    st.fastestLapMs = fastest
    st.medal = medal
    st.ringsTotal = this.flourish.ringCount
    const fresh = scoreRun(st)
    const { board, place } = addToBoard(this.lapCount, { ms: timeMs, medal, paint: savedPaint().id, date: new Date().toISOString().slice(0, 10) })
    this.ui.onFinish({
      newChallenges: fresh.map((c) => c.label),
      challengesDone: doneChallenges().size,
      challengesTotal: CHALLENGES.length,
      board,
      boardPlace: place,
      medal,
      totalMs: timeMs,
      bestTotalMs: isNewBest ? timeMs : prevBest,
      isNewBest,
      laps: [...this.lapTimes],
      bestLapMs: Math.min(fastest, prevBestLap),
      isNewBestLap,
    })
  }

  // ── Photo mode ───────────────────────────────────────────────────────

  /** Freeze the world and hand the camera to the player. */
  setPhotoMode(on: boolean): void {
    if (on === this.photoMode) return
    const cam = this.gfx.camera
    if (on) {
      this.photoMode = true
      this.photoSavedPos.copy(cam.position)
      this.photoSavedQuat.copy(cam.quaternion)
      this.photoSavedFov = cam.fov
      const dir = cam.getWorldDirection(this._pv)
      this.photoYaw = Math.atan2(-dir.x, -dir.z)
      this.photoPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
      this.post.setSpeed(0) // no motion blur on photos
      this.audio.setPaused(true)
    } else {
      this.photoMode = false
      cam.position.copy(this.photoSavedPos)
      cam.quaternion.copy(this.photoSavedQuat)
      cam.fov = this.photoSavedFov
      cam.updateProjectionMatrix()
      this.audio.setPaused(false)
    }
    this.ui.onPhotoMode(on)
  }

  /** Mouse-drag look (pixels). */
  photoLook(dx: number, dy: number): void {
    if (!this.photoMode) return
    this.photoYaw -= dx * 0.004
    this.photoPitch = THREE.MathUtils.clamp(this.photoPitch - dy * 0.004, -1.45, 1.45)
  }

  /** Mouse-wheel zoom: narrower FOV = telephoto. */
  photoZoom(delta: number): void {
    if (!this.photoMode) return
    const cam = this.gfx.camera
    cam.fov = THREE.MathUtils.clamp(cam.fov + delta * 0.03, 15, 95)
    cam.updateProjectionMatrix()
  }

  /** WASD move, Q/E down/up, arrows look, Shift = faster. Stays near the car. */
  private updatePhotoCamera(dt: number): void {
    const k = (c: string) => this.input.isDown(c)
    const turn = 1.4 * dt
    if (k('ArrowLeft')) this.photoYaw += turn
    if (k('ArrowRight')) this.photoYaw -= turn
    if (k('ArrowUp')) this.photoPitch = Math.min(1.45, this.photoPitch + turn)
    if (k('ArrowDown')) this.photoPitch = Math.max(-1.45, this.photoPitch - turn)
    const cam = this.gfx.camera
    const fwd = this._pv.set(-Math.sin(this.photoYaw) * Math.cos(this.photoPitch), Math.sin(this.photoPitch), -Math.cos(this.photoYaw) * Math.cos(this.photoPitch))
    const right = new THREE.Vector3(Math.cos(this.photoYaw), 0, -Math.sin(this.photoYaw))
    const speed = (k('ShiftLeft') || k('ShiftRight') ? 24 : 8) * dt
    if (k('KeyW')) cam.position.addScaledVector(fwd, speed)
    if (k('KeyS')) cam.position.addScaledVector(fwd, -speed)
    if (k('KeyD')) cam.position.addScaledVector(right, speed)
    if (k('KeyA')) cam.position.addScaledVector(right, -speed)
    if (k('KeyE')) cam.position.y += speed
    if (k('KeyQ')) cam.position.y -= speed
    // Keep the camera within 80 m of the car and above the road
    const off = cam.position.clone().sub(this.car.position)
    if (off.length() > 80) cam.position.copy(this.car.position).addScaledVector(off.normalize(), 80)
    cam.position.y = Math.max(cam.position.y, this.car.position.y + 0.3)
    cam.lookAt(cam.position.clone().add(fwd))
  }

  /** Render the current view and return it as a PNG. */
  capturePhoto(): Promise<Blob | null> {
    this.render(0)
    return new Promise((resolve) => this.gfx.renderer.domElement.toBlob(resolve, 'image/png'))
  }

  // ── Render ───────────────────────────────────────────────────────────
  private render = (dt: number): void => {
    this.updateCarReflection()
    this.post.render(dt)
  }

  getInput(): InputManager {
    return this.input
  }
}
