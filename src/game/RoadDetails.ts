import * as THREE from 'three'
import type { Track } from './Track'
import { rockSet, tiled } from './Textures'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Roadside furniture that makes the track read as a real road:
 *  - gravel shoulders beside the asphalt wherever the road sits on the ground
 *  - red/white kerbs through the corners
 *  - galvanised W-beam guardrails (posts + rail) along the canyon and coast
 *
 * Everything is built as long ribbons / instanced meshes, so the whole set is
 * a handful of draw calls.
 */
export function buildRoadDetails(track: Track): THREE.Group {
  const group = new THREE.Group()
  const n = track.sampleCount
  const half = track.width / 2
  const rights = track.tangents.map((t) => new THREE.Vector3().crossVectors(t, UP).normalize())
  const curvature = cornerStrength(track)

  const onGround = (i: number) => {
    const z = track.zoneOfSample(i)
    const p = track.samples[i]!
    return (z === 'town' || z === 'coast' || z === 'canyon') && p.y > -1 && p.y < 0.8
  }

  // ── Gravel shoulders ─────────────────────────────────────────────────
  const gravel = tiled(rockSet(), 1, 1)
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: 0x8a8273,
    map: gravel.map,
    normalMap: gravel.normalMap,
    roughnessMap: gravel.roughnessMap,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  })
  for (const side of [-1, 1] as const) {
    for (const run of runs(n, onGround)) {
      group.add(ribbon(track, rights, run, side, half - 0.05, half + 2.6, 0.0, shoulderMat, 2.6, 2.5, true))
    }
  }

  // ── Kerbs on corners ─────────────────────────────────────────────────
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.6 })
  const isCorner = (i: number) => onGround(i) && curvature[i]! > 0.35
  for (const side of [-1, 1] as const) {
    for (const run of runs(n, isCorner)) {
      if (run.length < 4) continue
      group.add(ribbon(track, rights, run, side, half - 0.25, half + 1.1, 0.05, kerbMat, 1, 2, true))
    }
  }

  // ── Guardrails: canyon + coast ───────────────────────────────────────
  const railZone = (i: number) => {
    const z = track.zoneOfSample(i)
    return (z === 'canyon' || z === 'coast') && track.samples[i]!.y > -1
  }
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xb9bdc1, metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide,
  })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8e9296, metalness: 0.7, roughness: 0.55 })
  const RAIL_OFFSET = half + 3.2 // just outside the gravel shoulder
  const postSpots: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
  for (const side of [-1, 1] as const) {
    for (const run of runs(n, railZone)) {
      if (run.length < 3) continue
      const rail = wBeam(track, rights, run, side, RAIL_OFFSET, railMat)
      rail.castShadow = true
      group.add(rail)
      for (let k = 0; k < run.length; k += 2) {
        const i = run[k]!
        const p = track.samples[i]!
        const pos = p.clone().addScaledVector(rights[i]!, side * (RAIL_OFFSET + 0.12))
        dummy.position.set(pos.x, p.y, pos.z)
        const t = track.tangents[i]!
        dummy.rotation.set(0, Math.atan2(t.x, t.z), 0)
        dummy.updateMatrix()
        postSpots.push(dummy.matrix.clone())
      }
    }
  }
  const postGeo = new THREE.BoxGeometry(0.1, 0.8, 0.15)
  postGeo.translate(0, 0.4, 0)
  const posts = new THREE.InstancedMesh(postGeo, postMat, postSpots.length)
  postSpots.forEach((m, i) => posts.setMatrixAt(i, m))
  posts.castShadow = true
  group.add(posts)

  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true })
  return group
}

/** 0 on straights → ~1+ in tight corners (turn angle over ±8 samples, radians). */
export function cornerStrength(track: Track): Float32Array {
  const n = track.sampleCount
  const out = new Float32Array(n)
  const W = 8
  for (let i = 0; i < n; i++) {
    const a = track.tangents[(i - W + n) % n]!
    const b = track.tangents[(i + W) % n]!
    const ang = Math.acos(THREE.MathUtils.clamp(
      (a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z) || 1), -1, 1))
    out[i] = ang
  }
  return out
}

/** Contiguous runs of sample indices satisfying `pred` (wrap-aware). */
function runs(n: number, pred: (i: number) => boolean): number[][] {
  const out: number[][] = []
  let start = 0
  while (start < n && pred(start)) start++
  if (start === n) return [Array.from({ length: n + 1 }, (_, i) => i % n)]
  let cur: number[] | null = null
  for (let o = 1; o <= n; o++) {
    const i = (start + o) % n
    if (pred(i)) (cur ??= []).push(i)
    else if (cur) { if (cur.length > 1) out.push(cur); cur = null }
  }
  if (cur && cur.length > 1) out.push(cur)
  return out
}

/** Flat strip from `inner` to `outer` metres off the centreline, `lift` above the road. */
function ribbon(
  track: Track, rights: THREE.Vector3[], run: number[], side: number,
  inner: number, outer: number, lift: number, mat: THREE.Material,
  uAcross: number, vMetres: number, receive: boolean
): THREE.Mesh {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let along = 0
  for (let k = 0; k < run.length; k++) {
    const i = run[k]!
    const p = track.samples[i]!
    if (k > 0) along += p.distanceTo(track.samples[run[k - 1]!]!)
    const r = rights[i]!
    const a = p.clone().addScaledVector(r, side * inner)
    const b = p.clone().addScaledVector(r, side * outer)
    pos.push(a.x, p.y + 0.02 + lift, a.z, b.x, p.y + 0.02 + lift * 0.4, b.z)
    uv.push(0, along / vMetres, uAcross, along / vMetres)
    if (k < run.length - 1) {
      // Winding so the face points up on both sides of the road
      if (side > 0) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2)
      else idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = receive
  return mesh
}

/** W-beam guardrail: a corrugated steel profile swept along the road edge. */
function wBeam(
  track: Track, rights: THREE.Vector3[], run: number[], side: number,
  offset: number, mat: THREE.Material
): THREE.Mesh {
  // (outward offset, height) of the W profile, bottom → top
  const profile: [number, number][] = [
    [0.0, 0.48], [0.07, 0.53], [0.07, 0.58], [0.0, 0.63], [0.07, 0.68], [0.07, 0.73], [0.0, 0.78],
  ]
  const P = profile.length
  const pos: number[] = []
  const idx: number[] = []
  for (let k = 0; k < run.length; k++) {
    const i = run[k]!
    const p = track.samples[i]!
    const r = rights[i]!
    for (const [out, h] of profile) {
      // Bulges face the road (inward)
      const v = p.clone().addScaledVector(r, side * (offset - out))
      pos.push(v.x, p.y + h, v.z)
    }
    if (k < run.length - 1) {
      for (let j = 0; j < P - 1; j++) {
        const a = k * P + j, b = a + 1, c = a + P, d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, mat)
}

/** Alternating red / white kerb stripes (one red + one white per 2 m tile). */
function kerbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#e9e7e2'
  ctx.fillRect(0, 0, 32, 64)
  ctx.fillStyle = '#b3201c'
  ctx.fillRect(0, 0, 32, 32)
  // Grime toward the outer edge
  const g = ctx.createLinearGradient(0, 0, 32, 0)
  g.addColorStop(0, 'rgba(40,35,30,0)')
  g.addColorStop(1, 'rgba(40,35,30,0.25)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}
