import * as THREE from 'three'
import type { Circuit } from './Circuit'
import type { World } from './World'

/**
 * A last pass over a finished track's scattered props (trees, rocks, lamps,
 * barrels, crates, buildings placed as instances): anything standing on a
 * road is taken away, and anything standing close beside one is made solid,
 * so nothing sits in your way and nothing can be driven through.
 * Glowing, see-through and moving things are left alone, and so is anything
 * marked `userData.keep`.
 */
export function tidyProps(root: THREE.Object3D, circuit: Circuit, world: World): { removed: number; solid: number } {
  const m4 = new THREE.Matrix4(), box = new THREE.Box3(), zero = new THREE.Matrix4().makeScale(0, 0, 0)
  let removed = 0, solid = 0
  const meshes: THREE.InstancedMesh[] = []
  root.traverse((o) => {
    if (o.userData['keep']) return
    let p: THREE.Object3D | null = o
    while (p) { if (p.userData['keep']) return; p = p.parent }
    const m = o as THREE.InstancedMesh
    if (!m.isInstancedMesh || !m.visible) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material & { toneMapped?: boolean; blending?: number }
    if (mat.transparent || mat.blending === THREE.AdditiveBlending || mat.toneMapped === false) return
    meshes.push(m)
  })
  for (const m of meshes) {
    m.updateMatrixWorld(true)
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    let changed = false
    for (let q = 0; q < m.count; q++) {
      m.getMatrixAt(q, m4)
      box.copy(m.geometry.boundingBox!).applyMatrix4(m4).applyMatrix4(m.matrixWorld)
      const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z, h = box.max.y - box.min.y
      if (h < 0.7 || sx > 40 || sz > 40) continue
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, foot = Math.max(sx, sz) / 2
      // the nearest road surface under or beside it
      let best: { out: number; y: number } | null = null
      for (const c of circuit.all) {
        const list = c.near(cx, cz)
        if (!list) continue
        let i = -1, bd = 1e12
        for (const j of list) {
          const s = c.samples[j]!, d = (s.x - cx) ** 2 + (s.z - cz) ** 2 + ((s.y - box.min.y) * 2) ** 2
          if (d < bd) { bd = d; i = j }
        }
        if (i < 0 || c.gap[i]) continue
        const s = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!
        if (Math.abs((cx - s.x) * t.x + (cz - s.z) * t.z) > 4) continue
        // standing at road level, not on a bridge above or a valley below
        if (Math.abs(box.min.y - s.y) > 2.2) continue
        const out = Math.abs((cx - s.x) * r.x + (cz - s.z) * r.z) - c.widths[i]! / 2
        if (!best || out < best.out) best = { out, y: s.y }
      }
      if (!best) continue
      if (best.out < -0.4 && foot < 8) {
        // on the road: take it away
        m.setMatrixAt(q, zero)
        changed = true
        removed++
      } else if (best.out >= 0.6 && best.out < 4 + foot && h > 1.8 && !world.blocked(cx, cz, 0.3)) {
        // just beside the road with nothing solid there: make it solid, but
        // never so wide that the post reaches onto the road
        world.addPost(cx, cz, THREE.MathUtils.clamp(foot * 0.5, 0.3, Math.min(2, best.out - 0.3)), box.max.y)
        solid++
      }
    }
    if (changed) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere() }
  }
  return { removed, solid }
}

/**
 * The same for everything a track builds itself (merged meshes laid out in
 * world space): any triangle sitting inside the driving lanes, between just
 * above the surface and car height, is cut away, and so is any fixed solid
 * standing there. Catches rails drawn across a road where a fork splits off,
 * arch feet, sign posts and frames that ended up on the tarmac. Things above
 * car height (bridges, arches, tunnel roofs) and at the road's edges stay.
 */
export function carveRoads(root: THREE.Object3D, circuit: Circuit, world: World): { triangles: number; solids: number } {
  const probe = { i: -1, lat: 0, y: 0 }
  const inLane = (x: number, y: number, z: number): boolean => {
    for (const c of circuit.all) {
      if (!c.roadAt(x, z, y + 0.2, probe) || probe.i < 0 || c.gap[probe.i]) continue
      if (Math.abs(probe.lat) > c.widths[probe.i]! / 2 - 0.9) continue
      const h = y - probe.y
      if (h > 0.15 && h < 3.6) return true
    }
    return false
  }
  const { nx, nz, x0, z0, cell } = world.gridSize
  const nearRoad = (x: number, z: number): boolean => {
    const i = Math.round((x - x0) / cell), j = Math.round((z - z0) / cell)
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false
    return world.roadDist[j * nx + i]! < cell
  }
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    let p: THREE.Object3D | null = o
    while (p) { if (p.userData['keep']) return; p = p.parent }
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !m.visible) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material & { toneMapped?: boolean; blending?: number; customProgramCacheKey?: () => string }
    if (mat.transparent || mat.blending === THREE.AdditiveBlending) return
    if (mat.customProgramCacheKey?.() === 'kart-road') return
    m.updateMatrixWorld(true)
    // only geometry laid out in world space: anything placed by a transform may move
    if (!m.matrixWorld.equals(IDENTITY)) return
    meshes.push(m)
  })
  let tris = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes['position'] as THREE.BufferAttribute | undefined
    if (!pos) continue
    const index = g.index
    const n = index ? index.count / 3 : pos.count / 3
    let cut = 0
    const keep: number[] = []
    for (let t = 0; t < n; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3, i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1, i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2)
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3
      // a big triangle (a rock face, a cliff cap) can span the road with its
      // centre off to one side: test its corners and edge midpoints as well
      let bad = nearRoad(cx, cz) && inLane(cx, cy, cz)
      if (!bad) {
        const span = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a))
        if (span > 4) {
          // a grid of points over the whole face, about 2.5 m apart
          const N = Math.min(40, Math.ceil(Math.sqrt(span) / 2.5))
          scan: for (let u = 0; u <= N; u++) for (let v = 0; v <= N - u; v++) {
            const wa = u / N, wb = v / N, wc = 1 - wa - wb
            const x = a.x * wa + b.x * wb + c.x * wc, y = a.y * wa + b.y * wb + c.y * wc, z = a.z * wa + b.z * wb + c.z * wc
            if (nearRoad(x, z) && inLane(x, y, z)) { bad = true; break scan }
          }
        }
      }
      if (bad) {
        cut++
        if (!index) for (const v of [i1, i2]) pos.setXYZ(v, a.x, a.y, a.z)
      } else if (index) keep.push(i0, i1, i2)
    }
    if (!cut) continue
    tris += cut
    if (index) g.setIndex(keep)
    else pos.needsUpdate = true
    g.computeBoundingSphere()
  }
  // fixed solids standing in the lanes, at car height: nothing visible is
  // there any more, so nothing should stop you there either
  const solids = world.clearSolids((sd) => {
    const size = sd.hx === undefined ? sd.r : Math.max(sd.hx, sd.hz ?? 0)
    if (size > 3) return false
    for (const cc of circuit.all) {
      const i = cc.track(sd.x, sd.z, 0, cc.count)
      const p = cc.samples[i]!, r = cc.rights[i]!
      const lat = (sd.x - p.x) * r.x + (sd.z - p.z) * r.z
      const along = Math.abs((sd.x - p.x) * cc.tangents[i]!.x + (sd.z - p.z) * cc.tangents[i]!.z)
      if (cc.gap[i] || along > 3 || Math.abs(lat) > cc.widths[i]! / 2 - 1.2) continue
      if (sd.top > p.y + 0.5) return true
    }
    return false
  })
  return { triangles: tris, solids }
}

const IDENTITY = new THREE.Matrix4()
