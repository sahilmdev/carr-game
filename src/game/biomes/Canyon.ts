import * as THREE from 'three'
import { props } from './Props'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { rockSet, tiled } from '../Textures'
import { biomeGroup, fbm2, lumpy, rng, zoneIndices, rightAt, canvasTexture, puffTexture, roadSign, besideRoad, smooth } from './kit'


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
 * it two boost strips and more falling rock to weave through at speed.
 */
export class Canyon implements Biome {
  readonly name = 'canyon'
  readonly group = biomeGroup('canyon')
  private readonly rand = rng(141)
  private before: number[] = []
  private after: number[] = []
  private slides: Slide[] = []

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
    this.useScannedRock()
  }

  /** Swap the stand-in rocks for a real scanned boulder as soon as it loads. */
  private useScannedRock(): void {
    void props.load('namaqualand_boulder_05').then((parts) => {
      const part = parts?.[0]
      if (!part) return
      const geo = part.geometry.clone()
      geo.computeBoundingBox()
      const box = geo.boundingBox!, c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      geo.translate(-c.x, -c.y, -c.z)
      const k = 2.2 / Math.max(size.x, size.y, size.z)
      geo.scale(k, k, k)
      const mat = (part.material as THREE.MeshStandardMaterial).clone()
      mat.color.multiply(new THREE.Color(1.15, 0.72, 0.56)) // canyon sandstone
      for (const s of this.slides) for (const r of s.rocks) {
        r.m.geometry = geo
        r.m.material = mat
        r.m.rotation.set(this.rand() * 6, this.rand() * 6, this.rand() * 6)
      }
    })
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

  /** The boost strips and the rockfalls after the loop. */
  private buildSplit(ctx: BuildCtx): void {
    const t = this.track, a = this.after, n = a.length
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
    // a slalom: rocks on one side of the road, then the other
    this.addSlide(a[Math.floor(n * 0.4)]!, 5.4, 10, null)
    this.addSlide(a[Math.floor(n * 0.7)]!, -5.4, 8, null)
  }

  private latAt(f: FrameCtx): number {
    const p = this.track.samples[f.carIdx]!, r = rightAt(this.track, f.carIdx)
    return (f.carPos.x - p.x) * r.x + (f.carPos.z - p.z) * r.z
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
