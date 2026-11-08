import * as THREE from 'three'
import { GameLoop } from '../engine/GameLoop'
import { GameRenderer } from '../engine/Renderer'
import { PostProcessing } from '../engine/PostProcessing'
import { InputManager, type InputState } from '../engine/Input'
import { Car } from '../game/Car'
import { ChaseCamera } from '../game/ChaseCamera'
import { CinematicCamera } from '../game/CinematicCamera'
import { SpeedEffects } from '../game/SpeedEffects'
import { CarFx } from '../game/CarFx'
import { ScreenShake } from '../game/ScreenShake'
import { GameAudio } from '../game/Audio'
import { SkySystem } from '../game/Sky'
import { setupLighting, followShadow, setShadowMapSize, DAY_RIG, type LightRig } from '../game/Lighting'
import { setMaxAnisotropy } from '../game/Textures'
import { AssetLoader } from '../game/AssetLoader'
import { Minimap } from '../ui/Minimap'
import { CARS, savedCar, type CarInfo } from '../game/Catalog'
import { savedPaint } from '../game/Progress'
import type { Settings } from '../ui/Settings'
import { Circuit } from './Circuit'
import { World } from './World'
import { Dresser } from './dress'
import { buildBase } from './Build'
import { Racer, RESCUE_TIME, type RacerEvents } from './Racer'
import { DRIVERS, Rival, type Difficulty } from './Rival'
import { RACES } from './tracks'
import { canvasTexture, softDot } from '../game/biomes/kit'
import { atmos, installAtmosphere, windClock } from './art/atmos'
import { Music } from './Music'
import { Items, type ItemKind } from './Items'
import type { FrameInfo, TrackDef } from './types'

const BASE = import.meta.env.BASE_URL
const COLOR_GRADE = [1.08, 1.08, 0, 0, 0, 1, 1, 1, 0.28] as const
/** How far behind the line the wall stands on lap 1 (samples). */
const START_WALL = 36

export interface RaceResultRow { name: string; isPlayer: boolean; timeMs: number; finished: boolean; bestLapMs: number }

export interface KartUI {
  setTime(text: string): void
  setMph(mph: number): void
  setLap(current: number, total: number): void
  setPlace(place: number, of: number): void
  setNitro(level: number, active: boolean): void
  /** The item slot: what's held (null for empty), whether it's still rolling, and how many. */
  setItem(kind: ItemKind | null, rolling: boolean, count: number): void
  warn(text: string | null): void
  countdown(label: string | null): void
  toast(text: string, best?: boolean): void
  raceStarted(): void
  raceEnded(rows: RaceResultRow[]): void
  loading(on: boolean, text?: string): void
}

type Phase = 'idle' | 'preview' | 'intro' | 'countdown' | 'racing' | 'finished'

/** One track at a time: everything for a race lives under `root` and is freed afterwards. */
export class KartApp {
  readonly gfx: GameRenderer
  readonly post: PostProcessing
  readonly input = new InputManager()
  readonly audio = new GameAudio()
  readonly assets = new AssetLoader()
  private readonly sky: SkySystem
  private readonly lights: LightRig
  private readonly loop: GameLoop
  private readonly chase = new ChaseCamera()
  private readonly cine = new CinematicCamera()
  private readonly shake = new ScreenShake()
  private readonly effects: SpeedEffects
  private readonly fx = new CarFx()
  readonly car = new Car()
  phase: Phase = 'idle'

  def: TrackDef | null = null
  circuit: Circuit | null = null
  world: World | null = null
  private root = new THREE.Group()
  private frames: ((f: FrameInfo) => void)[] = []
  readonly music = new Music()
  /** Tests skip the fly-in. */
  noIntro = false
  private introT = 0
  private minimap: Minimap | null = null
  private loadTicket = 0
  /** How long the last track took to load. */
  loadMs = 0

  player: Racer | null = null
  readonly racers: Racer[] = []
  rivals: Rival[] = []
  private readonly rivalCars: Car[] = []
  private drones = new Map<Racer, THREE.Group>()
  private wingsOf = new Map<Racer, THREE.Group>()
  items: Items | null = null
  private itemWas = false
  private itemShown = ''
  private readonly shadowMat = new THREE.MeshBasicMaterial({ map: softDot(), color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false })
  private readonly shadows: THREE.Mesh[] = []
  private autoPlayer: Rival | null = null
  private rand = Math.random

  laps = 3
  raceMs = 0
  private countdownT = 0
  private countdownStep = 0
  private revAt = -1
  private finishT = 0
  private startWall: THREE.Mesh | null = null
  private wrongT = 0
  private previewT = 0
  private previewPos = 0
  private bestLap = 0
  private leaderLap = 1
  private place = 1
  private accent = new THREE.Color(0xffffff)
  private readonly _v = new THREE.Vector3()
  private readonly _fwd = new THREE.Vector3()
  private flash = 0
  private readonly flashColor = new THREE.Color(1, 1, 1)
  /** Test hook: replaces the keyboard. */
  driver: (() => InputState) | null = null

  constructor(canvas: HTMLCanvasElement, private readonly mapCanvas: HTMLCanvasElement, private readonly ui: KartUI) {
    installAtmosphere()
    this.gfx = new GameRenderer(canvas)
    this.gfx.camera.far = 7000
    this.gfx.camera.updateProjectionMatrix()
    const hq = new URLSearchParams(location.search).has('hq')
    this.integrated = this.gfx.isIntegratedGpu()
    this.post = new PostProcessing(this.gfx.renderer, this.gfx.scene, this.gfx.camera, { ao: false, smaa: hq, bloom: true, msaa: this.integrated ? 2 : 4 })
    this.fitted = new URLSearchParams(location.search).has('nofit') ? 0 : 1
    setMaxAnisotropy(Math.min(8, this.gfx.renderer.capabilities.getMaxAnisotropy()))
    this.sky = new SkySystem(this.gfx.renderer, this.gfx.scene)
    this.lights = setupLighting(this.gfx.scene, this.sky.sunDir, hq)
    this.effects = new SpeedEffects(this.gfx.scene)
    this.car.canReverse = true
    this.car.earnNitro = true
    this.gfx.scene.add(this.car.mesh, this.fx.group, this.root)
    window.addEventListener('resize', this.onResize)
    this.loop = new GameLoop(this.update, this.render)
    this.loop.start()
    ;(window as unknown as Record<string, unknown>)['__kart'] = this
  }

  private onResize = (): void => {
    this.gfx.resize(window.innerWidth, window.innerHeight)
    this.post.resize(window.innerWidth, window.innerHeight)
  }

  applySettings(s: Settings): void {
    const low = s.quality === 'low', high = s.quality === 'high'
    const dpr = window.devicePixelRatio || 1
    this.maxRatio = low ? Math.min(dpr, 1) * 0.8 : Math.min(dpr, high ? 2 : this.integrated ? 1 : 1.4)
    this.minRatio = low ? 0.6 : 0.7
    this.gfx.renderer.setPixelRatio(this.maxRatio)
    setShadowMapSize(this.lights, low ? 1024 : high ? 4096 : 2048)
    this.post.setOptions({ ao: false, smaa: high, bloom: !low })
    this.onResize()
    this.post.setMotionBlur(s.motionBlur)
    this.audio.setVolume(s.volume)
    this.music.setVolume(s.volume)
    this.chase.setDistanceScale(s.camera === 'near' ? 0.8 : s.camera === 'far' ? 1.25 : 1)
  }

  /** Holds the frame rate by trading resolution, a step at a time. */
  private fitResolution(dt: number): void {
    if (!this.fitted || this.phase === 'idle') return
    this.fitT += dt
    this.fitN++
    if (this.fitT < 1.6) return
    const ms = (this.fitT / this.fitN) * 1000
    this.fitT = 0
    this.fitN = 0
    const r = this.gfx.renderer, now = r.getPixelRatio()
    const next = ms > 27 ? now - 0.1 : ms < 17 ? now + 0.1 : now
    const fit = THREE.MathUtils.clamp(next, this.minRatio, this.maxRatio)
    if (Math.abs(fit - now) < 0.01) return
    r.setPixelRatio(fit)
    this.onResize()
  }
  private fitted = 1
  private readonly integrated: boolean
  /** Between pressing Race and the rivals being ready. */
  private starting = false
  private fitT = 0
  private fitN = 0
  private maxRatio = 1.4
  private minRatio = 0.7

  setPaused(on: boolean): void {
    if (on) this.loop.stop()
    else this.loop.start()
    this.audio.setPaused(on)
    this.music.setPaused(on)
  }

  // ── Cars ──
  private async model(info: CarInfo): Promise<THREE.Group | null> {
    if (!this.assets.get(info.model)) {
      await this.assets.loadAll({ [info.model]: `${BASE}models/${info.file ?? (info.model === 'carHQ' ? 'car_hq.glb' : 'car_wedge.glb')}` }, () => undefined, () => false)
    }
    return this.assets.get(info.model)
  }

  private ticket = 0
  async setCar(info: CarInfo): Promise<void> {
    const t = ++this.ticket
    const m = await this.model(info)
    if (t !== this.ticket || !m) return
    const yaw = this.car.heading, x = this.car.mesh.rotation.x
    this.car.setStats(info.stats)
    this.car.applyModel(m, 4.5, 0, !!info.hq)
    this.car.mesh.rotation.set(x, yaw, 0)
    this.car.setPaint(savedPaint().hex)
  }

  setPaint(hex: number): void { this.car.setPaint(hex) }

  // ── Track loading ──
  private clearTrack(): void {
    this.gfx.scene.remove(this.root)
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || m.userData['shared']) return
      m.geometry.dispose()
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose()
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
    })
    this.root = new THREE.Group()
    this.gfx.scene.add(this.root)
    this.frames = []
    for (const c of this.rivalCars) this.gfx.scene.remove(c.mesh)
    this.rivalCars.length = 0
    this.racers.length = 0
    this.rivals = []
    for (const d of this.drones.values()) this.gfx.scene.remove(d)
    this.drones.clear()
    this.wingsOf.clear()
    this.items = null
    this.effects.clear()
  }

  /** Build one track and put the player's car on the grid. */
  /** @param quiet behind the menu: no full-screen loading card */
  loadTrack(id: string, quiet = false): Promise<void> {
    this.pending = this.load(id, quiet)
    return this.pending
  }

  /** Resolves when the latest track has finished loading. */
  async settled(): Promise<void> {
    let p: Promise<void> | null = null
    while (p !== this.pending) { p = this.pending; await p }
  }
  private pending: Promise<void> = Promise.resolve()

  private async load(id: string, quiet: boolean): Promise<void> {
    const ticket = ++this.loadTicket
    const t0 = performance.now()
    if (!quiet) this.ui.loading(true, RACES[id]!.name)
    this.phase = 'idle'
    this.audio.stopEngine()
    await new Promise((r) => setTimeout(r, 30)) // let the loading card paint
    if (ticket !== this.loadTicket) return // another track was picked meanwhile
    this.clearTrack()
    const def = RACES[id]!
    const circuit = Circuit.withBranches(def), world = new World(def, circuit)
    this.def = def
    this.circuit = circuit
    this.world = world
    this.leaderLap = 1
    this.accent.set(def.accent)
    const base = buildBase(def, circuit, world, this.root)
    this.items = new Items(this.root, circuit, world, this.rand)
    this.items.onEvent = this.itemEvent
    const d = new Dresser(this.root, circuit, world, this.assets, id.length * 97 + 11)
    await def.build({ track: def, world, circuit, root: this.root, d, road: base.road, water: base.water, onFrame: (fn) => { if (ticket === this.loadTicket) this.frames.push(fn) } })
    this.frames.push((f) => d.tick(f.camera.position))
    const pads = this.root.getObjectByName('pads') as THREE.Mesh | undefined
    if (pads) {
      const tex = (pads.material as THREE.MeshBasicMaterial).map!
      this.frames.push((f) => { tex.offset.y = -(f.time * 2.4) % 1 })
    }
    await d.ready()
    await this.loadSky(def)
    if (ticket !== this.loadTicket) return
    this.applyLook(def)
    this.minimap = new Minimap(this.mapCanvas, { samples: circuit.samples, tangents: circuit.tangents, spawnPosition: circuit.samples[0]! } as never)
    this.minimap.drawStatic()
    this.toGrid()
    await this.warm()
    if (ticket !== this.loadTicket) return
    this.loadMs = performance.now() - t0
    this.ui.loading(false)
  }

  /** Build every shader now so the race doesn't stutter on first sight. */
  private async warm(): Promise<void> {
    await this.gfx.renderer.compileAsync(this.gfx.scene, this.gfx.camera)
  }

  private readonly skies = new Set<string>()
  /** The photographed sky for this time of day, fetched the first time it's needed. */
  private async loadSky(def: TrackDef): Promise<void> {
    const tod = def.look.tod
    if (tod === 'night' || def.look.generatedSky || this.skies.has(tod)) return
    this.skies.add(tod)
    await this.sky.loadHdris({ [tod]: `${BASE}hdri/${tod}.hdr` })
  }

  private applyLook(def: TrackDef): void {
    const l = def.look, sky = this.sky, r = this.gfx.renderer
    sky.usePhotos = !l.generatedSky
    sky.setVisible(!l.noSky)
    sky.setConditions(l.tod, !!l.rain)
    const mix = l.mix ?? 0
    const col = (a?: [number, number, number]) => new THREE.Color(...(a ?? [0.5, 0.6, 0.8]))
    sky.setMood(mix, col(l.top), col(l.horizon), l.stars ?? 0, 0)
    const fog = this.gfx.scene.fog as THREE.FogExp2
    fog.color.setRGB(...l.fog)
    fog.density = l.fogDensity
    atmos.params.x = l.fogDensity
    atmos.params.y = l.fogBase ?? 0
    atmos.params.z = l.fogFall ?? 0.006
    atmos.params.w = l.sunGlow ?? 0.7
    atmos.caustic.x = l.caustics ?? 0
    atmos.sun.x = sky.sunDir.x; atmos.sun.y = sky.sunDir.y; atmos.sun.z = sky.sunDir.z
    atmos.tint.x = sky.sunColor.r * 1.05 + 0.1; atmos.tint.y = sky.sunColor.g * 0.95 + 0.08; atmos.tint.z = sky.sunColor.b * 0.8 + 0.06
    const L = this.lights
    L.sun.color.copy(sky.sunColor)
    L.sun.intensity = DAY_RIG.sunIntensity * sky.sunStrength * (l.sun ?? 1)
    L.hemi.intensity = DAY_RIG.hemiIntensity * sky.ambientScale * (l.hemi ?? 1)
    r.toneMappingExposure = l.exposure ?? 1
    this.gfx.scene.environmentIntensity = sky.envIntensity * (l.env ?? 1)
    this.post.setBloom(l.bloom ?? 0.3, 1)
    this.post.setGrade(new Float32Array(l.grade ?? COLOR_GRADE))
    this.car.setHeadlights(l.headlights ?? 0)
    this.effects.smokeColor.setRGB(l.fog[0], l.fog[1], l.fog[2]).lerp(new THREE.Color(1, 1, 1), 0.5)
  }

  private toGrid(): void {
    const c = this.circuit!, w = this.world!
    if (!this.player) this.player = new Racer(this.car, 'You', true, w, c)
    else {
      // a new track: same car, new world
      this.player = new Racer(this.car, 'You', true, w, c)
    }
    this.player.events = this.events
    const spot = c.gridSpot(5)
    this.player.place(spot.pos, spot.yaw, spot.i)
    this.car.mesh.visible = true
    this.gfx.camera.position.copy(spot.pos).add(new THREE.Vector3(8, 3, 8))
  }

  /** The chosen car waits on the grid, with the slow menu camera. */
  showGrid(): void {
    this.phase = 'idle'
    this.toGrid()
  }

  /** Drive a lap behind the menu. */
  startPreview(): void {
    // a preview that finishes loading after Race was pressed must not take
    // the car away from the grid
    if (this.starting || this.phase === 'intro' || this.phase === 'countdown' || this.phase === 'racing' || this.phase === 'finished') return
    this.phase = 'preview'
    this.previewPos = 0
    this.previewT = 0
  }

  // ── Race ──
  private readonly events: RacerEvents = {
    crash: (r, strength, at) => {
      if (!r.isPlayer) return
      this.shake.addTrauma(0.2 + strength * 0.45)
      this.car.bump(0.4 + strength)
      this.audio.playCollision()
      this.effects.sparks(this._v.copy(at).setY(at.y + 0.6), this.car.getForwardDir(this._fwd).multiplyScalar(-10), 26)
      if (strength > 0.72) this.effects.crash(this.car, 1)
    },
    landed: (r, hard) => {
      r.car.nitro = Math.min(1, r.car.nitro + 0.12 + hard * 0.1)
      if (!r.isPlayer) return
      this.shake.addTrauma(0.15 + hard * 0.3)
      this.car.bump(0.3 + hard)
      this.effects.landing(this.car, hard, this.dust())
      if (hard > 0.15) this.audio.playCollision()
    },
    trick: (r, clean) => {
      if (!r.isPlayer) return
      if (clean) {
        this.audio.playBoost()
        this.chase.kick(8)
        this.ui.toast('TRICK BOOST')
      } else this.ui.toast('SLOPPY LANDING')
    },
    hit: (r, blocked) => {
      if (!r.isPlayer) return
      if (blocked) { this.audio.sfx('ring', 0.7); this.ui.toast('SHIELD HELD'); return }
      this.audio.sfx('boom', 0.6)
      this.shake.addTrauma(0.55)
      this.flashColor.setRGB(1, 0.45, 0.25)
      this.flash = 0.5
      this.ui.toast('HIT!')
    },
    rescued: (r) => {
      if (r.isPlayer) {
        this.ui.toast('RECOVERY DRONE')
        this.audio.sfx('splash', 0.5)
      }
      this.drone(r).visible = true
    },
    smashed: (r) => {
      if (r.isPlayer) { this.audio.sfx('rockImpact', 0.5); this.shake.addTrauma(0.1) }
    },
    boosted: (r) => {
      if (!r.isPlayer) return
      this.audio.playBoost()
      this.chase.kick(10)
      this.shake.addTrauma(0.14)
      this.flashColor.setRGB(0.5, 0.9, 1)
      this.flash = 0.34
    },
  }

  private readonly itemEvent = (ev: string, r: Racer, kind: ItemKind | null, at?: THREE.Vector3): void => {
    const near = at ? at.distanceTo(this.car.position) < 120 : r.isPlayer
    if (ev === 'pickup' && r.isPlayer) this.audio.sfx('shatter', 0.35, 0.4)
    if (ev === 'got' && r.isPlayer) this.audio.playCheckpoint()
    if (ev === 'use' && r.isPlayer) {
      if (kind === 'turbo' || kind === 'triple') { this.audio.playBoost(); this.chase.kick(14); this.shake.addTrauma(0.2) }
      else if (kind === 'shield') this.audio.sfx('ring', 0.6)
      else this.audio.sfx('rocketLaunch', 0.35)
    }
    if (ev === 'boom' && near && at) {
      if (!r.isPlayer) this.audio.sfx('boom', 0.35)
      this.effects.sparks(at, this._v.set(0, 6, 0), 30)
    }
  }

  /** Wings that fold out of the roof over a glide drop. */
  private wings(r: Racer): THREE.Group {
    let g = this.wingsOf.get(r)
    if (g) return g
    g = new THREE.Group()
    const shape = new THREE.Shape()
    shape.moveTo(0, 1.6); shape.lineTo(4.6, -1.2); shape.lineTo(3.8, -1.6); shape.lineTo(0, -0.9); shape.lineTo(-3.8, -1.6); shape.lineTo(-4.6, -1.2); shape.closePath()
    // a striped fabric sail, tipped up at the front so it reads from behind
    const geo = new THREE.ShapeGeometry(shape)
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv')
    for (let q = 0; q < pos.count; q++) uv.setXY(q, pos.getX(q) / 9.2 + 0.5, pos.getY(q) / 3.2 + 0.5)
    const tint = r.isPlayer ? '#' + this.accent.getHexString() : ['#e8463c', '#f2b21c', '#3a8ae8', '#18b67a', '#c23ae0'][this.racers.indexOf(r) % 5]!
    const tex = canvasTexture(256, 128, (c, W, H) => {
      c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, W, H)
      c.fillStyle = tint
      for (let x = -H; x < W + H; x += 64) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + 32, H); c.lineTo(x + 32 + H * 0.6, 0); c.lineTo(x + H * 0.6, 0); c.fill() }
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, H - 8, W, 8)
    })
    const sail = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide, emissive: new THREE.Color(0x222222), emissiveMap: tex }))
    sail.rotation.x = -Math.PI / 2 + 0.32
    g.add(sail)
    const frame = new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.7, roughness: 0.35 })
    for (const s of [-1, 1]) {
      const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6, 6), frame)
      spar.position.set(s * 2.3, 0.02, 0.15)
      spar.rotation.set(Math.PI / 2, 0, s * -1.1)
      g.add(spar)
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), frame)
      strut.position.set(s * 0.5, -0.65, 0)
      strut.rotation.z = s * 0.35
      g.add(strut)
    }
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6), toneMapped: false })
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), tipMat)
      tip.position.set(s * 4.5, 0, 1.25)
      g.add(tip)
    }
    g.position.y = 2.1
    g.scale.setScalar(0.001)
    g.visible = false
    r.car.mesh.add(g)
    this.wingsOf.set(r, g)
    return g
  }

  private updateWings(dt: number): void {
    for (const r of this.racers) {
      if (!r.gliding && !this.wingsOf.has(r)) continue
      const g = this.wings(r)
      const want = r.gliding ? 1 : 0
      const s = THREE.MathUtils.lerp(g.scale.x, want, Math.min(1, dt * (want ? 6 : 10)))
      g.scale.setScalar(Math.max(0.001, s))
      g.visible = s > 0.02
    }
  }

  private dust(): THREE.Color {
    const s = this.player?.surface
    return this._dust.set(s === 'snow' ? 0xeef4fb : s === 'sand' ? 0xd8ab6e : s === 'mud' ? 0x5a4630 : 0x8c8378)
  }
  private readonly _dust = new THREE.Color()

  private drone(r: Racer): THREE.Group {
    let d = this.drones.get(r)
    if (d) return d
    d = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 1.8), new THREE.MeshStandardMaterial({ color: 0x20242e, metalness: 0.5, roughness: 0.4 }))
    d.add(body)
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2, 0.4), toneMapped: false })
    for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) {
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 12), lamp)
      rotor.position.set(x, 0.2, z)
      d.add(rotor)
    }
    d.visible = false
    this.gfx.scene.add(d)
    this.drones.set(r, d)
    return d
  }

  private async spawnRivals(difficulty: Difficulty): Promise<void> {
    const c = this.circuit!, w = this.world!
    for (const car of this.rivalCars) this.gfx.scene.remove(car.mesh)
    this.rivalCars.length = 0
    this.rivals = []
    this.racers.length = 0
    this.racers.push(this.player!)
    let k = 0
    for (const d of DRIVERS) {
      const info = CARS.find((x) => x.id === d.car)!
      const model = await this.model(info)
      const car = new Car(undefined, true)
      car.earnNitro = true
      car.canReverse = true
      car.setStats(info.stats)
      if (model) car.applyModel(model, 4.5, 0, false)
      car.setPaint(d.color)
      car.bake()
      car.mesh.traverse((o) => { o.castShadow = false })
      this.gfx.scene.add(car.mesh)
      this.rivalCars.push(car)
      const r = new Racer(car, d.name, false, w, c)
      r.events = this.events
      const spot = c.gridSpot(k)
      r.place(spot.pos, spot.yaw, spot.i)
      this.racers.push(r)
      this.rivals.push(new Rival(r, d, difficulty, this.rand))
      k++
    }
  }

  /** Grid up and count down. Rivals are optional for tests. */
  async startRace(laps: number, difficulty: Difficulty): Promise<void> {
    this.laps = laps
    this.starting = true
    this.phase = 'idle'
    this.toGrid()
    try { await this.spawnRivals(difficulty) } finally { this.starting = false }
    // anything that moved the car while the rivals loaded: back on the grid
    const spot = this.circuit!.gridSpot(5)
    this.player!.place(spot.pos, spot.yaw, spot.i)
    this.car.nitro = 0.25
    for (const r of this.racers) r.car.nitro = 0.25
    this.raceMs = 0
    this.finishT = 0
    this.wrongT = 0
    this.leaderLap = 1
    this.autoPlayer = null
    this.bestLap = Infinity
    this.buildStartWall()
    this.items?.clear()
    this.itemShown = ''
    this.ui.setItem(null, false, 0)
    this.effects.clear()
    this.chase.snap(this.gfx.camera, this.car)
    this.audio.unlock()
    this.audio.startEngine()
    this.music.start(this.def!.id)
    this.ui.raceStarted()
    this.ui.setLap(1, laps)
    this.ui.setNitro(this.car.nitro, false)
    this.phase = this.noIntro ? 'countdown' : 'intro'
    this.introT = 0
    if (!this.noIntro) this.ui.toast(this.def!.name.toUpperCase())
    this.countdownT = 0
    this.countdownStep = 0
    this.revAt = -1
  }

  private buildStartWall(): void {
    const c = this.circuit!
    if (this.startWall) this.root.remove(this.startWall)
    const i = (c.count - START_WALL) % c.count, p = c.samples[i]!, t = c.tangents[i]!
    const stripes = new THREE.MeshStandardMaterial({ color: 0xf2b21c, roughness: 0.6, emissive: 0x3a2a00 })
    this.startWall = new THREE.Mesh(new THREE.BoxGeometry(c.widths[i]! + 2, 1.2, 0.6), stripes)
    this.startWall.position.set(p.x, p.y + 0.6, p.z)
    this.startWall.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2 - Math.PI / 2
    this.root.add(this.startWall)
  }

  exitRace(): void {
    this.phase = 'idle'
    this.leaderLap = 1
    this.audio.stopEngine()
    this.music.stop()
    this.audio.setLoop('crowd', 0)
    for (const c of this.rivalCars) this.gfx.scene.remove(c.mesh)
    this.rivalCars.length = 0
    this.racers.length = 0
    this.rivals = []
    if (this.startWall) { this.root.remove(this.startWall); this.startWall = null }
    if (this.circuit) this.toGrid()
  }

  private update = (dt: number, time: number): void => {
    windClock.value = time
    atmos.caustic.y = time
    const f: FrameInfo = { time, dt, lap: this.leaderLap, totalLaps: this.laps, camera: this.gfx.camera, player: this.car.position }
    for (const fn of this.frames) fn(f)
    switch (this.phase) {
      case 'idle':
        if (this.circuit) this.cine.update(this.gfx.camera, dt, this.car.mesh.position, this.car.heading)
        this.post.setSpeed(0)
        break
      case 'preview': this.updatePreview(dt); break
      case 'intro': this.updateIntro(dt); break
      case 'countdown': this.updateCountdown(dt); break
      case 'racing': this.updateRacing(dt); break
      case 'finished': this.updateFinished(dt); break
    }
    const inRace = this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'finished'
    if (this.phase !== 'racing' && this.phase !== 'finished') this.items?.idle(time)
    this.spinRivals(dt)
    this.fx.update(dt, time, this.car.mesh, this.car.heading, this.car.getNormalizedSpeed(), this.accent, inRace && !this.player?.air, this.gfx.camera, this.sky.sunDir, 0)
    if (this.def) this.audio.setWorld(this.def.ambience, 0, 0, false, dt)
    this.updateShadows()
    this.flash = Math.max(0, this.flash - dt * 2.4)
    this.post.setFlash(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash * this.flash * 0.5)
    this.post.setTime(time)
    this.updateShafts()
    this.sky.update(time)
    this.sky.follow(this.gfx.camera.position)
    this.shake.update(this.gfx.camera, dt)
    const cam = this.gfx.camera
    cam.getWorldDirection(this._fwd)
    this._fwd.y = 0
    this._fwd.normalize()
    this._v.copy(cam.position).addScaledVector(this._fwd, 35)
    this._v.y = this.car.position.y
    followShadow(this.lights, this._v, this.sky.sunDir)
  }

  private render = (dt: number): void => { this.fitResolution(dt); this.post.render(dt) }

  /** Where the sun falls on screen, for the light shafts. */
  private updateShafts(): void {
    const k = this.def?.look.shafts ?? 0, cam = this.gfx.camera
    if (k <= 0) { this.post.setSun(0.5, 0.5, 0); return }
    this._v.copy(cam.position).addScaledVector(this.sky.sunDir, 1000).project(cam)
    cam.getWorldDirection(this._fwd)
    const facing = this._fwd.dot(this.sky.sunDir)
    const edge = Math.max(Math.abs(this._v.x), Math.abs(this._v.y))
    const s = facing > 0.05 ? k * THREE.MathUtils.smoothstep(1.7 - edge, 0, 0.7) : 0
    this.post.setSun(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5, s)
  }

  /** The fly-in: a low pass over the track, then down to the grid. */
  private updateIntro(dt: number): void {
    const c = this.circuit!, cam = this.gfx.camera, n = c.count
    this.introT += dt
    const T = 6.5, u = this.introT / T
    const keys = this.keys()
    if (u >= 1 || (this.introT > 0.6 && (keys.accelerate || keys.brake))) {
      this.phase = 'countdown'
      this.chase.snap(cam, this.car)
      return
    }
    const shot = Math.min(2, Math.floor(u * 3)), v = u * 3 - shot
    const i = Math.floor(n * (0.12 + shot * 0.27 + v * 0.05)) % n
    const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
    if (shot === 0) {
      cam.position.set(p.x + r.x * (30 - v * 12), p.y + 34 - v * 16, p.z + r.z * (30 - v * 12))
      cam.lookAt(p.x + t.x * 90, p.y + 2, p.z + t.z * 90)
    } else if (shot === 1) {
      cam.position.set(p.x - t.x * 12 + r.x * 6, p.y + 4 + v * 3, p.z - t.z * 12 + r.z * 6)
      cam.lookAt(p.x + t.x * 70, p.y + 6, p.z + t.z * 70)
    } else {
      const g = this.car.position, a = this.car.heading + 0.9 + v * 1.5, d = 16 - v * 7
      cam.position.set(g.x + Math.sin(a) * d, g.y + 3.5 - v * 2, g.z + Math.cos(a) * d)
      cam.lookAt(g.x, g.y + 1, g.z)
    }
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix() }
    this.post.setSpeed(0)
  }

  private spinRivals(dt: number): void {
    for (const c of this.rivalCars) c.spinWheels(c.getSpeed() * dt)
  }

  private updatePreview(dt: number): void {
    const c = this.circuit
    if (!c) return
    this.previewT += dt
    this.previewPos = (this.previewPos + 42 * dt / 2) % c.count
    const k = Math.floor(this.previewPos), fr = this.previewPos - k
    const i = k % c.count, t = c.tangents[i]!, car = this.car
    this._v.lerpVectors(c.samples[i]!, c.samples[(i + 1) % c.count]!, fr)
    car.setPose(this._v, Math.atan2(-t.x, -t.z))
    car.setSlopePitch(Math.asin(THREE.MathUtils.clamp(t.y, -1, 1)), 0.2)
    car.spinWheels(42 * dt)
    const cam = this.gfx.camera, p = this._v
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading), rx = -fz, rz = fx
    const shot = Math.floor(this.previewT / 6) % 3, s = Math.sin(this.previewT * 0.35)
    if (shot === 0) {
      cam.position.set(p.x - fx * 10 + rx * s * 4, p.y + 3, p.z - fz * 10 + rz * s * 4)
      cam.lookAt(p.x + fx * 12, p.y + 1.6, p.z + fz * 12)
    } else if (shot === 1) {
      cam.position.set(p.x + fx * 13 + rx * 6, p.y + 1.8, p.z + fz * 13 + rz * 6)
      cam.lookAt(p.x, p.y + 1, p.z)
    } else {
      cam.position.set(p.x - fx * 5 + rx * 12, p.y + 7, p.z - fz * 5 + rz * 12)
      cam.lookAt(p.x + fx * 8, p.y + 1, p.z + fz * 8)
    }
    if (cam.fov !== 56) { cam.fov = 56; cam.updateProjectionMatrix() }
    this.post.setSpeed(0.2)
  }

  private keys(): InputState { return this.driver ? this.driver() : this.input.get() }

  private updateCountdown(dt: number): void {
    this.countdownT += dt
    const labels = ['3', '2', '1', 'GO']
    const step = 0.9
    const due = Math.floor(this.countdownT / step)
    if (due >= this.countdownStep && this.countdownStep < labels.length) {
      const l = labels[this.countdownStep]!
      this.ui.countdown(l)
      if (l === 'GO') this.audio.playGoBeep()
      else this.audio.playCountdownBeep()
      this.countdownStep++
    }
    const accel = this.keys().accelerate
    if (!accel) this.revAt = -1
    else if (this.revAt < 0) this.revAt = this.countdownT
    this.audio.updateEngine(accel ? 0.55 : 0.05)
    this.chase.update(this.gfx.camera, this.car, dt)
    for (const r of this.racers) r.car.mesh.position.y = r.car.position.y
    this.post.setSpeed(0)
    if (this.countdownT >= step * 3) {
      this.phase = 'racing'
      const perfect = this.revAt >= step * 3 - 0.7
      this.car.launch = perfect ? 6 : 3
      for (const r of this.rivals) r.racer.car.launch = 3
      if (perfect) {
        this.car.setSpeed(26)
        this.chase.kick(12)
        this.shake.addTrauma(0.25)
        this.audio.playBoost()
        this.ui.toast('PERFECT LAUNCH', true)
      }
      for (const r of this.racers) r.lapStart = 0
      setTimeout(() => this.ui.countdown(null), 700)
    }
  }

  private updateRacing(dt: number): void {
    const pl = this.player!, car = this.car
    this.raceMs += dt * 1000
    const keys = this.keys()
    pl.step(dt, keys, true)
    if (pl.air) car.nitro = Math.min(1, car.nitro + dt * 0.1)
    this.stepRivals(dt)
    this.pairs()
    const press = !!keys.item && !this.itemWas
    this.itemWas = !!keys.item
    this.stepItems(dt, press, !!keys.brake)
    this.holdStartWall()
    this.laps_()
    if (this.phase !== 'racing') return
    this.wrongWay(dt)
    this.shared(dt)
    this.ui.setTime(fmt(this.raceMs))
    this.ui.setMph(Math.round(Math.abs(car.getSpeedMph())))
    this.ui.setNitro(car.nitro, car.boosting)
    const offroad = !pl.onRoad && !pl.air ? 1 : 0
    this.audio.updateDriving({ speed: car.getNormalizedSpeed(), throttle: car.throttle, slip: car.getSlip(), offroad })
    this.effects.update(car, dt, offroad, car.position.y)
    const boost = car.boosting
    if (boost && !this.wasBoost) { this.audio.playBoost(); this.shake.addTrauma(0.15) }
    this.wasBoost = boost
    this.drifted(dt)
    this.chase.update(this.gfx.camera, car, dt)
    this.music.setIntensity(Math.min(1, car.getNormalizedSpeed() + (this.laps > 1 && pl.lap + 1 >= this.laps ? 0.3 : 0)))
    this.post.setSpeed(Math.min(1, car.getNormalizedSpeed()) + (boost ? 0.45 : car.surge > 0 ? 0.3 : 0))
    this.minimap?.update(car.position, this.rivalCars.map((c) => c.position))
  }
  private wasBoost = false

  private stepItems(dt: number, use: boolean, back: boolean): void {
    const it = this.items
    if (!it) return
    const order = this.order()
    it.update(dt, this.raceMs / 1000, order, this.phase === 'racing' ? this.player : null, use, back)
    for (const a of this.rivals) { const h = it.carrying(a.racer); a.wantItem = !h.kind && h.roll <= 0 }
    this.updateWings(dt)
    if (!this.player) return
    const h = it.carrying(this.player)
    const key = `${h.kind}|${h.roll > 0}|${h.count}`
    if (key !== this.itemShown) { this.itemShown = key; this.ui.setItem(h.kind, h.roll > 0, h.count) }
  }

  /** Sparks under a held drift, changing colour as it charges, and the kick when it pays. */
  private drifted(dt: number): void {
    const car = this.car, level = car.driftCharge > 2.2 ? 3 : car.driftCharge > 1.3 ? 2 : car.driftCharge > 0.7 ? 1 : 0
    if (level) {
      this.driftAcc += dt * 40
      if (this.driftAcc > 1) {
        this.driftAcc = 0
        const f = car.getForwardDir(this._fwd)
        const s = Math.random() < 0.5 ? -1 : 1
        this._v.copy(car.position).addScaledVector(f, -1.6)
        this._v.x += -f.z * s * 0.9; this._v.z += f.x * s * 0.9; this._v.y += 0.2
        this.effects.sparks(this._v, f.multiplyScalar(-8), level * 2)
      }
    }
    if (car.driftPaid) {
      this.audio.playBoost()
      this.chase.kick(5 + car.driftPaid * 3)
      this.shake.addTrauma(0.08 + car.driftPaid * 0.05)
      this.ui.toast(['', 'DRIFT BOOST', 'SUPER DRIFT', 'ULTRA DRIFT'][car.driftPaid]!)
    }
  }
  private driftAcc = 0

  private stepRivals(dt: number): void {
    const n = this.circuit!.count, pl = this.player!
    for (const a of this.rivals) {
      const gap = (pl.progress - a.racer.progress) / n * this.circuit!.length
      if (a.racer.rescue <= 0) a.drive(dt, gap)
      a.racer.step(dt, a.input, !a.racer.finished || true)
    }
  }

  /** Cars bump: each is pushed clear, and the one behind loses a little. */
  private pairs(): void {
    const list = this.racers
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = list[a]!, B = list[b]!
      if (A.rescue > 0 || B.rescue > 0) continue
      const pa = A.car.position, pb = B.car.position
      const dx = pb.x - pa.x, dz = pb.z - pa.z, d = Math.hypot(dx, dz)
      if (d > 3.4 || d < 1e-3 || Math.abs(pa.y - pb.y) > 1.8) continue
      const push = (3.4 - d) / 2, nx = dx / d, nz = dz / d
      pa.x -= nx * push; pa.z -= nz * push
      pb.x += nx * push; pb.z += nz * push
      const behind = A.progress < B.progress ? A : B
      behind.car.scrubSpeed(0.985)
      if ((A.isPlayer || B.isPlayer) && this.bumpCool <= 0) {
        this.bumpCool = 0.5
        this.shake.addTrauma(0.15)
        this.audio.playCollision()
      }
    }
    this.bumpCool -= 1 / 60
  }
  private bumpCool = 0

  /** Nobody drives back past the wall behind the grid on lap 1. */
  private holdStartWall(): void {
    const c = this.circuit!
    const wall = -START_WALL + 2
    let anyOver = false
    for (const r of this.racers) {
      if (r.progress < wall && r.lap === 0) {
        const i = (c.count - START_WALL + 6) % c.count, p = c.samples[i]!
        r.car.position.lerp(this._v.set(p.x, r.car.position.y, p.z), 0.12)
        r.car.setSpeed(0)
      }
      if (r.progress > 40) anyOver = true
    }
    if (anyOver && this.startWall && this.player!.progress > 200) {
      this.root.remove(this.startWall)
      this.startWall = null
    }
  }

  private laps_(): void {
    const pl = this.player!
    for (const r of this.racers) {
      if (r.finished) continue
      const ev = r.updateLap(this.raceMs, this.laps)
      if (!ev) continue
      if (r.isPlayer) {
        const best = r.lastLapMs < this.bestLap
        this.bestLap = Math.min(this.bestLap, r.lastLapMs)
        if (ev === 'lap') {
          this.ui.setLap(r.lap + 1, this.laps)
          this.ui.toast(r.lap + 1 === this.laps ? `FINAL LAP  ${fmt(r.lastLapMs)}` : `LAP ${r.lap + 1}  ${fmt(r.lastLapMs)}`, best)
          this.audio.playCheckpoint()
        }
      }
      this.leaderLap = Math.max(this.leaderLap, r.lap + 1)
      if (ev === 'finish') {
        r.finished = true
        r.finishMs = this.raceMs
        if (r.isPlayer) { this.finish(); return }
      }
    }
    void pl
  }

  private wrongWay(dt: number): void {
    const pl = this.player!, t = pl.path.tangents[pl.pi]!
    const f = this.car.getForwardDir(this._fwd)
    const wrong = f.x * t.x + f.z * t.z < -0.35 && this.car.getSpeed() > 6
    this.wrongT = wrong ? this.wrongT + dt : 0
    this.ui.warn(this.wrongT > 1 ? 'WRONG WAY' : null)
  }

  /** Soft contact shadows, so cars sit on the road. */
  private updateShadows(): void {
    const list = this.racers.length ? this.racers : this.player ? [this.player] : []
    while (this.shadows.length < list.length) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2), this.shadowMat)
      m.rotation.order = 'YXZ'
      m.rotation.x = -Math.PI / 2
      m.renderOrder = 1
      this.gfx.scene.add(m)
      this.shadows.push(m)
    }
    this.shadows.forEach((m, k) => {
      const r = list[k]
      m.visible = !!r && r.rescue <= 0 && r.car.mesh.visible
      if (!r || !m.visible) return
      const p = r.car.position
      m.position.set(p.x, r.groundY + 0.09, p.z)
      m.rotation.y = r.car.heading
    })
  }

  private shared(dt: number): void {
    // places
    const order = this.order()
    const place = order.indexOf(this.player!) + 1
    if (place !== this.place) { this.place = place }
    this.ui.setPlace(place, this.racers.length)
    for (const r of this.racers) {
      const d = this.drones.get(r)
      if (d) {
        d.visible = r.rescue > 0
        if (d.visible) { d.position.copy(r.car.position).setY(r.car.position.y + 2.3); d.rotation.y += dt * 2 }
      }
    }
  }

  private order(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishMs - b.finishMs
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return b.progress - a.progress
    })
  }

  private finish(): void {
    const pl = this.player!
    this.phase = 'finished'
    this.finishT = 0
    this.audio.playFinish()
    this.music.stop()
    this.audio.sfx('cheer')
    this.ui.warn(null)
    this.shake.addTrauma(0.3)
    // the car keeps circulating on its own while the others come home
    this.autoPlayer = new Rival(pl, { name: 'You', pace: 0.8, mistakes: 0, bold: 0.2, color: 0, car: 'rotor' }, 'hard', this.rand)
  }

  private updateFinished(dt: number): void {
    this.finishT += dt
    const pl = this.player!, car = this.car
    this.autoPlayer!.drive(dt, 0)
    pl.step(dt, this.autoPlayer!.input, true)
    this.stepRivals(dt)
    this.pairs()
    this.stepItems(dt, false, false)
    this.raceMs += dt * 1000
    for (const r of this.racers) {
      if (r.finished) continue
      if (r.updateLap(this.raceMs, this.laps) === 'finish') { r.finished = true; r.finishMs = this.raceMs }
    }
    this.shared(dt)
    this.audio.updateEngine(car.getNormalizedSpeed() * 0.4)
    this.post.setSpeed(0)
    const cam = this.gfx.camera, a = this.finishT * 0.25 + car.heading + 2.4
    cam.position.set(car.position.x + Math.sin(a) * 9, car.position.y + 2.6, car.position.z + Math.cos(a) * 9)
    cam.lookAt(car.position.x, car.position.y + 1, car.position.z)
    if (this.finishT > 3 && !this.ended) { this.ended = true; this.endNow() }
  }
  private ended = false

  private endNow(): void {
    const rows = this.order().map((r) => ({ name: r.name, isPlayer: r.isPlayer, timeMs: r.finishMs, finished: r.finished, bestLapMs: r.bestLapMs }))
    this.ended = false
    this.phase = 'idle'
    this.audio.stopEngine()
    this.music.stop()
    this.ui.raceEnded(rows)
  }
}

export function fmt(ms: number): string {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), t = Math.floor(ms % 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(t).padStart(3, '0')}`
}

export { RESCUE_TIME, savedCar }
