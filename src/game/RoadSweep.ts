import * as THREE from 'three'
import type { Track } from './Track'

const CELL = 16
const key = (x: number, z: number): number => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)

/**
 * The last word on the "nothing stands on the road" rule. Scattered props are
 * placed by many builders, and any change to the road can leave one behind, so
 * once everything has loaded this removes every instance with geometry inside
 * the driving corridor. Anything meant to span the road sits above it (arches)
 * or isn't instanced (jump ramps), so it is left alone.
 *
 * @returns how many instances were removed
 */
export function sweepRoad(root: THREE.Object3D, track: Track, extra = 0.5): number {
  const n = track.sampleCount, reach = track.width / 2 + extra
  const grid = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    if (track.isGap(i)) continue
    const p = track.samples[i]!, cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL)
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const k = (cx + a) * 100003 + cz + b
      const l = grid.get(k)
      if (l) l.push(i)
      else grid.set(k, [i])
    }
  }
  const blocked = (x: number, z: number, y0: number, y1: number): boolean => {
    const l = grid.get(key(x, z))
    if (!l) return false
    for (const i of l) {
      const p = track.samples[i]!
      const dx = x - p.x, dz = z - p.z
      if (dx * dx + dz * dz <= reach * reach && y1 > p.y + 0.5 && y0 < p.y + 4.5) return true
    }
    return false
  }

  const m = new THREE.Matrix4(), w = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3()
  const hits = (geo: THREE.BufferGeometry, mat: THREE.Matrix4): boolean => {
    const pos = geo.getAttribute('position'), idx = geo.index, tris = (idx ? idx.count : pos.count) / 3
    for (let f = 0; f < tris; f++) {
      const ia = idx ? idx.getX(f * 3) : f * 3, ib = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, ic = idx ? idx.getX(f * 3 + 2) : f * 3 + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(mat)
      b.fromBufferAttribute(pos, ib).applyMatrix4(mat)
      c.fromBufferAttribute(pos, ic).applyMatrix4(mat)
      const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y)
      if (blocked((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, y0, y1) || blocked(a.x, a.z, y0, y1)) return true
    }
    return false
  }

  let removed = 0
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const inst = o as THREE.InstancedMesh
    if (!inst.isInstancedMesh) return
    const geo = inst.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    let changed = false
    for (let k = 0; k < inst.count; k++) {
      inst.getMatrixAt(k, m)
      if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue
      w.multiplyMatrices(inst.matrixWorld, m)
      box.copy(geo.boundingBox!).applyMatrix4(w)
      // nothing near any road cell: skip the triangles
      let near = false
      for (let x = box.min.x; x <= box.max.x + CELL && !near; x += CELL) {
        for (let z = box.min.z; z <= box.max.z + CELL && !near; z += CELL) near = grid.has(key(Math.min(x, box.max.x), Math.min(z, box.max.z)))
      }
      if (!near || !hits(geo, w)) continue
      inst.setMatrixAt(k, zero)
      changed = true
      removed++
    }
    if (changed) inst.instanceMatrix.needsUpdate = true
  })
  return removed
}
