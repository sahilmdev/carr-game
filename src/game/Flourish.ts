import * as THREE from 'three'
import type { Track, ZoneName } from './Track'
import { FLIGHT_ZONES } from './trackData'
import { canvasTexture, instanced, lumpy, puffTexture, rightAt, rng, trs, zoneIndices } from './biomes/kit'
import type { SfxName } from './Sfx'

interface Ring { i: number; lat: number; hit: boolean }
interface FlourishFrame {
  time: number
  dt: number
  idx: number
  zone: ZoneName
  carPos: THREE.Vector3
  sfx: (name: SfxName, vol?: number, pitch?: number) => void
}

const SPLASH = 26
const BIRDS = 44
const FLYERS = 46
const ROCKS = 70
const SERPENT = 44
/** Zones that open with a big arch; the name is the arch's place on the lap. */
const PORTAL_ZONES: ZoneName[] = ['causeway', 'canyon', 'volcano', 'desert', 'saltflat', 'snow', 'sky', 'jungle', 'city']

/**
 * Set dressing that sits outside the biome groups and switches itself on by
 * zone: flight rings, area arches, spray, the sea serpent, asteroids, birds,
 * hover traffic and the final billboards. Nothing here is ever on the road
 * except the rings, which hang in the air over the gaps.
 */
export class Flourish {
  readonly group = new THREE.Group()
  private readonly rand = rng(911)
  private readonly m = new THREE.Matrix4()
  private readonly v = new THREE.Vector3()

  private readonly rings: Ring[] = []
  private ringMesh!: THREE.InstancedMesh
  private portals!: THREE.InstancedMesh
  private readonly portalAt: { i: number; m: THREE.Matrix4 }[] = []
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0)

  private readonly splash: THREE.Sprite[] = []
  private nextSpray = 1
  private diveIdx = -1
  private dived = false

  private rays!: THREE.Group
  private serpent!: THREE.InstancedMesh
  private serpentIds: number[] = []
  private serpentT = -1

  private rocks!: THREE.InstancedMesh
  private readonly rockSeed: { p: THREE.Vector3; s: number; a: THREE.Vector3; w: number }[] = []

  private birds!: THREE.InstancedMesh
  private readonly bird = Array.from({ length: BIRDS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 9 }))
  private birdNext = 0
  private birdSpots: number[] = []

  private flyers!: THREE.InstancedMesh
  private cityIds: number[] = []
  private readonly flyer: { u: number; lat: number; up: number; dir: number; v: number }[] = []
  private boards = new THREE.Group()

  constructor(private readonly track: Track, skipBoard: (i: number) => boolean) {
    this.buildRings()
    this.buildPortals()
    this.buildSplash()
    this.buildSea()
    this.buildRocks()
    this.buildBirds()
    this.buildCity(skipBoard)
  }

  // ── flight rings ──
  private buildRings(): void {
    const t = this.track, n = t.sampleCount
    let run: number[] = []
    const flush = () => {
      if (run.length < 8) { run = []; return }
      const count = run.length > 140 ? 4 : run.length > 80 ? 3 : 1
      for (let k = 0; k < count; k++) {
        const i = run[Math.floor(run.length * ((k + 0.8) / (count + 0.6)))]!
        this.rings.push({ i, lat: (this.rings.length % 2 ? 1 : -1) * (3 + (this.rings.length % 3) * 1.6), hit: false })
      }
      run = []
    }
    for (let i = 0; i < n; i++) {
      if (FLIGHT_ZONES.has(t.zoneOfSample(i))) run.push(i)
      else flush()
    }
    flush()
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })
    this.ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(3.9, 0.2, 8, 36), mat, this.rings.length)
    this.ringMesh.frustumCulled = false
    this.rings.forEach((r, k) => this.ringMesh.setColorAt(k, new THREE.Color(k % 2 ? 0x38e8ff : 0xffc23c).multiplyScalar(2.6)))
    this.resetRings()
    this.ringMesh.visible = false
    this.group.add(this.ringMesh)
  }

  private ringMatrix(r: Ring): THREE.Matrix4 {
    const t = this.track, p = t.samples[r.i]!, tg = t.tangents[r.i]!, right = rightAt(t, r.i)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg)
    return new THREE.Matrix4().compose(this.v.set(p.x + right.x * r.lat, p.y + 0.8, p.z + right.z * r.lat), q, new THREE.Vector3(1, 1, 1))
  }

  resetRings(): void {
    this.rings.forEach((r, k) => { r.hit = false; this.ringMesh.setMatrixAt(k, this.ringMatrix(r)) })
    this.ringMesh.instanceMatrix.needsUpdate = true
  }

  /** Crossed samples a → b at lateral offset `lat`: returns rings collected. */
  collectRings(a: number, b: number, lat: number): number {
    let got = 0
    this.rings.forEach((r, k) => {
      if (r.hit || r.i <= a || r.i > b) return
      if (Math.abs(r.lat - lat) > 4.6) return
      r.hit = true
      got++
      this.ringMesh.setMatrixAt(k, this.zero)
      this.ringMesh.instanceMatrix.needsUpdate = true
    })
    return got
  }

  // ── arches at each change of area ──
  private buildPortals(): void {
    const t = this.track
    const cols: THREE.Color[] = []
    for (const z of PORTAL_ZONES) {
      const i = zoneIndices(t, z)[0]
      if (i === undefined || t.isGap(i)) continue
      const p = t.samples[i]!, tg = t.tangents[i]!
      this.portalAt.push({ i, m: trs(p.x, p.y - 0.4, p.z, Math.atan2(tg.x, tg.z)) })
      cols.push(t.accents[i]!.clone().multiplyScalar(3.2))
    }
    const arc = new THREE.TorusGeometry(19, 0.8, 10, 48, Math.PI)
    this.portals = instanced(arc, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), this.portalAt.map((p) => p.m), cols, false)
    this.portals.frustumCulled = false
    this.group.add(this.portals)
  }

  // ── sea: spray over the causeway, the splash into the tunnel ──
  private buildSplash(): void {
    const puff = puffTexture()
    for (let k = 0; k < SPLASH; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xeaf6ff, transparent: true, depthWrite: false, opacity: 0 }))
      s.visible = false
      s.userData['t'] = 9
      s.userData['life'] = 1
      s.userData['v'] = new THREE.Vector3()
      this.splash.push(s)
      this.group.add(s)
    }
    const under = zoneIndices(this.track, 'underwater')
    this.diveIdx = under.find((i) => this.track.samples[i]!.y < 0) ?? under[0]!
  }

  private burst(at: THREE.Vector3, count: number, speed: number, up: number, life: number): void {
    let left = count
    for (const s of this.splash) {
      if (left === 0) return
      if ((s.userData['t'] as number) < (s.userData['life'] as number)) continue
      left--
      s.position.copy(at)
      s.userData['t'] = 0
      s.userData['life'] = life * (0.7 + this.rand() * 0.6)
      const a = this.rand() * Math.PI * 2
      ;(s.userData['v'] as THREE.Vector3).set(Math.cos(a) * speed * this.rand(), up * (0.6 + this.rand() * 0.6), Math.sin(a) * speed * this.rand())
      s.visible = true
    }
  }

  private updateSplash(f: FlourishFrame): void {
    if (f.zone === 'causeway') {
      this.nextSpray -= f.dt
      if (this.nextSpray <= 0) {
        this.nextSpray = 0.9 + this.rand() * 0.9
        const i = (f.idx + 70 + Math.floor(this.rand() * 60)) % this.track.sampleCount
        const p = this.track.samples[i]!, r = rightAt(this.track, i), side = this.rand() < 0.5 ? -1 : 1
        this.burst(this.v.set(p.x + r.x * side * 13.5, p.y - 1, p.z + r.z * side * 13.5), 6, 3, 15, 1.5)
        f.sfx('gust', 0.3)
      }
    }
    if (!this.dived && f.idx >= this.diveIdx && f.idx < this.diveIdx + 80) {
      this.dived = true
      this.burst(this.v.copy(f.carPos).setY(0.4), 18, 9, 17, 1.4)
      f.sfx('splash')
    }
    if (f.idx < this.diveIdx - 100) this.dived = false
    for (const s of this.splash) {
      if (!s.visible) continue
      const t = (s.userData['t'] as number) + f.dt, life = s.userData['life'] as number
      s.userData['t'] = t
      const v = s.userData['v'] as THREE.Vector3
      v.y -= 19 * f.dt
      s.position.addScaledVector(v, f.dt)
      s.scale.setScalar(2.5 + (t / life) * 9)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.75 * (1 - t / life)
      if (t >= life) s.visible = false
    }
  }

  // ── under the sea: god rays and the serpent ──
  private buildSea(): void {
    const t = this.track
    const ids = zoneIndices(t, 'underwater')
    const tex = canvasTexture(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h)
      gr.addColorStop(0, 'rgba(190,245,255,0.6)')
      gr.addColorStop(1, 'rgba(190,245,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = 'destination-in'
      const e = g.createLinearGradient(0, 0, w, 0)
      e.addColorStop(0, 'rgba(0,0,0,0)')
      e.addColorStop(0.5, 'rgba(0,0,0,1)')
      e.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = e
      g.fillRect(0, 0, w, h)
    })
    this.rays = new THREE.Group()
    this.rays.visible = false
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.55 })
    const geo = new THREE.PlaneGeometry(14, 62)
    const mats: THREE.Matrix4[] = []
    for (let k = 0; k < 90; k++) {
      const i = ids[Math.floor(this.rand() * ids.length)]!
      const p = t.samples[i]!, r = rightAt(t, i), lat = (this.rand() < 0.5 ? -1 : 1) * (17 + this.rand() * 45)
      mats.push(trs(p.x + r.x * lat, -24, p.z + r.z * lat, this.rand() * 3.14, 1, 0, 0.16))
    }
    this.rays.add(instanced(geo, mat, mats, undefined, false))
    this.group.add(this.rays)

    // the last long sea-floor run, away from the spiral and the loops
    this.serpentIds = ids.slice(Math.floor(ids.length * 0.76), Math.floor(ids.length * 0.97))
    const body = new THREE.MeshStandardMaterial({ color: 0x173b4a, roughness: 0.45, metalness: 0.3, emissive: 0x0d7f8c, emissiveIntensity: 0.55, fog: true })
    this.serpent = new THREE.InstancedMesh(lumpy(new THREE.IcosahedronGeometry(1, 2), 0.1, 1.4, 3), body, SERPENT)
    this.serpent.frustumCulled = false
    this.serpent.visible = false
    this.group.add(this.serpent)
  }

  private updateSerpent(f: FlourishFrame): void {
    const ids = this.serpentIds, first = ids[0]!, last = ids[ids.length - 1]!
    const inside = f.idx >= first - 60 && f.idx <= last
    if (!inside) { this.serpentT = -1; this.serpent.visible = false; return }
    if (this.serpentT < 0) { this.serpentT = 0; f.sfx('whale', 0.9, 0) }
    this.serpentT += f.dt
    this.serpent.visible = true
    const t = this.track
    // it passes the car, head first, and pulls away
    const head = f.idx - 40 + this.serpentT * 34
    for (let k = 0; k < SERPENT; k++) {
      const u = k / SERPENT
      const i = (Math.floor(head - k * 3.5) + t.sampleCount) % t.sampleCount
      const p = t.samples[i]!, r = rightAt(t, i)
      const wave = Math.sin(this.serpentT * 3.2 - k * 0.42)
      const lat = 34 + wave * 5
      const s = (u < 0.1 ? 2.6 + u * 30 : 5.6 * (1 - u) + 0.5)
      this.m.makeScale(s * 1.2, s, s * 1.2)
      this.m.setPosition(p.x + r.x * lat, p.y + 9 + Math.cos(this.serpentT * 2.4 - k * 0.42) * 3, p.z + r.z * lat)
      this.serpent.setMatrixAt(k, this.m)
    }
    this.serpent.instanceMatrix.needsUpdate = true
  }

  // ── moon: asteroids well clear of the road ──
  private buildRocks(): void {
    const t = this.track
    const ids = zoneIndices(t, 'space')
    for (let k = 0; k < ROCKS; k++) {
      const i = ids[Math.floor(this.rand() * ids.length)]!
      const p = t.samples[i]!, r = rightAt(t, i), lat = (this.rand() < 0.5 ? -1 : 1) * (42 + this.rand() * 150)
      this.rockSeed.push({
        p: new THREE.Vector3(p.x + r.x * lat, p.y + 8 + this.rand() * 70, p.z + r.z * lat),
        s: 2 + this.rand() * this.rand() * 15,
        a: new THREE.Vector3(this.rand(), this.rand(), this.rand()).normalize(),
        w: 0.1 + this.rand() * 0.5,
      })
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.95, flatShading: true, fog: false })
    this.rocks = new THREE.InstancedMesh(lumpy(new THREE.IcosahedronGeometry(1, 2), 0.32, 1.7, 9), mat, ROCKS)
    this.rocks.frustumCulled = false
    this.rocks.visible = false
    this.group.add(this.rocks)
  }

  private readonly _q = new THREE.Quaternion()
  private readonly _s = new THREE.Vector3()
  private updateRocks(time: number): void {
    this.rockSeed.forEach((r, k) => {
      this._q.setFromAxisAngle(r.a, time * r.w)
      this.v.copy(r.p)
      this.v.y += Math.sin(time * 0.3 + k) * 3
      this.m.compose(this.v, this._q, this._s.setScalar(r.s))
      this.rocks.setMatrixAt(k, this.m)
    })
    this.rocks.instanceMatrix.needsUpdate = true
  }

  // ── rainforest: flocks that burst out of the trees as you pass ──
  private buildBirds(): void {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.7, 0.18, 0, 0, 0, -0.18, 0, 0, 0.2, 0.7, 0.18, 0, 0, 0, -0.18, 0, 0, 0.2], 3))
    g.computeVertexNormals()
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x151a14, side: THREE.DoubleSide }), BIRDS)
    this.birds.frustumCulled = false
    this.birds.visible = false
    this.group.add(this.birds)
    const ids = zoneIndices(this.track, 'jungle')
    for (let k = 40; k < ids.length; k += 95) this.birdSpots.push(ids[k]!)
  }

  private updateBirds(f: FlourishFrame): void {
    const spot = this.birdSpots[this.birdNext]
    if (spot !== undefined && f.idx >= spot - 45) {
      this.birdNext++
      const p = this.track.samples[spot]!, r = rightAt(this.track, spot), side = this.birdNext % 2 ? 1 : -1
      let left = 15
      for (const b of this.bird) {
        if (b.t < 4 || left === 0) continue
        left--
        b.t = 0
        b.p.set(p.x + r.x * side * (15 + this.rand() * 8), p.y + 4 + this.rand() * 6, p.z + r.z * side * (15 + this.rand() * 8))
        b.v.set(r.x * side * (6 + this.rand() * 8) + (this.rand() - 0.5) * 9, 7 + this.rand() * 8, r.z * side * (6 + this.rand() * 8) + (this.rand() - 0.5) * 9)
      }
    }
    this.bird.forEach((b, k) => {
      b.t += f.dt
      if (b.t >= 4) { this.birds.setMatrixAt(k, this.zero); return }
      b.p.addScaledVector(b.v, f.dt)
      this.m.makeScale(1.4, 1.4 * (0.3 + Math.abs(Math.sin(f.time * 16 + k))), 1.4)
      this.m.setPosition(b.p)
      this.birds.setMatrixAt(k, this.m)
    })
    this.birds.instanceMatrix.needsUpdate = true
  }

  // ── neon city: hover traffic overhead, billboards on the last stretch ──
  private buildCity(skipBoard: (i: number) => boolean): void {
    const t = this.track
    this.cityIds = zoneIndices(t, 'city')
    const cols = [0xff3d9a, 0x37e6ff, 0xffd34d, 0xffffff]
    this.flyers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.7, 5.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), FLYERS)
    this.flyers.frustumCulled = false
    this.flyers.visible = false
    for (let k = 0; k < FLYERS; k++) {
      this.flyer.push({ u: this.rand(), lat: (k % 2 ? 1 : -1) * (15 + this.rand() * 26), up: 24 + (k % 3) * 9 + this.rand() * 3, dir: k % 2 ? 1 : -1, v: 0.018 + this.rand() * 0.014 })
      this.flyers.setColorAt(k, new THREE.Color(cols[k % cols.length]!).multiplyScalar(2.4))
    }
    this.group.add(this.flyers)

    const ads = [['FINAL PUSH', '#ff2f8a'], ['FLAT OUT', '#25d9ff'], ['NITRO COSMOS', '#ffbf2e'], ['STADIUM AHEAD', '#ff2f8a'], ['NO BRAKES', '#25d9ff'], ['ALMOST HOME', '#ffbf2e']] as const
    const post = new THREE.MeshStandardMaterial({ color: 0x15161f, metalness: 0.6, roughness: 0.4 })
    const n = this.cityIds.length
    let placed = 0
    for (let k = Math.floor(n * 0.42); k < n - 30 && placed < ads.length; k += 34) {
      const i = this.cityIds[k]!
      if (skipBoard(i)) continue
      const [text, col] = ads[placed]!
      const tex = canvasTexture(512, 192, (g, w, h) => {
        g.fillStyle = '#07060e'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = col
        g.lineWidth = 10
        g.strokeRect(8, 8, w - 16, h - 16)
        g.fillStyle = col
        g.font = '800 62px Rajdhani, Arial, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(text, w / 2, h / 2 + 4, w - 50)
      })
      const p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!, side = placed % 2 ? 1 : -1
      const b = new THREE.Group()
      const face = new THREE.Mesh(new THREE.PlaneGeometry(21, 7.9), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }))
      face.position.y = 12
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 12, 0.7), post)
      leg.position.y = 6
      b.add(face, leg)
      b.position.set(p.x + r.x * side * 19, p.y, p.z + r.z * side * 19)
      // angled in toward oncoming cars
      b.rotation.y = Math.atan2(-tg.x, -tg.z) + side * 0.35
      this.boards.add(b)
      placed++
    }
    this.boards.visible = false
    this.group.add(this.boards)
  }

  private updateFlyers(dt: number): void {
    const ids = this.cityIds, t = this.track, n = ids.length
    this.flyer.forEach((c, k) => {
      c.u = (c.u + c.dir * c.v * dt + 1) % 1
      const i = ids[Math.floor(c.u * (n - 1))]!, p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!
      this.m.makeRotationY(Math.atan2(tg.x, tg.z))
      this.m.setPosition(p.x + r.x * c.lat, p.y + c.up, p.z + r.z * c.lat)
      this.flyers.setMatrixAt(k, this.m)
    })
    this.flyers.instanceMatrix.needsUpdate = true
  }

  /** New lap or race: everything can happen again. */
  rearm(): void {
    this.resetRings()
    this.birdNext = 0
    this.dived = false
    this.serpentT = -1
  }

  update(f: FlourishFrame, flying: boolean): void {
    const z = f.zone
    this.ringMesh.visible = flying || FLIGHT_ZONES.has(z) || z === 'rampUp'
    // only the nearest arches exist, or they would shine through the hills
    this.portalAt.forEach((p, k) => {
      const d = (p.i - f.idx + this.track.sampleCount) % this.track.sampleCount
      this.portals.setMatrixAt(k, d < 420 || d > this.track.sampleCount - 60 ? p.m : this.zero)
    })
    this.portals.instanceMatrix.needsUpdate = true
    this.updateSplash(f)
    const sea = z === 'underwater'
    this.rays.visible = sea
    if (sea) this.updateSerpent(f)
    else this.serpent.visible = false
    this.rocks.visible = z === 'space' || z === 'flight1' || z === 'flight2'
    if (this.rocks.visible) this.updateRocks(f.time)
    this.birds.visible = z === 'jungle'
    if (this.birds.visible) this.updateBirds(f)
    const city = z === 'city'
    this.flyers.visible = city
    this.boards.visible = city
    if (city) this.updateFlyers(f.dt)
  }
}
