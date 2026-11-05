import * as THREE from 'three'
import { LANDMARKS } from '../trackData'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField, Terrain } from './Terrain'
import type { Track } from '../Track'
import { Chase } from './Chase'
import {
  biomeGroup, fbm2, ridged2, smooth, lerp, rng, zoneIndices, rightAt, instanced, trs, lumpy,
  canvasTexture, ZoneDistance, puffTexture, roadSign, besideRoad,
} from './kit'

const LAKE = LANDMARKS.iceLake

/** Alpine pass: snowfields, pines, an avalanche gallery, ice lake, ski lift. */
export class Snow implements Biome {
  readonly name = 'snow'
  readonly group = biomeGroup('snow')
  private readonly rand = rng(53)
  private readonly idx: number[]
  private dSnow!: ZoneDistance
  private dSky!: ZoneDistance
  private iceIdx = new Set<number>()
  private chairs: THREE.InstancedMesh | null = null
  private cable: THREE.Vector3[] = []
  private smoke: THREE.Sprite[] = []
  private drift = 0
  private onIce = false
  private gallery = new Set<number>()
  private chases: Chase[] = []
  private powder: THREE.Sprite[] = []
  private balls: { m: THREE.Mesh; live: boolean; t: number; i: number; side: number; lat0: number; r: number }[] = []
  private nextBall = 0
  private terrain!: Terrain

  constructor(private readonly track: Track) {
    this.idx = zoneIndices(track, 'snow')
    for (const i of this.idx) {
      const p = track.samples[i]!
      if (Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r - 4) this.iceIdx.add(i)
    }
  }

  fields(): TerrainField[] {
    this.dSnow = new ZoneDistance(this.track, ['snow'], -1000, -1300, 1300, -40, 10)
    this.dSky = new ZoneDistance(this.track, ['sky', 'roll', 'flight3'], -1000, -1300, 1300, -40, 10)
    const mountains: TerrainField = {
      weight: (x, z) => {
        // the pass itself, plus a range running east under the sky islands
        const near = 1 - smooth(170, 280, this.dSnow.at(x, z))
        const range = smooth(780, 900, x) * smooth(-320, -440, z) * (1 - smooth(1200, 1290, x))
        return Math.max(near, range)
      },
      height: (x, z) => {
        const dRoad = this.dSnow.at(x, z)
        const dSky = this.dSky.at(x, z)
        const ridge = Math.pow(ridged2(x * 0.0034 + 3, z * 0.0034 - 7, 5), 1.35)
        let h = 10 + fbm2(x * 0.006, z * 0.006) * 24
        // big peaks away from the road, held down under the floating islands
        h += ridge * 190 * smooth(50, 260, dRoad) * (0.35 + 0.65 * smooth(110, 300, dSky))
        // a gentle rise from the salt pan up into the pass
        h *= smooth(300, 520, x) * 0.7 + 0.3
        // under the floating islands the range stays below the cloud deck
        h = Math.min(h, lerp(26, h, smooth(150, 340, dSky)))
        // the frozen lake basin
        const dl = Math.hypot(x - LAKE.x, z - LAKE.z)
        h = lerp(LAKE.y - 0.7, h, smooth(LAKE.r - 6, LAKE.r + 30, dl))
        return h
      },
      color: (x, z, h, slope, out) => {
        const n = fbm2(x * 0.04, z * 0.04)
        const snow = new THREE.Color(0.9 + n * 0.06, 0.93 + n * 0.05, 0.98)
        const rock = new THREE.Color(0.4 + n * 0.1, 0.4 + n * 0.1, 0.43 + n * 0.1)
        const tundra = new THREE.Color(0.55, 0.5, 0.4)
        const steep = smooth(0.6, 1.05, slope + (n - 0.5) * 0.3)
        const low = smooth(16, 6, h) * (1 - smooth(0.5, 0.75, fbm2(x * 0.02, z * 0.02)))
        out.copy(snow).lerp(tundra, low).lerp(rock, steep)
      },
      mask: (x, z, h, out) => {
        const snowy = smooth(10, 16, h)
        out.set(0, 0, snowy * 0.8, 0)
        void x; void z
      },
      surface: 1,
    }
    return [mountains]
  }

  build(ctx: BuildCtx): void {
    this.buildLake(ctx)
    this.buildPines(ctx)
    this.buildPoles()
    this.buildGallery(ctx)
    this.buildCabins(ctx)
    this.buildSkiLift(ctx.terrain)
    this.buildAvalanche(ctx)
    const i0 = this.idx[Math.floor(this.idx.length * 0.02)]!
    this.group.add(besideRoad(this.track, i0, 14, roadSign(['ALPINE PASS', 'SNOW CHAINS ADVISED'], '#0d5d2f', '#ffffff')))
    const i1 = this.idx[Math.floor(this.idx.length * 0.45)]!
    this.group.add(besideRoad(this.track, i1, 14, roadSign(['ICE ROAD', 'REDUCED GRIP'], '#1c4f8f', '#ffffff')))
  }

  private buildLake(ctx: BuildCtx): void {
    const tex = canvasTexture(1024, 1024, (g, w) => {
      g.fillStyle = '#bcd6e4'
      g.fillRect(0, 0, w, w)
      // dark clear-ice patches and white wind-blown snow drifts
      for (let k = 0; k < 60; k++) {
        const x = Math.random() * w, y = Math.random() * w, r = 30 + Math.random() * 120
        const gr = g.createRadialGradient(x, y, 0, x, y, r)
        const dark = Math.random() < 0.5
        gr.addColorStop(0, dark ? 'rgba(70,110,140,0.45)' : 'rgba(255,255,255,0.7)')
        gr.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = gr
        g.fillRect(0, 0, w, w)
      }
      // pressure cracks
      g.strokeStyle = 'rgba(255,255,255,0.75)'
      for (let k = 0; k < 40; k++) {
        g.lineWidth = 0.6 + Math.random() * 1.6
        g.beginPath()
        let x = Math.random() * w, y = Math.random() * w
        g.moveTo(x, y)
        for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 120; g.lineTo(x, y) }
        g.stroke()
      }
    })
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 })
    const ice = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 8, 72), mat)
    ice.rotation.x = -Math.PI / 2
    ice.position.set(LAKE.x, LAKE.y - 0.25, LAKE.z)
    ice.receiveShadow = true
    this.group.add(ice)
    // snow bank rim round the lake
    const bank = lumpy(new THREE.TorusGeometry(LAKE.r + 9, 2.2, 6, 64), 0.9, 0.12, 5)
    // sink the bank where the road crosses it
    const bp = bank.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < bp.count; k++) {
      const wx = LAKE.x + bp.getX(k), wz = LAKE.z - bp.getY(k)
      if (ctx.road.near(wx, wz, ctx.track.width / 2 + 4)) bp.setZ(k, bp.getZ(k) - 8)
    }
    bank.computeVertexNormals()
    const rim = new THREE.Mesh(bank, new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.9 }))
    rim.rotation.x = -Math.PI / 2
    rim.position.set(LAKE.x, LAKE.y - 1.4, LAKE.z)
    rim.scale.set(1, 1, 0.5)
    rim.receiveShadow = true
    this.group.add(rim)
  }

  /** Snow-laden spruce: trunk, three tiers of dark needles, snow caps. */
  private buildPines(ctx: BuildCtx): void {
    const t = ctx.terrain
    const trunk = new THREE.CylinderGeometry(0.2, 0.32, 1, 6)
    trunk.translate(0, 0.5, 0)
    const tier = lumpy(new THREE.ConeGeometry(1, 1, 9, 2), 0.06, 3, 1)
    tier.translate(0, 0.5, 0)
    const cap = lumpy(new THREE.ConeGeometry(1, 1, 9, 1), 0.05, 3, 2)
    cap.translate(0, 0.5, 0)
    const trunks: THREE.Matrix4[] = [], tiers: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = []
    const tint: THREE.Color[] = []
    const ids = this.idx
    for (let k = 0; k < 6000 && trunks.length < 1100; k++) {
      let x: number, z: number
      if (k % 3 === 0) {
        const i = ids[Math.floor(this.rand() * ids.length)]!
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        const off = (this.rand() < 0.5 ? -1 : 1) * (15 + Math.pow(this.rand(), 1.5) * 160)
        x = p.x + r.x * off + (this.rand() - 0.5) * 20
        z = p.z + r.z * off + (this.rand() - 0.5) * 20
      } else {
        x = 380 + this.rand() * 620
        z = -1150 + this.rand() * 560
      }
      if (ctx.road.near(x, z, 19)) continue
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 12) continue
      const y = t.heightAt(x, z)
      if (y < 6 || y > 125) continue
      if (y > 30 && this.dSky.at(x, z) < 340) continue // no trees poking out of the clouds
      const n = t.normalAt(x, z)
      if (n.y < 0.8) continue
      // clumps: thin out where the noise says meadow
      if (fbm2(x * 0.012, z * 0.012) < 0.42) continue
      const h = 7 + this.rand() * 10
      const yaw = this.rand() * 6
      trunks.push(trs(x, y - 0.3, z, yaw, new THREE.Vector3(1, h * 0.35, 1)))
      for (let q = 0; q < 3; q++) {
        const ty = y + h * (0.18 + q * 0.24)
        const w = h * (0.32 - q * 0.075)
        const th = h * (0.42 - q * 0.06)
        tiers.push(trs(x, ty, z, yaw + q, new THREE.Vector3(w, th, w)))
        caps.push(trs(x, ty + th * 0.3, z, yaw + q, new THREE.Vector3(w * 0.82, th * 0.6, w * 0.82)))
        tint.push(new THREE.Color().setHSL(0.36 + this.rand() * 0.04, 0.35, 0.13 + this.rand() * 0.05))
      }
    }
    const needles = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.85, flatShading: true })
    this.group.add(
      instanced(trunk, new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }), trunks),
      instanced(tier, needles, tiers, tint),
      instanced(cap, snow, caps),
    )
  }

  /** Orange snow poles marking both road edges. */
  private buildPoles(): void {
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5)
    geo.translate(0, 1.1, 0)
    const mats: THREE.Matrix4[] = []
    for (let k = 0; k < this.idx.length; k += 9) {
      const i = this.idx[k]!
      if (this.iceIdx.has(i)) continue
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      for (const s of [-1, 1]) mats.push(trs(p.x + r.x * s * 12, p.y - 0.2, p.z + r.z * s * 12, 0, 1, (this.rand() - 0.5) * 0.08, 0))
    }
    const tex = canvasTexture(8, 64, (g, w, h) => {
      for (let y = 0; y < 8; y++) { g.fillStyle = y % 2 ? '#111' : '#ff6a00'; g.fillRect(0, (y * h) / 8, w, h / 8) }
    })
    this.group.add(instanced(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), mats))
    // ice-road markers: tall flagged stakes across the lake
    const stake = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 5)
    stake.translate(0, 1.6, 0)
    const st: THREE.Matrix4[] = []
    let c = 0
    for (const i of this.iceIdx) {
      if (c++ % 12) continue
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      for (const s of [-1, 1]) st.push(trs(p.x + r.x * s * 12.5, p.y - 0.3, p.z + r.z * s * 12.5))
    }
    this.group.add(instanced(stake, new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0x332a00 }), st))
  }

  /**
   * Avalanche gallery: a concrete half-tunnel on the climb, solid wall on
   * the mountain side, open pillars to the valley, snow piled on the roof.
   */
  private buildGallery(ctx: BuildCtx): void {
    const n = this.idx.length
    const run = this.idx.slice(Math.floor(n * 0.24), Math.floor(n * 0.36))
    if (run.length < 10) return
    this.gallery = new Set(run)
    const t = ctx.terrain
    const half = this.track.width / 2
    // which side is uphill?
    const mid = run[Math.floor(run.length / 2)]!
    const mp = this.track.samples[mid]!, mr = rightAt(this.track, mid)
    const side = t.heightAt(mp.x + mr.x * 30, mp.z + mr.z * 30) > t.heightAt(mp.x - mr.x * 30, mp.z - mr.z * 30) ? 1 : -1
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a7a0, roughness: 0.95 })
    const snow = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.9 })
    const H = 8
    const pos: number[] = [], idx: number[] = []
    const snowPos: number[] = [], snowIdx: number[] = []
    // profile across (a = lateral, h = height)
    const prof: [number, number][] = [
      [side * (half + 1.6), -0.5], [side * (half + 1.6), H], [-side * (half + 1.2), H], [-side * (half + 1.2), H + 1], [side * (half + 2.6), H + 1], [side * (half + 2.6), -0.5],
    ]
    const sProf: [number, number][] = [[-side * (half + 1.3), H + 1], [-side * (half - 2), H + 2.2], [side * (half + 4), H + 3.4], [side * (half + 9), H - 1]]
    run.forEach((i, k) => {
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      for (const [a, h] of prof) pos.push(p.x + r.x * a, p.y + h, p.z + r.z * a)
      for (const [a, h] of sProf) snowPos.push(p.x + r.x * a, p.y + h + (fbm2(k * 0.3, a) - 0.5) * 0.6, p.z + r.z * a)
      if (k > 0) {
        const R = prof.length, b = k * R, a0 = b - R
        for (let j = 0; j < R - 1; j++) idx.push(a0 + j, b + j, a0 + j + 1, a0 + j + 1, b + j, b + j + 1)
        const S = sProf.length, sb = k * S, sa = sb - S
        for (let j = 0; j < S - 1; j++) snowIdx.push(sa + j, sb + j, sa + j + 1, sa + j + 1, sb + j, sb + j + 1)
      }
    })
    const mk = (p: number[], ix: number[], m: THREE.Material) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
      g.setIndex(ix)
      g.computeVertexNormals()
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      ;(m as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      this.group.add(mesh)
    }
    mk(pos, idx, concrete)
    mk(snowPos, snowIdx, snow)
    // valley-side pillars and lights in the ceiling
    const pillar = new THREE.BoxGeometry(0.9, H, 0.9)
    pillar.translate(0, H / 2, 0)
    const pm: THREE.Matrix4[] = [], lm: THREE.Matrix4[] = []
    for (let k = 0; k < run.length; k += 4) {
      const i = run[k]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i), tg = this.track.tangents[i]!
      pm.push(trs(p.x - r.x * side * (half + 0.8), p.y - 0.5, p.z - r.z * side * (half + 0.8), Math.atan2(tg.x, tg.z)))
      lm.push(trs(p.x, p.y + H - 0.15, p.z, Math.atan2(tg.x, tg.z)))
    }
    this.group.add(instanced(pillar, concrete, pm))
    this.group.add(instanced(new THREE.BoxGeometry(1.4, 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2 }), lm, undefined, false))
  }

  /** Timber chalets by the lake, with chimney smoke. */
  private buildCabins(ctx: BuildCtx): void {
    const t = ctx.terrain
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.9 })
    const roofSnow = new THREE.MeshStandardMaterial({ color: 0xf5f8fc, roughness: 0.85 })
    const win = new THREE.MeshStandardMaterial({ color: 0x2a1f12, emissive: 0xffb050, emissiveIntensity: 1.2 })
    let placed = 0
    for (let k = 0; k < 40 && placed < 4; k++) {
      const a = this.rand() * Math.PI * 2
      const x = LAKE.x + Math.cos(a) * (LAKE.r + 30), z = LAKE.z + Math.sin(a) * (LAKE.r + 30)
      if (ctx.road.near(x, z, 22)) continue
      const y = t.heightAt(x, z)
      const g = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), wood)
      body.position.y = 2
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.6, 3.2, 4, 1), roofSnow)
      roof.position.y = 5.6
      roof.rotation.y = Math.PI / 4
      roof.scale.set(1.15, 1, 0.95)
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x5c5650 }))
      chimney.position.set(1.6, 6.6, 1)
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), win)
      w1.position.set(-1.6, 2.2, 3.01)
      const w2 = w1.clone()
      w2.position.x = 1.6
      g.add(body, roof, chimney, w1, w2)
      g.position.set(x, y - 0.2, z)
      g.rotation.y = Math.atan2(LAKE.x - x, LAKE.z - z)
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
      this.group.add(g)
      for (let q = 0; q < 4; q++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xdddddd, transparent: true, depthWrite: false }))
        s.userData['base'] = new THREE.Vector3(x, y + 7.8, z).add(new THREE.Vector3(1.6, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y))
        s.userData['phase'] = q / 4
        this.smoke.push(s)
        this.group.add(s)
      }
      placed++
    }
  }

  /** Chairlift from the lake shore up the slope, with moving chairs. */
  private buildSkiLift(t: Terrain): void {
    // run away from the road: up the slope on the lake's far side
    const a0 = new THREE.Vector3(LAKE.x - 60, 0, LAKE.z + 60)
    const a1 = new THREE.Vector3(LAKE.x - 130, 0, LAKE.z + 100)
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b9196, metalness: 0.7, roughness: 0.4 })
    const N = 4
    const tops: THREE.Vector3[] = []
    for (let k = 0; k <= N; k++) {
      const p = a0.clone().lerp(a1, k / N)
      const y = t.heightAt(p.x, p.z)
      const h = k === 0 || k === N ? 6 : 12
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 8), steel)
      tower.position.set(p.x, y + h / 2, p.z)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 0.4), steel)
      arm.position.set(p.x, y + h, p.z)
      arm.rotation.y = Math.atan2(a1.x - a0.x, a1.z - a0.z) + Math.PI / 2
      tower.castShadow = arm.castShadow = true
      this.group.add(tower, arm)
      if (k === 0 || k === N) {
        const house = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), new THREE.MeshStandardMaterial({ color: 0xb03024, roughness: 0.8 }))
        house.position.set(p.x, y + 2.5, p.z)
        house.castShadow = true
        this.group.add(house)
      }
      tops.push(new THREE.Vector3(p.x, y + h - 0.2, p.z))
    }
    this.cable = tops
    const lg = new THREE.BufferGeometry().setFromPoints(tops)
    this.group.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x222222 })))
    const chair = new THREE.BoxGeometry(1.6, 0.25, 0.8)
    const hanger = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 4)
    hanger.translate(0, 1.2, 0)
    chair.translate(0, 0, 0)
    const merged = mergeTwo(chair, hanger)
    this.chairs = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ color: 0x2b2f6b, roughness: 0.6 }), 24)
    this.chairs.castShadow = true
    this.group.add(this.chairs)
  }

  /**
   * Two avalanches. The first chases you into the concrete gallery, which
   * shelters you; the second runs from there over the ice to the summit.
   */
  private buildAvalanche(ctx: BuildCtx): void {
    this.terrain = ctx.terrain
    const n = this.idx.length
    const mk = (a: number, b: number, end: string) => new Chase(this.track, this.idx.slice(Math.floor(n * a), Math.floor(n * b)), {
      label: 'AVALANCHE', loop: 'avalanche', startSfx: 'whumpf', caughtSfx: 'whumpf', color: '#bfe6ff', startGap: 38, base: 56, holdGap: 14,
      startText: 'AVALANCHE  GO', caughtText: 'BURIED IN SNOW',
      endText: (m) => `${end}  ${m} M CLEAR  NITRO FULL`,
    })
    this.chases = [mk(0.06, 0.25, 'SAFE IN THE GALLERY'), mk(0.37, 0.97, 'OUTRAN THE AVALANCHE')]
    const puff = puffTexture()
    for (let k = 0; k < 64; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xf4f8ff, transparent: true, depthWrite: false, opacity: 0 }))
      s.visible = false
      s.userData['u'] = this.rand()
      s.userData['v'] = this.rand()
      s.userData['w'] = this.rand()
      this.powder.push(s)
      this.group.add(s)
    }
    const geo = lumpy(new THREE.IcosahedronGeometry(1, 4), 0.34, 2.6, 4)
    const mat = new THREE.MeshStandardMaterial({ color: 0xf6f9fd, emissive: 0x8a97a8, emissiveIntensity: 0.5, roughness: 1 })
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(geo, mat)
      m.visible = false
      m.castShadow = true
      // a soft shell of powder hides the hard outline
      for (let q = 0; q < 3; q++) {
        const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xf6faff, transparent: true, depthWrite: false, opacity: 0.8 }))
        p.position.set(q - 1, 0.3, 0.6 - q * 0.6)
        p.scale.setScalar(3.4)
        m.add(p)
      }
      this.group.add(m)
      this.balls.push({ m, live: false, t: 0, i: 0, side: 1, lat0: 0, r: 2 })
    }
  }

  /** +1 when the mountain rises on the road's right at sample i, else -1. */
  private uphill(i: number): number {
    const p = this.track.samples[i]!, r = rightAt(this.track, i)
    return this.terrain.heightAt(p.x + r.x * 40, p.z + r.z * 40) >= this.terrain.heightAt(p.x - r.x * 40, p.z - r.z * 40) ? 1 : -1
  }

  private updateAvalanche(f: FrameCtx, ev: BiomeEvents): void {
    let run: Chase | null = null
    for (const c of this.chases) { c.update(f, ev); if (c.running) run = c }
    for (const s of this.powder) s.visible = !!run
    const t = this.track
    if (run) {
      const c = run, ids = c.ids
      // a wall of powder pouring down the slope alongside the car; the closer
      // it is, the further it reaches past you and the nearer the road it runs
      const close = Math.max(0, Math.min(1, 1 - c.gap / 95))
      const k1 = c.kAt(Math.max(0, c.front)), k2 = Math.min(ids.length - 1, c.carK + 30 + Math.round(close * 70))
      const side = this.uphill(ids[c.carK]!)
      for (const s of this.powder) {
        const u = ((s.userData['u'] as number) + f.time * 0.05) % 1, v = s.userData['v'] as number, w = s.userData['w'] as number
        const i = ids[k1 + Math.floor(u * Math.max(1, k2 - k1))]!
        const p = t.samples[i]!, r = rightAt(t, i)
        const lat = side * (lerp(40, 15, close) + v * 42)
        const x = p.x + r.x * lat, z = p.z + r.z * lat
        const y = Math.max(p.y, this.terrain.heightAt(x, z))
        s.position.set(x, y + 3 + w * 16 + Math.sin(f.time * 2 + v * 9) * 1.5, z)
        s.scale.setScalar(16 + w * 22)
        ;(s.material as THREE.SpriteMaterial).opacity = 0.75
      }
      // snowballs break off the front and roll across the road ahead
      this.nextBall -= f.dt
      if (this.nextBall <= 0) {
        this.nextBall = 1.2 + this.rand() * 1.3
        const b = this.balls.find((q) => !q.live)
        const k = Math.min(ids.length - 1, c.carK + Math.round(Math.max(f.carSpeed, 20) * 1.5))
        if (b && !this.iceIdx.has(ids[k]!)) {
          b.live = true
          b.t = 0
          b.i = ids[k]!
          b.side = this.uphill(b.i)
          b.lat0 = (this.rand() - 0.5) * 14
          b.r = 1.1 + this.rand() * 0.7
          b.m.scale.setScalar(b.r)
          b.m.visible = true
        }
      }
    }
    for (const b of this.balls) {
      if (!b.live) continue
      b.t += f.dt
      // crosses the road's centre after about 1.5 s
      const lat = b.lat0 + b.side * (1.5 - b.t) * 32
      const p = t.samples[b.i]!, r = rightAt(t, b.i)
      const x = p.x + r.x * lat, z = p.z + r.z * lat
      const road = Math.abs(lat) < t.width / 2 + 1
      b.m.position.set(x, (road ? p.y : Math.max(p.y, this.terrain.heightAt(x, z))) + b.r * 0.9, z)
      b.m.rotation.x += f.dt * 7
      if (Math.hypot(f.carPos.x - x, f.carPos.z - z) < b.r + 1.8) {
        ev.hit(0.7)
        ev.sfx('thud')
        b.live = false
        b.m.visible = false
      }
      if (b.t > 3.6) { b.live = false; b.m.visible = false }
    }
  }

  inGallery(i: number): boolean {
    return this.gallery.has(i)
  }

  surface(i: number): { slip: number; drag: number } | null {
    return this.iceIdx.has(i) ? { slip: 0.85, drag: 0 } : null
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    // ice drift scoring
    const ice = this.iceIdx.has(f.carIdx)
    if (ice) {
      this.onIce = true
    } else if (this.onIce) {
      this.onIce = false
      if (this.drift > 150) ev.toast(`ICE DRIFT  ${Math.round(this.drift).toLocaleString()} PTS`, this.drift > 2500 ? 'best' : 'info')
      this.drift = 0
    }
    if (!this.group.visible) return
    this.updateAvalanche(f, ev)
    for (const s of this.smoke) {
      const ph = (s.userData['phase'] as number + f.time * 0.1) % 1
      const b = s.userData['base'] as THREE.Vector3
      s.position.set(b.x + ph * 4, b.y + ph * 12, b.z + ph * 2)
      s.scale.setScalar(1.5 + ph * 7)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - ph) * smooth(0, 0.1, ph)
    }
    if (this.chairs && this.cable.length > 1) {
      const m = new THREE.Matrix4()
      const segs = this.cable.length - 1
      const total = 24
      for (let k = 0; k < total; k++) {
        // up one side of the loop, down the other (offset 1.6 m)
        let u = (k / total + f.time * 0.012) % 1
        const back = u > 0.5
        u = back ? 1 - (u - 0.5) * 2 : u * 2
        const s = u * segs
        const a = Math.min(segs - 1, Math.floor(s))
        const p = this.cable[a]!.clone().lerp(this.cable[a + 1]!, s - a)
        const d = this.cable[a + 1]!.clone().sub(this.cable[a]!).setY(0).normalize()
        const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(back ? 2 : -2)
        m.compose(p.add(side).setY(p.y - 2.6), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.x, d.z)), new THREE.Vector3(1, 1, 1))
        this.chairs.setMatrixAt(k, m)
      }
      this.chairs.instanceMatrix.needsUpdate = true
    }
  }

  /** Called by the game with the car's sideways slip while on the lake. */
  addDrift(slip: number, speed: number, dt: number): void {
    if (this.onIce && slip > 0.18 && speed > 12) this.drift += slip * speed * dt * 12
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.index ? a.toNonIndexed() : a
  const B = b.index ? b.toNonIndexed() : b
  const pa = A.getAttribute('position') as THREE.BufferAttribute
  const pb = B.getAttribute('position') as THREE.BufferAttribute
  const pos = new Float32Array((pa.count + pb.count) * 3)
  pos.set(pa.array as Float32Array, 0)
  pos.set(pb.array as Float32Array, pa.count * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}
