import * as THREE from 'three'
import { props, type PropName } from '../game/biomes/Props'
import { treePool, type TreeKind } from '../game/Trees'
import { lumpy, rng, trs } from '../game/biomes/kit'
import type { AssetLoader } from '../game/AssetLoader'
import type { Circuit } from './Circuit'
import type { World } from './World'

const BASE = import.meta.env.BASE_URL
const loading = new Map<string, Promise<void>>()

/** Placing things round a track. Everything solid here also blocks cars. */
export class Dresser {
  readonly rand: () => number
  private readonly waits: Promise<unknown>[] = []

  constructor(readonly root: THREE.Group, readonly circuit: Circuit, readonly world: World, readonly assets: AssetLoader, seed: number) {
    this.rand = rng(seed)
  }

  /** Metres from this point to the nearest road, ignoring height. */
  roadGap(x: number, z: number): number {
    let best = 1e9
    for (const c of this.circuit.all) for (let i = 0; i < c.count; i += 3) {
      const p = c.samples[i]!
      const d = Math.hypot(p.x - x, p.z - z) - c.widths[i]! / 2
      if (d < best) best = d
    }
    return best
  }

  /** Random spots beside the road between these sample fractions. */
  spots(count: number, min: number, max: number, opts: { from?: number; to?: number; clear?: number; side?: number; test?: (x: number, z: number, y: number) => boolean } = {}): THREE.Vector3[] {
    const c = this.circuit, out: THREE.Vector3[] = []
    const from = opts.from ?? 0, to = opts.to ?? 1, clear = opts.clear ?? 3
    for (let k = 0; k < count * 12 && out.length < count; k++) {
      const i = Math.floor((from + this.rand() * (to - from)) * c.count) % c.count
      const p = c.samples[i]!, r = c.rights[i]!
      const side = opts.side ?? (this.rand() < 0.5 ? -1 : 1)
      const off = side * (c.widths[i]! / 2 + min + this.rand() * (max - min))
      const x = p.x + r.x * off, z = p.z + r.z * off
      if (this.roadGap(x, z) < clear || this.world.blocked(x, z, 2)) continue
      const y = this.world.terrainAt(x, z)
      if (y < this.world.sea + 0.5) continue
      if (opts.test && !opts.test(x, z, y)) continue
      out.push(new THREE.Vector3(x, y, z))
    }
    return out
  }

  instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast = true, colors?: THREE.Color[]): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, mats.length)
    mats.forEach((x, k) => m.setMatrixAt(k, x))
    colors?.forEach((c, k) => m.setColorAt(k, c))
    m.castShadow = cast
    m.receiveShadow = true
    m.computeBoundingSphere()
    this.root.add(m)
    return m
  }

  /** Trees at these spots, each with a solid trunk. */
  trees(kind: TreeKind, spots: THREE.Vector3[], scale: [number, number], trunk = 0.8, tint?: (m: THREE.MeshStandardMaterial) => THREE.Material): void {
    const variants = treePool(kind).userData['variants'] as THREE.Group[]
    const per = variants.map(() => [] as THREE.Matrix4[])
    for (const s of spots) {
      const k = Math.floor(this.rand() * variants.length)
      const sc = scale[0] + this.rand() * (scale[1] - scale[0])
      per[k]!.push(trs(s.x, s.y - 0.2, s.z, this.rand() * 6.28, sc))
      this.world.addPost(s.x, s.z, trunk * sc * 0.5)
    }
    variants.forEach((v, k) => {
      if (!per[k]!.length) return
      v.updateMatrixWorld(true)
      v.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const mat = tint ? tint(m.material as THREE.MeshStandardMaterial) : (m.material as THREE.Material)
        const im = this.instanced(m.geometry, mat, per[k]!.map((x) => x.clone().multiply(m.matrixWorld)))
        im.userData['shared'] = true
      })
    })
  }

  /** Full-crowned trees built from soft lumps: blossom, dense canopy. */
  crowns(spots: THREE.Vector3[], scale: [number, number], trunk: number, leaves: number[], trunkR = 0.5, near = true): void {
    const trunks: THREE.Matrix4[] = [], lumps: THREE.Matrix4[] = [], cols: THREE.Color[] = []
    for (const s of spots) {
      const sc = scale[0] + this.rand() * (scale[1] - scale[0])
      trunks.push(trs(s.x, s.y + sc * 1.6, s.z, this.rand() * 6, new THREE.Vector3(sc * trunkR, sc * 3.4, sc * trunkR)))
      this.world.addPost(s.x, s.z, Math.min(1.6, sc * 0.3))
      const base = new THREE.Color(leaves[Math.floor(this.rand() * leaves.length)]!)
      for (let k = 0; k < 6; k++) {
        const a = this.rand() * 6.28, r = k === 0 ? 0 : sc * (0.9 + this.rand() * 0.8), l = sc * (1.3 + this.rand() * 0.8)
        lumps.push(trs(s.x + Math.cos(a) * r, s.y + sc * 3.3 + (k === 0 ? sc * 0.7 : this.rand() * sc * 0.9), s.z + Math.sin(a) * r, this.rand() * 6, new THREE.Vector3(l, l * 0.72, l)))
        cols.push(base.clone().offsetHSL(0, 0, (this.rand() - 0.5) * 0.09))
      }
    }
    this.instanced(new THREE.CylinderGeometry(0.42, 0.6, 1, 7), new THREE.MeshStandardMaterial({ color: trunk, roughness: 0.95 }), trunks, near)
    this.instanced(lumpy(new THREE.IcosahedronGeometry(1, near ? 2 : 1), 0.2, 1.8, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), lumps, near, cols)
  }

  /**
   * Scanned props, loaded in the background; the track waits for them. They
   * are detailed models, so they go in cells that are only drawn nearby.
   * `range` 0 keeps them always drawn: landmarks that are seen from afar.
   */
  prop(name: PropName, mats: THREE.Matrix4[], solid = 0, tint?: THREE.Color, range = 260): void {
    if (!mats.length) return
    if (solid > 0) for (const m of mats) {
      const e = m.elements
      this.world.addPost(e[12]!, e[14]!, solid * Math.hypot(e[0]!, e[1]!, e[2]!))
    }
    const cells = new Map<string, THREE.Matrix4[]>()
    for (const m of mats) {
      const e = m.elements, key = range ? `${Math.floor(e[12]! / 130)},${Math.floor(e[14]! / 130)}` : 'all'
      const l = cells.get(key)
      if (l) l.push(m)
      else cells.set(key, [m])
    }
    this.waits.push(props.load(name).then((parts) => {
      for (const part of parts ?? []) {
        let mat = part.material as THREE.MeshStandardMaterial
        if (tint) { mat = mat.clone(); mat.color.multiply(tint) }
        for (const list of cells.values()) {
          const im = this.instanced(part.geometry, mat, list, false)
          im.userData['shared'] = true
          if (!range) continue
          const c = list[0]!.elements
          this.cells.push({ o: im, x: c[12]!, z: c[14]!, range })
          im.visible = false
        }
      }
    }))
  }

  private readonly cells: { o: THREE.Object3D; x: number; z: number; range: number }[] = []
  private cellTick = 0
  /** Show nearby cells and hide far ones; cheap enough to run every few frames. */
  tick(cam: THREE.Vector3): void {
    if (++this.cellTick % 9) return
    for (const c of this.cells) c.o.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < c.range
  }

  /** A GLB from public/models, loaded once and handed out as clones. */
  model(file: string): Promise<THREE.Group | null> {
    const key = `kart:${file}`
    const load = loading.get(key) ?? this.assets.loadAll({ [key]: `${BASE}models/${file}` })
    loading.set(key, load)
    const p = load.then(() => this.assets.get(key))
    this.waits.push(p)
    return p
  }

  /** Copies of a model at these transforms, as one instanced mesh per part. */
  async models(file: string, mats: THREE.Matrix4[]): Promise<void> {
    const m = await this.model(file)
    if (!m || !mats.length) return
    m.updateMatrixWorld(true)
    m.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const local = mesh.matrixWorld
      const list = mats.map((x) => new THREE.Matrix4().multiplyMatrices(x, local))
      const im = this.instanced(mesh.geometry, mesh.material as THREE.Material, list)
      im.userData['shared'] = true
    })
  }

  /** Solid buildings from a model, fitted to a height, footprint from the model. */
  async buildings(file: string, spots: { x: number; z: number; yaw: number }[], height: number): Promise<void> {
    const job = (async () => {
      const m = await this.model(file)
      if (!m || !spots.length) return
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
      const s = Math.min(height / Math.max(size.y, 0.001), 24 / Math.max(size.x, size.z, 0.001))
      const mats = spots.map((p) => {
        const y = this.world.terrainAt(p.x, p.z)
        this.world.addBox(p.x, p.z, size.x * s / 2, size.z * s / 2, p.yaw)
        return new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(s, s, s))
          .multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z))
      })
      this.place(m, mats)
    })()
    this.waits.push(job)
    return job
  }

  /** A model fitted to `length` metres at these transforms. */
  async scaled(file: string, mats: THREE.Matrix4[], length: number): Promise<void> {
    const job = (async () => {
      const m = await this.model(file)
      if (!m || !mats.length) return
      const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
      const s = length / Math.max(size.x, size.y, size.z, 0.001)
      this.place(m, mats.map((x) => x.clone().multiply(new THREE.Matrix4().makeScale(s, s, s))))
    })()
    this.waits.push(job)
    return job
  }

  private place(m: THREE.Object3D, mats: THREE.Matrix4[]): void {
    m.updateMatrixWorld(true)
    m.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const im = this.instanced(mesh.geometry, mesh.material as THREE.Material, mats.map((x) => new THREE.Matrix4().multiplyMatrices(x, mesh.matrixWorld)))
      im.userData['shared'] = true
    })
  }

  wait(p: Promise<unknown>): void { this.waits.push(p) }

  /** Resolves when every background load has landed (and any they started). */
  async ready(): Promise<void> {
    for (let k = 0; k < this.waits.length; k++) await this.waits[k]
  }
}

/** Box-shaped solid with its visible block, for walls and simple buildings. */
export function fit(x: number, y: number, z: number, yaw: number, s: number | THREE.Vector3): THREE.Matrix4 {
  return trs(x, y, z, yaw, s)
}
