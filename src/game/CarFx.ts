import * as THREE from 'three'
import { softDot } from './biomes/kit'

const STREAKS = 170

/**
 * Showy car and speed effects: an underglow in the area's colour, wind streaks
 * that race past the camera, and a huge sun on the horizon.
 */
export class CarFx {
  readonly group = new THREE.Group()
  private readonly glow: THREE.Mesh
  private readonly streaks: THREE.LineSegments
  private readonly streakPos = new Float32Array(STREAKS * 6)
  private readonly seeds = new Float32Array(STREAKS * 3)
  private readonly sun: THREE.Sprite
  private readonly halo: THREE.Sprite
  private readonly _f = new THREE.Vector3()
  private readonly _r = new THREE.Vector3()

  constructor() {
    this.group.frustumCulled = false
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 7.2), new THREE.MeshBasicMaterial({
      map: softDot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    }))
    this.glow.rotation.x = -Math.PI / 2
    this.glow.renderOrder = 2
    this.group.add(this.glow)

    for (let k = 0; k < STREAKS; k++) {
      const a = Math.random() * Math.PI * 2
      this.seeds[k * 3] = Math.cos(a) * (5 + Math.random() * 16)
      this.seeds[k * 3 + 1] = Math.sin(a) * (3 + Math.random() * 9) + 3
      this.seeds[k * 3 + 2] = Math.random()
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3))
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.streaks.frustumCulled = false
    this.group.add(this.streaks)

    const sunMat = new THREE.SpriteMaterial({ map: softDot(), color: new THREE.Color(1.5, 1.05, 0.7), transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, toneMapped: false })
    this.sun = new THREE.Sprite(sunMat)
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: new THREE.Color(0.8, 0.42, 0.25), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }))
    this.group.add(this.halo, this.sun)
  }

  /**
   * @param car the car's body; speed 0–1+; accent the area colour
   * @param sunDir direction to the sun; sunOn 0–1 (off in the sea, space, city)
   */
  update(dt: number, time: number, carObj: THREE.Object3D, heading: number, speed: number, accent: THREE.Color, onRoad: boolean, cam: THREE.Camera, sunDir: THREE.Vector3, sunOn: number): void {
    const p = carObj.position
    this._f.set(-Math.sin(heading), 0, -Math.cos(heading))
    this._r.set(-this._f.z, 0, this._f.x)

    // underglow pools on the road; off while airborne
    const gm = this.glow.material as THREE.MeshBasicMaterial
    gm.color.copy(accent)
    gm.opacity = onRoad ? 0.42 + Math.sin(time * 5) * 0.04 : 0
    this.glow.position.set(p.x, p.y + 0.09, p.z)
    this.glow.rotation.z = heading

    // wind streaks flying past, only at real speed
    const k01 = THREE.MathUtils.smoothstep(speed, 0.55, 1.1)
    ;(this.streaks.material as THREE.LineBasicMaterial).opacity = k01 * 0.3
    ;(this.streaks.material as THREE.LineBasicMaterial).color.copy(accent).lerp(new THREE.Color(1, 1, 1), 0.6)
    if (k01 > 0.01) {
      const len = 6 + speed * 12
      for (let k = 0; k < STREAKS; k++) {
        const s = this.seeds
        s[k * 3 + 2] = (s[k * 3 + 2]! + dt * (1.1 + speed)) % 1
        const along = 60 - s[k * 3 + 2]! * 75
        const x = p.x + this._f.x * along + this._r.x * s[k * 3]!
        const y = p.y + s[k * 3 + 1]!
        const z = p.z + this._f.z * along + this._r.z * s[k * 3]!
        const o = k * 6
        this.streakPos[o] = x; this.streakPos[o + 1] = y; this.streakPos[o + 2] = z
        this.streakPos[o + 3] = x - this._f.x * len; this.streakPos[o + 4] = y; this.streakPos[o + 5] = z - this._f.z * len
      }
      ;(this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }

    // the sun: huge and low, always the same distance from the camera
    const on = sunOn > 0.01 && sunDir.y > -0.05
    this.sun.visible = this.halo.visible = on
    if (on) {
      const low = 1 - THREE.MathUtils.smoothstep(sunDir.y, 0.1, 0.7)
      this.sun.position.copy(cam.position).addScaledVector(sunDir, 1000)
      this.halo.position.copy(this.sun.position)
      const size = 70 + low * 80
      this.sun.scale.setScalar(size)
      this.halo.scale.setScalar(size * 2.2)
      ;(this.sun.material as THREE.SpriteMaterial).opacity = sunOn * low * 0.8
      ;(this.halo.material as THREE.SpriteMaterial).opacity = sunOn * 0.08 * low
    }
  }
}
