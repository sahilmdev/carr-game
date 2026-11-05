import * as THREE from 'three'

/**
 * Falling rain around the camera: a few thousand short vertical streaks in
 * a box that follows the camera. Drops fall straight down in world space
 * (the camera simply moves through them); each streak is drawn along the
 * drop's own fall, so rain always reads as top-to-bottom. One draw call.
 */
export class Rain {
  public readonly lines: THREE.LineSegments
  private readonly mat: THREE.LineBasicMaterial
  private readonly pos: Float32Array
  private readonly drops: Float32Array // x, y, z, fallSpeed
  private readonly count: number
  private readonly prevCam = new THREE.Vector3()
  private readonly camVel = new THREE.Vector3()
  private level = 0
  private hasPrev = false

  private static readonly BOX = 34 // half-width (m)
  private static readonly TOP = 24
  private static readonly BOTTOM = -6
  private static readonly WIND = new THREE.Vector3(0, 0, 0) // calm: straight down

  constructor(count = 3200) {
    this.count = count
    this.pos = new Float32Array(count * 6)
    this.drops = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      this.drops[i * 4] = (Math.random() * 2 - 1) * Rain.BOX
      this.drops[i * 4 + 1] = Rain.BOTTOM + Math.random() * (Rain.TOP - Rain.BOTTOM)
      this.drops[i * 4 + 2] = (Math.random() * 2 - 1) * Rain.BOX
      this.drops[i * 4 + 3] = 10 + Math.random() * 4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.mat = new THREE.LineBasicMaterial({
      color: 0xb8c2cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.lines = new THREE.LineSegments(geo, this.mat)
    this.lines.frustumCulled = false
    this.lines.visible = false
  }

  /** 0 = dry, 1 = heavy rain. */
  setLevel(level: number): void {
    this.level = level
    this.mat.opacity = 0.32 * level
  }

  /**
   * @param show false hides the rain (underwater / in space)
   * Drops are stored relative to the camera and wrap around it.
   */
  update(camera: THREE.Camera, dt: number, show: boolean): void {
    this.lines.visible = show && this.level > 0.01
    if (!this.lines.visible || dt <= 0) { this.hasPrev = false; return }
    const cam = camera.position
    if (this.hasPrev) this.camVel.copy(cam).sub(this.prevCam).divideScalar(dt)
    else this.camVel.set(0, 0, 0)
    this.prevCam.copy(cam)
    this.hasPrev = true

    const B = Rain.BOX, W = Rain.WIND
    const span = Rain.TOP - Rain.BOTTOM
    const streak = 0.045 // seconds of motion blur per streak
    const n = Math.floor(this.count * Math.min(1, 0.35 + this.level * 0.65))
    for (let i = 0; i < this.count; i++) {
      const d = i * 4
      const fall = this.drops[d + 3]!
      // Move in world space, then shift by camera motion so the box follows
      let x = this.drops[d]! + (W.x - this.camVel.x) * dt
      let y = this.drops[d + 1]! + (-fall - this.camVel.y) * dt
      let z = this.drops[d + 2]! + (W.z - this.camVel.z) * dt
      if (y < Rain.BOTTOM) { y += span; x = (Math.random() * 2 - 1) * B; z = (Math.random() * 2 - 1) * B }
      if (y > Rain.TOP) y -= span
      if (x > B) x -= 2 * B; else if (x < -B) x += 2 * B
      if (z > B) z -= 2 * B; else if (z < -B) z += 2 * B
      this.drops[d] = x; this.drops[d + 1] = y; this.drops[d + 2] = z
      const o = i * 6
      if (i >= n) { this.pos.fill(0, o, o + 6); continue } // lighter rain = fewer drops
      // Streak along the drop's own fall (world space), not camera motion
      const vx = W.x, vy = -fall, vz = W.z
      this.pos[o] = cam.x + x; this.pos[o + 1] = cam.y + y; this.pos[o + 2] = cam.z + z
      this.pos[o + 3] = cam.x + x - vx * streak
      this.pos[o + 4] = cam.y + y - vy * streak
      this.pos[o + 5] = cam.z + z - vz * streak
    }
    this.lines.geometry.getAttribute('position').needsUpdate = true
  }
}
