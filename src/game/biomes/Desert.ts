import * as THREE from 'three'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { photoSet } from '../Textures'
import {
  biomeGroup, fbm2, ridged2, smooth, lerp, rng, zoneIndices, rightAt, instanced, trs, lumpy,
  canvasTexture, ZoneDistance, roadSign, besideRoad, softDot, puffTexture,
} from './kit'

const BEST_TRAP_KEY = 'horizon-drive-speedtrap-mph'
/** The sandstorm's share of the desert road. */
export const STORM: [number, number] = [0.2, 0.85]
/** The rocket car runs on the salt, this far right of the road's centre. */
const ROCKET_LAT = 21
const GATE_R = 4
const STORM_COLOR = '#ffb347'

interface Gate { i: number; k: number; lat: number; ring: THREE.Mesh; beam: THREE.Sprite; hit: boolean }

interface Weed { m: THREE.Mesh; i: number; lat: number; speed: number; phase: number }

/** Rolling dunes and the white salt pan with its speed trap. */
export class Desert implements Biome {
  readonly name = 'desert'
  readonly group = biomeGroup('desert')
  private readonly rand = rng(31)
  private readonly desertIdx: number[]
  private readonly saltIdx: number[]
  private dDesert!: ZoneDistance
  private dSalt!: ZoneDistance
  private trapIdx = -1
  private trapCtx: CanvasRenderingContext2D | null = null
  private trapTex: THREE.CanvasTexture | null = null
  private bestTrap = 0
  private weeds: Weed[] = []
  private lastIdx = -1
  private heatHaze: THREE.Mesh | null = null
  private heightAt: (x: number, z: number) => number = () => 0
  private stormIds: number[] = []
  private readonly stormOrder = new Map<number, number>()
  private gates: Gate[] = []
  private inStorm = false
  private stormK = 0
  private gateHits = 0
  private nextGust = 3
  private gust = 0
  private gustSide = 1
  private sandGust: THREE.Sprite[] = []
  private rocket: THREE.Group | null = null
  private flame: THREE.Mesh | null = null
  private dust: THREE.Sprite[] = []
  private duel = false
  private rocketM = 0
  private rocketV = 0
  private lastSaltM = 0
  private readonly saltOrder = new Map<number, number>()
  private readonly saltCum: number[] = []

  constructor(private readonly track: Track) {
    this.desertIdx = zoneIndices(track, 'desert')
    this.saltIdx = zoneIndices(track, 'saltflat')
    try { this.bestTrap = Number(localStorage.getItem(BEST_TRAP_KEY)) || 0 } catch { /* storage blocked */ }
  }

  fields(): TerrainField[] {
    this.dDesert = new ZoneDistance(this.track, ['desert'], -1000, -1300, 1300, -40, 10)
    this.dSalt = new ZoneDistance(this.track, ['saltflat'], -1000, -1300, 1300, -40, 10)
    const dunes: TerrainField = {
      weight: (x, z) => (1 - smooth(230, 330, this.dDesert.at(x, z))) * 1.5,
      height: (x, z) => {
        // wind from the west-south-west: long crests with soft backs
        const wx = x + fbm2(x * 0.004, z * 0.004) * 120
        const crest = ridged2(wx * 0.0065, z * 0.012 + wx * 0.002, 4)
        return 3 + Math.pow(crest, 1.6) * 22 + fbm2(x * 0.02, z * 0.02) * 2
      },
      color: (x, z, h, slope, out) => {
        const n = fbm2(x * 0.03, z * 0.03)
        const lit = lerp(0.92, 1.04, n)
        out.setRGB(0.86 * lit, 0.68 * lit, 0.47 * lit)
        // darker coarse sand in the hollows
        const hollow = smooth(8, 3, h)
        out.lerp(new THREE.Color(0.7, 0.5, 0.34), hollow * 0.5)
        void slope
      },
      mask: (_x, _z, _h, out) => out.set(0, 1, 0, 0),
      surface: 0,
    }
    const salt: TerrainField = {
      weight: (x, z) => (1 - smooth(110, 210, this.dSalt.at(x, z))) * 3,
      height: (x, z) => 0.2 + fbm2(x * 0.05, z * 0.05) * 0.06,
      color: (x, z, _h, _s, out) => {
        const n = fbm2(x * 0.01, z * 0.01)
        out.setRGB(0.93 - n * 0.05, 0.92 - n * 0.05, 0.9 - n * 0.03)
      },
      mask: (_x, _z, _h, out) => out.set(0, 0, 0.25, 0),
    }
    return [dunes, salt]
  }

  build(ctx: BuildCtx): void {
    this.heightAt = (x, z) => ctx.terrain.heightAt(x, z)
    this.buildSaltCrust()
    this.buildCacti(ctx)
    this.buildScrub(ctx)
    this.buildArches(ctx)
    this.buildGasStation(ctx)
    this.buildPoles(ctx)
    this.buildSpeedTrap(ctx)
    this.buildRecordCamp(ctx)
    this.buildDunes(ctx)
    this.buildStorm()
    this.buildRocket()
  }

  /** Sand drifted across the road: hit one and it throws you into the air. */
  private buildDunes(ctx: BuildCtx): void {
    const t = this.track, n = this.desertIdx.length
    const sand = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#d8b27c'
      g.fillRect(0, 0, w, w)
      for (let k = 0; k < 7000; k++) {
        g.fillStyle = `rgba(${k % 2 ? '255,232,190' : '120,86,50'},${Math.random() * 0.16})`
        g.fillRect(Math.random() * w, Math.random() * w, 2, 2)
      }
    })
    sand.wrapS = sand.wrapT = THREE.RepeatWrapping
    const mat = new THREE.MeshStandardMaterial({ map: sand, roughness: 1 })
    const UP = 14, DOWN = 18, H = 2
    for (const fr of [0.07, 0.13, 0.9]) {
      const k0 = Math.floor(n * fr), i0 = this.desertIdx[k0]!
      const pos: number[] = [], uv: number[] = [], ind: number[] = []
      const COLS = 15
      let d = 0, row = 0
      for (let k = k0; d < UP + DOWN && k < n; k++) {
        const i = this.desertIdx[k]!, p = t.samples[i]!, r = rightAt(t, i)
        if (k > k0) d += p.distanceTo(t.samples[this.desertIdx[k - 1]!]!)
        const h = d < UP ? H * (d / UP) : H * Math.pow(Math.max(0, 1 - (d - UP) / DOWN), 2)
        for (let c = 0; c < COLS; c++) {
          const a = (c / (COLS - 1) - 0.5) * 30
          const edge = 1 - smooth(11, 15, Math.abs(a))
          pos.push(p.x + r.x * a, p.y + 0.04 + h * edge, p.z + r.z * a)
          uv.push(a / 8, d / 8)
        }
        if (row) for (let c = 0; c < COLS - 1; c++) { const b = row * COLS + c, q = b - COLS; ind.push(q, q + 1, b, q + 1, b + 1, b) }
        row++
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(ind)
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, mat)
      m.material.side = THREE.DoubleSide
      m.receiveShadow = true
      this.group.add(m)
      ctx.addKicker(i0, 15)
      this.group.add(besideRoad(t, this.desertIdx[Math.max(0, k0 - 50)]!, 14, roadSign(['DUNE JUMP', 'FLAT OUT'], '#f2c400', '#111')))
    }
  }

  /** Holographic rings that shine through the storm: thread them for nitro. */
  private buildStorm(): void {
    const n = this.desertIdx.length, t = this.track
    this.stormIds = this.desertIdx.slice(Math.floor(n * STORM[0]), Math.floor(n * STORM[1]))
    this.stormIds.forEach((i, k) => this.stormOrder.set(i, k))
    const ringGeo = new THREE.TorusGeometry(GATE_R, 0.14, 8, 40)
    const dot = softDot()
    const lanes = [-5, 0, 5, 0]
    const N = 10
    for (let q = 0; q < N; q++) {
      const k = Math.floor(((q + 0.7) / (N + 0.4)) * this.stormIds.length)
      const i = this.stormIds[k]!, p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!
      const lat = lanes[q % 4]!
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false, toneMapped: false, transparent: true }))
      ring.position.set(p.x + r.x * lat, p.y + GATE_R + 0.1, p.z + r.z * lat)
      ring.rotation.y = Math.atan2(tg.x, tg.z)
      const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffb347, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 }))
      beam.position.copy(ring.position).setY(p.y + 34)
      beam.scale.set(5, 70, 1)
      this.group.add(ring, beam)
      this.gates.push({ i, k, lat, ring, beam, hit: false })
    }
    const puff = puffTexture()
    for (let q = 0; q < 16; q++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xd9b080, transparent: true, depthWrite: false, opacity: 0 }))
      s.visible = false
      s.userData['ph'] = this.rand()
      s.userData['along'] = 6 + this.rand() * 55
      this.sandGust.push(s)
      this.group.add(s)
    }
  }

  private updateStorm(f: FrameCtx, ev: BiomeEvents): void {
    const t = this.track, k = this.stormOrder.get(f.carIdx)
    if (k === undefined) {
      if (!this.inStorm) return
      this.inStorm = false
      ev.loop('storm', 0)
      for (const s of this.sandGust) s.visible = false
      ev.danger(null, 0, STORM_COLOR)
      // out through the far end (not a restart)
      if (this.stormK < this.stormIds.length - 30) return
      const good = this.gateHits >= 6
      ev.toast(`STORM RUN  ${this.gateHits}/${this.gates.length} BEACONS${good ? '  NITRO FULL' : ''}`, good ? 'best' : 'info')
      if (good) ev.refill()
      return
    }
    if (!this.inStorm) {
      if (k > 12) return
      this.inStorm = true
      this.gateHits = 0
      this.nextGust = 2.5
      this.gust = 0
      for (const g of this.gates) {
        g.hit = false
        ;(g.ring.material as THREE.MeshBasicMaterial).color.set(0xffb347)
        ;(g.ring.material as THREE.MeshBasicMaterial).opacity = 1
        ;(g.beam.material as THREE.SpriteMaterial).color.set(0xffb347)
        g.beam.visible = true
      }
      this.stormK = k
      ev.toast('SANDSTORM  FOLLOW THE BEACONS')
    }
    const p = t.samples[f.carIdx]!, r = rightAt(t, f.carIdx)
    const lat = (f.carPos.x - p.x) * r.x + (f.carPos.z - p.z) * r.z
    for (const g of this.gates) {
      if (g.hit || g.k <= this.stormK || g.k > k) continue
      if (Math.abs(lat - g.lat) < GATE_R) {
        g.hit = true
        this.gateHits++
        ev.nitro(0.12)
        ev.sfx('ring', 1, this.gateHits * 1.5)
        ;(g.ring.material as THREE.MeshBasicMaterial).color.set(0x7dffa0)
        ;(g.beam.material as THREE.SpriteMaterial).color.set(0x7dffa0)
      } else {
        ;(g.ring.material as THREE.MeshBasicMaterial).opacity = 0.2
        g.beam.visible = false
      }
    }
    this.stormK = k
    ev.loop('storm', 1)
    ev.danger(`BEACONS  ${this.gateHits}/${this.gates.length}`, this.gateHits / this.gates.length, STORM_COLOR, true)

    // gusts shove you off your line
    this.nextGust -= f.dt
    if (this.nextGust <= 0) {
      this.nextGust = 3 + this.rand() * 1.5
      this.gust = 1.1
      this.gustSide = this.rand() < 0.5 ? -1 : 1
      ev.toast(this.gustSide > 0 ? 'GUST FROM THE LEFT' : 'GUST FROM THE RIGHT')
      ev.sfx('gust')
    }
    this.gust = Math.max(0, this.gust - f.dt)
    const on = this.gust > 0
    if (on) ev.push(r.x * this.gustSide * 4.5 * f.dt, r.z * this.gustSide * 4.5 * f.dt)
    const tg = t.tangents[f.carIdx]!
    for (const s of this.sandGust) {
      s.visible = on
      if (!on) continue
      const ph = ((s.userData['ph'] as number) + f.time * 1.3) % 1
      const a = s.userData['along'] as number, x = (ph - 0.5) * 70 * this.gustSide
      s.position.set(p.x + tg.x * a + r.x * x, p.y + 1.5 + ph * 4, p.z + tg.z * a + r.z * x)
      s.scale.setScalar(9 + ph * 6)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.55 * Math.sin(ph * Math.PI)
    }
  }

  /** The record car: races you down the pan, on the salt beside the road. */
  private buildRocket(): void {
    const t = this.track
    let d = 0
    this.saltIdx.forEach((i, k) => {
      if (k > 0) d += t.samples[i]!.distanceTo(t.samples[this.saltIdx[k - 1]!]!)
      this.saltCum.push(d)
      this.saltOrder.set(i, k)
    })
    const g = new THREE.Group()
    const paint = canvasTexture(512, 128, (c, w, h) => {
      c.fillStyle = '#f2f3f5'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#d8332a'
      c.fillRect(0, h * 0.42, w, h * 0.16)
    })
    const pts: THREE.Vector2[] = []
    for (let q = 0; q <= 24; q++) {
      const u = q / 24 // tail (0) to nose (1)
      pts.push(new THREE.Vector2(Math.max(0.02, 1.05 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.62 + 0.3)), 0.8) * (u > 0.75 ? 1 - Math.pow((u - 0.75) / 0.25, 2) : 1)), (u - 0.5) * 14))
    }
    const hullGeo = new THREE.LatheGeometry(pts, 24)
    hullGeo.rotateX(Math.PI / 2) // lathe axis onto +z, nose forward
    const hull = new THREE.Mesh(hullGeo, new THREE.MeshPhysicalMaterial({ map: paint, metalness: 0.3, roughness: 0.28, clearcoat: 1 }))
    hull.position.y = 1.5
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10), new THREE.MeshPhysicalMaterial({ color: 0x10161d, roughness: 0.08, metalness: 0.5 }))
    glass.scale.set(0.9, 0.75, 2.2)
    glass.position.set(0, 2.25, 2.4)
    const red = new THREE.MeshStandardMaterial({ color: 0xd8332a, roughness: 0.4 })
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.8, 3), red)
    fin.position.set(0, 3.2, -5.2)
    fin.rotation.x = 0.35
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1.6), red)
    wing.position.set(0, 1.4, -5.4)
    const tyre = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 })
    const wheels = [[-1.5, 3.8], [1.5, 3.8], [-1.5, -3.8], [1.5, -3.8]].map(([x, z]) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.34, 20), tyre)
      w.rotation.z = Math.PI / 2
      w.position.set(x!, 0.72, z!)
      return w
    })
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.42, 1, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x32363b, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }))
    nozzle.rotation.x = Math.PI / 2
    nozzle.position.set(0, 1.5, -7.2)
    const flameGeo = new THREE.ConeGeometry(0.55, 7, 14, 1, true)
    flameGeo.translate(0, 3.5, 0)
    flameGeo.rotateX(-Math.PI / 2) // wide at the nozzle, tapering out behind
    this.flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.5, 0.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))
    this.flame.position.set(0, 1.5, -7.5)
    this.flame.visible = false
    g.add(hull, glass, fin, wing, nozzle, this.flame, ...wheels)
    g.traverse((o) => { o.castShadow = o !== this.flame })
    this.rocket = g
    this.group.add(g)
    const puff = puffTexture()
    for (let q = 0; q < 14; q++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xf2efe8, transparent: true, depthWrite: false, opacity: 0 }))
      s.visible = false
      s.userData['ph'] = q / 14
      this.dust.push(s)
      this.group.add(s)
    }
    this.placeRocket(80)
  }

  private placeRocket(m: number): void {
    const t = this.track, cum = this.saltCum
    let a = 0, b = cum.length - 1
    while (a < b) { const c = (a + b + 1) >> 1; if (cum[c]! <= m) a = c; else b = c - 1 }
    const i = this.saltIdx[a]!, p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!
    const x = p.x + r.x * ROCKET_LAT, z = p.z + r.z * ROCKET_LAT
    this.rocket!.position.set(x, this.heightAt(x, z) + 0.35, z)
    this.rocket!.rotation.y = Math.atan2(tg.x, tg.z)
  }

  private updateDuel(f: FrameCtx, ev: BiomeEvents): void {
    if (!this.rocket) return
    const k = this.saltOrder.get(f.carIdx)
    const color = '#ffd24a'
    if (k === undefined) {
      if (!this.duel) return
      this.duel = false
      ev.loop('rocket', 0)
      this.flame!.visible = false
      for (const s of this.dust) s.visible = false
      ev.danger(null, 0, color)
      const end = this.saltCum[this.saltCum.length - 1]!
      const lead = this.rocketM - end
      this.placeRocket(80)
      if (this.lastSaltM < end - 40) return
      if (lead < 0) { ev.toast(`BEAT THE ROCKET  BY ${Math.round(-lead)} M  NITRO FULL`, 'best'); ev.refill(); ev.sfx('sting') }
      else { ev.toast(`ROCKET WINS  BY ${Math.round(lead)} M`); ev.sfx('fail') }
      return
    }
    const car = this.saltCum[k]!
    this.lastSaltM = car
    if (!this.duel) {
      if (k > 12) return
      this.duel = true
      this.rocketM = car + 80
      this.rocketV = 0
      this.flame!.visible = true
      ev.toast('ROCKET DUEL  USE YOUR NITRO')
      ev.sfx('rocketLaunch')
    }
    this.rocketV = Math.min(68, this.rocketV + 50 * f.dt)
    this.rocketM += this.rocketV * f.dt
    this.placeRocket(this.rocketM)
    const lead = this.rocketM - car
    const n = Math.abs(Math.round(lead))
    ev.loop('rocket', Math.max(0.2, 1 - Math.abs(lead) / 130))
    ev.danger(lead > 0 ? `ROCKET AHEAD  ${n} M` : `YOU LEAD  ${n} M`, Math.max(0, Math.min(1, 0.5 - lead / 80)), color, true)
    this.flame!.scale.set(1 + Math.sin(f.time * 50) * 0.15, 1 + Math.sin(f.time * 50) * 0.15, 1 + Math.sin(f.time * 37) * 0.25)
    const rp = this.rocket.position, tg = this.track.tangents[this.saltIdx[Math.min(k, this.saltIdx.length - 1)]!]!
    for (const s of this.dust) {
      const ph = ((s.userData['ph'] as number) + f.time * 1.6) % 1
      s.visible = true
      s.position.set(rp.x - tg.x * (7 + ph * 42), rp.y + 0.8 + ph * 5, rp.z - tg.z * (7 + ph * 42))
      s.scale.setScalar(3 + ph * 13)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - ph)
    }
  }

  /** Polygonal salt crust (cracked hexagon plates) laid over the pan. */
  private buildSaltCrust(): void {
    const tex = photoSet('mud_cracked_dry_03').map
    void canvasTexture(4, 4, (g, w) => {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, w, w)
      g.strokeStyle = 'rgba(150,140,125,0.85)'
      g.lineWidth = 3
      const cells = 9
      const s = w / cells
      for (let j = -1; j <= cells + 1; j++) {
        for (let i = -1; i <= cells + 1; i++) {
          const cx = (i + (j % 2) * 0.5) * s + (Math.random() - 0.5) * s * 0.2
          const cy = j * s * 0.87 + (Math.random() - 0.5) * s * 0.2
          g.beginPath()
          for (let k = 0; k <= 6; k++) {
            const a = (k / 6) * Math.PI * 2 + Math.PI / 6
            const r = s * (0.55 + (Math.random() - 0.5) * 0.12)
            const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
            if (k === 0) g.moveTo(x, y); else g.lineTo(x, y)
          }
          g.stroke()
        }
      }
    })
    tex.repeat.set(110, 40)
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0xffffff, emissive: 0x55534e, emissiveMap: tex, roughness: 0.42, metalness: 0,
      transparent: true, opacity: 0.85, depthWrite: false,
    })
    // fade the crust out toward the pan's edge
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSaltUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSaltUv = uv;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSaltUv;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nvec2 sd = abs(vSaltUv - 0.5) * 2.0;\ndiffuseColor.a *= (1.0 - smoothstep(0.7, 1.0, sd.x)) * (1.0 - smoothstep(0.55, 1.0, sd.y));')
    }
    const a = this.track.samples[this.saltIdx[0]!]!, b = this.track.samples[this.saltIdx[this.saltIdx.length - 1]!]!
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 380
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, 300), mat)
    plane.rotation.x = -Math.PI / 2
    plane.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x)
    plane.position.set((a.x + b.x) / 2, 0.5, (a.z + b.z) / 2)
    plane.receiveShadow = true
    plane.renderOrder = -1
    this.group.add(plane)
    // shimmering heat haze band low over the far pan (mirage)
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(len, 4), new THREE.MeshBasicMaterial({
      color: 0xdfe8f2, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
    }))
    haze.position.set((a.x + b.x) / 2, 1.8, (a.z + b.z) / 2 - 90)
    haze.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x)
    this.heatHaze = haze
    this.group.add(haze)
  }

  /** Saguaro cacti (trunk + up-curved arms) and squat barrel cacti. */
  private buildCacti(ctx: BuildCtx): void {
    const t = ctx.terrain
    const skin = new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.75 })
    const ribbed = (r: number, h: number) => {
      const g = new THREE.CylinderGeometry(r, r * 1.05, h, 12, 4)
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), z = pos.getZ(k)
        const a = Math.atan2(z, x)
        const f = 1 + 0.07 * Math.cos(a * 12)
        pos.setX(k, x * f); pos.setZ(k, z * f)
      }
      g.computeVertexNormals()
      g.translate(0, h / 2, 0)
      return g
    }
    const trunk = ribbed(0.35, 1)
    const cap = new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    const trunks: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = [], armsH: THREE.Matrix4[] = [], armsV: THREE.Matrix4[] = [], armCaps: THREE.Matrix4[] = []
    const barrels: THREE.Matrix4[] = []
    const ids = [...this.desertIdx, ...this.desertIdx]
    for (let k = 0; k < 1200 && trunks.length < 170; k++) {
      const i = ids[Math.floor(this.rand() * ids.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (16 + this.rand() * 130)
      const x = p.x + r.x * off + (this.rand() - 0.5) * 30, z = p.z + r.z * off + (this.rand() - 0.5) * 30
      if (ctx.road.near(x, z, 14)) continue
      const y = t.heightAt(x, z)
      if (y < 0.5) continue
      if (this.rand() < 0.35) {
        const s = 0.6 + this.rand() * 0.7
        barrels.push(trs(x, y - 0.1, z, this.rand() * 6, new THREE.Vector3(s * 1.4, s * 0.9, s * 1.4)))
        continue
      }
      const h = 4 + this.rand() * 6
      const yaw = this.rand() * 6
      trunks.push(trs(x, y - 0.3, z, yaw, new THREE.Vector3(1, h, 1)))
      caps.push(trs(x, y - 0.3 + h, z, yaw))
      const arms = Math.floor(this.rand() * 3)
      for (let a = 0; a < arms; a++) {
        const ay = y + h * (0.35 + this.rand() * 0.3)
        const dir = yaw + a * Math.PI + (this.rand() - 0.5) * 0.6
        const len = 0.9 + this.rand() * 0.5
        const dx = Math.sin(dir), dz = Math.cos(dir)
        armsH.push(trs(x + dx * 0.2, ay, z + dz * 0.2, dir, new THREE.Vector3(0.7, len, 0.7), Math.PI / 2, 0))
        const up = 1.4 + this.rand() * 2
        const ax = x + dx * (len + 0.1), az = z + dz * (len + 0.1)
        armsV.push(trs(ax, ay - 0.2, az, dir, new THREE.Vector3(0.7, up, 0.7)))
        armCaps.push(trs(ax, ay - 0.2 + up, az, dir, 0.7))
      }
    }
    const barrelGeo = ribbed(0.5, 1)
    this.group.add(
      instanced(trunk, skin, trunks), instanced(cap, skin, caps), instanced(trunk, skin, armsH),
      instanced(trunk, skin, armsV), instanced(cap, skin, armCaps),
      instanced(barrelGeo, new THREE.MeshStandardMaterial({ color: 0x5b6e34, roughness: 0.8 }), barrels),
    )
  }

  /** Dry scrub, rocks and bleached grass tufts. */
  private buildScrub(ctx: BuildCtx): void {
    const t = ctx.terrain
    const bush = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.3, 1.6, 2)
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x6d6440, roughness: 1, flatShading: true })
    const rock = lumpy(new THREE.DodecahedronGeometry(1, 1), 0.25, 0.9, 4)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a7354, roughness: 0.95, flatShading: true })
    const bushes: THREE.Matrix4[] = [], rocks: THREE.Matrix4[] = []
    const ids = [...this.desertIdx, ...this.saltIdx.slice(0, 40)]
    for (let k = 0; k < 2500; k++) {
      const i = ids[Math.floor(this.rand() * ids.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (14 + this.rand() * 160)
      const x = p.x + r.x * off + (this.rand() - 0.5) * 20, z = p.z + r.z * off + (this.rand() - 0.5) * 20
      if (ctx.road.near(x, z, 13)) continue
      const y = t.heightAt(x, z)
      if (y < 0.5) continue
      if (this.rand() < 0.7) {
        const s = 0.4 + this.rand() * 0.9
        bushes.push(trs(x, y + s * 0.2, z, this.rand() * 6, new THREE.Vector3(s, s * 0.6, s)))
      } else {
        const s = 0.4 + Math.pow(this.rand(), 2) * 3
        rocks.push(trs(x, y + s * 0.15, z, this.rand() * 6, new THREE.Vector3(s, s * 0.6, s * 0.8)))
      }
    }
    this.group.add(instanced(bush, bushMat, bushes), instanced(rock, rockMat, rocks))
  }

  /** Two sandstone arches; the first spans the road. */
  private buildArches(ctx: BuildCtx): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8643c, roughness: 0.95, flatShading: true })
    const banded = canvasTexture(64, 256, (g, w, h) => {
      for (let y = 0; y < h; y += 4) {
        const v = 150 + Math.sin(y * 0.15) * 30 + Math.random() * 20
        g.fillStyle = `rgb(${v + 40},${v - 20},${v - 60})`
        g.fillRect(0, y, w, 4)
      }
    })
    mat.map = banded
    const spots: [number, number][] = [[0.42, 0], [0.75, 70]]
    for (const [f, off] of spots) {
      const i = this.desertIdx[Math.floor(this.desertIdx.length * f)]!
      const p = this.track.samples[i]!, tg = this.track.tangents[i]!, r = rightAt(this.track, i)
      const span = off === 0 ? 17 : 12
      const arch = new THREE.Mesh(lumpy(new THREE.TorusGeometry(span, 3.4, 10, 28, Math.PI), 1.3, 0.18, f * 10), mat)
      const cx = p.x + r.x * off, cz = p.z + r.z * off
      const y = off === 0 ? p.y - 1 : ctx.terrain.heightAt(cx, cz) - 1
      arch.position.set(cx, y, cz)
      // the arch plane is across the road: its axis follows the road direction
      arch.rotation.y = Math.atan2(-tg.x, -tg.z)
      arch.scale.set(1, off === 0 ? 1.15 : 1.4, 1)
      arch.castShadow = true
      arch.receiveShadow = true
      this.group.add(arch)
      // rubble feet
      for (const s of [-1, 1]) {
        const foot = new THREE.Mesh(lumpy(new THREE.DodecahedronGeometry(4.5, 1), 1.2, 0.3, s + f), mat)
        foot.position.set(cx + r.x * s * span, y + 1, cz + r.z * s * span)
        foot.castShadow = true
        this.group.add(foot)
      }
    }
  }

  /** An abandoned roadside gas station with a faded sign and a rusted car. */
  private buildGasStation(ctx: BuildCtx): void {
    const i = this.desertIdx[Math.floor(this.desertIdx.length * 0.72)]!
    const p = this.track.samples[i]!, tg = this.track.tangents[i]!, r = rightAt(this.track, i)
    const g = new THREE.Group()
    const off = 34
    g.position.set(p.x + r.x * off, ctx.terrain.heightAt(p.x + r.x * off, p.z + r.z * off), p.z + r.z * off)
    g.rotation.y = Math.atan2(-tg.x, -tg.z)
    const paint = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.9 })
    const rust = new THREE.MeshStandardMaterial({ color: 0x7a3e1f, roughness: 0.85, metalness: 0.3 })
    const red = new THREE.MeshStandardMaterial({ color: 0x9c2b22, roughness: 0.8 })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 1 }))
    slab.position.y = 0.15
    const shop = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 7), paint)
    shop.position.set(6, 2.1, 3)
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(12, 0.7, 8), red)
    canopy.position.set(-5, 5.2, -2)
    canopy.rotation.z = 0.04
    const cols: THREE.Mesh[] = []
    for (const [x, z] of [[-10, -5], [0, -5], [-10, 1], [0, 1]] as const) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 0.35), paint)
      c.position.set(x, 2.5, z)
      cols.push(c)
    }
    const pumps: THREE.Mesh[] = []
    for (const x of [-7, -3]) {
      const pm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.6), red)
      pm.position.set(x, 1.15, -2)
      pumps.push(pm)
    }
    const signTex = canvasTexture(256, 256, (c, w) => {
      c.fillStyle = '#b8291e'; c.fillRect(0, 0, w, w)
      c.fillStyle = '#f1e2c2'; c.font = '700 120px Rajdhani, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText('GAS', w / 2, w * 0.42)
      c.font = '600 44px Rajdhani, Arial'; c.fillText('LAST STOP', w / 2, w * 0.75)
      // sun-fade and rust streaks
      for (let k = 0; k < 400; k++) { c.fillStyle = `rgba(240,220,190,${Math.random() * 0.15})`; c.fillRect(Math.random() * w, Math.random() * w, 6, 3) }
      for (let k = 0; k < 12; k++) { c.fillStyle = 'rgba(90,40,15,0.35)'; c.fillRect(Math.random() * w, Math.random() * w * 0.5, 3, 40 + Math.random() * 80) }
    })
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.3), [paint, paint, paint, paint, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }), paint])
    sign.position.set(-13, 8, -7)
    sign.rotation.z = 0.08
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7, 8), rust)
    pole.position.set(-13, 3.5, -7.2)
    // a rusted-out pickup on its rims
    const car = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), rust)
    body.position.y = 0.8
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.8), rust)
    cab.position.set(0, 1.7, 0.6)
    car.add(body, cab)
    car.position.set(9, 0.1, -6)
    car.rotation.set(0.04, 0.6, -0.06)
    g.add(slab, shop, canopy, ...cols, ...pumps, sign, pole, car)
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
    this.group.add(g)
  }

  /** Leaning timber telegraph poles with sagging wires along the dunes. */
  private buildPoles(ctx: BuildCtx): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 })
    const pole = new THREE.CylinderGeometry(0.14, 0.18, 8, 6)
    pole.translate(0, 4, 0)
    const bar = new THREE.BoxGeometry(2, 0.14, 0.14)
    const poles: THREE.Matrix4[] = [], bars: THREE.Matrix4[] = []
    const tops: THREE.Vector3[] = []
    const ids = [...this.desertIdx, ...this.saltIdx]
    for (let k = 0; k < ids.length; k += 14) {
      const i = ids[k]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const x = p.x - r.x * 19, z = p.z - r.z * 19
      const y = ctx.terrain.heightAt(x, z)
      const lean = (this.rand() - 0.5) * 0.08
      const yaw = Math.atan2(r.x, r.z)
      poles.push(trs(x, y - 0.4, z, yaw, 1, lean, 0))
      bars.push(trs(x, y + 7.2, z, yaw + Math.PI / 2, 1))
      tops.push(new THREE.Vector3(x, y + 7.3, z))
    }
    this.group.add(instanced(pole, wood, poles), instanced(bar, wood, bars))
    // sagging wires between pole tops
    const pts: number[] = []
    for (let k = 1; k < tops.length; k++) {
      const a = tops[k - 1]!, b = tops[k]!
      if (a.distanceTo(b) > 90) continue
      for (let s = 0; s < 10; s++) {
        const u0 = s / 10, u1 = (s + 1) / 10
        const sag = (u: number) => -Math.sin(u * Math.PI) * 1.4
        pts.push(lerp(a.x, b.x, u0), lerp(a.y, b.y, u0) + sag(u0), lerp(a.z, b.z, u0), lerp(a.x, b.x, u1), lerp(a.y, b.y, u1) + sag(u1), lerp(a.z, b.z, u1))
      }
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222222 })))
  }

  /** Overhead gantry with radar heads and a live speed board. */
  private buildSpeedTrap(ctx: BuildCtx): void {
    this.trapIdx = this.saltIdx[Math.floor(this.saltIdx.length * 0.62)]!
    const i = this.trapIdx
    const p = this.track.samples[i]!, tg = this.track.tangents[i]!, r = rightAt(this.track, i)
    const g = new THREE.Group()
    g.position.copy(p)
    g.rotation.y = Math.atan2(-tg.x, -tg.z)
    const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.8, roughness: 0.35 })
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), steel)
      leg.position.set(s * 13, 4.5, 0)
      g.add(leg)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(27, 1.2, 1.2), steel)
    beam.position.y = 9
    g.add(beam)
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 256
    this.trapCtx = c.getContext('2d')!
    this.trapTex = new THREE.CanvasTexture(c)
    this.trapTex.colorSpace = THREE.SRGBColorSpace
    this.drawTrap(0)
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshStandardMaterial({
      map: this.trapTex, emissiveMap: this.trapTex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.5,
    }))
    board.position.set(0, 11.6, 0.65)
    const back = new THREE.Mesh(new THREE.BoxGeometry(14.4, 3.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 }))
    back.position.set(0, 11.6, 0.35)
    g.add(back, board)
    for (const x of [-6, 6]) {
      const cam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 1.2), new THREE.MeshStandardMaterial({ color: 0x222222 }))
      cam.position.set(x, 8.1, 0.5)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2020, emissiveIntensity: 1.2 }))
      lens.position.set(x, 8.1, 1.11)
      g.add(cam, lens)
    }
    g.traverse((o) => { o.castShadow = true })
    this.group.add(g)
    // quarter-mile boards counting down to the trap
    for (const [f, label] of [[0.12, '3/4 MI'], [0.3, '1/2 MI'], [0.46, '1/4 MI']] as const) {
      const k = this.saltIdx[Math.floor(this.saltIdx.length * f)]!
      this.group.add(besideRoad(this.track, k, 14.5, roadSign(['SPEED TRAP', label], '#103a7a', '#ffffff', 3.4, 1.7)))
    }
    void ctx
    void r
  }

  private drawTrap(mph: number): void {
    const g = this.trapCtx!
    const W = 1024, H = 256
    g.fillStyle = '#05070a'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#ffb21a'
    g.textBaseline = 'middle'
    g.font = '700 70px Rajdhani, Arial'
    g.textAlign = 'left'
    g.fillText('SPEED TRAP', 40, 78)
    g.font = '600 46px Rajdhani, Arial'
    g.fillStyle = '#7fd7ff'
    g.fillText(`BEST ${Math.round(this.bestTrap)} MPH`, 40, 180)
    g.textAlign = 'right'
    g.fillStyle = mph > 0 ? '#ffffff' : '#555'
    g.font = 'italic 700 170px Rajdhani, Arial'
    g.fillText(mph > 0 ? `${Math.round(mph)}` : '---', W - 190, 136)
    g.font = '700 54px Rajdhani, Arial'
    g.fillStyle = '#ffb21a'
    g.fillText('MPH', W - 40, 160)
    if (this.trapTex) this.trapTex.needsUpdate = true
  }

  /** A land-speed-record camp beside the pan: tents, trailers, flags. */
  private buildRecordCamp(ctx: BuildCtx): void {
    const i = this.saltIdx[Math.floor(this.saltIdx.length * 0.5)]!
    const p = this.track.samples[i]!, r = rightAt(this.track, i), tg = this.track.tangents[i]!
    const base = new THREE.Vector3(p.x - r.x * 60, 0.35, p.z - r.z * 60)
    const yaw = Math.atan2(-tg.x, -tg.z)
    const tentMat = [0xf2f2f2, 0xd8332a, 0x2a5bd8]
    for (let k = 0; k < 5; k++) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(4, 4, 4), new THREE.MeshStandardMaterial({ color: tentMat[k % 3], roughness: 0.8 }))
      tent.position.copy(base).add(new THREE.Vector3(tg.x * (k - 2) * 12, 2, tg.z * (k - 2) * 12))
      tent.rotation.y = Math.PI / 4 + yaw
      tent.castShadow = true
      this.group.add(tent)
    }
    // the streamliner on its trailer
    const sl = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 9, 6, 16), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0.4, roughness: 0.25 }))
    hull.rotation.x = Math.PI / 2
    hull.position.y = 2
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 2.2), new THREE.MeshStandardMaterial({ color: 0xd8332a }))
    fin.position.set(0, 3.2, 4)
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 11), new THREE.MeshStandardMaterial({ color: 0x333333 }))
    trailer.position.y = 0.9
    sl.add(hull, fin, trailer)
    sl.position.copy(base).addScaledVector(r, 18)
    sl.rotation.y = yaw
    sl.traverse((o) => { o.castShadow = true })
    this.group.add(sl)
    // checkered flags on poles at the trap line
    const flagTex = canvasTexture(64, 48, (c, w, h) => {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * w / 8, y * h / 6, w / 8, h / 6) }
    })
    for (const s of [-1, 1]) {
      const k = this.trapIdx
      const q = this.track.samples[k]!, rr = rightAt(this.track, k)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd }))
      pole.position.set(q.x + rr.x * s * 17, 3.3, q.z + rr.z * s * 17)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }))
      flag.position.set(pole.position.x, 5.6, pole.position.z)
      flag.position.add(new THREE.Vector3(tg.x * 0.9, 0, tg.z * 0.9))
      flag.rotation.y = Math.atan2(tg.x, tg.z) + Math.PI / 2
      this.group.add(pole, flag)
    }
    void ctx
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    if (this.heatHaze) (this.heatHaze.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(f.time * 1.7)
    // speed trap: crossed the gantry this frame?
    if (this.trapIdx >= 0 && this.lastIdx >= 0) {
      const n = this.track.sampleCount
      const a = (this.trapIdx - this.lastIdx + n) % n
      const b = (f.carIdx - this.lastIdx + n) % n
      if (a > 0 && a <= b && b < 80) {
        const mph = f.carSpeed * 2.237
        const best = mph > this.bestTrap
        if (best) {
          this.bestTrap = mph
          try { localStorage.setItem(BEST_TRAP_KEY, String(Math.round(mph))) } catch { /* storage blocked */ }
        }
        this.drawTrap(mph)
        ev.toast(`SPEED TRAP  ${Math.round(mph)} MPH${best ? '  NEW BEST' : ''}`, best ? 'best' : 'info')
      }
    }
    this.lastIdx = f.carIdx
    this.updateStorm(f, ev)
    this.updateDuel(f, ev)
    if (!this.group.visible) return
    // tumbleweeds bounce across the road, then respawn further on
    for (const w of this.weeds) {
      w.lat += w.speed * f.dt
      if (w.lat > 40) {
        w.lat = -40
        w.i = this.desertIdx[Math.floor(this.rand() * this.desertIdx.length)]!
      }
      const p = this.track.samples[w.i]!, r = rightAt(this.track, w.i)
      const bounce = Math.abs(Math.sin(f.time * 3 + w.phase)) * 1.4
      const x = p.x + r.x * w.lat, z = p.z + r.z * w.lat
      const gy = Math.abs(w.lat) < 11 ? p.y : Math.max(p.y - 1, this.heightAt(x, z))
      w.m.position.set(x, gy + 0.8 + bounce, z)
      w.m.rotation.x += f.dt * w.speed * 0.9
      w.m.rotation.z += f.dt * 0.5
    }
  }
}
