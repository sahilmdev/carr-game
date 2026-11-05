import * as THREE from 'three'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { treePool } from '../Trees'
import { instanceVariants } from './Jungle'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { compactGroups } from '../SeaLife'
import {
  biomeGroup, fbm2, smooth, rng, zoneIndices, rightAt, instanced, trs, lumpy,
  canvasTexture, puffTexture, softDot, roadSign, besideRoad,
} from './kit'

const CLOUD_Y = 40

interface Fall { mesh: THREE.Mesh; mist: THREE.Sprite }
/** A stretch of glass that cracks and drops out as you approach. */
interface Trap { a: number; b: number; i0: number; i1: number; side: number; state: 'idle' | 'warn' | 'gone'; t: number; hit: boolean; slot: number; shards: THREE.Mesh[] }
interface Whale { m: THREE.Group; mixer: THREE.AnimationMixer; base: number; off: number; y: number; sp: number }

/** Floating islands above a sea of cloud, joined by the glass highway. */
export class SkyIslands implements Biome {
  readonly name = 'sky'
  readonly group = biomeGroup('sky')
  private readonly rand = rng(91)
  private readonly idx: number[]
  private cloudMat: THREE.ShaderMaterial | null = null
  private puffs: THREE.Sprite[] = []
  private falls: Fall[] = []
  private waterTex: THREE.CanvasTexture | null = null
  private rings: THREE.Mesh[] = []
  private airship: THREE.Group | null = null
  private balloons: THREE.Group[] = []
  private birds: THREE.InstancedMesh | null = null
  private crystals: THREE.MeshStandardMaterial | null = null
  private traps: Trap[] = []
  private whales: Whale[] = []
  private lastCar = -1
  private nextCall = 3
  private readonly order = new Map<number, number>()
  private open: number[] = []

  constructor(private readonly track: Track) {
    this.idx = zoneIndices(track, 'sky', 'roll')
    this.idx.forEach((i, k) => this.order.set(i, k))
    this.open = this.idx.filter((i) => track.zoneOfSample(i) !== 'roll')
  }

  fields(): TerrainField[] {
    return []
  }

  build(ctx: BuildCtx): void {
    this.buildCloudSea()
    this.buildIslands(ctx)
    this.buildRings(ctx)
    this.buildTraps()
    this.buildWhales()
    this.buildSkyTraffic()
    this.buildSigns()
  }

  /** A soft, slowly churning cloud deck that the islands float above. */
  private buildCloudSea(): void {
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        uCenter: { value: new THREE.Vector2(1040, -480) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec2 uCenter;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }
        void main() {
          vec2 p = vW.xz * 0.006 + vec2(uTime * 0.004, uTime * 0.002);
          float d = fbm(p);
          float d2 = fbm(p + uSun.xz * 0.04);
          float cover = smoothstep(0.32, 0.62, d);
          float lit = clamp(0.62 + (d - d2) * 4.0, 0.0, 1.0);
          vec3 col = mix(vec3(0.62, 0.68, 0.78), vec3(1.0, 0.99, 0.97), lit);
          // edges of the deck dissolve
          float r = length((vW.xz - uCenter) / vec2(1050.0, 900.0));
          float a = cover * (1.0 - smoothstep(0.7, 1.0, r));
          // thin out right under the camera so it never blocks the view down
          float camD = length(vW.xz - cameraPosition.xz);
          a *= mix(0.55, 1.0, smoothstep(20.0, 120.0, camD));
          gl_FragColor = vec4(col, a * 0.96);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1900, 1, 1), this.cloudMat)
    sea.rotation.x = -Math.PI / 2
    sea.position.set(1040, CLOUD_Y, -480)
    sea.renderOrder = 4
    this.group.add(sea)
    // a second, lower and slower layer for depth
    const low = sea.clone()
    low.position.y = CLOUD_Y - 14
    low.scale.setScalar(1.15)
    this.group.add(low)
    // big puffy sprites drifting among the islands and around the drop
    const tex = puffTexture()
    for (let k = 0; k < 110; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (70 + this.rand() * 220)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.7 }))
      s.position.set(p.x + r.x * off, CLOUD_Y + this.rand() * 14, p.z + r.z * off)
      s.scale.setScalar(40 + this.rand() * 70)
      s.userData['drift'] = (this.rand() - 0.5) * 2
      this.puffs.push(s)
      this.group.add(s)
    }
    // the drop to the jungle punches through a cloud bank
    for (let k = 0; k < 14; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xf4f6f8, transparent: true, depthWrite: false, opacity: 0.8 }))
      s.position.set(760 - k * 6 + (this.rand() - 0.5) * 50, 40 + (this.rand() - 0.5) * 16, -380 + (this.rand() - 0.5) * 70)
      s.scale.setScalar(30 + this.rand() * 40)
      s.userData['drift'] = 0
      this.puffs.push(s)
      this.group.add(s)
    }
  }

  private buildIslands(ctx: BuildCtx): void {
    const rock = new THREE.MeshStandardMaterial({ color: 0x7a6656, roughness: 0.95, side: THREE.DoubleSide })
    const grass = new THREE.MeshStandardMaterial({ color: 0x5b8a3a, roughness: 0.95, flatShading: true })
    const root = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 })
    this.waterTex = canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = 'rgba(200,230,255,0.55)'
      g.fillRect(0, 0, w, h)
      for (let k = 0; k < 90; k++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 10 + Math.random() * 40)
      }
    })
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping
    this.crystals = new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x2fd0ff, emissiveIntensity: 1.8, roughness: 0.15, metalness: 0.2, flatShading: true })
    const trees: THREE.Matrix4[] = []
    const n = this.idx.length
    let k = 0
    for (let s = 6; s < n - 6; s += Math.floor(n / 40)) {
      const i = this.idx[s]!
      if (this.track.zoneOfSample(i) === 'roll') continue
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const under = k % 3 === 0
      const side = k % 2 ? 1 : -1
      const R = under ? 26 + this.rand() * 10 : 14 + this.rand() * 20
      const off = under ? 0 : side * (R + 22 + this.rand() * 40)
      const cx = p.x + r.x * off, cz = p.z + r.z * off
      let low = p.y
      if (under) for (const q of this.idx) { const s = this.track.samples[q]!; if (Math.hypot(s.x - cx, s.z - cz) < R + 12) low = Math.min(low, s.y) }
      const top = under ? low - 6 : p.y - 8 + this.rand() * 22
      k++
      // side islands never reach back over another stretch of the highway
      if (!under && ctx.road.nearest(cx, cz, R + 30).d < R + 26) continue
      ;((this.group.userData['islandTops'] ??= []) as number[][]).push([cx, top, cz, R])
      const isl = new THREE.Group()
      isl.position.set(cx, top, cz)
      // rocky underside: an inverted, knobbly cone
      const body = new THREE.Mesh(islandRock(R, k * 7.3), rock)
      body.position.y = -1.2
      body.castShadow = true
      const cap = new THREE.Mesh(lumpy(new THREE.CylinderGeometry(R * 1.02, R * 0.98, 2.2, 16, 1), R * 0.05, 0.12, k + 3), grass)
      cap.position.y = -1
      cap.receiveShadow = true
      isl.add(body, cap)
      // hanging roots
      for (let q = 0; q < 6; q++) {
        const a = this.rand() * Math.PI * 2, rr = R * (0.3 + this.rand() * 0.5)
        const len = 6 + this.rand() * 14
        const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, len, 4), root)
        vine.position.set(Math.cos(a) * rr, -R * 0.5 - len / 2, Math.sin(a) * rr)
        isl.add(vine)
      }
      this.group.add(isl)
      // trees and crystals on the top (clear of the road on "under" islands)
      for (let q = 0; q < Math.round(R * 0.6); q++) {
        const a = this.rand() * Math.PI * 2, rr = Math.sqrt(this.rand()) * R * 0.85
        const tx = cx + Math.cos(a) * rr, tz = cz + Math.sin(a) * rr
        if (ctx.road.nearest(tx, tz, 20).d < 18) continue
        if (this.rand() < 0.15) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.2 + this.rand() * 1.6, 0), this.crystals)
          c.position.set(tx, top + 1, tz)
          c.scale.y = 2.2
          c.rotation.set(this.rand() * 0.4, this.rand() * 6, this.rand() * 0.4)
          this.group.add(c)
          continue
        }
        trees.push(trs(tx, top - 0.4, tz, this.rand() * 6, 0.9 + this.rand() * 0.7))
      }
      // a waterfall pouring off the side islands into the clouds
      if (!under && k % 2 === 0) {
        const a = Math.atan2(p.z - cz, p.x - cx) + Math.PI + (this.rand() - 0.5)
        const ex = cx + Math.cos(a) * R * 0.95, ez = cz + Math.sin(a) * R * 0.95
        const drop = top - CLOUD_Y + 6
        const mat = new THREE.MeshBasicMaterial({ map: this.waterTex.clone(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 })
        mat.map!.repeat.set(1, drop / 20)
        const fall = new THREE.Mesh(new THREE.PlaneGeometry(4 + R * 0.12, drop), mat)
        fall.position.set(ex, top - drop / 2, ez)
        fall.rotation.y = -a + Math.PI / 2
        const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.7 }))
        mist.position.set(ex, CLOUD_Y + 2, ez)
        mist.scale.setScalar(26)
        this.group.add(fall, mist)
        this.falls.push({ mesh: fall, mist })
      }
      // a ruined sky temple on the biggest side islands
      if (!under && R > 26) this.group.add(this.temple(cx, top, cz))
    }
    this.group.add(instanceVariants(treePool('broadleaf'), trees, this.rand))
  }

  private temple(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group()
    const marble = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.6 })
    const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 1.2, 20), marble)
    base.position.y = 0.6
    g.add(base)
    for (let k = 0; k < 8; k++) {
      if (k === 3) continue // a fallen column
      const a = (k / 8) * Math.PI * 2
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 7, 10), marble)
      col.position.set(Math.cos(a) * 6.5, 4.7, Math.sin(a) * 6.5)
      g.add(col)
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(7.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), marble)
    dome.position.y = 8.2
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 6, 10), marble)
    fallen.position.set(4, 1.6, 9)
    fallen.rotation.set(Math.PI / 2, 0.4, 0)
    g.add(dome, fallen)
    g.position.set(x, y, z)
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
    return g
  }

  /** Glowing boost rings the road threads through (full nitro + kick). */
  private buildRings(ctx: BuildCtx): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b1820, emissive: 0x46e6ff, emissiveIntensity: 2.6, metalness: 0.6, roughness: 0.3 })
    const frame = new THREE.MeshStandardMaterial({ color: 0xd5dde3, metalness: 0.8, roughness: 0.3 })
    const n = this.idx.length
    for (const f of [0.07, 0.62, 0.69, 0.77, 0.85, 0.95]) {
      const i = this.idx[Math.floor(n * f)]!
      if (this.track.zoneOfSample(i) === 'roll') continue
      const p = this.track.samples[i]!, tg = this.track.tangents[i]!
      const ring = new THREE.Group()
      const glow = new THREE.Mesh(new THREE.TorusGeometry(14.5, 0.45, 10, 64), mat)
      const outer = new THREE.Mesh(new THREE.TorusGeometry(15.4, 0.7, 8, 64), frame)
      ring.add(glow, outer)
      for (let q = 0; q < 8; q++) {
        const a = (q / 8) * Math.PI * 2
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 1.6), frame)
        fin.position.set(Math.cos(a) * 15.6, Math.sin(a) * 15.6, 0)
        fin.rotation.z = a
        ring.add(fin)
      }
      ring.position.copy(p).setY(p.y + 4)
      ring.rotation.y = Math.atan2(tg.x, tg.z)
      this.group.add(ring)
      this.rings.push(glow)
      ctx.addBoost(i, 0, 11)
    }
  }

  /**
   * Six stretches of deck that crack (red) as you near them and fall away,
   * leaving bare steel grating: swerve to the whole lane or lose your speed.
   */
  private buildTraps(): void {
    const n = this.idx.length, t = this.track
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8ea, transparent: true, opacity: 0.6, roughness: 0.2 })
    const grate = new THREE.MeshStandardMaterial({
      map: canvasTexture(128, 128, (g, w) => {
        g.clearRect(0, 0, w, w)
        g.strokeStyle = '#59646c'
        g.lineWidth = 9
        for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32, w); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke() }
      }),
      transparent: true, alphaTest: 0.4, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide,
    })
    grate.map!.wrapS = grate.map!.wrapT = THREE.RepeatWrapping
    grate.map!.repeat.set(2, 7)
    const half = t.width / 2
    ;[0.04, 0.1, 0.65, 0.73, 0.81, 0.89].forEach((fr, slot) => {
      const a = Math.floor(n * fr), i0 = this.idx[a]!, i1 = this.idx[Math.min(n - 1, a + 16)]!
      if (t.zoneOfSample(i0) === 'roll' || t.zoneOfSample(i1) === 'roll') return
      const side = slot % 2 ? 1 : -1
      const v0 = Math.round(t.deckV.get(i0) ?? -1), v1 = Math.round(t.deckV.get(i1) ?? -1) + 1
      if (v0 < 0) return
      // deck u runs left to right across the road: one half, in whole panels
      t.deckHoles.rect[slot]!.set(side > 0 ? 0.5 : 0, side > 0 ? 1 : 0.5, v0, v1)
      // grating strip under the panels, following the road
      const pos: number[] = [], uv: number[] = [], ind: number[] = []
      let row = 0
      for (let k = a - 2; k <= a + 18; k++) {
        const i = this.idx[Math.max(0, Math.min(n - 1, k))]!, p = t.samples[i]!, r = rightAt(t, i), u = t.ups[i]!
        for (const lat of [0, side * half]) {
          const v = p.clone().addScaledVector(r, lat).addScaledVector(u, -0.12)
          pos.push(v.x, v.y, v.z)
          uv.push(lat === 0 ? 0 : 1, row / 20)
        }
        if (row) { const b = row * 2; ind.push(b - 2, b - 1, b, b - 1, b + 1, b) }
        row++
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(ind)
      g.computeVertexNormals()
      this.group.add(new THREE.Mesh(g, grate))
      const shards: THREE.Mesh[] = []
      for (let q = 0; q < 8; q++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 4), glass)
        s.visible = false
        this.group.add(s)
        shards.push(s)
      }
      this.traps.push({ a, b: Math.min(n - 1, a + 16), i0, i1, side, state: 'idle', t: 0, hit: false, slot, shards })
    })
  }

  private updateTraps(f: FrameCtx, ev: BiomeEvents): void {
    const t = this.track, st = t.deckHoles.state.value
    const pos = this.order.get(f.carIdx) ?? -1
    const inSky = pos >= 0
    // left the sky or started a new lap: everything is whole again
    if (!inSky && this.lastCar >= 0) {
      for (const tr of this.traps) { tr.state = 'idle'; tr.hit = false; st[tr.slot] = 0; tr.shards.forEach((s) => { s.visible = false }) }
    }
    this.lastCar = pos
    for (const tr of this.traps) {
      if (tr.state === 'idle' && inSky) {
        const ahead = ((t.deckV.get(tr.i0) ?? 0) - (t.deckV.get(f.carIdx) ?? 0)) * 8
        // ~1.7 s of warning at whatever speed you're doing
        if (ahead > 0 && ahead < Math.max(60, f.carSpeed * 2.4)) {
          tr.state = 'warn'
          tr.t = 0
          ev.toast(tr.side > 0 ? 'GLASS BREAKING  GO LEFT' : 'GLASS BREAKING  GO RIGHT')
          ev.sfx('crack')
        }
      }
      if (tr.state === 'warn') {
        tr.t += f.dt
        st[tr.slot] = 0.35 + 0.65 * Math.abs(Math.sin(tr.t * 11))
        if (tr.t > 1.0) {
          tr.state = 'gone'
          tr.t = 0
          st[tr.slot] = 2
          ev.sfx('shatter', 0.85)
          const { a, b } = tr
          tr.shards.forEach((s, q) => {
            const i = this.idx[a + Math.floor(((q >> 1) + 0.5) / 4 * (b - a))]!
            const p = t.samples[i]!, r = rightAt(t, i)
            s.position.copy(p).addScaledVector(r, tr.side * (q % 2 ? 2.6 : 7.8))
            s.rotation.set(0, Math.atan2(t.tangents[i]!.x, t.tangents[i]!.z), 0)
            s.userData['v'] = 2 + q * 0.5
            s.userData['s'] = (q % 2 ? 1 : -1) * (0.8 + q * 0.2)
            s.visible = true
          })
        }
      }
      if (tr.state === 'gone') {
        tr.t += f.dt
        for (const s of tr.shards) {
          if (!s.visible) continue
          s.userData['v'] += 16 * f.dt
          s.position.y -= (s.userData['v'] as number) * f.dt
          s.rotation.x += (s.userData['s'] as number) * f.dt
          s.rotation.z += (s.userData['s'] as number) * 0.7 * f.dt
          if (tr.t > 3.5) s.visible = false
        }
        // on the bare grating: rattled and slowed, once per stretch
        if (!tr.hit && inSky && pos >= tr.a && pos <= tr.b) {
          const p = t.samples[f.carIdx]!, r = rightAt(t, f.carIdx)
          const lat = (f.carPos.x - p.x) * r.x + (f.carPos.z - p.z) * r.z
          if (lat * tr.side > 0.6) { tr.hit = true; ev.hit(0.55); ev.toast('ON THE STEEL'); ev.sfx('grate') }
        }
      }
    }
  }

  /** Whales gliding through the clouds, keeping pace beside the highway. */
  private buildWhales(): void {
    new FBXLoader().loadAsync(`${import.meta.env.BASE_URL}models/fish/Whale.fbx`).then((src) => {
      src.traverse(compactGroups)
      const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3())
      const s = 34 / Math.max(size.x, size.y, size.z, 0.001)
      for (let k = 0; k < 4; k++) {
        const a = cloneSkinned(src)
        a.scale.setScalar(s)
        a.traverse((o) => { o.frustumCulled = false })
        const m = new THREE.Group()
        m.add(a)
        this.group.add(m)
        const mixer = new THREE.AnimationMixer(a)
        if (src.animations[0]) mixer.clipAction(src.animations[0]).play()
        this.whales.push({ m, mixer, base: k / 4 + 0.1, off: (k % 2 ? 1 : -1) * (75 + k * 18), y: 66 + k * 13, sp: 0.0022 })
      }
    }).catch((e) => console.warn('[sky whales]', e))
  }

  private buildSkyTraffic(): void {
    // airship
    const ship = new THREE.Group()
    const env = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.55, metalness: 0.2 }))
    env.scale.set(9, 9, 34)
    const gond = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0x3b3f46 }))
    gond.position.y = -9.5
    const finMat = new THREE.MeshStandardMaterial({ color: 0xb8322a })
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 7), finMat)
      fin.position.z = 28
      fin.rotation.z = (k * Math.PI) / 2
      fin.translateY(7)
      ship.add(fin)
    }
    const stripe = canvasTexture(512, 64, (g, w, h) => {
      g.fillStyle = '#d9dde2'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#b8322a'; g.font = 'italic 800 52px "Barlow Condensed", Arial'; g.textBaseline = 'middle'
      g.fillText('COSMOS  AIR', 20, h / 2)
    })
    const band = new THREE.Mesh(new THREE.CylinderGeometry(9.05, 9.05, 20, 32, 1, true), new THREE.MeshStandardMaterial({ map: stripe, side: THREE.DoubleSide }))
    band.rotation.x = Math.PI / 2
    ship.add(env, gond, band)
    ship.traverse((o) => { o.castShadow = true })
    this.airship = ship
    this.group.add(ship)
    // hot-air balloons
    const colors = [0xe3412b, 0xf2b705, 0x2b7de3, 0x2bbf6b, 0xe32b9a]
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Group()
      const tex = canvasTexture(256, 128, (g, w, h) => {
        for (let s = 0; s < 8; s++) { g.fillStyle = s % 2 ? '#' + colors[k % 5]!.toString(16).padStart(6, '0') : '#f5f0e6'; g.fillRect((s * w) / 8, 0, w / 8, h) }
      })
      const env2 = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }))
      env2.scale.y = 1.2
      const basket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }))
      basket.position.y = -9.5
      b.add(env2, basket)
      b.userData['phase'] = this.rand() * 6
      b.userData['center'] = new THREE.Vector3(850 + this.rand() * 400, 95 + this.rand() * 50, -900 + this.rand() * 500)
      this.balloons.push(b)
      this.group.add(b)
    }
    // a flock of gulls
    const wing = new THREE.BufferGeometry()
    wing.setAttribute('position', new THREE.Float32BufferAttribute([-1.2, 0.3, 0, 0, 0, 0.3, 0, 0, -0.3, 0, 0, -0.3, 0, 0, 0.3, 1.2, 0.3, 0], 3))
    wing.computeVertexNormals()
    this.birds = new THREE.InstancedMesh(wing, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }), 26)
    this.group.add(this.birds)
  }

  private buildSigns(): void {
    const rollStart = zoneIndices(this.track, 'roll')[0]
    if (rollStart === undefined) return
    const n = this.track.sampleCount
    const i = (rollStart - 90 + n) % n
    const sign = roadSign(['BARREL ROLL', 'KEEP IT PINNED'], '#0b2233', '#5ff2ff', 3.6, 1.7, 0.4)
    this.group.add(besideRoad(this.track, i, 13.5, sign))
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    if (!this.group.visible) return
    if (this.cloudMat) this.cloudMat.uniforms['uTime']!.value = f.time % 10000
    for (const s of this.puffs) s.position.x += (s.userData['drift'] as number) * f.dt
    for (const fl of this.falls) {
      const m = fl.mesh.material as THREE.MeshBasicMaterial
      if (m.map) m.map.offset.y = (f.time * 0.9) % 1
      fl.mist.scale.setScalar(24 + Math.sin(f.time * 1.3) * 3)
    }
    this.updateTraps(f, ev)
    this.nextCall -= f.dt
    if (this.nextCall <= 0 && this.whales.length && this.order.has(f.carIdx)) {
      this.nextCall = 7 + this.rand() * 7
      ev.sfx('whale', 0.8)
    }
    for (const w of this.whales) {
      const n = this.open.length
      const u = ((w.base + f.time * w.sp) % 1 + 1) % 1
      const i = this.open[Math.floor(u * (n - 1))]!, j = this.open[Math.min(n - 1, Math.floor(u * (n - 1)) + 6)]!
      const p = this.track.samples[i]!, q = this.track.samples[j]!, r = rightAt(this.track, i)
      w.m.position.set(p.x + r.x * w.off, w.y + Math.sin(f.time * 0.3 + w.base * 9) * 5, p.z + r.z * w.off)
      w.m.rotation.y = Math.atan2(q.x - p.x, q.z - p.z)
      w.mixer.update(f.dt)
    }
    const pulse = 2.2 + Math.sin(f.time * 4) * 0.8
    for (const r of this.rings) (r.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse
    if (this.crystals) this.crystals.emissiveIntensity = 1.4 + Math.sin(f.time * 1.7) * 0.5
    if (this.airship) {
      const a = f.time * 0.012
      this.airship.position.set(1020 + Math.cos(a) * 260, 140, -640 + Math.sin(a) * 260)
      this.airship.rotation.y = -a
    }
    for (const b of this.balloons) {
      const c = b.userData['center'] as THREE.Vector3, ph = b.userData['phase'] as number
      b.position.set(c.x + Math.sin(f.time * 0.03 + ph) * 40, c.y + Math.sin(f.time * 0.2 + ph) * 3, c.z + Math.cos(f.time * 0.025 + ph) * 40)
    }
    if (this.birds) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
      for (let k = 0; k < 26; k++) {
        const a = f.time * 0.15 + k * 0.24
        const x = 1000 + Math.cos(a) * (90 + (k % 5) * 6), z = -560 + Math.sin(a) * (90 + (k % 5) * 6)
        const flap = Math.sin(f.time * 9 + k) * 0.5
        q.setFromEuler(e.set(0, -a, flap * 0.3))
        m.compose(new THREE.Vector3(x, 110 + Math.sin(k) * 6, z), q, new THREE.Vector3(1.4, 1 + flap, 1.4))
        this.birds.setMatrixAt(k, m)
      }
      this.birds.instanceMatrix.needsUpdate = true
    }
    void smooth; void fbm2; void softDot
  }
}

/** Rocky underside of a floating island: a lathe tapering to a point, roughened. */
function islandRock(R: number, seed: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []
  const N = 14
  for (let k = N; k >= 0; k--) {
    const u = k / N
    const r = R * Math.pow(1 - u, 0.75) * (1 + 0.1 * Math.sin(u * 11 + seed))
    pts.push(new THREE.Vector2(Math.max(0.05, r), -u * 1.9 * R))
  }
  const g = new THREE.LatheGeometry(pts, 36)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
    const a = Math.atan2(z, x)
    // continuous round the seam: sample the noise on a circle
    const n = fbm2(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6 - y * 0.06) - 0.5
    const f = 1 + n * 0.5
    pos.setXYZ(k, x * f, y, z * f)
  }
  g.computeVertexNormals()
  return g
}
