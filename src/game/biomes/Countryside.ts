import * as THREE from 'three'
import type { Track } from '../Track'
import { WATER_RECTS } from '../Vegetation'
import { treePool, bushGeometry } from '../Trees'
import { instanceVariants } from './Jungle'
import { props, at } from './Props'
import { RoadIndex, rng, fbm2, instanced, trs, smooth } from './kit'
import { groundSet, tiled } from '../Textures'

/**
 * The open meadow between the town and the bay (the menu camera looks
 * straight across it): farmland, hedgerows, tree groves, a farmstead,
 * wind turbines along the shore, scanned boulders and shrubs.
 */
export class Countryside {
  readonly group = new THREE.Group()
  private readonly rand = rng(808)
  private readonly road: RoadIndex
  private rotors: THREE.Object3D[] = []

  /** The empty land: x0, z0, x1, z1 */
  private static readonly AREAS: [number, number, number, number][] = [
    [-260, 40, 430, 330],
    [-300, -250, -60, -40],
  ]

  constructor(private readonly track: Track) {
    this.group.userData['biome'] = 'coast'
    this.road = new RoadIndex(track, 24, true)
    this.buildFields()
    this.buildTrees()
    this.buildHedges()
    this.buildFarm()
    this.buildTurbines()
    this.buildRocks()
    this.buildCoast()
  }

  /** The bay: anchored ships, channel markers, a pier and scanned sea cliffs. */
  private buildCoast(): void {
    props.place('dutch_ship_medium', [at(640, -1.2, 120, 0.8, 1), at(720, -1.2, 300, 2.3, 1.1), at(610, -1.2, 470, 4, 0.95)], this.group, { cast: true })
    const buoys: THREE.Matrix4[] = [], marks: THREE.Matrix4[] = []
    for (let k = 0; k < 8; k++) {
      const z = 40 + k * 45
      buoys.push(at(575 + this.rand() * 20, -0.5, z, this.rand() * 6))
      if (k % 2) marks.push(at(430 + this.rand() * 10, -1.2, z + 20, this.rand() * 6))
    }
    props.place('ocean_buoy', buoys, this.group)
    props.place('lateral_sea_marker', marks, this.group, { cast: true })
    const pier: THREE.Matrix4[] = []
    for (let k = 0; k < 8; k++) pier.push(at(388 + k * 6, -4.2, 210, Math.PI / 2))
    props.place('modular_wooden_pier', pier, this.group, { cast: true })
    props.place('coastal_cliff_01', [at(40, -1.5, 324, 0), at(135, -1.5, 324, 0), at(230, -1.5, 324, 0), at(325, -1.5, 324, 0)], this.group, { cast: true })
  }

  private wet(x: number, z: number, pad = 12): boolean {
    for (const [cx, cz, w, h] of WATER_RECTS) if (Math.abs(x - cx) < w / 2 + pad && Math.abs(z - cz) < h / 2 + pad) return true
    return false
  }

  /** Free land: in an area, off water, well clear of every road and the town. */
  private free(x: number, z: number, clear = 22): boolean {
    if (!Countryside.AREAS.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) return false
    if (this.wet(x, z)) return false
    // the town's buildings stand up to ~70 m from its main street
    if (z < 90 && x > -60 && x < 260) return false
    return !this.road.near(x, z, clear)
  }

  private spot(clear = 22, tries = 40): [number, number] | null {
    for (let k = 0; k < tries; k++) {
      const a = Countryside.AREAS[this.rand() < 0.8 ? 0 : 1]!
      const x = a[0] + this.rand() * (a[2] - a[0]), z = a[1] + this.rand() * (a[3] - a[1])
      if (this.free(x, z, clear)) return [x, z]
    }
    return null
  }

  /**
   * Farmland: photo-textured soil (the same scanned ground as the verges,
   * tinted per crop) with the crop itself planted in real rows: wheat and
   * barley as dense gold rows, vegetables as low green rows, vineyards as
   * trellised rows on posts, pasture left as grass with hay bales.
   */
  private buildFields(): void {
    const soil = groundSet()
    const kinds = [
      { tint: 0xc9b37a, crop: 0xd6b45a, rowGap: 0.9, h: 0.9, posts: false }, // wheat
      { tint: 0xb8a070, crop: 0xb9b052, rowGap: 0.9, h: 0.75, posts: false }, // barley
      { tint: 0x8a7258, crop: 0x5f8f3a, rowGap: 1.6, h: 0.45, posts: false }, // vegetables
      { tint: 0x8f7a5c, crop: 0x557d33, rowGap: 2.6, h: 1.5, posts: true }, // vineyard
      { tint: 0xffffff, crop: 0, rowGap: 0, h: 0, posts: false }, // pasture
    ]
    const bush = bushGeometry()
    let made = 0
    for (let k = 0; k < 90 && made < 14; k++) {
      const s = this.spot(40)
      if (!s) continue
      const [x, z] = s
      const w = 50 + this.rand() * 50, d = 40 + this.rand() * 40
      const ok = [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => this.free(x + a! * w / 2, z + b! * d / 2, 16))
      if (!ok) continue
      const kind = kinds[made % kinds.length]!
      const rot = (this.rand() - 0.5) * 0.6
      const color = tiled(soil, w / 30, d / 30)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({
        map: color.map, normalMap: color.normalMap, roughnessMap: color.roughnessMap, color: kind.tint, roughness: 1,
        alphaMap: fieldEdge(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }))
      m.rotation.x = -Math.PI / 2
      m.rotation.z = rot
      m.position.set(x, 0.02, z)
      m.receiveShadow = true
      this.group.add(m)
      const c = Math.cos(rot), sn = Math.sin(rot)
      const place = (u: number, v: number) => [x + u * c + v * sn, z - u * sn + v * c] as const
      if (kind.rowGap > 0) {
        const mat = bush.material.clone()
        mat.color.set(kind.crop)
        const mats: THREE.Matrix4[] = []
        for (let v = -d / 2 + 1.5; v < d / 2 - 1.5; v += kind.rowGap) {
          for (let u = -w / 2 + 1.5; u < w / 2 - 1.5; u += 1.3 + this.rand() * 0.5) {
            const [px, pz] = place(u, v)
            mats.push(trs(px, 0, pz, this.rand() * 6, new THREE.Vector3(1.0, kind.h * (0.8 + this.rand() * 0.4), 1.0)))
          }
        }
        this.group.add(instanced(bush.geometry, mat, mats, undefined, false))
        if (kind.posts) {
          const post = new THREE.CylinderGeometry(0.05, 0.06, 1.8, 5)
          post.translate(0, 0.9, 0)
          const pm: THREE.Matrix4[] = []
          for (let v = -d / 2 + 1.5; v < d / 2 - 1.5; v += kind.rowGap)
            for (let u = -w / 2 + 1.5; u < w / 2 - 1.5; u += 6) { const [px, pz] = place(u, v); pm.push(trs(px, 0, pz, 0)) }
          this.group.add(instanced(post, new THREE.MeshStandardMaterial({ color: 0x6b5640, roughness: 1 }), pm))
        }
      } else {
        const bale = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 14)
        bale.rotateZ(Math.PI / 2)
        const bm: THREE.Matrix4[] = []
        for (let q = 0; q < 10; q++) { const [px, pz] = place((this.rand() - 0.5) * w * 0.8, (this.rand() - 0.5) * d * 0.8); bm.push(trs(px, 0.8, pz, this.rand() * 6)) }
        this.group.add(instanced(bale, new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1 }), bm))
      }
      made++
    }
  }


  /** Groves of broadleaf trees with the odd palm near the shore. */
  private buildTrees(): void {
    const broad: THREE.Matrix4[] = [], palm: THREE.Matrix4[] = []
    for (let grove = 0; grove < 22; grove++) {
      const c = this.spot(26)
      if (!c) continue
      const n = 5 + Math.floor(this.rand() * 12)
      for (let k = 0; k < n; k++) {
        const x = c[0] + (this.rand() - 0.5) * 50, z = c[1] + (this.rand() - 0.5) * 50
        if (!this.free(x, z, 18)) continue
        const nearShore = this.wet(x, z, 60)
        ;(nearShore && this.rand() < 0.5 ? palm : broad).push(trs(x, 0, z, this.rand() * 6, 0.9 + this.rand() * 0.9))
      }
    }
    this.group.add(instanceVariants(treePool('broadleaf'), broad, this.rand))
    this.group.add(instanceVariants(treePool('palm'), palm, this.rand))
  }

  /** Hedgerows along the field edges and a few dry-stone walls. */
  private buildHedges(): void {
    const bush = bushGeometry()
    const mat = bush.material.clone()
    mat.color.setRGB(0.55, 0.75, 0.4)
    const mats: THREE.Matrix4[] = []
    const stone = new THREE.BoxGeometry(1, 1, 1)
    const walls: THREE.Matrix4[] = []
    for (let k = 0; k < 18; k++) {
      const s = this.spot(24)
      if (!s) continue
      const a = this.rand() * Math.PI, len = 60 + this.rand() * 90
      const dx = Math.cos(a), dz = Math.sin(a)
      const isWall = k % 4 === 0
      for (let u = -len / 2; u < len / 2; u += isWall ? 1.2 : 1.6) {
        const x = s[0] + dx * u, z = s[1] + dz * u
        if (!this.free(x, z, 16)) continue
        if (isWall) walls.push(trs(x, 0.45, z, -a + (this.rand() - 0.5) * 0.1, new THREE.Vector3(1.3, 0.9 + this.rand() * 0.2, 0.7)))
        else mats.push(trs(x, 0, z, this.rand() * 6, new THREE.Vector3(1.5, 1.2 + this.rand() * 0.5, 1.5)))
      }
    }
    this.group.add(instanced(bush.geometry, mat, mats))
    this.group.add(instanced(stone, new THREE.MeshStandardMaterial({ color: 0x8d877a, roughness: 1 }), walls))
  }

  /** A farmstead: house, red barn, grain silos, fenced yard. */
  private buildFarm(): void {
    for (let farm = 0; farm < 2; farm++) {
      const s = this.spot(45, 120)
      if (!s) continue
      const g = new THREE.Group()
      const white = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.85 })
      const red = new THREE.MeshStandardMaterial({ color: 0x9a2f22, roughness: 0.8 })
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.7, metalness: 0.3 })
      const steel = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.4, metalness: 0.8 })
      const house = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 8), white)
      house.position.set(-12, 2.5, 0)
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.4, 3.5, 4, 1), roofMat)
      roof.rotation.y = Math.PI / 4
      roof.scale.set(1, 1, 0.82)
      roof.position.set(-12, 6.7, 0)
      const barn = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 20), red)
      barn.position.set(8, 3.5, 0)
      const barnRoof = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 20.6, 4, 1, false, 0, Math.PI), roofMat)
      barnRoof.rotation.set(0, 0, 0)
      barnRoof.rotation.x = Math.PI / 2
      barnRoof.rotation.z = Math.PI / 2
      barnRoof.scale.set(1, 1, 0.45)
      barnRoof.position.set(8, 7, 0)
      const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ color: 0xf2efe6 }))
      door.position.set(8, 2.5, 10.02)
      g.add(house, roof, barn, barnRoof, door)
      for (const sx of [20, 25]) {
        const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 13, 20), steel)
        silo.position.set(sx, 6.5, -6)
        const cap = new THREE.Mesh(new THREE.ConeGeometry(2.3, 2, 20), steel)
        cap.position.set(sx, 14, -6)
        g.add(silo, cap)
      }
      // windows
      const win = new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.15, metalness: 0.4 })
      for (const wx of [-15, -9]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), win)
        w.position.set(wx, 2.8, 4.02)
        g.add(w)
      }
      // post-and-rail fence round the yard
      const post = new THREE.BoxGeometry(0.18, 1.3, 0.18)
      const rail = new THREE.BoxGeometry(3, 0.12, 0.08)
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 1 })
      const pm: THREE.Matrix4[] = [], rm: THREE.Matrix4[] = []
      for (let u = -30; u <= 30; u += 3) {
        for (const [px, pz, ry] of [[u, 18, 0], [u, -16, 0], [-30, u * 0.6, Math.PI / 2], [32, u * 0.6, Math.PI / 2]] as const) {
          pm.push(trs(px, 0.65, pz, 0))
          for (const h of [0.5, 1.0]) rm.push(trs(px + (ry ? 0 : 1.5), h, pz + (ry ? 1.5 : 0), ry))
        }
      }
      g.add(instanced(post, wood, pm), instanced(rail, wood, rm))
      g.position.set(s[0], 0, s[1])
      g.rotation.y = this.rand() * Math.PI * 2
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
      this.group.add(g)
      // hay bales in the field next door
      const bale = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 14)
      bale.rotateZ(Math.PI / 2)
      const bm: THREE.Matrix4[] = []
      for (let k = 0; k < 14; k++) {
        const x = s[0] + 40 + (this.rand() - 0.5) * 40, z = s[1] + (this.rand() - 0.5) * 40
        if (this.free(x, z, 14)) bm.push(trs(x, 0.8, z, this.rand() * 6))
      }
      this.group.add(instanced(bale, new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1 }), bm))
    }
  }

  /** A line of wind turbines along the shore (blades turn). */
  private buildTurbines(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.45, metalness: 0.2 })
    const tower = new THREE.CylinderGeometry(0.9, 1.7, 55, 16)
    tower.translate(0, 27.5, 0)
    const blade = new THREE.BoxGeometry(1.4, 24, 0.3)
    blade.translate(0, 12, 0)
    let placed = 0
    const used: [number, number][] = []
    for (let k = 0; k < 400 && placed < 6; k++) {
      const s = this.spot(40)
      if (!s) continue
      if (!this.wet(s[0], s[1], 90)) continue // near the water
      if (used.some(([ux, uz]) => Math.hypot(ux - s[0], uz - s[1]) < 75)) continue
      // keep clear of the menu camera's orbit (centre 110,110, radius 250)
      if (Math.abs(Math.hypot(s[0] - 110, s[1] - 110) - 250) < 60) continue
      const g = new THREE.Group()
      g.add(new THREE.Mesh(tower, white))
      const nac = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 7), white)
      nac.position.set(0, 56, 0)
      g.add(nac)
      const rotor = new THREE.Group()
      rotor.position.set(0, 56, 4)
      const hub = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), white)
      rotor.add(hub)
      for (let b = 0; b < 3; b++) {
        const bl = new THREE.Mesh(blade, white)
        bl.rotation.z = (b * Math.PI * 2) / 3
        rotor.add(bl)
      }
      rotor.rotation.z = this.rand() * 6
      g.add(rotor)
      // face the prevailing (sea) wind
      g.rotation.y = -0.6
      g.position.set(s[0], 0, s[1])
      g.traverse((o) => { o.castShadow = true })
      this.rotors.push(rotor)
      this.group.add(g)
      placed++
      used.push(s)
    }
  }

  /** Scanned boulders, stones and shrubs across the meadow. */
  private buildRocks(): void {
    const spots = (n: number, clear = 18) => {
      const out: [number, number][] = []
      for (let k = 0; k < n; k++) { const s = this.spot(clear); if (s) out.push(s) }
      return out
    }
    props.place('boulder_01', spots(30).map(([x, z]) => at(x, -0.15, z, this.rand() * 6, 0.8 + this.rand() * 1.6)), this.group)
    props.place('rock_moss_set_01', spots(16).map(([x, z]) => at(x, 0.4, z, this.rand() * 6, 0.9 + this.rand() * 0.8)), this.group)
    props.place('shrub_02', spots(80, 14).map(([x, z]) => at(x, -0.2, z, this.rand() * 6, 0.8 + this.rand() * 0.7)), this.group)
    props.place('tree_stump_01', spots(16).map(([x, z]) => at(x, -0.1, z, this.rand() * 6, 0.8 + this.rand() * 0.5)), this.group)
    props.place('dead_tree_trunk', spots(10).map(([x, z]) => at(x, 0, z, this.rand() * 6, 1 + this.rand() * 0.5)), this.group)
    void fbm2; void smooth
  }

  update(time: number): void {
    if (!this.group.visible) return
    for (const r of this.rotors) r.rotation.z = time * 0.9 + r.id
  }
}

let edgeTex: THREE.CanvasTexture | null = null
/** Soft-edged mask: field soil fades out into the surrounding grass. */
function fieldEdge(): THREE.CanvasTexture {
  if (edgeTex) return edgeTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 128, 128)
  g.filter = 'blur(9px)'
  g.fillStyle = '#fff'
  g.fillRect(16, 16, 96, 96)
  edgeTex = new THREE.CanvasTexture(c)
  return edgeTex
}
