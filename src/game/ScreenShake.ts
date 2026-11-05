import * as THREE from 'three'

/** Trauma-based camera shake: intensity = trauma², decays over time. */
export class ScreenShake {
  private trauma = 0
  private readonly decay = 2.2
  private readonly maxOffset = 0.25
  private readonly maxAngle = 0.012

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(camera: THREE.Camera, dt: number): void {
    if (this.trauma <= 0) return
    const shake = this.trauma * this.trauma
    const t = performance.now() / 1000
    camera.position.x += Math.sin(t * 47) * this.maxOffset * shake
    camera.position.y += Math.cos(t * 37) * this.maxOffset * shake * 0.5
    // rotateZ composes on the quaternion; writing rotation.z after a lookAt
    // corrupts the orientation.
    camera.rotateZ(Math.sin(t * 59) * this.maxAngle * shake)
    this.trauma = Math.max(0, this.trauma - this.decay * dt)
  }
}
