import * as THREE from 'three'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { rockSet, tiled } from '../Textures'
import { biomeGroup, fbm2, lumpy, rng, zoneIndices, rightAt, canvasTexture, puffTexture, roadSign, besideRoad, smooth } from './kit'

/** Half the rock spine's width, plus half the car. */
const SPINE_CLEAR = 2.1

interface Rock { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; vel: THREE.Vector3; delay: number; spin: number }
/** A rockfall that lands across lateral range lat0–lat1 at sample i. */
interface Slide {
  i: number
  lat0: number
  lat1: number
  text: string | null
  state: 'idle' | 'falling' | 'down' | 'scatter'
  t: number
  rocks: Rock[]
  dust: THREE.Sprite[]
}

/**
 * Red Rock Canyon: rockslides block half the road before the loop, and after
 * it a rock spine splits the road. Left is clear. Right has two boost strips
 * and falling rock to weave through at speed.
 */
export class Canyon implements Biome {
  readonly name = 'canyon'
  readonly group = biomeGroup('canyon')
  private readonly rand = rng(141)
  private before: number[] = []
  private after: number[] = []
  private slides: Slide[] = []
  private spineFrom = 0
  private spineTo = 0
  private lane = 0
  private scraped = false
  private clean = true
  private riskRun = false

  constructor(private readonly track: Track) {
    const ids = zoneIndices(track, 'canyon').filter((i) => track.samples[i]!.y > -1)
    // the loop splits the zone in two
    const cut = ids.findIndex((i, k) => k > 0 && i !== ids[k - 1]! + 1)
    this.before = cut > 0 ? ids.slice(0, cut) : ids
    this.after = cut > 0 ? ids.slice(cut) : []
  }

  fields(): TerrainField[] {
    return []
  }

  build(ctx: BuildCtx): void {
    const b = this.before, a = this.after
    if (b.length > 40) {
      this.addSlide(b[Math.floor(b.length * 0.42)]!, -10, 0.4, 'ROCKSLIDE  GO RIGHT')
      this.addSlide(b[Math.floor(b.length * 0.86)]!, -0.4, 10, 'ROCKSLIDE  GO LEFT')
    }
    if (a.length > 60) this.buildSplit(ctx)
  }

  private addSlide(i: number, lat0: number, lat1: number, text: string | null): void {
    const t = this.track, p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!
    const geo = lumpy(new THREE.DodecahedronGeometry(1, 2), 0.26, 1.2, i)
    const set = tiled(rockSet(), 1, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8775a, map: set.map, normalMap: set.normalMap, roughness: 1 })
    const side = (lat0 + lat1) > 0 ? 1 : -1
    const rocks: Rock[] = []
    const count = Math.round(Math.abs(lat1 - lat0) / 1.6) + 1
    for (let k = 0; k < count; k++) {
      const s = 1 + this.rand() * 0.9
      const m = new THREE.Mesh(geo, mat)
      m.scale.set(s, s * 0.8, s * (0.9 + this.rand() * 0.4))
      m.visible = false
      m.castShadow = true
      this.group.add(m)
      const lat = lat0 + ((k + 0.5) / count) * (lat1 - lat0)
      const along = (this.rand() - 0.5) * 7
      const to = p.clone().addScaledVector(r, lat).addScaledVector(tg, along)
      to.y = p.y + s * 0.55
      const from = p.clone().addScaledVector(r, side * (30 + this.rand() * 10)).addScaledVector(tg, along)
      from.y = p.y + 26 + this.rand() * 10
      rocks.push({ m, from, to, vel: new THREE.Vector3(), delay: this.rand() * 0.25, spin: 3 + this.rand() * 4 })
    }
    const dust: THREE.Sprite[] = []
    const puff = puffTexture()
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xc89a70, transparent: true, depthWrite: false, opacity: 0 }))
      s.visible = false
      dust.push(s)
      this.group.add(s)
    }
    this.slides.push({ i, lat0, lat1, text, state: 'idle', t: 0, rocks, dust })
  }

  /** The rock spine, the warning sign, the boost strips and the risky lane's rockfalls. */
  private buildSplit(ctx: BuildCtx): void {
    const t = this.track, a = this.after, n = a.length
    const k0 = Math.floor(n * 0.14), k1 = Math.floor(n * 0.84)
    this.spineFrom = a[k0]!
    this.spineTo = a[k1]!
    const set = tiled(rockSet(), 2, 12)
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8775a, map: set.map, normalMap: set.normalMap, roughness: 1, flatShading: true })
    const ROWS = 7
    const pos: number[] = [], uv: number[] = [], ind: number[] = []
    let d = 0, row = 0
    const total = k1 - k0
    for (let k = k0; k <= k1; k++) {
      const i = a[k]!, p = t.samples[i]!, r = rightAt(t, i)
      if (k > k0) d += p.distanceTo(t.samples[a[k - 1]!]!)
      // rises out of the road at the nose, sinks back at the tail
      const u = (k - k0) / total
      const grow = smooth(0, 0.1, u) * (1 - smooth(0.92, 1, u))
      const h = (1.7 + fbm2(d * 0.11, 3) * 3) * grow
      for (let c = 0; c < ROWS; c++) {
        const q = c / (ROWS - 1), a2 = q * Math.PI
        const bump = (fbm2(d * 0.3, c * 1.7) - 0.5) * 0.5
        const x = Math.cos(a2) * (1.05 + bump) * Math.max(0.15, grow)
        pos.push(p.x + r.x * x, p.y - 0.1 + Math.sin(a2) * (h + bump * grow), p.z + r.z * x)
        uv.push(q, d / 14)
      }
      if (row) for (let c = 0; c < ROWS - 1; c++) { const b = row * ROWS + c, o = b - ROWS; ind.push(o, b, o + 1, o + 1, b, b + 1) }
      row++
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(ind)
    g.computeVertexNormals()
    mat.side = THREE.DoubleSide
    const spine = new THREE.Mesh(g, mat)
    spine.castShadow = true
    spine.receiveShadow = true
    this.group.add(spine)

    this.group.add(besideRoad(t, a[Math.max(0, k0 - 10)]!, 14, roadSign(['ROAD SPLITS', 'RIGHT = RISK + BOOST'], '#f2c400', '#111', 3.8, 1.8)))

    const arrows = canvasTexture(128, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h)
      c.strokeStyle = '#46e6ff'
      c.lineWidth = 15
      c.lineJoin = 'miter'
      for (let q = 0; q < 3; q++) {
        const y = 60 + q * 76
        c.beginPath(); c.moveTo(14, y + 40); c.lineTo(w / 2, y - 14); c.lineTo(w - 14, y + 40); c.stroke()
      }
    })
    const pad = new THREE.MeshBasicMaterial({ map: arrows, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) })
    for (const fr of [0.24, 0.56]) {
      const i = a[Math.floor(n * fr)]!, p = t.samples[i]!, r = rightAt(t, i)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 10), pad)
      m.position.set(p.x + r.x * 5.6, p.y + 0.09, p.z + r.z * 5.6)
      m.rotation.set(-Math.PI / 2, 0, Math.atan2(-t.tangents[i]!.x, -t.tangents[i]!.z))
      m.renderOrder = 2
      this.group.add(m)
      ctx.addBoost(i, 5.6, 3.2)
    }
    // a slalom: first rocks on the outside of the lane, then against the spine
    this.addSlide(a[Math.floor(n * 0.4)]!, 5.4, 10, null)
    this.addSlide(a[Math.floor(n * 0.7)]!, 1.6, 6, null)
  }

  private latAt(f: FrameCtx): number {
    const p = this.track.samples[f.carIdx]!, r = rightAt(this.track, f.carIdx)
    return (f.carPos.x - p.x) * r.x + (f.carPos.z - p.z) * r.z
  }

  private updateSpine(f: FrameCtx, ev: BiomeEvents, lat: number): void {
    const i = f.carIdx
    if (!this.spineFrom || i < this.spineFrom || i > this.spineTo) {
      if (this.riskRun && i > this.spineTo && i < this.spineTo + 80) {
        this.riskRun = false
        if (this.clean) ev.toast('RISK LANE CLEAN', 'best')
      }
      this.lane = 0
      return
    }
    if (this.lane === 0) {
      this.lane = lat >= 0 ? 1 : -1
      this.scraped = false
      this.clean = true
      this.riskRun = this.lane > 0
    }
    // the spine has grown in by now: hold the car on its own side
    const grown = (i - this.spineFrom) / (this.spineTo - this.spineFrom) > 0.1
    const over = SPINE_CLEAR - lat * this.lane
    if (grown && over > 0) {
      const r = rightAt(this.track, i)
      ev.push(r.x * this.lane * over, r.z * this.lane * over)
      if (!this.scraped) {
        this.scraped = true
        ev.hit(0.3)
      }
    } else if (over < -1) {
      this.scraped = false
    }
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    if (f.zone !== 'canyon' && f.zone !== 'loop') {
      for (const s of this.slides) {
        if (s.state === 'idle') continue
        s.state = 'idle'
        for (const k of s.rocks) k.m.visible = false
        for (const d of s.dust) d.visible = false
      }
      return
    }
    if (f.zone === 'loop') return
    const lat = this.latAt(f)
    this.updateSpine(f, ev, lat)
    const car = f.carIdx
    for (const s of this.slides) {
      if (s.state === 'idle') {
        const p = this.track.samples[s.i]!
        const dist = Math.hypot(p.x - f.carPos.x, p.z - f.carPos.z)
        if (car < s.i && s.i - car < 220 && dist < Math.max(55, f.carSpeed * 2)) {
          s.state = 'falling'
          s.t = 0
          for (const k of s.rocks) { k.m.position.copy(k.from); k.m.visible = true }
          if (s.text) ev.toast(s.text)
          ev.sfx('rockfall')
        }
        continue
      }
      s.t += f.dt
      if (s.state === 'falling') {
        let landed = true
        for (const k of s.rocks) {
          const u = Math.min(1, Math.max(0, (s.t - k.delay) / 0.75))
          if (u < 1) landed = false
          k.m.position.lerpVectors(k.from, k.to, u)
          k.m.position.y = k.from.y + (k.to.y - k.from.y) * u * u // accelerates as it drops
          if (u < 1) k.m.rotation.x += f.dt * k.spin
        }
        if (landed) {
          s.state = 'down'
          s.t = 0
          ev.rumble(0.12)
          ev.sfx('rockImpact', 0.75)
          s.dust.forEach((d, q) => {
            const k = s.rocks[q % s.rocks.length]!
            d.position.copy(k.to)
            d.visible = true
          })
        }
      }
      if (s.state === 'down' || s.state === 'scatter') {
        for (const d of s.dust) {
          if (!d.visible) continue
          d.scale.setScalar(5 + s.t * 11)
          d.position.y += f.dt * 2.2
          ;(d.material as THREE.SpriteMaterial).opacity = 0.75 * Math.max(0, 1 - s.t / 2.2)
          if (s.t > 2.2) d.visible = false
        }
      }
      // rocks in the way: hit, and they burst aside so you never drive through them
      const p = this.track.samples[s.i]!
      const near = Math.hypot(p.x - f.carPos.x, p.z - f.carPos.z) < 6.5
      if (s.state === 'down' && near && lat > s.lat0 - 1 && lat < s.lat1 + 1) {
        s.state = 'scatter'
        s.t = 0
        this.clean = false
        ev.hit(0.6)
        ev.toast('HIT THE ROCKS')
        ev.sfx('rockImpact')
        const tg = this.track.tangents[s.i]!
        for (const k of s.rocks) {
          k.m.visible = true
          k.m.position.copy(k.to)
          k.vel.copy(tg).multiplyScalar(f.carSpeed * 0.6 + 8)
          k.vel.y = 7 + this.rand() * 7
          k.vel.x += (this.rand() - 0.5) * 22
          k.vel.z += (this.rand() - 0.5) * 22
        }
      }
      if (s.state === 'scatter') {
        for (const k of s.rocks) {
          k.vel.y -= 26 * f.dt
          k.m.position.addScaledVector(k.vel, f.dt)
          k.m.rotation.x += f.dt * k.spin * 2
          if (k.m.position.y < p.y - 3) k.m.visible = false
        }
      }
    }
  }
}
