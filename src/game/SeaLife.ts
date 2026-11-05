import * as THREE from 'three'
import { softDot } from './biomes/kit'
import { rockSet, tiled } from './Textures'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { props, at } from './biomes/Props'

/**
 * Landmarks and animals for the underwater world: a shipwreck, sunken
 * ruins, sea fans, branching coral, jellyfish, manta rays, a whale and
 * bubble vents. Everything is generated in code. `spots` are points on the
 * sea floor; `clearOf(p, r)` says whether a thing of radius r at p stays
 * clear of every glass tube.
 */
/**
 * FBX models come with dozens of geometry groups for a few materials, and each
 * group is a draw call. Sort the triangles by material: one group per material.
 */
export function compactGroups(o: THREE.Object3D): void {
  const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
  if (!geo || geo.groups.length < 2) return
  const src = geo.index
  const byMat = new Map<number, number[]>()
  for (const g of geo.groups) {
    const list = byMat.get(g.materialIndex ?? 0) ?? []
    byMat.set(g.materialIndex ?? 0, list)
    for (let k = g.start; k < g.start + g.count; k++) list.push(src ? src.getX(k) : k)
  }
  const index: number[] = []
  geo.clearGroups()
  for (const [mat, list] of byMat) {
    geo.addGroup(index.length, list.length, mat)
    for (const v of list) index.push(v)
  }
  geo.setIndex(index)
}

export class SeaLife {
  public readonly group = new THREE.Group()
  private readonly jellies: { m: THREE.Group; base: THREE.Vector3; ph: number }[] = []
  private readonly mantas: { m: THREE.Group; c: THREE.Vector3; r: number; sp: number; ph: number; wings: THREE.Mesh[] }[] = []
  private whale: { m: THREE.Group; c: THREE.Vector3; r: number; tail: THREE.Object3D } | null = null
  private bubbles: { pts: THREE.Points; base: Float32Array; vents: THREE.Vector3[] } | null = null

  constructor(spots: THREE.Vector3[], private readonly clearOf: (p: THREE.Vector3, r: number) => boolean, seed = 7) {
    let s = seed
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
    // Shuffle so landmarks spread out along the route
    const pool = spots.slice()
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [pool[k], pool[j]] = [pool[j]!, pool[k]!] }
    const take = (minGap: number, used: THREE.Vector3[], need: number): THREE.Vector3 | null => {
      for (let k = 0; k < pool.length; k++) {
        const p = pool[k]!
        if (used.every((u) => u.distanceTo(p) > minGap) && clearOf(p, need)) { pool.splice(k, 1); used.push(p); return p }
      }
      return null
    }
    const landmarks: THREE.Vector3[] = []
    const wreckAt = take(60, landmarks, 19)
    if (wreckAt) this.group.add(this.shipwreck(wreckAt, rand))
    for (let k = 0; k < 2; k++) {
      const at = take(60, landmarks, 14)
      if (at) this.group.add(this.ruins(at, rand))
    }
    this.seaFans(pool, rand)
    this.branchCoral(pool, rand)
    this.makeJellies(pool, rand)
    this.makeMantas(pool, rand)
    this.makeWhale()
    this.makeBubbles(pool.filter((p) => clearOf(p, 3)).slice(0, 6))
    this.sunkenProps(pool, rand)
    this.loadAnimals(pool, rand)
    this.update(0, new THREE.Vector3()) // place the animals before the first frame
  }

  // ── Shipwreck: a listing, half-buried steel hull with a broken mast ──
  private shipwreck(at: THREE.Vector3, rand: () => number): THREE.Group {
    const rust = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const g = c.getContext('2d')!
      g.fillStyle = '#4a3a2c'
      g.fillRect(0, 0, 256, 256)
      for (let k = 0; k < 1400; k++) {
        const v = Math.random()
        g.fillStyle = v < 0.5 ? `rgba(120,60,30,${0.15 + v * 0.2})` : `rgba(40,55,50,${0.1 + v * 0.15})`
        g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 8, 2 + Math.random() * 8)
      }
      g.strokeStyle = 'rgba(20,20,20,0.35)'
      for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke() } // hull plates
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(4, 1)
      return t
    })()
    const hullMat = new THREE.MeshStandardMaterial({ map: rust, roughness: 0.95, metalness: 0.2, side: THREE.DoubleSide })
    const g = new THREE.Group()
    // Hull: a box bent into a ship shape (tapered bow, rounded keel)
    const hull = new THREE.BoxGeometry(8, 6, 36, 6, 6, 18)
    const pa = hull.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < pa.count; k++) {
      let x = pa.getX(k)
      const y = pa.getY(k), z = pa.getZ(k)
      const bow = z > 8 ? 1 - Math.pow((z - 8) / 10, 1.6) * 0.95 : 1
      const stern = z < -15 ? 1 - ((-15 - z) / 3) * 0.15 : 1
      const keel = 0.45 + 0.55 * Math.sqrt(Math.max(0, (y + 3) / 6))
      x *= bow * stern * keel
      pa.setX(k, x)
      if (y > 2.9) pa.setY(k, y + Math.max(0, z - 8) * 0.06) // sheer: bow rises
    }
    hull.computeVertexNormals()
    const hm = new THREE.Mesh(hull, hullMat)
    hm.position.y = 1.5
    g.add(hm)
    // deckhouse, funnel, broken mast
    g.add(this.place(new THREE.Mesh(new THREE.BoxGeometry(6, 4, 8), hullMat), 0, 6.3, -9))
    g.add(this.place(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 4, 12), hullMat), 0, 9.5, -11))
    const mast = this.place(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 11, 8), hullMat), 0, 9, 4)
    mast.rotation.z = 0.9
    g.add(mast)
    // A hole torn in the side
    g.add(this.place(new THREE.Mesh(new THREE.CircleGeometry(1.8, 10), new THREE.MeshBasicMaterial({ color: 0x050a0c })), 3.75, 1.5, 2, 0, Math.PI / 2))
    g.position.copy(at).setY(at.y - 1.8) // half-buried
    g.rotation.set(0.04, rand() * Math.PI * 2, 0.32) // listing to one side
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return g
  }

  // ── Ruins: a ring of fluted columns (some broken), lintels, a fallen drum ──
  private ruins(at: THREE.Vector3, rand: () => number): THREE.Group {
    const st = tiled(rockSet(), 1, 1)
    const stone = new THREE.MeshStandardMaterial({ color: 0xb9b19c, map: st.map, normalMap: st.normalMap, roughness: 1 })
    const g = new THREE.Group()
    const colGeo = (h: number) => {
      const c = new THREE.CylinderGeometry(0.9, 1.05, h, 16, 4)
      const p = c.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < p.count; k++) {
        const a = Math.atan2(p.getZ(k), p.getX(k))
        const f = 1 - 0.06 * Math.max(0, Math.cos(a * 8)) // fluting
        p.setX(k, p.getX(k) * f); p.setZ(k, p.getZ(k) * f)
      }
      c.computeVertexNormals()
      return c
    }
    const N = 8, R = 11
    const heights: number[] = []
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2
      const h = rand() < 0.4 ? 2 + rand() * 3 : 8 + rand() * 1.5 // some broken off
      heights.push(h)
      g.add(this.place(new THREE.Mesh(colGeo(h), stone), Math.cos(a) * R, h / 2, Math.sin(a) * R))
      g.add(this.place(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), stone), Math.cos(a) * R, 0.3, Math.sin(a) * R))
    }
    // lintels across neighbouring tall columns
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N
      if (heights[k]! < 7 || heights[k2]! < 7) continue
      const a = ((k + 0.5) / N) * Math.PI * 2
      const top = Math.min(heights[k]!, heights[k2]!)
      const l = this.place(new THREE.Mesh(new THREE.BoxGeometry(2 * R * Math.sin(Math.PI / N) + 2, 1, 1.8), stone), Math.cos(a) * R * Math.cos(Math.PI / N), top + 0.5, Math.sin(a) * R * Math.cos(Math.PI / N))
      l.rotation.y = -a + Math.PI / 2
      g.add(l)
    }
    // fallen column drum and a toppled statue base
    const fallen = this.place(new THREE.Mesh(colGeo(6), stone), 4, 0.9, -3)
    fallen.rotation.set(0, rand() * 3, Math.PI / 2)
    g.add(fallen)
    g.add(this.place(new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 4), stone), 0, 0.8, 0))
    g.position.copy(at).setY(at.y - 0.4)
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return g
  }

  // ── Sea fans: flat lattice fans standing on the sand ──
  private seaFans(pool: THREE.Vector3[], rand: () => number): void {
    const colors = ['#b0456a', '#c7783a', '#8a4fa0', '#d0a040']
    for (const col of colors) {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')!
      g.strokeStyle = col
      g.lineCap = 'round'
      const branch = (x: number, y: number, a: number, len: number, w: number, d: number) => {
        if (d === 0 || len < 3) return
        const x2 = x + Math.cos(a) * len, y2 = y - Math.sin(a) * len
        g.lineWidth = w
        g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke()
        branch(x2, y2, a + 0.35, len * 0.78, w * 0.75, d - 1)
        branch(x2, y2, a - 0.35, len * 0.78, w * 0.75, d - 1)
      }
      branch(64, 128, Math.PI / 2, 30, 5, 7)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 })
      const geo = new THREE.PlaneGeometry(3, 3)
      geo.translate(0, 1.5, 0)
      const mats: THREE.Matrix4[] = []
      const d = new THREE.Object3D()
      for (let k = 0; k < 14 && pool.length; k++) {
        const p = pool[Math.floor(rand() * pool.length)]!
        d.position.set(p.x + (rand() - 0.5) * 8, p.y - 0.3, p.z + (rand() - 0.5) * 8)
        if (!this.clearOf(d.position, 3)) continue
        d.rotation.set(0, rand() * Math.PI, 0)
        d.scale.setScalar(0.7 + rand() * 0.9)
        d.updateMatrix()
        mats.push(d.matrix.clone())
      }
      const m = new THREE.InstancedMesh(geo, mat, mats.length)
      mats.forEach((x, k) => m.setMatrixAt(k, x))
      m.computeBoundingSphere()
      this.group.add(m)
    }
  }

  // ── Branching (staghorn) coral: one branchy shape, instanced with tints ──
  private branchCoral(pool: THREE.Vector3[], rand: () => number): void {
    const parts: THREE.BufferGeometry[] = []
    const grow = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
      const end = base.clone().addScaledVector(dir, len)
      const c = new THREE.CylinderGeometry(r * 0.7, r, len, 6)
      c.translate(0, len / 2, 0)
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
      c.translate(base.x, base.y, base.z)
      parts.push(c)
      if (depth === 0) return
      for (let k = 0; k < 2; k++) {
        const nd = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.2, 0.2, (rand() - 0.5) * 1.2)).normalize()
        grow(end, nd, len * 0.75, r * 0.7, depth - 1)
      }
    }
    for (let k = 0; k < 3; k++) grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3((rand() - 0.5) * 0.6, 1, (rand() - 0.5) * 0.6).normalize(), 0.9, 0.16, 3)
    const merged = mergeAll(parts)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
    const spotsOk: THREE.Vector3[] = []
    for (let k = 0; k < 200 && spotsOk.length < 90 && pool.length; k++) {
      const p = pool[Math.floor(rand() * pool.length)]!
      const q = new THREE.Vector3(p.x + (rand() - 0.5) * 10, p.y - 0.2, p.z + (rand() - 0.5) * 10)
      if (this.clearOf(q, 3)) spotsOk.push(q)
    }
    const COUNT = spotsOk.length
    const m = new THREE.InstancedMesh(merged, mat, COUNT)
    const tints = [0xd9a07a, 0xc77d8e, 0xe0c88f, 0x9fb18a, 0xb57fb0]
    const d = new THREE.Object3D()
    for (let k = 0; k < COUNT; k++) {
      d.position.copy(spotsOk[k]!)
      d.rotation.set(0, rand() * Math.PI * 2, 0)
      d.scale.setScalar(0.8 + rand() * 1.4)
      d.updateMatrix()
      m.setMatrixAt(k, d.matrix)
      m.setColorAt(k, new THREE.Color(tints[k % tints.length]!))
    }
    m.computeBoundingSphere()
    this.group.add(m)
  }

  // ── Jellyfish: glowing translucent bells trailing tentacles, bobbing ──
  private makeJellies(pool: THREE.Vector3[], rand: () => number): void {
    const bellGeo = new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    const bellMat = new THREE.MeshStandardMaterial({
      color: 0xf2b8e0, emissive: 0xd070c0, emissiveIntensity: 0.6, transparent: true, opacity: 0.55,
      roughness: 0.2, side: THREE.DoubleSide, depthWrite: false,
    })
    const tPos: number[] = []
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2
      for (let j = 0; j < 6; j++) {
        const y0 = -j * 0.45, y1 = -(j + 1) * 0.45
        tPos.push(Math.cos(a) * 0.45 + Math.sin(j) * 0.05, y0, Math.sin(a) * 0.45, Math.cos(a) * 0.4 + Math.sin(j + 1) * 0.05, y1, Math.sin(a) * 0.4)
      }
    }
    const tGeo = new THREE.BufferGeometry()
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3))
    const tMat = new THREE.LineBasicMaterial({ color: 0xf6c8e8, transparent: true, opacity: 0.5 })
    for (let k = 0; k < 28 && pool.length; k++) {
      const p = pool[Math.floor(rand() * pool.length)]!
      const j = new THREE.Group()
      j.add(new THREE.Mesh(bellGeo, bellMat))
      j.add(new THREE.LineSegments(tGeo, tMat))
      const base = new THREE.Vector3(p.x + (rand() - 0.5) * 12, p.y + 4 + rand() * 9, p.z + (rand() - 0.5) * 12)
      base.y = Math.min(base.y, -3)
      if (!this.clearOf(base, 4)) continue
      j.position.copy(base)
      j.scale.setScalar(0.8 + rand() * 0.8)
      this.group.add(j)
      this.jellies.push({ m: j, base, ph: rand() * 10 })
    }
  }

  // ── Manta rays: flat bodies with flapping wings, cruising in circles ──
  private makeMantas(pool: THREE.Vector3[], rand: () => number): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x232b33, roughness: 0.8, side: THREE.DoubleSide })
    const belly = new THREE.MeshStandardMaterial({ color: 0xc9d0d4, roughness: 0.8, side: THREE.DoubleSide })
    for (let tries = 0, made = 0; tries < 60 && made < 5 && pool.length; tries++) {
      const p = pool[Math.floor(rand() * pool.length)]!
      const r = 10 + rand() * 10
      if (!this.clearOf(p, r + 7)) continue
      made++
      const m = new THREE.Group()
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mat)
      body.scale.set(1.1, 0.3, 1.6)
      m.add(body)
      const under = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 8), belly)
      under.scale.set(1.05, 0.25, 1.5)
      under.position.y = -0.06
      m.add(under)
      const wings: THREE.Mesh[] = []
      for (const s of [-1, 1]) {
        const shape = new THREE.Shape()
        shape.moveTo(0, -1.2); shape.lineTo(s * 3.6, -0.2); shape.lineTo(0, 1.2)
        const wg = new THREE.ShapeGeometry(shape)
        wg.rotateX(-Math.PI / 2)
        const w = new THREE.Mesh(wg, mat)
        wings.push(w)
        m.add(w)
      }
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 3, 4), mat)
      tail.rotation.x = Math.PI / 2
      tail.position.z = 2.8
      m.add(tail)
      m.scale.setScalar(1.3 + rand() * 0.8)
      const c = new THREE.Vector3(p.x, Math.min(p.y + 7 + rand() * 6, -4), p.z)
      this.group.add(m)
      this.mantas.push({ m, c, r, sp: 0.12 + rand() * 0.08, ph: rand() * 6, wings })
    }
  }

  // ── A whale cruising slowly in a wide circle near the surface ──
  private makeWhale(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4652, roughness: 0.75 })
    const w = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat)
    body.scale.set(2.2, 2, 9)
    w.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), mat)
    head.scale.set(2, 1.6, 3.2)
    head.position.set(0, -0.2, -6.5)
    w.add(head)
    const tail = new THREE.Group()
    const fluke = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6), mat)
    fluke.scale.set(4, 0.25, 1.4)
    fluke.position.z = 1.2
    tail.add(fluke)
    tail.position.z = 8.5
    w.add(tail)
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat)
      fin.scale.set(2.6, 0.2, 0.9)
      fin.position.set(s * 2.6, -0.8, -3)
      fin.rotation.z = s * -0.4
      w.add(fin)
    }
    this.group.add(w)
    this.whale = { m: w, c: new THREE.Vector3(300, -7, 720), r: 85, tail }
  }

  // ── Bubble vents: thin streams of bubbles rising from the sand ──
  private makeBubbles(vents: THREE.Vector3[]): void {
    if (!vents.length) return
    const PER = 40
    const base = new Float32Array(vents.length * PER * 3)
    for (let v = 0; v < vents.length; v++) {
      for (let k = 0; k < PER; k++) {
        const o = (v * PER + k) * 3
        base[o] = (Math.random() - 0.5) * 0.8
        base[o + 1] = Math.random() // phase 0..1 up the column
        base[o + 2] = (Math.random() - 0.5) * 0.8
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.length), 3))
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.04, color: 0xdff8ff, size: 0.22, transparent: true, opacity: 0.8, depthWrite: false }))
    pts.frustumCulled = false
    this.group.add(pts)
    this.bubbles = { pts, base, vents }
  }

  private place(m: THREE.Mesh, x: number, y: number, z: number, rx = 0, ry = 0): THREE.Mesh {
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, 0)
    return m
  }

  /** Scanned bronze statues, chests and cannons lying on the sea floor. */
  private sunkenProps(pool: THREE.Vector3[], rand: () => number): void {
    const items = [['bronze_shark_statue', 7], ['bronze_ray_statue', 6], ['bronze_whale_statue', 4], ['treasure_chest', 2.4], ['cannon_01', 1.6]] as const
    let k = 0
    for (const [name, s] of items) {
      const mats: THREE.Matrix4[] = []
      for (let q = 0; q < 6 && k < pool.length; k += 7) {
        const p = pool[k]!
        if (!this.clearOf(p, 6)) continue
        mats.push(at(p.x, p.y - 0.1, p.z, rand() * 6.3, s, rand() * 0.25, rand() * 6))
        q++
      }
      props.place(name, mats, this.group)
    }
  }

  /** Rigged, swimming animals (Quaternius, CC0) replace the code-made ones. */
  private loadAnimals(pool: THREE.Vector3[], rand: () => number): void {
    const base = `${import.meta.env.BASE_URL}models/fish/`
    const loader = new FBXLoader()
    const spec: [string, number, number, number, number][] = [
      // file, length m, count, circle radius, speed
      ['Whale', 18, 2, 90, 0.04], ['Manta_ray', 5, 6, 30, 0.14], ['Shark', 4.5, 5, 40, 0.16], ['Dolphin', 3, 6, 45, 0.22],
      ['Fish1', 0.8, 26, 14, 0.4], ['Fish2', 0.7, 26, 16, 0.42], ['Fish3', 0.9, 26, 12, 0.38],
    ]
    for (const [file, len, n, r, sp] of spec) {
      loader.loadAsync(base + file + '.fbx').then((src) => {
        src.traverse(compactGroups)
        const box = new THREE.Box3().setFromObject(src)
        const size = box.getSize(new THREE.Vector3())
        const s = len / Math.max(size.x, size.y, size.z, 0.001)
        // school fish share a centre; the big animals roam alone
        const school = len < 1 ? this.swimSpot(pool, r, len, rand) : null
        for (let k = 0; k < n; k++) {
          const spot = school ?? this.swimSpot(pool, r, len, rand)
          if (!spot) continue
          const a = cloneSkinned(src)
          a.scale.setScalar(s)
          a.traverse((o) => { o.frustumCulled = false })
          const holder = new THREE.Group()
          holder.add(a)
          this.group.add(holder)
          const mixer = new THREE.AnimationMixer(a)
          if (src.animations[0]) { const act = mixer.clipAction(src.animations[0]); act.time = rand() * 2; act.play() }
          this.animals.push({ m: holder, mixer, c: spot.c.clone().setY(spot.c.y + 5 + rand() * 9), r: spot.r * (0.7 + rand() * 0.3), sp: sp * (rand() < 0.5 ? 1 : -1), ph: rand() * 6.3 })
        }
        if (file === 'Whale' && this.whale) this.whale.m.visible = false
        if (file === 'Manta_ray') for (const m of this.mantas) m.m.visible = false
      }).catch((e) => console.warn('[sea life]', file, e))
    }
  }
  /** A centre and radius whose whole circle stays clear of every glass tube. */
  private swimSpot(pool: THREE.Vector3[], r: number, len: number, rand: () => number): { c: THREE.Vector3; r: number } | null {
    const q = new THREE.Vector3()
    for (let tries = 0; tries < 60; tries++) {
      const c = pool[Math.floor(rand() * pool.length)]!
      const rad = r * (tries < 30 ? 1 : 0.5)
      let ok = this.clearOf(c, len)
      for (let a = 0; ok && a < 16; a++) {
        q.set(c.x + Math.cos(a / 16 * 6.283) * rad, c.y, c.z + Math.sin(a / 16 * 6.283) * rad)
        ok = this.clearOf(q, len / 2 + 4)
      }
      if (ok) return { c, r: rad }
    }
    return null
  }
  private readonly animals: { m: THREE.Group; mixer: THREE.AnimationMixer; c: THREE.Vector3; r: number; sp: number; ph: number }[] = []
  private lastTime = 0

  update(time: number, cam: THREE.Vector3): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime))
    this.lastTime = time
    // skinned models never cull themselves: only those near a submerged
    // camera are drawn or animated (the water hides the rest)
    const under = cam.y < 2
    for (const a of this.animals) {
      const t = time * a.sp + a.ph
      a.m.position.set(a.c.x + Math.cos(t) * a.r, a.c.y + Math.sin(t * 2) * 1.2, a.c.z + Math.sin(t) * a.r)
      const near = under && a.m.position.distanceToSquared(cam) < 260 * 260
      a.m.visible = near
      if (!near) continue
      a.m.rotation.y = -t + (a.sp > 0 ? Math.PI : 0)
      a.mixer.update(dt)
    }
    for (const j of this.jellies) {
      const t = time * 0.8 + j.ph
      j.m.position.set(j.base.x + Math.sin(t * 0.3) * 1.5, j.base.y + Math.sin(t) * 0.8, j.base.z + Math.cos(t * 0.27) * 1.5)
      const pulse = 1 + Math.sin(t * 2.2) * 0.08
      j.m.children[0]!.scale.set(pulse, 1 / pulse, pulse)
    }
    for (const m of this.mantas) {
      const a = time * m.sp + m.ph
      m.m.position.set(m.c.x + Math.cos(a) * m.r, m.c.y + Math.sin(a * 2) * 1.2, m.c.z + Math.sin(a) * m.r)
      m.m.rotation.y = -a // nose along the circle
      const flap = Math.sin(time * 1.6 + m.ph) * 0.35
      m.wings[0]!.rotation.z = -flap
      m.wings[1]!.rotation.z = flap
    }
    if (this.whale) {
      const w = this.whale
      const a = time * 0.03
      w.m.position.set(w.c.x + Math.cos(a) * w.r, w.c.y + Math.sin(time * 0.2) * 0.6, w.c.z + Math.sin(a) * w.r)
      w.m.rotation.y = -a
      w.tail.rotation.x = Math.sin(time * 0.9) * 0.25
    }
    if (this.bubbles) {
      const b = this.bubbles
      const pos = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      const PER = arr.length / 3 / b.vents.length
      for (let v = 0; v < b.vents.length; v++) {
        const vent = b.vents[v]!
        const H = Math.min(-1 - vent.y, 30)
        for (let k = 0; k < PER; k++) {
          const o = (v * PER + k) * 3
          const ph = (b.base[o + 1]! + time * 0.12) % 1
          arr[o] = vent.x + b.base[o]! + Math.sin(time * 3 + k) * 0.15
          arr[o + 1] = vent.y + ph * H
          arr[o + 2] = vent.z + b.base[o + 2]!
        }
      }
      pos.needsUpdate = true
    }
  }
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (non-indexed) so this file has no addon import
  const geos = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  let count = 0
  for (const g of geos) count += g.getAttribute('position').count
  const pos = new Float32Array(count * 3)
  const nrm = new Float32Array(count * 3)
  let o = 0
  for (const g of geos) {
    g.computeVertexNormals()
    pos.set(g.getAttribute('position').array as Float32Array, o)
    nrm.set(g.getAttribute('normal').array as Float32Array, o)
    o += g.getAttribute('position').count * 3
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return out
}
