import * as THREE from 'three'
import { LANDMARKS } from '../trackData'
import type { Biome, BuildCtx, FrameCtx } from './types'
import type { TerrainField, RoadMode, Terrain } from './Terrain'
import type { Track } from '../Track'
import { treePool, bushGeometry } from '../Trees'
import {
  biomeGroup, fbm2, smooth, lerp, rng, zoneIndices, rightAt, instanced, trs, lumpy,
  canvasTexture, ZoneDistance, puffTexture, softDot, roadSign, besideRoad,
} from './kit'

const BRIDGE = LANDMARKS.jungleBridge

/** Rainforest: a road behind a waterfall, a rope bridge, temple ruins. */
export class Jungle implements Biome {
  readonly name = 'jungle'
  readonly group = biomeGroup('jungle')
  private readonly rand = rng(17)
  private readonly idx: number[]
  private dJungle!: ZoneDistance
  /** Waterfall: road point, its right vector and up the cliff on the left. */
  private readonly wP: THREE.Vector3
  private readonly wR: THREE.Vector3
  private readonly wT: THREE.Vector3
  private river: THREE.Vector3[] = []
  private waterTex: THREE.CanvasTexture[] = []
  private mist: THREE.Sprite[] = []
  private rays: THREE.Mesh[] = []
  private parrots: THREE.InstancedMesh | null = null
  private mudIdx = new Set<number>()
  private waterMats: THREE.MeshStandardMaterial[] = []

  constructor(private readonly track: Track) {
    this.idx = zoneIndices(track, 'jungle')
    const wi = this.idx[Math.floor(this.idx.length * 0.08)]!
    this.wP = track.samples[wi]!.clone()
    this.wR = rightAt(track, wi)
    this.wT = track.tangents[wi]!.clone().setY(0).normalize()
    // river: from the plunge pool, down the valley, under the bridge
    const pool = this.wP.clone().addScaledVector(this.wR, 34)
    const bi = this.idx.reduce((best, i) => {
      const p = track.samples[i]!, b = track.samples[best]!
      return Math.hypot(p.x - BRIDGE.x, p.z - BRIDGE.z) < Math.hypot(b.x - BRIDGE.x, b.z - BRIDGE.z) ? i : best
    }, this.idx[0]!)
    const br = rightAt(track, bi)
    const bp = track.samples[bi]!
    const pts = [
      pool.clone().setY(this.wP.y - 6.5),
      pool.clone().lerp(new THREE.Vector3(bp.x, 0, bp.z).addScaledVector(br, 60), 0.5).setY(lerp(this.wP.y - 6.5, 2.4, 0.5)),
      new THREE.Vector3(bp.x, 2.2, bp.z).addScaledVector(br, 28),
      new THREE.Vector3(bp.x, 2.0, bp.z),
      new THREE.Vector3(bp.x, 1.8, bp.z).addScaledVector(br, -60),
      new THREE.Vector3(bp.x, 1.6, bp.z).addScaledVector(br, -150),
    ]
    const curve = new THREE.CatmullRomCurve3(pts)
    this.river = curve.getPoints(80)
    // mud on the road in a few places
    for (const f of [0.38, 0.86]) {
      const c = Math.floor(this.idx.length * f)
      for (let k = -14; k <= 14; k++) this.mudIdx.add(this.idx[c + k]!)
    }
  }

  private riverNear(x: number, z: number): { d: number; y: number } {
    let best = 1e9, y = 0
    for (let k = 0; k < this.river.length; k += 2) {
      const p = this.river[k]!
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < best) { best = d; y = p.y }
    }
    return { d: best, y }
  }

  fields(): TerrainField[] {
    this.dJungle = new ZoneDistance(this.track, ['jungle'], -1000, -1300, 1300, -40, 10)
    const field: TerrainField = {
      weight: (x, z) => (1 - smooth(200, 290, this.dJungle.at(x, z))) * 1.5,
      height: (x, z) => {
        let h = 9 + fbm2(x * 0.008, z * 0.008) * 30 + fbm2(x * 0.03, z * 0.03) * 4
        // waterfall cliff on the left of the road, plunge basin on the right
        const dx = x - this.wP.x, dz = z - this.wP.z
        const lat = dx * this.wR.x + dz * this.wR.z
        const along = dx * this.wT.x + dz * this.wT.z
        const band = 1 - smooth(30, 70, Math.abs(along))
        if (lat < -10) h = Math.max(h, lerp(h, this.wP.y + 30, band * smooth(-10, -24, lat)))
        if (lat > 14) h = lerp(h, Math.min(h, this.wP.y - 7), band * smooth(14, 22, lat) * (1 - smooth(60, 90, lat)))
        // river valley and gorge
        const rv = this.riverNear(x, z)
        if (rv.d < 60) h = lerp(rv.y - 1.6, h, smooth(6, 60, rv.d) * (0.6 + 0.4 * smooth(20, 60, rv.d)))
        return h
      },
      color: (x, z, h, slope, out) => {
        const n = fbm2(x * 0.05, z * 0.05)
        const moss = new THREE.Color(0.3 + n * 0.08, 0.42 + n * 0.1, 0.17)
        const earth = new THREE.Color(0.45, 0.34, 0.22)
        const rock = new THREE.Color(0.46, 0.46, 0.4)
        out.copy(moss).lerp(earth, smooth(0.45, 0.25, n) * 0.6).lerp(rock, smooth(0.8, 1.3, slope))
        const rv = this.riverNear(x, z)
        out.lerp(new THREE.Color(0.4, 0.33, 0.24), smooth(14, 5, rv.d) * 0.8)
        void h
      },
      mask: (x, z, _h, out) => {
        const rv = this.riverNear(x, z)
        out.set(0, 0, 0, 0.5 + 0.5 * smooth(18, 6, rv.d))
      },
      surface: 3,
    }
    return [field]
  }

  roadMode(i: number): RoadMode | undefined {
    if (this.track.zoneOfSample(i) !== 'jungle') return undefined
    const p = this.track.samples[i]!
    return Math.hypot(p.x - BRIDGE.x, p.z - BRIDGE.z) < BRIDGE.half + 4 ? 'bridge' : undefined
  }

  build(ctx: BuildCtx): void {
    this.buildWater()
    this.buildWaterfall()
    this.buildBridge()
    this.buildTrees(ctx)
    this.buildUndergrowth(ctx)
    this.buildRuins(ctx)
    this.buildRays()
    this.buildParrots()
    this.buildMud()
    const i = this.idx[Math.floor(this.idx.length * 0.06)]!
    this.group.add(besideRoad(this.track, i, 14, roadSign(['RAINFOREST', 'WET SURFACE'], '#1e5a2a', '#ffffff')))
  }

  private waterMaterial(): THREE.MeshStandardMaterial {
    const nTex = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = 'rgb(128,128,255)'
      g.fillRect(0, 0, w, w)
      for (let k = 0; k < 500; k++) {
        const x = Math.random() * w, y = Math.random() * w
        g.fillStyle = `rgba(${100 + Math.random() * 56},${100 + Math.random() * 56},255,0.35)`
        g.beginPath(); g.ellipse(x, y, 8 + Math.random() * 14, 3 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2); g.fill()
      }
    }, false)
    nTex.wrapS = nTex.wrapT = THREE.RepeatWrapping
    nTex.repeat.set(6, 6)
    this.waterTex.push(nTex)
    const m = new THREE.MeshStandardMaterial({
      color: 0x1f4a3e, roughness: 0.08, metalness: 0.1, normalMap: nTex, normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true, opacity: 0.88,
    })
    this.waterMats.push(m)
    return m
  }

  private buildWater(): void {
    const mat = this.waterMaterial()
    // river ribbon, flat across, following the bed down the valley
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    let along = 0
    this.river.forEach((p, k) => {
      const q = this.river[Math.min(k + 1, this.river.length - 1)]!, o = this.river[Math.max(k - 1, 0)]!
      const d = q.clone().sub(o).setY(0).normalize()
      const r = new THREE.Vector3(-d.z, 0, d.x)
      if (k > 0) along += p.distanceTo(this.river[k - 1]!)
      const w = k < 6 ? 16 : 9
      pos.push(p.x - r.x * w, p.y, p.z - r.z * w, p.x + r.x * w, p.y, p.z + r.z * w)
      uv.push(0, along / 20, 1, along / 20)
      if (k < this.river.length - 1) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const river = new THREE.Mesh(g, mat)
    river.receiveShadow = true
    this.group.add(river)
    // the plunge pool
    const pool = new THREE.Mesh(new THREE.CircleGeometry(20, 40), mat)
    pool.rotation.x = -Math.PI / 2
    pool.position.copy(this.river[0]!).setY(this.river[0]!.y + 0.05)
    this.group.add(pool)
    // river rocks
    const rockGeo = lumpy(new THREE.DodecahedronGeometry(1, 1), 0.25, 1.1, 8)
    const mats: THREE.Matrix4[] = []
    for (let k = 0; k < 90; k++) {
      const p = this.river[Math.floor(this.rand() * this.river.length)]!
      const s = 0.6 + this.rand() * 2.2
      mats.push(trs(p.x + (this.rand() - 0.5) * 22, p.y - 0.2, p.z + (this.rand() - 0.5) * 22, this.rand() * 6, new THREE.Vector3(s, s * 0.6, s)))
    }
    this.group.add(instanced(rockGeo, new THREE.MeshStandardMaterial({ color: 0x4e5248, roughness: 0.7, flatShading: true }), mats))
  }

  /** Cliff overhang above the road; the falls pour off its lip in front of it. */
  private buildWaterfall(): void {
    const P = this.wP, R = this.wR, T = this.wT
    const half = this.track.width / 2
    const yaw = Math.atan2(T.x, T.z)
    const rock = new THREE.MeshStandardMaterial({ color: 0x4a4a40, roughness: 0.95, flatShading: true })
    const moss = new THREE.MeshStandardMaterial({ color: 0x3f6a2a, roughness: 1, flatShading: true })
    // overhang roof: a thick slab from the cliff to just past the right edge
    const roof = new THREE.Mesh(lumpy(new THREE.BoxGeometry(34, 6, 70, 6, 2, 10), 1.6, 0.12, 4), rock)
    roof.position.copy(P).addScaledVector(R, -4).setY(P.y + 14.5)
    roof.rotation.y = yaw
    roof.castShadow = true
    roof.receiveShadow = true
    const mossCap = new THREE.Mesh(lumpy(new THREE.BoxGeometry(34, 1.4, 70, 6, 1, 10), 0.8, 0.15, 6), moss)
    mossCap.position.copy(roof.position).setY(roof.position.y + 3.4)
    mossCap.rotation.y = yaw
    // the cliff wall on the left
    const wall = new THREE.Mesh(lumpy(new THREE.BoxGeometry(10, 34, 90, 4, 8, 12), 2.2, 0.08, 9), rock)
    wall.position.copy(P).addScaledVector(R, -(half + 7)).setY(P.y + 8)
    wall.rotation.y = yaw
    wall.castShadow = true
    wall.receiveShadow = true
    this.group.add(roof, mossCap, wall)
    // hanging vines off the lip
    const vineMats: THREE.Matrix4[] = []
    const vine = new THREE.CylinderGeometry(0.03, 0.05, 1, 4)
    vine.translate(0, -0.5, 0)
    for (let k = 0; k < 60; k++) {
      const a = (this.rand() - 0.5) * 66
      const lat = -18 + this.rand() * 32
      // over the road they stop well above the car
      const len = Math.abs(lat) < half + 2 ? 1 + this.rand() * 4 : 2 + this.rand() * 7
      vineMats.push(trs(P.x + T.x * a + R.x * lat, P.y + 11.6, P.z + T.z * a + R.z * lat, 0, new THREE.Vector3(1, len, 1)))
    }
    this.group.add(instanced(vine, new THREE.MeshStandardMaterial({ color: 0x33402a, roughness: 1 }), vineMats, undefined, false))
    // the falling curtain: two layers of scrolling streaks
    const tex = canvasTexture(128, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h)
      for (let k = 0; k < 260; k++) {
        const x = Math.random() * w
        g.fillStyle = `rgba(235,248,255,${0.15 + Math.random() * 0.5})`
        g.fillRect(x, Math.random() * h, 1 + Math.random() * 3, 30 + Math.random() * 120)
      }
    })
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    this.waterTex.push(tex)
    const top = P.y + 13, bottom = P.y - 7
    const curtainGeo = new THREE.PlaneGeometry(64, top - bottom, 1, 1)
    for (const [off, op, rep] of [[half + 2.5, 0.85, 1.8], [half + 4, 0.55, 1.3]] as const) {
      const t2 = tex.clone()
      t2.repeat.set(3, rep)
      this.waterTex.push(t2)
      const m = new THREE.MeshBasicMaterial({ map: t2, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, color: 0xe6f6ff })
      const c = new THREE.Mesh(curtainGeo, m)
      c.position.copy(P).addScaledVector(R, off).setY((top + bottom) / 2)
      c.rotation.y = yaw + Math.PI / 2
      c.renderOrder = 3
      this.group.add(c)
    }
    // spray where it hits the pool, and a fine mist over the road
    for (let k = 0; k < 16; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.5 }))
      const a = (this.rand() - 0.5) * 60
      s.position.copy(P).addScaledVector(T, a).addScaledVector(R, half + 6 + this.rand() * 8).setY(bottom + 2 + this.rand() * 6)
      s.scale.setScalar(10 + this.rand() * 10)
      s.userData['base'] = s.position.clone()
      s.userData['phase'] = this.rand() * 6
      this.mist.push(s)
      this.group.add(s)
    }
  }

  /** Rope rails: posts, top and middle ropes and vertical hangers. */
  private buildBridge(): void {
    const ids = this.idx.filter((i) => this.track.isPlankDeck(i))
    if (ids.length < 4) return
    const half = this.track.width / 2 + 0.3
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 })
    const rope = new THREE.MeshStandardMaterial({ color: 0x9a8058, roughness: 1 })
    const postGeo = new THREE.CylinderGeometry(0.16, 0.2, 2.2, 6)
    postGeo.translate(0, 1.1, 0)
    const posts: THREE.Matrix4[] = []
    for (const s of [-1, 1]) {
      const tops: THREE.Vector3[] = [], mids: THREE.Vector3[] = []
      ids.forEach((i, k) => {
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        const x = p.x + r.x * s * half, z = p.z + r.z * s * half
        const sagUp = Math.sin((k / (ids.length - 1)) * Math.PI) * 0.6
        tops.push(new THREE.Vector3(x, p.y + 2.1 + sagUp, z))
        mids.push(new THREE.Vector3(x, p.y + 1.1 + sagUp * 0.5, z))
        if (k % 8 === 0 || k === ids.length - 1) posts.push(trs(x, p.y - 0.1, z))
      })
      for (const line of [tops, mids]) {
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length, 0.07, 5), rope)
        this.group.add(tube)
      }
      // main suspension cables from tall end posts
      const a = tops[0]!, b = tops[tops.length - 1]!
      const main: THREE.Vector3[] = []
      for (let k = 0; k <= 30; k++) {
        const u = k / 30
        main.push(a.clone().lerp(b, u).setY(lerp(a.y, b.y, u) + 4.5 - Math.sin(u * Math.PI) * 4.2))
      }
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(main), 40, 0.12, 6), rope))
      for (const end of [a, b]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 8, 6), wood)
        tower.position.copy(end).setY(end.y + 1.8)
        tower.castShadow = true
        this.group.add(tower)
      }
      // hangers
      for (let k = 2; k < main.length - 2; k += 2) {
        const top = main[k]!
        const bot = tops[Math.round((k / 30) * (tops.length - 1))]!
        const len = top.y - bot.y
        if (len < 0.3) continue
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 4), rope)
        h.position.set(bot.x, bot.y + len / 2, bot.z)
        this.group.add(h)
      }
    }
    this.group.add(instanced(postGeo, wood, posts))
  }

  /** Giant rainforest trees (scaled-up broadleaf), palms, tree ferns. */
  private buildTrees(ctx: BuildCtx): void {
    const t = ctx.terrain
    const big: THREE.Matrix4[] = [], palms: THREE.Matrix4[] = []
    for (let k = 0; k < 8000 && big.length + palms.length < 520; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (15 + Math.pow(this.rand(), 1.3) * 190)
      const x = p.x + r.x * off + (this.rand() - 0.5) * 30, z = p.z + r.z * off + (this.rand() - 0.5) * 30
      // big crowns spread ~10 m: keep them off the road and the camera
      if (ctx.road.near(x, z, 26)) continue
      if (this.riverNear(x, z).d < 12) continue
      const y = t.heightAt(x, z)
      if (y < 1) continue
      if (t.normalAt(x, z).y < 0.7) continue
      const palm = this.rand() < 0.3 && Math.abs(off) < 60
      const s = palm ? 1 + this.rand() * 0.6 : 2 + this.rand() * 1.3
      ;(palm ? palms : big).push(trs(x, y - 0.3, z, this.rand() * 6, palm ? s : new THREE.Vector3(s * 0.9, s * (1.3 + this.rand() * 0.4), s * 0.9)))
    }
    this.group.add(instanceVariants(treePool('broadleaf'), big, this.rand))
    this.group.add(instanceVariants(treePool('palm'), palms, this.rand))
    // tree ferns: a trunk with a crown of drooping fronds
    const fern = fernGeometry()
    const ferns: THREE.Matrix4[] = []
    for (let k = 0; k < 2000 && ferns.length < 260; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (13 + this.rand() * 50)
      const x = p.x + r.x * off, z = p.z + r.z * off
      if (ctx.road.near(x, z, 12.5)) continue
      const y = t.heightAt(x, z)
      if (y < 1) continue
      const s = 0.8 + this.rand() * 1.2
      ferns.push(trs(x, y - 0.1, z, this.rand() * 6, s))
    }
    this.group.add(instanced(fern.geometry, fern.material, ferns))
  }

  /** Dense bushes, broad leaves and flowering heliconia along the verges. */
  private buildUndergrowth(ctx: BuildCtx): void {
    const t = ctx.terrain
    const bush = bushGeometry()
    const mats: THREE.Matrix4[] = [], flowers: THREE.Matrix4[] = []
    const fl: THREE.Color[] = []
    for (let k = 0; k < 9000 && mats.length < 1500; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (12 + Math.pow(this.rand(), 2) * 80)
      const x = p.x + r.x * off + (this.rand() - 0.5) * 6, z = p.z + r.z * off + (this.rand() - 0.5) * 6
      if (ctx.road.near(x, z, 15)) continue
      const y = t.heightAt(x, z)
      if (y < 1) continue
      const s = 1 + this.rand() * 1.8
      mats.push(trs(x, y - 0.2, z, this.rand() * 6, new THREE.Vector3(s, s * (0.8 + this.rand() * 0.6), s)))
      if (this.rand() < 0.25) {
        flowers.push(trs(x + (this.rand() - 0.5), y + s * 0.9, z + (this.rand() - 0.5), this.rand() * 6, 0.22 + this.rand() * 0.15))
        fl.push(new THREE.Color().setHSL([0.0, 0.05, 0.12, 0.9][Math.floor(this.rand() * 4)]!, 0.85, 0.5))
      }
    }
    const bm = bush.material.clone()
    bm.color.setRGB(0.55, 0.85, 0.45)
    this.group.add(instanced(bush.geometry, bm, mats))
    this.group.add(instanced(new THREE.ConeGeometry(1, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x220800 }), flowers, fl, false))
  }

  /** A stepped temple pyramid, a broken stone arch and fallen carved heads. */
  private buildRuins(ctx: BuildCtx): void {
    const stoneTex = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#7c7865'
      g.fillRect(0, 0, w, w)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
        const v = 100 + Math.random() * 40
        g.fillStyle = `rgb(${v},${v - 4},${v - 22})`
        g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28)
      }
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(50,90,30,${Math.random() * 0.5})`; g.fillRect(Math.random() * w, Math.random() * w, 4, 4) }
    })
    stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 })
    // pyramid
    const i = this.idx[Math.floor(this.idx.length * 0.72)]!
    const p = this.track.samples[i]!, r = rightAt(this.track, i), tg = this.track.tangents[i]!
    const cx = p.x - r.x * 62, cz = p.z - r.z * 62
    const base = ctx.terrain.heightAt(cx, cz) - 1
    const pyr = new THREE.Group()
    for (let k = 0; k < 6; k++) {
      const w = 40 - k * 6
      const tex = stoneTex.clone()
      tex.repeat.set(w / 8, 1)
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, w), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }))
      step.position.y = 2.1 + k * 4.2
      pyr.add(step)
    }
    const shrine = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8), stone)
    shrine.position.y = 6 * 4.2 + 3
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshStandardMaterial({ color: 0x0a0806 }))
    door.position.set(0, 6 * 4.2 + 1.9, 4.02)
    const stairs = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 2), stone)
    stairs.position.set(0, 12.5, 20)
    stairs.rotation.x = -0.88
    pyr.add(shrine, door, stairs)
    pyr.position.set(cx, base, cz)
    pyr.rotation.y = Math.atan2(p.x - cx, p.z - cz)
    pyr.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
    this.group.add(pyr)
    // broken arch over the road
    const j = this.idx[Math.floor(this.idx.length * 0.58)]!
    const q = this.track.samples[j]!, rq = rightAt(this.track, j), tq = this.track.tangents[j]!
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), stone)
      pil.position.set(q.x + rq.x * s * 13, q.y + 5, q.z + rq.z * s * 13)
      pil.rotation.y = Math.atan2(tq.x, tq.z)
      pil.castShadow = true
      this.group.add(pil)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(17, 2.2, 2.6), stone)
    lintel.position.set(q.x - rq.x * 4.5, q.y + 11.4, q.z - rq.z * 4.5)
    lintel.rotation.y = Math.atan2(-tq.x, -tq.z)
    lintel.rotation.z = 0.06
    lintel.castShadow = true
    this.group.add(lintel)
    // fallen carved heads and column drums by the road
    for (let k = 0; k < 7; k++) {
      const m = this.idx[Math.floor(this.idx.length * (0.45 + this.rand() * 0.45))]!
      const sp = this.track.samples[m]!, sr = rightAt(this.track, m)
      const off = (this.rand() < 0.5 ? -1 : 1) * (22 + this.rand() * 12)
      const x = sp.x + sr.x * off, z = sp.z + sr.z * off
      const y = ctx.terrain.heightAt(x, z)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 2.4, 14), stone)
      head.position.set(x, y + 0.9, z)
      head.rotation.set(this.rand() * 0.4, this.rand() * 6, Math.PI / 2)
      head.castShadow = true
      this.group.add(head)
    }
    void tg
  }

  /** Slanting sun shafts through the canopy (additive light cards). */
  private buildRays(): void {
    const tex = canvasTexture(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h)
      gr.addColorStop(0, 'rgba(255,240,200,0.9)')
      gr.addColorStop(1, 'rgba(255,240,200,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
      const gx = g.createLinearGradient(0, 0, w, 0)
      gx.addColorStop(0, 'rgba(0,0,0,1)')
      gx.addColorStop(0.5, 'rgba(0,0,0,0)')
      gx.addColorStop(1, 'rgba(0,0,0,1)')
      g.globalCompositeOperation = 'destination-out'
      g.fillStyle = gx
      g.fillRect(0, 0, w, h)
    })
    for (let k = 0; k < 16; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() - 0.5) * 40
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6 + this.rand() * 6, 40), new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }))
      m.position.set(p.x + r.x * off, p.y + 18, p.z + r.z * off)
      m.rotation.set(0, this.rand() * 6, 0.35)
      m.userData['phase'] = this.rand() * 6
      this.rays.push(m)
      this.group.add(m)
    }
  }

  private buildParrots(): void {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.9, 0.2, 0, 0, 0, 0.25, 0, 0, -0.35, 0, 0, -0.35, 0, 0, 0.25, 0.9, 0.2, 0,
      0, 0, 0.5, 0.12, 0, -0.9, -0.12, 0, -0.9,
    ], 3))
    g.computeVertexNormals()
    this.parrots = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 14)
    const cols = [0xe0291b, 0x1d9be0, 0xf2c014, 0x2bbf4a]
    for (let k = 0; k < 14; k++) this.parrots.setColorAt(k, new THREE.Color(cols[k % 4]!))
    this.group.add(this.parrots)
  }

  /** Dark glossy mud slicks on the road (they also sap grip and speed). */
  private buildMud(): void {
    const tex = canvasTexture(256, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h)
      for (let k = 0; k < 40; k++) {
        const x = w * (0.15 + Math.random() * 0.7), y = Math.random() * h, rx = 20 + Math.random() * 60, ry = 30 + Math.random() * 90
        const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry))
        gr.addColorStop(0, 'rgba(58,40,24,0.95)')
        gr.addColorStop(0.7, 'rgba(70,50,30,0.6)')
        gr.addColorStop(1, 'rgba(70,50,30,0)')
        g.fillStyle = gr
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill()
      }
    })
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })
    const groups = new Map<number, number[]>()
    for (const i of [...this.mudIdx].sort((a, b) => a - b)) {
      const key = Math.floor(i / 40)
      ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(i)
    }
    for (const ids of groups.values()) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = []
      ids.forEach((i, k) => {
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        pos.push(p.x - r.x * 10, p.y + 0.06, p.z - r.z * 10, p.x + r.x * 10, p.y + 0.06, p.z + r.z * 10)
        uv.push(0, k / (ids.length - 1), 1, k / (ids.length - 1))
        if (k < ids.length - 1) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3)
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(idx)
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, mat)
      m.receiveShadow = true
      m.renderOrder = 1
      this.group.add(m)
    }
  }

  surface(i: number): { slip: number; drag: number } | null {
    return this.mudIdx.has(i) ? { slip: 0.45, drag: 7 } : null
  }

  update(f: FrameCtx): void {
    if (!this.group.visible) return
    for (const t of this.waterTex) t.offset.y = (t.offset.y + f.dt * (t.repeat.y > 2 ? 0.05 : 0.9)) % 1
    for (const s of this.mist) {
      const b = s.userData['base'] as THREE.Vector3, ph = s.userData['phase'] as number
      s.position.set(b.x, b.y + Math.sin(f.time * 0.8 + ph) * 1.5, b.z)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.35 + 0.15 * Math.sin(f.time + ph)
    }
    for (const r of this.rays) (r.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(f.time * 0.4 + (r.userData['phase'] as number))
    if (this.parrots) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
      const c = this.track.samples[this.idx[Math.floor(this.idx.length * 0.5)]!]!
      for (let k = 0; k < 14; k++) {
        const a = f.time * (0.25 + (k % 3) * 0.05) + k * 0.45
        const rad = 40 + (k % 4) * 12
        const flap = Math.sin(f.time * 14 + k * 2)
        q.setFromEuler(e.set(0, -a, flap * 0.25))
        m.compose(new THREE.Vector3(c.x + Math.cos(a) * rad, c.y + 22 + Math.sin(a * 2) * 4, c.z + Math.sin(a) * rad), q, new THREE.Vector3(0.9, 0.9 + flap * 0.4, 0.9))
        this.parrots.setMatrixAt(k, m)
      }
      this.parrots.instanceMatrix.needsUpdate = true
    }
    void softDot; void fbm2
  }
}

/** Instance a pool of tree variants (Trees.treePool) at the given placements. */
export function instanceVariants(pool: THREE.Group, placements: THREE.Matrix4[], rand: () => number): THREE.Group {
  const variants = (pool.userData['variants'] as THREE.Group[] | undefined) ?? [pool]
  const per: THREE.Matrix4[][] = variants.map(() => [])
  for (const m of placements) per[Math.floor(rand() * variants.length)]!.push(m)
  const out = new THREE.Group()
  variants.forEach((v, k) => {
    if (!per[k]!.length) return
    v.updateMatrixWorld(true)
    v.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const local = mesh.matrixWorld
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, per[k]!.length)
      per[k]!.forEach((m, q) => im.setMatrixAt(q, m.clone().multiply(local)))
      im.castShadow = mesh.castShadow
      im.receiveShadow = true
      im.computeBoundingSphere()
      out.add(im)
    })
  })
  return out
}

/** A tree fern: hairy trunk and a crown of arched fronds (alpha leaf cards). */
function fernGeometry(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  const tex = canvasTexture(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.strokeStyle = '#2d5a1c'
    g.lineWidth = 3
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke()
    for (let y = 8; y < h; y += 7) {
      const len = (w / 2) * Math.sin((y / h) * Math.PI) * 0.95
      g.fillStyle = `rgb(${50 + Math.random() * 20},${100 + Math.random() * 30},${30})`
      g.beginPath(); g.ellipse(w / 2 - len / 2, y, len / 2, 2.6, -0.3, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.ellipse(w / 2 + len / 2, y, len / 2, 2.6, 0.3, 0, Math.PI * 2); g.fill()
    }
  })
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const add = (v: number[], t: number[]) => { pos.push(...v); uv.push(...t) }
  // trunk as a crossed pair of cards
  let vi = 0
  const TRUNK_H = 2.4
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2
    const dx = Math.cos(a), dz = Math.sin(a)
    // each frond: a bent strip of 4 segments arching out and down
    const segs = 4
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const out = u * 2.6
      const y = TRUNK_H + Math.sin(u * Math.PI * 0.8) * 1.0 - u * u * 1.2
      const w = 0.55
      add([dx * out - dz * w, y, dz * out + dx * w, dx * out + dz * w, y, dz * out - dx * w], [0, 1 - u, 1, 1 - u])
      if (s < segs) idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3)
      vi += 2
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, TRUNK_H, 6)
  trunk.translate(0, TRUNK_H / 2, 0)
  const tu = new Float32Array((trunk.getAttribute('position') as THREE.BufferAttribute).count * 2).fill(0.5)
  trunk.setAttribute('uv', new THREE.BufferAttribute(tu, 2))
  const merged = mergeSimple([g, trunk.toNonIndexed()])
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 })
  return { geometry: merged, material: mat }
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  let n = 0
  for (const g of parts) n += (g.getAttribute('position') as THREE.BufferAttribute).count
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2)
  let o = 0
  for (const g of parts) {
    const p = g.getAttribute('position') as THREE.BufferAttribute, t = g.getAttribute('uv') as THREE.BufferAttribute
    pos.set(p.array as Float32Array, o * 3)
    if (t) uv.set(t.array as Float32Array, o * 2)
    o += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.computeVertexNormals()
  return out
}

export type { Terrain }
