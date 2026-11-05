import * as THREE from 'three'
import { LANDMARKS } from '../trackData'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField, RoadMode } from './Terrain'
import type { Track } from '../Track'
import {
  biomeGroup, fbm2, ridged2, smooth, lerp, rng, zoneIndices, rightAt, instanced, trs, lumpy,
  softDot, puffTexture, roadSign, besideRoad, canvasTexture, RoadIndex } from './kit'
import { lavaMaterial } from './Lava'
import { Chase } from './Chase'

const V = LANDMARKS.volcano
const RIM = 135
const RIM_H = 58
const FLOOR = 16
const LAKE_R = 56
/** Lava channel from the lake to the crater wall, crossed by a bridge. */
const CH_ANG = Math.atan2(-45, -60)
/** Lava rivers spilling over the rim and down the flank. */
const RIVER_ANGS = [2.6, -2.9, 1.75]

interface Bomb {
  mesh: THREE.Mesh
  marker: THREE.Mesh
  from: THREE.Vector3
  to: THREE.Vector3
  t: number
  T: number
  H: number
  live: boolean
}
interface Burst { flash: THREE.Sprite; scorch: THREE.Mesh; smoke: THREE.Sprite[]; age: number; live: boolean }

/** How far the lava tube pokes out of the rock at each mouth (samples). */
const MOUTH = 18

export class Volcano implements Biome {
  readonly name = 'volcano'
  readonly group = biomeGroup('volcano')
  /** Lights live outside the culled biome group (see Biomes.lights). */
  readonly lights = new THREE.Group()
  private readonly lavaShaders: { uniforms: Record<string, THREE.IUniform> }[] = []
  private tunnelIdx = new Set<number>()
  private bridgeIdx = new Set<number>()
  private idx: number[] = []
  private readonly bombs: Bomb[] = []
  private readonly bursts: Burst[] = []
  private nextBomb = 2
  private plume: THREE.Sprite[] = []
  private vents: THREE.Sprite[] = []
  private glow!: THREE.PointLight
  private beacon: THREE.Mesh | null = null
  private readonly rand = rng(77)
  private chase: Chase | null = null
  private lavaRoad: THREE.Mesh | null = null
  private cracks: THREE.Mesh[] = []
  private spray: THREE.Sprite[] = []
  private geysers: THREE.Sprite[] = []
  /** 0–1: the car cooks near lava. At 1 the engine melts and the run is lost. */
  private heat = 0
  /** Half the road turns to lava ahead of you, always on alternating sides. */
  private breaches: { k0: number; k1: number; side: number; mesh: THREE.Mesh; open: boolean }[] = []
  private blast: THREE.Sprite[] = []
  private blastT = -1
  private onLava = false
  private readonly kickerIds: number[] = []

  constructor(private readonly track: Track) {
    this.idx = zoneIndices(track, 'volcano')
    // The lava tube: exit-side samples that pass through the crater wall
    const n = this.idx.length
    this.idx.forEach((i, k) => {
      const p = track.samples[i]!
      const r = Math.hypot(p.x - V.x, p.z - V.z)
      if (k > n * 0.35 && r > 100 && r < 178) this.tunnelIdx.add(i)
      if (this.channelDist(p.x, p.z) < 16 && r < 120) this.bridgeIdx.add(i)
    })
  }

  /** Perpendicular distance to the lava channel (inf when off its length). */
  private channelDist(x: number, z: number): number {
    const dx = x - V.x, dz = z - V.z
    const along = dx * Math.cos(CH_ANG) + dz * Math.sin(CH_ANG)
    if (along < LAKE_R - 8 || along > 112) return 1e9
    return Math.abs(-dx * Math.sin(CH_ANG) + dz * Math.cos(CH_ANG))
  }

  private riverDist(x: number, z: number): number {
    const dx = x - V.x, dz = z - V.z
    const r = Math.hypot(dx, dz)
    if (r < RIM - 8 || r > 335) return 1e9
    let best = 1e9
    for (const a0 of RIVER_ANGS) {
      const a = a0 + 0.09 * Math.sin(r * 0.03 + a0 * 3)
      const ax = Math.cos(a), az = Math.sin(a)
      best = Math.min(best, Math.abs(-dx * az + dz * ax))
    }
    return best
  }

  fields(): TerrainField[] {
    const heightAt = (x: number, z: number): number => {
      const dx = x - V.x, dz = z - V.z
      const r = Math.hypot(dx, dz)
      const ang = Math.atan2(dz, dx)
      const rimN = (fbm2(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3) - 0.5) * 8
      let h: number
      if (r < RIM) {
        const t = smooth(84, RIM, r)
        h = lerp(FLOOR + (fbm2(x * 0.03, z * 0.03) - 0.5) * 2, RIM_H + rimN, Math.pow(t, 2.2))
        if (r < LAKE_R + 6) h = lerp(11.5, h, smooth(LAKE_R - 10, LAKE_R + 6, r))
        const cd = this.channelDist(x, z)
        if (cd < 12) h = lerp(12, h, smooth(5, 12, cd))
      } else {
        const t = (r - RIM) / 290
        const flank = (RIM_H + rimN) * Math.pow(Math.max(0, 1 - t), 1.4)
        const gully = ridged2(x * 0.018, z * 0.018, 4) * 6 * smooth(RIM, RIM + 40, r) * Math.max(0, 1 - t)
        h = flank + gully + 1.2 + fbm2(x * 0.01, z * 0.01) * 2
        const rd = this.riverDist(x, z)
        if (rd < 9) h -= 1.6 * smooth(9, 3, rd)
      }
      return h
    }
    const field: TerrainField = {
      weight: (x, z) => 1 - smooth(330, 420, Math.hypot(x - V.x, z - V.z)),
      height: heightAt,
      color: (x, z, h, slope, out) => {
        const r = Math.hypot(x - V.x, z - V.z)
        const n = fbm2(x * 0.02, z * 0.02)
        const basalt = [0.14, 0.13, 0.125], ash = [0.33, 0.31, 0.3], oxide = [0.42, 0.2, 0.12]
        const a = smooth(0.45, 0.75, n) * (r > RIM ? 0.8 : 0.3) * (1 - smooth(0.5, 1.0, slope))
        let c = basalt.map((v, k) => lerp(v, ash[k]!, a))
        const ox = smooth(100, 60, r) * 0.7 + smooth(10, 3, this.riverDist(x, z)) * 0.5
        c = c.map((v, k) => lerp(v, oxide[k]!, Math.min(1, ox)))
        // sulphur stains near the rim
        const s = smooth(0.7, 0.85, fbm2(x * 0.05 + 7, z * 0.05)) * smooth(RIM - 30, RIM, r) * smooth(RIM + 40, RIM, r)
        out.setRGB(lerp(c[0]!, 0.75, s * 0.6), lerp(c[1]!, 0.68, s * 0.6), lerp(c[2]!, 0.3, s * 0.6))
        void h
      },
      mask: (x, z, _h, out) => {
        const r = Math.hypot(x - V.x, z - V.z)
        const glow = smooth(98, 62, r) * 0.9 + smooth(9, 2, this.riverDist(x, z)) * 0.8 + (r > RIM ? 0.12 : 0) * smooth(380, 200, r)
        out.set(Math.min(1, glow), 0, 0, 0)
      },
      surface: 2,
    }
    return [field]
  }

  /** The tube's samples, with a stretch sticking out of each mouth. */
  private tubeRun(): number[] {
    const ids = [...this.tunnelIdx].sort((a, b) => a - b)
    if (ids.length < 4) return []
    const n = this.track.sampleCount
    const out: number[] = []
    for (let i = ids[0]! - MOUTH; i <= ids[ids.length - 1]! + MOUTH; i++) out.push((i + n) % n)
    return out
  }

  /** Top of the tube at a point (the terrain opens below it), or null. */
  boreCrown(x: number, z: number): number | null {
    if (!this.bores) {
      this.bores = new Set(this.tubeRun())
      this.boreIndex = new RoadIndex(this.track, 24)
    }
    const near = this.boreIndex!.nearest(x, z, this.track.width / 2 + 4, (i) => this.bores!.has(i))
    return near.i < 0 ? null : this.track.samples[near.i]!.y + 11.5
  }
  private bores: Set<number> | null = null
  private boreIndex: RoadIndex | null = null

  onBridge(i: number): boolean {
    return this.bridgeIdx.has(i)
  }

  inTube(i: number): boolean {
    return this.tunnelIdx.has(i)
  }

  roadMode(i: number): RoadMode | undefined {
    if (this.tunnelIdx.has(i)) return 'tunnel'
    if (this.bridgeIdx.has(i)) return 'bridge'
    return undefined
  }

  build(ctx: BuildCtx): void {
    const t = ctx.terrain
    // ── Lava lake, channel and the rivers down the flank ──
    const lakeMat = lavaMaterial(false, this.lavaShaders)
    const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R + 2, 64), lakeMat)
    lake.rotation.x = -Math.PI / 2
    lake.position.set(V.x, 13.1, V.z)
    this.group.add(lake)
    const flowMat = lavaMaterial(true, this.lavaShaders)
    // channel ribbon from the lake to the wall
    this.group.add(this.ribbon(
      Array.from({ length: 20 }, (_, k) => {
        const a = LAKE_R - 6 + k * 3.2
        return new THREE.Vector3(V.x + Math.cos(CH_ANG) * a, 12.9, V.z + Math.sin(CH_ANG) * a)
      }), 9, flowMat))
    for (const a0 of RIVER_ANGS) {
      const pts: THREE.Vector3[] = []
      for (let r = RIM - 6; r < 335; r += 4) {
        const a = a0 + 0.09 * Math.sin(r * 0.03 + a0 * 3)
        const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r
        pts.push(new THREE.Vector3(x, t.heightAt(x, z) + 0.35, z))
      }
      this.group.add(this.ribbon(pts, 6.5, flowMat))
    }

    // Crater glow lights the walls and the smoke from below
    this.glow = new THREE.PointLight(0xff5a1e, 0, 420, 2)
    this.glow.position.set(V.x, 34, V.z)
    // never hidden: switching a light on/off would recompile every shader
    this.glow.userData['keepVisible'] = true
    this.lights.add(this.glow)

    this.buildTunnel()
    this.buildBridge(ctx)
    this.buildRocks(ctx)
    this.buildDeadTrees(ctx)
    this.buildPlume()
    this.buildVents(ctx)
    this.buildSigns(ctx)
    this.buildStation(ctx)
    this.buildBombs()
    this.buildChase(ctx)
  }

  /**
   * The eruption: from the flank to the end of the lava tube the road turns to
   * lava behind you, cracks race ahead of you and two fissures throw you into
   * the air (with a full nitro) if you hit them.
   */
  private buildChase(ctx: BuildCtx): void {
    const t = this.track, n = this.idx.length, half = t.width / 2
    const ids = this.idx.slice(Math.floor(n * 0.1))
    this.chase = new Chase(t, ids, {
      label: 'LAVA', loop: 'lava', startSfx: 'eruption', caughtSfx: 'boom', color: '#ff4a10', startGap: 46, base: 58, holdGap: 30,
      startText: 'ERUPTION  GET OUT', caughtText: 'LAVA CAUGHT YOU',
      endText: (m) => `ESCAPED THE LAVA  ${m} M CLEAR  NITRO FULL`,
      onCatch: (ev) => { this.heat += 0.45; ev.hit(0.6); ev.toast('LAVA CAUGHT YOU'); ev.sfx('boom') },
      status: () => ({ text: this.heat > 0.02 ? `HEAT ${Math.round(this.heat * 100)}%` : '', level: this.heat }),
    })
    const flow = lavaMaterial(true, this.lavaShaders)
    const strip = (lat: number, width: number, up: number): THREE.Mesh => {
      const pts = ids.map((i) => {
        const p = t.samples[i]!, r = rightAt(t, i)
        return new THREE.Vector3(p.x + r.x * lat, p.y + up, p.z + r.z * lat)
      })
      const m = this.ribbon(pts, width, flow)
      m.frustumCulled = false
      m.visible = false
      this.group.add(m)
      return m
    }
    this.lavaRoad = strip(0, t.width + 1, 0.16)
    this.cracks = [strip(-half + 0.8, 0.9, 0.1), strip(half - 0.8, 0.9, 0.1), strip(2.8, 0.35, 0.1)]
    const dot = softDot()
    for (let k = 0; k < 12; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff7a22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      s.visible = false
      s.userData['ph'] = k / 12
      this.spray.push(s)
      this.group.add(s)
    }
    // fissures across the road, well clear of the bridge, its kicker and the tube
    for (const fr of [0.16, 0.34, 0.9]) {
      let k = Math.floor(n * fr)
      const clear = (q: number) => {
        for (let d = -70; d <= 70; d++) { const i = this.idx[q + d]; if (i !== undefined && (this.bridgeIdx.has(i) || this.tunnelIdx.has(i))) return false }
        return true
      }
      while (k < n * 0.97 && !clear(k)) k += 10
      if (k >= n * 0.97) continue
      const river = fr === 0.9 // the last one is the leap out of the volcano
      const i = this.idx[k]!, p = t.samples[i]!, r = rightAt(t, i), tg = t.tangents[i]!
      this.kickerIds.push(i)
      ctx.addKicker(i, river ? 9 : 15)
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(t.width + 1, river ? 34 : 2.2), flow)
      bar.position.copy(p).setY(p.y + 0.12)
      if (river) { const q = t.samples[this.idx[k + 12]!]!; bar.position.set(q.x, q.y + 0.12, q.z) }
      bar.rotation.set(-Math.PI / 2, 0, Math.atan2(r.x, r.z) - Math.PI / 2)
      this.group.add(bar)
      for (let q = 0; q < 7; q++) {
        const a = (q / 6 - 0.5) * (t.width - 2)
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff8a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
        s.userData['base'] = new THREE.Vector3(p.x + r.x * a, p.y, p.z + r.z * a)
        s.userData['ph'] = this.rand()
        this.geysers.push(s)
        this.group.add(s)
      }
      this.group.add(besideRoad(t, this.idx[Math.max(0, k - 50)]!, 14, roadSign(river ? ['LAVA RIVER', 'JUMP IT'] : ['FISSURE AHEAD', 'HIT IT FLAT OUT'], '#f2c400', '#111')))
      void tg
    }
    this.buildBreaches(ids, flow, dot)
    // the summit blowing: a column of fire you can see the whole way up the flank
    for (let k = 0; k < 22; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: k % 3 ? 0xff5a14 : 0xffc04a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }))
      s.visible = false
      s.userData['a'] = this.rand() * Math.PI * 2
      s.userData['v'] = 0.55 + this.rand() * 0.6
      this.blast.push(s)
      this.group.add(s)
    }
  }

  /** Lava flows that burst over one half of the road as you approach. */
  private buildBreaches(ids: number[], flow: THREE.Material, dot: THREE.Texture): void {
    const t = this.track
    const pos = new Map(ids.map((i, k) => [i, k]))
    const blocked = (k: number) => {
      for (let d = -6; d <= 34; d += 2) {
        const i = ids[k + d]
        if (i === undefined || this.bridgeIdx.has(i) || this.tunnelIdx.has(i) || t.isGap(i)) return true
      }
      return this.kickerIds.some((q) => { const d = (pos.get(q) ?? 1e9) - k; return d > -14 && d < 44 })
    }
    let side = 1, k = 70
    while (k < ids.length - 60) {
      if (blocked(k)) { k += 3; continue }
      const k1 = k + 30, lat = side * (t.width / 4 + 0.4)
      const pts = ids.slice(k, k1).map((i) => {
        const p = t.samples[i]!, r = rightAt(t, i)
        return new THREE.Vector3(p.x + r.x * lat, p.y + 0.2, p.z + r.z * lat)
      })
      const mesh = this.ribbon(pts, t.width / 2 + 1, flow)
      mesh.visible = false
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.breaches.push({ k0: k, k1, side, mesh, open: false })
      for (let q = 0; q < 4; q++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff8a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
        s.userData['base'] = pts[Math.floor((q + 0.5) * pts.length / 4)]!.clone()
        s.userData['ph'] = this.rand()
        s.userData['breach'] = this.breaches.length - 1
        s.visible = false
        this.geysers.push(s)
        this.group.add(s)
      }
      side = -side
      k = k1 + 50
    }
  }

  /** Heat, breaches and the summit blast. */
  private updateMeltdown(f: FrameCtx, ev: BiomeEvents): void {
    const c = this.chase!, t = this.track
    if (!c.running) {
      for (const b of this.breaches) { b.mesh.visible = false; b.open = false }
      this.heat = 0
      this.onLava = false
      return
    }
    if (this.blastT < 0) { this.blastT = 0; ev.flash(0xff5a14, 0.8); ev.rumble(0.7) }
    const i = c.ids[c.carK]!, p = t.samples[i]!, r = rightAt(t, i)
    const lat = (f.carPos.x - p.x) * r.x + (f.carPos.z - p.z) * r.z
    let burning = false
    for (const b of this.breaches) {
      if (!b.open && c.carK > b.k0 - 125 && c.carK < b.k1) {
        b.open = true
        b.mesh.visible = true
        ev.sfx('crack')
        ev.rumble(0.3)
        ev.toast(b.side > 0 ? '◀ LAVA RIGHT  GO LEFT' : 'LAVA LEFT  GO RIGHT ▶')
      }
      if (c.carK >= b.k0 && c.carK <= b.k1 && lat * b.side > -0.4) burning = true
    }
    const near = Math.max(0, 1 - c.gap / 70)
    this.heat += f.dt * (burning ? 0.6 : near * near * 0.22 - (near < 0.3 ? 0.05 : 0))
    this.heat = Math.max(0, this.heat)
    if (burning) {
      if (!this.onLava) { ev.sfx('boom', 0.6); ev.flash(0xff4a10, 0.35) }
      ev.rumble(f.dt * 3)
    }
    this.onLava = burning
    if (this.heat >= 1) {
      this.heat = 0.4
      ev.wreck('ENGINE MELTED  +4 SEC')
      c.setBack(75, 4)
    }
  }

  private updateChase(f: FrameCtx, ev: BiomeEvents): void {
    const c = this.chase
    if (!c) return
    c.update(f, ev)
    this.updateMeltdown(f, ev)
    const on = c.running
    if (this.lavaRoad) this.lavaRoad.visible = on
    for (const m of this.cracks) m.visible = on
    for (const s of this.spray) s.visible = on
    if (!on) return
    const fk = c.kAt(Math.max(0, c.front))
    this.lavaRoad!.geometry.setDrawRange(0, fk * 6)
    // cracks open ahead of the car, further the closer the lava is
    const reach = Math.min(c.ids.length - 2, c.carK + 45 + Math.round((1 - c.gap / 95) * 70))
    for (const m of this.cracks) m.geometry.setDrawRange(fk * 6, Math.max(0, reach - fk) * 6)
    const i = c.ids[fk]!, p = this.track.samples[i]!, r = rightAt(this.track, i)
    for (const s of this.spray) {
      const ph = ((s.userData['ph'] as number) + f.time * 0.9) % 1
      const a = ((s.userData['ph'] as number) - 0.5) * this.track.width
      s.position.set(p.x + r.x * a, p.y + ph * 16, p.z + r.z * a)
      s.scale.setScalar(5 + ph * 9)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - ph)
    }
  }

  /** Flat ribbon along a polyline (uv.x across, uv.y metres / 8 along). */
  private ribbon(pts: THREE.Vector3[], width: number, mat: THREE.Material): THREE.Mesh {
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    let along = 0
    pts.forEach((p, k) => {
      const q = pts[Math.min(k + 1, pts.length - 1)]!, o = pts[Math.max(k - 1, 0)]!
      const d = new THREE.Vector3().subVectors(q, o).setY(0).normalize()
      const r = new THREE.Vector3(-d.z, 0, d.x)
      if (k > 0) along += p.distanceTo(pts[k - 1]!)
      pos.push(p.x - r.x * width / 2, p.y, p.z - r.z * width / 2, p.x + r.x * width / 2, p.y, p.z + r.z * width / 2)
      uv.push(0, along / 8, 1, along / 8)
      if (k < pts.length - 1) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    m.receiveShadow = true
    return m
  }

  /** The lava tube: an arched basalt bore with glowing seams. */
  private buildTunnel(): void {
    const run = this.tubeRun()
    if (!run.length) return
    const veins = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, w)
      g.strokeStyle = '#ff6a1a'
      for (let k = 0; k < 14; k++) {
        g.lineWidth = 1 + Math.random() * 3
        g.beginPath()
        let x = Math.random() * w, y = Math.random() * w
        g.moveTo(x, y)
        for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 70; y += Math.random() * 50; g.lineTo(x, y) }
        g.stroke()
      }
    })
    veins.wrapS = veins.wrapT = THREE.RepeatWrapping
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x1c1816, roughness: 0.9, side: THREE.BackSide,
      emissive: 0xffffff, emissiveMap: veins, emissiveIntensity: 1.4, flatShading: true,
    })
    const half = this.track.width / 2 + 2
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    const ROWS = 15
    let along = 0
    run.forEach((i, k) => {
      const p = this.track.samples[i]!
      const r = rightAt(this.track, i)
      if (k > 0) along += p.distanceTo(this.track.samples[run[k - 1]!]!)
      for (let q = 0; q <= ROWS; q++) {
        const a = (q / ROWS) * Math.PI
        const bump = (fbm2(along * 0.15, q * 0.7) - 0.5) * 1.6
        const x = Math.cos(a) * (half + bump), y = Math.sin(a) * (11 + bump) - 0.6
        pos.push(p.x + r.x * x, p.y + y, p.z + r.z * x)
        uv.push(q / ROWS * 3, along / 12)
      }
      if (k > 0) {
        const b = k * (ROWS + 1), a0 = b - ROWS - 1
        for (let q = 0; q < ROWS; q++) idx.push(a0 + q, b + q, a0 + q + 1, a0 + q + 1, b + q, b + q + 1)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const tube = new THREE.Mesh(g, rockMat)
    tube.castShadow = true
    tube.receiveShadow = true
    this.group.add(tube)
    // rough portal collars at both mouths
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 0.95, flatShading: true })
    for (const i of [run[0]!, run[run.length - 1]!]) {
      const p = this.track.samples[i]!, tg = this.track.tangents[i]!
      const ring = new THREE.Mesh(lumpy(new THREE.TorusGeometry(half + 2.5, 3.2, 8, 20, Math.PI), 1.4, 0.25, i), collarMat)
      ring.position.copy(p).setY(p.y - 0.6)
      ring.rotation.y = Math.atan2(tg.x, tg.z)
      ring.castShadow = true
      this.group.add(ring)
    }
  }

  /** Steel girder bridge over the lava channel, with a kicker to jump it. */
  private buildBridge(ctx: BuildCtx): void {
    const ids = [...this.bridgeIdx].sort((a, b) => a - b)
    if (!ids.length) return
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.8, roughness: 0.45 })
    const half = this.track.width / 2
    for (const s of [-1, 1]) {
      for (let k = 0; k < ids.length; k += 3) {
        const i = ids[k]!
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25), steel)
        post.position.set(p.x + r.x * s * (half + 0.3), p.y + 0.6, p.z + r.z * s * (half + 0.3))
        this.group.add(post)
      }
      // deep side girders
      const a = this.track.samples[ids[0]!]!, b = this.track.samples[ids[ids.length - 1]!]!
      const r = rightAt(this.track, ids[Math.floor(ids.length / 2)]!)
      const len = a.distanceTo(b) + 4
      const girder = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, len), steel)
      girder.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(r.x * s * (half + 0.3), -1.2, r.z * s * (half + 0.3)))
      girder.lookAt(girder.position.clone().add(b.clone().sub(a)))
      girder.castShadow = true
      this.group.add(girder)
      // rail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), new THREE.MeshStandardMaterial({ color: 0xd7b21a, roughness: 0.5 }))
      rail.position.copy(girder.position).setY(girder.position.y + 2.4)
      rail.quaternion.copy(girder.quaternion)
      this.group.add(rail)
    }
    // Kicker ramp ~30 m before the bridge: hop the lava
    const n = this.track.sampleCount
    let ki = ids[0]!
    let dist = 0
    while (dist < 30) { const j = (ki - 1 + n) % n; dist += this.track.samples[ki]!.distanceTo(this.track.samples[j]!); ki = j }
    ctx.addKicker(ki, 15)
    this.group.add(kickerRamp(this.track, ki))
  }

  private buildRocks(ctx: BuildCtx): void {
    const t = ctx.terrain
    const geo = lumpy(new THREE.DodecahedronGeometry(1, 1), 0.28, 1.3, 3)
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 0.42, metalness: 0.05, flatShading: true })
    const mats: THREE.Matrix4[] = []
    for (let k = 0; k < 900 && mats.length < 420; k++) {
      const a = this.rand() * Math.PI * 2, r = 40 + Math.pow(this.rand(), 0.8) * 340
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r
      if (ctx.road.near(x, z, 15) || (r < LAKE_R + 4)) continue
      const s = 0.6 + Math.pow(this.rand(), 3) * 4.5
      const y = t.heightAt(x, z)
      mats.push(trs(x, y + s * 0.2, z, this.rand() * 6, new THREE.Vector3(s, s * (0.5 + this.rand() * 0.5), s * (0.8 + this.rand() * 0.4)), this.rand(), this.rand()))
    }
    this.group.add(instanced(geo, mat, mats))
  }

  private buildDeadTrees(ctx: BuildCtx): void {
    const t = ctx.terrain
    const trunk = new THREE.CylinderGeometry(0.12, 0.32, 1, 6)
    trunk.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 1 })
    const trunks: THREE.Matrix4[] = []
    const branches: THREE.Matrix4[] = []
    for (let k = 0; k < 600 && trunks.length < 140; k++) {
      const a = this.rand() * Math.PI * 2, r = 230 + this.rand() * 170
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r
      if (ctx.road.near(x, z, 14) || this.riverDist(x, z) < 14) continue
      const y = t.heightAt(x, z)
      if (y < 0) continue
      const h = 4 + this.rand() * 6
      const lean = (this.rand() - 0.5) * 0.25
      trunks.push(trs(x, y - 0.2, z, this.rand() * 6, new THREE.Vector3(1, h, 1), lean, 0))
      for (let b = 0; b < 3; b++) {
        const by = y + h * (0.45 + b * 0.17)
        branches.push(trs(x, by, z, this.rand() * 6, new THREE.Vector3(0.5, 1.6 + this.rand() * 2, 0.5), 0.9 + this.rand() * 0.6, 0))
      }
    }
    this.group.add(instanced(trunk, mat, trunks), instanced(trunk, mat, branches))
  }

  private buildPlume(): void {
    const tex = puffTexture()
    for (let k = 0; k < 34; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x3a3532, transparent: true, depthWrite: false, opacity: 0.5, fog: true }))
      s.userData['phase'] = k / 34
      s.userData['spin'] = this.rand() * 6
      this.plume.push(s)
      this.group.add(s)
    }
  }

  private buildVents(ctx: BuildCtx): void {
    const tex = puffTexture()
    const t = ctx.terrain
    for (let k = 0; k < 9; k++) {
      const a = this.rand() * Math.PI * 2, r = k < 3 ? 70 + this.rand() * 20 : RIM + 20 + this.rand() * 120
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r
      if (ctx.road.near(x, z, 12)) continue
      const y = t.heightAt(x, z)
      for (let q = 0; q < 5; q++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe8e4dc, transparent: true, depthWrite: false, opacity: 0.35 }))
        s.userData['base'] = new THREE.Vector3(x, y, z)
        s.userData['phase'] = q / 5 + this.rand() * 0.1
        this.vents.push(s)
        this.group.add(s)
      }
    }
  }

  private buildSigns(ctx: BuildCtx): void {
    const i0 = this.idx[Math.floor(this.idx.length * 0.03)]!
    this.group.add(besideRoad(this.track, i0, 14, roadSign(['DANGER', 'ACTIVE LAVA FLOW'], '#f2c400', '#111')))
    const i1 = this.idx[Math.floor(this.idx.length * 0.3)]!
    this.group.add(besideRoad(this.track, i1, -14, roadSign(['WARNING', 'FALLING ROCKS'], '#f2c400', '#111')))
    // jersey barriers on the lake side of the crater ring road
    const barrier = new THREE.BoxGeometry(0.6, 0.9, 3.6)
    const bm = new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 })
    const mats: THREE.Matrix4[] = []
    for (const i of this.idx) {
      const p = this.track.samples[i]!
      const r = Math.hypot(p.x - V.x, p.z - V.z)
      if (r > 100 || this.bridgeIdx.has(i) || i % 3) continue
      const rv = rightAt(this.track, i)
      // which side faces the lake?
      const toLake = (V.x - p.x) * rv.x + (V.z - p.z) * rv.z > 0 ? 1 : -1
      const tg = this.track.tangents[i]!
      mats.push(trs(p.x + rv.x * toLake * 11.6, p.y + 0.45, p.z + rv.z * toLake * 11.6, Math.atan2(tg.x, tg.z)))
    }
    this.group.add(instanced(barrier, bm, mats))
    void ctx
  }

  /** A volcanology station on the far rim: hut, mast and a blinking beacon. */
  private buildStation(ctx: BuildCtx): void {
    const a = 3.6, r = RIM + 6
    const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r
    const y = ctx.terrain.heightAt(x, z)
    const g = new THREE.Group()
    const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.7 }))
    hut.position.y = 1.6
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.3, 4.6), new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.8 }))
    roof.position.y = 3.35
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 16, 6), new THREE.MeshStandardMaterial({ color: 0xbababa, metalness: 0.7 }))
    mast.position.set(5, 8, 0)
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 }))
    this.beacon.position.set(5, 16.3, 0)
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide }))
    dish.position.set(-2, 4.6, 0)
    dish.rotation.x = -1.1
    g.add(hut, roof, mast, this.beacon, dish)
    g.position.set(x, y, z)
    g.rotation.y = -a
    g.traverse((o) => { o.castShadow = true })
    this.group.add(g)
  }

  private buildBombs(): void {
    const rockGeo = lumpy(new THREE.IcosahedronGeometry(1.5, 1), 0.35, 1.1, 9)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0xff4a10, emissiveIntensity: 1.8, roughness: 0.8, flatShading: true })
    const markMat = new THREE.MeshBasicMaterial({ color: 0xff3b1a, transparent: true, opacity: 0.6, depthWrite: false, map: ringTexture() })
    for (let k = 0; k < 6; k++) {
      const mesh = new THREE.Mesh(rockGeo, rockMat)
      mesh.visible = false
      mesh.castShadow = true
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      halo.scale.setScalar(9)
      mesh.add(halo)
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), markMat)
      marker.rotation.x = -Math.PI / 2
      marker.visible = false
      marker.renderOrder = 2
      this.group.add(mesh, marker)
      this.bombs.push({ mesh, marker, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, T: 1, H: 60, live: false })
    }
    const scorchTex = canvasTexture(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
      gr.addColorStop(0, 'rgba(10,6,4,0.95)')
      gr.addColorStop(0.6, 'rgba(25,14,8,0.6)')
      gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, w)
    })
    for (let k = 0; k < 6; k++) {
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      const scorch = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false }))
      scorch.rotation.x = -Math.PI / 2
      scorch.renderOrder = 1
      const smoke = Array.from({ length: 4 }, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0x4a4440, transparent: true, depthWrite: false })))
      flash.visible = scorch.visible = false
      smoke.forEach((s) => (s.visible = false))
      this.group.add(flash, scorch, ...smoke)
      this.bursts.push({ flash, scorch, smoke, age: 0, live: false })
    }
  }

  private launch(f: FrameCtx): void {
    const b = this.bombs.find((x) => !x.live)
    if (!b) return
    const n = this.track.sampleCount
    // land on the road a couple of seconds ahead of the car
    const ahead = Math.round(60 + this.rand() * 150)
    const i = (f.carIdx + ahead) % n
    if (this.track.zoneOfSample(i) !== 'volcano' || this.tunnelIdx.has(i)) return
    const p = this.track.samples[i]!, r = rightAt(this.track, i)
    const lat = (this.rand() - 0.5) * 16
    b.to.set(p.x + r.x * lat, p.y + 0.4, p.z + r.z * lat)
    b.from.set(V.x + (this.rand() - 0.5) * 30, 14, V.z + (this.rand() - 0.5) * 30)
    b.T = 2.4 + this.rand() * 1.2
    b.H = 70 + this.rand() * 50
    b.t = 0
    b.live = true
    b.mesh.visible = true
    b.marker.visible = true
    b.marker.position.copy(b.to).setY(b.to.y + 0.08)
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    const near = this.group.visible
    for (const s of this.lavaShaders) s.uniforms['uTime']!.value = f.time % 1000
    if (!near) { this.glow.intensity = 0; return }
    const dCar = Math.hypot(f.carPos.x - V.x, f.carPos.z - V.z)
    this.glow.intensity = 6000 * (1 - smooth(250, 600, dCar)) * (0.85 + 0.15 * Math.sin(f.time * 2.1))
    if (this.beacon) this.beacon.visible = Math.sin(f.time * 4) > 0.3

    // smoke column: rises, widens, thins
    for (const s of this.plume) {
      const ph = (s.userData['phase'] as number + f.time * 0.025) % 1
      const sp = s.userData['spin'] as number
      s.position.set(V.x + Math.sin(sp + ph * 3) * (8 + ph * 40) + ph * 60, 20 + ph * 230, V.z + Math.cos(sp) * (6 + ph * 30))
      s.scale.setScalar(30 + ph * 120)
      const m = s.material as THREE.SpriteMaterial
      m.opacity = 0.55 * smooth(0, 0.08, ph) * (1 - smooth(0.6, 1, ph))
      m.color.setRGB(lerp(0.75, 0.22, smooth(0, 0.25, ph)), lerp(0.32, 0.2, smooth(0, 0.25, ph)), lerp(0.12, 0.19, smooth(0, 0.25, ph)))
    }
    for (const s of this.vents) {
      const ph = (s.userData['phase'] as number + f.time * 0.12) % 1
      const b = s.userData['base'] as THREE.Vector3
      s.position.set(b.x + ph * 3, b.y + 1 + ph * 18, b.z)
      s.scale.setScalar(3 + ph * 10)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.4 * smooth(0, 0.15, ph) * (1 - ph)
    }

    this.updateChase(f, ev)
    if (this.blastT >= 0 && this.blastT < 6) {
      this.blastT += f.dt
      for (const s of this.blast) {
        const a = s.userData['a'] as number, v = s.userData['v'] as number
        const u = Math.min(1, this.blastT * v / 3.4)
        s.visible = true
        s.position.set(V.x + Math.cos(a) * u * 70, 30 + 300 * u * (1.25 - 0.5 * u), V.z + Math.sin(a) * u * 70)
        s.scale.setScalar(50 + u * 170)
        ;(s.material as THREE.SpriteMaterial).opacity = 0.95 * (1 - u)
      }
      this.glow.intensity *= 1 + 3 * (1 - smooth(0, 5, this.blastT))
      if (this.blastT >= 6) for (const s of this.blast) s.visible = false
    }
    if (!this.chase?.running && f.zone !== 'volcano') this.blastT = -1
    for (const s of this.geysers) {
      const br = s.userData['breach'] as number | undefined
      if (br !== undefined) { s.visible = this.breaches[br]!.open; if (!s.visible) continue }
      const ph = ((s.userData['ph'] as number) + f.time * 0.8) % 1
      const b = s.userData['base'] as THREE.Vector3
      s.position.set(b.x, b.y + ph * 11, b.z)
      s.scale.setScalar(3 + ph * 6)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - ph)
    }

    // eruption bombs while the car is in the volcano
    const inVolcano = f.zone === 'volcano'
    this.nextBomb -= f.dt
    if (inVolcano && this.nextBomb <= 0) {
      this.launch(f)
      this.nextBomb = (this.chase?.running ? 0.8 : 1.1) + this.rand() * 1.6
    }
    for (const b of this.bombs) {
      if (!b.live) continue
      b.t += f.dt
      const u = Math.min(1, b.t / b.T)
      b.mesh.position.lerpVectors(b.from, b.to, u)
      b.mesh.position.y += 4 * b.H * u * (1 - u)
      b.mesh.rotation.x += f.dt * 3
      b.mesh.rotation.z += f.dt * 2
      const mm = b.marker.material as THREE.MeshBasicMaterial
      mm.opacity = (0.35 + 0.35 * Math.sin(f.time * 14)) * smooth(0.25, 0.6, u)
      b.marker.scale.setScalar(1.4 - u * 0.5)
      if (u >= 1) {
        b.live = false
        b.mesh.visible = false
        b.marker.visible = false
        this.impact(b.to)
        const d = Math.hypot(f.carPos.x - b.to.x, f.carPos.z - b.to.z)
        ev.sfx('boom', 0.9 - d / 190)
        if (d < 6) { ev.hit(1 - d / 8); this.heat += 0.18 }
      }
    }
    for (const x of this.bursts) {
      if (!x.live) continue
      x.age += f.dt
      const a = x.age
      x.flash.scale.setScalar(6 + a * 40)
      ;(x.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - a * 2.2)
      x.flash.visible = a < 0.5
      ;(x.scorch.material as THREE.MeshBasicMaterial).opacity = 1 - smooth(5, 9, a)
      x.smoke.forEach((s, k) => {
        s.visible = a < 4
        s.position.y += f.dt * (2 + k)
        s.scale.setScalar(4 + a * (5 + k * 2))
        ;(s.material as THREE.SpriteMaterial).opacity = 0.6 * (1 - smooth(0.5, 4, a))
      })
      if (a > 9) { x.live = false; x.scorch.visible = false }
    }
  }

  private impact(at: THREE.Vector3): void {
    const x = this.bursts.find((b) => !b.live) ?? this.bursts[0]!
    x.live = true
    x.age = 0
    x.flash.position.copy(at).setY(at.y + 2)
    x.flash.visible = true
    x.scorch.position.copy(at).setY(at.y + 0.05)
    x.scorch.visible = true
    x.smoke.forEach((s) => { s.position.set(at.x + (this.rand() - 0.5) * 4, at.y + 1, at.z + (this.rand() - 0.5) * 4); s.visible = true })
  }
}

let _ring: THREE.CanvasTexture | null = null
function ringTexture(): THREE.CanvasTexture {
  _ring ??= canvasTexture(128, 128, (g, w) => {
    g.strokeStyle = '#fff'
    g.lineWidth = 10
    g.beginPath(); g.arc(w / 2, w / 2, w * 0.4, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 6
    g.beginPath(); g.arc(w / 2, w / 2, w * 0.18, 0, Math.PI * 2); g.stroke()
  })
  return _ring
}

/** Steel kicker ramp with hazard chevrons, sitting on the road at sample i. */
export function kickerRamp(track: Track, i: number, width = 9): THREE.Group {
  const g = new THREE.Group()
  const tex = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#1b1b1b'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#f5c518'
    for (let k = -2; k < 10; k++) {
      c.beginPath()
      c.moveTo(k * 32, h); c.lineTo(k * 32 + 16, h); c.lineTo(k * 32 + 16 + h * 0.5, 0); c.lineTo(k * 32 + h * 0.5, 0)
      c.fill()
    }
  })
  const L = 6, H = 1.1
  const shape = new THREE.Shape()
  shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, 0)
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false })
  geo.translate(-L, 0, -width / 2)
  geo.rotateY(Math.PI / 2)
  const ramp = new THREE.Mesh(geo, [
    new THREE.MeshStandardMaterial({ color: 0x5a5e62, metalness: 0.7, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xf5c518, emissiveIntensity: 0.25, emissiveMap: tex, roughness: 0.5 }),
  ])
  ramp.castShadow = true
  ramp.receiveShadow = true
  g.add(ramp)
  const p = track.samples[i]!, t = track.tangents[i]!
  g.position.copy(p).setY(p.y + 0.02)
  g.rotation.y = Math.atan2(-t.x, -t.z)
  return g
}
