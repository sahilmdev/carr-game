import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type ModelManifest = Record<string, string>

/**
 * Preloads GLB models with Draco support and hands out fresh clones.
 * Failures are swallowed (logged) so the game can fall back to procedural
 * geometry — a missing file must never hard-crash the game.
 */
export class AssetLoader {
  private readonly loader: GLTFLoader
  private readonly cache = new Map<string, THREE.Group>()
  private readonly failed = new Set<string>()

  constructor() {
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
    this.loader = new GLTFLoader()
    this.loader.setDRACOLoader(draco)
  }

  /**
   * Bake a model down to one mesh per material.
   *
   * Many free GLBs are authored as hundreds of tiny separate meshes (one town
   * prop here was 648 boxes totalling only 9.4k triangles). Cloning those per
   * placement multiplies draw calls into the thousands and tanks the frame
   * rate, even though the triangle count is trivial. Merging by material keeps
   * the exact same pixels while collapsing the mesh count.
   *
   * Skipped for anything whose node names are load-bearing (e.g. the car,
   * whose wheels are found by name and reparented into spin/steer pivots).
   */
  private static flatten(root: THREE.Object3D): THREE.Group {
    root.updateMatrixWorld(true)
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
    const leftovers: THREE.Mesh[] = []

    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      // Multi-material meshes keep their own draw calls — rare, not worth the
      // complexity of splitting geometry groups.
      if (Array.isArray(mesh.material)) { leftovers.push(mesh); return }
      const geo = mesh.geometry.clone()
      geo.applyMatrix4(mesh.matrixWorld)
      // Normalise attributes so merges never fail on a missing uv/normal.
      if (!geo.getAttribute('normal')) geo.computeVertexNormals()
      if (!geo.getAttribute('uv')) {
        const count = geo.getAttribute('position').count
        geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
      }
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name)
      }
      const list = byMat.get(mesh.material)
      if (list) list.push(geo)
      else byMat.set(mesh.material, [geo])
    })

    const out = new THREE.Group()
    for (const [mat, geos] of byMat) {
      try {
        const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)
        if (merged) out.add(new THREE.Mesh(merged, mat))
        else throw new Error('merge returned null')
      } catch {
        for (const geo of geos) out.add(new THREE.Mesh(geo, mat))
      }
    }
    for (const m of leftovers) {
      const c = m.clone()
      c.applyMatrix4(m.matrixWorld)
      out.add(c)
    }
    return out
  }

  /**
   * Load every model in the manifest. `onProgress` gets 0–1. Never throws.
   * `shouldFlatten(name)` opts a model into geometry merging (see `flatten`).
   */
  async loadAll(
    manifest: ModelManifest,
    onProgress?: (fraction: number) => void,
    shouldFlatten?: (name: string) => boolean
  ): Promise<void> {
    const names = Object.keys(manifest)
    if (names.length === 0) {
      onProgress?.(1)
      return
    }
    let done = 0
    await Promise.all(
      names.map(async (name) => {
        try {
          const gltf = await this.loader.loadAsync(manifest[name]!)
          const usable = shouldFlatten?.(name)
            ? AssetLoader.flatten(gltf.scene)
            : gltf.scene
          this.cache.set(name, usable)
        } catch (err) {
          this.failed.add(name)
          console.warn(`[AssetLoader] failed to load "${name}" (${manifest[name]}), using fallback`, err)
        } finally {
          done++
          onProgress?.(done / names.length)
        }
      })
    )
  }

  has(name: string): boolean {
    return this.cache.has(name)
  }

  /** A fresh, independent clone of a loaded model, or null if unavailable. */
  get(name: string): THREE.Group | null {
    const src = this.cache.get(name)
    if (!src) return null
    return skeletonClone(src) as THREE.Group
  }
}
