import * as THREE from 'three'
import type { Car } from './Car'

/**
 * Chase camera: sits a fixed distance behind/above the car at ANY speed.
 * It follows the car rigidly; only changes in its offset (swinging round
 * in corners, the turn lean, bumps) are smoothed, so it still eases
 * through turns but never falls behind on the straights. FOV widens with
 * speed.
 */
export class ChaseCamera {
  // Classic retrowave chase: behind AND above, looking down at the car so it
  // reads as a 3D vehicle (roof + rear visible) instead of a flat side-on
  // slab. Car sits in the lower third with lots of road ahead.
  private static readonly BASE_HEIGHT = 3.1
  private static readonly BASE_DISTANCE = 7.8
  private height = ChaseCamera.BASE_HEIGHT
  private distance = ChaseCamera.BASE_DISTANCE
  private readonly lookAhead = 8
  private readonly sideLean = 1.5 // subtle lateral slide outward on turns — sells "leaning into" the corner without rolling the horizon

  private readonly _desired = new THREE.Vector3()
  private readonly _lookTarget = new THREE.Vector3()
  private readonly _forward = new THREE.Vector3()
  private readonly _right = new THREE.Vector3()
  private leanX = 0
  // Smoothed offset of the camera from where it is aiming to be
  private readonly _lag = new THREE.Vector3()
  private readonly _prevDesired = new THREE.Vector3()
  private hasPrev = false
  /** Seconds for a corner swing to settle (smaller = stiffer). */
  private readonly swing = 0.14

  private readonly baseFov = 60
  private readonly maxFovBoost = 18 // FOV surge at speed — wide enough to feel fast, not so wide the car shrinks

  private fovKick = 0
  /** Momentary FOV punch (degrees), e.g. entering a new area or a jump. */
  kick(deg: number): void {
    this.fovKick = Math.max(this.fovKick, deg)
  }

  /** Camera distance multiplier (settings: near 0.8 / normal 1 / far 1.25). */
  setDistanceScale(k: number): void {
    this.distance = ChaseCamera.BASE_DISTANCE * k
    this.height = ChaseCamera.BASE_HEIGHT * (0.85 + 0.15 * k)
  }

  /** Snap instantly to the correct pose (on race start / reset). */
  snap(camera: THREE.PerspectiveCamera, car: Car): void {
    this.leanX = -car.steer * this.sideLean
    this.computeDesired(car)
    camera.position.copy(this._desired)
    this._prevDesired.copy(this._desired)
    this.hasPrev = true
    this.computeLookTarget(car)
    camera.lookAt(this._lookTarget)
  }

  update(camera: THREE.PerspectiveCamera, car: Car, dt: number): void {
    // Smooth the lateral lean toward the outside of the turn
    const targetLean = -car.steer * this.sideLean * (0.4 + car.getNormalizedSpeed() * 0.6)
    this.leanX = THREE.MathUtils.lerp(this.leanX, targetLean, 1 - Math.pow(0.002, dt))

    this.computeDesired(car)
    // Where the camera sits relative to LAST frame's target. Forward motion
    // moves the target and the camera together, so speed adds no lag; only
    // the swing of the target around the car (turning) is eased out.
    if (this.hasPrev) this._lag.copy(camera.position).sub(this._prevDesired)
    else this._lag.set(0, 0, 0)
    this._lag.multiplyScalar(Math.exp(-dt / this.swing)).clampLength(0, 3)
    camera.position.copy(this._desired).add(this._lag)
    this._prevDesired.copy(this._desired)
    this.hasPrev = true

    this.computeLookTarget(car)
    camera.lookAt(this._lookTarget)

    // No camera roll — it kept reading as the car being "tilted/horizontal".
    // The lateral lean (position offset) alone conveys the turn.
    // Extra FOV kick while the nitro fires
    this.fovKick = Math.max(0, this.fovKick - dt * 14)
    const targetFov = this.baseFov + Math.min(car.getNormalizedSpeed(), 1.25) * this.maxFovBoost + (car.boosting ? 5 : 0) + this.fovKick
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.pow(0.001, dt))
    camera.updateProjectionMatrix()
  }

  private computeDesired(car: Car): void {
    car.getForwardDir(this._forward)
    this._right.set(-this._forward.z, 0, this._forward.x) // right = forward rotated -90° in XZ
    this._desired.copy(car.position)
    this._desired.addScaledVector(this._forward, -this.distance) // behind
    this._desired.addScaledVector(this._right, this.leanX) // lean outward on turns
    this._desired.y += this.height
    // Camera rides the suspension a little: dips on landings and bumps
    this._desired.y += car.getBodyHeave() * 0.6
  }

  private computeLookTarget(car: Car): void {
    car.getForwardDir(this._forward)
    this._lookTarget.copy(car.position)
    this._lookTarget.addScaledVector(this._forward, this.lookAhead)
    this._lookTarget.y += 2.1 + car.getBodyHeave() * 0.4 - car.getBodyPitch() * 3
  }
}
