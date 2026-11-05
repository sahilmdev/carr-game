import * as THREE from 'three'
import { softDot } from './kit'
import type { ParticleKind } from './Moods'

interface Spec {
  count: number
  size: number
  color: number
  opacity: number
  additive?: boolean
  /** base velocity (m/s) */
  vel: [number, number, number]
  /** random sway amplitude (m/s) */
  sway: number
  box: number
}

const SPECS: Record<ParticleKind, Spec> = {
  ash: { count: 2200, size: 0.18, color: 0x8a8580, opacity: 0.8, vel: [1.2, -0.9, 0.4], sway: 0.6, box: 70 },
  embers: { count: 500, size: 0.22, color: 0xff7a26, opacity: 1, additive: true, vel: [0.6, 1.6, 0.3], sway: 1.2, box: 60 },
  snow: { count: 3500, size: 0.2, color: 0xffffff, opacity: 0.95, vel: [0.8, -2.2, 0.3], sway: 0.9, box: 70 },
  sand: { count: 4000, size: 0.12, color: 0xc9a473, opacity: 0.75, vel: [14, -0.4, 5], sway: 2.5, box: 60 },
  pollen: { count: 700, size: 0.14, color: 0xfff2a0, opacity: 0.9, additive: true, vel: [0.2, 0.15, 0.1], sway: 0.5, box: 50 },
}

/** Camera-local ambient particles (ash, embers, snow, blowing sand, pollen). */
export class Particles {
  readonly group = new THREE.Group()
  private readonly sets = new Map<ParticleKind, { pts: THREE.Points; pos: Float32Array; seed: Float32Array; spec: Spec }>()

  constructor() {
    for (const [kind, spec] of Object.entries(SPECS) as [ParticleKind, Spec][]) {
      const pos = new Float32Array(spec.count * 3)
      const seed = new Float32Array(spec.count)
      for (let k = 0; k < spec.count; k++) {
        pos[k * 3] = (Math.random() - 0.5) * spec.box
        pos[k * 3 + 1] = (Math.random() - 0.5) * spec.box * 0.6
        pos[k * 3 + 2] = (Math.random() - 0.5) * spec.box
        seed[k] = Math.random() * 100
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const mat = new THREE.PointsMaterial({
        size: spec.size, map: softDot(), color: spec.color, transparent: true, opacity: 0,
        depthWrite: false, sizeAttenuation: true, blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      const pts = new THREE.Points(g, mat)
      pts.frustumCulled = false
      pts.visible = false
      this.group.add(pts)
      this.sets.set(kind, { pts, pos, seed, spec })
    }
  }

  update(camera: THREE.Camera, dt: number, time: number, weights: Record<ParticleKind, number>): void {
    const c = camera.position
    for (const [kind, s] of this.sets) {
      const w = weights[kind] ?? 0
      s.pts.visible = w > 0.02
      if (!s.pts.visible) continue
      ;(s.pts.material as THREE.PointsMaterial).opacity = s.spec.opacity * Math.min(1, w * 1.2)
      // keep the cloud of particles centred on the camera (wrapped box)
      s.pts.position.set(0, 0, 0)
      const B = s.spec.box, H = B * 0.6
      const p = s.pos
      const [vx, vy, vz] = s.spec.vel
      const sw = s.spec.sway
      for (let k = 0; k < s.spec.count; k++) {
        const sd = s.seed[k]!
        let x = p[k * 3]! + (vx + Math.sin(time * 0.9 + sd) * sw) * dt
        let y = p[k * 3 + 1]! + (vy + Math.cos(time * 0.7 + sd * 1.3) * sw * 0.4) * dt
        let z = p[k * 3 + 2]! + (vz + Math.cos(time * 0.8 + sd) * sw) * dt
        // wrap relative to the camera
        x = c.x + ((((x - c.x + B / 2) % B) + B) % B) - B / 2
        y = c.y + ((((y - c.y + H / 2) % H) + H) % H) - H / 2
        z = c.z + ((((z - c.z + B / 2) % B) + B) % B) - B / 2
        p[k * 3] = x; p[k * 3 + 1] = y; p[k * 3 + 2] = z
      }
      ;(s.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
  }
}
