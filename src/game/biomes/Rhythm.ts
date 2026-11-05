import * as THREE from 'three'
import type { BuildCtx } from './types'
import type { ZoneName } from '../Track'
import { zoneIndices, rightAt, instanced, trs, lumpy, canvasTexture, rng } from './kit'

/**
 * Road rhythm: repeating roadside elements at a steady spacing (what makes
 * speed read, like a real highway's delineator posts) and big distant
 * landmarks for the horizon.
 */
export function buildRhythm(ctx: BuildCtx, groups: Record<string, THREE.Group>): void {
  const t = ctx.track
  const rand = rng(99)
  /** Every `every` metres along the zones: [pos, right, tangent] */
  const along = (zones: ZoneName[], every: number, skip?: (i: number) => boolean): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] => {
    const ids = zoneIndices(t, ...zones)
    const out: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = []
    let acc = every
    for (let k = 1; k < ids.length; k++) {
      const i = ids[k]!
      if (ids[k - 1] !== i - 1) { acc = every; continue }
      acc += t.samples[i]!.distanceTo(t.samples[i - 1]!)
      if (acc < every || t.isGap(i) || skip?.(i)) continue
      acc = 0
      out.push([t.samples[i]!, rightAt(t, i), t.tangents[i]!])
    }
    return out
  }
  const half = t.width / 2

  // ── Delineator posts with reflectors ──
  const post = new THREE.BoxGeometry(0.14, 1.1, 0.14)
  post.translate(0, 0.55, 0)
  const refl = new THREE.BoxGeometry(0.1, 0.18, 0.16)
  const posts = (zones: ZoneName[], group: THREE.Group, body: number, glow: number, every: number) => {
    const pm: THREE.Matrix4[] = [], rm: THREE.Matrix4[] = []
    for (const [p, r, tg] of along(zones, every, (i) => t.isPlankDeck(i))) {
      const yaw = Math.atan2(tg.x, tg.z)
      for (const s of [-1, 1]) {
        const x = p.x + r.x * s * (half + 1.2), z = p.z + r.z * s * (half + 1.2)
        pm.push(trs(x, p.y - 0.05, z, yaw))
        rm.push(trs(x, p.y + 0.9, z, yaw))
      }
    }
    group.add(instanced(post, new THREE.MeshStandardMaterial({ color: body, roughness: 0.6 }), pm))
    group.add(instanced(refl, new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 2.2 }), rm, undefined, false))
  }
  posts(['volcano'], groups['volcano']!, 0x1d1d1d, 0xff8a1a, 28)
  posts(['desert', 'saltflat'], groups['desert']!, 0xf2f2ee, 0xff3a2a, 30)

  // ── Rainforest: timber posts with hanging lanterns ──
  {
    const g = groups['jungle']!
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 3.2, 6)
    pole.translate(0, 1.6, 0)
    const arm = new THREE.BoxGeometry(0.1, 0.1, 1.1)
    const lamp = new THREE.CylinderGeometry(0.18, 0.22, 0.42, 8)
    const pm: THREE.Matrix4[] = [], am: THREE.Matrix4[] = [], lm: THREE.Matrix4[] = []
    let side = 1
    for (const [p, r, tg] of along(['jungle'], 34, (i) => t.isPlankDeck(i))) {
      side = -side
      const yaw = Math.atan2(r.x, r.z)
      const x = p.x + r.x * side * (half + 1.6), z = p.z + r.z * side * (half + 1.6)
      pm.push(trs(x, p.y - 0.1, z, 0))
      am.push(trs(x - r.x * side * 0.5, p.y + 3, z - r.z * side * 0.5, yaw))
      lm.push(trs(x - r.x * side * 1.0, p.y + 2.65, z - r.z * side * 1.0, 0))
      void tg
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 })
    g.add(instanced(pole, wood, pm), instanced(arm, wood, am))
    g.add(instanced(lamp, new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9a3a, emissiveIntensity: 2.4 }), lm, undefined, false))
  }

  // ── Landmark: a range of giant sandstone buttes on the desert horizon ──
  {
    const g = groups['desert']!
    const tex = canvasTexture(64, 256, (c, w, h) => {
      for (let y = 0; y < h; y += 3) {
        const v = 150 + Math.sin(y * 0.11) * 25 + Math.random() * 18
        c.fillStyle = `rgb(${v + 50},${v - 10},${v - 55})`
        c.fillRect(0, y, w, 3)
      }
    })
    tex.wrapS = THREE.RepeatWrapping
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, flatShading: true })
    const spots: [number, number, number, number][] = [
      [-930, -1180, 70, 110], [-870, -1250, 50, 80], [-950, -990, 60, 130], [-800, -1265, 40, 70], [-940, -810, 55, 90],
    ]
    for (const [x, z, r, h] of spots) {
      // eroded tiers: a broad lower block, a narrower cap rock, rough faces
      let y = -2
      for (const [rf, hf] of [[1, 0.62], [0.72, 0.38]] as const) {
        const th = h * hf
        const body = lumpy(new THREE.CylinderGeometry(r * rf * 0.88, r * rf * 1.08, th, 22, 8), r * 0.16, 0.045, x + rf * 9)
        const m = new THREE.Mesh(body, mat)
        m.position.set(x + (rand() - 0.5) * r * 0.3, y + th / 2, z + (rand() - 0.5) * r * 0.3)
        m.scale.set(1, 1, 0.75 + rand() * 0.4)
        m.rotation.y = rand() * 6
        m.castShadow = true
        g.add(m)
        y += th - 1
      }
      // a talus apron round the foot
      const apron = new THREE.Mesh(lumpy(new THREE.ConeGeometry(r * 1.7, h * 0.35, 18, 3), r * 0.05, 0.05, z), mat)
      apron.position.set(x, h * 0.17 - 2, z)
      g.add(apron)
    }
  }
}
