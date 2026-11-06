import * as THREE from 'three'

/**
 * Menu camera: a slow, low orbit around the car on the start line, framed so
 * the car sits to the right of the menu panel.
 */
export class CinematicCamera {
  private t = 0.6
  private readonly _look = new THREE.Vector3()
  private readonly _side = new THREE.Vector3()

  update(camera: THREE.PerspectiveCamera, dt: number, target: THREE.Vector3, heading = 0): void {
    this.t += dt * 0.07
    // always ahead of the car and over the road, so no trackside board can block the view
    const a = heading + Math.PI + 0.7 + Math.sin(this.t) * 0.35
    const radius = 11.5 + Math.sin(this.t * 0.6) * 0.8
    camera.position.set(target.x + Math.sin(a) * radius, target.y + 1.25 + Math.sin(this.t * 0.4) * 0.3, target.z + Math.cos(a) * radius)
    // aim left of the car so it lands in the right half of the frame
    this._side.set(Math.cos(a), 0, -Math.sin(a))
    this._look.copy(target).addScaledVector(this._side, -2.1).setY(target.y + 1)
    camera.lookAt(this._look)
    if (camera.fov !== 38) {
      camera.fov = 38
      camera.updateProjectionMatrix()
    }
  }
}
