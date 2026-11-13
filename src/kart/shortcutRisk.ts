import * as THREE from 'three'
import type { Circuit } from './Circuit'
import type { Solid, World } from './World'
import type { FrameInfo } from './types'

/**
 * A shortcut should be quicker but riskier. Every side road that saves
 * distance gets swinging barrier arms: posts at the road edge whose striped
 * booms sweep across the lane in turn. Time it and you're through; get it
 * wrong and the boom knocks you aside. Long scenic routes stay clear.
 */
export function shortcutRisk(root: THREE.Group, main: Circuit, world: World, onFrame: (fn: (f: FrameInfo) => void) => void): number {
  const step = main.length / main.count
  let placed = 0
  const stripes = (() => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 16
    const g = c.getContext('2d')!
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 128, 16)
    g.fillStyle = '#e8302a'
    for (let x = -16; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 16, 16); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill() }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })()
  const boomMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5, emissive: 0x220806 })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.6, roughness: 0.4 })
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 0.3), toneMapped: false })

  for (const b of main.branches) {
    const j = b.join
    if (!j) continue
    const skipped = ((j.to - j.from + main.count) % main.count) * step
    // only a real shortcut: no longer than the stretch it replaces
    if (b.length > skipped * 1.02 || b.count < 40) continue
    for (const u of [0.38, 0.62]) {
      let i = Math.floor(b.count * u)
      // keep clear of jumps, pipes, rolls and walls, and of open edges over a drop
      let ok = false
      for (let tries = 0; tries < 30 && !ok; tries++, i++) {
        ok = true
        for (let q = -6; q <= 6 && ok; q++) {
          const k = Math.min(b.count - 1, Math.max(0, i + q))
          if (b.gap[k] || b.pipe[k]! > 0 || b.roll[k] || b.tunnel[k]) ok = false
        }
      }
      if (!ok) continue
      const p = b.samples[i]!, rt = b.rights[i]!, half = b.widths[i]! / 2
      const side = placed % 2 ? 1 : -1
      const pivot = new THREE.Vector3(p.x + rt.x * side * (half + 0.6), p.y, p.z + rt.z * side * (half + 0.6))
      const len = half * 1.15
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 10), postMat)
      post.position.set(pivot.x, pivot.y + 1.2, pivot.z)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat.clone())
      lamp.position.set(pivot.x, pivot.y + 2.55, pivot.z)
      const arm = new THREE.Group()
      arm.position.set(pivot.x, pivot.y + 1.05, pivot.z)
      const boom = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.45), boomMat)
      boom.position.x = len / 2
      boom.castShadow = true
      arm.add(boom)
      root.add(post, lamp, arm)
      world.addPost(pivot.x, pivot.z, 0.5, pivot.y + 3)
      // the boom swings between pointing along the road and straight across it
      // three.js turns the boom's +x to (cos a, -sin a): solve a for each direction
      const inward = Math.atan2(rt.z * side, -rt.x * side)
      const t = b.tangents[i]!
      let along = Math.atan2(-t.z, t.x)
      // swing the short way round
      while (along - inward > Math.PI) along -= Math.PI * 2
      while (along - inward < -Math.PI) along += Math.PI * 2
      const solid: Solid = { x: pivot.x, z: pivot.z, r: len / 2 + 1, hx: len / 2, hz: 0.45, cos: 1, sin: 0, top: pivot.y + 1.6, floor: pivot.y - 1.5, bounce: 7 }
      world.movers.push(solid)
      const phase = placed * 1.7
      onFrame((f) => {
        // across for a beat, then away: a two-second gap every four seconds
        const w = 0.5 - 0.5 * Math.cos((f.time * 0.8 + phase) * Math.PI / 2)
        const a = THREE.MathUtils.lerp(along, inward, THREE.MathUtils.smoothstep(w, 0.15, 0.85))
        arm.rotation.y = a
        const bx = Math.cos(a), bz = -Math.sin(a)
        solid.x = pivot.x + bx * len / 2
        solid.z = pivot.z + bz * len / 2
        solid.cos = bx
        solid.sin = -bz
        lamp.material.color.setRGB(w > 0.5 ? 3 : 0.6, w > 0.5 ? 0.5 : 2.2, 0.3)
      })
      placed++
    }
  }
  return placed
}
