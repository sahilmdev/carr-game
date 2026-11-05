import * as THREE from 'three'
import { softDot } from './biomes/kit'
import { SeaLife } from './SeaLife'
import type { Track } from './Track'
import { rockSet, tiled, photoSet } from './Textures'
import { buildGates, seaRibs } from './biomes/Spectacle'

/**
 * The underwater section as a real aquarium-style road tunnel:
 *  - a glass half-tube with steel ribs over the road
 *  - a sandy seabed lit by moving caustics
 *  - textured rocky trench walls, rocks, coral and swaying kelp
 *  - sunbeams slanting down from the surface, drifting particles
 *  - the water surface seen from below (bright, rippling)
 */
export class UnderwaterWorld {
  public readonly group = new THREE.Group()
  private readonly shaders: { uniforms: Record<string, THREE.IUniform> }[] = []
  private readonly shafts: THREE.Mesh[] = []
  private readonly snow: THREE.Points
  private readonly snowBase: Float32Array
  private readonly SNOW_BOX = 40

  constructor(private readonly track: Track, waterRects: [number, number, number, number][]) {
    const n = track.sampleCount
    const isUw = (i: number) => track.zoneOfSample(i) === 'underwater' && track.samples[i]!.y < -1.5
    const idx: number[] = []
    for (let i = 0; i < n; i++) if (isUw(i)) idx.push(i)
    const UP = new THREE.Vector3(0, 1, 0)
    const right = (i: number) => new THREE.Vector3().crossVectors(track.tangents[i]!, UP).normalize()

    // The tunnel spirals over itself. Where another pass of the road runs
    // nearby, this pass's seabed / rock walls / life would cut through it:
    //  - seabed only where nothing deeper runs within 85 m (the lowest pass)
    //  - trench walls and life only where no other pass is within 100 m
    const far = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, n - d) > 90 }
    const near = (i: number, r: number, deeperOnly: boolean) => {
      const p = track.samples[i]!
      for (let j = 0; j < n; j += 2) {
        if (!far(i, j)) continue
        const q = track.samples[j]!
        if (deeperOnly && q.y > p.y - 4) continue
        if (!deeperOnly && q.y > -1) continue // dry land road doesn't count
        if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < r * r) return true
      }
      return false
    }
    const openIdx = idx.filter((i) => !near(i, 100, false))
    const open = new Set(openIdx)
    const stackedIdx = idx.filter((i) => !open.has(i))

    this.buildSeabed(openIdx, right)
    // rock walls stand 66–90 m out: keep them well clear of the spiral
    this.buildWalls(idx.filter((i) => !near(i, 190, false)), right)
    this.buildTunnel(idx, right)
    this.buildTrench(right)
    // Where the road spirals over itself: one real sea floor under the
    // deepest pass, the tubes held up on steel pylons
    // (life on that floor keeps clear of every wet road sample, loops included)
    const wet: number[] = []
    for (let i = 0; i < n; i++) if (track.samples[i]!.y < -1) wet.push(i)
    const floorSpots = this.buildSpiralFloor(stackedIdx, wet)
    this.buildLife(openIdx.length ? openIdx : idx, right, floorSpots)

    // Landmarks and animals (wreck, ruins, fans, coral, jellyfish, mantas,
    // whale, bubble vents) on free sea floor, clear of every glass tube
    const wetPts = wet.filter((_, k) => k % 3 === 0).map((i) => track.samples[i]!)
    const clearOf = (p: THREE.Vector3, rad: number) => {
      const lim = (rad + track.width * 0.62 + 2) ** 2
      for (const q of wetPts) if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < lim) return false
      return true
    }
    const spots = floorSpots.slice()
    for (let k = 0; k < openIdx.length; k += 5) {
      const i = openIdx[k]!
      const p = track.samples[i]!
      const off = 24 + ((k * 7919) % 34)
      const side = k % 2 ? 1 : -1
      const v = p.clone().addScaledVector(right(i), side * off)
      v.y = p.y - 0.7 + off * 0.05
      if (v.y < -4) spots.push(v)
    }
    this.life = new SeaLife(spots, clearOf)
    this.group.add(this.life.group)
    this.buildShafts(idx, right)
    buildGates(track, this.group, ['underwater'], 55, () => false, 12.2)
    seaRibs(track, this.group, idx[Math.floor(idx.length * 0.72)]!)
    this.buildSurface(waterRects)
    // Marine snow: tiny particles drifting around the camera
    const COUNT = 900
    this.snowBase = new Float32Array(COUNT * 3)
    for (let k = 0; k < COUNT * 3; k++) this.snowBase[k] = (Math.random() * 2 - 1) * this.SNOW_BOX
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.04,
      color: 0xcfeee8, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false,
    }))
    this.snow.frustumCulled = false
    this.group.add(this.snow)
  }

  /** Ribbon of quads following the road: across offsets [a, b] (m), height offset dy. */
  private ribbon(idx: number[], right: (i: number) => THREE.Vector3, rows: { off: number; dy: (i: number, row: number) => number }[]): THREE.BufferGeometry {
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const R = rows.length
    let along = 0
    let prev: THREE.Vector3 | null = null
    let started = 0
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]!
      const p = this.track.samples[i]!
      // Break the ribbon where the underwater run is interrupted
      if (k > 0 && i !== idx[k - 1]! + 1) { started = pos.length / 3; prev = null }
      if (prev) along += prev.distanceTo(p)
      prev = p
      const r = right(i)
      for (let j = 0; j < R; j++) {
        const v = p.clone().addScaledVector(r, rows[j]!.off)
        pos.push(v.x, p.y + rows[j]!.dy(i, j), v.z)
        uv.push(rows[j]!.off / 8, along / 8)
      }
      const base = pos.length / 3 - R
      if (base - R >= started) {
        for (let j = 0; j < R - 1; j++) {
          const a = base - R + j, b = a + 1, c = base + j, d = c + 1
          index.push(a, c, b, b, c, d)
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(index)
    geo.computeVertexNormals()
    return geo
  }

  /** Inject animated caustic light into a standard material (world-space pattern). */
  private withCaustics(mat: THREE.MeshStandardMaterial, strength: number): THREE.MeshStandardMaterial {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      this.shaders.push(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUwWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvUwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vUwWorld;\nuniform float uTime;\n${CAUSTIC_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float cst = caustics(vUwWorld.xz * 0.33, uTime);
          // fainter the deeper we are
          float depthK = clamp(1.0 + vUwWorld.y / 40.0, 0.25, 1.0);
          totalEmissiveRadiance += vec3(0.55, 0.95, 0.9) * cst * ${strength.toFixed(2)} * depthK;`)
    }
    return mat
  }

  private buildSeabed(idx: number[], right: (i: number) => THREE.Vector3): void {
    const sand = photoSet('coral_gravel')
    const mat = this.withCaustics(new THREE.MeshStandardMaterial({
      color: 0xd8d0c0, map: sand.map, normalMap: sand.normalMap, roughness: 1, side: THREE.DoubleSide,
    }), 0.55)
    const rows = [-70, -45, -28, -14, 14, 28, 45, 70].map((off) => ({
      off,
      // gentle dunes, sloping up toward the trench walls
      dy: (i: number) => -0.4 + Math.abs(off) * 0.05 + Math.sin(i * 0.17 + off) * 0.6,
    }))
    // Rocky skirts at both edges dropping ~30 m, so where this seabed ends
    // above a deeper floor it reads as a reef cliff, not a floating shelf
    // Dip under the road itself (the ±14 m rows spanned the deck and the
    // dunes could rise through the asphalt)
    rows.splice(4, 0, { off: -11.5, dy: () => -1.0 }, { off: 11.5, dy: () => -1.0 })
    rows.unshift({ off: -76, dy: (i: number) => -30 + Math.sin(i * 0.11) * 3 })
    rows.push({ off: 76, dy: (i: number) => -30 + Math.cos(i * 0.13) * 3 })
    const bed = new THREE.Mesh(this.ribbon(idx, right, rows), mat)
    bed.receiveShadow = true
    this.group.add(bed)
  }

  private buildWalls(idx: number[], right: (i: number) => THREE.Vector3): void {
    const rock = tiled(rockSet(), 1, 1)
    const mat = this.withCaustics(new THREE.MeshStandardMaterial({
      color: 0x5f6a62, map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(1.6, 1.6),
      roughness: 1, side: THREE.DoubleSide,
    }), 0.25)
    for (const side of [-1, 1]) {
      // Several rows climbing outward and up, with noisy ledges
      const rows = [0, 1, 2, 3, 4].map((r) => ({
        off: side * (66 + r * 6),
        dy: (i: number) => {
          const p = this.track.samples[i]!
          const top = Math.min(-1.5 - p.y, 30)
          const base = 2 + r * (top / 4)
          return Math.min(base + Math.sin(i * 0.23 + r * 1.7) * 2.2 + Math.sin(i * 0.07 + side) * 3, top)
        },
      }))
      this.group.add(new THREE.Mesh(this.ribbon(idx, right, rows), mat))
    }
  }

  private buildTunnel(idx: number[], right: (i: number) => THREE.Vector3): void {
    const R = this.track.width * 0.62
    const SEG = 20 // around the half circle
    const glassGeoPos: number[] = []
    const glassIdx: number[] = []
    const ribs: THREE.Matrix4[] = []
    const dummy = new THREE.Object3D()
    let ring = 0
    let lastRib = -99
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]!
      const p = this.track.samples[i]!
      const deepEnough = p.y + R < -0.8 // the tube must stay under the surface
      if (!deepEnough) { ring = 0; continue }
      const r = right(i)
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI
        const v = p.clone().addScaledVector(r, Math.cos(a) * R)
        glassGeoPos.push(v.x, p.y + Math.sin(a) * R, v.z)
      }
      if (ring > 0) {
        const b = glassGeoPos.length / 3 - (SEG + 1)
        const a0 = b - (SEG + 1)
        for (let s = 0; s < SEG; s++) glassIdx.push(a0 + s, b + s, a0 + s + 1, a0 + s + 1, b + s, b + s + 1)
      }
      ring++
      if (i - lastRib >= 4) {
        lastRib = i
        const t = this.track.tangents[i]!
        dummy.position.copy(p)
        // Torus lies in its XY plane: turn its Z axis onto the road direction
        // so each half-ring spans across the road like the glass tube does
        dummy.rotation.set(0, Math.atan2(t.x, t.z), 0)
        dummy.updateMatrix()
        ribs.push(dummy.matrix.clone())
      }
    }
    if (!glassGeoPos.length) return
    const glassGeo = new THREE.BufferGeometry()
    glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassGeoPos, 3))
    glassGeo.setIndex(glassIdx)
    glassGeo.computeVertexNormals()
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
      color: 0xd8f4f6, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0,
      envMapIntensity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    }))
    glass.renderOrder = 3
    this.group.add(glass)
    const ribGeo = new THREE.TorusGeometry(R, 0.16, 6, 28, Math.PI)
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x8a949b, metalness: 0.85, roughness: 0.35 })
    const ribMesh = new THREE.InstancedMesh(ribGeo, ribMat, ribs.length)
    ribs.forEach((m, k) => ribMesh.setMatrixAt(k, m))
    ribMesh.computeBoundingSphere()
    this.group.add(ribMesh)
  }

  /**
   * Samples where the road is below (or just above) sea level but not yet
   * deep enough for the glass tube: the dive-in and climb-out approaches.
   * Scenery cuts the sea out over these so the car drives in a dry trench.
   */
  public readonly trenchIdx: number[] = []

  private buildTrench(right: (i: number) => THREE.Vector3): void {
    const t = this.track
    const R = t.width * 0.62
    const WATER_ZONES = new Set(['causeway', 'underwater', 'rampUp'])
    for (let i = 0; i < t.sampleCount; i++) {
      const p = t.samples[i]!
      if (!WATER_ZONES.has(t.zoneOfSample(i)) || p.y > 0.6) continue
      // overlap the glass tube by a few samples so there is no gap at the joint
      if (p.y + R < -0.8 && !(t.samples[i - 4] && t.samples[i - 4]!.y + R >= -0.8) &&
        !(t.samples[i + 4] && t.samples[i + 4]!.y + R >= -0.8)) continue
      this.trenchIdx.push(i)
    }
    if (!this.trenchIdx.length) return
    // Concrete retaining walls rising above the waterline, like a real
    // immersed-tunnel approach: inner face, top, outer face
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c9b95, roughness: 0.92, flatShading: true, side: THREE.DoubleSide })
    const top = (i: number) => Math.max(1.1 - t.samples[i]!.y, 0.5)
    for (const side of [-1, 1]) {
      const a = side * (t.width / 2 + 0.7), b = side * (t.width / 2 + 1.3)
      const rows = [
        { off: a, dy: () => -0.4 },
        { off: a, dy: top },
        { off: b, dy: top },
        { off: b, dy: () => -0.4 },
      ]
      const wall = new THREE.Mesh(this.ribbon(this.trenchIdx, right, rows), mat)
      wall.castShadow = wall.receiveShadow = true
      this.group.add(wall)
    }
  }

  /**
   * Sea floor under the spiral section + pylons under its tubes. Returns
   * points on that floor, clear of every tube, for kelp / rocks / coral.
   */
  private buildSpiralFloor(stacked: number[], all: number[]): THREE.Vector3[] {
    if (stacked.length < 10) return []
    const t = this.track
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity
    for (const i of stacked) {
      const p = t.samples[i]!
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y)
    }
    const pad = 75
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad
    const floorY = y0 - 3.5
    const w = x1 - x0, d = z1 - z0
    const geo = new THREE.PlaneGeometry(w, d, 64, 64)
    geo.rotateX(-Math.PI / 2)
    const pa = geo.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k), z = pa.getZ(k)
      // gentle dunes, rising toward the rim so it meets the shallower seabed
      const ex = Math.abs(x) / (w / 2), ez = Math.abs(z) / (d / 2)
      const rim = Math.pow(Math.max(ex, ez), 4) * 14
      pa.setY(k, Math.sin(x * 0.07) * Math.cos(z * 0.05) * 1.3 + Math.sin(x * 0.19 + z * 0.13) * 0.5 + rim)
    }
    geo.computeVertexNormals()
    const sand = photoSet('coral_gravel')
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 8, uv.getY(k) * d / 8)
    const floor = new THREE.Mesh(geo, this.withCaustics(new THREE.MeshStandardMaterial({
      color: 0xd8d0c0, map: sand.map, normalMap: sand.normalMap, roughness: 1,
    }), 0.5))
    floor.position.set((x0 + x1) / 2, floorY, (z0 + z1) / 2)
    floor.receiveShadow = true
    this.group.add(floor)

    // Pylons: a pair of steel legs under the deck every few metres
    const UP = new THREE.Vector3(0, 1, 0)
    const legs: THREE.Matrix4[] = []
    const dummy = new THREE.Object3D()
    for (let k = 0; k < stacked.length; k += 9) {
      const i = stacked[k]!
      const p = t.samples[i]!
      const h = p.y - 0.6 - floorY
      if (h < 3) continue
      const r = new THREE.Vector3().crossVectors(t.tangents[i]!, UP).normalize()
      for (const s of [-7, 7]) {
        dummy.position.copy(p).addScaledVector(r, s).setY(floorY + h / 2)
        dummy.scale.set(1, h, 1)
        dummy.updateMatrix()
        legs.push(dummy.matrix.clone())
      }
    }
    if (legs.length) {
      const legMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.5, 0.7, 1, 10),
        new THREE.MeshStandardMaterial({ color: 0x7d868c, metalness: 0.7, roughness: 0.5 }),
        legs.length,
      )
      legs.forEach((m, k) => legMesh.setMatrixAt(k, m))
      legMesh.computeBoundingSphere()
      this.group.add(legMesh)
    }

    // Free floor spots (clear of every tube by 18 m)
    const spots: THREE.Vector3[] = []
    let seed = 4242
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let k = 0; k < 900 && spots.length < 220; k++) {
      const x = x0 + pad * 0.5 + rand() * (w - pad), z = z0 + pad * 0.5 + rand() * (d - pad)
      let ok = true
      for (let j = 0; j < all.length && ok; j += 3) {
        const p = t.samples[all[j]!]!
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < 18 * 18) ok = false
      }
      if (ok) spots.push(new THREE.Vector3(x, floorY, z))
    }
    return spots
  }

  private buildLife(idx: number[], right: (i: number) => THREE.Vector3, floorSpots: THREE.Vector3[] = []): void {
    const dummy = new THREE.Object3D()
    let seed = 99
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const spot = (minOff: number, maxOff: number) => {
      // Some life on the spiral's sea floor too
      if (floorSpots.length && rand() < 0.4) {
        const f = floorSpots[Math.floor(rand() * floorSpots.length)]!
        return f.clone().add(new THREE.Vector3((rand() - 0.5) * 6, 0, (rand() - 0.5) * 6))
      }
      const i = idx[Math.floor(rand() * idx.length)]!
      const p = this.track.samples[i]!
      const side = rand() < 0.5 ? -1 : 1
      const off = minOff + rand() * (maxOff - minOff)
      const v = p.clone().addScaledVector(right(i), side * off)
      v.y = p.y - 0.4 + off * 0.05
      return v
    }

    // Kelp: tall blades that sway (vertex shader)
    const kelpTex = (() => {
      const c = document.createElement('canvas')
      c.width = 32; c.height = 256
      const ctx = c.getContext('2d')!
      const g = ctx.createLinearGradient(0, 0, 0, 256)
      g.addColorStop(0, '#6d7d2e'); g.addColorStop(1, '#2d4a1c')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(16, 256)
      for (let y = 256; y >= 0; y -= 8) ctx.lineTo(16 + Math.sin(y * 0.08) * 6 + 9, y)
      for (let y = 0; y <= 256; y += 8) ctx.lineTo(16 + Math.sin(y * 0.08) * 6 - 9, y)
      ctx.fill()
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    const kelpMat = new THREE.MeshStandardMaterial({ map: kelpTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 })
    kelpMat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      this.shaders.push(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 kw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 0.9 + kw.x * 0.3 + position.y * 0.35) * 0.6;
          transformed.x += sway * uv.y * uv.y * 2.0;
          transformed.z += cos(uTime * 0.7 + kw.z * 0.2) * uv.y * 0.8;`)
    }
    const kelpGeo = new THREE.PlaneGeometry(1.2, 9, 1, 8)
    kelpGeo.translate(0, 4.5, 0)
    const kelpSpots: THREE.Matrix4[] = []
    for (let k = 0; k < 260; k++) {
      const v = spot(16, 62)
      // Kelp must stay under the surface: cap height by the water depth
      const maxScale = (-1.5 - v.y) / 9
      if (maxScale < 0.25) continue
      for (let b = 0; b < 3; b++) {
        dummy.position.set(v.x + (rand() - 0.5) * 2, v.y, v.z + (rand() - 0.5) * 2)
        dummy.rotation.set(0, rand() * Math.PI, 0)
        dummy.scale.setScalar(Math.min(0.6 + rand() * 0.9, maxScale))
        dummy.updateMatrix()
        kelpSpots.push(dummy.matrix.clone())
      }
    }
    const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, kelpSpots.length)
    kelpSpots.forEach((m, k) => kelp.setMatrixAt(k, m))
    kelp.computeBoundingSphere()
    this.group.add(kelp)

    // Rocks (textured, lumpy)
    const rock = tiled(rockSet(), 1, 1)
    const rockGeo = new THREE.IcosahedronGeometry(1.4, 2)
    const rp = rockGeo.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < rp.count; k++) {
      const s = 0.75 + Math.sin(rp.getX(k) * 3.1) * 0.12 + Math.cos(rp.getZ(k) * 2.7) * 0.12 + (rand() - 0.5) * 0.1
      rp.setXYZ(k, rp.getX(k) * s, rp.getY(k) * s * 0.7, rp.getZ(k) * s)
    }
    rockGeo.computeVertexNormals()
    const rockMat = this.withCaustics(new THREE.MeshStandardMaterial({ color: 0x6b736a, map: rock.map, normalMap: rock.normalMap, roughness: 1 }), 0.3)
    const rockSpots: THREE.Matrix4[] = []
    for (let k = 0; k < 140; k++) {
      const v = spot(15, 62)
      const maxScale = (-1 - v.y) / 1.2 // rock tops stay below the surface
      if (maxScale < 0.4) continue
      dummy.position.copy(v)
      dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4)
      dummy.scale.setScalar(Math.min(0.8 + rand() * 3, maxScale))
      dummy.updateMatrix()
      rockSpots.push(dummy.matrix.clone())
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length)
    rockSpots.forEach((m, k) => rocks.setMatrixAt(k, m))
    rocks.computeBoundingSphere()
    rocks.castShadow = true
    this.group.add(rocks)

    // Coral heads: clusters of rounded lumps in muted reef colours
    const coralColors = [0x9a6a5a, 0x9c8664, 0x7e6676, 0xa89272, 0x6f7a62]
    // Knobbly, lobed heads (smooth spheres read as plastic balls)
    const geo = new THREE.IcosahedronGeometry(0.6, 3)
    {
      const cp = geo.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < cp.count; k++) {
        const x = cp.getX(k), y = cp.getY(k), z = cp.getZ(k)
        const s = 1 + 0.14 * Math.sin(x * 11) * Math.sin(y * 13) * Math.sin(z * 12) + 0.1 * Math.sin(x * 5 + z * 6)
        cp.setXYZ(k, x * s, Math.max(y, -0.2) * s, z * s) // flat base sitting on the sand
      }
      geo.computeVertexNormals()
    }
    for (const col of coralColors) {
      const mat = this.withCaustics(new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }), 0.25)
      const spots: THREE.Matrix4[] = []
      for (let k = 0; k < 60; k++) {
        const v = spot(14, 40)
        if (v.y > -3) continue // too shallow: would break the surface
        for (let b = 0; b < 5; b++) {
          dummy.position.set(v.x + (rand() - 0.5) * 1.6, v.y + rand() * 0.6, v.z + (rand() - 0.5) * 1.6)
          dummy.scale.set(0.5 + rand() * 0.8, 0.4 + rand() * 1.2, 0.5 + rand() * 0.8)
          dummy.rotation.set(0, rand() * 3, 0)
          dummy.updateMatrix()
          spots.push(dummy.matrix.clone())
        }
      }
      const m = new THREE.InstancedMesh(geo, mat, spots.length)
      spots.forEach((s, k) => m.setMatrixAt(k, s))
      m.computeBoundingSphere()
      this.group.add(m)
    }
  }

  /** Sunbeams: tall, soft additive light cones angled down from the surface. */
  private buildShafts(idx: number[], right: (i: number) => THREE.Vector3): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.045 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        varying float vDist;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          vDist = length(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        varying float vDist;
        void main() {
          float edge = pow(abs(dot(vN, vView)), 3.0);          // soft, feathered sides
          // fade toward the bottom AND at the very top, so no hard rim shows
          float fall = smoothstep(0.0, 0.7, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
          // broken into streaks that slowly drift, like light through waves
          float streak = 0.45 + 0.55 * max(0.0, sin(vUv.x * 41.0 + uTime * 0.45) * sin(vUv.x * 17.0 - uTime * 0.3));
          float near = smoothstep(6.0, 28.0, vDist);         // no glowing wall right at the camera
          gl_FragColor = vec4(vec3(0.55, 0.9, 0.85) * edge * fall * streak * near * uIntensity, 1.0);
        }`,
    })
    this.shaders.push(mat as unknown as { uniforms: Record<string, THREE.IUniform> })
    const geo = new THREE.CylinderGeometry(1.5, 4.5, 40, 16, 1, true)
    geo.translate(0, -20, 0)
    let seed = 7
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let k = 0; k < 28; k++) {
      const i = idx[Math.floor(rand() * idx.length)]!
      const p = this.track.samples[i]!
      const v = p.clone().addScaledVector(right(i), (rand() - 0.5) * 70)
      const m = new THREE.Mesh(geo, mat)
      m.position.set(v.x, -0.5, v.z)
      m.rotation.set(0.35 + (rand() - 0.5) * 0.1, 0.4, (rand() - 0.5) * 0.15) // sun is to one side
      m.userData['phase'] = rand() * 6
      this.group.add(m)
      this.shafts.push(m)
    }
  }

  /** The underside of the sea surface: bright, rippling, darker at grazing angles. */
  private buildSurface(rects: [number, number, number, number][]): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vW;
        ${CAUSTIC_GLSL}
        void main() {
          vec3 toEye = normalize(cameraPosition - vW);
          float up = clamp(-toEye.y, 0.0, 1.0);           // looking straight up = 1
          float window = smoothstep(0.55, 0.85, up);        // Snell's window: bright overhead
          float rip = caustics(vW.xz * 0.12, uTime * 0.6);
          vec3 deep = vec3(0.03, 0.18, 0.2);
          vec3 lit = vec3(0.45, 0.8, 0.82) + rip * 0.25;
          vec3 c = mix(deep, lit, window);
          float distFade = exp(-length(cameraPosition - vW) * 0.012);
          gl_FragColor = vec4(c, 0.85 * distFade + 0.15);
        }`,
    })
    this.shaders.push(mat as unknown as { uniforms: Record<string, THREE.IUniform> })
    for (const [x, z, w, d] of rects) {
      const g = new THREE.PlaneGeometry(w, d)
      g.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(g, mat)
      m.position.set(x, -0.03, z)
      this.group.add(m)
    }
  }

  private life: SeaLife | null = null

  update(time: number, camera: THREE.Camera): void {
    this.life?.update(time, camera.position)
    for (const s of this.shaders) s.uniforms['uTime']!.value = time % 1000
    for (const m of this.shafts) {
      const ph = m.userData['phase'] as number
      m.rotation.z = Math.sin(time * 0.15 + ph) * 0.08
    }
    // Marine snow follows the camera, drifting slowly
    const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const B = this.SNOW_BOX
    const c = camera.position
    for (let k = 0; k < arr.length; k += 3) {
      const ox = this.snowBase[k]! + Math.sin(time * 0.2 + k) * 0.5
      const oy = this.snowBase[k + 1]! - ((time * 0.3) % (2 * B))
      const oz = this.snowBase[k + 2]!
      // wrap each particle into a box around the camera
      arr[k] = c.x + (((ox - c.x) % (2 * B)) + 3 * B) % (2 * B) - B
      arr[k + 1] = c.y + (((oy - c.y) % (2 * B)) + 3 * B) % (2 * B) - B
      arr[k + 2] = c.z + (((oz - c.z) % (2 * B)) + 3 * B) % (2 * B) - B
    }
    pos.needsUpdate = true
  }
}

/** Animated caustic network: bright thin light lines where wave lenses focus. */
export const CAUSTIC_GLSL = /* glsl */ `
  float caustics(vec2 p, float t) {
    vec2 q = p;
    float c = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      q += vec2(sin(q.y * 1.7 + t * 0.9 + fi), cos(q.x * 1.3 - t * 0.7 + fi * 1.7)) * 0.45;
      c += 1.0 / (1.0 + 30.0 * abs(sin(q.x + fi) * sin(q.y - fi)));
    }
    c /= 3.0;
    return c * c * 1.6;
  }`
