import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Real scanned props (Poly Haven, CC0, real-world scale) placed by the
 * biomes. Placements are decided while the world is built; the models load
 * in the background and appear as instanced meshes when they arrive. A
 * missing file only means that prop is left out.
 */
export type PropName =
  | 'moon_rock_01' | 'moon_rock_02' | 'moon_rock_03' | 'moon_rock_04' | 'moon_rock_05' | 'moon_rock_06' | 'moon_rock_07'
  | 'rock_face_01' | 'rock_face_02' | 'boulder_01' | 'dead_tree_trunk' | 'dead_tree_trunk_02'
  | 'quiver_tree_01' | 'quiver_tree_02' | 'dead_quiver_trunk' | 'namaqualand_boulder_02' | 'namaqualand_boulder_05'
  | 'namaqualand_boulders_01' | 'namaqualand_cliff_01' | 'wild_rooibos_bush' | 'othonna_cerarioides' | 'cheiridopsis_succulent'
  | 'old_tyre' | 'barrel_03' | 'rusted_wheel_rim_01' | 'metal_jerrycan'
  | 'rock_moss_set_01' | 'rock_moss_set_02' | 'tree_stump_01' | 'stone_01'
  | 'pachira_aquatica_01' | 'fern_02' | 'calathea_orbifolia_01' | 'shrub_01' | 'shrub_02' | 'shrub_04' | 'root_cluster_01'
  | 'mountainside' | 'rock_07' | 'rock_09'
  | 'street_lamp_02' | 'fire_hydrant' | 'utility_box_01' | 'utility_box_02' | 'concrete_road_barrier' | 'metal_trash_can'
  | 'exterior_aircon_unit' | 'security_light' | 'water_manhole_cover'
  | 'dutch_ship_medium' | 'modular_wooden_pier' | 'coastal_cliff_01' | 'bronze_shark_statue' | 'bronze_ray_statue' | 'bronze_whale_statue'
  | 'treasure_chest' | 'cannon_01' | 'ocean_buoy' | 'lateral_sea_marker' | 'wooden_barrels_01' | 'namaqualand_cliff_02' | 'modular_fire_escape'
  | 'dt:Building_Large_2' | 'dt:Building_Medium_2_001' | 'dt:Building_Small_1' | 'dt:Prop_ACUnit' | 'dt:Sidewalk_Planter' | 'dt:Prop_Bollard'

interface Request { name: PropName; mats: THREE.Matrix4[]; parent: THREE.Object3D; tint?: THREE.Color; cast: boolean }

export class Props {
  private readonly requests: Request[] = []
  private readonly loader = new GLTFLoader()
  private readonly cache = new Map<PropName, Promise<THREE.Mesh[] | null>>()
  ready: Promise<void> = Promise.resolve()
  /** 0–1 share of the queued props that have loaded */
  progress = 1
  private readonly chunks: THREE.InstancedMesh[] = []
  private cullFrame = 0

  /** Hide prop chunks beyond `range` m of the camera (checked every few frames). */
  cull(cam: THREE.Vector3, range = 520): void {
    if (++this.cullFrame % 8) return
    for (const c of this.chunks) {
      const s = c.boundingSphere
      if (!s) continue
      // tall things stay on far longer, so nothing big pops in mid-view
      c.visible = s.center.distanceTo(cam) - s.radius < (c.castShadow ? 1300 : range)
    }
  }

  /** Queue instances of `name` (matrices in world space) under `parent`. */
  place(name: PropName, mats: THREE.Matrix4[], parent: THREE.Object3D, opts: { tint?: THREE.Color; cast?: boolean } = {}): void {
    if (mats.length) this.requests.push({ name, mats, parent, tint: opts.tint, cast: opts.cast ?? CASTERS.has(name) })
  }

  /**
   * One-off models (NASA spacecraft and the like): loaded once, scaled to
   * `height` metres, stood on each spot. Their own units vary, so they are
   * fitted rather than trusted.
   */
  fit(file: string, spots: { x: number; y: number; z: number; yaw: number }[], height: number, parent: THREE.Object3D): void {
    this.fits.push(this.loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then((gltf) => {
      const root = gltf.scene
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
      const s = height / Math.max(size.y, 0.001)
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
      for (const p of spots) {
        const g = new THREE.Group()
        const copy = root.clone(true)
        copy.position.set(-c.x * s, -box.min.y * s, -c.z * s)
        copy.scale.setScalar(s)
        g.add(copy)
        g.position.set(p.x, p.y, p.z)
        g.rotation.y = p.yaw
        parent.add(g)
      }
    }).catch((e) => console.warn(`[props] ${file} unavailable`, e)))
  }
  private readonly fits: Promise<unknown>[] = []

  /** Load everything that was asked for and add the instanced meshes. */
  loadAll(): Promise<void> {
    const reqs = this.requests.splice(0)
    let done = 0
    this.progress = reqs.length ? 0 : 1
    this.ready = Promise.all(reqs.map(async (r) => {
      const parts = await this.load(r.name)
      this.progress = ++done / reqs.length
      if (!parts) return
      for (const part of parts) {
        let mat = part.material as THREE.Material
        if (r.tint) {
          const m = (mat as THREE.MeshStandardMaterial).clone()
          m.color.multiply(r.tint)
          mat = m
        }
        // one instanced mesh per 160 m cell, so frustum culling skips what's behind
        const cells = new Map<string, THREE.Matrix4[]>()
        const v = new THREE.Vector3()
        for (const m of r.mats) {
          v.setFromMatrixPosition(m)
          const key = Math.floor(v.x / 160) + ',' + Math.floor(v.z / 160)
          const list = cells.get(key) ?? []
          list.push(m)
          cells.set(key, list)
        }
        for (const list of cells.values()) {
          const im = new THREE.InstancedMesh(part.geometry, mat, list.length)
          list.forEach((m, k) => im.setMatrixAt(k, m))
          im.castShadow = r.cast
          im.receiveShadow = true
          im.computeBoundingSphere()
          r.parent.add(im)
          this.chunks.push(im)
        }
      }
    })).then(() => Promise.all(this.fits)).then(() => undefined)
    return this.ready
  }

  /** One merged geometry per material, in the model's own (metre) units. */
  private load(name: PropName): Promise<THREE.Mesh[] | null> {
    let p = this.cache.get(name)
    if (!p) {
      const url = name.startsWith('dt:')
        ? `${import.meta.env.BASE_URL}models/downtown/${name.slice(3)}.gltf`
        : `${import.meta.env.BASE_URL}models/polyhaven/${name}/${name}.gltf`
      p = this.loader.loadAsync(url).then((gltf) => {
        const root = gltf.scene
        root.updateMatrixWorld(true)
        const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
        root.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
          // keep only what the standard material needs, so parts merge
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'tangent'].includes(k)) g.deleteAttribute(k)
          const mat = m.material as THREE.Material
          const list = byMat.get(mat) ?? []
          list.push(g)
          byMat.set(mat, list)
        })
        const out: THREE.Mesh[] = []
        let total = 0
        for (const geos of byMat.values()) for (const g of geos) total += (g.index ? g.index.count : g.getAttribute('position').count) / 3
        for (const [mat, geos] of byMat) {
          let merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)
          if (!merged) continue
          const tris = (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3
          // scans come at up to 225k triangles: cluster them down to a game budget
          const budget = (TRI_BUDGET[name] ?? 6000) * (tris / Math.max(1, total))
          // alpha-tested leaf cards must keep their uvs whole
          const cards = !!(mat as THREE.MeshStandardMaterial).alphaMap || (mat as THREE.Material).alphaTest > 0 || (mat as THREE.Material).transparent
          if (tris > budget * 1.2) merged = simplify(merged, budget, cards)
          const sm = mat as THREE.MeshStandardMaterial
          if (sm.isMeshStandardMaterial) {
            sm.envMapIntensity = 0.8
            // the city kit's rooms behind the windows glow at night
            if (sm.name.startsWith('MI_FakeInterior') && sm.map) {
              sm.emissive.set(0xffffff)
              sm.emissiveMap = sm.map
              sm.emissiveIntensity = 0.9
            }
            // 1k scans ×150 textures would eat ~800 MB of video memory
            const max = SMALL.has(name) ? 256 : 512
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap'] as const) {
              const t = sm[k]
              if (t) shrink(t, max)
            }
          }
          out.push(new THREE.Mesh(merged, mat))
        }
        return out
      }).catch((e) => {
        console.warn(`[props] ${name} unavailable`, e)
        return null
      })
      this.cache.set(name, p)
    }
    return p
  }
}

/** Shared instance for all biomes. */
export const props = new Props()

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
/** Matrix for a prop: position, yaw, uniform scale, optional tilt. */
export function at(x: number, y: number, z: number, yaw: number, s = 1, tilt = 0, tiltDir = 0): THREE.Matrix4 {
  _q.setFromEuler(_e.set(Math.cos(tiltDir) * tilt, yaw, Math.sin(tiltDir) * tilt, 'YXZ'))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, s, s))
}

/** Triangle budget per model after simplification (default 6000). */
const TRI_BUDGET: Partial<Record<PropName, number>> = {
  'dt:Building_Large_2': 60000, 'dt:Building_Medium_2_001': 60000, 'dt:Building_Small_1': 60000,
  dutch_ship_medium: 30000, modular_wooden_pier: 12000, coastal_cliff_01: 16000, treasure_chest: 6000, cannon_01: 6000,
  quiver_tree_01: 22000, quiver_tree_02: 16000, othonna_cerarioides: 18000, pachira_aquatica_01: 16000,
  cheiridopsis_succulent: 9000, wild_rooibos_bush: 9000, shrub_02: 12000, fern_02: 7000, calathea_orbifolia_01: 8000,
  mountainside: 14000, namaqualand_cliff_01: 10000, rock_face_01: 8000, rock_face_02: 7000,
  dead_tree_trunk: 6000, dead_tree_trunk_02: 7000, dead_quiver_trunk: 5000,
  moon_rock_01: 3000, moon_rock_02: 2500, moon_rock_03: 2500, moon_rock_04: 2500, moon_rock_05: 2500, moon_rock_06: 2500, moon_rock_07: 2500,
  rock_07: 2500, rock_09: 2500, stone_01: 2500, namaqualand_boulders_01: 5000,
}

/**
 * Vertex-clustering simplifier: snap vertices to a grid (keyed by position,
 * normal direction and a coarse uv so texture seams stay intact), drop the
 * collapsed triangles, and grow the grid until under the triangle budget.
 */
function simplify(src: THREE.BufferGeometry, budget: number, cards = false): THREE.BufferGeometry {
  const g = src.index ? src : src.toNonIndexed()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, k) => k)
  g.computeBoundingBox()
  const size = g.boundingBox!.getSize(new THREE.Vector3())
  let cell = Math.max(size.x, size.y, size.z) / 60
  let best: THREE.BufferGeometry = g
  for (let iter = 0; iter < 18; iter++) {
    // first keep seams and creases; if that can't reach the budget, let them go
    const keepN = iter < 7, keepUv = cards || iter < 12
    const map = new Map<string, number>()
    const remap = new Int32Array(pos.count)
    const P: number[] = [], N: number[] = [], U: number[] = [], C: number[] = []
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k)
      const nk = nrm && keepN ? `${Math.round(nrm.getX(k) * 1.5)},${Math.round(nrm.getY(k) * 1.5)},${Math.round(nrm.getZ(k) * 1.5)}` : ''
      const uk = uv && keepUv ? `${Math.round(uv.getX(k) * 12)},${Math.round(uv.getY(k) * 12)}` : ''
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}|${nk}|${uk}`
      let id = map.get(key)
      if (id === undefined) {
        id = C.length
        map.set(key, id)
        P.push(0, 0, 0); N.push(0, 0, 0); U.push(0, 0); C.push(0)
      }
      remap[k] = id
      P[id * 3]! += x; P[id * 3 + 1]! += y; P[id * 3 + 2]! += z
      if (nrm) { N[id * 3]! += nrm.getX(k); N[id * 3 + 1]! += nrm.getY(k); N[id * 3 + 2]! += nrm.getZ(k) }
      if (uv) { U[id * 2]! += uv.getX(k); U[id * 2 + 1]! += uv.getY(k) }
      C[id]!++
    }
    const idx: number[] = []
    for (let t = 0; t < index.length; t += 3) {
      const a = remap[index[t]!]!, b = remap[index[t + 1]!]!, c = remap[index[t + 2]!]!
      if (a !== b && b !== c && a !== c) idx.push(a, b, c)
    }
    if (idx.length / 3 <= budget || iter === 17) {
      for (let v = 0; v < C.length; v++) {
        const c = C[v]!
        P[v * 3]! /= c; P[v * 3 + 1]! /= c; P[v * 3 + 2]! /= c
        U[v * 2]! /= c; U[v * 2 + 1]! /= c
      }
      const out = new THREE.BufferGeometry()
      out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
      if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
      out.setIndex(idx)
      out.computeVertexNormals()
      best = out
      break
    }
    cell *= 1.3
  }
  return best
}

/** Props seen small on screen: quarter-size textures are plenty. */
const SMALL = new Set<PropName>([
  'old_tyre', 'barrel_03', 'rusted_wheel_rim_01', 'metal_jerrycan', 'fire_hydrant', 'utility_box_01', 'utility_box_02',
  'metal_trash_can', 'water_manhole_cover', 'security_light', 'exterior_aircon_unit', 'street_lamp_02',
  'cheiridopsis_succulent', 'wild_rooibos_bush', 'calathea_orbifolia_01', 'fern_02', 'tree_stump_01',
])

const shrunk = new WeakSet<THREE.Texture>()
/** Redraw a texture's image at most `max` px (keeps aspect), once. */
function shrink(t: THREE.Texture, max: number): void {
  if (shrunk.has(t)) return
  shrunk.add(t)
  const img = t.image as { width: number; height: number } | undefined
  if (!img || !img.width || (img.width <= max && img.height <= max)) return
  const k = max / Math.max(img.width, img.height)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * k))
  c.height = Math.max(1, Math.round(img.height * k))
  c.getContext('2d')!.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height)
  t.image = c
  t.needsUpdate = true
}

/** Only the tall props cast shadows (ground cover would double the cost for nothing). */
const CASTERS = new Set<PropName>([
  'quiver_tree_01', 'quiver_tree_02', 'dead_quiver_trunk', 'othonna_cerarioides', 'pachira_aquatica_01',
  'rock_face_01', 'rock_face_02', 'boulder_01', 'namaqualand_cliff_01', 'namaqualand_boulder_02', 'namaqualand_boulder_05',
  'mountainside', 'rock_moss_set_01', 'rock_moss_set_02', 'concrete_road_barrier', 'dead_tree_trunk_02',
])
